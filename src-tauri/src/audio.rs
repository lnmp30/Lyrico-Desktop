use crate::models::{AudioTrack, TagUpdate};
use base64::{engine::general_purpose, Engine as _};
use image::codecs::jpeg::JpegEncoder;
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::tag::items::popularimeter::{Popularimeter, StarRating};
use lofty::tag::{Accessor, ItemKey, ItemValue, Tag, TagExt, TagItem};
use std::collections::HashSet;
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
) -> Result<AudioTrack, lofty::error::FileParseError> {
    let tagged_file = lofty::read_from_path(path)?;
    let properties = tagged_file.properties();
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());
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
        .and_then(|tag| joined_tag_values(tag, ItemKey::Genre, "; "))
        .unwrap_or_default();
    let language = read_text(tag, ItemKey::Language);
    let composer = read_text(tag, ItemKey::Composer);
    let lyricist = read_text(tag, ItemKey::Lyricist);
    let copyright = read_text(tag, ItemKey::CopyrightMessage);
    let rating = tag
        .and_then(|tag| tag.ratings().next())
        .map(|popularimeter| popularimeter.rating() as u8);
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
        .and_then(|tag| {
            tag.get_string(ItemKey::ReplayGainTrackGain)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default();
    let replay_gain_track_peak = tag
        .and_then(|tag| {
            tag.get_string(ItemKey::ReplayGainTrackPeak)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default();
    let replay_gain_album_gain = tag
        .and_then(|tag| {
            tag.get_string(ItemKey::ReplayGainAlbumGain)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default();
    let replay_gain_album_peak = tag
        .and_then(|tag| {
            tag.get_string(ItemKey::ReplayGainAlbumPeak)
                .map(ToOwned::to_owned)
        })
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
        language,
        composer,
        lyricist,
        copyright,
        rating,
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
        replay_gain_reference_loudness: String::new(),
        cover_data_url,
    })
}

pub(crate) fn save_tags(update: TagUpdate, artist_separator: &str) -> Result<AudioTrack, String> {
    let path = std::path::PathBuf::from(&update.path);
    let mut tagged_file = lofty::read_from_path(&path).map_err(|error| error.to_string())?;
    let tag_type = tagged_file.primary_tag_type();
    if tagged_file.primary_tag().is_none() {
        tagged_file.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged_file
        .primary_tag_mut()
        .ok_or_else(|| "This audio format does not support writable primary tags".to_string())?;
    if update.remove_cover {
        tag.remove_picture_type(PictureType::CoverFront);
    } else if let Some(cover_data_url) = update.cover_data_url.as_deref() {
        let picture = picture_from_data_url(cover_data_url)?;
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(picture);
    }
    set_string(
        tag,
        update.title,
        |tag, value| tag.set_title(value),
        |tag| tag.remove_title(),
    );
    set_string(
        tag,
        update.artist,
        |tag, value| tag.set_artist(value),
        |tag| tag.remove_artist(),
    );
    set_string(
        tag,
        update.album,
        |tag, value| tag.set_album(value),
        |tag| tag.remove_album(),
    );
    set_text_items(tag, ItemKey::Genre, update.genre);
    set_text_item(tag, ItemKey::Language, update.language);
    set_text_item(tag, ItemKey::Composer, update.composer);
    set_text_item(tag, ItemKey::Lyricist, update.lyricist);
    set_text_item(tag, ItemKey::CopyrightMessage, update.copyright);
    set_rating(tag, update.rating);
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
    set_text_item(
        tag,
        ItemKey::ReplayGainTrackGain,
        update.replay_gain_track_gain,
    );
    set_text_item(
        tag,
        ItemKey::ReplayGainTrackPeak,
        update.replay_gain_track_peak,
    );
    set_text_item(
        tag,
        ItemKey::ReplayGainAlbumGain,
        update.replay_gain_album_gain,
    );
    set_text_item(
        tag,
        ItemKey::ReplayGainAlbumPeak,
        update.replay_gain_album_peak,
    );
    let _reference_loudness = update.replay_gain_reference_loudness;
    set_u32(
        tag,
        update.track_number,
        |tag, value| tag.set_track(value),
        |tag| tag.remove_track(),
    );
    set_u32(
        tag,
        update.disc_number,
        |tag, value| tag.set_disk(value),
        |tag| tag.remove_disk(),
    );
    tag.save_to_path(&path, WriteOptions::new())
        .map_err(|error| error.to_string())?;
    read_track(&path, artist_separator, ArtworkMode::Full).map_err(|error| error.to_string())
}

pub(crate) fn write_replay_gain_tags(
    path: &Path,
    artist_separator: &str,
    track_gain: String,
    track_peak: String,
) -> Result<AudioTrack, String> {
    let mut tagged_file = lofty::read_from_path(path).map_err(|error| error.to_string())?;
    let tag_type = tagged_file.primary_tag_type();
    if tagged_file.primary_tag().is_none() {
        tagged_file.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged_file
        .primary_tag_mut()
        .ok_or_else(|| "This audio format does not support writable primary tags".to_string())?;
    set_text_item(tag, ItemKey::ReplayGainTrackGain, track_gain);
    set_text_item(tag, ItemKey::ReplayGainTrackPeak, track_peak);
    tag.save_to_path(path, WriteOptions::new())
        .map_err(|error| error.to_string())?;
    read_track(path, artist_separator, ArtworkMode::None).map_err(|error| error.to_string())
}

pub(crate) fn write_lyrics_tag(
    path: &Path,
    artist_separator: &str,
    lyrics: String,
) -> Result<AudioTrack, String> {
    let mut tagged_file = lofty::read_from_path(path).map_err(|error| error.to_string())?;
    let tag_type = tagged_file.primary_tag_type();
    if tagged_file.primary_tag().is_none() {
        tagged_file.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged_file
        .primary_tag_mut()
        .ok_or_else(|| "This audio format does not support writable primary tags".to_string())?;
    set_text_item(tag, ItemKey::Lyrics, lyrics);
    tag.save_to_path(path, WriteOptions::new())
        .map_err(|error| error.to_string())?;
    read_track(path, artist_separator, ArtworkMode::None).map_err(|error| error.to_string())
}

pub(crate) fn read_cover_thumbnail(path: &Path) -> Option<String> {
    let tagged_file = lofty::read_from_path(path).ok()?;
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())?;
    cover_preview_data_url_from_bytes(tag.pictures().first()?.data(), 128, 82)
}

pub(crate) fn read_cover_artwork(path: &Path) -> Option<String> {
    let tagged_file = lofty::read_from_path(path).ok()?;
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())?;
    cover_preview_data_url_from_bytes(tag.pictures().first()?.data(), 384, 88)
}

pub(crate) fn read_embedded_cover(path: &Path) -> Result<Option<Vec<u8>>, String> {
    let tagged_file = lofty::read_from_path(path).map_err(|error| error.to_string())?;
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());
    let picture = tag.and_then(|tag| {
        tag.pictures()
            .iter()
            .find(|picture| picture.pic_type() == PictureType::CoverFront)
            .or_else(|| tag.pictures().first())
    });
    Ok(picture.map(|picture| picture.data().to_vec()))
}

pub(crate) fn read_image_data_url(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("Cover image must be smaller than 25 MB".to_string());
    }
    image::load_from_memory(&bytes)
        .map_err(|_| "Selected file is not a valid image".to_string())?;
    let picture = Picture::unchecked(bytes).build();
    Ok(format!(
        "data:{};base64,{}",
        picture_mime(&picture),
        general_purpose::STANDARD.encode(picture.data())
    ))
}

pub(crate) fn write_image_data_url(path: &Path, data_url: &str) -> Result<(), String> {
    let picture = picture_from_data_url(data_url)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(path, picture.data()).map_err(|error| error.to_string())
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

fn set_text_items(tag: &mut Tag, key: ItemKey, values: Vec<String>) {
    tag.remove_key(key);
    let mut seen = HashSet::new();
    for value in values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        if !seen.insert(value.to_lowercase()) {
            continue;
        }
        tag.push(TagItem::new(key, ItemValue::Text(value)));
    }
}

fn set_rating(tag: &mut Tag, rating: Option<u8>) {
    tag.remove_key(ItemKey::Popularimeter);
    let rating = match rating {
        Some(1) => StarRating::One,
        Some(2) => StarRating::Two,
        Some(3) => StarRating::Three,
        Some(4) => StarRating::Four,
        Some(5) => StarRating::Five,
        _ => return,
    };
    tag.insert_text(
        ItemKey::Popularimeter,
        Popularimeter::musicbee(rating, 0).to_string(),
    );
}

fn read_text(tag: Option<&Tag>, key: ItemKey) -> String {
    tag.and_then(|tag| tag.get_string(key).map(ToOwned::to_owned))
        .unwrap_or_default()
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

fn cover_preview_data_url_from_bytes(bytes: &[u8], max_size: u32, quality: u8) -> Option<String> {
    let image = image::load_from_memory(bytes).ok()?;
    let thumbnail = image.thumbnail(max_size, max_size).to_rgb8();
    let mut encoded_thumbnail = Vec::new();
    JpegEncoder::new_with_quality(&mut encoded_thumbnail, quality)
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

fn picture_from_data_url(data_url: &str) -> Result<Picture, String> {
    let (header, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "Invalid cover data URL".to_string())?;
    if !header.starts_with("data:image/") || !header.ends_with(";base64") {
        return Err("Cover must be a base64 image data URL".to_string());
    }
    let mime = header
        .trim_start_matches("data:")
        .trim_end_matches(";base64");
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| error.to_string())?;
    image::load_from_memory(&bytes)
        .map_err(|_| "Selected cover is not a valid image".to_string())?;
    Ok(Picture::unchecked(bytes)
        .pic_type(PictureType::CoverFront)
        .mime_type(MimeType::from_str(mime))
        .build())
}

#[cfg(test)]
mod tests {
    use super::*;
    use lofty::tag::TagType;

    #[test]
    fn multi_value_genres_are_trimmed_and_deduplicated() {
        let mut tag = Tag::new(TagType::VorbisComments);
        set_text_items(
            &mut tag,
            ItemKey::Genre,
            vec![" Rock ".into(), "Pop".into(), "rock".into(), "".into()],
        );

        assert_eq!(
            tag.get_strings(ItemKey::Genre).collect::<Vec<_>>(),
            vec!["Rock", "Pop"]
        );
    }

    #[test]
    fn rating_uses_a_portable_popularimeter_value() {
        let mut tag = Tag::new(TagType::Id3v2);
        set_rating(&mut tag, Some(4));

        assert_eq!(
            tag.ratings().next().map(|rating| rating.rating() as u8),
            Some(4)
        );
        set_rating(&mut tag, None);
        assert!(tag.ratings().next().is_none());
    }

    #[test]
    fn cover_data_url_is_validated_and_mapped_to_front_cover() {
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgba8(1, 1)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .unwrap();
        let data_url = format!(
            "data:image/png;base64,{}",
            general_purpose::STANDARD.encode(bytes)
        );
        let picture = picture_from_data_url(&data_url).expect("valid PNG cover");
        assert_eq!(picture.pic_type(), PictureType::CoverFront);
        assert_eq!(picture.mime_type(), Some(&MimeType::Png));
        assert!(picture_from_data_url("data:text/plain;base64,SGVsbG8=").is_err());
    }

    #[test]
    fn replay_gain_writer_changes_only_supported_replay_gain_fields() {
        let Ok(source) = std::env::var("LYRICO_REPLAY_GAIN_FIXTURE") else {
            return;
        };
        let source = std::path::PathBuf::from(source);
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("flac");
        let target = std::env::temp_dir().join(format!(
            "lyrico-replay-gain-write-{}.{extension}",
            std::process::id()
        ));
        std::fs::copy(&source, &target).expect("fixture should copy");
        let before = read_track(&target, "/", ArtworkMode::None).expect("fixture should read");
        let after =
            write_replay_gain_tags(&target, "/", "-8.50 dB".to_string(), "0.987654".to_string())
                .expect("ReplayGain tags should write");
        assert_eq!(after.replay_gain_track_gain, "-8.50 dB");
        assert_eq!(after.replay_gain_track_peak, "0.987654");
        assert_eq!(after.title, before.title);
        assert_eq!(after.artist, before.artist);
        assert_eq!(after.album, before.album);
        let _ = std::fs::remove_file(target);
    }

    #[test]
    fn lyrics_writer_changes_only_the_lyrics_field() {
        let Ok(source) = std::env::var("LYRICO_REPLAY_GAIN_FIXTURE") else {
            return;
        };
        let source = std::path::PathBuf::from(source);
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("flac");
        let target = std::env::temp_dir().join(format!(
            "lyrico-lyrics-write-{}.{extension}",
            std::process::id()
        ));
        std::fs::copy(&source, &target).expect("fixture should copy");
        let before = read_track(&target, "/", ArtworkMode::None).expect("fixture should read");
        let lyrics = "[00:01.000]歌词格式化测试".to_string();
        let after = write_lyrics_tag(&target, "/", lyrics.clone())
            .expect("lyrics should write and read back");
        assert_eq!(after.lyrics, lyrics);
        assert_eq!(after.title, before.title);
        assert_eq!(after.artist, before.artist);
        assert_eq!(after.album, before.album);
        assert_eq!(after.replay_gain_track_gain, before.replay_gain_track_gain);
        assert_eq!(after.replay_gain_track_peak, before.replay_gain_track_peak);
        let _ = std::fs::remove_file(target);
    }
}
