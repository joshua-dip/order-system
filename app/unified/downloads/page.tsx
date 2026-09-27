'use client';

/**
 * 내신 예비시험지 — 보관함(내 예비시험지).
 *
 * 학원웹(리체움) /admin/mock-exams 화면을 따른다: 왼쪽 목록 → 오른쪽 시험지 / 정답과 해설 미리보기 ·
 * 인쇄 · PDF. 미리보기는 PDF 와 같은 HTML(/api/my/final-exams/[id]/preview)이라 화면·인쇄·PDF 가 같은 양식.
 * 오답 재학습 세트는 원본 아래에 들여 쓴 줄로, 학생별 채점 기록은 8명 초과 시 접기/펼치기.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AppBar from '@/app/components/AppBar';
import { displayFinalExamTitle, FINAL_EXAM_PRODUCT_NAME } from '@/lib/final-exam-title';

interface GradingRow {
  id: string;
  studentName: string;
  score: number;
  total: number;
  createdAt: string;
}

interface JobRow {
  id: string;
  title: string;
  folder?: string;
  scopeSummary: string;
  status: 'ready' | 'awaiting_admin';
  orderMode?: OrderMode;
  sources?: { sourceKey: string; count: number }[];
  students?: string[];
  totalRequested: number;
  totalAssigned: number;
  totalShort: number;
  pointsCharged: number;
  shortageOrderNumber: string | null;
  gradeToken: string | null;
  retryIndex: number | null;
  parentJobId: string | null;
  createdAt: string;
  gradings?: GradingRow[];
}

type OrderMode = 'default' | 'interleave' | 'shuffle';
type View = 'exam' | 'answer';

const GRADING_PREVIEW_COUNT = 8;
const BTN = 'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50';
const BTN_PRIMARY = `${BTN} bg-[#13294B] text-white hover:bg-[#0c1c36]`;
const BTN_LINE = `${BTN} border border-slate-300 bg-white text-slate-800 hover:border-slate-500 hover:bg-slate-50`;

function GradingChips({ job, expanded, onToggle }: { job: JobRow; expanded: boolean; onToggle: () => void }) {
  const list = job.gradings ?? [];
  if (list.length === 0 || !job.gradeToken) return null;
  const visible = expanded ? list : list.slice(0, GRADING_PREVIEW_COUNT);
  const hidden = list.length - visible.length;
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="mb-1.5 text-[12px] font-bold text-slate-700">채점 기록 {list.length}명 — 누르면 학생별 보고서</p>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((g) => {
          const p = g.total > 0 ? Math.round((g.score / g.total) * 100) : 0;
          return (
            <a
              key={g.id}
              href={`/grade/${job.gradeToken}?g=${g.id}`}
              target="_blank"
              rel="noreferrer"
              className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold ring-1 hover:opacity-80 ${
                p >= 80 ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : p >= 50 ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-rose-50 text-rose-800 ring-rose-200'
              }`}
              title={`${new Date(g.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })} 채점 — 보고서 열기`}
            >
              {g.studentName} {g.score}/{g.total} ({p}%)
            </a>
          );
        })}
        {hidden > 0 && (
          <button onClick={onToggle} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-200">
            +{hidden}명 더보기
          </button>
        )}
        {expanded && list.length > GRADING_PREVIEW_COUNT && (
          <button onClick={onToggle} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-200">
            접기
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * ZIP/PDF 다운로드 응답 처리.
 *  - 응답이 JSON(`{ url }`)이면 대용량이라 Dropbox 임시 링크로 오프로드된 것 → 그 링크로 받는다.
 *  - 바이너리면 blob 으로 저장. (Amplify 응답 6MB 한도 우회)
 */
