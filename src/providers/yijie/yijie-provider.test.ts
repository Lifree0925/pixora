import { afterEach, describe, expect, it, vi } from "vitest";

const mockInputPng = vi.hoisted(() =>
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

vi.mock("../../lib/security/safe-fetch", () => ({
  downloadRemoteImage: vi.fn(async () => ({
    buffer: mockInputPng,
    contentType: "image/png",
    finalUrl: "https://example.com/input.png",
  })),
}));

import {
  buildEditTaskBody,
  buildGeminiNativeBody,
  buildTextTaskBody,
  extractGeminiFileReference,
  extractGeminiImage,
  extractGeminiInlineImage,
  extractOutputUrls,
  extractProviderTaskId,
  loadGeminiInlineImages,
  normalizeProviderStatus,
  parseAsyncTaskCreation,
  YijieImageProvider,
} from "./yijie-provider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("yijie provider mapping", () => {
  it("normalizes known statuses and keeps unknown explicit", () => {
    expect(normalizeProviderStatus("submitted")).toBe("queued");
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

  it("recognizes immediate success and failed submissions", () => {
    expect(
      parseAsyncTaskCreation({
        status: "succeeded",
        data: [{ url: "https://example.com/immediate.png" }],
      }),
    ).toMatchObject({
      status: "succeeded",
      outputUrls: ["https://example.com/immediate.png"],
    });

    expect(
      parseAsyncTaskCreation({
        status: "failed",
        error: { code: "invalid_request", message: "bad prompt" },
      }),
    ).toMatchObject({
      status: "failed",
      error: "bad prompt",
    });

    expect(() => parseAsyncTaskCreation({ status: "queued" })).toThrow();
  });

  it("passes official image parameters through to the upstream body", () => {
    const textBody = buildTextTaskBody({
      prompt: "hello",
      size: "1024x1024",
      model: "gpt-image-2.5-flare",
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
      model: "gpt-image-2.5-flare",
      imageUrls: ["https://example.com/a.png"],
      parameters: {
        quality: "medium",
        output_format: "webp",
      },
    });

    expect(textBody).toEqual({
      model: "gpt-image-2.5-flare",
      prompt: "hello",
      size: "1024x1024",
      quality: "high",
      background: "opaque",
      output_format: "png",
      output_compression: 90,
      moderation: "auto",
    });
    expect(editBody).toEqual({
      model: "gpt-image-2.5-flare",
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

  it("builds Gemini edit requests with inline reference images", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const images = await loadGeminiInlineImages(["https://example.com/input.png"], {
      maxBytes: 1024,
      download: async () => ({ buffer: png, contentType: "image/png" }),
    });
    const body = buildGeminiNativeBody({
      prompt: "把输入图改成二次元美少女风格",
      size: "1344x768",
      images,
    });

    expect(body.generationConfig.imageConfig.aspectRatio).toBe("16:9");
    expect(body.contents[0]?.parts[0]).toEqual({
      text: "把输入图改成二次元美少女风格",
    });
    expect(body.contents[0]?.parts[1]).toEqual({
      inlineData: { mimeType: "image/png", data: png.toString("base64") },
    });
  });

  it("rejects non-image Gemini reference payloads", async () => {
    await expect(
      loadGeminiInlineImages(["https://example.com/input.bin"], {
        maxBytes: 1024,
        download: async () => ({ buffer: Buffer.from("not an image"), contentType: "text/plain" }),
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED", retryable: false });
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

  it("returns immediate async image results without requiring a task ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "succeeded",
            data: [{ url: "https://example.com/immediate.png" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const provider = new YijieImageProvider({
      baseUrl: "https://example.com",
      apiKey: "test-key",
      model: "gpt-image-2.5-flare-优化版",
    });

    await expect(
      provider.createTextTask({ prompt: "hello", size: "1024x1024" }),
    ).resolves.toMatchObject({
      status: "succeeded",
      outputUrls: ["https://example.com/immediate.png"],
    });
  });

  it("edits Gemini natively with inline reference images", async () => {
    const outputPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: outputPng.toString("base64"),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const provider = new YijieImageProvider({
      baseUrl: "https://example.com",
      apiKey: "test-key",
      model: "gemini-nano-banana-2.1",
      apiStyle: "gemini-generate-content",
    });

    const result = await provider.createEditTask({
      prompt: "二次元美少女风格",
      size: "1024x1024",
      imageUrls: ["https://example.com/input.png"],
    });
    expect(result.inlineOutput?.mimeType).toBe("image/png");

    const fetchMock = vi.mocked(fetch);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
    };
    expect(body.contents[0]?.parts[1]).toEqual({
      inlineData: { mimeType: "image/png", data: mockInputPng.toString("base64") },
    });
  });

  it("treats task lookup 404 as a terminal provider error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "task_not_exist" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const provider = new YijieImageProvider({
      baseUrl: "https://example.com",
      apiKey: "test-key",
      model: "gr-gpt-image-2",
    });

    await expect(provider.getTask("missing")).rejects.toMatchObject({
      code: "PROVIDER_NOT_FOUND",
      retryable: false,
    });
  });
});
