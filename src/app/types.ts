export type ViewKey =
  | "songs"
  | "albums"
  | "artists"
  | "folders"
  | "sources"
  | "tasks"
  | "settings";

export type AudioTrack = {
  id: string;
  path: string;
  fileName: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  comment: string;
  lyrics: string;
  trackNumber?: number;
  discNumber?: number;
  year: string;
  durationSeconds: number;
  format: string;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  coverDataUrl?: string;
  hasLyrics: boolean;
  hasCover: boolean;
  replayGainTrackGain: string;
  replayGainTrackPeak: string;
  replayGainAlbumGain: string;
  replayGainAlbumPeak: string;
};

export type TagForm = {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNumber?: number;
  discNumber?: number;
  year: string;
  genre: string;
  comment: string;
  lyrics: string;
};

export type LibraryFolder = {
  path: string;
  trackCount: number;
  lastScannedAt?: string;
  status: "ready" | "scanning" | "error";
  error?: string;
};

export type ScanProgress = {
  jobId: string;
  folderPath: string;
  phase: "enumerating" | "reading" | "committing" | "completed" | "failed";
  current: number;
  total: number;
  errors: number;
  status: "running" | "completed" | "failed";
  message?: string;
};

export type StorageInfo = {
  dataPath: string;
  databasePath: string;
  configPath: string;
  location: "installation" | "appData";
};

export type PluginCapability = "tags" | "lyrics" | "covers" | "structuredLyrics";

export type SourcePlugin = {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  enabled: boolean;
  capabilities: PluginCapability[];
  permissions: string[];
  entryFile: string;
  config: Record<string, string | number | boolean>;
};

export type BatchCandidate = {
  track: AudioTrack;
  sources: string[];
  status: "notRun" | "ready" | "sourceMissing";
};

export type CustomArtistSeparator = {
  id: string;
  value: string;
  enabled: boolean;
};

export type CustomNoSplitArtist = {
  id: string;
  name: string;
  enabled: boolean;
};

export type ArtistSplitConfig = {
  enabled: boolean;
  artistSeparator: string;
  builtinSeparatorOverrides: Record<string, boolean>;
  hiddenBuiltinSeparatorIds: string[];
  customSeparators: CustomArtistSeparator[];
  builtinNoSplitArtistOverrides: Record<string, boolean>;
  customNoSplitArtists: CustomNoSplitArtist[];
};
