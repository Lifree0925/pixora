import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { downloadRemoteImage } from "../src/lib/security/safe-fetch";
import {
  DEFAULT_MODEL_ID,
  getModelDefinition,
  type ModelParameterValue,
} from "../src/modules/models/registry";
import {
  getProviderParameterOverrides,
  normalizeModelParameters,
} from "../src/modules/models/parameters";
import {
  buildGeminiNativeBody,
  extractGeminiImage,
  loadGeminiInlineImages,
} from "../src/providers/yijie/yijie-provider";

type ProbeMode = "text" | "edit" | "multi";

interface Options {
  mode: ProbeMode;
  modelId?: string;
  size?: string;
  prompt: string;
  imageUrls: string[];
  parameterOverrides: Record<string, ModelParameterValue>;
  confirm: boolean;
  writeFixtures: boolean;
  assetsFile?: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    mode: "text",
    prompt: "A simple red circle centered on a white background",
    imageUrls: [],
    parameterOverrides: {},
    confirm: false,
    writeFixtures: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--confirm") {
      options.confirm = true;
    } else if (arg === "--write-fixtures") {
      options.writeFixtures = true;
    } else if (arg === "--mode" || arg.startsWith("--mode=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : argv[++index];
      if (value !== "text" && value !== "edit" && value !== "multi") {
        throw new Error("--mode 只支持 text、edit、multi");
      }
      options.mode = value;
    } else if (arg === "--model" || arg.startsWith("--model=")) {
      options.modelId = arg.includes("=") ? arg.split("=")[1] : argv[++index];
      if (!options.modelId) {
        throw new Error("--model 不能为空");
      }
    } else if (arg === "--size" || arg.startsWith("--size=")) {
      options.size = arg.includes("=") ? arg.split("=")[1] : argv[++index];
      if (!options.size) {
        throw new Error("--size 不能为空");
      }
    } else if (arg === "--quality" || arg.startsWith("--quality=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : argv[++index];
      if (!value) {
        throw new Error("--quality 不能为空");
      }
      options.parameterOverrides.quality = value;
    } else if (arg === "--complexity" || arg.startsWith("--complexity=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : argv[++index];
      if (!value) {
        throw new Error("--complexity 不能为空");
      }
      options.parameterOverrides.complexity = value;
    } else if (arg === "--background" || arg.startsWith("--background=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : argv[++index];
      if (!value) {
        throw new Error("--background 不能为空");
      }
      options.parameterOverrides.background = value;
    } else if (arg === "--output-format" || arg.startsWith("--output-format=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : argv[++index];
      if (!value) {
        throw new Error("--output-format 不能为空");
      }
      options.parameterOverrides.output_format = value;
    } else if (arg === "--prompt" || arg.startsWith("--prompt=")) {
      options.prompt = arg.includes("=") ? arg.split("=").slice(1).join("=") : argv[++index];
    } else if (arg === "--image-url" || arg.startsWith("--image-url=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : argv[++index];
      if (!value) {
        throw new Error("--image-url 不能为空");
      }
      options.imageUrls.push(value);
    } else if (arg === "--assets-file" || arg.startsWith("--assets-file=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : argv[++index];
      if (!value) {
        throw new Error("--assets-file 不能为空");
      }
      options.assetsFile = value;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  if (!options.prompt?.trim()) {
    throw new Error("--prompt 不能为空");
  }

  return options;
}

async function loadAssetUrls(options: Options): Promise<void> {
  if (!options.assetsFile) {
    return;
  }

  const content = await readFile(options.assetsFile, "utf8");
  const parsed = JSON.parse(content) as
    | { urls?: unknown[]; a?: { url?: string }; b?: { url?: string } }
    | unknown[];
  const values = Array.isArray(parsed)
    ? parsed
    : [
        ...(Array.isArray(parsed.urls) ? parsed.urls : []),
        parsed.a?.url,
        parsed.b?.url,
      ];
  const urls = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  options.imageUrls.push(...(options.mode === "edit" ? urls.slice(0, 1) : urls));
}

function validateOptions(options: Options): void {
  if (options.mode === "edit" && options.imageUrls.length !== 1) {
    throw new Error("edit 模式需要且只需要一个图片 URL（--image-url 或 --assets-file）");
  }
  if (options.mode === "multi" && options.imageUrls.length < 2) {
    throw new Error("multi 模式至少需要两个图片 URL（--image-url 或 --assets-file）");
  }
  if (options.mode === "text" && options.imageUrls.length > 0) {
    throw new Error("text 模式不接受图片 URL");
  }
}

function printHelp(): void {
  console.log(`Phase 0.5 一阶契约探测

用法:
  pnpm verify:yijie --mode text --model gpt-image-2.5-flare
  pnpm verify:yijie --mode text --model gemini-nano-banana-2.1
  pnpm verify:yijie --mode text --model gpt-image-2.5-sunburst --quality xhigh --complexity high --size 2048x2048
  pnpm verify:yijie --mode edit --model gpt-image-2.5-flare --assets-file /tmp/probe-assets.json --confirm --write-fixtures
  pnpm verify:yijie --mode multi --model gemini-nano-banana-2.1 --assets-file /tmp/probe-assets.json --confirm

可选参数:
  --model <id>            模型内部 ID 或 providerModelId；默认读取 YIJIE_MODEL
  --size <WxH>            必须属于该模型的 registry sizes
  --quality <value>       auto/low/medium/high/xhigh/max，按模型校验
  --complexity <value>    low/medium/high，仅 2.5 支持
  --background <value>    auto/opaque/transparent，按模型校验
  --output-format <value> png/jpeg/webp，按模型校验

默认 dry-run，不会发送付费请求；只有 --confirm 才会调用真实接口。
`);
}

function getConfig() {
  return {
    baseUrl: (process.env.YIJIE_BASE_URL ?? "https://yijieapi.com").replace(/\/+$/, ""),
    apiKey: process.env.YIJIE_API_KEY?.trim() ?? "",
  };
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const field = record[key];
  return typeof field === "string" ? field : undefined;
}

function getRecordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return field && typeof field === "object" ? (field as Record<string, unknown>) : undefined;
}

function extractTaskId(value: unknown): string | undefined {
  const direct = getStringField(value, "id") ?? getStringField(value, "task_id");
  if (direct) {
    return direct;
  }
  const data = getRecordField(value, "data");
  return data ? getStringField(data, "id") ?? getStringField(data, "task_id") : undefined;
}

function extractOutputUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data) || data.length === 0) {
    return undefined;
  }
  return getStringField(data[0], "url");
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === "string" && /^https?:\/\//i.test(item) ? "<redacted-url>" : sanitize(item),
    );
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "url" && typeof field === "string") {
      result[key] = "<redacted-url>";
    } else if (lowerKey === "b64_json" && typeof field === "string") {
      result[key] = `<redacted-b64-json:${field.length} chars>`;
    } else if (lowerKey === "data" && typeof field === "string") {
      result[key] = `<redacted-base64:${field.length} chars>`;
    } else if (lowerKey === "thoughtsignature" && typeof field === "string") {
      result[key] = `<redacted-signature:${field.length} chars>`;
    } else if (["authorization", "api_key", "apikey"].includes(lowerKey)) {
      result[key] = "<redacted>";
    } else {
      result[key] = sanitize(field);
    }
  }
  return result;
}

