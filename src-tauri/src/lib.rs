mod audio;
mod commands;
mod config;
mod database;
mod models;
mod paths;

use commands::{
    load_artist_split_config, load_library_folders, load_library_track, load_library_tracks,
    load_track_covers, get_storage_info, read_audio_file, remove_library_folder, save_artist_split_config,
    save_audio_tags, scan_folder, upsert_library_folder,
};
use database::Database;
use paths::resolve_data_paths;
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::Manager;

pub(crate) struct AppState {
    pub(crate) database: Database,
    pub(crate) active_scans: Mutex<HashSet<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let paths = resolve_data_paths(&app.handle()).map_err(std::io::Error::other)?;
            let database = tauri::async_runtime::block_on(Database::open(&paths.database))
                .map_err(std::io::Error::other)?;
            let legacy_artist_split = tauri::async_runtime::block_on(
                database.load_legacy_setting("artist_split_config"),
            )
            .map_err(std::io::Error::other)?;
            config::migrate_legacy_artist_split_config(&app.handle(), legacy_artist_split)
                .map_err(std::io::Error::other)?;
            app.manage(AppState {
                database,
                active_scans: Mutex::new(HashSet::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_folder,
            read_audio_file,
            save_audio_tags,
            load_library_folders,
            load_library_tracks,
            load_library_track,
            load_track_covers,
            load_artist_split_config,
            save_artist_split_config,
            upsert_library_folder,
            remove_library_folder,
            get_storage_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
