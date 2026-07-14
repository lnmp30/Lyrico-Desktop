use super::model::{
    LineTrack, LyricFormat, LyricsDocument, LyricsLine, LyricsMetadata, LyricsOptions, LyricsTrack,
    LyricsWord, TrackType,
};
use regex::Regex;
use std::sync::OnceLock;

pub(crate) fn parse(raw: &str, format: LyricFormat) -> LyricsDocument {
    let tag_pattern = Regex::new(r"^\[([A-Za-z][\w-]*):([^\]]*)\]\s*$").expect("valid tag regex");
    let mut tags = Vec::new();
    let mut parsed = Vec::new();
    for source_line in raw.lines() {
        if let Some(captures) = tag_pattern.captures(source_line) {
            let key = captures[1].to_string();
            if !key.chars().all(|value| value.is_ascii_digit()) {
                tags.push((key, captures[2].to_string()));
                continue;
            }
        }
        match format {
            LyricFormat::PlainLrc => parsed.extend(parse_plain_line(source_line)),
            LyricFormat::EnhancedLrc => {
                if let Some(line) = parse_timed_line(source_line, '<', '>') {
                    parsed.push(line);
                }
            }
            LyricFormat::VerbatimLrc => {
                if let Some(line) = parse_timed_line(source_line, '[', ']') {
                    parsed.push(line);
                }
            }
            LyricFormat::Ttml => unreachable!("TTML is parsed by the TTML parser"),
        }
    }
    LyricsDocument {
        metadata: LyricsMetadata::from_lrc_tags(tags),
        agents: Vec::new(),
        tracks: classify_tracks(parsed),
        source_format: Some(format),
    }
}

fn timestamp_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)").expect("valid timestamp regex")
    })
}

fn parse_plain_line(line: &str) -> Vec<LyricsLine> {
    let prefix = Regex::new(r"^(?:\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\])+")
        .expect("valid plain LRC prefix regex");
    let Some(found) = prefix.find(line) else {
        return Vec::new();
    };
    let text = line[found.end()..].to_string();
    timestamp_pattern()
        .captures_iter(found.as_str())
        .filter_map(|capture| parse_lrc_time(&capture[1]))
        .map(|start_ms| LyricsLine {
            start_ms: Some(start_ms),
            end_ms: Some(start_ms + 2_000),
            text: text.clone(),
            ..LyricsLine::default()
        })
        .collect()
}

#[derive(Clone, Copy)]
struct Stamp<'a> {
    start: usize,
    end: usize,
    value: &'a str,
}

fn parse_timed_line(line: &str, open: char, close: char) -> Option<LyricsLine> {
    let mut source = line;
    let mut line_start = None;
    if open == '<' && line.starts_with('[') {
        if let Some(end) = line.find(']') {
            let value = &line[1..end];
            line_start = parse_lrc_time(value);
            if line_start.is_some() {
                source = &line[end + 1..];
            }
        }
    }

    let escaped_open = regex::escape(&open.to_string());
    let escaped_close = regex::escape(&close.to_string());
    let pattern = Regex::new(&format!(
        r"{}(\d{{1,3}}:\d{{2}}(?:[.:]\d{{1,3}})?){}",
        escaped_open, escaped_close
    ))
    .expect("valid timed LRC regex");
    let stamps: Vec<_> = pattern
        .captures_iter(source)
        .filter_map(|capture| {
            let full = capture.get(0)?;
            let value = capture.get(1)?.as_str();
            Some(Stamp {
                start: full.start(),
                end: full.end(),
                value,
            })
        })
        .collect();
    let start_ms =
        line_start.or_else(|| stamps.first().and_then(|stamp| parse_lrc_time(stamp.value)))?;
    if stamps.is_empty() {
        return Some(LyricsLine {
            start_ms: Some(start_ms),
            end_ms: Some(start_ms + 2_000),
            text: source.to_string(),
            ..LyricsLine::default()
        });
    }

    let last = stamps.last().copied()?;
    let trailing_text = &source[last.end..];
    let has_explicit_end = stamps.len() > 1 && trailing_text.is_empty();
    let word_count = stamps.len() - usize::from(has_explicit_end);
    let explicit_end = has_explicit_end
        .then(|| parse_lrc_time(last.value))
        .flatten();
    let mut words = Vec::new();
    for index in 0..word_count {
        let stamp = stamps[index];
        let word_start = parse_lrc_time(stamp.value)?;
        let content_end = stamps
            .get(index + 1)
            .map(|next| next.start)
            .unwrap_or(source.len());
        let text = source[stamp.end..content_end].to_string();
        if text.is_empty() {
            continue;
        }
        let next_time = stamps
            .get(index + 1)
            .and_then(|next| parse_lrc_time(next.value));
        words.push(LyricsWord {
            start_ms: Some(word_start),
            end_ms: next_time.or(explicit_end).or(Some(word_start + 500)),
            text,
        });
    }
    let text = words.iter().map(|word| word.text.as_str()).collect();
    let end_ms = explicit_end
        .or_else(|| words.last().and_then(|word| word.end_ms))
        .unwrap_or(start_ms + 2_000);
    Some(LyricsLine {
        start_ms: Some(start_ms),
        end_ms: Some(end_ms),
        text,
        words,
        ..LyricsLine::default()
    })
}

