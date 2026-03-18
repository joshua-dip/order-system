'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const GQ_COL_STORAGE = 'admin-generated-questions-col-widths-v4';
const VALIDATE_EXCLUDE_STORAGE = 'admin-gq-validate-excluded-types';
const GQ_COL_MINS = [130, 100, 160, 200, 200, 88, 88, 180, 80];
const GQ_COL_MAXS = [480, 280, 560, 720, 720, 280, 320, 800, 200];
const GQ_COL_DEFAULTS = [200, 140, 280, 320, 320, 120, 140, 260, 100];

const DEFAULT_QUESTION_JSON = `{
  "순서": 1,
  "Source": "",
  "NumQuestion": 1,
  "Category": "",
  "Question": "",
  "Paragraph": "",
  "Options": "",
  "OptionType": "English",
  "CorrectAnswer": "",
  "Explanation": ""
}`;

type Row = {
  _id: string;
  textbook: string;
  passage_id: string | null;
  source: string;
  type: string;
  option_type?: string;
  question_data?: {
    Question?: string;
    Paragraph?: string;
    NumQuestion?: number;
    Category?: string;
    Options?: string;
    Explanation?: string;
  };
  created_at?: string;
};

export default function AdminGeneratedQuestionsPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ loginId: string; role: string } | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);

  const [filterTextbook, setFilterTextbook] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPassageId, setFilterPassageId] = useState('');
  const [filterQ, setFilterQ] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<Row[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    textbook: '',
    passage_id: '',
    source: '',
    type: '',
    option_type: 'English',
    status: '완료',
    error_msg: '',
  });
  const [questionJson, setQuestionJson] = useState(DEFAULT_QUESTION_JSON);

  type SolveResult = {
    claudeAnswer: string;
    claudeResponse: string;
    correctAnswer: string | null;
    isCorrect: boolean | null;
  };

  const [solveOpen, setSolveOpen] = useState(false);
  const [solveLoading, setSolveLoading] = useState(false);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);
  const [solveRow, setSolveRow] = useState<{
    id: string; source: string; type: string; textbook: string;
    question: string; paragraph: string; options: string; correctAnswer: string;
  } | null>(null);

  type DuplicateGroup = {
    questionType: string;
    optionsFull: string;
    optionsPreview: string;
    duplicateCount: number;
    sampleItems: { id: string; textbook: string; source: string; type: string }[];
    truncated: boolean;
  };
  const [validateOpen, setValidateOpen] = useState(false);
  const [validateLoading, setValidateLoading] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [validateData, setValidateData] = useState<{
    scannedDocuments: number;
    duplicateGroupCount: number;
    summaryByType: Record<string, number>;
    excludedTypes: string[];
    groups: DuplicateGroup[];
    filters: { textbook: string | null; type: string | null };
  } | null>(null);
  const [validateExpanded, setValidateExpanded] = useState<Record<number, boolean>>({});
  const [validateExcludedTypes, setValidateExcludedTypes] = useState<string[]>([]);

  useEffect(() => {
    try {
      const s = localStorage.getItem(VALIDATE_EXCLUDE_STORAGE);
      if (s) {
        const p = JSON.parse(s) as unknown;
        if (Array.isArray(p)) {
          setValidateExcludedTypes(p.filter((x): x is string => typeof x === 'string'));
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VALIDATE_EXCLUDE_STORAGE, JSON.stringify(validateExcludedTypes));
    } catch {
      /* ignore */
    }
  }, [validateExcludedTypes]);

  const [colWidths, setColWidths] = useState<number[]>(GQ_COL_DEFAULTS);
  const dragRef = useRef<{ i: number; startX: number; startW: number } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(GQ_COL_STORAGE);
      if (raw) {
        const p = JSON.parse(raw) as unknown;
        if (Array.isArray(p) && p.length === GQ_COL_DEFAULTS.length) {
          const next = GQ_COL_DEFAULTS.map((d, i) => {
            const n = Number(p[i]);
            if (!Number.isFinite(n)) return d;
            return Math.min(GQ_COL_MAXS[i], Math.max(GQ_COL_MINS[i], n));
          });
          setColWidths(next);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(GQ_COL_STORAGE, JSON.stringify(colWidths));
    } catch {
      /* ignore */
    }
  }, [colWidths]);

  const startColResize = (colIndex: number, clientX: number) => {
    dragRef.current = {
      i: colIndex,
      startX: clientX,
      startW: colWidths[colIndex],
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const w = Math.min(
        GQ_COL_MAXS[d.i],
        Math.max(GQ_COL_MINS[d.i], d.startW + e.clientX - d.startX)
      );
      setColWidths((prev) => {
        const next = [...prev];
        next[d.i] = w;
        return next;
      });
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });
  };

  const resetColWidths = () => {
    setColWidths([...GQ_COL_DEFAULTS]);
    try {
      localStorage.removeItem(GQ_COL_STORAGE);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.user || d.user.role !== 'admin') {
          router.replace('/admin/login?from=/admin/generated-questions');
          return;
        }
        setUser(d.user);
      })
      .catch(() => router.replace('/admin/login?from=/admin/generated-questions'))
      .finally(() => setLoadingAuth(false));
  }, [router]);

  const fetchMeta = useCallback(() => {
    fetch('/api/admin/generated-questions/meta', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setTextbooks(Array.isArray(d.textbooks) ? d.textbooks : []);
        setTypes(Array.isArray(d.types) ? d.types : []);
        setStatuses(Array.isArray(d.statuses) ? d.statuses : []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchMeta();
  }, [user, fetchMeta]);

  const fetchList = useCallback(() => {
    setListLoading(true);
    const params = new URLSearchParams();
    if (filterTextbook) params.set('textbook', filterTextbook);
    if (filterType) params.set('type', filterType);
    if (filterPassageId.trim()) params.set('passage_id', filterPassageId.trim());
    if (filterQ) params.set('q', filterQ);
    params.set('page', String(page));
    params.set('limit', String(limit));
    fetch(`/api/admin/generated-questions?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setItems(Array.isArray(d.items) ? d.items : []);
        setTotal(typeof d.total === 'number' ? d.total : 0);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setListLoading(false));
  }, [filterTextbook, filterType, filterPassageId, filterQ, page, limit]);

  useEffect(() => {
    if (!user) return;
    fetchList();
  }, [user, fetchList]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      textbook: filterTextbook || '',
      passage_id: filterPassageId.trim() || '',
      source: '',
      type: filterType || '',
      option_type: 'English',
      status: '완료',
      error_msg: '',
    });
    setQuestionJson(DEFAULT_QUESTION_JSON);
    setModalOpen(true);
  };

  const openEdit = async (id: string) => {
    setEditingId(id);
    try {
      const res = await fetch(`/api/admin/generated-questions/${id}`, { credentials: 'include' });
      const d = await res.json();
      if (!res.ok || !d.item) {
        alert(d.error || '불러오기 실패');
        return;
      }
      const it = d.item as Record<string, unknown>;
      setForm({
        textbook: String(it.textbook ?? ''),
        passage_id: String(it.passage_id ?? ''),
        source: String(it.source ?? ''),
        type: String(it.type ?? ''),
        option_type: String(it.option_type ?? 'English'),
        status: String(it.status ?? '완료'),
        error_msg: it.error_msg == null ? '' : String(it.error_msg),
      });
      const qd = it.question_data;
      setQuestionJson(
        qd && typeof qd === 'object' ? JSON.stringify(qd, null, 2) : DEFAULT_QUESTION_JSON
      );
      setModalOpen(true);
    } catch {
      alert('요청 실패');
    }
  };

  const handleSave = async () => {
    if (!form.textbook.trim() || !form.passage_id.trim()) {
      alert('교재명과 passage_id(원문 문서 ObjectId)는 필수입니다.');
      return;
    }
    if (!editingId && (!form.source.trim() || !form.type.trim())) {
      alert('출처(source)와 유형(type)은 필수입니다.');
      return;
    }
    let question_data: Record<string, unknown>;
    try {
      question_data = JSON.parse(questionJson) as Record<string, unknown>;
      if (!question_data || typeof question_data !== 'object' || Array.isArray(question_data)) {
        throw new Error('invalid');
      }
    } catch {
      alert('question_data JSON 형식을 확인해 주세요.');
      return;
    }

    setSaving(true);
    try {
      const url = editingId ? `/api/admin/generated-questions/${editingId}` : '/api/admin/generated-questions';
      const method = editingId ? 'PATCH' : 'POST';
      const body = editingId
        ? {
            textbook: form.textbook.trim(),
            passage_id: form.passage_id.trim(),
            source: form.source.trim(),
            type: form.type.trim(),
            option_type: form.option_type.trim(),
            status: form.status.trim(),
            error_msg: form.error_msg.trim() || null,
            question_data,
          }
        : {
            textbook: form.textbook.trim(),
            passage_id: form.passage_id.trim(),
            source: form.source.trim(),
            type: form.type.trim(),
            option_type: form.option_type.trim(),
            status: form.status.trim(),
            error_msg: form.error_msg.trim() || null,
            question_data,
          };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '저장 실패');
        return;
      }
      setModalOpen(false);
      fetchList();
      fetchMeta();
    } catch {
      alert('요청 중 오류');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 변형문제를 삭제할까요? 되돌릴 수 없습니다.')) return;
    try {
      const res = await fetch(`/api/admin/generated-questions/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok) {
        alert(d.error || '삭제 실패');
        return;
      }
      fetchList();
      fetchMeta();
    } catch {
      alert('요청 실패');
    }
  };

  const openSolve = async (id: string) => {
    setSolveOpen(true);
    setSolveResult(null);
    setSolveError(null);
    setSolveRow(null);
    setSolveLoading(true);
    try {
      const res = await fetch(`/api/admin/generated-questions/${id}`, { credentials: 'include' });
      const d = await res.json();
      if (!res.ok || !d.item) {
        setSolveError(d.error || '문제 데이터 불러오기 실패');
        setSolveLoading(false);
        return;
      }
      const it = d.item as Record<string, unknown>;
      const qd = (it.question_data as Record<string, unknown>) || {};
      const rowData = {
        id,
        source: String(it.source ?? ''),
        type: String(it.type ?? ''),
        textbook: String(it.textbook ?? ''),
        question: String(qd.Question ?? ''),
        paragraph: String(qd.Paragraph ?? ''),
        options: String(qd.Options ?? ''),
        correctAnswer: String(qd.CorrectAnswer ?? ''),
      };
      setSolveRow(rowData);

      const solveRes = await fetch('/api/admin/generated-questions/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          question: rowData.question,
          paragraph: rowData.paragraph,
          options: rowData.options,
          correctAnswer: rowData.correctAnswer,
          questionType: rowData.type,
        }),
      });
      const sd = await solveRes.json();
      if (!solveRes.ok) {
        setSolveError(sd.error || '풀기 요청 실패');
        return;
      }
      setSolveResult(sd as SolveResult);
    } catch {
      setSolveError('네트워크 오류');
    } finally {
      setSolveLoading(false);
    }
  };

  const openValidateModal = () => {
    setValidateOpen(true);
    setValidateData(null);
    setValidateError(null);
    setValidateExpanded({});
    if (types.length === 0) fetchMeta();
  };

  const runOptionsDuplicateValidate = async () => {
    setValidateLoading(true);
    setValidateError(null);
    setValidateData(null);
    setValidateExpanded({});
    try {
      const params = new URLSearchParams();
      if (filterTextbook) params.set('textbook', filterTextbook);
      if (filterType) params.set('type', filterType);
      validateExcludedTypes.forEach((t) => params.append('exclude_type', t));
      const res = await fetch(
        `/api/admin/generated-questions/validate/duplicate-options?${params}`,
        { credentials: 'include' }
      );
      const d = await res.json();
      if (!res.ok) {
        setValidateError(d.error || '검증 요청 실패');
        return;
      }
      const rawGroups: DuplicateGroup[] = Array.isArray(d.groups)
        ? d.groups.map((g: Record<string, unknown>) => ({
            questionType: String(g.questionType ?? '—'),
            optionsFull: String(g.optionsFull ?? ''),
            optionsPreview: String(g.optionsPreview ?? ''),
            duplicateCount: Number(g.duplicateCount) || 0,
            sampleItems: Array.isArray(g.sampleItems) ? g.sampleItems : [],
            truncated: !!g.truncated,
          }))
        : [];
      setValidateData({
        scannedDocuments: d.scannedDocuments ?? 0,
        duplicateGroupCount: d.duplicateGroupCount ?? 0,
        summaryByType:
          d.summaryByType && typeof d.summaryByType === 'object' ? d.summaryByType : {},
        excludedTypes: Array.isArray(d.excludedTypes) ? d.excludedTypes : [],
        groups: rawGroups,
        filters: d.filters ?? { textbook: null, type: null },
      });
    } catch {
      setValidateError('네트워크 오류');
    } finally {
      setValidateLoading(false);
    }
  };

  const openEditFromValidate = (id: string) => {
    setValidateOpen(false);
    openEdit(id);
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const questionPreview = (row: Row) => row.question_data?.Question || '—';

  if (loadingAuth || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin w-10 h-10 border-4 border-slate-600 border-t-violet-400 rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="border-b border-slate-700 bg-slate-800/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">변형문제 관리</h1>
            <p className="text-slate-400 text-sm mt-0.5">MongoDB · gomijoshua.generated_questions</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="text-slate-300 hover:text-white text-sm px-3 py-2 rounded-lg border border-slate-600 hover:border-slate-500"
            >
              ← 관리자 홈
            </Link>
            <Link
              href="/admin/passages"
              className="text-slate-300 hover:text-white text-sm px-3 py-2 rounded-lg border border-slate-600 hover:border-slate-500"
            >
              원문 관리
            </Link>
            <button
              type="button"
              onClick={openCreate}
              className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold px-4 py-2 rounded-lg"
            >
              + 새 변형문제
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 mb-6 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">교재</label>
            <select
              value={filterTextbook}
              onChange={(e) => {
                setFilterTextbook(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm min-w-[200px] text-white"
            >
              <option value="">전체</option>
              {textbooks.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">유형</label>
            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm min-w-[120px] text-white"
            >
              <option value="">전체</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">passage_id</label>
            <input
              value={filterPassageId}
              onChange={(e) => {
                setFilterPassageId(e.target.value);
                setPage(1);
              }}
              placeholder="원문 ObjectId"
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 w-48 text-white font-mono text-xs placeholder:text-slate-500"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs text-slate-400 mb-1">검색 (출처·발문·지문)</label>
            <input
              value={filterQ}
              onChange={(e) => {
                setFilterQ(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
            />
          </div>
          <button
            type="button"
            onClick={() => fetchList()}
            className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm font-medium"
          >
            새로고침
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <p className="text-slate-400 text-sm">
            총 <span className="text-white font-semibold">{total}</span>건 · {page}/{totalPages}페이지
          </p>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              type="button"
              disabled={validateLoading}
              onClick={openValidateModal}
              className="shrink-0 bg-amber-800/90 hover:bg-amber-700 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-amber-100 border border-amber-500/40"
              title="표의 Options 열 기준 · 모달에서 제외 유형 선택 후 검증"
            >
              Options 중복 검증
            </button>
            <span className="hidden sm:inline h-4 w-px bg-slate-600" aria-hidden />
            <p className="text-slate-500 text-xs flex items-center gap-2">
              <span className="hidden md:inline">헤더 오른쪽 가장자리를 드래그하면 열 너비 조절</span>
              <button
                type="button"
                onClick={resetColWidths}
                className="text-violet-400 hover:text-violet-300 underline text-xs whitespace-nowrap"
              >
                열 너비 초기화
              </button>
            </p>
          </div>
        </div>

        <div className="border border-slate-700 rounded-xl overflow-hidden bg-slate-800/30">
          <div className="overflow-x-auto">
            <table className="text-sm table-fixed border-collapse" style={{ width: colWidths.reduce((a, b) => a + b, 0) }}>
              <thead>
                <tr className="bg-slate-800 text-left text-slate-300 border-b border-slate-700">
                  {[
                    { label: '교재', i: 0 },
                    { label: '유형 (type)', i: 1, cls: 'text-violet-300/90' },
                    { label: 'Paragraph', i: 2 },
                    { label: 'Options', i: 3 },
                    { label: 'Explanation', i: 4 },
                    { label: '출처', i: 5 },
                    { label: 'passage', i: 6, cls: 'font-mono text-xs' },
                    { label: '발문', i: 7 },
                    { label: '작업', i: 8, cls: 'text-right' },
                  ].map(({ label, i, cls }) => (
                    <th
                      key={i}
                      className={`relative px-2 py-3 font-medium align-top select-none ${cls || ''}`}
                      style={{
                        width: colWidths[i],
                        minWidth: colWidths[i],
                        maxWidth: colWidths[i],
                        boxSizing: 'border-box',
                      }}
                    >
                      <span className="block truncate pr-3" title={label}>
                        {label}
                      </span>
                      <div
                        role="separator"
                        aria-hidden
                        className="absolute top-0 right-0 h-full w-2 cursor-col-resize z-10 flex items-center justify-end pr-0"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          startColResize(i, e.clientX);
                        }}
                      >
                        <span className="h-[60%] w-px bg-slate-600 hover:bg-violet-500 hover:w-0.5 block" />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listLoading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                      불러오는 중…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                      데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  items.map((row) => {
                    const qd = row.question_data || {};
                    const para = typeof qd.Paragraph === 'string' ? qd.Paragraph : '';
                    const opt = typeof qd.Options === 'string' ? qd.Options : '';
                    const expl = typeof qd.Explanation === 'string' ? qd.Explanation : '';
                    const cat = (typeof qd.Category === 'string' ? qd.Category : '').trim();
                    const typeStr = (row.type || '').trim();
                    const showCategoryNote = cat && cat !== typeStr;
                    return (
                    <tr key={row._id} className="border-b border-slate-700/80 hover:bg-slate-800/40">
                      <td
                        className="px-2 py-2 text-slate-200 align-top truncate border-r border-slate-700/30"
                        style={{ width: colWidths[0], maxWidth: colWidths[0] }}
                        title={row.textbook}
                      >
                        {row.textbook}
                      </td>
                      <td
                        className="px-2 py-2 align-top border-r border-slate-700/30 overflow-hidden"
                        style={{ width: colWidths[1], maxWidth: colWidths[1] }}
                        title={showCategoryNote ? `${typeStr} · Category: ${cat}` : typeStr}
                      >
                        <span className="text-violet-300 font-medium break-words">{typeStr || '—'}</span>
                        {showCategoryNote && (
                          <div className="text-[11px] text-amber-200/80 mt-1 leading-snug border-t border-slate-600/50 pt-1">
                            <span className="text-slate-500">Category: </span>
                            {cat}
                          </div>
                        )}
                      </td>
                      <td
                        className="px-2 py-2 text-slate-300 align-top border-r border-slate-700/30 text-[13px] leading-snug"
                        style={{ width: colWidths[2], maxWidth: colWidths[2] }}
                        title={para.length > 200 ? para.slice(0, 200) + '…' : para || undefined}
                      >
                        <div className="max-h-52 overflow-y-auto break-words whitespace-pre-wrap pr-1 text-slate-200/95">
                          {para || '—'}
                        </div>
                      </td>
                      <td
                        className="px-2 py-2 text-slate-300 align-top border-r border-slate-700/30 text-[13px] leading-snug"
                        style={{ width: colWidths[3], maxWidth: colWidths[3] }}
                      >
                        <div className="max-h-52 overflow-y-auto break-words whitespace-pre-wrap pr-1">
                          {opt || '—'}
                        </div>
                      </td>
                      <td
                        className="px-2 py-2 text-slate-300 align-top border-r border-slate-700/30 text-[13px] leading-snug"
                        style={{ width: colWidths[4], maxWidth: colWidths[4] }}
                      >
                        <div className="max-h-52 overflow-y-auto break-words whitespace-pre-wrap pr-1">
                          {expl || '—'}
                        </div>
                      </td>
                      <td
                        className="px-2 py-2 text-slate-400 align-top truncate border-r border-slate-700/30"
                        style={{ width: colWidths[5], maxWidth: colWidths[5] }}
                        title={row.source}
                      >
                        {row.source}
                      </td>
                      <td
                        className="px-2 py-2 text-slate-500 align-top font-mono text-[10px] truncate border-r border-slate-700/30"
                        style={{ width: colWidths[6], maxWidth: colWidths[6] }}
                        title={row.passage_id || ''}
                      >
                        {row.passage_id ? `${row.passage_id.slice(0, 8)}…` : '—'}
                      </td>
                      <td
                        className="px-2 py-2 text-slate-400 align-top border-r border-slate-700/30 overflow-hidden"
                        style={{ width: colWidths[7], maxWidth: colWidths[7] }}
                      >
                        <span className="line-clamp-3 break-words" title={questionPreview(row)}>
                          {questionPreview(row)}
                        </span>
                      </td>
                      <td
                        className="px-2 py-2 text-right align-top whitespace-nowrap"
                        style={{ width: colWidths[8], maxWidth: colWidths[8] }}
                      >
                        <button
                          type="button"
                          onClick={() => openSolve(row._id)}
                          className="text-emerald-400 hover:text-emerald-300 mr-2"
                        >
                          풀기
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(row._id)}
                          className="text-violet-400 hover:text-violet-300 mr-2"
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(row._id)}
                          className="text-red-400 hover:text-red-300"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-6">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-600 disabled:opacity-40"
            >
              이전
            </button>
            <span className="px-4 py-2 text-slate-400">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-600 disabled:opacity-40"
            >
              다음
            </button>
          </div>
        )}
      </main>

      {validateOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
          <div className="bg-slate-800 border border-amber-700/40 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-600 flex justify-between items-center shrink-0 bg-slate-800/95">
              <div>
                <h2 className="text-lg font-bold text-amber-200">Options 중복 데이터 검증</h2>
                <p className="text-xs text-slate-400 mt-1">
                  <strong className="text-slate-300">같은 유형(type)</strong> 안에서만 Options가 완전히 같으면 중복으로 묶습니다(trim 기준).
                  교재·유형 필터 적용, 체크한 유형은 검증 제외됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setValidateOpen(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-2"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              {!validateData && !validateLoading && (
                <div className="mb-6 p-4 rounded-xl border-2 border-amber-800/50 bg-slate-900/60">
                  <h3 className="text-sm font-bold text-amber-200 mb-2">
                    중복 검증에서 제외할 유형
                  </h3>
                  <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                    체크한 유형은 <strong className="text-slate-200">검사 대상에서 완전히 제외</strong>
                    됩니다. (예: 어법 등 동일 Options 플레이스홀더가 많은 유형) 선택은 브라우저에
                    저장됩니다.
                  </p>
                  {types.length === 0 ? (
                    <p className="text-amber-500/90 text-sm py-4">
                      유형 목록을 불러오는 중입니다… 잠시 후 다시 열어 보거나 상단 필터로 목록을 한 번
                      불러온 뒤 시도해 주세요.
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2 mb-3">
                        <button
                          type="button"
                          onClick={() => setValidateExcludedTypes([...types])}
                          className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600"
                        >
                          전체 유형 제외
                        </button>
                        <button
                          type="button"
                          onClick={() => setValidateExcludedTypes([])}
                          className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600"
                        >
                          제외 전부 해제
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 max-h-48 overflow-y-auto pr-1">
                        {types.map((t) => (
                          <label
                            key={t}
                            className="inline-flex items-center gap-2 text-sm text-slate-200 cursor-pointer hover:text-white"
                          >
                            <input
                              type="checkbox"
                              checked={validateExcludedTypes.includes(t)}
                              onChange={() =>
                                setValidateExcludedTypes((prev) =>
                                  prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                                )
                              }
                              className="rounded border-slate-500 text-amber-600 focus:ring-amber-500 w-4 h-4"
                            />
                            <span className={validateExcludedTypes.includes(t) ? 'text-amber-200' : ''}>
                              {t}
                            </span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="mt-4 pt-4 border-t border-slate-600 text-xs text-slate-500">
                    적용 필터: 교재{' '}
                    <strong className="text-slate-300">{filterTextbook || '전체'}</strong> · 목록 유형{' '}
                    <strong className="text-slate-300">{filterType || '전체'}</strong>
                    {filterType && (
                      <span className="block mt-1 text-amber-600/90">
                        ※ 목록에서 특정 유형만 고른 경우, 제외 설정보다 해당 유형만 검사됩니다.
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={validateLoading || types.length === 0}
                    onClick={runOptionsDuplicateValidate}
                    className="mt-5 w-full sm:w-auto px-6 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold text-sm shadow-lg"
                  >
                    {validateLoading ? '검증 중…' : '검증 실행'}
                  </button>
                </div>
              )}

              {validateLoading && !validateData && (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <span className="animate-pulse">중복 검증 중…</span>
                </div>
              )}

              {validateError && (
                <div className="mb-4 p-3 rounded-lg bg-red-950/40 border border-red-800/50">
                  <p className="text-red-300 text-sm">{validateError}</p>
                  <button
                    type="button"
                    onClick={() => setValidateError(null)}
                    className="mt-2 text-xs text-red-400 underline"
                  >
                    닫기
                  </button>
                </div>
              )}
              {validateData && !validateError && (
                <>
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <button
                      type="button"
                      onClick={() => {
                        setValidateData(null);
                        setValidateError(null);
                        setValidateExpanded({});
                      }}
                      className="text-sm px-3 py-2 rounded-lg border border-slate-500 text-slate-300 hover:bg-slate-700"
                    >
                      ← 제외 유형 바꿔 다시 검증
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-4 mb-6 text-sm">
                    <span className="text-slate-300">
                      검사 대상 문서:{' '}
                      <strong className="text-white">{validateData.scannedDocuments.toLocaleString()}</strong>건
                    </span>
                    <span className="text-amber-200 inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                      중복 그룹{' '}
                      <strong>{validateData.duplicateGroupCount.toLocaleString()}</strong>개
                      {validateData.groups.length > 0 && (
                        <span className="text-slate-400 font-normal text-xs hidden sm:inline">
                          (아래 요약 참고)
                        </span>
                      )}
                    </span>
                    {(validateData.filters.textbook || validateData.filters.type) && (
                      <span className="text-slate-500">
                        필터: {validateData.filters.textbook || '전체 교재'} /{' '}
                        {validateData.filters.type || '전체 유형'}
                      </span>
                    )}
                  </div>
                  {validateData.excludedTypes.length > 0 && (
                    <p className="text-xs text-slate-500 mb-3">
                      검증 제외 유형:{' '}
                      <span className="text-amber-400/90 font-medium">
                        {validateData.excludedTypes.join(', ')}
                      </span>
                    </p>
                  )}
                  {Object.keys(validateData.summaryByType || {}).length > 0 && (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-500 shrink-0">유형별 중복 그룹 수:</span>
                      {Object.entries(validateData.summaryByType)
                        .sort(([a], [b]) => a.localeCompare(b, 'ko'))
                        .map(([t, n]) => (
                          <span
                            key={t}
                            className="inline-flex items-baseline gap-1 px-2 py-1 rounded-lg bg-violet-950/80 border border-violet-800/50 text-xs"
                          >
                            <span className="text-violet-200 font-semibold">{t}</span>
                            <span className="text-amber-300 font-bold">{n}</span>
                            <span className="text-slate-500">그룹</span>
                          </span>
                        ))}
                    </div>
                  )}
                  {validateData.duplicateGroupCount > 0 && validateData.groups.length > 0 && (
                    <div className="mb-4 p-3 rounded-xl bg-slate-900/90 border border-amber-900/40">
                      <p className="text-amber-200/90 text-xs font-bold mb-2 tracking-wide">
                        그룹 요약 — 유형 + 겹치는 Options
                      </p>
                      <ul className="space-y-2 text-sm">
                        {[...validateData.groups]
                          .sort((a, b) => {
                            const c = (a.questionType || '').localeCompare(b.questionType || '', 'ko');
                            if (c !== 0) return c;
                            return b.duplicateCount - a.duplicateCount;
                          })
                          .map((g, i) => {
                            const raw = (g.optionsFull || g.optionsPreview || '').replace(/\s+/g, ' ').trim();
                            const short =
                              raw.length > 100 ? `${raw.slice(0, 100)}…` : raw || '(빈 문자열)';
                            return (
                              <li
                                key={`${g.questionType}-${i}-${short.slice(0, 20)}`}
                                className="flex flex-wrap items-start gap-2 gap-y-1 border-b border-slate-700/50 pb-2 last:border-0 last:pb-0"
                              >
                                <span className="text-slate-500 font-mono text-xs w-6 shrink-0 pt-0.5">
                                  {i + 1}.
                                </span>
                                <span className="shrink-0 px-2 py-0.5 rounded bg-violet-900/60 text-violet-200 text-xs font-bold">
                                  {g.questionType}
                                </span>
                                <span
                                  className="text-slate-200 text-xs font-mono bg-slate-950/80 px-2 py-1 rounded border border-slate-700 flex-1 min-w-0 break-all"
                                  title={g.optionsFull || g.optionsPreview}
                                >
                                  {short}
                                </span>
                                <span className="text-amber-400 font-bold text-xs whitespace-nowrap shrink-0">
                                  ×{g.duplicateCount}건
                                </span>
                              </li>
                            );
                          })}
                      </ul>
                    </div>
                  )}
                  {validateData.duplicateGroupCount === 0 ? (
                    <p className="text-emerald-400 font-medium py-8 text-center">
                      중복된 Options 조합이 없습니다.
                    </p>
                  ) : (
                    <ul className="space-y-4">
                      {[...validateData.groups]
                        .sort((a, b) => {
                          const c = (a.questionType || '').localeCompare(b.questionType || '', 'ko');
                          if (c !== 0) return c;
                          return b.duplicateCount - a.duplicateCount;
                        })
                        .map((g, idx) => (
                        <li
                          key={`detail-${g.questionType}-${idx}-${g.optionsFull.slice(0, 40)}`}
                          className="border border-slate-600 rounded-xl bg-slate-900/50 overflow-hidden"
                        >
                          <div className="px-4 py-2 bg-amber-950/40 border-b border-slate-600 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-amber-300 font-bold text-sm flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-violet-800 text-violet-100 text-xs">
                                {g.questionType}
                              </span>
                              동일 Options × {g.duplicateCount}건
                            </span>
                            {g.truncated && (
                              <span className="text-xs text-amber-500/90">
                                아래 목록은 최대 50건만 표시
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setValidateExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }))
                              }
                              className="text-xs text-violet-400 hover:text-violet-300 underline"
                            >
                              {validateExpanded[idx] ? 'Options 접기' : 'Options 전문 펼치기'}
                            </button>
                          </div>
                          <div className="px-4 py-3">
                            {validateExpanded[idx] ? (
                              <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words max-h-48 overflow-y-auto bg-slate-950 p-3 rounded-lg border border-slate-700">
                                {g.optionsFull}
                              </pre>
                            ) : (
                              <p className="text-sm text-slate-400 line-clamp-3 whitespace-pre-wrap">
                                {g.optionsPreview}
                              </p>
                            )}
                            <div className="mt-3 overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-slate-500 border-b border-slate-700">
                                    <th className="py-2 pr-2">교재</th>
                                    <th className="py-2 pr-2">유형</th>
                                    <th className="py-2 pr-2">출처</th>
                                    <th className="py-2 text-right">작업</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.sampleItems.map((it) => (
                                    <tr key={it.id} className="border-b border-slate-700/50">
                                      <td className="py-1.5 pr-2 text-slate-300 max-w-[140px] truncate" title={it.textbook}>
                                        {it.textbook}
                                      </td>
                                      <td className="py-1.5 pr-2 text-violet-300">{it.type}</td>
                                      <td className="py-1.5 pr-2 text-slate-400">{it.source}</td>
                                      <td className="py-1.5 text-right">
                                        <button
                                          type="button"
                                          onClick={() => openEditFromValidate(it.id)}
                                          className="text-violet-400 hover:text-violet-300 font-medium"
                                        >
                                          수정
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {solveOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
          <div className="bg-slate-800 border border-emerald-700/40 rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-600 flex justify-between items-center shrink-0 bg-slate-800/95">
              <div>
                <h2 className="text-lg font-bold text-emerald-300">Claude로 문제 풀기</h2>
                {solveRow && (
                  <p className="text-xs text-slate-400 mt-1">
                    <span className="text-violet-300">{solveRow.type}</span>
                    {' · '}{solveRow.source}
                    {' · '}<span className="text-slate-500">{solveRow.textbook}</span>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSolveOpen(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-2"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {solveLoading && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                  <div className="animate-spin w-8 h-8 border-4 border-slate-600 border-t-emerald-400 rounded-full" />
                  <span className="text-sm">Claude가 문제를 풀고 있습니다…</span>
                </div>
              )}

              {solveError && !solveLoading && (
                <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/50">
                  <p className="text-red-300 text-sm">{solveError}</p>
                </div>
              )}

              {!solveLoading && solveRow && (
                <>
                  {solveRow.paragraph && (
                    <div className="rounded-xl bg-slate-900/70 border border-slate-600 p-4">
                      <p className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wider">지문</p>
                      <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{solveRow.paragraph}</p>
                    </div>
                  )}
                  {solveRow.question && (
                    <div className="rounded-xl bg-slate-900/50 border border-slate-600 p-4">
                      <p className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wider">발문</p>
                      <p className="text-sm text-slate-100 whitespace-pre-wrap">{solveRow.question}</p>
                    </div>
                  )}
                  {solveRow.options && (
                    <div className="rounded-xl bg-slate-900/50 border border-slate-600 p-4">
                      <p className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wider">선택지</p>
                      <p className="text-sm text-slate-200 whitespace-pre-wrap font-mono">{solveRow.options}</p>
                    </div>
                  )}
                </>
              )}

              {!solveLoading && solveResult && (
                <>
                  <div
                    className={`rounded-xl border-2 p-4 ${
                      solveResult.isCorrect === true
                        ? 'border-emerald-500/60 bg-emerald-950/40'
                        : solveResult.isCorrect === false
                        ? 'border-red-500/60 bg-red-950/40'
                        : 'border-slate-500/60 bg-slate-900/40'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-3 mb-3">
                      <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Claude의 답</p>
                      {solveResult.isCorrect === true && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-600/80 text-white">✓ 정답</span>
                      )}
                      {solveResult.isCorrect === false && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-600/80 text-white">✗ 오답</span>
                      )}
                    </div>
                    <p className="text-emerald-300 font-bold text-base mb-3">{solveResult.claudeAnswer}</p>
                    <div className="border-t border-slate-600 pt-3">
                      <p className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">풀이</p>
                      <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{solveResult.claudeResponse}</p>
                    </div>
                  </div>

                  {solveResult.correctAnswer && (
                    <div className="rounded-xl bg-slate-900/70 border border-slate-600 p-4">
                      <p className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">정답 (CorrectAnswer)</p>
                      <p className="text-base font-bold text-amber-300">{solveResult.correctAnswer}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {!solveLoading && solveRow && (
              <div className="px-5 py-3 border-t border-slate-600 flex justify-between items-center shrink-0 bg-slate-800/95">
                <button
                  type="button"
                  disabled={solveLoading}
                  onClick={() => {
                    if (!solveRow) return;
                    setSolveResult(null);
                    setSolveError(null);
                    setSolveLoading(true);
                    fetch('/api/admin/generated-questions/solve', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({
                        question: solveRow.question,
                        paragraph: solveRow.paragraph,
                        options: solveRow.options,
                        correctAnswer: solveRow.correctAnswer,
                        questionType: solveRow.type,
                      }),
                    })
                      .then((r) => r.json())
                      .then((d) => {
                        if (d.ok) setSolveResult(d as SolveResult);
                        else setSolveError(d.error || '오류');
                      })
                      .catch(() => setSolveError('네트워크 오류'))
                      .finally(() => setSolveLoading(false));
                  }}
                  className="text-sm px-4 py-2 rounded-lg bg-emerald-700/60 hover:bg-emerald-600/80 text-emerald-200 font-medium disabled:opacity-50"
                >
                  다시 풀기
                </button>
                <button
                  type="button"
                  onClick={() => setSolveOpen(false)}
                  className="text-sm px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  닫기
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 overflow-y-auto">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-600 px-5 py-4 flex justify-between items-center z-10">
              <h2 className="text-lg font-bold">{editingId ? '변형문제 수정' : '새 변형문제'}</h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-400 block mb-1">passage_id (원문 passages._id) *</label>
                  <input
                    value={form.passage_id}
                    onChange={(e) => setForm((f) => ({ ...f, passage_id: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white font-mono"
                    placeholder="24자 hex ObjectId"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">교재명 *</label>
                  <input
                    value={form.textbook}
                    onChange={(e) => setForm((f) => ({ ...f, textbook: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">출처 (source) *</label>
                  <input
                    value={form.source}
                    onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="예: 01강 기출 예제"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">유형 (type) *</label>
                  <input
                    list="gq-types"
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="빈칸, 주제, …"
                  />
                  <datalist id="gq-types">
                    {types.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">option_type</label>
                  <input
                    value={form.option_type}
                    onChange={(e) => setForm((f) => ({ ...f, option_type: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">상태</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {['완료', '대기', '오류'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                    {statuses.filter((s) => !['완료', '대기', '오류'].includes(s)).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-400 block mb-1">error_msg (비우면 null)</label>
                  <input
                    value={form.error_msg}
                    onChange={(e) => setForm((f) => ({ ...f, error_msg: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-violet-300 block mb-1 font-semibold">question_data (JSON) *</label>
                <textarea
                  value={questionJson}
                  onChange={(e) => setQuestionJson(e.target.value)}
                  rows={18}
                  className="w-full bg-slate-950 border border-violet-900/50 rounded-lg px-3 py-2 text-xs text-green-200 font-mono"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 font-bold disabled:opacity-50"
                >
                  {saving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
