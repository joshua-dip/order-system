'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/** 화면 아래에 붙은 고정 바(`data-bottom-bar`)의 높이 — 문의 버튼이 주문 버튼을 가리지 않게 그만큼 올린다 */
function useBottomBarOffset(pathname: string | null, enabled: boolean): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const vh = window.innerHeight;
      let h = 0;
      document.querySelectorAll<HTMLElement>('[data-bottom-bar]').forEach((el) => {
        const r = el.getBoundingClientRect();
        /* 실제로 화면 아래에 붙어 있을 때만 (sticky 바가 아직 본문 중간이면 무시) */
        if (r.height > 0 && r.bottom >= vh - 2 && r.top < vh) h = Math.max(h, vh - r.top);
      });
      setOffset((prev) => (Math.abs(prev - h) < 1 ? prev : h));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [pathname, enabled]);
  return offset;
}

const KAKAO_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

export default function KakaoFab() {
  const pathname = usePathname();
  // 관리자·VIP 모드·학생 자가채점 페이지에서는 카카오 문의 버튼 숨김
  const hidden = !!(pathname?.startsWith('/admin') || pathname?.startsWith('/my/vip') || pathname?.startsWith('/exam-grade'));
  const barOffset = useBottomBarOffset(pathname, !hidden);
  if (hidden) return null;

  return (
    <>
    {/* 페이지 맨 끝 여백 — 끝까지 내렸을 때 마지막 버튼이 이 문의 버튼 밑에 깔리지 않게 */}
    <div aria-hidden className="h-20 shrink-0 print:hidden" />
    <a
      href={KAKAO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="카카오톡 문의하기"
      className="fixed bottom-6 right-5 z-50 flex items-center gap-2 rounded-full shadow-xl transition-transform hover:scale-105 active:scale-95 group print:hidden"
      style={{ backgroundColor: '#FEE500', bottom: barOffset > 0 ? barOffset + 12 : undefined }}
    >
      {/* 말풍선 라벨 — hover 시 슬라이드인 */}
      <span className="hidden sm:block max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 ease-in-out whitespace-nowrap pl-0 group-hover:pl-4 text-sm font-bold text-gray-900">
        문의하기
      </span>

      {/* 카카오 아이콘 */}
      <span className="flex items-center justify-center w-14 h-14 rounded-full" style={{ backgroundColor: '#FEE500' }}>
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M12 3C6.48 3 2 6.58 2 11c0 2.4 1.17 4.55 3 6.06V21l3.94-2.06c.97.27 2 .42 3.06.42 5.52 0 10-3.58 10-8s-4.48-8-10-8z"
            fill="#3C1E1E"
          />
        </svg>
      </span>
    </a>
    </>
  );
}
