"""direction.md + finding md parser, serializer, and mutation helpers.

Contract: see docs/explore-schema.md. This module implements the Explore
Kanban's object model, parallel to card.py (Research Kanban).

Parallels to card.py:
- Same frontmatter+body layout (YAML + markdown sections).
- Command Queue / Activity Log line formats are **identical** to card.py's
  Command Queue / Event Log — we reuse COMMAND_RE, EVENT_RE, and the
  parse_commands/parse_events helpers.
- Append-only safety contract applies: Activity Log and Command Queue are
  never rewritten; Seed is also append-only (refocus → new subsection).

Structural differences:
- Direction frontmatter has `kind`, `cadence`, `next_run`, `last_run`,
  `finding_count` fields.
- Body sections: Seed, Agenda, Command Queue, Activity Log (4 sections).
- Findings live as separate files under `explore/<slug>/findings/f<NNN>-*.md`.
"""
from __future__ import annotations

import os
import re
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import yaml

from .card import (
    COMMAND_RE,
    EVENT_RE,
    FRONTMATTER_RE,
    HEADER_RE,
    KST,
    _QUOTED_ISO_RE,
    CommandEntry,
    EventEntry,
    parse_commands,
    parse_events,
)

# ───────────────────────── constants ─────────────────────────

DIRECTION_SECTION_ORDER: list[str] = [
    "Seed",
    "Agenda",
    "Command Queue",
    "Activity Log",
]

KNOWN_DIRECTION_VERBS: tuple[str, ...] = (
    "refocus",
    "run_now",
    "pause",
    "resume",
    "archive",
    "drop",
    "promote",
    "note",
)

DIRECTION_KINDS: tuple[str, ...] = (
    "venues",
    "venue_archive",
    "tracking",
    "topic",
    "freeform",
)

CADENCES: tuple[str, ...] = ("oneshot", "daily", "weekly", "on_demand")

DIRECTION_STATUSES: tuple[str, ...] = ("running", "paused", "done", "error")

FINDING_KINDS: tuple[str, ...] = (
    "paper",
    "venue",
    "idea",
    "tracking",
    "synthesis",
)

FINDING_INTERESTS: tuple[str, ...] = ("none", "liked", "archived", "promoted")

FINDING_FILENAME_RE = re.compile(r"^f(\d{3})-([a-z0-9][a-z0-9_-]{0,23})\.md$")


# ───────────────────────── data classes ─────────────────────────


@dataclass
class DirectionFrontmatter:
    id: str
    title: str
    kind: str
    cadence: str
    status: str
    assignee: Optional[str]
    created: str
    updated: str
    next_run: Optional[str] = None
    last_run: Optional[str] = None
    finding_count: int = 0
    tags: list[str] = field(default_factory=list)


@dataclass
class Direction:
    frontmatter: DirectionFrontmatter
    sections: dict[str, str]
    path: Optional[Path] = None

    @property
    def id(self) -> str:
        return self.frontmatter.id

    def parsed_commands(self) -> list[CommandEntry]:
        return parse_commands(
            self.sections.get("Command Queue", ""),
            verbs=KNOWN_DIRECTION_VERBS,
        )

    def parsed_events(self) -> list[EventEntry]:
        return parse_events(self.sections.get("Activity Log", ""))


@dataclass
class FindingFrontmatter:
    id: str
    parent: str
    kind: str
    title: str
    created: str
    interest: str = "none"
    source: Optional[str] = None
    promoted_to: Optional[str] = None
    tags: list[str] = field(default_factory=list)


@dataclass
class Finding:
    frontmatter: FindingFrontmatter
    body: str
    path: Optional[Path] = None

    @property
    def id(self) -> str:
        return self.frontmatter.id


# ───────────────────────── parsing ─────────────────────────


def parse_direction(text: str, path: Optional[Path] = None) -> Direction:
    m = FRONTMATTER_RE.match(text)
    if not m:
        raise ValueError("direction.md frontmatter missing or malformed")
    fm_data = yaml.safe_load(m.group(1)) or {}
    body = text[m.end():]
    for k in ("created", "updated", "next_run", "last_run"):
        v = fm_data.get(k)
        if isinstance(v, datetime):
            if v.tzinfo is None:
                v = v.replace(tzinfo=KST)
            fm_data[k] = v.isoformat()
    try:
        fm = DirectionFrontmatter(**fm_data)
    except TypeError as e:
        raise ValueError(f"direction frontmatter schema mismatch: {e}") from e
    sections = _parse_body_sections(body)
    return Direction(frontmatter=fm, sections=sections, path=path)


