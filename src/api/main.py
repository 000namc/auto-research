"""FastAPI app — Kanban webapp backend.

Endpoints
---------
GET  /api/health                       → liveness
GET  /api/cards                        → list (frontmatter only) of all projects/*/card.md
GET  /api/cards/{id}                   → full card (frontmatter + sections + parsed lists)
POST /api/cards/{id}/commands          → append a command to Command Queue
GET  /api/directions                   → list (frontmatter + counts) of explore/*/direction.md
POST /api/directions                   → scaffold a new direction
GET  /api/directions/{slug}            → full direction + finding summaries
POST /api/directions/{slug}/commands   → append command; deterministic verbs processed sync
GET  /api/directions/{slug}/findings/{fid}  → full finding body
GET  /api/docs                         → list *.md files under docs/ (recursive, private/ hidden)
GET  /api/docs/{path:path}             → read docs/<path>.md (supports subdirs)
PUT  /api/docs/{path:path}             → atomic overwrite docs/<path>.md (creates subdirs)
POST /api/docs/{path:path}/move        → rename/move doc to a new path
DELETE /api/docs/{path:path}           → delete a doc
GET  /api/agents                       → list of 4 agent sessions with status
POST /api/agents/{role}/start          → spawn agent's tmux session (idempotent)
POST /api/agents/{role}/stop           → kill agent's tmux session (idempotent)
POST /api/agents/{role}/restart        → stop + start
GET  /api/agents/{role}/pane           → capture-pane content (last N lines)
POST /api/agents/{role}/input          → send a message to the agent's pane
GET  /api/events                       → SSE stream: card_*, direction_*, finding_*, agent_*, docs_*

CARDS_ROOT (env, default `/app/data/auto-research`) is the directory containing
projects/<slug>/card.md. The compose file bind-mounts the host's repo root
at /app/data/auto-research (uniform path across all containers; the host
path is configurable via `PROJECT_ROOT` in `.env`).

Bind: 127.0.0.1 only (per CLAUDE.md "Webapp 접근" rule). Compose runs us with
network_mode: host so this binds directly to the host loopback.
"""
from __future__ import annotations

import logging
import os
import re
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from shared.card import (
    KNOWN_VERBS,
    Card,
    Frontmatter as CardFrontmatter,
    append_command,
    append_event as append_card_event,
    find_cards,
    load_card,
    save_card,
)
from shared import direction as dmod
from shared.direction import (
    CADENCES,
    DIRECTION_KINDS,
    FINDING_FILENAME_RE,
    FINDING_INTERESTS,
    FINDING_KINDS,
    KNOWN_DIRECTION_VERBS,
    Direction,
    DirectionFrontmatter,
    Finding,
    FindingFrontmatter,
    compute_next_run,
    find_directions,
    list_findings,
    load_direction,
    load_finding,
    next_finding_id,
    save_direction,
    save_finding,
)

from .agents import (
    CARDINALITY,
    ROLES,
    TmuxError,
    archive_instance,
    capture_pane,
    info_dict,
    list_agents,
    restart_agent,
    restart_instance,
    send_input,
    spawn_instance,
    start_agent,
    start_instance,
    stop_agent,
    stop_instance,
)
from .sse import AgentWatcher, CardWatcher, DirectionWatcher, DocsWatcher, EventBus
from .ws_terminal import router as ws_terminal_router

