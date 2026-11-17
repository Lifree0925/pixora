import type { TaskStatus } from "@prisma/client";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "等待中",
  submitting: "处理中",
  processing: "处理中",
  timed_out: "查询超时（可继续查询）",
  submit_unknown: "提交结果未知，请勿重复提交",
  succeeded: "成功",
  failed: "失败",
};

export function getTaskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status];
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === "succeeded" || status === "failed";
}

export function canResumeTaskStatus(status: TaskStatus): boolean {
  return status === "timed_out";
}
