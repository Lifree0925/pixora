import type { ModelDefinition } from "../modules/models/registry";
import type { ImageProvider } from "./contracts/image-provider";
import { createYijieProvider } from "./yijie/yijie-provider";

export interface ProviderEnv {
  YIJIE_BASE_URL: string;
  YIJIE_API_KEY: string;
  YIJIE_MODEL: string;
  MAX_RESULT_MB: number;
}

export function createProviderForModel(
  model: ModelDefinition,
  env: ProviderEnv,
): ImageProvider {
  if (model.provider === "yijie") {
    return createYijieProvider(env, model.providerModelId, model.apiStyle);
  }
  throw new Error(`未实现的模型 Provider: ${model.provider}`);
}
