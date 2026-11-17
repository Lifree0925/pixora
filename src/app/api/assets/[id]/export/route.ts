import sharp from "sharp";
import { AppError } from "@/lib/api/app-error";
import { handleApiError } from "@/lib/api/handle-error";
import { getServerEnv } from "@/lib/env";
import { getAssetContent } from "@/modules/assets/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LONG_EDGES = new Set([1024, 1536, 2048, 4096]);
const FORMATS = new Set(["original", "png", "jpeg", "webp"]);

type OutputFormat = "png" | "jpeg" | "webp";

const EXTENSIONS: Record<OutputFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

function formatFromMime(mimeType: string): OutputFormat {
  if (mimeType === "image/jpeg") {
    return "jpeg";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "png";
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const sizeValue = url.searchParams.get("size") ?? "original";
    const formatValue = url.searchParams.get("format") ?? "original";
    const qualityValue = Number(url.searchParams.get("quality") ?? "90");

    if (sizeValue !== "original" && !LONG_EDGES.has(Number(sizeValue))) {
      throw new AppError("VALIDATION_ERROR", "不支持的导出分辨率", 400);
    }
    if (!FORMATS.has(formatValue)) {
      throw new AppError("VALIDATION_ERROR", "不支持的导出格式", 400);
    }
    if (!Number.isFinite(qualityValue) || qualityValue < 20 || qualityValue > 100) {
      throw new AppError("VALIDATION_ERROR", "导出质量必须在 20–100 之间", 400);
    }

    const { asset, object } = await getAssetContent(id);
    const resolvedFormat: OutputFormat =
      formatValue === "original" ? formatFromMime(asset.mimeType) : (formatValue as OutputFormat);

    const source = Buffer.from(object.body);
    let pipeline = sharp(source, { failOn: "error" }).rotate();

    if (sizeValue !== "original") {
      const longEdge = Number(sizeValue);
      const sourceLongEdge = Math.max(asset.width, asset.height);
      const scale = longEdge / sourceLongEdge;
      const width = Math.max(1, Math.round(asset.width * scale));
      const height = Math.max(1, Math.round(asset.height * scale));
      const env = getServerEnv();

      if (width * height > env.MAX_IMAGE_PIXELS) {
        throw new AppError("EXPORT_TOO_LARGE", "导出尺寸超过允许的像素上限", 413);
      }

      pipeline = pipeline.resize({ width, height, fit: "fill" });
    }

    const quality = Math.round(qualityValue);
    if (resolvedFormat === "jpeg") {
      pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true });
    } else if (resolvedFormat === "webp") {
      pipeline = pipeline.webp({ quality });
    } else {
      pipeline = pipeline.png({ compressionLevel: 9 });
    }

    const output = await pipeline.toBuffer();
    const mimeType = `image/${resolvedFormat}`;
    const extension = EXTENSIONS[resolvedFormat];
    const suffix = sizeValue === "original" ? "original" : `${sizeValue}px`;

    return new Response(new Uint8Array(output), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="ai-image-${asset.id}-${suffix}.${extension}"`,
        "Content-Length": String(output.byteLength),
        "Cache-Control": "private, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error, "assets.export");
  }
}
