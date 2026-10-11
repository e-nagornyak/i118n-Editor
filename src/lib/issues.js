import { scanPlaceholderIssues, parseMessage } from './placeholders.js'

// Country-code aliases that Intl.PluralRules doesn't know.
const PLURAL_LOCALE_ALIAS = { ua: 'uk', by: 'be', rs: 'sr', cz: 'cs', gr: 'el', jp: 'ja', cn: 'zh', kr: 'ko', se: 'sv', dk: 'da', ee: 'et' }
const PLURAL_SUFFIX = /^(.*)_(zero|one|two|few|many|other)$/
const ICU_PLURAL = /,\s*(?:plural|selectordinal)\s*,/

const categoriesCache = new Map()
export function pluralCategories(lang) {
  const code = String(lang?.translatorCode || lang?.code || '').toLowerCase()
  if (!categoriesCache.has(code)) {
    let cats = ['one', 'other']
    try { cats = new Intl.PluralRules(PLURAL_LOCALE_ALIAS[code] || code).resolvedOptions().pluralCategories } catch {}
    // `zero` is optional in both i18next and ICU — never demand it.
    categoriesCache.set(code, cats.filter(c => c !== 'zero'))
  }
  return categoriesCache.get(code)
}

const letterCount = (s) => (s.match(/\p{L}/gu) || []).length
const isLatin = (s) => !/[^\p{Script=Latin}\P{L}]/u.test(s)

// Whether a locale writes in Latin script — decided per top-level namespace,
// because real files mix (a Cyrillic `rs.json` with a Latin `amazon.*`
// section). Only values that differ from the base count, otherwise a section
// nobody translated would vouch for itself.
const MIN_LETTERS = 100
function latinScriptResolver(map, baseMap) {
  const tally = new Map()
  const file = { latin: 0, total: 0 }
  for (const [k, v] of Object.entries(map || {})) {
    if (typeof v !== 'string' || !v || v.trim() === (baseMap[k] || '').trim()) continue
    const ns = k.split('.')[0]
    const t = tally.get(ns) || tally.set(ns, { latin: 0, total: 0 }).get(ns)
    for (const ch of v.replace(/\{[^{}]*\}/g, '')) {
      if (!/\p{L}/u.test(ch)) continue
      const latin = /\p{Script=Latin}/u.test(ch) ? 1 : 0
      t.total++; t.latin += latin
      file.total++; file.latin += latin
    }
  }
  const fileLatin = file.total ? file.latin / file.total >= 0.5 : true
  return (key) => {
    const t = tally.get(key.split('.')[0])
    return t && t.total >= MIN_LETTERS ? t.latin / t.total >= 0.5 : fileLatin
  }
}

// A value equal to the base text is only suspicious when it stands out:
//  • most other languages kept it too → it's a term or brand ("Buy Box"), skip;
//  • Latin text in a non-Latin locale ("Proceeds" in ua) → flag;
//  • in a Latin-script locale single words are often real cognates
//    ("Status" in pl), so only whole phrases are flagged.
function looksUntranslated({ baseStr, sameCount, translatedCount, latinLocale }) {
  if (translatedCount > 1 && sameCount / translatedCount >= 0.6) return false
  const text = [...parseMessage(baseStr).tokens].length ? baseStr.replace(/\{[^{}]*\}/g, ' ') : baseStr
  if (letterCount(text) < 4) return false
  if (!latinLocale && isLatin(text)) return true
  return text.trim().split(/\s+/).filter(w => /\p{L}{2,}/u.test(w)).length >= 3
}

