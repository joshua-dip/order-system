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
import { fetchAuthMe } from '@/lib/auth-me-cache';

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
    fetchAuthMe()
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
        {/* 헤더 — 차콜 단색 + 포인트 1색(하늘). 그라데이션·다색 박스는 쓰지 않는다 */}
        <div className="bg-slate-900 px-6 py-5 text-white">
          <span className="inline-block rounded bg-sky-500 px-2 py-0.5 text-[11px] font-bold">NEW</span>
          <h2 id="home-notice-title" className="mt-2 text-lg font-extrabold leading-snug">
            순서·삽입, 이제 웹에서 바로 연습하세요
          </h2>
          <p className="mt-1 text-[13px] text-slate-300">모의고사 문항을 풀면 바로 채점 · 해설까지 (회원 무료)</p>
        </div>

        {/* 본문 — 한 줄씩 */}
        <div className="px-6 py-5">
          <ul className="divide-y divide-slate-100 text-sm">
            <li className="flex gap-3 py-2.5">
              <span className="w-5 shrink-0 text-center">✍️</span>
              <p className="text-slate-800">
                <b>순서·삽입 연습</b> <span className="text-slate-500">— 회차·문항 수 골라 한 문항씩 풀기</span>
              </p>
            </li>
            <li className="flex gap-3 py-2.5">
              <span className="w-5 shrink-0 text-center">🆓</span>
              <p className="text-slate-800">
                <b>기본난도 {FREE_VARIANT_TYPES.length}종 0원</b>{' '}
                <span className="text-slate-500">— 유료 유형과 함께 주문 시 (고난도 제외)</span>
              </p>
            </li>
            <li className="flex gap-3 py-2.5">
              <span className="w-5 shrink-0 text-center">🎯</span>
              <p className="text-slate-800">
                <b>파이널 예비 모의고사</b>{' '}
                <span className="text-slate-500">— 범위만 고르면 PDF 즉시 (연회원·월구독)</span>
              </p>
            </li>
            <li className="flex gap-3 py-2.5">
              <span className="w-5 shrink-0 text-center">💬</span>
              <p className="text-slate-800">
                <b>사용법 문의하면 포인트</b> <span className="text-slate-500">— 카톡 한마디면 충분해요</span>
              </p>
            </li>
          </ul>

          {/* 버튼 — 주 행동 하나 + 보조 */}
          <div className="mt-5 flex flex-col gap-2">
            {showApply ? (
              <button
                type="button"
                onClick={openApply}
                className="w-full rounded-xl bg-sky-600 py-3 text-sm font-bold text-white transition hover:bg-sky-700"
              >
                가입 신청하고 연습 시작하기
              </button>
            ) : (
              <a
                href="/practice"
                onClick={closeSession}
                className="w-full rounded-xl bg-sky-600 py-3 text-center text-sm font-bold text-white no-underline transition hover:bg-sky-700"
              >
                순서·삽입 연습하러 가기 →
              </a>
            )}
            <a
              href={KAKAO_INQUIRY_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="w-full rounded-xl bg-[#FEE500] py-2.5 text-center text-sm font-bold text-[#3C1E1E] transition hover:brightness-95"
            >
              💬 카톡으로 사용법 묻고 포인트 받기
            </a>
            {!showApply && (
              /* 회원 보조 링크 — 예전엔 버튼 셋이었는데 한 줄로 */
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 pt-1 text-[12px] font-semibold text-slate-500">
                <a href="/unified" onClick={closeSession} className="hover:text-slate-800">파이널 열기</a>
                <span className="text-slate-300">·</span>
                <a href="/my?tab=points" onClick={closeSession} className="hover:text-slate-800">출석 포인트</a>
                <span className="text-slate-300">·</span>
                <a href="/my/point-charge" onClick={closeSession} className="hover:text-slate-800">포인트 충전</a>
                <span className="text-slate-300">·</span>
                <a href="/my/point-charge#membership" onClick={closeSession} className="hover:text-slate-800">연회원·월구독</a>
              </div>
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
    </div>
  );
}
