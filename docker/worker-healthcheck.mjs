import { PrismaClient } from "@prisma/client";

const WORKER_HEARTBEAT_FRESH_MS = 30_000;
const prisma = new PrismaClient();

async function main() {
  let healthy = false;

  try {
    const heartbeat = await prisma.workerHeartbeat.findFirst({
      orderBy: { lastSeenAt: "desc" },
    });
    healthy = Boolean(
      heartbeat &&
        Date.now() - new Date(heartbeat.lastSeenAt).getTime() <= WORKER_HEARTBEAT_FRESH_MS,
    );
  } catch {
    healthy = false;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }

  process.exitCode = healthy ? 0 : 1;
}

void main();
