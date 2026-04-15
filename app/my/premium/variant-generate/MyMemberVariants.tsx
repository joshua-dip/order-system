'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BOOK_VARIANT_QUESTION_TYPES } from '@/lib/book-variant-types';
import QuestionFriendlyPreview from './QuestionFriendlyPreview';

type Row = {
  id: string;
  created_at: string | null;
  textbook: string;
  source: string;
  type: string;
  status: string;
  difficulty: string;
  option_type: string;
  question_preview: string;
  answer_preview: string;
  options_preview: string;
};

type ColumnKey =
  | 'created_at'
  | 'type'
  | 'difficulty'
  | 'textbook'
  | 'source'
  | 'status'
  | 'option_type'
  | 'question_preview'
  | 'answer_preview'
  | 'options_preview';

const COLUMN_META: { key: ColumnKey; label: string; defaultOn: boolean }[] = [
  { key: 'created_at', label: '일시', defaultOn: true },
  { key: 'type', label: '유형', defaultOn: true },
  { key: 'difficulty', label: '난이도', defaultOn: true },
  { key: 'textbook', label: '교재', defaultOn: true },
  { key: 'source', label: '출처', defaultOn: true },
  { key: 'status', label: '상태', defaultOn: true },
  { key: 'option_type', label: '선지언어', defaultOn: false },
  { key: 'question_preview', label: '미리보기(발문·지문)', defaultOn: true },
  { key: 'answer_preview', label: '정답 미리보기', defaultOn: false },
  { key: 'options_preview', label: '선택지 미리보기', defaultOn: false },
];

const LS_COLUMNS = 'memberVariantColumnVis:v1';

function loadColumnVisibility(): Record<ColumnKey, boolean> {
  const base: Record<ColumnKey, boolean> = {} as Record<ColumnKey, boolean>;
  for (const c of COLUMN_META) base[c.key] = c.defaultOn;
  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(LS_COLUMNS);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    for (const c of COLUMN_META) {
      if (typeof parsed[c.key] === 'boolean') base[c.key] = parsed[c.key];
    }
  } catch {
    /* ignore */
  }
  return base;
}

type Props = {
  refreshKey: number;
};

type DetailMeta = {
  textbook: string;
  source: string;
  type: string;
  status: string;
  created_at: string | null;
};

type ExportFormat = 'xlsx' | 'pdf' | 'docx' | 'hwpx';

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