fn classify_tracks(lines: Vec<LyricsLine>) -> Vec<LyricsTrack> {
    let mut groups: Vec<(i64, Vec<LyricsLine>)> = Vec::new();
    for line in lines {
        let key = line.start_ms.unwrap_or(-1);
        if let Some((_, group)) = groups.iter_mut().find(|(start, _)| *start == key) {
            group.push(line);
        } else {
            groups.push((key, vec![line]));
        }
    }

    let mut original = Vec::new();
    let mut translation = Vec::new();
    let mut romanization = Vec::new();
    for (index, (_, mut group)) in groups.into_iter().enumerate() {
        let mut first = group.remove(0);
        let first_text = first.visible_text();
        let link_key = format!("L{}", index + 1);
        first.link_key = Some(link_key.clone());
        original.push(first);
        for mut candidate in group {
            candidate.link_key = Some(link_key.clone());
            candidate.words.clear();
            if looks_like_romanization(&candidate.text, &first_text)
                && !romanization
                    .iter()
                    .any(|line: &LyricsLine| line.link_key.as_deref() == Some(link_key.as_str()))
            {
                romanization.push(candidate);
            } else {
                translation.push(candidate);
            }
        }
    }
    let mut tracks = vec![LyricsTrack::new(TrackType::Original, original)];
    if !translation.is_empty() {
        tracks.push(LyricsTrack::new(TrackType::Translation, translation));
    }
    if !romanization.is_empty() {
        tracks.push(LyricsTrack::new(TrackType::Romanization, romanization));
    }
    tracks
}

fn looks_like_romanization(value: &str, original: &str) -> bool {
    static ORIGINAL: OnceLock<Regex> = OnceLock::new();
    static LATIN: OnceLock<Regex> = OnceLock::new();
    let original_pattern = ORIGINAL.get_or_init(|| {
        Regex::new(r"[\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}]")
            .expect("valid original script regex")
    });
    let latin_pattern = LATIN.get_or_init(|| {
        Regex::new(r"^[\p{Latin}\p{Number}\p{Punctuation}\p{Separator}]+$")
            .expect("valid romanization regex")
    });
    original_pattern.is_match(original) && latin_pattern.is_match(value)
}

