'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * 문항 샘플을 오른쪽에서 슬라이드되는 드로어로 표시.
 * 주문서(QuestionSettings/MockExamSettings)에서
 *   window.dispatchEvent(new CustomEvent('open-sample', { detail: type }))
 * 를 보내면 열린다. 새 페이지/새 탭이 아니라 오버레이라 주문서 입력 상태가 유지된다.
 */
export default function SampleDrawer() {
  const [type, setType] = useState<string | null>(null);
  const close = useCallback(() => setType(null), []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (typeof d === 'string' && d.trim()) setType(d.trim());
    };
    window.addEventListener('open-sample', onOpen as EventListener);
    return () => window.removeEventListener('open-sample', onOpen as EventListener);
  }, []);

  useEffect(() => {
    if (!type) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [type, close]);

  const open = type !== null;

  return (
    <>
      {/* 배경 (클릭 시 닫기) */}
      <div
        onClick={close}
        aria-hidden
        className={`fixed inset-0 z-[60] bg-black/30 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      {/* 오른쪽 패널 */}
      <aside
        role="dialog"
        aria-label="문항 샘플"
        className={`fixed top-0 right-0 z-[61] h-full w-full sm:max-w-md bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <span className="text-sm font-bold text-slate-800">문항 샘플{type ? ` · ${type}` : ''}</span>
          <button
            type="button"
            onClick={close}
            aria-label="닫기"
            className="px-2 py-1 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors text-sm"
          >
            ✕ 닫기
          </button>
        </div>
        <div className="flex-1 min-h-0">
          {open && (
            <iframe
              key={type}
              src={`/sample/${encodeURIComponent(type as string)}?embed=1`}
              title="문항 샘플"
              className="w-full h-full border-0"
            />
          )}
        </div>
      </aside>
    </>
  );
}
