import { deeplCodeFor, translatorCodeFor } from './consts'
// Tauri's http plugin does the request from Rust so browser CORS doesn't
// apply — most translation APIs don't send Access-Control-Allow-Origin.
import { fetch } from '@tauri-apps/plugin-http'
import { log } from './logs'

// ── Provider selection & settings ───────────────────────────────────────────

export const PROVIDERS = [
  { id: 'deepl',    label: 'DeepL',           needsKey: true,  batch: true,  note: 'Best quality · API key required' },
  { id: 'mymemory', label: 'MyMemory',        needsKey: false, batch: false, note: 'Free · ~1000 words/day per IP' },
  { id: 'lingva',   label: 'Lingva Translate',needsKey: false, batch: false, note: 'Free Google Translate proxy · no key' },
  { id: 'google',   label: 'Google (unofficial)', needsKey: false, batch: false, note: 'Undocumented endpoint · may break anytime' },
  { id: 'libre',    label: 'LibreTranslate',  needsKey: false, batch: true,  note: 'Open-source · key optional depending on instance' },
]

export function getProvider() {
  const raw = localStorage.getItem('translate-provider')
  if (raw && PROVIDERS.some(p => p.id === raw)) return raw
  // Back-compat: honor the old DeepL toggle.
  if (localStorage.getItem('deepl-enabled') === 'true' && localStorage.getItem('deepl-key')) return 'deepl'
  return 'mymemory'
}

export function providerLabel() {
  return PROVIDERS.find(p => p.id === getProvider())?.label || 'MyMemory'
}

// Lingva has public instances that come and go — try each in order.
const LINGVA_INSTANCES = [
  'https://lingva.ml',
  'https://translate.plausibility.cloud',
  'https://lingva.thedaviddelta.com',
]
function libreConfig() {
  return {
    url: (localStorage.getItem('libre-url') || 'https://libretranslate.de').replace(/\/$/, ''),
    key: localStorage.getItem('libre-key') || '',
  }
}

// MyMemory & Lingva & Google expect ISO 639-1 — remap country-code aliases.
const CODE_ALIAS = { ua: 'uk', jp: 'ja', cn: 'zh-CN', kr: 'ko' }
function normalizeCode(code) {
  const c = String(code || '').toLowerCase()
  return CODE_ALIAS[c] || c
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function translateBatch({ texts, srcLang, tgtLang }) {
  if (!texts?.length) return { translations: [] }
  const provider = getProvider()
  const impl = IMPLS[provider] || IMPLS.mymemory
  return impl({ texts, srcLang, tgtLang })
}

export async function translateOne({ src, srcLang, tgtLang }) {
  const r = await translateBatch({ texts: [src], srcLang, tgtLang })
  if (r.error) return { text: null, error: r.error }
  return { text: r.translations[0] ?? null }
}

// ── DeepL ──────────────────────────────────────────────────────────────────
const DEEPL_BATCH = 50

async function deepl({ texts, srcLang, tgtLang }) {
  const key = localStorage.getItem('deepl-key') || ''
  if (!key) return { translations: new Array(texts.length).fill(null), error: 'DeepL API key not set (Settings → DeepL)' }
  const base = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com'
  const out = new Array(texts.length).fill(null)
  const srcCode = deeplCodeFor(srcLang), tgtCode = deeplCodeFor(tgtLang)
  for (let i = 0; i < texts.length; i += DEEPL_BATCH) {
    const chunk = texts.slice(i, i + DEEPL_BATCH)
    log.debug('deepl', `POST ${srcCode}→${tgtCode} · ${chunk.length}`, { first: chunk[0] })
    let res
    try {
      res = await fetch(`${base}/v2/translate`, {
        method: 'POST',
        headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunk, source_lang: srcCode, target_lang: tgtCode }),
      })
    } catch (e) { log.error('deepl', `network: ${e.message}`); return { translations: out, error: `Network: ${e.message}` } }
    if (res.status === 456 || res.status === 429) { log.error('deepl', `quota HTTP ${res.status}`); return { translations: out, error: `DeepL quota / rate limit (HTTP ${res.status})`, quota: true } }
    if (!res.ok) { const body = await res.text().catch(() => ''); log.error('deepl', `HTTP ${res.status}`, { body: body.slice(0, 400) }); return { translations: out, error: `DeepL HTTP ${res.status}: ${body.slice(0, 140)}` } }
    let data; try { data = await res.json() } catch { log.error('deepl', 'invalid JSON'); return { translations: out, error: 'DeepL: invalid JSON' } }
    const arr = data?.translations
    if (!Array.isArray(arr)) { log.error('deepl', 'unexpected shape', data); return { translations: out, error: 'DeepL: unexpected response' } }
    for (let j = 0; j < chunk.length; j++) out[i + j] = arr[j]?.text ?? null
    log.info('deepl', `ok ${chunk.length}`, { sample: arr[0]?.text })
  }
  return { translations: out }
}

