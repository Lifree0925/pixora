import { NextResponse } from "next/server";
import { getHealth } from "@/modules/system/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await getHealth();
    return NextResponse.json(health, {
      status: health.status === "error" ? 503 : 200,
    });
  } catch {
    return NextResponse.json(
      {
        status: "error",
        checks: {
          database: "error",
          storage: "unknown",
          configuration: "error",
          worker: "unknown",
        },
        message: "健康检查失败，请查看服务端日志",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
