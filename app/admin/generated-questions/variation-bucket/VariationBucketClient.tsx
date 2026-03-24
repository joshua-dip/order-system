'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function formatDbCreatedAt(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Asia/Seoul',
  }).format(d);
}

type Item = {
  _id: string;
  textbook: string;
  source: string;
  type: string;
  variation_pct: number;
  paragraphPreview: string;
  created_at: unknown;
  passage_id: string | null;
};

export default function VariationBucketClient() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    items: Item[];
    scanned: number;
    maxScan: number;
    maxResults: number;
    scanStoppedReason: string;
    bucketLabel: string;
    bucket: number | string;
    filters: { textbook: string | null; type: string | null; typeEmpty: boolean };
  } | null>(null);

  const qs = searchParams.toString();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/generated-questions/analyze/variation/bucket?${qs}`, { credentials: 'include' })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(typeof d.error === 'string' ? d.error : '요청 실패');
        return d;
      })
      .then((d) => {
        if (cancelled) return;
        setData({
          items: Array.isArray(d.items) ? d.items : [],
          scanned: typeof d.scanned === 'number' ? d.scanned : 0,
          maxScan: typeof d.maxScan === 'number' ? d.maxScan : 0,
          maxResults: typeof d.maxResults === 'number' ? d.maxResults : 500,
          scanStoppedReason: String(d.scanStoppedReason ?? ''),
          bucketLabel: String(d.bucketLabel ?? ''),
          bucket: d.bucket ?? '',
          filters: {
            textbook: d.filters?.textbook ?? null,
            type: d.filters?.type ?? null,
            typeEmpty: !!d.filters?.typeEmpty,
          },
        });
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || '불러오기 실패');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [qs]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Link
            href="/admin/generated-questions"
            className="text-sm text-teal-400 hover:text-teal-300 border border-teal-700/50 rounded-lg px-3 py-2"
          >
            ← 변형문제 관리
          </Link>
          <h1 className="text-xl font-bold text-white">변형도 구간 문항</h1>
        </div>

        {loading && <p className="text-slate-400 animate-pulse">목록 불러오는 중…</p>}
        {error && (
          <div className="p-4 rounded-lg bg-red-950/50 border border-red-800/60 text-red-200 text-sm">{error}</div>
        )}

        {data && !loading && (
          <>
            <div className="mb-4 p-4 rounded-xl bg-slate-800/80 border border-slate-600 text-sm space-y-1">
              <p>
                <strong className="text-teal-200">{data.bucketLabel}</strong>
                {data.filters.textbook && (
                  <>
                    {' '}
                    · 교재 <span className="text-white">{data.filters.textbook}</span>
                  </>
                )}
                {(data.filters.type || data.filters.typeEmpty) && (
                  <>
                    {' '}
                    · 유형{' '}
                    <span className="text-white">
                      {data.filters.typeEmpty ? '— (유형 비움)' : data.filters.type}
                    </span>
                  </>
                )}
              </p>
              <p className="text-slate-400 text-xs">
                스캔 {data.scanned.toLocaleString()}건 / 상한 {data.maxScan.toLocaleString()}건 · 표시 최대{' '}
                {data.maxResults.toLocaleString()}건
                {data.scanStoppedReason === 'maxResults' && (
                  <span className="text-amber-300"> · 결과가 많아 일부만 표시했습니다.</span>
                )}
                {data.scanStoppedReason === 'maxScan' && (
                  <span className="text-amber-300"> · 스캔 상한에 도달했습니다. 더 보려면 API maxScan을 늘리세요.</span>
                )}
              </p>
              <p className="text-slate-500 text-xs">
                변형도는 변형도 분석 집계와 동일한 방식으로 계산됩니다. 행의 ID를 누르면 관리 화면에서 수정 모달이 열립니다.
              </p>
            </div>

            {data.items.length === 0 ? (
              <p className="text-slate-500">이 구간에 해당하는 문항이 없거나, 스캔 범위 안에서 찾지 못했습니다.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-600">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-800 text-left text-slate-300 border-b border-slate-600">
                      <th className="px-3 py-2 font-semibold">변형도</th>
                      <th className="px-3 py-2 font-semibold">교재</th>
                      <th className="px-3 py-2 font-semibold">유형</th>
                      <th className="px-3 py-2 font-semibold">출처</th>
                      <th className="px-3 py-2 font-semibold">지문 미리보기</th>
                      <th className="px-3 py-2 font-semibold">등록</th>
                      <th className="px-3 py-2 font-semibold">수정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => (
                      <tr key={row._id} className="border-b border-slate-700/50 hover:bg-slate-800/40">
                        <td className="px-3 py-2 tabular-nums text-teal-300 font-medium">{row.variation_pct}%</td>
                        <td className="px-3 py-2 text-slate-300 max-w-[140px] truncate" title={row.textbook}>
                          {row.textbook || '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{row.type || '—'}</td>
                        <td className="px-3 py-2 text-slate-400 max-w-[160px] truncate" title={row.source}>
                          {row.source || '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-400 text-xs max-w-md">{row.paragraphPreview || '—'}</td>
                        <td className="px-3 py-2 text-slate-500 text-xs whitespace-nowrap">
                          {formatDbCreatedAt(
                            typeof row.created_at === 'string' ? row.created_at : null
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/admin/generated-questions?openId=${encodeURIComponent(row._id)}&returnTo=${encodeURIComponent(
                              `/admin/generated-questions/variation-bucket${qs ? `?${qs}` : ''}`
                            )}`}
                            className="text-sky-400 hover:text-sky-300 text-xs font-medium underline-offset-2 hover:underline"
                          >
                            열기
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
