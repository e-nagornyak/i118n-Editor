// `ua` / `cn` / `jp` / `kr` are country-code aliases — not canonical ISO 639-1
// but common in real projects. Mapped to the same flag/language/DeepL entry.
export const FLAG = { en:"🇬🇧", uk:"🇺🇦", ua:"🇺🇦", de:"🇩🇪", fr:"🇫🇷", es:"🇪🇸", pl:"🇵🇱", it:"🇮🇹", pt:"🇵🇹", nl:"🇳🇱", cs:"🇨🇿", ja:"🇯🇵", jp:"🇯🇵", zh:"🇨🇳", cn:"🇨🇳", ko:"🇰🇷", kr:"🇰🇷", ar:"🇸🇦", ru:"🇷🇺" }
export const LANG_NAMES = { en:"English", uk:"Ukrainian", ua:"Ukrainian", de:"German", fr:"French", es:"Spanish", pl:"Polish", it:"Italian", pt:"Portuguese", nl:"Dutch", cs:"Czech", ja:"Japanese", jp:"Japanese", zh:"Chinese", cn:"Chinese", ko:"Korean", kr:"Korean", ar:"Arabic", ru:"Russian" }
export const DEEPL_CODES = { en:"EN", uk:"UK", ua:"UK", de:"DE", fr:"FR", es:"ES", pl:"PL", it:"IT", pt:"PT-PT", nl:"NL", cs:"CS", ja:"JA", jp:"JA", zh:"ZH", cn:"ZH", ko:"KO", kr:"KO", ar:"AR", ru:"RU" }

export const flagFor = (l) => (l && l.flag) || (l && FLAG[l.code]) || "🌐"
export const translatorCodeFor = (l) => (l && l.translatorCode) || (l && l.code) || ""
export const deeplCodeFor = (l) => {
  const tc = translatorCodeFor(l)
  return DEEPL_CODES[tc] || DEEPL_CODES[l?.code] || tc.toUpperCase()
}

export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)
export const snap = (o) => JSON.parse(JSON.stringify(o))
