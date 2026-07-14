use super::lrc::{find_linked, resolved_timed_words, track_lines};
use super::model::{
    LyricFormat, LyricsAgent, LyricsDocument, LyricsLine, LyricsMetadata, LyricsTrack, LyricsWord,
    TrackType,
};
use regex::Regex;
use roxmltree::Node;
use std::collections::HashSet;

const NS_XML: &str = "http://www.w3.org/XML/1998/namespace";

pub(crate) fn parse(raw: &str) -> LyricsDocument {
    let Ok(xml) = roxmltree::Document::parse(raw) else {
        return empty_document();
    };
    let root = xml.root_element();
    if root.tag_name().name() != "tt" {
        return empty_document();
    }

    let agents = root
        .descendants()
        .filter(|node| is_element(*node, "agent"))
        .filter_map(|node| {
            let id = attr(&node, "id")?;
            let name = visible_text(node).trim().to_string();
            Some(LyricsAgent {
                id: id.to_string(),
                kind: attr(&node, "type").map(str::to_string),
                name: (!name.is_empty()).then_some(name),
            })
        })
        .collect();

    let mut original = Vec::new();
    let mut inline_translation = Vec::new();
    let mut romanization = Vec::new();
    let mut background = Vec::new();
    for p in root.descendants().filter(|node| is_element(*node, "p")) {
        let start_ms = attr(&p, "begin").and_then(parse_time);
        let end_ms = attr(&p, "end").and_then(parse_time);
        if start_ms.is_none() && end_ms.is_none() {
            continue;
        }
        let start = start_ms.unwrap_or(0);
        let end = end_ms.or(start_ms).unwrap_or(0);
        let link_key = attr(&p, "key").map(str::to_string);
        let agent_id = attr(&p, "agent").map(str::to_string);
        let parsed = parse_p_text(p, start, end, link_key.as_deref());
        let line = LyricsLine {
            start_ms,
            end_ms,
            text: parsed.original_text.clone(),
            words: parsed.words,
            link_key: link_key.clone(),
            agent_id,
        };
        match attr(&p, "role") {
            Some("x-translation") => inline_translation.push(line),
            Some("x-romanization") => romanization.push(line),
            Some("x-bg") => background.push(line),
            _ => {
                original.push(line);
                if !parsed.translation_text.trim().is_empty() {
                    inline_translation.push(linked_text_line(
                        parsed.translation_text,
                        start_ms,
                        end_ms,
                        link_key.clone(),
                    ));
                }
                if !parsed.romanization_text.trim().is_empty() {
                    romanization.push(linked_text_line(
                        parsed.romanization_text,
                        start_ms,
                        end_ms,
                        link_key.clone(),
                    ));
                }
                background.extend(parsed.background_lines.into_iter().map(|mut line| {
                    line.start_ms = line.start_ms.or(start_ms);
                    line.end_ms = line.end_ms.or(end_ms);
                    line.link_key = line.link_key.or_else(|| link_key.clone());
                    line
                }));
            }
        }
    }

    let mut translations = Vec::new();
    for translation in root
        .descendants()
        .filter(|node| is_element(*node, "translation"))
    {
        let lines: Vec<_> = translation
            .children()
            .filter(|node| is_element(*node, "text"))
            .filter_map(|node| {
                let key = attr(&node, "for")?;
                let text = normalize_text(&visible_text(node), true);
                (!text.is_empty())
                    .then(|| linked_text_line(text, None, None, Some(key.to_string())))
            })
            .collect();
        if !lines.is_empty() {
            translations.push(LyricsTrack {
                kind: TrackType::Translation,
                language: attr(&translation, "lang").map(str::to_string),
                lines,
            });
        }
    }
    if translations.is_empty() && !inline_translation.is_empty() {
        translations.push(LyricsTrack::new(TrackType::Translation, inline_translation));
    }

    let mut tracks = vec![LyricsTrack::new(TrackType::Original, original)];
    tracks.extend(translations);
    if !romanization.is_empty() {
        tracks.push(LyricsTrack::new(TrackType::Romanization, romanization));
    }
    if !background.is_empty() {
        tracks.push(LyricsTrack::new(TrackType::Background, background));
    }
    LyricsDocument {
        metadata: LyricsMetadata {
            language: root.attribute((NS_XML, "lang")).map(str::to_string),
            ..LyricsMetadata::default()
        },
        agents,
        tracks,
        source_format: Some(LyricFormat::Ttml),
    }
}

