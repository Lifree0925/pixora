import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { listModelsForApi } from "@/modules/models/registry";
import { getModelCapabilityVerification } from "@/modules/models/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const env = getServerEnv();
    const models = listModelsForApi((model) =>
      getModelCapabilityVerification(model, env),
    ).map((model) => ({
      ...model,
      limits: {
        maxReferenceImages: env.MAX_REFERENCE_IMAGES,
        maxUploadMb: env.MAX_UPLOAD_MB,
        maxTotalUploadMb: env.MAX_TOTAL_UPLOAD_MB,
        maxImagePixels: env.MAX_IMAGE_PIXELS,
        promptMaxChars: env.PROMPT_MAX_CHARS,
        supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      },
    }));

    return NextResponse.json({ models });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "CONFIGURATION_ERROR",
          message: "服务端配置不完整，请检查环境变量",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 500 },
    );
  }
}
