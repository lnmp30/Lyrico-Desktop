use crate::models::{AudioTrack, LibraryFolder};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use std::fs;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

const DATABASE_SCHEMA_VERSION: u32 = 2;

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

    pub(crate) async fn load_tracks(&self) -> Result<Vec<AudioTrack>, String> {
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
            .execute("DELETE FROM songs WHERE folder_path = ?1", params![folder_path])
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

fn migrate_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(SCHEMA)
        .map_err(|error| error.to_string())?;
    add_column_if_missing(connection, "songs", "file_size", "INTEGER NOT NULL DEFAULT 0")?;
    add_column_if_missing(connection, "songs", "modified_at", "INTEGER NOT NULL DEFAULT 0")?;
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
            .execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"))
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
    })
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
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
            let database = Database::in_memory().await.expect("database should initialize");
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
            let database = Database::in_memory().await.expect("database should initialize");
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
}
