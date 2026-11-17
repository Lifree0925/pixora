import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getServerEnv } from "@/lib/env";
import { AppError } from "@/lib/api/app-error";
import { getStorage } from "@/lib/storage";
import type { CreateTaskRequest, HistoryEditRequest } from "./schemas";
import {
  getModelDefinition,
  getModelName,
  ModelError,
  type ModelParameterValue,
} from "@/modules/models/registry";
import { normalizeModelParameters } from "@/modules/models/parameters";
import { getModelCapabilityVerification } from "@/modules/models/verification";

export class GenerationError extends AppError {
  constructor(code: string, message: string, status = 400) {
    super(code, message, status);
    this.name = "GenerationError";
  }
}

export interface AssetView {
  id: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  previewUrl: string;
}

export interface TaskView {
  id: string;
  conversationId: string;
  mode: "text_to_image" | "image_edit" | "multi_image_edit";
  prompt: string;
  requestedSize: string;
  model: string;
  modelName: string;
  parameters: Record<string, ModelParameterValue>;
  status: string;
  canResume: boolean;
  inputs: AssetView[];
  outputs: AssetView[];
  actualWidth: number | null;
  actualHeight: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  providerRawStatus: string | null;
  nextPollAt: string | null;
  parentTaskId: string | null;
  parentAssetId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ConversationListItem {
  id: string;
  title: string;
  latestPromptSummary: string;
  model: string;
  modelName: string;
  status: string;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
  latestTaskId: string;
  thumbnailUrl: string | null;
  outputAssetId: string | null;
  errorCode: string | null;
}

export interface ConversationView {
  id: string;
  title: string;
  model: string;
  modelName: string;
  createdAt: string;
  updatedAt: string;
  latestTaskId: string;
  latestSuccessfulTaskId: string | null;
  turns: TaskView[];
}

type TaskWithAssets = Prisma.GenerationTaskGetPayload<{
  include: { assets: { include: { asset: true } } };
}>;

function toAssetView(asset: {
  id: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
}): AssetView {
  return {
    id: asset.id,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    previewUrl: `/api/assets/${asset.id}/content`,
  };
}

function summarizePrompt(prompt: string, length = 100): string {
  return prompt.length > length ? `${prompt.slice(0, length)}…` : prompt;
}

function toTaskView(task: TaskWithAssets): TaskView {
  const inputs = task.assets
    .filter((item) => item.relation === "input" && !item.asset.deletedAt)
    .map((item) => toAssetView(item.asset));
  const outputs = task.assets
    .filter((item) => item.relation === "output" && !item.asset.deletedAt)
    .map((item) => toAssetView(item.asset));
  const firstOutput = outputs[0];
  const snapshot =
    task.requestSnapshot && typeof task.requestSnapshot === "object"
      ? (task.requestSnapshot as Record<string, unknown>)
      : {};
  const snapshotParameters =
    snapshot.parameters &&
    typeof snapshot.parameters === "object" &&
    !Array.isArray(snapshot.parameters)
      ? (snapshot.parameters as Record<string, ModelParameterValue>)
      : {};

  return {
    id: task.id,
    conversationId: task.conversationId,
    mode: task.mode,
    prompt: task.prompt,
    requestedSize: task.size,
    model: task.model,
    modelName: getModelName(task.model),
    parameters: { size: task.size, ...snapshotParameters },
    status: task.status,
    canResume: task.status === "timed_out",
    inputs,
    outputs,
    actualWidth: firstOutput?.width ?? null,
    actualHeight: firstOutput?.height ?? null,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    providerRawStatus: task.providerRawStatus,
    nextPollAt: task.nextPollAt?.toISOString() ?? null,
    parentTaskId: task.parentTaskId,
    parentAssetId: task.parentAssetId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}

function canonicalRequest(input: CreateTaskRequest, modelId: string) {
  const parameters = Object.fromEntries(
    Object.entries(input.parameters ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  );

  return {
    mode: input.mode,
    prompt: input.prompt.trim(),
    modelId,
    size: input.size,
    parameters,
    assetIds: input.assetIds,
    parentTaskId: input.parentTaskId ?? null,
    parentAssetId: input.parentAssetId ?? null,
  };
}

function requestHashOf(input: CreateTaskRequest, modelId: string): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalRequest(input, modelId)))
    .digest("hex");
}

