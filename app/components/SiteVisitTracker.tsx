'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * 공개 페이지 라우트 변경 시 방문 집계(/api/public/track-visit). /admin 제외.
 */
export default function SiteVisitTracker() {
  const pathname = usePathname();
  const lastRef = useRef<{ path: string; at: number } | null>(null);

  useEffect(() => {
    if (!pathname || pathname.startsWith('/admin')) return;

    const now = Date.now();
    const prev = lastRef.current;
    if (prev && prev.path === pathname && now - prev.at < 1500) return;
    lastRef.current = { path: pathname, at: now };

    fetch('/api/public/track-visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ path: pathname }),
    }).catch(() => {});
  }, [pathname]);

  return null;
}
