'use client';

import { useState, useEffect } from 'react';

/**
 * 교재 데이터를 /api/textbooks에서 불러옵니다.
 * converted_data.json을 번들에 포함하지 않아 ChunkLoadError를 방지합니다.
 */
export function useTextbooksData(): {
  data: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/textbooks')
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
  }, []);

  return { data, loading, error };
}
