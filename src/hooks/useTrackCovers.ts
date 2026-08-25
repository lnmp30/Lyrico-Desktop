import { useEffect, useMemo, useState } from "react";
import { loadTrackCovers } from "../backend/audioApi";

const coverCache = new Map<string, string>();
const pendingRequests = new Map<string, { promise: Promise<void>; resolve: () => void }>();
const queuedPaths = new Set<string>();
const defaultRetryDelays = [0, 150, 500];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

export function useTrackCovers(paths: string[]) {
  const [version, setVersion] = useState(0);
  const pathKey = paths.join("\u0000");

  useEffect(() => {
    const requestedPaths = pathKey ? pathKey.split("\u0000") : [];
    if (requestedPaths.every((path) => coverCache.has(cacheKey(path, false)))) return;

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
      const cover = coverCache.get(cacheKey(path, false));
      if (cover) covers.set(path, cover);
    }
    return covers;
  }, [pathKey, version]);
}

export function useTrackCover(path: string | undefined, enabled = true, artwork = false) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled || !path || coverCache.has(cacheKey(path, artwork))) return;
    let cancelled = false;
    void preloadTrackCovers([path], defaultRetryDelays, artwork).finally(() => {
      if (!cancelled) setVersion((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [artwork, enabled, path]);
  void version;
  return path ? coverCache.get(cacheKey(path, artwork)) : undefined;
}

export function updateCachedCover(path: string, coverDataUrl?: string) {
  if (coverDataUrl) {
    coverCache.set(cacheKey(path, false), coverDataUrl);
    coverCache.set(cacheKey(path, true), coverDataUrl);
  } else {
    coverCache.delete(cacheKey(path, false));
    coverCache.delete(cacheKey(path, true));
  }
}

export async function preloadTrackCovers(paths: string[], retryDelays = defaultRetryDelays, artwork = false) {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  for (const delay of retryDelays) {
    const missingPaths = uniquePaths.filter((path) => !coverCache.has(cacheKey(path, artwork)));
    if (missingPaths.length === 0) return;
    if (delay > 0) await wait(delay);

    const pending = requestCoverBatch(missingPaths, artwork);
    await Promise.allSettled(pending);
  }
}

export function readCachedTrackCover(path: string, artwork = false) {
  return coverCache.get(cacheKey(path, artwork));
}

export function resetTrackCoverCache() {
  coverCache.clear();
  pendingRequests.clear();
  queuedPaths.clear();
  if (flushTimer !== undefined) globalThis.clearTimeout(flushTimer);
  flushTimer = undefined;
}

function requestCoverBatch(paths: string[], artwork: boolean) {
  const requests: Promise<void>[] = [];
  for (const path of paths) {
    const key = cacheKey(path, artwork);
    if (coverCache.has(key)) continue;
    let pending = pendingRequests.get(key);
    if (!pending) {
      let resolve: () => void = () => {};
      const promise = new Promise<void>((next) => {
        resolve = next;
      });
      pending = { promise, resolve };
      pendingRequests.set(key, pending);
      queuedPaths.add(key);
    }
    requests.push(pending.promise);
  }
  scheduleFlush();
  return [...new Set(requests)];
}

function scheduleFlush() {
  if (flushTimer !== undefined || queuedPaths.size === 0) return;
  flushTimer = globalThis.setTimeout(() => {
    flushTimer = undefined;
    void flushCoverQueue();
  }, 16);
}

async function flushCoverQueue() {
  const firstKey = queuedPaths.values().next().value as string | undefined;
  if (!firstKey) return;
  const artwork = firstKey.startsWith("artwork\u0000");
  const keys = [...queuedPaths].filter((key) => key.startsWith(artwork ? "artwork\u0000" : "thumbnail\u0000")).slice(0, 16);
  const paths = keys.map(pathFromKey);
  for (const key of keys) queuedPaths.delete(key);
  try {
    const covers = artwork ? await loadTrackCovers(paths, true) : await loadTrackCovers(paths);
    for (const cover of covers) {
      if (cover.coverDataUrl) coverCache.set(cacheKey(cover.path, artwork), cover.coverDataUrl);
    }
  } catch {
    // A failed load remains a cache miss so preloadTrackCovers can retry it.
  } finally {
    for (const key of keys) {
      pendingRequests.get(key)?.resolve();
      pendingRequests.delete(key);
    }
    scheduleFlush();
  }
}

function cacheKey(path: string, artwork: boolean) {
  return `${artwork ? "artwork" : "thumbnail"}\u0000${path}`;
}

function pathFromKey(key: string) {
  return key.slice(key.indexOf("\u0000") + 1);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