logger = logging.getLogger("api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

CARDS_ROOT = Path(os.environ.get("CARDS_ROOT", "/app/data/auto-research")).resolve()
DOCS_DIR = CARDS_ROOT / "docs"
# Cap per-doc payloads — docs are human-editable notes, not novels.
DOC_MAX_BYTES = 256 * 1024


# ───────────────────────── lifespan ─────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not CARDS_ROOT.exists():
        raise RuntimeError(f"CARDS_ROOT does not exist: {CARDS_ROOT}")
    bus = EventBus()
    card_watcher = CardWatcher(root=CARDS_ROOT, bus=bus)
    direction_watcher = DirectionWatcher(root=CARDS_ROOT, bus=bus)
    agent_watcher = AgentWatcher(bus=bus)
    docs_watcher = DocsWatcher(docs_dir=DOCS_DIR, bus=bus)
    await card_watcher.start()
    await direction_watcher.start()
    await agent_watcher.start()
    await docs_watcher.start()
    app.state.bus = bus
    app.state.card_watcher = card_watcher
    app.state.direction_watcher = direction_watcher
    app.state.agent_watcher = agent_watcher
    app.state.docs_watcher = docs_watcher
    logger.info("API ready, CARDS_ROOT=%s", CARDS_ROOT)
    try:
        yield
    finally:
        await card_watcher.stop()
        await direction_watcher.stop()
        await agent_watcher.stop()
        await docs_watcher.stop()


app = FastAPI(title="auto-research API", version="0.1.0", lifespan=lifespan)
app.include_router(ws_terminal_router)


# ───────────────────────── helpers ─────────────────────────


_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def _resolve_card_path(card_id: str) -> Path:
    """Resolve a card slug to its file path, with traversal protection.

    Slug rules: lowercase alphanumerics + hyphen/underscore, 1..64 chars,
    must not start with hyphen/underscore. Cards live at
    `CARDS_ROOT/projects/<slug>/card.md`.
    """
    if not _SLUG_RE.match(card_id):
        raise HTTPException(status_code=400, detail="invalid card id")
    target = (CARDS_ROOT / "projects" / card_id / "card.md").resolve()
    try:
        target.relative_to(CARDS_ROOT)
    except ValueError:
        raise HTTPException(status_code=400, detail="card id escapes CARDS_ROOT")
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"card not found: {card_id}")
    return target


def _card_to_summary(card: Card) -> dict:
    return asdict(card.frontmatter)


def _card_to_full(card: Card) -> dict:
    return {
        "frontmatter": asdict(card.frontmatter),
        "sections": card.sections,
        "blockers": [asdict(b) for b in card.parsed_blockers()],
        "commands": [asdict(c) for c in card.parsed_commands()],
        "events": [asdict(e) for e in card.parsed_events()],
    }


def _validate_role(role: str) -> str:
    if role not in ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"unknown role '{role}'. allowed: {list(ROLES)}",
        )
    return role


# ───────────────────────── card endpoints ─────────────────────────


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "cards_root": str(CARDS_ROOT)}


@app.get("/api/cards")
def list_cards() -> dict:
    cards: list[dict] = []
    for path in find_cards(CARDS_ROOT):
        try:
            card = load_card(path)
            cards.append(_card_to_summary(card))
        except Exception as e:
            logger.warning("failed to parse %s: %s", path, e)
    return {"cards": cards}


@app.get("/api/cards/{card_id}")
def get_card(card_id: str) -> dict:
    path = _resolve_card_path(card_id)
    card = load_card(path)
    return _card_to_full(card)


class CommandIn(BaseModel):
    author: str = Field(..., min_length=1, max_length=64)
    verb: str = Field(..., min_length=1, max_length=64)
    args: Optional[str] = Field(None, max_length=4096)


@app.post("/api/cards/{card_id}/commands", status_code=201)
def post_command(card_id: str, cmd: CommandIn) -> dict:
    if cmd.verb not in KNOWN_VERBS:
        raise HTTPException(
            status_code=400,
            detail=f"unknown verb '{cmd.verb}'. allowed: {sorted(KNOWN_VERBS)}",
        )
    path = _resolve_card_path(card_id)
    card = load_card(path)
    entry = append_command(card, author=cmd.author, verb=cmd.verb, args=cmd.args)
    save_card(card, path)
    return {"appended": asdict(entry), "card_id": card_id}


# ───────────────────────── direction / finding endpoints ─────────────────────────
#
# Explore Kanban objects (docs/explore-schema.md). Directions live at
# `explore/<slug>/direction.md`, findings at `explore/<slug>/findings/f<NNN>-*.md`.
# The API handles deterministic verbs (refocus/pause/resume/archive/drop/run_now/
# promote/note) synchronously — cycle execution is orchestrator's job and not
# part of this module.


