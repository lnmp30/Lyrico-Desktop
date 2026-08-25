import { invoke } from "@tauri-apps/api/core";
import type { ArtistSplitConfig, AudioTrack, BatchTask, BatchTaskItem, CharacterMappingRule, DesktopSettings, LibraryFolder, PluginInstallPreview, PluginInstallResult, PluginSourceKind, RenamePreview, ReplayGainAnalysis, SourcePlugin, StorageInfo, TagForm } from "../app/types";

export async function scanFolder(folderPath: string) {
  return invoke<AudioTrack[]>("scan_folder", { folderPath });
}

export async function readAudioFile(path: string) {
  return invoke<AudioTrack>("read_audio_file", { path });
}

export async function readImageFile(path: string) {
  return invoke<string>("read_image_file", { path });
}

export async function readTextFile(path: string) {
  return invoke<string>("read_text_file", { path });
}

export async function writeTextFile(path: string, contents: string) {
  return invoke<void>("write_text_file", { path, contents });
}

export async function writeImageFile(path: string, dataUrl: string) {
  return invoke<void>("write_image_file", { path, dataUrl });
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

export async function loadDesktopSettings() {
  return invoke<DesktopSettings>("load_desktop_settings");
}

export async function saveDesktopSettings(settings: DesktopSettings) {
  return invoke<void>("save_desktop_settings", { settings });
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

export async function analyzeReplayGain(path: string, jobId: string) {
  return invoke<ReplayGainAnalysis>("analyze_replay_gain", { path, jobId });
}

export async function cancelReplayGain(jobId: string) {
  return invoke<boolean>("cancel_replay_gain", { jobId });
}

export async function createBatchTask(taskType: string, songPaths: string[], configJson?: string) {
  return invoke<BatchTask>("create_batch_task", { taskType, songPaths, configJson });
}

export async function loadBatchTasks() {
  return invoke<BatchTask[]>("load_batch_tasks");
}

export async function loadBatchTaskItems(taskId: string) {
  return invoke<BatchTaskItem[]>("load_batch_task_items", { taskId });
}

export async function previewBatchRename(paths: string[], renameFormat: string, characterMappingRules: CharacterMappingRule[]) {
  return invoke<RenamePreview[]>("preview_batch_rename", { paths, renameFormat, characterMappingRules });
}

export async function startBatchTask(taskId: string) {
  return invoke<BatchTask>("start_batch_task", { taskId });
}

export async function cancelBatchTask(taskId: string) {
  return invoke<BatchTask>("cancel_batch_task", { taskId });
}

export async function cancelBatchTaskItem(taskId: string, itemId: string) {
  return invoke<BatchTask>("cancel_batch_task_item", { taskId, itemId });
}

export async function retryFailedBatchItems(taskId: string, itemIds?: string[]) {
  return invoke<BatchTask>("retry_failed_batch_items", { taskId, itemIds });
}

export async function loadSourcePlugins() {
  return invoke<SourcePlugin[]>("load_source_plugins");
}

export async function previewSourcePluginArchive(archivePath: string) {
  return invoke<PluginInstallPreview>("preview_source_plugin_archive", { archivePath });
}

export async function installSourcePluginArchive(archivePath: string, selectedRoots: string[], allowDowngrade = false) {
  return invoke<PluginInstallResult>("install_source_plugin_archive", { archivePath, selectedRoots, allowDowngrade });
}

export async function setPluginSourceEnabled(pluginId: string, sourceKind: PluginSourceKind, enabled: boolean) {
  return invoke<SourcePlugin[]>("set_plugin_source_enabled", { pluginId, sourceKind, enabled });
}

export async function reorderPluginSources(sourceKind: PluginSourceKind, pluginIds: string[]) {
  return invoke<SourcePlugin[]>("reorder_plugin_sources", { sourceKind, pluginIds });
}

export async function saveSourcePluginSettings(pluginId: string, config: Record<string, string>) {
  return invoke<SourcePlugin[]>("save_source_plugin_settings", { pluginId, config });
}

export async function uninstallSourcePlugin(pluginId: string) {
  return invoke<SourcePlugin[]>("uninstall_source_plugin", { pluginId });
}

export async function invokeSourcePlugin<T>(pluginId: string, functionName: "searchSongs" | "getLyrics" | "searchCovers", request: unknown) {
  return invoke<T>("invoke_source_plugin", { pluginId, functionName, request });
}

export async function fetchRemoteImage(url: string, maxSize?: number) {
  return invoke<string>("fetch_remote_image", { url, maxSize });
}
