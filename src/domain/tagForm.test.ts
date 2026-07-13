import { describe, expect, it } from "vitest";
import type { AudioTrack } from "../app/types";
import { completeTagForm } from "./tagForm";

const original = {
  title: "Title",
  artist: "Artist",
  album: "Album",
  albumArtist: "Album artist",
  trackNumber: 2,
  discNumber: 1,
  year: "2026",
  genre: "Rock; Pop",
  language: "jpn",
  composer: "Composer",
  lyricist: "Lyricist",
  copyright: "Copyright",
  rating: 4,
  comment: "Annotation",
  lyrics: "Lyrics",
  replayGainTrackGain: "-8.00 dB",
  replayGainTrackPeak: "0.900000",
  replayGainAlbumGain: "-7.00 dB",
  replayGainAlbumPeak: "0.950000",
  replayGainReferenceLoudness: "-18 LUFS",
} as AudioTrack;

describe("completeTagForm", () => {
  it("preserves original values for fields not mounted by a collapsed section", () => {
    const result = completeTagForm({ title: "Changed" }, original);
    expect(result.title).toBe("Changed");
    expect(result.composer).toBe("Composer");
    expect(result.genre).toEqual(["Rock", "Pop"]);
  });

  it("keeps an explicitly cleared field empty so the tag is removed", () => {
    const result = completeTagForm({ composer: "", trackNumber: undefined }, original);
    expect(result.composer).toBe("");
    expect(result.trackNumber).toBeUndefined();
  });
});
