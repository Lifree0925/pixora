"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  MessageSquare,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ImageDownloadMenu } from "@/components/ui/image-download-menu";
import { ImageViewer } from "@/components/ui/image-viewer";
import { ComposerMenu } from "@/components/studio/composer-menu";
import { cn } from "@/lib/utils";
import { fetchJson, ClientApiError } from "@/lib/client/api";
import { groupSizeOptions } from "@/modules/models/size-options";
import { getTaskStatusLabel } from "@/lib/task-status";
import type { AssetView, ConversationView, ModelInfo, TaskView } from "@/types/api";

const MODE_LABELS: Record<string, string> = {
  text_to_image: "文生图",
  image_edit: "图片编辑",
  multi_image_edit: "多图融合",
};

type ComposerMenuKey = "mode" | "orientation" | "resolution";
type HistoryEditMode = "image_edit" | "multi_image_edit";

const ACTIVE_STATUSES = new Set(["pending", "submitting", "processing"]);

function messageOf(error: unknown): string {
  return error instanceof ClientApiError || error instanceof Error
    ? error.message
    : "操作失败，请稍后重试";
}

async function fetchConversation(id: string) {
  return fetchJson<{ conversation: ConversationView }>(`/api/history/${id}`);
}

function parameterSummary(task: TaskView): string {
  const values = Object.entries(task.parameters)
    .filter(([key, value]) => key !== "size" && value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`);
  return [task.requestedSize, ...values].join(" · ");
}

function latestSuccessfulTaskOf(conversation: ConversationView): TaskView | undefined {
  return [...conversation.turns]
    .reverse()
    .find((task) => task.status === "succeeded" && task.outputs.length > 0);
}

export function HistoryDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [mode, setMode] = useState<HistoryEditMode>("image_edit");
  const [references, setReferences] = useState<AssetView[]>([]);
  const [uploading, setUploading] = useState(false);
  const [composerMenu, setComposerMenu] = useState<ComposerMenuKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxAsset, setLightboxAsset] = useState<AssetView | null>(null);
  const idempotencyRef = useRef(crypto.randomUUID());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const historyModel = models.find((model) => model.id === conversation?.model);
  const historySizeParameter = historyModel?.parameters.find(
    (parameter) => parameter.key === "size",
  );
  const historySizeOptions = historySizeParameter?.options ?? historyModel?.sizes ?? [];
  const groupedSizes = groupSizeOptions(historySizeOptions);
  const currentSize =
    groupedSizes.options.find((option) => option.value === size) ?? groupedSizes.options[0];
  const effectiveSize = currentSize?.value ?? size;
  const availableResolutions = currentSize
    ? [
        ...new Set(
          groupedSizes.options
            .filter((option) => option.orientationKey === currentSize.orientationKey)
            .map((option) => option.resolution),
        ),
      ]
    : [];
  const canEdit = Boolean(historyModel?.capabilities.imageEdit);
  const canMultiEdit = Boolean(historyModel?.capabilities.multiImageEdit);
  const maxAdditionalReferences = Math.max(
    0,
    (historyModel?.limits.maxReferenceImages ?? 8) - 1,
  );
  const latestSuccessfulTask = conversation ? latestSuccessfulTaskOf(conversation) : undefined;
  const latestOutput = latestSuccessfulTask?.outputs[0] ?? null;
  const canContinue = Boolean(conversation?.latestSuccessfulTaskId && latestOutput);
  const hasEditCapability = canEdit || canMultiEdit;
  const modeReady = mode === "image_edit" ? canEdit : canMultiEdit && references.length > 0;

  function selectHistoryOrientation(orientationKey: string) {
    const next =
      groupedSizes.options.find(
        (option) =>
          option.orientationKey === orientationKey &&
          option.resolution === currentSize?.resolution,
      ) ?? groupedSizes.options.find((option) => option.orientationKey === orientationKey);
    if (next) {
      setSize(next.value);
    }
  }

  function selectHistoryResolution(resolution: string) {
    const next = groupedSizes.options.find(
      (option) =>
        option.resolution === resolution &&
        option.orientationKey === currentSize?.orientationKey,
    );
    if (next) {
      setSize(next.value);
    }
  }

  useEffect(() => {
    if (!composerMenu) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-composer-menu]")) {
        setComposerMenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setComposerMenu(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [composerMenu]);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ models: ModelInfo[] }>("/api/models")
      .then((data) => {
        if (!cancelled) {
          setModels(data.models);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(messageOf(loadError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshConversation(): Promise<void> {
    const data = await fetchConversation(id);
    setConversation(data.conversation);
    const latestSuccessful = latestSuccessfulTaskOf(data.conversation);
    setSize(latestSuccessful?.requestedSize ?? "1024x1024");
  }

  useEffect(() => {
    let cancelled = false;
    void fetchConversation(id)
      .then((data) => {
        if (cancelled) {
          return;
        }
        setConversation(data.conversation);
        const latestSuccessful = latestSuccessfulTaskOf(data.conversation);
        setSize(latestSuccessful?.requestedSize ?? "1024x1024");
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(messageOf(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const hasActiveTask = Boolean(
    conversation?.turns.some((task) => ACTIVE_STATUSES.has(task.status)),
  );

  useEffect(() => {
    if (!hasActiveTask) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshConversation().catch(() => undefined);
    }, 3000);
    return () => {
      window.clearInterval(timer);
    };
    // refreshConversation 只读取当前路由，不需要作为依赖重复创建定时器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveTask, id]);

  function chooseEditMode(nextMode: HistoryEditMode) {
    if (nextMode === "image_edit" && !canEdit) {
      setError("当前模型未开放图片编辑能力");
      return;
    }
    if (nextMode === "multi_image_edit" && !canMultiEdit) {
      setError("当前模型未开放多图融合能力");
      return;
    }

    setMode(nextMode);
    setError(null);
    if (nextMode === "image_edit") {
      setReferences([]);
    }
  }

  async function uploadReferences(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }
    if (!canMultiEdit) {
      setError("当前模型未开放多图融合能力");
      return;
    }
    if (!canContinue) {
      setError("当前对话还没有可用于多图融合的结果");
      return;
    }

    const remaining = maxAdditionalReferences - references.length;
    if (remaining <= 0) {
      setError("参考图数量已达上限");
      return;
    }

    const selected = Array.from(files).slice(0, remaining);
    setUploading(true);
    setError(null);
    try {
      const nextReferences = [...references];
      for (const file of selected) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/uploads", { method: "POST", body: formData });
        const data = (await response.json().catch(() => null)) as {
          asset?: AssetView;
          error?: { message?: string };
        } | null;
        if (!response.ok || !data?.asset) {
          throw new Error(data?.error?.message ?? `上传失败 HTTP ${response.status}`);
        }
        nextReferences.push(data.asset);
        setReferences([...nextReferences]);
        setMode("multi_image_edit");
      }
    } catch (uploadError) {
      setError(messageOf(uploadError));
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function removeReference(id: string) {
    setReferences((current) => current.filter((asset) => asset.id !== id));
  }

  async function submitEdit() {
    if (!prompt.trim()) {
      setError("请先填写编辑提示词");
      return;
    }
    const latestTaskId = conversation?.latestSuccessfulTaskId;
    if (!latestTaskId) {
      setError("当前对话还没有可用于继续编辑的结果");
      return;
    }
    if (mode === "image_edit" && !canEdit) {
      setError("当前模型未开放图片编辑能力");
      return;
    }
    if (mode === "multi_image_edit" && !canMultiEdit) {
      setError("当前模型未开放多图融合能力");
      return;
    }
    if (mode === "multi_image_edit" && references.length === 0) {
      setError("多图融合除当前结果外至少还需要一张参考图");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await fetchJson<{ task: { id: string } }>(
        `/api/history/${latestTaskId}/edit`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyRef.current },
          body: JSON.stringify({
            prompt,
            size: effectiveSize,
            mode,
            assetIds: mode === "multi_image_edit" ? references.map((asset) => asset.id) : [],
          }),
        },
      );
      idempotencyRef.current = crypto.randomUUID();
      router.push(`/create?taskId=${created.task.id}`);
    } catch (editError) {
      setError(messageOf(editError));
    } finally {
      setSubmitting(false);
    }
  }

  async function removeConversation() {
    if (!conversation) {
      return;
    }
    if (!window.confirm("确认删除整个对话？共享资产不会被误删。")) {
      return;
    }
    setError(null);
    try {
      await fetchJson<void>(`/api/history/${conversation.id}`, { method: "DELETE" });
      router.push("/history");
    } catch (deleteError) {
      setError(messageOf(deleteError));
    }
  }

  async function runTaskAction(task: TaskView, action: "resume" | "abandon") {
    if (action === "abandon" && !window.confirm("确认上游没有创建任务并放弃？此操作不会退款。")) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await fetchJson<{ task: TaskView }>(`/api/images/tasks/${task.id}/${action}`, {
        method: "POST",
        ...(action === "abandon"
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ confirm: true }),
            }
          : {}),
      });
      await refreshConversation();
    } catch (actionError) {
      setError(messageOf(actionError));
    } finally {
      setSubmitting(false);
    }
  }

  function openLightbox(asset: AssetView) {
    setLightboxAsset(asset);
  }

  if (loading) {
    return (
      <div className="flex min-h-96 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        正在加载对话…
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-12">
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
          {error ?? "对话不存在"}
        </div>
        <Link href="/history" className="mt-4 inline-block text-sm underline underline-offset-4">
          返回历史
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full pb-3">
      <header className="sticky top-0 z-20 border-b bg-[#f7f7f5]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-4 md:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Link
              href="/history"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="返回历史"
              title="返回历史"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="line-clamp-1 text-base font-semibold">{conversation.title}</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <MessageSquare className="size-3" />
                {conversation.turns.length} 轮<span>·</span>
                <span>{conversation.modelName}</span>
                <span>·</span>
                <span>{new Date(conversation.updatedAt).toLocaleString("zh-CN")}</span>
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            title="删除对话"
            aria-label="删除对话"
            onClick={() => void removeConversation()}
          >
            <Trash2 />
          </Button>
        </div>
      </header>

      {error ? (
        <div className="shrink-0 px-4 pt-4 md:px-6">
          <div className="mx-auto max-w-3xl rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
        <div className="space-y-7">
          {conversation.turns.map((task, index) => {
            const output = task.outputs[0] ?? null;
            const active = ACTIVE_STATUSES.has(task.status);
            return (
              <section key={task.id} className="space-y-3">
                <div className="flex justify-center">
                  <div className="max-w-[88%] rounded-3xl border border-black/5 bg-[#efede8] px-4 py-3 text-sm leading-6 text-neutral-900">
                    <p className="whitespace-pre-wrap">{task.prompt}</p>
                    {task.inputs.length > 0 ? (
                      <div className="mt-3 flex gap-2 overflow-x-auto">
                        {task.inputs.map((asset, assetIndex) => (
                          <button
                            key={asset.id}
                            type="button"
                            className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-white/80 ring-1 ring-black/5"
                            onClick={() => openLightbox(asset)}
                            title="查看参考图"
                          >
                            <Image
                              src={asset.previewUrl}
                              alt={`参考图 ${assetIndex + 1}`}
                              fill
                              unoptimized
                              sizes="64px"
                              className="object-cover"
                            />
                            <span className="absolute bottom-0 left-0 rounded-tr bg-white/90 px-1 text-[9px] text-neutral-700">
                              {assetIndex + 1}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-neutral-500">
                      <span>第 {index + 1} 轮</span>
                      <span>·</span>
                      <span>{MODE_LABELS[task.mode] ?? task.mode}</span>
                      <span>·</span>
                      <span>{parameterSummary(task)}</span>
                    </div>
                  </div>
                </div>

                {output ? (
                  <div className="mx-auto w-full max-w-[94%]">
                    <button
                      type="button"
                      className="relative mx-auto block w-fit max-w-full"
                      onClick={() => openLightbox(output)}
                      title="查看大图"
                      aria-label="查看大图"
                    >
                      <Image
                        src={output.previewUrl}
                        alt="生成结果"
                        width={output.width}
                        height={output.height}
                        unoptimized
                        className="max-h-[55vh] w-auto max-w-full object-contain"
                      />
                    </button>
                    <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[11px] text-muted-foreground">
                      <span>
                        {output.width} × {output.height}
                      </span>
                      <ImageDownloadMenu asset={output} />
                      <Link
                        href={`/create?taskId=${task.id}`}
                        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                        title="打开并再次编辑"
                        aria-label="打开并再次编辑"
                      >
                        <RotateCcw />
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto flex max-w-[94%] flex-col items-center gap-2 text-center">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {active ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      <span>
                        {active ? "正在生成，通常需要 1–3 分钟" : getTaskStatusLabel(task.status)}
                      </span>
                    </div>
                    {task.errorMessage ? (
                      <p className="max-w-lg rounded-xl bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
                        {task.errorMessage}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {task.status === "timed_out" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={submitting}
                          onClick={() => void runTaskAction(task, "resume")}
                        >
                          <RefreshCw />
                          继续查询
                        </Button>
                      ) : null}
                      {task.status === "submit_unknown" ? (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={submitting}
                          onClick={() => void runTaskAction(task, "abandon")}
                        >
                          确认上游无任务并放弃
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </main>

      <footer className="sticky bottom-3 z-20 mx-auto w-full max-w-3xl px-4 md:px-6">
        <div className="rounded-3xl border bg-white p-3 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          {references.length > 0 ? (
            <div className="mb-3">
              <p className="mb-2 text-[11px] text-muted-foreground">
                当前结果自动作为第 1 张参考图，新添加的参考图从第 2 张开始。
              </p>
              <div className="flex gap-2 overflow-x-auto">
                {references.map((asset, index) => (
                  <div
                    key={asset.id}
                    className="relative size-16 shrink-0 overflow-hidden rounded-2xl border bg-muted"
                  >
                    <Image
                      src={asset.previewUrl}
                      alt={`新增参考图 ${index + 1}`}
                      fill
                      unoptimized
                      sizes="64px"
                      className="object-cover"
                    />
                    <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 text-[9px] text-white">
                      {index + 2}
                    </span>
                    <button
                      type="button"
                      aria-label={`移除新增参考图 ${index + 1}`}
                      className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white"
                      onClick={() => removeReference(asset.id)}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <textarea
            rows={2}
            value={prompt}
            disabled={!canContinue || submitting || !hasEditCapability}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitEdit();
              }
            }}
            placeholder={
              canContinue
                ? hasEditCapability
                  ? "继续这个对话，描述要修改的内容…"
                  : "当前模型未开放继续编辑能力"
                : "当前对话还没有可编辑的结果"
            }
            className="max-h-36 min-h-14 w-full resize-none overflow-y-auto border-0 bg-transparent px-1 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <ComposerMenu
                label="模式"
                value={mode === "image_edit" ? "图片编辑" : "多图融合"}
                open={composerMenu === "mode"}
                onToggle={() => setComposerMenu((current) => (current === "mode" ? null : "mode"))}
                disabled={!historyModel || uploading || submitting}
                options={[
                  {
                    label: "图片编辑",
                    hint: canEdit ? "当前结果作为参考图" : "当前模型未开放",
                    selected: mode === "image_edit",
                    disabled: !canEdit,
                    onSelect: () => chooseEditMode("image_edit"),
                  },
                  {
                    label: "多图融合",
                    hint: canMultiEdit ? "当前结果 + 已添加参考图" : "当前模型未开放",
                    selected: mode === "multi_image_edit",
                    disabled: !canMultiEdit,
                    onSelect: () => chooseEditMode("multi_image_edit"),
                  },
                ]}
              />
              <ComposerMenu
                label="画面"
                value={currentSize?.orientationLabel ?? "—"}
                open={composerMenu === "orientation"}
                disabled={groupedSizes.orientations.length === 0}
                onToggle={() =>
                  setComposerMenu((current) => (current === "orientation" ? null : "orientation"))
                }
                options={groupedSizes.orientations.map((orientation) => ({
                  label: orientation.label,
                  hint: groupedSizes.options.find(
                    (option) =>
                      option.orientationKey === orientation.key &&
                      option.resolution === currentSize?.resolution,
                  )?.value,
                  selected: orientation.key === currentSize?.orientationKey,
                  onSelect: () => selectHistoryOrientation(orientation.key),
                }))}
              />
              <ComposerMenu
                label="分辨率"
                value={currentSize?.resolution ?? "—"}
                open={composerMenu === "resolution"}
                disabled={availableResolutions.length === 0}
                onToggle={() =>
                  setComposerMenu((current) => (current === "resolution" ? null : "resolution"))
                }
                options={availableResolutions.map((resolution) => ({
                  label: resolution,
                  hint: resolution === "1K" ? "当前比例可用" : "实验档，可能计入更高费用",
                  selected: resolution === currentSize?.resolution,
                  onSelect: () => selectHistoryResolution(resolution),
                }))}
              />
              {mode === "multi_image_edit" ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="hidden"
                    onChange={(event) => void uploadReferences(event.target.files)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title={
                      references.length >= maxAdditionalReferences
                        ? "参考图数量已达上限"
                        : "添加参考图"
                    }
                    aria-label="添加参考图"
                    disabled={
                      !canContinue ||
                      submitting ||
                      uploading ||
                      !canMultiEdit ||
                      maxAdditionalReferences <= 0
                    }
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
                  </Button>
                </>
              ) : null}
            </div>
            <Button
              type="button"
              size="icon"
              className="rounded-full"
              disabled={!canContinue || submitting || uploading || !prompt.trim() || !modeReady}
              title="继续编辑"
              aria-label="继续编辑"
              onClick={() => void submitEdit()}
            >
              {submitting ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
          {canContinue && !hasEditCapability ? (
            <p className="mt-2 text-[11px] text-destructive">当前模型未开放继续编辑能力。</p>
          ) : null}
        </div>
      </footer>

      <ImageViewer
        key={lightboxAsset?.id ?? "empty"}
        open={Boolean(lightboxAsset)}
        asset={lightboxAsset}
        title="查看图片"
        onClose={() => setLightboxAsset(null)}
      />
    </div>
  );
}
