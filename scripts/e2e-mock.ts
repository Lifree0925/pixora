import "dotenv/config";
import assert from "node:assert/strict";
import http from "node:http";
import sharp from "sharp";
import { getStorage } from "../src/lib/storage";
import type { TaskView, AssetView, ConversationView } from "../src/types/api";

const APP_BASE_URL = process.env.E2E_APP_URL ?? "http://127.0.0.1:3000";
const MOCK_PORT = Number(process.env.MOCK_PROVIDER_PORT ?? "4100");
const RESULT_GREEN = { r: 34, g: 197, b: 94, alpha: 1 };

interface MockTask {
  id: string;
  kind: "text" | "edit" | "multi";
  polls: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${APP_BASE_URL}${path}`, init);
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : (undefined as T);
  if (!response.ok) {
    throw new Error(`API ${path} HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return data;
}

async function uploadPng(name: string, color: { r: number; g: number; b: number; alpha: number }) {
  const png = await sharp({
    create: { width: 8, height: 8, channels: 4, background: color },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append("file", new File([png], name, { type: "image/png" }));
  const response = await fetch(`${APP_BASE_URL}/api/uploads`, { method: "POST", body: form });
  const data = (await response.json().catch(() => null)) as {
    asset?: AssetView;
    error?: { message?: string };
  } | null;
  if (!response.ok || !data?.asset) {
    throw new Error(`上传失败 HTTP ${response.status}: ${data?.error?.message ?? ""}`);
  }
  return data.asset;
}

async function createTask(input: {
  mode: "text_to_image" | "image_edit" | "multi_image_edit";
  prompt: string;
  assetIds: string[];
  parameters?: Record<string, string | number | boolean>;
}) {
  const task = await apiJson<{ task: { id: string } }>("/api/images", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      mode: input.mode,
      modelId: "gr-gpt-image-2",
      prompt: input.prompt,
      size: "1024x1024",
      parameters: input.parameters ?? {},
      assetIds: input.assetIds,
      parentTaskId: null,
      parentAssetId: null,
    }),
  });
  return task.task.id;
}

async function pollTask(taskId: string): Promise<TaskView> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const data = await apiJson<{ task: TaskView }>(`/api/images/tasks/${taskId}`);
    if (["succeeded", "failed", "timed_out", "submit_unknown"].includes(data.task.status)) {
      return data.task;
    }
    await sleep(1000);
  }
  throw new Error(`任务 ${taskId} 轮询超时`);
}

async function deleteTask(taskId: string): Promise<void> {
  const response = await fetch(`${APP_BASE_URL}/api/history/${taskId}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`删除任务 ${taskId} 失败 HTTP ${response.status}`);
  }
}

async function waitForHealthyApp(): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${APP_BASE_URL}/api/health`);
      if (response.ok) {
        const data = (await response.json()) as { checks?: { worker?: string } };
        if (data.checks?.worker === "ok") {
          return;
        }
      }
    } catch {
      // retry
    }
    await sleep(1000);
  }
  throw new Error("应用或 worker 未在 45 秒内就绪");
}

async function createMockServer(resultUrl: string) {
  const tasks = new Map<string, MockTask>();
  let counter = 0;

  const server = http.createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };

    const url = new URL(request.url ?? "/", `http://127.0.0.1:${MOCK_PORT}`);
    const path = url.pathname;

    if (
      request.method === "POST" &&
      (path.endsWith("/generations/async") || path.endsWith("/edits/async"))
    ) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      if (body.model !== "gr-gpt-image-2" || typeof body.prompt !== "string") {
        send(400, { error: { message: "invalid body" } });
        return;
      }

      const kind = path.endsWith("/edits/async")
        ? Array.isArray(body.image) && body.image.length > 1
          ? "multi"
          : "edit"
        : "text";
      if (kind !== "text") {
        if (!Array.isArray(body.image) || body.image.length === 0) {
          send(400, { error: { message: "image required" } });
          return;
        }
        for (const imageUrl of body.image) {
          if (typeof imageUrl !== "string") {
            send(400, { error: { message: "invalid image url" } });
            return;
          }
          const imageResponse = await fetch(imageUrl);
          if (!imageResponse.ok) {
            send(400, { error: { message: "image url not accessible" } });
            return;
          }
        }
      }

      counter += 1;
      const id = `mock_${kind}_${Date.now()}_${counter}`;
      tasks.set(id, { id, kind, polls: 0 });
      send(200, { id });
      return;
    }

    const match = path.match(/^\/v1\/images\/tasks\/([^/]+)$/);
    if (request.method === "GET" && match) {
      const task = tasks.get(decodeURIComponent(match[1]));
      if (!task) {
        send(404, { error: { message: "task not found" } });
        return;
      }
      task.polls += 1;
      if (task.polls <= 1) {
        send(200, { id: task.id, status: "processing", progress: 50, data: [] });
        return;
      }
      send(200, {
        id: task.id,
        status: "succeeded",
        progress: 100,
        data: [{ url: resultUrl }],
      });
      return;
    }

    send(404, { error: { message: "not found" } });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(MOCK_PORT, "127.0.0.1", resolve);
  });

  return server;
}

