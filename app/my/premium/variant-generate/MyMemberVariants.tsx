'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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

/** API `textbook` / `source` 빈 값 필터와 동일 */
const FILTER_EMPTY = '__none__';

type FilterMeta = {
  textbooks: string[];
  sources: string[];
  statuses: string[];
  difficulties: string[];
  hasEmptyTextbook: boolean;
  hasEmptySource: boolean;
};

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
  /** preview: 최신 10건만 + 전체 보기 링크 / full: 기존 페이지네이션(25건) */
  listMode?: 'preview' | 'full';
  /** 목록 내 특정 문항을 잠깐 강조하고 그 위치로 스크롤 (방금 저장한 문항 등) */
  highlightVariantId?: string;
};

type DetailMeta = {
  textbook: string;
  source: string;
  type: string;
  status: string;
  created_at: string | null;
};

type ExportFormat = 'xlsx' | 'pdf' | 'docx' | 'hwpx';

const EXPORT_FORMATS: ExportFormat[] = ['xlsx', 'pdf', 'docx', 'hwpx'];
const EXPORT_META: Record<ExportFormat, { label: string; short: string; badge: string; tip: string }> = {
  xlsx: { label: '엑셀', short: 'XLS', badge: 'bg-emerald-600', tip: '엑셀(.xlsx)로 내려받습니다.' },
  pdf: { label: 'PDF', short: 'PDF', badge: 'bg-rose-600', tip: 'PDF로 내려받습니다.' },
  docx: { label: 'Word', short: 'DOC', badge: 'bg-indigo-600', tip: 'MS Word(.docx)로 내려받습니다.' },
  hwpx: { label: 'HWPX', short: 'HWP', badge: 'bg-violet-600', tip: '한컴 한글에서 바로 열 수 있는 OWPML(.hwpx) 파일로 내려받습니다.' },
};

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

