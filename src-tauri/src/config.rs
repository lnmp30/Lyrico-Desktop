use crate::models::ArtistSplitConfig;
use crate::paths::resolve_data_paths;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use tauri::AppHandle;

const CONFIG_SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct DesktopSettings {
    pub(crate) search_page_size: u32,
    pub(crate) lyric_format: String,
    pub(crate) show_translation: bool,
    pub(crate) show_romanization: bool,
    pub(crate) only_translation_if_available: bool,
    pub(crate) remove_empty_lyric_lines: bool,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            search_page_size: 10,
            lyric_format: "verbatimLrc".to_string(),
            show_translation: true,
            show_romanization: true,
            only_translation_if_available: false,
            remove_empty_lyric_lines: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct AppConfig {
    schema_version: u32,
    artist_split: ArtistSplitConfig,
    settings: DesktopSettings,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            artist_split: ArtistSplitConfig::default(),
            settings: DesktopSettings::default(),
        }
    }
}

pub(crate) fn load_desktop_settings(app: &AppHandle) -> Result<DesktopSettings, String> {
    Ok(load_config(app)?.settings)
}

pub(crate) fn save_desktop_settings(
    app: &AppHandle,
    mut settings: DesktopSettings,
) -> Result<(), String> {
    settings.search_page_size = settings.search_page_size.clamp(5, 50);
    if !matches!(
        settings.lyric_format.as_str(),
        "plainLrc" | "verbatimLrc" | "enhancedLrc" | "ttml"
    ) {
        settings.lyric_format = DesktopSettings::default().lyric_format;
    }
    let mut config = load_config(app)?;
    config.schema_version = CONFIG_SCHEMA_VERSION;
    config.settings = settings;
    write_json(&resolve_data_paths(app)?.settings, &config)
}

pub(crate) fn load_artist_split_config(app: &AppHandle) -> Result<ArtistSplitConfig, String> {
    Ok(load_config(app)?.artist_split)
}

pub(crate) fn save_artist_split_config(
    app: &AppHandle,
    artist_split: ArtistSplitConfig,
) -> Result<(), String> {
    let mut config = load_config(app)?;
    config.schema_version = CONFIG_SCHEMA_VERSION;
    config.artist_split = artist_split;
    let path = resolve_data_paths(app)?.settings;
    write_json(&path, &config)
}

pub(crate) fn migrate_legacy_artist_split_config(
    app: &AppHandle,
    legacy_value: Option<String>,
) -> Result<(), String> {
    let path = resolve_data_paths(app)?.settings;
    if path.exists() {
        return Ok(());
    }
    let Some(legacy_value) = legacy_value else {
        return Ok(());
    };
    let artist_split = serde_json::from_str(&legacy_value).map_err(|error| {
        format!("Failed to migrate the legacy artist split configuration: {error}")
    })?;
    write_json(
        &path,
        &AppConfig {
            schema_version: CONFIG_SCHEMA_VERSION,
            artist_split,
            settings: DesktopSettings::default(),
        },
    )
}

fn load_config(app: &AppHandle) -> Result<AppConfig, String> {
    let path = resolve_data_paths(app)?.settings;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let contents = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| {
        format!(
            "Failed to parse application configuration at {}: {error}",
            path.display()
        )
    })
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    if path.exists() {
        fs::copy(path, &backup).map_err(|error| error.to_string())?;
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}
