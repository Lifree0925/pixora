import { prisma } from "@/lib/db/prisma";
import { getServerEnv, isStorageConfigured, isYijieConfigured } from "@/lib/env";

export type CheckState = "ok" | "error" | "configured" | "not_configured" | "unknown";

export interface HealthResult {
  status: "ok" | "degraded" | "error";
  checks: {
    database: CheckState;
    storage: CheckState;
    configuration: CheckState;
    worker: CheckState;
  };
  timestamp: string;
}

const WORKER_HEARTBEAT_FRESH_MS = 30_000;

export async function getHealth(): Promise<HealthResult> {
  const env = getServerEnv();

  let database: CheckState = "error";
  let worker: CheckState = "unknown";

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "ok";

    const heartbeat = await prisma.workerHeartbeat.findFirst({
      orderBy: { lastSeenAt: "desc" },
    });

    if (heartbeat && Date.now() - heartbeat.lastSeenAt.getTime() <= WORKER_HEARTBEAT_FRESH_MS) {
      worker = "ok";
    }
  } catch {
    database = "error";
    worker = "unknown";
  }

  const storage: CheckState = isStorageConfigured(env) ? "configured" : "not_configured";
  const configuration: CheckState = isYijieConfigured(env) ? "configured" : "not_configured";

  const status: HealthResult["status"] =
    database === "error"
      ? "error"
      : storage === "configured" && configuration === "configured" && worker === "ok"
        ? "ok"
        : "degraded";

  return {
    status,
    checks: { database, storage, configuration, worker },
    timestamp: new Date().toISOString(),
  };
}
