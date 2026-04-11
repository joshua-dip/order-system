'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/* ── types ── */

interface QuestionDoc {
  _id: string;
  textbook: string;
  source: string;
  type: string;
  difficulty: string;
  status: string;
  pric?: string;
  passage_id?: string;
  reviewComment?: string;
  teacherExplanation?: string;
  flagged?: boolean;
  flaggedAt?: string;
  variation_pct?: number | null;
  question_data: {
    순서?: number;
    Question?: string;
    Paragraph?: string;
    Options?: string;
    CorrectAnswer?: string;
    Explanation?: string;
  };
}

interface SessionStats {
  approved: number;
  rejected: number;
  flagged: number;
  viewed: number;
}

/* ── guide content ── */

const GUIDE_SECTIONS = [
  {
    title: '기본 조작',
    items: [
      { key: '← →', desc: '이전/다음 문제로 이동' },
      { key: 'Space', desc: '정답·해설 토글' },
      { key: 'Enter', desc: '현재 문제 승인 (PRIC 부여)' },
      { key: 'G', desc: '번호 점프 모드 — 원하는 문제 번호 입력 후 Enter' },
    ],
  },
  {
    title: '직접 풀어보기',
    items: [
      { key: '선택지 클릭', desc: '정답을 보기 전에 직접 풀어볼 수 있습니다' },
      { key: '삽입 유형', desc: '지문 내 ①②③④⑤ 번호를 직접 클릭하여 풀이' },
      { key: '피드백', desc: '정답이면 초록, 오답이면 빨강+정답 표시' },
    ],
  },
  {
    title: '깃발 (보류)',
    items: [
      { key: 'F', desc: '현재 문제에 깃발 표시 토글' },
      { key: '필터', desc: '"깃발 있음" 필터로 보류한 문제만 모아보기' },
      { key: '용도', desc: '승인/반려 판단이 애매한 문제를 표시해두고 나중에 재검토' },
    ],
  },
  {
    title: '승인 / 반려 / 되돌리기',
    items: [
      { key: '승인', desc: 'PRIC 고유번호(PRIC-0001~)를 부여하고 검수 완료 처리' },
      { key: '반려', desc: '문제를 반려 상태로 변경, 사유 입력 가능' },
      { key: 'Cmd+Z', desc: '방금 승인/반려한 문제를 8초 이내에 되돌리기' },
    ],
  },
  {
    title: '코멘트 & 선생님 해설',
    items: [
      { key: '검수 코멘트', desc: '문제에 대한 의견·메모를 남길 수 있습니다' },
      { key: '선생님 해설', desc: 'AI 해설과 별도로 나만의 해설을 작성' },
      { key: '자동 저장', desc: '다음 문제로 넘어갈 때 수정된 내용이 자동 저장됩니다' },
    ],
  },
  {
    title: '비교·분석 도구',
    items: [
      { key: 'V', desc: '좌우 분할 뷰 토글 — 문제와 원문을 나란히 비교' },
      { key: '원문 보기', desc: '지문 영역 우측 버튼 — 변형 전 원래 지문과 나란히 비교' },
      { key: '같은 지문 보기', desc: '메타바 📄 버튼 — 동일 지문의 모든 문제를 패널로 비교' },
      { key: '변형도 %', desc: '메타바 배지 — 원문 대비 변형 비율 (초록 40%↑, 노랑 20~40%, 빨강 20%↓)' },
    ],
  },
  {
    title: '편집·집중 모드',
    items: [
      { key: 'E', desc: '인라인 편집 모드 — 발문/지문/선택지/정답/해설을 직접 수정' },
      { key: '◎ 버튼', desc: '포커스 모드 — 필터/통계/힌트를 숨기고 문제에 집중' },
      { key: 'Escape', desc: '포커스 모드 해제 또는 편집 모드 취소' },
    ],
  },
  {
    title: '세션 통계 & 탐색',
    items: [
      { key: '헤더 바', desc: '이번 세션의 승인/반려/보류/열람 건수를 실시간 표시' },
      { key: '프로그레스 바', desc: '클릭하여 해당 위치로 바로 이동' },
      { key: '번호 클릭', desc: '"1 / 120" 텍스트를 클릭하면 번호 입력 모드로 전환' },
    ],
  },
];

/* ── helpers ── */

function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, '');
}

function parseParagraph(raw: string) {
  const cleaned = stripHtml(raw);
  if (cleaned.includes('###')) {
    const [given, ...rest] = cleaned.split('###');
    return { givenSentence: given.trim(), passage: rest.join('').trim() };
  }
  return { givenSentence: '', passage: cleaned };
}

function parseOptions(raw: string) {
  if (raw.includes('###')) return raw.split('###').map((o) => o.trim()).filter(Boolean);
  return raw.split('\n').map((l) => l.trim()).filter(Boolean);
}

function normalizeAnswer(s: string) {
  return s.trim().replace(/\s+/g, ' ');
}

/* ================================================================ */

