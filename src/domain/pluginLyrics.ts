import { DOMParser, type Element as XmlElement, type Node as XmlNode } from "@xmldom/xmldom";
import OpenCCS2T from "opencc-js/cn2t";
import OpenCCT2S from "opencc-js/t2cn";

export type LyricFormat = "plainLrc" | "verbatimLrc" | "enhancedLrc" | "ttml";

type CompactWord = [number, number, string];
type CompactLine = [number, number, CompactWord[] | string];

interface StructuredLyrics {
  tags?: Record<string, unknown>;
  original: CompactLine[];
  translated?: CompactLine[] | null;
  romanization?: CompactLine[] | null;
}

export type LyricsTrackType = "original" | "translation" | "romanization" | "background";
export type LyricLineTrack = Exclude<LyricsTrackType, "background">;
export type LyricsConversionMode = "none" | "traditionalToSimplified" | "simplifiedToTraditional";

type LyricsWord = {
  startMs?: number;
  endMs?: number;
  text: string;
};

type LyricsLine = {
  startMs?: number;
  endMs?: number;
  text: string;
  words: LyricsWord[];
  linkKey?: string;
  agentId?: string;
};

type LyricsTrack = {
  type: LyricsTrackType;
  language?: string;
  lines: LyricsLine[];
};

type LyricsDocument = {
  metadata: Record<string, string>;
  language?: string;
  agents: Array<{ id: string; type?: string; name?: string }>;
  tracks: LyricsTrack[];
  sourceFormat?: LyricFormat;
};

const RAW_KEYS: Record<LyricFormat, string> = {
  plainLrc: "rawPlainLrc",
  verbatimLrc: "rawVerbatimLrc",
  enhancedLrc: "rawEnhancedLrc",
  ttml: "rawTtml",
};

export const LYRIC_FORMATS: LyricFormat[] = ["plainLrc", "verbatimLrc", "enhancedLrc", "ttml"];

export type PluginLyricsOptions = {
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
};

const DEFAULT_LINE_ORDER: LyricLineTrack[] = ["original", "romanization", "translation"];

const DEFAULT_OPTIONS: Required<PluginLyricsOptions> = {
  showTranslation: true,
  showRomanization: true,
  onlyTranslationIfAvailable: false,
  lineOrder: DEFAULT_LINE_ORDER,
  normalizeWhitespace: false,
  removeEmptyLines: false,
  removeTagLineKeywords: [],
  offsetMs: 0,
  conversionMode: "none",
  forceRewrite: false,
};

export type LyricsPipelineResult = {
  text: string;
  warnings: string[];
  sourceFormat?: LyricFormat;
  targetFormat: LyricFormat;
};

const toSimplified = OpenCCT2S.Converter({ from: "t", to: "cn" });
const toTraditional = OpenCCS2T.Converter({ from: "cn", to: "tw" });

export function preferredPluginLyricFormat(result: unknown): LyricFormat | undefined {
  if (!isRecord(result)) return undefined;
  if (isStructured(result)) return "verbatimLrc";
  return LYRIC_FORMATS.find((format) => typeof result[RAW_KEYS[format]] === "string" && result[RAW_KEYS[format]]);
}

export function renderPluginLyrics(
  result: unknown,
  format: LyricFormat,
  options: PluginLyricsOptions = DEFAULT_OPTIONS,
): string {
  return processPluginLyrics(result, format, options).text;
}

export function processPluginLyrics(
  result: unknown,
  format: LyricFormat,
  options: PluginLyricsOptions = DEFAULT_OPTIONS,
): LyricsPipelineResult {
  if (!isRecord(result)) return { text: "", warnings: [], targetFormat: format };
  const normalizedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
    lineOrder: options.lineOrder ?? DEFAULT_LINE_ORDER,
    removeTagLineKeywords: options.removeTagLineKeywords ?? [],
  };
  const targetRaw = result[RAW_KEYS[format]];

  // A true no-op must retain provider-specific TTML extensions and formatting.
  if (
    typeof targetRaw === "string" &&
    targetRaw.trim() &&
    normalizedOptions.showTranslation &&
    normalizedOptions.showRomanization &&
    !normalizedOptions.onlyTranslationIfAvailable &&
    !hasDocumentTransforms(normalizedOptions)
  ) {
    return { text: targetRaw, warnings: [], sourceFormat: format, targetFormat: format };
  }

  const document = isStructured(result)
    ? documentFromStructured(result)
    : parseBestRawDocument(result, format, normalizedOptions);
  if (!document) return { text: "", warnings: [], targetFormat: format };

  const processed = processDocument(document, normalizedOptions);
  return {
    text: format === "ttml" ? writeTtml(processed) : writeLrc(processed, format, normalizedOptions.lineOrder),
    warnings: collectConversionWarnings(result, document.sourceFormat, format),
    sourceFormat: document.sourceFormat,
    targetFormat: format,
  };
}

