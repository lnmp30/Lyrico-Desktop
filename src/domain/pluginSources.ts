import type { PluginCapability, PluginSongResult, PluginSourceKind, SourcePlugin } from "../app/types";

export const PLUGIN_SOURCE_KINDS: PluginSourceKind[] = ["aggregated", "metadata", "lyrics", "covers"];

export function normalizedCapabilities(plugin: Pick<SourcePlugin, "capabilities">): PluginCapability[] {
  return plugin.capabilities.length ? plugin.capabilities : ["searchSongs"];
}

export function supportedSourceKinds(plugin: Pick<SourcePlugin, "apiVersion" | "capabilities">): PluginSourceKind[] {
  const capabilities = new Set(normalizedCapabilities(plugin));
  return PLUGIN_SOURCE_KINDS.filter((kind) => {
    if (kind === "aggregated") return ["searchSongs", "getLyrics", "searchCovers"].every((capability) => capabilities.has(capability as PluginCapability));
    if (kind === "metadata") return capabilities.has("searchSongs");
    if (kind === "lyrics") return capabilities.has("getLyrics");
    return capabilities.has("searchCovers");
  });
}

export function isPluginSourceEnabled(
  plugin: Pick<SourcePlugin, "apiVersion" | "capabilities" | "sourceStates">,
  kind: PluginSourceKind,
) {
  if (!supportedSourceKinds(plugin).includes(kind)) return false;
  return plugin.sourceStates[kind]?.enabled ?? false;
}

export function pluginSourceOrder(plugin: Pick<SourcePlugin, "sourceStates">, kind: PluginSourceKind) {
  return plugin.sourceStates[kind]?.priority ?? Number.MAX_SAFE_INTEGER;
}

export function normalizePluginResults(response: unknown): PluginSongResult[] {
  if (Array.isArray(response)) return response.filter(isObjectResult) as PluginSongResult[];
  if (!response || typeof response !== "object") return [];
  const value = response as Record<string, unknown>;
  for (const key of ["items", "results", "songs", "data"]) {
    if (Array.isArray(value[key])) return value[key].filter(isObjectResult) as PluginSongResult[];
  }
  return [];
}

export function normalizeCoverResults(response: unknown, apiVersion: number): PluginSongResult[] {
  const results = normalizePluginResults(response);
  if (apiVersion < 4) return results;
  return results.filter((result) => {
    const cover = result.fields?.cover_url ?? result.picUrl ?? result.coverUrl ?? result.cover_url ?? result.artworkUrl;
    return [result.title, result.artist, result.album, result.date, cover]
      .every((value) => typeof value === "string" && value.trim().length > 0);
  });
}

export type NormalizedLyricsCandidate = { result: PluginSongResult; lyricsPayload: unknown };

export function firstLyricsPayload(response: unknown): unknown | undefined {
  let candidate = response;
  if (Array.isArray(response)) {
    candidate = response[0];
  } else if (response && typeof response === "object") {
    const candidates = firstArray(response as Record<string, unknown>, ["items", "results", "candidates"]);
    if (candidates) candidate = candidates[0];
  }
  if (candidate == null) return undefined;
  if (typeof candidate === "object" && "lyrics" in candidate) {
    return (candidate as { lyrics?: unknown }).lyrics;
  }
  return candidate;
}

export function normalizeLyricsCandidates(response: unknown, apiVersion: number): NormalizedLyricsCandidate[] {
  const values = Array.isArray(response)
    ? response
    : response && typeof response === "object"
      ? firstArray(response as Record<string, unknown>, ["items", "results", "candidates"]) ?? [response]
      : response == null ? [] : [response];
  return values.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const value = candidate as Record<string, unknown>;
    const tags = value.tags && typeof value.tags === "object" ? value.tags as Record<string, unknown> : {};
    const title = text(tags.ti);
    const artist = text(tags.ar);
    const album = text(tags.al);
    const date = text(tags.date);
    if (apiVersion >= 4 && [title, artist, album, date].some((field) => !field)) return [];
    return [{
      lyricsPayload: "lyrics" in value ? value.lyrics : candidate,
      result: { id: `lyrics:${index}:${title}`, title, artist, album, date },
    }];
  });
}

function firstArray(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (Array.isArray(value[key])) return value[key] as unknown[];
  return undefined;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isObjectResult(value: unknown) {
  return Boolean(value && typeof value === "object");
}
