import "dotenv/config";
import os from "node:os";
import { prisma } from "../src/lib/db/prisma";
import { getServerEnv } from "../src/lib/env";
import { processNextTask } from "./processor";

const workerId = process.env.WORKER_ID ?? `${os.hostname()}-${process.pid}`;
const version = process.env.APP_VERSION ?? "0.1.0";
const startedAt = new Date();

let stopping = false;
let heartbeatTimer: NodeJS.Timeout | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeHeartbeat(): Promise<void> {
  await prisma.workerHeartbeat.upsert({
    where: { workerId },
    create: { workerId, version, startedAt, lastSeenAt: new Date() },
    update: { version, lastSeenAt: new Date() },
  });
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  console.log(`[worker] 收到 ${signal}，正在停止`);
  await prisma.$disconnect();
  process.exit(0);
}

async function main(): Promise<void> {
  const env = getServerEnv();
  console.log(`[worker] 启动 ${workerId}，轮询间隔 ${env.WORKER_POLL_INTERVAL_MS}ms`);

  try {
    await writeHeartbeat();
  } catch (error) {
    console.error("[worker] 首次心跳失败", error instanceof Error ? error.message : error);
  }

  heartbeatTimer = setInterval(() => {
    void writeHeartbeat().catch((error: unknown) => {
      console.error("[worker] 心跳失败", error instanceof Error ? error.message : error);
    });
  }, 10_000);

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  while (!stopping) {
    try {
      const processed = await processNextTask();
      if (!processed) {
        await sleep(env.WORKER_POLL_INTERVAL_MS);
      }
    } catch (error) {
      console.error("[worker] 任务处理异常", error instanceof Error ? error.message : error);
      await sleep(env.WORKER_POLL_INTERVAL_MS);
    }
  }
}

void main().catch(async (error: unknown) => {
  console.error("[worker] 启动失败", error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
