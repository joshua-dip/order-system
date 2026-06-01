'use client';

import { useEffect, useState } from 'react';
import { VARIANT_PRICE } from '@/lib/variant-pricing';
import { MEMBERSHIP_APPLY_OPEN_EVENT } from '@/lib/membership-apply-event';
import {
  shouldShowHomeNotice,
  dismissHomeNoticeThisSession,
  dismissHomeNoticeForTodayKst,
} from '@/lib/home-notice-dismiss';

interface HomeNoticeModalProps {
  /** 비로그인 방문자에게만 「가입 신청」 CTA 노출 */
  showApplyCta?: boolean;
}

export default function HomeNoticeModal({ showApplyCta = false }: HomeNoticeModalProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (shouldShowHomeNotice()) setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSession();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const closeSession = () => {
    dismissHomeNoticeThisSession();
    setOpen(false);
  };

  const hideToday = () => {
    dismissHomeNoticeForTodayKst();
    setOpen(false);
  };

  const openApply = () => {
    closeSession();
    window.dispatchEvent(new Event(MEMBERSHIP_APPLY_OPEN_EVENT));
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={closeSession}
      role="dialog"
      aria-modal="true"
      aria-labelledby="home-notice-title"
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-5 text-white">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold tracking-wide">
            📣 6월 1일부터 적용
          </div>
          <h2 id="home-notice-title" className="mt-2 text-xl font-extrabold leading-snug">
            객관식 변형문제 가격 인하
          </h2>
          <p className="mt-1 text-sm text-indigo-100">
            본격 시험기간, 더 합리적인 가격으로 만나보세요.
          </p>
        </div>

        {/* 본문 */}
        <div className="px-6 py-5">
          <ul className="space-y-2.5 text-sm text-slate-700">
            <li className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
              <span className="font-medium">기본 변형문제</span>
              <span className="font-bold text-indigo-600">
                문항당 {VARIANT_PRICE.base}원
              </span>
            </li>
            <li className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
              <span className="font-medium">
                고난도 유형
                <span className="ml-1 text-xs text-slate-400">(삽입·어법 고난도)</span>
              </span>
              <span className="font-bold text-indigo-600">
                문항당 {VARIANT_PRICE.advanced}원
              </span>
            </li>
            <li className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
              <span className="font-medium">
                순서·삽입
                <span className="ml-1 text-xs text-slate-400">(문제·답만)</span>
              </span>
              <span className="font-bold text-indigo-600">
                문항당 {VARIANT_PRICE.orderInsertNoExplanation}원
              </span>
            </li>
          </ul>

          {/* 가입 쿠폰 안내 */}
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5">
            <div className="flex items-start gap-2.5">
              <span className="text-xl leading-none">🎟️</span>
              <div className="text-sm text-amber-900">
                <p className="font-bold">지금 가입 신청하면</p>
                <p className="mt-0.5 leading-relaxed">
                  포인트 구매 시 사용할 수 있는{' '}
                  <span className="font-extrabold text-amber-700">10% 할인 쿠폰</span>을 드려요.
                </p>
              </div>
            </div>
          </div>

          {/* 버튼 */}
          <div className="mt-5 flex flex-col gap-2">
            {showApplyCta && (
              <button
                type="button"
                onClick={openApply}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
              >
                가입 신청하고 쿠폰 받기
              </button>
            )}
            <button
              type="button"
              onClick={closeSession}
              className="w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
            >
              닫기
            </button>
          </div>
        </div>

        {/* 푸터 — 오늘 하루 보지 않기 */}
        <div className="border-t border-slate-100 bg-slate-50 px-6 py-3 text-center">
          <button
            type="button"
            onClick={hideToday}
            className="text-xs font-medium text-slate-400 underline-offset-2 transition hover:text-slate-600 hover:underline"
          >
            오늘 하루 보지 않기
          </button>
        </div>
      </div>
    </div>
  );
}
