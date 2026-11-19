import type {
  ImageProvider,
  ProviderInlineImage,
  ProviderParameters,
  ProviderTaskCreation,
  ProviderTaskResult,
  ProviderTaskStatus,
} from "../contracts/image-provider";
import { ProviderError } from "../contracts/image-provider";
import { downloadRemoteImage } from "../../lib/security/safe-fetch";
import { fileTypeFromBuffer } from "file-type";

export type YijieApiStyle = "async-images" | "gemini-generate-content";

const GEMINI_IMAGE_CONFIG_BY_SIZE: Record<
  string,
  { aspectRatio: string; imageSize: string }
> = {
  "1024x1024": { aspectRatio: "1:1", imageSize: "1K" },
  "1376x768": { aspectRatio: "16:9", imageSize: "1K" },
  "768x1376": { aspectRatio: "9:16", imageSize: "1K" },
  "2048x2048": { aspectRatio: "1:1", imageSize: "2K" },
};

const JSON_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

const GEMINI_INPUT_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface GeminiInlineImageInput {
  mimeType: string;
  data: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function normalizeProviderStatus(value: unknown): ProviderTaskStatus {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value.toLowerCase();
  if (["submitted", "queued", "pending", "waiting"].includes(normalized)) {
    return "queued";
  }
  if (["processing", "in_progress", "running"].includes(normalized)) {
    return "processing";
  }
  if (["succeeded", "success", "completed", "complete"].includes(normalized)) {
    return "succeeded";
  }
  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) {
    return "failed";
  }
  return "unknown";
}

export function extractProviderTaskId(value: unknown): string | undefined {
  const root = asRecord(value);
  if (!root) {
    return undefined;
  }

  const direct = asString(root.id) ?? asString(root.task_id);
  if (direct) {
    return direct;
  }

  const data = asRecord(root.data);
  return data ? (asString(data.id) ?? asString(data.task_id)) : undefined;
}

export function extractOutputUrls(value: unknown): string[] {
  const root = asRecord(value);
  if (!root || !Array.isArray(root.data)) {
    return [];
  }

  return root.data
    .map((item) => asString(asRecord(item)?.url))
    .filter((url): url is string => Boolean(url));
}

export function extractProviderError(value: unknown): string | undefined {
  const root = asRecord(value);
  if (!root) {
    return undefined;
  }

  const direct = asString(root.error) ?? asString(root.message);
  if (direct) {
    return direct;
  }

  const error = asRecord(root.error);
  return error ? (asString(error.message) ?? asString(error.code)) : undefined;
}

export function parseAsyncTaskCreation(value: unknown): ProviderTaskCreation {
  const root = asRecord(value);
  const providerTaskId = extractProviderTaskId(value);
  const status = normalizeProviderStatus(root?.status);
  const outputUrls = extractOutputUrls(value);
  const error = extractProviderError(value);

  if (status === "succeeded" && outputUrls.length > 0) {
    return { providerTaskId, status, outputUrls, error, raw: value };
  }

  if (status === "failed") {
    return { providerTaskId, status, outputUrls, error, raw: value };
  }

  if (!providerTaskId) {
    throw new ProviderError({
      code: "PROVIDER_RESPONSE_INVALID",
      message: "一阶提交响应缺少任务 ID 或可直接保存的结果 URL",
      retryable: false,
      ambiguous: true,
    });
  }

  return { providerTaskId, status, outputUrls, error, raw: value };
}

export function buildTextTaskBody(input: {
  prompt: string;
  size: string;
  model: string;
  parameters?: ProviderParameters;
}) {
  return {
    model: input.model,
    prompt: input.prompt,
    size: input.size,
    ...(input.parameters ?? {}),
  };
}

export function buildEditTaskBody(input: {
  prompt: string;
  size: string;
  model: string;
  imageUrls: string[];
  parameters?: ProviderParameters;
}) {
  return {
    model: input.model,
    prompt: input.prompt,
    size: input.size,
    image: input.imageUrls,
    ...(input.parameters ?? {}),
  };
}

