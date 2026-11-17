"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const MIN_THUMB_SIZE = 56;
const MAX_THUMB_SIZE = 176;
const TRACK_INSET = 8;

interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
}

export function ScrollArea({ children, className }: ScrollAreaProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerY: number;
    scrollTop: number;
    travel: number;
    maxScroll: number;
  } | null>(null);

  const updateThumb = useCallback(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!viewport || !track || !thumb) {
      return;
    }

    const overflow = viewport.scrollHeight - viewport.clientHeight;
    if (overflow <= 1) {
      thumb.style.opacity = "0";
      thumb.style.pointerEvents = "none";
      return;
    }

    const trackHeight = Math.max(0, track.clientHeight);
    const naturalHeight = (viewport.clientHeight / viewport.scrollHeight) * trackHeight;
    const thumbHeight = Math.min(MAX_THUMB_SIZE, Math.max(MIN_THUMB_SIZE, naturalHeight));
    const travel = Math.max(0, trackHeight - thumbHeight);
    const progress = Math.min(1, Math.max(0, viewport.scrollTop / overflow));

    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${progress * travel}px)`;
    thumb.style.opacity = "1";
    thumb.style.pointerEvents = "auto";
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const track = trackRef.current;
    if (!viewport || !track) {
      return;
    }

    let frame = 0;
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateThumb);
    };

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(viewport);
    resizeObserver.observe(track);
    if (content) {
      resizeObserver.observe(content);
    }

    viewport.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    updateThumb();
    scheduleMeasure();

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      viewport.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [updateThumb]);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!viewport || !track || !thumb || event.button !== 0) {
      return;
    }

    const travel = Math.max(0, track.clientHeight - thumb.offsetHeight);
    const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    if (travel <= 0 || maxScroll <= 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerY: event.clientY,
      scrollTop: viewport.scrollTop,
      travel,
      maxScroll,
    };
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport) {
      return;
    }

    viewport.scrollTop = Math.min(
      drag.maxScroll,
      Math.max(
        0,
        drag.scrollTop + ((event.clientY - drag.pointerY) / drag.travel) * drag.maxScroll,
      ),
    );
    updateThumb();
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div className={cn("group relative min-h-0", className)}>
      <div ref={viewportRef} className="scrollbar-none h-full overflow-y-auto overscroll-contain">
        <div ref={contentRef}>{children}</div>
      </div>
      <div
        ref={trackRef}
        className="pointer-events-none absolute right-1 w-3"
        style={{ top: TRACK_INSET, bottom: TRACK_INSET }}
        aria-hidden="true"
      >
        <div
          ref={thumbRef}
          className="ml-auto w-1.5 cursor-grab rounded-full bg-neutral-400/35 opacity-0 transition-[background-color,opacity] hover:bg-neutral-500/50 active:cursor-grabbing group-hover:opacity-100"
          onPointerCancel={endDrag}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
        />
      </div>
    </div>
  );
}