async function main(): Promise<void> {
  const createdTaskIds: string[] = [];
  let server: http.Server | undefined;
  let resultKey: string | undefined;
  const storage = getStorage();

  try {
    await waitForHealthyApp();

    const invalidResponse = await fetch(`${APP_BASE_URL}/api/images`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        mode: "text_to_image",
        modelId: "gr-gpt-image-2",
        prompt: "[E2E] invalid parameter",
        size: "1024x1024",
        parameters: { seed: 42 },
        assetIds: [],
      }),
    });
    assert.equal(invalidResponse.status, 400);

    const resultPng = await sharp({
      create: { width: 8, height: 8, channels: 4, background: RESULT_GREEN },
    })
      .png()
      .toBuffer();
    resultKey = `checks/e2e-result-${Date.now()}.png`;
    await storage.upload({
      key: resultKey,
      body: new Uint8Array(resultPng).buffer,
      contentType: "image/png",
    });
    const resultUrl = await storage.createSignedUrl(resultKey, 600);
    server = await createMockServer(resultUrl);

    const inputA = await uploadPng("e2e-a.png", { r: 220, g: 40, b: 40, alpha: 1 });
    const inputB = await uploadPng("e2e-b.png", { r: 40, g: 80, b: 220, alpha: 1 });

    const textTaskId = await createTask({
      mode: "text_to_image",
      prompt: "[E2E] text image",
      assetIds: [],
      parameters: { quality: "high" },
    });
    createdTaskIds.push(textTaskId);
    const textTask = await pollTask(textTaskId);
    assert.equal(textTask.status, "succeeded");
    assert.equal(textTask.outputs.length, 1);
    assert.equal(textTask.parameters.quality, "high");

    const editTaskId = await createTask({
      mode: "image_edit",
      prompt: "[E2E] edit image",
      assetIds: [inputA.id],
    });
    createdTaskIds.push(editTaskId);
    const editTask = await pollTask(editTaskId);
    assert.equal(editTask.status, "succeeded");
    assert.equal(editTask.inputs.length, 1);
    assert.equal(editTask.outputs.length, 1);

    const multiTaskId = await createTask({
      mode: "multi_image_edit",
      prompt: "[E2E] multi image",
      assetIds: [inputA.id, inputB.id],
    });
    createdTaskIds.push(multiTaskId);
    const multiTask = await pollTask(multiTaskId);
    assert.equal(multiTask.status, "succeeded");
    assert.equal(multiTask.inputs.length, 2);
    assert.equal(multiTask.outputs.length, 1);

    const downloadResponse = await fetch(
      `${APP_BASE_URL}/api/assets/${multiTask.outputs[0].id}/download`,
    );
    assert.equal(downloadResponse.status, 200);
    assert.match(downloadResponse.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.ok((await downloadResponse.arrayBuffer()).byteLength > 0);

    const history = await apiJson<{
      items: Array<{ id: string; latestTaskId: string }>;
    }>("/api/history?limit=50");
    for (const taskId of createdTaskIds) {
      assert.ok(
        history.items.some((item) => item.latestTaskId === taskId),
        `history missing ${taskId}`,
      );
    }

    const detail = await apiJson<{ conversation: ConversationView }>(`/api/history/${multiTaskId}`);
    const multiTurn = detail.conversation.turns.find((task) => task.id === multiTaskId);
    assert.ok(multiTurn);
    assert.equal(multiTurn.inputs.length, 2);
    assert.equal(multiTurn.outputs.length, 1);

    const reEdit = await apiJson<{ task: { id: string } }>(`/api/history/${multiTaskId}/edit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ prompt: "[E2E] re-edit", size: "1024x1024" }),
    });
    createdTaskIds.push(reEdit.task.id);
    const reEditTask = await pollTask(reEdit.task.id);
    assert.equal(reEditTask.status, "succeeded");
    assert.equal(reEditTask.parentTaskId, multiTaskId);
    assert.equal(reEditTask.parentAssetId, multiTask.outputs[0].id);

    const reEditConversation = await apiJson<{ conversation: ConversationView }>(
      `/api/history/${reEdit.task.id}`,
    );
    assert.equal(reEditConversation.conversation.turns.length, 2);
    assert.deepEqual(
      reEditConversation.conversation.turns.map((task) => task.id),
      [multiTaskId, reEdit.task.id],
    );

    await deleteTask(multiTaskId);
    const childAfterParentDelete = await apiJson<{ conversation: ConversationView }>(
      `/api/history/${reEdit.task.id}`,
    );
    const childTurn = childAfterParentDelete.conversation.turns.find(
      (task) => task.id === reEdit.task.id,
    );
    assert.ok(childTurn);
    assert.equal(childTurn.inputs.length, 1);
    assert.equal(childTurn.inputs[0].id, multiTask.outputs[0].id);

    await deleteTask(reEdit.task.id);
    await deleteTask(textTaskId);
    await deleteTask(editTaskId);

    const finalHistory = await apiJson<{
      items: Array<{ id: string; latestTaskId: string }>;
    }>("/api/history?limit=50");
    for (const taskId of createdTaskIds) {
      assert.ok(
        !finalHistory.items.some((item) => item.latestTaskId === taskId),
        `task not deleted ${taskId}`,
      );
    }

    console.log("[e2e] 文生图、单图编辑、多图融合、历史、下载、再次编辑、删除均通过");
  } finally {
    await new Promise<void>((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
    if (resultKey) {
      await storage.delete(resultKey).catch(() => undefined);
    }
    for (const taskId of createdTaskIds) {
      await deleteTask(taskId).catch(() => undefined);
    }
  }
}

void main().catch((error: unknown) => {
  console.error("[e2e] 失败", error instanceof Error ? error.message : error);
  process.exit(1);
});
