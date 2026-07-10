use crate::models::{AudioTrack, TagUpdate};
use base64::{engine::general_purpose, Engine as _};
use image::codecs::jpeg::JpegEncoder;
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::Picture;
use lofty::tag::{Accessor, ItemKey, Tag, TagExt};
use std::path::Path;

pub(crate) const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "m4a", "mp4", "aac", "ogg", "opus", "wav", "aiff", "aif",
];

#[derive(Clone, Copy)]
pub(crate) enum ArtworkMode {
    None,
    Full,
}

pub(crate) fn read_track(
    path: &Path,
    artist_separator: &str,
    artwork_mode: ArtworkMode,
) -> Result<AudioTrack, lofty::error::LoftyError> {
    let tagged_file = lofty::read_from_path(path)?;
    let properties = tagged_file.properties();
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let fallback_title = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let title = tag
        .and_then(|tag| tag.title().map(|value| value.into_owned()))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback_title);
    let artist = tag
        .and_then(|tag| joined_tag_values(tag, ItemKey::TrackArtist, artist_separator))
        .unwrap_or_default();
    let album = tag
        .and_then(|tag| tag.album().map(|value| value.into_owned()))
        .unwrap_or_default();
    let genre = tag
        .and_then(|tag| tag.genre().map(|value| value.into_owned()))
        .unwrap_or_default();
    let comment = tag
        .and_then(|tag| tag.comment().map(|value| value.into_owned()))
        .unwrap_or_default();
    let album_artist = tag
        .and_then(|tag| joined_tag_values(tag, ItemKey::AlbumArtist, artist_separator))
        .unwrap_or_default();
    let lyrics = tag
        .and_then(|tag| {
            tag.get_string(ItemKey::Lyrics)
                .or_else(|| tag.get_string(ItemKey::UnsyncLyrics))
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default();
    let year = tag
        .and_then(|tag| {
            tag.get_string(ItemKey::RecordingDate)
                .or_else(|| tag.get_string(ItemKey::Year))
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default();
    let replay_gain_track_gain = tag
        .and_then(|tag| tag.get_string(ItemKey::ReplayGainTrackGain).map(ToOwned::to_owned))
        .unwrap_or_default();
    let replay_gain_track_peak = tag
        .and_then(|tag| tag.get_string(ItemKey::ReplayGainTrackPeak).map(ToOwned::to_owned))
        .unwrap_or_default();
    let replay_gain_album_gain = tag
        .and_then(|tag| tag.get_string(ItemKey::ReplayGainAlbumGain).map(ToOwned::to_owned))
        .unwrap_or_default();
    let replay_gain_album_peak = tag
        .and_then(|tag| tag.get_string(ItemKey::ReplayGainAlbumPeak).map(ToOwned::to_owned))
        .unwrap_or_default();
    let has_cover = tag.is_some_and(|tag| !tag.pictures().is_empty());
    let cover_data_url = match artwork_mode {
        ArtworkMode::None => None,
        ArtworkMode::Full => tag.and_then(cover_data_url),
    };

    Ok(AudioTrack {
        id: path.to_string_lossy().to_string(),
        path: path.to_string_lossy().to_string(),
        file_name,
        title,
        artist,
        album,
        album_artist,
        genre,
        comment,
        lyrics: lyrics.clone(),
        track_number: tag.and_then(Accessor::track),
        disc_number: tag.and_then(Accessor::disk),
        year,
        duration_seconds: properties.duration().as_secs(),
        format: path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or_default()
            .to_uppercase(),
        bitrate: properties.audio_bitrate(),
        sample_rate: properties.sample_rate(),
        channels: properties.channels(),
        has_lyrics: !lyrics.trim().is_empty(),
        has_cover,
        replay_gain_track_gain,
        replay_gain_track_peak,
        replay_gain_album_gain,
        replay_gain_album_peak,
        cover_data_url,
    })
}

pub(crate) fn save_tags(
    update: TagUpdate,
    artist_separator: &str,
) -> Result<AudioTrack, String> {
    let path = std::path::PathBuf::from(&update.path);
    let mut tagged_file = lofty::read_from_path(&path).map_err(|error| error.to_string())?;
    let tag_type = tagged_file.primary_tag_type();
    if tagged_file.primary_tag().is_none() {
        tagged_file.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged_file
        .primary_tag_mut()
        .ok_or_else(|| "This audio format does not support writable primary tags".to_string())?;
    set_string(tag, update.title, |tag, value| tag.set_title(value), |tag| tag.remove_title());
    set_string(tag, update.artist, |tag, value| tag.set_artist(value), |tag| tag.remove_artist());
    set_string(tag, update.album, |tag, value| tag.set_album(value), |tag| tag.remove_album());
    set_string(tag, update.genre, |tag, value| tag.set_genre(value), |tag| tag.remove_genre());
    set_string(
        tag,
        update.comment,
        |tag, value| tag.set_comment(value),
        |tag| tag.remove_comment(),
    );
    set_text_item(tag, ItemKey::AlbumArtist, update.album_artist);
    set_text_item(tag, ItemKey::Lyrics, update.lyrics);
    set_text_item(tag, ItemKey::RecordingDate, update.year.clone());
    set_text_item(tag, ItemKey::Year, update.year);
    set_u32(tag, update.track_number, |tag, value| tag.set_track(value), |tag| tag.remove_track());
    set_u32(tag, update.disc_number, |tag, value| tag.set_disk(value), |tag| tag.remove_disk());
    tag.save_to_path(&path, WriteOptions::new())
        .map_err(|error| error.to_string())?;
    read_track(&path, artist_separator, ArtworkMode::Full).map_err(|error| error.to_string())
}

pub(crate) fn read_cover_thumbnail(path: &Path) -> Option<String> {
    let tagged_file = lofty::read_from_path(path).ok()?;
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag())?;
    thumbnail_data_url_from_bytes(tag.pictures().first()?.data())
}

pub(crate) fn is_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            AUDIO_EXTENSIONS
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(extension))
        })
}

