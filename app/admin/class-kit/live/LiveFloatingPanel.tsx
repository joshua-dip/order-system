'use client';

/**
 * 떠 있는 패널 — 머리를 잡고 끌어 옮기고, 오른쪽 아래 모서리로 크기를 바꾼다.
 * 위치·크기는 storageKey 로 기억해 다음 수업에도 같은 자리에 뜬다.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

type Box = { x: number; y: number; w: number; h: number };

function clampBox(b: Box): Box {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(b.w, 320), vw - 16);
  const h = Math.min(Math.max(b.h, 200), vh - 16);
  return { w, h, x: Math.min(Math.max(b.x, 8), vw - w - 8), y: Math.min(Math.max(b.y, 8), vh - h - 8) };
}

export function LiveFloatingPanel({
  storageKey,
  defaultBox,
  title,
  headerExtra,
  onClose,
  children,
  accent = 'emerald',
}: {
  storageKey: string;
  defaultBox: () => Box;
  title: ReactNode;
  headerExtra?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  accent?: 'emerald' | 'sky';
}) {
  const [box, setBox] = useState<Box | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  // 저장된 위치 복원(마운트 후 — SSR 과 첫 렌더를 맞춘다)
  useEffect(() => {
    let b = defaultBox();
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) b = { ...b, ...(JSON.parse(raw) as Partial<Box>) };
    } catch {
      /* ignore */
    }
    setBox(clampBox(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const save = (b: Box) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(b));
    } catch {
      /* ignore */
    }
  };

  // 모서리로 크기를 바꾸면 저장
  useEffect(() => {
    const el = ref.current;
    if (!el || !box) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (Math.abs(r.width - box.w) > 2 || Math.abs(r.height - box.h) > 2) {
        const next = { ...box, w: r.width, h: r.height };
        setBox(next);
        save(next);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box?.x, box?.y]);

  if (!box) return null;
  const ring = accent === 'sky' ? 'ring-sky-400/70' : 'ring-emerald-400/70';

  return (
    <div
      ref={ref}
      role="dialog"
      className={`fixed z-[60] flex flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl ring-2 ${ring}`}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, resize: 'both' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="flex shrink-0 cursor-move select-none items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { dx: e.clientX - box.x, dy: e.clientY - box.y };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setBox(clampBox({ ...box, x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }));
        }}
        onPointerUp={() => {
          if (drag.current) save(box);
          drag.current = null;
        }}
      >
        <span className="text-slate-300" aria-hidden>
          ⠿
        </span>
        <div className="min-w-0 flex-1 truncate text-sm font-bold">{title}</div>
        {headerExtra}
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          aria-label="닫기"
          title="닫기 (Esc)"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
