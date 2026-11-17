import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/handle-error";
import { listHistory } from "@/modules/generation/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitValue = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitValue) ? Math.floor(limitValue) : 20;
    const cursor = url.searchParams.get("cursor") ?? undefined;
    return NextResponse.json(await listHistory({ limit, cursor }));
  } catch (error) {
    return handleApiError(error, "history.list");
  }
}
