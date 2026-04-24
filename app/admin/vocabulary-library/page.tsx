'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminSidebar from '../_components/AdminSidebar';

interface VocabRow {
  id: string;
  user_id: string;
  login_id: string;
  passage_id: string;
  textbook: string;
  display_label: string;
  package_type: string;
  points_used: number;
  order_number: string;
  purchased_at: string;
  last_edited_at: string;
  entry_count: number;
  has_custom_edit: boolean;
}

const PAGE_SIZE = 50;

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function AdminVocabularyLibraryPage() {
  const router = useRouter();
  const [adminLoginId, setAdminLoginId] = useState('');
  const [loginIdFilter, setLoginIdFilter] = useState('');
  const [appliedFilter, setAppliedFilter] = useState('');
  const [items, setItems] = useState<VocabRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageEdited, setPageEdited] = useState(0);
  const [pagePoints, setPagePoints] = useState(0);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d?.role !== 'admin') router.replace('/admin/login');
        else setAdminLoginId(d.loginId ?? '');
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      sp.set('limit', String(PAGE_SIZE));
      sp.set('skip', String(skip));
      if (appliedFilter.trim()) sp.set('loginId', appliedFilter.trim());
      const r = await fetch(`/api/admin/vocabulary-library?${sp}`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? '불러오기 실패');
        setItems([]);
        setTotal(0);
        return;
      }
      setItems(d.items ?? []);
      setTotal(typeof d.total === 'number' ? d.total : 0);
      setPageEdited(d.pageMeta?.editedCount ?? 0);
      setPagePoints(d.pageMeta?.pointsOnPage ?? 0);
    } catch {
      setError('네트워크 오류');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [skip, appliedFilter]);

  useEffect(() => {
    load();
  }, [load]);

  function applySearch() {
    setSkip(0);
    setAppliedFilter(loginIdFilter);
  }

  const page = Math.floor(skip / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      <AdminSidebar loginId={adminLoginId} />
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-xl font-bold text-white">단어장 구매·편집 분석</h1>
              <p className="text-slate-400 text-sm mt-1">
                회원별 단어장 구매 시각, 포인트, 원본 대비 편집 여부를 확인할 수 있습니다.
              </p>
            </div>
            <Link href="/admin/users" className="text-slate-400 hover:text-white text-sm shrink-0">
              ← 회원상세관리
            </Link>
          </div>

          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 mb-4 flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1 min-w-0">
              <label htmlFor="vocab-login-filter" className="block text-xs text-slate-500 mb-1">
                아이디 검색 (부분 일치)
              </label>
              <input
                id="vocab-login-filter"
                type="text"
                value={loginIdFilter}
                onChange={(e) => setLoginIdFilter(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                placeholder="예: gomijoshua"
                className="w-full max-w-md bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-400"
              />
            </div>
            <button
              type="button"
              onClick={applySearch}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              검색
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-slate-800 rounded-lg border border-slate-700 px-4 py-3">
              <p className="text-xs text-slate-500">전체 건수</p>
              <p className="text-lg font-bold text-white">{total.toLocaleString()}</p>
            </div>
            <div className="bg-slate-800 rounded-lg border border-slate-700 px-4 py-3">
              <p className="text-xs text-slate-500">이 페이지 편집됨</p>
              <p className="text-lg font-bold text-teal-300">{pageEdited}</p>
            </div>
            <div className="bg-slate-800 rounded-lg border border-slate-700 px-4 py-3">
              <p className="text-xs text-slate-500">이 페이지 포인트 합</p>
              <p className="text-lg font-bold text-amber-300">{pagePoints.toLocaleString()}P</p>
            </div>
            <div className="bg-slate-800 rounded-lg border border-slate-700 px-4 py-3">
              <p className="text-xs text-slate-500">페이지</p>
              <p className="text-lg font-bold text-white">
                {page} / {totalPages}
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-red-300 text-sm">{error}</div>
          )}

          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            {loading ? (
              <div className="py-16 text-center text-slate-500 text-sm">불러오는 중…</div>
            ) : items.length === 0 ? (
              <div className="py-16 text-center text-slate-500 text-sm">데이터가 없습니다.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase tracking-wider text-left">
                      <th className="px-4 py-3 font-medium">회원</th>
                      <th className="px-4 py-3 font-medium">교재·지문</th>
                      <th className="px-4 py-3 font-medium">주문번호</th>
                      <th className="px-4 py-3 font-medium text-right">포인트</th>
                      <th className="px-4 py-3 font-medium">구매일시</th>
                      <th className="px-4 py-3 font-medium">최종 편집</th>
                      <th className="px-4 py-3 font-medium text-center">편집</th>
                      <th className="px-4 py-3 font-medium text-right">단어 수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.id} className="border-b border-slate-700/50 last:border-0 hover:bg-slate-700/25">
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/users/${row.user_id}`}
                            className="font-mono text-xs text-sky-400 hover:underline"
                          >
                            {row.login_id}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-300 max-w-[220px]">
                          <p className="truncate text-xs text-slate-500">{row.textbook}</p>
                          <p className="truncate text-slate-200">{row.display_label || '—'}</p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{row.order_number}</td>
                        <td className="px-4 py-3 text-right text-slate-300">{row.points_used.toLocaleString()}P</td>
                        <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmt(row.purchased_at)}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmt(row.last_edited_at)}</td>
                        <td className="px-4 py-3 text-center">
                          {row.has_custom_edit ? (
                            <span className="text-xs font-semibold text-teal-300">편집됨</span>
                          ) : (
                            <span className="text-xs text-slate-600">원본</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-400">{row.entry_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {total > PAGE_SIZE && (
            <div className="flex justify-center gap-2 mt-4">
              <button
                type="button"
                disabled={skip <= 0 || loading}
                onClick={() => setSkip((s) => Math.max(0, s - PAGE_SIZE))}
                className="px-4 py-2 rounded-lg bg-slate-700 text-slate-200 text-sm disabled:opacity-40"
              >
                이전
              </button>
              <button
                type="button"
                disabled={skip + PAGE_SIZE >= total || loading}
                onClick={() => setSkip((s) => s + PAGE_SIZE)}
                className="px-4 py-2 rounded-lg bg-slate-700 text-slate-200 text-sm disabled:opacity-40"
              >
                다음
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
