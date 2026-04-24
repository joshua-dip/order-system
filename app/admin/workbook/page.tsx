'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { WorkbookGrammarPreview } from './_components/WorkbookGrammarPreview';

type CoverageRow = {
  textbook: string;
  total_passages: number;
  passages_with_workbook: number;
  coverage_pct: number;
};

type WorkbookVariant = {
  id: string;
  category: string;
  status: string;
  truncated_points_count: number | null;
  grammar_points_count: number;
  created_at: string;
  parent_id: string | null;
};

type PassageRow = {
  passage_id: string;
  textbook: string;
  source?: string;
  content?: { lessonNo?: number; page?: string; title?: string };
  workbook_count: number;
  latest_status: string | null;
  latest_created_at: string | null;
  latest_points_count: number | null;
  latest_truncated: number | null;
  workbooks: WorkbookVariant[];
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-slate-400">없음</span>;
  if (status === 'reviewed') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">검수완료</span>;
  }
  return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">초안</span>;
}

export default function WorkbookDashboardPage() {
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [items, setItems] = useState<PassageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(true);
  const [filterTextbook, setFilterTextbook] = useState('');
  const [expandedPassage, setExpandedPassage] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null);
  const limit = 30;

  const fetchCoverage = useCallback(async () => {
    setCoverageLoading(true);
    try {
      const res = await fetch('/api/admin/workbook/coverage', { credentials: 'include' });
      const d = await res.json();
      setCoverage(d.rows ?? []);
    } catch { /* ignore */ }
    setCoverageLoading(false);
  }, []);

  const fetchList = useCallback(async () => {
    setListLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filterTextbook) sp.set('textbook', filterTextbook);
      const res = await fetch(`/api/admin/workbook/list?${sp}`, { credentials: 'include' });
      const d = await res.json();
      setItems(d.items ?? []);
      setTotal(d.total ?? 0);
    } catch { /* ignore */ }
    setListLoading(false);
  }, [page, filterTextbook]);

  useEffect(() => { fetchCoverage(); }, [fetchCoverage]);
  useEffect(() => { fetchList(); }, [fetchList]);

  const handleGenerate = async (passageId: string) => {
    if (generating) return;
    setGenerating(passageId);
    try {
      const res = await fetch('/api/admin/workbook/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ passage_id: passageId }),
      });
      const d = await res.json();
      if (!d.ok) {
        alert(d.error || '생성 실패');
      } else {
        fetchList();
        fetchCoverage();
      }
    } catch (e) {
      alert('생성 중 오류: ' + (e instanceof Error ? e.message : String(e)));
    }
    setGenerating(null);
  };

  const handleDelete = async (wbId: string) => {
    if (!confirm('이 워크북 변형을 삭제할까요?')) return;
    try {
      await fetch(`/api/admin/workbook/${wbId}`, { method: 'DELETE', credentials: 'include' });
      fetchList();
      fetchCoverage();
    } catch { /* ignore */ }
  };

  const handleToggleStatus = async (wbId: string) => {
    try {
      await fetch(`/api/admin/workbook/${wbId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'toggle-status' }),
      });
      fetchList();
    } catch { /* ignore */ }
  };

  const handlePreview = async (wbId: string) => {
    try {
      const res = await fetch(`/api/admin/workbook/${wbId}`, { credentials: 'include' });
      const d = await res.json();
      if (d.ok && d.item) {
        setPreviewData(d.item);
      }
    } catch { /* ignore */ }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">워크북 관리</h1>
            <p className="text-slate-400 text-sm mt-1">교재별 워크북 어법 커버리지와 변형 관리</p>
          </div>
          <Link href="/admin" className="text-sm text-slate-400 hover:text-white transition-colors">
            ← 관리자 메인
          </Link>
        </div>

        {/* 커버리지 카드 */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">교재별 커버리지</h2>
          {coverageLoading ? (
            <div className="text-slate-500 text-sm">로딩 중...</div>
          ) : coverage.length === 0 ? (
            <div className="text-slate-500 text-sm">교재 없음</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {coverage.map((c) => (
                <button
                  key={c.textbook}
                  type="button"
                  onClick={() => {
                    setFilterTextbook(f => f === c.textbook ? '' : c.textbook);
                    setPage(1);
                  }}
                  className={`rounded-xl p-3 text-left transition-all border ${
                    filterTextbook === c.textbook
                      ? 'border-amber-500 bg-amber-950/40'
                      : 'border-slate-700 bg-slate-800 hover:border-slate-600'
                  }`}
                >
                  <p className="text-xs font-medium text-slate-300 truncate" title={c.textbook}>
                    {c.textbook}
                  </p>
                  <div className="mt-2 flex items-end gap-1">
                    <span className="text-lg font-bold text-white">{c.passages_with_workbook}</span>
                    <span className="text-xs text-slate-500 mb-0.5">/ {c.total_passages}</span>
                  </div>
                  <div className="mt-1.5 w-full bg-slate-700 rounded-full h-1.5">
                    <div
                      className="bg-amber-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min(100, c.coverage_pct)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">{c.coverage_pct}%</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 필터 표시 */}
        {filterTextbook && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xs text-slate-400">필터:</span>
            <span className="text-xs bg-amber-900/40 text-amber-300 px-2 py-0.5 rounded-full">{filterTextbook}</span>
            <button
              type="button"
              onClick={() => { setFilterTextbook(''); setPage(1); }}
              className="text-xs text-slate-500 hover:text-white"
            >
              초기화
            </button>
          </div>
        )}

        {/* 지문 테이블 */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-300">
              지문 {total}건 {filterTextbook ? `(${filterTextbook})` : ''}
            </p>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {page > 1 && (
                <button onClick={() => setPage(p => p - 1)} className="hover:text-white">← 이전</button>
              )}
              <span>{page} / {totalPages}</span>
              {page < totalPages && (
                <button onClick={() => setPage(p => p + 1)} className="hover:text-white">다음 →</button>
              )}
            </div>
          </div>

          {listLoading ? (
            <div className="p-8 text-center text-slate-500 text-sm">로딩 중...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">지문이 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-700">
                  <th className="text-left px-4 py-2">교재</th>
                  <th className="text-left px-4 py-2">강/페이지</th>
                  <th className="text-center px-4 py-2">변형 수</th>
                  <th className="text-center px-4 py-2">최신 상태</th>
                  <th className="text-center px-4 py-2">포인트</th>
                  <th className="text-center px-4 py-2">최근 생성</th>
                  <th className="text-center px-4 py-2">작업</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <Fragment key={row.passage_id}>
                    <tr className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                      <td className="px-4 py-2.5 text-slate-300 max-w-[200px] truncate" title={row.textbook}>
                        {row.textbook}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">
                        {row.content?.lessonNo ? `${row.content.lessonNo}강` : '—'}
                        {row.content?.page ? ` p.${row.content.page}` : ''}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {row.workbook_count > 0 ? (
                          <button
                            type="button"
                            onClick={() => setExpandedPassage(e => e === row.passage_id ? null : row.passage_id)}
                            className="text-amber-400 hover:text-amber-300 font-medium"
                          >
                            {row.workbook_count}
                            <span className="text-[10px] ml-0.5">{expandedPassage === row.passage_id ? '▲' : '▼'}</span>
                          </button>
                        ) : (
                          <span className="text-slate-600">0</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <StatusBadge status={row.latest_status} />
                      </td>
                      <td className="px-4 py-2.5 text-center text-slate-400">
                        {row.latest_points_count ?? '—'}
                        {row.latest_truncated != null && row.latest_truncated > 0 && (
                          <span className="ml-1 text-red-400" title={`${row.latest_truncated}개 포인트 5단어 초과로 제외됨`}>⚠</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center text-slate-500 text-xs">
                        {formatDate(row.latest_created_at)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          type="button"
                          disabled={generating === row.passage_id}
                          onClick={() => handleGenerate(row.passage_id)}
                          className="text-xs px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 transition-colors"
                        >
                          {generating === row.passage_id ? '생성 중...' : '+ 변형'}
                        </button>
                      </td>
                    </tr>

                    {/* 변형 펼치기 */}
                    {expandedPassage === row.passage_id && row.workbooks.length > 0 && (
                      <tr>
                        <td colSpan={7} className="bg-slate-850 px-0">
                          <div className="px-8 py-3 space-y-2">
                            {row.workbooks.map((wb, idx) => (
                              <div
                                key={wb.id}
                                className="flex items-center gap-4 px-4 py-2 rounded-lg bg-slate-800/80 border border-slate-700/50"
                              >
                                <span className="text-xs text-slate-500 font-mono w-8">#{row.workbooks.length - idx}</span>
                                <span className="text-xs text-slate-400">{formatDate(wb.created_at)}</span>
                                <span className="text-xs text-slate-400">
                                  {wb.grammar_points_count}포인트
                                  {wb.truncated_points_count != null && wb.truncated_points_count > 0 && (
                                    <span className="text-red-400 ml-1">⚠{wb.truncated_points_count}</span>
                                  )}
                                </span>
                                <StatusBadge status={wb.status} />
                                <div className="flex-1" />
                                <button
                                  type="button"
                                  onClick={() => handlePreview(wb.id)}
                                  className="text-xs text-sky-400 hover:text-sky-300"
                                >
                                  미리보기
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleStatus(wb.id)}
                                  className="text-xs text-violet-400 hover:text-violet-300"
                                >
                                  {wb.status === 'reviewed' ? '초안으로' : '검수완료'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(wb.id)}
                                  className="text-xs text-red-400 hover:text-red-300"
                                >
                                  삭제
                                </button>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 미리보기 모달 */}
        {previewData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-white rounded-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-800">워크북 미리보기</h3>
                <button
                  type="button"
                  onClick={() => setPreviewData(null)}
                  className="text-slate-400 hover:text-slate-600 text-xl"
                >
                  ✕
                </button>
              </div>
              <WorkbookGrammarPreview data={previewData} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
