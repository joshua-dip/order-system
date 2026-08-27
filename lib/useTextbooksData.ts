'use client';

import { useState, useEffect } from 'react';

export type UseTextbooksDataOptions = {
  /** 단어장: 모의고사 카탈로그·passages 기준으로 병합에 없는 강·번호 트리를 API에서 보강 */
  vocabularyEnrich?: boolean;
  /** 교재 이름만 받는다(1KB). 목록 화면처럼 Object.keys 만 쓰는 곳에서. */
  namesOnly?: boolean;
  /** false 면 아예 요청하지 않는다. 교재를 고르기 전에는 전체 트리를 받을 이유가 없다. */
  enabled?: boolean;
};

/**
 * 교재 데이터를 /api/textbooks에서 불러옵니다.
 * converted_data.json을 번들에 포함하지 않아 ChunkLoadError를 방지합니다.
 */
export function useTextbooksData(opts?: UseTextbooksDataOptions): {
  data: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
} {
  const vocabularyEnrich = opts?.vocabularyEnrich === true;
  const namesOnly = opts?.namesOnly === true;
  const enabled = opts?.enabled !== false;
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (vocabularyEnrich) params.set('vocabularyEnrich', '1');
    if (namesOnly) params.set('namesOnly', '1');
    const qs = params.toString();
    const url = qs ? `/api/textbooks?${qs}` : '/api/textbooks';
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          setData(json);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '데이터를 불러올 수 없습니다.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vocabularyEnrich, namesOnly, enabled]);

  return { data, loading, error };
}
