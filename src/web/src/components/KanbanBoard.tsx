import type React from 'react'
import type { Frontmatter, Stage, Substage } from '../types'
import { STAGE_ACCENT, STATUS_STYLES, SUBSTAGE_META } from '../styles'

// Substages shown as sub-lanes inside the Run column. Order = forward flow.
const RUN_LANES: Substage[] = ['survey', 'setup', 'plan_review', 'iterate', 'wrap']

interface Props {
  cards: Frontmatter[]
  selectedId: string | null
  onSelect: (id: string) => void
  onIdeate?: () => void
}

export function KanbanBoard({ cards, selectedId, onSelect, onIdeate }: Props) {
  const byStage = groupByStage(cards)

  return (
    <div className="flex min-w-max gap-4 px-6 py-5">
      <PlainColumn
        stage="idea"
        label="Idea"
        cards={byStage.idea}
        selectedId={selectedId}
        onSelect={onSelect}
        headerExtra={
          onIdeate && (
            <button
              onClick={onIdeate}
              className="rounded border border-sky-600/40 bg-sky-600/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300 transition hover:border-sky-500 hover:bg-sky-600/20"
              title="Open ideation chat with research-worker"
            >
              🗣 Ideate
            </button>
          )
        }
      />
      <RunColumn
        cards={byStage.run}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <PlainColumn
        stage="write"
        label="Write"
        cards={byStage.write}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <PlainColumn
        stage="done"
        label="Done"
        cards={byStage.done}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </div>
  )
}

function groupByStage(cards: Frontmatter[]): Record<Stage, Frontmatter[]> {
  const out: Record<Stage, Frontmatter[]> = {
    idea: [],
    run: [],
    write: [],
    done: [],
  }
  for (const c of cards) {
    if (c.stage in out) out[c.stage].push(c)
  }
  return out
}

