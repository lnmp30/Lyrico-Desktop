import { useEffect, useMemo, useState } from "react";
import { loadTrackCovers } from "../backend/audioApi";

const coverCache = new Map<string, string>();
const inFlightRequests = new Map<string, Promise<void>>();
const defaultRetryDelays = [0, 150, 500];

export function useTrackCovers(paths: string[]) {
  const [version, setVersion] = useState(0);
  const pathKey = paths.join("\u0000");

  useEffect(() => {
    const requestedPaths = pathKey ? pathKey.split("\u0000") : [];
    if (requestedPaths.every((path) => coverCache.has(path))) return;

    let cancelled = false;
    void preloadTrackCovers(requestedPaths).finally(() => {
      if (!cancelled) setVersion((value) => value + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [pathKey]);

  return useMemo(() => {
    const covers = new Map<string, string>();
    for (const path of paths) {
      const cover = coverCache.get(path);
      if (cover) covers.set(path, cover);
    }
    return covers;
  }, [pathKey, version]);
}

export function updateCachedCover(path: string, coverDataUrl?: string) {
  if (coverDataUrl) {
    coverCache.set(path, coverDataUrl);
  } else {
    coverCache.delete(path);
  }
}

export async function preloadTrackCovers(paths: string[], retryDelays = defaultRetryDelays) {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  for (const delay of retryDelays) {
    const missingPaths = uniquePaths.filter((path) => !coverCache.has(path));
    if (missingPaths.length === 0) return;
    if (delay > 0) await wait(delay);

    const pending = requestCoverBatch(missingPaths);
    await Promise.allSettled(pending);
  }
}

export function readCachedTrackCover(path: string) {
  return coverCache.get(path);
}

export function resetTrackCoverCache() {
  coverCache.clear();
  inFlightRequests.clear();
}

function requestCoverBatch(paths: string[]) {
  const newPaths = paths.filter((path) => !coverCache.has(path) && !inFlightRequests.has(path));
  if (newPaths.length > 0) {
    let request: Promise<void>;
    request = loadTrackCovers(newPaths)
      .then((covers) => {
        for (const cover of covers) {
          if (cover.coverDataUrl) coverCache.set(cover.path, cover.coverDataUrl);
        }
      })
      .finally(() => {
        for (const path of newPaths) {
          if (inFlightRequests.get(path) === request) inFlightRequests.delete(path);
        }
      });
    for (const path of newPaths) inFlightRequests.set(path, request);
  }

  return [...new Set(paths.map((path) => inFlightRequests.get(path)).filter(isPromise))];
}

function isPromise(value: Promise<void> | undefined): value is Promise<void> {
  return value !== undefined;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}
