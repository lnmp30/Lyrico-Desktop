import { detectLyricFormat, extractPlainLyricsText, processLyricsText } from "./pluginLyrics";

export function shiftLyricsOffset(lyrics: string, offsetMs: number) {
  return processLyricsText(lyrics, { offsetMs }).text;
}

export function removeEmptyLyricsLines(lyrics: string) {
  return processLyricsText(lyrics, { removeEmptyLines: true }).text;
}

export function plainLyricsText(lyrics: string) {
  return extractPlainLyricsText(lyrics);
}

export function lyricsExportExtension(lyrics: string) {
  return detectLyricFormat(lyrics) === "ttml" ? "ttml" : "lrc";
}
