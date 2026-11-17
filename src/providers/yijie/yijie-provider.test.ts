import { describe, expect, it } from "vitest";
import {
  buildEditTaskBody,
  buildGeminiNativeBody,
  buildTextTaskBody,
  extractGeminiFileReference,
  extractGeminiImage,
  extractGeminiInlineImage,
  extractOutputUrls,
  extractProviderTaskId,
  normalizeProviderStatus,
} from "./yijie-provider";

describe("yijie provider mapping", () => {
  it("normalizes known statuses and keeps unknown explicit", () => {
    expect(normalizeProviderStatus("queued")).toBe("queued");
    expect(normalizeProviderStatus("in_progress")).toBe("processing");
    expect(normalizeProviderStatus("success")).toBe("succeeded");
    expect(normalizeProviderStatus("error")).toBe("failed");
    expect(normalizeProviderStatus("something_new")).toBe("unknown");
  });

  it("extracts task ID and output URLs from flexible responses", () => {
    expect(extractProviderTaskId({ id: "task_1" })).toBe("task_1");
    expect(extractProviderTaskId({ data: { task_id: "task_2" } })).toBe("task_2");
    expect(extractOutputUrls({ data: [{ url: "https://example.com/a.png" }] })).toEqual([
      "https://example.com/a.png",
    ]);
  });

  it("passes official image parameters through to the upstream body", () => {
    const textBody = buildTextTaskBody({
      prompt: "hello",
      size: "1024x1024",
      model: "gr-gpt-image-2",
      parameters: {
        quality: "high",
        background: "opaque",
        output_format: "png",
        output_compression: 90,
        moderation: "auto",
      },
    });
    const editBody = buildEditTaskBody({
      prompt: "edit",
      size: "1024x1024",
      model: "gr-gpt-image-2",
      imageUrls: ["https://example.com/a.png"],
      parameters: {
        quality: "medium",
        output_format: "webp",
      },
    });

    expect(textBody).toEqual({
      model: "gr-gpt-image-2",
      prompt: "hello",
      size: "1024x1024",
      quality: "high",
      background: "opaque",
      output_format: "png",
      output_compression: 90,
      moderation: "auto",
    });
    expect(editBody).toEqual({
      model: "gr-gpt-image-2",
      prompt: "edit",
      size: "1024x1024",
      image: ["https://example.com/a.png"],
      quality: "medium",
      output_format: "webp",
    });
    expect(textBody).not.toHaveProperty("n");
    expect(textBody).not.toHaveProperty("watermark");
    expect(textBody).not.toHaveProperty("mask");
  });

  it("maps Gemini sizes and extracts inline images", () => {
    const body = buildGeminiNativeBody({ prompt: "hello", size: "1248x832" });
    expect(body.generationConfig.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(body.generationConfig.imageConfig).toEqual({
      aspectRatio: "3:2",
      imageSize: "1K",
    });

    const inline = extractGeminiInlineImage({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { mimeType: "image/jpeg", data: "aGVsbG8=" } }],
          },
        },
      ],
    });
    expect(inline?.mimeType).toBe("image/jpeg");
    expect(inline?.buffer.toString("utf8")).toBe("hello");

    expect(() => buildGeminiNativeBody({ prompt: "hello", size: "999x999" })).toThrow();
  });

  it("supports fileData image responses from Gemini native", async () => {
    const raw = {
      candidates: [
        {
          content: {
            parts: [
              {
                fileData: {
                  mimeType: "image/jpeg",
                  fileUri: "https://example.com/generated.jpg",
                },
              },
            ],
          },
        },
      ],
    };
    expect(extractGeminiFileReference(raw)).toEqual({
      mimeType: "image/jpeg",
      fileUri: "https://example.com/generated.jpg",
    });

    const image = await extractGeminiImage(raw, {
      maxBytes: 1024,
      download: async () => ({
        buffer: Buffer.from("downloaded"),
        contentType: "image/jpeg",
      }),
    });
    expect(image?.mimeType).toBe("image/jpeg");
    expect(image?.buffer.toString("utf8")).toBe("downloaded");
  });
});
