'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

export type GqPageMode = 'objective' | 'essay';

type Props = {
  enabled: boolean;
  /** URL의 ?mode= 값을 1회만 부모 상태로 반영 */
  onInit: (mode: GqPageMode) => void;
};

/**
 * `/admin/generated-questions?mode=essay|objective` 로 들어올 때 첫 진입 시 한 번
 * 부모 상태에 페이지 모드를 반영한다. (이후 부모가 router.replace 로 직접 동기화)
 */
export function PageModeFromQuery({ enabled, onInit }: Props) {
  const searchParams = useSearchParams();
  const did = useRef(false);

  useEffect(() => {
    if (!enabled || did.current) return;
    did.current = true;
    const raw = searchParams.get('mode')?.trim().toLowerCase();
    if (raw === 'essay' || raw === 'objective') {
      onInit(raw);
    }
  }, [enabled, searchParams, onInit]);

  return null;
}
