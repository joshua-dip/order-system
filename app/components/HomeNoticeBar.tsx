'use client';

import { useEffect, useState } from 'react';
import type { HomeNoticePublic } from '@/lib/home-notices';

/**
 * 홈 상단 한 줄 공지 배너.
 *
 * 팝업 모달에 안내를 다 담기 어려워, 짧은 한 줄만 홈에 계속 띄우고 누르면 상세를 연다.
 * 공지가 여러 개면 일정 간격으로 돌아가며 보여 준다.
 *
 * 본문은 평문으로만 렌더한다(줄바꿈만 유지 — HTML 주입 금지).
 */
const ROTATE_MS = 6000;

export default function HomeNoticeBar() {
  const [notices, setNotices] = useState<HomeNoticePublic[]>([]);
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState<HomeNoticePublic | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/public/home-notices', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (alive && Array.isArray(d?.notices)) setNotices(d.notices);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 여러 개면 순환 — 상세를 열어 둔 동안에는 멈춘다
  useEffect(() => {
    if (notices.length < 2 || open) return;
    const t = window.setInterval(() => setIdx((i) => (i + 1) % notices.length), ROTATE_MS);
    return () => window.clearInterval(t);
  }, [notices.length, open]);

  // 상세 모달 — Esc 로 닫기 + 배경 스크롤 잠금
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (notices.length === 0) return null;
  const current = notices[Math.min(idx, notices.length - 1)];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(current)}
        className="mb-3 flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50/40"
      >
        <span className="shrink-0 text-base leading-none">📢</span>
        {current.badge && (
          <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
            {current.badge}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-700">
          {current.title}
        </span>
        {notices.length > 1 && (
          <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
            {idx + 1}/{notices.length}
          </span>
        )}
        <span className="shrink-0 text-[12px] font-bold text-indigo-600">자세히 →</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-black/60"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="home-notice-bar-title"
        >
          <div className="flex min-h-full items-center justify-center p-4">
            <div
              className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-5">
                <span className="text-xl leading-none">📢</span>
                <div className="min-w-0 flex-1">
                  {open.badge && (
                    <span className="mb-1 inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                      {open.badge}
                    </span>
                  )}
                  <h2 id="home-notice-bar-title" className="text-base font-extrabold leading-snug text-slate-900">
                    {open.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  aria-label="닫기"
                  className="shrink-0 rounded-lg px-2 py-1 text-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>

              {open.body && (
                <div className="px-6 py-5">
                  <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-700">{open.body}</p>
                </div>
              )}

              <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
                {open.linkUrl && (
                  <a
                    href={open.linkUrl}
                    onClick={() => setOpen(null)}
                    className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-sky-500 py-2.5 text-center text-sm font-bold text-white no-underline transition hover:opacity-90"
                  >
                    {open.linkLabel || '바로가기 →'}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  className="w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
