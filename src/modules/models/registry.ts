export type ModelProvider = "yijie";
export type ModelParameterType = "enum" | "number" | "boolean" | "string";
export type ModelParameterValue = string | number | boolean;
export type ModelVerificationGroup =
  | "gpt-image-2"
  | "gpt-image-2-5"
  | "gemini-nano-banana-2-1";
export type ModelApiStyle = "async-images" | "gemini-generate-content";

export interface ModelParameterOption {
  label: string;
  value: string;
}

export interface ModelParameterDefinition {
  key: string;
  label: string;
  type: ModelParameterType;
  group?: string;
  required?: boolean;
  defaultValue?: ModelParameterValue;
  options?: ModelParameterOption[];
  min?: number;
  max?: number;
  step?: number;
  help?: string;
}

export interface ModelDefinition {
  id: string;
  name: string;
  provider: ModelProvider;
  providerModelId: string;
  verificationGroup: ModelVerificationGroup;
  apiStyle: ModelApiStyle;
  enabled: boolean;
  capabilities: {
    textToImage: boolean;
    imageEdit: boolean;
    multiImageEdit: boolean;
  };
  sizes: ModelParameterOption[];
  parameters: ModelParameterDefinition[];
}

export interface ModelVerification {
  editVerified: boolean;
  multiImageEditVerified: boolean;
}

export type ModelVerificationResolver = (model: ModelDefinition) => ModelVerification;

export class ModelError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelError";
    this.code = code;
  }
}

export const DEFAULT_MODEL_ID = "gr-gpt-image-2";

const GPT_IMAGE_2_SIZES: ModelParameterOption[] = [
  { label: "正方形（1K）", value: "1024x1024" },
  { label: "横版（3:2）", value: "1536x1024" },
  { label: "竖版（2:3）", value: "1024x1536" },
];

const GPT_IMAGE_2_5_SIZES: ModelParameterOption[] = [
  { label: "1K 正方形", value: "1024x1024" },
  { label: "1K 横版", value: "1536x1024" },
  { label: "1K 竖版", value: "1024x1536" },
  { label: "2K 正方形", value: "2048x2048" },
  { label: "2K 横版", value: "2016x1344" },
  { label: "2K 竖版", value: "1344x2016" },
  { label: "4K 正方形", value: "2880x2880" },
  { label: "4K 横版", value: "3504x2336" },
  { label: "4K 竖版", value: "2336x3504" },
];

const GEMINI_NANO_BANANA_SIZES: ModelParameterOption[] = [
  { label: "1K 正方形", value: "1024x1024" },
  { label: "1K 横版（3:2）", value: "1248x832" },
  { label: "1K 竖版（2:3）", value: "832x1248" },
  { label: "1K 宽屏（16:9）", value: "1344x768" },
  { label: "1K 竖屏（9:16）", value: "768x1344" },
];

function createSizeParameter(
  options: ModelParameterOption[],
  defaultValue: string,
  help: string,
): ModelParameterDefinition {
  return {
    key: "size",
    label: "画面尺寸",
    type: "enum",
    group: "画面",
    required: true,
    defaultValue,
    options,
    help,
  };
}

function createQualityParameter(
  values: Array<{ label: string; value: string }>,
  help: string,
): ModelParameterDefinition {
  return {
    key: "quality",
    label: "生成质量",
    type: "enum",
    group: "画面",
    defaultValue: "auto",
    options: values,
    help,
  };
}

