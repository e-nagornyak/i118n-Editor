import React, { useMemo, useState } from 'react'
import { Search, Replace } from 'lucide-react'

export default function FindReplaceModal({ languages, translations, onApply, onCancel }) {
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [scope, setScope] = useState('all') // 'all' | one lang code
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)

  const { matches, patternError } = useMemo(() => {
    if (!find) return { matches: [], patternError: null }
    let re
    try {
      const flags = caseSensitive ? 'g' : 'gi'
      const source = regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      re = new RegExp(source, flags)
    } catch (e) { return { matches: [], patternError: e.message } }

    const targets = scope === 'all' ? languages : languages.filter(l => l.code === scope)
    const list = []
    for (const l of targets) {
      const map = translations[l.code] || {}
      for (const [k, v] of Object.entries(map)) {
        if (typeof v !== 'string' || !v) continue
        if (re.test(v)) {
          re.lastIndex = 0
          const after = v.replace(re, replace)
          list.push({ lang: l.code, key: k, before: v, after })
          if (list.length > 400) return { matches: list, patternError: null } // cap preview
        }
      }
    }
    return { matches: list, patternError: null }
  }, [find, replace, scope, regex, caseSensitive, languages, translations])

  const doApply = () => { onApply({ find, replace, scope, regex, caseSensitive, matches }); onCancel() }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ width: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Replace size={18} /> Find & Replace</h2>
        <div className="sub">Bulk replace values across languages. Preview shows up to 400 matches.</div>

        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Find</label>
          <input className="input" style={{ width: '100%' }} value={find} onChange={e => setFind(e.target.value)}
            placeholder={regex ? 'regex, e.g. \\bcolour\\b' : 'text to find'} autoFocus />
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Replace</label>
          <input className="input" style={{ width: '100%' }} value={replace} onChange={e => setReplace(e.target.value)}
            placeholder="replacement (empty = delete)" />
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="checkbox"><input type="checkbox" checked={regex} onChange={e => setRegex(e.target.checked)} /> Regex</label>
          <label className="checkbox"><input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} /> Case sensitive</label>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Scope</span>
            <select className="input" value={scope} onChange={e => setScope(e.target.value)}>
              <option value="all">All languages</option>
              {languages.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
            </select>
          </div>
        </div>

        {patternError && <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,.1)', color: 'var(--danger)', fontSize: 12, marginBottom: 10 }}>Bad regex: {patternError}</div>}

        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          {!find ? 'Enter a search term to preview' : matches.length ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : 'No matches'}
        </div>
        <div style={{ flex: 1, minHeight: 200, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}>
          {matches.slice(0, 200).map((m, i) => (
            <div key={i} style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
              <div style={{ display: 'flex', gap: 8, fontFamily: '"SF Mono", Menlo, monospace', color: 'var(--text-muted)', fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: 'var(--accent)' }}>{m.lang}</span>
                <span>{m.key}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div style={{ padding: 6, background: 'rgba(239,68,68,.1)', borderRadius: 4, color: 'var(--text-sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.before}</div>
                <div style={{ padding: 6, background: 'rgba(16,185,129,.1)', borderRadius: 4, color: 'var(--text-sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.after}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="actions">
          <button className="btn outline" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!matches.length || !!patternError} onClick={doApply}>
            Replace {matches.length} value{matches.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}
