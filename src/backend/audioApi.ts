import { invoke } from "@tauri-apps/api/core";
import type { ArtistSplitConfig, AudioTrack, LibraryFolder, StorageInfo, TagForm } from "../app/types";

export async function scanFolder(folderPath: string) {
  return invoke<AudioTrack[]>("scan_folder", { folderPath });
}

export async function readAudioFile(path: string) {
  return invoke<AudioTrack>("read_audio_file", { path });
}

export async function saveAudioTags(path: string, values: TagForm) {
  return invoke<AudioTrack>("save_audio_tags", {
    update: {
      path,
      ...values,
    },
  });
}

export async function loadLibraryFolders() {
  return invoke<LibraryFolder[]>("load_library_folders");
}

export async function loadLibraryTracks() {
  return invoke<AudioTrack[]>("load_library_tracks");
}

export async function loadLibraryTrack(path: string) {
  return invoke<AudioTrack>("load_library_track", { path });
}

export type TrackCover = {
  path: string;
  coverDataUrl: string;
};

export async function loadTrackCovers(paths: string[]) {
  return invoke<TrackCover[]>("load_track_covers", { paths });
}

export async function loadArtistSplitConfig() {
  return invoke<ArtistSplitConfig>("load_artist_split_config");
}

export async function saveArtistSplitConfig(config: ArtistSplitConfig) {
  return invoke<void>("save_artist_split_config", { config });
}

export async function upsertLibraryFolder(folder: LibraryFolder) {
  return invoke<void>("upsert_library_folder", { folder });
}

export async function removeLibraryFolder(path: string) {
  return invoke<void>("remove_library_folder", { path });
}

export async function getStorageInfo() {
  return invoke<StorageInfo>("get_storage_info");
}
