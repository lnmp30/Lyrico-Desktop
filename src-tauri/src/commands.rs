use crate::audio::{is_audio_path, read_cover_thumbnail, read_track, save_tags, ArtworkMode};
use crate::config as app_config;
use crate::database::IndexedTrack;
use crate::models::{
    ArtistSplitConfig, AudioTrack, LibraryFolder, ScanProgress, StorageInfo, TagUpdate, TrackCover,
};
use crate::AppState;
use crate::paths::resolve_data_paths;
use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;
use rayon::prelude::*;

const SCAN_PROGRESS_EVENT: &str = "library-scan-progress";
static NEXT_SCAN_ID: AtomicU64 = AtomicU64::new(1);

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
        emit_scan_progress(&app, &job_id, &folder_path, "enumerating", 0, 0, 0, "running", None);
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
pub(crate) async fn read_audio_file(
    app: AppHandle,
    path: String,
) -> Result<AudioTrack, String> {
    let artist_separator = app_config::load_artist_split_config(&app)?.artist_separator;
    tauri::async_runtime::spawn_blocking(move || {
        read_track(Path::new(&path), &artist_separator, ArtworkMode::Full)
            .map_err(|error| error.to_string())
    })
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
    state.database.load_tracks().await
}

#[tauri::command]
pub(crate) async fn load_library_track(
    app: AppHandle,
    path: String,
) -> Result<AudioTrack, String> {
    read_audio_file(app, path).await
}

#[tauri::command]
pub(crate) async fn load_track_covers(paths: Vec<String>) -> Result<Vec<TrackCover>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .filter_map(|path| {
                read_cover_thumbnail(Path::new(&path)).map(|cover_data_url| TrackCover {
                    path,
                    cover_data_url,
                })
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
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
    emit_scan_progress(app, job_id, folder_path, "reading", 0, total, enumeration_errors, "running", None);
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

fn unchanged_track(path: &Path, existing_index: &HashMap<String, IndexedTrack>) -> Option<AudioTrack> {
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
        }
    }
}
