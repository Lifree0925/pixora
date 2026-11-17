"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { Loader2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageDownloadMenu } from "@/components/ui/image-download-menu";
import { cn } from "@/lib/utils";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const SCALE_STEP = 0.25;

export interface ImageViewerAsset {
  id: string;
  mimeType: string;
  previewUrl: string;
  width: number;
  height: number;
}

interface ImageViewerProps {
  open: boolean;
  asset: ImageViewerAsset | null;
  onClose: () => void;
  title?: string;
}

interface Point {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ImageViewer({ open, asset, onClose, title = "查看图片" }: ImageViewerProps) {
  const [scale, setScale] = useState(MIN_SCALE);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(true);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ pointer: Point; origin: Point } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setScale(MIN_SCALE);
        setOffset({ x: 0, y: 0 });
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  function clampOffset(point: Point, nextScale: number): Point {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image || nextScale <= MIN_SCALE) {
      return { x: 0, y: 0 };
    }

    const maxX = Math.max(0, (image.offsetWidth * nextScale - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (image.offsetHeight * nextScale - viewport.clientHeight) / 2);
    return {
      x: clamp(point.x, -maxX, maxX),
      y: clamp(point.y, -maxY, maxY),
    };
  }

  function zoomTo(nextScale: number, anchor?: Point) {
    const clampedScale = clamp(Number(nextScale.toFixed(2)), MIN_SCALE, MAX_SCALE);
    if (clampedScale === scale) {
      return;
    }

    if (clampedScale === MIN_SCALE) {
      setScale(MIN_SCALE);
      setOffset({ x: 0, y: 0 });
      return;
    }

    const viewport = viewportRef.current;
    if (anchor && viewport) {
      const rect = viewport.getBoundingClientRect();
      const anchorX = anchor.x - rect.left - rect.width / 2;
      const anchorY = anchor.y - rect.top - rect.height / 2;
      const ratio = clampedScale / scale;
      const nextOffset = {
        x: anchorX - (anchorX - offset.x) * ratio,
        y: anchorY - (anchorY - offset.y) * ratio,
      };
      setOffset(clampOffset(nextOffset, clampedScale));
    } else {
      setOffset((current) => clampOffset(current, clampedScale));
    }
    setScale(clampedScale);
  }

  function resetViewer() {
    setScale(MIN_SCALE);
    setOffset({ x: 0, y: 0 });
  }

  function closeViewer() {
    setScale(MIN_SCALE);
    setOffset({ x: 0, y: 0 });
    onClose();
  }

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (scale <= MIN_SCALE || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointer: { x: event.clientX, y: event.clientY },
      origin: offset,
    };
    suppressClickRef.current = true;
    setDragging(true);
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    setOffset(
      clampOffset(
        {
          x: drag.origin.x + event.clientX - drag.pointer.x,
          y: drag.origin.y + event.clientY - drag.pointer.y,
        },
        scale,
      ),
    );
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) {
      return;
    }
    dragRef.current = null;
    setDragging(false);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  if (!open || !asset) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] select-none overflow-hidden bg-black/90 text-white backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={viewportRef}
        className={cn(
          "absolute inset-0 flex items-center justify-center overflow-hidden p-4",
          scale > MIN_SCALE ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
        )}
        onClick={(event) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (event.target === event.currentTarget) {
            closeViewer();
          }
        }}
        onDoubleClick={() => zoomTo(scale > MIN_SCALE ? MIN_SCALE : 2)}
        onPointerCancel={endDrag}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onWheel={(event) => {
          if (event.deltaY === 0) {
            return;
          }
          zoomTo(scale + (event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP), {
            x: event.clientX,
            y: event.clientY,
          });
        }}
      >
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
            <Loader2 className="mr-2 size-4 animate-spin" />
            正在加载图片…
          </div>
        ) : null}
        <Image
          ref={imageRef}
          src={asset.previewUrl}
          alt={title}
          width={asset.width}
          height={asset.height}
          unoptimized
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          onLoad={() => setLoading(false)}
          onError={() => setLoading(false)}
          className="max-h-[calc(100dvh-9rem)] w-auto max-w-[calc(100vw-2rem)] object-contain"
          style={{
            height: "auto",
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transformOrigin: "center center",
            transition: dragging ? "none" : "transform 120ms ease-out",
          }}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 bg-gradient-to-b from-black/60 to-transparent px-4 pb-12 pt-4">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-[11px] text-white/55">
            {asset.width} × {asset.height} · 双击切换缩放
          </p>
        </div>
        <div className="pointer-events-auto flex items-center gap-1">
          <ImageDownloadMenu
            asset={asset}
            className="text-white hover:bg-white/10 hover:text-white"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-white hover:bg-white/10 hover:text-white"
            title="关闭"
            aria-label="关闭"
            onClick={closeViewer}
          >
            <X />
          </Button>
        </div>
      </div>

      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-black/65 p-1.5 shadow-2xl backdrop-blur">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/10 hover:text-white disabled:opacity-35"
          title="缩小"
          aria-label="缩小"
          disabled={scale <= MIN_SCALE}
          onClick={() => zoomTo(scale - SCALE_STEP)}
        >
          <Minus />
        </Button>
        <span className="w-12 text-center text-xs text-white/75">{Math.round(scale * 100)}%</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/10 hover:text-white disabled:opacity-35"
          title="放大"
          aria-label="放大"
          disabled={scale >= MAX_SCALE}
          onClick={() => zoomTo(scale + SCALE_STEP)}
        >
          <Plus />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-1 text-white hover:bg-white/10 hover:text-white"
          title="重置缩放"
          aria-label="重置缩放"
          onClick={resetViewer}
        >
          <RotateCcw />
        </Button>
      </div>
    </div>,
    document.body,
  );
}
