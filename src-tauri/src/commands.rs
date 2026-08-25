use crate::audio::{
    is_audio_path, read_cover_thumbnail, read_image_data_url, read_track, save_tags,
    write_image_data_url, ArtworkMode,
};
use crate::batch::{generate_rename_previews, CharacterMappingRule, RenamePreview};
use crate::config as app_config;
use crate::config::DesktopSettings;
use crate::database::IndexedTrack;
use crate::models::{
    ArtistSplitConfig, AudioTrack, BatchTask, BatchTaskItem, LibraryFolder, ReplayGainAnalysis,
    ReplayGainProgress, ScanProgress, StorageInfo, TagUpdate, TrackCover,
};
use crate::paths::resolve_data_paths;
use crate::plugins::installer as plugin_installer;
use crate::plugins::manifest::{PluginInstallResult, SourcePlugin};
use crate::plugins::runtime as plugin_runtime;
use crate::replay_gain::analyze_track;
use crate::AppState;
use rayon::prelude::*;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

const SCAN_PROGRESS_EVENT: &str = "library-scan-progress";
const REPLAY_GAIN_PROGRESS_EVENT: &str = "replay-gain-progress";
static NEXT_SCAN_ID: AtomicU64 = AtomicU64::new(1);

#[tauri::command]
pub(crate) async fn load_source_plugins(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<SourcePlugin>, String> {
    let paths = resolve_data_paths(&app)?;
    plugin_installer::load_plugins(&state.database, &paths.plugins).await
}

#[tauri::command]
pub(crate) async fn install_source_plugin_archive(
    app: AppHandle,
    state: State<'_, AppState>,
    archive_path: String,
    allow_downgrade: bool,
) -> Result<PluginInstallResult, String> {
    let paths = resolve_data_paths(&app)?;
    plugin_installer::install_archive(
        &state.database,
        &paths.plugins,
        Path::new(&archive_path),
        allow_downgrade,
    )
    .await
}

#[tauri::command]
pub(crate) async fn set_source_plugin_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    enabled: bool,
) -> Result<Vec<SourcePlugin>, String> {
    let paths = resolve_data_paths(&app)?;
    plugin_installer::set_enabled(&state.database, &paths.plugins, &plugin_id, enabled).await
}

#[tauri::command]
pub(crate) async fn save_source_plugin_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    config: serde_json::Value,
) -> Result<Vec<SourcePlugin>, String> {
    let paths = resolve_data_paths(&app)?;
    plugin_installer::save_settings(&state.database, &paths.plugins, &plugin_id, config).await
}