// ── MyMemory ───────────────────────────────────────────────────────────────
async function mymemory({ texts, srcLang, tgtLang }) {
  const srcCode = normalizeCode(translatorCodeFor(srcLang))
  const tgtCode = normalizeCode(translatorCodeFor(tgtLang))
  const out = new Array(texts.length).fill(null)
  for (let i = 0; i < texts.length; i++) {
    const q = encodeURIComponent(texts[i])
    const pair = encodeURIComponent(`${srcCode}|${tgtCode}`)
    log.debug('mymemory', `GET ${srcCode}→${tgtCode}`, { text: texts[i] })
    let res
    try { res = await fetch(`https://api.mymemory.translated.net/get?q=${q}&langpair=${pair}`) }
    catch (e) { log.error('mymemory', `network: ${e.message}`); return { translations: out, error: `Network: ${e.message}` } }
    let data; try { data = await res.json() } catch { log.error('mymemory', 'invalid JSON'); return { translations: out, error: 'MyMemory: invalid JSON' } }
    const status = Number(data?.responseStatus)
    const details = data?.responseDetails || ''
    if (status === 429 || /QUERY LENGTH LIMIT|QUOTA|BANNED|MYMEMORY WARNING/i.test(details)) {
      log.error('mymemory', 'quota / rate limit', { status, details })
      return { translations: out, error: `MyMemory quota / rate limit: ${details || status}`, quota: true }
    }
    if (status !== 200) { log.warn('mymemory', `status ${status}`, { details }); out[i] = null; continue }
    out[i] = data?.responseData?.translatedText || null
  }
  log.info('mymemory', `ok ${out.filter(Boolean).length}/${texts.length}`)
  return { translations: out }
}

// ── Lingva ─────────────────────────────────────────────────────────────────
async function lingva({ texts, srcLang, tgtLang }) {
  const srcCode = normalizeCode(translatorCodeFor(srcLang))
  const tgtCode = normalizeCode(translatorCodeFor(tgtLang))
  const out = new Array(texts.length).fill(null)
  const custom = localStorage.getItem('lingva-url')
  const bases = custom ? [custom.replace(/\/$/, '')] : LINGVA_INSTANCES
  let instance = bases[0]
  for (let i = 0; i < texts.length; i++) {
    const q = encodeURIComponent(texts[i])
    let translated = null, lastErr = null
    // Try each instance until one answers — public Lingva mirrors go down
    // regularly, so failing over is essential.
    for (const base of bases) {
      log.debug('lingva', `GET ${base} ${srcCode}→${tgtCode}`, { text: texts[i] })
      try {
        const res = await fetch(`${base}/api/v1/${srcCode}/${tgtCode}/${q}`)
        if (!res.ok) { lastErr = `HTTP ${res.status} @ ${base}`; continue }
        const data = await res.json()
        if (data?.translation) { translated = data.translation; instance = base; break }
        lastErr = `no translation field @ ${base}`
      } catch (e) { lastErr = `${e.message} @ ${base}` }
    }
    if (translated == null) { log.warn('lingva', lastErr || 'all instances failed'); out[i] = null; continue }
    out[i] = translated
  }
  log.info('lingva', `ok ${out.filter(Boolean).length}/${texts.length} via ${instance}`)
  return { translations: out }
}

