import { describe, expect, it } from "vitest";
import type { AudioTrack, LibraryFolder } from "../app/types";
import { buildLibraryFolderTree, tracksInDirectory } from "./library";

describe("library folder view", () => {
  const folder: LibraryFolder = { path: "E:\\Music", trackCount: 3, status: "ready" };
  const tracks = [
    track("E:\\Music\\loose.flac"),
    track("E:\\Music\\Artist\\Album\\one.flac"),
    track("E:\\Music\\Artist\\Album\\two.flac"),
    track("E:\\Music Archive\\outside.flac"),
  ];

  it("builds a navigable tree with direct and recursive counts", () => {
    const [root] = buildLibraryFolderTree([folder], tracks);
    expect(root.name).toBe("Music");
    expect(root.directTrackCount).toBe(1);
    expect(root.totalTrackCount).toBe(3);
    expect(root.children[0].name).toBe("Artist");
    expect(root.children[0].children[0].name).toBe("Album");
    expect(root.children[0].children[0].directTrackCount).toBe(2);
  });

  it("switches between current-directory and recursive song scopes", () => {
    expect(tracksInDirectory(tracks, "E:\\Music", false).map((item) => item.fileName)).toEqual(["loose.flac"]);
    expect(tracksInDirectory(tracks, "E:\\Music", true)).toHaveLength(3);
    expect(tracksInDirectory(tracks, "E:\\Music\\Artist", false)).toHaveLength(0);
    expect(tracksInDirectory(tracks, "E:\\Music\\Artist", true)).toHaveLength(2);
  });
});

function track(path: string): AudioTrack {
  const parts = path.split("\\");
  return {
    id: path,
    path,
    fileName: parts[parts.length - 1] ?? path,
    title: "",
    artist: "",
    album: "",
    albumArtist: "",
    genre: "",
    language: "",
    composer: "",
    lyricist: "",
    copyright: "",
    comment: "",
    lyrics: "",
    year: "",
    durationSeconds: 0,
    format: "FLAC",
    hasLyrics: false,
    hasCover: false,
    replayGainTrackGain: "",
    replayGainTrackPeak: "",
    replayGainAlbumGain: "",
    replayGainAlbumPeak: "",
    replayGainReferenceLoudness: "",
  };
}