#[tauri::command]
pub(crate) async fn uninstall_source_plugin(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<Vec<SourcePlugin>, String> {
    let paths = resolve_data_paths(&app)?;
    plugin_installer::uninstall(&state.database, &paths.plugins, &plugin_id).await
}

#[tauri::command]
pub(crate) async fn invoke_source_plugin(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    function_name: String,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let paths = resolve_data_paths(&app)?;
    let plugin = plugin_installer::load_plugins(&state.database, &paths.plugins)
        .await?
        .into_iter()
        .find(|plugin| plugin.manifest.id == plugin_id)
        .ok_or_else(|| "Plugin was not found".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        plugin_runtime::invoke(&plugin, &function_name, request)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn fetch_remote_image(
    url: String,
    max_size: Option<u32>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let parsed = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("Only HTTP and HTTPS image URLs are supported".to_string());
        }
        let response = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|error| error.to_string())?
            .get(parsed)
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(|error| error.to_string())?;
        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .unwrap_or("application/octet-stream")
            .to_string();
        if !mime.starts_with("image/") {
            return Err(format!("Remote resource is not an image: {mime}"));
        }
        if response
            .content_length()
            .is_some_and(|length| length > 20 * 1024 * 1024)
        {
            return Err("Remote image is larger than 20 MB".to_string());
        }
        let bytes = response.bytes().map_err(|error| error.to_string())?;
        if bytes.len() > 20 * 1024 * 1024 {
            return Err("Remote image is larger than 20 MB".to_string());
        }
        use base64::Engine;
        if let Some(max_size) = max_size {
            let max_size = max_size.clamp(64, 4096);
            let image = image::load_from_memory(&bytes).map_err(|error| error.to_string())?;
            let resized = image.thumbnail(max_size, max_size);
            let mut output = std::io::Cursor::new(Vec::new());
            resized
                .write_to(&mut output, image::ImageFormat::Png)
                .map_err(|error| error.to_string())?;
            return Ok(format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(output.into_inner())
            ));
        }
        Ok(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn create_batch_task(
    state: State<'_, AppState>,
    task_type: String,
    song_paths: Vec<String>,
    config_json: Option<String>,
) -> Result<BatchTask, String> {
    state
        .database
        .create_batch_task(&task_type, &song_paths, config_json)
        .await
}

#[tauri::command]
pub(crate) async fn load_batch_tasks(state: State<'_, AppState>) -> Result<Vec<BatchTask>, String> {
    state.database.load_batch_tasks().await
}

#[tauri::command]
pub(crate) async fn load_batch_task_items(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Vec<BatchTaskItem>, String> {
    state.database.load_batch_task_items(&task_id).await
}

#[tauri::command]
pub(crate) async fn preview_batch_rename(
    app: AppHandle,
    paths: Vec<String>,
    rename_format: String,
    character_mapping_rules: Vec<CharacterMappingRule>,
) -> Result<Vec<RenamePreview>, String> {
    let artist_separator = app_config::load_artist_split_config(&app)?.artist_separator;
    tauri::async_runtime::spawn_blocking(move || {
        generate_rename_previews(
            &paths,
            &rename_format,
            &character_mapping_rules,
            &artist_separator,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn start_batch_task(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
) -> Result<BatchTask, String> {
    state.batch_manager.start_task(app, task_id).await
}

#[tauri::command]
pub(crate) async fn cancel_batch_task(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
) -> Result<BatchTask, String> {
    state.batch_manager.cancel_task(&app, &task_id).await
}

#[tauri::command]
pub(crate) async fn cancel_batch_task_item(
    state: State<'_, AppState>,
    task_id: String,
    item_id: String,
) -> Result<BatchTask, String> {
    state.batch_manager.cancel_item(&task_id, &item_id).await
}

#[tauri::command]
pub(crate) async fn retry_failed_batch_items(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    item_ids: Option<Vec<String>>,
) -> Result<BatchTask, String> {
    let source_task = state.database.load_batch_task(&task_id).await?;
    let requested = item_ids.map(|ids| ids.into_iter().collect::<std::collections::HashSet<_>>());
    let paths = state
        .database
        .load_batch_task_items(&task_id)
        .await?
        .into_iter()
        .filter(|item| item.status == "failed")
        .filter(|item| {
            requested
                .as_ref()
                .is_none_or(|ids| ids.contains(&item.item_id))
        })
        .map(|item| item.song_path)
        .collect::<Vec<_>>();
    if paths.is_empty() {
        return Err("No failed batch items are available to retry".to_string());
    }
    let task = state
        .database
        .create_batch_task(&source_task.task_type, &paths, source_task.config_json)
        .await?;
    state.batch_manager.start_task(app, task.task_id).await
}

#[tauri::command]
pub(crate) async fn analyze_replay_gain(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    path: String,
) -> Result<ReplayGainAnalysis, String> {
    if job_id.trim().is_empty() {
        return Err("ReplayGain job id is required".to_string());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = state
            .active_replay_gain
            .lock()
            .map_err(|_| "ReplayGain registry lock was poisoned".to_string())?;
        if active.contains_key(&job_id) {
            return Err("ReplayGain job id is already active".to_string());
        }
        active.insert(job_id.clone(), cancelled.clone());
    }

    emit_replay_gain_progress(&app, &job_id, &path, 0, "running", None);
    let worker_app = app.clone();
    let worker_job_id = job_id.clone();
    let worker_path = path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        analyze_track(
            worker_job_id.clone(),
            Path::new(&worker_path),
            &cancelled,
            |progress| {
                emit_replay_gain_progress(
                    &worker_app,
                    &worker_job_id,
                    &worker_path,
                    (progress.clamp(0.0, 1.0) * 100.0).round() as u8,
                    "running",
                    None,
                );
            },
        )
    })
    .await
    .map_err(|error| error.to_string())?;

    state
        .active_replay_gain
        .lock()
        .map_err(|_| "ReplayGain registry lock was poisoned".to_string())?
        .remove(&job_id);
    match &result {
        Ok(_) => emit_replay_gain_progress(&app, &job_id, &path, 100, "completed", None),
        Err(error) if error.contains("cancelled") => {
            emit_replay_gain_progress(&app, &job_id, &path, 0, "cancelled", Some(error.clone()))
        }
        Err(error) => {
            emit_replay_gain_progress(&app, &job_id, &path, 0, "failed", Some(error.clone()))
        }
    }
    result
}

#[tauri::command]
pub(crate) fn cancel_replay_gain(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<bool, String> {
    let active = state
        .active_replay_gain
        .lock()
        .map_err(|_| "ReplayGain registry lock was poisoned".to_string())?;
    if let Some(cancelled) = active.get(&job_id) {
        cancelled.store(true, Ordering::Relaxed);
        Ok(true)
    } else {
        Ok(false)
    }
}

fn emit_replay_gain_progress(
    app: &AppHandle,
    job_id: &str,
    path: &str,
    percent: u8,
    status: &str,
    message: Option<String>,
) {
    let _ = app.emit(
        REPLAY_GAIN_PROGRESS_EVENT,
        ReplayGainProgress {
            job_id: job_id.to_string(),
            path: path.to_string(),
            percent,
            status: status.to_string(),
            message,
        },
    );
}

struct ScanResult {
    tracks: Vec<AudioTrack>,
    errors: usize,
}

#[tauri::command]
pub(crate) async fn scan_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<Vec<AudioTrack>, String> {
    let root = PathBuf::from(&folder_path);
    if !root.is_dir() {
        return Err("Selected path is not a folder".to_string());
    }
    let artist_separator = app_config::load_artist_split_config(&app)?.artist_separator;
    let scan_key = normalize_path(&folder_path);
    {
        let mut active_scans = state
            .active_scans
            .lock()
            .map_err(|_| "Scan registry lock was poisoned".to_string())?;
        if !active_scans.insert(scan_key.clone()) {
            return Err("This folder is already being scanned".to_string());
        }
    }
    let job_id = format!("scan-{}", NEXT_SCAN_ID.fetch_add(1, Ordering::Relaxed));
    let scan_signature = format!("audio-summary-v1|artist-separator={artist_separator}");
    let existing_index = state
        .database
        .load_folder_index(&folder_path, &scan_signature)
        .await?;
    let result: Result<Vec<AudioTrack>, String> = async {
        emit_scan_progress(
            &app,
            &job_id,
            &folder_path,
            "enumerating",
            0,
            0,
            0,
            "running",
            None,
        );
        let scan_app = app.clone();
        let scan_job_id = job_id.clone();
        let scan_folder_path = folder_path.clone();
        let scan = tauri::async_runtime::spawn_blocking(move || {
            scan_tracks(
                root,
                &artist_separator,
                &scan_app,
                &scan_job_id,
                &scan_folder_path,
                &existing_index,
            )
        })
        .await
        .map_err(|error| error.to_string())?;
        emit_scan_progress(
            &app,
            &job_id,
            &folder_path,
            "committing",
            scan.tracks.len(),
            scan.tracks.len(),
            scan.errors,
            "running",
            None,
        );
        state
            .database
            .persist_folder_scan(&folder_path, &scan_signature, &scan.tracks)
            .await?;
        emit_scan_progress(
            &app,
            &job_id,
            &folder_path,
            "completed",
            scan.tracks.len(),
            scan.tracks.len(),
            scan.errors,
            "completed",
            None,
        );
        Ok(scan.tracks)
    }
    .await;
    if let Err(error) = &result {
        emit_scan_progress(
            &app,
            &job_id,
            &folder_path,
            "failed",
            0,
            0,
            1,
            "failed",
            Some(error.clone()),
        );
    }
    if let Ok(mut active_scans) = state.active_scans.lock() {
        active_scans.remove(&scan_key);
    }
    result
}

#[tauri::command]
pub(crate) async fn read_audio_file(app: AppHandle, path: String) -> Result<AudioTrack, String> {
    let artist_separator = app_config::load_artist_split_config(&app)?.artist_separator;
    tauri::async_runtime::spawn_blocking(move || {
        read_track(Path::new(&path), &artist_separator, ArtworkMode::Full)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn read_image_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_image_data_url(Path::new(&path)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn read_text_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
        if metadata.len() > 5 * 1024 * 1024 {
            return Err("Lyrics file must be smaller than 5 MB".to_string());
        }
        std::fs::read_to_string(path).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(parent) = Path::new(&path).parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::write(path, contents).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn write_image_file(path: String, data_url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_image_data_url(Path::new(&path), &data_url))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn save_audio_tags(
    app: AppHandle,
    state: State<'_, AppState>,
    update: TagUpdate,
) -> Result<AudioTrack, String> {
    let artist_separator = app_config::load_artist_split_config(&app)?.artist_separator;
    let saved = tauri::async_runtime::spawn_blocking(move || save_tags(update, &artist_separator))
        .await
        .map_err(|error| error.to_string())??;
    state.database.update_track_summary(&saved).await?;
    Ok(saved)
}

#[tauri::command]
pub(crate) async fn load_library_folders(
    state: State<'_, AppState>,
) -> Result<Vec<LibraryFolder>, String> {
    state.database.load_folders().await
}

#[tauri::command]
pub(crate) async fn load_library_tracks(
    state: State<'_, AppState>,
) -> Result<Vec<AudioTrack>, String> {
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || database.load_tracks_blocking())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn load_library_track(app: AppHandle, path: String) -> Result<AudioTrack, String> {
    read_audio_file(app, path).await
}

#[tauri::command]
pub(crate) async fn load_track_covers(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<TrackCover>, String> {
    let cached = state.database.load_cover_thumbnails(&paths)?;
    let missing = paths
        .iter()
        .filter(|path| !cached.contains_key(*path))
        .cloned()
        .collect::<Vec<_>>();
    let fresh = tauri::async_runtime::spawn_blocking(move || {
        missing
            .into_iter()
            .filter_map(|path| {
                read_cover_thumbnail(Path::new(&path)).map(|cover_data_url| TrackCover {
                    path,
                    cover_data_url,
                })
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|error| error.to_string())?;
    if !fresh.is_empty() {
        let thumbnails = fresh
            .iter()
            .map(|cover| (cover.path.clone(), cover.cover_data_url.clone()))
            .collect::<Vec<_>>();
        state.database.save_cover_thumbnails(&thumbnails)?;
    }
    let mut result = paths
        .into_iter()
        .filter_map(|path| {
            cached
                .get(&path)
                .cloned()
                .map(|cover_data_url| TrackCover {
                    path,
                    cover_data_url,
                })
        })
        .collect::<Vec<_>>();
    result.extend(fresh);
    Ok(result)
}

#[tauri::command]
pub(crate) fn load_artist_split_config(app: AppHandle) -> Result<ArtistSplitConfig, String> {
    app_config::load_artist_split_config(&app)
}

#[tauri::command]
pub(crate) fn save_artist_split_config(
    app: AppHandle,
    config: ArtistSplitConfig,
) -> Result<(), String> {
    app_config::save_artist_split_config(&app, config)
}

#[tauri::command]
pub(crate) fn load_desktop_settings(app: AppHandle) -> Result<DesktopSettings, String> {
    app_config::load_desktop_settings(&app)
}

#[tauri::command]
pub(crate) fn save_desktop_settings(
    app: AppHandle,
    settings: DesktopSettings,
) -> Result<(), String> {
    app_config::save_desktop_settings(&app, settings)
}

#[tauri::command]
pub(crate) async fn upsert_library_folder(
    state: State<'_, AppState>,
    folder: LibraryFolder,
) -> Result<(), String> {
    state.database.upsert_folder(folder).await
}

#[tauri::command]
pub(crate) async fn remove_library_folder(
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    state.database.remove_folder(&path).await
}

#[tauri::command]
pub(crate) fn get_storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    let paths = resolve_data_paths(&app)?;
    Ok(StorageInfo {
        data_path: paths.root.to_string_lossy().to_string(),
        database_path: paths.database.to_string_lossy().to_string(),
        config_path: paths.settings.to_string_lossy().to_string(),
        location: paths.location,
    })
}

fn scan_tracks(
    root: PathBuf,
    artist_separator: &str,
    app: &AppHandle,
    job_id: &str,
    folder_path: &str,
    existing_index: &HashMap<String, IndexedTrack>,
) -> ScanResult {
    let mut enumeration_errors = 0;
    let paths = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|entry| match entry {
            Ok(entry) => Some(entry),
            Err(_) => {
                enumeration_errors += 1;
                None
            }
        })
        .map(|entry| entry.into_path())
        .filter(|path| path.is_file() && is_audio_path(path))
        .collect::<Vec<_>>();
    let total = paths.len();
    emit_scan_progress(
        app,
        job_id,
        folder_path,
        "reading",
        0,
        total,
        enumeration_errors,
        "running",
        None,
    );
    let processed = AtomicUsize::new(0);
    let errors = AtomicUsize::new(enumeration_errors);
    let thread_count = std::thread::available_parallelism()
        .map_or(2, usize::from)
        .clamp(1, 4);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(thread_count)
        .thread_name(|index| format!("Lyrico-Scanner-{index}"))
        .build();
    let mut tracks = pool
        .map(|pool| {
            pool.install(|| {
                paths
                    .par_iter()
                    .filter_map(|path| {
                        let track = unchanged_track(path, existing_index).or_else(|| {
                            read_track(path, artist_separator, ArtworkMode::None)
                                .ok()
                                .map(AudioTrack::into_summary)
                        });
                        if track.is_none() {
                            errors.fetch_add(1, Ordering::Relaxed);
                        }
                        let current = processed.fetch_add(1, Ordering::Relaxed) + 1;
                        if current == total || current % 8 == 0 {
                            emit_scan_progress(
                                app,
                                job_id,
                                folder_path,
                                "reading",
                                current,
                                total,
                                errors.load(Ordering::Relaxed),
                                "running",
                                None,
                            );
                        }
                        track
                    })
                    .collect::<Vec<_>>()
            })
        })
        .unwrap_or_else(|_| {
            paths
                .iter()
                .filter_map(|path| {
                    unchanged_track(path, existing_index).or_else(|| {
                        read_track(path, artist_separator, ArtworkMode::None)
                            .ok()
                            .map(AudioTrack::into_summary)
                    })
                })
                .collect()
        });
    tracks.sort_by(|left, right| {
        left.album
            .cmp(&right.album)
            .then(left.disc_number.cmp(&right.disc_number))
            .then(left.track_number.cmp(&right.track_number))
            .then(left.title.cmp(&right.title))
    });
    ScanResult {
        tracks,
        errors: errors.load(Ordering::Relaxed),
    }
}

fn unchanged_track(
    path: &Path,
    existing_index: &HashMap<String, IndexedTrack>,
) -> Option<AudioTrack> {
    let path_text = path.to_string_lossy();
    let indexed = existing_index.get(path_text.as_ref())?;
    let metadata = path.metadata().ok()?;
    let modified_at = metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    (indexed.file_size == metadata.len() && indexed.modified_at == modified_at)
        .then(|| indexed.track.clone())
}

#[allow(clippy::too_many_arguments)]
fn emit_scan_progress(
    app: &AppHandle,
    job_id: &str,
    folder_path: &str,
    phase: &str,
    current: usize,
    total: usize,
    errors: usize,
    status: &str,
    message: Option<String>,
) {
    let _ = app.emit(
        SCAN_PROGRESS_EVENT,
        ScanProgress {
            job_id: job_id.to_string(),
            folder_path: folder_path.to_string(),
            phase: phase.to_string(),
            current,
            total,
            errors,
            status: status.to_string(),
            message,
        },
    );
}

fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unchanged_files_reuse_the_stored_summary() {
        let path = std::env::temp_dir().join(format!(
            "lyrico-fingerprint-{}-{}.mp3",
            std::process::id(),
            NEXT_SCAN_ID.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::write(&path, b"fingerprint").expect("temporary file should be written");
        let metadata = path.metadata().expect("temporary metadata should exist");
        let modified_at = metadata
            .modified()
            .expect("modified time should exist")
            .duration_since(std::time::UNIX_EPOCH)
            .expect("modified time should be valid")
            .as_secs();
        let path_text = path.to_string_lossy().to_string();
        let track = sample_track(path_text.clone());
        let index = HashMap::from([(
            path_text,
            IndexedTrack {
                track: track.clone(),
                file_size: metadata.len(),
                modified_at,
            },
        )]);

        let reused = unchanged_track(&path, &index).expect("unchanged file should reuse the index");

        assert_eq!(reused.title, track.title);
        std::fs::remove_file(path).expect("temporary file should be removed");
    }

    fn sample_track(path: String) -> AudioTrack {
        AudioTrack {
            id: path.clone(),
            path,
            file_name: "sample.mp3".to_string(),
            title: "Stored title".to_string(),
            artist: String::new(),
            album: String::new(),
            album_artist: String::new(),
            genre: String::new(),
            language: String::new(),
            composer: String::new(),
            lyricist: String::new(),
            copyright: String::new(),
            rating: None,
            comment: String::new(),
            lyrics: String::new(),
            track_number: None,
            disc_number: None,
            year: String::new(),
            duration_seconds: 0,
            format: "MP3".to_string(),
            bitrate: None,
            sample_rate: None,
            channels: None,
            cover_data_url: None,
            has_lyrics: false,
            has_cover: false,
            replay_gain_track_gain: String::new(),
            replay_gain_track_peak: String::new(),
            replay_gain_album_gain: String::new(),
            replay_gain_album_peak: String::new(),
            replay_gain_reference_loudness: String::new(),
        }
    }
}
