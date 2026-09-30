mod commands;
mod store;
mod watcher;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(watcher::WatcherHandle::new())
        .invoke_handler(tauri::generate_handler![
            commands::scan_locales,
            commands::read_files,
            commands::write_file,
            commands::save_locales,
            commands::load_project,
            commands::compute_diff,
            commands::compute_stats,
            commands::get_projects,
            commands::save_project,
            commands::delete_project,
            commands::get_last_project,
            commands::set_last_project,
            commands::app_ready,
            watcher::watch_folder,
            watcher::unwatch_folder,
        ])
        .setup(|app| {
            // Main window is created hidden — splash is up front. Frontend
            // signals `app_ready` once initial data is loaded and we swap them.
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.hide();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
