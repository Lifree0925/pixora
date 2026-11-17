import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error-response";
import { handleApiError } from "@/lib/api/handle-error";
import { assertSameOrigin } from "@/lib/security/origin";
import { resumeTask, GenerationError } from "@/modules/generation/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const task = await resumeTask(id);
    return NextResponse.json({ task });
  } catch (error) {
    if (error instanceof GenerationError) {
      return apiError(error.code, error.message, error.status);
    }
    return handleApiError(error, "images.task.resume");
  }
}