async function saveDownloadResponse(res: Response, fallbackName: string) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const d = await res.json().catch(() => ({} as { url?: string; filename?: string; error?: string }));
    if (!d?.url) throw new Error(typeof d?.error === 'string' ? d.error : '다운로드 링크 생성에 실패했습니다.');
    const a = document.createElement('a');
    a.href = d.url;
    a.download = d.filename || fallbackName;
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 한 번에 여러 파일로 받기 — ZIP·학생별·유사문항·채점 (자주 안 쓰는 것) */
function MoreDownloads({ job, onReload }: { job: JobRow; onReload: () => void }) {
  const [similarBusy, setSimilarBusy] = useState(false);
  const [zipBusy, setZipBusy] = useState<'' | 'full' | 'source' | 'students' | 'combined'>('');
  const base = `/api/my/final-exams/${job.id}/download`;
  const shownTitle = displayFinalExamTitle(job.title);

  const getZip = async (key: 'full' | 'source' | 'students' | 'combined', q: string, name: string) => {
    setZipBusy(key);
    try {
      const res = await fetch(`${base}-zip${q}`, { credentials: 'include' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(typeof d.error === 'string' ? d.error : '파일을 만들지 못했습니다.');
        return;
      }
      await saveDownloadResponse(res, name);
    } catch {
      alert('파일을 만들지 못했습니다.');
    } finally {
      setZipBusy('');
    }
  };

  /* 유사문항 — 같은 범위로 겹치지 않는 새 문항 발급(포인트 차감 + 주문번호 생성) */
  const makeSimilar = async () => {
    if (!confirm('같은 범위(교재·지문·유형·문항수)로 기존 문제와 겹치지 않는 새 문항을 발급합니다.\n포인트가 차감되고 주문번호가 생성됩니다. 진행할까요?')) return;
    setSimilarBusy(true);
    try {
      const res = await fetch(`/api/my/final-exams/${job.id}/similar`, { method: 'POST', credentials: 'include' });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        alert(typeof d.error === 'string' ? d.error : '유사문항 발급에 실패했습니다.');
        return;
      }
      alert([
        '유사문항 발급 완료 ✓',
        `주문번호: ${d.orderNumber ?? '-'}`,
        `${d.totalRequested}문항${d.totalShort > 0 ? ` (부족 ${d.totalShort}문항은 제작 후 자동으로 채워집니다)` : ''}`,
        `차감 ${Number(d.pointsCharged ?? 0).toLocaleString()}P · 잔액 ${Number(d.balanceAfter ?? 0).toLocaleString()}P`,
      ].join('\n'));
      onReload();
    } catch {
      alert('유사문항 발급 중 오류가 발생했습니다.');
    } finally {
      setSimilarBusy(false);
    }
  };

  const nStudents = job.students?.length ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={() => void getZip('full', '?scope=full', `${shownTitle} 전체묶음.zip`)}
        disabled={!!zipBusy}
        title="기본순·회차별·전부랜덤·지문별의 문제지+정답해설을 ZIP 한 개로 (만드는 데 시간이 걸립니다)"
        className={BTN_LINE}
      >
        {zipBusy === 'full' ? '만드는 중…' : '📦 전부 ZIP'}
      </button>
      {nStudents > 0 && (
        <>
          <button
            onClick={() => void getZip('students', '?students=1', `${shownTitle} 학생별.zip`)}
            disabled={!!zipBusy}
            title={`학생 ${nStudents}명 이름이 박힌 개별 문제지 + 정답해설 ZIP`}
            className={BTN_LINE}
          >
            {zipBusy === 'students' ? '만드는 중…' : `👥 학생별 ZIP (${nStudents}명)`}
          </button>
          <button
            onClick={() => void getZip('combined', '?students=combined', `${shownTitle} 학생합본.pdf`)}
            disabled={!!zipBusy}
            title="모든 학생 문제지를 한 PDF 로 — 각 학생이 새 용지(홀수 쪽)에서 시작(양면 인쇄용 빈 쪽 자동 삽입)"
            className={BTN_LINE}
          >
            {zipBusy === 'combined' ? '합치는 중…' : '👥 학생 합본 PDF'}
          </button>
        </>
      )}
      {job.gradeToken && (
        <a href={`/grade/${job.gradeToken}`} target="_blank" rel="noreferrer" className={BTN_LINE} title="시험지 QR 과 같은 채점 페이지">
          📱 채점 페이지
        </a>
      )}
      {job.retryIndex == null && (
        <button
          onClick={() => void makeSimilar()}
          disabled={similarBusy}
          title="같은 범위로 기존 문제와 겹치지 않는 새 문항을 발급합니다. 포인트 차감 + 주문번호 생성."
          className={BTN_LINE}
        >
          {similarBusy ? '발급 중…' : '🧬 유사문항 발급'}
        </button>
      )}
      <SourceDownloads job={job} zipBusy={zipBusy === 'source'} onZip={() => void getZip('source', '', `${shownTitle} 지문별.zip`)} />
    </div>
  );
}

