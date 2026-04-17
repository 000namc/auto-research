import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDoc, fetchDocsList, putDoc } from '../api'
import type { DocListEntry } from '../api'

interface Props {
  liveTick: number
  initialDoc?: string
}

/**
 * Inline docs browser for the Context tab.
 * Left sidebar: list of docs/*.md files. Right pane is always an editable
 * textarea — save via PUT /api/docs/{name} when dirty.
 */
export function DocsView({ liveTick, initialDoc = 'research-direction' }: Props) {
  const [list, setList] = useState<DocListEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [draft, setDraft] = useState<string>('')
  const [updated, setUpdated] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const reloadList = useCallback(async () => {
    try {
      const items = await fetchDocsList()
      setList(items)
      setError(null)
      if (selected === null) {
        const pick = items.find((d) => d.name === initialDoc)?.name ?? items[0]?.name ?? null
        setSelected(pick)
      }
    } catch (e) {
      setError(String(e))
    }
  }, [selected, initialDoc])

  useEffect(() => {
    reloadList()
  }, [reloadList, liveTick])

  const reloadContent = useCallback(async () => {
    if (!selected) {
      setContent('')
      setDraft('')
      setUpdated(null)
      return
    }
    try {
      const d = await fetchDoc(selected)
      setContent(d.content)
      setUpdated(d.updated)
      setError(null)
      if (!dirty) setDraft(d.content)
    } catch (e) {
      setError(String(e))
    }
  }, [selected, dirty])

  useEffect(() => {
    reloadContent()
  }, [reloadContent, liveTick])

  const selectDoc = (name: string) => {
    if (dirty && !confirm('Unsaved changes will be lost. Switch doc anyway?')) return
    setDirty(false)
    setSelected(name)
    // Focus after swap so user can keep typing without a click.
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const save = async () => {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      const r = await putDoc(selected, draft)
      setUpdated(r.updated)
      setContent(draft)
      setDirty(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    setDraft(content)
    setDirty(false)
  }

  // Cmd/Ctrl+S to save.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      if (dirty && !saving) save()
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar — doc list */}
      <div className="flex w-44 flex-shrink-0 flex-col border-r border-slate-800 bg-slate-900/40">
        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          docs/
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.length === 0 && (
            <div className="px-3 py-4 text-center text-[11px] text-slate-600">empty</div>
          )}
          {list.map((d) => {
            const active = selected === d.name
            return (
              <button
                key={d.name}
                onClick={() => selectDoc(d.name)}
                className={
                  'block w-full truncate border-l-2 px-3 py-1.5 text-left text-[11px] transition ' +
                  (active
                    ? 'border-sky-500 bg-slate-800/60 text-slate-100'
                    : 'border-transparent text-slate-400 hover:bg-slate-900 hover:text-slate-200')
                }
                title={`${d.name}.md · ${d.bytes} bytes · updated ${new Date(
                  d.updated,
                ).toLocaleString()}`}
              >
                <span className="font-mono">{d.name}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Editor pane */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-2">
          <div className="min-w-0">
            <h3 className="truncate font-mono text-[12px] text-slate-100">
              {selected ? `${selected}.md` : '(no doc)'}
            </h3>
            <p className="text-[10px] text-slate-500">
              {updated
                ? `updated ${new Date(updated).toLocaleString()}`
                : selected
                ? 'new file'
                : 'select a doc on the left'}
              {dirty && <span className="ml-2 text-amber-400">● unsaved</span>}
            </p>
          </div>
        </div>

        {error && (
          <div className="border-b border-rose-900/60 bg-rose-950/40 px-4 py-2 text-[11px] text-rose-300">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {!selected ? (
            <div className="p-6 text-center text-[11px] text-slate-500">
              select a document from the list
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setDirty(e.target.value !== content)
              }}
              onKeyDown={onKeyDown}
              className="h-full w-full resize-none border-0 bg-slate-950 px-4 py-3 font-mono text-[11px] leading-relaxed text-slate-100 placeholder:text-slate-600 focus:outline-none"
              placeholder={`# ${selected}\n\n...`}
              spellCheck={false}
            />
          )}
        </div>

        {selected && (
          <div className="border-t border-slate-800 bg-slate-900/40 px-4 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-slate-500 tabular-nums">
                {draft.length.toLocaleString()} chars ·{' '}
                <span className="opacity-70">⌘S / Ctrl+S to save</span>
              </span>
              <div className="flex gap-2">
                <button
                  className="rounded bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700 disabled:opacity-40"
                  onClick={discard}
                  disabled={saving || !dirty}
                >
                  discard
                </button>
                <button
                  className="rounded bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
                  onClick={save}
                  disabled={saving || !dirty}
                >
                  {saving ? 'saving…' : 'save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
