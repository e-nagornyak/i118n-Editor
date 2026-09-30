import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'

// Wraps every Tauri command in one place so the rest of the app doesn't have
// to know about `invoke`. Argument names must match #[tauri::command] fn args.
export const api = {
  // FS + parsing
  scanLocales: (dirPath) => invoke('scan_locales', { dirPath }),
  readFiles:   (filePaths) => invoke('read_files', { filePaths }),
  writeFile:   (filePath, content) => invoke('write_file', { filePath, content }),
  saveLocales: (payload) => invoke('save_locales', { payload }),
  loadProject: (project) => invoke('load_project', { project }),
  computeDiff: (input) => invoke('compute_diff', { input }),
  computeStats: (input) => invoke('compute_stats', { input }),

  // Projects
  getProjects:     () => invoke('get_projects'),
  saveProject:     (project) => invoke('save_project', { project }),
  deleteProject:   (id) => invoke('delete_project', { id }),
  getLastProject:  () => invoke('get_last_project'),
  setLastProject:  (id) => invoke('set_last_project', { id }),

  // Splash → main handoff
  appReady: () => invoke('app_ready'),

  // File watcher
  watchFolder:   (dirPath) => invoke('watch_folder', { dirPath }),
  unwatchFolder: () => invoke('unwatch_folder'),

  // Dialogs (via plugin — the native dialog UI)
  pickJson: async (title) => {
    const res = await openDialog({ title: title || 'Select JSON', multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (!res) return null
    // Backend reads the picked file for us via read_files.
    const [{ content, error }] = await api.readFiles([res])
    return { filePath: res, content, error }
  },
  pickDirectory: async (title) => {
    const res = await openDialog({ title: title || 'Select folder', directory: true, multiple: false })
    return res || null
  },
  saveJsonAs: async (defaultName) => {
    const res = await saveDialog({ defaultPath: defaultName || 'translations.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    return res || null
  },
}
