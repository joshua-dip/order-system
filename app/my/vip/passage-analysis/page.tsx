'use client';

import { useEffect } from 'react';

/** 옛 경로 — 「출제 스튜디오」(/my/vip/studio)로 이동. 쿼리(?examId&key) 보존. */
export default function PassageAnalysisRedirect() {
  useEffect(() => {
    const qs = typeof window !== 'undefined' ? window.location.search : '';
    window.location.replace('/my/vip/studio' + qs);
  }, []);
  return (
    <div className="p-12 text-center text-sm text-zinc-500">「출제 스튜디오」로 이동 중…</div>
  );
}