export function processLyricsText(
  raw: string,
  options: PluginLyricsOptions & { sourceFormat?: LyricFormat; targetFormat?: LyricFormat } = {},
): LyricsPipelineResult {
  if (!raw.trim()) {
    const targetFormat = options.targetFormat ?? options.sourceFormat ?? "plainLrc";
    return { text: raw, warnings: [], sourceFormat: options.sourceFormat, targetFormat };
  }
  const sourceFormat = options.sourceFormat ?? detectLyricFormat(raw);
  const targetFormat = options.targetFormat ?? sourceFormat;
  const processed = processPluginLyrics({ [RAW_KEYS[sourceFormat]]: raw }, targetFormat, options);
  if (processed.text || sourceFormat === "ttml" || !options.removeEmptyLines) return processed;
  return {
    ...processed,
    text: raw.split(/\r?\n/).filter((line) => line.trim()).join("\n"),
  };
}

export function detectLyricFormat(raw: string): LyricFormat {
  if (/<(?:\w+:)?tt(?:\s|>)|<(?:\w+:)?p\b[^>]*(?:begin|end)=/i.test(raw)) return "ttml";
  if (/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/.test(raw)) return "enhancedLrc";
  if (/^\s*(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\].*){2,}/m.test(raw)) return "verbatimLrc";
  return "plainLrc";
}

export function extractPlainLyricsText(raw: string): string {
  if (!raw.trim()) return "";
  const format = detectLyricFormat(raw);
  const document = format === "ttml" ? parseTtml(raw) : parseLrc(raw, format);
  const original = document.tracks.find((track) => track.type === "original")?.lines ?? [];
  if (original.length) return original.map((line) => line.text || line.words.map((word) => word.text).join("")).filter(Boolean).join("\n");
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("\n");
}

function hasDocumentTransforms(options: Required<PluginLyricsOptions>) {
  return options.normalizeWhitespace || options.removeEmptyLines || options.removeTagLineKeywords.length > 0 ||
    options.offsetMs !== 0 || options.conversionMode !== "none" ||
    options.forceRewrite ||
    normalizedLineOrder(options.lineOrder).join("|") !== DEFAULT_LINE_ORDER.join("|");
}

function parseBestRawDocument(
  result: Record<string, unknown>,
  targetFormat: LyricFormat,
  options: Required<PluginLyricsOptions>,
): LyricsDocument | undefined {
  const order: LyricFormat[] = [];
  const add = (format: LyricFormat) => {
    if (!order.includes(format)) order.push(format);
  };
  add(targetFormat);
  if (options.showTranslation || options.showRomanization || options.onlyTranslationIfAvailable) add("ttml");
  add("enhancedLrc");
  add("verbatimLrc");
  add("plainLrc");
  add("ttml");

  for (const sourceFormat of order) {
    const raw = result[RAW_KEYS[sourceFormat]];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const parsed = sourceFormat === "ttml" ? parseTtml(raw) : parseLrc(raw, sourceFormat);
    if (parsed.tracks.some((track) => track.lines.length)) return parsed;
  }
  return undefined;
}

function documentFromStructured(result: StructuredLyrics): LyricsDocument {
  const toLines = (lines: CompactLine[] | null | undefined, type: LyricsTrackType): LyricsLine[] =>
    (lines ?? []).map((line, index) => compactLineToDocument(line, `L${index + 1}`, type));
  const tracks: LyricsTrack[] = [{ type: "original", lines: toLines(result.original, "original") }];
  if (result.translated?.length) tracks.push({ type: "translation", lines: toLines(result.translated, "translation") });
  if (result.romanization?.length) tracks.push({ type: "romanization", lines: toLines(result.romanization, "romanization") });
  return {
    metadata: normalizeTags(result.tags),
    agents: [],
    tracks,
  };
}

function compactLineToDocument(line: CompactLine, linkKey: string, type: LyricsTrackType): LyricsLine {
  const words = Array.isArray(line[2])
    ? line[2].map((word) => ({ startMs: word[0], endMs: word[1], text: String(word[2] ?? "") }))
    : [];
  return {
    startMs: line[0],
    endMs: line[1],
    text: Array.isArray(line[2]) ? words.map((word) => word.text).join("") : String(line[2] ?? ""),
    words: type === "original" ? words : [],
    linkKey,
  };
}

