'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * 샘플 페이지 상단 좌측 뒤로가기.
 * - 주문서에서 새 탭(window.open)으로 열린 경우: 탭을 닫아 주문서로 복귀.
 * - 같은 탭에서 이동해 온 경우: 이전 페이지로.
 * - 직접 방문(기록 없음): 홈으로.
 */
export default function BackButton() {
  const router = useRouter();
  const [newTab, setNewTab] = useState(false);
  useEffect(() => {
    setNewTab(typeof window !== 'undefined' && !!window.opener);
  }, []);

  const handle = () => {
    if (typeof window === 'undefined') return;
    if (window.opener) { window.close(); return; }            // 새 탭 → 닫고 주문서로
    if (window.history.length > 1) { router.back(); return; } // 같은 탭 → 이전 페이지
    router.push('/');                                          // 폴백 → 홈
  };

  return (
    <button
      type="button"
      onClick={handle}
      className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors"
    >
      {newTab ? '✕ 닫고 주문서로 돌아가기' : '← 뒤로가기'}
    </button>
  );
}
