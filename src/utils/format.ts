import type { AudioTrack } from "../app/types";

export function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function formatTechnical(track: AudioTrack) {
  const sampleRate = track.sampleRate ? `${(track.sampleRate / 1000).toFixed(1)} kHz` : undefined;
  const bitrate = track.bitrate ? `${track.bitrate} kbps` : undefined;
  const channels = track.channels ? `${track.channels} ch` : undefined;
  return [track.format, bitrate, sampleRate, channels].filter(Boolean).join(" · ");
}

export function shortPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length <= 2) {
    return path;
  }
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export function formatDateTime(value?: string, locale?: string) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString(locale);
}