const GPT_IMAGE_2_PARAMETERS: ModelParameterDefinition[] = [
  createSizeParameter(
    GPT_IMAGE_2_SIZES,
    "1024x1024",
    "GPT Image 2 支持标准尺寸和自定义尺寸；1024x1024 请求实测可能返回 1254x1254，实际输出像素以结果文件为准。",
  ),
  createQualityParameter(
    [
      { label: "自动", value: "auto" },
      { label: "低", value: "low" },
      { label: "中", value: "medium" },
      { label: "高", value: "high" },
    ],
    "GPT Image 2 不支持 xhigh 和 max；最终档位仍以当前渠道实际承接情况为准。",
  ),
  {
    key: "background",
    label: "背景",
    type: "enum",
    group: "画面",
    defaultValue: "auto",
    options: [
      { label: "自动", value: "auto" },
      { label: "不透明", value: "opaque" },
    ],
    help: "官方文档把 GPT Image 2 的透明背景标为预览能力；当前渠道未验证前只开放 auto/opaque。",
  },
  {
    key: "output_format",
    label: "输出格式",
    type: "enum",
    group: "输出",
    defaultValue: "png",
    options: [
      { label: "PNG", value: "png" },
      { label: "JPEG", value: "jpeg" },
      { label: "WebP", value: "webp" },
    ],
    help: "所选格式会随请求发送；当前渠道若固定返回其他格式，以实际文件 MIME 为准。",
  },
  {
    key: "output_compression",
    label: "压缩质量",
    type: "number",
    group: "输出",
    defaultValue: 100,
    min: 0,
    max: 100,
    step: 1,
    help: "仅 JPEG / WebP 有意义，0–100，数值越高文件越大。",
  },
  {
    key: "moderation",
    label: "内容审核",
    type: "enum",
    group: "高级",
    defaultValue: "auto",
    options: [
      { label: "自动", value: "auto" },
      { label: "宽松", value: "low" },
    ],
    help: "官方参数值；实际审核规则仍以当前渠道为准。",
  },
];

const GPT_IMAGE_2_5_PARAMETERS: ModelParameterDefinition[] = [
  createSizeParameter(
    GPT_IMAGE_2_5_SIZES,
    "1024x1024",
    "GPT Image 2.5 支持 1K/2K/4K 预设；宽高需为 16 的倍数、宽高比 1:3–3:1、最长边不超过 3840。超过 2560x1440 为官方实验档，4K 可能计入更高费用。",
  ),
  createQualityParameter(
    [
      { label: "自动", value: "auto" },
      { label: "低", value: "low" },
      { label: "中", value: "medium" },
      { label: "高", value: "high" },
      { label: "超高", value: "xhigh" },
      { label: "最大", value: "max" },
    ],
    "2.5 在 low/medium/high 之外新增 xhigh/max；xhigh、max 和 4K 可能进入更高计费档。",
  ),
  {
    key: "complexity",
    label: "规划复杂度",
    type: "enum",
    group: "画面",
    defaultValue: "high",
    options: [
      { label: "低", value: "low" },
      { label: "中", value: "medium" },
      { label: "高", value: "high" },
    ],
    help: "控制生成前的规划深度，不直接改变渲染分辨率；一阶文档标注默认 high。",
  },
  {
    key: "background",
    label: "背景",
    type: "enum",
    group: "画面",
    defaultValue: "auto",
    options: [
      { label: "自动", value: "auto" },
      { label: "不透明", value: "opaque" },
      { label: "透明", value: "transparent" },
    ],
    help: "透明背景必须搭配 PNG 或 WebP；JPEG 不能使用 transparent。",
  },
  {
    key: "output_format",
    label: "输出格式",
    type: "enum",
    group: "输出",
    defaultValue: "png",
    options: [
      { label: "PNG", value: "png" },
      { label: "JPEG", value: "jpeg" },
      { label: "WebP", value: "webp" },
    ],
    help: "GPT Image 2.5 支持 PNG / JPEG / WebP；GIF、SVG 属于 2.6 能力，当前不开放。",
  },
  {
    key: "output_compression",
    label: "压缩质量",
    type: "number",
    group: "输出",
    defaultValue: 100,
    min: 0,
    max: 100,
    step: 1,
    help: "仅 JPEG / WebP 有意义；PNG 不使用压缩质量参数。",
  },
  {
    key: "moderation",
    label: "内容审核",
    type: "enum",
    group: "高级",
    defaultValue: "auto",
    options: [
      { label: "自动", value: "auto" },
      { label: "宽松", value: "low" },
    ],
    help: "官方参数值；实际审核规则仍以当前渠道为准。",
  },
];