export function buildGeminiNativeBody(input: {
  prompt: string;
  size: string;
  images?: GeminiInlineImageInput[];
  parameters?: ProviderParameters;
}) {
  const imageConfig = GEMINI_IMAGE_CONFIG_BY_SIZE[input.size];
  if (!imageConfig) {
    throw new ProviderError({
      code: "PROVIDER_REJECTED",
      message: `Gemini 原生图片不支持尺寸 ${input.size}`,
      retryable: false,
      ambiguous: false,
    });
  }

  const thinkingLevel = input.parameters?.thinking_level;

  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: input.prompt },
          ...(input.images ?? []).map((image) => ({
            inlineData: {
              mimeType: image.mimeType,
              data: image.data,
            },
          })),
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig,
      ...(typeof thinkingLevel === "string"
        ? { thinkingConfig: { thinkingLevel } }
        : {}),
    },
  };
}

export async function loadGeminiInlineImages(
  imageUrls: string[],
  options: {
    maxBytes: number;
    download?: (
      url: string,
      maxBytes: number,
    ) => Promise<{ buffer: Buffer; contentType?: string }>;
  },
): Promise<GeminiInlineImageInput[]> {
  const download = options.download ?? downloadRemoteImage;
  const images: GeminiInlineImageInput[] = [];

  for (const imageUrl of imageUrls) {
    const downloaded = await download(imageUrl, options.maxBytes);
    const detected = await fileTypeFromBuffer(downloaded.buffer);
    if (!detected || !GEMINI_INPUT_MIME_TYPES.has(detected.mime)) {
      throw new ProviderError({
        code: "PROVIDER_REJECTED",
        message: "Gemini 参考图必须是 PNG、JPEG 或 WebP",
        retryable: false,
        ambiguous: false,
      });
    }
    images.push({
      mimeType: detected.mime,
      data: downloaded.buffer.toString("base64"),
    });
  }

  return images;
}

function summarizeGeminiResponse(value: unknown): string {
  const root = asRecord(value);
  if (!root) {
    return "response is not an object";
  }

  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const summary = {
    keys: Object.keys(root),
    candidateCount: candidates.length,
    finishReasons: candidates.map((candidate) => asString(asRecord(candidate)?.finishReason)),
    partKeys: candidates.flatMap((candidate) => {
      const parts = asRecord(asRecord(candidate)?.content)?.parts;
      return Array.isArray(parts)
        ? parts.map((part) => Object.keys(asRecord(part) ?? {}))
        : [];
    }),
    fileDataKeys: candidates.flatMap((candidate) => {
      const parts = asRecord(asRecord(candidate)?.content)?.parts;
      if (!Array.isArray(parts)) {
        return [];
      }
      return parts
        .map((part) => asRecord(asRecord(part)?.fileData))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => Object.keys(item));
    }),
    promptFeedback: asRecord(root.promptFeedback) ?? null,
  };
  return JSON.stringify(summary).slice(0, 1200);
}

export function extractGeminiInlineImage(value: unknown): ProviderInlineImage | undefined {
  const root = asRecord(value);
  const candidates = root?.candidates;
  if (!Array.isArray(candidates)) {
    return undefined;
  }

  for (const candidate of candidates) {
    const content = asRecord(asRecord(candidate)?.content);
    const parts = content?.parts;
    if (!Array.isArray(parts)) {
      continue;
    }
    for (const part of parts) {
      const inlineData = asRecord(asRecord(part)?.inlineData);
      const data = asString(inlineData?.data);
      if (!data) {
        continue;
      }
      return {
        buffer: Buffer.from(data, "base64"),
        mimeType: asString(inlineData?.mimeType) ?? "image/png",
      };
    }
  }

  return undefined;
}

export function extractGeminiFileReference(value: unknown):
  | { fileUri: string; mimeType?: string }
  | undefined {
  const root = asRecord(value);
  const candidates = root?.candidates;
  if (!Array.isArray(candidates)) {
    return undefined;
  }

  for (const candidate of candidates) {
    const content = asRecord(asRecord(candidate)?.content);
    const parts = content?.parts;
    if (!Array.isArray(parts)) {
      continue;
    }
    for (const part of parts) {
      const fileData = asRecord(asRecord(part)?.fileData);
      const fileUri =
        asString(fileData?.fileUri) ?? asString(fileData?.uri) ?? asString(fileData?.url);
      if (fileUri) {
        return {
          fileUri,
          mimeType: asString(fileData?.mimeType),
        };
      }
    }
  }

  return undefined;
}