function normalizeTags(tags?: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(tags ?? {}).flatMap(([key, value]) =>
      value == null || !String(value).trim() ? [] : [[key, String(value)]],
    ),
  );
}

function parseLrc(raw: string, format: Exclude<LyricFormat, "ttml">): LyricsDocument {
  const metadata: Record<string, string> = {};
  const parsed: LyricsLine[] = [];
  const tagPattern = /^\[([A-Za-z][\w-]*):([^\]]*)\]\s*$/;

  for (const sourceLine of raw.split(/\r?\n/)) {
    const tag = sourceLine.match(tagPattern);
    if (tag && !/^\d+$/.test(tag[1])) {
      metadata[tag[1]] = tag[2];
      continue;
    }
    if (format === "plainLrc") {
      parsed.push(...parsePlainLrcLine(sourceLine));
    } else if (format === "enhancedLrc") {
      const line = parseEnhancedLrcLine(sourceLine);
      if (line) parsed.push(line);
    } else {
      const line = parseVerbatimLrcLine(sourceLine);
      if (line) parsed.push(line);
    }
  }

  const tracks = classifyLrcTracks(parsed);
  return { metadata, agents: [], tracks, sourceFormat: format };
}

function parsePlainLrcLine(line: string): LyricsLine[] {
  const prefix = /^(?:\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\])+/;
  const match = line.match(prefix);
  if (!match) return [];
  const stamps = [...match[0].matchAll(/\[([^\]]+)\]/g)]
    .map((item) => parseLrcTime(item[1]))
    .filter((value): value is number => value != null);
  const text = line.slice(match[0].length);
  return stamps.map((startMs) => ({ startMs, endMs: startMs + 2000, text, words: [] }));
}

function parseEnhancedLrcLine(line: string): LyricsLine | undefined {
  const lineStamp = line.match(/^\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/);
  const content = lineStamp ? line.slice(lineStamp[0].length) : line;
  const stampMatches = [...content.matchAll(/<(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)>/g)];
  const startMs = lineStamp ? parseLrcTime(lineStamp[1]) : parseLrcTime(stampMatches[0]?.[1] ?? "");
  if (startMs == null) return undefined;
  if (!stampMatches.length) return { startMs, endMs: startMs + 2000, text: content, words: [] };
  return timedLineFromStamps(content, stampMatches, startMs);
}

function parseVerbatimLrcLine(line: string): LyricsLine | undefined {
  const stamps = [...line.matchAll(/\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/g)];
  if (!stamps.length) return undefined;
  const startMs = parseLrcTime(stamps[0][1]);
  if (startMs == null) return undefined;
  return timedLineFromStamps(line, stamps, startMs);
}

function timedLineFromStamps(
  source: string,
  stamps: RegExpMatchArray[],
  lineStartMs: number,
): LyricsLine {
  const lastStamp = stamps[stamps.length - 1];
  const trailingText = source.slice((lastStamp?.index ?? 0) + (lastStamp?.[0].length ?? 0));
  const hasExplicitEnd = stamps.length > 1 && trailingText.length === 0;
  const wordStamps = hasExplicitEnd ? stamps.slice(0, -1) : stamps;
  const explicitEnd = hasExplicitEnd ? parseLrcTime(lastStamp[1]) : undefined;
  const words: LyricsWord[] = wordStamps.flatMap((stamp, index) => {
    const wordStart = parseLrcTime(stamp[1]);
    if (wordStart == null) return [];
    const contentStart = (stamp.index ?? 0) + stamp[0].length;
    const nextStamp = stamps[index + 1];
    const contentEnd = nextStamp?.index ?? source.length;
    const text = source.slice(contentStart, contentEnd);
    if (!text) return [];
    const nextTime = nextStamp ? parseLrcTime(nextStamp[1]) : undefined;
    return [{ startMs: wordStart, endMs: nextTime ?? explicitEnd ?? wordStart + 500, text }];
  });
  const text = words.map((word) => word.text).join("");
  const endMs = explicitEnd ?? words[words.length - 1]?.endMs ?? lineStartMs + 2000;
  return { startMs: lineStartMs, endMs, text, words };
}