export default function MyMemberVariants({ refreshKey }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<Row[]>([]);
  const [skip, setSkip] = useState(0);
  const limit = 25;
  const [typeFilter, setTypeFilter] = useState('');
  const [pageSearch, setPageSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailMeta, setDetailMeta] = useState<DetailMeta | null>(null);
  const [detailQuestionData, setDetailQuestionData] = useState<Record<string, unknown> | null>(null);

  const [colVis, setColVis] = useState<Record<ColumnKey, boolean>>(() => loadColumnVisibility());
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef<HTMLDivElement | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  /** 상세에서 GPT/Claude 검수 안내 표시 */
  const [reviewChannel, setReviewChannel] = useState<null | 'gpt' | 'claude'>(null);
  const [statusLegendOpen, setStatusLegendOpen] = useState(false);
  const statusLegendRef = useRef<HTMLDivElement>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!colMenuOpen) return;
      const el = colMenuRef.current;
      if (el && !el.contains(e.target as Node)) setColMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [colMenuOpen]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!statusLegendOpen) return;
      const el = statusLegendRef.current;
      if (el && !el.contains(e.target as Node)) setStatusLegendOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [statusLegendOpen]);

  const persistCols = useCallback((next: Record<ColumnKey, boolean>) => {
    setColVis(next);
    try {
      window.localStorage.setItem(LS_COLUMNS, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(
    async (nextSkip: number) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ skip: String(nextSkip), limit: String(limit) });
        if (typeFilter) qs.set('type', typeFilter);
        const res = await fetch(`/api/my/member-variant/questions?${qs}`, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || '목록을 불러오지 못했습니다.');
          setItems([]);
          return;
        }
        setTotal(typeof data.total === 'number' ? data.total : 0);
        const raw = Array.isArray(data.items) ? data.items : [];
        setItems(
          raw.map((r: Record<string, unknown>) => ({
            id: String(r.id ?? ''),
            created_at: typeof r.created_at === 'string' ? r.created_at : null,
            textbook: typeof r.textbook === 'string' ? r.textbook : '',
            source: typeof r.source === 'string' ? r.source : '',
            type: typeof r.type === 'string' ? r.type : '',
            status: typeof r.status === 'string' ? r.status : '',
            difficulty: typeof r.difficulty === 'string' ? r.difficulty : '',
            option_type: typeof r.option_type === 'string' ? r.option_type : '',
            question_preview: typeof r.question_preview === 'string' ? r.question_preview : '',
            answer_preview: typeof r.answer_preview === 'string' ? r.answer_preview : '',
            options_preview: typeof r.options_preview === 'string' ? r.options_preview : '',
          })),
        );
        setSkip(nextSkip);
        setSelectedIds(new Set());
      } catch {
        setError('요청 중 오류가 발생했습니다.');
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [typeFilter],
  );

  useEffect(() => {
    void load(0);
  }, [refreshKey, typeFilter, load]);

  const displayRows = useMemo(() => {
    const q = pageSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (r) =>
        r.textbook.toLowerCase().includes(q) ||
        r.question_preview.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        r.answer_preview.toLowerCase().includes(q),
    );
  }, [items, pageSearch]);

  const selectedOnPage = useMemo(() => {
    return displayRows.filter((r) => selectedIds.has(r.id));
  }, [displayRows, selectedIds]);

  const allOnPageSelected =
    displayRows.length > 0 && selectedOnPage.length === displayRows.length;
  const someOnPageSelected = selectedOnPage.length > 0 && !allOnPageSelected;

  const toggleSelectAllPage = () => {
    if (allOnPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of displayRows) next.delete(r.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of displayRows) next.add(r.id);
        return next;
      });
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const closeDetail = () => {
    setReviewChannel(null);
    setDetailId(null);
    setDetailError(null);
    setDetailMeta(null);
    setDetailQuestionData(null);
  };

  const patchMarkComplete = useCallback(async (id: string) => {
    setCompletingId(id);
    try {
      const res = await fetch(`/api/my/member-variant/questions/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markReviewComplete' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(typeof data?.error === 'string' ? data.error : '처리에 실패했습니다.');
        return;
      }
      setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status: '완료' } : r)));
      setReviewChannel(null);
      setDetailMeta((m) => {
        if (!m || detailId !== id) return m;
        return { ...m, status: '완료' };
      });
    } finally {
      setCompletingId(null);
    }
  }, [detailId]);

  const openDetail = async (id: string, channel?: 'gpt' | 'claude') => {
    setReviewChannel(channel ?? null);
    setDetailId(id);
    setDetailLoading(true);
    setDetailError(null);
    setDetailMeta(null);
    setDetailQuestionData(null);
    try {
      const res = await fetch(`/api/my/member-variant/questions/${id}`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDetailError(typeof data?.error === 'string' ? data.error : '불러오기에 실패했습니다.');
        return;
      }
      if (data.ok !== true) {
        setDetailError('문항 정보를 불러오지 못했습니다.');
        return;
      }
      const qd = data.question_data;
      if (!qd || typeof qd !== 'object' || Array.isArray(qd)) {
        setDetailError('문항 내용이 없습니다.');
        return;
      }
      setDetailMeta({
        textbook: typeof data.textbook === 'string' ? data.textbook : '',
        source: typeof data.source === 'string' ? data.source : '',
        type: typeof data.type === 'string' ? data.type : '',
        status: typeof data.status === 'string' ? data.status : '',
        created_at: typeof data.created_at === 'string' ? data.created_at : null,
      });
      setDetailQuestionData(qd as Record<string, unknown>);
    } catch {
      setDetailError('요청 중 오류가 발생했습니다.');
    } finally {
      setDetailLoading(false);
    }
  };

  const runExport = async (format: ExportFormat) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setExporting(format);
    try {
      const res = await fetch('/api/my/member-variant/export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, ids }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        window.alert(typeof j?.error === 'string' ? j.error : '보내기에 실패했습니다.');
        return;
      }
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const ext =
        format === 'xlsx' ? 'xlsx' : format === 'pdf' ? 'pdf' : format === 'hwpx' ? 'hwpx' : 'docx';
      const base = `회원변형문항_${stamp}`;
      const filename = `${base}.${ext}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.alert('보내기 중 오류가 발생했습니다.');
    } finally {
      setExporting(null);
    }
  };

  const visibleColCount = COLUMN_META.filter((c) => colVis[c.key]).length;

  const renderCell = (row: Row, key: ColumnKey) => {
    switch (key) {
      case 'created_at':
        return (
          <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{formatShortDate(row.created_at)}</td>
        );
      case 'type':
        return <td className="px-4 py-3 text-sm font-semibold text-slate-800">{row.type}</td>;
      case 'difficulty':
        return <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{row.difficulty || '—'}</td>;
      case 'textbook':
        return (
          <td className="max-w-[160px] truncate px-4 py-3 text-sm text-slate-700" title={row.textbook}>
            {row.textbook}
          </td>
        );
      case 'source':
        return (
          <td className="max-w-[140px] truncate px-4 py-3 text-xs text-slate-600" title={row.source}>
            {row.source || '—'}
          </td>
        );
      case 'status':
        return (
          <td className="min-w-[200px] max-w-[280px] px-4 py-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col gap-2">
              <span
                className={`inline-flex w-fit rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${statusStyle(row.status)}`}
              >
                {row.status}
              </span>
              {row.status === '대기' && (
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    title="직접 검수"
                    disabled={completingId === row.id}
                    onClick={() => {
                      if (!window.confirm('문항을 직접 확인했고, 검수 완료(완료)로 표시할까요?')) return;
                      void patchMarkComplete(row.id);
                    }}
                    className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    직접 검수
                  </button>
                  <button
                    type="button"
                    title="ChatGPT 등에 붙여 검수"
                    disabled={completingId === row.id}
                    onClick={() => void openDetail(row.id, 'gpt')}
                    className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-900 hover:bg-sky-100 disabled:opacity-50"
                  >
                    GPT 검수
                  </button>
                  <button
                    type="button"
                    title="Claude에 붙여 검수"
                    disabled={completingId === row.id}
                    onClick={() => void openDetail(row.id, 'claude')}
                    className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-900 hover:bg-violet-100 disabled:opacity-50"
                  >
                    Claude 검수
                  </button>
                </div>
              )}
            </div>
          </td>
        );
      case 'option_type':
        return <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{row.option_type || '—'}</td>;
      case 'question_preview':
        return (
          <td className="max-w-[220px] truncate px-4 py-3 text-xs text-slate-500" title={row.question_preview}>
            {row.question_preview}
          </td>
        );
      case 'answer_preview':
        return (
          <td className="max-w-[120px] truncate px-4 py-3 text-xs text-slate-600" title={row.answer_preview}>
            {row.answer_preview || '—'}
          </td>
        );
      case 'options_preview':
        return (
          <td className="max-w-[180px] truncate px-4 py-3 text-xs text-slate-500" title={row.options_preview}>
            {row.options_preview || '—'}
          </td>
        );
      default:
        return null;
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-md ring-1 ring-slate-100">
      <div className="border-b border-slate-100 px-5 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="block flex-1 text-xs font-bold text-slate-600">
            유형으로 좁히기
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPageSearch('');
              }}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              <option value="">전체 유형</option>
              {BOOK_VARIANT_QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1 text-xs font-bold text-slate-600">
            이 페이지에서 검색
            <input
              value={pageSearch}
              onChange={(e) => setPageSearch(e.target.value)}
              placeholder="교재·출처·미리보기·정답"
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </label>
        </div>
      </div>

      <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-600">
              선택 <strong className="text-violet-700">{selectedIds.size}</strong>건
            </span>
            <button
              type="button"
              disabled={displayRows.length === 0 || loading}
              onClick={() => toggleSelectAllPage()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              {allOnPageSelected ? '이 페이지 선택 해제' : '이 페이지 전체 선택'}
            </button>
          </div>
          <div className="relative flex flex-wrap items-center gap-2" ref={colMenuRef}>
            <button
              type="button"
              onClick={() => setColMenuOpen((o) => !o)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
            >
              열 표시 ({visibleColCount})
            </button>
            {colMenuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">테이블 열</p>
                <ul className="max-h-64 space-y-2 overflow-auto text-xs">
                  {COLUMN_META.map((c) => (
                    <li key={c.key}>
                      <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={colVis[c.key]}
                          onChange={() => persistCols({ ...colVis, [c.key]: !colVis[c.key] })}
                          className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        {c.label}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              disabled={selectedIds.size === 0 || exporting !== null}
              onClick={() => void runExport('xlsx')}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {exporting === 'xlsx' ? '…' : '엑셀'}
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0 || exporting !== null}
              onClick={() => void runExport('pdf')}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-rose-700 disabled:opacity-40"
            >
              {exporting === 'pdf' ? '…' : 'PDF'}
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0 || exporting !== null}
              onClick={() => void runExport('docx')}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {exporting === 'docx' ? '…' : 'Word'}
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0 || exporting !== null}
              onClick={() => void runExport('hwpx')}
              className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-[11px] font-bold text-violet-900 hover:bg-violet-100 disabled:opacity-40"
            >
              {exporting === 'hwpx' ? '…' : 'HWPX'}
            </button>
          </div>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          HWPX는 한컴 한글에서 바로 열 수 있는 OWPML(.hwpx) 파일로 내려받습니다. 서식은 단순화되어 있을 수 있습니다.
        </p>
      </div>

      <div className="p-4">
        {loading && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
            <p className="text-sm text-slate-500">목록을 불러오는 중입니다…</p>
          </div>
        ) : error ? (
          <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-600">아직 저장된 문항이 없습니다.</p>
            <p className="mt-2 text-xs text-slate-500">위에서 지문을 넣고 생성한 뒤 「저장하기」를 눌러 보세요.</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto overflow-hidden rounded-2xl border border-slate-100 md:block">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <th className="w-10 px-2 py-3">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someOnPageSelected;
                        }}
                        onChange={() => toggleSelectAllPage()}
                        className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        aria-label="이 페이지 전체 선택"
                      />
                    </th>
                    {COLUMN_META.filter((c) => colVis[c.key]).map((c) =>
                      c.key === 'status' ? (
                        <th key={c.key} className="relative min-w-[200px] px-4 py-3 text-left normal-case">
                          <div ref={statusLegendRef} className="inline-flex items-center gap-1">
                            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">상태</span>
                            <button
                              type="button"
                              aria-expanded={statusLegendOpen}
                              aria-label="대기 상태 안내"
                              onClick={(e) => {
                                e.stopPropagation();
                                setStatusLegendOpen((o) => !o);
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-violet-300 hover:text-violet-700"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M13 16h-1v-4h-1m1-4h.01M12 20a8 8 0 100-16 8 8 0 000 16z"
                                />
                              </svg>
                            </button>
                            {statusLegendOpen && (
                              <div className="absolute left-4 top-full z-30 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed text-slate-700 shadow-lg ring-1 ring-slate-100">
                                <strong className="text-amber-900">「대기」</strong>는 저장한 문항이 아직{' '}
                                <strong>내용 검수·확인 전</strong>임을 뜻합니다. 직접 읽어 보거나 ChatGPT·Claude 등에
                                붙여 검수한 뒤, 문제가 없으면 <strong className="text-emerald-800">완료</strong>로 바꿀 수
                                있습니다.
                              </div>
                            )}
                          </div>
                        </th>
                      ) : (
                        <th key={c.key} className="px-4 py-3">
                          {c.label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-b border-slate-50 transition last:border-0 hover:bg-violet-50/50"
                      onClick={() => void openDetail(row.id)}
                    >
                      <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.id)}
                          onChange={() => toggleRow(row.id)}
                          className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                          aria-label={`문항 ${row.id} 선택`}
                        />
                      </td>
                      {COLUMN_META.filter((c) => colVis[c.key]).map((c) => (
                        <Fragment key={c.key}>{renderCell(row, c.key)}</Fragment>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 md:hidden">
              {displayRows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4 transition hover:border-violet-200 hover:bg-violet-50/30"
                >
                  <div className="flex gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      onChange={() => toggleRow(row.id)}
                      className="mt-1 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                      aria-label={`문항 ${row.id} 선택`}
                    />
                    <button type="button" onClick={() => void openDetail(row.id)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500">{formatShortDate(row.created_at)}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${statusStyle(row.status)}`}
                        >
                          {row.status}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-bold text-slate-900">{row.type}</p>
                      {colVis.difficulty && row.difficulty ? (
                        <p className="text-[11px] text-slate-500">난이도 {row.difficulty}</p>
                      ) : null}
                      {colVis.textbook ? <p className="mt-1 truncate text-xs text-slate-600">{row.textbook}</p> : null}
                      {colVis.source && row.source ? (
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">출처 {row.source}</p>
                      ) : null}
                      {colVis.question_preview ? (
                        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500">{row.question_preview}</p>
                      ) : null}
                      {colVis.answer_preview && row.answer_preview ? (
                        <p className="mt-1 line-clamp-1 text-[11px] text-slate-600">정답 {row.answer_preview}</p>
                      ) : null}
                      {colVis.options_preview && row.options_preview ? (
                        <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{row.options_preview}</p>
                      ) : null}
                    </button>
                  </div>
                  {row.status === '대기' && (
                    <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-100 pt-2 pl-8" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        disabled={completingId === row.id}
                        onClick={() => {
                          if (!window.confirm('문항을 직접 확인했고, 검수 완료(완료)로 표시할까요?')) return;
                          void patchMarkComplete(row.id);
                        }}
                        className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-900"
                      >
                        직접 검수
                      </button>
                      <button
                        type="button"
                        disabled={completingId === row.id}
                        onClick={() => void openDetail(row.id, 'gpt')}
                        className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-900"
                      >
                        GPT 검수
                      </button>
                      <button
                        type="button"
                        disabled={completingId === row.id}
                        onClick={() => void openDetail(row.id, 'claude')}
                        className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-900"
                      >
                        Claude 검수
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {pageSearch && displayRows.length === 0 && (
              <p className="mt-4 text-center text-sm text-slate-500">검색 조건에 맞는 문항이 이 페이지에 없습니다.</p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500">
              <span>
                총 <strong className="text-slate-800">{total}</strong>건 ·{' '}
                <strong className="text-slate-800">{skip + 1}</strong>–{Math.min(skip + items.length, total)}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={skip <= 0 || loading}
                  onClick={() => void load(Math.max(0, skip - limit))}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  이전
                </button>
                <button
                  type="button"
                  disabled={skip + items.length >= total || loading}
                  onClick={() => void load(skip + limit)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  다음
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {detailId && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm"
          onClick={() => closeDetail()}
        >
          <div
            className="max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-slate-50 to-violet-50/50 px-5 py-4">
              <span className="text-base font-bold text-slate-900">저장한 문항</span>
              <button
                type="button"
                className="rounded-full bg-slate-100 px-4 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-200"
                onClick={() => closeDetail()}
              >
                닫기
              </button>
            </div>
            <div className="max-h-[calc(88vh-4.5rem)] overflow-auto p-5">
              {detailLoading ? (
                <div className="flex justify-center py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
                </div>
              ) : detailError ? (
                <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">{detailError}</p>
              ) : detailMeta && detailQuestionData ? (
                <div className="space-y-5">
                  <dl className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50/80 p-4 text-sm">
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-bold text-slate-500">유형</dt>
                      <dd className="font-semibold text-slate-900">{detailMeta.type || '—'}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-bold text-slate-500">교재</dt>
                      <dd className="text-slate-800">{detailMeta.textbook || '—'}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-bold text-slate-500">출처</dt>
                      <dd className="text-slate-800">{detailMeta.source || '—'}</dd>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2">
                      <dt className="font-bold text-slate-500">상태</dt>
                      <dd>
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${statusStyle(detailMeta.status)}`}
                        >
                          {detailMeta.status || '—'}
                        </span>
                      </dd>
                    </div>
                    {detailMeta.created_at && (
                      <div className="flex flex-wrap gap-x-2 text-xs text-slate-500">
                        <dt className="font-bold">저장 일시</dt>
                        <dd>
                          {new Date(detailMeta.created_at).toLocaleString('ko-KR', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </dd>
                      </div>
                    )}
                  </dl>
                  <QuestionFriendlyPreview data={detailQuestionData} editable={false} />
                  {detailMeta.status === '대기' && (
                    <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50/50 p-4">
                      {reviewChannel === 'gpt' && (
                        <p className="text-xs leading-relaxed text-sky-900">
                          <strong>GPT 검수:</strong> 위의 「전체 복사」로 내용을 ChatGPT 등에 붙여 검수한 뒤, 문제가
                          없으면 아래 <strong>검수 완료로 표시</strong>를 눌러 주세요.
                        </p>
                      )}
                      {reviewChannel === 'claude' && (
                        <p className="text-xs leading-relaxed text-violet-900">
                          <strong>Claude 검수:</strong> 위의 「전체 복사」로 내용을 Claude(채팅)에 붙여 검수한 뒤,
                          문제가 없으면 아래 <strong>검수 완료로 표시</strong>를 눌러 주세요.
                        </p>
                      )}
                      {!reviewChannel && (
                        <p className="text-xs leading-relaxed text-amber-950">
                          내용을 확인한 뒤 <strong>검수 완료로 표시</strong>를 누르면 상태가 완료로 바뀝니다.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!detailId || completingId === detailId}
                          onClick={() => {
                            if (!detailId) return;
                            if (!window.confirm('검수를 마쳤고, 완료 상태로 바꿀까요?')) return;
                            void patchMarkComplete(detailId);
                          }}
                          className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {completingId === detailId ? '처리 중…' : '검수 완료로 표시'}
                        </button>
                        <button
                          type="button"
                          disabled={completingId === detailId}
                          onClick={() => setReviewChannel('gpt')}
                          className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-bold text-sky-900 hover:bg-sky-50 disabled:opacity-50"
                        >
                          GPT 검수 안내
                        </button>
                        <button
                          type="button"
                          disabled={completingId === detailId}
                          onClick={() => setReviewChannel('claude')}
                          className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-bold text-violet-900 hover:bg-violet-50 disabled:opacity-50"
                        >
                          Claude 검수 안내
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
