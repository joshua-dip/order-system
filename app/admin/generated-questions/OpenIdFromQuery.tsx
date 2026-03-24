'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type Props = {
  enabled: boolean;
  /** 두 번째 인자: 변형도 구간 문항 페이지 등 저장 후 돌아갈 경로(path?query) */
  openEdit: (id: string, bucketReturnPath?: string | null) => Promise<void>;
};

/** 저장 후 이동 허용: 변형도 구간 문항만 (오픈 리다이렉트 방지) */
export function parseVariationBucketReturnTo(searchParams: URLSearchParams): string | null {
  const raw = searchParams.get('returnTo')?.trim();
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const q = decoded.indexOf('?');
    const pathname = q >= 0 ? decoded.slice(0, q) : decoded;
    if (pathname !== '/admin/generated-questions/variation-bucket') return null;
    if (decoded.startsWith('//') || decoded.includes('://')) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * `/admin/generated-questions?openId=<24hex>&returnTo=...` 로 들어올 때 수정 모달을 연다.
 * (부모에서 Suspense로 감쌀 것)
 */
export function OpenIdFromQuery({ enabled, openEdit }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const openId = searchParams.get('openId')?.trim();
    if (!openId || !/^[a-f0-9]{24}$/i.test(openId)) return;
    const bucketReturn = parseVariationBucketReturnTo(searchParams);
    router.replace('/admin/generated-questions', { scroll: false });
    void openEdit(openId, bucketReturn);
  }, [enabled, searchParams, openEdit, router]);

  return null;
}
