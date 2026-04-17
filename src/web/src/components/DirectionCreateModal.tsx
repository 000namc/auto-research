import { useEffect, useState } from 'react'
import type { Cadence, DirectionKind } from '../types'
import { createDirection } from '../api'

interface Props {
  onCreated: (slug: string) => void
  onClose: () => void
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

const KIND_OPTIONS: Array<{
  value: DirectionKind
  label: string
  hint: string
}> = [
  { value: 'venues', label: 'venues', hint: '내 방향과 맞는 학회·저널 찾기' },
  { value: 'venue_archive', label: 'venue_archive', hint: '특정 venue 과거~현재 논문 catalog' },
  { value: 'tracking', label: 'tracking', hint: '새 논문·공지 지속 트래킹' },
  { value: 'topic', label: 'topic', hint: '특정 주제 자유 수집 (논문 + 아이디어)' },
  { value: 'freeform', label: 'freeform', hint: '템플릿 없음 — seed 만 보고 판단' },
]

const CADENCE_OPTIONS: Array<{
  value: Cadence
  label: string
  hint: string
}> = [
  { value: 'oneshot', label: 'oneshot', hint: '한 번만 실행 후 완료' },
  { value: 'daily', label: 'daily', hint: '매일 cycle 1회' },
  { value: 'weekly', label: 'weekly', hint: '매주 cycle 1회' },
  { value: 'on_demand', label: 'on_demand', hint: 'Run now 버튼으로만 실행' },
]

// kind별 권장 cadence — 사용자는 override 가능.
const RECOMMENDED_CADENCE: Record<DirectionKind, Cadence> = {
  venues: 'oneshot',
  venue_archive: 'oneshot',
  tracking: 'weekly',
  topic: 'on_demand',
  freeform: 'on_demand',
}

export function DirectionCreateModal({ onCreated, onClose }: Props) {
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<DirectionKind>('topic')
  const [cadence, setCadence] = useState<Cadence>(RECOMMENDED_CADENCE['topic'])
  const [seed, setSeed] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cadenceTouched, setCadenceTouched] = useState(false)

  // When kind changes and user hasn't touched cadence, auto-set the recommended.
  useEffect(() => {
    if (!cadenceTouched) setCadence(RECOMMENDED_CADENCE[kind])
  }, [kind, cadenceTouched])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  const canSubmit =
    !submitting &&
    SLUG_RE.test(slug) &&
    title.trim().length > 0 &&
    seed.trim().length > 0

  const submit = async () => {
    setError(null)
    if (!SLUG_RE.test(slug)) {
      setError('slug 규칙: 소문자 영숫자 + -/_, 첫글자 영숫자, 1~64자')
      return
    }
    setSubmitting(true)
    try {
      const resp = await createDirection({
        slug,
        title: title.trim(),
        kind,
        cadence,
        seed: seed.trim(),
      })
      onCreated(resp.frontmatter.id)
    } catch (e) {
      setError(String(e))
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
    >
      <div className="flex max-h-[92vh] w-[min(640px,92vw)] flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-slate-100">
              New explore direction
            </h2>
            <p className="text-[11px] text-slate-500">
              seed · kind · cadence 지정. orchestrator가 cycle 돌려 findings 수집.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"
          >
            ✕
          </button>
        </header>

        {error && (
          <div className="border-b border-rose-900/60 bg-rose-950/40 px-5 py-2 text-[11px] text-rose-300">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          <Field label="slug" hint="lowercase + -/_, 1~64자">
            <input
              autoFocus
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. alignment-drift-papers"
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
            />
          </Field>

          <Field label="title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="한 줄로 direction 제목"
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="kind" hint="direction 유형">
              <div className="flex flex-col gap-1">
                {KIND_OPTIONS.map((o) => (
                  <label
                    key={o.value}
                    className={
                      'flex cursor-pointer items-start gap-2 rounded border px-2 py-1.5 text-[11px] transition ' +
                      (kind === o.value
                        ? 'border-violet-500 bg-violet-600/10'
                        : 'border-slate-800 bg-slate-950 hover:border-slate-700')
                    }
                  >
                    <input
                      type="radio"
                      name="kind"
                      checked={kind === o.value}
                      onChange={() => setKind(o.value)}
                      className="mt-0.5"
                    />
                    <span className="flex-1">
                      <span className="block font-mono text-[11px] text-slate-200">
                        {o.label}
                      </span>
                      <span className="block text-[10px] text-slate-500">{o.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>

            <Field
              label="cadence"
              hint={cadenceTouched ? '수동 설정' : `kind default: ${RECOMMENDED_CADENCE[kind]}`}
            >
              <div className="flex flex-col gap-1">
                {CADENCE_OPTIONS.map((o) => (
                  <label
                    key={o.value}
                    className={
                      'flex cursor-pointer items-start gap-2 rounded border px-2 py-1.5 text-[11px] transition ' +
                      (cadence === o.value
                        ? 'border-violet-500 bg-violet-600/10'
                        : 'border-slate-800 bg-slate-950 hover:border-slate-700')
                    }
                  >
                    <input
                      type="radio"
                      name="cadence"
                      checked={cadence === o.value}
                      onChange={() => {
                        setCadence(o.value)
                        setCadenceTouched(true)
                      }}
                      className="mt-0.5"
                    />
                    <span className="flex-1">
                      <span className="block font-mono text-[11px] text-slate-200">
                        {o.label}
                      </span>
                      <span className="block text-[10px] text-slate-500">{o.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          </div>

          <Field label="seed" hint="이 direction 의 목적·맥락·제약·원하는 결과 형태">
            <textarea
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              rows={8}
              placeholder={seedPlaceholderFor(kind)}
              className="w-full resize-y rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
            />
          </Field>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? 'creating…' : 'Create direction'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
        {hint && (
          <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">
            {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  )
}

function seedPlaceholderFor(kind: DirectionKind): string {
  switch (kind) {
    case 'venues':
      return '예: small-scale alignment 연구에 적합한 workshop 찾아줘. NeurIPS/ICLR 우선, ICBINB 스타일 선호. 실험 규모 작아도 되고 negative results 환영하는 곳.'
    case 'venue_archive':
      return '예: NeurIPS 2024 Safe Generative AI workshop accepted paper 싹 정리. 각 논문 요약 3줄 + 내 방향과의 관계.'
    case 'tracking':
      return '예: arxiv cs.CL 신간 중 "continual learning" + "alignment" 키워드 포함 주간 트래킹. 중요해 보이는 것만 1줄 요약.'
    case 'topic':
      return '예: "soft prompt 으로 alignment 주입" 주제 관련 논문·아이디어 수집. 최근 2년, 가능하면 실험 스킴 구체적인 것 선호.'
    case 'freeform':
      return '하고 싶은 것 자유롭게 기술…'
  }
}
