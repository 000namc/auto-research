import { useCallback, useEffect, useState } from 'react'
import { fetchCard, postCommand } from '../api'
import type { CardFull, Verb } from '../types'
import { STATUS_STYLES } from '../styles'

interface Props {
  id: string
  liveTick: number
  onClose: () => void
  onChange: () => void
}

const VERBS: Verb[] = ['approve', 'reject', 'revise', 'resolve', 'abort', 'note']

export function CardDetail({ id, liveTick, onClose, onChange }: Props) {
  const [card, setCard] = useState<CardFull | null>(null)
  const [verb, setVerb] = useState<Verb>('note')
  const [args, setArgs] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    fetchCard(id)
      .then((c) => {
        setCard(c)
        setError(null)
      })
      .catch((e) => setError(String(e)))
  }, [id])

  useEffect(() => {
    reload()
  }, [reload, liveTick])

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await postCommand(id, { author: 'user', verb, args: args || undefined })
      setArgs('')
      reload()
      onChange()
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (!card) {
    return <div className="p-4 text-sm text-slate-500">loading…</div>
  }

  const fm = card.frontmatter
  const statusStyle = STATUS_STYLES[fm.status]

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800 px-5 py-4">
        <button
          className="text-[11px] text-slate-500 transition hover:text-slate-300"
          onClick={onClose}
        >
          ← close
        </button>
        <div className="mt-2 flex items-start gap-2">
          <span className={'mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ' + statusStyle.dot} />
          <h2 className="text-base font-semibold leading-snug text-slate-100">
            {fm.title}
          </h2>
        </div>
        <div className="mt-1 font-mono text-[11px] text-slate-500">{fm.id}</div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge label="stage" value={fm.stage} />
          {fm.substage && <Badge label="sub" value={fm.substage} />}
          <span
            className={
              'rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ' +
              statusStyle.chip
            }
          >
            {statusStyle.label}
          </span>
          <Badge label="assignee" value={fm.assignee ?? '–'} />
          {fm.target_venue && <Badge label="venue" value={fm.target_venue} />}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {Object.entries(card.sections).map(([title, body]) => (
          <section
            key={title}
            className="border-b border-slate-800/60 px-5 py-4"
          >
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {title}
            </h3>
            {body ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-300">
                {body}
              </pre>
            ) : (
              <div className="text-[11px] text-slate-600">(empty)</div>
            )}
          </section>
        ))}
      </div>

      <div className="border-t border-slate-800 bg-slate-950/60 px-5 py-3">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Add command
        </h3>
        <div className="flex gap-2">
          <select
            value={verb}
            onChange={(e) => setVerb(e.target.value as Verb)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            {VERBS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="args (optional)"
            className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !submitting) submit()
            }}
          />
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-40"
          >
            send
          </button>
        </div>
        {error && <div className="mt-2 text-[11px] text-rose-400">{error}</div>}
      </div>
    </div>
  )
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-slate-800/80 px-2 py-0.5 text-[10px] ring-1 ring-slate-700/60">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-200">{value}</span>
    </span>
  )
}
