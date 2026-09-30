import React from 'react'
import CellInput from './CellInput.jsx'
import { flagFor } from '../lib/consts.js'

function buildTree(keys) {
  const root = {}
  for (const key of keys) {
    const parts = key.split('.')
    let node = root
    parts.forEach((p, i) => {
      if (!node[p]) node[p] = { __isLeaf: false, __children: {}, __fullKey: parts.slice(0, i + 1).join('.') }
      if (i === parts.length - 1) node[p].__isLeaf = true
      else node = node[p].__children
    })
  }
  return root
}

function Node({ name, node, depth, ctx }) {
  const {
    languages, translations, baseLanguage, expanded, toggleExpand,
    namespaceMissing, onCommit, onAutoTranslate, translating, onCopyKey, copiedKey,
  } = ctx
  const hasChildren = Object.keys(node.__children).length > 0
  const isExpanded = expanded[node.__fullKey]
  const missing = !node.__isLeaf ? (namespaceMissing[node.__fullKey] || 0) : 0

  return (
    <>
      <div className="tree-row" style={{ background: node.__isLeaf ? undefined : 'var(--surface-2)' }}>
        <div className="tree-key" style={{ paddingLeft: 12 + depth * 20 }}>
          {hasChildren
            ? <button className="tree-toggle" onClick={() => toggleExpand(node.__fullKey)}>{isExpanded ? '▾' : '▸'}</button>
            : <span style={{ width: 12 }} />}
          {node.__isLeaf ? (
            <button className={`copy-key ${copiedKey === node.__fullKey ? 'copied' : ''}`} onClick={() => onCopyKey(node.__fullKey)}>
              {copiedKey === node.__fullKey ? '✓ Copied!' : name}
            </button>
          ) : (
            <>
              <strong style={{ fontSize: 12.5, color: 'var(--text-sub)' }}>{name}</strong>
              {missing > 0 && <span className="badge warn">{missing} missing</span>}
              {missing === 0 && hasChildren && <span className="badge">{Object.keys(node.__children).length}</span>}
            </>
          )}
        </div>
        {node.__isLeaf
          ? languages.map(lang => {
              const val = translations[lang.code]?.[node.__fullKey] ?? ''
              const empty = !val
              const tKey = `${node.__fullKey}-${lang.code}`
              return (
                <div key={lang.code} className={`tcell val ${empty ? 'missing' : ''}`}>
                  <CellInput
                    value={val}
                    missing={empty}
                    placeholder={lang.code === baseLanguage ? '— base —' : 'missing…'}
                    onCommit={(v) => onCommit(lang.code, node.__fullKey, v)}
                  />
                  {lang.code !== baseLanguage && (
                    <button className="translate-btn" onClick={() => onAutoTranslate(node.__fullKey, lang.code)} disabled={!!translating[tKey]}>
                      {translating[tKey] ? '⏳' : '✨'}
                    </button>
                  )}
                </div>
              )
            })
          : languages.map(l => <div key={l.code} className="tcell val" />)}
      </div>
      {hasChildren && isExpanded && Object.entries(node.__children).map(([n, c]) => (
        <Node key={c.__fullKey} name={n} node={c} depth={depth + 1} ctx={ctx} />
      ))}
    </>
  )
}

export default function TreeView({ keys, ...rest }) {
  const tree = React.useMemo(() => buildTree(keys), [keys])
  const ctx = rest
  return (
    <div className="table-wrap">
      <div className="trow header">
        <div className="tree-key" style={{ paddingLeft: 12 }}>Key</div>
        {rest.languages.map(l => (
          <div key={l.code} className="tcell val" style={{ display: 'flex', gap: 4 }}>
            <span>{flagFor(l)}</span>
            <span>{l.label}</span>
            {l.code === rest.baseLanguage && <span style={{ fontSize: 10, color: 'var(--accent)' }}>base</span>}
          </div>
        ))}
      </div>
      {Object.entries(tree).map(([n, node]) => (
        <Node key={node.__fullKey} name={n} node={node} depth={0} ctx={ctx} />
      ))}
    </div>
  )
}
