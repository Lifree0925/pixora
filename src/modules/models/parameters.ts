import {
  ModelError,
  type ModelDefinition,
  type ModelParameterDefinition,
  type ModelParameterValue,
} from "./registry";

function validateValue(
  parameter: ModelParameterDefinition,
  value: ModelParameterValue,
): ModelParameterValue {
  if (parameter.type === "enum") {
    if (typeof value !== "string" || !parameter.options?.some((option) => option.value === value)) {
      throw new ModelError("INVALID_MODEL_PARAMETER", `${parameter.label} 的值不受当前模型支持`);
    }
    return value;
  }

  if (parameter.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ModelError("INVALID_MODEL_PARAMETER", `${parameter.label} 必须是数字`);
    }
    if (parameter.integer && !Number.isInteger(value)) {
      throw new ModelError("INVALID_MODEL_PARAMETER", `${parameter.label} 必须是整数`);
    }
    if (parameter.min !== undefined && value < parameter.min) {
      throw new ModelError(
        "INVALID_MODEL_PARAMETER",
        `${parameter.label} 不能小于 ${parameter.min}`,
      );
    }
    if (parameter.max !== undefined && value > parameter.max) {
      throw new ModelError(
        "INVALID_MODEL_PARAMETER",
        `${parameter.label} 不能大于 ${parameter.max}`,
      );
    }
    return value;
  }

  if (parameter.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new ModelError("INVALID_MODEL_PARAMETER", `${parameter.label} 必须是布尔值`);
    }
    return value;
  }

  if (typeof value !== "string") {
    throw new ModelError("INVALID_MODEL_PARAMETER", `${parameter.label} 必须是字符串`);
  }
  return value;
}

function validateParameterCombinations(
  model: ModelDefinition,
  explicitParameters: Record<string, ModelParameterValue>,
  normalized: Record<string, ModelParameterValue>,
): void {
  const outputFormat = normalized.output_format;
  const background = normalized.background;

  if (
    background === "transparent" &&
    outputFormat !== undefined &&
    outputFormat !== "png" &&
    outputFormat !== "webp"
  ) {
    throw new ModelError(
      "INVALID_MODEL_PARAMETER",
      "透明背景只能搭配 PNG 或 WebP 输出",
    );
  }

  if (explicitParameters.output_compression === undefined) {
    return;
  }

  const compressionDefinition = model.parameters.find(
    (parameter) => parameter.key === "output_compression",
  );
  if (
    compressionDefinition?.defaultValue !== undefined &&
    explicitParameters.output_compression === compressionDefinition.defaultValue
  ) {
    return;
  }

  if (outputFormat !== undefined && outputFormat !== "jpeg" && outputFormat !== "webp") {
    throw new ModelError(
      "INVALID_MODEL_PARAMETER",
      "压缩质量只适用于 JPEG 或 WebP 输出",
    );
  }
}

export function normalizeModelParameters(input: {
  model: ModelDefinition;
  size: string;
  parameters?: Record<string, ModelParameterValue>;
}): Record<string, ModelParameterValue> {
  const { model, size } = input;
  const parameters = input.parameters ?? {};
  const normalized: Record<string, ModelParameterValue> = {};

  for (const parameter of model.parameters) {
    if (parameter.defaultValue !== undefined) {
      normalized[parameter.key] = parameter.defaultValue;
    }
  }

  if (!model.sizes.some((option) => option.value === size)) {
    throw new ModelError("INVALID_MODEL_PARAMETER", `当前模型不支持尺寸 ${size}`);
  }
  if (parameters.size !== undefined && parameters.size !== size) {
    throw new ModelError("INVALID_MODEL_PARAMETER", "parameters.size 与顶层 size 不一致");
  }
  normalized.size = size;

  for (const [key, value] of Object.entries(parameters)) {
    if (key === "size") {
      continue;
    }
    const definition = model.parameters.find((parameter) => parameter.key === key);
    if (!definition) {
      throw new ModelError(
        "UNSUPPORTED_MODEL_PARAMETER",
        `当前模型不支持参数 ${key}，不要静默忽略`,
      );
    }
    normalized[key] = validateValue(definition, value);
  }

  for (const parameter of model.parameters) {
    if (parameter.required && normalized[parameter.key] === undefined) {
      throw new ModelError("INVALID_MODEL_PARAMETER", `缺少必填参数 ${parameter.label}`);
    }
  }

  validateParameterCombinations(model, parameters, normalized);

  return normalized;
}

export function getExtraParameterDefaults(
  model: ModelDefinition,
): Record<string, ModelParameterValue> {
  const values: Record<string, ModelParameterValue> = {};
  for (const parameter of model.parameters) {
    if (parameter.key !== "size" && parameter.defaultValue !== undefined) {
      values[parameter.key] = parameter.defaultValue;
    }
  }
  return values;
}

/**
 * 只把用户实际改动过的参数传给上游。
 * 默认值仍会保存在任务快照中供 UI 展示，但不会无条件塞进付费请求，
 * 避免当前渠道因不认识某些官方扩展字段而拒绝请求。
 */
export function getProviderParameterOverrides(
  model: ModelDefinition,
  parameters: Record<string, ModelParameterValue>,
): Record<string, ModelParameterValue> {
  const values: Record<string, ModelParameterValue> = {};

  for (const definition of model.parameters) {
    if (definition.key === "size") {
      continue;
    }
    const value = parameters[definition.key];
    if (value === undefined) {
      continue;
    }
    if (definition.defaultValue !== undefined && Object.is(value, definition.defaultValue)) {
      continue;
    }
    values[definition.key] = value;
  }

  return values;
}