async function saveFixture(name: string, value: unknown): Promise<void> {
  const dir = path.join("tests", "fixtures", "yijie");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${name}.json`),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), response: sanitize(value) }, null, 2)}\n`,
    "utf8",
  );
  console.log(`[probe] 已写入脱敏 fixture: tests/fixtures/yijie/${name}.json`);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { nonJsonBody: text.slice(0, 500) };
  }
}

async function inspectResultUrl(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { buffer, contentType } = await downloadRemoteImage(url, 50 * 1024 * 1024);
      const firstBytes = buffer.subarray(0, 8).toString("hex");
      console.log(
        `[probe] 结果 URL: content-type=${contentType}, bytes=${buffer.byteLength}, first8=${firstBytes}`,
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
      }
    }
  }
  throw lastError;
}

function modelSlug(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await loadAssetUrls(options);
  validateOptions(options);

  const model = getModelDefinition(options.modelId ?? process.env.YIJIE_MODEL ?? DEFAULT_MODEL_ID);
  const selectedSize =
    options.size ??
    model.parameters.find((parameter) => parameter.key === "size")?.defaultValue ??
    model.sizes[0]?.value;
  if (typeof selectedSize !== "string") {
    throw new Error("模型没有可用的默认尺寸");
  }

  const normalized = normalizeModelParameters({
    model,
    size: selectedSize,
    parameters: options.parameterOverrides,
  });
  const providerParameters = getProviderParameterOverrides(model, normalized);
  const isGeminiNative = model.apiStyle === "gemini-generate-content";

  const endpoint = isGeminiNative
    ? `/v1beta/models/${encodeURIComponent(model.providerModelId)}:generateContent`
    : options.mode === "text"
      ? "/v1/images/generations/async"
      : "/v1/images/edits/async";
  const geminiImages = isGeminiNative
    ? await loadGeminiInlineImages(options.imageUrls, { maxBytes: 50 * 1024 * 1024 })
    : [];
  const body: Record<string, unknown> = isGeminiNative
    ? buildGeminiNativeBody({
        prompt: options.prompt,
        size: selectedSize,
        images: geminiImages,
      })
    : {
        model: model.providerModelId,
        prompt: options.prompt,
        size: selectedSize,
        ...providerParameters,
      };
  if (!isGeminiNative && options.mode !== "text") {
    body.image = options.imageUrls;
  }

  const config = getConfig();
  if (!options.confirm) {
    console.log("[probe] dry-run：不会发送付费请求。");
    console.log(
      JSON.stringify(
        {
          endpoint,
          body: sanitize(body),
          imageUrlCount: options.imageUrls.length,
        },
        null,
        2,
      ),
    );
    console.log("[probe] 确认费用后追加 --confirm。");
    return;
  }

  if (!config.apiKey) {
    throw new Error("YIJIE_API_KEY 未配置，不能发送真实请求");
  }

  if (isGeminiNative) {
    console.log(`[probe] 提交 Gemini 原生 ${options.mode} 请求到 ${endpoint}`);
    const response = await fetch(`${config.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const json = await readJson(response);
    if (options.writeFixtures) {
      await saveFixture(`${modelSlug(model.id)}-${options.mode}-native`, json);
    }
    if (!response.ok) {
      console.error(`[probe] Gemini 原生请求失败 HTTP ${response.status}`);
      console.error(JSON.stringify(sanitize(json), null, 2));
      process.exitCode = 1;
      return;
    }
    const inline = await extractGeminiImage(json, {
      maxBytes: 50 * 1024 * 1024,
    });
    if (!inline) {
      console.error("[probe] Gemini 原生响应没有 inlineData 图片");
      console.error(JSON.stringify(sanitize(json), null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(
      `[probe] Gemini 原生图片: mime=${inline.mimeType}, bytes=${inline.buffer.byteLength}`,
    );
    return;
  }

  console.log(`[probe] 提交 ${options.mode} 请求到 ${endpoint}`);
  const createResponse = await fetch(`${config.baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const createJson = await readJson(createResponse);

  if (options.writeFixtures) {
    await saveFixture(`${modelSlug(model.id)}-${options.mode}-create`, createJson);
  }

  if (!createResponse.ok) {
    console.error(`[probe] 提交失败 HTTP ${createResponse.status}`);
    console.error(JSON.stringify(sanitize(createJson), null, 2));
    process.exitCode = 1;
    return;
  }

  const taskId = extractTaskId(createJson);
  if (!taskId) {
    console.error("[probe] 未从提交响应中识别到任务 ID");
    console.error(JSON.stringify(sanitize(createJson), null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(`[probe] 任务 ID: ${taskId}`);
  const maxSeconds = Number(process.env.TASK_POLL_MAX_SECONDS ?? "180");
  const deadline = Date.now() + Math.max(30, Math.min(maxSeconds, 900)) * 1000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));

    const taskResponse = await fetch(
      `${config.baseUrl}/v1/images/tasks/${encodeURIComponent(taskId)}`,
      {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    const taskJson = await readJson(taskResponse);
    if (options.writeFixtures) {
      await saveFixture(`${modelSlug(model.id)}-${options.mode}-task`, taskJson);
    }

    if (!taskResponse.ok) {
      console.log(`[probe] 查询失败 HTTP ${taskResponse.status}，继续轮询`);
      continue;
    }

    const status = getStringField(taskJson, "status") ?? "unknown";
    console.log(`[probe] status=${status}`);

    if (status === "succeeded" || status === "success") {
      const outputUrl = extractOutputUrl(taskJson);
      if (outputUrl) {
        await inspectResultUrl(outputUrl);
      } else {
        console.log("[probe] 成功响应中没有 data[0].url；请检查是否返回 b64_json。");
      }
      console.log("[probe] 探测成功；请把真实响应结构写回开发文档。");
      return;
    }

    if (status === "failed" || status === "error") {
      console.error("[probe] 上游任务失败");
      console.error(JSON.stringify(sanitize(taskJson), null, 2));
      process.exitCode = 1;
      return;
    }
  }

  console.error("[probe] 轮询超时；上游可能仍在处理。");
  process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error("[probe] 失败", error instanceof Error ? error.message : error);
  process.exit(1);
});
