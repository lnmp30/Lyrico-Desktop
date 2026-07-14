import { describe, expect, it } from "vitest";
import { LYRIC_FORMATS, preferredPluginLyricFormat } from "./lyricsApi";

describe("lyrics API boundary", () => {
  it("keeps plugin format selection lightweight and mobile-compatible", () => {
    expect(preferredPluginLyricFormat({ original: [[1000, 2000, "line"]] })).toBe("verbatimLrc");
    expect(preferredPluginLyricFormat({ rawTtml: "<tt />" })).toBe("ttml");
    expect(preferredPluginLyricFormat({ rawEnhancedLrc: "", rawPlainLrc: "[00:01]line" })).toBe("plainLrc");
    expect(preferredPluginLyricFormat(null)).toBeUndefined();
    expect(LYRIC_FORMATS).toEqual(["plainLrc", "verbatimLrc", "enhancedLrc", "ttml"]);
  });
});