function validateModeAndAssets(input: CreateTaskRequest): void {
  const env = getServerEnv();
  const count = input.assetIds.length;
  const uniqueCount = new Set(input.assetIds).size;

  if (uniqueCount !== count) {
    throw new GenerationError("VALIDATION_ERROR", "参考图不能重复选择");
  }
  if (input.prompt.length > env.PROMPT_MAX_CHARS) {
    throw new GenerationError("VALIDATION_ERROR", `提示词不能超过 ${env.PROMPT_MAX_CHARS} 个字符`);
  }
  if (input.mode === "text_to_image" && count !== 0) {
    throw new GenerationError("VALIDATION_ERROR", "文生图不能上传参考图");
  }
  if (input.mode === "image_edit" && count !== 1) {
    throw new GenerationError("VALIDATION_ERROR", "图片编辑需要恰好一张参考图");
  }
  if (input.mode === "multi_image_edit" && count < 2) {
    throw new GenerationError("VALIDATION_ERROR", "多图融合至少需要两张参考图");
  }
  if (count > env.MAX_REFERENCE_IMAGES) {
    throw new GenerationError("VALIDATION_ERROR", `参考图不能超过 ${env.MAX_REFERENCE_IMAGES} 张`);
  }
}

async function validateAssets(assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) {
    return;
  }

  const assets = await prisma.imageAsset.findMany({
    where: { id: { in: assetIds }, deletedAt: null },
    select: { id: true },
  });
  if (assets.length !== assetIds.length) {
    throw new GenerationError("ASSET_NOT_FOUND", "参考图不存在或已被删除", 404);
  }
}

async function validateParent(
  input: CreateTaskRequest,
): Promise<{ conversationId: string } | null> {
  const hasTask = Boolean(input.parentTaskId);
  const hasAsset = Boolean(input.parentAssetId);
  if (!hasTask && !hasAsset) {
    return null;
  }
  if (!hasTask || !hasAsset) {
    throw new GenerationError("VALIDATION_ERROR", "父任务和父资产必须同时提供");
  }

  const parent = await prisma.generationTask.findFirst({
    where: { id: input.parentTaskId!, deletedAt: null },
  });
  if (!parent) {
    throw new GenerationError("PARENT_TASK_NOT_FOUND", "父任务不存在", 404);
  }

  const link = await prisma.taskAsset.findFirst({
    where: {
      taskId: input.parentTaskId!,
      assetId: input.parentAssetId!,
      relation: "output",
    },
  });
  if (!link) {
    throw new GenerationError("PARENT_ASSET_NOT_FOUND", "父资产不是该任务的输出图", 404);
  }

  return { conversationId: parent.conversationId };
}

