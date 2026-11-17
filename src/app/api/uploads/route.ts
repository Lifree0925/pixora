import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error-response";
import { uploadReferenceImage } from "@/modules/assets/upload";
import { assertSameOrigin } from "@/lib/security/origin";
import { handleApiError } from "@/lib/api/handle-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return apiError("VALIDATION_ERROR", "请通过 file 字段上传图片", 400);
    }

    const asset = await uploadReferenceImage(file);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "uploads");
  }
}
