import type { SourcePlugin } from "../app/types";

export const initialPlugins: SourcePlugin[] = [
  {
    id: "apple-music",
    name: "Apple Music",
    version: "1.4.2",
    apiVersion: "2.3.0",
    enabled: true,
    capabilities: ["tags", "lyrics", "covers", "structuredLyrics"],
    permissions: ["http", "log", "cache", "xml", "json", "base64url"],
    entryFile: "index.js",
    config: {
      storefront: "US",
      language: "en-US",
      clientType: "web",
      searchLimit: 50,
    },
  },
  {
    id: "netease",
    name: "NetEase",
    version: "1.2.0",
    apiVersion: "2.3.0",
    enabled: true,
    capabilities: ["tags", "lyrics", "covers"],
    permissions: ["http", "log", "cache", "json"],
    entryFile: "index.js",
    config: {
      region: "CN",
      searchLimit: 30,
    },
  },
  {
    id: "qq-music",
    name: "QQ Music",
    version: "1.1.8",
    apiVersion: "2.3.0",
    enabled: true,
    capabilities: ["tags", "lyrics", "covers"],
    permissions: ["http", "log", "cache", "json"],
    entryFile: "index.js",
    config: {
      region: "CN",
      searchLimit: 30,
    },
  },
  {
    id: "local-tags",
    name: "Local Tags",
    version: "0.1.0",
    apiVersion: "2.3.0",
    enabled: true,
    capabilities: ["tags", "covers"],
    permissions: ["cache", "log"],
    entryFile: "builtin://local-tags",
    config: {
      preferEmbeddedCover: true,
    },
  },
];

export function capabilityLabel(capability: SourcePlugin["capabilities"][number]) {
  switch (capability) {
    case "structuredLyrics":
      return "Structured Lyrics";
    case "tags":
      return "Tags";
    case "lyrics":
      return "Lyrics";
    case "covers":
      return "Covers";
    default:
      return capability;
  }
}