function classifyLrcTracks(lines: LyricsLine[]): LyricsTrack[] {
  const original: LyricsLine[] = [];
  const translation: LyricsLine[] = [];
  const romanization: LyricsLine[] = [];
  const byStart = new Map<number, LyricsLine[]>();
  for (const line of lines) {
    const key = line.startMs ?? -1;
    const group = byStart.get(key) ?? [];
    group.push(line);
    byStart.set(key, group);
  }

  let index = 1;
  for (const group of byStart.values()) {
    const first = group[0];
    const linkKey = `L${index++}`;
    original.push({ ...first, linkKey });
    for (const candidate of group.slice(1)) {
      const linked = { ...candidate, linkKey, words: [] };
      if (looksLikeRomanization(candidate.text, first.text) && !romanization.some((line) => line.linkKey === linkKey)) {
        romanization.push(linked);
      } else {
        translation.push(linked);
      }
    }
  }
  const tracks: LyricsTrack[] = [{ type: "original", lines: original }];
  if (translation.length) tracks.push({ type: "translation", lines: translation });
  if (romanization.length) tracks.push({ type: "romanization", lines: romanization });
  return tracks;
}

function looksLikeRomanization(value: string, original: string) {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(original) &&
    /^[\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}]+$/u.test(value);
}

function parseTtml(raw: string): LyricsDocument {
  const xml = new DOMParser().parseFromString(raw, "application/xml");
  if (!xml?.documentElement || localName(xml.documentElement) === "parsererror") {
    return { metadata: {}, agents: [], tracks: [], sourceFormat: "ttml" };
  }
  const root = xml.documentElement;
  const metadata = Object.fromEntries(
    descendants(root, "tag").flatMap((tag) => {
      const name = attr(tag, "name");
      return name ? [[name, visibleText(tag)]] : [];
    }),
  );
  const original: LyricsLine[] = [];
  const translations: LyricsTrack[] = [];
  const romanization: LyricsLine[] = [];
  const background: LyricsLine[] = [];
  const agents = descendants(root, "agent").flatMap((agent) => {
    const id = attr(agent, "id");
    return id ? [{ id, type: attr(agent, "type"), name: visibleText(agent).trim() || undefined }] : [];
  });

  for (const p of descendants(root, "p")) {
    const startMs = parseTtmlTime(attr(p, "begin"));
    if (startMs == null) continue;
    const pEnd = parseTtmlTime(attr(p, "end"));
    const linkKey = attr(p, "key") || `L${original.length + 1}`;
    const agentId = attr(p, "agent");
    const words: LyricsWord[] = [];
    let text = "";
    for (const child of childNodes(p)) {
      if (child.nodeType === 3 || child.nodeType === 4) {
        const childText = normalizeTtmlText(child.nodeValue ?? "");
        if (words.length) words.push({ text: childText });
        else text += childText;
        continue;
      }
      if (child.nodeType !== 1) continue;
      const element = child as XmlElement;
      const role = attr(element, "role");
      const childText = normalizeTtmlText(visibleText(element), true);
      if (role === "x-translation") {
        // Collected below with all inline translations so each span is emitted once.
      } else if (role === "x-romanization") {
        if (childText) romanization.push(linkedTextLine(childText, startMs, pEnd, linkKey));
      } else if (role === "x-bg") {
        if (childText) background.push({ ...linkedTextLine(childText, startMs, pEnd, linkKey), words: parseTimedWords(element, pEnd) });
      } else {
        const childStart = parseTtmlTime(attr(element, "begin"));
        if (childStart != null) {
          words.push({
            startMs: childStart,
            endMs: parseTtmlTime(attr(element, "end")) ?? pEnd,
            text: normalizeTtmlText(visibleText(element)),
          });
        } else {
          const childWords = parseTimedWords(element, pEnd);
          if (childWords.some((word) => word.startMs != null)) words.push(...childWords);
          else text += normalizeTtmlText(visibleText(element));
        }
      }
    }
    const normalizedText = words.length ? words.map((word) => word.text).join("") : normalizeTtmlText(text, true);
    const endMs = pEnd ?? words[words.length - 1]?.endMs ?? startMs + 2000;
    original.push({ startMs, endMs, text: normalizedText, words, linkKey, agentId });
  }

  for (const translation of descendants(root, "translation")) {
    const lines = descendants(translation, "text").flatMap((textNode) => {
      const linkKey = attr(textNode, "for");
      const text = normalizeTtmlText(visibleText(textNode), true);
      if (!linkKey || !text) return [];
      const linkedOriginal = original.find((line) => line.linkKey === linkKey);
      return [linkedTextLine(text, linkedOriginal?.startMs, linkedOriginal?.endMs, linkKey)];
    });
    if (lines.length) translations.push({ type: "translation", language: attr(translation, "lang"), lines });
  }

  // Inline translations are legal in many provider TTML variants.
  const inlineTranslation = descendants(root, "span").flatMap((span) => {
    if (attr(span, "role") !== "x-translation") return [];
    const p = parentByLocalName(span, "p");
    if (!p) return [];
    const startMs = parseTtmlTime(attr(p, "begin"));
    const endMs = parseTtmlTime(attr(p, "end"));
    const linkKey = attr(p, "key") || original.find((line) => line.startMs === startMs)?.linkKey;
    const text = normalizeTtmlText(visibleText(span), true);
    return linkKey && text ? [linkedTextLine(text, startMs, endMs, linkKey)] : [];
  });
  if (inlineTranslation.length) translations.push({ type: "translation", lines: inlineTranslation });

  const tracks: LyricsTrack[] = [{ type: "original", lines: original }, ...translations];
  if (romanization.length) tracks.push({ type: "romanization", lines: romanization });
  if (background.length) tracks.push({ type: "background", lines: background });
  return {
    metadata,
    language: attr(root, "lang"),
    agents,
    tracks,
    sourceFormat: "ttml",
  };
}

