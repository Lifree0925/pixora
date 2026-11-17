import { getServerEnv, isStorageConfigured, isYijieConfigured } from "@/lib/env";
import {
  DEFAULT_MODEL_ID,
  findModel,
  type ModelDefinition,
} from "@/modules/models/registry";
import { getModelCapabilityVerification } from "@/modules/models/verification";
import { getHealth } from "./health";

function resolveCurrentModel(modelId: string): ModelDefinition {
  return findModel(modelId) ?? findModel(DEFAULT_MODEL_ID)!;
}

export async function getSystemStatus() {
  const env = getServerEnv();
  const health = await getHealth();
  const currentModel = resolveCurrentModel(env.YIJIE_MODEL);
  const verification = getModelCapabilityVerification(currentModel, env);

  return {
    app: {
      name: "pixora",
      version: process.env.APP_VERSION ?? "0.1.0",
      node: process.version,
      accessMode: "local",
      bindHost: env.APP_BIND_HOST,
    },
    model: {
      provider: currentModel.provider,
      id: currentModel.id,
      providerModelId: currentModel.providerModelId,
      apiKeyConfigured: isYijieConfigured(env),
      editVerified: verification.editVerified,
      multiImageEditVerified: verification.multiImageEditVerified,
    },
    storage: {
      driver: env.STORAGE_DRIVER,
      configured: isStorageConfigured(env),
      publicEndpointConfigured:
        env.STORAGE_DRIVER === "supabase"
          ? Boolean(env.SUPABASE_URL)
          : Boolean(env.S3_PUBLIC_ENDPOINT),
      bucket:
        env.STORAGE_DRIVER === "supabase"
          ? env.SUPABASE_STORAGE_BUCKET || null
          : env.S3_BUCKET || null,
    },
    limits: {
      maxUploadMb: env.MAX_UPLOAD_MB,
      maxTotalUploadMb: env.MAX_TOTAL_UPLOAD_MB,
      maxReferenceImages: env.MAX_REFERENCE_IMAGES,
      maxImagePixels: env.MAX_IMAGE_PIXELS,
      maxResultMb: env.MAX_RESULT_MB,
      promptMaxChars: env.PROMPT_MAX_CHARS,
    },
    health,
  };
}
