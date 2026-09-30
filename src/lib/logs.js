// Tiny in-memory ring buffer of log entries with a pub/sub so React views
// can subscribe with useSyncExternalStore. Not persistent across restarts.

const MAX = 500
let entries = []
let seq = 0
const listeners = new Set()

function notify() { for (const fn of listeners) fn() }

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getEntries() { return entries }

function push(level, category, message, data) {
  const e = {
    id: ++seq,
    ts: Date.now(),
    level,
    category,
    message,
    data: data == null ? undefined : safeSnapshot(data),
  }
  entries = entries.length >= MAX ? [...entries.slice(-MAX + 1), e] : [...entries, e]
  notify()
  // Also echo to devtools for people who like the console.
  const fn = console[level] || console.log
  fn(`[${category}]`, message, data ?? '')
}

function safeSnapshot(v) {
  try { return JSON.parse(JSON.stringify(v, replacer)) } catch { return String(v) }
}
function replacer(_k, v) {
  if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack }
  if (typeof v === 'string' && v.length > 800) return v.slice(0, 800) + `… (+${v.length - 800} chars)`
  return v
}

export const log = {
  debug: (c, m, d) => push('debug', c, m, d),
  info:  (c, m, d) => push('info',  c, m, d),
  warn:  (c, m, d) => push('warn',  c, m, d),
  error: (c, m, d) => push('error', c, m, d),
}

export function clearLogs() { entries = []; notify() }
