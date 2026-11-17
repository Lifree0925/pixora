import { NextResponse } from "next/server";
import { getSystemStatus } from "@/modules/system/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getSystemStatus());
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "CONFIGURATION_ERROR",
          message: "系统状态读取失败，请检查服务端配置和数据库连接",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 503 },
    );
  }
}