fn set_string(
    tag: &mut Tag,
    value: String,
    set: impl FnOnce(&mut Tag, String),
    remove: impl FnOnce(&mut Tag),
) {
    let value = value.trim().to_string();
    if value.is_empty() {
        remove(tag);
    } else {
        set(tag, value);
    }
}

fn set_text_item(tag: &mut Tag, key: ItemKey, value: String) {
    let value = value.trim().to_string();
    if value.is_empty() {
        tag.remove_key(key);
    } else {
        tag.insert_text(key, value);
    }
}

fn set_u32(
    tag: &mut Tag,
    value: Option<u32>,
    set: impl FnOnce(&mut Tag, u32),
    remove: impl FnOnce(&mut Tag),
) {
    match value {
        Some(value) if value > 0 => set(tag, value),
        _ => remove(tag),
    }
}

fn joined_tag_values(tag: &Tag, key: ItemKey, separator: &str) -> Option<String> {
    let values = tag
        .get_strings(key)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    (!values.is_empty()).then(|| values.join(separator))
}

fn cover_data_url(tag: &Tag) -> Option<String> {
    let picture = tag.pictures().first()?;
    let mime = picture_mime(picture);
    let encoded = general_purpose::STANDARD.encode(picture.data());
    Some(format!("data:{mime};base64,{encoded}"))
}

fn thumbnail_data_url_from_bytes(bytes: &[u8]) -> Option<String> {
    let image = image::load_from_memory(bytes).ok()?;
    let thumbnail = image.thumbnail(128, 128).to_rgb8();
    let mut encoded_thumbnail = Vec::new();
    JpegEncoder::new_with_quality(&mut encoded_thumbnail, 82)
        .encode_image(&thumbnail)
        .ok()?;
    Some(format!(
        "data:image/jpeg;base64,{}",
        general_purpose::STANDARD.encode(encoded_thumbnail)
    ))
}

fn picture_mime(picture: &Picture) -> &'static str {
    let data = picture.data();
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if data.starts_with(b"\x89PNG\r\n\x1A\n") {
        "image/png"
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        "image/gif"
    } else if data.len() > 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "application/octet-stream"
    }
}
