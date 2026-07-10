use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioTrack {
    pub(crate) id: String,
    pub(crate) path: String,
    pub(crate) file_name: String,
    pub(crate) title: String,
    pub(crate) artist: String,
    pub(crate) album: String,
    pub(crate) album_artist: String,
    pub(crate) genre: String,
    pub(crate) comment: String,
    pub(crate) lyrics: String,
    pub(crate) track_number: Option<u32>,
    pub(crate) disc_number: Option<u32>,
    pub(crate) year: String,
    pub(crate) duration_seconds: u64,
    pub(crate) format: String,
    pub(crate) bitrate: Option<u32>,
    pub(crate) sample_rate: Option<u32>,
    pub(crate) channels: Option<u8>,
    pub(crate) cover_data_url: Option<String>,
    pub(crate) has_lyrics: bool,
    pub(crate) has_cover: bool,
    pub(crate) replay_gain_track_gain: String,
    pub(crate) replay_gain_track_peak: String,
    pub(crate) replay_gain_album_gain: String,
    pub(crate) replay_gain_album_peak: String,
}

impl AudioTrack {
    pub(crate) fn into_summary(mut self) -> Self {
        self.comment.clear();
        self.lyrics.clear();
        self.cover_data_url = None;
        self
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackCover {
    pub(crate) path: String,
    pub(crate) cover_data_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScanProgress {
    pub(crate) job_id: String,
    pub(crate) folder_path: String,
    pub(crate) phase: String,
    pub(crate) current: usize,
    pub(crate) total: usize,
    pub(crate) errors: usize,
    pub(crate) status: String,
    pub(crate) message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageInfo {
    pub(crate) data_path: String,
    pub(crate) database_path: String,
    pub(crate) config_path: String,
    pub(crate) location: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct ArtistSplitConfig {
    pub(crate) enabled: bool,
    #[serde(default = "default_artist_separator")]
    pub(crate) artist_separator: String,
    pub(crate) builtin_separator_overrides: HashMap<String, bool>,
    pub(crate) hidden_builtin_separator_ids: HashSet<String>,
    pub(crate) custom_separators: Vec<CustomArtistSeparator>,
    pub(crate) builtin_no_split_artist_overrides: HashMap<String, bool>,
    pub(crate) custom_no_split_artists: Vec<CustomNoSplitArtist>,
}

impl Default for ArtistSplitConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            artist_separator: default_artist_separator(),
            builtin_separator_overrides: HashMap::new(),
            hidden_builtin_separator_ids: HashSet::new(),
            custom_separators: Vec::new(),
            builtin_no_split_artist_overrides: HashMap::new(),
            custom_no_split_artists: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CustomArtistSeparator {
    pub(crate) id: String,
    pub(crate) value: String,
    #[serde(default = "default_true")]
    pub(crate) enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CustomNoSplitArtist {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default = "default_true")]
    pub(crate) enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryFolder {
    pub(crate) path: String,
    pub(crate) track_count: u32,
    pub(crate) last_scanned_at: Option<String>,
    pub(crate) status: String,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TagUpdate {
    pub(crate) path: String,
    pub(crate) title: String,
    pub(crate) artist: String,
    pub(crate) album: String,
    pub(crate) album_artist: String,
    pub(crate) genre: String,
    pub(crate) comment: String,
    pub(crate) lyrics: String,
    pub(crate) track_number: Option<u32>,
    pub(crate) disc_number: Option<u32>,
    pub(crate) year: String,
}

fn default_true() -> bool {
    true
}

fn default_artist_separator() -> String {
    "/".to_string()
}
