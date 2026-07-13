import { describe, expect, it } from "vitest";
import { preferredPluginLyricFormat, processLyricsText, processPluginLyrics, renderPluginLyrics } from "./pluginLyrics";

const result = {
  type: "structured",
  tags: { ti: "晴天", ar: "周杰伦" },
  original: [[1000, 2000, [[1000, 1500, "故"], [1500, 2000, "事"]]]],
  translated: [[1000, 2000, "Story"]],
  romanization: [[1000, 2000, "gushi"]],
};

describe("plugin lyric rendering", () => {
  it("defaults structured plugin lyrics to the mobile verbatim format", () => {
    expect(preferredPluginLyricFormat(result)).toBe("verbatimLrc");
    expect(renderPluginLyrics(result, "verbatimLrc")).toContain("[00:01.000]故[00:01.500]事[00:02.000]");
  });

  it("renders enhanced LRC and TTML from the same structured result", () => {
    expect(renderPluginLyrics(result, "enhancedLrc")).toContain("[00:01.000]<00:01.000>故<00:01.500>事<00:02.000>");
    expect(renderPluginLyrics(result, "ttml")).toContain('<span begin="00:00:01.000" end="00:00:01.500">故</span>');
    expect(renderPluginLyrics(result, "ttml")).toContain('<text for="L1">Story</text>');
  });

  it("converts a raw enhanced LRC fallback instead of blanking unsupported targets", () => {
    const raw = { rawEnhancedLrc: "[00:01.000]<00:01.000>故<00:01.500>事<00:02.000>" };
    expect(renderPluginLyrics(raw, "plainLrc")).toContain("[00:01.000]故事");
    expect(renderPluginLyrics(raw, "ttml")).toContain('<p begin="00:00:01.000" end="00:00:02.000"');
  });

  it("honors translation and romanization preferences", () => {
    const originalOnly = renderPluginLyrics(result, "plainLrc", { showTranslation: false, showRomanization: false });
    expect(originalOnly).not.toContain("Story");
    expect(originalOnly).not.toContain("gushi");
    const translationOnly = renderPluginLyrics(result, "plainLrc", { showTranslation: true, showRomanization: false, onlyTranslationIfAvailable: true });
    expect(translationOnly).toContain("[00:01.000]Story");
    expect(translationOnly).not.toContain("故事");
  });

  it("does not drop the final timed word when no explicit line-end stamp exists", () => {
    expect(renderPluginLyrics(
      { rawEnhancedLrc: "[00:01.000]<00:01.000>故<00:01.500>事" },
      "plainLrc",
    )).toContain("[00:01.000]故事");
    expect(renderPluginLyrics(
      { rawVerbatimLrc: "[00:01.000]故[00:01.500]事" },
      "plainLrc",
    )).toContain("[00:01.000]故事");
  });

  it("preserves LRC metadata when converting formats", () => {
    const converted = renderPluginLyrics(
      { rawPlainLrc: "[ti:标题]\n[ar:艺术家]\n[al:专辑]\n[00:01.000]正文" },
      "ttml",
    );
    const roundTrip = renderPluginLyrics({ rawTtml: converted }, "plainLrc");
    expect(converted).toContain('<lyrico:tag name="ti">标题</lyrico:tag>');
    expect(renderPluginLyrics(
      { rawPlainLrc: "[ti:标题]\n[ar:艺术家]\n[00:01.000]正文" },
      "enhancedLrc",
    )).toContain("[ti:标题]\n[ar:艺术家]");
    expect(roundTrip).toContain("[ti:标题]\n[ar:艺术家]\n[al:专辑]");
    expect(roundTrip).toContain("[00:01.000]正文");
  });

  it("accepts TTML offset time expressions used by provider plugins", () => {
    const output = renderPluginLyrics(
      { rawTtml: '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1.5s" end="3s">正文</p></div></body></tt>' },
      "plainLrc",
    );
    expect(output).toContain("[00:01.500]正文");
  });

  it("keeps TTML translation, romanization, background vocals and agents linked", () => {
    const rawTtml = `<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xml:lang="zh-Hans">
  <head>
    <metadata><ttm:agent xml:id="v1" type="person">歌手</ttm:agent></metadata>
    <metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation xml:lang="en"><text for="line-1">Story</text></translation></translations></iTunesMetadata></metadata>
  </head>
  <body><div><p begin="1.5s" end="3s" itunes:key="line-1" ttm:agent="v1"><span begin="1.5s" end="2s">故</span><span begin="2s" end="3s">事</span><span ttm:role="x-romanization">gushi</span><span ttm:role="x-bg">和声</span></p></div></body>
</tt>`;
    const converted = renderPluginLyrics(
      { rawTtml },
      "ttml",
      { showTranslation: true, showRomanization: false },
    );
    expect(converted).toContain('xml:lang="zh-Hans"');
    expect(converted).toContain('xml:id="v1"');
    expect(converted).toContain('for="line-1">Story</text>');
    expect(converted).toContain('ttm:role="x-bg"');
    expect(converted).not.toContain("gushi");
  });

  it("keeps untimed spaces between timed TTML words", () => {
    const converted = renderPluginLyrics(
      { rawTtml: '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="3s"><span begin="1s" end="2s">hello</span> <span begin="2s" end="3s">world</span></p></div></body></tt>' },
      "verbatimLrc",
    );
    expect(converted).toContain("hello [00:02.000]world");
  });

  it("applies the mobile line order and structured processors", () => {
    const reordered = renderPluginLyrics(result, "plainLrc", {
      lineOrder: ["translation", "original", "romanization"],
      offsetMs: 500,
      conversionMode: "simplifiedToTraditional",
    });
    const lines = reordered.split("\n").filter((line) => line.startsWith("[00:01.500]"));
    expect(lines).toEqual([
      "[00:01.500]Story",
      "[00:01.500]故事",
      "[00:01.500]gushi",
    ]);
  });

  it("converts TTML original, translation and metadata with the mobile conversion mode", () => {
    const ttml = `<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><head><metadata><lyrico:tags xmlns:lyrico="https://github.com/LonelyNeZha/Lyrico"><lyrico:tag name="ti">繁體標題</lyrico:tag></lyrico:tags><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation xml:lang="zh-Hans"><text for="L1">這裡是翻譯</text></translation></translations></iTunesMetadata></metadata></head><body><div><p begin="1s" end="2s" itunes:key="L1">這裡有故事</p></div></body></tt>`;
    const converted = processLyricsText(ttml, {
      targetFormat: "ttml",
      conversionMode: "traditionalToSimplified",
    }).text;
    expect(converted).toContain("繁体标题");
    expect(converted).toContain("这里有故事");
    expect(converted).toContain("这里是翻译");
    expect(converted).not.toContain("這裡");
  });

  it("removes empty original lines and their linked tracks", () => {
    const ttml = `<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation xml:lang="en"><text for="L1">Removed</text><text for="L2">Kept</text></translation></translations></iTunesMetadata></metadata></head><body><div><p begin="1s" end="2s" itunes:key="L1">---</p><p begin="2s" end="3s" itunes:key="L2">保留</p></div></body></tt>`;
    const processed = processLyricsText(ttml, { targetFormat: "plainLrc", removeEmptyLines: true }).text;
    expect(processed).not.toContain("Removed");
    expect(processed).toContain("保留");
    expect(processed).toContain("Kept");
  });

  it("filters tag lines with linked translation and reports unknown TTML losses", () => {
    const ttml = `<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:foo="urn:provider"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation><text for="L1">translation credit</text><text for="L2">译文</text></translation></translations></iTunesMetadata></metadata></head><body><div><p begin="1s" end="2s" itunes:key="L1">producer credit</p><p begin="2s" end="3s" itunes:key="L2">歌词</p></div></body></tt>`;
    const processed = processPluginLyrics({ rawTtml: ttml }, "plainLrc", { removeTagLineKeywords: ["credit"] });
    expect(processed.text).not.toContain("credit");
    expect(processed.text).toContain("歌词");
    expect(processed.warnings).toEqual(["TTML extension cannot be represented in plainLrc: urn:provider"]);
  });

  it("parses all mobile TTML time forms through the same offset processor", () => {
    const ttml = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1500ms" end="3s">a</p><p begin="4.5" end="5.5">b</p><p begin="02:04.818" end="02:05.000">c</p><p begin="00:02:06.000" end="00:02:07.000">d</p></div></body></tt>`;
    const output = processLyricsText(ttml, { targetFormat: "plainLrc", offsetMs: 500 }).text;
    expect(output).toContain("[00:02.000]a");
    expect(output).toContain("[00:05.000]b");
    expect(output).toContain("[02:05.318]c");
    expect(output).toContain("[02:06.500]d");
  });

  it("can force the mobile default line order without changing formats", () => {
    const ttml = `<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation><text for="L1">translation</text></translation></translations></iTunesMetadata></metadata></head><body><div><p begin="1s" end="2s" itunes:key="L1"><span ttm:role="x-romanization" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">romanization</span>original</p></div></body></tt>`;
    const processed = processLyricsText(ttml, { targetFormat: "ttml", forceRewrite: true }).text;
    expect(processed).not.toBe(ttml);
    expect(processed).toContain("original");
    expect(processed).toContain("translation");
    expect(processed).toContain("romanization");
  });
});