def load_direction(path: Path | str) -> Direction:
    p = Path(path)
    return parse_direction(p.read_text(encoding="utf-8"), path=p)


def parse_finding(text: str, path: Optional[Path] = None) -> Finding:
    m = FRONTMATTER_RE.match(text)
    if not m:
        raise ValueError("finding frontmatter missing or malformed")
    fm_data = yaml.safe_load(m.group(1)) or {}
    body = text[m.end():]
    for k in ("created",):
        v = fm_data.get(k)
        if isinstance(v, datetime):
            if v.tzinfo is None:
                v = v.replace(tzinfo=KST)
            fm_data[k] = v.isoformat()
    try:
        fm = FindingFrontmatter(**fm_data)
    except TypeError as e:
        raise ValueError(f"finding frontmatter schema mismatch: {e}") from e
    return Finding(frontmatter=fm, body=body.lstrip("\n"), path=path)


def load_finding(path: Path | str) -> Finding:
    p = Path(path)
    return parse_finding(p.read_text(encoding="utf-8"), path=p)


def _parse_body_sections(body: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    current_title: Optional[str] = None
    current_lines: list[str] = []
    for line in body.split("\n"):
        m = HEADER_RE.match(line)
        if m:
            if current_title is not None:
                sections[current_title] = "\n".join(current_lines).strip("\n")
            current_title = m.group(1).strip()
            current_lines = []
        elif current_title is not None:
            current_lines.append(line)
    if current_title is not None:
        sections[current_title] = "\n".join(current_lines).strip("\n")
    return sections


# ───────────────────────── serialization ─────────────────────────


def serialize_direction(d: Direction) -> str:
    fm_yaml = yaml.dump(
        asdict(d.frontmatter),
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=None,
        width=10000,
    ).rstrip("\n")
    fm_yaml = _QUOTED_ISO_RE.sub(r"\1\2", fm_yaml)
    parts: list[str] = ["---", fm_yaml, "---", ""]
    titles = list(DIRECTION_SECTION_ORDER)
    for t in d.sections:
        if t not in titles:
            titles.append(t)
    for title in titles:
        if title not in d.sections:
            continue
        parts.append(f"## {title}")
        parts.append("")
        body = d.sections[title].strip("\n")
        if body:
            parts.append(body)
            parts.append("")
    return "\n".join(parts).rstrip("\n") + "\n"


def serialize_finding(f: Finding) -> str:
    fm_yaml = yaml.dump(
        asdict(f.frontmatter),
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=None,
        width=10000,
    ).rstrip("\n")
    fm_yaml = _QUOTED_ISO_RE.sub(r"\1\2", fm_yaml)
    body = f.body.strip("\n")
    parts = ["---", fm_yaml, "---", ""]
    if body:
        parts.append(body)
        parts.append("")
    return "\n".join(parts).rstrip("\n") + "\n"


def _atomic_write(target: Path, text: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        dir=str(target.parent),
        prefix=f".{target.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, target)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def save_direction(d: Direction, path: Optional[Path | str] = None) -> Path:
    target = Path(path or d.path or "")
    if not str(target):
        raise ValueError("no path provided to save_direction")
    _atomic_write(target, serialize_direction(d))
    d.path = target
    return target


def save_finding(f: Finding, path: Optional[Path | str] = None) -> Path:
    target = Path(path or f.path or "")
    if not str(target):
        raise ValueError("no path provided to save_finding")
    _atomic_write(target, serialize_finding(f))
    f.path = target
    return target


# ───────────────────────── mutations (append-only) ─────────────────────────


def now_kst() -> datetime:
    return datetime.now(KST)


def _ts_short(ts: datetime) -> str:
    return ts.strftime("%Y-%m-%d %H:%M")


def _ts_iso(ts: datetime) -> str:
    return ts.strftime("%Y-%m-%dT%H:%M:%S+09:00")


def bump_updated(d: Direction, ts: Optional[datetime] = None) -> None:
    d.frontmatter.updated = _ts_iso(ts or now_kst())


def append_command(
    d: Direction,
    author: str,
    verb: str,
    args: Optional[str] = None,
    ts: Optional[datetime] = None,
) -> CommandEntry:
    ts = ts or now_kst()
    line = f"- [ ] {_ts_short(ts)} {author}: {verb}"
    if args:
        line += f": {args}"
    body = d.sections.get("Command Queue", "")
    d.sections["Command Queue"] = (body.rstrip("\n") + "\n" + line) if body else line
    bump_updated(d, ts)
    return CommandEntry(
        done=False,
        timestamp=_ts_short(ts),
        author=author,
        verb=verb,
        args=args,
    )


def append_event(
    d: Direction,
    type_: str,
    description: str,
    ts: Optional[datetime] = None,
) -> EventEntry:
    ts = ts or now_kst()
    line = f"- {_ts_short(ts)} [{type_}] {description}"
    body = d.sections.get("Activity Log", "")
    d.sections["Activity Log"] = (body.rstrip("\n") + "\n" + line) if body else line
    bump_updated(d, ts)
    return EventEntry(
        timestamp=_ts_short(ts),
        type=type_,
        description=description,
    )


def mark_last_command_done(d: Direction) -> None:
    """Toggle the most recent `- [ ]` Command Queue bullet to `- [x]`.

    Used when the API processes a command synchronously — we append the
    command first, then immediately mark it done. Unlike card.py's
    mark_command_done(index), this operates on the tail because deterministic
    verbs are handled in the same transaction they're queued.
    """
    body = d.sections.get("Command Queue", "")
    lines = body.split("\n")
    for i in range(len(lines) - 1, -1, -1):
        if COMMAND_RE.match(lines[i]) and lines[i].startswith("- [ ]"):
            lines[i] = lines[i].replace("- [ ]", "- [x]", 1)
            d.sections["Command Queue"] = "\n".join(lines)
            bump_updated(d)
            return
    raise ValueError("no pending command to mark done")


def append_seed_refocus(d: Direction, hint: str, ts: Optional[datetime] = None) -> None:
    """Append a `### Refocus <ts>` subsection to `## Seed` (append-only contract)."""
    ts = ts or now_kst()
    block = f"\n### Refocus {_ts_short(ts)}\n\n{hint.strip()}\n"
    seed = d.sections.get("Seed", "")
    d.sections["Seed"] = (seed.rstrip("\n") + block) if seed else block.lstrip("\n")
    bump_updated(d, ts)


# ───────────────────────── cadence engine ─────────────────────────


def compute_next_run(cadence: str, anchor: datetime) -> Optional[str]:
    """Return the next `next_run` ISO string for a given cadence.

    `oneshot` and `on_demand` return None (no recurring schedule).
    `daily`/`weekly` roll forward from `anchor` (usually last_run).
    """
    if cadence == "daily":
        return _ts_iso(anchor + timedelta(days=1))
    if cadence == "weekly":
        return _ts_iso(anchor + timedelta(days=7))
    if cadence in ("oneshot", "on_demand"):
        return None
    raise ValueError(f"unknown cadence: {cadence!r}")


# ───────────────────────── discovery ─────────────────────────


def find_directions(root: Path | str) -> list[Path]:
    """Find all explore/<slug>/direction.md files under `root`."""
    return sorted(Path(root).glob("explore/*/direction.md"))


def list_findings(direction_dir: Path | str) -> list[Path]:
    """Find all findings/f<NNN>-*.md files under a direction's directory."""
    d = Path(direction_dir)
    findings_dir = d / "findings"
    if not findings_dir.exists():
        return []
    out: list[Path] = []
    for p in findings_dir.iterdir():
        if p.is_file() and FINDING_FILENAME_RE.match(p.name):
            out.append(p)
    return sorted(out)


def next_finding_id(direction_dir: Path | str, short_slug: str) -> str:
    """Return the next `f<NNN>-<short>` finding id for a direction."""
    existing = list_findings(direction_dir)
    max_n = 0
    for p in existing:
        m = FINDING_FILENAME_RE.match(p.name)
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"f{max_n + 1:03d}-{short_slug}"
