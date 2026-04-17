import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentInfo, AgentRole, AgentsResponse, RoleMeta } from '../types'
import {
  archiveInstance,
  fetchAgents,
  restartAgent,
  spawnInstance,
  startAgent,
  stopAgent,
} from '../api'
import { AgentPaneViewer } from './AgentPaneViewer'

interface Props {
  liveTick: number
}

const ROLE_LABELS: Record<AgentRole, string> = {
  'orchestrator': 'orchestrator',
  'research-worker': 'research',
  'execution-worker': 'execution',
  'writing-worker': 'writing',
}

const ROLE_DESCRIPTIONS: Record<AgentRole, string> = {
  'orchestrator': 'dispatcher · state machine',
  'research-worker': 'ideation · librarian · planner',
  'execution-worker': 'experiments · validator · analysis',
  'writing-worker': 'latex · automated review',
}

// Mirrors src/api/agents.py `_NAME_RE`.
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/

export function AgentPanel({ liveTick }: Props) {
  const [roles, setRoles] = useState<RoleMeta[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const reload = useCallback(() => {
    fetchAgents()
      .then((d: AgentsResponse) => {
        setRoles(d.roles)
        setAgents(d.agents)
        setError(null)
      })
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    reload()
  }, [reload, liveTick])

  /** Group agents by role, preserving the server's role ordering. */
  const byRole = useMemo(() => {
    const m = new Map<AgentRole, AgentInfo[]>()
    for (const a of agents) {
      const arr = m.get(a.role) ?? []
      arr.push(a)
      m.set(a.role, arr)
    }
    return m
  }, [agents])

  const markBusy = (key: string, val: boolean) =>
    setBusy((b) => ({ ...b, [key]: val }))

  const runAction = async (key: string, fn: () => Promise<unknown>) => {
    markBusy(key, true)
    setError(null)
    try {
      await fn()
      reload()
    } catch (e) {
      setError(String(e))
    } finally {
      markBusy(key, false)
    }
  }

  const onSpawn = (role: AgentRole) => {
    const name = window.prompt(
      `spawn new ${role} — instance name (a-z, 0-9, hyphen; 1-32)`,
    )
    if (!name) return
    const trimmed = name.trim().toLowerCase()
    if (!NAME_RE.test(trimmed)) {
      setError(`invalid instance name '${trimmed}'`)
      return
    }
    void runAction(`spawn:${role}:${trimmed}`, () => spawnInstance(role, trimmed))
  }

  const onArchive = (role: AgentRole, name: string) => {
    if (
      !window.confirm(
        `archive ${role}/${name}? files move to .archive/, the process is killed.`,
      )
    )
      return
    void runAction(`archive:${role}:${name}`, () => archiveInstance(role, name))
    if (selected === `${role}/${name}`) setSelected(null)
  }

  const selectedAgent = useMemo(
    () => agents.find((a) => a.address === selected) ?? null,
    [agents, selected],
  )

  // Clear selection if the selected agent disappeared (e.g. archived).
  useEffect(() => {
    if (selected && !agents.some((a) => a.address === selected)) {
      setSelected(null)
    }
  }, [agents, selected])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-900/40">
      {/* Roles: fixed area at top when terminal is open; scrollable. */}
      <div
        className={
          'min-h-0 overflow-y-auto px-4 py-3 ' +
          (selectedAgent ? 'flex-shrink-0 max-h-[40%]' : 'flex-1')
        }
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Agents
          </h2>
          <span className="text-[10px] text-slate-500">
            tmux · click a card for terminal
          </span>
        </div>

        {error && (
          <div className="mb-3 rounded border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {roles.map((meta) => (
            <RoleRow
              key={meta.role}
              meta={meta}
              instances={byRole.get(meta.role) ?? []}
              selected={selected}
              busy={busy}
              onSelect={setSelected}
              onSpawn={() => onSpawn(meta.role)}
              onStart={(info) =>
                runAction(`start:${info.address}`, () =>
                  startAgent(info.role, info.name),
                )
              }
              onStop={(info) =>
                runAction(`stop:${info.address}`, () =>
                  stopAgent(info.role, info.name),
                )
              }
              onRestart={(info) =>
                runAction(`restart:${info.address}`, () =>
                  restartAgent(info.role, info.name),
                )
              }
              onArchive={(info) =>
                info.name && onArchive(info.role, info.name)
              }
            />
          ))}
        </div>
      </div>

      {selectedAgent && (
        // Terminal: fills remaining vertical space. min-h-0 is critical —
        // without it the flex-1 child can't shrink below its content's
        // intrinsic height and xterm ends up squished or overflowing.
        <div className="flex min-h-0 flex-1 flex-col border-t border-slate-700">
          <AgentPaneViewer
            role={selectedAgent.role}
            name={selectedAgent.name}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  )
}


// ───────────────────────── RoleRow ─────────────────────────


interface RoleRowProps {
  meta: RoleMeta
  instances: AgentInfo[]   // empty list if multi role with no spawns yet
  selected: string | null
  busy: Record<string, boolean>
  onSelect: (address: string) => void
  onSpawn: () => void
  onStart: (info: AgentInfo) => void
  onStop: (info: AgentInfo) => void
  onRestart: (info: AgentInfo) => void
  onArchive: (info: AgentInfo) => void
}

function RoleRow({
  meta,
  instances,
  selected,
  busy,
  onSelect,
  onSpawn,
  onStart,
  onStop,
  onRestart,
  onArchive,
}: RoleRowProps) {
  const isMulti = meta.cardinality === 'multi'
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[11px] font-semibold text-slate-300">
          {ROLE_LABELS[meta.role]}
        </span>
        <span className="text-[10px] text-slate-500">
          {ROLE_DESCRIPTIONS[meta.role]}
        </span>
        <span
          className={
            'ml-auto rounded px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wider ' +
            (isMulti
              ? 'bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/30'
              : 'bg-slate-800 text-slate-400 ring-1 ring-slate-700')
          }
        >
          {meta.cardinality}
          {isMulti ? ` · ${instances.length}` : ''}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {instances.map((a) => (
          <AgentCard
            key={a.address}
            info={a}
            selected={selected === a.address}
            busy={busy}
            onSelect={() => onSelect(a.address)}
            onStart={() => onStart(a)}
            onStop={() => onStop(a)}
            onRestart={() => onRestart(a)}
            onArchive={a.name ? () => onArchive(a) : undefined}
          />
        ))}
        {isMulti && (
          <button
            onClick={onSpawn}
            className="flex min-h-[80px] min-w-[120px] flex-1 basis-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-700 text-slate-500 transition hover:border-sky-500/50 hover:bg-sky-500/5 hover:text-sky-300"
            title={`spawn a new ${meta.role} instance`}
          >
            <span className="text-xl leading-none">+</span>
            <span className="mt-0.5 text-[10px] uppercase tracking-wider">
              spawn
            </span>
          </button>
        )}
      </div>
    </div>
  )
}


