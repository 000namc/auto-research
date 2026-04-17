"""Tmux-based control plane for auto-research agent sessions.

An **agent** is addressed by a pair `(role, name)`:

- If the role's cardinality is `single`, there is exactly one instance and
  `name is None`. Paths are `agents/{role}/...`. Session is `agent-{role}`.
- If the role's cardinality is `multi`, each instance has a slug name.
  Paths are `agents/{role}/{name}/...`. Session is `agent-{role}:{name}`.

Singletons are spawned/stopped via `start_agent(role)` / `stop_agent(role)`.
Multi instances are created via `spawn_instance(role, name)` and torn down via
`stop_instance(role, name)` (tmux only) or `archive_instance(role, name)`
(tmux + filesystem → `.archive/`).

The api container has a tmux client (apt-installed in Dockerfile.api) that
connects to the agents container's tmux server via the shared `tmux-socket`
named volume mounted at /tmp/tmux-1000 in both containers. When the api
spawns a new session via `tmux new-session ... cmd`, the cmd runs inside the
agents container (so the resulting `claude` process lives there, not in the
api container).

All write side-effects on tmux state are funneled through this module so the
behavior is auditable in one place.
"""
from __future__ import annotations

import hashlib
import logging
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable, Literal, Optional

logger = logging.getLogger("api.agents")

REPO_ROOT = Path("/app/data/auto-research")

# Role cardinality. Iteration order matches the UI's top-to-bottom display.
Cardinality = Literal["single", "multi"]
CARDINALITY: dict[str, Cardinality] = {
    "orchestrator": "single",
    "research-worker": "multi",
    "execution-worker": "multi",
    "writing-worker": "multi",
}
ROLES: tuple[str, ...] = tuple(CARDINALITY.keys())

SESSION_PREFIX = "agent-"
TMUX_TIMEOUT_S = 5.0

# Instance name: short, kebab-friendly, safe for both tmux session names
# (no ':' or whitespace) and filesystem paths.
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$|^[a-z0-9]$")


class TmuxError(RuntimeError):
    pass


@dataclass
class AgentInfo:
    role: str
    name: Optional[str]         # None for singletons, slug for multi
    address: str                # "role" or "role/name" — stable id for UI/routing
    session: str                # tmux session name
    tmux_state: str             # "up" | "down"
    heartbeat: Optional[str]
    inbox_count: int
    outbox_count: int
    pane_lines: int             # rough proxy for context size; 0 if down


# ───────────────────────── helpers ─────────────────────────


def _tmux(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    """Run a tmux command. Raises TmuxError on failure when check=True."""
    cmd = ["tmux", *args]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=TMUX_TIMEOUT_S,
        )
    except FileNotFoundError as e:
        raise TmuxError("tmux binary not on PATH inside the api container") from e
    except subprocess.TimeoutExpired as e:
        raise TmuxError(f"tmux {' '.join(args)} timed out after {TMUX_TIMEOUT_S}s") from e
    if check and result.returncode != 0:
        stderr = result.stderr.strip() or result.stdout.strip()
        raise TmuxError(f"tmux {' '.join(args)} failed (rc={result.returncode}): {stderr}")
    return result


def _validate_role(role: str) -> None:
    if role not in CARDINALITY:
        raise ValueError(f"unknown role '{role}'. allowed: {ROLES}")


def _validate_name(name: str) -> None:
    if not _NAME_RE.match(name):
        raise ValueError(
            f"invalid instance name '{name}' — must be [a-z0-9-], length 1..32, "
            "no leading/trailing hyphen"
        )
    if name.startswith("."):
        raise ValueError(f"reserved instance name: '{name}'")
    # Reserve internal directory names + HTTP action segments so the
    # instance never shadows a route path like /api/agents/{role}/spawn.
    RESERVED = {
        "inbox", "outbox", "log", "status", "identity",
        "spawn", "start", "stop", "restart", "archive", "pane", "input",
    }
    if name in RESERVED:
        raise ValueError(f"reserved instance name: '{name}'")


def session_for(role: str, name: Optional[str] = None) -> str:
    _validate_role(role)
    if name is None:
        if CARDINALITY[role] != "single":
            raise ValueError(f"role '{role}' is multi — an instance name is required")
        return SESSION_PREFIX + role
    if CARDINALITY[role] != "multi":
        raise ValueError(f"role '{role}' is single — does not accept an instance name")
    _validate_name(name)
    # Underscore separator: tmux forbids ':' and '.' in session names (both are
    # reserved as session:window.pane separators), so we use '_'. Since role
    # slugs are kebab-case and instance slugs are kebab-case (both disallow
    # '_'), the resulting session name `agent-{role}_{name}` can still be
    # decoded one way if needed.
    return f"{SESSION_PREFIX}{role}_{name}"


def address_for(role: str, name: Optional[str]) -> str:
    return role if name is None else f"{role}/{name}"


