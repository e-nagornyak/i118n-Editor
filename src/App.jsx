import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  Save, RotateCw, Undo2, Redo2, Sun, Moon, Settings as SettingsIcon,
  Plus, Trash2, Search, FolderKanban, ArrowRightLeft, TreePine, Table as TableIcon,
  Sparkles, PauseCircle, ChevronRight, Filter, Command as CmdIcon,
} from 'lucide-react'
import { api } from './lib/api.js'
import { FLAG, LANG_NAMES, flagFor, uid, snap } from './lib/consts.js'
import { translateOne, translateBatch, getProvider, providerLabel, PROVIDERS } from './lib/translate.js'
import { scanPlaceholderIssues } from './lib/placeholders.js'
import VirtualTable from './components/VirtualTable.jsx'
import TreeView from './components/TreeView.jsx'
import LogsView from './components/LogsView.jsx'
import CommandPalette from './components/CommandPalette.jsx'
import FindReplaceModal from './components/FindReplace.jsx'
import { log } from './lib/logs.js'
import {
  Confirm, SettingsModal, AutoTranslateModal, DiffModal, NewProjectModal, LangEditModal,
} from './components/Modals.jsx'

export default function App() {
  // ── Theme ─────────────────────────────────────────────────────────────────
  const [isDark, setIsDark] = useState(() => (localStorage.getItem('i18n-theme') || 'light') === 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
    try { localStorage.setItem('i18n-theme', isDark ? 'dark' : 'light') } catch {}
  }, [isDark])

  // ── Data ──────────────────────────────────────────────────────────────────
  const [projects, setProjects] = useState([])
  const [currentProjectId, setCurrentProjectId] = useState(null)
  const [translations, setTranslations] = useState({})
  const [baseLanguage, setBaseLanguage] = useState('en')
  const [stats, setStats] = useState({ allKeys: [], filled: {}, missingTotal: 0, namespaceMissing: {} })
  const formatsRef = useRef({}) // langCode → JsonFormat cache

  // ── UI ────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('translations')
  const [viewMode, setViewMode] = useState('table')
  const [search, setSearch] = useState('')
  const [showEmptyOnly, setShowEmptyOnly] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newLangCode, setNewLangCode] = useState('')
  const [newLangLabel, setNewLangLabel] = useState('')
  const [editingLang, setEditingLang] = useState(null)
  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
  const [translating, setTranslating] = useState({})
  const [autoConfig, setAutoConfig] = useState(null)
  const [autoRunning, setAutoRunning] = useState(null)
  const autoCancelRef = useRef(false)
  const [toast, setToast] = useState(null)
  const [confirmDlg, setConfirmDlg] = useState(null)
  const [treeExpanded, setTreeExpanded] = useState({})
  const [rewriting, setRewriting] = useState(false)
  const [rewriteStatus, setRewriteStatus] = useState(null)
  const [diffData, setDiffData] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectFolder, setNewProjectFolder] = useState(null)
  const [copiedKey, setCopiedKey] = useState(null)
  const [renamingProjectId, setRenamingProjectId] = useState(null)
  const [dragLangCode, setDragLangCode] = useState(null)
  const [dropTargetLangCode, setDropTargetLangCode] = useState(null)
  const [showPalette, setShowPalette] = useState(false)
  const [showFindReplace, setShowFindReplace] = useState(false)
  const [dirtyLangs, setDirtyLangs] = useState(() => new Set())
  const [placeholderIssues, setPlaceholderIssues] = useState({})
  const tableRef = useRef(null)

  // ── History (undo / redo) ────────────────────────────────────────────────
  const histRef = useRef({ stack: [], pos: -1 })
  const transRef = useRef({})
  const debTimerRef = useRef(null)
  useEffect(() => { transRef.current = translations }, [translations])
  const pushHistory = useCallback((s) => {
    const { stack, pos } = histRef.current
    const next = [...stack.slice(0, pos + 1), snap(s)]
    if (next.length > 60) next.shift()
    histRef.current = { stack: next, pos: next.length - 1 }
  }, [])
  const recordNow = useCallback((s) => { clearTimeout(debTimerRef.current); pushHistory(s) }, [pushHistory])
  const recordDebounced = useCallback(() => {
    clearTimeout(debTimerRef.current)
    debTimerRef.current = setTimeout(() => pushHistory(transRef.current), 700)
  }, [pushHistory])
  const undo = useCallback(() => {
    const { stack, pos } = histRef.current
    if (pos <= 0) return
    histRef.current = { stack, pos: pos - 1 }
    setTranslations(snap(stack[pos - 1]))
    showToast('↩ Undo', 'info')
  }, [])
  const redo = useCallback(() => {
    const { stack, pos } = histRef.current
    if (pos >= stack.length - 1) return
    histRef.current = { stack, pos: pos + 1 }
    setTranslations(snap(stack[pos + 1]))
    showToast('↪ Redo', 'info')
  }, [])
  const canUndo = histRef.current.pos > 0
  const canRedo = histRef.current.pos < histRef.current.stack.length - 1
  useEffect(() => {
    const handler = (e) => {
      const cmd = e.metaKey || e.ctrlKey
      if (!cmd) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if (e.key === 'z' && e.shiftKey)  { e.preventDefault(); redo() }
      if (e.key === 'y')                { e.preventDefault(); redo() }
      if (e.key === 'k')                { e.preventDefault(); setShowPalette(v => !v) }
      if (e.key === 'f' && e.shiftKey)  { e.preventDefault(); setShowFindReplace(true) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

  // ── Initial load + splash handoff ────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const saved = await api.getProjects()
        setProjects(saved || [])
        const lastId = await api.getLastProject()
        const target = (saved || []).find(p => p.id === lastId) || (saved || [])[0]
        if (target) {
          setCurrentProjectId(target.id)
          setBaseLanguage(target.baseLanguage || target.languages?.[0]?.code || 'en')
          await loadProject(target)
        }
      } finally {
        // Close splash + reveal main window. Even on error we should not
        // leave the user staring at a splash.
        api.appReady().catch(() => {})
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentProject = useMemo(() => projects.find(p => p.id === currentProjectId) || null, [projects, currentProjectId])
  const languages = currentProject?.languages || []

  // ── Project loading ──────────────────────────────────────────────────────
  const loadProject = async (project) => {
    log.info('project', `load "${project.name}"`, { langs: project.languages.map(l => l.code), localesPath: project.localesPath })
    const res = await api.loadProject(project)
    log.info('project', `loaded ${res.all_keys.length} keys · ${Object.keys(res.translations).length} langs · ${res.missing_total} missing${res.added_languages?.length ? ` · +${res.added_languages.length} new lang(s)` : ''}`)
    setTranslations(res.translations)
    formatsRef.current = res.formats
    setStats({
      allKeys: res.all_keys,
      filled: res.filled,
      missingTotal: res.missing_total,
      namespaceMissing: {}, // computed on demand after edits
    })
    histRef.current = { stack: [snap(res.translations)], pos: 0 }
    setDirtyLangs(new Set())
    // Persist any auto-added languages from folder scan
    if (res.added_languages?.length) {
      setProjects(prev => prev.map(p => p.id === project.id ? res.project : p))
      await api.saveProject(res.project)
    }
    // Kick off namespace-missing calc (rust) in background
    refreshStats(res.translations, res.project.languages)
  }

  const refreshStats = useCallback(async (trans, langs) => {
    try {
      const r = await api.computeStats({ translations: trans, languages: langs.map(l => l.code) })
      setStats({
        allKeys: r.all_keys,
        filled: r.filled,
        missingTotal: r.missing_total,
        namespaceMissing: r.namespace_missing,
      })
    } catch (e) { /* non-critical */ }
  }, [])

  // Debounce stats refresh so it doesn't fire on every single commit.
  const statsTimerRef = useRef(null)
  const scheduleStats = useCallback(() => {
    clearTimeout(statsTimerRef.current)
    statsTimerRef.current = setTimeout(() => {
      refreshStats(transRef.current, languages)
    }, 400)
  }, [languages, refreshStats])

  // Placeholder validation — cheap, run debounced whenever translations or
  // keys shift. Doing it in the renderer is fine for 5k keys × 10 langs.
  const phTimerRef = useRef(null)
  useEffect(() => {
    clearTimeout(phTimerRef.current)
    phTimerRef.current = setTimeout(() => {
      if (!languages.length || !stats.allKeys.length) { setPlaceholderIssues({}); return }
      const issues = scanPlaceholderIssues({
        translations, languages, baseLanguage, keys: stats.allKeys,
      })
      setPlaceholderIssues(issues)
    }, 500)
    return () => clearTimeout(phTimerRef.current)
  }, [translations, languages, baseLanguage, stats.allKeys])

  // File watcher — subscribe once on mount; the Rust side pushes debounced
  // change events for the current project's locales folder.
  const dirtyLangsRef = useRef(dirtyLangs)
  useEffect(() => { dirtyLangsRef.current = dirtyLangs }, [dirtyLangs])
  const reloadRef = useRef(null)
  useEffect(() => { reloadRef.current = reloadFromDisk })
  useEffect(() => {
    let unlisten = null
    ;(async () => {
      unlisten = await listen('locales:changed', (e) => {
        const paths = e.payload || []
        log.info('watcher', `changed on disk (${paths.length})`, { first: paths[0] })
        if (dirtyLangsRef.current.size === 0) {
          reloadRef.current?.({ silent: true })
        } else {
          showToast('⚠ Files changed on disk — click Reload (unsaved edits blocking auto)', 'info')
        }
      })
    })()
    return () => { if (unlisten) unlisten() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Start/stop the OS watcher when the current project's locales folder changes.
  useEffect(() => {
    const path = currentProject?.localesPath
    if (path) api.watchFolder(path).catch(e => log.warn('watcher', `watch failed: ${e}`))
    else api.unwatchFolder().catch(() => {})
    return () => { api.unwatchFolder().catch(() => {}) }
  }, [currentProject?.localesPath])

  // ── Project management ──────────────────────────────────────────────────
  const persistProject = async (updated) => {
    setProjects(prev => {
      const i = prev.findIndex(p => p.id === updated.id)
      const n = [...prev]
      if (i >= 0) n[i] = updated; else n.push(updated)
      return n
    })
    await api.saveProject(updated)
  }

  const switchProject = async (id) => {
    const p = projects.find(x => x.id === id); if (!p) return
    setCurrentProjectId(id)
    setBaseLanguage(p.baseLanguage || p.languages?.[0]?.code || 'en')
    setSearch(''); setShowEmptyOnly(false); setSelectedKeys(new Set())
    await api.setLastProject(id)
    await loadProject(p)
  }

  const createProject = async (name) => {
    const proj = { id: uid(), name, baseLanguage: 'en', languages: [], localesPath: newProjectFolder || null }
    await persistProject(proj)
    setCurrentProjectId(proj.id); setBaseLanguage('en')
    await api.setLastProject(proj.id)
    if (proj.localesPath) await loadProject(proj)
    else {
      setTranslations({}); setStats({ allKeys: [], filled: {}, missingTotal: 0, namespaceMissing: {} })
      histRef.current = { stack: [{}], pos: 0 }
    }
    setNewProjectFolder(null); setShowNewProject(false)
    showToast(`Project "${name}" created`)
  }

  const renameProject = async (id, newName) => {
    const trimmed = (newName || '').trim()
    setRenamingProjectId(null)
    const proj = projects.find(p => p.id === id); if (!proj) return
    if (!trimmed || trimmed === proj.name) return
    await persistProject({ ...proj, name: trimmed })
    showToast(`Renamed to "${trimmed}"`)
  }

  const reorderLanguages = async (fromCode, toCode) => {
    if (!currentProject || fromCode === toCode) return
    const langs = [...currentProject.languages]
    const fromIdx = langs.findIndex(l => l.code === fromCode)
    const toIdx = langs.findIndex(l => l.code === toCode)
    if (fromIdx < 0 || toIdx < 0) return
    const [moved] = langs.splice(fromIdx, 1)
    langs.splice(toIdx, 0, moved)
    await persistProject({ ...currentProject, languages: langs })
    log.info('lang', `reordered ${fromCode} → position of ${toCode}`)
  }

  const deleteProject = (id) => {
    setConfirmDlg({
      message: `Delete project "${projects.find(p => p.id === id)?.name}"?`,
      onConfirm: async () => {
        await api.deleteProject(id)
        setProjects(prev => prev.filter(p => p.id !== id))
        if (currentProjectId === id) {
          const rem = projects.filter(p => p.id !== id)
          if (rem.length) switchProject(rem[0].id)
          else { setCurrentProjectId(null); setTranslations({}); setStats({ allKeys: [], filled: {}, missingTotal: 0, namespaceMissing: {} }) }
        }
      },
    })
  }

  const setLocalesFolder = async () => {
    if (!currentProject) return
    const dir = await api.pickDirectory('Select locales folder')
    if (!dir) return
    const updated = { ...currentProject, localesPath: dir }
    await persistProject(updated)
    const before = updated.languages.length
    await loadProject(updated)
    const after = (await api.getProjects()).find(p => p.id === updated.id)?.languages?.length || before
    showToast(after > before ? `📁 Folder set · added ${after - before} language(s)` : '📁 Folder set')
  }

  const rescanLocales = async () => {
    if (!currentProject?.localesPath) return
    const before = currentProject.languages.length
    await loadProject(currentProject)
    const after = (await api.getProjects()).find(p => p.id === currentProject.id)?.languages?.length || before
    showToast(after > before ? `↻ Rescan · added ${after - before} language(s)` : '↻ Rescan · nothing new')
  }

  // Full disk re-read — picks up new keys added externally (e.g. from code)
  // and any new locale files in the folder. Discards in-memory unsaved edits,
  // so warn first if there's history to lose.
  const [reloading, setReloading] = useState(false)
  const reloadFromDisk = async (opts = {}) => {
    if (!currentProject) return
    const hasUnsavedEdits = dirtyLangs.size > 0 || histRef.current.pos > 0
    const doReload = async () => {
      setReloading(true)
      const keysBefore = new Set(allKeys)
      const langsBefore = currentProject.languages.length
      try {
        await loadProject(currentProject)
        const keysAfter = new Set()
        for (const m of Object.values(transRef.current)) for (const k of Object.keys(m)) keysAfter.add(k)
        const added = [...keysAfter].filter(k => !keysBefore.has(k)).length
        const removed = [...keysBefore].filter(k => !keysAfter.has(k)).length
        const langsAfter = (await api.getProjects()).find(p => p.id === currentProject.id)?.languages?.length || langsBefore
        const langDelta = langsAfter - langsBefore
        const parts = []
        if (added) parts.push(`+${added} keys`)
        if (removed) parts.push(`−${removed} keys`)
        if (langDelta > 0) parts.push(`+${langDelta} language(s)`)
        if (!opts.silent || parts.length) {
          showToast(parts.length ? `↻ Reloaded · ${parts.join(', ')}` : '↻ Reloaded · no changes')
        }
      } finally {
        setReloading(false)
      }
    }
    if (opts.silent) return doReload()
    if (hasUnsavedEdits) {
      setConfirmDlg({
        message: 'Reload will discard unsaved changes from memory. Continue?',
        onConfirm: doReload,
        confirmLabel: '↻ Reload',
        variant: 'primary',
      })
    } else {
      doReload()
    }
  }

  // ── Keys ────────────────────────────────────────────────────────────────
  const allKeys = stats.allKeys
  const filteredKeys = useMemo(() => {
    const q = search.toLowerCase()
    return allKeys.filter(k => {
      if (showEmptyOnly && !languages.some(l => !translations[l.code]?.[k])) return false
      if (!q) return true
      if (k.toLowerCase().includes(q)) return true
      return languages.some(l => (translations[l.code]?.[k] || '').toLowerCase().includes(q))
    })
  }, [allKeys, search, showEmptyOnly, languages, translations])

  const searchNamespace = useMemo(() => {
    if (!search || !search.includes('.')) return null
    if (!/^[\w][\w.-]*$/.test(search) || search.endsWith('.')) return null
    return allKeys.some(k => k.startsWith(search + '.')) ? search : null
  }, [search, allKeys])

  const computedNewKey = useMemo(() => {
    const k = newKey.trim()
    if (!k || !searchNamespace) return k
    if (k.startsWith(searchNamespace + '.') || k.includes('.')) return k
    return `${searchNamespace}.${k}`
  }, [newKey, searchNamespace])

  // ── Cell commit (the hot path) ──────────────────────────────────────────
  // Called from CellInput on blur or after 700ms of quiet typing. Because
  // typing itself is local, the global map only changes at "commit points".
  const commitValue = useCallback((langCode, key, value) => {
    setTranslations(p => {
      const langMap = { ...(p[langCode] || {}), [key]: value }
      const next = { ...p, [langCode]: langMap }
      transRef.current = next
      return next
    })
    setDirtyLangs(prev => prev.has(langCode) ? prev : new Set(prev).add(langCode))
    recordDebounced()
    scheduleStats()
  }, [recordDebounced, scheduleStats])

  const mutate = (fn) => {
    setTranslations(prev => {
      const next = fn(prev)
      recordNow(next)
      transRef.current = next
      // Any structural change (add/rename/delete key, bulk edit) touches
      // every language file — mark them all dirty for the save indicator.
      setDirtyLangs(new Set(languages.map(l => l.code)))
      refreshStats(next, languages)
      return next
    })
  }

  const addKey = () => {
    const k = computedNewKey
    if (!k) return
    if (allKeys.includes(k)) { showToast('Key already exists', 'error'); return }
    mutate(prev => {
      const next = { ...prev }
      languages.forEach(l => { next[l.code] = { ...next[l.code], [k]: '' } })
      return next
    })
    setNewKey(''); showToast(`Key "${k}" added`)
  }

  const deleteKey = (key) => setConfirmDlg({
    message: `Delete key "${key}"?`,
    onConfirm: () => {
      mutate(prev => {
        const next = { ...prev }
        languages.forEach(l => {
          const { [key]: _, ...rest } = next[l.code] || {}
          next[l.code] = rest
        })
        return next
      })
      setSelectedKeys(prev => { if (!prev.has(key)) return prev; const n = new Set(prev); n.delete(key); return n })
    },
  })

  // ── Bulk selection ──────────────────────────────────────────────────────
  const toggleKeySelection = useCallback((k) => {
    setSelectedKeys(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }, [])
  const filteredSelectionState = useMemo(() => {
    if (!filteredKeys.length) return { checked: false, indeterminate: false }
    let n = 0; for (const k of filteredKeys) if (selectedKeys.has(k)) n++
    if (n === 0) return { checked: false, indeterminate: false }
    if (n === filteredKeys.length) return { checked: true, indeterminate: false }
    return { checked: false, indeterminate: true }
  }, [filteredKeys, selectedKeys])
  const toggleSelectAllFiltered = () => {
    setSelectedKeys(prev => {
      const n = new Set(prev)
      const allSelected = filteredKeys.every(k => n.has(k))
      if (allSelected) filteredKeys.forEach(k => n.delete(k))
      else filteredKeys.forEach(k => n.add(k))
      return n
    })
  }
  const bulkDelete = () => {
    const keys = [...selectedKeys]; if (!keys.length) return
    setConfirmDlg({
      message: `Delete ${keys.length} key${keys.length !== 1 ? 's' : ''}?`,
      onConfirm: () => {
        mutate(prev => {
          const next = { ...prev }
          languages.forEach(l => {
            const tr = { ...(next[l.code] || {}) }
            keys.forEach(k => { delete tr[k] })
            next[l.code] = tr
          })
          return next
        })
        setSelectedKeys(new Set())
        showToast(`✓ Deleted ${keys.length} key${keys.length !== 1 ? 's' : ''}`)
      },
    })
  }
  const askBulkAutoTranslate = () => {
    const keys = [...selectedKeys]; if (!keys.length) return
    const nonBase = languages.filter(l => l.code !== baseLanguage)
    if (!nonBase.length) { showToast('No target languages', 'error'); return }
    let count = 0
    nonBase.forEach(l => keys.forEach(k => { if (!translations[l.code]?.[k] && translations[baseLanguage]?.[k]) count++ }))
    if (!count) { showToast('Nothing to translate for selection'); return }
    setAutoConfig({ bulk: true, langCode: null, langLabel: `${nonBase.length} language${nonBase.length !== 1 ? 's' : ''}`, langFlag: '🌐', count, bulkKeys: keys })
  }

  // ── Languages ───────────────────────────────────────────────────────────
  const addLanguage = async () => {
    if (!currentProject) { showToast('Create a project first', 'error'); return }
    const code = newLangCode.trim().toLowerCase(); if (!code) return
    if (languages.find(l => l.code === code)) { showToast('Already exists', 'error'); return }
    const label = newLangLabel.trim() || LANG_NAMES[code] || code.toUpperCase()
    const picked = await api.pickJson(`Select JSON for ${label} (optional)`)
    let flat = {}
    if (picked?.content) {
      try {
        const parsed = JSON.parse(picked.content)
        flat = flatten(parsed)
      } catch {}
    }
    const newLang = { code, label, filePath: picked?.filePath || null }
    const updated = { ...currentProject, languages: [...currentProject.languages, newLang] }
    await persistProject(updated)
    mutate(prev => ({ ...prev, [code]: flat }))
    setNewLangCode(''); setNewLangLabel('')
    showToast(`Language "${label}" added`)
  }

  const removeLanguage = (code) => {
    setConfirmDlg({
      message: `Remove language "${languages.find(l => l.code === code)?.label || code}"?`,
      onConfirm: async () => {
        const updated = { ...currentProject, languages: currentProject.languages.filter(l => l.code !== code) }
        await persistProject(updated)
        mutate(prev => { const { [code]: _, ...rest } = prev; return rest })
        if (baseLanguage === code) setBaseLanguage(languages.find(l => l.code !== code)?.code || 'en')
      },
    })
  }

  const saveEditLanguage = async (draft) => {
    const lang = languages.find(l => l.code === editingLang)
    if (!lang) return
    const label = (draft.label || '').trim() || LANG_NAMES[lang.code] || lang.code.toUpperCase()
    const flag = (draft.flag || '').trim()
    const translatorCode = (draft.translatorCode || '').trim()
    const updated = {
      ...currentProject,
      languages: currentProject.languages.map(l => l.code === editingLang ? {
        ...l, label,
        flag: flag || undefined,
        translatorCode: translatorCode || undefined,
      } : l),
    }
    await persistProject(updated)
    setEditingLang(null)
    showToast(`"${label}" updated`)
  }

  const importLanguageFile = async (langCode) => {
    const picked = await api.pickJson(`Import JSON for ${langCode}`); if (!picked) return
    let flat = {}
    try { flat = flatten(JSON.parse(picked.content)) } catch { showToast('Invalid JSON', 'error'); return }
    mutate(prev => ({ ...prev, [langCode]: flat }))
    const updated = { ...currentProject, languages: currentProject.languages.map(l => l.code === langCode ? { ...l, filePath: picked.filePath } : l) }
    await persistProject(updated)
    showToast(`Imported ${Object.keys(flat).length} keys · path saved`)
  }

  const exportOne = async (langCode) => {
    const lang = languages.find(l => l.code === langCode)
    const content = JSON.stringify(unflatten(translations[langCode] || {}), null, 2)
    const filePath = await api.saveJsonAs(`${lang?.code || langCode}.json`)
    if (!filePath) return
    const res = await api.writeFile(filePath, content)
    if (res.success) showToast(`Exported ${lang?.label}`); else showToast(`Error: ${res.error}`, 'error')
  }

  const rewriteOne = async (langCode) => {
    const lang = languages.find(l => l.code === langCode); if (!lang) return
    let filePath = lang.filePath
    if (!filePath) {
      const defaultDir = currentProject.localesPath
      const defaultPath = defaultDir ? `${defaultDir.replace(/\/$/, '')}/${lang.code}.json` : `${lang.code}.json`
      filePath = await api.saveJsonAs(defaultPath)
      if (!filePath) return
      const updated = { ...currentProject, languages: currentProject.languages.map(l => l.code === langCode ? { ...l, filePath } : l) }
      await persistProject(updated)
    }
    const [res] = await api.saveLocales([{ filePath, flat: translations[lang.code] || {}, format: formatsRef.current[langCode] || null }])
    if (res?.success) { showToast(`✓ Saved ${lang.label}`); setDirtyLangs(prev => { const n = new Set(prev); n.delete(langCode); return n }) }
    else showToast(`Error: ${res?.error || 'unknown'}`, 'error')
  }

  // ── Diff & Rewrite All ─────────────────────────────────────────────────
  const handleRewriteAll = async () => {
    setRewriting(true)
    const n = currentProject.languages.filter(l => l.filePath).length
    setRewriteStatus(n ? `Reading ${n} file${n !== 1 ? 's' : ''}…` : 'Preparing…')
    try {
      const [diff, formats] = await api.computeDiff({ languages: currentProject.languages, translations })
      Object.assign(formatsRef.current, formats || {})
      setDiffData(diff)
    } finally {
      setRewriteStatus(null); setRewriting(false)
    }
  }

  const executeRewrite = async () => {
    setDiffData(null); setRewriting(true); setRewriteStatus('Saving…')
    const errors = []
    let written = 0
    try {
      const updatedLangs = [...currentProject.languages]
      const defaultDir = currentProject.localesPath
      for (let i = 0; i < updatedLangs.length; i++) {
        const lang = updatedLangs[i]
        if (lang.filePath) continue
        if (defaultDir) {
          updatedLangs[i] = { ...lang, filePath: `${defaultDir.replace(/\/$/, '')}/${lang.code}.json` }
        } else {
          const filePath = await api.saveJsonAs(`${lang.code}.json`)
          if (filePath) updatedLangs[i] = { ...lang, filePath }
          else errors.push(`${lang.code}: skipped`)
        }
      }
      const withFile = updatedLangs.filter(l => l.filePath)
      const payload = withFile.map(l => ({
        filePath: l.filePath,
        flat: translations[l.code] || {},
        format: formatsRef.current[l.code] || null,
      }))
      log.info('save', `writing ${payload.length} file(s)`)
      const results = payload.length ? await api.saveLocales(payload) : []
      results.forEach((r, i) => { if (r.success) written++; else { errors.push(`${withFile[i]?.code}: ${r.error}`); log.error('save', `${withFile[i]?.code} failed: ${r.error}`) } })
      log.info('save', `wrote ${written}/${payload.length}${errors.length ? ` · ${errors.length} failed` : ''}`)
      await persistProject({ ...currentProject, languages: updatedLangs })
      // Wipe dirty state — everything on disk is now what's in memory.
      if (!errors.length) setDirtyLangs(new Set())
      else setDirtyLangs(prev => { const n = new Set(prev); withFile.forEach((l, i) => results[i]?.success && n.delete(l.code)); return n })
    } catch (e) { errors.push(e.message || String(e)) }
    finally { setRewriteStatus(null); setRewriting(false) }
    if (errors.length) showToast(`Written ${written}, errors: ${errors.join('; ')}`, 'error')
    else showToast(`✓ Rewritten ${written} file${written !== 1 ? 's' : ''}`)
  }

  // ── Auto-translate ─────────────────────────────────────────────────────
  const askAutoTranslate = (langCode) => {
    const lang = languages.find(l => l.code === langCode); if (!lang) return
    const missing = allKeys.filter(k => !translations[langCode]?.[k])
    if (!missing.length) { showToast('Nothing to translate'); return }
    setAutoConfig({ langCode, langLabel: lang.label, langFlag: flagFor(lang), count: missing.length })
  }
  const doTranslate = async (key, targetCode) => {
    const src = translations[baseLanguage]?.[key]
    if (!src) { showToast('No base text', 'error'); return }
    const tKey = `${key}-${targetCode}`
    const srcLang = languages.find(l => l.code === baseLanguage) || { code: baseLanguage }
    const tgtLang = languages.find(l => l.code === targetCode) || { code: targetCode }
    setTranslating(p => ({ ...p, [tKey]: true }))
    try {
      const r = await translateOne({ src, srcLang, tgtLang })
      if (r.text) { commitValue(targetCode, key, r.text) }
      else showToast(r.error || 'Translation failed', 'error')
    } catch (e) { showToast(`Network: ${e.message}`, 'error') }
    setTranslating(p => { const n = { ...p }; delete n[tKey]; return n })
  }

  const startAutoTranslate = async (delayMs) => {
    const cfg = autoConfig; if (!cfg) return
    setAutoConfig(null)
    try { localStorage.setItem('auto-delay-ms', String(delayMs)) } catch {}

    // Group tasks by target language so we can batch-request (DeepL takes 50
    // texts per call, so a 3000-key project needs ~60 requests not 3000).
    const groups = new Map() // langCode → { texts: string[], keys: string[] }
    const push = (lang, key) => {
      if (!groups.has(lang)) groups.set(lang, { texts: [], keys: [] })
      const g = groups.get(lang)
      g.texts.push(translations[baseLanguage][key])
      g.keys.push(key)
    }
    if (cfg.bulk) {
      const nonBase = languages.filter(l => l.code !== baseLanguage)
      for (const l of nonBase) for (const k of cfg.bulkKeys) {
        if (!translations[l.code]?.[k] && translations[baseLanguage]?.[k]) push(l.code, k)
      }
    } else {
      for (const k of allKeys) {
        if (!translations[cfg.langCode]?.[k] && translations[baseLanguage]?.[k]) push(cfg.langCode, k)
      }
    }
    const total = Array.from(groups.values()).reduce((s, g) => s + g.keys.length, 0)
    if (!total) { showToast('Nothing to translate'); return }

    const srcLang = languages.find(l => l.code === baseLanguage) || { code: baseLanguage }
    const providerId = getProvider()
    const providerMeta = PROVIDERS.find(p => p.id === providerId)
    // DeepL takes 50 per call, LibreTranslate accepts an array too — the rest
    // are one-at-a-time and translateBatch just loops internally.
    const CHUNK = providerId === 'deepl' ? 50 : (providerMeta?.batch ? 50 : 1)

    autoCancelRef.current = false
    setAutoRunning(cfg.bulk ? '__bulk__' : cfg.langCode)
    showToast(`Translating ${total} → ${cfg.langLabel}…`, 'info')

    let done = 0, failed = 0, hitQuota = false, lastErr = null
    outer: for (const [langCode, g] of groups) {
      const tgtLang = languages.find(l => l.code === langCode) || { code: langCode }
      for (let i = 0; i < g.keys.length; i += CHUNK) {
        if (autoCancelRef.current) break outer
        const chunkKeys = g.keys.slice(i, i + CHUNK)
        const chunkTexts = g.texts.slice(i, i + CHUNK)
        const r = await translateBatch({ texts: chunkTexts, srcLang, tgtLang })
        for (let j = 0; j < chunkKeys.length; j++) {
          const t = r.translations[j]
          if (t) { commitValue(langCode, chunkKeys[j], t); done++ }
          else failed++
        }
        if (done % 100 < CHUNK) showToast(`${done + failed}/${total} · ${done} ok`, 'info')
        if (r.quota) { hitQuota = true; lastErr = r.error; break outer }
        if (r.error) { lastErr = r.error }
        if (delayMs > 0 && !autoCancelRef.current) await new Promise(res => setTimeout(res, delayMs))
      }
    }
    setAutoRunning(null)

    if (autoCancelRef.current) showToast(`⏸ Stopped — ${done}/${total}`, 'info')
    else if (hitQuota) showToast(`⚠ Quota hit — ${done}/${total} · ${lastErr}`, 'error')
    else if (failed) showToast(`✓ ${done} ok · ${failed} failed${lastErr ? ` · ${lastErr}` : ''}`, failed > done ? 'error' : 'info')
    else showToast(`✓ Done — ${done} translated`)
  }
  const cancelAutoTranslate = () => { autoCancelRef.current = true }

  // ── Bulk find & replace ────────────────────────────────────────────────
  const applyReplace = ({ matches }) => {
    if (!matches?.length) return
    mutate(prev => {
      const next = { ...prev }
      for (const m of matches) {
        next[m.lang] = { ...(next[m.lang] || {}), [m.key]: m.after }
      }
      return next
    })
    showToast(`✓ Replaced ${matches.length} value${matches.length === 1 ? '' : 's'}`)
    log.info('replace', `${matches.length} values updated`)
  }

  // Convenience: auto-translate all missing across all target langs. Used by
  // the command palette so a single ⌘K → Enter can kick off a full run.
  const autoTranslateAllMissing = () => {
    if (!currentProject) return
    const nonBase = languages.filter(l => l.code !== baseLanguage)
    let count = 0
    const bulkKeys = allKeys
    for (const l of nonBase) for (const k of bulkKeys) {
      if (!translations[l.code]?.[k] && translations[baseLanguage]?.[k]) count++
    }
    if (!count) { showToast('Nothing missing to translate'); return }
    setAutoConfig({
      bulk: true, langCode: null,
      langLabel: `${nonBase.length} language${nonBase.length === 1 ? '' : 's'}`,
      langFlag: '🌐',
      count, bulkKeys,
    })
  }

  // Palette can jump-scroll into the table.
  const jumpToKey = (k) => {
    setActiveTab('translations')
    setViewMode('table')
    setSearch('')
    setShowEmptyOnly(false)
    setTimeout(() => tableRef.current?.scrollToKey?.(k), 60)
  }

  // ── Misc helpers ───────────────────────────────────────────────────────
  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3200) }
  const onCopyKey = (key) => {
    navigator.clipboard.writeText(key).catch(() => {})
    setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1400)
  }
  const toggleTreeExpand = useCallback((k) => setTreeExpanded(p => ({ ...p, [k]: !p[k] })), [])
  const expandAll = () => {
    const paths = new Set()
    allKeys.forEach(k => { const parts = k.split('.'); for (let i = 1; i < parts.length; i++) paths.add(parts.slice(0, i).join('.')) })
    const o = {}; paths.forEach(p => { o[p] = true }); setTreeExpanded(o)
  }
  const pctFor = (code) => allKeys.length ? Math.round((stats.filled[code] || 0) / allKeys.length * 100) : 100

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header" data-tauri-drag-region>
          <div className="brand-glyph" data-tauri-drag-region>i</div>
          <div data-tauri-drag-region>
            <div className="brand-name" data-tauri-drag-region>i18n Editor</div>
            <div className="brand-sub" data-tauri-drag-region>Tauri edition</div>
          </div>
        </div>
        <div className="sidebar-section">Projects</div>
        <div className="sidebar-list">
          {projects.length === 0 && (
            <div style={{ padding: 10, color: 'var(--text-faint)', fontSize: 12 }}>No projects yet</div>
          )}
          {projects.map(p => (
            <div key={p.id}
              className={`proj-item ${p.id === currentProjectId ? 'active' : ''}`}
              onClick={() => renamingProjectId !== p.id && switchProject(p.id)}
              onDoubleClick={(e) => { e.stopPropagation(); setRenamingProjectId(p.id) }}
              title={renamingProjectId === p.id ? '' : 'Double-click to rename'}>
              <span className="dot" style={{ opacity: p.id === currentProjectId ? 1 : 0.35 }} />
              {renamingProjectId === p.id ? (
                <input
                  className="rename"
                  autoFocus
                  defaultValue={p.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => renameProject(p.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.currentTarget.blur() }
                    if (e.key === 'Escape') { setRenamingProjectId(null) }
                  }}
                />
              ) : (
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              )}
              {renamingProjectId !== p.id && (
                <button className="del" onClick={(e) => { e.stopPropagation(); deleteProject(p.id) }}>🗑</button>
              )}
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <button className="btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowNewProject(true)}>
            <Plus size={14} /> New
          </button>
          <button className="btn ghost" title="Command palette (⌘K)" onClick={() => setShowPalette(true)}><CmdIcon size={14} /></button>
          <button className="btn ghost" title="Settings" onClick={() => setShowSettings(true)}><SettingsIcon size={14} /></button>
          <button className="btn ghost" title="Toggle theme" onClick={() => setIsDark(v => !v)}>{isDark ? <Sun size={14} /> : <Moon size={14} />}</button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main">
        {!currentProject ? (
          <div className="empty">
            <div className="glyph">🌐</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>No project selected</div>
            <div>Create a project in the sidebar to get started</div>
          </div>
        ) : (
          <>
            <div className="topbar" data-tauri-drag-region>
              <div className="tabs">
                <button className={`tab ${activeTab === 'translations' ? 'active' : ''}`} onClick={() => setActiveTab('translations')}>Translations</button>
                <button className={`tab ${activeTab === 'languages' ? 'active' : ''}`} onClick={() => setActiveTab('languages')}>Languages · {languages.length}</button>
                <button className={`tab ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>Logs</button>
              </div>
              <div className="stat-chip">
                <strong>{stats.allKeys.length}</strong> keys
                <span style={{ opacity: 0.4 }}>·</span>
                <span className={stats.missingTotal ? 'missing' : 'ok'}>{stats.missingTotal} missing</span>
              </div>
              <div style={{ flex: 1 }} data-tauri-drag-region />
              <button className="btn ghost" onClick={() => setShowPalette(true)} title="Command palette (⌘K)"><CmdIcon size={14} /></button>
              <button className="btn ghost" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)"><Undo2 size={14} /></button>
              <button className="btn ghost" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)"><Redo2 size={14} /></button>
              <button className="btn outline" onClick={reloadFromDisk} disabled={reloading || rewriting}
                title="Re-read all locale files from disk (picks up new keys)">
                <RotateCw size={13} /> {reloading ? 'Reloading…' : 'Reload'}
              </button>
              <button className="btn success" onClick={handleRewriteAll} disabled={rewriting || reloading}
                title={dirtyLangs.size ? `${dirtyLangs.size} unsaved · ${[...dirtyLangs].join(', ')}` : 'All saved'}>
                {dirtyLangs.size > 0 && <span className="dirty-dot" />}
                <Save size={14} /> {rewriting ? (rewriteStatus || 'Preparing…') : `Rewrite All${dirtyLangs.size ? ` · ${dirtyLangs.size}` : ''}`}
              </button>
            </div>

            {activeTab === 'languages' && (
              <div style={{ overflow: 'auto', flex: 1 }}>
                <div style={{ padding: '14px 20px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>📁</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Locales folder</div>
                    {currentProject.localesPath
                      ? <div style={{ fontFamily: '"SF Mono", Menlo, monospace', fontSize: 11.5, color: 'var(--text)', wordBreak: 'break-all' }}>{currentProject.localesPath}</div>
                      : <div style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>Not set — pick one to auto-detect locales</div>}
                  </div>
                  {currentProject.localesPath && <button className="btn outline" onClick={rescanLocales}>↻ Rescan</button>}
                  <button className="btn primary" onClick={setLocalesFolder}>{currentProject.localesPath ? 'Change…' : 'Set folder…'}</button>
                </div>
                <div className="lang-grid">
                  {languages.map(lang => {
                    const pct = pctFor(lang.code)
                    const isBase = lang.code === baseLanguage
                    const filled = stats.filled[lang.code] || 0
                    const isDragging = dragLangCode === lang.code
                    const isDropTarget = dropTargetLangCode === lang.code && dragLangCode !== lang.code
                    return (
                      <div key={lang.code}
                        className={`lang-card ${isBase ? 'base' : ''} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
                        draggable
                        onDragStart={(e) => {
                          setDragLangCode(lang.code)
                          e.dataTransfer.effectAllowed = 'move'
                          try { e.dataTransfer.setData('text/plain', lang.code) } catch {}
                          log.debug('dnd', `dragstart ${lang.code}`)
                        }}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropTargetLangCode !== lang.code) setDropTargetLangCode(lang.code) }}
                        onDragLeave={() => setDropTargetLangCode(null)}
                        onDrop={(e) => {
                          e.preventDefault()
                          const from = dragLangCode || e.dataTransfer.getData('text/plain')
                          log.debug('dnd', `drop ${from} → ${lang.code}`)
                          if (from) reorderLanguages(from, lang.code)
                          setDragLangCode(null); setDropTargetLangCode(null)
                        }}
                        onDragEnd={() => { setDragLangCode(null); setDropTargetLangCode(null) }}
                      >
                        <div className="lang-card-head">
                          <span className="drag-handle" title="Drag to reorder">⋮⋮</span>
                          <span className="lang-flag">{flagFor(lang)}</span>
                          <div className="lang-info">
                            <div className="lang-label">{lang.label}</div>
                            <div className="lang-code">
                              {lang.code}
                              {lang.translatorCode && lang.translatorCode !== lang.code && <span className="translator"> → {lang.translatorCode}</span>}
                            </div>
                          </div>
                          {isBase && <span className="base-badge">BASE</span>}
                        </div>
                        <div>
                          <div className="progress-row">
                            <span>{filled} / {stats.allKeys.length} translated</span>
                            <span className="pct" style={{ color: pct === 100 ? 'var(--success)' : pct > 60 ? 'var(--warn)' : 'var(--danger)' }}>{pct}%</span>
                          </div>
                          <div className="progress">
                            <div style={{ width: `${pct}%`, background: pct === 100 ? 'var(--success)' : pct > 60 ? 'var(--warn)' : 'var(--danger)' }} />
                          </div>
                        </div>
                        <div className={`lang-path ${lang.filePath ? '' : 'empty'}`}>
                          {lang.filePath ? <><span>📁</span><span style={{ flex: 1, minWidth: 0 }}>{lang.filePath}</span></> : 'No file linked'}
                        </div>
                        <div className="lang-actions">
                          <button className="btn" onClick={() => setEditingLang(lang.code)}>✏️ Edit</button>
                          <button className="btn" onClick={() => importLanguageFile(lang.code)}>⬆ Import</button>
                          <button className={`btn ${lang.filePath ? 'success' : ''}`} onClick={() => rewriteOne(lang.code)}>💾 {lang.filePath ? 'Rewrite' : 'Save as…'}</button>
                          <button className="btn" onClick={() => exportOne(lang.code)}>⬇ Export</button>
                          {!isBase && (autoRunning === lang.code
                            ? <button className="btn danger wide" onClick={cancelAutoTranslate}>⏸ Stop translating</button>
                            : <button className="btn wide" style={{ background: 'var(--accent-2)', color: 'white' }} onClick={() => askAutoTranslate(lang.code)} disabled={!!autoRunning}>✨ Auto-translate</button>)}
                          {!isBase && <button className="btn outline" onClick={() => { persistProject({ ...currentProject, baseLanguage: lang.code }); setBaseLanguage(lang.code) }}>⭐ Set Base</button>}
                          {!isBase && <button className="btn danger" onClick={() => removeLanguage(lang.code)}>🗑 Remove</button>}
                        </div>
                      </div>
                    )
                  })}
                  <div className="lang-card add">
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-sub)', marginBottom: 4 }}>+ Add Language</div>
                    <input className="input" value={newLangCode} onChange={e => setNewLangCode(e.target.value)} placeholder="Code (e.g. de)"
                      onKeyDown={e => e.key === 'Enter' && addLanguage()} />
                    <input className="input" value={newLangLabel} onChange={e => setNewLangLabel(e.target.value)} placeholder="Label (e.g. German)"
                      onKeyDown={e => e.key === 'Enter' && addLanguage()} />
                    <button className="btn primary" style={{ justifyContent: 'center' }} onClick={addLanguage}>Add Language</button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'translations' && (
              <>
                <div className="toolbar">
                  <div className="search-wrap">
                    <span className="icon">🔍</span>
                    <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search keys or values…" />
                    {search && <button className="clear" onClick={() => setSearch('')}>✕</button>}
                    {searchNamespace && <span className="namespace-hint">📂 {searchNamespace}</span>}
                  </div>
                  <label className="checkbox">
                    <input type="checkbox" checked={showEmptyOnly} onChange={e => setShowEmptyOnly(e.target.checked)} />
                    Missing only
                  </label>
                  <div className="tabs" style={{ padding: 2 }}>
                    <button className={`tab ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><TableIcon size={12} /> Table</button>
                    <button className={`tab ${viewMode === 'tree' ? 'active' : ''}`} onClick={() => setViewMode('tree')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><TreePine size={12} /> Tree</button>
                  </div>
                  {viewMode === 'tree' && (<>
                    <button className="btn outline small" onClick={expandAll}>Expand all</button>
                    <button className="btn outline small" onClick={() => setTreeExpanded({})}>Collapse all</button>
                  </>)}
                  <div style={{ display: 'flex', gap: 6, flex: '1 1 220px', minWidth: 200 }}>
                    <input className="input" style={{ flex: 1 }} value={newKey} onChange={e => setNewKey(e.target.value)}
                      placeholder={searchNamespace ? `Key under ${searchNamespace}…` : 'New key (e.g. app.title)'}
                      onKeyDown={e => e.key === 'Enter' && addKey()} />
                    <button className="btn primary" onClick={addKey}>+ Add Key</button>
                  </div>
                  <span style={{ color: 'var(--text-faint)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                    {filteredKeys.length} / {stats.allKeys.length}
                  </span>
                </div>

                <div className="lang-bar">
                  {languages.map(l => (
                    <div key={l.code} className={`lang-pill ${l.code === baseLanguage ? 'base' : ''}`}>
                      <span>{flagFor(l)}</span>
                      <strong>{l.code}</strong>
                      <span style={{ color: pctFor(l.code) === 100 ? 'var(--success)' : 'var(--warn)' }}>{pctFor(l.code)}%</span>
                      {l.filePath && <span style={{ fontSize: 10, color: 'var(--text-faint)' }} title={l.filePath}>📁</span>}
                    </div>
                  ))}
                </div>

                {viewMode === 'table' && selectedKeys.size > 0 && (
                  <div className="bulk-bar">
                    <span className="count">{selectedKeys.size} selected</span>
                    <span style={{ color: 'var(--text-faint)' }}>·</span>
                    {autoRunning === '__bulk__'
                      ? <button className="btn danger" onClick={cancelAutoTranslate}>⏸ Stop</button>
                      : <button className="btn" style={{ background: 'var(--accent-2)', color: 'white' }} onClick={askBulkAutoTranslate} disabled={!!autoRunning}>✨ Auto-translate</button>}
                    <button className="btn danger" onClick={bulkDelete}>🗑 Delete</button>
                    <button className="btn outline" onClick={() => setSelectedKeys(new Set())}>✕ Clear</button>
                  </div>
                )}

                {filteredKeys.length === 0 ? (
                  <div className="empty">
                    <div className="glyph">🌍</div>
                    <div>{stats.allKeys.length === 0 ? 'No keys yet — import a JSON or add one above' : 'No keys match your filter'}</div>
                  </div>
                ) : viewMode === 'table' ? (
                  <VirtualTable
                    ref={tableRef}
                    keys={filteredKeys}
                    languages={languages}
                    translations={translations}
                    baseLanguage={baseLanguage}
                    search={search}
                    selectedKeys={selectedKeys}
                    onToggleSelect={toggleKeySelection}
                    onCommit={commitValue}
                    onDelete={deleteKey}
                    onCopyKey={onCopyKey}
                    copiedKey={copiedKey}
                    translating={translating}
                    onAutoTranslate={doTranslate}
                    onToggleAll={toggleSelectAllFiltered}
                    allChecked={filteredSelectionState.checked}
                    allIndeterminate={filteredSelectionState.indeterminate}
                    filledByLang={stats.filled}
                    onReorderLang={reorderLanguages}
                    placeholderIssues={placeholderIssues}
                  />
                ) : (
                  <TreeView
                    keys={filteredKeys}
                    languages={languages}
                    translations={translations}
                    baseLanguage={baseLanguage}
                    expanded={treeExpanded}
                    toggleExpand={toggleTreeExpand}
                    namespaceMissing={stats.namespaceMissing}
                    onCommit={commitValue}
                    onAutoTranslate={doTranslate}
                    translating={translating}
                    onCopyKey={onCopyKey}
                    copiedKey={copiedKey}
                  />
                )}
              </>
            )}

            {activeTab === 'logs' && <LogsView />}

            <div className="footer">
              <span>{languages.length} languages · {stats.allKeys.length} keys{currentProject.name ? ` · ${currentProject.name}` : ''}</span>
              <span className="right">
                {providerLabel()} · ⌘Z undo
              </span>
            </div>
          </>
        )}
      </main>

      {/* Modals */}
      {confirmDlg && <Confirm
        message={confirmDlg.message}
        onConfirm={confirmDlg.onConfirm}
        onCancel={() => setConfirmDlg(null)}
        confirmLabel={confirmDlg.confirmLabel}
        variant={confirmDlg.variant} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {diffData && <DiffModal diff={diffData} onConfirm={executeRewrite} onCancel={() => setDiffData(null)} />}
      {autoConfig && (
        <AutoTranslateModal
          config={autoConfig}
          initialDelay={(() => { const v = parseInt(localStorage.getItem('auto-delay-ms') || '500', 10); return Number.isFinite(v) && v >= 0 ? v : 500 })()}
          onStart={startAutoTranslate}
          onCancel={() => setAutoConfig(null)}
        />
      )}
      {showNewProject && (
        <NewProjectModal
          folder={newProjectFolder}
          onPickFolder={async () => { const d = await api.pickDirectory('Select locales folder'); if (d) setNewProjectFolder(d) }}
          onCreate={createProject}
          onCancel={() => { setShowNewProject(false); setNewProjectFolder(null) }}
        />
      )}
      {editingLang && (
        <LangEditModal lang={languages.find(l => l.code === editingLang)} onSave={saveEditLanguage} onCancel={() => setEditingLang(null)} />
      )}

      {showPalette && (
        <CommandPalette
          ctx={{
            projects, currentProject, currentProjectId, languages, baseLanguage,
            allKeys: stats.allKeys, isDark,
            switchProject, newProject: () => setShowNewProject(true),
            rewriteAll: handleRewriteAll, reloadFromDisk,
            openFindReplace: () => setShowFindReplace(true),
            autoTranslateAll: autoTranslateAllMissing,
            askAutoTranslate,
            setViewMode, setActiveTab, openSettings: () => setShowSettings(true),
            toggleTheme: () => setIsDark(v => !v),
            jumpToKey,
          }}
          onClose={() => setShowPalette(false)}
        />
      )}
      {showFindReplace && currentProject && (
        <FindReplaceModal
          languages={languages}
          translations={translations}
          onApply={applyReplace}
          onCancel={() => setShowFindReplace(false)}
        />
      )}

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}

// ── Local helpers reused only from a couple of spots ────────────────────────
function flatten(obj, prefix = '', out = {}) {
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue
    const full = prefix ? `${prefix}.${key}` : key
    const v = obj[key]
    if (v !== null && typeof v === 'object') flatten(Array.isArray(v) ? { ...v } : v, full, out)
    else out[full] = String(v ?? '')
  }
  return out
}
function unflatten(flat) {
  const out = {}
  for (const dotKey in flat) {
    const parts = dotKey.split('.')
    let cur = out
    parts.forEach((p, i) => {
      if (i === parts.length - 1) cur[p] = flat[dotKey]
      else { cur[p] = cur[p] ?? {}; cur = cur[p] }
    })
  }
  return out
}