fn empty_document() -> LyricsDocument {
    LyricsDocument {
        source_format: Some(LyricFormat::Ttml),
        ..LyricsDocument::default()
    }
}

struct ParsedPText {
    original_text: String,
    translation_text: String,
    romanization_text: String,
    background_lines: Vec<LyricsLine>,
    words: Vec<LyricsWord>,
}

fn parse_p_text(
    p: Node<'_, '_>,
    fallback_start: i64,
    fallback_end: i64,
    link_key: Option<&str>,
) -> ParsedPText {
    let mut original = String::new();
    let mut translation = String::new();
    let mut romanization = String::new();
    let mut background = Vec::new();
    let mut words = Vec::new();

    for child in p.children() {
        if child.is_text() {
            let text = normalize_text(child.text().unwrap_or_default(), false);
            if text.contains('\n') || text.trim().is_empty() && text != " " {
                continue;
            }
            if words.is_empty() {
                original.push_str(&text);
            } else if !text.is_empty() {
                words.push(LyricsWord {
                    text,
                    ..LyricsWord::default()
                });
            }
            continue;
        }
        if !child.is_element() {
            continue;
        }
        let text = normalize_text(&visible_text(child), false);
        match attr(&child, "role") {
            Some("x-translation") => translation.push_str(text.trim()),
            Some("x-romanization") => romanization.push_str(text.trim()),
            Some("x-bg") => {
                let bg_words = parse_timed_words(child, fallback_end);
                background.push(LyricsLine {
                    start_ms: attr(&child, "begin")
                        .and_then(parse_time)
                        .or(Some(fallback_start)),
                    end_ms: attr(&child, "end")
                        .and_then(parse_time)
                        .or(Some(fallback_end)),
                    text: normalize_text(&visible_text(child), true),
                    words: bg_words,
                    link_key: link_key.map(str::to_string),
                    agent_id: None,
                });
            }
            _ => {
                if let Some(start_ms) = attr(&child, "begin").and_then(parse_time) {
                    words.push(LyricsWord {
                        start_ms: Some(start_ms),
                        end_ms: attr(&child, "end")
                            .and_then(parse_time)
                            .or(Some(fallback_end)),
                        text,
                    });
                } else {
                    let child_words = parse_timed_words(child, fallback_end);
                    if child_words.iter().any(|word| word.start_ms.is_some()) {
                        words.extend(child_words);
                    } else {
                        original.push_str(&text);
                    }
                }
            }
        }
    }
    let original_text = if words.is_empty() {
        normalize_text(&original, true)
    } else {
        words.iter().map(|word| word.text.as_str()).collect()
    };
    ParsedPText {
        original_text,
        translation_text: normalize_text(&translation, true),
        romanization_text: normalize_text(&romanization, true),
        background_lines: background,
        words,
    }
}

fn parse_timed_words(element: Node<'_, '_>, fallback_end: i64) -> Vec<LyricsWord> {
    let mut words = Vec::new();
    for child in element.children() {
        if child.is_text() {
            let text = normalize_text(child.text().unwrap_or_default(), false);
            if !text.is_empty() && !text.contains('\n') {
                words.push(LyricsWord {
                    text,
                    ..LyricsWord::default()
                });
            }
            continue;
        }
        if !child.is_element() {
            continue;
        }
        let start_ms = attr(&child, "begin").and_then(parse_time);
        let end_ms = attr(&child, "end")
            .and_then(parse_time)
            .or(Some(fallback_end));
        let text = normalize_text(&visible_text(child), false);
        if start_ms.is_some() && !text.is_empty() {
            words.push(LyricsWord {
                start_ms,
                end_ms,
                text,
            });
        } else {
            words.extend(parse_timed_words(child, fallback_end));
        }
    }
    words
}

fn linked_text_line(
    text: String,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    link_key: Option<String>,
) -> LyricsLine {
    LyricsLine {
        start_ms,
        end_ms,
        text,
        words: Vec::new(),
        link_key,
        agent_id: None,
    }
}

