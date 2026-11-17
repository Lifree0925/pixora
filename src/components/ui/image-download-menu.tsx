"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ImageDownloadMenuProps {
  asset: {
    id: string;
    mimeType: string;
    width: number;
    height: number;
  };
  className?: string;
}

const SIZE_OPTIONS = [
  { value: "original", label: "原图", hint: "原始文件" },
  { value: "1024", label: "1K", hint: "长边 1024" },
  { value: "1536", label: "1.5K", hint: "长边 1536" },
  { value: "2048", label: "2K", hint: "长边 2048" },
  { value: "4096", label: "4K", hint: "长边 4096" },
] as const;

const FORMAT_OPTIONS = [
  { value: "original", label: "原格式" },
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
] as const;

type SizeOption = (typeof SIZE_OPTIONS)[number]["value"];
type FormatOption = (typeof FORMAT_OPTIONS)[number]["value"];

function downloadUrl(assetId: string, size: SizeOption, format: FormatOption, quality: number) {
  if (size === "original" && format === "original") {
    return `/api/assets/${assetId}/download`;
  }
  const query = new URLSearchParams({ size, format, quality: String(quality) });
  return `/api/assets/${assetId}/export?${query.toString()}`;
}

export function ImageDownloadMenu({ asset, className }: ImageDownloadMenuProps) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<SizeOption>("original");
  const [format, setFormat] = useState<FormatOption>("original");
  const [quality, setQuality] = useState(90);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function openDialog() {
    setSize("original");
    setFormat("original");
    setQuality(90);
    setOpen(true);
  }

  function startDownload() {
    const anchor = document.createElement("a");
    anchor.href = downloadUrl(asset.id, size, format, quality);
    anchor.download = "";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setOpen(false);
  }

  const usesCompression = format === "jpeg" || format === "webp";
  const isUpscale = size !== "original" && Number(size) > Math.max(asset.width, asset.height);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={className}
        title="下载选项"
        aria-label="下载选项"
        onClick={openDialog}
      >
        <Download />
      </Button>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <button
                type="button"
                className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
                aria-label="关闭下载选项"
                onClick={() => setOpen(false)}
              />
              <div
                className="relative w-full max-w-md rounded-3xl border bg-white p-5 shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-label="下载选项"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold">下载图片</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      原图 {asset.width} × {asset.height}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title="关闭"
                    aria-label="关闭"
                    onClick={() => setOpen(false)}
                  >
                    <X />
                  </Button>
                </div>

                <section className="mt-5">
                  <p className="text-xs font-medium text-muted-foreground">分辨率</p>
                  <div className="mt-2 grid grid-cols-5 gap-1.5">
                    {SIZE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setSize(option.value)}
                        title={option.hint}
                        className={cn(
                          "rounded-xl border px-1 py-2 text-xs transition-colors",
                          size === option.value
                            ? "border-neutral-300 bg-[#efede7] text-neutral-900"
                            : "text-muted-foreground hover:bg-muted/40",
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="mt-4">
                  <p className="text-xs font-medium text-muted-foreground">格式</p>
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {FORMAT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setFormat(option.value)}
                        className={cn(
                          "rounded-xl border px-2 py-2 text-xs transition-colors",
                          format === option.value
                            ? "border-neutral-300 bg-[#efede7] text-neutral-900"
                            : "text-muted-foreground hover:bg-muted/40",
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </section>

                {usesCompression ? (
                  <section className="mt-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground">清晰度</p>
                      <span className="text-xs font-medium">{quality}%</span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={100}
                      step={5}
                      value={quality}
                      onChange={(event) => setQuality(Number(event.target.value))}
                      className="mt-2 w-full accent-neutral-800"
                      aria-label="压缩质量"
                    />
                  </section>
                ) : null}

                <p className="mt-4 rounded-xl bg-[#f7f7f5] px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                  {isUpscale
                    ? "所选尺寸大于原图，导出时会重采样放大，不会增加真实细节。"
                    : "导出只改变文件尺寸或格式，不会修改原图内容。"}
                </p>

                <Button type="button" className="mt-5 w-full rounded-xl" onClick={startDownload}>
                  <Download />
                  下载
                </Button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
