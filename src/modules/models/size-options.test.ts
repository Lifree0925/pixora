import { describe, expect, it } from "vitest";
import { describeSizeOption, groupSizeOptions } from "./size-options";

describe("size option presentation", () => {
  it("separates resolution from aspect ratio in GPT Image 2.5 sizes", () => {
    const grouped = groupSizeOptions([
      { label: "1:1", value: "1024x1024" },
      { label: "3:2", value: "1536x1024" },
      { label: "2:3", value: "1024x1536" },
      { label: "16:9", value: "1536x864" },
      { label: "9:16", value: "864x1536" },
      { label: "1:1", value: "2048x2048" },
      { label: "3:2", value: "2016x1344" },
      { label: "2:3", value: "1344x2016" },
      { label: "16:9", value: "2560x1440" },
      { label: "9:16", value: "1440x2560" },
      { label: "1:1", value: "2880x2880" },
      { label: "3:2", value: "3504x2336" },
      { label: "2:3", value: "2336x3504" },
      { label: "16:9", value: "3840x2160" },
      { label: "9:16", value: "2160x3840" },
    ]);

    expect(grouped.resolutions).toEqual(["1K", "2K", "4K"]);
    expect(grouped.orientations.map((option) => option.label)).toEqual([
      "1:1",
      "3:2",
      "2:3",
      "16:9",
      "9:16",
    ]);
    expect(grouped.options.find((option) => option.value === "2560x1440")).toMatchObject({
      resolution: "2K",
      orientationLabel: "16:9",
    });
    expect(grouped.options.find((option) => option.value === "2160x3840")).toMatchObject({
      resolution: "4K",
      orientationLabel: "9:16",
    });
  });

  it("normalizes aspect ratios from labels and dimensions", () => {
    expect(describeSizeOption({ label: "正方形（1K）", value: "1024x1024" })).toMatchObject({
      resolution: "1K",
      orientationLabel: "1:1",
    });
    expect(describeSizeOption({ label: "竖版（2:3）", value: "1024x1536" })).toMatchObject({
      resolution: "1K",
      orientationLabel: "2:3",
    });
    expect(describeSizeOption({ label: "1K 横版", value: "1536x1024" }).orientationLabel).toBe(
      "3:2",
    );
  });

  it("prefers a declared ratio over mathematically reduced dimensions", () => {
    expect(describeSizeOption({ label: "宽屏（16:9）", value: "1376x768" })).toMatchObject({
      resolution: "1K",
      orientationLabel: "16:9",
    });
  });
});
