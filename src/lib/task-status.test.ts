import { describe, expect, it } from "vitest";
import {
  canResumeTaskStatus,
  getTaskStatusLabel,
  isTerminalTaskStatus,
} from "./task-status";

describe("task-status", () => {
  it("提供中文状态文案", () => {
    expect(getTaskStatusLabel("pending")).toBe("等待中");
    expect(getTaskStatusLabel("timed_out")).toBe("查询超时（可继续查询）");
    expect(getTaskStatusLabel("submit_unknown")).toBe("提交结果未知，请勿重复提交");
  });

  it("只把成功和失败视为终态", () => {
    expect(isTerminalTaskStatus("succeeded")).toBe(true);
    expect(isTerminalTaskStatus("failed")).toBe(true);
    expect(isTerminalTaskStatus("timed_out")).toBe(false);
    expect(isTerminalTaskStatus("submit_unknown")).toBe(false);
  });

  it("只有超时任务可以继续查询", () => {
    expect(canResumeTaskStatus("timed_out")).toBe(true);
    expect(canResumeTaskStatus("submit_unknown")).toBe(false);
  });
});