// Returns { "lang:key": { placeholder?, plural?, same? } }.
//   placeholder: { missing: [], extra: [] }
//   plural:      { missing: ['few', 'many'], base: 'items', addKeys: ['items_few', …] | null }
//   same:        true — value identical to the base language
export function scanIssues({ translations, languages, baseLanguage, keys, ignored }) {
  const out = {}
  const add = (lang, key, type, data) => {
    const id = `${lang}:${key}`
    ;(out[id] ||= {})[type] = data
  }

  const ph = scanPlaceholderIssues({ translations, languages, baseLanguage, keys })
  for (const [id, v] of Object.entries(ph)) {
    const i = id.indexOf(':')
    add(id.slice(0, i), id.slice(i + 1), 'placeholder', v)
  }

  const baseMap = translations[baseLanguage] || {}
  const targets = languages.filter(l => l.code !== baseLanguage)
  const keySet = new Set(keys)

  // i18next-style plural groups: items_one / items_other / …
  const groups = new Map()
  for (const k of keys) {
    const m = PLURAL_SUFFIX.exec(k)
    if (m) (groups.get(m[1]) || groups.set(m[1], []).get(m[1])).push(m[2])
  }
  for (const [base, forms] of groups) {
    if (!forms.some(f => baseMap[`${base}_${f}`])) continue
    for (const lang of targets) {
      const tr = translations[lang.code] || {}
      const filled = forms.filter(f => tr[`${base}_${f}`])
      // A language with nothing filled is just untranslated — the missing
      // counter already covers it.
      if (!filled.length) continue
      const missing = pluralCategories(lang).filter(c => !filled.includes(c))
      if (!missing.length) continue
      const anchor = forms.includes('other') ? `${base}_other` : `${base}_${filled[0]}`
      const addKeys = missing.map(c => `${base}_${c}`).filter(k => !keySet.has(k))
      add(lang.code, anchor, 'plural', { missing, base, addKeys: addKeys.length ? addKeys : null })
    }
  }

  const isLatinAt = Object.fromEntries(targets.map(l => [l.code, latinScriptResolver(translations[l.code], baseMap)]))
  for (const key of keys) {
    const baseStr = baseMap[key]
    if (!baseStr) continue
    const basePlurals = ICU_PLURAL.test(baseStr) ? parseMessage(baseStr).plurals : null
    const trimmed = baseStr.trim()
    let sameCount = 0, translatedCount = 0
    for (const lang of targets) {
      const val = translations[lang.code]?.[key]
      if (!val) continue
      translatedCount++
      if (val.trim() === trimmed) sameCount++
    }
    for (const lang of targets) {
      const val = translations[lang.code]?.[key]
      if (!val) continue
      if (basePlurals?.size) {
        // Rephrasing without a plural ("Days left: {days}") is fine — only a
        // plural block that exists but lacks categories is a bug.
        const trPlurals = parseMessage(val).plurals
        const missing = new Set()
        for (const arg of basePlurals.keys()) {
          const sel = trPlurals.get(arg)
          if (!sel) continue
          for (const c of pluralCategories(lang)) if (!sel.has(c)) missing.add(c)
        }
        if (missing.size) add(lang.code, key, 'plural', { missing: [...missing], base: null, addKeys: null })
      }
      if (val.trim() === trimmed && !ignored?.has(`${lang.code}:${key}`)
        && looksUntranslated({ baseStr, sameCount, translatedCount, latinLocale: isLatinAt[lang.code](key) })) {
        add(lang.code, key, 'same', true)
      }
    }
  }
  return out
}

export function describeIssue(issue) {
  if (!issue) return ''
  const lines = []
  if (issue.placeholder?.missing?.length) lines.push(`Missing placeholders: ${issue.placeholder.missing.join(', ')}`)
  if (issue.placeholder?.extra?.length) lines.push(`Extra placeholders: ${issue.placeholder.extra.join(', ')}`)
  if (issue.plural) {
    lines.push(`Missing plural forms: ${issue.plural.missing.join(', ')}`)
    if (issue.plural.addKeys) lines.push(`Click to add ${issue.plural.addKeys.join(', ')}`)
  }
  if (issue.same) lines.push('Same as base language — not translated?\nClick to mark as intentional')
  return lines.join('\n')
}

export const issueSeverity = (issue) => (issue?.placeholder || issue?.plural) ? 'warn' : 'info'
