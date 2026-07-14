use crate::lyrics::{self, LyricFormat, LyricsOptions, LyricsPipelineResult};
use serde_json::Value;

#[tauri::command]
pub(crate) async fn process_lyrics_text(
    raw: String,
    options: LyricsOptions,
) -> Result<LyricsPipelineResult, String> {
    tauri::async_runtime::spawn_blocking(move || lyrics::process_text(&raw, &options))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn render_plugin_lyrics(
    result: Value,
    target_format: LyricFormat,
    options: LyricsOptions,
) -> Result<LyricsPipelineResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        lyrics::process_plugin_result(&result, target_format, &options)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn extract_plain_lyrics_text(raw: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || lyrics::extract_plain_text(&raw))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn detect_lyrics_format(raw: String) -> Result<LyricFormat, String> {
    tauri::async_runtime::spawn_blocking(move || lyrics::detect_format(&raw))
        .await
        .map_err(|error| error.to_string())
}