pub(crate) fn write(document: &LyricsDocument) -> String {
    let original = track_lines(document, TrackType::Original);
    let translation_tracks: Vec<_> = document
        .tracks
        .iter()
        .filter(|track| track.kind == TrackType::Translation)
        .collect();
    let romanizations = track_lines(document, TrackType::Romanization);
    let backgrounds = track_lines(document, TrackType::Background);
    let mut used: HashSet<String> = original
        .iter()
        .filter_map(|line| line.link_key.clone())
        .collect();
    let mut next_key = 1;
    let keys: Vec<_> = original
        .iter()
        .map(|line| {
            if let Some(key) = &line.link_key {
                return Some(key.clone());
            }
            let needs_key = translation_tracks.iter().any(|track| {
                track.lines.iter().any(|candidate| {
                    candidate.start_ms.is_some() && candidate.start_ms == line.start_ms
                })
            });
            if !needs_key {
                return None;
            }
            loop {
                let key = format!("L{next_key}");
                next_key += 1;
                if used.insert(key.clone()) {
                    break Some(key);
                }
            }
        })
        .collect();

    let mut output = String::from("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
    output.push_str("<tt xmlns=\"http://www.w3.org/ns/ttml\" xmlns:ttm=\"http://www.w3.org/ns/ttml#metadata\" xmlns:itunes=\"http://music.apple.com/lyric-ttml-internal\"");
    if let Some(language) = &document.metadata.language {
        output.push_str(&format!(" xml:lang=\"{}\"", escape_xml(language)));
    }
    output.push_str(">\n");
    append_head(&mut output, document, &original, &keys, &translation_tracks);
    output.push_str("  <body>\n    <div>\n");
    for (index, line) in original.iter().enumerate() {
        let Some(start) = line.start_ms else { continue };
        let end = line
            .end_ms
            .or_else(|| line.words.last().and_then(|word| word.end_ms))
            .unwrap_or(start + 2_000);
        output.push_str(&format!(
            "      <p begin=\"{}\" end=\"{}\"",
            ttml_time(start),
            ttml_time(end)
        ));
        if let Some(key) = &keys[index] {
            output.push_str(&format!(" itunes:key=\"{}\"", escape_xml(key)));
        }
        if let Some(agent) = &line.agent_id {
            output.push_str(&format!(" ttm:agent=\"{}\"", escape_xml(agent)));
        }
        output.push('>');
        let timed = resolved_timed_words(&line.words);
        if timed.len() > 1 {
            output.push_str(&write_word_content(&line.words, end));
        } else {
            output.push_str(&escape_xml(&line.visible_text()));
        }
        if let Some(romanization) = find_linked(&romanizations, line) {
            if !romanization.text.is_empty() {
                output.push_str(&format!(
                    "<span ttm:role=\"x-romanization\">{}</span>",
                    escape_xml(&romanization.text)
                ));
            }
        }
        for background in backgrounds
            .iter()
            .filter(|candidate| is_linked(candidate, line))
        {
            let content = if resolved_timed_words(&background.words).is_empty() {
                escape_xml(&background.visible_text())
            } else {
                write_word_content(&background.words, end)
            };
            output.push_str(&format!("<span ttm:role=\"x-bg\">{content}</span>"));
        }
        output.push_str("</p>\n");
    }
    output.push_str("    </div>\n  </body>\n</tt>");
    output
}

fn append_head(
    output: &mut String,
    document: &LyricsDocument,
    original: &[&LyricsLine],
    keys: &[Option<String>],
    translations: &[&LyricsTrack],
) {
    if document.agents.is_empty() && translations.is_empty() {
        return;
    }
    output.push_str("  <head>\n");
    if !document.agents.is_empty() {
        output.push_str("    <metadata>\n");
        for agent in &document.agents {
            output.push_str(&format!(
                "      <ttm:agent xml:id=\"{}\"",
                escape_xml(&agent.id)
            ));
            if let Some(kind) = &agent.kind {
                output.push_str(&format!(" type=\"{}\"", escape_xml(kind)));
            }
            if let Some(name) = &agent.name {
                output.push_str(&format!(">{}</ttm:agent>\n", escape_xml(name)));
            } else {
                output.push_str("/>\n");
            }
        }
        output.push_str("    </metadata>\n");
    }
    if !translations.is_empty() {
        output.push_str("    <metadata>\n      <iTunesMetadata xmlns=\"http://music.apple.com/lyric-ttml-internal\">\n        <translations>\n");
        for track in translations {
            output.push_str("          <translation");
            if let Some(language) = &track.language {
                output.push_str(&format!(" xml:lang=\"{}\"", escape_xml(language)));
            }
            output.push_str(">\n");
            for line in &track.lines {
                let key = line.link_key.clone().or_else(|| {
                    original
                        .iter()
                        .position(|candidate| candidate.start_ms == line.start_ms)
                        .and_then(|index| keys[index].clone())
                });
                if let Some(key) = key {
                    output.push_str(&format!(
                        "            <text for=\"{}\">{}</text>\n",
                        escape_xml(&key),
                        escape_xml(&line.visible_text())
                    ));
                }
            }
            output.push_str("          </translation>\n");
        }
        output.push_str("        </translations>\n      </iTunesMetadata>\n    </metadata>\n");
    }
    output.push_str("  </head>\n");
}

fn write_word_content(words: &[LyricsWord], fallback_end: i64) -> String {
    words
        .iter()
        .map(|word| {
            if let Some(start) = word.start_ms {
                format!(
                    "<span begin=\"{}\" end=\"{}\">{}</span>",
                    ttml_time(start),
                    ttml_time(word.end_ms.unwrap_or(fallback_end)),
                    escape_xml(&word.text)
                )
            } else {
                escape_xml(&word.text)
            }
        })
        .collect()
}

fn is_linked(candidate: &LyricsLine, original: &LyricsLine) -> bool {
    (original.link_key.is_some() && candidate.link_key == original.link_key)
        || (original.start_ms.is_some() && candidate.start_ms == original.start_ms)
}

pub(crate) fn parse_time(value: &str) -> Option<i64> {
    let text = value.trim();
    if let Some(value) = text.strip_suffix("ms") {
        return value.parse::<f64>().ok().map(|value| value.round() as i64);
    }
    if let Some(value) = text.strip_suffix('s') {
        return value
            .parse::<f64>()
            .ok()
            .map(|value| (value * 1_000.0).round() as i64);
    }
    if !text.contains(':') {
        return text
            .parse::<f64>()
            .ok()
            .map(|value| (value * 1_000.0).round() as i64);
    }
    let parts: Vec<_> = text.split(':').collect();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [minutes, seconds] => (0, minutes.parse::<i64>().ok()?, *seconds),
        [hours, minutes, seconds] => (
            hours.parse::<i64>().ok()?,
            minutes.parse::<i64>().ok()?,
            *seconds,
        ),
        _ => return None,
    };
    let seconds = seconds.parse::<f64>().ok()?;
    Some(hours * 3_600_000 + minutes * 60_000 + (seconds * 1_000.0).round() as i64)
}

fn ttml_time(milliseconds: i64) -> String {
    let safe = milliseconds.max(0);
    format!(
        "{:02}:{:02}:{:02}.{:03}",
        safe / 3_600_000,
        (safe % 3_600_000) / 60_000,
        (safe % 60_000) / 1_000,
        safe % 1_000
    )
}

fn is_element(node: Node<'_, '_>, name: &str) -> bool {
    node.is_element() && node.tag_name().name().eq_ignore_ascii_case(name)
}

fn attr<'a>(node: &'a Node<'a, '_>, name: &str) -> Option<&'a str> {
    node.attributes()
        .find(|attribute| attribute.name() == name)
        .map(|attribute| attribute.value())
}

fn visible_text(node: Node<'_, '_>) -> String {
    node.descendants()
        .filter(|child| child.is_text())
        .filter_map(|child| child.text())
        .collect()
}

fn normalize_text(value: &str, trim_edges: bool) -> String {
    let normalized = if value.contains(['\r', '\n']) {
        Regex::new(r"\s+")
            .expect("valid whitespace regex")
            .replace_all(value, " ")
            .into_owned()
    } else {
        value.to_string()
    };
    if trim_edges {
        normalized.trim().to_string()
    } else {
        normalized
    }
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
