import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import type { ReplayGainProgress } from "../app/types";

const listeners = new Set<() => void>();
let current: ReplayGainProgress | undefined;
let pending: ReplayGainProgress | undefined;
let timer: number | undefined;
let listening = false;

function emit(progress: ReplayGainProgress) {
  current = progress;
  listeners.forEach((listener) => listener());
}

function ingest(progress: ReplayGainProgress) {
  pending = progress;
  if (progress.status !== "running") {
    if (timer != null) window.clearTimeout(timer);
    timer = undefined;
    pending = undefined;
    emit(progress);
    return;
  }
  if (timer != null) return;
  timer = window.setTimeout(() => {
    timer = undefined;
    const latest = pending;
    pending = undefined;
    if (latest) emit(latest);
  }, 160);
}

function ensureListening() {
  if (listening) return;
  listening = true;
  void listen<ReplayGainProgress>("replay-gain-progress", ({ payload }) => ingest(payload)).catch(() => {
    listening = false;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureListening();
  return () => listeners.delete(listener);
}

export function useReplayGainProgress() {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

export function getReplayGainProgress() {
  return current;
}

export function publishReplayGainProgress(progress: ReplayGainProgress) {
  pending = undefined;
  if (timer != null) window.clearTimeout(timer);
  timer = undefined;
  emit(progress);
}
