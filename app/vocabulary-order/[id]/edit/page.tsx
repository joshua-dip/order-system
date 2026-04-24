'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppBar from '@/app/components/AppBar';
import { VOCABULARY_POINTS_PER_PASSAGE, type UserVocabularySerialized } from '@/lib/vocabulary-library-types';
import type { VocabularyEntry } from '@/lib/passage-analyzer-types';

/* ────────── 상수 ────────── */

const CEFR_OPTIONS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const POS_OPTIONS = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.', 'pron.', 'n. phrase', 'v. phrase', 'adj. phrase', 'adv. phrase'];

type ViewOpts = { hiddenCols: string[]; rowSize: 'compact' | 'normal' | 'loose'; colWidths: Record<string, number> };
const VIEW_LS_KEY = 'vocab-edit-view-opts-v2';
const VIEW_COL_META = [
  { id: 'partOfSpeech', label: '품사' },
  { id: 'cefr', label: 'CEFR' },
  { id: 'meaning', label: '뜻' },
  { id: 'synonym', label: '동의어' },
  { id: 'antonym', label: '반의어' },
] as const;
const VIEW_PRESETS: { label: string; hiddenCols: string[] }[] = [
  { label: '전체', hiddenCols: [] },
  { label: '학습용', hiddenCols: ['synonym', 'antonym'] },
  { label: '단어·품사', hiddenCols: ['cefr', 'meaning', 'synonym', 'antonym'] },
  { label: '정답 가리기', hiddenCols: ['meaning'] },
];
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  word: 128, partOfSpeech: 96, cefr: 80, meaning: 200, synonym: 112, antonym: 112,
};
const COL_WIDTH_MIN = 48;
const COL_WIDTH_MAX = 360;
const DEFAULT_VIEW_OPTS: ViewOpts = { hiddenCols: [], rowSize: 'normal', colWidths: {} };

const DOWNLOAD_FORMATS = [
  { id: 'xlsx', label: '단어장 Excel', desc: '전체 단어장 스프레드시트' },
  { id: 'pdf', label: '단어장 PDF', desc: '인쇄용 단어장' },
  { id: 'test-xlsx', label: '시험지 Excel', desc: '학생용 시험지 + 정답지' },
  { id: 'test-pdf', label: '시험지 PDF', desc: '인쇄용 시험지 + 정답지' },
  { id: 'first-letter-pdf', label: '첫글자 제시 PDF', desc: '첫 글자만 보이는 시험지' },
  { id: 'hidden-meaning-pdf', label: '뜻 가리기 PDF', desc: '뜻을 가린 채 영단어 보기' },
  { id: 'flashcard-pdf', label: '플래시카드 PDF', desc: '낱장 카드 인쇄' },
  { id: 'anki-csv', label: 'Anki/Quizlet CSV', desc: 'Anki·Quizlet 임포트용 파일' },
] as const;
type FormatId = (typeof DOWNLOAD_FORMATS)[number]['id'];

type SortField = 'original' | 'alpha';

type EditSnapshot = { entries: VocabularyEntry[]; sortField: SortField };

function cloneSnapshot(s: EditSnapshot): EditSnapshot {
  return {
    entries: JSON.parse(JSON.stringify(s.entries)) as VocabularyEntry[],
    sortField: s.sortField,
  };
}

/* ────────── 인라인 편집 행 ────────── */