export default function MyMemberVariants({ refreshKey, listMode = 'full', highlightVariantId }: Props) {
  const isPreview = listMode === 'preview';
  const pageLimit = isPreview ? 10 : 25;
  /** 방금 저장한 행을 몇 초간 강조 — CSS 하이라이트를 토글 */
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const setRowRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<Row[]>([]);
  const [skip, setSkip] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [textbookFilter, setTextbookFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('');
  const [pageSearch, setPageSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterMeta, setFilterMeta] = useState<FilterMeta | null>(null);
  const [scopedSources, setScopedSources] = useState<string[] | null>(null);
  const [scopedSourcesLoading, setScopedSourcesLoading] = useState(false);
  const [scopedHasEmptySource, setScopedHasEmptySource] = useState(false);
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
  const [exportMode, setExportMode] = useState<'student' | 'teacher'>('teacher');
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

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(pageSearch.trim()), 320);
    return () => window.clearTimeout(t);
  }, [pageSearch]);

  useEffect(() => {
    fetch('/api/my/member-variant/questions/filters', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok === true) {
          setFilterMeta({
            textbooks: Array.isArray(d.textbooks) ? d.textbooks : [],
            sources: Array.isArray(d.sources) ? d.sources : [],
            statuses: Array.isArray(d.statuses) ? d.statuses : [],
            difficulties: Array.isArray(d.difficulties) ? d.difficulties : [],
            hasEmptyTextbook: d.hasEmptyTextbook === true,
            hasEmptySource: d.hasEmptySource === true,
          });
        } else {
          setFilterMeta({
            textbooks: [],
            sources: [],
            statuses: [],
            difficulties: [],
            hasEmptyTextbook: false,
            hasEmptySource: false,
          });
        }
      })
      .catch(() =>
        setFilterMeta({
          textbooks: [],
          sources: [],
          statuses: [],
          difficulties: [],
          hasEmptyTextbook: false,
          hasEmptySource: false,
        }),
      );
  }, [refreshKey]);

  useEffect(() => {
    if (!textbookFilter) {
      setScopedSources(null);
      setScopedSourcesLoading(false);
      setScopedHasEmptySource(false);
      return;
    }
    setScopedSources(null);
    setScopedSourcesLoading(true);
    const qs = new URLSearchParams();
    qs.set('textbook', textbookFilter);
    fetch(`/api/my/member-variant/questions/filters?${qs}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok === true && Array.isArray(d.sources)) {
          setScopedSources(d.sources);
          setScopedHasEmptySource(d.hasEmptySource === true);
        } else {
          setScopedSources([]);
          setScopedHasEmptySource(false);
        }
      })
      .catch(() => {
        setScopedSources([]);
        setScopedHasEmptySource(false);
      })
      .finally(() => setScopedSourcesLoading(false));
  }, [textbookFilter, refreshKey]);

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
        const qs = new URLSearchParams({ skip: String(nextSkip), limit: String(pageLimit) });
        if (typeFilter) qs.set('type', typeFilter);
        if (textbookFilter) qs.set('textbook', textbookFilter);
        if (sourceFilter) qs.set('source', sourceFilter);
        if (statusFilter) qs.set('status', statusFilter);
        if (difficultyFilter) qs.set('difficulty', difficultyFilter);
        if (debouncedSearch) qs.set('search', debouncedSearch);
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
    [
      typeFilter,
      textbookFilter,
      sourceFilter,
      statusFilter,
      difficultyFilter,
      debouncedSearch,
      pageLimit,
    ],
  );

  useEffect(() => {
    void load(0);
  }, [
    refreshKey,
    typeFilter,
    textbookFilter,
    sourceFilter,
    statusFilter,
    difficultyFilter,
    debouncedSearch,
    load,
  ]);

  /** highlightVariantId가 지정되고 해당 id가 현재 목록에 있으면 스크롤 + 하이라이트 */
  useEffect(() => {
    if (!highlightVariantId) return;
    if (!items.some((r) => r.id === highlightVariantId)) return;
    const el = rowRefs.current.get(highlightVariantId);
    if (el) {
      const t = window.setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
      return () => window.clearTimeout(t);
    }
  }, [highlightVariantId, items]);

  useEffect(() => {
    if (!highlightVariantId) return;
    if (!items.some((r) => r.id === highlightVariantId)) return;
    setFlashId(highlightVariantId);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setFlashId(null), 2800);
    return () => {
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
        flashTimeoutRef.current = null;
      }
    };
  }, [highlightVariantId, items]);

  const selectedOnPage = useMemo(() => {
    return items.filter((r) => selectedIds.has(r.id));
  }, [items, selectedIds]);

  const allOnPageSelected = items.length > 0 && selectedOnPage.length === items.length;
  const someOnPageSelected = selectedOnPage.length > 0 && !allOnPageSelected;

  const hasActiveFilters = Boolean(
    typeFilter ||
      textbookFilter ||
      sourceFilter ||
      statusFilter ||
      difficultyFilter ||
      debouncedSearch,
  );

  const sourceOptions = useMemo(() => {
    if (!textbookFilter) return filterMeta?.sources ?? [];
    if (scopedSourcesLoading && scopedSources === null) return [];
    return scopedSources ?? [];
  }, [textbookFilter, scopedSources, scopedSourcesLoading, filterMeta?.sources]);

  const resetFilters = () => {
    setTypeFilter('');
    setTextbookFilter('');
    setSourceFilter('');
    setStatusFilter('');
    setDifficultyFilter('');
    setPageSearch('');
  };

  const toggleSelectAllPage = () => {
    if (allOnPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of items) next.delete(r.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of items) next.add(r.id);
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
        body: JSON.stringify({ format, ids, mode: exportMode }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as Record<string, unknown>));
        const err = typeof j?.error === 'string' ? j.error : '보내기에 실패했습니다.';
        const detail = typeof (j as Record<string, unknown>)?.detail === 'string'
          ? `\n\n[원인] ${(j as Record<string, string>).detail}`
          : `\n\n[HTTP ${res.status}]`;
        window.alert(`${err}${detail}`);
        return;
      }
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const ext =
        format === 'xlsx' ? 'xlsx' : format === 'pdf' ? 'pdf' : format === 'hwpx' ? 'hwpx' : 'docx';
      const modeSuffix = exportMode === 'student' ? '_학생용' : '_교사용';
      const base = `회원변형문항${modeSuffix}_${stamp}`;
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
      <div className="border-b border-slate-100 px-5 py-4">
        {/* 1열 — 키워드 검색 풀폭 (가장 자주 쓰는 입력) */}
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-slate-600">키워드 검색</span>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10 18a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
            </span>
            <input
              value={pageSearch}
              onChange={(e) => setPageSearch(e.target.value)}
              placeholder="발문·지문·교재·출처·유형으로 전체 문항 검색"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
        </label>

        {/* 2열 — 셀렉트 5개 (sm 2열 / lg 3열) + 우측 액션 */}
        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-xs font-bold text-slate-600">
              유형
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
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
            <label className="block text-xs font-bold text-slate-600">
              교재
              <select
                value={textbookFilter}
                onChange={(e) => {
                  setTextbookFilter(e.target.value);
                  setSourceFilter('');
                }}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              >
                <option value="">전체 교재</option>
                {filterMeta?.hasEmptyTextbook ? (
                  <option value={FILTER_EMPTY}>(교재 없음)</option>
                ) : null}
                {(filterMeta?.textbooks ?? []).map((tb) => (
                  <option key={tb} value={tb}>
                    {tb.length > 42 ? `${tb.slice(0, 42)}…` : tb}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold text-slate-600">
              <span className="inline-flex items-center gap-1">
                출처
                <span
                  className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-200 bg-white text-[9px] font-bold text-slate-500"
                  title="교재를 먼저 고르면 그 교재에 있는 출처로만 목록이 줄어듭니다."
                  aria-label="출처 필터 안내"
                >
                  i
                </span>
              </span>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                disabled={!!textbookFilter && scopedSourcesLoading}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-60"
              >
                <option value="">전체 출처</option>
                {(textbookFilter ? scopedHasEmptySource : filterMeta?.hasEmptySource) ? (
                  <option value={FILTER_EMPTY}>(출처 없음)</option>
                ) : null}
                {sourceOptions.map((s) => (
                  <option key={s} value={s}>
                    {s.length > 48 ? `${s.slice(0, 48)}…` : s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold text-slate-600">
              상태
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              >
                <option value="">전체 상태</option>
                {(filterMeta?.statuses ?? []).map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold text-slate-600">
              난이도
              <select
                value={difficultyFilter}
                onChange={(e) => setDifficultyFilter(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              >
                <option value="">전체 난이도</option>
                {(filterMeta?.difficulties ?? []).map((df) => (
                  <option key={df} value={df}>
                    {df}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={resetFilters}
              disabled={!hasActiveFilters}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:bg-white disabled:hover:text-slate-700"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9M20 20v-5h-.581m0 0a8.003 8.003 0 01-15.357-2" />
              </svg>
              필터·검색 초기화
            </button>
            {isPreview && (
              <Link
                href="/my/premium/member-variants"
                className="rounded-xl bg-violet-600 px-4 py-2.5 text-center text-xs font-bold text-white shadow-sm shadow-violet-500/20 transition hover:bg-violet-700"
              >
                전체 목록 보기
              </Link>
            )}
          </div>
        </div>
        {isPreview && (
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            이 목록에는 <strong className="text-slate-700">최신 10개</strong>만 빠르게 보여 드려요. 나머지는{' '}
            <Link href="/my/premium/member-variants" className="font-bold text-violet-700 underline decoration-violet-200 underline-offset-2 hover:text-violet-900">
              전체 목록 보기
            </Link>
            에서 확인할 수 있어요.
          </p>
        )}
      </div>

      <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-600">
              선택 <strong className="text-violet-700">{selectedIds.size}</strong>건
            </span>
            <button
              type="button"
              disabled={items.length === 0 || loading}
              onClick={() => toggleSelectAllPage()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              {allOnPageSelected ? '이 페이지 선택 해제' : '이 페이지 전체 선택'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* 학생용/교사용 토글 */}
            <div className="flex rounded-lg overflow-hidden border border-slate-200 bg-white shadow-sm text-[11px] font-bold shrink-0">
              <button
                type="button"
                onClick={() => setExportMode('student')}
                className={`px-3 py-1.5 transition ${exportMode === 'student' ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                title="학생용 — 정답·해설 제외"
              >
                학생용
              </button>
              <button
                type="button"
                onClick={() => setExportMode('teacher')}
                className={`px-3 py-1.5 transition ${exportMode === 'teacher' ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                title="교사용 — 정답·해설 포함"
              >
                교사용
              </button>
            </div>
            {EXPORT_FORMATS.map((fmt) => {
              const meta = EXPORT_META[fmt];
              const disabled = selectedIds.size === 0 || exporting !== null;
              const tip =
                selectedIds.size === 0
                  ? '항목을 먼저 선택하세요'
                  : fmt === 'hwpx'
                    ? 'HWPX(한컴 한글) — 서식이 단순화될 수 있습니다.'
                    : meta.tip;
              return (
                <button
                  key={fmt}
                  type="button"
                  disabled={disabled}
                  onClick={() => void runExport(fmt)}
                  title={tip}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span
                    className={`inline-flex h-4 min-w-[1.75rem] items-center justify-center rounded px-1 text-[9px] font-extrabold uppercase tracking-wide text-white ${meta.badge}`}
                    aria-hidden
                  >
                    {meta.short}
                  </span>
                  <span>{exporting === fmt ? '내보내는 중…' : meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>
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
          <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm">
            {hasActiveFilters ? (
              <>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10 18a8 8 0 100-16 8 8 0 000 16z" />
                  </svg>
                </div>
                <p className="text-sm font-bold text-slate-800">조건에 맞는 문항이 없습니다.</p>
                <p className="mt-1.5 text-xs text-slate-500">교재·출처·유형·상태·난이도 또는 검색어를 바꿔 보세요.</p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-violet-700"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9M20 20v-5h-.581m0 0a8.003 8.003 0 01-15.357-2" />
                  </svg>
                  필터·검색 초기화
                </button>
              </>
            ) : (
              <>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6M9 8h6M5 21h14a2 2 0 002-2V7l-5-5H5a2 2 0 00-2 2v15a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm font-bold text-slate-800">아직 저장된 문항이 없습니다.</p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  지문을 넣고 변형문제를 만든 뒤 「저장하기」를 누르면 여기에 모입니다.
                </p>
                <Link
                  href="/my/premium/variant-generate"
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-violet-700"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  변형문제 만들기로 이동
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            {/* 테이블 우상단 — 열 표시 (다운로드 액션과 분리해 성격 구분) */}
            <div className="mb-2 hidden items-center justify-end md:flex">
              <div className="relative" ref={colMenuRef}>
                <button
                  type="button"
                  onClick={() => setColMenuOpen((o) => !o)}
                  aria-expanded={colMenuOpen}
                  title="테이블 열 표시 설정"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
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
              </div>
            </div>
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
                  {items.map((row) => (
                    <tr
                      key={row.id}
                      ref={(el) => setRowRef(row.id, el)}
                      className={`cursor-pointer border-b border-slate-50 transition last:border-0 ${
                        flashId === row.id
                          ? 'bg-amber-50 ring-2 ring-amber-400 ring-offset-[-2px] anim-fade-slide-top'
                          : 'hover:bg-violet-50/50'
                      }`}
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
              {items.map((row) => (
                <div
                  key={row.id}
                  ref={(el) => setRowRef(row.id, el)}
                  className={`rounded-2xl border p-4 transition ${
                    flashId === row.id
                      ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-300 anim-fade-slide-top'
                      : 'border-slate-100 bg-slate-50/50 hover:border-violet-200 hover:bg-violet-50/30'
                  }`}
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

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500">
              {isPreview ? (
                <>
                  <span>
                    전체 <strong className="text-slate-800">{total}</strong>건 중{' '}
                    <strong className="text-slate-800">최신 {Math.min(total, pageLimit)}건</strong>만 표시
                  </span>
                  {total > pageLimit ? (
                    <Link
                      href="/my/premium/member-variants"
                      className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-bold text-violet-900 hover:bg-violet-100"
                    >
                      나머지 {total - pageLimit}건 보기 →
                    </Link>
                  ) : null}
                </>
              ) : (
                <>
                  <span>
                    총 <strong className="text-slate-800">{total}</strong>건 ·{' '}
                    <strong className="text-slate-800">{skip + 1}</strong>–{Math.min(skip + items.length, total)}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={skip <= 0 || loading}
                      onClick={() => void load(Math.max(0, skip - pageLimit))}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      이전
                    </button>
                    <button
                      type="button"
                      disabled={skip + items.length >= total || loading}
                      onClick={() => void load(skip + pageLimit)}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      다음
                    </button>
                  </div>
                </>
              )}
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