const GEMINI_NANO_BANANA_PARAMETERS: ModelParameterDefinition[] = [
  createSizeParameter(
    GEMINI_NANO_BANANA_SIZES,
    "1024x1024",
    "Gemini 官方用宽高比和分辨率描述输出；当前通过一阶 size 传递 1K 常用画幅，映射是否生效需真实接口验证。",
  ),
];

export const MODEL_REGISTRY: ModelDefinition[] = [
  {
    id: "gr-gpt-image-2",
    name: "GPT Image 2.0",
    provider: "yijie",
    providerModelId: "gr-gpt-image-2",
    verificationGroup: "gpt-image-2",
    apiStyle: "async-images",
    enabled: true,
    capabilities: {
      textToImage: true,
      imageEdit: true,
      multiImageEdit: true,
    },
    sizes: GPT_IMAGE_2_SIZES,
    parameters: GPT_IMAGE_2_PARAMETERS,
  },
  {
    id: "gpt-image-2.5-flare",
    name: "GPT Image 2.5 Flare",
    provider: "yijie",
    providerModelId: "gpt-image-2.5-flare-优化版",
    verificationGroup: "gpt-image-2-5",
    apiStyle: "async-images",
    enabled: true,
    capabilities: {
      textToImage: true,
      imageEdit: true,
      multiImageEdit: true,
    },
    sizes: GPT_IMAGE_2_5_SIZES,
    parameters: GPT_IMAGE_2_5_PARAMETERS,
  },
  {
    id: "gpt-image-2.5-sunburst",
    name: "GPT Image 2.5 Sunburst",
    provider: "yijie",
    providerModelId: "gpt-image-2.5-sunburst-优化版",
    verificationGroup: "gpt-image-2-5",
    apiStyle: "async-images",
    enabled: true,
    capabilities: {
      textToImage: true,
      imageEdit: true,
      multiImageEdit: true,
    },
    sizes: GPT_IMAGE_2_5_SIZES,
    parameters: GPT_IMAGE_2_5_PARAMETERS,
  },
  {
    id: "gemini-nano-banana-2.1",
    name: "Gemini Nano Banana 2.1",
    provider: "yijie",
    providerModelId: "gemini-nano-banana-2.1",
    verificationGroup: "gemini-nano-banana-2-1",
    apiStyle: "gemini-generate-content",
    enabled: true,
    capabilities: {
      textToImage: true,
      imageEdit: true,
      multiImageEdit: true,
    },
    sizes: GEMINI_NANO_BANANA_SIZES,
    parameters: GEMINI_NANO_BANANA_PARAMETERS,
  },
];

export function findModel(modelId?: string): ModelDefinition | undefined {
  const id = modelId?.trim() || process.env.YIJIE_MODEL?.trim() || DEFAULT_MODEL_ID;
  return MODEL_REGISTRY.find((model) => model.id === id || model.providerModelId === id);
}

export function getModelDefinition(modelId?: string): ModelDefinition {
  const model = findModel(modelId);
  if (!model || !model.enabled) {
    throw new ModelError("MODEL_NOT_FOUND", `模型不存在或未启用: ${modelId ?? "default"}`);
  }
  return model;
}

export function listModelsForApi(resolveVerification: ModelVerificationResolver) {
  return MODEL_REGISTRY.filter((model) => model.enabled).map((model) => {
    const verification = resolveVerification(model);
    const editOk = !model.capabilities.imageEdit || verification.editVerified;
    const multiOk = !model.capabilities.multiImageEdit || verification.multiImageEditVerified;

    return {
      ...model,
      verificationGroup: undefined,
      verified: model.capabilities.textToImage && editOk && multiOk,
      capabilities: {
        textToImage: model.capabilities.textToImage,
        imageEdit: model.capabilities.imageEdit && verification.editVerified,
        multiImageEdit: model.capabilities.multiImageEdit && verification.multiImageEditVerified,
      },
    };
  });
}

export function getModelName(modelId: string): string {
  return findModel(modelId)?.name ?? modelId;
}
