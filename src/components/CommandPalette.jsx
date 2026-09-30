import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, FolderKanban, Languages, KeyRound, Save, RotateCw, Sparkles, Sun, Moon,
  Settings as SettingsIcon, Trash2, ScrollText, Table, TreePine, Replace,
} from 'lucide-react'

// Small unicode-forgiving substring matcher — good enough for command lists
// and short key strings. For real fuzzy search we'd bring in fuse.js; the
// simple version keeps the bundle lean and is instant on 5k rows.
function match(query, hay) {
  if (!query) return 1
  const q = query.toLowerCase(), h = hay.toLowerCase()
  if (h.includes(q)) return 10 - Math.min(h.indexOf(q), 9)
  // subsequence match
  let i = 0
  for (const c of h) { if (c === q[i]) i++; if (i === q.length) return 1 }
  return 0
}

export default function CommandPalette({ ctx, onClose }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const items = useMemo(() => {
    const list = []
    // Static actions
    const actions = [
      { icon: Save,           label: 'Rewrite All',        hint: 'Save every locale to disk', run: ctx.rewriteAll,       when: !!ctx.currentProject },
      { icon: RotateCw,       label: 'Reload from disk',   hint: 'Re-read files, pick up new keys', run: ctx.reloadFromDisk, when: !!ctx.currentProject },
      { icon: Replace,        label: 'Find & Replace',     hint: 'Bulk replace values across langs', run: ctx.openFindReplace, when: !!ctx.currentProject },
      { icon: Sparkles,       label: 'Auto-translate missing (base language)', hint: 'For current project', run: ctx.autoTranslateAll, when: !!ctx.currentProject },
      { icon: Table,          label: 'View: Table',         run: () => ctx.setViewMode('table') },
      { icon: TreePine,       label: 'View: Tree',          run: () => ctx.setViewMode('tree') },
      { icon: SettingsIcon,   label: 'Settings',            run: ctx.openSettings },
      { icon: ctx.isDark ? Sun : Moon, label: ctx.isDark ? 'Switch to Light theme' : 'Switch to Dark theme', run: ctx.toggleTheme },
      { icon: ScrollText,     label: 'Open Logs',           run: () => ctx.setActiveTab('logs') },
      { icon: FolderKanban,   label: 'New Project',         run: ctx.newProject },
    ]
    for (const a of actions) if (a.when !== false) list.push({ ...a, group: 'Actions' })

    // Projects
    for (const p of ctx.projects) list.push({
      icon: FolderKanban,
      label: p.name,
      hint: p.id === ctx.currentProjectId ? 'Current' : 'Switch project',
      group: 'Projects',
      run: () => ctx.switchProject(p.id),
    })

    // Languages
    for (const l of ctx.languages) list.push({
      icon: Languages,
      label: `${l.label} (${l.code})`,
      hint: l.code === ctx.baseLanguage ? 'Base' : 'Auto-translate missing',
      group: 'Languages',
      run: () => l.code === ctx.baseLanguage ? null : ctx.askAutoTranslate(l.code),
    })

    // Keys (only when query is meaningful — 5000 items in DOM = laggy)
    if (q.length >= 2) {
      const scored = []
      for (const k of ctx.allKeys) {
        const s = match(q, k)
        if (s > 0) scored.push([s, k])
        if (scored.length > 500) break
      }
      scored.sort((a, b) => b[0] - a[0])
      for (const [, k] of scored.slice(0, 40)) {
        list.push({ icon: KeyRound, label: k, group: 'Keys', hint: 'Scroll to key', run: () => ctx.jumpToKey(k) })
      }
    }

    if (!q) return list
    return list
      .map(item => ({ ...item, _score: match(q, item.label) + match(q, item.group) * 0.5 }))
      .filter(item => item._score > 0)
      .sort((a, b) => b._score - a._score)
  }, [q, ctx])

  useEffect(() => { setIdx(0) }, [q])

  // Keep the highlighted item in view.
  useEffect(() => {
    const row = listRef.current?.querySelector(`[data-idx="${idx}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); items[idx]?.run?.(); onClose() }
    else if (e.key === 'Escape') { onClose() }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={16} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search actions, projects, languages, keys…"
          />
          <span className="palette-hint">ESC to close · ↑↓ Enter</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <div className="palette-empty">No matches</div>}
          {items.map((item, i) => {
            const Icon = item.icon
            const prev = i > 0 ? items[i - 1].group : null
            return (
              <React.Fragment key={i}>
                {item.group !== prev && <div className="palette-group">{item.group}</div>}
                <button
                  className={`palette-row ${i === idx ? 'active' : ''}`}
                  data-idx={i}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => { item.run?.(); onClose() }}
                >
                  <Icon size={14} />
                  <span className="label">{item.label}</span>
                  {item.hint && <span className="hint">{item.hint}</span>}
                </button>
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}
