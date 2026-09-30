import React, { useState } from 'react'
import { testProvider, PROVIDERS, getProvider } from '../lib/translate.js'
import { FLAG } from '../lib/consts.js'

export function Confirm({ message, onConfirm, onCancel, confirmLabel, variant }) {
  const label = confirmLabel || 'Delete'
  const btnClass = variant === 'primary' ? 'btn primary' : 'btn danger'
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Confirm</h2>
        <div className="sub">{message}</div>
        <div className="actions">
          <button className="btn outline" onClick={onCancel}>Cancel</button>
          <button className={btnClass} onClick={() => { onConfirm(); onCancel() }}>{label}</button>
        </div>
      </div>
    </div>
  )
}

export function SettingsModal({ onClose }) {
  const [provider, setProvider] = useState(() => getProvider())
  const [deeplKey, setDeeplKey] = useState(() => localStorage.getItem('deepl-key') || '')
  const [libreUrl, setLibreUrl] = useState(() => localStorage.getItem('libre-url') || 'https://libretranslate.de')
  const [libreKey, setLibreKey] = useState(() => localStorage.getItem('libre-key') || '')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState(null)

  const save = () => {
    localStorage.setItem('translate-provider', provider)
    localStorage.setItem('deepl-key', deeplKey.trim())
    // Keep the legacy toggle in sync so old readers keep working.
    localStorage.setItem('deepl-enabled', String(provider === 'deepl'))
    localStorage.setItem('libre-url', libreUrl.trim())
    localStorage.setItem('libre-key', libreKey.trim())
    onClose()
  }

  const runTest = async () => {
    // Persist current form values before test so provider impls read them.
    localStorage.setItem('deepl-key', deeplKey.trim())
    localStorage.setItem('libre-url', libreUrl.trim())
    localStorage.setItem('libre-key', libreKey.trim())
    setTesting(true); setResult(null)
    setResult(await testProvider(provider))
    setTesting(false)
  }

  const current = PROVIDERS.find(p => p.id === provider) || PROVIDERS[0]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
        <h2>⚙️ Settings</h2>
        <div className="sub" style={{ marginBottom: 12 }}>Translation provider</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {PROVIDERS.map(p => (
            <label key={p.id} className="provider-row" style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
              background: provider === p.id ? 'rgba(99,102,241,.08)' : 'var(--surface-2)',
              border: `1px solid ${provider === p.id ? 'var(--accent)' : 'transparent'}`,
            }}>
              <input type="radio" name="provider" checked={provider === p.id} onChange={() => setProvider(p.id)} style={{ marginTop: 3 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {p.label}
                  {p.needsKey && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--warn)' }}>KEY</span>}
                  {p.id === 'google' && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--danger)' }}>UNOFFICIAL</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{p.note}</div>
              </div>
            </label>
          ))}
        </div>

        {provider === 'deepl' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>DeepL API Key</div>
            <input className="input" style={{ width: '100%' }} value={deeplKey} onChange={e => setDeeplKey(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx" />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
              Free keys end with <code>:fx</code> — get one at deepl.com/pro
            </div>
          </div>
        )}

        {provider === 'libre' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Instance URL</div>
            <input className="input" style={{ width: '100%', marginBottom: 10 }} value={libreUrl} onChange={e => setLibreUrl(e.target.value)}
              placeholder="https://libretranslate.de" />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>API key (optional, depends on instance)</div>
            <input className="input" style={{ width: '100%' }} value={libreKey} onChange={e => setLibreKey(e.target.value)}
              placeholder="leave empty for keyless instances" />
          </div>
        )}

        {provider === 'google' && (
          <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', fontSize: 11.5, color: 'var(--text-muted)' }}>
            ⚠ This uses an undocumented endpoint that isn't meant for third-party use. Google may block requests or change the format at any time. Prefer DeepL or Lingva for anything you rely on.
          </div>
        )}

        {result && (
          <div style={{ marginTop: 4, padding: '8px 12px', borderRadius: 6, fontSize: 12, background: result.ok ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)', color: result.ok ? 'var(--success)' : 'var(--danger)' }}>
            {result.msg}
          </div>
        )}

        <div className="actions">
          <button className="btn outline" disabled={testing} onClick={runTest}>
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button className="btn outline" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

export function AutoTranslateModal({ config, initialDelay, onStart, onCancel }) {
  const [delay, setDelay] = useState(initialDelay)
  const providerId = getProvider()
  const provider = PROVIDERS.find(p => p.id === providerId)?.label || 'Provider'
  const isBatch = PROVIDERS.find(p => p.id === providerId)?.batch
  const perReqMs = (isBatch ? 60 : 600) + delay
  const totalSec = Math.max(1, Math.round((config.count * perReqMs) / 1000))
  const mins = Math.floor(totalSec / 60), secs = totalSec % 60
  const estimate = mins ? `~${mins}m ${secs}s` : `~${secs}s`

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
        <h2>✨ Auto-translate</h2>
        <div className="sub">
          <strong>{config.count}</strong> missing → <strong>{config.langFlag || FLAG[config.langCode] || '🌐'} {config.langLabel}</strong>
          <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.7 }}>via {provider}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Delay between requests (ms)</div>
        <input className="input" style={{ width: '100%' }} type="number" min={0} step={100}
          value={delay} onChange={e => setDelay(Math.max(0, parseInt(e.target.value, 10) || 0))} autoFocus />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
          {[0, 250, 500, 1000, 2000, 5000].map(v => (
            <button key={v} className={`btn small ${delay === v ? 'primary' : 'outline'}`} onClick={() => setDelay(v)}>{v}ms</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
          Estimated time: <strong style={{ color: 'var(--text-sub)' }}>{estimate}</strong>
          {!isBatch && <> · Free providers rate-limit on burst — ≥500ms recommended.</>}
        </div>
        <div className="actions">
          <button className="btn outline" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={() => onStart(delay)}>✨ Start</button>
        </div>
      </div>
    </div>
  )
}

export function DiffModal({ diff, onConfirm, onCancel }) {
  const [expanded, setExpanded] = useState({})
  const totals = diff.reduce((a, d) => ({
    added:   a.added   + (d.added?.length   || 0),
    changed: a.changed + (d.changed?.length || 0),
    deleted: a.deleted + (d.deleted?.length || 0),
  }), { added: 0, changed: 0, deleted: 0 })
  const noChanges = totals.added + totals.changed + totals.deleted === 0 && !diff.some(d => d.newFile)

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ width: 580, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <h2>💾 Rewrite Preview</h2>
        <div className="sub">
          {noChanges ? 'No changes detected.' : `Total: +${totals.added} added, ~${totals.changed} changed, −${totals.deleted} deleted`}
        </div>
        <div style={{ flex: 1, overflow: 'auto', marginBottom: 12 }}>
          {diff.map((d, i) => (
            <div key={i} style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: 'var(--surface-2)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <span style={{ fontSize: 16 }}>{FLAG[d.lang] || '🌐'}</span>
                <strong>{d.label || d.lang}</strong>
                {d.newFile && <span style={{ fontSize: 11, color: 'var(--warn)' }}>📄 new file</span>}
                {!d.newFile && (
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                    {d.added.length > 0 && <span style={{ color: 'var(--success)' }}> +{d.added.length} </span>}
                    {d.changed.length > 0 && <span style={{ color: 'var(--warn)' }}>~{d.changed.length} </span>}
                    {d.deleted.length > 0 && <span style={{ color: 'var(--danger)' }}>−{d.deleted.length}</span>}
                    {d.added.length + d.changed.length + d.deleted.length === 0 && <span>no changes</span>}
                  </span>
                )}
                {(d.added.length + d.changed.length + d.deleted.length) > 0 && (
                  <button className="btn ghost small" style={{ marginLeft: 'auto' }} onClick={() => setExpanded(p => ({ ...p, [i]: !p[i] }))}>
                    {expanded[i] ? '▾ hide' : '▸ show'}
                  </button>
                )}
              </div>
              {expanded[i] && (
                <div style={{ padding: '8px 12px', maxHeight: 200, overflow: 'auto', fontFamily: '"SF Mono", Menlo, monospace', fontSize: 11 }}>
                  {d.added.map(k => <div key={k} style={{ color: 'var(--success)' }}>+ {k}</div>)}
                  {d.changed.map(k => <div key={k} style={{ color: 'var(--warn)' }}>~ {k}</div>)}
                  {d.deleted.map(k => <div key={k} style={{ color: 'var(--danger)' }}>− {k}</div>)}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="btn outline" onClick={onCancel}>Cancel</button>
          <button className="btn success" onClick={onConfirm}>{noChanges ? 'Write anyway' : '✓ Confirm Rewrite'}</button>
        </div>
      </div>
    </div>
  )
}

export function NewProjectModal({ onCreate, onCancel, onPickFolder, folder }) {
  const [name, setName] = useState('')
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <h2>New Project</h2>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Project name</div>
        <input className="input" style={{ width: '100%' }} autoFocus value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onCreate(name.trim()) }}
          placeholder="e.g. Storefront web" />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '14px 0 6px' }}>Locales folder (optional)</div>
        <button className="btn outline" style={{ width: '100%', justifyContent: 'center' }} onClick={onPickFolder}>
          {folder ? `📁 ${folder.split('/').pop()}` : '📁 Pick folder…'}
        </button>
        <div className="actions">
          <button className="btn outline" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!name.trim()} onClick={() => onCreate(name.trim())}>Create</button>
        </div>
      </div>
    </div>
  )
}

export function LangEditModal({ lang, onSave, onCancel }) {
  const [draft, setDraft] = useState({ label: lang.label || '', flag: lang.flag || '', translatorCode: lang.translatorCode || '' })
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ width: 380 }} onClick={e => e.stopPropagation()}>
        <h2>✏ Edit {lang.code}</h2>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Label</div>
        <input className="input" style={{ width: '100%', marginBottom: 10 }} value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Flag (emoji)</div>
        <input className="input" style={{ width: '100%', marginBottom: 10 }} value={draft.flag} onChange={e => setDraft(d => ({ ...d, flag: e.target.value }))} placeholder="🌐" />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Translator code</div>
        <input className="input" style={{ width: '100%' }} value={draft.translatorCode} onChange={e => setDraft(d => ({ ...d, translatorCode: e.target.value }))} placeholder={lang.code} />
        <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 6 }}>
          Sent to MyMemory/DeepL, e.g. <code>pt-BR</code>. Leave empty to use <code>{lang.code}</code>.
        </div>
        <div className="actions">
          <button className="btn outline" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={() => onSave(draft)}>💾 Save</button>
        </div>
      </div>
    </div>
  )
}
