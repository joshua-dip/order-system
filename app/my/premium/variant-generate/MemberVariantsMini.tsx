'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type Row = {
  id: string;
  created_at: string | null;
  textbook: string;
  source: string;
  type: string;
  status: string;
  difficulty: string;
  question_preview: string;
};

type Props = {
  refreshKey: number;
  /** 방금 저장한 문항 — 카드 위에 NEW 배지·앰버 ring 강조 + 스크롤 */
  highlightVariantId?: string;
};

const FETCH_LIMIT = 6;
const FULL_LIST_HREF = '/my/premium/member-variants';

function statusStyle(status: string): string {
  if (status === '완료') return 'bg-emerald-50 text-emerald-800 ring-emerald-100';
  if (status === '대기') return 'bg-amber-50 text-amber-900 ring-amber-100';
  if (status.includes('불')) return 'bg-red-50 text-red-800 ring-red-100';
  return 'bg-slate-100 text-slate-700 ring-slate-200';
}

function formatShortDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function MemberVariantsMini({ refreshKey, highlightVariantId }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);

  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const setRowRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ skip: '0', limit: String(FETCH_LIMIT) });
    fetch(`/api/my/member-variant/questions?${qs}`, { credentials: 'include' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setError(d?.error || '목록을 불러오지 못했습니다.');
          setItems([]);
          return;
        }
        setTotal(typeof d.total === 'number' ? d.total : 0);
        const raw = Array.isArray(d.items) ? d.items : [];
        setItems(
          raw.map((r: Record<string, unknown>) => ({
            id: String(r.id ?? ''),
            created_at: typeof r.created_at === 'string' ? r.created_at : null,
            textbook: typeof r.textbook === 'string' ? r.textbook : '',
            source: typeof r.source === 'string' ? r.source : '',
            type: typeof r.type === 'string' ? r.type : '',
            status: typeof r.status === 'string' ? r.status : '',
            difficulty: typeof r.difficulty === 'string' ? r.difficulty : '',
            question_preview: typeof r.question_preview === 'string' ? r.question_preview : '',
          })),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setError('네트워크 오류로 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // 방금 저장된 항목 강조 + 스크롤
  useEffect(() => {
    if (!highlightVariantId) return;
    const found = items.find((it) => it.id === highlightVariantId);
    if (!found) return;
    setFlashId(highlightVariantId);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setFlashId(null), 4200);
    const el = rowRefs.current.get(highlightVariantId);
    if (el) {
      // 너무 빠른 스크롤 방지
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    }
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    };
  }, [highlightVariantId, items]);

  return (
    <div className="space-y-3 px-4 py-4 sm:px-5">
      {/* 상단 안내 + 자세히 보기 링크 */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-500">
          최신 {Math.min(items.length, FETCH_LIMIT)}건만 보여드려요
          {total > 0 && (
            <>
              {' · '}
              <span className="font-semibold text-slate-700">전체 {total.toLocaleString()}건</span>
            </>
          )}
        </p>
        <Link
          href={FULL_LIST_HREF}
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-violet-700 hover:text-violet-900"
        >
          전체 목록 보기
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[68px] animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      )}

      {/* 에러 */}
      {!loading && error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* 빈 상태 */}
      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-slate-700">아직 저장한 문항이 없어요</p>
          <p className="mt-1 text-[11px] text-slate-500">
            위에서 지문을 입력하고 유형을 골라 첫 변형 문항을 만들어 보세요.
          </p>
        </div>
      )}

      {/* 카드 리스트 */}
      {!loading && !error && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((row) => {
            const isFlashing = flashId === row.id;
            const isHighlighted = highlightVariantId === row.id;
            return (
              <li
                key={row.id}
                ref={(el) => setRowRef(row.id, el)}
                className={`group relative overflow-hidden rounded-xl border transition ${
                  isFlashing
                    ? 'border-amber-300 bg-amber-50/60 shadow-md ring-2 ring-amber-200 anim-fade-slide-top'
                    : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-violet-50/30'
                }`}
              >
                {isHighlighted && (
                  <span className="absolute right-2 top-2 z-10 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white shadow">
                    NEW
                  </span>
                )}
                <Link
                  href={`${FULL_LIST_HREF}?focus=${encodeURIComponent(row.id)}`}
                  className="block px-3.5 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-800">
                      {row.type || '—'}
                    </span>
                    {row.status && (
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${statusStyle(row.status)}`}
                      >
                        {row.status}
                      </span>
                    )}
                    {row.difficulty && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                        {row.difficulty}
                      </span>
                    )}
                    <span className="ml-auto truncate text-[10px] text-slate-400">
                      {formatShortDate(row.created_at)}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-1 text-[13px] font-medium text-slate-900">
                    {row.question_preview || '— 발문 미리보기 없음'}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {row.textbook || '교재 미지정'}
                    {row.source ? ` · ${row.source}` : ''}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* 하단 큰 CTA — 전체 작업으로 유도 */}
      {!loading && !error && (
        <Link
          href={FULL_LIST_HREF}
          className="group mt-1 flex items-center justify-between gap-3 rounded-2xl border-2 border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 px-4 py-3.5 transition hover:border-violet-400 hover:from-violet-100 hover:to-indigo-100"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-bold text-violet-900">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              자세히 보기 · 모든 작업 열기
            </p>
            <p className="mt-0.5 text-[11px] text-violet-700">
              필터·검색 · HWP/Excel/Word/PDF Export · GPT/Claude 검수 · 완료 처리
            </p>
          </div>
          <svg
            className="h-5 w-5 shrink-0 text-violet-600 transition group-hover:translate-x-0.5"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      )}
    </div>
  );
}
