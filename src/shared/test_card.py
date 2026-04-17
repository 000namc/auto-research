"""Tests for shared.card.

Run inside the api container:
    docker compose run --rm api pytest src/shared/test_card.py -v
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest

from shared.card import (
    Card,
    CommandEntry,
    EventEntry,
    KST,
    SECTION_ORDER,
    append_command,
    append_event,
    find_cards,
    load_card,
    mark_command_done,
    parse_card,
    save_card,
    serialize_card,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
PROJ0 = REPO_ROOT / "projects" / "proj0" / "card.md"


# ───────────────────────── fixtures ─────────────────────────


@pytest.fixture
def proj0_text() -> str:
    assert PROJ0.exists(), f"fixture missing: {PROJ0}"
    return PROJ0.read_text(encoding="utf-8")


@pytest.fixture
def proj0_card(proj0_text: str) -> Card:
    return parse_card(proj0_text)


# ───────────────────────── parse: frontmatter ─────────────────────────


def test_frontmatter_parses(proj0_card: Card) -> None:
    fm = proj0_card.frontmatter
    assert fm.id == "proj0"
    assert fm.stage == "run"
    assert fm.substage == "survey"
    assert fm.status == "awaiting_user"
    assert fm.assignee == "user"
    assert "smoke-test" in fm.tags
    assert fm.parent_id is None
    assert fm.target_venue is None


def test_card_id_property(proj0_card: Card) -> None:
    assert proj0_card.id == "proj0"


# ───────────────────────── parse: body sections ─────────────────────────


def test_all_required_sections_present(proj0_card: Card) -> None:
    for required in ["Summary", "Plan", "Blockers", "Command Queue", "Event Log"]:
        assert required in proj0_card.sections, f"missing required section: {required}"


def test_section_summary_nonempty(proj0_card: Card) -> None:
    assert "compositional" in proj0_card.sections["Summary"].lower()


def test_blockers_parse(proj0_card: Card) -> None:
    blockers = proj0_card.parsed_blockers()
    assert len(blockers) == 2
    assert all(b.done is False for b in blockers)
    assert "survey" in blockers[0].text


# ───────────────────────── parse: Command Queue ─────────────────────────


def test_command_queue_parses(proj0_card: Card) -> None:
    cmds = proj0_card.parsed_commands()
    assert len(cmds) == 3
    # Line 0: `- [x] 2026-04-08 14:20 user: proj0 생성, smoke test 목적`
    # Free text → schema §6.1 falls back to verb="note".
    assert cmds[0].done is True
    assert cmds[0].author == "user"
    assert cmds[0].verb == "note"
    assert cmds[0].args == "proj0 생성, smoke test 목적"
    # Line 1: `- [x] 2026-04-08 14:25 user: approve`
    assert cmds[1].verb == "approve"
    assert cmds[1].args is None
    # Line 2: `- [ ] 2026-04-10 10:30 ai: note: 플랜 작성 완료, ...`
    assert cmds[2].done is False
    assert cmds[2].author == "ai"
    assert cmds[2].verb == "note"
    assert cmds[2].args is not None and "플랜 작성 완료" in cmds[2].args


# ───────────────────────── parse: Event Log ─────────────────────────


def test_event_log_parses(proj0_card: Card) -> None:
    events = proj0_card.parsed_events()
    assert len(events) >= 5
    types = [e.type for e in events]
    assert "ideation" in types
    assert "approval" in types
    assert "gate" in types
    # Last event is the v0.1→v0.2 schema migration marker.
    last = events[-1]
    assert last.type == "migration"
    assert "v0.2" in last.description


# ───────────────────────── round-trip (semantic) ─────────────────────────


def test_semantic_roundtrip(proj0_card: Card) -> None:
    serialized = serialize_card(proj0_card)
    reparsed = parse_card(serialized)

    # Frontmatter equal
    assert reparsed.frontmatter == proj0_card.frontmatter

    # Section bodies equal (after strip)
    for title in proj0_card.sections:
        assert reparsed.sections[title].strip() == proj0_card.sections[title].strip(), (
            f"section drift in '{title}'"
        )


def test_serialized_starts_with_frontmatter(proj0_card: Card) -> None:
    text = serialize_card(proj0_card)
    assert text.startswith("---\n")
    assert "\n---\n" in text


def test_serialized_section_order(proj0_card: Card) -> None:
    text = serialize_card(proj0_card)
    indices = []
    for title in SECTION_ORDER:
        if title in proj0_card.sections:
            idx = text.find(f"## {title}")
            assert idx != -1, f"missing serialized header for {title}"
            indices.append(idx)
    assert indices == sorted(indices), "sections out of canonical order"


def test_timestamps_serialized_unquoted_with_T(proj0_card: Card) -> None:
    """Regression: PyYAML force-quotes timestamp-like strings; serialize_card
    must post-process them back to bare ISO 8601 with `T` separator."""
    text = serialize_card(proj0_card)
    # Bare form (canonical, schema §3.1)
    assert "created: 2026-04-08T14:20:00+09:00" in text
    # No quoted form
    assert "created: '2026-" not in text
    assert "updated: '2026-" not in text
    # No space-separated YAML timestamp form
    assert "created: 2026-04-08 14:20:00" not in text


# ───────────────────────── mutations ─────────────────────────


def test_append_command(proj0_card: Card) -> None:
    before = len(proj0_card.parsed_commands())
    fixed_ts = datetime(2026, 4, 11, 12, 0, tzinfo=KST)
    append_command(proj0_card, "user", "approve", ts=fixed_ts)
    after = proj0_card.parsed_commands()
    assert len(after) == before + 1
    assert after[-1].author == "user"
    assert after[-1].verb == "approve"
    assert after[-1].timestamp == "2026-04-11 12:00"
    assert proj0_card.frontmatter.updated.startswith("2026-04-11T12:00:00")


def test_append_command_with_args(proj0_card: Card) -> None:
    fixed_ts = datetime(2026, 4, 11, 13, 0, tzinfo=KST)
    append_command(
        proj0_card,
        "user",
        "revise",
        args="Stage 3 budget too high",
        ts=fixed_ts,
    )
    cmds = proj0_card.parsed_commands()
    assert cmds[-1].verb == "revise"
    assert cmds[-1].args == "Stage 3 budget too high"


def test_append_event(proj0_card: Card) -> None:
    before = len(proj0_card.parsed_events())
    fixed_ts = datetime(2026, 4, 11, 14, 0, tzinfo=KST)
    append_event(proj0_card, "user_note", "test note", ts=fixed_ts)
    events = proj0_card.parsed_events()
    assert len(events) == before + 1
    assert events[-1].type == "user_note"
    assert events[-1].description == "test note"


def test_mark_command_done(proj0_card: Card) -> None:
    # The 3rd command (index 2) is initially [ ]
    assert proj0_card.parsed_commands()[2].done is False
    mark_command_done(proj0_card, 2)
    assert proj0_card.parsed_commands()[2].done is True
    # Round-trip preserves the toggle
    reparsed = parse_card(serialize_card(proj0_card))
    assert reparsed.parsed_commands()[2].done is True


def test_mark_command_done_out_of_range(proj0_card: Card) -> None:
    with pytest.raises(IndexError):
        mark_command_done(proj0_card, 999)


def test_existing_commands_preserved_after_append(proj0_card: Card) -> None:
    """Append must not rewrite or reorder existing entries."""
    original_cmds = proj0_card.parsed_commands()
    append_command(proj0_card, "user", "note", args="hi")
    new_cmds = proj0_card.parsed_commands()
    assert len(new_cmds) == len(original_cmds) + 1
    for old, new in zip(original_cmds, new_cmds[:-1]):
        assert old == new


# ───────────────────────── save/load round-trip ─────────────────────────


def test_save_and_reload(tmp_path: Path, proj0_card: Card) -> None:
    target = tmp_path / "proj_test" / "card.md"
    target.parent.mkdir()
    save_card(proj0_card, target)
    assert target.exists()
    reloaded = load_card(target)
    assert reloaded.frontmatter == proj0_card.frontmatter
    assert reloaded.parsed_commands() == proj0_card.parsed_commands()


def test_save_atomic_no_temp_leftover(tmp_path: Path, proj0_card: Card) -> None:
    target = tmp_path / "card.md"
    save_card(proj0_card, target)
    leftovers = list(tmp_path.glob(".card.md.*.tmp"))
    assert leftovers == []


# ───────────────────────── discovery ─────────────────────────


def test_find_cards_finds_proj0() -> None:
    cards = find_cards(REPO_ROOT)
    assert PROJ0 in cards
