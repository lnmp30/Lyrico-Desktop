import { describe, expect, it } from "vitest";
import type { BatchTask } from "../app/types";
import { clearFinishedTask, currentActiveTask, mergeBatchTaskSnapshot } from "./batchTasks";

function task(status: BatchTask["status"], current = 0, taskId = "task-1"): BatchTask {
  return {
    taskId,
    taskType: "exportCover",
    status,
    total: 2,
    current,
    successCount: status === "succeeded" ? current : 0,
    failureCount: 0,
    skippedCount: 0,
    createdAt: "1",
    updatedAt: "1",
  };
}

describe("batch task snapshots", () => {
  it("does not let a stale start response overwrite a quickly completed task", () => {
    const completed = task("succeeded", 2);
    expect(mergeBatchTaskSnapshot(completed, task("running", 0))).toBe(completed);
  });

  it("accepts terminal progress even when every item was skipped", () => {
    const skipped = { ...task("succeeded", 2), successCount: 0, skippedCount: 2 };
    expect(mergeBatchTaskSnapshot(task("running", 0), skipped)).toEqual(skipped);
  });

  it("restores only active tasks and clears completed progress after navigation", () => {
    expect(currentActiveTask([task("succeeded", 2), task("running", 1, "task-2")])?.taskId).toBe("task-2");
    expect(clearFinishedTask(task("succeeded", 2))).toBeUndefined();
    expect(clearFinishedTask(task("running", 1))?.status).toBe("running");
  });
});
