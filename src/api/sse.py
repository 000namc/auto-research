"""Server-Sent Events broadcaster for card.md and agent state changes.

Architecture:
  EventBus           — single fan-out for all SSE events
   ├── CardWatcher   — polls projects/*/card.md mtimes, publishes card_*
   └── AgentWatcher  — polls tmux session state, publishes agent_state_changed

The /api/events endpoint subscribes to the bus and streams everything to the
webapp; the React side filters by event name.

Polling latency: 1s (CardWatcher) and 2s (AgentWatcher). Good enough for a
human-in-the-loop UI; swap to inotify/watchfiles later if needed.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncIterator

logger = logging.getLogger(__name__)

CARD_POLL_INTERVAL_S = 1.0
AGENT_POLL_INTERVAL_S = 2.0
QUEUE_MAXSIZE = 64


# ───────────────────────── EventBus ─────────────────────────


class EventBus:
    """Single SSE fan-out. Multiple watchers publish, multiple endpoints subscribe."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[str]] = set()

    async def publish(self, event: str, data: dict) -> None:
        message = _sse_format(event, data)
        for q in list(self._subscribers):
            await self._safe_put(q, message)

    @staticmethod
    async def _safe_put(q: asyncio.Queue[str], message: str) -> None:
        try:
            q.put_nowait(message)
        except asyncio.QueueFull:
            # Drop oldest to make room — slow clients shouldn't block others.
            try:
                q.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                pass

    async def subscribe(self) -> AsyncIterator[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        self._subscribers.add(q)
        try:
            yield _sse_format(
                "hello", {"pid": os.getpid()}
            )
            while True:
                try:
                    message = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    # Heartbeat keeps proxies/tunnels from killing the connection.
                    yield ": ping\n\n"
                    continue
                yield message
                if message.startswith("event: close"):
                    return
        finally:
            self._subscribers.discard(q)


def _sse_format(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# ───────────────────────── CardWatcher ─────────────────────────


@dataclass
class CardWatcher:
    root: Path
    bus: EventBus
    _mtimes: dict[str, float] = field(default_factory=dict)
    _task: asyncio.Task | None = None

    async def start(self) -> None:
        # Seed initial mtimes so the first scan doesn't flood.
        for p in sorted(self.root.glob("projects/*/card.md")):
            try:
                self._mtimes[p.parent.name] = p.stat().st_mtime
            except FileNotFoundError:
                pass
        self._task = asyncio.create_task(self._loop(), name="card-watcher")
        logger.info("CardWatcher started, watching %s", self.root)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        while True:
            try:
                await self._scan_once()
            except Exception:
                logger.exception("CardWatcher scan failed")
            await asyncio.sleep(CARD_POLL_INTERVAL_S)

    async def _scan_once(self) -> None:
        seen: set[str] = set()
        for p in sorted(self.root.glob("projects/*/card.md")):
            card_id = p.parent.name
            seen.add(card_id)
            try:
                mtime = p.stat().st_mtime
            except FileNotFoundError:
                continue
            prev = self._mtimes.get(card_id)
            if prev is None:
                self._mtimes[card_id] = mtime
                await self.bus.publish("card_added", {"id": card_id})
            elif mtime != prev:
                self._mtimes[card_id] = mtime
                await self.bus.publish("card_changed", {"id": card_id})
        for gone in set(self._mtimes) - seen:
            self._mtimes.pop(gone, None)
            await self.bus.publish("card_removed", {"id": gone})


# ───────────────────────── DirectionWatcher ─────────────────────────


DIRECTION_POLL_INTERVAL_S = 1.0


@dataclass
class DirectionWatcher:
    """Polls `explore/*/direction.md` and its `findings/f*.md` children.

    Publishes:
      - direction_added / direction_changed / direction_removed {slug}
      - finding_added / finding_changed / finding_removed {slug, fid}

    Mirrors CardWatcher's polling model so the webapp reuses the same SSE
    plumbing for live updates.
    """

    root: Path
    bus: EventBus
    _dir_mtimes: dict[str, float] = field(default_factory=dict)
    _finding_mtimes: dict[str, float] = field(default_factory=dict)  # key = "slug/fid"
    _task: asyncio.Task | None = None

    async def start(self) -> None:
        for p in sorted(self.root.glob("explore/*/direction.md")):
            try:
                self._dir_mtimes[p.parent.name] = p.stat().st_mtime
            except FileNotFoundError:
                pass
        for p in sorted(self.root.glob("explore/*/findings/*.md")):
            try:
                key = f"{p.parent.parent.name}/{p.stem}"
                self._finding_mtimes[key] = p.stat().st_mtime
            except FileNotFoundError:
                pass
        self._task = asyncio.create_task(self._loop(), name="direction-watcher")
        logger.info("DirectionWatcher started, watching %s", self.root)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        while True:
            try:
                await self._scan_once()
            except Exception:
                logger.exception("DirectionWatcher scan failed")
            await asyncio.sleep(DIRECTION_POLL_INTERVAL_S)

    async def _scan_once(self) -> None:
        seen_dirs: set[str] = set()
        for p in sorted(self.root.glob("explore/*/direction.md")):
            slug = p.parent.name
            seen_dirs.add(slug)
            try:
                mtime = p.stat().st_mtime
            except FileNotFoundError:
                continue
            prev = self._dir_mtimes.get(slug)
            if prev is None:
                self._dir_mtimes[slug] = mtime
                await self.bus.publish("direction_added", {"slug": slug})
            elif mtime != prev:
                self._dir_mtimes[slug] = mtime
                await self.bus.publish("direction_changed", {"slug": slug})
        for gone in set(self._dir_mtimes) - seen_dirs:
            self._dir_mtimes.pop(gone, None)
            await self.bus.publish("direction_removed", {"slug": gone})

        seen_findings: set[str] = set()
        for p in sorted(self.root.glob("explore/*/findings/*.md")):
            slug = p.parent.parent.name
            fid = p.stem
            if slug not in seen_dirs:
                continue  # orphaned finding — direction disappeared
            key = f"{slug}/{fid}"
            seen_findings.add(key)
            try:
                mtime = p.stat().st_mtime
            except FileNotFoundError:
                continue
            prev = self._finding_mtimes.get(key)
            if prev is None:
                self._finding_mtimes[key] = mtime
                await self.bus.publish("finding_added", {"slug": slug, "fid": fid})
            elif mtime != prev:
                self._finding_mtimes[key] = mtime
                await self.bus.publish("finding_changed", {"slug": slug, "fid": fid})
        for gone in set(self._finding_mtimes) - seen_findings:
            self._finding_mtimes.pop(gone, None)
            slug, _, fid = gone.partition("/")
            await self.bus.publish("finding_removed", {"slug": slug, "fid": fid})


# ───────────────────────── DocsWatcher ─────────────────────────


DOCS_POLL_INTERVAL_S = 1.0


@dataclass
class DocsWatcher:
    """Polls `docs/*.md` for mtime/presence changes.

    Publishes one of:
      - docs_added   {name}  — new file appeared
      - docs_changed {name}  — existing file content changed
      - docs_removed {name}  — file deleted
    `name` is the filename stem (no `.md`).
    """

    docs_dir: Path
    bus: EventBus
    _mtimes: dict[str, float] = field(default_factory=dict)
    _task: asyncio.Task | None = None

    async def start(self) -> None:
        # Seed initial mtimes so first scan doesn't emit `added` for every file.
        if self.docs_dir.exists():
            for p in sorted(self.docs_dir.glob("*.md")):
                try:
                    self._mtimes[p.stem] = p.stat().st_mtime
                except OSError:
                    pass
        self._task = asyncio.create_task(self._loop(), name="docs-watcher")
        logger.info("DocsWatcher started, watching %s", self.docs_dir)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        while True:
            try:
                await self._scan_once()
            except Exception:
                logger.exception("DocsWatcher scan failed")
            await asyncio.sleep(DOCS_POLL_INTERVAL_S)

    async def _scan_once(self) -> None:
        seen: set[str] = set()
        if self.docs_dir.exists():
            for p in sorted(self.docs_dir.glob("*.md")):
                name = p.stem
                seen.add(name)
                try:
                    mtime = p.stat().st_mtime
                except OSError:
                    continue
                prev = self._mtimes.get(name)
                if prev is None:
                    self._mtimes[name] = mtime
                    await self.bus.publish("docs_added", {"name": name})
                elif mtime != prev:
                    self._mtimes[name] = mtime
                    await self.bus.publish("docs_changed", {"name": name})
        for gone in set(self._mtimes) - seen:
            self._mtimes.pop(gone, None)
            await self.bus.publish("docs_removed", {"name": gone})


# ───────────────────────── AgentWatcher ─────────────────────────


@dataclass
class AgentWatcher:
    """Polls tmux session + filesystem state and publishes:
       - agent_added:         a new instance appears (spawn)
       - agent_removed:       an instance disappears (archive)
       - agent_state_changed: up/down flips on an existing agent
       - agent_pane_changed:  the pane content (last 200 lines) changes

    Keyed by `info.address` ("role" for singletons, "role/name" for
    multi-role instances) so multiple instances of the same role don't
    collide on a single-role dict key.
    """

    bus: EventBus
    _states: dict[str, str] = field(default_factory=dict)      # address -> "up"|"down"
    _pane_hashes: dict[str, str] = field(default_factory=dict) # address -> pane hash
    _task: asyncio.Task | None = None

    async def start(self) -> None:
        try:
            await self._scan_once(emit=False)  # seed
        except Exception:
            logger.exception("AgentWatcher initial scan failed")
        self._task = asyncio.create_task(self._loop(), name="agent-watcher")
        logger.info("AgentWatcher started")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        while True:
            try:
                await self._scan_once(emit=True)
            except Exception:
                logger.exception("AgentWatcher scan failed")
            await asyncio.sleep(AGENT_POLL_INTERVAL_S)

    async def _scan_once(self, emit: bool) -> None:
        # Local import avoids a circular reference; agents.py uses subprocess
        # and is cheap to import.
        from .agents import list_agents, info_dict, pane_hash

        seen: set[str] = set()
        for info in list_agents():
            addr = info.address
            seen.add(addr)

            # First sight of this address → agent_added (except during seed)
            prev_state = self._states.get(addr)
            if prev_state is None:
                self._states[addr] = info.tmux_state
                if emit:
                    await self.bus.publish("agent_added", info_dict(info))
            elif prev_state != info.tmux_state:
                self._states[addr] = info.tmux_state
                if emit:
                    await self.bus.publish(
                        "agent_state_changed",
                        info_dict(info),
                    )

            # Pane content change (only if up)
            if info.tmux_state == "up":
                h = pane_hash(info.role, info.name)
                if h is None:
                    continue
                prev_hash = self._pane_hashes.get(addr)
                if prev_hash is None:
                    self._pane_hashes[addr] = h
                elif prev_hash != h:
                    self._pane_hashes[addr] = h
                    if emit:
                        await self.bus.publish(
                            "agent_pane_changed",
                            {
                                "role": info.role,
                                "name": info.name,
                                "address": addr,
                                "hash": h,
                            },
                        )
            else:
                # Session is down → drop stale hash so a future restart triggers a fresh seed.
                self._pane_hashes.pop(addr, None)

        # Anything previously tracked but no longer in the list → archived/removed.
        for gone in set(self._states) - seen:
            self._states.pop(gone, None)
            self._pane_hashes.pop(gone, None)
            if emit:
                role, _, name = gone.partition("/")
                await self.bus.publish(
                    "agent_removed",
                    {"role": role, "name": name or None, "address": gone},
                )