pub(crate) fn write(
    document: &LyricsDocument,
    format: LyricFormat,
    options: &LyricsOptions,
) -> String {
    let tags: Vec<_> = document
        .metadata
        .lrc_tags()
        .into_iter()
        .map(|(key, value)| format!("[{key}:{value}]"))
        .collect();
    let original = track_lines(document, TrackType::Original);
    let translations = track_lines(document, TrackType::Translation);
    let romanizations = track_lines(document, TrackType::Romanization);
    let mut output = Vec::new();
    for line in original {
        for kind in options.normalized_line_order() {
            match kind {
                LineTrack::Original => output.push(write_original_line(line, format)),
                LineTrack::Translation => {
                    if let Some(linked) = find_linked(&translations, line) {
                        if !linked.text.is_empty() {
                            output.push(format!(
                                "[{}]{}",
                                lrc_time(line.start_ms.unwrap_or(0)),
                                linked.text
                            ));
                        }
                    }
                }
                LineTrack::Romanization => {
                    if let Some(linked) = find_linked(&romanizations, line) {
                        if !linked.text.is_empty() {
                            output.push(format!(
                                "[{}]{}",
                                lrc_time(line.start_ms.unwrap_or(0)),
                                linked.text
                            ));
                        }
                    }
                }
            }
        }
    }
    let mut lines = tags;
    if !lines.is_empty() && !output.is_empty() {
        lines.push(String::new());
    }
    lines.extend(output);
    lines.join("\n")
}

fn write_original_line(line: &LyricsLine, format: LyricFormat) -> String {
    let start = line.start_ms.unwrap_or(0);
    let text = line.visible_text();
    let words = resolved_timed_words(&line.words);
    if format == LyricFormat::PlainLrc || words.is_empty() {
        return format!("[{}]{text}", lrc_time(start));
    }
    let end = line
        .end_ms
        .or_else(|| words.last().and_then(|word| word.end_ms))
        .unwrap_or(start + 2_000);
    if format == LyricFormat::VerbatimLrc {
        let body: String = words
            .iter()
            .map(|word| format!("[{}]{}", lrc_time(word.start_ms.unwrap()), word.text))
            .collect();
        return format!("{body}[{}]", lrc_time(end));
    }
    let body: String = words
        .iter()
        .map(|word| format!("<{}>{}", lrc_time(word.start_ms.unwrap()), word.text))
        .collect();
    format!("[{}]{body}<{}>", lrc_time(start), lrc_time(end))
}

pub(crate) fn resolved_timed_words(words: &[LyricsWord]) -> Vec<LyricsWord> {
    let mut result: Vec<LyricsWord> = Vec::new();
    let mut pending = String::new();
    for word in words {
        if word.start_ms.is_none() {
            if let Some(last) = result.last_mut() {
                last.text.push_str(&word.text);
            } else {
                pending.push_str(&word.text);
            }
            continue;
        }
        let mut word = word.clone();
        word.text = format!("{pending}{}", word.text);
        pending.clear();
        result.push(word);
    }
    if !pending.is_empty() {
        if let Some(last) = result.last_mut() {
            last.text.push_str(&pending);
        }
    }
    result
}

pub(crate) fn track_lines(document: &LyricsDocument, kind: TrackType) -> Vec<&LyricsLine> {
    document
        .tracks
        .iter()
        .filter(|track| track.kind == kind)
        .flat_map(|track| track.lines.iter())
        .collect()
}

pub(crate) fn find_linked<'a>(
    lines: &'a [&LyricsLine],
    line: &LyricsLine,
) -> Option<&'a LyricsLine> {
    lines.iter().copied().find(|candidate| {
        (line.link_key.is_some() && candidate.link_key == line.link_key)
            || (line.start_ms.is_some() && candidate.start_ms == line.start_ms)
    })
}

pub(crate) fn parse_lrc_time(value: &str) -> Option<i64> {
    let pattern =
        Regex::new(r"^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$").expect("valid LRC time regex");
    let captures = pattern.captures(value)?;
    Some(
        captures[1].parse::<i64>().ok()? * 60_000
            + captures[2].parse::<i64>().ok()? * 1_000
            + fraction_ms(captures.get(3).map(|value| value.as_str())),
    )
}

pub(crate) fn fraction_ms(value: Option<&str>) -> i64 {
    let Some(value) = value else { return 0 };
    let padded = format!("{value}000");
    padded[..3].parse().unwrap_or(0)
}

pub(crate) fn lrc_time(milliseconds: i64) -> String {
    let safe = milliseconds.max(0);
    format!(
        "{:02}:{:02}.{:03}",
        safe / 60_000,
        (safe % 60_000) / 1_000,
        safe % 1_000
    )
}
