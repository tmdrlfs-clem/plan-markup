"use client";

// Story 5.13: the SignaturePad (UX). Drawn with the mouse, pen or a finger:
// each stroke is a smooth line in ink; the parent reads the canvas when a
// stroke ends (onInk) and clears it through the ref (clear()).

import { forwardRef, useImperativeHandle, useRef, type PointerEvent } from "react";

import { INK_COLOR } from "./signature-image";

export const PAD_WIDTH = 480;
export const PAD_HEIGHT = 160;
/** The pad's backing store: twice its CSS size, so a signature stays crisp. */
const SCALE = 2;

export type SignaturePadHandle = { clear: () => void; canvas: () => HTMLCanvasElement | null };

export const SignaturePad = forwardRef<SignaturePadHandle, { onInk: (canvas: HTMLCanvasElement) => void; label: string }>(function SignaturePad({ onInk, label }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  useImperativeHandle(ref, () => ({
    clear: () => {
      const c = canvas.current?.getContext("2d");
      if (c && canvas.current) c.clearRect(0, 0, canvas.current.width, canvas.current.height);
    },
    canvas: () => canvas.current,
  }));

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / (box.width || 1)) * e.currentTarget.width, y: ((e.clientY - box.top) / (box.height || 1)) * e.currentTarget.height };
  };
  const line = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const c = canvas.current?.getContext("2d");
    if (!c) return;
    c.strokeStyle = INK_COLOR;
    c.lineWidth = 2.5 * SCALE;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.lineTo(to.x, to.y);
    c.stroke();
  };

  return (
    <canvas
      ref={canvas}
      width={PAD_WIDTH * SCALE}
      height={PAD_HEIGHT * SCALE}
      role="img"
      aria-label={label}
      data-testid="signature-pad"
      className="block h-40 w-full max-w-[480px] touch-none rounded-sm border border-strong bg-white"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const p = point(e);
        last.current = p;
        line(p, { x: p.x + 0.1, y: p.y + 0.1 });
      }}
      onPointerMove={(e) => {
        if (!last.current) return;
        const p = point(e);
        line(last.current, p);
        last.current = p;
      }}
      onPointerUp={() => {
        if (!last.current) return;
        last.current = null;
        if (canvas.current) onInk(canvas.current);
      }}
      onPointerCancel={() => {
        last.current = null;
      }}
    />
  );
});