/** 지문(출처)별 문제·정답 — 번호는 지문 안에서 1번부터 */
function SourceDownloads({ job, zipBusy, onZip }: { job: JobRow; zipBusy: boolean; onZip: () => void }) {
  const [open, setOpen] = useState(false);
  const sources = job.sources ?? [];
  if (sources.length === 0) return null;
  const base = `/api/my/final-exams/${job.id}/download`;
  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className={BTN_LINE}>
          📚 지문별로 받기 ({sources.length}지문) {open ? '▲' : '▼'}
        </button>
        <button onClick={onZip} disabled={zipBusy} className={BTN_LINE} title="지문별 문제지+정답해설 전부를 ZIP 한 개로">
          {zipBusy ? '압축 중…' : '지문별 ZIP'}
        </button>
      </div>
      {open && (
        <ul className="mt-2 space-y-1">
          {sources.map((s, i) => {
            const sq = `?source=${encodeURIComponent(s.sourceKey)}&order=default`;
            return (
              <li key={s.sourceKey} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
                <span className="mr-auto min-w-0 max-w-full truncate text-[12px] font-semibold text-slate-700" title={s.sourceKey}>
                  {i + 1}. {s.sourceKey} <span className="font-normal text-slate-500">· {s.count}문항</span>
                </span>
                <a href={`${base}${sq}&kind=exam`} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px] font-semibold text-slate-800 hover:bg-slate-50">
                  시험지 PDF
                </a>
                <a href={`${base}${sq}&kind=answer`} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px] font-semibold text-slate-800 hover:bg-slate-50">
                  정답 PDF
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 오른쪽 — 시험지 / 정답과 해설 미리보기 · 인쇄 · PDF */
function PaperPreview({ job, onReload }: { job: JobRow; onReload: () => void }) {
  const [view, setView] = useState<View>('exam');
  const [order, setOrder] = useState<OrderMode>(job.orderMode ?? 'default');
  const [html, setHtml] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const reshuffleNext = useRef(false);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let alive = true;
    setState('loading');
    const reshuffle = reshuffleNext.current;
    reshuffleNext.current = false;
    const q = new URLSearchParams({ kind: view, order, ...(reshuffle ? { reshuffle: '1' } : {}) });
    fetch(`/api/my/final-exams/${job.id}/preview?${q}`, { credentials: 'include', cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(typeof d.error === 'string' ? d.error : '미리보기를 불러오지 못했습니다.');
        }
        return r.text();
      })
      .then((t) => { if (alive) { setHtml(t); setState('ready'); } })
      .catch((e: Error) => { if (alive) { setError(e.message); setState('error'); } });
    return () => { alive = false; };
  }, [job.id, view, order, nonce]);

  /* 미리보기 높이를 내용에 맞춘다(웹폰트가 늦게 들어오면 한 번 더) */
  const onFrameLoad = useCallback(() => {
    const f = frame.current;
    const doc = f?.contentDocument;
    if (!f || !doc) return;
    const fit = () => { f.style.height = `${doc.documentElement.scrollHeight + 40}px`; };
    fit();
    void (doc as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready?.then(fit);
    window.setTimeout(fit, 800);
  }, []);

  const print = async () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    try { await (w.document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* ignore */ }
    w.focus();
    w.print();
  };

  const base = `/api/my/final-exams/${job.id}/download`;
  return (
    <>
      <div className="sticky top-[68px] z-10 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        <div className="flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="보기 선택">
          {(['exam', 'answer'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`rounded-md px-3 py-1 text-[13px] font-semibold ${view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
            >
              {v === 'exam' ? '시험지' : '정답과 해설'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-[12px] font-semibold text-slate-600">
          순서
          <select
            value={order}
            onChange={(e) => setOrder(e.target.value as OrderMode)}
            title="문제 순서 — 채점(QR)도 이 순서를 따릅니다. 전부 랜덤은 고정 순서(다시 섞기로만 바뀜)"
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-semibold text-slate-800"
          >
            <option value="default">기본순(유형별)</option>
            <option value="interleave">회차별로</option>
            <option value="shuffle">전부 랜덤</option>
          </select>
        </label>
        {order === 'shuffle' && (
          <button
            onClick={() => { reshuffleNext.current = true; setNonce((n) => n + 1); }}
            className={BTN_LINE}
            title="새로 섞기 — 이전 순서는 사라지고 채점도 새 순서를 따릅니다"
          >
            🔀 다시 섞기
          </button>
        )}
        <button onClick={() => void print()} disabled={state !== 'ready'} className={BTN_PRIMARY}>
          🖨 인쇄 · PDF 저장
        </button>
        <a href={`${base}?kind=${view}&order=${order}`} className={BTN_LINE} title="서버에서 만든 PDF 파일로 받기">
          ⬇ {view === 'exam' ? '시험지' : '정답과 해설'} PDF
        </a>
      </div>
      <p className="mt-2 text-[13px] text-slate-600">
        화면은 한 단(인쇄 단 폭)으로 보여요 — 인쇄·PDF 는 학교 시험지처럼 A4 2단입니다. 인쇄 창에서 「PDF로 저장」을 고르면 PDF 로 저장돼요.
      </p>

      <div className="mt-3">
        <MoreDownloads job={job} onReload={onReload} />
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-1.5 sm:p-3">
        {state === 'loading' && <p className="py-24 text-center text-sm text-slate-600" role="status">시험지를 불러오는 중…</p>}
        {state === 'error' && (
          <div className="py-16 text-center text-sm text-slate-700" role="alert">
            <p>{error}</p>
            <button onClick={() => setNonce((n) => n + 1)} className={`${BTN_LINE} mt-3`}>다시 불러오기</button>
          </div>
        )}
        {state === 'ready' && (
          <iframe
            key={`${view}-${order}-${nonce}`}
            ref={frame}
            srcDoc={html}
            onLoad={onFrameLoad}
            title={`${displayFinalExamTitle(job.title)} ${view === 'exam' ? '시험지' : '정답과 해설'} 미리보기`}
            className="mx-auto block w-full max-w-[210mm] rounded bg-white shadow"
            style={{ height: '1200px' }}
          />
        )}
      </div>
    </>
  );
}

export default function FinalExamDownloadsPage() {
  const [items, setItems] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [authError, setAuthError] = useState('');
  const [selId, setSelId] = useState<string>('');
  const [expandedGradings, setExpandedGradings] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** 폴더 필터 — null=전체, ''=미분류, 그 외=폴더명 */
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [folderEditId, setFolderEditId] = useState<string | null>(null);
  const [folderInput, setFolderInput] = useState('');
  const mainRef = useRef<HTMLElement>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const r = await fetch('/api/my/final-exams', { credentials: 'include' });
      if (r.status === 401 || r.status === 403) {
        const d = await r.json().catch(() => ({}));
        setAuthError(typeof d.error === 'string' ? d.error : '로그인이 필요합니다.');
        return;
      }
      const d = await r.json();
      setAuthError('');
      if (Array.isArray(d.items)) setItems(d.items as JobRow[]);
      else setLoadError('목록을 불러오지 못했습니다.');
    } catch {
      setLoadError('목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchList(); }, [fetchList]);

  /* 처음엔 가장 최근 시험지를 연다(넓은 화면에서만 — 좁은 화면은 목록부터) */
  useEffect(() => {
    if (selId || items.length === 0) return;
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) setSelId(items[0].id);
  }, [items, selId]);

  const select = (id: string) => {
    setSelId(id);
    setEditingId(null);
    setConfirmDeleteId(null);
    setFolderEditId(null);
    if (!window.matchMedia('(min-width: 1024px)').matches) {
      window.setTimeout(() => mainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  };

  const toggleGradings = (id: string) => {
    setExpandedGradings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const patchJob = useCallback(async (id: string, body: Record<string, string>, fail: string) => {
    setBusyId(id);
    try {
      const r = await fetch(`/api/my/final-exams/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (r.ok) {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...body } : it)));
        return true;
      }
      const d = await r.json().catch(() => ({}));
      alert(typeof d.error === 'string' ? d.error : fail);
    } catch {
      alert(fail);
    } finally {
      setBusyId(null);
    }
    return false;
  }, []);

  const submitRename = async (id: string) => {
    const title = editTitle.trim();
    if (!title) return;
    if (await patchJob(id, { title }, '이름 변경에 실패했습니다.')) setEditingId(null);
  };

  const moveToFolder = async (id: string, folder: string) => {
    if (await patchJob(id, { folder: folder.trim().slice(0, 40) }, '폴더 이동에 실패했습니다.')) {
      setFolderEditId(null);
      setFolderInput('');
    }
  };

  const doDelete = async (id: string) => {
    setBusyId(id);
    try {
      const r = await fetch(`/api/my/final-exams/${id}`, { method: 'DELETE', credentials: 'include' });
      if (r.ok) {
        /* 부모 삭제 시 children(오답세트)도 서버에서 사라지므로 함께 제거 */
        setItems((prev) => prev.filter((it) => it.id !== id && it.parentJobId !== id));
        setConfirmDeleteId(null);
        setSelId('');
      } else {
        const d = await r.json().catch(() => ({}));
        alert(typeof d.error === 'string' ? d.error : '삭제에 실패했습니다.');
      }
    } catch {
      alert('삭제에 실패했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  /* 원본(부모) 기준 — 오답 세트는 부모 아래 들여 쓴 줄. 부모가 목록에 없으면 단독 표시 */
  const ids = new Set(items.map((i) => i.id));
  const allParents = items.filter((i) => !i.parentJobId || !ids.has(i.parentJobId));
  const folderCount = new Map<string, number>();
  for (const p of allParents) { const f = (p.folder || '').trim(); folderCount.set(f, (folderCount.get(f) || 0) + 1); }
  const folderNames = [...folderCount.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
  const unfiledCount = folderCount.get('') || 0;
  const parents = activeFolder === null ? allParents : allParents.filter((p) => (p.folder || '') === activeFolder);
  const childrenOf = (id: string) =>
    items.filter((i) => i.parentJobId === id).sort((a, b) => (a.retryIndex ?? 0) - (b.retryIndex ?? 0));
  const sel = items.find((i) => i.id === selId) ?? null;
  const existingFolders = [...new Set(items.map((i) => (i.folder || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));

  const statusBadge = (j: JobRow) =>
    j.status === 'ready' ? (
      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">✓ 준비됨</span>
    ) : (
      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200">⏱ 제작 중 · {j.totalShort}문항 대기</span>
    );

  const listRow = (j: JobRow, child: boolean) => (
    <button
      key={j.id}
      onClick={() => select(j.id)}
      aria-current={selId === j.id ? 'true' : undefined}
      className={`block w-full border-b border-slate-100 py-2.5 text-left last:border-0 hover:bg-slate-50 ${child ? 'pl-7 pr-3' : 'px-3'} ${selId === j.id ? 'bg-[#13294B]/[0.06]' : ''}`}
    >
      <div className="flex items-start gap-2">
        {selId === j.id && <span aria-hidden className="mt-1 h-3.5 w-1 shrink-0 rounded bg-[#13294B]" />}
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold leading-snug text-slate-900 break-keep">
            {child ? `↳ 오답 재학습 세트 ${j.retryIndex}` : displayFinalExamTitle(j.title)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-600">
            {statusBadge(j)}
            <span>{j.totalRequested}문항</span>
            <span>· {new Date(j.createdAt).toLocaleDateString('ko-KR', { dateStyle: 'medium' })}</span>
          </div>
        </div>
      </div>
    </button>
  );

  return (
    <>
      <AppBar title="내 예비시험지" showBackButton />
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-[1400px] px-4 py-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-slate-900">📝 내 예비시험지</h1>
              <p className="mt-1 text-[13px] text-slate-600">
                {FINAL_EXAM_PRODUCT_NAME} 보관함 — 학교 시험지 양식(A4 2단 · 선택형 뒤 서·논술형)으로 보고, 인쇄하고, PDF 로 받습니다.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => void fetchList()} disabled={loading} className={BTN_LINE}>
                {loading ? '확인 중…' : '↻ 새로고침'}
              </button>
              <Link href="/unified" className={BTN_PRIMARY}>＋ 새 예비시험지 만들기</Link>
            </div>
          </div>

          {authError ? (
            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center">
              <p className="text-sm text-slate-700">{authError}</p>
              <Link href="/login?from=/unified/downloads" className={`${BTN_PRIMARY} mt-4`}>로그인</Link>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-[320px_1fr]">
              <aside className="space-y-3 self-start lg:sticky lg:top-[80px]">
                {folderNames.length > 0 && (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="폴더">
                    <button
                      onClick={() => setActiveFolder(null)}
                      aria-pressed={activeFolder === null}
                      className={`rounded-full px-3 py-1 text-[12px] font-semibold ring-1 ${activeFolder === null ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-slate-700 ring-slate-300'}`}
                    >
                      전체 {allParents.length}
                    </button>
                    {folderNames.map((f) => (
                      <button
                        key={f}
                        onClick={() => setActiveFolder(f)}
                        aria-pressed={activeFolder === f}
                        className={`rounded-full px-3 py-1 text-[12px] font-semibold ring-1 ${activeFolder === f ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-slate-700 ring-slate-300'}`}
                      >
                        📁 {f} {folderCount.get(f)}
                      </button>
                    ))}
                    {unfiledCount > 0 && (
                      <button
                        onClick={() => setActiveFolder('')}
                        aria-pressed={activeFolder === ''}
                        className={`rounded-full px-3 py-1 text-[12px] font-semibold ring-1 ${activeFolder === '' ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-slate-700 ring-slate-300'}`}
                      >
                        미분류 {unfiledCount}
                      </button>
                    )}
                  </div>
                )}
                <nav aria-label="예비시험지 목록" className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
                  {loading && items.length === 0 ? (
                    <p className="py-10 text-center text-sm text-slate-600" role="status">불러오는 중…</p>
                  ) : loadError ? (
                    <div className="py-8 text-center text-sm text-slate-700" role="alert">
                      <p>{loadError}</p>
                      <button onClick={() => void fetchList()} className={`${BTN_LINE} mt-3`}>다시 불러오기</button>
                    </div>
                  ) : items.length === 0 ? (
                    <div className="px-4 py-10 text-center">
                      <p className="text-sm text-slate-700">아직 만든 예비시험지가 없어요.</p>
                      <Link href="/unified" className={`${BTN_PRIMARY} mt-3`}>예비시험지 만들러 가기 →</Link>
                    </div>
                  ) : parents.length === 0 ? (
                    <div className="py-8 text-center text-sm text-slate-700">
                      이 폴더에 시험지가 없어요.
                      <button onClick={() => setActiveFolder(null)} className="ml-1 font-semibold text-[#13294B] underline">전체 보기</button>
                    </div>
                  ) : (
                    parents.map((p) => (
                      <div key={p.id}>
                        {listRow(p, false)}
                        {childrenOf(p.id).map((k) => listRow(k, true))}
                      </div>
                    ))
                  )}
                </nav>
              </aside>

              <main ref={mainRef} className="min-w-0 scroll-mt-4">
                {!sel ? (
                  <p className="rounded-xl border border-dashed border-slate-300 py-20 text-center text-sm text-slate-600">
                    {items.length ? '목록에서 시험지를 고르세요.' : '예비시험지를 만들면 여기에서 보고 인쇄할 수 있어요.'}
                  </p>
                ) : (
                  <>
                    <div className="mb-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                      <div className="flex flex-wrap items-start gap-2">
                        {editingId === sel.id ? (
                          <span className="flex flex-1 flex-wrap items-center gap-1.5">
                            <label htmlFor="rename" className="sr-only">시험지 이름</label>
                            <input
                              id="rename"
                              autoFocus
                              value={editTitle}
                              maxLength={120}
                              onChange={(e) => setEditTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void submitRename(sel.id);
                                else if (e.key === 'Escape') setEditingId(null);
                              }}
                              className="min-w-[220px] flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-[15px] font-semibold text-slate-900"
                            />
                            <button disabled={busyId === sel.id || !editTitle.trim()} onClick={() => void submitRename(sel.id)} className={BTN_PRIMARY}>저장</button>
                            <button onClick={() => setEditingId(null)} className={BTN_LINE}>취소</button>
                          </span>
                        ) : (
                          <h2 className="w-full min-w-0 text-[16px] font-bold leading-snug text-slate-900 break-keep sm:w-auto sm:flex-1">
                            {sel.retryIndex != null ? `오답 재학습 세트 ${sel.retryIndex} · ` : ''}{displayFinalExamTitle(sel.title)}
                          </h2>
                        )}
                        {editingId !== sel.id && (
                          <div className="flex shrink-0 flex-wrap items-center gap-1">
                            {sel.retryIndex == null && (
                              <>
                                <button
                                  onClick={() => { setFolderEditId(folderEditId === sel.id ? null : sel.id); setFolderInput(sel.folder || ''); }}
                                  className="rounded-md px-2 py-1 text-[12px] font-semibold text-slate-600 hover:bg-slate-100"
                                  aria-expanded={folderEditId === sel.id}
                                >
                                  📁 {sel.folder || '폴더'}
                                </button>
                                <button
                                  onClick={() => { setEditingId(sel.id); setEditTitle(sel.title); setConfirmDeleteId(null); }}
                                  className="rounded-md px-2 py-1 text-[12px] font-semibold text-slate-600 hover:bg-slate-100"
                                >
                                  ✏️ 이름 바꾸기
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => {
                                if (confirmDeleteId === sel.id) void doDelete(sel.id);
                                else { setConfirmDeleteId(sel.id); window.setTimeout(() => setConfirmDeleteId((c) => (c === sel.id ? null : c)), 4000); }
                              }}
                              disabled={busyId === sel.id}
                              className={`rounded-md px-2 py-1 text-[12px] font-semibold ${confirmDeleteId === sel.id ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-400' : 'text-slate-600 hover:bg-slate-100'}`}
                            >
                              {confirmDeleteId === sel.id ? '한 번 더 누르면 삭제' : '🗑 삭제'}
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="mt-1.5 text-[13px] text-slate-600" title={sel.scopeSummary}>
                        {sel.scopeSummary} · {sel.totalRequested}문항
                        {sel.pointsCharged > 0 ? ` · ${sel.pointsCharged.toLocaleString()}P` : ''}
                        {sel.shortageOrderNumber ? ` · 제작요청 ${sel.shortageOrderNumber}` : ''}
                        {' · '}{new Date(sel.createdAt).toLocaleDateString('ko-KR', { dateStyle: 'medium' })}
                      </p>
                      {folderEditId === sel.id && (
                        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="mb-2 text-[12px] font-bold text-slate-700">폴더로 옮기기</p>
                          {existingFolders.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {existingFolders.map((f) => (
                                <button
                                  key={f}
                                  disabled={busyId === sel.id}
                                  onClick={() => void moveToFolder(sel.id, f)}
                                  aria-pressed={(sel.folder || '') === f}
                                  className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ${(sel.folder || '') === f ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-slate-700 ring-slate-300'}`}
                                >
                                  {f}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <label htmlFor="folder-new" className="sr-only">새 폴더 이름</label>
                            <input
                              id="folder-new"
                              value={folderInput}
                              maxLength={40}
                              placeholder="새 폴더 이름"
                              onChange={(e) => setFolderInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && folderInput.trim()) void moveToFolder(sel.id, folderInput);
                                else if (e.key === 'Escape') setFolderEditId(null);
                              }}
                              className="min-w-[140px] flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                            />
                            <button disabled={busyId === sel.id || !folderInput.trim()} onClick={() => void moveToFolder(sel.id, folderInput)} className={BTN_PRIMARY}>옮기기</button>
                            {sel.folder ? (
                              <button disabled={busyId === sel.id} onClick={() => void moveToFolder(sel.id, '')} className={BTN_LINE}>미분류로 빼기</button>
                            ) : null}
                          </div>
                        </div>
                      )}
                      <GradingChips job={sel} expanded={expandedGradings.has(sel.id)} onToggle={() => toggleGradings(sel.id)} />
                    </div>

                    {sel.status === 'ready' ? (
                      <PaperPreview key={sel.id} job={sel} onReload={fetchList} />
                    ) : (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-[14px] text-amber-950">
                        <b>⏱ 부족한 {sel.totalShort}문항을 만드는 중이에요.</b> 다 만들어지면 여기에서 바로 볼 수 있어요 — 「새로고침」으로 확인해 주세요.
                      </div>
                    )}
                  </>
                )}
              </main>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
