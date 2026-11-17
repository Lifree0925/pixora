import { handleApiError } from "@/lib/api/handle-error";
import { getAssetContent } from "@/modules/assets/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { asset, object } = await getAssetContent(id);
    const extension = EXTENSIONS[asset.mimeType] ?? "bin";

    return new Response(object.body, {
      headers: {
        "Content-Type": object.contentType || asset.mimeType,
        "Content-Disposition": `attachment; filename="ai-image-${asset.id}.${extension}"`,
        "Content-Length": String(asset.sizeBytes),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error, "assets.download");
  }
}
