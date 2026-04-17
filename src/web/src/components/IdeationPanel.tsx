import { useEffect, useState } from 'react'
import { AgentPaneViewer } from './AgentPaneViewer'
import { fetchAgents, fetchDoc, sendAgentInput } from '../api'

interface Props {
  onClose: () => void
}

const IDEATION_ROLE = 'research-worker' as const

/**
 * Right-pane ideation chat. On mount, nudges the research-worker into
 * @ideation-mode (per agents/research-worker/identity.md). The middle slot
 * reuses AgentPaneViewer so user <-> worker conversation happens in the
 * actual tmux pane.
 *
 * Crystallize sends `@crystallize slug=<slug>` — the worker writes
 * projects/<slug>/card.md and the Kanban auto-updates via SSE card_added.
 */
export function IdeationPanel({ onClose }: Props) {
  const [directionSummary, setDirectionSummary] = useState<string>('')
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [crystallizing, setCrystallizing] = useState(false)
  const [lastCrystallized, setLastCrystallized] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [signaled, setSignaled] = useState(false)
  // research-worker is multi-cardinality — we must target a specific instance.
  // Resolved on mount from /api/agents; if none are up, the panel renders a
  // hint telling the user to spawn one from the Agents tab.
  const [instanceName, setInstanceName] = useState<string | null>(null)
  const [instanceResolved, setInstanceResolved] = useState(false)

  // Load direction summary for the header.
  useEffect(() => {
    fetchDoc('research-direction')
      .then((d) => {
        const themes = extractSection(d.content, 'Research themes')
        const hooks = extractSection(d.content, 'Open hooks')
        setDirectionSummary(
          [themes && `themes:\n${themes}`, hooks && `hooks:\n${hooks}`]
            .filter(Boolean)
            .join('\n\n') || '(direction doc 비어있음)',
        )
      })
      .catch((e) => setError(String(e)))
  }, [])

  // Resolve which research-worker instance to attach to.
  useEffect(() => {
    let cancelled = false
    fetchAgents()
      .then((resp) => {
        if (cancelled) return
        const candidates = resp.agents.filter(
          (a) => a.role === IDEATION_ROLE && a.tmux_state === 'up' && a.name,
        )
        setInstanceName(candidates[0]?.name ?? null)
        setInstanceResolved(true)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(`failed to list agents: ${e}`)
          setInstanceResolved(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Nudge the chosen research-worker instance into @ideation-mode on mount.
  useEffect(() => {
    if (!instanceResolved || !instanceName) return
    let cancelled = false
    sendAgentInput(
      IDEATION_ROLE,
      '@ideation-mode start — 사용자와 직접 대화 시작. docs/research-direction.md + projects/*/card.md(stage=idea) 로드 후 한 줄 "ideation-mode ready" 출력 후 대화 대기.',
      instanceName,
    )
      .then(() => {
        if (!cancelled) setSignaled(true)
      })
      .catch((e) => {
        if (!cancelled) setError(`ideation-mode signal failed: ${e}`)
      })
    return () => {
      cancelled = true
      // Best-effort: leave ideation mode on unmount. Ignore errors.
      sendAgentInput(IDEATION_ROLE, '@ideation-mode end', instanceName).catch(() => {})
    }
  }, [instanceResolved, instanceName])

  const crystallize = async () => {
    if (!instanceName) {
      setError('no research-worker instance attached')
      return
    }
    const slug = window.prompt(
      'Crystallize into new card. Enter slug (lowercase letters/digits/-/_, 1~64 chars):',
    )
    if (!slug) return
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) {
      setError(`invalid slug: "${slug}". 규칙: 소문자 영숫자 + -/_, 첫글자 영숫자, 1~64자`)
      return
    }
    setCrystallizing(true)
    setError(null)
    try {
      await sendAgentInput(
        IDEATION_ROLE,
        `@crystallize slug=${slug} — 지금까지의 대화를 정리해 projects/${slug}/card.md 생성. frontmatter: stage=idea, substage=draft, status=running, assignee=ai. 완료 후 "crystallized: projects/${slug}/card.md" 한 줄 출력.`,
        instanceName,
      )
      setLastCrystallized(slug)
    } catch (e) {
      setError(String(e))
    } finally {
      setCrystallizing(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-slate-100">
            Ideation chat
          </h2>
          <p className="text-[11px] text-slate-500">
            {!instanceResolved
              ? 'resolving research-worker instance…'
              : instanceName
              ? `agent-research-worker/${instanceName} · ${
                  signaled ? 'in ideation mode' : 'connecting…'
                }`
              : 'no research-worker instance up'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
          title="End ideation (sends @ideation-mode end)"
        >
          ✕
        </button>
      </div>

      {/* Direction summary (collapsible) */}
      <div className="border-b border-slate-800/60 bg-slate-900/40">
        <button
          onClick={() => setSummaryExpanded((v) => !v)}
          className="flex w-full items-center gap-2 px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 transition hover:text-slate-300"
        >
          <span>{summaryExpanded ? '▾' : '▸'}</span>
          <span>Direction summary</span>
        </button>
        {summaryExpanded && (
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words px-5 pb-3 font-mono text-[11px] leading-relaxed text-slate-400">
            {directionSummary || 'loading…'}
          </pre>
        )}
      </div>

      {error && (
        <div className="border-b border-rose-900/60 bg-rose-950/40 px-5 py-2 text-[11px] text-rose-300">
          {error}
        </div>
      )}

      {/* Pane: reuse the terminal component attached to the chosen instance */}
      <div className="flex-1 overflow-hidden">
        {instanceName ? (
          <AgentPaneViewer
            role={IDEATION_ROLE}
            name={instanceName}
            onClose={onClose}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[11px] text-slate-400">
            <p className="text-slate-300">
              research-worker instance가 없습니다.
            </p>
            <p>
              <span className="text-slate-500">Agents</span> 탭에서 research-worker instance를
              하나 spawn 한 후 <span className="text-slate-500">Ideate</span> 탭을 다시 열어주세요.
            </p>
          </div>
        )}
      </div>

      {/* Crystallize action bar */}
      <div className="border-t border-slate-800 bg-slate-900/40 px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500">
            대화가 무르익으면 아래 버튼으로 카드 생성.
            {lastCrystallized && (
              <span className="ml-2 text-emerald-400">
                last: {lastCrystallized}
              </span>
            )}
          </div>
          <button
            onClick={crystallize}
            disabled={crystallizing || !instanceName}
            className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
          >
            {crystallizing ? 'sending…' : '✦ Crystallize to card'}
          </button>
        </div>
      </div>
    </div>
  )
}

function extractSection(md: string, header: string): string {
  const re = new RegExp(`^##\\s+${escapeRegExp(header)}\\s*$`, 'm')
  const m = md.match(re)
  if (!m || m.index === undefined) return ''
  const start = m.index + m[0].length
  const rest = md.slice(start)
  const next = rest.search(/^##\s+/m)
  const body = next === -1 ? rest : rest.slice(0, next)
  return body.trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
