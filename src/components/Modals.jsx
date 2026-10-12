import React, { useState } from 'react'
import { Undo2 } from 'lucide-react'
import { testProvider, PROVIDERS, getProvider, CLAUDE_MODELS } from '../lib/translate.js'
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
  const [claudeKey, setClaudeKey] = useState(() => localStorage.getItem('claude-key') || '')
  const [claudeModel, setClaudeModel] = useState(() => localStorage.getItem('claude-model') || CLAUDE_MODELS[0].id)
  const [claudeGlossary, setClaudeGlossary] = useState(() => localStorage.getItem('claude-glossary') || '')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState(null)

  const save = () => {
    localStorage.setItem('translate-provider', provider)
    localStorage.setItem('deepl-key', deeplKey.trim())
    // Keep the legacy toggle in sync so old readers keep working.
    localStorage.setItem('deepl-enabled', String(provider === 'deepl'))
    localStorage.setItem('libre-url', libreUrl.trim())
    localStorage.setItem('libre-key', libreKey.trim())
    persistClaude()
    onClose()
  }

  const persistClaude = () => {
    localStorage.setItem('claude-key', claudeKey.trim())
    localStorage.setItem('claude-model', claudeModel)
    localStorage.setItem('claude-glossary', claudeGlossary)
  }

  const runTest = async () => {
    // Persist current form values before test so provider impls read them.
    localStorage.setItem('deepl-key', deeplKey.trim())
    localStorage.setItem('libre-url', libreUrl.trim())
    localStorage.setItem('libre-key', libreKey.trim())
    persistClaude()
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

        {provider === 'claude' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Anthropic API key</div>
            <input className="input" type="password" style={{ width: '100%', marginBottom: 10 }} value={claudeKey} onChange={e => setClaudeKey(e.target.value)}
              placeholder="sk-ant-…" />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Model</div>
            <select className="input" style={{ width: '100%', marginBottom: 10 }} value={claudeModel} onChange={e => setClaudeModel(e.target.value)}>
              {CLAUDE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Glossary (optional) — one rule per line</div>
            <textarea className="input" rows={4} style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} value={claudeGlossary}
              onChange={e => setClaudeGlossary(e.target.value)}
              placeholder={'Workspace → Робочий простір\nDashboard — do not translate'} />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
              Get a key at console.anthropic.com. Translates in batches of 40 using key names as context.
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

const KIND_META = {
  added:   { sign: '+', color: 'var(--success)', title: 'Remove this new key' },
  changed: { sign: '~', color: 'var(--warn)',    title: 'Restore the value from disk' },
  deleted: { sign: '−', color: 'var(--danger)',  title: 'Bring this key back' },
}

function DiffEntry({ kind, k, before, after, onRevert }) {
  const meta = KIND_META[kind]
  return (
    <div className="diff-entry">
      <div className="diff-entry-main">
        <div style={{ color: meta.color }}>{meta.sign} {k}</div>
        {kind === 'changed' && (<>
          <div className="diff-old">{before || <em>empty</em>}</div>
          <div className="diff-new">{after || <em>empty</em>}</div>
        </>)}
        {kind === 'added' && after && <div className="diff-new">{after}</div>}
        {kind === 'deleted' && <div className="diff-old">{before || <em>empty</em>}</div>}
      </div>
      <button className="diff-revert" title={meta.title} onClick={onRevert}><Undo2 size={12} /></button>
    </div>
  )
}

export function DiffModal({ diff, translations, onRevert, onConfirm, onCancel }) {
  const [expanded, setExpanded] = useState(() => diff.length === 1 || diff.filter(d => d.added.length + d.changed.length + d.deleted.length).length === 1
    ? Object.fromEntries(diff.map((_, i) => [i, true])) : {})
  const totals = diff.reduce((a, d) => ({
    added:   a.added   + (d.added?.length   || 0),
    changed: a.changed + (d.changed?.length || 0),
    deleted: a.deleted + (d.deleted?.length || 0),
  }), { added: 0, changed: 0, deleted: 0 })
  const noChanges = totals.added + totals.changed + totals.deleted === 0 && !diff.some(d => d.newFile)
  const entriesOf = (d) => [
    ...d.added.map(key => ({ lang: d.lang, kind: 'added', key })),
    ...d.changed.map(key => ({ lang: d.lang, kind: 'changed', key })),
    ...d.deleted.map(key => ({ lang: d.lang, kind: 'deleted', key })),
  ]

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ width: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <h2>💾 Rewrite Preview</h2>
        <div className="sub">
          {noChanges ? 'No changes left to write.' : `Total: +${totals.added} added, ~${totals.changed} changed, −${totals.deleted} deleted`}
        </div>
        <div style={{ flex: 1, overflow: 'auto', marginBottom: 12 }}>
          {diff.map((d, i) => {
            const count = d.added.length + d.changed.length + d.deleted.length
            return (
              <div key={d.lang} style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ background: 'var(--surface-2)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                  <span style={{ fontSize: 16 }}>{FLAG[d.lang] || '🌐'}</span>
                  <strong>{d.label || d.lang}</strong>
                  {d.newFile && <span style={{ fontSize: 11, color: 'var(--warn)' }}>📄 new file</span>}
                  {!d.newFile && (
                    <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                      {d.added.length > 0 && <span style={{ color: 'var(--success)' }}> +{d.added.length} </span>}
                      {d.changed.length > 0 && <span style={{ color: 'var(--warn)' }}>~{d.changed.length} </span>}
                      {d.deleted.length > 0 && <span style={{ color: 'var(--danger)' }}>−{d.deleted.length}</span>}
                      {count === 0 && <span>no changes</span>}
                    </span>
                  )}
                  {count > 0 && (<>
                    <button className="btn ghost small" style={{ marginLeft: 'auto' }} title="Revert every change in this language"
                      onClick={() => onRevert(entriesOf(d))}><Undo2 size={11} /> Revert all</button>
                    <button className="btn ghost small" onClick={() => setExpanded(p => ({ ...p, [i]: !p[i] }))}>
                      {expanded[i] ? '▾ hide' : '▸ show'}
                    </button>
                  </>)}
                </div>
                {expanded[i] && count > 0 && (
                  <div className="diff-list">
                    {entriesOf(d).map(e => (
                      <DiffEntry key={e.kind + e.key} kind={e.kind} k={e.key}
                        before={d.before?.[e.key]} after={translations?.[d.lang]?.[e.key]}
                        onRevert={() => onRevert([e])} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
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

export function RenameKeyModal({ from, allKeys, onRename, onCancel }) {
  const [to, setTo] = useState(from)
  const affected = React.useMemo(
    () => allKeys.filter(k => k === from || k.startsWith(from + '.')),
    [allKeys, from])
  const target = to.trim()
  const error = (() => {
    if (!target) return 'Key cannot be empty'
    if (/\s/.test(target) || target.startsWith('.') || target.endsWith('.') || target.includes('..')) return 'Invalid key'
    if (target === from) return null
    if (target.startsWith(from + '.')) return 'Cannot move a key inside itself'
    const moving = new Set(affected)
    const clash = affected.map(k => target + k.slice(from.length)).find(k => allKeys.includes(k) && !moving.has(k))
    return clash ? `"${clash}" already exists` : null
  })()
  const nested = affected.filter(k => k !== from).length
  const submit = () => { if (!error && target !== from) onRename(from, target) }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <h2>Rename {nested ? 'namespace' : 'key'}</h2>
        <div className="sub" style={{ marginBottom: 10 }}>
          {nested
            ? <>Renames <strong>{affected.length}</strong> key{affected.length === 1 ? '' : 's'} under <code>{from}</code> in every language.</>
            : <>Renames <code>{from}</code> in every language. Values stay the same.</>}
        </div>
        <input className="input" style={{ width: '100%', fontFamily: "'SF Mono', Menlo, monospace" }} autoFocus value={to}
          onChange={e => setTo(e.target.value)}
          onFocus={e => { const i = from.lastIndexOf('.') + 1; e.target.setSelectionRange(i, from.length) }}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }} />
        {error && target !== from && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>{error}</div>}
        {!error && nested > 0 && target !== from && (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8, fontFamily: "'SF Mono', Menlo, monospace" }}>
            {affected.slice(0, 3).map(k => <div key={k}>{k} → {target + k.slice(from.length)}</div>)}
            {affected.length > 3 && <div>… and {affected.length - 3} more</div>}
          </div>
        )}
        <div className="actions">
          <button className="btn outline" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!!error || target === from} onClick={submit}>Rename</button>
        </div>
      </div>
    </div>
  )
}

export function QuitModal({ langs, saving, onSave, onDiscard, onCancel }) {
  return (
    <div className="modal-overlay" onClick={saving ? undefined : onCancel}>
      <div className="modal" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <h2>Unsaved changes</h2>
        <div className="sub">
          {langs.length === 1 ? <><strong>{langs[0]}</strong> has</> : <><strong>{langs.join(', ')}</strong> have</>} changes that aren't written to disk yet.
        </div>
        <div className="actions">
          <button className="btn outline" disabled={saving} onClick={onCancel}>Cancel</button>
          <button className="btn danger" disabled={saving} onClick={onDiscard}>Quit without saving</button>
          <button className="btn primary" disabled={saving} autoFocus onClick={onSave}>{saving ? 'Saving…' : 'Save & Quit'}</button>
        </div>
      </div>
    </div>
  )
}