def _resolve_direction_path(slug: str) -> Path:
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="invalid direction slug")
    target = (CARDS_ROOT / "explore" / slug / "direction.md").resolve()
    try:
        target.relative_to(CARDS_ROOT)
    except ValueError:
        raise HTTPException(status_code=400, detail="slug escapes CARDS_ROOT")
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"direction not found: {slug}")
    return target


_FINDING_ID_RE = re.compile(r"^f\d{3}-[a-z0-9][a-z0-9_-]{0,23}$")


def _resolve_finding_path(slug: str, fid: str) -> Path:
    if not _FINDING_ID_RE.match(fid):
        raise HTTPException(status_code=400, detail="invalid finding id")
    direction_path = _resolve_direction_path(slug)
    target = (direction_path.parent / "findings" / f"{fid}.md").resolve()
    try:
        target.relative_to(CARDS_ROOT)
    except ValueError:
        raise HTTPException(status_code=400, detail="finding id escapes CARDS_ROOT")
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"finding not found: {fid}")
    return target


def _direction_to_summary(d: Direction) -> dict:
    out = asdict(d.frontmatter)
    out["finding_count"] = _count_findings(d.path.parent) if d.path else 0
    return out


def _finding_to_summary(f: Finding) -> dict:
    return asdict(f.frontmatter)


def _count_findings(direction_dir: Path) -> int:
    return len(list_findings(direction_dir))


def _direction_to_full(d: Direction) -> dict:
    findings = []
    if d.path:
        for p in list_findings(d.path.parent):
            try:
                fi = load_finding(p)
                findings.append(_finding_to_summary(fi))
            except Exception as e:
                logger.warning("failed to parse %s: %s", p, e)
    return {
        "frontmatter": asdict(d.frontmatter),
        "sections": d.sections,
        "commands": [asdict(c) for c in d.parsed_commands()],
        "events": [asdict(e) for e in d.parsed_events()],
        "findings": findings,
    }


@app.get("/api/directions")
def list_directions_endpoint() -> dict:
    out: list[dict] = []
    for p in find_directions(CARDS_ROOT):
        try:
            d = load_direction(p)
            out.append(_direction_to_summary(d))
        except Exception as e:
            logger.warning("failed to parse %s: %s", p, e)
    return {"directions": out}


class DirectionCreateIn(BaseModel):
    slug: str = Field(..., min_length=1, max_length=64)
    title: str = Field(..., min_length=1, max_length=200)
    kind: str = Field(..., min_length=1, max_length=32)
    cadence: str = Field(..., min_length=1, max_length=32)
    seed: str = Field(..., min_length=1, max_length=16 * 1024)
    tags: list[str] = Field(default_factory=list)


@app.post("/api/directions", status_code=201)
def create_direction(body: DirectionCreateIn) -> dict:
    if not _SLUG_RE.match(body.slug):
        raise HTTPException(status_code=400, detail="invalid slug")
    if body.kind not in DIRECTION_KINDS:
        raise HTTPException(
            status_code=400,
            detail=f"unknown kind '{body.kind}'. allowed: {list(DIRECTION_KINDS)}",
        )
    if body.cadence not in CADENCES:
        raise HTTPException(
            status_code=400,
            detail=f"unknown cadence '{body.cadence}'. allowed: {list(CADENCES)}",
        )
    dir_root = (CARDS_ROOT / "explore" / body.slug).resolve()
    try:
        dir_root.relative_to(CARDS_ROOT)
    except ValueError:
        raise HTTPException(status_code=400, detail="slug escapes CARDS_ROOT")
    target = dir_root / "direction.md"
    if target.exists():
        raise HTTPException(status_code=409, detail=f"direction already exists: {body.slug}")

    dir_root.mkdir(parents=True, exist_ok=True)
    (dir_root / "findings").mkdir(exist_ok=True)

    now = dmod.now_kst()
    ts_iso = now.strftime("%Y-%m-%dT%H:%M:%S+09:00")
    # Recurring cadences start at now so the first cycle fires immediately.
    # oneshot/on_demand: next_run=None; the orchestrator must be nudged via `run_now` for on_demand.
    if body.cadence in ("daily", "weekly", "oneshot"):
        next_run: Optional[str] = ts_iso
    else:
        next_run = None

    fm = DirectionFrontmatter(
        id=body.slug,
        title=body.title,
        kind=body.kind,
        cadence=body.cadence,
        status="running",
        assignee="ai",
        created=ts_iso,
        updated=ts_iso,
        next_run=next_run,
        last_run=None,
        finding_count=0,
        tags=body.tags,
    )
    d = Direction(
        frontmatter=fm,
        sections={
            "Seed": body.seed.strip(),
            "Agenda": "",
            "Command Queue": "",
            "Activity Log": "",
        },
        path=target,
    )
    dmod.append_event(
        d,
        "direction_created",
        f"kind={body.kind} cadence={body.cadence} title={body.title!r}",
        ts=now,
    )
    save_direction(d, target)

    return _direction_to_full(d) | {"slug": body.slug}


