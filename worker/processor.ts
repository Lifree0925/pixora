import { prisma } from "../src/lib/db/prisma";
import { getServerEnv } from "../src/lib/env";
import { downloadRemoteImage } from "../src/lib/security/safe-fetch";
import { storeGeneratedImage } from "../src/lib/storage/generated-image";
import { getStorage } from "../src/lib/storage";
import { AppError } from "../src/lib/api/app-error";
import { ProviderError } from "../src/providers/contracts/image-provider";
import { createProviderForModel } from "../src/providers";
import { getModelDefinition, ModelError } from "../src/modules/models/registry";
import { getProviderParameterOverrides } from "../src/modules/models/parameters";
import type { ModelParameterValue } from "../src/modules/models/registry";

const env = getServerEnv();

function readSnapshotParameters(snapshot: unknown): Record<string, ModelParameterValue> {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {};
  }
  const parameters = (snapshot as Record<string, unknown>).parameters;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    return {};
  }
  return parameters as Record<string, ModelParameterValue>;
}

type ClaimedTask =
  { type: "submit"; id: string } | { type: "poll"; id: string } | { type: "recovered"; id: string };

function truncateMessage(message: string | undefined): string | undefined {
  return message ? message.slice(0, 1000) : undefined;
}

function computeNextDelaySeconds(attempts: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds, env.TASK_POLL_MAX_INTERVAL_SECONDS);
  }
  const base = env.TASK_POLL_MIN_SECONDS * 2 ** Math.min(Math.max(attempts, 0), 5);
  return Math.min(base, env.TASK_POLL_MAX_INTERVAL_SECONDS);
}

function nextPollAt(attempts: number, retryAfterSeconds?: number): Date {
  return new Date(Date.now() + computeNextDelaySeconds(attempts, retryAfterSeconds) * 1000);
}

async function markFailed(
  taskId: string,
  code: string,
  message?: string,
  providerTaskId?: string,
): Promise<void> {
  await prisma.generationTask.update({
    where: { id: taskId },
    data: {
      status: "failed",
      ...(providerTaskId ? { providerTaskId } : {}),
      errorCode: code,
      errorMessage: truncateMessage(message) ?? code,
      completedAt: new Date(),
      nextPollAt: null,
      leaseUntil: null,
    },
  });
}

async function markSubmitUnknown(taskId: string, message?: string): Promise<void> {
  await prisma.generationTask.update({
    where: { id: taskId },
    data: {
      status: "submit_unknown",
      errorCode: "SUBMIT_UNKNOWN",
      errorMessage: truncateMessage(message) ?? "提交结果未知，请先核对上游是否创建任务",
      nextPollAt: null,
      leaseUntil: null,
    },
  });
}

async function scheduleRetry(
  taskId: string,
  attempts: number,
  code: string,
  message?: string,
  retryAfterSeconds?: number,
): Promise<void> {
  await prisma.generationTask.update({
    where: { id: taskId },
    data: {
      status: "processing",
      providerRawStatus: "retry_scheduled",
      errorCode: code,
      errorMessage: truncateMessage(message),
      pollAttempts: { increment: 1 },
      nextPollAt: nextPollAt(attempts, retryAfterSeconds),
      leaseUntil: null,
    },
  });
}

async function markTimedOut(taskId: string): Promise<void> {
  await prisma.generationTask.update({
    where: { id: taskId },
    data: {
      status: "timed_out",
      providerRawStatus: "local_timeout",
      errorCode: "PROVIDER_TIMEOUT",
      errorMessage: "本地等待超时，上游可能仍在处理，可继续查询",
      nextPollAt: null,
      leaseUntil: null,
    },
  });
}

async function completeTaskWithBuffer(
  taskId: string,
  buffer: Buffer,
  submittedAt?: Date,
  providerTaskId?: string,
): Promise<void> {
  const generated = await storeGeneratedImage(buffer);

  try {
    await prisma.$transaction([
      prisma.taskAsset.create({
        data: {
          taskId,
          assetId: generated.id,
          relation: "output",
          sortOrder: 0,
        },
      }),
      prisma.generationTask.update({
        where: { id: taskId },
        data: {
          status: "succeeded",
          providerRawStatus: "succeeded",
          ...(providerTaskId ? { providerTaskId } : {}),
          submittedAt,
          completedAt: new Date(),
          nextPollAt: null,
          leaseUntil: null,
          errorCode: null,
          errorMessage: null,
        },
      }),
    ]);
  } catch (error) {
    await prisma.imageAsset.update({
      where: { id: generated.id },
      data: { deletedAt: new Date() },
    });
    throw error;
  }
}

