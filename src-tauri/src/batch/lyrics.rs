use super::processor::{BatchProcessor, ProcessContext, ProcessError, ProcessOutcome};
use crate::audio::{read_track, write_lyrics_tag, ArtworkMode};
use rquickjs::{Context, Function, Runtime};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

const LYRICS_RUNTIME: &str = include_str!("lyrics_runtime.js");
const MEMORY_LIMIT: usize = 128 * 1024 * 1024;
const STACK_LIMIT: usize = 2 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LyricsFormatConfig {
    target_format: Option<String>,
    #[serde(default = "default_concurrency")]
    concurrency: usize,
    #[serde(default = "default_true")]
    format_line_order: bool,
    #[serde(default)]
    remove_tag_lines: bool,
    #[serde(default)]
    tag_line_keywords: Vec<String>,
    #[serde(default)]
    remove_empty_lines: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LyricsPipelineResult {
    pub(super) text: String,
    warnings: Vec<String>,
    source_format: Option<String>,
    target_format: String,
}

pub(super) struct LyricsFormatProcessor;

impl BatchProcessor for LyricsFormatProcessor {
    fn process(
        &self,
        context: ProcessContext<'_>,
        on_progress: &mut dyn FnMut(f64),
    ) -> Result<ProcessOutcome, ProcessError> {
        if context.cancelled.load(Ordering::Relaxed) {
            return Err(ProcessError::Cancelled("Batch item cancelled".to_string()));
        }
        let config = parse_config(context.task.config_json.as_deref())?;
        let path = Path::new(&context.item.song_path);
        let existing = read_track(path, context.artist_separator, ArtworkMode::None)
            .map_err(|error| ProcessError::Failed(error.to_string()))?;
        if existing.lyrics.trim().is_empty() {
            return Err(ProcessError::Skipped("No lyrics".to_string()));
        }

        let result = process_lyrics(&existing.lyrics, &config).map_err(ProcessError::Failed)?;
        if result.text.trim().is_empty() {
            return Err(ProcessError::Failed(
                "Lyrics conversion produced an empty result".to_string(),
            ));
        }
        if result.text == existing.lyrics {
            return Err(ProcessError::Skipped(
                "Converted lyrics are unchanged".to_string(),
            ));
        }
        on_progress(0.75);
        if context.cancelled.load(Ordering::Relaxed) {
            return Err(ProcessError::Cancelled("Batch item cancelled".to_string()));
        }
        let updated = write_lyrics_tag(path, context.artist_separator, result.text)
            .map_err(ProcessError::Failed)?;
        Ok(ProcessOutcome {
            result_json: Some(
                json!({
                    "sourceFormat": result.source_format,
                    "targetFormat": result.target_format,
                    "warnings": result.warnings,
                })
                .to_string(),
            ),
            updated_track: Some(updated),
        })
    }
}

fn default_concurrency() -> usize {
    3
}

fn default_true() -> bool {
    true
}

fn parse_config(config_json: Option<&str>) -> Result<LyricsFormatConfig, ProcessError> {
    let raw = config_json.ok_or_else(|| ProcessError::Skipped("No config".to_string()))?;
    let mut config: LyricsFormatConfig = serde_json::from_str(raw)
        .map_err(|error| ProcessError::Failed(format!("Invalid lyrics format config: {error}")))?;
    config.target_format = config
        .target_format
        .as_deref()
        .map(normalize_format)
        .transpose()
        .map_err(ProcessError::Failed)?;
    config.concurrency = config.concurrency.clamp(1, 5);
    config.tag_line_keywords = config
        .tag_line_keywords
        .into_iter()
        .map(|keyword| keyword.trim().to_string())
        .filter(|keyword| !keyword.is_empty())
        .collect();
    let removes_tag_lines = config.remove_tag_lines && !config.tag_line_keywords.is_empty();
    if config.target_format.is_none()
        && !config.format_line_order
        && !removes_tag_lines
        && !config.remove_empty_lines
    {
        return Err(ProcessError::Skipped(
            "No lyrics operation selected".to_string(),
        ));
    }
    Ok(config)
}

fn normalize_format(value: &str) -> Result<String, String> {
    match value {
        "plainLrc" | "PLAIN_LRC" => Ok("plainLrc".to_string()),
        "verbatimLrc" | "VERBATIM_LRC" => Ok("verbatimLrc".to_string()),
        "enhancedLrc" | "ENHANCED_LRC" => Ok("enhancedLrc".to_string()),
        "ttml" | "TTML" => Ok("ttml".to_string()),
        other => Err(format!("Unsupported lyrics format: {other}")),
    }
}

fn process_lyrics(
    lyrics: &str,
    config: &LyricsFormatConfig,
) -> Result<LyricsPipelineResult, String> {
    run_runtime(
        "__lyricoProcessBatchLyrics",
        json!({
            "lyrics": lyrics,
            "config": config,
        }),
    )
}

pub(super) fn render_plugin_lyrics(
    result: &Value,
    target_format: &str,
    options: Value,
) -> Result<LyricsPipelineResult, String> {
    run_runtime(
        "__lyricoRenderPluginLyrics",
        json!({
            "result": result,
            "targetFormat": target_format,
            "options": options,
        }),
    )
}

fn run_runtime(entry_point: &str, request: Value) -> Result<LyricsPipelineResult, String> {
    let runtime = Runtime::new().map_err(|error| error.to_string())?;
    runtime.set_memory_limit(MEMORY_LIMIT);
    runtime.set_max_stack_size(STACK_LIMIT);
    let started = Instant::now();
    runtime.set_interrupt_handler(Some(Box::new(move || started.elapsed() >= TIMEOUT)));
    let context = Context::full(&runtime).map_err(|error| error.to_string())?;
    context.with(|ctx| {
        ctx.eval::<(), _>(LYRICS_RUNTIME.as_bytes())
            .map_err(|error| format_js_error(&ctx, error))?;
        let function: Function = ctx
            .globals()
            .get(entry_point)
            .map_err(|_| "Lyrics runtime entry point is missing".to_string())?;
        let request_json = serde_json::to_string(&request).map_err(|error| error.to_string())?;
        let request = ctx
            .json_parse(request_json)
            .map_err(|error| format_js_error(&ctx, error))?;
        let output = function
            .call::<_, rquickjs::Value>((request,))
            .map_err(|error| format_js_error(&ctx, error))?;
        let output = ctx
            .json_stringify(output)
            .map_err(|error| format_js_error(&ctx, error))?
            .ok_or_else(|| "Lyrics runtime returned no result".to_string())?;
        serde_json::from_str(
            output
                .to_string()
                .map_err(|error| error.to_string())?
                .as_str(),
        )
        .map_err(|error| error.to_string())
    })
}

fn format_js_error(ctx: &rquickjs::Ctx<'_>, error: rquickjs::Error) -> String {
    if ctx.has_exception() {
        let exception = ctx.catch();
        format!("{error}: {exception:?}")
    } else {
        error.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(target_format: Option<&str>) -> LyricsFormatConfig {
        LyricsFormatConfig {
            target_format: target_format.map(ToOwned::to_owned),
            concurrency: 3,
            format_line_order: true,
            remove_tag_lines: false,
            tag_line_keywords: Vec::new(),
            remove_empty_lines: false,
        }
    }

    #[test]
    fn runtime_uses_the_shared_mobile_lyrics_pipeline() {
        let raw = "[00:01.000]<00:01.000>故<00:01.500>事<00:02.000>";
        let result = process_lyrics(raw, &config(Some("plainLrc"))).expect("runtime should run");
        assert_eq!(result.source_format.as_deref(), Some("enhancedLrc"));
        assert_eq!(result.target_format, "plainLrc");
        assert!(result.text.contains("[00:01.000]故事"));
    }

    #[test]
    fn runtime_filters_linked_ttml_tag_lines() {
        let raw = r#"<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation><text for="L1">translation credit</text><text for="L2">译文</text></translation></translations></iTunesMetadata></metadata></head><body><div><p begin="1s" end="2s" itunes:key="L1">producer credit</p><p begin="2s" end="3s" itunes:key="L2">歌词</p></div></body></tt>"#;
        let mut config = config(Some("plainLrc"));
        config.remove_tag_lines = true;
        config.tag_line_keywords = vec!["credit".to_string()];
        let result = process_lyrics(raw, &config).expect("runtime should run");
        assert!(!result.text.contains("credit"));
        assert!(result.text.contains("歌词"));
        assert!(result.text.contains("译文"));
    }

    #[test]
    fn config_accepts_mobile_enum_names_and_rejects_no_op_requests() {
        let parsed = parse_config(Some(
            r#"{"targetFormat":"VERBATIM_LRC","concurrency":9,"formatLineOrder":false}"#,
        ))
        .expect("mobile config should parse");
        assert_eq!(parsed.target_format.as_deref(), Some("verbatimLrc"));
        assert_eq!(parsed.concurrency, 5);

        assert!(matches!(
            parse_config(Some(
                r#"{"targetFormat":null,"concurrency":3,"formatLineOrder":false}"#
            )),
            Err(ProcessError::Skipped(_))
        ));
    }

    #[test]
    fn metadata_match_runtime_renders_plugin_lyrics_with_opencc() {
        let result = render_plugin_lyrics(
            &json!({
                "type":"structured",
                "original":[[1000,2000,[[1000,1500,"這"],[1500,2000,"裡"]]]],
                "translated":[[1000,2000,"繁體翻譯"]]
            }),
            "plainLrc",
            json!({
                "showTranslation":true,
                "showRomanization":false,
                "conversionMode":"traditionalToSimplified"
            }),
        )
        .expect("plugin lyrics should render");
        assert!(result.text.contains("这里"));
        assert!(result.text.contains("繁体翻译"));
    }
}