interface ColumnProps {
  cards: Frontmatter[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function PlainColumn({
  stage,
  label,
  cards,
  selectedId,
  onSelect,
  headerExtra,
}: ColumnProps & { stage: Stage; label: string; headerExtra?: React.ReactNode }) {
  const needsYou = cards.some(
    (c) => c.status === 'awaiting_user' || c.status === 'blocked',
  )
  return (
    <div className="flex w-80 flex-shrink-0 flex-col">
      <ColumnHeader
        label={label}
        accent={STAGE_ACCENT[stage]}
        count={cards.length}
        needsYou={needsYou}
        extra={headerExtra}
      />
      <div className="flex flex-col gap-2">
        {cards.length === 0 ? (
          <EmptyCell />
        ) : (
          cards.map((c) => (
            <Card
              key={c.id}
              card={c}
              selected={selectedId === c.id}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  )
}

function RunColumn({ cards, selectedId, onSelect }: ColumnProps) {
  const needsYou = cards.some(
    (c) => c.status === 'awaiting_user' || c.status === 'blocked',
  )
  const bySub: Record<string, Frontmatter[]> = {}
  for (const s of RUN_LANES) bySub[s] = []
  const orphans: Frontmatter[] = []
  for (const c of cards) {
    if (c.substage && RUN_LANES.includes(c.substage as Substage)) {
      bySub[c.substage].push(c)
    } else {
      orphans.push(c)
    }
  }

  return (
    <div className="flex w-80 flex-shrink-0 flex-col">
      <ColumnHeader
        label="Run"
        accent={STAGE_ACCENT.run}
        count={cards.length}
        needsYou={needsYou}
      />
      <div className="flex flex-col gap-3">
        {RUN_LANES.map((sub) => {
          const laneCards = bySub[sub]
          const meta = SUBSTAGE_META[sub]
          const laneNeedsYou = laneCards.some(
            (c) => c.status === 'awaiting_user' || c.status === 'blocked',
          )
          return (
            <div
              key={sub}
              className={
                'rounded-lg border px-2 pb-2 pt-1.5 ' +
                (meta.isGate
                  ? 'border-amber-500/25 bg-amber-500/[0.04]'
                  : 'border-slate-800/80 bg-slate-900/30')
              }
            >
              <div className="mb-1.5 flex items-center gap-2 px-1">
                <span
                  className={
                    'h-1 w-1 rounded-full ' +
                    (meta.isGate ? 'bg-amber-400' : 'bg-slate-600')
                  }
                />
                <span
                  className={
                    'text-[10px] font-semibold uppercase tracking-[0.12em] ' +
                    (meta.isGate ? 'text-amber-300' : 'text-slate-500')
                  }
                >
                  {meta.label}
                </span>
                {meta.isGate && (
                  <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-amber-300 ring-1 ring-amber-500/30">
                    gate
                  </span>
                )}
                {laneNeedsYou && (
                  <span className="text-[10px]" title="사용자 액션 대기">
                    ✋
                  </span>
                )}
                <span
                  className={
                    'ml-auto text-[10px] tabular-nums ' +
                    (laneCards.length > 0 ? 'text-slate-400' : 'text-slate-600')
                  }
                >
                  {laneCards.length}
                </span>
              </div>
              {laneCards.length === 0 ? (
                <div className="rounded border border-dashed border-slate-800/60 py-2 text-center text-[10px] text-slate-700">
                  —
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {laneCards.map((c) => (
                    <Card
                      key={c.id}
                      card={c}
                      selected={selectedId === c.id}
                      onSelect={onSelect}
                      compact
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {orphans.length > 0 && (
          <div className="rounded-lg border border-rose-800/50 bg-rose-950/20 px-2 pb-2 pt-1.5">
            <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-300">
              invalid substage
            </div>
            <div className="flex flex-col gap-1.5">
              {orphans.map((c) => (
                <Card
                  key={c.id}
                  card={c}
                  selected={selectedId === c.id}
                  onSelect={onSelect}
                  compact
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ColumnHeader({
  label,
  accent,
  count,
  needsYou,
  extra,
}: {
  label: string
  accent: string
  count: number
  needsYou: boolean
  extra?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-center gap-2 px-1">
      <h2
        className={
          'text-[11px] font-semibold uppercase tracking-[0.14em] ' + accent
        }
      >
        {label}
      </h2>
      {needsYou && (
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300 ring-1 ring-amber-500/30">
          ✋ needs you
        </span>
      )}
      {extra}
      <span
        className={
          'ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums ' +
          (count > 0 ? 'bg-slate-800 text-slate-300' : 'text-slate-600')
        }
      >
        {count}
      </span>
    </div>
  )
}

function EmptyCell() {
  return (
    <div className="rounded-lg border border-dashed border-slate-800 py-6 text-center text-[11px] text-slate-600">
      empty
    </div>
  )
}

function Card({
  card,
  selected,
  onSelect,
  compact = false,
}: {
  card: Frontmatter
  selected: boolean
  onSelect: (id: string) => void
  compact?: boolean
}) {
  const statusStyle = STATUS_STYLES[card.status]
  const sub = card.substage ? SUBSTAGE_META[card.substage] : null
  return (
    <button
      onClick={() => onSelect(card.id)}
      className={
        'group relative rounded-lg border bg-slate-900/60 text-left shadow-card transition-all hover:-translate-y-px hover:bg-slate-900 hover:shadow-card-hover ' +
        (compact ? 'p-2' : 'p-3') +
        ' ' +
        (selected
          ? 'border-sky-500/70 ring-2 ring-sky-500/30'
          : 'border-slate-800')
      }
    >
      {sub?.isGate && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-amber-400/80" />
      )}
      <div className="flex items-center gap-2">
        <span className={'h-1.5 w-1.5 rounded-full ' + statusStyle.dot} />
        <span className="font-mono text-[10px] text-slate-500">{card.id}</span>
        {card.target_venue && (
          <span className="ml-auto rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
            {card.target_venue}
          </span>
        )}
      </div>
      <div
        className={
          'mt-1.5 font-medium leading-snug text-slate-100 ' +
          (compact ? 'text-[12px]' : 'text-[13px]')
        }
      >
        {card.title}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className={
            'rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ' +
            statusStyle.chip
          }
        >
          {statusStyle.label}
        </span>
        <span className="text-[10px] text-slate-500">
          {card.assignee === 'user'
            ? '← user'
            : card.assignee === 'ai'
            ? '→ ai'
            : '–'}
        </span>
      </div>
      {!compact && card.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.tags.slice(0, 4).map((t) => (
            <span
              key={t}
              className="rounded bg-slate-800/60 px-1.5 py-0.5 text-[9px] text-slate-400"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}
