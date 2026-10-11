import React, { useState, useEffect, useRef } from 'react'
import { AlertTriangle, Equal } from 'lucide-react'
import { describeIssue, issueSeverity } from '../lib/issues.js'

// Locally-owned input state so the parent's `translations` map isn't updated
// on every keystroke — commit on blur, or after ~700 ms of quiet typing.
export default function CellInput({ value, missing, placeholder, onCommit, issue, onIssueClick, onNavigate }) {
  const [local, setLocal] = useState(value ?? '')
  const [focused, setFocused] = useState(false)
  const timerRef = useRef(null)
  const taRef = useRef(null)

  useEffect(() => { setLocal(value ?? '') }, [value])

  const commit = (v) => {
    clearTimeout(timerRef.current)
    if (v === value) return
    onCommit(v)
  }
  const scheduleCommit = (v) => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => commit(v), 700)
  }

  // Multi-line only kicks in on focus if the value is long enough to wrap.
  // Otherwise stays a single-row input — keeps table looking neat.
  const isLong = (local?.length || 0) > 60 || (local?.includes('\n'))
  const multiLine = focused && isLong

  const commonProps = {
    className: `cell-input ${missing ? 'missing' : ''}`,
    value: local,
    placeholder,
    onFocus: () => setFocused(true),
    onBlur: () => { setFocused(false); commit(local) },
    onChange: (e) => { const v = e.target.value; setLocal(v); scheduleCommit(v) },
    onKeyDown: (e) => {
      if (e.key === 'Escape') { setLocal(value ?? ''); clearTimeout(timerRef.current); e.currentTarget.blur(); return }
      if (!onNavigate) {
        if (e.key === 'Enter' && !e.shiftKey && !multiLine) e.currentTarget.blur()
        return
      }
      // Moving focus blurs this input, which commits it.
      if (e.key === 'Enter' && (multiLine ? e.metaKey || e.ctrlKey : !e.shiftKey)) { e.preventDefault(); onNavigate(e.shiftKey ? -1 : 1) }
      else if (!multiLine && e.key === 'ArrowDown') { e.preventDefault(); onNavigate(1) }
      else if (!multiLine && e.key === 'ArrowUp') { e.preventDefault(); onNavigate(-1) }
    },
  }

  const severity = issueSeverity(issue)
  const clickable = !!(onIssueClick && (issue?.plural?.addKeys || issue?.same))

  return (
    <>
      {multiLine
        ? <textarea ref={taRef} rows={Math.min(6, (local.match(/\n/g)?.length || 0) + 2)} {...commonProps} style={{ resize: 'vertical', minHeight: 60, width: '100%' }} />
        : <input {...commonProps} />}
      {issue && (
        <span title={describeIssue(issue)} className={`ph-warn ${severity} ${clickable ? 'clickable' : ''}`}
          onMouseDown={clickable ? (e) => e.preventDefault() : undefined}
          onClick={clickable ? () => onIssueClick(issue) : undefined}>
          {severity === 'warn' ? <AlertTriangle size={12} /> : <Equal size={12} />}
        </span>
      )}
    </>
  )
}
