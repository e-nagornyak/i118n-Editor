import React, { forwardRef, useRef, useState, useImperativeHandle, memo, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Sparkles, Trash2, Copy, Check, Hourglass } from 'lucide-react'
import CellInput from './CellInput.jsx'
import { flagFor } from '../lib/consts.js'

const ROW_HEIGHT = 38
const DEFAULT_WIDTH = { key: 300, val: 220 }
const MIN_WIDTH = 80
const WIDTHS_STORAGE = 'i18n-col-widths'

// Widths live in CSS variables on the scroll container, so dragging a column
// edge doesn't re-render the memoized rows.
const widthVar = (col) => `--w-${col.replace(/[^\w-]/g, '_')}`
const valWidth = (code) => `var(${widthVar('lang-' + code)}, ${DEFAULT_WIDTH.val}px)`
const KEY_WIDTH = `var(${widthVar('key')}, ${DEFAULT_WIDTH.key}px)`

function loadWidths() {
  try { return JSON.parse(localStorage.getItem(WIDTHS_STORAGE)) || {} } catch { return {} }
}

function ResizeHandle({ onStart, onReset }) {
  return (
    <span className="col-resize" draggable={false}
      onMouseDown={onStart} onDoubleClick={onReset}
      onClick={e => e.stopPropagation()}
      title="Drag to resize · double-click to reset" />
  )
}

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
  translating, onAutoTranslate, placeholderIssues, flashLang,
}) {
  return (
    <div className="trow" style={{ minHeight: ROW_HEIGHT }}>
      <div className="tcell select sticky">
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(rowKey)} />
      </div>
      <div className="tcell key sticky" style={{ left: 34, width: KEY_WIDTH }}>
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
          <div key={lang.code} data-cell={`${lang.code}:${rowKey}`}
            className={`tcell val ${empty ? 'missing' : ''} ${flashLang === lang.code ? 'flash' : ''}`}
            style={{ width: valWidth(lang.code) }}>
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
    filledByLang, onReorderLang, placeholderIssues, flashCell,
  } = props

  const parentRef = useRef(null)
  const [dragCode, setDragCode] = useState(null)
  const [dropCode, setDropCode] = useState(null)
  const [widths, setWidths] = useState(loadWidths)
  const resizingRef = useRef(false)

  const widthStyle = useMemo(() => {
    const st = {}
    for (const [col, w] of Object.entries(widths)) st[widthVar(col)] = `${w}px`
    return st
  }, [widths])

  const saveWidths = (next) => {
    try { localStorage.setItem(WIDTHS_STORAGE, JSON.stringify(next)) } catch {}
  }

  const startResize = (col, fallback) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = e.currentTarget.parentElement.getBoundingClientRect().width || fallback
    let latest = null
    resizingRef.current = true
    document.body.classList.add('col-resizing')
    const onMove = (ev) => {
      const w = Math.max(MIN_WIDTH, Math.round(startW + ev.clientX - startX))
      setWidths(prev => (latest = { ...prev, [col]: w }))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('col-resizing')
      resizingRef.current = false
      if (latest) saveWidths(latest)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const resetWidth = (col) => () => {
    setWidths(prev => {
      const next = { ...prev }
      delete next[col]
      saveWidths(next)
      return next
    })
  }

  useImperativeHandle(apiRef, () => ({
    scrollToKey: (k) => {
      const idx = keys.indexOf(k)
      if (idx >= 0) virt.scrollToIndex(idx, { align: 'center' })
    },
    scrollToCell: (k, langCode) => {
      const idx = keys.indexOf(k)
      if (idx < 0) return
      virt.scrollToIndex(idx, { align: 'center', behavior: 'smooth' })
      // The row only exists in the DOM once virtualized into view, so the
      // horizontal adjustment has to wait for the vertical scroll to land.
      setTimeout(() => {
        parentRef.current?.querySelector(`[data-cell="${CSS.escape(`${langCode}:${k}`)}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
      }, 450)
    },
  }), [keys])
  const virt = useVirtualizer({
    count: keys.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  return (
    <div ref={parentRef} className="table-wrap" style={widthStyle}>
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
        <div className="tcell key sticky" style={{ left: 34, width: KEY_WIDTH }}>
          Key
          <ResizeHandle onStart={startResize('key', DEFAULT_WIDTH.key)} onReset={resetWidth('key')} />
        </div>
        {languages.map(lang => {
          const pct = keys.length ? Math.round((filledByLang[lang.code] || 0) / keys.length * 100) : 100
          const isDrag = dragCode === lang.code
          const isDrop = dropCode === lang.code && dragCode !== lang.code
          return (
            <div key={lang.code}
              className={`tcell val ${isDrag ? 'dragging' : ''} ${isDrop ? 'drop-target' : ''}`}
              style={{ display: 'flex', gap: 4, width: valWidth(lang.code) }}
              draggable={!!onReorderLang}
              onDragStart={(e) => {
                if (resizingRef.current) { e.preventDefault(); return }
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
              <ResizeHandle onStart={startResize('lang-' + lang.code, DEFAULT_WIDTH.val)} onReset={resetWidth('lang-' + lang.code)} />
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
                flashLang={flashCell?.key === k ? flashCell.lang : null}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
})
