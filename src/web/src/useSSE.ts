import { useEffect } from 'react'

type SseEvent =
  | 'hello'
  | 'card_added'
  | 'card_changed'
  | 'card_removed'
  | 'direction_added'
  | 'direction_changed'
  | 'direction_removed'
  | 'finding_added'
  | 'finding_changed'
  | 'finding_removed'
  | 'docs_added'
  | 'docs_changed'
  | 'docs_removed'
  | 'agent_added'
  | 'agent_removed'
  | 'agent_state_changed'
  | 'agent_pane_changed'
type Handler = (event: SseEvent, data: unknown) => void

const EVENTS: SseEvent[] = [
  'hello',
  'card_added',
  'card_changed',
  'card_removed',
  'direction_added',
  'direction_changed',
  'direction_removed',
  'finding_added',
  'finding_changed',
  'finding_removed',
  'docs_added',
  'docs_changed',
  'docs_removed',
  'agent_added',
  'agent_removed',
  'agent_state_changed',
  'agent_pane_changed',
]

/**
 * Subscribe to /api/events. Calls `handler` for each named event.
 * EventSource auto-reconnects on transient drops.
 */
export function useSSE(handler: Handler): void {
  useEffect(() => {
    const es = new EventSource('/api/events')
    const listeners: Array<[SseEvent, EventListener]> = []
    for (const ev of EVENTS) {
      const fn: EventListener = (e) => {
        const me = e as MessageEvent
        let data: unknown = null
        try {
          data = JSON.parse(me.data)
        } catch {
          // ignore parse errors
        }
        handler(ev, data)
      }
      es.addEventListener(ev, fn)
      listeners.push([ev, fn])
    }
    return () => {
      for (const [ev, fn] of listeners) es.removeEventListener(ev, fn)
      es.close()
    }
  }, [handler])
}
