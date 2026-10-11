mod commands;
mod store;
mod usage;
mod watcher;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

// Set once the frontend has confirmed there's nothing left to lose; until
// then every close/quit path is bounced to the webview to ask the user.
static QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);

fn request_quit(app: &AppHandle) {
    let _ = app.emit_to("main", "app:quit-requested", ());
}

#[tauri::command]
fn confirm_quit(app: AppHandle) {
    QUIT_CONFIRMED.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(watcher::WatcherHandle::new())
        // The stock macOS Quit item sends `terminate:` straight to NSApp, which
        // never surfaces as a preventable event — swap it for our own item.
        .menu(|app| {
            let menu = Menu::default(app)?;
            #[cfg(target_os = "macos")]
            if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
                let n = app_menu.items()?.len();
                if n > 0 {
                    app_menu.remove_at(n - 1)?;
                }
                app_menu.append(&MenuItem::with_id(app, "quit", "Quit i18n Editor", true, Some("CmdOrCtrl+Q"))?)?;
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                request_quit(app);
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && !QUIT_CONFIRMED.load(Ordering::SeqCst) {
                    api.prevent_close();
                    request_quit(window.app_handle());
                }
            }
        })
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
            usage::scan_code_usage,
            confirm_quit,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { code: None, api, .. } = event {
                if !QUIT_CONFIRMED.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    request_quit(app);
                }
            }
        });
}
