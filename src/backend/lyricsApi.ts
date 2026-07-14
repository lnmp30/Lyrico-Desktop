import { invoke } from "@tauri-apps/api/core";

export type LyricFormat = "plainLrc" | "verbatimLrc" | "enhancedLrc" | "ttml";
export type LyricLineTrack = "original" | "translation" | "romanization";
export type LyricsConversionMode = "none" | "traditionalToSimplified" | "simplifiedToTraditional";

export type LyricsOptions = {
  showTranslation?: boolean;
  showRomanization?: boolean;
  onlyTranslationIfAvailable?: boolean;
  lineOrder?: LyricLineTrack[];
  normalizeWhitespace?: boolean;
  removeEmptyLines?: boolean;
  removeTagLineKeywords?: string[];
  offsetMs?: number;
  conversionMode?: LyricsConversionMode;
  forceRewrite?: boolean;
  sourceFormat?: LyricFormat;
  targetFormat?: LyricFormat;
};

export type LyricsPipelineResult = {
  text: string;
  warnings: string[];
  sourceFormat?: LyricFormat;
  targetFormat: LyricFormat;
};

const RAW_KEYS: Record<LyricFormat, string> = {
  plainLrc: "rawPlainLrc",
  verbatimLrc: "rawVerbatimLrc",
  enhancedLrc: "rawEnhancedLrc",
  ttml: "rawTtml",
};

export const LYRIC_FORMATS: LyricFormat[] = ["plainLrc", "verbatimLrc", "enhancedLrc", "ttml"];

export function preferredPluginLyricFormat(result: unknown): LyricFormat | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const value = result as Record<string, unknown>;
  if (Array.isArray(value.original)) return "verbatimLrc";
  return LYRIC_FORMATS.find((format) => typeof value[RAW_KEYS[format]] === "string" && Boolean(value[RAW_KEYS[format]]));
}

export function processLyricsText(raw: string, options: LyricsOptions = {}) {
  return invoke<LyricsPipelineResult>("process_lyrics_text", { raw, options });
}

export function renderPluginLyrics(result: unknown, targetFormat: LyricFormat, options: LyricsOptions = {}) {
  return invoke<LyricsPipelineResult>("render_plugin_lyrics", { result, targetFormat, options });
}

export function extractPlainLyricsText(raw: string) {
  return invoke<string>("extract_plain_lyrics_text", { raw });
}

export function detectLyricsFormat(raw: string) {
  return invoke<LyricFormat>("detect_lyrics_format", { raw });
}
