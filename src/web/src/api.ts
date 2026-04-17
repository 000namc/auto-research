import type {
  AgentInfo,
  AgentRole,
  AgentsResponse,
  Cadence,
  CardFull,
  DirectionFrontmatter,
  DirectionFull,
  DirectionKind,
  DirectionVerb,
  FindingFull,
  Frontmatter,
  Verb,
} from './types'

export async function fetchCards(): Promise<Frontmatter[]> {
  const r = await fetch('/api/cards')
  if (!r.ok) throw new Error(`fetchCards: ${r.status}`)
  const d = await r.json()
  return d.cards
}

export async function fetchCard(id: string): Promise<CardFull> {
  const r = await fetch(`/api/cards/${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`fetchCard ${id}: ${r.status}`)
  return await r.json()
}

export async function postCommand(
  id: string,
  cmd: { author: string; verb: Verb; args?: string },
): Promise<void> {
  const r = await fetch(`/api/cards/${encodeURIComponent(id)}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`postCommand: ${r.status} ${text}`)
  }
}

// ───────────────────────── agents ─────────────────────────

/** Path segment for an instance endpoint. */
function instancePath(role: AgentRole, name?: string | null): string {
  return name ? `${role}/${encodeURIComponent(name)}` : role
}

export async function fetchAgents(): Promise<AgentsResponse> {
  const r = await fetch('/api/agents')
  if (!r.ok) throw new Error(`fetchAgents: ${r.status}`)
  return r.json()
}

async function post(path: string, body?: unknown): Promise<Response> {
  const r = await fetch(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`${path}: ${r.status} ${text}`)
  }
  return r
}

export async function startAgent(role: AgentRole, name?: string | null): Promise<AgentInfo> {
  return (await post(`/api/agents/${instancePath(role, name)}/start`)).json()
}

export async function stopAgent(role: AgentRole, name?: string | null): Promise<AgentInfo> {
  return (await post(`/api/agents/${instancePath(role, name)}/stop`)).json()
}

export async function restartAgent(role: AgentRole, name?: string | null): Promise<AgentInfo> {
  return (await post(`/api/agents/${instancePath(role, name)}/restart`)).json()
}

export async function spawnInstance(role: AgentRole, name: string): Promise<AgentInfo> {
  return (await post(`/api/agents/${role}/spawn`, { name })).json()
}

export async function archiveInstance(role: AgentRole, name: string): Promise<void> {
  await post(`/api/agents/${role}/${encodeURIComponent(name)}/archive`)
}

export async function fetchAgentPane(
  role: AgentRole,
  name: string | null = null,
  lines = 200,
): Promise<string> {
  const r = await fetch(`/api/agents/${instancePath(role, name)}/pane?lines=${lines}`)
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`fetchAgentPane ${role}: ${r.status} ${text}`)
  }
  const d = await r.json()
  return d.content as string
}

export async function sendAgentInput(
  role: AgentRole,
  message: string,
  name: string | null = null,
): Promise<void> {
  await post(`/api/agents/${instancePath(role, name)}/input`, { message })
}


// ───────────────────────── directions (Explore Kanban) ─────────────────────────

export async function fetchDirections(): Promise<DirectionFrontmatter[]> {
  const r = await fetch('/api/directions')
  if (!r.ok) throw new Error(`fetchDirections: ${r.status}`)
  const d = await r.json()
  return d.directions
}

export async function fetchDirection(slug: string): Promise<DirectionFull> {
  const r = await fetch(`/api/directions/${encodeURIComponent(slug)}`)
  if (!r.ok) throw new Error(`fetchDirection ${slug}: ${r.status}`)
  return r.json()
}

export async function createDirection(body: {
  slug: string
  title: string
  kind: DirectionKind
  cadence: Cadence
  seed: string
  tags?: string[]
}): Promise<DirectionFull> {
  const r = await fetch('/api/directions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`createDirection: ${r.status} ${text}`)
  }
  return r.json()
}

export async function postDirectionCommand(
  slug: string,
  cmd: { author: string; verb: DirectionVerb; args?: string },
): Promise<{ frontmatter: DirectionFrontmatter; finding?: unknown; promotion?: { card_id: string } }> {
  const r = await fetch(`/api/directions/${encodeURIComponent(slug)}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`postDirectionCommand: ${r.status} ${text}`)
  }
  return r.json()
}

export async function fetchFinding(slug: string, fid: string): Promise<FindingFull> {
  const r = await fetch(
    `/api/directions/${encodeURIComponent(slug)}/findings/${encodeURIComponent(fid)}`,
  )
  if (!r.ok) throw new Error(`fetchFinding ${slug}/${fid}: ${r.status}`)
  return r.json()
}

// ───────────────────────── docs ─────────────────────────

export interface DocListEntry {
  name: string
  updated: string
  bytes: number
}

export interface DocDetail {
  name: string
  content: string
  updated: string | null
  exists: boolean
}

export async function fetchDocsList(): Promise<DocListEntry[]> {
  const r = await fetch('/api/docs')
  if (!r.ok) throw new Error(`fetchDocsList: ${r.status}`)
  const d = await r.json()
  return d.docs
}

export async function fetchDoc(name: string): Promise<DocDetail> {
  const r = await fetch(`/api/docs/${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`fetchDoc ${name}: ${r.status}`)
  return r.json()
}

export async function putDoc(
  name: string,
  content: string,
): Promise<{ ok: true; name: string; updated: string; bytes: number }> {
  const r = await fetch(`/api/docs/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`putDoc ${name}: ${r.status} ${text}`)
  }
  return r.json()
}
