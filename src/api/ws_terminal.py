"""WebSocket endpoint that attaches an interactive tmux client to an agent
session running in the agents container.

Design:
    browser (xterm.js) ─WS─→ api container ──┐
                                              │  pty.openpty() + tmux attach
    bytes ←─ os.read(master_fd) ─────────────┤
    bytes ─→ os.write(master_fd) ────────────┘

`tmux attach-session -d -t agent-{role}` runs as a subprocess of api, but the
tmux server itself lives in the agents container (shared /tmp/tmux-1000 socket
volume). So from the agent's perspective this is just another tmux client
attaching to its session — /model, slash commands, arrow-key history, etc. all
work because they're handled by the real claude TUI on the other side of the
pty. No send-keys + Enter shenanigans.

On WS disconnect we run `tmux detach-client -s agent-{role}` so the tmux
session stays alive (the claude process inside keeps working).
"""
from __future__ import annotations

import asyncio
import fcntl
import json
import logging
import os
import pty
import select
import shutil
import signal
import struct
import subprocess
import termios

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .agents import CARDINALITY, ROLES, session_for

logger = logging.getLogger("api.ws_terminal")

router = APIRouter(tags=["agent-terminal"])


async def _run_agent_terminal(ws: WebSocket, role: str, name: str | None):
    await ws.accept()

    if role not in ROLES:
        await ws.send_bytes(f"\x1b[31munknown role: {role}\x1b[0m\r\n".encode())
        await ws.close(code=4000, reason=f"unknown role: {role}")
        return

    try:
        session = session_for(role, name)
    except ValueError as e:
        await ws.send_bytes(f"\x1b[31m{e}\x1b[0m\r\n".encode())
        await ws.close(code=4000, reason=str(e))
        return

    # tmux binary check (it's apt-installed in Dockerfile.api but be defensive).
    if shutil.which("tmux") is None:
        await ws.send_bytes(b"\x1b[31mtmux not found in api container\x1b[0m\r\n")
        await ws.close(code=4002, reason="tmux missing")
        return

    # Require session to exist — user must start the agent first via the UI.
    has_session = subprocess.run(
        ["tmux", "has-session", "-t", session],
        capture_output=True,
        timeout=5,
    )
    if has_session.returncode != 0:
        address = role if name is None else f"{role}/{name}"
        await ws.send_bytes(
            f"\x1b[33magent {address} is not running. click Start on the card first.\x1b[0m\r\n".encode()
        )
        await ws.close(code=4004, reason=f"session {session} not running")
        return

    master_fd, slave_fd = pty.openpty()
    # Initial size — xterm will send a resize shortly after connecting.
    winsize = struct.pack("HHHH", 30, 120, 0, 0)
    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)

    env = os.environ.copy()
    env["TERM"] = "xterm-256color"

    # `-d` detaches any other attached client so we don't fight over window
    # size. Fine for solo use; if multi-viewer is ever wanted, drop -d and
    # accept mirrored viewports.
    proc = subprocess.Popen(
        ["tmux", "attach-session", "-d", "-t", session],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        env=env,
        close_fds=True,
        start_new_session=True,
    )
    os.close(slave_fd)

    loop = asyncio.get_event_loop()
    running = True

    async def read_pty():
        while running:
            try:
                readable = await loop.run_in_executor(
                    None, lambda: select.select([master_fd], [], [], 0.05)[0]
                )
                if readable:
                    data = os.read(master_fd, 16384)
                    if not data:
                        break
                    await ws.send_bytes(data)
            except (OSError, WebSocketDisconnect):
                break

    read_task = asyncio.create_task(read_pty())

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            if "text" in msg and msg["text"] is not None:
                try:
                    data = json.loads(msg["text"])
                except (TypeError, ValueError):
                    continue
                kind = data.get("type")
                if kind == "resize":
                    try:
                        cols = int(data.get("cols", 120))
                        rows = int(data.get("rows", 30))
                    except (TypeError, ValueError):
                        continue
                    if not (0 < cols <= 1000 and 0 < rows <= 1000):
                        continue
                    ws_sz = struct.pack("HHHH", rows, cols, 0, 0)
                    try:
                        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, ws_sz)
                    except OSError:
                        pass
                    # Nudge the tmux client with an explicit SIGWINCH. Some
                    # PTY layers do not auto-deliver it from TIOCSWINSZ, so
                    # the client ends up stuck at its create-time size, the
                    # window does not follow (even with aggressive-resize on),
                    # and the `#{?window_bigger,…,}` status-right conditional
                    # paints `·` padding + `[0,0]` markers into the viewport.
                    # With the signal, the client re-reads its winsize and
                    # the server's window tracks it automatically — no manual
                    # `tmux resize-window` needed (which only fights with the
                    # client's own size and keeps window_bigger tripped).
                    try:
                        os.kill(proc.pid, signal.SIGWINCH)
                    except (OSError, ProcessLookupError):
                        pass
                    logger.info("resize %s -> %dx%d", session, cols, rows)
                elif kind == "input":
                    payload = data.get("data", "")
                    if isinstance(payload, str) and payload:
                        try:
                            os.write(master_fd, payload.encode())
                        except OSError:
                            break
            elif "bytes" in msg and msg["bytes"] is not None:
                try:
                    os.write(master_fd, msg["bytes"])
                except OSError:
                    break

    except WebSocketDisconnect:
        pass
    finally:
        running = False
        read_task.cancel()

        # Detach the client so the tmux session keeps the claude process alive.
        try:
            subprocess.run(
                ["tmux", "detach-client", "-s", session],
                capture_output=True,
                timeout=3,
            )
        except Exception as e:
            logger.warning("detach-client failed for %s: %s", session, e)

        try:
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

        try:
            os.close(master_fd)
        except OSError:
            pass


@router.websocket("/ws/agent/{role}")
async def agent_terminal_singleton(ws: WebSocket, role: str):
    """WS for singletons. Multi roles on this path get rejected by session_for."""
    await _run_agent_terminal(ws, role, None)


@router.websocket("/ws/agent/{role}/{name}")
async def agent_terminal_instance(ws: WebSocket, role: str, name: str):
    """WS for named instances of multi roles. Singletons on this path get
    rejected by session_for (cardinality mismatch)."""
    await _run_agent_terminal(ws, role, name)


# The top-level CARDINALITY import is kept so the module is the one-stop
# reference for the terminal-ws wiring; the route handlers themselves defer
# validation to session_for(), which consults CARDINALITY internally.
_ = CARDINALITY
