'use client';

/**
 * 판서 레이어 — 지문 위에 펜·형광펜으로 쓰고, 지우개로 획 단위로 지운다.
 * 획은 지문 영역 기준 좌표(px)로 들고 있어 스크롤해도 글자에 붙어 있다.
 * 켜져 있을 때만 포인터를 받는다(꺼지면 아래 문장 클릭이 그대로 동작).
 */

import { useCallback, useEffect, useRef } from 'react';

export type InkTool = 'pen' | 'highlighter' | 'eraser';
export type InkStroke = { tool: 'pen' | 'highlighter'; color: string; width: number; points: [number, number][] };

export const INK_COLORS = ['#111827', '#dc2626', '#2563eb', '#059669'] as const;
const HIGHLIGHT_COLORS: Record<string, string> = {
  '#111827': 'rgba(250, 204, 21, 0.38)',
  '#dc2626': 'rgba(248, 113, 113, 0.32)',
  '#2563eb': 'rgba(96, 165, 250, 0.32)',
  '#059669': 'rgba(52, 211, 153, 0.32)',
};

function drawStroke(ctx: CanvasRenderingContext2D, s: InkStroke) {
  if (s.points.length === 0) return;
  ctx.save();
  ctx.lineCap = s.tool === 'highlighter' ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.tool === 'highlighter' ? HIGHLIGHT_COLORS[s.color] ?? 'rgba(250, 204, 21, 0.38)' : s.color;
  ctx.lineWidth = s.width;
  ctx.beginPath();
  const [x0, y0] = s.points[0];
  ctx.moveTo(x0, y0);
  if (s.points.length === 1) ctx.lineTo(x0 + 0.1, y0 + 0.1);
  for (let i = 1; i < s.points.length; i++) {
    const [x, y] = s.points[i];
    const [px, py] = s.points[i - 1];
    ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
  }
  ctx.stroke();
  ctx.restore();
}

function hits(s: InkStroke, x: number, y: number, r: number): boolean {
  const rr = (r + s.width / 2) ** 2;
  return s.points.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 <= rr);
}

export function LiveInkLayer({
  active,
  tool,
  color,
  strokes,
  onChange,
}: {
  active: boolean;
  tool: InkTool;
  color: string;
  strokes: InkStroke[];
  onChange: (next: InkStroke[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef<InkStroke | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of strokesRef.current) drawStroke(ctx, s);
    if (drawing.current) drawStroke(ctx, drawing.current);
  }, []);

  // 지문 영역 크기에 맞춰 캔버스를 키운다(글자 크기·창 크기가 바뀔 때마다)
  useEffect(() => {
    const c = canvasRef.current;
    const host = c?.parentElement;
    if (!c || !host) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = host.scrollWidth;
      const h = host.scrollHeight;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(redraw, [strokes, redraw]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const erase = (x: number, y: number) => {
    const next = strokesRef.current.filter((s) => !hits(s, x, y, 10));
    if (next.length !== strokesRef.current.length) onChange(next);
  };

  return (
    <canvas
      ref={canvasRef}
      className="absolute left-0 top-0 z-20"
      style={{
        pointerEvents: active ? 'auto' : 'none',
        touchAction: active ? 'none' : 'auto',
        cursor: active ? (tool === 'eraser' ? 'cell' : 'crosshair') : 'default',
      }}
      onPointerDown={(e) => {
        if (!active) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = pos(e);
        if (tool === 'eraser') return erase(...p);
        drawing.current = {
          tool,
          color,
          width: tool === 'highlighter' ? 18 : e.pointerType === 'pen' ? Math.max(1.5, 3 * (e.pressure || 0.5)) : 2.5,
          points: [p],
        };
        redraw();
      }}
      onPointerMove={(e) => {
        if (!active || e.buttons === 0) return;
        const p = pos(e);
        if (tool === 'eraser') return erase(...p);
        if (!drawing.current) return;
        drawing.current.points.push(p);
        redraw();
      }}
      onPointerUp={() => {
        if (drawing.current) {
          const s = drawing.current;
          drawing.current = null;
          onChange([...strokesRef.current, s]);
        }
      }}
      onPointerCancel={() => {
        drawing.current = null;
        redraw();
      }}
    />
  );
}