async function claimNextTask(): Promise<ClaimedTask | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status::text AS status
      FROM "GenerationTask"
      WHERE "deletedAt" IS NULL
        AND (
          ("status"::text = 'pending' AND ("nextPollAt" IS NULL OR "nextPollAt" <= NOW()) AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW()))
          OR ("status"::text = 'processing' AND ("nextPollAt" IS NULL OR "nextPollAt" <= NOW()) AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW()))
          OR ("status"::text = 'submitting' AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW()))
        )
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    const row = rows[0];
    if (!row) {
      return null;
    }

    const now = new Date();
    const leaseUntil = new Date(now.getTime() + env.TASK_LEASE_SECONDS * 1000);

    if (row.status === "submitting") {
      await tx.generationTask.update({
        where: { id: row.id },
        data: {
          status: "submit_unknown",
          errorCode: "SUBMIT_UNKNOWN",
          errorMessage: "worker 在提交阶段中断，提交结果未知",
          nextPollAt: null,
          leaseUntil: null,
        },
      });
      return { type: "recovered", id: row.id };
    }

    if (row.status === "pending") {
      await tx.generationTask.update({
        where: { id: row.id },
        data: {
          status: "submitting",
          submissionStartedAt: now,
          leaseUntil,
        },
      });
      return { type: "submit", id: row.id };
    }

    await tx.generationTask.update({
      where: { id: row.id },
      data: { leaseUntil },
    });
    return { type: "poll", id: row.id };
  });
}

