import { useCallback, useEffect, useState } from 'react'
import type { Frontmatter } from './types'
import { fetchCards } from './api'
import { useSSE } from './useSSE'
import { KanbanBoard } from './components/KanbanBoard'
import { CardDetail } from './components/CardDetail'
import { AgentPanel } from './components/AgentPanel'
import { DocsView } from './components/DocsView'
import { IdeationPanel } from './components/IdeationPanel'
import { ExploreView } from './components/ExploreView'

type RightTab = 'card' | 'agents' | 'ideate' | 'context'
type MainView = 'research' | 'explore'

const RIGHT_TABS: Array<{ id: RightTab; label: string; title: string }> = [
  { id: 'agents', label: 'Agents', title: 'tmux 세션 + pane viewer' },
  { id: 'ideate', label: 'Ideate', title: 'research-worker 와 대화하며 idea 탐색' },
  { id: 'card', label: 'Card', title: 'kanban card 목록 / 선택한 card 의 상세' },
  { id: 'context', label: 'Context', title: 'docs/*.md — 맥락 문서 목록 · 편집' },
]

export function App() {
  const [cards, setCards] = useState<Frontmatter[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [liveTick, setLiveTick] = useState(0)
  const [sseConnected, setSseConnected] = useState(false)
  const [docsTick, setDocsTick] = useState(0)
  const [rightTab, setRightTab] = useState<RightTab>('agents')
  const [mainView, setMainView] = useState<MainView>('research')
  const [directionTick, setDirectionTick] = useState(0)

  const reload = useCallback(() => {
    fetchCards()
      .then((c) => {
        setCards(c)
        setError(null)
      })
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  useSSE(
    useCallback(
      (event, _data) => {
        if (event === 'hello') {
          setSseConnected(true)
          return
        }
        if (event === 'card_added' || event === 'card_changed' || event === 'card_removed') {
          setLiveTick((t) => t + 1)
          reload()
        } else if (
          event === 'direction_added' ||
          event === 'direction_changed' ||
          event === 'direction_removed' ||
          event === 'finding_added' ||
          event === 'finding_changed' ||
          event === 'finding_removed'
        ) {
          setDirectionTick((t) => t + 1)
        } else if (
          event === 'agent_added' ||
          event === 'agent_removed' ||
          event === 'agent_state_changed' ||
          event === 'agent_pane_changed'
        ) {
          setLiveTick((t) => t + 1)
        } else if (
          event === 'docs_added' ||
          event === 'docs_changed' ||
          event === 'docs_removed'
        ) {
          setDocsTick((t) => t + 1)
        }
      },
      [reload],
    ),
  )

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold tracking-tight text-slate-100">
            auto-research
          </h1>
          <div className="flex items-center rounded-md border border-slate-800 bg-slate-950 p-0.5">
            <button
              onClick={() => setMainView('research')}
              className={
                'rounded px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition ' +
                (mainView === 'research'
                  ? 'bg-slate-800 text-sky-300 shadow-inner'
                  : 'text-slate-500 hover:text-slate-300')
              }
              title="Research Kanban — idea · run · write · done"
            >
              Research
            </button>
            <button
              onClick={() => setMainView('explore')}
              className={
                'rounded px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition ' +
                (mainView === 'explore'
                  ? 'bg-slate-800 text-violet-300 shadow-inner'
                  : 'text-slate-500 hover:text-slate-300')
              }
              title="Explore — 자유탐색 direction + findings"
            >
              Explore
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          {mainView === 'research' ? (
            <span className="tabular-nums">
              <span className="text-slate-200 font-medium">{cards.length}</span> cards
            </span>
          ) : (
            <span className="tabular-nums">
              <span className="text-slate-200 font-medium">{directionTick}</span> events
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span
              className={
                'h-1.5 w-1.5 rounded-full ' +
                (sseConnected ? 'bg-emerald-400 animate-pulse-dot' : 'bg-slate-600')
              }
            />
            <span className="tabular-nums">
              {sseConnected ? 'live' : 'offline'} · {liveTick}
            </span>
          </span>
        </div>
      </header>

      {error && (
        <div className="border-b border-rose-900/60 bg-rose-950/40 px-6 py-2 text-sm text-rose-300">
          {error}
        </div>
      )}
      <main className="flex flex-1 overflow-hidden">
        {mainView === 'research' ? (
          <>
            {/* Left 2/3: Kanban (full width of section). Card detail moved to the
                right dock as a tab to avoid stealing kanban real-estate. */}
            <section className="flex min-w-0 flex-[2] overflow-hidden">
              <div className="flex-1 overflow-x-auto overflow-y-auto">
                <KanbanBoard
                  cards={cards}
                  onSelect={(id) => {
                    setSelectedId(id)
                    if (id) setRightTab('card')
                  }}
                  selectedId={selectedId}
                  onIdeate={() => setRightTab('ideate')}
                />
              </div>
            </section>
            {/* Right 1/3: tabbed dock — Card / Agents / Ideate / Context */}
            <aside className="flex min-w-[360px] flex-1 flex-col overflow-hidden border-l border-slate-700 bg-slate-900/50">
              <nav className="flex border-b border-slate-700 bg-slate-900">
                {RIGHT_TABS.map((tab) => {
                  const active = rightTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      title={tab.title}
                      onClick={() => setRightTab(tab.id)}
                      className={
                        'flex-1 border-b-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition ' +
                        (active
                          ? 'border-sky-500 text-slate-100'
                          : 'border-transparent text-slate-500 hover:text-slate-300')
                      }
                    >
                      {tab.label}
                    </button>
                  )
                })}
              </nav>
              <div className="flex flex-1 flex-col overflow-hidden">
                {rightTab === 'card' && selectedId && (
                  <CardDetail
                    id={selectedId}
                    liveTick={liveTick}
                    onClose={() => setSelectedId(null)}
                    onChange={reload}
                  />
                )}
                {rightTab === 'card' && !selectedId && (
                  <CardList cards={cards} onSelect={setSelectedId} />
                )}
                {rightTab === 'agents' && <AgentPanel liveTick={liveTick} />}
                {rightTab === 'ideate' && (
                  <IdeationPanel onClose={() => setRightTab('agents')} />
                )}
                {rightTab === 'context' && <DocsView liveTick={docsTick} />}
              </div>
            </aside>
          </>
        ) : (
          <ExploreView
            directionTick={directionTick}
            onCardCreated={(slug) => {
              // When a finding is promoted, bring the user back to Research to see the new card.
              setMainView('research')
              setSelectedId(slug)
              setRightTab('card')
              reload()
            }}
          />
        )}
      </main>
    </div>
  )
}


// ───────────────────────── CardList ─────────────────────────

/** Stage order for the Card-tab default listing, matching the Kanban columns. */
const STAGE_ORDER: Array<{ stage: Frontmatter['stage']; label: string }> = [
  { stage: 'idea', label: 'IDEA' },
  { stage: 'run', label: 'RUN' },
  { stage: 'write', label: 'WRITE' },
  { stage: 'done', label: 'DONE' },
]

function CardList({
  cards,
  onSelect,
}: {
  cards: Frontmatter[]
  onSelect: (id: string) => void
}) {
  const byStage = new Map<Frontmatter['stage'], Frontmatter[]>()
  for (const c of cards) {
    const arr = byStage.get(c.stage) ?? []
    arr.push(c)
    byStage.set(c.stage, arr)
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      <div className="mb-3 text-[11px] text-slate-500">
        card 제목을 클릭하면 상세가 여기 열립니다.
      </div>
      <div className="flex flex-col gap-4">
        {STAGE_ORDER.map(({ stage, label }) => {
          const list = byStage.get(stage) ?? []
          return (
            <div key={stage}>
              <div className="mb-1.5 flex items-baseline justify-between border-b border-slate-700 pb-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">
                  {label}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-slate-500">
                  {list.length}
                </span>
              </div>
              {list.length === 0 ? (
                <div className="px-1 py-1 text-[11px] text-slate-600">—</div>
              ) : (
                <ul className="flex flex-col">
                  {list.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => onSelect(c.id)}
                        className="group flex w-full items-baseline gap-2 rounded px-2 py-1 text-left transition hover:bg-slate-800/60"
                      >
                        <span className="font-mono text-[10px] text-slate-500 group-hover:text-slate-400">
                          {c.id}
                        </span>
                        <span className="flex-1 truncate text-xs text-slate-200 group-hover:text-white">
                          {c.title}
                        </span>
                        {c.status && (
                          <span className="shrink-0 font-mono text-[9px] uppercase text-slate-500">
                            {c.status}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
