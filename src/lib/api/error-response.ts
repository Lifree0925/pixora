import { NextResponse } from "next/server";

export function apiError(code: string, message: string, status = 400) {
  const requestId = crypto.randomUUID();
  return NextResponse.json(
    {
      error: {
        code,
        message,
        requestId,
      },
    },
    { status, headers: { "x-request-id": requestId } },
  );
}
