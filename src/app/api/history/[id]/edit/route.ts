import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error-response";
import { handleApiError } from "@/lib/api/handle-error";
import { assertSameOrigin } from "@/lib/security/origin";
import {
  createEditFromHistory,
  GenerationError,
} from "@/modules/generation/service";
import { historyEditSchema, idempotencyKeySchema } from "@/modules/generation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);

    const keyResult = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!keyResult.success) {
      return apiError("VALIDATION_ERROR", "缺少或无效的 Idempotency-Key", 400);
    }

    const body = await request.json().catch(() => null);
    const parsed = historyEditSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "编辑参数不合法",
        400,
      );
    }

    const { id } = await params;
    const task = await createEditFromHistory(id, parsed.data, keyResult.data);
    return NextResponse.json({ task }, { status: 202 });
  } catch (error) {
    if (error instanceof GenerationError) {
      return apiError(error.code, error.message, error.status);
    }
    return handleApiError(error, "history.edit");
  }
}