async function submitTask(taskId: string): Promise<void> {
  const task = await prisma.generationTask.findFirst({
    where: { id: taskId, deletedAt: null },
    include: {
      assets: {
        where: { relation: "input" },
        include: { asset: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!task) {
    return;
  }

  try {
    const model = getModelDefinition(task.model);
    const taskProvider = createProviderForModel(model, env);
    const imageUrls: string[] = [];
    for (const item of task.assets) {
      if (!item.asset || item.asset.deletedAt) {
        throw new AppError("ASSET_NOT_FOUND", "参考图不存在", 404);
      }
      imageUrls.push(
        await getStorage().createSignedUrl(
          item.asset.storageKey,
          env.SUPABASE_SIGNED_URL_EXPIRES_SECONDS,
        ),
      );
    }

    if (model.apiStyle === "gemini-generate-content") {
      await prisma.generationTask.update({
        where: { id: task.id },
        data: { leaseUntil: new Date(Date.now() + 180_000) },
      });
    }

    const result =
      task.mode === "text_to_image"
        ? await taskProvider.createTextTask({
            prompt: task.prompt,
            size: task.size,
            parameters: getProviderParameterOverrides(
              model,
              readSnapshotParameters(task.requestSnapshot),
            ),
          })
        : await taskProvider.createEditTask({
            prompt: task.prompt,
            size: task.size,
            imageUrls,
            parameters: getProviderParameterOverrides(
              model,
              readSnapshotParameters(task.requestSnapshot),
            ),
          });

    if (result.inlineOutput) {
      try {
        await completeTaskWithBuffer(task.id, result.inlineOutput.buffer, new Date());
      } catch (error) {
        await markFailed(
          task.id,
          error instanceof AppError ? error.code : "STORAGE_FAILED",
          error instanceof Error ? error.message : "保存生成结果失败",
        );
      }
      return;
    }

    if (result.status === "failed") {
      await markFailed(
        task.id,
        "PROVIDER_TASK_FAILED",
        result.error ?? "上游提交阶段返回失败",
        result.providerTaskId,
      );
      return;
    }

    if (result.outputUrls && result.outputUrls.length > 0) {
      const downloaded = await downloadRemoteImage(
        result.outputUrls[0],
        env.MAX_RESULT_MB * 1024 * 1024,
      );
      await completeTaskWithBuffer(task.id, downloaded.buffer, new Date(), result.providerTaskId);
      return;
    }

    if (!result.providerTaskId) {
      throw new ProviderError({
        code: "PROVIDER_RESPONSE_INVALID",
        message: "一阶提交响应缺少任务 ID 或可直接保存的结果 URL",
        retryable: false,
        ambiguous: true,
      });
    }

    const now = new Date();
    await prisma.generationTask.update({
      where: { id: task.id },
      data: {
        status: "processing",
        providerTaskId: result.providerTaskId,
        submittedAt: now,
        pollWindowStartedAt: now,
        nextPollAt: now,
        leaseUntil: null,
        providerRawStatus: result.status === "unknown" ? "submitted" : result.status,
        errorCode: null,
        errorMessage: null,
      },
    });
  } catch (error) {
    if (error instanceof ModelError) {
      await markFailed(task.id, error.code, error.message);
      return;
    }

    if (error instanceof AppError) {
      await markFailed(task.id, error.code, error.message);
      return;
    }

    if (error instanceof ProviderError) {
      if (error.ambiguous) {
        await markSubmitUnknown(task.id, error.message);
      } else if (error.retryable) {
        await prisma.generationTask.update({
          where: { id: task.id },
          data: {
            status: "pending",
            errorCode: error.code,
            errorMessage: truncateMessage(error.message),
            pollAttempts: { increment: 1 },
            nextPollAt: nextPollAt(task.pollAttempts + 1, error.retryAfterSeconds),
            leaseUntil: null,
          },
        });
      } else {
        await markFailed(task.id, error.code, error.message);
      }
      return;
    }

    await markSubmitUnknown(
      task.id,
      error instanceof Error ? error.message : "提交阶段发生未知错误",
    );
  }
}

async function pollTask(taskId: string): Promise<void> {
  const task = await prisma.generationTask.findFirst({
    where: { id: taskId, deletedAt: null },
  });
  if (!task) {
    return;
  }
  if (!task.providerTaskId) {
    await markFailed(task.id, "PROVIDER_TASK_MISSING", "缺少上游任务 ID");
    return;
  }

  try {
    const model = getModelDefinition(task.model);
    const taskProvider = createProviderForModel(model, env);
    const result = await taskProvider.getTask(task.providerTaskId);
    const pollWindowStart = task.pollWindowStartedAt ?? task.submittedAt ?? task.createdAt;
    const timedOut = Date.now() - pollWindowStart.getTime() > env.TASK_POLL_MAX_SECONDS * 1000;

    if (result.status === "succeeded") {
      if (result.outputUrls.length === 0) {
        await markFailed(task.id, "PROVIDER_NO_RESULT", "上游成功响应没有结果图片");
        return;
      }

      const downloaded = await downloadRemoteImage(
        result.outputUrls[0],
        env.MAX_RESULT_MB * 1024 * 1024,
      );
      await completeTaskWithBuffer(task.id, downloaded.buffer);
      return;
    }

    if (result.status === "failed") {
      await markFailed(task.id, "PROVIDER_TASK_FAILED", result.error ?? "上游任务失败");
      return;
    }

    if (timedOut) {
      await markTimedOut(task.id);
      return;
    }

    await scheduleRetry(
      task.id,
      task.pollAttempts + 1,
      result.status === "unknown" ? "PROVIDER_UNKNOWN_STATUS" : "PROVIDER_PENDING",
      result.error,
    );
  } catch (error) {
    if (error instanceof ProviderError) {
      const pollWindowStart = task.pollWindowStartedAt ?? task.submittedAt ?? task.createdAt;
      const timedOut = Date.now() - pollWindowStart.getTime() > env.TASK_POLL_MAX_SECONDS * 1000;

      if (timedOut && error.retryable) {
        await markTimedOut(task.id);
      } else if (error.retryable) {
        await scheduleRetry(
          task.id,
          task.pollAttempts + 1,
          error.code,
          error.message,
          error.retryAfterSeconds,
        );
      } else {
        await markFailed(task.id, error.code, error.message);
      }
      return;
    }

    if (error instanceof ModelError) {
      await markFailed(task.id, error.code, error.message);
      return;
    }

    if (error instanceof AppError) {
      await markFailed(task.id, error.code, error.message);
      return;
    }

    await markFailed(
      task.id,
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "worker 处理失败",
    );
  }
}

export async function processNextTask(): Promise<boolean> {
  const claimed = await claimNextTask();
  if (!claimed) {
    return false;
  }

  if (claimed.type === "recovered") {
    console.warn(`[worker] task=${claimed.id} 提交阶段租约过期，已标记 submit_unknown`);
    return true;
  }

  if (claimed.type === "submit") {
    await submitTask(claimed.id);
  } else {
    await pollTask(claimed.id);
  }
  return true;
}
