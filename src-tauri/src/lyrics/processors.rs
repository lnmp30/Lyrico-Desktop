use super::model::{ConversionMode, LyricsDocument, LyricsLine, LyricsOptions, TrackType};
use ferrous_opencc::config::BuiltinConfig;
use ferrous_opencc::OpenCC;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

pub(crate) fn process(mut document: LyricsDocument, options: &LyricsOptions) -> LyricsDocument {
    if options.conversion_mode != ConversionMode::None || options.normalize_whitespace {
        transform_text(&mut document, options);
    }
    document.tracks.retain(|track| {
        !(!options.show_translation && track.kind == TrackType::Translation)
            && !(!options.show_romanization && track.kind == TrackType::Romanization)
    });
    if !options.remove_tag_line_keywords.is_empty() {
        remove_matching_lines(&mut document, &options.remove_tag_line_keywords, true);
    }
    if options.remove_empty_lines {
        remove_matching_lines(&mut document, &[], false);
    }
    if options.only_translation_if_available {
        only_translation(&mut document);
    }
    if options.offset_ms != 0 {
        offset(&mut document, options.offset_ms);
    }
    document
}

fn converter(config: BuiltinConfig) -> &'static OpenCC {
    static T2S: OnceLock<OpenCC> = OnceLock::new();
    static S2TW: OnceLock<OpenCC> = OnceLock::new();
    match config {
        BuiltinConfig::T2s => T2S.get_or_init(|| {
            OpenCC::from_config(BuiltinConfig::T2s).expect("embedded OpenCC T2S dictionaries")
        }),
        BuiltinConfig::S2tw => S2TW.get_or_init(|| {
            OpenCC::from_config(BuiltinConfig::S2tw).expect("embedded OpenCC S2TW dictionaries")
        }),
        _ => unreachable!("only T2S and S2TW converters are used"),
    }
}

fn transform_text(document: &mut LyricsDocument, options: &LyricsOptions) {
    let transform = |value: &str| {
        let converted = match options.conversion_mode {
            ConversionMode::None => value.to_string(),
            ConversionMode::TraditionalToSimplified => converter(BuiltinConfig::T2s).convert(value),
            ConversionMode::SimplifiedToTraditional => {
                converter(BuiltinConfig::S2tw).convert(value)
            }
        };
        if options.normalize_whitespace {
            normalize_whitespace(&converted)
        } else {
            converted
        }
    };
    document.metadata.title = document.metadata.title.as_deref().map(&transform);
    document.metadata.artist = document.metadata.artist.as_deref().map(&transform);
    document.metadata.album = document.metadata.album.as_deref().map(&transform);
    for (_, value) in &mut document.metadata.extra {
        *value = transform(value);
    }
    for track in &mut document.tracks {
        for line in &mut track.lines {
            line.text = transform(&line.text);
            for word in &mut line.words {
                word.text = transform(&word.text);
            }
        }
    }
}

fn normalize_whitespace(value: &str) -> String {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN
        .get_or_init(|| Regex::new(r"[ \t\u{00a0}]+").expect("valid whitespace regex"))
        .replace_all(value, " ")
        .into_owned()
}

fn remove_matching_lines(document: &mut LyricsDocument, keywords: &[String], remove_tags: bool) {
    let mut removed_keys = HashSet::new();
    let mut removed_starts = HashSet::new();
    for track in &mut document.tracks {
        track.lines.retain(|line| {
            let remove = if keywords.is_empty() {
                is_blank_or_placeholder(&line.visible_text())
            } else {
                keywords.iter().any(|keyword| {
                    line.visible_text()
                        .to_lowercase()
                        .contains(&keyword.to_lowercase())
                })
            };
            if remove && track.kind == TrackType::Original {
                if let Some(key) = &line.link_key {
                    removed_keys.insert(key.clone());
                }
                if let Some(start) = line.start_ms {
                    removed_starts.insert(start);
                }
            }
            !remove
        });
    }
    for track in &mut document.tracks {
        if matches!(
            track.kind,
            TrackType::Translation | TrackType::Romanization | TrackType::Background
        ) {
            track.lines.retain(|line| {
                !line
                    .link_key
                    .as_ref()
                    .is_some_and(|key| removed_keys.contains(key))
                    && !line
                        .start_ms
                        .is_some_and(|start| removed_starts.contains(&start))
            });
        }
    }
    if remove_tags {
        remove_matching_tags(document, keywords);
    }
}

fn remove_matching_tags(document: &mut LyricsDocument, keywords: &[String]) {
    let matches = |key: &str, value: Option<&str>| {
        let tag = format!("[{key}:{}]", value.unwrap_or_default()).to_lowercase();
        keywords
            .iter()
            .any(|keyword| tag.contains(&keyword.to_lowercase()))
    };
    if matches("ti", document.metadata.title.as_deref()) {
        document.metadata.title = None;
    }
    if matches("ar", document.metadata.artist.as_deref()) {
        document.metadata.artist = None;
    }
    if matches("al", document.metadata.album.as_deref()) {
        document.metadata.album = None;
    }
    if matches(
        "offset",
        document
            .metadata
            .offset_ms
            .map(|value| value.to_string())
            .as_deref(),
    ) {
        document.metadata.offset_ms = None;
    }
    document
        .metadata
        .extra
        .retain(|(key, value)| !matches(key, Some(value)));
}

fn is_blank_or_placeholder(value: &str) -> bool {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    let trimmed = value.trim();
    trimmed.is_empty()
        || PATTERN
            .get_or_init(|| Regex::new(r"^[\s/\\|｜·・.。…_-]*$").expect("valid placeholder regex"))
            .is_match(trimmed)
}

fn only_translation(document: &mut LyricsDocument) {
    let Some(original_index) = document
        .tracks
        .iter()
        .position(|track| track.kind == TrackType::Original)
    else {
        return;
    };
    let Some(translation) = document
        .tracks
        .iter()
        .find(|track| track.kind == TrackType::Translation)
        .cloned()
    else {
        return;
    };
    let by_key: HashMap<_, _> = translation
        .lines
        .iter()
        .filter_map(|line| {
            line.link_key
                .as_ref()
                .map(|key| (key.clone(), line.clone()))
        })
        .collect();
    let by_start: HashMap<_, _> = translation
        .lines
        .iter()
        .filter_map(|line| line.start_ms.map(|start| (start, line.clone())))
        .collect();
    for line in &mut document.tracks[original_index].lines {
        let translated = line
            .link_key
            .as_ref()
            .and_then(|key| by_key.get(key))
            .or_else(|| line.start_ms.and_then(|start| by_start.get(&start)));
        if let Some(translated) = translated.filter(|line| !line.text.trim().is_empty()) {
            line.text = translated.text.clone();
            line.words.clear();
        }
    }
    document
        .tracks
        .retain(|track| !matches!(track.kind, TrackType::Translation | TrackType::Background));
}

fn offset(document: &mut LyricsDocument, offset_ms: i64) {
    let shift = |value: &mut Option<i64>| {
        if let Some(current) = value {
            *current = (*current + offset_ms).max(0);
        }
    };
    for track in &mut document.tracks {
        for line in &mut track.lines {
            shift(&mut line.start_ms);
            shift(&mut line.end_ms);
            for word in &mut line.words {
                shift(&mut word.start_ms);
                shift(&mut word.end_ms);
            }
        }
    }
}

#[allow(dead_code)]
fn _line_visible_text(line: &LyricsLine) -> String {
    line.visible_text()
}
