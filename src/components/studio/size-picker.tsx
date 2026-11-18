"use client";

import { groupSizeOptions } from "@/modules/models/size-options";
import { cn } from "@/lib/utils";

type SizeOption = { label: string; value: string };

export function SizePicker({
  options,
  value,
  onChange,
}: {
  options: SizeOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const grouped = groupSizeOptions(options);
  const current = grouped.options.find((option) => option.value === value) ?? grouped.options[0];

  if (!current) {
    return null;
  }

  function selectResolution(resolution: string) {
    const next =
      grouped.options.find(
        (option) =>
          option.resolution === resolution && option.orientationKey === current.orientationKey,
      ) ?? grouped.options.find((option) => option.resolution === resolution);
    if (next) {
      onChange(next.value);
    }
  }

  function selectOrientation(orientationKey: string) {
    const next =
      grouped.options.find(
        (option) =>
          option.orientationKey === orientationKey && option.resolution === current.resolution,
      ) ?? grouped.options.find((option) => option.orientationKey === orientationKey);
    if (next) {
      onChange(next.value);
    }
  }

  return (
    <div className="mt-2 rounded-2xl border bg-background p-3">
      <div>
        <p className="text-xs font-medium">画面比例</p>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="画面比例">
          {grouped.orientations.map((orientation) => {
            const selected = current.orientationKey === orientation.key;
            return (
              <button
                key={orientation.key}
                type="button"
                aria-pressed={selected}
                onClick={() => selectOrientation(orientation.key)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-xs transition-colors",
                  selected
                    ? "border-neutral-300 bg-[#efede7] text-neutral-900"
                    : "bg-white text-muted-foreground hover:bg-muted/40",
                )}
              >
                {orientation.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 border-t pt-4">
        <p className="text-xs font-medium">分辨率</p>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="分辨率">
          {grouped.resolutions.map((resolution) => {
            const selected = current.resolution === resolution;
            return (
              <button
                key={resolution}
                type="button"
                aria-pressed={selected}
                onClick={() => selectResolution(resolution)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-xs transition-colors",
                  selected
                    ? "border-neutral-300 bg-[#efede7] text-neutral-900"
                    : "bg-white text-muted-foreground hover:bg-muted/40",
                )}
              >
                {resolution}
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        目标尺寸：{current.width} × {current.height}
      </p>
      {current.resolution !== "1K" ? (
        <p className="mt-1 text-[10px] text-amber-700">
          2K/4K 为实验性档位，可能计入更高费用，实际支持情况以渠道返回为准。
        </p>
      ) : null}
    </div>
  );
}