@app.get("/api/directions/{slug}")
def get_direction(slug: str) -> dict:
    path = _resolve_direction_path(slug)
    d = load_direction(path)
    return _direction_to_full(d)


@app.get("/api/directions/{slug}/findings/{fid}")
def get_finding(slug: str, fid: str) -> dict:
    path = _resolve_finding_path(slug, fid)
    f = load_finding(path)
    return {"frontmatter": asdict(f.frontmatter), "body": f.body}


class DirectionCommandIn(BaseModel):
    author: str = Field(..., min_length=1, max_length=64)
    verb: str = Field(..., min_length=1, max_length=64)
    args: Optional[str] = Field(None, max_length=4096)


_PROMOTE_RE = re.compile(r"^(?P<fid>f\d{3}-[a-z0-9][a-z0-9_-]{0,23})\s+as\s+(?P<slug>[a-z0-9][a-z0-9_-]{0,63})$")


@app.post("/api/directions/{slug}/commands", status_code=201)
def post_direction_command(slug: str, cmd: DirectionCommandIn) -> dict:
    """Append a command. Deterministic verbs (all except unknown) are
    processed synchronously in the same transaction and marked done.
    """
    if cmd.verb not in KNOWN_DIRECTION_VERBS:
        raise HTTPException(
            status_code=400,
            detail=f"unknown verb '{cmd.verb}'. allowed: {sorted(KNOWN_DIRECTION_VERBS)}",
        )
    path = _resolve_direction_path(slug)
    d = load_direction(path)
    now = dmod.now_kst()
    entry = dmod.append_command(d, author=cmd.author, verb=cmd.verb, args=cmd.args, ts=now)

    side_effects: dict = {}

    try:
        if cmd.verb == "refocus":
            if not cmd.args:
                raise HTTPException(status_code=400, detail="refocus requires args")
            dmod.append_seed_refocus(d, cmd.args, ts=now)
            dmod.append_event(d, "direction_refocused", f"hint={cmd.args[:80]!r}", ts=now)

        elif cmd.verb == "run_now":
            d.frontmatter.next_run = now.strftime("%Y-%m-%dT%H:%M:%S+09:00")
            dmod.append_event(d, "command_processed", "run_now — next_run set to now", ts=now)

        elif cmd.verb == "pause":
            d.frontmatter.status = "paused"
            d.frontmatter.next_run = None
            dmod.append_event(d, "direction_paused", "by user", ts=now)

        elif cmd.verb == "resume":
            d.frontmatter.status = "running"
            anchor_str = d.frontmatter.last_run or d.frontmatter.updated
            anchor = datetime.fromisoformat(anchor_str)
            d.frontmatter.next_run = compute_next_run(d.frontmatter.cadence, anchor) or d.frontmatter.updated
            dmod.append_event(d, "direction_resumed", "by user", ts=now)

        elif cmd.verb == "archive":
            d.frontmatter.status = "done"
            d.frontmatter.next_run = None
            d.frontmatter.assignee = None
            dmod.append_event(d, "direction_archived", "by user", ts=now)

        elif cmd.verb == "drop":
            if not cmd.args or not _FINDING_ID_RE.match(cmd.args.strip()):
                raise HTTPException(status_code=400, detail="drop args must be a valid finding id")
            fid = cmd.args.strip()
            fpath = _resolve_finding_path(slug, fid)
            f = load_finding(fpath)
            if f.frontmatter.interest != "promoted":
                f.frontmatter.interest = "archived"
                save_finding(f, fpath)
            dmod.append_event(d, "finding_dropped", f"fid={fid}", ts=now)
            side_effects["finding"] = asdict(f.frontmatter)

        elif cmd.verb == "promote":
            if not cmd.args:
                raise HTTPException(status_code=400, detail="promote requires `<fid> as <slug>`")
            m = _PROMOTE_RE.match(cmd.args.strip())
            if not m:
                raise HTTPException(status_code=400, detail="promote format: `<fid> as <new-slug>`")
            fid = m.group("fid")
            target_slug = m.group("slug")
            promotion = _promote_finding(slug, fid, target_slug, ts=now)
            dmod.append_event(
                d,
                "finding_promoted",
                f"fid={fid} → projects/{target_slug}",
                ts=now,
            )
            side_effects["promotion"] = promotion

        elif cmd.verb == "note":
            dmod.append_event(d, "user_note", cmd.args or "", ts=now)

        dmod.mark_last_command_done(d)
        save_direction(d, path)

    except HTTPException:
        save_direction(d, path)
        raise

    return {
        "appended": asdict(entry),
        "slug": slug,
        "frontmatter": asdict(d.frontmatter),
        **side_effects,
    }


