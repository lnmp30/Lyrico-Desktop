use crate::models::{AudioTrack, BatchTask, BatchTaskItem, LibraryFolder};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

const DATABASE_SCHEMA_VERSION: u32 = 2;
static NEXT_BATCH_ID: AtomicU64 = AtomicU64::new(1);
const BATCH_TASK_TYPES: &[&str] = &[
    "matchMetadata",
    "editTags",
    "renameFiles",
    "formatLyrics",
    "exportLyrics",
    "exportCover",
    "replayGain",
];

#[derive(Clone)]
pub(crate) struct Database {
    connection: Arc<Mutex<Connection>>,
}

#[derive(Clone)]
pub(crate) struct IndexedTrack {
    pub(crate) track: AudioTrack,
    pub(crate) file_size: u64,
    pub(crate) modified_at: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct PluginRecord {
    pub(crate) id: String,
    pub(crate) manifest_json: String,
    pub(crate) enabled: bool,
    pub(crate) sort_order: i32,
    pub(crate) installed_at: String,
    pub(crate) updated_at: String,
    pub(crate) settings_json: String,
}

impl Database {
    pub(crate) async fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        configure_connection(&connection)?;
        migrate_schema(&connection)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    #[cfg(test)]
    async fn in_memory() -> Result<Self, String> {
        let connection = Connection::open_in_memory().map_err(|error| error.to_string())?;
        configure_connection(&connection)?;
        migrate_schema(&connection)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub(crate) async fn load_folders(&self) -> Result<Vec<LibraryFolder>, String> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare(
                "SELECT path, track_count, last_scanned_at, status, error
                 FROM library_folders ORDER BY path COLLATE NOCASE",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(LibraryFolder {
                    path: row.get(0)?,
                    track_count: row.get(1)?,
                    last_scanned_at: row.get(2)?,
                    status: row.get(3)?,
                    error: row.get(4)?,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub(crate) async fn load_plugin_records(&self) -> Result<Vec<PluginRecord>, String> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare(
                "SELECT p.id, p.manifest_json, p.enabled, p.sort_order, p.installed_at, p.updated_at,
                        COALESCE(s.values_json, '{}')
                 FROM source_plugins p
                 LEFT JOIN plugin_settings s ON s.plugin_id = p.id
                 ORDER BY p.sort_order, p.installed_at, p.id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(PluginRecord {
                    id: row.get(0)?,
                    manifest_json: row.get(1)?,
                    enabled: row.get::<_, i64>(2)? != 0,
                    sort_order: row.get(3)?,
                    installed_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    settings_json: row.get(6)?,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub(crate) async fn load_plugin_record(
        &self,
        plugin_id: &str,
    ) -> Result<Option<PluginRecord>, String> {
        let connection = self.lock()?;
        connection
            .query_row(
                "SELECT p.id, p.manifest_json, p.enabled, p.sort_order, p.installed_at, p.updated_at,
                        COALESCE(s.values_json, '{}')
                 FROM source_plugins p
                 LEFT JOIN plugin_settings s ON s.plugin_id = p.id
                 WHERE p.id = ?1",
                params![plugin_id],
                |row| {
                    Ok(PluginRecord {
                        id: row.get(0)?,
                        manifest_json: row.get(1)?,
                        enabled: row.get::<_, i64>(2)? != 0,
                        sort_order: row.get(3)?,
                        installed_at: row.get(4)?,
                        updated_at: row.get(5)?,
                        settings_json: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub(crate) async fn upsert_plugin_record(
        &self,
        plugin_id: &str,
        manifest_json: &str,
        default_settings_json: &str,
    ) -> Result<PluginRecord, String> {
        {
            let mut connection = self.lock()?;
            let transaction = connection
                .transaction()
                .map_err(|error| error.to_string())?;
            let timestamp = now().to_string();
            let next_sort_order: i32 = transaction
                .query_row(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM source_plugins",
                    [],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO source_plugins (id, manifest_json, enabled, sort_order, installed_at, updated_at)
                     VALUES (?1, ?2, 0, ?3, ?4, ?4)
                     ON CONFLICT(id) DO UPDATE SET manifest_json = excluded.manifest_json, updated_at = excluded.updated_at",
                    params![plugin_id, manifest_json, next_sort_order, timestamp],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO plugin_settings (plugin_id, values_json, updated_at)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(plugin_id) DO NOTHING",
                    params![plugin_id, default_settings_json, timestamp],
                )
                .map_err(|error| error.to_string())?;
            transaction.commit().map_err(|error| error.to_string())?;
        }
        self.load_plugin_record(plugin_id)
            .await?
            .ok_or_else(|| "Installed plugin record was not found".to_string())
    }

    pub(crate) async fn set_plugin_enabled(
        &self,
        plugin_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let connection = self.lock()?;
        let changed = connection
            .execute(
                "UPDATE source_plugins SET enabled = ?2, updated_at = ?3 WHERE id = ?1",
                params![plugin_id, i64::from(enabled), now().to_string()],
            )
            .map_err(|error| error.to_string())?;
        if changed == 1 {
            Ok(())
        } else {
            Err("Plugin was not found".to_string())
        }
    }

    pub(crate) async fn save_plugin_settings(
        &self,
        plugin_id: &str,
        values_json: &str,
    ) -> Result<(), String> {
        serde_json::from_str::<serde_json::Value>(values_json)
            .map_err(|error| format!("Invalid plugin settings: {error}"))?;
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO plugin_settings (plugin_id, values_json, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(plugin_id) DO UPDATE SET values_json = excluded.values_json, updated_at = excluded.updated_at",
                params![plugin_id, values_json, now().to_string()],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub(crate) async fn delete_plugin_record(&self, plugin_id: &str) -> Result<(), String> {
        let connection = self.lock()?;
        connection
            .execute(
                "DELETE FROM source_plugins WHERE id = ?1",
                params![plugin_id],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub(crate) fn load_tracks_blocking(&self) -> Result<Vec<AudioTrack>, String> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare(
                "SELECT path, file_name, title, artist, album, album_artist, genre,
                        track_number, disc_number, year, duration_seconds, format, bitrate,
                        sample_rate, channels, has_lyrics, has_cover,
                        replay_gain_track_gain, replay_gain_track_peak,
                        replay_gain_album_gain, replay_gain_album_peak
                 FROM songs
                 ORDER BY album COLLATE NOCASE, disc_number, track_number, title COLLATE NOCASE",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], map_audio_track)
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn load_cover_thumbnails(
        &self,
        paths: &[String],
    ) -> Result<HashMap<String, String>, String> {
        if paths.is_empty() {
            return Ok(HashMap::new());
        }
        let connection = self.lock()?;
        let placeholders = paths.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!(
            "SELECT path, cover_thumbnail_data_url FROM songs \
             WHERE path IN ({placeholders}) AND cover_thumbnail_data_url IS NOT NULL"
        );
        let mut statement = connection
            .prepare(&query)
            .map_err(|error| error.to_string())?;
        let mut rows = statement
            .query(rusqlite::params_from_iter(paths))
            .map_err(|error| error.to_string())?;
        let mut thumbnails = HashMap::with_capacity(paths.len());
        while let Some(row) = rows.next().map_err(|error| error.to_string())? {
            let data_url = row
                .get::<_, Option<String>>(1)
                .map_err(|error| error.to_string())?;
            if let Some(data_url) = data_url {
                thumbnails.insert(
                    row.get::<_, String>(0).map_err(|error| error.to_string())?,
                    data_url,
                );
            }
        }
        Ok(thumbnails)
    }

    pub(crate) fn save_cover_thumbnails(
        &self,
        thumbnails: &[(String, String)],
    ) -> Result<(), String> {
        if thumbnails.is_empty() {
            return Ok(());
        }
        let connection = self.lock()?;
        for (path, data_url) in thumbnails {
            connection
                .execute(
                    "UPDATE songs SET cover_thumbnail_data_url = ?2, updated_at = ?3 \
                     WHERE path = ?1",
                    params![path, data_url, as_i64(now())],
                )
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub(crate) async fn load_folder_index(
        &self,
        folder_path: &str,
        scan_signature: &str,
    ) -> Result<HashMap<String, IndexedTrack>, String> {
        let connection = self.lock()?;
        let stored_signature = connection
            .query_row(
                "SELECT scan_signature FROM library_folders WHERE path = ?1",
                params![folder_path],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if stored_signature.as_deref() != Some(scan_signature) {
            return Ok(HashMap::new());
        }
        let mut statement = connection
            .prepare(
                "SELECT path, file_name, title, artist, album, album_artist, genre,
                        track_number, disc_number, year, duration_seconds, format, bitrate,
                        sample_rate, channels, has_lyrics, has_cover,
                        replay_gain_track_gain, replay_gain_track_peak,
                        replay_gain_album_gain, replay_gain_album_peak, file_size, modified_at
                 FROM songs WHERE folder_path = ?1",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![folder_path], |row| {
                let track = map_audio_track(row)?;
                let file_size = row
                    .get::<_, i64>(21)
                    .map(|value| u64::try_from(value).unwrap_or_default())?;
                let modified_at = row
                    .get::<_, i64>(22)
                    .map(|value| u64::try_from(value).unwrap_or_default())?;
                Ok(IndexedTrack {
                    track,
                    file_size,
                    modified_at,
                })
            })
            .map_err(|error| error.to_string())?;
        let mut index = HashMap::new();
        for row in rows {
            let indexed = row.map_err(|error| error.to_string())?;
            index.insert(indexed.track.path.clone(), indexed);
        }
        Ok(index)
    }

    pub(crate) async fn persist_folder_scan(
        &self,
        folder_path: &str,
        scan_signature: &str,
        tracks: &[AudioTrack],
    ) -> Result<(), String> {
        let mut connection = self.lock()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let scanned_at = now().to_string();
        transaction
            .execute(
                "INSERT INTO library_folders (path, track_count, last_scanned_at, status, error, scan_signature)
                 VALUES (?1, ?2, ?3, 'ready', NULL, ?4)
                 ON CONFLICT(path) DO UPDATE SET
                   track_count = excluded.track_count,
                   last_scanned_at = excluded.last_scanned_at,
                   status = 'ready', error = NULL,
                   scan_signature = excluded.scan_signature",
                params![folder_path, tracks.len() as u32, scanned_at, scan_signature],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM songs WHERE folder_path = ?1",
                params![folder_path],
            )
            .map_err(|error| error.to_string())?;
        for track in tracks {
            upsert_track(&transaction, folder_path, track)?;
        }
        rebuild_collections(&transaction)?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub(crate) async fn update_track_summary(&self, track: &AudioTrack) -> Result<(), String> {
        let mut connection = self.lock()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let folder_path = transaction
            .query_row(
                "SELECT folder_path FROM songs WHERE path = ?1",
                params![track.path],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(folder_path) = folder_path {
            upsert_track(&transaction, &folder_path, track)?;
            rebuild_collections(&transaction)?;
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub(crate) async fn update_renamed_track_summary(
        &self,
        previous_path: &str,
        track: &AudioTrack,
    ) -> Result<(), String> {
        let mut connection = self.lock()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let folder_path = transaction
            .query_row(
                "SELECT folder_path FROM songs WHERE path = ?1",
                params![previous_path],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("Renamed library track was not found: {previous_path}"))?;
        transaction
            .execute("DELETE FROM songs WHERE path = ?1", params![previous_path])
            .map_err(|error| error.to_string())?;
        upsert_track(&transaction, &folder_path, track)?;
        rebuild_collections(&transaction)?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub(crate) async fn create_batch_task(
        &self,
        task_type: &str,
        song_paths: &[String],
        config_json: Option<String>,
    ) -> Result<BatchTask, String> {
        if !BATCH_TASK_TYPES.contains(&task_type) {
            return Err("Unsupported batch task type".to_string());
        }
        if let Some(config) = config_json
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            serde_json::from_str::<serde_json::Value>(config)
                .map_err(|error| format!("Invalid batch task configuration: {error}"))?;
        }
        let mut unique_paths = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for path in song_paths
            .iter()
            .map(|path| path.trim())
            .filter(|path| !path.is_empty())
        {
            if seen.insert(path.to_string()) {
                unique_paths.push(path.to_string());
            }
        }
        if unique_paths.is_empty() {
            return Err("At least one song is required".to_string());
        }

        let timestamp = now().to_string();
        let task_id = format!(
            "batch-{}-{}",
            now_millis(),
            NEXT_BATCH_ID.fetch_add(1, Ordering::Relaxed)
        );
        let task = BatchTask {
            task_id: task_id.clone(),
            task_type: task_type.to_string(),
            status: "queued".to_string(),
            total: unique_paths.len() as u32,
            current: 0,
            success_count: 0,
            failure_count: 0,
            skipped_count: 0,
            config_json,
            started_at: None,
            finished_at: None,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
            error_message: None,
        };

        let mut connection = self.lock()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO batch_tasks (
                    task_id, type, status, total, current, success_count, failure_count,
                    skipped_count, config_json, started_at, finished_at, created_at, updated_at, error_message
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    task.task_id,
                    task.task_type,
                    task.status,
                    task.total,
                    task.current,
                    task.success_count,
                    task.failure_count,
                    task.skipped_count,
                    task.config_json,
                    task.started_at,
                    task.finished_at,
                    task.created_at,
                    task.updated_at,
                    task.error_message,
                ],
            )
            .map_err(|error| error.to_string())?;
        for (index, path) in unique_paths.iter().enumerate() {
            let file_name = Path::new(path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(path)
                .to_string();
            transaction
                .execute(
                    "INSERT INTO batch_task_items (
                        item_id, task_id, song_path, file_name, status, progress,
                        result_json, error_message, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, 'queued', 0, NULL, NULL, ?5, ?5)",
                    params![
                        format!("{}-{index}", task.task_id),
                        task.task_id,
                        path,
                        file_name,
                        timestamp
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(task)
    }

    pub(crate) async fn load_batch_tasks(&self) -> Result<Vec<BatchTask>, String> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare(
                "SELECT task_id, type, status, total, current, success_count, failure_count,
                        skipped_count, config_json, started_at, finished_at, created_at,
                        updated_at, error_message
                 FROM batch_tasks ORDER BY created_at DESC, task_id DESC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], map_batch_task)
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub(crate) async fn load_batch_task(&self, task_id: &str) -> Result<BatchTask, String> {
        let connection = self.lock()?;
        load_batch_task(&connection, task_id)
    }

    pub(crate) async fn recover_interrupted_batch_tasks(&self) -> Result<Vec<String>, String> {
        let mut connection = self.lock()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let timestamp = now().to_string();
        transaction
            .execute(
                "UPDATE batch_task_items SET status = 'queued', progress = 0,
                    error_message = 'Recovered after application restart', updated_at = ?1
             WHERE status = 'running'",
                params![timestamp],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE batch_tasks SET status = 'queued', started_at = NULL, finished_at = NULL,
                    error_message = 'Recovered after application restart', updated_at = ?1
             WHERE status = 'running'",
                params![timestamp],
            )
            .map_err(|error| error.to_string())?;
        let task_ids = {
            let mut statement = transaction.prepare(
                "SELECT task_id FROM batch_tasks WHERE status = 'queued' ORDER BY created_at, task_id",
            ).map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?
        };
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(task_ids)
    }

    pub(crate) async fn load_batch_task_items(
        &self,
        task_id: &str,
    ) -> Result<Vec<BatchTaskItem>, String> {
        let connection = self.lock()?;
        let mut statement = connection
            .prepare(
                "SELECT item_id, task_id, song_path, file_name, status, progress,
                        result_json, error_message, created_at, updated_at
                 FROM batch_task_items WHERE task_id = ?1 ORDER BY created_at, item_id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![task_id], map_batch_task_item)
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub(crate) async fn start_batch_task(&self, task_id: &str) -> Result<BatchTask, String> {
        let connection = self.lock()?;
        let timestamp = now().to_string();
        let changed = connection
            .execute(
                "UPDATE batch_tasks SET status = 'running', started_at = ?2, updated_at = ?2
                 WHERE task_id = ?1 AND status = 'queued'",
                params![task_id, timestamp],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("Batch task is missing or no longer queued".to_string());
        }
        load_batch_task(&connection, task_id)
    }

    #[cfg(test)]
    pub(crate) async fn update_batch_task_item(
        &self,
        task_id: &str,
        item_id: &str,
        status: &str,
        progress: f64,
        error_message: Option<String>,
    ) -> Result<BatchTask, String> {
        if !["running", "succeeded", "failed", "skipped", "cancelled"].contains(&status) {
            return Err("Unsupported batch item status".to_string());
        }
        let mut connection = self.lock()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let timestamp = now().to_string();
        let changed = transaction
            .execute(
                "UPDATE batch_task_items
                 SET status = ?3, progress = ?4, error_message = ?5, updated_at = ?6
                 WHERE task_id = ?1 AND item_id = ?2",
                params![
                    task_id,
                    item_id,
                    status,
                    progress.clamp(0.0, 1.0),
                    error_message,
                    timestamp
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("Batch task item was not found".to_string());
        }
        transaction
            .execute(
                "UPDATE batch_tasks SET
                    current = (SELECT count(*) FROM batch_task_items WHERE task_id = ?1 AND status IN ('succeeded','failed','skipped','cancelled')),
                    success_count = (SELECT count(*) FROM batch_task_items WHERE task_id = ?1 AND status = 'succeeded'),
                    failure_count = (SELECT count(*) FROM batch_task_items WHERE task_id = ?1 AND status = 'failed'),
                    skipped_count = (SELECT count(*) FROM batch_task_items WHERE task_id = ?1 AND status = 'skipped'),
                    updated_at = ?2
                 WHERE task_id = ?1 AND status = 'running'",
                params![task_id, timestamp],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        load_batch_task(&connection, task_id)
    }

    pub(crate) async fn update_batch_task_item_result(
        &self,
        task_id: &str,
        item_id: &str,
        status: &str,
        progress: f64,
        result_json: Option<String>,
        error_message: Option<String>,
    ) -> Result<BatchTask, String> {
        if ![
            "queued",
            "running",
            "succeeded",
            "failed",
            "skipped",
            "cancelled",
        ]
        .contains(&status)
        {
            return Err("Unsupported batch item status".to_string());
        }
        let connection = self.lock()?;
        let timestamp = now().to_string();
        let changed = connection
            .execute(
                "UPDATE batch_task_items SET status = ?3, progress = ?4, result_json = ?5,
                    error_message = ?6, updated_at = ?7 WHERE task_id = ?1 AND item_id = ?2",
                params![
                    task_id,
                    item_id,
                    status,
                    progress.clamp(0.0, 1.0),
                    result_json,
                    error_message,
                    timestamp
                ],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("Batch task item was not found".to_string());
        }
        connection.execute(
            "UPDATE batch_tasks SET
                current = (SELECT count(*) FROM batch_task_items WHERE task_id = ?1 AND status IN ('succeeded','failed','skipped','cancelled')),
                success_count = (SELECT count(*) FROM batch_task_items WHERE task_id = ?1 AND status = 'succeeded'),
                failure_count = (SELECT count(*) FROM batch_task_items WHERE task_id = ?1 AND status = 'failed'),
                skipped_count = (SELECT count(*) FROM batch_task_items WHERE task_id = ?1 AND status = 'skipped'),
                updated_at = ?2 WHERE task_id = ?1 AND status = 'running'",
            params![task_id, timestamp],
        ).map_err(|error| error.to_string())?;
        load_batch_task(&connection, task_id)
    }

    pub(crate) async fn cancel_pending_batch_items(
        &self,
        task_id: &str,
        reason: &str,
    ) -> Result<BatchTask, String> {
        let connection = self.lock()?;
        let timestamp = now().to_string();
        connection.execute(
            "UPDATE batch_task_items SET status = 'cancelled', error_message = ?2, updated_at = ?3
             WHERE task_id = ?1 AND status IN ('queued', 'running')",
            params![task_id, reason, timestamp],
        ).map_err(|error| error.to_string())?;
        connection.execute(
            "UPDATE batch_tasks SET current = total,
                success_count = (SELECT count(*) FROM batch_task_items WHERE task_id = ?1 AND status = 'succeeded'),
                failure_count = (SELECT count(*) FROM batch_task_items WHERE task_id = ?1 AND status = 'failed'),
                skipped_count = (SELECT count(*) FROM batch_task_items WHERE task_id = ?1 AND status = 'skipped'),
                updated_at = ?2 WHERE task_id = ?1 AND status = 'running'",
            params![task_id, timestamp],
        ).map_err(|error| error.to_string())?;
        load_batch_task(&connection, task_id)
    }

    pub(crate) async fn log_batch_event(
        &self,
        level: &str,
        message: &str,
        detail: Option<String>,
        related_id: &str,
    ) -> Result<(), String> {
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO app_logs (created_at, level, type, tag, message, detail, related_id)
             VALUES (?1, ?2, 'batch', 'BatchManager', ?3, ?4, ?5)",
                params![now().to_string(), level, message, detail, related_id],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub(crate) async fn finish_batch_task(
        &self,
        task_id: &str,
        status: &str,
        error_message: Option<String>,
    ) -> Result<BatchTask, String> {
        if !["succeeded", "failed", "cancelled"].contains(&status) {
            return Err("Unsupported terminal batch task status".to_string());
        }
        let connection = self.lock()?;
        let timestamp = now().to_string();
        let changed = connection
            .execute(
                "UPDATE batch_tasks
                 SET status = ?2, finished_at = ?3, updated_at = ?3, error_message = ?4
                 WHERE task_id = ?1 AND status = 'running'",
                params![task_id, status, timestamp, error_message],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err("Batch task is missing or no longer running".to_string());
        }
        load_batch_task(&connection, task_id)
    }

    pub(crate) async fn upsert_folder(&self, folder: LibraryFolder) -> Result<(), String> {
        let connection = self.lock()?;
        connection
            .execute(
                "INSERT INTO library_folders (path, track_count, last_scanned_at, status, error)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(path) DO UPDATE SET
                   track_count = excluded.track_count,
                   last_scanned_at = excluded.last_scanned_at,
                   status = excluded.status,
                   error = excluded.error",
                params![
                    folder.path,
                    folder.track_count,
                    folder.last_scanned_at,
                    folder.status,
                    folder.error
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub(crate) async fn remove_folder(&self, path: &str) -> Result<(), String> {
        let mut connection = self.lock()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM songs WHERE folder_path = ?1", params![path])
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM library_folders WHERE path = ?1", params![path])
            .map_err(|error| error.to_string())?;
        rebuild_collections(&transaction)?;
        transaction.commit().map_err(|error| error.to_string())
    }

    pub(crate) async fn load_legacy_setting(&self, key: &str) -> Result<Option<String>, String> {
        let connection = self.lock()?;
        connection
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.connection
            .lock()
            .map_err(|_| "Database lock was poisoned".to_string())
    }
}

fn configure_connection(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA temp_store = MEMORY;",
        )
        .map_err(|error| error.to_string())
}

fn map_batch_task(row: &Row<'_>) -> rusqlite::Result<BatchTask> {
    Ok(BatchTask {
        task_id: row.get(0)?,
        task_type: row.get(1)?,
        status: row.get(2)?,
        total: row.get(3)?,
        current: row.get(4)?,
        success_count: row.get(5)?,
        failure_count: row.get(6)?,
        skipped_count: row.get(7)?,
        config_json: row.get(8)?,
        started_at: row.get(9)?,
        finished_at: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        error_message: row.get(13)?,
    })
}

fn load_batch_task(connection: &Connection, task_id: &str) -> Result<BatchTask, String> {
    connection
        .query_row(
            "SELECT task_id, type, status, total, current, success_count, failure_count,
                    skipped_count, config_json, started_at, finished_at, created_at,
                    updated_at, error_message
             FROM batch_tasks WHERE task_id = ?1",
            params![task_id],
            map_batch_task,
        )
        .map_err(|error| error.to_string())
}

fn map_batch_task_item(row: &Row<'_>) -> rusqlite::Result<BatchTaskItem> {
    Ok(BatchTaskItem {
        item_id: row.get(0)?,
        task_id: row.get(1)?,
        song_path: row.get(2)?,
        file_name: row.get(3)?,
        status: row.get(4)?,
        progress: row.get(5)?,
        result_json: row.get(6)?,
        error_message: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn migrate_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(SCHEMA)
        .map_err(|error| error.to_string())?;
    add_column_if_missing(
        connection,
        "songs",
        "file_size",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        connection,
        "songs",
        "modified_at",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        connection,
        "library_folders",
        "scan_signature",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    connection
        .pragma_update(None, "user_version", DATABASE_SCHEMA_VERSION)
        .map_err(|error| error.to_string())
}

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if !columns.iter().any(|candidate| candidate == column) {
        connection
            .execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN {column} {definition}"
            ))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn upsert_track(
    transaction: &Transaction<'_>,
    folder_path: &str,
    track: &AudioTrack,
) -> Result<(), String> {
    let metadata = fs::metadata(&track.path).ok();
    let file_size = metadata.as_ref().map_or(0, fs::Metadata::len);
    let modified_at = metadata
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_secs());
    transaction
        .execute(
            "INSERT INTO songs (
                id, path, folder_path, file_name, title, artist, album, album_artist, genre,
                track_number, disc_number, year, duration_seconds, format, bitrate, sample_rate,
                channels, has_lyrics, has_cover, replay_gain_track_gain, replay_gain_track_peak,
                replay_gain_album_gain, replay_gain_album_peak, file_size, modified_at, updated_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26
             ) ON CONFLICT(path) DO UPDATE SET
                folder_path = excluded.folder_path, file_name = excluded.file_name,
                title = excluded.title, artist = excluded.artist, album = excluded.album,
                album_artist = excluded.album_artist, genre = excluded.genre,
                track_number = excluded.track_number, disc_number = excluded.disc_number,
                year = excluded.year, duration_seconds = excluded.duration_seconds,
                format = excluded.format, bitrate = excluded.bitrate,
                sample_rate = excluded.sample_rate, channels = excluded.channels,
                has_lyrics = excluded.has_lyrics, has_cover = excluded.has_cover,
                replay_gain_track_gain = excluded.replay_gain_track_gain,
                replay_gain_track_peak = excluded.replay_gain_track_peak,
                replay_gain_album_gain = excluded.replay_gain_album_gain,
                replay_gain_album_peak = excluded.replay_gain_album_peak,
                file_size = excluded.file_size, modified_at = excluded.modified_at,
                updated_at = excluded.updated_at",
            params![
                track.path,
                track.path,
                folder_path,
                track.file_name,
                track.title,
                track.artist,
                track.album,
                track.album_artist,
                track.genre,
                track.track_number,
                track.disc_number,
                track.year,
                as_i64(track.duration_seconds),
                track.format,
                track.bitrate,
                track.sample_rate,
                track.channels,
                track.has_lyrics,
                track.has_cover,
                track.replay_gain_track_gain,
                track.replay_gain_track_peak,
                track.replay_gain_album_gain,
                track.replay_gain_album_peak,
                as_i64(file_size),
                as_i64(modified_at),
                as_i64(now())
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn rebuild_collections(transaction: &Transaction<'_>) -> Result<(), String> {
    transaction
        .execute_batch(
            "DELETE FROM artist_song;
             DELETE FROM artists;
             DELETE FROM album_song;
             DELETE FROM albums;
             INSERT INTO artists (name, normalized_name, song_count, album_count, cover_song_path, updated_at)
             SELECT artist, lower(trim(artist)), count(*), count(DISTINCT album),
                    min(CASE WHEN has_cover = 1 THEN path END), strftime('%s','now')
             FROM songs WHERE trim(artist) <> '' GROUP BY lower(trim(artist));
             INSERT INTO artist_song (artist_id, song_path)
             SELECT artists.id, songs.path FROM artists
             JOIN songs ON lower(trim(songs.artist)) = artists.normalized_name;
             INSERT INTO albums (name, album_artist, normalized_key, song_count, year, cover_song_path, updated_at)
             SELECT album, album_artist,
                    lower(trim(album)) || char(0) || lower(trim(CASE WHEN album_artist <> '' THEN album_artist ELSE artist END)),
                    count(*), min(NULLIF(year, '')), min(CASE WHEN has_cover = 1 THEN path END), strftime('%s','now')
             FROM songs WHERE trim(album) <> ''
             GROUP BY lower(trim(album)), lower(trim(CASE WHEN album_artist <> '' THEN album_artist ELSE artist END));
             INSERT INTO album_song (album_id, song_path)
             SELECT albums.id, songs.path FROM albums JOIN songs
             ON albums.normalized_key = lower(trim(songs.album)) || char(0) ||
                lower(trim(CASE WHEN songs.album_artist <> '' THEN songs.album_artist ELSE songs.artist END));",
        )
        .map_err(|error| error.to_string())
}

fn map_audio_track(row: &Row<'_>) -> rusqlite::Result<AudioTrack> {
    let path: String = row.get(0)?;
    Ok(AudioTrack {
        id: path.clone(),
        path,
        file_name: row.get(1)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        album: row.get(4)?,
        album_artist: row.get(5)?,
        genre: row.get(6)?,
        language: String::new(),
        composer: String::new(),
        lyricist: String::new(),
        copyright: String::new(),
        rating: None,
        comment: String::new(),
        lyrics: String::new(),
        track_number: row.get(7)?,
        disc_number: row.get(8)?,
        year: row.get(9)?,
        duration_seconds: row
            .get::<_, i64>(10)
            .map(|value| u64::try_from(value).unwrap_or_default())?,
        format: row.get(11)?,
        bitrate: row.get(12)?,
        sample_rate: row.get(13)?,
        channels: row.get(14)?,
        cover_data_url: None,
        has_lyrics: row.get(15)?,
        has_cover: row.get(16)?,
        replay_gain_track_gain: row.get(17)?,
        replay_gain_track_peak: row.get(18)?,
        replay_gain_album_gain: row.get(19)?,
        replay_gain_album_peak: row.get(20)?,
        replay_gain_reference_loudness: String::new(),
    })
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn as_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS library_folders (
    path TEXT PRIMARY KEY NOT NULL,
    track_count INTEGER NOT NULL DEFAULT 0,
    last_scanned_at TEXT,
    status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','scanning','error')),
    error TEXT,
    scan_signature TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS songs (
    id TEXT NOT NULL,
    path TEXT PRIMARY KEY NOT NULL,
    folder_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '', artist TEXT NOT NULL DEFAULT '',
    album TEXT NOT NULL DEFAULT '', album_artist TEXT NOT NULL DEFAULT '',
    genre TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '', lyrics TEXT NOT NULL DEFAULT '',
    track_number INTEGER, disc_number INTEGER, year TEXT NOT NULL DEFAULT '',
    duration_seconds INTEGER NOT NULL DEFAULT 0, format TEXT NOT NULL DEFAULT '',
    bitrate INTEGER, sample_rate INTEGER, channels INTEGER,
    cover_data_url TEXT, cover_thumbnail_data_url TEXT,
    has_lyrics INTEGER NOT NULL DEFAULT 0, has_cover INTEGER NOT NULL DEFAULT 0,
    replay_gain_track_gain TEXT NOT NULL DEFAULT '', replay_gain_track_peak TEXT NOT NULL DEFAULT '',
    replay_gain_album_gain TEXT NOT NULL DEFAULT '', replay_gain_album_peak TEXT NOT NULL DEFAULT '',
    file_size INTEGER NOT NULL DEFAULT 0, modified_at INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(folder_path) REFERENCES library_folders(path) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_songs_folder_path ON songs(folder_path);
CREATE INDEX IF NOT EXISTS idx_songs_fingerprint ON songs(path, file_size, modified_at);
CREATE INDEX IF NOT EXISTS idx_songs_album_order ON songs(album COLLATE NOCASE, disc_number, track_number, title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_songs_artist_order ON songs(artist COLLATE NOCASE, album COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS artists (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE, song_count INTEGER NOT NULL DEFAULT 0,
    album_count INTEGER NOT NULL DEFAULT 0, cover_song_path TEXT, updated_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS artist_song (
    artist_id INTEGER NOT NULL, song_path TEXT NOT NULL,
    PRIMARY KEY(artist_id, song_path),
    FOREIGN KEY(artist_id) REFERENCES artists(id) ON DELETE CASCADE,
    FOREIGN KEY(song_path) REFERENCES songs(path) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    album_artist TEXT NOT NULL DEFAULT '', normalized_key TEXT NOT NULL UNIQUE,
    song_count INTEGER NOT NULL DEFAULT 0, year TEXT, cover_song_path TEXT,
    updated_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS album_song (
    album_id INTEGER NOT NULL, song_path TEXT NOT NULL,
    PRIMARY KEY(album_id, song_path),
    FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE,
    FOREIGN KEY(song_path) REFERENCES songs(path) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS source_plugins (
    id TEXT PRIMARY KEY, manifest_json TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0, installed_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS plugin_settings (
    plugin_id TEXT PRIMARY KEY, values_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(plugin_id) REFERENCES source_plugins(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS plugin_cache (
    plugin_id TEXT NOT NULL, cache_key TEXT NOT NULL, value TEXT NOT NULL,
    expires_at INTEGER, PRIMARY KEY(plugin_id, cache_key),
    FOREIGN KEY(plugin_id) REFERENCES source_plugins(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS batch_tasks (
    task_id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0, current INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0, config_json TEXT,
    started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '', error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_batch_tasks_status ON batch_tasks(status, created_at);
CREATE TABLE IF NOT EXISTS batch_task_items (
    item_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, song_path TEXT NOT NULL,
    file_name TEXT NOT NULL, status TEXT NOT NULL, progress REAL,
    result_json TEXT, error_message TEXT, created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(task_id) REFERENCES batch_tasks(task_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_batch_task_items_task ON batch_task_items(task_id, status);
CREATE TABLE IF NOT EXISTS app_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
    level TEXT NOT NULL, type TEXT NOT NULL, tag TEXT NOT NULL,
    message TEXT NOT NULL, detail TEXT, related_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_logs_lookup ON app_logs(type, level, created_at);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT ''
);
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_and_basic_repository_round_trip() {
        tauri::async_runtime::block_on(async {
            let database = Database::in_memory()
                .await
                .expect("database should initialize");
            database
                .upsert_folder(LibraryFolder {
                    path: "C:\\Music".to_string(),
                    track_count: 0,
                    last_scanned_at: None,
                    status: "ready".to_string(),
                    error: None,
                })
                .await
                .expect("folder should be saved");
            let folders = database.load_folders().await.expect("folders should load");
            assert_eq!(folders.len(), 1);
            assert_eq!(folders[0].path, "C:\\Music");
        });
    }

    #[test]
    fn database_uses_wal_and_foreign_keys() {
        tauri::async_runtime::block_on(async {
            let database = Database::in_memory()
                .await
                .expect("database should initialize");
            let connection = database.lock().expect("database should lock");
            let foreign_keys: i64 = connection
                .pragma_query_value(None, "foreign_keys", |row| row.get(0))
                .expect("foreign key pragma should be readable");
            assert_eq!(foreign_keys, 1);
            let version: u32 = connection
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .expect("schema version should be readable");
            assert_eq!(version, DATABASE_SCHEMA_VERSION);
        });
    }

    #[test]
    fn batch_task_repository_creates_deduplicated_item_snapshot() {
        tauri::async_runtime::block_on(async {
            let database = Database::in_memory()
                .await
                .expect("database should initialize");
            let task = database
                .create_batch_task(
                    "exportLyrics",
                    &[
                        "C:\\Music\\first.flac".to_string(),
                        "C:\\Music\\first.flac".to_string(),
                        "C:\\Music\\second.mp3".to_string(),
                    ],
                    Some(r#"{"destination":"C:\\Lyrics"}"#.to_string()),
                )
                .await
                .expect("batch task should be created");
            assert_eq!(task.status, "queued");
            assert_eq!(task.total, 2);

            let tasks = database
                .load_batch_tasks()
                .await
                .expect("tasks should load");
            assert_eq!(tasks.len(), 1);
            assert_eq!(tasks[0].task_id, task.task_id);

            let items = database
                .load_batch_task_items(&task.task_id)
                .await
                .expect("task items should load");
            assert_eq!(items.len(), 2);
            assert!(items.iter().all(|item| item.status == "queued"));
            assert_eq!(items[0].file_name, "first.flac");
            assert_eq!(items[1].file_name, "second.mp3");

            let running = database
                .start_batch_task(&task.task_id)
                .await
                .expect("task should start");
            assert_eq!(running.status, "running");
            let after_success = database
                .update_batch_task_item(&task.task_id, &items[0].item_id, "succeeded", 1.0, None)
                .await
                .expect("first item should finish");
            assert_eq!(after_success.current, 1);
            assert_eq!(after_success.success_count, 1);
            let after_skip = database
                .update_batch_task_item(
                    &task.task_id,
                    &items[1].item_id,
                    "skipped",
                    1.0,
                    Some("ReplayGain already exists".to_string()),
                )
                .await
                .expect("second item should skip");
            assert_eq!(after_skip.current, 2);
            assert_eq!(after_skip.skipped_count, 1);
            let finished = database
                .finish_batch_task(&task.task_id, "succeeded", None)
                .await
                .expect("task should finish");
            assert_eq!(finished.status, "succeeded");
            assert!(finished.finished_at.is_some());
        });
    }

    #[test]
    fn batch_task_repository_rejects_invalid_type_and_config() {
        tauri::async_runtime::block_on(async {
            let database = Database::in_memory()
                .await
                .expect("database should initialize");
            assert!(database
                .create_batch_task("unknown", &["song.flac".to_string()], None)
                .await
                .is_err());
            assert!(database
                .create_batch_task(
                    "replayGain",
                    &["song.flac".to_string()],
                    Some("not-json".to_string()),
                )
                .await
                .is_err());
        });
    }

    #[test]
    fn interrupted_batch_tasks_are_requeued_for_safe_recovery() {
        tauri::async_runtime::block_on(async {
            let database = Database::in_memory().await.expect("database should open");
            let task = database
                .create_batch_task(
                    "replayGain",
                    &["song.flac".to_string()],
                    Some(r#"{"concurrency":3}"#.to_string()),
                )
                .await
                .expect("task should be created");
            database
                .start_batch_task(&task.task_id)
                .await
                .expect("task should start");
            let item = database
                .load_batch_task_items(&task.task_id)
                .await
                .expect("items should load")
                .remove(0);
            database
                .update_batch_task_item(&task.task_id, &item.item_id, "running", 0.4, None)
                .await
                .expect("item should run");

            let recovered = database
                .recover_interrupted_batch_tasks()
                .await
                .expect("recovery should succeed");
            assert_eq!(recovered, vec![task.task_id.clone()]);
            let recovered_task = database
                .load_batch_task(&task.task_id)
                .await
                .expect("task should load");
            let recovered_item = database
                .load_batch_task_items(&task.task_id)
                .await
                .expect("items should load")
                .remove(0);
            assert_eq!(recovered_task.status, "queued");
            assert_eq!(recovered_item.status, "queued");
            assert_eq!(recovered_item.progress, Some(0.0));
            assert_eq!(
                recovered_item.error_message.as_deref(),
                Some("Recovered after application restart")
            );
        });
    }

    #[test]
    fn renamed_track_replaces_old_library_path_transactionally() {
        tauri::async_runtime::block_on(async {
            let database = Database::in_memory().await.expect("database should open");
            let old_path = "C:\\Music\\before.flac";
            let new_path = "C:\\Music\\after.flac";
            let old_track = sample_track(old_path, "before.flac");
            database
                .persist_folder_scan("C:\\Music", "test", std::slice::from_ref(&old_track))
                .await
                .expect("folder scan should persist");
            let mut renamed_track = old_track.clone();
            renamed_track.id = new_path.to_string();
            renamed_track.path = new_path.to_string();
            renamed_track.file_name = "after.flac".to_string();
            database
                .update_renamed_track_summary(old_path, &renamed_track)
                .await
                .expect("renamed path should be migrated");

            let tracks = database.load_tracks_blocking().expect("tracks should load");
            assert_eq!(tracks.len(), 1);
            assert_eq!(tracks[0].path, new_path);
            assert_eq!(tracks[0].file_name, "after.flac");
            assert!(database
                .update_renamed_track_summary(old_path, &renamed_track)
                .await
                .is_err());
        });
    }

    fn sample_track(path: &str, file_name: &str) -> AudioTrack {
        AudioTrack {
            id: path.to_string(),
            path: path.to_string(),
            file_name: file_name.to_string(),
            title: "Title".to_string(),
            artist: "Artist".to_string(),
            album: "Album".to_string(),
            album_artist: "Album Artist".to_string(),
            genre: "Pop".to_string(),
            language: String::new(),
            composer: String::new(),
            lyricist: String::new(),
            copyright: String::new(),
            rating: None,
            comment: String::new(),
            lyrics: String::new(),
            track_number: Some(1),
            disc_number: Some(1),
            year: "2026".to_string(),
            duration_seconds: 1,
            format: "FLAC".to_string(),
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
