import React, { useMemo, useState } from 'react'
import { FolderOpen, ScanSearch, Trash2, Plus, CornerDownRight } from 'lucide-react'
import { api } from '../lib/api.js'
import { log } from '../lib/logs.js'

function KeyList({ keys, selected, onToggle, onJump, renderExtra }) {
  return (
    <div className="usage-list">
      {keys.map(item => {
        const k = typeof item === 'string' ? item : item.key
        return (
          <div key={k} className="usage-row">
            {selected && <input type="checkbox" checked={selected.has(k)} onChange={() => onToggle(k)} />}
            <span className="usage-key">{k}</span>
            {renderExtra?.(item)}
            {onJump && <button className="btn ghost small" title="Show in table" onClick={() => onJump(k)}><CornerDownRight size={12} /></button>}
          </div>
        )
      })}
    </div>
  )
}

export default function UsageView({ project, allKeys, onSetSourcePath, onDeleteKeys, onAddKeys, onJump }) {
  const [result, setResult] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [section, setSection] = useState('unused')
  const root = project.sourcePath

  const keySet = useMemo(() => new Set(allKeys), [allKeys])
  // Results go stale as keys get deleted/added — filter against live keys.
  const unused = useMemo(() => (result?.unused || []).filter(k => keySet.has(k)), [result, keySet])
  const dynamic = useMemo(() => (result?.dynamic || []).filter(k => keySet.has(k)), [result, keySet])
  const missing = useMemo(() => (result?.missing || []).filter(m => !keySet.has(m.key)), [result, keySet])

  const scan = async (dir = root) => {
    if (!dir) return
    setScanning(true); setError(null)
    const t0 = performance.now()
    try {
      const r = await api.scanCodeUsage({ root: dir, keys: allKeys })
      setResult(r); setSelected(new Set())
      log.info('usage', `scanned ${r.files_scanned} files in ${Math.round(performance.now() - t0)} ms · ${r.unused.length} unused · ${r.missing.length} missing`)
    } catch (e) {
      setError(String(e)); log.error('usage', String(e))
    } finally { setScanning(false) }
  }

  const pickFolder = async () => {
    const dir = await api.pickDirectory('Select source code folder')
    if (!dir) return
    await onSetSourcePath(dir)
    scan(dir)
  }

  const toggle = (k) => setSelected(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const allSel = unused.length > 0 && unused.every(k => selected.has(k))

  return (
    <div className="usage-view">
      <div className="usage-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>Code usage</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {root ? root : 'Pick the folder with your app source to find unused and missing keys.'}
          </div>
        </div>
        <button className="btn outline" onClick={pickFolder}><FolderOpen size={14} /> {root ? 'Change folder' : 'Choose folder'}</button>
        {root && <button className="btn primary" onClick={() => scan()} disabled={scanning}><ScanSearch size={14} /> {scanning ? 'Scanning…' : result ? 'Rescan' : 'Scan'}</button>}
      </div>

      {error && <div className="usage-error">{error}</div>}

      {result && (
        <>
          <div className="usage-summary">
            {result.files_scanned} files scanned
            <span style={{ opacity: .4 }}>·</span>
            <div className="tabs" style={{ padding: 2 }}>
              <button className={`tab ${section === 'unused' ? 'active' : ''}`} onClick={() => setSection('unused')}>Unused · {unused.length}</button>
              <button className={`tab ${section === 'missing' ? 'active' : ''}`} onClick={() => setSection('missing')}>Missing · {missing.length}</button>
              <button className={`tab ${section === 'dynamic' ? 'active' : ''}`} onClick={() => setSection('dynamic')}>Dynamic · {dynamic.length}</button>
            </div>
          </div>

          {section === 'unused' && (
            <>
              <div className="usage-note">
                Keys whose name never appears as a string in the code. Double-check before deleting — keys built at runtime in ways the scan can't see would show up here too.
              </div>
              {unused.length > 0 && (
                <div className="usage-actions">
                  <label className="checkbox">
                    <input type="checkbox" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(unused))} /> Select all
                  </label>
                  <button className="btn danger small" disabled={!selected.size}
                    onClick={() => onDeleteKeys([...selected].filter(k => keySet.has(k)))}>
                    <Trash2 size={12} /> Delete {selected.size || ''}
                  </button>
                </div>
              )}
              <KeyList keys={unused} selected={selected} onToggle={toggle} onJump={onJump} />
            </>
          )}

          {section === 'missing' && (
            <>
              <div className="usage-note">Keys passed to <code>t()</code> / <code>i18nKey</code> in code that don't exist in the locale files.</div>
              {missing.length > 0 && (
                <div className="usage-actions">
                  <button className="btn primary small" onClick={() => onAddKeys(missing.map(m => m.key))}><Plus size={12} /> Add all {missing.length}</button>
                </div>
              )}
              <KeyList keys={missing} renderExtra={(m) => (<>
                <span className="usage-loc" title={`${m.file}:${m.line}`}>{m.file}:{m.line}{m.count > 1 ? ` · ×${m.count}` : ''}</span>
                <button className="btn ghost small" title="Add key" onClick={() => onAddKeys([m.key])}><Plus size={12} /></button>
              </>)} />
            </>
          )}

          {section === 'dynamic' && (
            <>
              <div className="usage-note">Not referenced literally, but matching a prefix built at runtime (e.g. <code>{'`status.${s}`'}</code>). Probably used.</div>
              <KeyList keys={dynamic} onJump={onJump} />
            </>
          )}
        </>
      )}
    </div>
  )
}