function EntryRow({
  entry,
  index,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  viewOpts,
}: {
  entry: VocabularyEntry;
  index: number;
  onUpdate: (index: number, updated: VocabularyEntry) => void;
  onDelete: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  isFirst: boolean;
  isLast: boolean;
  viewOpts: ViewOpts;
}) {
  const set = (field: keyof VocabularyEntry, val: string) =>
    onUpdate(index, { ...entry, [field]: val });
  const hidden = new Set(viewOpts.hiddenCols);
  const rowPy = viewOpts.rowSize === 'compact' ? 'py-0.5' : viewOpts.rowSize === 'loose' ? 'py-3' : 'py-1.5';

  return (
    <tr className="group border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
      <td className={`px-2 ${rowPy} text-xs text-slate-400 w-8 text-center`}>{index + 1}</td>
      <td className={`px-2 ${rowPy} overflow-hidden`}>
        <input
          type="text"
          value={entry.word}
          onChange={(e) => set('word', e.target.value)}
          className="w-full text-sm font-semibold text-slate-900 bg-transparent border-b border-transparent focus:border-teal-400 focus:outline-none py-0.5"
          placeholder="단어"
        />
      </td>
      {!hidden.has('partOfSpeech') && (
        <td className={`px-2 ${rowPy} overflow-hidden`}>
          <select
            value={entry.partOfSpeech || ''}
            onChange={(e) => set('partOfSpeech', e.target.value)}
            className="w-full text-xs text-slate-600 bg-transparent border-b border-transparent focus:border-teal-400 focus:outline-none py-0.5"
          >
            <option value="">품사</option>
            {POS_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </td>
      )}
      {!hidden.has('cefr') && (
        <td className={`px-2 ${rowPy} overflow-hidden`}>
          <select
            value={entry.cefr || ''}
            onChange={(e) => set('cefr', e.target.value)}
            className="w-full text-xs text-slate-600 bg-transparent border-b border-transparent focus:border-teal-400 focus:outline-none py-0.5"
          >
            <option value="">CEFR</option>
            {CEFR_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </td>
      )}
      {!hidden.has('meaning') && (
        <td className={`px-2 ${rowPy} overflow-hidden`}>
          <input
            type="text"
            value={entry.meaning || ''}
            onChange={(e) => set('meaning', e.target.value)}
            className="w-full text-sm text-slate-700 bg-transparent border-b border-transparent focus:border-teal-400 focus:outline-none py-0.5"
            placeholder="뜻"
          />
        </td>
      )}
      {!hidden.has('synonym') && (
        <td className={`px-2 ${rowPy} overflow-hidden`}>
          <input
            type="text"
            value={entry.synonym || ''}
            onChange={(e) => set('synonym', e.target.value)}
            className="w-full text-xs text-slate-500 bg-transparent border-b border-transparent focus:border-teal-400 focus:outline-none py-0.5"
            placeholder="동의어"
          />
        </td>
      )}
      {!hidden.has('antonym') && (
        <td className={`px-2 ${rowPy} overflow-hidden`}>
          <input
            type="text"
            value={entry.antonym || ''}
            onChange={(e) => set('antonym', e.target.value)}
            className="w-full text-xs text-slate-500 bg-transparent border-b border-transparent focus:border-teal-400 focus:outline-none py-0.5"
            placeholder="반의어"
          />
        </td>
      )}
      <td className={`px-2 ${rowPy}`}>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            disabled={isFirst}
            onClick={() => onMoveUp(index)}
            className="p-0.5 rounded text-slate-400 hover:text-teal-600 disabled:opacity-20"
            title="위로"
          >↑</button>
          <button
            type="button"
            disabled={isLast}
            onClick={() => onMoveDown(index)}
            className="p-0.5 rounded text-slate-400 hover:text-teal-600 disabled:opacity-20"
            title="아래로"
          >↓</button>
          <button
            type="button"
            onClick={() => onDelete(index)}
            className="p-0.5 rounded text-slate-400 hover:text-red-500"
            title="삭제"
          >✕</button>
        </div>
      </td>
    </tr>
  );
}

/* ────────── 다운로드 패널 ────────── */

function DownloadPanel({ id, title, entryCount, onCollapse }: { id: string; title: string; entryCount: number; onCollapse: () => void }) {
  const [format, setFormat] = useState<FormatId>('xlsx');
  const [direction, setDirection] = useState<'word-to-meaning' | 'meaning-to-word'>('word-to-meaning');
  const [layoutColumns, setLayoutColumns] = useState<1 | 2>(1);
  const [shuffle, setShuffle] = useState(false);
  const [cefrFilter, setCefrFilter] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);

  const selectedFmt = DOWNLOAD_FORMATS.find((f) => f.id === format)!;
  const showDirection = ['test-xlsx', 'test-pdf', 'first-letter-pdf', 'hidden-meaning-pdf'].includes(format);
  const showLayout = format === 'test-pdf';
  const showShuffle = ['test-xlsx', 'test-pdf', 'first-letter-pdf', 'hidden-meaning-pdf'].includes(format);
  const showCefr = format !== 'anki-csv';

  const toggleCefr = (c: string) =>
    setCefrFilter((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const r = await fetch(`/api/my/vocabulary/${id}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          direction,
          layoutColumns,
          shuffle,
          cefrLevels: cefrFilter,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || '다운로드에 실패했습니다.');
        return;
      }
      const cd = r.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename\*=UTF-8''(.+)/);
      const fileName = match ? decodeURIComponent(match[1]) : `단어장_${title}.${format.includes('csv') ? 'txt' : format.split('-').pop()}`;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <span className="flex items-center gap-2">
          <span className="font-bold text-slate-800">다운로드</span>
          <span className="text-xs font-normal text-slate-400">{entryCount}개 단어</span>
        </span>
        <button
          type="button"
          onClick={onCollapse}
          className="text-slate-400 hover:text-slate-600 transition-colors text-sm px-1.5"
          title="오른쪽으로 접기"
        >▶</button>
      </div>

      <div className="px-5 pb-5 pt-4 space-y-4">
      {/* 포맷 선택 */}
      <div className="grid grid-cols-2 gap-2">
        {DOWNLOAD_FORMATS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFormat(f.id)}
            className={`text-left p-2.5 rounded-xl border transition-all text-xs ${
              format === f.id
                ? 'border-teal-500 bg-teal-50 text-teal-800'
                : 'border-slate-200 hover:border-slate-300 text-slate-700'
            }`}
          >
            <div className="font-semibold">{f.label}</div>
            <div className="text-slate-400 mt-0.5">{f.desc}</div>
          </button>
        ))}
      </div>

      {/* CEFR 필터 */}
      {showCefr && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5">CEFR 필터 (미선택 시 전체)</p>
          <div className="flex flex-wrap gap-1">
            {CEFR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleCefr(c)}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  cefrFilter.includes(c)
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'border-slate-300 text-slate-600 hover:border-teal-400'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 시험 방향 */}
      {showDirection && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5">시험 방향</p>
          <div className="flex gap-2">
            {([['word-to-meaning', '영→뜻'], ['meaning-to-word', '뜻→영']] as const).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => setDirection(val)}
                className={`flex-1 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                  direction === val ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-300 text-slate-600 hover:border-teal-400'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 레이아웃 */}
      {showLayout && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5">레이아웃</p>
          <div className="flex gap-2">
            {([1, 2] as const).map((col) => (
              <button
                key={col}
                type="button"
                onClick={() => setLayoutColumns(col)}
                className={`flex-1 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                  layoutColumns === col ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-300 text-slate-600 hover:border-teal-400'
                }`}
              >
                {col}단
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 셔플 */}
      {showShuffle && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} className="rounded text-teal-600" />
          <span className="text-xs text-slate-600">순서 랜덤 셔플</span>
        </label>
      )}

      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className="w-full py-3 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors text-sm"
      >
        {downloading ? '생성 중…' : `${selectedFmt.label} 다운로드`}
      </button>
    </div>
    </div>
  );
}

/* ────────── 메인 편집 페이지 ────────── */

export default function VocabularyEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [doc, setDoc] = useState<UserVocabularySerialized | null>(null);
  const [entries, setEntries] = useState<VocabularyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [sortField, setSortField] = useState<SortField>('original');
  const [cefrFilter, setCefrFilter] = useState<string[]>([]);
  const [showViewPanel, setShowViewPanel] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(true);
  const [viewOpts, setViewOpts] = useState<ViewOpts>(() => {
    try {
      const v = typeof window !== 'undefined' ? localStorage.getItem(VIEW_LS_KEY) : null;
      return v ? { ...DEFAULT_VIEW_OPTS, ...(JSON.parse(v) as ViewOpts) } : DEFAULT_VIEW_OPTS;
    } catch { return DEFAULT_VIEW_OPTS; }
  });
  const updateViewOpts = (next: ViewOpts) => {
    setViewOpts(next);
    try { localStorage.setItem(VIEW_LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const colW = (id: string) => viewOpts.colWidths[id] ?? DEFAULT_COL_WIDTHS[id] ?? 120;

  /* 드래그 리사이즈 */
  const [resizing, setResizing] = useState<{ colId: string; startX: number; startWidth: number } | null>(null);
  const setColWidth = useCallback((colId: string, width: number) => {
    setViewOpts((prev) => {
      const next = { ...prev, colWidths: { ...prev.colWidths, [colId]: width } };
      try { localStorage.setItem(VIEW_LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const startResize = useCallback((colId: string, clientX: number, startWidth: number) => {
    setResizing({ colId, startX: clientX, startWidth });
  }, []);
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const next = Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH_MIN, resizing.startWidth + (e.clientX - resizing.startX)));
      setColWidth(resizing.colId, next);
    };
    const onUp = () => setResizing(null);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [resizing, setColWidth]);
  /** 원본 복원 직후: 복원 전·후 스냅샷으로 한 번에 되돌리기/다시 적용 */
  const [resetHistory, setResetHistory] = useState<{
    pre: EditSnapshot;
    post: EditSnapshot;
    dock: 'pre' | 'post';
  } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  /* ── 데이터 로드 ── */
  const fetchDoc = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/my/vocabulary/${id}`);
      if (r.ok) {
        const d = await r.json();
        setResetHistory(null);
        setDoc(d.item);
        setEntries(d.item.vocabulary_list || []);
      } else if (r.status === 401 || r.status === 403) {
        router.push('/login');
      } else {
        router.push('/vocabulary-order');
      }
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { fetchDoc(); }, [fetchDoc]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* ── 자동 저장 (디바운스 2s) ── */
  const autoSave = useCallback(async (list: VocabularyEntry[]) => {
    setSaving(true);
    try {
      const r = await fetch(`/api/my/vocabulary/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabulary_list: list }),
      });
      setSaveStatus(r.ok ? 'saved' : 'error');
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  }, [id]);

  const scheduleAutoSave = useCallback((list: VocabularyEntry[]) => {
    dirtyRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      autoSave(list);
      dirtyRef.current = false;
    }, 1500);
  }, [autoSave]);

  /* ── 단어 편집 핸들러 ── */
  const handleUpdate = useCallback((index: number, updated: VocabularyEntry) => {
    setResetHistory(null);
    setEntries((prev) => {
      const next = [...prev];
      next[index] = updated;
      scheduleAutoSave(next);
      return next;
    });
  }, [scheduleAutoSave]);

  const handleDelete = useCallback((index: number) => {
    setResetHistory(null);
    setEntries((prev) => {
      const next = prev.filter((_, i) => i !== index);
      scheduleAutoSave(next);
      return next;
    });
  }, [scheduleAutoSave]);

  const handleMoveUp = useCallback((index: number) => {
    if (index === 0) return;
    setResetHistory(null);
    setEntries((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      scheduleAutoSave(next);
      return next;
    });
  }, [scheduleAutoSave]);

  const handleMoveDown = useCallback((index: number) => {
    setResetHistory(null);
    setEntries((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      scheduleAutoSave(next);
      return next;
    });
  }, [scheduleAutoSave]);

  const handleAddRow = () => {
    setResetHistory(null);
    const newEntry: VocabularyEntry = { word: '', meaning: '' };
    setEntries((prev) => {
      const next = [...prev, newEntry];
      scheduleAutoSave(next);
      return next;
    });
  };

  /* ── 정렬 ── */
  const handleSort = (field: SortField) => {
    setResetHistory(null);
    setSortField(field);
    if (field === 'alpha') {
      setEntries((prev) => {
        const next = [...prev].sort((a, b) => a.word.localeCompare(b.word));
        scheduleAutoSave(next);
        return next;
      });
    }
  };

  /* ── 원본 복원 직후: 복원 전/후 토글 ── */
  const handleUndoAfterReset = useCallback(() => {
    if (!resetHistory || resetHistory.dock === 'pre') return;
    const { pre } = resetHistory;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setEntries(pre.entries);
    setSortField(pre.sortField);
    setResetHistory({ ...resetHistory, dock: 'pre' });
    void autoSave(pre.entries);
  }, [resetHistory, autoSave]);

  const handleRedoAfterReset = useCallback(() => {
    if (!resetHistory || resetHistory.dock === 'post') return;
    const { post } = resetHistory;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setEntries(post.entries);
    setSortField(post.sortField);
    setResetHistory({ ...resetHistory, dock: 'post' });
    void autoSave(post.entries);
  }, [resetHistory, autoSave]);

  /* ── 원본 복원 ── */
  const handleReset = async () => {
    const pre: EditSnapshot = { entries: JSON.parse(JSON.stringify(entries)) as VocabularyEntry[], sortField };
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const r = await fetch(`/api/my/vocabulary/${id}/reset`, { method: 'POST' });
    if (r.ok) {
      const d = await r.json();
      const postEntries = (d.item.vocabulary_list || []) as VocabularyEntry[];
      const post: EditSnapshot = {
        entries: JSON.parse(JSON.stringify(postEntries)) as VocabularyEntry[],
        sortField: 'original',
      };
      setResetHistory({
        pre: cloneSnapshot(pre),
        post: cloneSnapshot(post),
        dock: 'post',
      });
      setDoc(d.item);
      setEntries(postEntries);
      setSortField('original');
    }
    setResetConfirm(false);
  };

  /* ── 삭제 ── */
  const handleDelete2 = async () => {
    const r = await fetch(`/api/my/vocabulary/${id}`, { method: 'DELETE' });
    if (r.ok) router.push('/vocabulary-order');
    setDeleteConfirm(false);
  };

  /* ── CEFR 필터 표시 ── */
  const displayedEntries = cefrFilter.length === 0
    ? entries
    : entries.filter((e) => !e.cefr || cefrFilter.includes(e.cefr.toUpperCase()));

  if (loading) {
    return (
      <>
        <AppBar title="단어장 편집" showBackButton onBackClick={() => router.push('/vocabulary-order')} />
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="animate-spin w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  if (!doc) return null;

  return (
    <>
      <AppBar title={doc.display_label || doc.textbook} showBackButton onBackClick={() => router.push('/vocabulary-order')} />

      <div className="min-h-screen bg-slate-50 pb-10" style={resizing ? { cursor: 'col-resize', userSelect: 'none' } : undefined}>
        <div className="max-w-6xl mx-auto px-4 py-5">

          {/* 제목 + 저장 상태 */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-slate-400">{doc.textbook}</p>
              <h1 className="text-lg font-bold text-slate-900">{doc.display_label}</h1>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                  typeof doc.points_used === 'number' && doc.points_used === 0
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-teal-100 text-teal-800'
                }`}
              >
                {typeof doc.points_used === 'number'
                  ? doc.points_used === 0
                    ? '무료 제공'
                    : `${doc.points_used}P 구매`
                  : `단어장 · ${VOCABULARY_POINTS_PER_PASSAGE}P`}
                {doc.package_type === 'detailed' ? ' · 상세(레거시)' : ''}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {saving && <span className="text-slate-400">저장 중…</span>}
              {saveStatus === 'saved' && <span className="text-teal-600 font-medium">저장됨</span>}
              {saveStatus === 'error' && <span className="text-red-500">저장 실패</span>}
            </div>
          </div>

          <div className={fullscreen ? '' : 'flex gap-5 items-start'}>

            {/* ── 단어 편집 영역 ── */}
            <div className={fullscreen
              ? 'fixed inset-0 z-50 bg-white flex flex-col'
              : 'flex-1 min-w-0 space-y-4'
            }>
              {/* 전체화면 헤더 */}
              {fullscreen && (
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-white shrink-0">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-slate-800 text-sm">{doc.display_label}</span>
                    <span className="text-xs text-slate-400">{entries.length}개 단어</span>
                    {saving && <span className="text-xs text-slate-400">저장 중…</span>}
                    {saveStatus === 'saved' && <span className="text-xs text-teal-600 font-medium">저장됨</span>}
                    {saveStatus === 'error' && <span className="text-xs text-red-500">저장 실패</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setFullscreen(false)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    ✕ 닫기 (Esc)
                  </button>
                </div>
              )}

              {/* 툴바 */}
              <div className={`bg-white border-slate-100 p-3 flex flex-wrap gap-2 items-center ${fullscreen ? 'border-b shrink-0' : 'rounded-2xl border'}`}>
                <button
                  type="button"
                  onClick={handleAddRow}
                  className="px-3 py-1.5 text-xs bg-teal-600 text-white rounded-lg font-semibold hover:bg-teal-700 transition-colors"
                >
                  + 단어 추가
                </button>

                <div className="flex gap-1">
                  {(['original', 'alpha'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleSort(s)}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                        sortField === s ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-300 text-slate-600 hover:border-slate-400'
                      }`}
                    >
                      {s === 'original' ? '순서대로' : '알파벳순'}
                    </button>
                  ))}
                </div>

                {/* CEFR 필터 */}
                <div className="flex flex-wrap gap-1">
                  {CEFR_OPTIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCefrFilter((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c])}
                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                        cefrFilter.includes(c)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'border-slate-300 text-slate-500 hover:border-indigo-400'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                  {cefrFilter.length > 0 && (
                    <button type="button" onClick={() => setCefrFilter([])} className="text-[11px] text-slate-400 hover:text-red-500 transition-colors">
                      초기화
                    </button>
                  )}
                </div>

                <div className="ml-auto flex flex-wrap gap-2 items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setFullscreen((p) => !p)}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-600 hover:border-teal-400 hover:text-teal-600 transition-colors"
                    title="전체화면 편집 (Esc로 닫기)"
                  >
                    {fullscreen ? '✕ 전체화면 닫기' : '⛶ 전체화면'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowViewPanel((p) => !p)}
                    className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                      showViewPanel
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'border-slate-300 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    ⚙ 보기 설정{viewOpts.hiddenCols.length > 0 ? ` (${viewOpts.hiddenCols.length}개 숨김)` : ''}
                  </button>
                  {resetHistory && (
                    <>
                      <button
                        type="button"
                        disabled={resetHistory.dock === 'pre'}
                        onClick={handleUndoAfterReset}
                        className="px-2.5 py-1.5 text-xs text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                        title="원본 복원 직전 편집 내용으로 되돌립니다"
                      >
                        복원 직전으로
                      </button>
                      <button
                        type="button"
                        disabled={resetHistory.dock === 'post'}
                        onClick={handleRedoAfterReset}
                        className="px-2.5 py-1.5 text-xs text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                        title="다시 서버에 저장된 원본 데이터를 불러옵니다"
                      >
                        다시 원본 적용
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setResetConfirm(true)}
                    className="px-2.5 py-1.5 text-xs text-amber-600 border border-amber-300 rounded-lg hover:bg-amber-50 transition-colors"
                  >
                    원본으로 복원
                  </button>
                </div>
              </div>

              {/* 전체화면: 스크롤 영역 래퍼 */}
              <div className={fullscreen ? 'flex-1 overflow-y-auto px-4 py-3 space-y-3' : 'space-y-4'}>

              {/* 보기 설정 패널 */}
              {showViewPanel && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-500 shrink-0">프리셋</span>
                    {VIEW_PRESETS.map((p) => {
                      const active = JSON.stringify([...p.hiddenCols].sort()) === JSON.stringify([...viewOpts.hiddenCols].sort());
                      return (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => updateViewOpts({ ...viewOpts, hiddenCols: p.hiddenCols })}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                            active ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-300 text-slate-600 hover:border-teal-400'
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs font-semibold text-slate-500 shrink-0">열 표시</span>
                    {VIEW_COL_META.map((col) => {
                      const isHidden = viewOpts.hiddenCols.includes(col.id);
                      return (
                        <label key={col.id} className="flex items-center gap-1 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={!isHidden}
                            onChange={() => {
                              const next = isHidden
                                ? viewOpts.hiddenCols.filter((c) => c !== col.id)
                                : [...viewOpts.hiddenCols, col.id];
                              updateViewOpts({ ...viewOpts, hiddenCols: next });
                            }}
                            className="accent-teal-500"
                          />
                          <span className={`text-xs ${isHidden ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{col.label}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-500 shrink-0">열 너비</span>
                    <span className="text-xs text-slate-400">열 헤더 오른쪽 경계선을 드래그해서 조절</span>
                    {Object.keys(viewOpts.colWidths).length > 0 && (
                      <button
                        type="button"
                        onClick={() => updateViewOpts({ ...viewOpts, colWidths: {} })}
                        className="text-xs px-2 py-0.5 rounded border border-slate-300 text-slate-500 hover:border-red-300 hover:text-red-500 transition-colors"
                      >
                        너비 초기화
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500 shrink-0">행 간격</span>
                    {(['compact', 'normal', 'loose'] as const).map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => updateViewOpts({ ...viewOpts, rowSize: size })}
                        className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                          viewOpts.rowSize === size
                            ? 'bg-slate-800 text-white border-slate-800'
                            : 'border-slate-300 text-slate-600 hover:border-slate-400'
                        }`}
                      >
                        {size === 'compact' ? '좁게' : size === 'normal' ? '보통' : '넓게'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 단어 테이블 */}
              <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col style={{ width: '2rem' }} />
                      <col style={{ width: `${colW('word')}px` }} />
                      {!viewOpts.hiddenCols.includes('partOfSpeech') && <col style={{ width: `${colW('partOfSpeech')}px` }} />}
                      {!viewOpts.hiddenCols.includes('cefr') && <col style={{ width: `${colW('cefr')}px` }} />}
                      {!viewOpts.hiddenCols.includes('meaning') && <col style={{ width: `${colW('meaning')}px` }} />}
                      {!viewOpts.hiddenCols.includes('synonym') && <col style={{ width: `${colW('synonym')}px` }} />}
                      {!viewOpts.hiddenCols.includes('antonym') && <col style={{ width: `${colW('antonym')}px` }} />}
                      <col style={{ width: '4rem' }} />
                    </colgroup>
                    <thead>
                      <tr className={`bg-slate-50 border-b border-slate-200 ${resizing ? 'select-none' : ''}`}>
                        <th className="px-2 py-2 text-xs font-semibold text-slate-500">#</th>
                        {(['word', 'partOfSpeech', 'cefr', 'meaning', 'synonym', 'antonym'] as const)
                          .filter((id) => id === 'word' || !viewOpts.hiddenCols.includes(id))
                          .map((id) => {
                            const label = id === 'word' ? '단어' : id === 'partOfSpeech' ? '품사' : id === 'cefr' ? 'CEFR' : id === 'meaning' ? '뜻' : id === 'synonym' ? '동의어' : '반의어';
                            const isActive = resizing?.colId === id;
                            return (
                              <th key={id} className="px-2 py-2 text-xs font-semibold text-slate-500 text-left relative overflow-visible">
                                {label}
                                <div
                                  onMouseDown={(e) => { e.preventDefault(); startResize(id, e.clientX, colW(id)); }}
                                  className="absolute top-0 right-0 bottom-0 w-2 flex items-stretch justify-center group/rh"
                                  style={{ cursor: 'col-resize' }}
                                  title="드래그해서 열 너비 조절"
                                >
                                  <div className={`w-px transition-colors ${isActive ? 'bg-teal-500' : 'bg-slate-300 group-hover/rh:bg-teal-400'}`} />
                                </div>
                              </th>
                            );
                          })}
                        <th className="w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedEntries.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-12 text-center text-slate-400 text-sm">
                            단어가 없습니다. &quot;+ 단어 추가&quot; 버튼으로 추가해 보세요.
                          </td>
                        </tr>
                      ) : (
                        displayedEntries.map((entry, i) => {
                          const realIndex = cefrFilter.length === 0 ? i : entries.indexOf(entry);
                          return (
                            <EntryRow
                              key={realIndex}
                              entry={entry}
                              index={realIndex}
                              onUpdate={handleUpdate}
                              onDelete={handleDelete}
                              onMoveUp={handleMoveUp}
                              onMoveDown={handleMoveDown}
                              isFirst={realIndex === 0}
                              isLast={realIndex === entries.length - 1}
                              viewOpts={viewOpts}
                            />
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2 border-t border-slate-100 flex justify-between items-center">
                  <span className="text-xs text-slate-400">
                    {cefrFilter.length > 0 ? `${displayedEntries.length}개 표시 / 전체 ${entries.length}개` : `${entries.length}개 단어`}
                  </span>
                  <button
                    type="button"
                    onClick={handleAddRow}
                    className="text-xs text-teal-600 hover:underline font-medium"
                  >
                    + 단어 추가
                  </button>
                </div>
              </div>
              </div>{/* /스크롤 래퍼 */}
            </div>

            {/* ── 다운로드 패널 ── */}
            {!fullscreen && (
              <>
                {/* 접힌 상태: 세로 탭 */}
                {!downloadOpen && (
                  <button
                    type="button"
                    onClick={() => setDownloadOpen(true)}
                    className="shrink-0 flex flex-col items-center gap-1.5 px-2 py-4 rounded-2xl border border-slate-200 bg-white text-slate-500 hover:text-teal-600 hover:border-teal-300 transition-colors"
                    title="다운로드 패널 펼치기"
                  >
                    <span className="text-xs font-semibold" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>다운로드</span>
                    <span className="text-[10px]">◀</span>
                  </button>
                )}
                {/* 펼친 상태: 슬라이드 */}
                <div
                  className="shrink-0 overflow-hidden transition-all duration-300"
                  style={{ width: downloadOpen ? '20rem' : '0', opacity: downloadOpen ? 1 : 0 }}
                >
                  <div style={{ width: '20rem' }}>
                    <DownloadPanel id={id} title={doc.display_label || doc.textbook} entryCount={entries.length} onCollapse={() => setDownloadOpen(false)} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── 원본 복원 확인 모달 ── */}
      {resetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-slate-800 mb-2">원본으로 복원</h3>
            <p className="text-sm text-slate-600 mb-4">
              구매 시점의 원본 데이터로 복원합니다. 현재까지의 편집 내용은 모두 사라집니다. 복원 직후에는 상단 도구줄에서 복원 직전 편집으로 되돌리거나, 다시 원본을 적용할 수 있습니다. 표에서 단어를 수정하면 그때부터는 되돌리기 범위가 비워집니다.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setResetConfirm(false)} className="flex-1 py-2.5 border border-slate-300 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50">
                취소
              </button>
              <button type="button" onClick={handleReset} className="flex-1 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600">
                복원하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 삭제 확인 모달 ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-bold text-slate-800 mb-2">단어장 삭제</h3>
            <p className="text-sm text-slate-600 mb-4">
              이 단어장을 삭제합니다. 삭제 후에는 동일 지문을 다시 구매할 수 있습니다.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDeleteConfirm(false)} className="flex-1 py-2.5 border border-slate-300 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50">
                취소
              </button>
              <button type="button" onClick={handleDelete2} className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-bold hover:bg-red-600">
                삭제하기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
