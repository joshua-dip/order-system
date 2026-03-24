'use client';

import { useState, useEffect } from 'react';

export type TextbookLinkEntry = { kyoboUrl: string; description: string };

/**
 * MongoDB textbook_links (GET /api/textbooks/links) — 기존 textbook-links.json과 동일 맵 형태
 */
export function useTextbookLinks(): {
  links: Record<string, TextbookLinkEntry>;
  loading: boolean;
  error: string | null;
} {
  const [links, setLinks] = useState<Record<string, TextbookLinkEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/textbooks/links', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data && typeof data === 'object' && data.error) {
          setLinks({});
          setError(String(data.error));
          return;
        }
        if (data && typeof data === 'object') {
          const map: Record<string, TextbookLinkEntry> = {};
          for (const [k, v] of Object.entries(data)) {
            if (
              v &&
              typeof v === 'object' &&
              typeof (v as TextbookLinkEntry).kyoboUrl === 'string' &&
              typeof (v as TextbookLinkEntry).description === 'string'
            ) {
              map[k] = v as TextbookLinkEntry;
            }
          }
          setLinks(map);
        } else {
          setLinks({});
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinks({});
          setError('링크를 불러오지 못했습니다.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { links, loading, error };
}