// ── Google (unofficial) ────────────────────────────────────────────────────
async function google({ texts, srcLang, tgtLang }) {
  const srcCode = normalizeCode(translatorCodeFor(srcLang))
  const tgtCode = normalizeCode(translatorCodeFor(tgtLang))
  const out = new Array(texts.length).fill(null)
  for (let i = 0; i < texts.length; i++) {
    const q = encodeURIComponent(texts[i])
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${srcCode}&tl=${tgtCode}&dt=t&q=${q}`
    log.debug('google', `GET ${srcCode}→${tgtCode}`, { text: texts[i] })
    let res
    try { res = await fetch(url) }
    catch (e) { log.error('google', `network: ${e.message}`); return { translations: out, error: `Network: ${e.message}` } }
    if (res.status === 429 || res.status === 403) {
      log.error('google', `blocked / rate limited HTTP ${res.status}`)
      return { translations: out, error: `Google blocked (HTTP ${res.status}) — try later or use another provider`, quota: true }
    }
    if (!res.ok) { log.warn('google', `HTTP ${res.status}`); out[i] = null; continue }
    let data; try { data = await res.json() } catch { log.warn('google', 'invalid JSON'); out[i] = null; continue }
    // Response format: [[[ "translated", "original", ... ], ...], ...]
    const parts = Array.isArray(data?.[0]) ? data[0].map(seg => seg?.[0] || '').join('') : ''
    out[i] = parts || null
  }
  log.info('google', `ok ${out.filter(Boolean).length}/${texts.length}`)
  return { translations: out }
}

// ── LibreTranslate ─────────────────────────────────────────────────────────
async function libre({ texts, srcLang, tgtLang }) {
  const { url, key } = libreConfig()
  const srcCode = normalizeCode(translatorCodeFor(srcLang))
  const tgtCode = normalizeCode(translatorCodeFor(tgtLang))
  const out = new Array(texts.length).fill(null)
  log.debug('libre', `POST ${url} ${srcCode}→${tgtCode} · ${texts.length}`)
  let res
  try {
    res = await fetch(`${url}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: texts, source: srcCode, target: tgtCode, format: 'text', ...(key ? { api_key: key } : {}) }),
    })
  } catch (e) { log.error('libre', `network: ${e.message}`); return { translations: out, error: `Network: ${e.message}` } }
  if (res.status === 429) { log.error('libre', 'rate limit'); return { translations: out, error: 'LibreTranslate rate limit', quota: true } }
  if (res.status === 403 || res.status === 401) { log.error('libre', 'auth/blocked'); return { translations: out, error: 'LibreTranslate requires API key on this instance', quota: true } }
  if (!res.ok) { const body = await res.text().catch(() => ''); log.error('libre', `HTTP ${res.status}`, { body: body.slice(0, 200) }); return { translations: out, error: `LibreTranslate HTTP ${res.status}: ${body.slice(0, 140)}` } }
  let data; try { data = await res.json() } catch { log.error('libre', 'invalid JSON'); return { translations: out, error: 'LibreTranslate: invalid JSON' } }
  const arr = Array.isArray(data?.translatedText) ? data.translatedText : (typeof data?.translatedText === 'string' ? [data.translatedText] : null)
  if (!arr) { log.error('libre', 'unexpected shape', data); return { translations: out, error: 'LibreTranslate: unexpected response' } }
  for (let i = 0; i < Math.min(arr.length, out.length); i++) out[i] = arr[i] || null
  log.info('libre', `ok ${out.filter(Boolean).length}/${texts.length}`)
  return { translations: out }
}

const IMPLS = { deepl, mymemory, lingva, google, libre }

// ── Connection test — used by Settings modal for any provider ──────────────
export async function testProvider(providerId) {
  const impl = IMPLS[providerId] || IMPLS.mymemory
  try {
    const r = await impl({ texts: ['Hello'], srcLang: { code: 'en' }, tgtLang: { code: 'uk' } })
    if (r.error) return { ok: false, msg: r.error }
    const t = r.translations?.[0]
    if (t) return { ok: true, msg: `✓ Works! "${t}"` }
    return { ok: false, msg: 'No translation returned' }
  } catch (e) { return { ok: false, msg: e.message } }
}
