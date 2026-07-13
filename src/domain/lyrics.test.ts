import { describe, expect, it } from "vitest";
import { lyricsExportExtension, plainLyricsText, removeEmptyLyricsLines, shiftLyricsOffset } from "./lyrics";

describe("lyrics processing", () => {
  it("shifts LRC and enhanced LRC timestamps without going below zero", () => {
    expect(shiftLyricsOffset("[00:01.20]line\n<00:00.050>word", -100)).toBe("[00:01.100]line\n<00:00.000>word");
  });

  it("shifts TTML begin and end timestamps", () => {
    expect(shiftLyricsOffset('<p begin="00:00:01.000" end="00:00:02.500">line</p>', 500))
      .toContain('begin="00:00:01.500" end="00:00:03.000"');
  });

  it("cleans empty lines, extracts plain text, and chooses export extension", () => {
    expect(removeEmptyLyricsLines("a\n \nb")).toBe("a\nb");
    expect(plainLyricsText("[00:01.000]hello\n[00:02.000]world")).toBe("hello\nworld");
    expect(lyricsExportExtension("<tt><body /></tt>")).toBe("ttml");
  });
});