export async function extractGeminiImage(
  value: unknown,
  options: {
    maxBytes: number;
    download?: (
      url: string,
      maxBytes: number,
    ) => Promise<{ buffer: Buffer; contentType?: string }>;
  },
): Promise<ProviderInlineImage | undefined> {
  const inline = extractGeminiInlineImage(value);
  if (inline) {
    return inline;
  }

  const fileReference = extractGeminiFileReference(value);
  if (!fileReference) {
    return undefined;
  }

  const download =
    options.download ??
    (async (url: string, maxBytes: number) => {
      const downloaded = await downloadRemoteImage(url, maxBytes);
      return { buffer: downloaded.buffer, contentType: downloaded.contentType };
    });
  const downloaded = await download(fileReference.fileUri, options.maxBytes);
  return {
    buffer: downloaded.buffer,
    mimeType: fileReference.mimeType ?? downloaded.contentType ?? "image/jpeg",
  };
}

export class YijieImageProvider implements ImageProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly apiStyle: YijieApiStyle;
  private readonly timeoutMs: number;
  private readonly nativeTimeoutMs: number;
  private readonly nativeMaxBytes: number;

  constructor(options: {
    baseUrl: string;
    apiKey: string;
    model: string;
    apiStyle?: YijieApiStyle;
    timeoutMs?: number;
    nativeTimeoutMs?: number;
    nativeMaxBytes?: number;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.apiStyle = options.apiStyle ?? "async-images";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.nativeTimeoutMs = options.nativeTimeoutMs ?? 150_000;
    this.nativeMaxBytes = options.nativeMaxBytes ?? 50 * 1024 * 1024;
  }

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs = this.timeoutMs,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...JSON_HEADERS,
          Authorization: `Bearer ${this.apiKey}`,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new ProviderError({
        code: "PROVIDER_NETWORK_ERROR",
        message: `一阶网络请求失败: ${error instanceof Error ? error.message : "unknown"}`,
        retryable: true,
        ambiguous: true,
      });
    }

    const text = await response.text();
    let json: unknown = undefined;
    try {
      json = text ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      json = undefined;
    }

    if (!response.ok) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;
      const message = extractProviderError(json) ?? `一阶 HTTP ${response.status}`;

      if (response.status === 401 || response.status === 403) {
        throw new ProviderError({
          code: "PROVIDER_AUTH_ERROR",
          message,
          status: response.status,
          retryable: false,
          ambiguous: false,
        });
      }
      if (response.status === 429) {
        throw new ProviderError({
          code: "PROVIDER_RATE_LIMIT",
          message,
          status: response.status,
          retryable: true,
          ambiguous: false,
          retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
        });
      }
      if (response.status === 404) {
        throw new ProviderError({
          code: "PROVIDER_NOT_FOUND",
          message,
          status: response.status,
          retryable: false,
          ambiguous: false,
        });
      }
      if (response.status >= 500) {
        throw new ProviderError({
          code: "PROVIDER_SERVER_ERROR",
          message,
          status: response.status,
          retryable: true,
          ambiguous: true,
        });
      }
      throw new ProviderError({
        code: "PROVIDER_REJECTED",
        message,
        status: response.status,
        retryable: false,
        ambiguous: false,
      });
    }

    if (json === undefined) {
      throw new ProviderError({
        code: "PROVIDER_RESPONSE_INVALID",
        message: "一阶返回了非 JSON 响应",
        status: response.status,
        retryable: true,
        ambiguous: true,
      });
    }

    return json;
  }

  async createTextTask(input: {
    prompt: string;
    size: string;
    parameters?: ProviderParameters;
  }): Promise<ProviderTaskCreation> {
    if (this.apiStyle === "gemini-generate-content") {
      return this.createGeminiNativeTask(input);
    }

    const raw = await this.request("/v1/images/generations/async", {
      method: "POST",
      body: JSON.stringify(
        buildTextTaskBody({
          prompt: input.prompt,
          size: input.size,
          model: this.model,
          parameters: input.parameters,
        }),
      ),
    });
    return parseAsyncTaskCreation(raw);
  }

  async createEditTask(input: {
    prompt: string;
    size: string;
    imageUrls: string[];
    parameters?: ProviderParameters;
  }): Promise<ProviderTaskCreation> {
    if (this.apiStyle === "gemini-generate-content") {
      return this.createGeminiNativeTask(input);
    }

    const raw = await this.request("/v1/images/edits/async", {
      method: "POST",
      body: JSON.stringify(
        buildEditTaskBody({
          prompt: input.prompt,
          size: input.size,
          model: this.model,
          imageUrls: input.imageUrls,
          parameters: input.parameters,
        }),
      ),
    });
    return parseAsyncTaskCreation(raw);
  }

  private async createGeminiNativeTask(input: {
    prompt: string;
    size: string;
    imageUrls?: string[];
    parameters?: ProviderParameters;
  }): Promise<ProviderTaskCreation> {
    const images = await loadGeminiInlineImages(input.imageUrls ?? [], {
      maxBytes: this.nativeMaxBytes,
    });
    let raw: unknown;
    try {
      raw = await this.request(
        `/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: "POST",
          body: JSON.stringify(
            buildGeminiNativeBody({
              prompt: input.prompt,
              size: input.size,
              images,
              parameters: input.parameters,
            }),
          ),
        },
        this.nativeTimeoutMs,
      );
    } catch (error) {
      if (
        error instanceof ProviderError &&
        (error.message.includes("IMAGE_RECITATION") || error.message.includes("SAFETY"))
      ) {
        throw new ProviderError({
          code: "PROVIDER_CONTENT_BLOCKED",
          message: "Gemini 内容策略拒绝了这次生成，请修改提示词后重试",
          status: error.status,
          retryable: false,
          ambiguous: false,
        });
      }
      throw error;
    }
    const inlineOutput = await extractGeminiImage(raw, { maxBytes: this.nativeMaxBytes });
    if (!inlineOutput) {
      throw new ProviderError({
        code: "PROVIDER_NO_RESULT",
        message: extractProviderError(raw) ?? `Gemini 原生响应没有内联图片: ${summarizeGeminiResponse(raw)}`,
        retryable: false,
        ambiguous: false,
      });
    }

    return { raw, inlineOutput };
  }

  async getTask(providerTaskId: string): Promise<ProviderTaskResult> {
    const raw = await this.request(`/v1/images/tasks/${encodeURIComponent(providerTaskId)}`, {
      method: "GET",
    });
    const root = asRecord(raw);
    const progressValue = root?.progress;
    const progress =
      typeof progressValue === "number" && Number.isFinite(progressValue)
        ? progressValue
        : undefined;

    return {
      status: normalizeProviderStatus(root?.status),
      progress,
      outputUrls: extractOutputUrls(raw),
      error: extractProviderError(raw),
      raw,
    };
  }
}

export function createYijieProvider(
  env: {
    YIJIE_BASE_URL: string;
    YIJIE_API_KEY: string;
    YIJIE_MODEL: string;
    MAX_RESULT_MB?: number;
  },
  modelOverride?: string,
  apiStyle: YijieApiStyle = "async-images",
): ImageProvider {
  if (!env.YIJIE_API_KEY) {
    throw new ProviderError({
      code: "PROVIDER_AUTH_ERROR",
      message: "YIJIE_API_KEY 未配置",
      retryable: false,
      ambiguous: false,
    });
  }

  return new YijieImageProvider({
    baseUrl: env.YIJIE_BASE_URL,
    apiKey: env.YIJIE_API_KEY,
    model: modelOverride ?? env.YIJIE_MODEL,
    apiStyle,
    nativeMaxBytes: (env.MAX_RESULT_MB ?? 50) * 1024 * 1024,
  });
}
