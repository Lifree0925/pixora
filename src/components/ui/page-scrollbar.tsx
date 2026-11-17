"use client";

import { useCallback, useEffect, useRef } from "react";

const TRACK_INSET = 8;
const THUMB_SCALE = 0.25;
const MIN_THUMB_HEIGHT = 36;

export function PageScrollbar() {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerY: number;
    scrollY: number;
    travel: number;
    maxScroll: number;
  } | null>(null);

  const updateThumb = useCallback(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) {
      return;
    }

    const documentHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    );
    const viewportHeight = window.innerHeight;
    const maxScroll = Math.max(0, documentHeight - viewportHeight);
    const trackHeight = Math.max(0, track.clientHeight);

    if (maxScroll <= 1 || trackHeight <= 0) {
      thumb.style.opacity = "0";
      thumb.style.pointerEvents = "none";
      return;
    }

    const naturalThumbHeight = (viewportHeight / documentHeight) * trackHeight;
    const thumbHeight = Math.max(MIN_THUMB_HEIGHT, naturalThumbHeight * THUMB_SCALE);
    const travel = Math.max(0, trackHeight - thumbHeight);
    const progress = Math.min(1, Math.max(0, window.scrollY / maxScroll));

    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${progress * travel}px)`;
    thumb.style.opacity = "1";
    thumb.style.pointerEvents = "auto";
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) {
      return;
    }

    let frame = 0;
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateThumb);
    };

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(document.body);
    resizeObserver.observe(track);

    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    window.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    updateThumb();
    scheduleMeasure();

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [updateThumb]);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    const thumb = thumbRef.current;
    const track = trackRef.current;
    if (!thumb || !track || event.button !== 0) {
      return;
    }

    const documentHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    );
    const maxScroll = Math.max(0, documentHeight - window.innerHeight);
    const travel = Math.max(0, track.clientHeight - thumb.offsetHeight);
    if (maxScroll <= 0 || travel <= 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerY: event.clientY,
      scrollY: window.scrollY,
      travel,
      maxScroll,
    };
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }

    const nextScroll =
      drag.scrollY + ((event.clientY - drag.pointerY) / drag.travel) * drag.maxScroll;
    window.scrollTo({ top: Math.min(drag.maxScroll, Math.max(0, nextScroll)) });
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
    <div
      ref={trackRef}
      aria-hidden="true"
      className="fixed right-1 z-[55] hidden w-3 md:block"
      style={{ top: TRACK_INSET, bottom: TRACK_INSET }}
    >
      <div
        ref={thumbRef}
        className="absolute right-0 w-1.5 cursor-grab rounded-full bg-neutral-400/40 opacity-0 transition-[background-color] hover:bg-neutral-500/55 active:cursor-grabbing"
        onPointerCancel={endDrag}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      />
    </div>
  );
}
