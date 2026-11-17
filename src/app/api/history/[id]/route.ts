import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error-response";
import { handleApiError } from "@/lib/api/handle-error";
import { assertSameOrigin } from "@/lib/security/origin";
import {
  deleteHistoryEntry,
  getHistoryConversation,
  GenerationError,
} from "@/modules/generation/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ conversation: await getHistoryConversation(id) });
  } catch (error) {
    if (error instanceof GenerationError) {
      return apiError(error.code, error.message, error.status);
    }
    return handleApiError(error, "history.detail");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    await deleteHistoryEntry(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof GenerationError) {
      return apiError(error.code, error.message, error.status);
    }
    return handleApiError(error, "history.delete");
  }
}
