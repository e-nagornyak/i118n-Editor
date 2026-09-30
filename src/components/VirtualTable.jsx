import React, { forwardRef, useRef, useState, useImperativeHandle, memo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Sparkles, Trash2, Copy, Check, Hourglass } from 'lucide-react'
import CellInput from './CellInput.jsx'
import { flagFor } from '../lib/consts.js'

const ROW_HEIGHT = 38

function Highlight({ text, query }) {
  if (!query || !text) return text
  const i = text.toLowerCase().indexOf(query.toLowerCase())
  if (i < 0) return text
  return (<>
    {text.slice(0, i)}
    <mark className="hl-match">{text.slice(i, i + query.length)}</mark>
    {text.slice(i + query.length)}
  </>)
}

const Row = memo(function Row({
  rowKey, languages, translations, baseLanguage, search,
  selected, onToggleSelect, onCommit, onDelete, onCopyKey, copiedKey,
  translating, onAutoTranslate, placeholderIssues,
}) {
  return (
    <div className="trow" style={{ minHeight: ROW_HEIGHT }}>
      <div className="tcell select sticky">
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(rowKey)} />
      </div>
      <div className="tcell key sticky" style={{ left: 34 }}>
        <button className={`copy-key ${copiedKey === rowKey ? 'copied' : ''}`} onClick={() => onCopyKey(rowKey)} title="Click to copy">
          {copiedKey === rowKey
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={11} /> Copied!</span>
            : <Highlight text={rowKey} query={search} />}
        </button>
      </div>
      {languages.map(lang => {
        const val = translations[lang.code]?.[rowKey] ?? ''
        const empty = !val
        const tKey = `${rowKey}-${lang.code}`
        const issue = placeholderIssues?.[`${lang.code}:${rowKey}`]
        return (
          <div key={lang.code} className={`tcell val ${empty ? 'missing' : ''}`}>
            <CellInput
              value={val}
              missing={empty}
              placeholder={lang.code === baseLanguage ? '— base —' : 'missing…'}
              onCommit={(v) => onCommit(lang.code, rowKey, v)}
              issue={issue}
            />
            {lang.code !== baseLanguage && (
              <button className="translate-btn" onClick={() => onAutoTranslate(rowKey, lang.code)} disabled={!!translating[tKey]} title="Auto-translate">
                {translating[tKey] ? <Hourglass size={13} /> : <Sparkles size={13} />}
              </button>
            )}
          </div>
        )
      })}
      <div className="tcell actions">
        <button className="del-btn" onClick={() => onDelete(rowKey)} title="Delete key"><Trash2 size={14} /></button>
      </div>
    </div>
  )
})

export default forwardRef(function VirtualTable(props, apiRef) {
  const {
    keys, languages, translations, baseLanguage, search,
    selectedKeys, onToggleSelect, onCommit, onDelete, onCopyKey, copiedKey,
    translating, onAutoTranslate, onToggleAll, allChecked, allIndeterminate,
    filledByLang, onReorderLang, placeholderIssues,
  } = props

  const parentRef = useRef(null)
  const [dragCode, setDragCode] = useState(null)
  const [dropCode, setDropCode] = useState(null)

  useImperativeHandle(apiRef, () => ({
    scrollToKey: (k) => {
      const idx = keys.indexOf(k)
      if (idx >= 0) virt.scrollToIndex(idx, { align: 'center' })
    },
  }), [keys])
  const virt = useVirtualizer({
    count: keys.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  return (
    <div ref={parentRef} className="table-wrap">
      {/* header */}
      <div className="trow header">
        <div className="tcell select sticky">
          <input
            type="checkbox"
            checked={allChecked}
            ref={el => { if (el) el.indeterminate = allIndeterminate }}
            onChange={onToggleAll}
          />
        </div>
        <div className="tcell key sticky" style={{ left: 34 }}>Key</div>
        {languages.map(lang => {
          const pct = keys.length ? Math.round((filledByLang[lang.code] || 0) / keys.length * 100) : 100
          const isDrag = dragCode === lang.code
          const isDrop = dropCode === lang.code && dragCode !== lang.code
          return (
            <div key={lang.code}
              className={`tcell val ${isDrag ? 'dragging' : ''} ${isDrop ? 'drop-target' : ''}`}
              style={{ display: 'flex', gap: 4 }}
              draggable={!!onReorderLang}
              onDragStart={(e) => {
                setDragCode(lang.code)
                e.dataTransfer.effectAllowed = 'move'
                try { e.dataTransfer.setData('text/plain', lang.code) } catch {}
              }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropCode !== lang.code) setDropCode(lang.code) }}
              onDragLeave={() => setDropCode(null)}
              onDrop={(e) => {
                e.preventDefault()
                const from = dragCode || e.dataTransfer.getData('text/plain')
                if (from && onReorderLang) onReorderLang(from, lang.code)
                setDragCode(null); setDropCode(null)
              }}
              onDragEnd={() => { setDragCode(null); setDropCode(null) }}
              title={onReorderLang ? 'Drag to reorder column' : undefined}
            >
              <span>{flagFor(lang)}</span>
              <span>{lang.label}</span>
              {lang.code === baseLanguage && <span style={{ fontSize: 10, color: 'var(--accent)' }}>base</span>}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>{pct}%</span>
            </div>
          )
        })}
        <div className="tcell actions" />
      </div>

      {/* virtualized rows */}
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map(v => {
          const k = keys[v.index]
          return (
            <div
              key={k}
              style={{ position: 'absolute', top: 0, left: 0, transform: `translateY(${v.start}px)` }}
            >
              <Row
                rowKey={k}
                languages={languages}
                translations={translations}
                baseLanguage={baseLanguage}
                search={search}
                selected={selectedKeys.has(k)}
                onToggleSelect={onToggleSelect}
                onCommit={onCommit}
                onDelete={onDelete}
                onCopyKey={onCopyKey}
                copiedKey={copiedKey}
                translating={translating}
                onAutoTranslate={onAutoTranslate}
                placeholderIssues={placeholderIssues}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
})