// ───────────────────────── AgentCard ─────────────────────────


interface CardProps {
  info: AgentInfo
  selected: boolean
  busy: Record<string, boolean>
  onSelect: () => void
  onStart: () => void
  onStop: () => void
  onRestart: () => void
  onArchive?: () => void   // only for multi-role instances
}

function AgentCard({
  info,
  selected,
  busy,
  onSelect,
  onStart,
  onStop,
  onRestart,
  onArchive,
}: CardProps) {
  const isUp = info.tmux_state === 'up'
  const isBusy =
    !!busy[`start:${info.address}`] ||
    !!busy[`stop:${info.address}`] ||
    !!busy[`restart:${info.address}`] ||
    !!busy[`archive:${info.address}`]
  return (
    <div
      onClick={onSelect}
      className={
        'min-w-[140px] flex-1 basis-[160px] cursor-pointer rounded-lg border p-2.5 transition shadow-card hover:shadow-card-hover ' +
        (selected
          ? 'border-sky-500/70 bg-slate-900 ring-2 ring-sky-500/30'
          : isUp
          ? 'border-emerald-900/50 bg-emerald-950/20 hover:border-emerald-700/60'
          : 'border-slate-700 bg-slate-900/40 hover:border-slate-700')
      }
    >
      <div className="flex items-center gap-2">
        <span
          className={
            'h-2 w-2 rounded-full ' +
            (isUp ? 'bg-emerald-400 animate-pulse-dot' : 'bg-slate-600')
          }
          title={info.tmux_state}
        />
        <span className="font-mono text-xs font-medium text-slate-100">
          {info.name ?? info.role}
        </span>
        <span
          className={
            'ml-auto rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ' +
            (isUp
              ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
              : 'bg-slate-800 text-slate-400 ring-1 ring-slate-700')
          }
        >
          {info.tmux_state}
        </span>
      </div>
      <div className="mt-2 flex gap-3 font-mono text-[10px] text-slate-500">
        <span title="inbox">
          <span className="text-slate-600">in</span>{' '}
          <span className="tabular-nums text-slate-300">
            {info.inbox_count}
          </span>
        </span>
        <span title="outbox">
          <span className="text-slate-600">out</span>{' '}
          <span className="tabular-nums text-slate-300">
            {info.outbox_count}
          </span>
        </span>
        {isUp && (
          <span title="pane lines">
            <span className="text-slate-600">ln</span>{' '}
            <span className="tabular-nums text-slate-300">
              {info.pane_lines}
            </span>
          </span>
        )}
      </div>
      <div
        className="mt-2 flex flex-wrap gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        {isUp ? (
          <>
            <button
              disabled={isBusy}
              onClick={onStop}
              className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300 transition hover:bg-slate-700 disabled:opacity-40"
            >
              stop
            </button>
            <button
              disabled={isBusy}
              onClick={onRestart}
              className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-amber-500/30 transition hover:bg-amber-500/30 disabled:opacity-40"
            >
              restart
            </button>
          </>
        ) : (
          <button
            disabled={isBusy}
            onClick={onStart}
            className="rounded bg-sky-600 px-2 py-0.5 text-[10px] font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
          >
            start
          </button>
        )}
        {onArchive && (
          <button
            disabled={isBusy}
            onClick={onArchive}
            className="ml-auto rounded bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-300 ring-1 ring-rose-500/30 transition hover:bg-rose-500/20 disabled:opacity-40"
            title="archive (stop + move to .archive/)"
          >
            archive
          </button>
        )}
      </div>
    </div>
  )
}
