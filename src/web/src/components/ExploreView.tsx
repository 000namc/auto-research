import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DirectionFrontmatter,
  DirectionFull,
  FindingFrontmatter,
  FindingKind,
} from '../types'
import {
  fetchDirection,
  fetchDirections,
  fetchFinding,
  postDirectionCommand,
} from '../api'
import { DirectionCreateModal } from './DirectionCreateModal'

interface Props {
  /** SSE tick — bumped on any direction or finding event. Triggers reload. */
  directionTick: number
  /** Called when a promoted card should be opened in the Research Kanban. */
  onCardCreated: (slug: string) => void
}

/**
 * Explore Kanban main view. Two-pane layout:
 *   ┌─────────────────────────┬──────────────────────────────────────┐
 *   │ DirectionList (master)  │ DirectionDetail (selected's stream)  │
 *   └─────────────────────────┴──────────────────────────────────────┘
 * See docs/explore-schema.md. Right-side dock (Agents/Ideate/Card/Context)
 * is hidden in this view — ExploreView fills the main area entirely.
 */
export function ExploreView({ directionTick, onCardCreated }: Props) {
  const [directions, setDirections] = useState<DirectionFrontmatter[]>([])
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [detail, setDetail] = useState<DirectionFull | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const reloadList = useCallback(async () => {
    try {
      const list = await fetchDirections()
      setDirections(list)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const reloadDetail = useCallback(async () => {
    if (!selectedSlug) {
      setDetail(null)
      return
    }
    try {
      const d = await fetchDirection(selectedSlug)
      setDetail(d)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [selectedSlug])

  useEffect(() => {
    void reloadList()
  }, [reloadList, directionTick])

  useEffect(() => {
    void reloadDetail()
  }, [reloadDetail, directionTick])

  // If the selected direction disappears, clear selection.
  useEffect(() => {
    if (selectedSlug && !directions.find((d) => d.id === selectedSlug)) {
      setSelectedSlug(null)
    }
  }, [directions, selectedSlug])

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden">
      {/* Left: master list */}
      <aside className="flex w-[340px] flex-shrink-0 flex-col border-r border-slate-800 bg-slate-900/40">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">
              Directions
            </h2>
            <p className="text-[10px] text-slate-500">
              자유탐색 방향 · orchestrator 가 findings 수집
            </p>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-violet-500"
            title="New direction"
          >
            + New
          </button>
        </div>
        {error && (
          <div className="border-b border-rose-900/60 bg-rose-950/40 px-4 py-1.5 text-[10px] text-rose-300">
            {error}
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          <DirectionList
            directions={directions}
            selectedSlug={selectedSlug}
            onSelect={setSelectedSlug}
          />
        </div>
      </aside>

      {/* Right: detail */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selectedSlug && detail ? (
          <DirectionDetail
            direction={detail}
            onCommand={async (verb, args) => {
              try {
                const resp = await postDirectionCommand(selectedSlug, {
                  author: 'user',
                  verb,
                  args,
                })
                if (resp.promotion?.card_id) {
                  onCardCreated(resp.promotion.card_id)
                }
                await reloadDetail()
                await reloadList()
              } catch (e) {
                setError(String(e))
              }
            }}
          />
        ) : (
          <EmptyDetail onCreate={() => setCreateOpen(true)} />
        )}
      </section>

      {createOpen && (
        <DirectionCreateModal
          onCreated={async (slug) => {
            setCreateOpen(false)
            await reloadList()
            setSelectedSlug(slug)
          }}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </div>
  )
}

// ───────────────────────── DirectionList ─────────────────────────

const KIND_BADGE: Record<DirectionFrontmatter['kind'], { label: string; tone: string }> = {
  venues: { label: 'venues', tone: 'bg-sky-500/15 text-sky-300 ring-sky-500/30' },
  venue_archive: { label: 'archive', tone: 'bg-teal-500/15 text-teal-300 ring-teal-500/30' },
  tracking: { label: 'tracking', tone: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  topic: { label: 'topic', tone: 'bg-violet-500/15 text-violet-300 ring-violet-500/30' },
  freeform: { label: 'freeform', tone: 'bg-slate-600/30 text-slate-300 ring-slate-500/30' },
}

const STATUS_DOT: Record<DirectionFrontmatter['status'], string> = {
  running: 'bg-emerald-400 animate-pulse-dot',
  paused: 'bg-amber-400',
  done: 'bg-slate-500',
  error: 'bg-rose-500',
}

function DirectionList({
  directions,
  selectedSlug,
  onSelect,
}: {
  directions: DirectionFrontmatter[]
  selectedSlug: string | null
  onSelect: (slug: string) => void
}) {
  if (directions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[11px] text-slate-600">
        아직 direction 이 없습니다.
        <br />
        우상단 <span className="text-slate-400">+ New</span> 버튼으로 시작하세요.
      </div>
    )
  }
  return (
    <ul className="flex flex-col">
      {directions.map((d) => {
        const active = d.id === selectedSlug
        const badge = KIND_BADGE[d.kind]
        return (
          <li key={d.id}>
            <button
              onClick={() => onSelect(d.id)}
              className={
                'group flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition ' +
                (active
                  ? 'border-violet-400 bg-slate-800/60'
                  : 'border-transparent hover:bg-slate-800/40')
              }
            >
              <div className="flex items-center gap-2">
                <span className={'h-1.5 w-1.5 rounded-full ' + STATUS_DOT[d.status]} />
                <span className="font-mono text-[10px] text-slate-500">{d.id}</span>
                <span
                  className={
                    'ml-auto rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ring-1 ' +
                    badge.tone
                  }
                >
                  {badge.label}
                </span>
              </div>
              <div className="text-[12px] font-medium leading-snug text-slate-100">
                {d.title}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                <span>cadence: {d.cadence}</span>
                <span>·</span>
                <span>findings: {d.finding_count}</span>
                {d.status !== 'running' && (
                  <>
                    <span>·</span>
                    <span className="font-mono uppercase text-slate-400">{d.status}</span>
                  </>
                )}
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ───────────────────────── EmptyDetail ─────────────────────────

function EmptyDetail({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
        Autonomous explore
      </div>
      <div className="max-w-md text-sm text-slate-400">
        direction 을 하나 만들고 seed 만 주면 orchestrator 가 주기적으로
        관련 논문·venue·아이디어를 findings 로 쌓습니다. 맘에 드는 finding 은
        Research Kanban 으로 승격할 수 있습니다.
      </div>
      <button
        onClick={onCreate}
        className="rounded bg-violet-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-violet-500"
      >
        + Create first direction
      </button>
    </div>
  )
}

// ───────────────────────── DirectionDetail ─────────────────────────

function DirectionDetail({
  direction,
  onCommand,
}: {
  direction: DirectionFull
  onCommand: (verb: import('../types').DirectionVerb, args?: string) => Promise<void>
}) {
  const fm = direction.frontmatter
  const [refocusOpen, setRefocusOpen] = useState(false)
  const [refocusText, setRefocusText] = useState('')
  const [activityExpanded, setActivityExpanded] = useState(false)
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null)

  // When a finding is selected, open its body below. Close on direction change.
  useEffect(() => {
    setSelectedFindingId(null)
  }, [direction.frontmatter.id])

  const findings = direction.findings
  const activeFindings = useMemo(
    () => findings.filter((f) => f.interest !== 'archived'),
    [findings],
  )
  const archivedCount = findings.length - activeFindings.length

  const canRunNow = fm.status === 'running'
  const canPause = fm.status === 'running'
  const canResume = fm.status === 'paused'
  const canArchive = fm.status !== 'done'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={'h-1.5 w-1.5 rounded-full ' + STATUS_DOT[fm.status]} />
              <span className="font-mono text-[10px] text-slate-500">{fm.id}</span>
              <KindBadge kind={fm.kind} />
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-mono uppercase text-slate-400">
                cadence: {fm.cadence}
              </span>
              {fm.next_run && (
                <span className="text-[10px] text-slate-500" title="next_run">
                  next: {fmtRelativeOrShort(fm.next_run)}
                </span>
              )}
            </div>
            <h1 className="mt-1.5 text-base font-semibold text-slate-100">{fm.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <ActionButton
              label="Run now"
              onClick={() => onCommand('run_now')}
              disabled={!canRunNow}
              title="cadence 무시하고 즉시 cycle 실행 (orchestrator 가 대기 중이어야 반영)"
            />
            <ActionButton
              label="Refocus"
              onClick={() => setRefocusOpen((v) => !v)}
              tone="violet"
              disabled={fm.status === 'done'}
            />
            {canPause && (
              <ActionButton label="Pause" onClick={() => onCommand('pause')} tone="amber" />
            )}
            {canResume && (
              <ActionButton label="Resume" onClick={() => onCommand('resume')} tone="emerald" />
            )}
            <ActionButton
              label="Archive"
              onClick={() => onCommand('archive')}
              tone="slate"
              disabled={!canArchive}
            />
          </div>
        </div>
        {refocusOpen && (
          <div className="mt-3 rounded border border-violet-600/30 bg-violet-950/20 p-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-violet-300">
              Refocus hint
            </label>
            <textarea
              value={refocusText}
              onChange={(e) => setRefocusText(e.target.value)}
              rows={3}
              placeholder="새 방향성 / 제외할 것 / 더 파고 싶은 지점 등"
              className="mt-1 w-full resize-y rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-100 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => {
                  setRefocusOpen(false)
                  setRefocusText('')
                }}
                className="rounded px-2.5 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const hint = refocusText.trim()
                  if (!hint) return
                  await onCommand('refocus', hint)
                  setRefocusText('')
                  setRefocusOpen(false)
                }}
                disabled={!refocusText.trim()}
                className="rounded bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
              >
                Submit refocus
              </button>
            </div>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Seed */}
        <section className="border-b border-slate-800 px-6 py-4">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Seed
          </h3>
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-300">
            {direction.sections.Seed || '(empty)'}
          </pre>
        </section>

        {/* Findings */}
        <section className="px-6 py-4">
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Findings
            </h3>
            <span className="text-[10px] tabular-nums text-slate-500">
              {activeFindings.length} active
              {archivedCount > 0 && ` · ${archivedCount} archived`}
            </span>
          </div>
          {findings.length === 0 ? (
            <div className="rounded border border-dashed border-slate-800 py-6 text-center text-[11px] text-slate-600">
              아직 finding 없음. orchestrator 가 cycle 돌리면 여기에 쌓입니다.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {findings.map((f) => (
                <li key={f.id}>
                  <FindingRow
                    finding={f}
                    slug={direction.frontmatter.id}
                    selected={selectedFindingId === f.id}
                    onToggle={() =>
                      setSelectedFindingId(selectedFindingId === f.id ? null : f.id)
                    }
                    onCommand={onCommand}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Activity log (collapsible) */}
        <section className="border-t border-slate-800 bg-slate-950/50 px-6 py-3">
          <button
            onClick={() => setActivityExpanded((v) => !v)}
            className="flex w-full items-center gap-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 transition hover:text-slate-300"
          >
            <span>{activityExpanded ? '▾' : '▸'}</span>
            <span>Activity log ({direction.events.length})</span>
          </button>
          {activityExpanded && (
            <ul className="mt-2 flex flex-col gap-1 font-mono text-[10px] text-slate-400">
              {[...direction.events].reverse().map((e, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="text-slate-600">{e.timestamp}</span>
                  <span className="rounded bg-slate-800/60 px-1.5 py-0.5 text-[9px] uppercase text-slate-400">
                    {e.type}
                  </span>
                  <span className="truncate text-slate-300">{e.description}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

// ───────────────────────── FindingRow ─────────────────────────

const FINDING_KIND_TONE: Record<FindingKind, string> = {
  paper: 'bg-sky-500/10 text-sky-300 ring-sky-500/25',
  venue: 'bg-teal-500/10 text-teal-300 ring-teal-500/25',
  idea: 'bg-violet-500/10 text-violet-300 ring-violet-500/25',
  tracking: 'bg-amber-500/10 text-amber-300 ring-amber-500/25',
  synthesis: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
}

function FindingRow({
  finding,
  slug,
  selected,
  onToggle,
  onCommand,
}: {
  finding: FindingFrontmatter
  slug: string
  selected: boolean
  onToggle: () => void
  onCommand: (verb: import('../types').DirectionVerb, args?: string) => Promise<void>
}) {
  const [body, setBody] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selected || body !== null) return
    setLoading(true)
    fetchFinding(slug, finding.id)
      .then((f) => setBody(f.body))
      .catch((e) => setBody(`(failed to load: ${e})`))
      .finally(() => setLoading(false))
  }, [selected, body, slug, finding.id])

  const promote = async () => {
    const suggested = finding.id.replace(/^f\d{3}-/, '')
    const target = window.prompt(
      `finding ${finding.id} 을 Research Kanban 으로 승격합니다.\n` +
        '새 card slug 입력 (lowercase + -/_, 1~64자):',
      suggested,
    )
    if (!target) return
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(target)) {
      window.alert(`invalid slug: "${target}"`)
      return
    }
    await onCommand('promote', `${finding.id} as ${target}`)
  }

  const archived = finding.interest === 'archived'
  const promoted = finding.interest === 'promoted'

  return (
    <div
      className={
        'rounded-lg border bg-slate-900/60 transition ' +
        (archived
          ? 'border-slate-800/60 opacity-50'
          : promoted
          ? 'border-emerald-600/40'
          : 'border-slate-800 hover:border-slate-700')
      }
    >
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={
                'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ring-1 ' +
                FINDING_KIND_TONE[finding.kind]
              }
            >
              {finding.kind}
            </span>
            <span className="font-mono text-[10px] text-slate-500">{finding.id}</span>
            {promoted && finding.promoted_to && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] uppercase text-emerald-300 ring-1 ring-emerald-500/30">
                → {finding.promoted_to}
              </span>
            )}
            {archived && (
              <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[9px] uppercase text-slate-400">
                archived
              </span>
            )}
          </div>
          <div className="mt-1 text-[12px] font-medium text-slate-100">{finding.title}</div>
          {finding.source && (
            <a
              href={finding.source}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 block truncate text-[10px] text-sky-400 hover:underline"
            >
              {finding.source}
            </a>
          )}
        </div>
        <span className="pt-1 text-[10px] text-slate-500">{selected ? '▾' : '▸'}</span>
      </button>
      {selected && (
        <div className="border-t border-slate-800 bg-slate-950/40 px-3 py-3">
          {loading ? (
            <div className="text-[11px] text-slate-500">loading…</div>
          ) : (
            <pre className="mb-3 max-h-80 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-300">
              {body || '(empty)'}
            </pre>
          )}
          <div className="flex flex-wrap items-center justify-end gap-1">
            {!promoted && !archived && (
              <>
                <button
                  onClick={() => onCommand('drop', finding.id)}
                  className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-400 hover:border-slate-500 hover:bg-slate-800 hover:text-slate-200"
                >
                  Archive
                </button>
                <button
                  onClick={promote}
                  className="rounded bg-emerald-600 px-2.5 py-1 text-[10px] font-medium text-white transition hover:bg-emerald-500"
                >
                  → Research
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ───────────────────────── small helpers ─────────────────────────

function KindBadge({ kind }: { kind: DirectionFrontmatter['kind'] }) {
  const b = KIND_BADGE[kind]
  return (
    <span
      className={
        'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ring-1 ' + b.tone
      }
    >
      {b.label}
    </span>
  )
}

function ActionButton({
  label,
  onClick,
  disabled,
  tone = 'sky',
  title,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'sky' | 'violet' | 'amber' | 'emerald' | 'slate'
  title?: string
}) {
  const tones: Record<string, string> = {
    sky: 'border-sky-600/40 text-sky-300 hover:border-sky-500 hover:bg-sky-600/10',
    violet:
      'border-violet-600/40 text-violet-300 hover:border-violet-500 hover:bg-violet-600/10',
    amber: 'border-amber-600/40 text-amber-300 hover:border-amber-500 hover:bg-amber-600/10',
    emerald:
      'border-emerald-600/40 text-emerald-300 hover:border-emerald-500 hover:bg-emerald-600/10',
    slate: 'border-slate-700 text-slate-300 hover:border-slate-500 hover:bg-slate-800/60',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        'rounded border bg-transparent px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-40 ' +
        tones[tone]
      }
    >
      {label}
    </button>
  )
}

function fmtRelativeOrShort(iso: string): string {
  try {
    const t = new Date(iso).getTime()
    const delta = t - Date.now()
    const absMin = Math.abs(delta) / 60000
    if (absMin < 60) return delta < 0 ? `${Math.round(absMin)}m ago` : `in ${Math.round(absMin)}m`
    const absHr = absMin / 60
    if (absHr < 48) return delta < 0 ? `${Math.round(absHr)}h ago` : `in ${Math.round(absHr)}h`
    return iso.slice(5, 16).replace('T', ' ')
  } catch {
    return iso
  }
}
