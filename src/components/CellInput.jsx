import React, { useState, useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'

// Locally-owned input state so the parent's `translations` map isn't updated
// on every keystroke — commit on blur, or after ~700 ms of quiet typing.
export default function CellInput({ value, missing, placeholder, onCommit, issue }) {
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
      if (e.key === 'Enter' && !e.shiftKey && !multiLine) { e.currentTarget.blur() }
      if (e.key === 'Escape') { setLocal(value ?? ''); clearTimeout(timerRef.current); e.currentTarget.blur() }
    },
  }

  const title = issue
    ? [
        issue.missing?.length ? `Missing placeholders: ${issue.missing.join(', ')}` : null,
        issue.extra?.length   ? `Extra placeholders: ${issue.extra.join(', ')}`     : null,
      ].filter(Boolean).join('\n')
    : undefined

  return (
    <>
      {multiLine
        ? <textarea ref={taRef} rows={Math.min(6, (local.match(/\n/g)?.length || 0) + 2)} {...commonProps} style={{ resize: 'vertical', minHeight: 60, width: '100%' }} />
        : <input {...commonProps} />}
      {issue && (
        <span title={title} className="ph-warn"><AlertTriangle size={12} /></span>
      )}
    </>
  )
}