def _promote_finding(
    direction_slug: str,
    fid: str,
    target_slug: str,
    ts: datetime,
) -> dict:
    """Create a Research card at `projects/<target_slug>/card.md` from a finding.

    Implements explore-schema.md §7. Slug collision → 409. The finding's
    interest flag is flipped to `promoted` and `promoted_to` is set.
    """
    if not _SLUG_RE.match(target_slug):
        raise HTTPException(status_code=400, detail="invalid target slug")
    card_dir = (CARDS_ROOT / "projects" / target_slug).resolve()
    try:
        card_dir.relative_to(CARDS_ROOT)
    except ValueError:
        raise HTTPException(status_code=400, detail="target slug escapes CARDS_ROOT")
    card_path = card_dir / "card.md"
    if card_path.exists():
        raise HTTPException(status_code=409, detail=f"card already exists: {target_slug}")

    finding_path = _resolve_finding_path(direction_slug, fid)
    finding = load_finding(finding_path)

    card_dir.mkdir(parents=True, exist_ok=True)

    ts_iso = ts.strftime("%Y-%m-%dT%H:%M:%S+09:00")
    tags = list({*finding.frontmatter.tags, "from-explore"})

    card_fm = CardFrontmatter(
        id=target_slug,
        title=finding.frontmatter.title,
        stage="idea",
        substage="draft",
        status="running",
        assignee="ai",
        created=ts_iso,
        updated=ts_iso,
        tags=tags,
        parent_id=None,
        target_venue=None,
    )
    summary = (
        f"Explore direction `{direction_slug}` 의 finding `{fid}` 에서 승격됨.\n\n"
        f"{finding.body.strip()[:800]}"
    )
    card = Card(
        frontmatter=card_fm,
        sections={
            "Summary": summary,
            "Plan": "(TBD — idea review 후 run.survey 에서 구체화)",
            "Blockers": "",
            "Command Queue": "",
            "Event Log": "",
        },
        path=card_path,
    )
    append_card_event(
        card,
        "ideation",
        f"promoted from explore/{direction_slug}/findings/{fid}",
        ts=ts,
    )
    save_card(card, card_path)

    # Update the finding's interest + promoted_to, and append a trace note to the body.
    finding.frontmatter.interest = "promoted"
    finding.frontmatter.promoted_to = target_slug
    trace_line = f"\n\n> PROMOTED to projects/{target_slug} at {ts_iso}\n"
    if not finding.body.endswith(trace_line):
        finding.body = finding.body.rstrip() + trace_line
    save_finding(finding, finding_path)

    return {
        "finding": asdict(finding.frontmatter),
        "card_id": target_slug,
        "card_path": str(card_path.relative_to(CARDS_ROOT)),
    }


# ───────────────────────── docs endpoints ─────────────────────────
#
# Docs are *.md files directly under DOCS_DIR (non-recursive). They are
# user-editable notes: research-direction.md, venue-decision.md, etc.
# The `{name}` path parameter is the file's stem (no ".md"), validated as a
# slug so path traversal can't escape DOCS_DIR.


