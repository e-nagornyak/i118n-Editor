use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// Held across commands — dropping this stops watching.
pub struct WatcherHandle {
    inner: Mutex<Option<(PathBuf, Debouncer<RecommendedWatcher>)>>,
}

impl WatcherHandle {
    pub fn new() -> Self {
        Self { inner: Mutex::new(None) }
    }
}

#[tauri::command]
pub fn watch_folder(app: AppHandle, dir_path: String, state: tauri::State<WatcherHandle>) -> Result<bool, String> {
    let mut guard = state.inner.lock().unwrap();

    // If already watching the same dir, no-op — avoids churn on every reload.
    if let Some((prev, _)) = guard.as_ref() {
        if prev.to_string_lossy() == dir_path { return Ok(true); }
    }

    let path = PathBuf::from(&dir_path);
    if !path.is_dir() { return Err(format!("Not a directory: {dir_path}")); }

    let app_clone = app.clone();
    // 400ms debounce — batches bursts (git checkout, IDE save) into one event.
    let mut debouncer = new_debouncer(Duration::from_millis(400), move |res: DebounceEventResult| {
        match res {
            Ok(events) => {
                let paths: Vec<String> = events
                    .into_iter()
                    .map(|e| e.path.to_string_lossy().into_owned())
                    .filter(|p| p.to_lowercase().ends_with(".json"))
                    .collect();
                if !paths.is_empty() {
                    let _ = app_clone.emit("locales:changed", paths);
                }
            }
            Err(err) => {
                let _ = app_clone.emit("locales:error", format!("{err:?}"));
            }
        }
    }).map_err(|e| e.to_string())?;

    debouncer.watcher().watch(&path, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    *guard = Some((path, debouncer));
    Ok(true)
}

#[tauri::command]
pub fn unwatch_folder(state: tauri::State<WatcherHandle>) -> Result<bool, String> {
    let mut guard = state.inner.lock().unwrap();
    *guard = None; // dropping Debouncer stops the OS watcher
    Ok(true)
}
