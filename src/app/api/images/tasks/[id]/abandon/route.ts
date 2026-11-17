import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/error-response";
import { handleApiError } from "@/lib/api/handle-error";
import { assertSameOrigin } from "@/lib/security/origin";
import { abandonSubmitUnknownTask, GenerationError } from "@/modules/generation/service";

const bodySchema = z.object({ confirm: z.literal(true) });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", "必须确认后才能放弃任务", 400);
    }

    const { id } = await params;
    const task = await abandonSubmitUnknownTask(id, parsed.data.confirm);
    return NextResponse.json({ task });
  } catch (error) {
    if (error instanceof GenerationError) {
      return apiError(error.code, error.message, error.status);
    }
    return handleApiError(error, "images.task.abandon");
  }
}