def agent_dir(role: str, name: Optional[str] = None) -> Path:
    """Filesystem root for an agent's inbox/outbox/log/status files."""
    _validate_role(role)
    if name is None:
        return REPO_ROOT / "agents" / role
    _validate_name(name)
    return REPO_ROOT / "agents" / role / name


def _has_session(session: str) -> bool:
    return _tmux("has-session", "-t", session, check=False).returncode == 0


# ───────────────────────── listing ─────────────────────────


def _list_instance_names(role: str) -> list[str]:
    """Filesystem-backed list of instance names for a multi role.

    An instance exists iff its directory exists. This is decoupled from the
    tmux state — an instance may be stopped (no tmux session) but still
    "present" as files.
    """
    if CARDINALITY[role] != "multi":
        return []
    root = REPO_ROOT / "agents" / role
    if not root.is_dir():
        return []
    names: list[str] = []
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        if child.name.startswith("."):  # skip .archive etc.
            continue
        # Require the name to pass validation — defensive against manual mucking.
        try:
            _validate_name(child.name)
        except ValueError:
            logger.debug("ignoring invalid instance dir %s", child)
            continue
        names.append(child.name)
    return names


def _iter_addresses() -> Iterable[tuple[str, Optional[str]]]:
    """Yield (role, name) for every known agent, in display order."""
    for role in ROLES:
        if CARDINALITY[role] == "single":
            yield (role, None)
        else:
            for name in _list_instance_names(role):
                yield (role, name)


def _info_for_address(role: str, name: Optional[str]) -> AgentInfo:
    session = session_for(role, name)
    tmux_state = "up" if _has_session(session) else "down"

    base = agent_dir(role, name)
    status_path = base / "status"
    heartbeat: Optional[str] = None
    if status_path.exists() and status_path.stat().st_size > 0:
        try:
            heartbeat = status_path.read_text(encoding="utf-8").strip()
        except OSError:
            heartbeat = None

    inbox_dir = base / "inbox"
    outbox_dir = base / "outbox"
    inbox_count = sum(1 for _ in inbox_dir.glob("*.json")) if inbox_dir.is_dir() else 0
    outbox_count = sum(1 for _ in outbox_dir.glob("*.json")) if outbox_dir.is_dir() else 0

    pane_lines = 0
    if tmux_state == "up":
        try:
            cap = _tmux("capture-pane", "-t", session, "-p", "-S", "-")
            pane_lines = sum(1 for _ in cap.stdout.splitlines())
        except TmuxError as e:
            logger.warning("capture-pane failed for %s: %s", session, e)

    return AgentInfo(
        role=role,
        name=name,
        address=address_for(role, name),
        session=session,
        tmux_state=tmux_state,
        heartbeat=heartbeat,
        inbox_count=inbox_count,
        outbox_count=outbox_count,
        pane_lines=pane_lines,
    )


def list_agents() -> list[AgentInfo]:
    return [_info_for_address(role, name) for role, name in _iter_addresses()]


def _info_for(role: str, name: Optional[str] = None) -> AgentInfo:
    return _info_for_address(role, name)


# ───────────────────────── singleton lifecycle ─────────────────────────


def _ensure_agent_dirs(role: str, name: Optional[str]) -> None:
    """Create inbox/outbox/log and an empty status file if missing."""
    base = agent_dir(role, name)
    # inbox/outbox are always directories. 'log' is convention-dependent —
    # some existing singletons keep it as a single append-only file; we only
    # create it as a directory if it does not already exist in some form.
    for sub in ("inbox", "outbox"):
        (base / sub).mkdir(parents=True, exist_ok=True)
    log_path = base / "log"
    if not log_path.exists():
        log_path.mkdir(parents=True, exist_ok=True)
    status = base / "status"
    if not status.exists():
        status.touch()


def _spawn_session(role: str, name: Optional[str]) -> None:
    """Create the tmux session for (role, name). Session must not already exist."""
    session = session_for(role, name)
    spawn_script = REPO_ROOT / "bin" / "spawn-agent.sh"
    if not spawn_script.exists():
        raise TmuxError(f"spawn script missing: {spawn_script}")
    args = [
        "new-session",
        "-d",
        "-s",
        session,
        "-c",
        str(REPO_ROOT),
        str(spawn_script),
        role,
    ]
    if name is not None:
        args.append(name)
    _tmux(*args)
    logger.info("spawned %s", session)


def start_agent(role: str) -> AgentInfo:
    """Idempotent. Singleton-only — multi roles must use spawn_instance."""
    _validate_role(role)
    if CARDINALITY[role] != "single":
        raise ValueError(
            f"role '{role}' is multi; call spawn_instance(role, name) instead"
        )
    session = session_for(role)
    if _has_session(session):
        logger.info("start_agent: %s already up", session)
    else:
        _ensure_agent_dirs(role, None)
        _spawn_session(role, None)
    return _info_for(role)