export default function QuestionReviewPage() {
  const router = useRouter();

  /* ── core state ── */
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<QuestionDoc[]>([]);
  const [stats, setStats] = useState({ total: 0, pricAssigned: 0 });
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [toast, setToast] = useState('');

  /* ── comment / teacher explanation ── */
  const [reviewComment, setReviewComment] = useState('');
  const [teacherExplanation, setTeacherExplanation] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentSaved, setCommentSaved] = useState(false);
  const commentDirtyRef = useRef(false);

  /* ── filters ── */
  const [filterTextbook, setFilterTextbook] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [filterStatus, setFilterStatus] = useState('완료');
  const [filterPric, setFilterPric] = useState('unassigned');
  const [filterFlagged, setFilterFlagged] = useState('');
  const [textbooks, setTextbooks] = useState<string[]>([]);

  /* ── 1. try-solve ── */
  const [solveResult, setSolveResult] = useState<{ selected: string; correct: boolean } | null>(null);

  /* ── 2. flag ── */

  /* ── 4. session stats ── */
  const [sessionStats, setSessionStats] = useState<SessionStats>({ approved: 0, rejected: 0, flagged: 0, viewed: 0 });

  /* ── 5. same passage panel ── */
  const [samePassageOpen, setSamePassageOpen] = useState(false);
  const [samePassageItems, setSamePassageItems] = useState<QuestionDoc[]>([]);
  const [samePassageLoading, setSamePassageLoading] = useState(false);

  /* ── 6. jump nav ── */
  const [jumpMode, setJumpMode] = useState(false);
  const [jumpInput, setJumpInput] = useState('');
  const jumpRef = useRef<HTMLInputElement>(null);

  /* ── 7. undo ── */
  const [lastAction, setLastAction] = useState<{
    type: 'approve' | 'reject';
    doc: QuestionDoc;
    pric?: string;
    previousStatus: string;
  } | null>(null);
  const [showUndo, setShowUndo] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── 8. original passage ── */
  const [showOriginal, setShowOriginal] = useState(false);
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [originalCachedPid, setOriginalCachedPid] = useState<string | null>(null);
  const [originalLoading, setOriginalLoading] = useState(false);

  /* ── 9. split view ── */
  const [splitView, setSplitView] = useState(false);

  /* ── 10. focus mode ── */
  const [focusMode, setFocusMode] = useState(false);

  /* ── 11. inline edit ── */
  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState<{
    Question: string;
    Paragraph: string;
    Options: string;
    CorrectAnswer: string;
    Explanation: string;
    difficulty: string;
    type: string;
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  /* ── guide modal ── */
  const [showGuide, setShowGuide] = useState(false);

  /* ── auth ── */
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.user || d.user.role !== 'admin') {
          router.replace('/admin/login?from=/admin/question-review');
        }
      })
      .catch(() => router.replace('/admin/login?from=/admin/question-review'));
  }, [router]);

  useEffect(() => {
    fetch('/api/admin/generated-questions/meta', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.textbooks)) setTextbooks(d.textbooks); })
      .catch(() => {});
  }, []);

  /* ── fetch items ── */
  const fetchItems = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterTextbook) params.set('textbook', filterTextbook);
    if (filterType) params.set('type', filterType);
    if (filterDifficulty) params.set('difficulty', filterDifficulty);
    if (filterStatus) params.set('status', filterStatus);
    if (filterPric) params.set('pric', filterPric);
    if (filterFlagged) params.set('flagged', filterFlagged);

    fetch(`/api/admin/question-review?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? []);
        setStats(d.stats ?? { total: 0, pricAssigned: 0 });
        setCurrentIdx(0);
        resetQuestionState();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterTextbook, filterType, filterDifficulty, filterStatus, filterPric, filterFlagged]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const current = items[currentIdx] ?? null;

  /* ── load comment/explanation when question changes ── */
  useEffect(() => {
    if (current) {
      setReviewComment(current.reviewComment ?? '');
      setTeacherExplanation(current.teacherExplanation ?? '');
      setCommentSaved(false);
      commentDirtyRef.current = false;
      setSessionStats((s) => ({ ...s, viewed: s.viewed + 1 }));
    }
  }, [current?._id]);

  /* ── reset per-question state ── */
  function resetQuestionState() {
    setShowAnswer(false);
    setShowRejectInput(false);
    setRejectReason('');
    setSolveResult(null);
    setShowOriginal(false);
    setSamePassageOpen(false);
    setEditMode(false);
    setEditDraft(null);
  }

  /* ── toast ── */
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2500);
  };

  /* ── 3. auto-save helper ── */
  const autoSaveIfDirty = async () => {
    if (!current || !commentDirtyRef.current) return;
    if (!reviewComment.trim() && !teacherExplanation.trim()) return;
    try {
      await fetch('/api/admin/question-review/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: current._id, reviewComment, teacherExplanation }),
      });
      commentDirtyRef.current = false;
    } catch { /* silent */ }
  };

  /* ── navigation ── */
  const confirmLeaveEdit = () => {
    if (editMode && editDraft) {
      if (!window.confirm('편집 내용이 저장되지 않았습니다. 이동하시겠습니까?')) return false;
    }
    return true;
  };

  const goNext = async () => {
    if (!confirmLeaveEdit()) return;
    await autoSaveIfDirty();
    resetQuestionState();
    if (currentIdx < items.length - 1) setCurrentIdx((i) => i + 1);
  };

  const goPrev = async () => {
    if (!confirmLeaveEdit()) return;
    await autoSaveIfDirty();
    resetQuestionState();
    if (currentIdx > 0) setCurrentIdx((i) => i - 1);
  };

  const jumpTo = async (n: number) => {
    if (!confirmLeaveEdit()) return;
    await autoSaveIfDirty();
    resetQuestionState();
    setCurrentIdx(Math.max(0, Math.min(n, items.length - 1)));
    setJumpMode(false);
    setJumpInput('');
  };

  /* ── 1. try-solve ── */
  const handleSolve = (selected: string) => {
    if (solveResult) return;
    const correct = normalizeAnswer(selected) === normalizeAnswer(current?.question_data.CorrectAnswer ?? '');
    setSolveResult({ selected, correct });
    if (!correct) setShowAnswer(true);
  };

  /* ── 2. flag ── */
  const handleFlag = async () => {
    if (!current) return;
    try {
      const res = await fetch('/api/admin/question-review/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: current._id }),
      });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || '깃발 실패'); return; }
      setItems((prev) =>
        prev.map((item, i) => i === currentIdx ? { ...item, flagged: d.flagged } : item),
      );
      showToast(d.flagged ? '깃발 표시됨' : '깃발 해제됨');
      if (d.flagged) setSessionStats((s) => ({ ...s, flagged: s.flagged + 1 }));
    } catch { showToast('깃발 처리 오류'); }
  };

  /* ── comment save ── */
  const handleSaveComment = async () => {
    if (!current) return;
    setCommentSaving(true);
    try {
      const res = await fetch('/api/admin/question-review/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: current._id, reviewComment, teacherExplanation }),
      });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || '저장 실패'); return; }
      setCommentSaved(true);
      commentDirtyRef.current = false;
      showToast('저장 완료');
      setItems((prev) =>
        prev.map((item, i) => i === currentIdx ? { ...item, reviewComment, teacherExplanation } : item),
      );
    } catch { showToast('저장 중 오류'); }
    finally { setCommentSaving(false); }
  };

  /* ── approve ── */
  const handleApprove = async () => {
    if (!current || current.pric) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/question-review/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: current._id,
          reviewComment: reviewComment.trim() || undefined,
          teacherExplanation: teacherExplanation.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || '승인 실패'); return; }

      triggerUndo('approve', current, d.pric);
      setItems((prev) => prev.filter((_, i) => i !== currentIdx));
      if (currentIdx >= items.length - 1) setCurrentIdx(Math.max(0, currentIdx - 1));
      resetQuestionState();
      setStats((s) => ({ ...s, pricAssigned: s.pricAssigned + 1 }));
      setSessionStats((s) => ({ ...s, approved: s.approved + 1 }));
      showToast(`승인 완료! ${d.pric}`);
    } catch { showToast('승인 중 오류 발생'); }
    finally { setActionLoading(false); }
  };

  /* ── reject ── */
  const handleReject = async () => {
    if (!current) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/question-review/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: current._id, reason: rejectReason }),
      });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || '반려 실패'); return; }

      triggerUndo('reject', current);
      setItems((prev) => prev.filter((_, i) => i !== currentIdx));
      if (currentIdx >= items.length - 1) setCurrentIdx(Math.max(0, currentIdx - 1));
      resetQuestionState();
      setSessionStats((s) => ({ ...s, rejected: s.rejected + 1 }));
      showToast('반려 처리됨');
    } catch { showToast('반려 중 오류 발생'); }
    finally { setActionLoading(false); }
  };

  /* ── 7. undo ── */
  const triggerUndo = (type: 'approve' | 'reject', doc: QuestionDoc, pric?: string) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setLastAction({ type, doc, pric, previousStatus: doc.status });
    setShowUndo(true);
    undoTimerRef.current = setTimeout(() => { setShowUndo(false); setLastAction(null); }, 8000);
  };

  const handleUndo = async () => {
    if (!lastAction) return;
    try {
      const res = await fetch('/api/admin/question-review/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: lastAction.doc._id,
          undoType: lastAction.type,
          previousStatus: lastAction.previousStatus,
        }),
      });
      if (!res.ok) { showToast('되돌리기 실패'); return; }

      const restored = { ...lastAction.doc };
      if (lastAction.type === 'approve') {
        delete restored.pric;
        setStats((s) => ({ ...s, pricAssigned: Math.max(0, s.pricAssigned - 1) }));
        setSessionStats((s) => ({ ...s, approved: Math.max(0, s.approved - 1) }));
      } else {
        setSessionStats((s) => ({ ...s, rejected: Math.max(0, s.rejected - 1) }));
      }
      setItems((prev) => {
        const newItems = [...prev];
        newItems.splice(currentIdx, 0, restored);
        return newItems;
      });
      showToast('되돌리기 완료');
    } catch { showToast('되돌리기 오류'); }
    finally { setShowUndo(false); setLastAction(null); }
  };

  /* ── 5. same passage ── */
  const handleSamePassage = async () => {
    if (!current?.passage_id) return;
    if (samePassageOpen) { setSamePassageOpen(false); return; }
    setSamePassageLoading(true);
    setSamePassageOpen(true);
    try {
      const res = await fetch(
        `/api/admin/question-review?passage_id=${current.passage_id}`,
        { credentials: 'include' },
      );
      const d = await res.json();
      setSamePassageItems(d.items ?? []);
    } catch { setSamePassageItems([]); }
    finally { setSamePassageLoading(false); }
  };

  /* ── 8. original passage ── */
  const handleOriginal = async () => {
    if (!current?.passage_id) return;
    if (showOriginal) { setShowOriginal(false); return; }
    setShowOriginal(true);
    if (originalCachedPid === current.passage_id && originalText !== null) return;
    setOriginalLoading(true);
    try {
      const res = await fetch(`/api/admin/passages/${current.passage_id}`, { credentials: 'include' });
      const d = await res.json();
      const text = d.item?.content || d.item?.text || d.item?.paragraph || '';
      setOriginalText(text);
      setOriginalCachedPid(current.passage_id);
    } catch { setOriginalText('원문을 불러올 수 없습니다.'); }
    finally { setOriginalLoading(false); }
  };

  /* ── 11. inline edit handlers ── */
  const handleEditSave = async () => {
    if (!current || !editDraft) return;
    setEditSaving(true);
    try {
      const res = await fetch('/api/admin/question-review/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: current._id,
          question_data: {
            Question: editDraft.Question,
            Paragraph: editDraft.Paragraph,
            Options: editDraft.Options,
            CorrectAnswer: editDraft.CorrectAnswer,
            Explanation: editDraft.Explanation,
          },
          difficulty: editDraft.difficulty,
          type: editDraft.type,
        }),
      });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || '저장 실패'); return; }
      setItems((prev) =>
        prev.map((item, i) =>
          i === currentIdx
            ? {
                ...item,
                difficulty: editDraft.difficulty,
                type: editDraft.type,
                question_data: {
                  ...item.question_data,
                  Question: editDraft.Question,
                  Paragraph: editDraft.Paragraph,
                  Options: editDraft.Options,
                  CorrectAnswer: editDraft.CorrectAnswer,
                  Explanation: editDraft.Explanation,
                },
              }
            : item,
        ),
      );
      setEditMode(false);
      setEditDraft(null);
      showToast('편집 저장 완료');
    } catch { showToast('편집 저장 오류'); }
    finally { setEditSaving(false); }
  };

  const handleEditCancel = () => {
    setEditMode(false);
    setEditDraft(null);
  };

  /* ── auto-fetch original for split view ── */
  useEffect(() => {
    if (!splitView || !current?.passage_id) return;
    if (originalCachedPid === current.passage_id && originalText !== null) return;
    setOriginalLoading(true);
    fetch(`/api/admin/passages/${current.passage_id}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const text = d.item?.content || d.item?.text || d.item?.paragraph || '';
        setOriginalText(text);
        setOriginalCachedPid(current.passage_id!);
      })
      .catch(() => setOriginalText('원문을 불러올 수 없습니다.'))
      .finally(() => setOriginalLoading(false));
  }, [splitView, current?.passage_id, current?._id]);

  /* ── keyboard shortcuts ── */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'ArrowLeft') { goPrev(); return; }
      if (e.key === 'ArrowRight') { goNext(); return; }
      if (e.key === ' ') { e.preventDefault(); setShowAnswer((v) => !v); return; }
      if (e.key === 'Enter' && !e.shiftKey && current && !current.pric) { handleApprove(); return; }
      if (e.key === 'f' || e.key === 'F') { handleFlag(); return; }
      if (e.key === 'g' || e.key === 'G') { e.preventDefault(); setJumpMode(true); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (lastAction && showUndo) handleUndo();
        return;
      }
      if (e.key === 'v' || e.key === 'V') {
        if (current?.passage_id) setSplitView((v) => !v);
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        if (!editMode && current) {
          setEditMode(true);
          setEditDraft({
            Question: current.question_data.Question ?? '',
            Paragraph: current.question_data.Paragraph ?? '',
            Options: current.question_data.Options ?? '',
            CorrectAnswer: current.question_data.CorrectAnswer ?? '',
            Explanation: current.question_data.Explanation ?? '',
            difficulty: current.difficulty,
            type: current.type,
          });
        } else if (editMode) {
          setEditMode(false);
          setEditDraft(null);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (editMode) { setEditMode(false); setEditDraft(null); return; }
        if (focusMode) { setFocusMode(false); return; }
      }
      if (e.key === '?' || e.key === 'h' || e.key === 'H') {
        setShowGuide((v) => !v);
        return;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  useEffect(() => {
    if (jumpMode && jumpRef.current) jumpRef.current.focus();
  }, [jumpMode]);

  const progress = items.length > 0 ? `${currentIdx + 1} / ${items.length}` : '0 / 0';

  /* ================================================================
   * RENDER
   * ================================================================ */

  return (
    <div className={`min-h-screen text-white ${focusMode ? 'bg-black' : 'bg-slate-950'}`}>
      {/* toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-semibold animate-pulse">
          {toast}
        </div>
      )}

      {/* guide modal */}
      {showGuide && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowGuide(false)} />
          <div className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4">
            <div className="sticky top-0 bg-slate-900 border-b border-slate-700/50 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">문제 검수 사용법</h2>
              <button type="button" onClick={() => setShowGuide(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="px-6 py-4 space-y-6">
              {GUIDE_SECTIONS.map((section) => (
                <div key={section.title}>
                  <h3 className="text-sm font-bold text-sky-400 mb-2">{section.title}</h3>
                  <div className="space-y-1.5">
                    {section.items.map((item, i) => (
                      <div key={i} className="flex gap-3 text-sm">
                        <span className="shrink-0 w-28 text-right font-mono text-xs bg-slate-800 px-2 py-1 rounded text-slate-300">{item.key}</span>
                        <span className="text-slate-400 py-1">{item.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="border-t border-slate-700/40 pt-4 text-xs text-slate-600 text-center">
                이 안내를 닫으려면 ✕ 버튼, 배경 클릭, 또는 ? 키를 누르세요
              </div>
            </div>
          </div>
        </div>
      )}

      {/* undo bar */}
      {showUndo && lastAction && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-800 border border-slate-600 text-white pl-5 pr-3 py-3 rounded-2xl shadow-2xl">
          <span className="text-sm">
            {lastAction.type === 'approve' ? `승인 (${lastAction.pric})` : '반려'} 처리됨
          </span>
          <button
            type="button"
            onClick={handleUndo}
            className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-bold"
          >
            되돌리기 (Cmd+Z)
          </button>
          <button
            type="button"
            onClick={() => { setShowUndo(false); setLastAction(null); }}
            className="text-slate-500 hover:text-white text-xs px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* same passage slide panel */}
      {samePassageOpen && (
        <div className="fixed inset-y-0 right-0 w-96 z-50 bg-slate-900 border-l border-slate-700 shadow-2xl overflow-y-auto">
          <div className="flex items-center justify-between p-4 border-b border-slate-700">
            <h3 className="font-bold text-sm">같은 지문 문제들</h3>
            <button type="button" onClick={() => setSamePassageOpen(false)} className="text-slate-400 hover:text-white text-lg">✕</button>
          </div>
          {samePassageLoading ? (
            <p className="p-4 text-slate-500 text-sm">불러오는 중...</p>
          ) : samePassageItems.length === 0 ? (
            <p className="p-4 text-slate-500 text-sm">같은 지문의 문제가 없습니다.</p>
          ) : (
            <div className="p-3 space-y-2">
              {samePassageItems.map((item) => (
                <div
                  key={item._id}
                  className={`p-3 rounded-xl border text-xs ${item._id === current?._id ? 'border-sky-500/50 bg-sky-950/30' : 'border-slate-700/40 bg-slate-800/30'}`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded">{item.type}</span>
                    <span className={`px-1.5 py-0.5 rounded ${item.difficulty === '상' ? 'bg-red-900/50 text-red-300' : 'bg-amber-900/50 text-amber-300'}`}>{item.difficulty}</span>
                    {item.pric && <span className="text-emerald-400 font-mono">{item.pric}</span>}
                    {item.flagged && <span className="text-amber-400">⚑</span>}
                    <span className={`ml-auto px-1.5 py-0.5 rounded ${item.status === '완료' ? 'bg-emerald-900/40 text-emerald-300' : item.status === '반려' ? 'bg-red-900/40 text-red-300' : 'bg-yellow-900/40 text-yellow-300'}`}>{item.status}</span>
                  </div>
                  <p className="text-slate-300 truncate">{item.question_data.Question || '(발문 없음)'}</p>
                  <p className="text-slate-500 mt-0.5">정답: {item.question_data.CorrectAnswer}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* header */}
      <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur border-b border-slate-700/50">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/admin/generated-questions" className="text-slate-400 hover:text-white text-sm">← 변형문제</Link>
              <h1 className="text-lg font-bold">문제 검수</h1>
              <button
                type="button"
                onClick={() => setShowGuide(true)}
                className="text-slate-500 hover:text-sky-400 text-xs px-2 py-0.5 rounded border border-slate-700 hover:border-sky-700 transition"
                title="사용법 (? 키)"
              >
                사용법
              </button>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span>PRIC: <span className="text-emerald-400 font-bold">{stats.pricAssigned}</span></span>
              <span>전체: {stats.total}</span>
            </div>
          </div>
          {/* session stats bar */}
          {!focusMode && (sessionStats.viewed > 0) && (
            <div className="flex items-center gap-4 mt-1.5 text-[11px] text-slate-500">
              <span>이번 세션:</span>
              <span className="text-emerald-400">승인 {sessionStats.approved}</span>
              <span className="text-red-400">반려 {sessionStats.rejected}</span>
              <span className="text-amber-400">보류 {sessionStats.flagged}</span>
              <span className="text-slate-400">열람 {sessionStats.viewed}</span>
            </div>
          )}
        </div>
      </header>

      <div className={`mx-auto px-4 py-4 ${splitView ? 'max-w-7xl' : focusMode ? 'max-w-3xl' : 'max-w-5xl'} transition-all`}>
        {/* filters */}
        {!focusMode && <div className="flex flex-wrap gap-2 mb-4">
          <select value={filterTextbook} onChange={(e) => setFilterTextbook(e.target.value)} className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm">
            <option value="">전체 교재</option>
            {textbooks.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm">
            <option value="">전체 유형</option>
            {['빈칸', '순서', '삽입', '무관한문장', '삽입-고난도', '주제', '어법'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterDifficulty} onChange={(e) => setFilterDifficulty(e.target.value)} className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm">
            <option value="">전체 난이도</option>
            <option value="중">중</option>
            <option value="상">상</option>
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm">
            <option value="">전체 상태</option>
            <option value="완료">완료</option>
            <option value="대기">대기</option>
            <option value="반려">반려</option>
          </select>
          <select value={filterPric} onChange={(e) => setFilterPric(e.target.value)} className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm">
            <option value="">PRIC 전체</option>
            <option value="unassigned">미부여</option>
            <option value="assigned">부여됨</option>
          </select>
          <select value={filterFlagged} onChange={(e) => setFilterFlagged(e.target.value)} className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm">
            <option value="">깃발 전체</option>
            <option value="yes">깃발 있음</option>
            <option value="no">깃발 없음</option>
          </select>
        </div>}

        {loading ? (
          <div className="text-center py-20 text-slate-500">불러오는 중...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-slate-500 text-lg mb-2">검수할 문제가 없습니다</p>
            <p className="text-slate-600 text-sm">필터 조건을 변경해 보세요</p>
          </div>
        ) : current ? (
          <div>
            {/* progress bar + jump nav */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                {jumpMode ? (
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => { e.preventDefault(); const n = parseInt(jumpInput, 10); if (n >= 1 && n <= items.length) jumpTo(n - 1); }}
                  >
                    <input
                      ref={jumpRef}
                      type="number"
                      min={1}
                      max={items.length}
                      value={jumpInput}
                      onChange={(e) => setJumpInput(e.target.value)}
                      onBlur={() => { setJumpMode(false); setJumpInput(''); }}
                      placeholder={`1-${items.length}`}
                      className="w-20 bg-slate-800 border border-sky-600 rounded px-2 py-0.5 text-sm text-center"
                    />
                    <span className="text-xs text-slate-500">/ {items.length}</span>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setJumpMode(true); setJumpInput(String(currentIdx + 1)); }}
                    className="text-sm text-slate-400 hover:text-sky-400 cursor-pointer"
                    title="클릭하여 번호 점프 (G)"
                  >
                    {progress}
                  </button>
                )}
                <div className="flex items-center gap-2">
                  {focusMode && (
                    <button type="button" onClick={() => setFocusMode(false)} className="text-xs text-violet-400 hover:text-violet-300 px-2 py-0.5 rounded border border-violet-700/40">
                      포커스 해제
                    </button>
                  )}
                  {current.flagged && <span className="text-amber-400 text-sm" title="깃발 표시됨">⚑</span>}
                  {current.pric && (
                    <span className="text-xs bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded-full font-mono">{current.pric}</span>
                  )}
                </div>
              </div>
              {/* clickable progress bar */}
              {!focusMode && (
                <div
                  className="w-full h-2 bg-slate-800 rounded-full overflow-hidden cursor-pointer relative"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = (e.clientX - rect.left) / rect.width;
                    const idx = Math.round(ratio * (items.length - 1));
                    jumpTo(idx);
                  }}
                  title="클릭하여 이동"
                >
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-sky-400 transition-all duration-300 pointer-events-none"
                    style={{ width: `${((currentIdx + 1) / items.length) * 100}%` }}
                  />
                </div>
              )}
            </div>

            {/* split view grid wrapper */}
            <div className={splitView ? 'grid grid-cols-2 gap-6' : ''}>

            {/* question card */}
            <div className="rounded-2xl border border-slate-700/60 bg-slate-900/50 overflow-hidden">
              {/* meta bar */}
              <div className="px-5 py-3 bg-slate-800/50 border-b border-slate-700/40 flex flex-wrap items-center gap-2 text-xs">
                <span className="bg-slate-700 px-2 py-0.5 rounded font-medium">{current.textbook}</span>
                <span className="text-slate-400">{current.source}</span>
                {editMode && editDraft ? (
                  <select
                    value={editDraft.type}
                    onChange={(e) => setEditDraft({ ...editDraft, type: e.target.value })}
                    className="bg-violet-900/50 text-violet-300 px-2 py-0.5 rounded text-xs border-none outline-none"
                  >
                    {['빈칸', '순서', '삽입', '무관한문장', '삽입-고난도', '주제', '어법'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                ) : (
                  <span className="bg-violet-900/50 text-violet-300 px-2 py-0.5 rounded">{current.type}</span>
                )}
                {editMode && editDraft ? (
                  <select
                    value={editDraft.difficulty}
                    onChange={(e) => setEditDraft({ ...editDraft, difficulty: e.target.value })}
                    className={`px-2 py-0.5 rounded text-xs border-none outline-none ${editDraft.difficulty === '상' ? 'bg-red-900/50 text-red-300' : 'bg-amber-900/50 text-amber-300'}`}
                  >
                    <option value="중">중</option>
                    <option value="상">상</option>
                  </select>
                ) : (
                  <span className={`px-2 py-0.5 rounded ${current.difficulty === '상' ? 'bg-red-900/50 text-red-300' : 'bg-amber-900/50 text-amber-300'}`}>
                    {current.difficulty}
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded ${current.status === '완료' ? 'bg-emerald-900/50 text-emerald-300' : current.status === '반려' ? 'bg-red-900/50 text-red-300' : 'bg-yellow-900/50 text-yellow-300'}`}>
                  {current.status}
                </span>
                {current.variation_pct != null && (
                  <span
                    className={`px-2 py-0.5 rounded font-mono ${
                      current.variation_pct >= 40
                        ? 'bg-emerald-900/50 text-emerald-300'
                        : current.variation_pct >= 20
                        ? 'bg-yellow-900/50 text-yellow-300'
                        : 'bg-red-900/50 text-red-300'
                    }`}
                    title={`원문 대비 ${current.variation_pct}% 변형`}
                  >
                    변형 {current.variation_pct}%
                  </span>
                )}

                <div className="ml-auto flex items-center gap-2">
                  {current.passage_id && (
                    <button
                      type="button"
                      onClick={() => setSplitView((v) => !v)}
                      className={`px-2 py-0.5 rounded text-sm transition ${splitView ? 'bg-sky-800/50 text-sky-300' : 'text-slate-500 hover:text-sky-400'}`}
                      title="좌우 분할 뷰 (V)"
                    >
                      ▥
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setFocusMode((v) => !v)}
                    className={`px-2 py-0.5 rounded text-sm transition ${focusMode ? 'bg-violet-800/50 text-violet-300' : 'text-slate-500 hover:text-violet-400'}`}
                    title={focusMode ? '포커스 해제 (Esc)' : '포커스 모드'}
                  >
                    {focusMode ? '◉' : '◎'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!editMode && current) {
                        setEditMode(true);
                        setEditDraft({
                          Question: current.question_data.Question ?? '',
                          Paragraph: current.question_data.Paragraph ?? '',
                          Options: current.question_data.Options ?? '',
                          CorrectAnswer: current.question_data.CorrectAnswer ?? '',
                          Explanation: current.question_data.Explanation ?? '',
                          difficulty: current.difficulty,
                          type: current.type,
                        });
                      } else {
                        setEditMode(false);
                        setEditDraft(null);
                      }
                    }}
                    className={`px-2 py-0.5 rounded text-sm transition ${editMode ? 'bg-amber-800/50 text-amber-300' : 'text-slate-500 hover:text-amber-400'}`}
                    title="인라인 편집 (E)"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={handleFlag}
                    className={`px-2 py-0.5 rounded text-sm transition ${current.flagged ? 'bg-amber-800/50 text-amber-300' : 'text-slate-500 hover:text-amber-400'}`}
                    title="깃발 토글 (F)"
                  >
                    ⚑
                  </button>
                  {current.passage_id && (
                    <button
                      type="button"
                      onClick={handleSamePassage}
                      className="text-slate-500 hover:text-sky-400 transition"
                      title="같은 지문 보기"
                    >
                      📄
                    </button>
                  )}
                  <span className="text-slate-600 font-mono text-[10px]">{current._id.slice(-8)}</span>
                </div>
              </div>

              {/* edit mode header */}
              {editMode && editDraft && (
                <div className="px-5 py-2 bg-amber-900/20 border-b border-amber-700/30 flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-400">✎ 편집 중</span>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={handleEditCancel} className="px-3 py-1 rounded-lg text-xs text-slate-400 hover:text-white border border-slate-600 transition">취소</button>
                    <button type="button" onClick={handleEditSave} disabled={editSaving} className="px-4 py-1 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 transition">
                      {editSaving ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </div>
              )}

              {/* question */}
              <div className="p-5 space-y-4">
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">발문</h3>
                  {editMode && editDraft ? (
                    <textarea
                      value={editDraft.Question}
                      onChange={(e) => setEditDraft({ ...editDraft, Question: e.target.value })}
                      rows={2}
                      className="w-full bg-slate-800/50 border border-amber-700/30 rounded-xl px-4 py-2.5 text-base font-medium leading-relaxed resize-y focus:outline-none focus:border-amber-500/50"
                    />
                  ) : (
                    <p className="text-base font-medium leading-relaxed">
                      {current.question_data.Question || '(발문 없음)'}
                    </p>
                  )}
                </div>

                {/* paragraph */}
                {(current.question_data.Paragraph || (editMode && editDraft)) && (() => {
                  if (editMode && editDraft) {
                    return (
                      <div>
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">지문</h3>
                        <textarea
                          value={editDraft.Paragraph}
                          onChange={(e) => setEditDraft({ ...editDraft, Paragraph: e.target.value })}
                          rows={10}
                          className="w-full bg-slate-800/50 border border-amber-700/30 rounded-xl px-4 py-2.5 text-sm leading-[1.9] resize-y focus:outline-none focus:border-amber-500/50"
                        />
                      </div>
                    );
                  }

                  const { givenSentence, passage } = parseParagraph(current.question_data.Paragraph!);
                  const isInsertion = current.type === '삽입';
                  const circledPattern = /([①②③④⑤])/g;

                  return (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">지문</h3>
                        {current.passage_id && !splitView && (
                          <button
                            type="button"
                            onClick={handleOriginal}
                            className={`text-[11px] px-2 py-0.5 rounded transition ${showOriginal ? 'bg-cyan-800/50 text-cyan-300' : 'text-slate-500 hover:text-cyan-400'}`}
                          >
                            {showOriginal ? '원문 닫기' : '원문 보기'}
                          </button>
                        )}
                      </div>

                      {/* original passage comparison */}
                      {showOriginal && (
                        <div className="mb-3 p-3 rounded-xl bg-cyan-950/20 border border-cyan-800/25">
                          <p className="text-[10px] text-cyan-500 font-bold mb-1.5">원문 (변형 전)</p>
                          {originalLoading ? (
                            <p className="text-sm text-slate-500">불러오는 중...</p>
                          ) : (
                            <p className="text-sm leading-[1.9] text-cyan-100/80 whitespace-pre-wrap">
                              {originalText || '(원문 없음)'}
                            </p>
                          )}
                        </div>
                      )}

                      {givenSentence && (
                        <div className="mb-3 p-3 rounded-xl bg-amber-950/30 border border-amber-800/30">
                          <p className="text-xs text-amber-400/70 font-bold mb-1">주어진 문장</p>
                          <p className="text-sm leading-relaxed text-amber-100">{givenSentence}</p>
                        </div>
                      )}
                      <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/30">
                        {isInsertion && !solveResult ? (
                          <p className="text-sm leading-[1.9] text-slate-200">
                            {passage.split(circledPattern).map((part, i) => {
                              if (/^[①②③④⑤]$/.test(part)) {
                                return (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() => handleSolve(part)}
                                    className="inline-block mx-1 px-2 py-0.5 rounded-lg bg-violet-900/40 hover:bg-violet-700/50 text-violet-300 font-bold cursor-pointer transition text-base"
                                    title="이 위치 선택"
                                  >
                                    {part}
                                  </button>
                                );
                              }
                              return <span key={i}>{part}</span>;
                            })}
                          </p>
                        ) : isInsertion && solveResult ? (
                          <p className="text-sm leading-[1.9] text-slate-200">
                            {passage.split(circledPattern).map((part, i) => {
                              if (/^[①②③④⑤]$/.test(part)) {
                                const isCorrectPos = normalizeAnswer(part) === normalizeAnswer(current.question_data.CorrectAnswer ?? '');
                                const isSelected = normalizeAnswer(part) === normalizeAnswer(solveResult.selected);
                                let cls = 'inline-block mx-1 px-2 py-0.5 rounded-lg font-bold text-base ';
                                if (isCorrectPos) cls += 'bg-emerald-700/60 text-emerald-200 ring-2 ring-emerald-400';
                                else if (isSelected && !solveResult.correct) cls += 'bg-red-700/50 text-red-200 line-through';
                                else cls += 'bg-slate-700/40 text-slate-400';
                                return <span key={i} className={cls}>{part}</span>;
                              }
                              return <span key={i}>{part}</span>;
                            })}
                          </p>
                        ) : (
                          <p className="text-sm leading-[1.9] text-slate-200 whitespace-pre-wrap">{passage}</p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* options (clickable for try-solve) */}
                {editMode && editDraft ? (
                  <div>
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">선택지</h3>
                    <textarea
                      value={editDraft.Options}
                      onChange={(e) => setEditDraft({ ...editDraft, Options: e.target.value })}
                      rows={5}
                      className="w-full bg-slate-800/50 border border-amber-700/30 rounded-xl px-4 py-2.5 text-sm leading-relaxed resize-y focus:outline-none focus:border-amber-500/50"
                      placeholder="선택지를 줄 바꿈으로 구분"
                    />
                    <div className="mt-3 flex items-center gap-3">
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">정답</h3>
                      <input
                        value={editDraft.CorrectAnswer}
                        onChange={(e) => setEditDraft({ ...editDraft, CorrectAnswer: e.target.value })}
                        className="flex-1 bg-slate-800/50 border border-amber-700/30 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500/50"
                      />
                    </div>
                    <div className="mt-3">
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">AI 해설</h3>
                      <textarea
                        value={editDraft.Explanation}
                        onChange={(e) => setEditDraft({ ...editDraft, Explanation: e.target.value })}
                        rows={4}
                        className="w-full bg-slate-800/50 border border-amber-700/30 rounded-xl px-4 py-2.5 text-sm leading-relaxed resize-y focus:outline-none focus:border-amber-500/50"
                      />
                    </div>
                  </div>
                ) : current.question_data.Options && (() => {
                  const opts = parseOptions(current.question_data.Options);
                  const isCircledOnly = opts.every((o) => /^[①②③④⑤]$/.test(o.trim()));
                  if (isCircledOnly) return null;

                  return (
                    <div>
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">선택지</h3>
                      <div className="space-y-1.5">
                        {opts.map((opt, i) => {
                          const optNorm = normalizeAnswer(opt);
                          const correctNorm = normalizeAnswer(current.question_data.CorrectAnswer ?? '');
                          const isCorrectOpt = optNorm === correctNorm || opt.startsWith(current.question_data.CorrectAnswer ?? '___NONE___');

                          let cls = 'px-3 py-2 rounded-lg text-sm transition ';
                          if (solveResult) {
                            const isSelected = normalizeAnswer(solveResult.selected) === optNorm;
                            if (isCorrectOpt) cls += 'bg-emerald-900/40 border border-emerald-600/40 text-emerald-200';
                            else if (isSelected && !solveResult.correct) cls += 'bg-red-900/30 border border-red-600/30 text-red-300 line-through';
                            else cls += 'bg-slate-800/20 text-slate-500';
                          } else {
                            cls += 'bg-slate-800/30 hover:bg-slate-700/40 cursor-pointer';
                          }

                          return (
                            <div
                              key={i}
                              className={cls}
                              onClick={() => { if (!solveResult) handleSolve(opt); }}
                              role={solveResult ? undefined : 'button'}
                              tabIndex={solveResult ? undefined : 0}
                            >
                              {opt}
                            </div>
                          );
                        })}
                      </div>
                      {solveResult && (
                        <p className={`mt-2 text-sm font-bold ${solveResult.correct ? 'text-emerald-400' : 'text-red-400'}`}>
                          {solveResult.correct ? '정답입니다!' : `오답 — 정답: ${current.question_data.CorrectAnswer}`}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* answer toggle — hide in edit mode */}
              {editMode ? null : (
              <div className="px-5 pb-5">
                <button type="button" onClick={() => setShowAnswer(!showAnswer)} className="text-sm text-sky-400 hover:text-sky-300 font-medium">
                  {showAnswer ? '정답·해설 숨기기 ▲' : '정답·해설 보기 ▼'}
                </button>

                {showAnswer && (
                  <div className="mt-3 p-4 rounded-xl bg-slate-800/50 border border-slate-700/30 space-y-3">
                    <p className="text-sm">
                      <span className="text-slate-500 font-bold mr-2">정답</span>
                      <span className="text-lg font-bold text-emerald-400">{current.question_data.CorrectAnswer}</span>
                    </p>
                    {current.question_data.Explanation && (
                      <div>
                        <span className="text-slate-500 font-bold text-sm">AI 해설</span>
                        <p className="mt-1 text-sm leading-relaxed text-slate-300">{current.question_data.Explanation}</p>
                      </div>
                    )}
                    {current.teacherExplanation && (
                      <div className="pt-2 border-t border-amber-800/20">
                        <span className="text-amber-400/80 font-bold text-sm">선생님 해설</span>
                        <p className="mt-1 text-sm leading-relaxed text-amber-100/90 whitespace-pre-wrap">{current.teacherExplanation}</p>
                      </div>
                    )}
                    {current.reviewComment && (
                      <div className="pt-2 border-t border-slate-700/30">
                        <span className="text-sky-400/80 font-bold text-sm">검수 코멘트</span>
                        <p className="mt-1 text-sm leading-relaxed text-slate-400 whitespace-pre-wrap">{current.reviewComment}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              )}

              {/* comment & teacher explanation */}
              {!focusMode && <div className="px-5 pb-5 space-y-4 border-t border-slate-700/30 pt-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">검수 코멘트</h3>
                    {commentSaved && <span className="text-[10px] text-emerald-500">저장됨</span>}
                  </div>
                  <textarea
                    value={reviewComment}
                    onChange={(e) => { setReviewComment(e.target.value); setCommentSaved(false); commentDirtyRef.current = true; }}
                    placeholder="이 문제에 대한 의견이나 메모를 남겨주세요..."
                    rows={2}
                    className="w-full bg-slate-800/50 border border-slate-700/40 rounded-xl px-4 py-2.5 text-sm leading-relaxed resize-y placeholder:text-slate-600 focus:outline-none focus:border-sky-600/50"
                  />
                </div>

                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">선생님 해설</h3>
                  <textarea
                    value={teacherExplanation}
                    onChange={(e) => { setTeacherExplanation(e.target.value); setCommentSaved(false); commentDirtyRef.current = true; }}
                    placeholder="AI 해설과 별도로 선생님만의 해설을 작성해 주세요..."
                    rows={4}
                    className="w-full bg-slate-800/50 border border-amber-800/20 rounded-xl px-4 py-2.5 text-sm leading-relaxed resize-y placeholder:text-slate-600 focus:outline-none focus:border-amber-600/50"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSaveComment}
                  disabled={commentSaving}
                  className="px-5 py-2 rounded-lg bg-sky-800 hover:bg-sky-700 text-sm font-medium disabled:opacity-40 transition"
                >
                  {commentSaving ? '저장 중...' : '코멘트·해설 저장'}
                </button>
              </div>}
            </div>

            {/* split view: original passage panel */}
            {splitView && (
              <div className="rounded-2xl border border-slate-700/60 bg-slate-900/50 overflow-hidden sticky top-20 self-start max-h-[calc(100vh-6rem)]">
                <div className="px-5 py-3 bg-slate-800/50 border-b border-slate-700/40 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">원문 (변형 전)</h3>
                  {current.variation_pct != null && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-mono ${
                        current.variation_pct >= 40
                          ? 'bg-emerald-900/50 text-emerald-300'
                          : current.variation_pct >= 20
                          ? 'bg-yellow-900/50 text-yellow-300'
                          : 'bg-red-900/50 text-red-300'
                      }`}
                    >
                      {current.variation_pct}%
                    </span>
                  )}
                </div>
                <div className="p-5 overflow-y-auto max-h-[calc(100vh-10rem)]">
                  {originalLoading ? (
                    <p className="text-sm text-slate-500">불러오는 중...</p>
                  ) : !current.passage_id ? (
                    <p className="text-sm text-slate-500">지문이 없는 문항입니다.</p>
                  ) : (
                    <p className="text-sm leading-[1.9] text-cyan-100/80 whitespace-pre-wrap">
                      {originalText || '(원문 없음)'}
                    </p>
                  )}
                </div>
              </div>
            )}

            </div>{/* /split view grid wrapper */}

            {/* action buttons */}
            <div className="mt-5 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={goPrev} disabled={currentIdx === 0} className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-sm font-medium transition">
                  ← 이전
                </button>

                <div className="flex items-center gap-3">
                  {!current.pric && !editMode && (
                    <>
                      <button type="button" onClick={() => setShowRejectInput(!showRejectInput)} disabled={actionLoading} className="px-5 py-2.5 rounded-xl bg-red-900/40 hover:bg-red-900/60 border border-red-700/40 text-red-300 text-sm font-bold disabled:opacity-40 transition">
                        반려
                      </button>
                      <button type="button" onClick={handleApprove} disabled={actionLoading} className="px-8 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold disabled:opacity-40 shadow-lg shadow-emerald-900/40 transition">
                        {actionLoading ? '처리 중...' : '승인 (PRIC 부여)'}
                      </button>
                    </>
                  )}
                  {editMode && (
                    <span className="text-xs text-amber-400">편집 모드 — 저장 후 승인/반려 가능</span>
                  )}
                </div>

                <button type="button" onClick={goNext} disabled={currentIdx >= items.length - 1} className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-sm font-medium transition">
                  다음 →
                </button>
              </div>

              {showRejectInput && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-red-950/20 border border-red-800/30">
                  <input
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="반려 사유 (선택)"
                    className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleReject(); }}
                  />
                  <button type="button" onClick={handleReject} disabled={actionLoading} className="px-5 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-bold disabled:opacity-40">
                    반려 확정
                  </button>
                </div>
              )}
            </div>

            {/* keyboard shortcuts hint */}
            {!focusMode && (
              <div className="mt-4 text-center text-xs text-slate-600">
                ← → 이동 · Space 정답 · Enter 승인 · F 깃발 · G 점프 · V 분할 · E 편집 · Cmd+Z 되돌리기 · ? 사용법
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
