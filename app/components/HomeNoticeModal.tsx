'use client';

import { useEffect, useState } from 'react';
import { MEMBERSHIP_APPLY_OPEN_EVENT } from '@/lib/membership-apply-event';
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

  // 로그인 여부를 직접 확인해 audience 를 확정한다.
  // (부모의 user 로드가 비동기라, mount 시점에는 항상 게스트로 보이는 문제 방지)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setAudience(d?.user ? 'member' : 'guest');
      })
      .catch(() => {
        if (!cancelled) setAudience('guest');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!audience) return;
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
    dismissHomeNoticeThisSession(audience ?? 'guest');
    setOpen(false);
  };

  const hideToday = () => {
    dismissHomeNoticeForTodayKst(audience ?? 'guest');
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
        <div className="bg-gradient-to-r from-rose-500 to-amber-500 px-6 py-5 text-white">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold tracking-wide">
            🎉 시험기간 마무리 이벤트
          </div>
          <h2 id="home-notice-title" className="mt-2 text-xl font-extrabold leading-snug">
            이번 시험기간 정말 수고 많으셨어요!
          </h2>
          <p className="mt-1 text-sm text-rose-50">
            고생하신 만큼, 포인트로 보답할게요 💝
          </p>
        </div>

        {/* 본문 */}
        <div className="px-6 py-5">
          <p className="mb-3 text-[13px] font-bold text-slate-500">지금 포인트 받는 세 가지 방법</p>
          <div className="space-y-3">
            {/* 1. 기출문제 업로드 */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <span className="text-xl leading-none">🎁</span>
                <div className="text-sm text-amber-900">
                  <p className="font-extrabold">
                    기출문제 올리면 <span className="text-amber-700">1건당 50,000P</span>
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-amber-800/90">
                    내 정보 &gt; 기출문제 탭에서 업로드! <b>전체 문제가 빠짐없이</b> 들어 있으면 관리자 확인 후 지급, <b>답지까지</b> 있으면 <b className="text-amber-700">60,000P</b>!
                  </p>
                </div>
              </div>
            </div>
            {/* 2. 출석 */}
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <span className="text-xl leading-none">🙌</span>
                <div className="text-sm text-indigo-900">
                  <p className="font-extrabold">
                    매일 출석하면 <span className="text-indigo-700">랜덤 100~1,000P</span>
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-indigo-800/90">
                    내 정보에서 「출석하러 가기」 버튼 한 번이면 끝! 하루 한 번 랜덤 적립돼요.
                  </p>
                </div>
              </div>
            </div>
            {/* 3. 사용법 문의 — 카톡만 해도 포인트 */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <span className="text-xl leading-none">💬</span>
                <div className="text-sm text-emerald-900">
                  <p className="font-extrabold">
                    홈페이지 사용법 물어만 봐도 <span className="text-emerald-700">포인트!</span>
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-emerald-800/90">
                    어렵게 생각 마세요. 카톡으로 <b>&ldquo;사용법 알려주세요&rdquo;</b> 한마디면 관리자가 안내드리고 포인트도 드려요.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 버튼 */}
          <div className="mt-5 flex flex-col gap-2">
            {/* 카톡 문의 — 사용법만 물어봐도 포인트 (게스트·회원 공통, 최상단 강조) */}
            <a
              href={KAKAO_INQUIRY_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#FEE500] py-3 text-sm font-extrabold text-[#3C1E1E] shadow-sm transition hover:brightness-95"
            >
              💬 카톡으로 사용법 물어보고 포인트 받기
            </a>
            {showApply ? (
              <button
                type="button"
                onClick={openApply}
                className="w-full rounded-xl bg-gradient-to-r from-rose-500 to-amber-500 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
              >
                가입 신청하고 포인트 받기
              </button>
            ) : (
              <>
                <a
                  href="/my/point-charge"
                  onClick={closeSession}
                  className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3 text-center text-sm font-bold text-white shadow-sm transition hover:opacity-90"
                >
                  💳 포인트 충전하러 가기
                </a>
                <a
                  href="/my?tab=settings"
                  onClick={closeSession}
                  className="w-full rounded-xl border border-rose-200 bg-rose-50 py-2.5 text-center text-sm font-bold text-rose-600 transition hover:bg-rose-100"
                >
                  내 정보에서 포인트 받기 →
                </a>
              </>
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
