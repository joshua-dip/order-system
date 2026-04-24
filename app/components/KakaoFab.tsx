'use client';

import { usePathname } from 'next/navigation';

const KAKAO_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

export default function KakaoFab() {
  const pathname = usePathname();
  if (pathname?.startsWith('/admin')) return null;

  return (
    <a
      href={KAKAO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="카카오톡 문의하기"
      className="fixed bottom-6 right-5 z-50 flex items-center gap-2 rounded-full shadow-xl transition-transform hover:scale-105 active:scale-95 group"
      style={{ backgroundColor: '#FEE500' }}
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
  );
}
