"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  ArrowUp,
  Loader2,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageDownloadMenu } from "@/components/ui/image-download-menu";
import { ImageViewer } from "@/components/ui/image-viewer";
import { ComposerMenu } from "@/components/studio/composer-menu";
import { ModelPicker } from "@/components/studio/model-picker";
import { SizePicker } from "@/components/studio/size-picker";
import { cn } from "@/lib/utils";
import { fetchJson, ClientApiError } from "@/lib/client/api";
import { getTaskStatusLabel } from "@/lib/task-status";
import type {
  AssetView,
  GenerationMode,
  ModelInfo,
  ModelParameterDefinition,
  TaskView,
} from "@/types/api";

const MODE_LABELS: Record<GenerationMode, string> = {
  text_to_image: "文生图",
  image_edit: "图片编辑",
  multi_image_edit: "多图融合",
};

const MODE_HINTS: Record<GenerationMode, string> = {
  text_to_image: "仅使用提示词",
  image_edit: "使用一张参考图",
  multi_image_edit: "使用多张参考图",
};

const ACTIVE_STATUSES = new Set(["pending", "submitting", "processing"]);
const MODEL_STORAGE_KEY = "pixora.create.selected-model";

function readStoredModelId(): string {
  try {
    return window.localStorage.getItem(MODEL_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberModelId(modelId: string) {
  try {
    window.localStorage.setItem(MODEL_STORAGE_KEY, modelId);
  } catch {
    // 忽略存储不可用，模型选择在当前会话内仍然有效。
  }
}

function errorMessage(error: unknown): string {
  return error instanceof ClientApiError || error instanceof Error
    ? error.message
    : "请求失败，请稍后重试";
}

function sizeOf(model: ModelInfo | undefined): string {
  const sizeParameter = model?.parameters.find((parameter) => parameter.key === "size");
  return (
    (typeof sizeParameter?.defaultValue === "string" ? sizeParameter.defaultValue : undefined) ??
    model?.sizes[0]?.value ??
    "1024x1024"
  );
}

function extraDefaults(model: ModelInfo | undefined): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};
  for (const parameter of model?.parameters ?? []) {
    if (parameter.key !== "size" && parameter.defaultValue !== undefined) {
      values[parameter.key] = parameter.defaultValue;
    }
  }
  return values;
}

function modelCanEdit(model: ModelInfo | undefined): boolean {
  return Boolean(model?.capabilities.imageEdit);
}

function modelCanMultiEdit(model: ModelInfo | undefined): boolean {
  return Boolean(model?.capabilities.multiImageEdit);
}

function parameterSummary(task: TaskView): string {
  const values = Object.entries(task.parameters)
    .filter(([key]) => key !== "size")
    .map(([key, value]) => `${key}=${String(value)}`);
  return [task.requestedSize, ...values].join(" · ");
}

function groupParameterDefinitions(
  definitions: ModelParameterDefinition[],
): Array<[string, ModelParameterDefinition[]]> {
  const groups = new Map<string, ModelParameterDefinition[]>();
  for (const definition of definitions) {
    const group = definition.group ?? "其他";
    const items = groups.get(group) ?? [];
    items.push(definition);
    groups.set(group, items);
  }
  return [...groups.entries()];
}

export function CreateWorkspace() {
  const searchParams = useSearchParams();
  const initialTaskId = searchParams.get("taskId");

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState<GenerationMode>("text_to_image");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [extraParameters, setExtraParameters] = useState<Record<string, string | number | boolean>>(
    {},
  );
  const [assets, setAssets] = useState<AssetView[]>([]);
  const [parent, setParent] = useState<{ taskId: string; assetId: string } | null>(null);
  const [task, setTask] = useState<TaskView | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const idempotencyRef = useRef(crypto.randomUUID());
  const pollDelayRef = useRef(2000);
  const pollTimerRef = useRef<number | null>(null);

  const selectedModel = models.find((model) => model.id === modelId) ?? models[0];
  const maxReferenceImages = selectedModel?.limits?.maxReferenceImages ?? 8;
  const promptMaxChars = selectedModel?.limits?.promptMaxChars ?? 8000;
  const sizeParameter = selectedModel?.parameters.find((parameter) => parameter.key === "size");
  const sizeOptions = sizeParameter?.options ?? selectedModel?.sizes ?? [];
  const extraParameterDefinitions =
    selectedModel?.parameters.filter((parameter) => parameter.key !== "size") ?? [];
  const extraParameterGroups = groupParameterDefinitions(extraParameterDefinitions);
  const modeMenuOptions = (Object.keys(MODE_LABELS) as GenerationMode[]).map((item) => {
    const disabled =
      (item === "image_edit" && !modelCanEdit(selectedModel)) ||
      (item === "multi_image_edit" && !modelCanMultiEdit(selectedModel));
    return {
      label: MODE_LABELS[item],
      hint: disabled ? "当前模型未开放" : MODE_HINTS[item],
      selected: mode === item,
      disabled,
      onSelect: () => chooseMode(item),
    };
  });
  const busy = uploading || submitting || (task ? ACTIVE_STATUSES.has(task.status) : false);
  const output = task?.outputs[0] ?? null;

  useEffect(() => {
    void fetchJson<{ models: ModelInfo[] }>("/api/models")
      .then((data) => {
        setModels(data.models);
        const storedModelId = readStoredModelId();
        const initialModel =
          data.models.find((model) => model.id === storedModelId) ?? data.models[0];
        if (initialModel) {
          setModelId(initialModel.id);
          setSize(sizeOf(initialModel));
          setExtraParameters(extraDefaults(initialModel));
        }
      })
      .catch((fetchError) => setError(errorMessage(fetchError)));
  }, []);

  useEffect(() => {
    if (!initialTaskId) {
      return;
    }
    void fetchJson<{ task: TaskView }>(`/api/images/tasks/${initialTaskId}`)
      .then((data) => {
        setTask(data.task);
        setMode(data.task.mode);
        const taskModel = models.find((model) => model.id === data.task.model);
        if (taskModel) {
          setModelId(taskModel.id);
          setSize(data.task.requestedSize);
          setExtraParameters(
            Object.fromEntries(
              Object.entries(data.task.parameters).filter(([key]) => key !== "size"),
            ),
          );
        }
        pollDelayRef.current = 2000;
      })
      .catch((fetchError) => setError(errorMessage(fetchError)));
  }, [initialTaskId, models]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);

  useEffect(() => {
    if (!modeMenuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-composer-menu]")) {
        setModeMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModeMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modeMenuOpen]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [prompt]);

  const activeTaskId = task?.id;
  const activeTaskStatus = task?.status;

  useEffect(() => {
    if (!activeTaskId || !activeTaskStatus || !ACTIVE_STATUSES.has(activeTaskStatus)) {
      return;
    }

    let cancelled = false;
    const schedule = () => {
      pollTimerRef.current = window.setTimeout(async () => {
        try {
          const data = await fetchJson<{ task: TaskView }>(`/api/images/tasks/${activeTaskId}`);
          if (cancelled) {
            return;
          }
          setTask(data.task);
          if (ACTIVE_STATUSES.has(data.task.status)) {
            pollDelayRef.current = Math.min(30_000, Math.round(pollDelayRef.current * 1.4));
            schedule();
          }
        } catch (fetchError) {
          if (!cancelled) {
            setError(errorMessage(fetchError));
          }
        }
      }, pollDelayRef.current);
    };

    schedule();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, [activeTaskId, activeTaskStatus]);

  function selectModel(nextModel: ModelInfo) {
    rememberModelId(nextModel.id);
    if (nextModel.id === modelId) {
      setError(null);
      return;
    }

    setModelId(nextModel.id);
    setSize(sizeOf(nextModel));
    setExtraParameters(extraDefaults(nextModel));
    setError(null);

    if (mode === "image_edit" && !modelCanEdit(nextModel)) {
      setMode("text_to_image");
      setAssets([]);
      setParent(null);
    }
    if (mode === "multi_image_edit" && !modelCanMultiEdit(nextModel)) {
      setMode("text_to_image");
      setAssets([]);
      setParent(null);
    }
  }

  function chooseMode(nextMode: GenerationMode) {
    if (nextMode === "image_edit" && !modelCanEdit(selectedModel)) {
      setError("单图编辑能力尚未通过真实接口验证");
      return;
    }
    if (nextMode === "multi_image_edit" && !modelCanMultiEdit(selectedModel)) {
      setError("多图融合能力尚未通过真实接口验证");
      return;
    }

    setMode(nextMode);
    setError(null);
    if (nextMode === "text_to_image") {
      setAssets([]);
      setParent(null);
    } else if (nextMode === "image_edit") {
      setAssets((current) => current.slice(0, 1));
    } else {
      setParent(null);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }
    if (!modelCanEdit(selectedModel)) {
      setError("当前模型尚未验证图片编辑能力");
      return;
    }

    let targetMode = mode;
    if (targetMode === "text_to_image") {
      targetMode =
        files.length > 1 && modelCanMultiEdit(selectedModel) ? "multi_image_edit" : "image_edit";
      chooseMode(targetMode);
    }

    const max = targetMode === "image_edit" ? 1 : maxReferenceImages;
    if (assets.length >= max) {
      setError(
        targetMode === "image_edit" ? "单图编辑只能上传一张参考图" : `最多上传 ${max} 张参考图`,
      );
      return;
    }

    const selected = Array.from(files).slice(0, Math.max(0, max - assets.length));
    if (selected.length === 0) {
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const nextAssets = [...assets];
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
        nextAssets.push(data.asset);
        setAssets([...nextAssets]);
      }
    } catch (uploadError) {
      setError(errorMessage(uploadError));
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function removeAsset(id: string) {
    setAssets((current) => current.filter((asset) => asset.id !== id));
  }

  function moveAsset(from: number, to: number) {
    if (from === to) {
      return;
    }
    setAssets((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      if (item) {
        next.splice(to, 0, item);
      }
      return next;
    });
  }

  async function generate() {
    if (!prompt.trim() || !selectedModel) {
      setError("请先填写提示词");
      return;
    }
    if (mode === "image_edit" && !modelCanEdit(selectedModel)) {
      setError("当前模型未启用图片编辑能力");
      return;
    }
    if (mode === "multi_image_edit" && !modelCanMultiEdit(selectedModel)) {
      setError("当前模型未启用多图融合能力");
      return;
    }
    if (mode === "image_edit" && assets.length !== 1) {
      setError("图片编辑需要恰好一张参考图");
      return;
    }
    if (mode === "multi_image_edit" && assets.length < 2) {
      setError("多图融合至少需要两张参考图");
      return;
    }

    setSubmitting(true);
    setError(null);
    pollDelayRef.current = 2000;

    try {
      const created = await fetchJson<{ task: { id: string } }>("/api/images", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyRef.current },
        body: JSON.stringify({
          mode,
          modelId: selectedModel.id,
          prompt: prompt.trim(),
          size,
          parameters: extraParameters,
          assetIds: assets.map((asset) => asset.id),
          parentTaskId: parent?.taskId ?? null,
          parentAssetId: parent?.assetId ?? null,
        }),
      });

      const data = await fetchJson<{ task: TaskView }>(`/api/images/tasks/${created.task.id}`);
      setTask(data.task);
      setPrompt("");
      setAssets([]);
      setParent(null);
      idempotencyRef.current = crypto.randomUUID();
      setSettingsOpen(false);
    } catch (generateError) {
      setError(errorMessage(generateError));
    } finally {
      setSubmitting(false);
    }
  }

  async function resumeTask() {
    if (!task) {
      return;
    }
    setError(null);
    try {
      const data = await fetchJson<{ task: TaskView }>(`/api/images/tasks/${task.id}/resume`, {
        method: "POST",
      });
      setTask(data.task);
      pollDelayRef.current = 2000;
    } catch (resumeError) {
      setError(errorMessage(resumeError));
    }
  }

  async function abandonTask() {
    if (!task || !window.confirm("确认上游没有创建任务并放弃？此操作不会退款。")) {
      return;
    }
    setError(null);
    try {
      const data = await fetchJson<{ task: TaskView }>(`/api/images/tasks/${task.id}/abandon`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      setTask(data.task);
    } catch (abandonError) {
      setError(errorMessage(abandonError));
    }
  }

  function editCurrentResult() {
    if (!task || !output) {
      return;
    }
    setModelId(task.model);
    setMode("image_edit");
    setAssets([output]);
    setParent({ taskId: task.id, assetId: output.id });
    setTask(null);
    setPrompt("");
    setSize(task.requestedSize);
    setExtraParameters(
      Object.fromEntries(Object.entries(task.parameters).filter(([key]) => key !== "size")),
    );
    setError(null);
    idempotencyRef.current = crypto.randomUUID();
  }

  function resetWorkspace() {
    setTask(null);
    setPrompt("");
    setAssets([]);
    setParent(null);
    setError(null);
    idempotencyRef.current = crypto.randomUUID();
    pollDelayRef.current = 2000;
  }

  function updateExtraParameter(
    parameter: ModelParameterDefinition,
    value: string | number | boolean,
  ) {
    setExtraParameters((current) => {
      const next = { ...current, [parameter.key]: value };

      if (parameter.key === "output_format" && value === "jpeg" && next.background === "transparent") {
        next.background = "auto";
      }

      if (parameter.key === "output_format" && value === "png") {
        const compression = extraParameterDefinitions.find(
          (definition) => definition.key === "output_compression",
        );
        if (compression?.defaultValue !== undefined) {
          next.output_compression = compression.defaultValue;
        }
      }

      if (parameter.key === "background" && value === "transparent" && next.output_format === "jpeg") {
        next.output_format = "png";
      }

      return next;
    });
  }

  function openLightbox() {
    setLightboxOpen(true);
  }

  const showEmptyState = !task && !prompt.trim() && assets.length === 0;

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f7f5]">
      <header className="sticky top-0 z-20 border-b bg-[#f7f7f5]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold">创作</span>
          <Button type="button" variant="ghost" size="sm" onClick={resetWorkspace}>
            <Plus />
            新对话
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
        {error ? (
          <div className="mb-4 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {showEmptyState ? (
          <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl border bg-white shadow-sm">
              <Sparkles className="size-5 text-muted-foreground" />
            </div>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight">今天想创作什么？</h1>
          </div>
        ) : (
          <div className="space-y-5 pb-8">
            {task ? (
              <>
                <div className="flex justify-center">
                  <div className="max-w-[85%] rounded-3xl border border-black/5 bg-[#efede8] px-4 py-3 text-sm leading-6 text-neutral-900">
                    <p className="whitespace-pre-wrap">{task.prompt}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                      <span>{task.modelName}</span>
                      <span>·</span>
                      <span>{MODE_LABELS[task.mode]}</span>
                      <span>·</span>
                      <span>{parameterSummary(task)}</span>
                    </div>
                    {task.inputs.length > 0 ? (
                      <div className="mt-3 flex gap-2 overflow-x-auto">
                        {task.inputs.map((asset, index) => (
                          <div
                            key={asset.id}
                            className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-white/80 ring-1 ring-black/5"
                          >
                            <Image
                              src={asset.previewUrl}
                              alt={`参考图 ${index + 1}`}
                              fill
                              unoptimized
                              sizes="56px"
                              className="object-cover"
                            />
                            <span className="absolute bottom-0 left-0 rounded-tr bg-white/90 px-1 text-[9px] text-neutral-700">
                              {index + 1}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                {ACTIVE_STATUSES.has(task.status) ? (
                  <div className="flex w-fit items-center gap-2 rounded-full border bg-white/80 px-3 py-2 text-xs text-muted-foreground shadow-sm">
                    <Loader2 className="size-3.5 animate-spin" />
                    正在生成，通常需要 1–3 分钟
                  </div>
                ) : output ? (
                  <div className="mx-auto w-full max-w-[92%]">
                    <button
                      type="button"
                      className="relative mx-auto block w-fit max-w-full"
                      onClick={openLightbox}
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
                    <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {output.width} × {output.height}
                      </span>
                      <ImageDownloadMenu asset={output} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        title="再次编辑"
                        aria-label="再次编辑"
                        onClick={editCurrentResult}
                      >
                        <RotateCcw />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto flex max-w-[92%] flex-col items-center gap-2 text-center">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {getTaskStatusLabel(task.status)}
                    </div>

                    {task.status === "timed_out" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => void resumeTask()}
                      >
                        <RefreshCw />
                        继续查询
                      </Button>
                    ) : null}

                    {task.status === "submit_unknown" ? (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs leading-5 text-amber-700">
                          提交结果不确定，请先核对上游是否已创建任务，不要重复提交。
                        </p>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => void abandonTask()}
                        >
                          确认上游无任务并放弃
                        </Button>
                      </div>
                    ) : null}

                    {task.errorMessage ? (
                      <p className="mt-2 text-xs leading-5 text-destructive">{task.errorMessage}</p>
                    ) : null}
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
      </main>

      <div className="sticky bottom-0 z-20 bg-gradient-to-t from-[#f7f7f5] via-[#f7f7f5] to-transparent pt-6">
        <div className="mx-auto w-full max-w-3xl px-4 pb-4">
          <div className="rounded-3xl border bg-white p-3 shadow-lg shadow-black/5">
            {assets.length > 0 ? (
              <div className="mb-3 flex gap-2 overflow-x-auto">
                {assets.map((asset, index) => (
                  <div
                    key={asset.id}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragIndex !== null) {
                        moveAsset(dragIndex, index);
                      }
                      setDragIndex(null);
                    }}
                    className="relative size-16 shrink-0 overflow-hidden rounded-2xl border bg-muted"
                  >
                    <Image
                      src={asset.previewUrl}
                      alt={`参考图 ${index + 1}`}
                      fill
                      unoptimized
                      sizes="64px"
                      className="object-cover"
                    />
                    <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 text-[9px] text-white">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      aria-label={`移除参考图 ${index + 1}`}
                      className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white"
                      onClick={() => removeAsset(asset.id)}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <textarea
              ref={textareaRef}
              rows={1}
              value={prompt}
              maxLength={promptMaxChars}
              aria-label="提示词"
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void generate();
                }
              }}
              placeholder="描述你想生成的画面，或上传参考图后说明修改要求…"
              className="max-h-40 min-h-11 w-full resize-none overflow-y-auto border-0 bg-transparent px-1 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground"
            />

            <div className="mt-1 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <ComposerMenu
                  label="模式"
                  value={MODE_LABELS[mode]}
                  open={modeMenuOpen}
                  onToggle={() => setModeMenuOpen((current) => !current)}
                  disabled={!selectedModel || uploading}
                  options={modeMenuOptions}
                />
                {mode !== "text_to_image" ? (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      className="hidden"
                      onChange={(event) => void uploadFiles(event.target.files)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="添加参考图"
                      aria-label="添加参考图"
                      disabled={uploading || busy || !modelCanEdit(selectedModel)}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
                    </Button>
                  </>
                ) : null}
                {prompt.length > promptMaxChars * 0.8 ? (
                  <span className="text-[11px] text-muted-foreground">
                    {prompt.length}/{promptMaxChars}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                {selectedModel ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="max-w-[190px] rounded-full px-2 text-xs text-muted-foreground hover:text-foreground"
                    title={`创作设置 · ${selectedModel.name}`}
                    aria-label={`创作设置 · ${selectedModel.name}`}
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings2 />
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        selectedModel.verified ? "bg-emerald-500" : "bg-amber-500",
                      )}
                    />
                    <span className="truncate">{selectedModel.name}</span>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title="创作设置"
                    aria-label="创作设置"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings2 />
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon"
                  className="rounded-full"
                  disabled={busy || !prompt.trim()}
                  title="生成"
                  aria-label="生成"
                  onClick={() => void generate()}
                >
                  {busy || submitting ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <button
            type="button"
            aria-label="关闭设置"
            className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
            onClick={() => setSettingsOpen(false)}
          />
          <div className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">创作设置</h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="关闭"
                aria-label="关闭"
                onClick={() => setSettingsOpen(false)}
              >
                <X />
              </Button>
            </div>

            <ModelPicker
              models={models}
              selectedModelId={selectedModel?.id ?? ""}
              onSelect={selectModel}
            />

            <section className="mt-5">
              <p className="text-xs font-medium text-muted-foreground">参数</p>
              {sizeParameter ? (
                <div className="mt-2">
                  <p className="mb-2 text-xs">{sizeParameter.label}</p>
                  <SizePicker options={sizeOptions} value={size} onChange={setSize} />
                </div>
              ) : null}

              {extraParameterGroups.length > 0 ? (
                <div className="mt-4 space-y-5">
                  {extraParameterGroups.map(([group, definitions]) => (
                    <div key={group}>
                      <p className="mb-2 text-[11px] font-medium text-muted-foreground">{group}</p>
                      <div className="space-y-3">
                        {definitions.map((parameter) => {
                          const disabled =
                            parameter.key === "output_compression" &&
                            extraParameters.output_format === "png";
                          return (
                            <div key={parameter.key}>
                              <p className="mb-1 text-xs">{parameter.label}</p>
                              {parameter.type === "enum" && parameter.options ? (
                                <div className="flex flex-wrap gap-2">
                                  {parameter.options.map((option) => (
                                    <button
                                      key={option.value}
                                      type="button"
                                      onClick={() => updateExtraParameter(parameter, option.value)}
                                      className={cn(
                                        "rounded-xl border px-3 py-1.5 text-xs",
                                        extraParameters[parameter.key] === option.value
                                          ? "border-neutral-300 bg-[#efede7] text-neutral-900"
                                          : "bg-background text-muted-foreground",
                                      )}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                              ) : parameter.type === "boolean" ? (
                                <button
                                  type="button"
                                  disabled={disabled}
                                  onClick={() =>
                                    updateExtraParameter(
                                      parameter,
                                      !Boolean(extraParameters[parameter.key]),
                                    )
                                  }
                                  className={cn(
                                    "rounded-xl border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-45",
                                    extraParameters[parameter.key]
                                      ? "border-neutral-300 bg-[#efede7] text-neutral-900"
                                      : "bg-background text-muted-foreground",
                                  )}
                                >
                                  {extraParameters[parameter.key] ? "开启" : "关闭"}
                                </button>
                              ) : (
                                <input
                                  type={parameter.type === "number" ? "number" : "text"}
                                  value={String(extraParameters[parameter.key] ?? "")}
                                  min={parameter.min}
                                  max={parameter.max}
                                  step={parameter.step}
                                  disabled={disabled}
                                  onChange={(event) =>
                                    updateExtraParameter(
                                      parameter,
                                      parameter.type === "number"
                                        ? Number(event.target.value)
                                        : event.target.value,
                                    )
                                  }
                                  className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-45"
                                />
                              )}
                              {parameter.help ? (
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  {disabled ? "PNG 输出不使用压缩质量参数。" : parameter.help}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  当前模型没有额外可配置参数。
                </p>
              )}
            </section>

            <Button
              type="button"
              className="mt-6 w-full rounded-xl"
              onClick={() => setSettingsOpen(false)}
            >
              完成
            </Button>
          </div>
        </div>
      ) : null}

      <ImageViewer
        key={output?.id ?? "empty"}
        open={lightboxOpen}
        asset={output}
        title="生成结果"
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}
