import { describe, expect, it } from "vitest";
import { describeSizeOption, groupSizeOptions } from "./size-options";

describe("size option presentation", () => {
  it("separates resolution from orientation in GPT Image 2.5 labels", () => {
    const grouped = groupSizeOptions([
      { label: "1K 正方形", value: "1024x1024" },
      { label: "1K 横版", value: "1536x1024" },
      { label: "1K 竖版", value: "1024x1536" },
      { label: "2K 正方形", value: "2048x2048" },
      { label: "2K 横版", value: "2016x1344" },
      { label: "2K 竖版", value: "1344x2016" },
      { label: "4K 正方形", value: "2880x2880" },
      { label: "4K 横版", value: "3504x2336" },
      { label: "4K 竖版", value: "2336x3504" },
    ]);

    expect(grouped.resolutions).toEqual(["1K", "2K", "4K"]);
    expect(grouped.orientations.map((option) => option.label)).toEqual([
      "正方形",
      "横版",
      "竖版",
    ]);
  });

  it("reads resolutions from labels with full-width parentheses", () => {
    expect(describeSizeOption({ label: "正方形（1K）", value: "1024x1024" })).toMatchObject({
      resolution: "1K",
      orientationLabel: "正方形",
    });
    expect(describeSizeOption({ label: "竖版（2:3）", value: "1024x1536" })).toMatchObject({
      resolution: "1K",
      orientationLabel: "竖版（2:3）",
    });
  });

  it("falls back to dimensions when the label does not declare a resolution", () => {
    expect(describeSizeOption({ label: "宽屏（16:9）", value: "1344x768" })).toMatchObject({
      resolution: "1K",
      orientationLabel: "宽屏（16:9）",
    });
  });
});