function linkedTextLine(text: string, startMs?: number, endMs?: number, linkKey?: string): LyricsLine {
  return { startMs, endMs, text, words: [], linkKey };
}

function parseTimedWords(element: XmlElement, fallbackEnd?: number): LyricsWord[] {
  const words: LyricsWord[] = [];
  for (const child of childNodes(element)) {
    if (child.nodeType === 3 || child.nodeType === 4) {
      const text = normalizeTtmlText(child.nodeValue ?? "");
      if (text && !text.includes("\n")) words.push({ text });
      continue;
    }
    if (child.nodeType !== 1) continue;
    const item = child as XmlElement;
    const startMs = parseTtmlTime(attr(item, "begin"));
    const endMs = parseTtmlTime(attr(item, "end")) ?? fallbackEnd;
    const text = normalizeTtmlText(visibleText(item));
    if (startMs != null && text) words.push({ startMs, endMs, text });
    else words.push(...parseTimedWords(item, fallbackEnd));
  }
  return words;
}

function processDocument(document: LyricsDocument, options: Required<PluginLyricsOptions>): LyricsDocument {
  let next = transformDocumentText(document, options);
  let tracks = next.tracks.filter((track) => {
    if (!options.showTranslation && track.type === "translation") return false;
    if (!options.showRomanization && track.type === "romanization") return false;
    return true;
  });
  if (options.onlyTranslationIfAvailable) {
    const original = tracks.find((track) => track.type === "original");
    const translations = tracks.filter((track) => track.type === "translation").flatMap((track) => track.lines);
    if (original && translations.length) {
      const byKey = new Map(translations.flatMap((line) => line.linkKey ? [[line.linkKey, line] as const] : []));
      const byStart = new Map(translations.flatMap((line) => line.startMs != null ? [[line.startMs, line] as const] : []));
      original.lines = original.lines.map((line) => {
        const translated = (line.linkKey ? byKey.get(line.linkKey) : undefined) ??
          (line.startMs != null ? byStart.get(line.startMs) : undefined);
        return translated?.text ? { ...line, text: translated.text, words: [] } : line;
      });
      tracks = tracks.filter((track) => track.type !== "translation" && track.type !== "background");
    }
  }
  next = { ...next, tracks };
  if (options.removeTagLineKeywords.length) next = removeMatchingLines(next, options.removeTagLineKeywords, true);
  if (options.removeEmptyLines) next = removeEmptyLines(next);
  if (options.offsetMs) next = offsetDocument(next, options.offsetMs);
  return next;
}

function writeLrc(document: LyricsDocument, format: Exclude<LyricFormat, "ttml">, lineOrder: LyricLineTrack[] = DEFAULT_LINE_ORDER) {
  const tags = Object.entries(document.metadata).map(([key, value]) => `[${key}:${value}]`);
  const original = document.tracks.find((track) => track.type === "original")?.lines ?? [];
  const translations = linkedLineLookup(document.tracks, "translation");
  const romanizations = linkedLineLookup(document.tracks, "romanization");
  const output: string[] = [];
  for (const line of original) {
    for (const type of normalizedLineOrder(lineOrder)) {
      if (type === "original") output.push(writeOriginalLrcLine(line, format));
      if (type === "romanization") {
        const romanization = findLinkedLine(romanizations, line);
        if (romanization?.text) output.push(`[${lrcTime(line.startMs ?? 0)}]${romanization.text}`);
      }
      if (type === "translation") {
        const translation = findLinkedLine(translations, line);
        if (translation?.text) output.push(`[${lrcTime(line.startMs ?? 0)}]${translation.text}`);
      }
    }
  }
  return [...tags, ...(tags.length && output.length ? [""] : []), ...output].join("\n");
}