_DOC_SEGMENT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
# Docs may live in subdirectories up to 4 levels deep. Each segment is a slug.
DOC_MAX_DEPTH = 4


def _validate_doc_path(path: str) -> tuple[str, ...]:
    """Validate a slash-separated doc path (e.g. 'venues/neurips') and return
    its segments. The last segment is the filename stem; prior segments are
    subdirectories under DOCS_DIR."""
    segments = tuple(s for s in path.split("/") if s)
    if not (1 <= len(segments) <= DOC_MAX_DEPTH):
        raise HTTPException(status_code=400, detail=f"path must be 1..{DOC_MAX_DEPTH} segments")
    for seg in segments:
        if not _DOC_SEGMENT_RE.match(seg):
            raise HTTPException(status_code=400, detail=f"invalid path segment: {seg!r}")
    return segments


def _resolve_doc_path(path: str, *, must_exist: bool = False) -> Path:
    """Resolve a doc path → absolute filesystem path.

    Single-segment names fall back to `docs/private/<name>.md` if the root
    version doesn't exist (back-compat for IdeationPanel etc. fetching
    `research-direction`). Multi-segment paths are used verbatim.
    """
    segments = _validate_doc_path(path)
    # Multi-segment paths: direct resolution.
    if len(segments) > 1:
        candidate = (DOCS_DIR.joinpath(*segments[:-1]) / f"{segments[-1]}.md").resolve()
    else:
        name = segments[0]
        # Back-compat: try root first, then private/.
        root = (DOCS_DIR / f"{name}.md").resolve()
        private = (DOCS_DIR / "private" / f"{name}.md").resolve()
        if root.exists():
            candidate = root
        elif private.exists():
            candidate = private
        else:
            candidate = root  # default for new-file PUTs
    try:
        candidate.relative_to(DOCS_DIR)
    except ValueError:
        raise HTTPException(status_code=400, detail="path escapes DOCS_DIR")
    if must_exist and not candidate.exists():
        raise HTTPException(status_code=404, detail=f"doc not found: {path}")
    return candidate


def _doc_relpath(abs_path: Path) -> str:
    """Return the slash-joined doc path (without .md) for an absolute path
    inside DOCS_DIR, e.g. `/app/.../docs/venues/foo.md` → `venues/foo`."""
    rel = abs_path.relative_to(DOCS_DIR)
    # rel.with_suffix('') drops the .md
    return str(rel.with_suffix("")).replace(os.sep, "/")


class DocIn(BaseModel):
    content: str = Field(..., max_length=DOC_MAX_BYTES)


class DocMoveIn(BaseModel):
    to: str = Field(..., min_length=1, max_length=512)


@app.get("/api/docs")
def list_docs() -> dict:
    """List `*.md` files under DOCS_DIR (recursive). `private/` is hidden from
    the listing (still addressable via single-segment back-compat)."""
    out: list[dict] = []
    if DOCS_DIR.exists():
        for p in sorted(DOCS_DIR.rglob("*.md")):
            try:
                rel = p.relative_to(DOCS_DIR)
            except ValueError:
                continue
            parts = rel.parts
            if parts and parts[0] == "private":
                continue
            try:
                st = p.stat()
            except OSError:
                continue
            doc_path = _doc_relpath(p)
            dir_parts = parts[:-1]
            out.append({
                "path": doc_path,
                "name": p.stem,
                "dir": "/".join(dir_parts),  # "" for top-level
                "updated": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
                "bytes": st.st_size,
            })
    return {"docs": out}


@app.get("/api/docs/{path:path}")
def get_doc(path: str) -> dict:
    target = _resolve_doc_path(path)
    doc_path = _doc_relpath(target) if target.exists() else path
    if not target.exists():
        # First-edit fallback: render empty editor rather than 404 so the
        # webapp can create a doc by PUTting to this path.
        return {"path": path, "name": path.rsplit("/", 1)[-1], "content": "", "updated": None, "exists": False}
    try:
        content = target.read_text(encoding="utf-8")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"read failed: {e}")
    mtime = datetime.fromtimestamp(target.stat().st_mtime, tz=timezone.utc)
    return {
        "path": doc_path,
        "name": target.stem,
        "content": content,
        "updated": mtime.isoformat(),
        "exists": True,
    }