def stop_agent(role: str) -> AgentInfo:
    """Idempotent. Singleton-only. Kills the tmux session if it exists."""
    _validate_role(role)
    if CARDINALITY[role] != "single":
        raise ValueError(
            f"role '{role}' is multi; call stop_instance(role, name) instead"
        )
    session = session_for(role)
    if _has_session(session):
        _tmux("kill-session", "-t", session)
        logger.info("stop_agent: killed %s", session)
    return _info_for(role)


def restart_agent(role: str) -> AgentInfo:
    stop_agent(role)
    return start_agent(role)


# ───────────────────────── multi-instance lifecycle ─────────────────────────


def spawn_instance(role: str, name: str) -> AgentInfo:
    """Create a new multi-role instance. Fails if one with this name already
    exists (directory present) to avoid silently reusing an archived slug."""
    _validate_role(role)
    if CARDINALITY[role] != "multi":
        raise ValueError(f"role '{role}' is single — cannot spawn a named instance")
    _validate_name(name)

    base = agent_dir(role, name)
    if base.exists():
        raise ValueError(f"instance already exists: {address_for(role, name)}")

    _ensure_agent_dirs(role, name)
    try:
        _spawn_session(role, name)
    except TmuxError:
        # Roll back the directory if tmux spawn failed — avoids leaving
        # half-initialized instances around.
        try:
            shutil.rmtree(base)
        except OSError:
            pass
        raise
    return _info_for(role, name)


def start_instance(role: str, name: str) -> AgentInfo:
    """Start a previously-spawned instance (files present, tmux down)."""
    _validate_role(role)
    if CARDINALITY[role] != "multi":
        raise ValueError(f"role '{role}' is single; use start_agent instead")
    _validate_name(name)
    base = agent_dir(role, name)
    if not base.is_dir():
        raise ValueError(f"instance not found: {address_for(role, name)}")
    session = session_for(role, name)
    if _has_session(session):
        logger.info("start_instance: %s already up", session)
    else:
        _ensure_agent_dirs(role, name)
        _spawn_session(role, name)
    return _info_for(role, name)


def stop_instance(role: str, name: str) -> AgentInfo:
    """Kill the tmux session for an instance. Files remain intact."""
    _validate_role(role)
    if CARDINALITY[role] != "multi":
        raise ValueError(f"role '{role}' is single; use stop_agent instead")
    _validate_name(name)
    session = session_for(role, name)
    if _has_session(session):
        _tmux("kill-session", "-t", session)
        logger.info("stop_instance: killed %s", session)
    return _info_for(role, name)


def restart_instance(role: str, name: str) -> AgentInfo:
    stop_instance(role, name)
    return start_instance(role, name)


def archive_instance(role: str, name: str) -> None:
    """Stop + move files to agents/{role}/.archive/{name}-{ts}/. Irreversible
    from the UI's perspective (the instance disappears from list_agents)."""
    _validate_role(role)
    if CARDINALITY[role] != "multi":
        raise ValueError(f"role '{role}' is single — cannot archive")
    _validate_name(name)
    base = agent_dir(role, name)
    if not base.is_dir():
        raise ValueError(f"instance not found: {address_for(role, name)}")
    stop_instance(role, name)
    archive_root = REPO_ROOT / "agents" / role / ".archive"
    archive_root.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%dT%H%M%S")
    dest = archive_root / f"{name}-{ts}"
    shutil.move(str(base), str(dest))
    logger.info("archived %s → %s", address_for(role, name), dest)


# ───────────────────────── pane / input ─────────────────────────


def capture_pane(role: str, name: Optional[str] = None, n_lines: int = 200) -> str:
    """Return the last n_lines of the agent's tmux pane."""
    session = session_for(role, name)
    if not _has_session(session):
        raise TmuxError(f"session {session} is not running")
    result = _tmux("capture-pane", "-t", session, "-p", "-S", f"-{n_lines}")
    return result.stdout


def pane_hash(role: str, name: Optional[str] = None, n_lines: int = 200) -> Optional[str]:
    """Short hash of the current pane content (for SSE change detection).

    Returns None if the session is not running.
    """
    session = session_for(role, name)
    if not _has_session(session):
        return None
    try:
        content = capture_pane(role, name, n_lines=n_lines)
    except TmuxError:
        return None
    return hashlib.sha256(content.encode("utf-8", errors="replace")).hexdigest()[:16]


def send_input(role: str, message: str, name: Optional[str] = None) -> None:
    """Send a string followed by Enter to the agent's tmux pane.

    (Kept for programmatic one-off pokes. Interactive use goes through the
    /ws/agent WebSocket.)
    """
    if not message:
        raise ValueError("message must be non-empty")
    session = session_for(role, name)
    if not _has_session(session):
        raise TmuxError(f"session {session} is not running")
    _tmux("send-keys", "-t", session, message, "Enter")


def info_dict(info: AgentInfo) -> dict:
    return asdict(info)