export async function createGenerationTask(
  input: CreateTaskRequest,
  idempotencyKey: string,
): Promise<{ id: string; status: string; created: boolean }> {
  const env = getServerEnv();
  let model;
  try {
    model = getModelDefinition(input.modelId ?? env.YIJIE_MODEL);
  } catch (error) {
    if (error instanceof ModelError) {
      throw new GenerationError(error.code, error.message, 400);
    }
    throw error;
  }

  const verification = getModelCapabilityVerification(model, env);
  if (input.mode === "image_edit" && (!model.capabilities.imageEdit || !verification.editVerified)) {
    throw new GenerationError("CAPABILITY_NOT_VERIFIED", "当前模型的单图编辑能力尚未验证或未启用", 409);
  }
  if (
    input.mode === "multi_image_edit" &&
    (!model.capabilities.multiImageEdit || !verification.multiImageEditVerified)
  ) {
    throw new GenerationError("CAPABILITY_NOT_VERIFIED", "当前模型的多图融合能力尚未验证或未启用", 409);
  }

  let normalizedParameters: Record<string, ModelParameterValue>;
  try {
    normalizedParameters = normalizeModelParameters({
      model,
      size: input.size,
      parameters: input.parameters,
    });
  } catch (error) {
    if (error instanceof ModelError) {
      throw new GenerationError(error.code, error.message, 400);
    }
    throw error;
  }

  validateModeAndAssets(input);
  await validateAssets(input.assetIds);
  const parentTask = await validateParent(input);
  const conversationId = parentTask?.conversationId ?? crypto.randomUUID();

  const requestHash = requestHashOf(input, model.id);
  const existing = await prisma.generationTask.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new GenerationError("IDEMPOTENCY_CONFLICT", "同一幂等键对应了不同请求", 409);
    }
    return { id: existing.id, status: existing.status, created: false };
  }

  const snapshot = {
    ...canonicalRequest(input, model.id),
    parameters: normalizedParameters,
    provider: model.provider,
    providerModelId: model.providerModelId,
  } as Prisma.InputJsonValue;

  try {
    const task = await prisma.generationTask.create({
      data: {
        conversationId,
        mode: input.mode,
        prompt: input.prompt.trim(),
        size: input.size,
        status: "pending",
        idempotencyKey,
        requestHash,
        requestSnapshot: snapshot,
        provider: model.provider,
        model: model.id,
        parentTaskId: input.parentTaskId ?? null,
        parentAssetId: input.parentAssetId ?? null,
        assets: {
          create: input.assetIds.map((assetId, index) => ({
            assetId,
            relation: "input",
            sortOrder: index,
          })),
        },
      },
    });

    return { id: task.id, status: task.status, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.generationTask.findUnique({ where: { idempotencyKey } });
      if (raced && raced.requestHash === requestHash) {
        return { id: raced.id, status: raced.status, created: false };
      }
      throw new GenerationError("IDEMPOTENCY_CONFLICT", "同一幂等键对应了不同请求", 409);
    }
    throw error;
  }
}

