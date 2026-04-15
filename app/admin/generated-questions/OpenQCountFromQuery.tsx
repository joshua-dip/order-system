'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type Props = {
  enabled: boolean;
  /** 주문 MongoDB _id(24hex) — 문제수 검증 모달을 주문 범위로 연다 */
  openQCountWithOrderId: (orderId: string) => void;
};

/**
 * `/admin/generated-questions?qCountOrderId=<24hex>` 로 들어올 때
 * 문제수 검증 모달을 주문 범위로 연다.
 */
export function OpenQCountFromQuery({ enabled, openQCountWithOrderId }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const openRef = useRef(openQCountWithOrderId);
  openRef.current = openQCountWithOrderId;

  useEffect(() => {
    if (!enabled) return;
    const oid = searchParams.get('qCountOrderId')?.trim();
    if (!oid || !/^[a-f0-9]{24}$/i.test(oid)) return;
    router.replace('/admin/generated-questions', { scroll: false });
    openRef.current(oid);
  }, [enabled, searchParams, router]);

  return null;
}