@app.put("/api/docs/{path:path}")
def put_doc(path: str, body: DocIn) -> dict:
    target = _resolve_doc_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        dir=str(target.parent),
        prefix=f".{target.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body.content)
        os.replace(tmp, target)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    mtime = datetime.fromtimestamp(target.stat().st_mtime, tz=timezone.utc)
    return {
        "ok": True,
        "path": _doc_relpath(target),
        "updated": mtime.isoformat(),
        "bytes": len(body.content),
    }


@app.post("/api/docs/{path:path}/move")
def move_doc(path: str, body: DocMoveIn) -> dict:
    src = _resolve_doc_path(path, must_exist=True)
    # Validate destination path (resolve with back-compat disabled — moves are explicit).
    segments = _validate_doc_path(body.to)
    if len(segments) > 1:
        dst = (DOCS_DIR.joinpath(*segments[:-1]) / f"{segments[-1]}.md").resolve()
    else:
        dst = (DOCS_DIR / f"{segments[0]}.md").resolve()
    try:
        dst.relative_to(DOCS_DIR)
    except ValueError:
        raise HTTPException(status_code=400, detail="destination escapes DOCS_DIR")
    if dst.exists():
        raise HTTPException(status_code=409, detail=f"destination already exists: {body.to}")
    if src == dst:
        raise HTTPException(status_code=400, detail="source and destination are identical")
    dst.parent.mkdir(parents=True, exist_ok=True)
    os.replace(src, dst)
    # Clean up now-empty source directories (but never DOCS_DIR itself).
    parent = src.parent
    while parent != DOCS_DIR and parent.is_relative_to(DOCS_DIR):
        try:
            parent.rmdir()  # only succeeds if empty
        except OSError:
            break
        parent = parent.parent
    return {
        "ok": True,
        "from": _doc_relpath(Path(src)) if src.exists() else path,
        "to": _doc_relpath(dst),
    }


@app.delete("/api/docs/{path:path}", status_code=204)
def delete_doc(path: str):
    target = _resolve_doc_path(path, must_exist=True)
    try:
        target.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"delete failed: {e}")
    # Clean up now-empty parent directories.
    parent = target.parent
    while parent != DOCS_DIR and parent.is_relative_to(DOCS_DIR):
        try:
            parent.rmdir()
        except OSError:
            break
        parent = parent.parent
    return None


# ───────────────────────── agent endpoints ─────────────────────────
#
# Singletons: /api/agents/{role}/{start,stop,restart,pane,input}
# Multi-role instances:
#   POST /api/agents/{role}/spawn           body: {"name": "..."}
#   POST /api/agents/{role}/{name}/{start,stop,restart,archive}
#   GET  /api/agents/{role}/{name}/pane
#   POST /api/agents/{role}/{name}/input
#
# The agents.py layer guards against calling singleton endpoints on multi roles
# (and vice versa); those guards surface here as 400 errors.


def _tmux_or_400(e: Exception) -> "HTTPException":
    """Map agents.py exceptions to HTTP error responses.
    ValueError → 400 (bad request / role-cardinality mismatch / name collision)
    TmuxError  → 502 (tmux plumbing failure)
    """
    if isinstance(e, ValueError):
        return HTTPException(status_code=400, detail=str(e))
    return HTTPException(status_code=502, detail=str(e))


@app.get("/api/agents")
def list_agents_endpoint() -> dict:
    """Return role metadata + the currently known agents (singletons +
    spawned multi instances). Empty-multi roles still appear in `roles` so
    the UI can render a "+" button."""
    try:
        return {
            "roles": [
                {"role": role, "cardinality": CARDINALITY[role]} for role in ROLES
            ],
            "agents": [info_dict(a) for a in list_agents()],
        }
    except TmuxError as e:
        raise _tmux_or_400(e)


# ── singleton lifecycle ───────────────────────────────────────────