function writeOriginalLrcLine(line: LyricsLine, format: Exclude<LyricFormat, "ttml">) {
  const start = line.startMs ?? 0;
  const text = line.text || line.words.map((word) => word.text).join("");
  const timedWords = resolvedTimedWords(line.words);
  if (format === "plainLrc" || !timedWords.length) return `[${lrcTime(start)}]${text}`;
  const end = line.endMs ?? timedWords[timedWords.length - 1]?.endMs ?? start + 2000;
  if (format === "verbatimLrc") {
    return `${timedWords.map((word) => `[${lrcTime(word.startMs!)}]${word.text}`).join("")}[${lrcTime(end)}]`;
  }
  return `[${lrcTime(start)}]${timedWords.map((word) => `<${lrcTime(word.startMs!)}>${word.text}`).join("")}<${lrcTime(end)}>`;
}

function writeTtml(document: LyricsDocument) {
  const original = document.tracks.find((track) => track.type === "original")?.lines ?? [];
  const translations = document.tracks.filter((track) => track.type === "translation");
  const romanizations = linkedLineLookup(document.tracks, "romanization");
  const backgrounds = linkedLineLookup(document.tracks, "background");
  const usedKeys = new Set(original.flatMap((line) => line.linkKey ? [line.linkKey] : []));
  let keyIndex = 1;
  const lineKeys = original.map((line) => {
    if (line.linkKey) return line.linkKey;
    let key = `L${keyIndex++}`;
    while (usedKeys.has(key)) key = `L${keyIndex++}`;
    usedKeys.add(key);
    return key;
  });

  const headParts: string[] = [];
  if (Object.keys(document.metadata).length) {
    headParts.push(`    <metadata>\n${Object.entries(document.metadata).map(([key, value]) =>
      `      <lyrico:tag name="${escapeXml(key)}">${escapeXml(value)}</lyrico:tag>`,
    ).join("\n")}\n    </metadata>`);
  }
  if (document.agents.length) {
    headParts.push(`    <metadata>\n${document.agents.map((agent) => {
      const type = agent.type ? ` type="${escapeXml(agent.type)}"` : "";
      const name = agent.name ? `>${escapeXml(agent.name)}</ttm:agent>` : "/>";
      return `      <ttm:agent xml:id="${escapeXml(agent.id)}"${type}${name}`;
    }).join("\n")}\n    </metadata>`);
  }
  if (translations.some((track) => track.lines.length)) {
    const content = translations.map((track) => {
      const language = track.language ? ` xml:lang="${escapeXml(track.language)}"` : "";
      const texts = track.lines.flatMap((line) => {
        const key = line.linkKey || lineKeys[original.findIndex((item) => item.startMs === line.startMs)];
        return key && line.text ? [`            <text for="${escapeXml(key)}">${escapeXml(line.text)}</text>`] : [];
      }).join("\n");
      return `          <translation${language}>\n${texts}\n          </translation>`;
    }).join("\n");
    headParts.push(`    <metadata>\n      <iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">\n        <translations>\n${content}\n        </translations>\n      </iTunesMetadata>\n    </metadata>`);
  }
  const head = headParts.length ? `  <head>\n${headParts.join("\n")}\n  </head>\n` : "";
  const lines = original.map((line, index) => {
    const start = line.startMs ?? 0;
    const end = line.endMs ?? line.words[line.words.length - 1]?.endMs ?? start + 2000;
    const agent = line.agentId ? ` ttm:agent="${escapeXml(line.agentId)}"` : "";
    const timedWords = resolvedTimedWords(line.words);
    const originalContent = timedWords.length > 1
      ? timedWords.map((word) => `<span begin="${ttmlTime(word.startMs!)}" end="${ttmlTime(word.endMs ?? end)}">${escapeXml(word.text)}</span>`).join("")
      : escapeXml(line.text || line.words.map((word) => word.text).join(""));
    const romanization = findLinkedLine(romanizations, line);
    const romanizationContent = romanization?.text
      ? `<span ttm:role="x-romanization">${escapeXml(romanization.text)}</span>`
      : "";
    const backgroundContent = findLinkedLines(backgrounds, line).map((background) => {
      const words = resolvedTimedWords(background.words);
      const content = words.length
        ? words.map((word) => `<span begin="${ttmlTime(word.startMs!)}" end="${ttmlTime(word.endMs ?? end)}">${escapeXml(word.text)}</span>`).join("")
        : escapeXml(background.text);
      return `<span ttm:role="x-bg">${content}</span>`;
    }).join("");
    return `      <p begin="${ttmlTime(start)}" end="${ttmlTime(end)}" itunes:key="${escapeXml(lineKeys[index])}"${agent}>${originalContent}${romanizationContent}${backgroundContent}</p>`;
  });
  const language = document.language ? ` xml:lang="${escapeXml(document.language)}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" ${language}>\n${head}  <body>\n    <div>\n${lines.join("\n")}\n    </div>\n  </body>\n</tt>`;
}

