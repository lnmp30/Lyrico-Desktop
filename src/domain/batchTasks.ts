import type { BatchTask } from "../app/types";

const terminalStatuses = new Set<BatchTask["status"]>(["succeeded", "failed", "skipped", "cancelled"]);

export function isActiveTask(task?: BatchTask) {
  return task?.status === "queued" || task?.status === "running";
}

export function currentActiveTask(tasks: BatchTask[]) {
  return tasks.find(isActiveTask);
}

export function clearFinishedTask(task?: BatchTask) {
  return isActiveTask(task) ? task : undefined;
}

export function mergeBatchTaskSnapshot(current: BatchTask | undefined, incoming: BatchTask) {
  if (!current) return incoming;
  if (current.taskId !== incoming.taskId) return isActiveTask(incoming) ? incoming : current;
  if (terminalStatuses.has(current.status) && isActiveTask(incoming)) return current;
  if (incoming.current < current.current && incoming.status === current.status) return current;
  return incoming;
}
