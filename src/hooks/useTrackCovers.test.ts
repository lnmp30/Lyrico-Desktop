import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTrackCovers } from "../backend/audioApi";
import { preloadTrackCovers, readCachedTrackCover, resetTrackCoverCache } from "./useTrackCovers";

vi.mock("../backend/audioApi", () => ({
  loadTrackCovers: vi.fn(),
}));

const mockedLoadTrackCovers = vi.mocked(loadTrackCovers);

describe("track cover cache", () => {
  beforeEach(() => {
    resetTrackCoverCache();
    mockedLoadTrackCovers.mockReset();
  });

  it("retries a transient failed batch instead of caching a permanent miss", async () => {
    mockedLoadTrackCovers
      .mockRejectedValueOnce(new Error("database is busy"))
      .mockResolvedValueOnce([{ path: "C:\\Music\\song.flac", coverDataUrl: "data:image/jpeg;base64,cover" }]);

    await preloadTrackCovers(["C:\\Music\\song.flac"], [0, 0]);

    expect(mockedLoadTrackCovers).toHaveBeenCalledTimes(2);
    expect(readCachedTrackCover("C:\\Music\\song.flac")).toBe("data:image/jpeg;base64,cover");
  });

  it("retries only paths missing from a partial response", async () => {
    mockedLoadTrackCovers
      .mockResolvedValueOnce([{ path: "first", coverDataUrl: "first-cover" }])
      .mockResolvedValueOnce([{ path: "second", coverDataUrl: "second-cover" }]);

    await preloadTrackCovers(["first", "second"], [0, 0]);

    expect(mockedLoadTrackCovers).toHaveBeenNthCalledWith(1, ["first", "second"]);
    expect(mockedLoadTrackCovers).toHaveBeenNthCalledWith(2, ["second"]);
    expect(readCachedTrackCover("first")).toBe("first-cover");
    expect(readCachedTrackCover("second")).toBe("second-cover");
  });
});
