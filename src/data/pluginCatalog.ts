import type { PluginCapability } from "../app/types";

export function capabilityLabel(capability: PluginCapability) {
  switch (capability) {
    case "searchSongs":
      return "标签搜索";
    case "getLyrics":
      return "歌词";
    case "searchCovers":
      return "封面";
    default:
      return capability;
  }
}
