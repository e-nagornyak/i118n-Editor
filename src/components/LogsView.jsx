import React, { useSyncExternalStore, useState, useMemo } from 'react'
import { subscribe, getEntries, clearLogs } from '../lib/logs.js'

const LEVEL_COLOR = {
  debug: 'var(--text-faint)',
  info:  'var(--accent)',
  warn:  'var(--warn)',
  error: 'var(--danger)',
}

function fmtTime(ts) {
  const d = new Date(ts)
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

function Row({ e }) {
  const [open, setOpen] = useState(false)
  const hasData = e.data !== undefined
  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '6px 12px', fontFamily: '"SF Mono", Menlo, monospace', fontSize: 11.5 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ color: 'var(--text-faint)', flexShrink: 0, minWidth: 90 }}>{fmtTime(e.ts)}</span>
        <span style={{ color: LEVEL_COLOR[e.level] || 'var(--text)', fontWeight: 700, flexShrink: 0, minWidth: 44, textTransform: 'uppercase' }}>{e.level}</span>
        <span style={{ color: 'var(--text-muted)', flexShrink: 0, minWidth: 84 }}>{e.category}</span>
        <span style={{ color: 'var(--text)', flex: 1, wordBreak: 'break-word' }}>{e.message}</span>
        {hasData && (
          <button className="btn ghost small" onClick={() => setOpen(v => !v)}>{open ? '▾' : '▸'}</button>
        )}
      </div>
      {open && hasData && (
        <pre style={{ marginTop: 4, marginLeft: 100, background: 'var(--surface-2)', padding: 8, borderRadius: 6, overflow: 'auto', color: 'var(--text-sub)', fontSize: 11 }}>
          {JSON.stringify(e.data, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default function LogsView() {
  const entries = useSyncExternalStore(subscribe, getEntries)
  const [level, setLevel] = useState('all')
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const qq = q.toLowerCase()
    return entries.filter(e => {
      if (level !== 'all' && e.level !== level) return false
      if (!qq) return true
      return (e.category + ' ' + e.message + ' ' + JSON.stringify(e.data || '')).toLowerCase().includes(qq)
    })
  }, [entries, level, q])

  const counts = useMemo(() => {
    const c = { debug: 0, info: 0, warn: 0, error: 0 }
    for (const e of entries) c[e.level] = (c[e.level] || 0) + 1
    return c
  }, [entries])

  const copyAll = () => {
    const text = filtered.map(e =>
      `${fmtTime(e.ts)} [${e.level.toUpperCase()}] ${e.category} ${e.message}${e.data !== undefined ? ' ' + JSON.stringify(e.data) : ''}`
    ).join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
  }

  return (
    <>
      <div className="toolbar">
        <input className="input" style={{ flex: 1, minWidth: 200 }}
          placeholder="Filter logs…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="tabs" style={{ padding: 2 }}>
          {['all', 'debug', 'info', 'warn', 'error'].map(l => (
            <button key={l} className={`tab ${level === l ? 'active' : ''}`} onClick={() => setLevel(l)}>
              {l}{l !== 'all' && counts[l] ? ` · ${counts[l]}` : ''}
            </button>
          ))}
        </div>
        <button className="btn outline" onClick={copyAll}>📋 Copy visible</button>
        <button className="btn outline" onClick={clearLogs}>🗑 Clear</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--surface)' }}>
        {filtered.length === 0 ? (
          <div className="empty">
            <div className="glyph">📜</div>
            <div>{entries.length === 0 ? 'No log entries yet' : 'No entries match filter'}</div>
          </div>
        ) : (
          filtered.map(e => <Row key={e.id} e={e} />)
        )}
      </div>
    </>
  )
}
