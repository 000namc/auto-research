import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type { AgentRole } from '../types'

interface Props {
  role: AgentRole
  name?: string | null    // null → singleton
  onClose: () => void
}

/**
 * Interactive terminal attached to the agent's tmux session via the
 * `/ws/agent/{role}` WebSocket. Full TTY — slash commands, arrow-key
 * history, /model picker etc. all work because the real claude TUI is on
 * the other side of the pty and we just relay raw bytes.
 *
 * Disconnect just detaches the tmux client; the claude process keeps running.
 */
export function AgentPaneViewer({ role, name = null, onClose }: Props) {
  const address = name ? `${role}/${name}` : role
  const wsPath = name ? `/ws/agent/${role}/${encodeURIComponent(name)}` : `/ws/agent/${role}`
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: '#0f172a', // slate-900
        foreground: '#e2e8f0', // slate-200
        cursor: '#e2e8f0',
        selectionBackground: '#334155', // slate-700
      },
      scrollback: 10000,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    termRef.current = term

    term.open(containerRef.current)

    // Swap in the WebGL renderer AFTER open() — the default DOM renderer
    // leans on the system font for box-drawing characters (U+2500 series),
    // which depending on the font's glyph metrics renders `─` as a small
    // dot-sized segment per cell. Claude Code's TUI draws hundreds of those
    // as message dividers, so the screen ends up looking like a dot grid.
    // The WebGL (and Canvas) renderer draws box-drawing as geometric shapes
    // spanning the full cell, which is what we want. Fall back silently if
    // the browser can't give us a WebGL2 context.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      // leave the DOM renderer in place
    }

    // Claude Code (and many TUIs) enable VT mouse tracking (DECSET 1000/1002/
    // 1003), at which point xterm.js forwards wheel events to the pty as mouse
    // sequences — the app then maps them to up/down arrow keys, so scrolling
    // looks like cycling through chat history instead of moving the viewport.
    // We want wheel = local scrollback always, so capture the event before
    // xterm's own handler and scroll the buffer ourselves.
    const onWheel = (ev: WheelEvent) => {
      ev.stopPropagation()
      ev.preventDefault()
      const step = ev.shiftKey ? 1 : 3
      term.scrollLines(Math.sign(ev.deltaY) * step)
    }
    term.element?.addEventListener('wheel', onWheel, {
      capture: true,
      passive: false,
    })

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}${wsPath}`)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    const sendResize = () => {
      const dims = fitAddon.proposeDimensions()
      if (!dims) return
      const { cols, rows } = dims
      if (!Number.isFinite(cols) || !Number.isFinite(rows)) return
      if (cols <= 0 || rows <= 0) return
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(
        JSON.stringify({
          type: 'resize',
          cols: Math.floor(cols),
          rows: Math.floor(rows),
        }),
      )
      // Nudge claude to redraw at the new geometry — SIGWINCH alone is not
      // always enough (tmux scrollback retains old-coordinate content and
      // claude's partial redraw ghosts on top). Small delay so the pty
      // resize has time to land before Ctrl+L.
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data: '\x0c' }))
        }
      }, 80)
    }

    // xterm renders its screen at cols*charWidth — if fit() runs before the
    // monospace webfont has loaded, charWidth is measured against the fallback
    // font (usually wider), so cols ends up too small and the canvas only
    // fills the left half of the container. Defer the initial fit to the next
    // animation frame, and re-fit once webfonts finish loading.
    //
    // Debounced: multiple fit() in quick succession push several SIGWINCH at
    // claude's TUI which can tear its redraw mid-frame. Coalesce into one.
    let lastCols = -1
    let lastRows = -1
    let fitTimer: ReturnType<typeof setTimeout> | null = null
    const safeFit = () => {
      if (fitTimer) clearTimeout(fitTimer)
      fitTimer = setTimeout(() => {
        fitTimer = null
        try {
          fitAddon.fit()
        } catch {
          return
        }
        const dims = fitAddon.proposeDimensions()
        if (!dims) return
        const cols = Math.floor(dims.cols)
        const rows = Math.floor(dims.rows)
        if (cols === lastCols && rows === lastRows) return
        lastCols = cols
        lastRows = rows
        sendResize()
      }, 60)
    }
    requestAnimationFrame(safeFit)
    if (document.fonts?.ready) {
      document.fonts.ready.then(safeFit).catch(() => {})
    }

    // Shift+Enter → ESC+CR (Claude Code newline vs submit convention).
    term.attachCustomKeyEventHandler((ev) => {
      if (
        ev.type === 'keydown' &&
        ev.key === 'Enter' &&
        ev.shiftKey &&
        !ev.ctrlKey &&
        !ev.altKey &&
        !ev.metaKey
      ) {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'input', data: '\x1b\r' }))
        }
        ev.preventDefault()
        return false
      }
      return true
    })

    ws.onopen = () => {
      setConnected(true)
      setError(null)
      safeFit()
      try {
        term.focus()
      } catch {
        // ignore
      }
      // Tmux keeps old (possibly smaller-viewport) scrollback for the session,
      // and claude's TUI redraw after SIGWINCH can ghost on top of it. Give
      // the resize a moment to propagate, then nudge claude with Ctrl+L so it
      // clears + redraws at our current size.
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            term.clear()
          } catch {
            // ignore
          }
          ws.send(JSON.stringify({ type: 'input', data: '\x0c' }))
        }
      }, 150)
    }

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data))
      } else if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((buf) => term.write(new Uint8Array(buf)))
      } else {
        term.write(event.data)
      }
    }

    ws.onclose = (ev) => {
      setConnected(false)
      if (ev.reason) setError(ev.reason)
      term.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n')
    }

    ws.onerror = () => {
      setConnected(false)
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Re-fit whenever container size changes (sidebar toggles, window resize).
    const ro = new ResizeObserver(safeFit)
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      try {
        term.element?.removeEventListener('wheel', onWheel, { capture: true })
      } catch {
        // ignore
      }
      try {
        ws.close()
      } catch {
        // ignore
      }
      try {
        term.dispose()
      } catch {
        // ignore
      }
      wsRef.current = null
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, name])

  return (
    <div className="flex h-full w-full flex-col bg-slate-900 text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className={
              'h-2 w-2 rounded-full ' +
              (connected ? 'bg-emerald-400' : 'bg-slate-600')
            }
          />
          <span className="font-mono text-xs">agent · {address}</span>
          {error && (
            <span className="font-mono text-[10px] text-rose-400">{error}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-xs text-slate-400 hover:text-slate-200"
          title="Close pane viewer"
        >
          ✕
        </button>
      </div>
      {/* Terminal host. min-h-0/min-w-0 are required so this flex child can
          actually shrink below its content's intrinsic size — without them,
          xterm's canvas can refuse to downsize and the flex layout gets
          confused. overflow-hidden clips any 1-2px rounding mismatch between
          (cols × cellWidth) and the container. */}
      <div
        ref={containerRef}
        className="min-h-0 min-w-0 flex-1 overflow-hidden"
      />
    </div>
  )
}
