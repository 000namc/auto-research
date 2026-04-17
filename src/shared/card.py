"""card.md parser, serializer, and mutation helpers.

Contract: see docs/card-schema.md.

Design notes
------------
- File-as-database. The orchestrator, the API, and human editors all read/write
  the same `projects/<slug>/card.md` file. There is no other source of truth.
- Round-trip is **semantic**, not byte-for-byte:
      parse(serialize(parse(text))) == parse(text)
  We do NOT promise the serialized text equals the original character-for-character
  (yaml formatting may normalize). We DO promise the parsed model is preserved.
- Append-only sections (Command Queue, Event Log) are mutated only via helpers
  that append to the end or toggle a single checkbox in place. Existing entries
  are never rewritten.
- Saves are atomic: write to tempfile in the same directory, then os.replace.
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

KST = timezone(timedelta(hours=9))

# Canonical body section order — docs/card-schema.md §3.2.
SECTION_ORDER: list[str] = [
    "Summary",
    "Plan",
    "Blockers",
    "Command Queue",
    "Event Log",
    "Metrics",
    "Artifacts",
]

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n?", re.DOTALL)
HEADER_RE = re.compile(r"^## (.+?)\s*$")

# Recognized command verbs — schema §6.1.
# Anything that doesn't match one of these is interpreted as a `note` with the
# whole text as args (schema: "verb가 없는 자유 텍스트는 note:로 해석").
KNOWN_VERBS: tuple[str, ...] = (
    "approve",
    "reject",
    "revise",
    "resolve",
    "abort",
    "note",
)

COMMAND_RE = re.compile(
    r"^- \[(?P<done>[ x])\] "
    r"(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?) "
    r"(?P<author>\w+): "
    r"(?P<rest>.+)$"
)

VERB_RE = re.compile(rf"^(?P<verb>{'|'.join(KNOWN_VERBS)})(?:: (?P<args>.+))?$")


def _verb_regex(verbs: tuple[str, ...]) -> re.Pattern[str]:
    """Build a verb matcher for a custom vocabulary (e.g. direction verbs)."""
    return re.compile(rf"^(?P<verb>{'|'.join(verbs)})(?:: (?P<args>.+))?$")

# Post-process pattern: PyYAML force-quotes ISO 8601 timestamp strings (since
# they look like timestamps and bare emission would round-trip as datetime).
# We strip those quotes after dump so the file matches the canonical
# `created: 2026-04-08T14:20:00+09:00` form. parse_card() handles the bare
# form by coercing datetime back to str.
_QUOTED_ISO_RE = re.compile(
    r"^(\s*[A-Za-z_][A-Za-z0-9_]*: )"
    r"'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)?)'$",
    re.MULTILINE,
)

EVENT_RE = re.compile(
    r"^- "
    r"(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?) "
    r"\[(?P<type>\w+)\] "
    r"(?P<desc>.+)$"
)

BLOCKER_RE = re.compile(r"^- \[(?P<done>[ x])\] (?P<text>.+)$")


# ───────────────────────── data classes ─────────────────────────


@dataclass
class Frontmatter:
    id: str
    title: str
    stage: str
    status: str
    assignee: Optional[str]
    created: str
    updated: str
    substage: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    parent_id: Optional[str] = None
    target_venue: Optional[str] = None


@dataclass
class CommandEntry:
    done: bool
    timestamp: str
    author: str
    verb: str
    args: Optional[str]


@dataclass
class EventEntry:
    timestamp: str
    type: str
    description: str


@dataclass
class BlockerEntry:
    done: bool
    text: str


@dataclass
class Card:
    frontmatter: Frontmatter
    sections: dict[str, str]
    path: Optional[Path] = None

    @property
    def id(self) -> str:
        return self.frontmatter.id

    def parsed_blockers(self) -> list[BlockerEntry]:
        return parse_blockers(self.sections.get("Blockers", ""))

    def parsed_commands(self) -> list[CommandEntry]:
        return parse_commands(self.sections.get("Command Queue", ""))

    def parsed_events(self) -> list[EventEntry]:
        return parse_events(self.sections.get("Event Log", ""))


# ───────────────────────── parsing ─────────────────────────


def parse_card(text: str, path: Optional[Path] = None) -> Card:
    m = FRONTMATTER_RE.match(text)
    if not m:
        raise ValueError("card.md frontmatter missing or malformed")
    fm_yaml = m.group(1)
    body = text[m.end():]
    fm_data = yaml.safe_load(fm_yaml) or {}
    # PyYAML auto-converts bare ISO 8601 timestamps to datetime objects, but
    # the schema treats `created`/`updated` as strings in canonical
    # `YYYY-MM-DDTHH:MM:SS+09:00` form. Coerce back.
    for k in ("created", "updated"):
        v = fm_data.get(k)
        if isinstance(v, datetime):
            if v.tzinfo is None:
                v = v.replace(tzinfo=KST)
            fm_data[k] = v.isoformat()
    try:
        fm = Frontmatter(**fm_data)
    except TypeError as e:
        raise ValueError(f"frontmatter schema mismatch: {e}") from e
    sections = _parse_body_sections(body)
    return Card(frontmatter=fm, sections=sections, path=path)


def load_card(path: Path | str) -> Card:
    p = Path(path)
    return parse_card(p.read_text(encoding="utf-8"), path=p)


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
        # Lines before the first `## ` (preamble) are dropped — there shouldn't be any.
    if current_title is not None:
        sections[current_title] = "\n".join(current_lines).strip("\n")
    return sections


def parse_commands(
    body: str,
    verbs: tuple[str, ...] = KNOWN_VERBS,
) -> list[CommandEntry]:
    """Parse a Command Queue body. `verbs` is the known vocabulary — anything
    outside it is demoted to `note` (schema §6.1). Pass a different tuple for
    non-Research Command Queues (e.g. direction.md uses its own verb set)."""
    verb_re = _verb_regex(verbs) if verbs is not KNOWN_VERBS else VERB_RE
    out: list[CommandEntry] = []
    for line in body.split("\n"):
        m = COMMAND_RE.match(line)
        if not m:
            continue
        rest = m.group("rest")
        vm = verb_re.match(rest)
        if vm:
            verb = vm.group("verb")
            args = vm.group("args")
        else:
            verb = "note"
            args = rest
        out.append(
            CommandEntry(
                done=(m.group("done") == "x"),
                timestamp=m.group("ts"),
                author=m.group("author"),
                verb=verb,
                args=args,
            )
        )
    return out


def parse_events(body: str) -> list[EventEntry]:
    out: list[EventEntry] = []
    for line in body.split("\n"):
        m = EVENT_RE.match(line)
        if not m:
            continue
        out.append(
            EventEntry(
                timestamp=m.group("ts"),
                type=m.group("type"),
                description=m.group("desc"),
            )
        )
    return out


def parse_blockers(body: str) -> list[BlockerEntry]:
    out: list[BlockerEntry] = []
    for line in body.split("\n"):
        m = BLOCKER_RE.match(line)
        if not m:
            continue
        out.append(BlockerEntry(done=(m.group("done") == "x"), text=m.group("text")))
    return out


# ───────────────────────── serialization ─────────────────────────


def serialize_card(card: Card) -> str:
    fm_dict = asdict(card.frontmatter)
    fm_yaml = yaml.dump(
        fm_dict,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=None,
        width=10000,
    ).rstrip("\n")
    fm_yaml = _QUOTED_ISO_RE.sub(r"\1\2", fm_yaml)
    parts: list[str] = ["---", fm_yaml, "---", ""]
    titles = list(SECTION_ORDER)
    for t in card.sections:
        if t not in titles:
            titles.append(t)
    for title in titles:
        if title not in card.sections:
            continue
        parts.append(f"## {title}")
        parts.append("")
        body = card.sections[title].strip("\n")
        if body:
            parts.append(body)
            parts.append("")
    return "\n".join(parts).rstrip("\n") + "\n"


def save_card(card: Card, path: Optional[Path | str] = None) -> Path:
    target = Path(path or card.path or "")
    if not str(target):
        raise ValueError("no path provided to save_card")
    text = serialize_card(card)
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
    card.path = target
    return target


# ───────────────────────── mutations (append-only contract) ─────────────────────────


def now_kst() -> datetime:
    return datetime.now(KST)


def _ts_short(ts: datetime) -> str:
    return ts.strftime("%Y-%m-%d %H:%M")


def _ts_iso(ts: datetime) -> str:
    return ts.strftime("%Y-%m-%dT%H:%M:%S+09:00")


def bump_updated(card: Card, ts: Optional[datetime] = None) -> None:
    card.frontmatter.updated = _ts_iso(ts or now_kst())


def append_command(
    card: Card,
    author: str,
    verb: str,
    args: Optional[str] = None,
    ts: Optional[datetime] = None,
) -> CommandEntry:
    ts = ts or now_kst()
    line = f"- [ ] {_ts_short(ts)} {author}: {verb}"
    if args:
        line += f": {args}"
    body = card.sections.get("Command Queue", "")
    card.sections["Command Queue"] = (body.rstrip("\n") + "\n" + line) if body else line
    bump_updated(card, ts)
    return CommandEntry(
        done=False,
        timestamp=_ts_short(ts),
        author=author,
        verb=verb,
        args=args,
    )


def append_event(
    card: Card,
    type_: str,
    description: str,
    ts: Optional[datetime] = None,
) -> EventEntry:
    ts = ts or now_kst()
    line = f"- {_ts_short(ts)} [{type_}] {description}"
    body = card.sections.get("Event Log", "")
    card.sections["Event Log"] = (body.rstrip("\n") + "\n" + line) if body else line
    bump_updated(card, ts)
    return EventEntry(
        timestamp=_ts_short(ts),
        type=type_,
        description=description,
    )


def mark_command_done(card: Card, index: int) -> None:
    """Toggle the index-th Command Queue bullet's checkbox to [x].

    `index` counts only bullets that match COMMAND_RE — comments and other
    non-bullet lines are skipped.
    """
    body = card.sections.get("Command Queue", "")
    lines = body.split("\n")
    bullet_indices = [i for i, ln in enumerate(lines) if COMMAND_RE.match(ln)]
    if not (0 <= index < len(bullet_indices)):
        raise IndexError(
            f"command index {index} out of range (have {len(bullet_indices)} bullets)"
        )
    target = bullet_indices[index]
    lines[target] = lines[target].replace("- [ ]", "- [x]", 1)
    card.sections["Command Queue"] = "\n".join(lines)
    bump_updated(card)


# ───────────────────────── discovery ─────────────────────────


def find_cards(root: Path | str) -> list[Path]:
    """Find all projects/<slug>/card.md files under `root`, sorted by slug."""
    return sorted(Path(root).glob("projects/*/card.md"))
