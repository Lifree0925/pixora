import { getAssetContent } from "@/modules/assets/upload";
import { handleApiError } from "@/lib/api/handle-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const { asset, object } = await getAssetContent(id);

    return new Response(object.body, {
      headers: {
        "Content-Type": object.contentType || asset.mimeType,
        "Content-Disposition": "inline",
        "Content-Length": String(asset.sizeBytes),
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
        ETag: `"${asset.sha256}"`,
      },
    });
  } catch (error) {
    return handleApiError(error, "assets.content");
  }
}
