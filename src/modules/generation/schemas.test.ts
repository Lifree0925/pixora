import { describe, expect, it } from "vitest";
import { historyEditSchema } from "./schemas";

describe("history edit schema", () => {
  it("keeps legacy single-image edit requests compatible", () => {
    expect(
      historyEditSchema.parse({
        prompt: "调整光线",
        size: "1024x1024",
      }),
    ).toEqual({
      prompt: "调整光线",
      size: "1024x1024",
      mode: "image_edit",
      assetIds: [],
    });
  });

  it("accepts multi-image edit with additional references", () => {
    expect(
      historyEditSchema.parse({
        prompt: "融合两张图片",
        size: "1024x1024",
        mode: "multi_image_edit",
        assetIds: ["asset-a"],
      }),
    ).toMatchObject({
      mode: "multi_image_edit",
      assetIds: ["asset-a"],
    });
  });

  it("rejects text-to-image mode in history editing", () => {
    expect(() =>
      historyEditSchema.parse({
        prompt: "重新生成",
        size: "1024x1024",
        mode: "text_to_image",
      }),
    ).toThrow();
  });
});