export async function getTaskView(taskId: string): Promise<TaskView> {
  const task = await prisma.generationTask.findFirst({
    where: { id: taskId, deletedAt: null },
    include: {
      assets: {
        include: { asset: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!task) {
    throw new GenerationError("TASK_NOT_FOUND", "任务不存在", 404);
  }
  return toTaskView(task);
}

export async function resumeTask(taskId: string): Promise<TaskView> {
  const task = await prisma.generationTask.findFirst({
    where: { id: taskId, deletedAt: null },
  });
  if (!task) {
    throw new GenerationError("TASK_NOT_FOUND", "任务不存在", 404);
  }
  if (task.status !== "timed_out" || !task.providerTaskId) {
    throw new GenerationError("TASK_NOT_RESUMABLE", "当前任务不能继续查询", 409);
  }

  await prisma.generationTask.update({
    where: { id: task.id },
    data: {
      status: "processing",
      nextPollAt: new Date(),
      pollWindowStartedAt: new Date(),
      leaseUntil: null,
      errorCode: null,
      errorMessage: null,
      completedAt: null,
    },
  });

  return getTaskView(task.id);
}

export async function abandonSubmitUnknownTask(
  taskId: string,
  confirm: boolean,
): Promise<TaskView> {
  if (!confirm) {
    throw new GenerationError("VALIDATION_ERROR", "必须确认后才能放弃任务");
  }

  const task = await prisma.generationTask.findFirst({
    where: { id: taskId, deletedAt: null },
  });
  if (!task) {
    throw new GenerationError("TASK_NOT_FOUND", "任务不存在", 404);
  }
  if (task.status !== "submit_unknown") {
    throw new GenerationError("TASK_NOT_ABANDONABLE", "当前任务不是提交未知状态", 409);
  }

  await prisma.generationTask.update({
    where: { id: task.id },
    data: {
      status: "failed",
      errorCode: "SUBMIT_UNKNOWN_ABANDONED",
      errorMessage: "用户确认上游未创建任务后手动放弃",
      completedAt: new Date(),
      nextPollAt: null,
      leaseUntil: null,
    },
  });

  return getTaskView(task.id);
}

export async function listHistory(input: {
  limit: number;
  cursor?: string;
}): Promise<{ items: ConversationListItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit, 1), 50);
  const tasks = await prisma.generationTask.findMany({
    where: { deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      assets: {
        where: { relation: "output" },
        include: { asset: true },
        orderBy: { sortOrder: "asc" },
        take: 1,
      },
    },
  });

  type ConversationAccumulator = {
    id: string;
    title: string;
    createdAt: Date;
    latest: TaskWithAssets;
    latestOutput: { id: string } | null;
    turnCount: number;
  };

  const conversations = new Map<string, ConversationAccumulator>();
  for (const task of tasks) {
    let conversation = conversations.get(task.conversationId);
    if (!conversation) {
      conversation = {
        id: task.conversationId,
        title: summarizePrompt(task.prompt),
        createdAt: task.createdAt,
        latest: task,
        latestOutput: null,
        turnCount: 0,
      };
      conversations.set(task.conversationId, conversation);
    }

    conversation.latest = task;
    conversation.turnCount += 1;
    const output = task.assets.find((item) => !item.asset.deletedAt)?.asset;
    if (output) {
      conversation.latestOutput = { id: output.id };
    }
  }

  const ordered = [...conversations.values()].sort((left, right) => {
    const timeDiff = right.latest.createdAt.getTime() - left.latest.createdAt.getTime();
    return timeDiff !== 0 ? timeDiff : right.id.localeCompare(left.id);
  });
  const cursorIndex = input.cursor
    ? ordered.findIndex((conversation) => conversation.id === input.cursor)
    : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const page = ordered.slice(start, start + limit);
  const hasMore = start + limit < ordered.length;
  const items = page.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    latestPromptSummary: summarizePrompt(conversation.latest.prompt),
    model: conversation.latest.model,
    modelName: getModelName(conversation.latest.model),
    status: conversation.latest.status,
    turnCount: conversation.turnCount,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.latest.createdAt.toISOString(),
    latestTaskId: conversation.latest.id,
    thumbnailUrl: conversation.latestOutput
      ? `/api/assets/${conversation.latestOutput.id}/content`
      : null,
    outputAssetId: conversation.latestOutput?.id ?? null,
    errorCode: conversation.latest.errorCode,
  }));

  return {
    items,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function getHistoryConversation(entryId: string): Promise<ConversationView> {
  const directTask = await prisma.generationTask.findFirst({
    where: { id: entryId, deletedAt: null },
    select: { conversationId: true },
  });
  const conversationId =
    directTask?.conversationId ??
    (
      await prisma.generationTask.findFirst({
        where: { conversationId: entryId, deletedAt: null },
        select: { conversationId: true },
      })
    )?.conversationId;

  if (!conversationId) {
    throw new GenerationError("TASK_NOT_FOUND", "对话记录不存在", 404);
  }

  const tasks = await prisma.generationTask.findMany({
    where: { conversationId, deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      assets: {
        include: { asset: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (tasks.length === 0) {
    throw new GenerationError("TASK_NOT_FOUND", "对话记录不存在", 404);
  }

  const turns = tasks.map(toTaskView);
  const latest = turns[turns.length - 1]!;
  const latestSuccessful = [...turns]
    .reverse()
    .find((task) => task.status === "succeeded" && task.outputs.length > 0);

  return {
    id: conversationId,
    title: summarizePrompt(tasks[0]!.prompt),
    model: latest.model,
    modelName: latest.modelName,
    createdAt: tasks[0]!.createdAt.toISOString(),
    updatedAt: latest.createdAt,
    latestTaskId: latest.id,
    latestSuccessfulTaskId: latestSuccessful?.id ?? null,
    turns,
  };
}

export async function createEditFromHistory(
  taskId: string,
  input: HistoryEditRequest,
  idempotencyKey: string,
): Promise<{ id: string; status: string; created: boolean }> {
  const task = await prisma.generationTask.findFirst({
    where: { id: taskId, deletedAt: null },
    include: {
      assets: {
        where: { relation: "output" },
        include: { asset: true },
        orderBy: { sortOrder: "asc" },
        take: 1,
      },
    },
  });

  if (!task) {
    throw new GenerationError("TASK_NOT_FOUND", "历史任务不存在", 404);
  }
  if (task.status !== "succeeded") {
    throw new GenerationError("TASK_NOT_EDITABLE", "只有成功任务可以再次编辑", 409);
  }

  const output = task.assets[0]?.asset;
  if (!output || output.deletedAt) {
    throw new GenerationError("ASSET_NOT_FOUND", "历史任务没有可用的输出图", 404);
  }

  const snapshot =
    task.requestSnapshot && typeof task.requestSnapshot === "object"
      ? (task.requestSnapshot as Record<string, unknown>)
      : {};
  const snapshotParameters =
    snapshot.parameters &&
    typeof snapshot.parameters === "object" &&
    !Array.isArray(snapshot.parameters)
      ? (snapshot.parameters as Record<string, ModelParameterValue>)
      : {};
  const model = getModelDefinition(task.model);
  const inheritedParameters = Object.fromEntries(
    model.parameters
      .filter((parameter) => parameter.key !== "size")
      .filter((parameter) => snapshotParameters[parameter.key] !== undefined)
      .map((parameter) => [parameter.key, snapshotParameters[parameter.key]!]),
  );

  return createGenerationTask(
    {
      mode: "image_edit",
      prompt: input.prompt,
      size: input.size,
      modelId: task.model,
      parameters: inheritedParameters,
      assetIds: [output.id],
      parentTaskId: task.id,
      parentAssetId: output.id,
    },
    idempotencyKey,
  );
}

export async function deleteHistoryEntry(entryId: string): Promise<void> {
  const task = await prisma.generationTask.findFirst({
    where: { id: entryId, deletedAt: null },
    select: { id: true },
  });
  if (task) {
    await deleteHistoryTask(task.id);
    return;
  }

  const conversation = await prisma.generationTask.findFirst({
    where: { conversationId: entryId, deletedAt: null },
    select: { id: true },
  });
  if (!conversation) {
    throw new GenerationError("TASK_NOT_FOUND", "历史记录不存在", 404);
  }

  const tasks = await prisma.generationTask.findMany({
    where: { conversationId: entryId, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  for (const item of tasks) {
    await deleteHistoryTask(item.id);
  }
}

export async function deleteHistoryTask(taskId: string): Promise<void> {
  const task = await prisma.generationTask.findFirst({
    where: { id: taskId, deletedAt: null },
    include: { assets: true },
  });
  if (!task) {
    throw new GenerationError("TASK_NOT_FOUND", "任务不存在", 404);
  }

  const assetIds = [...new Set(task.assets.map((item) => item.assetId))];
  await prisma.$transaction([
    prisma.generationTask.update({
      where: { id: task.id },
      data: { deletedAt: new Date() },
    }),
    prisma.taskAsset.deleteMany({ where: { taskId: task.id } }),
  ]);

  const storage = getStorage();
  for (const assetId of assetIds) {
    const remaining = await prisma.taskAsset.count({ where: { assetId } });
    if (remaining > 0) {
      continue;
    }

    const asset = await prisma.imageAsset.findFirst({
      where: { id: assetId, deletedAt: null },
    });
    if (!asset) {
      continue;
    }

    try {
      await storage.delete(asset.storageKey);
      await prisma.imageAsset.update({
        where: { id: asset.id },
        data: { deletedAt: new Date() },
      });
    } catch (error) {
      console.error(
        "[history] 删除资产失败，保留数据库记录以便后续清理",
        assetId,
        error instanceof Error ? error.message : error,
      );
    }
  }
}