function linkedLineLookup(tracks: LyricsTrack[], type: LyricsTrackType) {
  const lines = tracks.filter((track) => track.type === type).flatMap((track) => track.lines);
  return { lines };
}

function resolvedTimedWords(words: LyricsWord[]) {
  const result: Array<LyricsWord & { startMs: number }> = [];
  let pending = "";
  for (const word of words) {
    if (word.startMs == null) {
      if (result.length) result[result.length - 1].text += word.text;
      else pending += word.text;
      continue;
    }
    result.push({ ...word, startMs: word.startMs, text: pending + word.text });
    pending = "";
  }
  if (pending && result.length) result[result.length - 1].text += pending;
  return result;
}

function findLinkedLine(lookup: ReturnType<typeof linkedLineLookup>, line: LyricsLine) {
  return findLinkedLines(lookup, line)[0];
}

function findLinkedLines(lookup: ReturnType<typeof linkedLineLookup>, line: LyricsLine) {
  return lookup.lines.filter((candidate) =>
    (line.linkKey && candidate.linkKey === line.linkKey) ||
    (line.startMs != null && candidate.startMs === line.startMs),
  );
}

function normalizedLineOrder(order: LyricLineTrack[]) {
  return [...order, ...DEFAULT_LINE_ORDER].filter((item, index, all) => all.indexOf(item) === index && DEFAULT_LINE_ORDER.includes(item));
}

function transformDocumentText(document: LyricsDocument, options: Required<PluginLyricsOptions>): LyricsDocument {
  let transform = (value: string) => value;
  if (options.conversionMode === "traditionalToSimplified") transform = toSimplified;
  if (options.conversionMode === "simplifiedToTraditional") transform = toTraditional;
  const normalize = (value: string) => options.normalizeWhitespace ? transform(value).replace(/[ \t\u00a0]+/g, " ") : transform(value);
  if (options.conversionMode === "none" && !options.normalizeWhitespace) return document;
  return {
    ...document,
    metadata: Object.fromEntries(Object.entries(document.metadata).map(([key, value]) => [key, normalize(value)])),
    tracks: document.tracks.map((track) => ({
      ...track,
      lines: track.lines.map((line) => ({
        ...line,
        text: normalize(line.text),
        words: line.words.map((word) => ({ ...word, text: normalize(word.text) })),
      })),
    })),
  };
}

function removeEmptyLines(document: LyricsDocument) {
  return removeMatchingLines(document, [], false);
}

function removeMatchingLines(document: LyricsDocument, keywords: string[], removeMetadata: boolean): LyricsDocument {
  const removedKeys = new Set<string>();
  const removedStarts = new Set<number>();
  const matches = (line: LyricsLine) => keywords.length
    ? keywords.some((keyword) => (line.text || line.words.map((word) => word.text).join("")).toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))
    : isBlankOrPlaceholder(line.text || line.words.map((word) => word.text).join(""));
  const tracks = document.tracks.map((track) => {
    const lines = track.lines.filter((line) => {
      const remove = matches(line);
      if (remove && track.type === "original") {
        if (line.linkKey) removedKeys.add(line.linkKey);
        if (line.startMs != null) removedStarts.add(line.startMs);
      }
      return !remove;
    });
    return { ...track, lines };
  }).map((track) => track.type === "original" ? track : ({
    ...track,
    lines: track.lines.filter((line) => !(line.linkKey && removedKeys.has(line.linkKey)) && !(line.startMs != null && removedStarts.has(line.startMs))),
  }));
  const metadata = !removeMetadata ? document.metadata : Object.fromEntries(Object.entries(document.metadata).filter(([key, value]) => {
    const tag = `[${key}:${value}]`.toLocaleLowerCase();
    return !keywords.some((keyword) => tag.includes(keyword.toLocaleLowerCase()));
  }));
  return { ...document, metadata, tracks };
}

function isBlankOrPlaceholder(value: string) {
  return !value.trim() || /^[\s/\\|｜·・.。…_-]*$/u.test(value.trim());
}

