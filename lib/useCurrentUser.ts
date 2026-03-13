'use client';

import { useState, useEffect } from 'react';

export interface CurrentUser {
  allowedTextbooks: string[];
  allowedTextbooksAnalysis: string[];
  allowedTextbooksEssay: string[];
  canAccessAnalysis?: boolean;
  canAccessEssay?: boolean;
}

/**
 * 로그인한 회원 정보를 가져옵니다.
 * allowedTextbooks가 비어 있지 않으면 해당 회원은 허용된 교재만 보게 됩니다.
 */
export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data?.user) {
          const at = Array.isArray(data.user.allowedTextbooks) ? data.user.allowedTextbooks : [];
          setUser({
            allowedTextbooks: at,
            allowedTextbooksAnalysis: Array.isArray(data.user.allowedTextbooksAnalysis) ? data.user.allowedTextbooksAnalysis : at,
            allowedTextbooksEssay: Array.isArray(data.user.allowedTextbooksEssay) ? data.user.allowedTextbooksEssay : at,
            canAccessAnalysis: !!data.user.canAccessAnalysis,
            canAccessEssay: !!data.user.canAccessEssay,
          });
        } else {
          setUser(null);
        }
      })
      .catch(() => setUser(null));
  }, []);

  return user;
}

/**
 * 전체 교재 키 목록을 회원 허용 목록으로 필터링합니다.
 * allowedTextbooks가 없으면(미설정) 전체 목록을 반환하고, 배열이면(빈 배열 포함) 허용된 교재만 반환합니다.
 */
export function filterTextbooksByAllowed(
  allKeys: string[],
  allowedTextbooks: string[] | undefined
): string[] {
  if (allowedTextbooks === undefined) return allKeys;
  const set = new Set(allowedTextbooks);
  return allKeys.filter((k) => set.has(k));
}
