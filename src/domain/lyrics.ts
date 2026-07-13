const LRC_TIMESTAMP = /([\[<])(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?([\]>])/g;
const TTML_TIMESTAMP = /((?:begin|end)=["'])(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(["'])/g;

export function shiftLyricsOffset(lyrics: string, offsetMs: number) {
  if (!lyrics.trim() || offsetMs === 0) return lyrics;
  const shiftedLrc = lyrics.replace(LRC_TIMESTAMP, (_, open, minutes, seconds, fraction = "0", close) => {
    const total = Number(minutes) * 60_000 + Number(seconds) * 1_000 + fractionToMilliseconds(fraction);
    const shifted = Math.max(0, total + offsetMs);
    const nextMinutes = Math.floor(shifted / 60_000);
    const nextSeconds = Math.floor((shifted % 60_000) / 1_000);
    const milliseconds = shifted % 1_000;
    return `${open}${String(nextMinutes).padStart(2, "0")}:${String(nextSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}${close}`;
  });
  return shiftedLrc.replace(TTML_TIMESTAMP, (_, prefix, hours, minutes, seconds, fraction = "0", suffix) => {
    const total = Number(hours) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1_000 + fractionToMilliseconds(fraction);
    const shifted = Math.max(0, total + offsetMs);
    const nextHours = Math.floor(shifted / 3_600_000);
    const nextMinutes = Math.floor((shifted % 3_600_000) / 60_000);
    const nextSeconds = Math.floor((shifted % 60_000) / 1_000);
    const milliseconds = shifted % 1_000;
    return `${prefix}${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(2, "0")}:${String(nextSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}${suffix}`;
  });
}

export function removeEmptyLyricsLines(lyrics: string) {
  return lyrics.split(/\r?\n/).filter((line) => line.trim()).join("\n");
}

export function plainLyricsText(lyrics: string) {
  return lyrics
    .replace(LRC_TIMESTAMP, "")
    .replace(/<[^>]+>/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function lyricsExportExtension(lyrics: string) {
  return /<tt[\s>]/i.test(lyrics) ? "ttml" : "lrc";
}

function fractionToMilliseconds(value: string) {
  return Number(value.padEnd(3, "0").slice(0, 3));
}
