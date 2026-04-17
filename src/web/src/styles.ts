import type { Stage, Status, Substage } from './types'

export const STATUS_STYLES: Record<Status, { dot: string; chip: string; label: string }> = {
  running: {
    dot: 'bg-sky-400 animate-pulse-dot',
    chip: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30',
    label: 'running',
  },
  awaiting_user: {
    dot: 'bg-amber-400 animate-pulse-dot',
    chip: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
    label: 'awaiting user',
  },
  blocked: {
    dot: 'bg-rose-500 animate-pulse-dot',
    chip: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
    label: 'blocked',
  },
  idle: {
    dot: 'bg-slate-500',
    chip: 'bg-slate-500/15 text-slate-300 ring-1 ring-slate-500/30',
    label: 'idle',
  },
  done: {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
    label: 'done',
  },
  error: {
    dot: 'bg-rose-600',
    chip: 'bg-rose-600/20 text-rose-300 ring-1 ring-rose-600/40',
    label: 'error',
  },
}

export const STAGE_ACCENT: Record<Stage, string> = {
  idea: 'text-slate-300',
  run: 'text-sky-300',
  write: 'text-violet-300',
  done: 'text-emerald-300',
}

// Substage display metadata used in the Run column sub-lanes and CardDetail badge.
export const SUBSTAGE_META: Record<
  Substage,
  { label: string; short: string; isGate: boolean }
> = {
  draft: { label: 'draft', short: 'draft', isGate: false },
  review: { label: 'review', short: 'review', isGate: true },
  survey: { label: 'survey', short: 'survey', isGate: false },
  setup: { label: 'setup', short: 'setup', isGate: false },
  plan_review: { label: 'plan review', short: 'plan review', isGate: true },
  iterate: { label: 'iterate', short: 'iterate', isGate: false },
  wrap: { label: 'wrap', short: 'wrap', isGate: false },
}
