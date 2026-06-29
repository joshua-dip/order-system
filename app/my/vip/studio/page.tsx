'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/* ── 출제 스튜디오 — 한 지문에 집중: 좌측 원문(출제 포인트 표시) · 우측 변형문제 직접 작성(AI 없음) ── */

interface SchoolOpt { id: string; name: string }
interface ExamOpt { id: string; academicYear: number; grade: number; examType: string; examScopePassages: string[] }
interface ScopePassage { key: string; textbook: string; sourceKey: string; passageId: string; original: string }
interface Mark { scope: 'word' | 'phrase' | 'sentence'; target: string; qTypes: string[]; note: string; start?: number; end?: number }
interface Problem { id: string; type: string; question: string; paragraph: string; options: string; answer: string; explanation: string; status: '제작완료' | '검수완료'; createdAt: string }
interface Bank { total: number; 완료: number; 대기: number; 검수불일치: number }
interface Workspace { passageId: string; sourceKey: string; textbook: string; source: string; examType: string; original: string; examId?: string; key?: string }
interface StudioPhoto { id: string; name: string; url: string }

const GRADES = [1, 2, 3];
const QTYPES = ['빈칸', '어법', '어휘', '순서', '삽입', '요약', '무관한문장', '함의', '주제', '제목', '주장', '일치', '불일치', '영작', '기타'];
const SCOPE_LABEL: Record<Mark['scope'], string> = { word: '단어', phrase: '구', sentence: '문장' };
const CIRCLED = ['①', '②', '③', '④', '⑤'];
/** 원문 왼쪽 출제 포인트 거터 폭(px) + 카드 스택 간격용 추정 높이. */
const STUDIO_GUTTER = 150;
const STUDIO_CARD_H = 66;  // 거터 카드 추정 높이(헤더+유형칩+메모 3줄) — 스택 겹침 방지용
const BLANK_PF = { type: '빈칸', question: '', paragraph: '', opts: ['', '', '', '', ''] as string[], answer: '', explanation: '' };
/** 유형별 입력 형태. */
const MARKER_TYPES = ['어법', '어휘', '삽입', '무관한문장'];   // 보기 = 본문 안 ①~⑤ 표시(별도 선택지 입력란 없음)
const ESSAY_TYPES = ['영작'];                                  // 보기·정답번호 없이 모범답안
const MULTI_ANSWER_TYPES = ['어법', '어휘'];                   // 복수정답(고난도) 가능
const ORDER_OPTS_DEFAULT = ['(A)-(C)-(B)', '(B)-(A)-(C)', '(B)-(C)-(A)', '(C)-(A)-(B)', '(C)-(B)-(A)'];
const DEFAULT_QUESTION: Record<string, string> = {
  빈칸: '다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?',
  어법: '다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?',
  어휘: '다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?',
  순서: '주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?',
  삽입: '글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?',
  요약: '다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 말로 가장 적절한 것은?',
  무관한문장: '다음 글에서 전체 흐름과 관계 없는 문장은?',
  함의: '밑줄 친 부분이 다음 글에서 의미하는 바로 가장 적절한 것은?',
  주제: '다음 글의 주제로 가장 적절한 것은?',
  제목: '다음 글의 제목으로 가장 적절한 것은?',
  주장: '다음 글에서 필자가 주장하는 바로 가장 적절한 것은?',
  일치: '다음 글의 내용과 일치하는 것은?',
  불일치: '다음 글의 내용과 일치하지 않는 것은?',
};
/** 자동 채운 발문인지 판별용(직접 입력 발문과 구분). */
const DEFAULT_QUESTION_SET = new Set(Object.values(DEFAULT_QUESTION));
/** 유형별 선택지 placeholder. */
function optHint(type: string, i: number): string {
  if (type === '순서') return `${ORDER_OPTS_DEFAULT[i] ?? '배열'} 형태`;
  if (type === '요약') return '(A) 단어 · (B) 단어';
  return `선택지 ${CIRCLED[i]}`;
}
/** 마커 유형(보기가 본문 안 ①~⑤) 안내. */
function markerHint(type: string): string {
  if (type === '어법' || type === '어휘') return '보기를 본문에서 ①~⑤로 밑줄(번호) 표시하고, 아래에서 정답 번호만 고르세요.';
  if (type === '삽입') return '본문에 ①~⑤ 위치 표시 + 「발문」 위 칸에 넣을 문장을 적고, 정답 위치만 고르세요.';
  return '전체 흐름과 무관한 문장에 ①~⑤를 매기고, 정답 번호만 고르세요.';
}
/** 저장된 options 문자열(### 또는 줄바꿈) → 5칸 배열 (앞 동그라미 제거). */
function parseOpts(s: string): string[] {
  const arr = String(s || '').split(/\s*###\s*|\n/).map((x) => x.replace(/^\s*[①②③④⑤]\s*/, '').trim());
  return [0, 1, 2, 3, 4].map((i) => arr[i] ?? '');
}
/** 5칸 배열 → 저장용 options 문자열 (`① a ### ② b …`). 중간 빈칸은 번호만 남겨 위치 보존, 뒤쪽 빈칸은 생략. */
function buildOpts(opts: string[]): string {
  let last = -1;
  for (let i = 0; i < 5; i++) if (opts[i] && opts[i].trim()) last = i;
  if (last < 0) return '';
  const parts: string[] = [];
  for (let i = 0; i <= last; i++) parts.push(opts[i] && opts[i].trim() ? `${CIRCLED[i]} ${opts[i].trim()}` : CIRCLED[i]);
  return parts.join(' ### ');
}

function cleanWord(w: string): string { return w.replace(/^[^A-Za-z0-9'’\-]+|[^A-Za-z0-9'’\-]+$/g, ''); }
/**
 * 원문을 토큰으로 렌더하면서 출제 포인트(marks)를 위치 기반으로 강조.
 * 단어 mark = 배경 강조, 구/문장 mark = 밑줄(연속) — 겹치면 둘 다 적용.
 * 클릭/드래그는 컨테이너(onMouseUp)에서 처리(data-word 로 단어 식별).
 */
/** 마크 1개가 덮는 원문 범위 [start,end) — 위치 고정값(start)이 있으면 그 위치만, 없으면(레거시) 첫 등장. */
function markRange(m: Mark, text: string, lc: string): { start: number; end: number } | null {
  const t = m.target.trim(); if (t.length < 1) return null;
  if (typeof m.start === 'number' && m.start >= 0 && m.start < text.length) {
    const end = typeof m.end === 'number' && m.end > m.start ? Math.min(m.end, text.length) : Math.min(m.start + t.length, text.length);
    return { start: m.start, end };
  }
  const idx = lc.indexOf(t.toLowerCase());
  return idx >= 0 ? { start: idx, end: idx + t.length } : null;
}

function renderOriginal(text: string, marks: Mark[]) {
  const lc = text.toLowerCase();
  // 마크당 정확히 한 범위(선택 위치 고정) — 같은 단어가 여러 곳 나와도 그 위치만 하이라이트
  const ranges = marks.map((m) => {
    const r = markRange(m, text, lc); if (!r) return null;
    return { ...r, multi: /\s/.test(m.target.trim()) || m.scope !== 'word', mark: m };
  }).filter((r): r is { start: number; end: number; multi: boolean; mark: Mark } => !!r);
  let pos = 0;
  return text.split(/(\s+)/).map((part, i) => {
    const start = pos, end = pos + part.length; pos = end;
    if (part === '') return null;
    const isSpace = /^\s+$/.test(part);
    const covering = ranges.filter((r) => r.start < end && r.end > start);
    const covered = covering.length > 0;
    const multi = covering.some((r) => r.multi);
    const bg = covered ? 'bg-amber-400/25' : '';
    const underline = multi ? 'border-b-2 border-amber-400/70' : '';
    if (isSpace) return <span key={i} className={`${bg} ${underline}`}>{part}</span>;
    const title = covered
      ? covering.map((r) => `[${SCOPE_LABEL[r.mark.scope]}${r.mark.qTypes.length ? '·' + r.mark.qTypes.join('·') : ''}] ${r.mark.target}${r.mark.note ? ' — ' + r.mark.note : ''}`).join('\n')
      : '클릭(단어) · 드래그(구)해 출제 포인트';
    return (
      <span key={i} data-word={cleanWord(part) || part} data-start={start} title={title}
        className={`cursor-pointer rounded-sm px-px transition-colors hover:bg-amber-400/40 ${covered ? 'text-amber-100' : ''} ${bg} ${underline}`}>{part}</span>
    );
  });
}

export default function StudioPage() {
  const [tab, setTab] = useState<'scope' | 'free'>('scope');

  /* 시험범위 탭 */
  const [schools, setSchools] = useState<SchoolOpt[]>([]);
  const [selectedSchool, setSelectedSchool] = useState('');
  const [grade, setGrade] = useState(0);
  const [exams, setExams] = useState<ExamOpt[]>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [scopePassages, setScopePassages] = useState<ScopePassage[]>([]);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeMeta, setScopeMeta] = useState<{ examType: string } | null>(null);
  const [openText, setOpenText] = useState<Record<string, boolean>>({});

  /* 일반 지문 탭 (모의고사 DB) */
  const [tbs, setTbs] = useState<string[]>([]);
  const [freeTb, setFreeTb] = useState('');
  const [freeItems, setFreeItems] = useState<{ _id: string; source_key?: string }[]>([]);
  const [freeBusy, setFreeBusy] = useState(false);

  /* 작업 공간 */
  const [wp, setWp] = useState<Workspace | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [bank, setBank] = useState<Bank | null>(null);
  const [wpLoading, setWpLoading] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pf, setPf] = useState({ ...BLANK_PF });
  const [editingId, setEditingId] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const rightColRef = useRef<HTMLDivElement | null>(null); // 우측 스크롤 칼럼(편집 시 맨 위로)
  const paneRef = useRef<HTMLDivElement | null>(null);
  const origRef = useRef<HTMLDivElement | null>(null);
  /* 원문 왼쪽 거터에 마크 카드 배치용 — 단어 위치 측정 결과 */
  const contentRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null); // 본문 텍스트만(거터 카드 제외) — 선택 대상 한정용
  const [markEditor, setMarkEditor] = useState<number | null>(null); // 더블클릭 시 상세 편집 팝업(마크 index)
  const [focusMode, setFocusMode] = useState(false);  // 집중 모드 — 우측 편집 숨기고 원문 전체폭+큰 글씨로 출제 포인트에 집중
  const [cliCopied, setCliCopied] = useState(false);  // cc:studio CLI 명령 복사 피드백
  /* 시험범위에서 불러온 지문의 학생 필기 사진 + 확대/축소 뷰어 */
  const [passagePhotos, setPassagePhotos] = useState<StudioPhoto[]>([]);
  const [photoViewer, setPhotoViewer] = useState<StudioPhoto | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [markPos, setMarkPos] = useState<{ key: number; wordTop: number; wordLeft: number; wordH: number; cardTop: number }[]>([]);
  /* 원문↔편집 분할 비율(%) — 드래그 바로 조절, localStorage 저장 (거터 때문에 기본 넓게) */
  const [leftPct, setLeftPct] = useState(52);
  useEffect(() => {
    const v = Number(localStorage.getItem('studio_leftPct'));
    if (Number.isFinite(v) && v >= 25 && v <= 70) setLeftPct(v);
  }, []);
  useEffect(() => { localStorage.setItem('studio_leftPct', String(Math.round(leftPct))); }, [leftPct]);

  /* ── 데이터 로딩 ── */
  useEffect(() => {
    fetch('/api/my/vip/schools', { credentials: 'include' }).then((r) => r.json())
      .then((d) => { if (d.ok && Array.isArray(d.schools)) setSchools(d.schools); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!selectedSchool) { setExams([]); return; }
    let alive = true;
    fetch(`/api/my/vip/school-exams?schoolId=${selectedSchool}`, { credentials: 'include' }).then((r) => r.json())
      .then((d) => { if (alive && d.ok && Array.isArray(d.exams)) setExams(d.exams); }).catch(() => {});
    return () => { alive = false; };
  }, [selectedSchool]);
  const loadScope = useCallback(async (examId: string) => {
    setScopeLoading(true);
    try {
      const d = await fetch(`/api/my/vip/school-exams/${examId}/scope-passages`, { credentials: 'include' }).then((r) => r.json());
      setScopePassages(d.ok && Array.isArray(d.passages) ? d.passages : []);
      setScopeMeta(d.ok && d.exam ? d.exam : null);
    } catch { setScopePassages([]); setScopeMeta(null); } finally { setScopeLoading(false); }
  }, []);
  useEffect(() => { if (selectedExamId) void loadScope(selectedExamId); else { setScopePassages([]); setScopeMeta(null); } }, [selectedExamId, loadScope]);

  // 일반 지문: 교재 목록
  useEffect(() => {
    if (tab !== 'free' || tbs.length) return;
    fetch('/api/class-kit/passages/textbooks', { credentials: 'include' }).then((r) => r.json())
      .then((d) => { if (Array.isArray(d.textbooks)) setTbs(d.textbooks); }).catch(() => {});
  }, [tab, tbs.length]);
  useEffect(() => {
    if (!freeTb) { setFreeItems([]); return; }
    fetch(`/api/class-kit/passages?textbook=${encodeURIComponent(freeTb)}&limit=500`, { credentials: 'include' }).then((r) => r.json())
      .then((d) => setFreeItems(Array.isArray(d.items) ? d.items : [])).catch(() => setFreeItems([]));
  }, [freeTb]);

  /* ── 작업 공간 진입 / 스튜디오 로드·저장 ── */
  const loadStudio = useCallback(async (passageId: string) => {
    setWpLoading(true);
    try {
      const d = await fetch(`/api/my/vip/studio?passageId=${passageId}`, { credentials: 'include' }).then((r) => r.json());
      setMarks(d.ok ? (d.studio?.marks ?? []) : []);
      setProblems(d.ok ? (d.studio?.problems ?? []) : []);
      setBank(d.ok ? (d.bank ?? null) : null);
    } catch { setMarks([]); setProblems([]); setBank(null); } finally { setWpLoading(false); }
  }, []);

  const openPassage = useCallback((w: Workspace) => {
    setWp(w); setPf({ ...BLANK_PF }); setEditingId(null); setSavedAt(null);
    void loadStudio(w.passageId);
  }, [loadStudio]);

  const persist = useCallback(async (nextMarks: Mark[], nextProblems: Problem[]) => {
    if (!wp) return;
    try {
      const d = await fetch(`/api/my/vip/studio?passageId=${wp.passageId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ marks: nextMarks, problems: nextProblems, textbook: wp.textbook, sourceKey: wp.sourceKey, source: wp.source, examType: wp.examType }),
      }).then((r) => r.json());
      if (d.ok) { setBank(d.bank ?? null); setSavedAt(new Date().toLocaleTimeString('ko-KR')); }
    } catch { /* 무시 */ }
  }, [wp]);

  const updateMarks = (next: Mark[]) => { setMarks(next); void persist(next, problems); };
  const updateProblems = (next: Problem[]) => { setProblems(next); void persist(marks, next); };

  /* 일반 지문 불러오기 → 작업 공간 */
  const loadFreePassage = async (id: string, sourceKey: string) => {
    setFreeBusy(true);
    try {
      const d = await fetch(`/api/class-kit/passages/${id}`, { credentials: 'include' }).then((r) => r.json());
      const original = String(d.item?.content?.original ?? '').replace(/\s+/g, ' ').trim();
      if (!original) { alert('이 지문의 원문을 찾지 못했습니다.'); return; }
      openPassage({ passageId: id, sourceKey: sourceKey || '지문', textbook: freeTb, source: [freeTb, sourceKey].filter(Boolean).join(' · '), examType: '', original });
    } catch { alert('지문 불러오기에 실패했습니다.'); } finally { setFreeBusy(false); }
  };

  /* 딥링크 (?examId=&key=) — 필기 사진 '지문 분석' 진입 */
  const [deepLink] = useState<{ examId: string; key: string } | null>(() => {
    if (typeof window === 'undefined') return null;
    const sp = new URLSearchParams(window.location.search);
    const examId = sp.get('examId');
    return examId ? { examId, key: sp.get('key') || '' } : null;
  });
  const [deepLinkDone, setDeepLinkDone] = useState(false);
  useEffect(() => {
    if (!deepLink || deepLinkDone) return;
    setTab('scope');
    if (selectedExamId !== deepLink.examId) { setSelectedExamId(deepLink.examId); return; }
    if (!deepLink.key) { setDeepLinkDone(true); return; }
    if (!scopeLoading && scopePassages.length > 0) {
      const p = scopePassages.find((x) => x.key === deepLink.key);
      if (p && p.original) openPassage({ passageId: p.passageId, sourceKey: p.sourceKey, textbook: p.textbook, source: [p.textbook, p.sourceKey].filter(Boolean).join(' · '), examType: scopeMeta?.examType ?? '', original: p.original, examId: deepLink.examId, key: p.key });
      setDeepLinkDone(true);
    }
  }, [deepLink, deepLinkDone, selectedExamId, scopePassages, scopeLoading, scopeMeta, openPassage]);

  const scopeGroups = useMemo(() => {
    const byTb: { textbook: string; items: ScopePassage[] }[] = [];
    for (const p of scopePassages) {
      let g = byTb.find((x) => x.textbook === p.textbook);
      if (!g) { g = { textbook: p.textbook, items: [] }; byTb.push(g); }
      g.items.push(p);
    }
    return byTb;
  }, [scopePassages]);

  const madeCount = problems.length;
  const verifiedCount = problems.filter((p) => p.status === '검수완료').length;
  const grammarMarkCount = marks.filter((m) => m.qTypes.includes('어법')).length;  // 어법 출제 포인트 수 — 밑줄 ①~⑤(5개 이상)이어야 어법 문제 가능

  /* 원문 텍스트만(거터 카드 제외) — 클릭=단어 / 드래그=단어경계로 스냅한 구·문장 → 출제 포인트 추가 */
  const addMarkFromOriginal = useCallback((e: { target: EventTarget | null }) => {
    const text = textRef.current;
    if (!text || !wp) return;
    const lc = wp.original.toLowerCase();
    const add = (scope: Mark['scope'], target: string, start: number, end: number) => {
      const t = target.trim(); if (!t) return;
      // 같은 '위치' 중복만 방지 — 같은 단어라도 다른 위치면 별개 출제 포인트로 허용(레거시는 첫 등장 위치로 환산해 비교)
      if (marks.some((m) => { const r = markRange(m, wp.original, lc); return r ? Math.abs(r.start - start) < 1 : false; })) return;
      updateMarks([...marks, { scope, target: t, qTypes: [], note: '', start, end }]);
    };
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (sel && !sel.isCollapsed && sel.toString().trim()) {
      const range = sel.getRangeAt(0);
      // 본문 텍스트 영역 안의 선택만 (거터 카드 라벨 등은 무시)
      if (text.contains(range.commonAncestorContainer)) {
        // 선택이 걸친 단어 토큰을 모두 포함 → 단어 중간에서 끊기지 않게 스냅
        const tokens = Array.from(text.querySelectorAll<HTMLElement>('span[data-word]'));
        const hit = tokens.filter((tok) => { try { return range.intersectsNode(tok); } catch { return false; } });
        sel.removeAllRanges();
        if (hit.length > 0) {
          const startC = Number(hit[0].dataset.start || 0);
          const lastEl = hit[hit.length - 1];
          const endC = Number(lastEl.dataset.start || 0) + (lastEl.textContent?.length || 0);
          const raw = wp.original.slice(startC, endC).replace(/\s+/g, ' ').trim();
          const words = hit.length;
          const endsSentence = /[.!?]$/.test(raw);
          const scope: Mark['scope'] = words <= 1 ? 'word' : (words >= 6 || (endsSentence && words >= 4)) ? 'sentence' : 'phrase';
          add(scope, scope === 'sentence' ? raw : raw.replace(/[.,;:]+$/, ''), startC, endC);
        }
        return;
      }
    }
    const el = e.target as HTMLElement | null;
    if (el && text.contains(el)) {
      const word = el.getAttribute?.('data-word');
      const startC = Number(el.getAttribute?.('data-start') ?? -1);
      if (word && startC >= 0) add('word', word, startC, startC + (el.textContent?.length || word.length));
    }
  }, [marks, wp]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 단어 위치 측정 → 왼쪽 거터 카드 top(겹치면 아래로 쌓음) + 점선 연결 좌표 */
  const [resizeTick, setResizeTick] = useState(0);
  useEffect(() => {
    const f = () => setResizeTick((t) => t + 1);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || !wp) { setMarkPos([]); return; }
    const lc = wp.original.toLowerCase();
    const tokens = Array.from(content.querySelectorAll<HTMLElement>('span[data-start]'));
    const raw = marks.map((m, key) => {
      const start = markRange(m, wp.original, lc)?.start ?? -1;  // 하이라이트와 동일 위치(고정 start 우선)
      let tok: HTMLElement | undefined;
      if (start >= 0) tok = tokens.find((el) => { const s = Number(el.dataset.start || 0); return s <= start && start < s + (el.textContent?.length || 0); });
      return { key, wordTop: tok ? tok.offsetTop : -1, wordLeft: tok ? tok.offsetLeft : 0, wordH: tok ? tok.offsetHeight : 18 };
    });
    raw.sort((a, b) => a.wordTop - b.wordTop);
    let lastBottom = -Infinity;
    const out = raw.map((r) => { const cardTop = Math.max(r.wordTop < 0 ? 0 : r.wordTop, lastBottom + 6); lastBottom = cardTop + STUDIO_CARD_H; return { ...r, cardTop }; });
    setMarkPos(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, wp, leftPct, resizeTick, focusMode]);

  /* 시험범위 지문이면 학생 필기 사진 로드 (byPassage[교재::sourceKey]) */
  useEffect(() => {
    if (!wp?.examId || !wp?.key) { setPassagePhotos([]); return; }
    let alive = true;
    fetch(`/api/my/vip/school-exams/${wp.examId}/question-photos`, { credentials: 'include' }).then((r) => r.json())
      .then((d) => { if (alive) setPassagePhotos(d.ok && d.byPassage ? (d.byPassage[wp.key as string] ?? []) : []); })
      .catch(() => { if (alive) setPassagePhotos([]); });
    return () => { alive = false; };
  }, [wp?.examId, wp?.key]);

  /* 필기 사진 확대/축소 뷰어 */
  useEffect(() => { if (photoViewer) { setZoom(1); setPan({ x: 0, y: 0 }); } }, [photoViewer]);
  useEffect(() => {
    if (!photoViewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPhotoViewer(null);
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(8, z + 0.25));
      else if (e.key === '-') setZoom((z) => Math.max(0.3, z - 0.25));
      else if (e.key === '0') { setZoom(1); setPan({ x: 0, y: 0 }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photoViewer]);
  /* 집중 모드 — Esc 로 해제(사진 뷰어·상세팝업 안 떠 있을 때만) */
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !photoViewer && markEditor === null) setFocusMode(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusMode, photoViewer, markEditor]);
  const zoomBy = (d: number) => setZoom((z) => Math.min(8, Math.max(0.3, +(z + d).toFixed(2))));
  const onViewerWheel = (e: { deltaY: number }) => zoomBy(e.deltaY < 0 ? 0.2 : -0.2);
  const onPanDown = (e: { clientX: number; clientY: number }) => { panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; };
  const onPanMove = (e: { clientX: number; clientY: number }) => { const s = panStart.current; if (!s) return; setPan({ x: s.px + (e.clientX - s.x), y: s.py + (e.clientY - s.y) }); };
  const onPanUp = () => { panStart.current = null; };

  /* 원문↔편집 분할 바 드래그 */
  const startDrag = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const el = paneRef.current; if (!el) return;
    const onMove = (ev: globalThis.MouseEvent) => {
      const r = el.getBoundingClientRect();
      const pct = ((ev.clientX - r.left) / r.width) * 100;
      setLeftPct(Math.max(25, Math.min(70, pct)));
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp); document.body.style.userSelect = 'none';
  };

  /* 편집/추가 시 우측 칼럼을 맨 위로 — sticky 폼이 원문 상단과 같은 선에 보이도록 */
  const scrollToForm = () => { setTimeout(() => rightColRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 60); };

  /* ── 문제 작성 폼 ── */
  const submitProblem = () => {
    // 마커형(어법·어휘·삽입·무관)·영작은 별도 보기 입력란이 없으므로 직렬화하지 않음(이전 유형의 잔여 보기 저장 방지)
    const optionsStr = (MARKER_TYPES.includes(pf.type) || ESSAY_TYPES.includes(pf.type)) ? '' : buildOpts(pf.opts);
    if (!pf.paragraph.trim() && !optionsStr.trim() && !pf.answer.trim()) { alert('본문·보기·정답 중 하나는 입력하세요.'); return; }
    const data = { type: pf.type, question: pf.question, paragraph: pf.paragraph, options: optionsStr, answer: pf.answer, explanation: pf.explanation };
    if (editingId) {
      updateProblems(problems.map((p) => (p.id === editingId ? { ...p, ...data } : p)));
      setEditingId(null);
    } else {
      const np: Problem = { id: `p_${Date.now()}_${Math.floor(problems.length)}`, ...data, status: '제작완료', createdAt: new Date().toISOString() };
      updateProblems([...problems, np]);
    }
    setPf({ ...BLANK_PF, type: pf.type });
    scrollToForm();
  };
  const editProblem = (p: Problem) => { setEditingId(p.id); setPf({ type: p.type, question: p.question, paragraph: p.paragraph, opts: parseOpts(p.options), answer: p.answer, explanation: p.explanation }); scrollToForm(); };
  const toggleStatus = (id: string) => updateProblems(problems.map((p) => (p.id === id ? { ...p, status: p.status === '검수완료' ? '제작완료' : '검수완료' } : p)));
  const deleteProblem = (id: string) => { if (confirm('이 문제를 삭제할까요?')) { updateProblems(problems.filter((p) => p.id !== id)); if (editingId === id) { setEditingId(null); setPf({ ...BLANK_PF }); } } };

  /* ═══════════════ 브라우저(지문 선택) ═══════════════ */
  if (!wp) {
    const gradeExams = exams.filter((e) => grade === 0 || e.grade === grade)
      .sort((a, b) => b.academicYear - a.academicYear || a.grade - b.grade || a.examType.localeCompare(b.examType));
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">출제 스튜디오</h1>
          <p className="text-sm text-zinc-500 mt-0.5">한 지문에 집중해 <span className="text-amber-300/80">📌 출제 포인트</span>를 짚고 <span className="text-amber-300/80">변형문제</span>를 직접 만드는 공간이에요.</p>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-zinc-900/60 border border-zinc-800/70 p-0.5 text-xs w-fit">
          <button onClick={() => setTab('scope')} className={`px-3.5 py-1.5 rounded-md font-medium transition-colors ${tab === 'scope' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>시험범위에서</button>
          <button onClick={() => setTab('free')} className={`px-3.5 py-1.5 rounded-md font-medium transition-colors ${tab === 'free' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>일반 지문</button>
        </div>

        {tab === 'scope' ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">학교</label>
                <select value={selectedSchool} onChange={(e) => { setSelectedSchool(e.target.value); setSelectedExamId(''); }} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none [&>option]:bg-zinc-900">
                  <option value="">학교 선택</option>
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">학년</label>
                <div className="flex gap-1">
                  <button onClick={() => setGrade(0)} className={`flex-1 py-2 text-sm rounded-xl border font-medium transition-colors ${grade === 0 ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-500 hover:text-zinc-300'}`}>전체</button>
                  {GRADES.map((g) => <button key={g} onClick={() => setGrade(g)} className={`flex-1 py-2 text-sm rounded-xl border font-medium transition-colors ${grade === g ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-500 hover:text-zinc-300'}`}>{g}학년</button>)}
                </div>
              </div>
            </div>

            {!selectedSchool ? (
              <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-10 text-center text-sm text-zinc-600">학교를 선택하면 시험(중간·기말 등) 목록이 떠요.</div>
            ) : gradeExams.length === 0 ? (
              <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-10 text-center text-sm text-zinc-600">해당 학년의 시험이 없습니다. <a href="/my/vip/exams" className="text-violet-400 hover:text-violet-300 underline">시험 준비</a>에서 먼저 등록하세요.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {gradeExams.map((e) => {
                  const sel = e.id === selectedExamId;
                  return (
                    <button key={e.id} onClick={() => setSelectedExamId(sel ? '' : e.id)} className={`rounded-xl border px-3.5 py-2.5 text-left transition-colors ${sel ? 'border-[#c9a44e] bg-[#c9a44e]/10' : 'border-zinc-800/80 bg-zinc-900/50 hover:border-zinc-600'}`}>
                      <div className="text-sm font-semibold text-zinc-100">{e.academicYear}년 {e.grade}학년 · {e.examType}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">시험범위 지문 {e.examScopePassages?.length ?? 0}개</div>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedExamId && (
              scopeLoading ? (
                <div className="p-10 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
              ) : scopePassages.length === 0 ? (
                <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-10 text-center text-sm text-zinc-600">이 시험은 시험범위 지문(소스)이 설정돼 있지 않습니다.</div>
              ) : (
                <div className="space-y-4">
                  <div className="text-xs text-zinc-500">시험범위 지문 {scopePassages.length}개 · 지문을 눌러 출제 시작</div>
                  {scopeGroups.map((g) => (
                    <div key={g.textbook || '_'} className="rounded-xl bg-zinc-900/40 border border-zinc-800/80 overflow-hidden">
                      {g.textbook && <div className="px-4 pt-3 pb-1 text-[11px] text-zinc-400 truncate" title={g.textbook}>{g.textbook}</div>}
                      <div className="divide-y divide-zinc-800/50">
                        {g.items.map((p) => {
                          const opened = openText[p.key];
                          return (
                            <div key={p.key} className="p-4 flex items-start gap-3">
                              <div className="w-20 flex-shrink-0">
                                <div className="text-[10px] text-zinc-500 mb-0.5">지문</div>
                                <div className="font-bold text-zinc-200 text-sm break-keep leading-tight">{p.sourceKey}</div>
                              </div>
                              <div className="flex-1 min-w-0">
                                {p.original ? <p className={`text-xs text-zinc-400 leading-relaxed ${opened ? '' : 'line-clamp-2'}`}>{p.original}</p> : <p className="text-xs text-zinc-600">원문을 찾지 못했습니다.</p>}
                                {p.original && p.original.length > 120 && <button onClick={() => setOpenText((o) => ({ ...o, [p.key]: !o[p.key] }))} className="mt-1 text-[10px] text-zinc-500 hover:text-zinc-300">{opened ? '접기 ▲' : '원문 펼치기 ▼'}</button>}
                              </div>
                              <button onClick={() => openPassage({ passageId: p.passageId, sourceKey: p.sourceKey, textbook: p.textbook, source: [p.textbook, p.sourceKey].filter(Boolean).join(' · '), examType: scopeMeta?.examType ?? '', original: p.original, examId: selectedExamId, key: p.key })} disabled={!p.original}
                                className="shrink-0 rounded-lg bg-[#c9a44e] px-3 py-2 text-xs font-bold text-zinc-900 hover:bg-[#d8b65f] disabled:opacity-40">출제 시작</button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">교재(모의고사)</label>
                <select value={freeTb} onChange={(e) => setFreeTb(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none [&>option]:bg-zinc-900">
                  <option value="">교재 선택</option>
                  {tbs.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            {!freeTb ? (
              <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-10 text-center text-sm text-zinc-600">교재를 선택하면 지문 목록이 떠요. (회원은 모의고사 지문)</div>
            ) : freeItems.length === 0 ? (
              <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-10 text-center text-sm text-zinc-600">지문이 없습니다.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {freeItems.map((it) => (
                  <button key={it._id} onClick={() => void loadFreePassage(it._id, it.source_key || '')} disabled={freeBusy} className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 px-3 py-2 text-xs font-medium text-zinc-200 hover:border-[#c9a44e] disabled:opacity-50">{it.source_key || it._id.slice(-6)}</button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  /* ═══════════════ 작업 공간 (좌: 원문 · 우: 출제) ═══════════════ */
  /* 작성/수정 폼 — 편집 중엔 해당 문제 바로 아래, 아니면 맨 아래에 렌더 (단일 인스턴스) */
  const isMarker = MARKER_TYPES.includes(pf.type);   // 보기 = 본문 ①~⑤
  const isEssay = ESSAY_TYPES.includes(pf.type);     // 모범답안
  const isEtc = pf.type === '기타';
  const multiAnswer = MULTI_ANSWER_TYPES.includes(pf.type);
  const toggleAns = (c: string) => setPf((p) => {
    const has = p.answer.includes(c);
    if (!multiAnswer) return { ...p, answer: has ? '' : c };  // 단일정답: 토글
    return { ...p, answer: CIRCLED.filter((x) => (x === c ? !has : p.answer.includes(x))).join('') };  // 복수정답: ①~⑤ 순 누적
  });
  const editorForm = wp ? (
    <div ref={formRef} className={`rounded-2xl bg-zinc-900/50 border p-4 space-y-2 ${editingId ? 'border-[#c9a44e]/60' : 'border-zinc-800/80'}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-zinc-100">{editingId ? '✏️ 문제 수정' : '➕ 새 변형문제'}</span>
        <div className="flex items-center gap-2">
          <select value={pf.type} onChange={(e) => {
            const type = e.target.value;
            setPf((p) => {
              const next = { ...p, type };
              // 발문: 비었거나 '이전 유형의 자동 발문'이면 새 유형 기본값으로 교체(직접 입력한 발문은 보존)
              if (!p.question.trim() || DEFAULT_QUESTION_SET.has(p.question.trim())) next.question = DEFAULT_QUESTION[type] ?? '';
              // 순서 보기: 들어가면 비었을 때 자동채움, 나가면 '손대지 않은 자동값'만 비움
              const wasOrderAuto = p.opts.join('|') === ORDER_OPTS_DEFAULT.join('|');
              if (type === '순서') { if (p.opts.every((o) => !o.trim())) next.opts = [...ORDER_OPTS_DEFAULT]; }
              else if (wasOrderAuto) next.opts = ['', '', '', '', ''];
              return next;
            });
          }} className="rounded-lg bg-zinc-900 border border-zinc-800/70 px-2 py-1.5 text-xs text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none">
            {QTYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={() => setPf({ ...pf, paragraph: wp.original })} className="rounded-lg border border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800" title="원문을 본문에 채우고 변형하세요">원문 채우기</button>
        </div>
      </div>
      <input value={pf.question} onChange={(e) => setPf({ ...pf, question: e.target.value })} placeholder="발문 (예: 다음 글의 빈칸에 들어갈 …) — 선택" className="w-full rounded-lg bg-zinc-950/50 border border-zinc-800/60 px-2.5 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/40" />
      <textarea value={pf.paragraph} onChange={(e) => setPf({ ...pf, paragraph: e.target.value })} rows={5} placeholder="문제 본문 (원문을 변형해 작성 — 「원문 채우기」로 불러오기)" className="w-full rounded-lg bg-zinc-950/50 border border-zinc-800/60 px-2.5 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/40" />
      {/* 보기 — 유형별 */}
      {isEssay ? (
        <textarea value={pf.answer} onChange={(e) => setPf({ ...pf, answer: e.target.value })} rows={3}
          placeholder="모범답안 (영작·서술형 정답 문장)"
          className="w-full rounded-lg bg-zinc-950/50 border border-emerald-900/50 px-2.5 py-2 text-sm text-emerald-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50" />
      ) : isMarker ? (
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-2.5 py-2 text-[11px] leading-relaxed text-zinc-500">
          ✏️ <b className="text-zinc-300">{pf.type}</b> — {markerHint(pf.type)}
        </div>
      ) : (
        <div className="space-y-1.5">
          {pf.opts.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-4 shrink-0 text-center text-sm text-zinc-400">{CIRCLED[i]}</span>
              <input value={o} onChange={(e) => setPf({ ...pf, opts: pf.opts.map((x, j) => (j === i ? e.target.value : x)) })} placeholder={optHint(pf.type, i)} className="flex-1 rounded-lg bg-zinc-950/50 border border-zinc-800/60 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/40" />
            </div>
          ))}
        </div>
      )}
      {/* 정답 — 영작 외엔 ①~⑤ 버튼(기타는 자유 입력) */}
      {!isEssay && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-[11px] text-zinc-500">정답{multiAnswer ? ' (복수 가능)' : ''}</span>
          {isEtc ? (
            <input value={pf.answer} onChange={(e) => setPf({ ...pf, answer: e.target.value })} placeholder="정답" className="w-40 rounded-lg bg-zinc-950/50 border border-zinc-800/60 px-2.5 py-1.5 text-sm text-emerald-200 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/40" />
          ) : (
            <div className="flex gap-1">
              {CIRCLED.map((c) => (
                <button key={c} type="button" onClick={() => toggleAns(c)}
                  className={`h-7 w-7 rounded-lg border text-sm transition ${pf.answer.includes(c) ? 'border-emerald-500 bg-emerald-600/30 text-emerald-200' : 'border-zinc-800/70 text-zinc-500 hover:border-zinc-600'}`}>{c}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <input value={pf.explanation} onChange={(e) => setPf({ ...pf, explanation: e.target.value })} placeholder={isEssay ? '채점 기준·해설 (선택)' : '해설 (선택)'} className="w-full rounded-lg bg-zinc-950/50 border border-zinc-800/60 px-2.5 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/40" />
      <div className="flex justify-end gap-2">
        {editingId && <button onClick={() => { setEditingId(null); setPf({ ...BLANK_PF }); }} className="rounded-lg px-3 py-2 text-xs font-bold text-zinc-400 hover:text-zinc-200">취소</button>}
        <button onClick={submitProblem} className="rounded-lg bg-[#c9a44e] px-4 py-2 text-xs font-bold text-zinc-900 hover:bg-[#d8b65f]">{editingId ? '수정 저장' : '문제 추가'}</button>
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-4 pb-10 lg:pb-0 lg:space-y-3 lg:h-[calc(100vh-5rem)] lg:flex lg:flex-col lg:overflow-hidden">
      {/* 상단바 — 좌: 금색 타이틀 · 우: 현황 + 지문 목록 */}
      <div className="flex items-center justify-between gap-3 flex-wrap lg:shrink-0">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#f0dd97] to-[#c9a44e] shadow-[0_2px_10px_rgba(201,164,78,0.45)]">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L9.9 5.9L14.5 6.4L11 9.6L12 14.2L8 11.9L4 14.2L5 9.6L1.5 6.4L6.1 5.9L8 1.5Z" fill="#1a1400" fillOpacity="0.85" /></svg>
          </span>
          <span className="text-base lg:text-lg font-extrabold tracking-tight bg-gradient-to-r from-[#f6ecc2] via-[#d8b75f] to-[#c9a44e] bg-clip-text text-transparent drop-shadow-[0_1px_4px_rgba(201,164,78,0.35)]">출제 스튜디오</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-zinc-400 flex-wrap">
          <span className="rounded bg-zinc-800/70 px-2 py-1">문제 <b className="text-zinc-100">{madeCount}</b></span>
          <span className="rounded bg-zinc-800/70 px-2 py-1">제작완료 <b className="text-amber-300">{madeCount - verifiedCount}</b></span>
          <span className="rounded bg-emerald-900/30 px-2 py-1">검수완료 <b className="text-emerald-300">{verifiedCount}</b></span>
          {bank && <span className="rounded bg-sky-900/30 px-2 py-1" title="기존 변형 DB(이 지문)">기존 변형 <b className="text-sky-300">{bank.total}</b><span className="text-zinc-500"> (완료 {bank.완료})</span></span>}
          {savedAt && <span className="text-zinc-600">저장됨 {savedAt}</span>}
          <button onClick={() => { setWp(null); }} className="ml-1 inline-flex items-center gap-1 rounded-lg border border-zinc-700/80 px-2.5 py-1 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100" title="지문 목록으로">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" /></svg>
            지문 목록
          </button>
        </div>
      </div>

      <div ref={paneRef} className="flex flex-col gap-4 lg:grid lg:gap-0 lg:flex-1 lg:min-h-0 lg:overflow-hidden" style={{ gridTemplateColumns: focusMode ? '1fr' : `${leftPct}% 12px minmax(0,1fr)` }}>
        {/* 좌: 원문 + 왼쪽 거터 출제 포인트(점선 연결) + 하단 학생 필기 사진 */}
        <div className="lg:h-full lg:min-h-0 lg:flex lg:flex-col lg:gap-2 lg:overflow-hidden lg:pr-1">
          <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/80 overflow-hidden lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
            <div className="px-4 py-2.5 border-b border-zinc-800/70 flex items-center justify-between gap-2 lg:shrink-0">
              <span className="text-sm font-bold text-zinc-100 truncate" title={wp.source}>{wp.examType ? `${wp.examType} · ` : ''}{wp.sourceKey}</span>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${grammarMarkCount >= 5 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}
                  title={grammarMarkCount >= 5 ? `어법 출제 가능 — 밑줄 ${grammarMarkCount}개(①~⑤ 5개 이상)` : `어법 문제는 밑줄 ①~⑤ 5개 이상이 필요해요 (현재 ${grammarMarkCount}개 — ${5 - grammarMarkCount}개 더)`}>
                  어법 {grammarMarkCount}/5{grammarMarkCount >= 5 ? ' ✓' : ''}
                </span>
                <span className="text-[10px] text-amber-300/80" title="단어 클릭 / 드래그(구·문장)로 출제 포인트 추가">📌 {marks.length} · 단어클릭·드래그</span>
                <button onClick={async () => {
                  const cmd = `npm run cc:studio -- passage --id ${wp.passageId}`;
                  try { await navigator.clipboard.writeText(cmd); setCliCopied(true); setTimeout(() => setCliCopied(false), 1800); }
                  catch { window.prompt('아래 명령을 복사해 Claude Code 채팅/터미널에 붙여넣으세요:', cmd); }
                }} title={`cc:studio CLI 명령 복사 — Claude Code 채팅이나 터미널에 붙여넣어 이 지문 출제 포인트를 AI와 함께 잡으세요.\n\nnpm run cc:studio -- passage --id ${wp.passageId}`}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${cliCopied ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-zinc-700 text-zinc-300 hover:border-sky-500/70 hover:text-sky-300'}`}>
                  {cliCopied ? (
                    <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>복사됨</>
                  ) : (
                    <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v14H4z M8 10l2.5 2.5L8 15 M13.5 15H17" /></svg>CLI 명령</>
                  )}
                </button>
                <button onClick={() => setFocusMode((v) => !v)} title={focusMode ? '집중 모드 해제 (Esc) — 편집 패널 다시 열기' : '집중 모드 — 원문을 크게 키워 출제 포인트에만 집중'}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${focusMode ? 'border-[#c9a44e] bg-[#c9a44e]/20 text-[#e6c878]' : 'border-zinc-700 text-zinc-300 hover:border-[#c9a44e]/70 hover:text-[#e6c878]'}`}>
                  {focusMode ? (
                    <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 9L4 4m0 0v4m0-4h4m6 6l5 5m0 0v-4m0 4h-4M9 15l-5 5m0 0v-4m0 4h4m6-6l5-5m0 0v4m0-4h-4" /></svg>축소</>
                  ) : (
                    <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>확대</>
                  )}
                </button>
              </div>
            </div>
            <div ref={origRef} onMouseUp={addMarkFromOriginal} className="relative max-h-[50vh] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto scrollbar-thin">
              <div ref={contentRef} className={`relative py-3 pr-4 leading-relaxed text-zinc-300 whitespace-pre-wrap select-text ${focusMode ? 'text-[19px] leading-loose' : 'text-[13px]'}`} style={{ paddingLeft: STUDIO_GUTTER + 12 }}>
                {/* 점선 연결선 (카드 → 단어) */}
                <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
                  {markPos.filter((p) => p.wordTop >= 0 && marks[p.key]).map((p) => (
                    <polyline key={p.key} points={`${STUDIO_GUTTER - 12},${p.cardTop + 15} ${STUDIO_GUTTER + 2},${p.cardTop + 15} ${p.wordLeft - 2},${p.wordTop + p.wordH / 2}`} fill="none" stroke="#c9a44e" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="3 3" />
                  ))}
                </svg>
                {/* 왼쪽 거터 출제 포인트 카드 */}
                {markPos.map((p) => {
                  const m = marks[p.key]; if (!m) return null;
                  return (
                    <div key={p.key} className="absolute left-1.5 z-10" style={{ top: p.cardTop, width: STUDIO_GUTTER - 16 }}>
                      <div onDoubleClick={() => setMarkEditor(p.key)} title="더블클릭 → 상세 메모" className="rounded-lg border border-amber-700/40 bg-zinc-900/95 px-1.5 py-1 shadow-lg shadow-black/40 transition-colors hover:border-amber-600/70">
                        <div className="mb-0.5 flex items-center gap-1">
                          <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">{SCOPE_LABEL[m.scope]}</span>
                          <span className="flex-1 truncate text-[10px] text-zinc-200" title={m.target}>{m.target || '(대상)'}</span>
                          {m.note && <span className="text-[9px] text-amber-400/70" title={m.note}>📝</span>}
                          <button onClick={() => updateMarks(marks.filter((_, j) => j !== p.key))} onDoubleClick={(e) => e.stopPropagation()} title="삭제" className="text-[11px] leading-none text-zinc-600 hover:text-rose-400">✕</button>
                        </div>
                        <div className="flex flex-wrap items-center gap-0.5">
                          {m.qTypes.map((qt) => (
                            <button key={qt} onClick={() => updateMarks(marks.map((x, j) => (j === p.key ? { ...x, qTypes: x.qTypes.filter((y) => y !== qt) } : x)))} onDoubleClick={(e) => e.stopPropagation()} title="클릭해 제거" className="inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] text-amber-200 hover:bg-rose-500/20 hover:text-rose-300">{qt}<span className="text-amber-400/60">✕</span></button>
                          ))}
                          <select value="" onChange={(e) => { const v = e.target.value; if (v) updateMarks(marks.map((x, j) => (j === p.key ? { ...x, qTypes: [...x.qTypes, v] } : x))); }} onDoubleClick={(e) => e.stopPropagation()} title="예상 유형 추가(복수 가능)" className="rounded border border-zinc-800/70 bg-zinc-950 px-0.5 py-0.5 text-[10px] text-amber-200/90 [&>option]:bg-zinc-900 focus:outline-none">
                            <option value="">{m.qTypes.length ? '＋' : '유형＋'}</option>
                            {QTYPES.filter((t) => !m.qTypes.includes(t)).map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <input value={m.note} onChange={(e) => updateMarks(marks.map((x, j) => (j === p.key ? { ...x, note: e.target.value } : x)))} onDoubleClick={(e) => e.stopPropagation()} placeholder="메모(더블클릭=상세)" className="mt-0.5 w-full min-w-0 rounded border border-zinc-800/70 bg-zinc-950 px-1 py-0.5 text-[10px] text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-[#c9a44e]/40" />
                      </div>
                    </div>
                  );
                })}
                {/* 본문 (텍스트만 — 선택/클릭 대상) */}
                <div ref={textRef}>{renderOriginal(wp.original, marks)}</div>
                {marks.length === 0 && <span className="pointer-events-none absolute left-2 top-3 text-[10px] leading-tight text-zinc-600" style={{ width: STUDIO_GUTTER - 16 }}>단어 클릭·드래그하면 여기에 출제 포인트가 생겨요 →</span>}
              </div>
            </div>
          </div>

          {/* 학생 필기 사진 (시험범위 지문) — 원문 하단, 클릭 시 확대/축소 */}
          {passagePhotos.length > 0 && (
            <div className="lg:shrink-0 rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-2 lg:max-h-[26vh] overflow-y-auto scrollbar-thin">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
                <span className="font-semibold text-amber-300/80">📝 학생 필기 ({passagePhotos.length})</span>
                <span className="text-zinc-600">· 클릭하면 확대/축소</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {passagePhotos.map((ph) => (ph.url ? (
                  <button key={ph.id} onClick={() => setPhotoViewer(ph)} title={`${ph.name} — 클릭해 확대`} className="group relative shrink-0">
                    <img src={ph.url} alt={ph.name} className="h-24 w-24 rounded-lg border border-zinc-700 object-cover transition-colors group-hover:border-[#c9a44e]" />
                    <span className="absolute inset-0 flex items-center justify-center rounded-lg text-base text-transparent transition group-hover:bg-black/40 group-hover:text-white">🔍</span>
                  </button>
                ) : (
                  <div key={ph.id} className="grid h-24 w-24 shrink-0 place-items-center rounded-lg border border-zinc-700 bg-zinc-800 text-center text-[10px] text-zinc-500">미리보기<br />불가</div>
                )))}
              </div>
            </div>
          )}
        </div>

        {!focusMode && (<>
        {/* 분할 바 — 드래그로 좌우 너비 조절 */}
        <div onMouseDown={startDrag} className="hidden lg:flex items-stretch justify-center cursor-col-resize group" title="드래그해 원문·편집 너비 조절">
          <div className="w-1 rounded-full bg-zinc-800 group-hover:bg-[#c9a44e]/70 transition-colors" />
        </div>

        {/* 우: 작성/수정 폼(맨 위 고정·원문 상단과 정렬) + 문제 목록(아래 스크롤) */}
        <div ref={rightColRef} className="space-y-3 min-w-0 lg:pl-1 lg:h-full lg:min-h-0 lg:overflow-y-auto scrollbar-thin">
          {/* 폼 — sticky 상단 (원문 위쪽과 항상 같은 선) */}
          <div className="lg:sticky lg:top-0 lg:z-20 bg-[#09090b] lg:pb-2">
            {editorForm}
          </div>

          {/* 문제 목록 — 클릭하면 위 폼에서 편집 */}
          {wpLoading ? (
            <div className="p-8 text-center"><div className="w-5 h-5 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
          ) : problems.length === 0 ? (
            <div className="rounded-2xl bg-zinc-900/40 border border-zinc-800/80 p-6 text-center text-xs text-zinc-600">아직 만든 문제가 없어요. 위 폼에서 첫 변형문제를 추가하세요.</div>
          ) : (
            <div className="space-y-2">
              {problems.map((p, idx) => (
                <div key={p.id} onClick={() => { if (editingId !== p.id) editProblem(p); }} title="클릭해 편집"
                  className={`cursor-pointer rounded-2xl border p-3 transition-colors ${editingId === p.id ? 'border-[#c9a44e] ring-1 ring-[#c9a44e]/40 bg-[#c9a44e]/5' : p.status === '검수완료' ? 'border-emerald-700/50 bg-emerald-900/10 hover:border-emerald-500/70' : 'border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-600'}`}>
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-[11px] font-mono text-zinc-600">#{idx + 1}</span>
                    <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 text-[10px]">{p.type || '유형?'}</span>
                    <button onClick={(e) => { e.stopPropagation(); toggleStatus(p.id); }} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${p.status === '검수완료' ? 'bg-emerald-600/80 text-white' : 'bg-amber-500/20 text-amber-300'}`} title="클릭해 제작완료↔검수완료">{p.status}</button>
                    {p.answer && <span className="max-w-[220px] truncate text-[10px] text-emerald-400/80">{ESSAY_TYPES.includes(p.type) ? '모범답안' : '정답'} {p.answer}</span>}
                    {editingId === p.id && <span className="text-[10px] text-[#d8b75f]">위에서 편집 중</span>}
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-[10px] text-zinc-600">클릭해 편집</span>
                      <button onClick={(e) => { e.stopPropagation(); deleteProblem(p.id); }} className="px-1.5 py-0.5 text-[10px] text-zinc-600 hover:text-rose-400">삭제</button>
                    </span>
                  </div>
                  {p.question && <p className="text-xs text-zinc-300 mb-1">{p.question}</p>}
                  {p.paragraph && <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-3 whitespace-pre-wrap">{p.paragraph}</p>}
                  {p.options && <p className="mt-1 text-[11px] text-zinc-400 whitespace-pre-wrap">{p.options.split(/\s*###\s*/).join('\n')}</p>}
                  {p.explanation && <p className="mt-1 text-[11px] text-zinc-600 line-clamp-2">해설: {p.explanation}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
        </>)}
      </div>

      {/* 출제 포인트 상세 메모 팝업 (거터 카드 더블클릭) */}
      {markEditor !== null && marks[markEditor] && (() => {
        const i = markEditor;
        const m = marks[i];
        const upd = (patch: Partial<Mark>) => updateMarks(marks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60" onClick={() => setMarkEditor(null)} />
            <div className="relative w-[460px] max-w-[94vw] space-y-3 rounded-2xl border border-amber-700/50 bg-zinc-900 p-4 shadow-2xl">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-amber-300/90">📌 출제 포인트 상세</span>
                <button onClick={() => setMarkEditor(null)} className="text-zinc-500 hover:text-zinc-200">✕</button>
              </div>
              <div className="flex gap-2">
                <select value={m.scope} onChange={(e) => upd({ scope: e.target.value as Mark['scope'] })} className="rounded-lg border border-zinc-800/70 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 [&>option]:bg-zinc-900 focus:outline-none">
                  {(['word', 'phrase', 'sentence'] as Mark['scope'][]).map((sc) => <option key={sc} value={sc}>{SCOPE_LABEL[sc]}</option>)}
                </select>
                <input value={m.target} onChange={(e) => upd({ target: e.target.value })} placeholder="대상(원문 표현)" className="flex-1 rounded-lg border border-zinc-800/70 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
              </div>
              <div>
                <div className="mb-1 text-[11px] text-zinc-500">예상 유형 <span className="text-zinc-600">· 복수 선택 가능 (예: 역접 But → 순서·삽입)</span></div>
                <div className="flex flex-wrap gap-1">
                  {QTYPES.map((t) => {
                    const on = m.qTypes.includes(t);
                    return (
                      <button key={t} type="button" onClick={() => upd({ qTypes: on ? m.qTypes.filter((x) => x !== t) : [...m.qTypes, t] })}
                        className={`rounded-lg border px-2 py-1 text-xs transition ${on ? 'border-amber-500 bg-amber-500/20 text-amber-200' : 'border-zinc-800/70 text-zinc-400 hover:border-zinc-600'}`}>{t}</button>
                    );
                  })}
                </div>
              </div>
              <textarea value={m.note} onChange={(e) => upd({ note: e.target.value })} rows={7} autoFocus placeholder="상세 메모 — 함정·근거·출제 의도·변형 아이디어 등 자유롭게 적어두세요" className="w-full rounded-lg border border-zinc-800/70 bg-zinc-950 px-3 py-2 text-sm leading-relaxed text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
              <div className="flex items-center justify-between">
                <button onClick={() => { updateMarks(marks.filter((_, j) => j !== i)); setMarkEditor(null); }} className="rounded-lg px-3 py-1.5 text-xs font-bold text-rose-400/80 hover:bg-rose-500/10 hover:text-rose-300">삭제</button>
                <button onClick={() => setMarkEditor(null)} className="rounded-lg bg-[#c9a44e] px-4 py-1.5 text-xs font-bold text-zinc-900 hover:bg-[#d8b65f]">완료</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 학생 필기 사진 확대/축소 뷰어 */}
      {photoViewer && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/85" onMouseUp={onPanUp} onMouseLeave={onPanUp}>
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
            <span className="truncate text-xs text-zinc-300" title={photoViewer.name}>📝 {photoViewer.name}</span>
            <div className="flex items-center gap-1 text-zinc-200">
              <button onClick={() => zoomBy(-0.25)} className="grid h-7 w-7 place-items-center rounded-lg border border-white/15 hover:bg-white/10" title="축소 (−)">−</button>
              <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
              <button onClick={() => zoomBy(0.25)} className="grid h-7 w-7 place-items-center rounded-lg border border-white/15 hover:bg-white/10" title="확대 (+)">＋</button>
              <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="ml-1 rounded-lg border border-white/15 px-2 py-1 text-[11px] hover:bg-white/10" title="원래 크기 (0)">100%</button>
              <button onClick={() => setPhotoViewer(null)} className="ml-1 grid h-7 w-7 place-items-center rounded-lg border border-white/15 hover:bg-white/10" title="닫기 (Esc)">✕</button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden flex items-center justify-center" onWheel={onViewerWheel} onMouseDown={onPanDown} onMouseMove={onPanMove}>
            {photoViewer.url
              ? <img src={photoViewer.url} alt={photoViewer.name} draggable={false} onMouseDown={(e) => e.preventDefault()} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: zoom > 1 ? (panStart.current ? 'grabbing' : 'grab') : 'default' }} className="max-h-full max-w-full select-none" />
              : <span className="text-sm text-zinc-400">미리보기를 불러올 수 없습니다.</span>}
          </div>
          <div className="px-4 py-1.5 text-center text-[10px] text-zinc-500">휠/＋−로 확대·축소 · 드래그로 이동 · Esc 닫기</div>
        </div>
      )}
    </div>
  );
}
