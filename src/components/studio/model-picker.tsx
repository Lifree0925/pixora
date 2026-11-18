"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ModelInfo } from "@/types/api";

export function ModelPicker({
  models,
  selectedModelId,
  onSelect,
}: {
  models: ModelInfo[];
  selectedModelId: string;
  onSelect: (model: ModelInfo) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedModel = models.find((model) => model.id === selectedModelId);

  return (
    <section className="mt-5">
      <p className="text-xs font-medium text-muted-foreground">模型</p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="model-picker-options"
        disabled={models.length === 0}
        onClick={() => setOpen((current) => !current)}
        className="mt-2 flex w-full items-center justify-between gap-3 rounded-2xl border bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted/40 disabled:cursor-wait disabled:opacity-60"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {selectedModel?.name ?? "正在加载模型…"}
          </span>
          {selectedModel ? (
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {selectedModel.provider} · {selectedModel.id}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          id="model-picker-options"
          className="mt-2 max-h-72 overflow-y-auto rounded-2xl border bg-white p-1.5 shadow-sm"
        >
          {models.map((model) => {
            const selected = selectedModel?.id === model.id;
            return (
              <button
                key={model.id}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  onSelect(model);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full rounded-xl px-3 py-2 text-left transition-colors",
                  selected ? "bg-[#f5f2ec] text-neutral-900" : "hover:bg-muted/50",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{model.name}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {model.provider} · {model.id}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