function offsetDocument(document: LyricsDocument, offsetMs: number): LyricsDocument {
  const shift = (value?: number) => value == null ? undefined : Math.max(0, value + offsetMs);
  return {
    ...document,
    tracks: document.tracks.map((track) => ({
      ...track,
      lines: track.lines.map((line) => ({
        ...line,
        startMs: shift(line.startMs),
        endMs: shift(line.endMs),
        words: line.words.map((word) => ({ ...word, startMs: shift(word.startMs), endMs: shift(word.endMs) })),
      })),
    })),
  };
}

function collectConversionWarnings(result: Record<string, unknown>, sourceFormat: LyricFormat | undefined, targetFormat: LyricFormat) {
  if (sourceFormat !== "ttml" || targetFormat === "ttml") return [];
  const raw = result.rawTtml;
  if (typeof raw !== "string") return [];
  const knownNamespaces = new Set(["http://www.w3.org/ns/ttml", "http://www.w3.org/ns/ttml#metadata", "http://music.apple.com/lyric-ttml-internal"]);
  const unknownNamespaces = [...raw.matchAll(/xmlns(?::[\w-]+)?=["']([^"']+)["']/g)].map((match) => match[1]).filter((value) => !knownNamespaces.has(value));
  return [...new Set(unknownNamespaces)].map((namespace) => `TTML extension cannot be represented in ${targetFormat}: ${namespace}`);
}

function parseLrcTime(value: string) {
  const match = value.match(/^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!match) return undefined;
  return Number(match[1]) * 60_000 + Number(match[2]) * 1000 + fractionMs(match[3]);
}

function parseTtmlTime(value?: string) {
  if (!value) return undefined;
  const text = value.trim();
  const milliseconds = text.match(/^(\d+(?:\.\d+)?)ms$/);
  if (milliseconds) return Number(milliseconds[1]);
  const seconds = text.match(/^(\d+(?:\.\d+)?)s?$/);
  if (seconds) return Number(seconds[1]) * 1000;
  const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
  if (!clock) return undefined;
  return Number(clock[1] ?? 0) * 3_600_000 + Number(clock[2]) * 60_000 + Number(clock[3]) * 1000 + fractionMs(clock[4]);
}

function fractionMs(value?: string) {
  return value ? Number(value.padEnd(3, "0").slice(0, 3)) : 0;
}

function lrcTime(milliseconds: number) {
  const safe = Number.isFinite(milliseconds) ? Math.max(0, Math.round(milliseconds)) : 0;
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(safe % 1_000).padStart(3, "0")}`;
}

function ttmlTime(milliseconds: number) {
  const safe = Number.isFinite(milliseconds) ? Math.max(0, Math.round(milliseconds)) : 0;
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(safe % 1_000).padStart(3, "0")}`;
}

function descendants(root: XmlElement, name: string): XmlElement[] {
  const result: XmlElement[] = [];
  const visit = (node: XmlNode) => {
    if (node.nodeType === 1 && localName(node as XmlElement) === name) result.push(node as XmlElement);
    for (const child of childNodes(node)) visit(child);
  };
  visit(root);
  return result;
}

function childNodes(node: XmlNode) {
  return Array.from({ length: node.childNodes?.length ?? 0 }, (_, index) => node.childNodes.item(index)).filter(Boolean) as XmlNode[];
}

function parentByLocalName(element: XmlElement, name: string) {
  let parent = element.parentNode;
  while (parent) {
    if (parent.nodeType === 1 && localName(parent as XmlElement) === name) return parent as XmlElement;
    parent = parent.parentNode;
  }
  return undefined;
}

function localName(element: XmlElement) {
  const parts = element.nodeName.split(":");
  return (element.localName || parts[parts.length - 1] || "").toLowerCase();
}

function attr(element: XmlElement, name: string) {
  const direct = element.getAttribute(name);
  if (direct) return direct;
  for (let index = 0; index < element.attributes.length; index += 1) {
    const item = element.attributes.item(index);
    const parts = item?.name.split(":") ?? [];
    const local = item?.localName || parts[parts.length - 1];
    if (local === name && item?.value) return item.value;
  }
  return undefined;
}

function visibleText(element: XmlElement) {
  return element.textContent ?? "";
}

function normalizeTtmlText(value: string, trimEdges = false) {
  const normalized = /[\r\n]/.test(value) ? value.replace(/\s+/g, " ") : value;
  return trimEdges ? normalized.trim() : normalized;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isStructured(value: Record<string, unknown>): value is Record<string, unknown> & StructuredLyrics {
  return Array.isArray(value.original);
}