@app.post("/api/agents/{role}/start")
def start_agent_endpoint(role: str) -> dict:
    _validate_role(role)
    try:
        return info_dict(start_agent(role))
    except (TmuxError, ValueError) as e:
        raise _tmux_or_400(e)


@app.post("/api/agents/{role}/stop")
def stop_agent_endpoint(role: str) -> dict:
    _validate_role(role)
    try:
        return info_dict(stop_agent(role))
    except (TmuxError, ValueError) as e:
        raise _tmux_or_400(e)


@app.post("/api/agents/{role}/restart")
def restart_agent_endpoint(role: str) -> dict:
    _validate_role(role)
    try:
        return info_dict(restart_agent(role))
    except (TmuxError, ValueError) as e:
        raise _tmux_or_400(e)


@app.get("/api/agents/{role}/pane")
def get_pane_endpoint(role: str, lines: int = 200) -> dict:
    _validate_role(role)
    if not (1 <= lines <= 5000):
        raise HTTPException(status_code=400, detail="lines must be 1..5000")
    try:
        content = capture_pane(role, n_lines=lines)
        return {"role": role, "name": None, "content": content}
    except (TmuxError, ValueError) as e:
        raise _tmux_or_400(e)


class AgentInputIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=8192)


@app.post("/api/agents/{role}/input", status_code=202)
def send_agent_input_endpoint(role: str, body: AgentInputIn) -> dict:
    _validate_role(role)
    try:
        send_input(role, body.message)
        return {"role": role, "name": None, "sent": True}
    except (TmuxError, ValueError) as e:
        raise _tmux_or_400(e)


# ── multi-role instance lifecycle ─────────────────────────────────


class SpawnIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=32)


@app.post("/api/agents/{role}/spawn", status_code=201)
def spawn_instance_endpoint(role: str, body: SpawnIn) -> dict:
    _validate_role(role)
    try:
        return info_dict(spawn_instance(role, body.name))
    except (TmuxError, ValueError) as e:
        raise _tmux_or_400(e)


@app.post("/api/agents/{role}/{name}/start")
def start_instance_endpoint(role: str, name: str) -> dict:
    _validate_role(role)
    try:
        return info_dict(start_instance(role, name))
    except (TmuxError, ValueError) as e:
        raise _tmux_or_400(e)


@app.post("/api/agents/{role}/{name}/stop")
def stop_instance_endpoint(role: str, name: str) -> dict:
    _validate_role(role)
    try:
        return info_dict(stop_instance(role, name))
    except (TmuxError, ValueError) as e:
        raise _tmux_or_400(e)


@app.post("/api/agents/{role}/{name}/restart")
def restart_instance_endpoint(role: str, name: str) -> dict:
    _validate_role(role)
    try:
        return info_dict(restart_instance(role, name))
    except (TmuxError, ValueError) as e:
        raise _tmux_or_400(e)


@app.post("/api/agents/{role}/{name}/archive", status_code=204)
def archive_instance_endpoint(role: str, name: str):
    _validate_role(role)
    try:
        archive_instance(role, name)
    except (TmuxError, ValueError) as e:
        raise _tmux_or_400(e)


@app.get("/api/agents/{role}/{name}/pane")
def get_instance_pane_endpoint(role: str, name: str, lines: int = 200) -> dict:
    _validate_role(role)
    if not (1 <= lines <= 5000):
        raise HTTPException(status_code=400, detail="lines must be 1..5000")
    try:
        content = capture_pane(role, name=name, n_lines=lines)
        return {"role": role, "name": name, "content": content}
    except (TmuxError, ValueError) as e:
        raise _tmux_or_400(e)


@app.post("/api/agents/{role}/{name}/input", status_code=202)
def send_instance_input_endpoint(role: str, name: str, body: AgentInputIn) -> dict:
    _validate_role(role)
    try:
        send_input(role, body.message, name=name)
        return {"role": role, "name": name, "sent": True}
    except (TmuxError, ValueError) as e:
        raise _tmux_or_400(e)


# ───────────────────────── SSE ─────────────────────────


@app.get("/api/events")
async def events() -> StreamingResponse:
    bus: EventBus = app.state.bus
    return StreamingResponse(
        bus.subscribe(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
