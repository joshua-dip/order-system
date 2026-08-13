'use client';

import { useEffect, useRef, useState } from 'react';
import { MEMBERSHIP_APPLY_OPEN_EVENT } from '@/lib/membership-apply-event';
import { getAuthUserCache } from '@/lib/auth-user-cache';
import { FREE_VARIANT_TYPES } from '@/lib/variant-pricing';
import {
  shouldShowHomeNotice,
  dismissHomeNoticeThisSession,
  dismissHomeNoticeForTodayKst,
  type HomeNoticeAudience,
} from '@/lib/home-notice-dismiss';

/** 문의용 카카오톡 오픈채팅 (사이트 전역에서 쓰는 링크와 동일) */
const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

interface HomeNoticeModalProps {
  /** 비로그인 방문자에게만 「가입 신청」 CTA 노출 (로그인 상태 확정 전 초기 힌트) */
  showApplyCta?: boolean;
}

export default function HomeNoticeModal({ showApplyCta = false }: HomeNoticeModalProps) {
  const [open, setOpen] = useState(false);
  /** 로그인 상태 확정 후의 대상(게스트/회원). 확정 전에는 노출 결정을 미룬다. */
  const [audience, setAudience] = useState<HomeNoticeAudience | null>(null);

  /** 사용자가 한 번 닫았으면 audience 가 뒤늦게 바뀌어도 다시 열지 않는다 */
  const dismissedRef = useRef(false);

  // ① 마운트 직후 — 표시 캐시로 audience 를 즉시 확정한다.
  //    예전에는 auth/me 응답을 기다렸는데, 콜드스타트면 수 초 뒤에야 모달이 떠서
  //    「페이지 다 뜬 줄 알고 누른 첫 클릭」을 모달 배경이 삼켜 버렸다(로그인 버튼이 안 눌리는 원인).
  //    ⚠️ useState 초기값으로 스토리지를 읽으면 하이드레이션이 깨지므로 반드시 mount effect 에서 복원.
  useEffect(() => {
    setAudience(getAuthUserCache<{ loginId?: string }>() ? 'member' : 'guest');
  }, []);

  // ② auth/me 로 보정 — 캐시가 없거나(첫 방문) 만료된 경우만 값이 달라진다.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setAudience(d?.user ? 'member' : 'guest');
      })
      .catch(() => {
        if (!cancelled) setAudience((prev) => prev ?? 'guest');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!audience || dismissedRef.current) return;
    if (shouldShowHomeNotice(audience)) setOpen(true);
  }, [audience]);

  // audience 확정 후에는 실제 로그인 상태로 CTA 결정 (prop 은 초기 힌트일 뿐)
  const showApply = audience ? audience === 'guest' : showApplyCta;

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
    dismissedRef.current = true;
    dismissHomeNoticeThisSession(audience ?? 'guest');
    setOpen(false);
  };

  const hideToday = () => {
    dismissedRef.current = true;
    dismissHomeNoticeForTodayKst(audience ?? 'guest');
    setOpen(false);
  };

  const openApply = () => {
    closeSession();
    window.dispatchEvent(new Event(MEMBERSHIP_APPLY_OPEN_EVENT));
  };

  return (
    // 모달 내용이 화면보다 길어질 수 있으므로(작은 폰·가로 모드) 배경 자체를 스크롤 컨테이너로 둔다.
    // items-center + 고정 높이로 두면 위아래가 잘린 채 스크롤도 안 돼 「닫기」에 닿지 못한다.
    <div
      className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-black/60"
      onClick={closeSession}
      role="dialog"
      aria-modal="true"
      aria-labelledby="home-notice-title"
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
        {/* 헤더 */}
        <div className="bg-gradient-to-r from-indigo-600 to-sky-500 px-6 py-5 text-white">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold tracking-wide">
            📚 2학기 중간고사 대비
          </div>
          <h2 id="home-notice-title" className="mt-2 text-xl font-extrabold leading-snug">
            2학기 중간고사, 지금부터 준비하세요
          </h2>
          <p className="mt-1 text-sm text-indigo-50">
            시험 범위만 고르면 변형문제·예비 시험지까지 한 번에
          </p>
        </div>

        {/* 본문 */}
        <div className="px-6 py-5">
          <p className="mb-3 text-[13px] font-bold text-slate-500">시험 대비, 이렇게 준비하세요</p>
          <div className="space-y-3">
            {/* 1. 기본 유형 무료 */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <span className="text-xl leading-none">🆓</span>
                <div className="text-sm text-emerald-900">
                  <p className="font-extrabold">
                    기본 유형 {FREE_VARIANT_TYPES.length}종은 <span className="text-emerald-700">문항당 0원</span>
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-emerald-800/90">
                    <b>{FREE_VARIANT_TYPES.join(' · ')}</b> 유형을 무료로 드려요. 유료 유형을 하나 이상 고른 주문에 추가 비용 없이 함께 담깁니다.
                  </p>
                </div>
              </div>
            </div>
            {/* 2. 변형문제 */}
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <span className="text-xl leading-none">📝</span>
                <div className="text-sm text-indigo-900">
                  <p className="font-extrabold">
                    시험 범위만 고르면 <span className="text-indigo-700">변형문제 자동 생성</span>
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-indigo-800/90">
                    교재·회차와 지문만 선택하세요. 객관식 · 서술형 · 워크북 어법까지 지문 하나로 만들어 드립니다.
                  </p>
                </div>
              </div>
            </div>
            {/* 3. 파이널 예비 모의고사 */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <span className="text-xl leading-none">🎯</span>
                <div className="text-sm text-amber-900">
                  <p className="font-extrabold">
                    시험 범위 그대로 <span className="text-amber-700">예비 시험지</span>
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-amber-800/90">
                    파이널 예비 모의고사로 실전 시험지를 바로 제작해요. QR 자가채점까지 됩니다(연회원 · 월구독).
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 버튼 */}
          <div className="mt-5 flex flex-col gap-2">
            {showApply ? (
              <button
                type="button"
                onClick={openApply}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-sky-500 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
              >
                가입 신청하고 시험 대비 시작하기
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={closeSession}
                  className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-sky-500 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
                >
                  시험 범위 정하고 주문 시작하기
                </button>
                <a
                  href="/my/point-charge"
                  onClick={closeSession}
                  className="w-full rounded-xl border border-indigo-200 bg-indigo-50 py-2.5 text-center text-sm font-bold text-indigo-600 transition hover:bg-indigo-100"
                >
                  💳 포인트 충전하러 가기 →
                </a>
              </>
            )}
            {/* 카톡 문의 — 사용법만 물어봐도 포인트 (게스트·회원 공통) */}
            <a
              href={KAKAO_INQUIRY_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#FEE500] py-3 text-sm font-extrabold text-[#3C1E1E] shadow-sm transition hover:brightness-95"
            >
              💬 카톡으로 사용법 물어보고 포인트 받기
            </a>
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
    </div>
  );
}
