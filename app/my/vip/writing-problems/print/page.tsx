'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { PrintWorksheet } from '../../grammar-problems/print-worksheet';
import type { BankFormat } from '../../grammar-problems/shared';

/** 라이팅 문제지 인쇄 라우트 — 직접 URL(북마크·외부 링크) 진입용. 부모 목록은 인페이지 오버레이를 쓰므로 이 경로는 하위호환. */
function PrintInner() {
  const params = useSearchParams();
  const keys = useMemo(() => params.getAll('topicKey').filter(Boolean), [params]);
  const source = params.get('source') ?? '';
  const fmt: BankFormat = params.get('fmt') === 'subjective' ? 'subjective' : 'mc';

  const doClose = () => {
    // 스크립트로 열린 탭이면 닫고, 아니면(직접 URL 접근) 목록으로 이동
    window.close();
    setTimeout(() => { if (!window.closed) window.location.href = '/my/vip/writing-problems'; }, 150);
  };

  return (
    <PrintWorksheet keys={keys} source={source} bankBase="/api/my/vip/writing-problems/bank" initialFmt={fmt} onClose={doClose} />
  );
}

export default function WritingPrintPage() {
  return (
    <Suspense fallback={<p className="p-10 text-center text-sm text-zinc-500">불러오는 중…</p>}>
      <PrintInner />
    </Suspense>
  );
}
