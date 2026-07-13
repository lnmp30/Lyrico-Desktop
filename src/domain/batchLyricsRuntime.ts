import { processLyricsText, processPluginLyrics, type LyricFormat, type PluginLyricsOptions } from "./pluginLyrics";

type BatchLyricsFormatConfig = {
  targetFormat?: LyricFormat | null;
  formatLineOrder?: boolean;
  removeTagLines?: boolean;
  tagLineKeywords?: string[];
  removeEmptyLines?: boolean;
};

type BatchLyricsRequest = {
  lyrics: string;
  config: BatchLyricsFormatConfig;
};

function processBatchLyrics(request: BatchLyricsRequest) {
  const { config } = request;
  return processLyricsText(request.lyrics, {
    targetFormat: config.targetFormat ?? undefined,
    forceRewrite: config.formatLineOrder ?? true,
    removeTagLineKeywords: config.removeTagLines ? config.tagLineKeywords ?? [] : [],
    removeEmptyLines: config.removeEmptyLines ?? false,
  });
}

Object.assign(globalThis, { __lyricoProcessBatchLyrics: processBatchLyrics });

function renderPluginLyrics(request: { result: unknown; targetFormat: LyricFormat; options: PluginLyricsOptions }) {
  return processPluginLyrics(request.result, request.targetFormat, request.options);
}

Object.assign(globalThis, { __lyricoRenderPluginLyrics: renderPluginLyrics });
