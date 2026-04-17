// Mirrors src/shared/card.py dataclasses. Keep in sync.

// Top-level stages — see docs/state-machine.md §2
export type Stage = 'idea' | 'run' | 'write' | 'done'

// Substage enum — valid combinations are constrained by stage (§3):
//   idea  → draft, review
//   run   → survey, setup, plan_review, iterate, wrap
//   write → draft, review
//   done  → null
export type Substage =
  | 'draft'
  | 'review'
  | 'survey'
  | 'setup'
  | 'plan_review'
  | 'iterate'
  | 'wrap'

export type Status =
  | 'running'
  | 'awaiting_user'
  | 'blocked'
  | 'idle'
  | 'done'
  | 'error'

export type Verb =
  | 'approve'
  | 'reject'
  | 'revise'
  | 'resolve'
  | 'abort'
  | 'note'

export interface Frontmatter {
  id: string
  title: string
  stage: Stage
  status: Status
  assignee: 'ai' | 'user' | null
  created: string
  updated: string
  substage: Substage | null
  tags: string[]
  parent_id: string | null
  target_venue: string | null
}

export interface BlockerEntry {
  done: boolean
  text: string
}

export interface CommandEntry {
  done: boolean
  timestamp: string
  author: string
  verb: string
  args: string | null
}

export interface EventEntry {
  timestamp: string
  type: string
  description: string
}

export interface CardFull {
  frontmatter: Frontmatter
  sections: Record<string, string>
  blockers: BlockerEntry[]
  commands: CommandEntry[]
  events: EventEntry[]
}

// Agent control plane (mirrors src/api/agents.py AgentInfo)

export type AgentRole =
  | 'orchestrator'
  | 'research-worker'
  | 'execution-worker'
  | 'writing-worker'

export type Cardinality = 'single' | 'multi'

export type TmuxState = 'up' | 'down'

export interface RoleMeta {
  role: AgentRole
  cardinality: Cardinality
}

export interface AgentInfo {
  role: AgentRole
  name: string | null           // null → singleton; otherwise instance slug
  address: string               // "role" or "role/name" — stable id for routing/SSE
  session: string
  tmux_state: TmuxState
  heartbeat: string | null
  inbox_count: number
  outbox_count: number
  pane_lines: number
}

export interface AgentsResponse {
  roles: RoleMeta[]
  agents: AgentInfo[]
}

// ───────────────────────── Explore Kanban ─────────────────────────
// Mirrors src/shared/direction.py — see docs/explore-schema.md.

export type DirectionKind = 'venues' | 'venue_archive' | 'tracking' | 'topic' | 'freeform'
export type Cadence = 'oneshot' | 'daily' | 'weekly' | 'on_demand'
export type DirectionStatus = 'running' | 'paused' | 'done' | 'error'
export type DirectionVerb =
  | 'refocus'
  | 'run_now'
  | 'pause'
  | 'resume'
  | 'archive'
  | 'drop'
  | 'promote'
  | 'note'

export type FindingKind = 'paper' | 'venue' | 'idea' | 'tracking' | 'synthesis'
export type FindingInterest = 'none' | 'liked' | 'archived' | 'promoted'

export interface DirectionFrontmatter {
  id: string
  title: string
  kind: DirectionKind
  cadence: Cadence
  status: DirectionStatus
  assignee: 'ai' | 'user' | null
  created: string
  updated: string
  next_run: string | null
  last_run: string | null
  finding_count: number
  tags: string[]
}

export interface FindingFrontmatter {
  id: string
  parent: string
  kind: FindingKind
  title: string
  created: string
  interest: FindingInterest
  source: string | null
  promoted_to: string | null
  tags: string[]
}

export interface DirectionFull {
  frontmatter: DirectionFrontmatter
  sections: Record<string, string>
  commands: CommandEntry[]
  events: EventEntry[]
  findings: FindingFrontmatter[]
}

export interface FindingFull {
  frontmatter: FindingFrontmatter
  body: string
}
