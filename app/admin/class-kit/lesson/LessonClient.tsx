'use client';

/**
 * 수업용자료 — "한 지문 = 한 화면" 수업용 자료 (페이퍼릭 마젠타 톤).
 * 영어 원문(좌) + 한국어 해석(우) 2단. 강의용자료와 동일한 편집 UI.
 * (DB 저장 없음 — 그때그때 지문을 골라 띄우는 용도.)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import PassagePickerModal, { PassageItem } from '../../_components/PassagePickerModal';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import {
  buildLessonMaterialHtml,
  clampLineHeight,
  clampSplitPct,
  clampFontScale,
  normalizeLessonMode,
  normalizeLineLayout,
  normalizeEnFont,
  normalizeKoFont,
  lessonModeIsLandscape,
  LESSON_MODE_LABELS,
  EN_FONT_OPTIONS,
  KO_FONT_OPTIONS,
  type LessonSentencePair,
  type LessonMode,
  type LineLayout,
  type EnFontKey,
  type KoFontKey,
} from '@/lib/lesson-material-html';
import ClassKitTabs from '../ClassKitTabs';

const TITLE_KEY = 'class_kit_lesson_title';
const NUMBER_KEY = 'class_kit_lesson_number';
const LINE_HEIGHT_KEY = 'class_kit_lesson_line_height';
const SPLIT_KEY = 'class_kit_lesson_split';
const MODE_KEY = 'class_kit_lesson_mode';
const LINE_LAYOUT_KEY = 'class_kit_lesson_line_layout';
const EN_FONT_KEY = 'class_kit_lesson_en_font';
const KO_FONT_KEY = 'class_kit_lesson_ko_font';
const FONT_SCALE_KEY = 'class_kit_lesson_font_scale';
const LAST_PASSAGE_KEY = 'class_kit_lesson_last_passage_id';
const DEFAULT_LINE_HEIGHT = 2.6;
const DEFAULT_SPLIT = 60;
const DEFAULT_FONT_SCALE = 1.0;

/** passage.number 에서 숫자만 추출 (없으면 원문 그대로). */
function deriveNumber(raw?: string): string {
  const s = (raw ?? '').trim();
  const m = s.match(/\d+/);
  return m ? m[0] : s;
}

/** passage.content 로 영어 문장 배열 (sentences_en 우선, 없으면 original split). */
function enSentencesOf(item: PassageItem | null): string[] {
  if (!item?.content) return [];
  return tokenizePassageFromContent(item.content).map(s => s.text);
}

export default function LessonClient({ forcedMode }: { forcedMode?: LessonMode }) {
  const [passage, setPassage] = useState<PassageItem | null>(null);
  const [pairs, setPairs] = useState<LessonSentencePair[]>([]);
  // 카테고리(kicker)는 현재 유형 라벨을 따라감 (한줄해석/영작하기/해석쓰기 …)
  const [kicker, setKicker] = useState(LESSON_MODE_LABELS[forcedMode ?? 'parallel']);
  const [title, setTitle] = useState('');
  const [number, setNumber] = useState('');
  const [lineHeight, setLineHeight] = useState(DEFAULT_LINE_HEIGHT);
  const [splitPct, setSplitPct] = useState(DEFAULT_SPLIT);
  const [mode, setMode] = useState<LessonMode>(forcedMode ?? 'parallel');
  const [lineLayout, setLineLayout] = useState<LineLayout>('stack');
  const [enFont, setEnFont] = useState<EnFontKey>('sans');
  const [koFont, setKoFont] = useState<KoFontKey>('pen');
  const [fontScale, setFontScale] = useState(DEFAULT_FONT_SCALE);
  const [showPicker, setShowPicker] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [defaultLineHeight, setDefaultLineHeight] = useState(DEFAULT_LINE_HEIGHT);
  const [lhSaved, setLhSaved] = useState(false);
  const [siblings, setSiblings] = useState<PassageItem[]>([]);
  const [siblingsTextbook, setSiblingsTextbook] = useState('');
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  const persist = (key: string, v: string) => {
    try { localStorage.setItem(key, v); } catch { /* ignore */ }
  };

  /** 한국어 해석(/korean) 까지 합쳐 영/한 문장 쌍을 만든다. */
  const loadPairs = async (item: PassageItem) => {
    let en = enSentencesOf(item);
    let ko: string[] = [];
    try {
      const r = await fetch(`/api/admin/passages/${encodeURIComponent(item._id)}/korean`, { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        const rEn = Array.isArray(d.sentences_en) ? (d.sentences_en as string[]) : [];
        const rKo = Array.isArray(d.sentences_ko) ? (d.sentences_ko as string[]) : [];
        if (rEn.length) en = rEn;
        ko = rKo;
      }
    } catch {
      /* ignore */
    }
    setPairs(en.map((t, i) => ({ idx: i, en: t, ko: (ko[i] ?? '').trim() })));
  };

  // localStorage 복원 + 마지막 지문 자동 불러오기
  useEffect(() => {
    try {
      const t = localStorage.getItem(TITLE_KEY);
      if (t !== null) setTitle(t);
      const n = localStorage.getItem(NUMBER_KEY);
      if (n !== null) setNumber(n);
      const lh = localStorage.getItem(LINE_HEIGHT_KEY);
      if (lh !== null) {
        const v = clampLineHeight(parseFloat(lh));
        setDefaultLineHeight(v);
        setLineHeight(v);
      }
      const sp = localStorage.getItem(SPLIT_KEY);
      if (sp !== null) setSplitPct(clampSplitPct(parseInt(sp, 10)));
      const ll = localStorage.getItem(LINE_LAYOUT_KEY);
      if (ll !== null) setLineLayout(normalizeLineLayout(ll));
      const ef = localStorage.getItem(EN_FONT_KEY);
      if (ef !== null) setEnFont(normalizeEnFont(ef));
      const kf = localStorage.getItem(KO_FONT_KEY);
      if (kf !== null) setKoFont(normalizeKoFont(kf));
      const fsz = localStorage.getItem(FONT_SCALE_KEY);
      if (fsz !== null) setFontScale(clampFontScale(parseFloat(fsz)));
      // 강제 모드(하위 경로)면 localStorage 모드보다 우선. 카테고리는 유형 라벨을 따름.
      const effMode = forcedMode ?? normalizeLessonMode(localStorage.getItem(MODE_KEY));
      setMode(effMode);
      setKicker(LESSON_MODE_LABELS[effMode]);
      const pid = localStorage.getItem(LAST_PASSAGE_KEY);
      if (pid) {
        fetch(`/api/admin/passages/${encodeURIComponent(pid)}`, { credentials: 'include' })
          .then(r => (r.ok ? r.json() : null))
          .then(d => {
            if (d?.item) {
              const item = d.item as PassageItem;
              setPassage(item);
              void loadPairs(item);
            }
          })
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 현재 지문의 교재가 바뀌면 그 교재의 지문 목록(좌우 이동용)을 불러옴
  useEffect(() => {
    const tb = passage?.textbook;
    if (!tb || tb === siblingsTextbook) return;
    let cancelled = false;
    fetch(`/api/admin/passages?textbook=${encodeURIComponent(tb)}&limit=500`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return;
        setSiblings(Array.isArray(d.items) ? (d.items as PassageItem[]) : []);
        setSiblingsTextbook(tb);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [passage?.textbook, siblingsTextbook]);

  const curIndex = useMemo(
    () => (passage ? siblings.findIndex(s => s._id === passage._id) : -1),
    [siblings, passage],
  );
  const hasPrev = curIndex > 0;
  const hasNext = curIndex >= 0 && curIndex < siblings.length - 1;

  const koCount = useMemo(() => pairs.filter(p => (p.ko ?? '').trim()).length, [pairs]);

  const isLandscape = lessonModeIsLandscape(mode);

  const previewHtml = useMemo(
    () => buildLessonMaterialHtml({ kicker, title, number, sentences: pairs, lineHeight, splitPct, lineLayout, enFont, koFont, fontScale, mode }),
    [kicker, title, number, pairs, lineHeight, splitPct, lineLayout, enFont, koFont, fontScale, mode],
  );

  const filenameBase = useMemo(() => {
    const label = LESSON_MODE_LABELS[mode];
    const parts = [...(label !== '수업용자료' ? [label] : []), title.trim(), number.trim()]
      .filter(Boolean)
      .map(s => s.replace(/[\\/:*?"<>|]/g, '_'));
    return ['수업용자료', ...parts].join('_');
  }, [mode, title, number]);

  const handlePick = (p: PassageItem) => {
    setPassage(p);
    setShowPicker(false);
    try { localStorage.setItem(LAST_PASSAGE_KEY, p._id); } catch { /* ignore */ }
    setTitle(prev => {
      if (prev.trim()) return prev;
      persist(TITLE_KEY, p.textbook);
      return p.textbook;
    });
    const num = deriveNumber(p.number);
    setNumber(num);
    persist(NUMBER_KEY, num);
    setLineHeight(defaultLineHeight);
    void loadPairs(p);
    const cnt = enSentencesOf(p).length;
    setMsg(`📂 ${p.chapter} · ${p.number} 불러옴 — ${cnt}문장`);
    setTimeout(() => setMsg(''), 3000);
  };

  const goSibling = (dir: -1 | 1) => {
    if (curIndex < 0) return;
    const ni = curIndex + dir;
    if (ni < 0 || ni >= siblings.length) return;
    handlePick(siblings[ni]);
  };

  const updKicker = (v: string) => setKicker(v); // 카테고리는 유형 라벨 자동 — 임시 수정만
  const updTitle = (v: string) => { setTitle(v); persist(TITLE_KEY, v); };
  const updNumber = (v: string) => { setNumber(v); persist(NUMBER_KEY, v); };
  const updLineHeight = (v: number) => setLineHeight(clampLineHeight(v));
  const updSplit = (v: number) => {
    const sp = clampSplitPct(v);
    setSplitPct(sp);
    persist(SPLIT_KEY, String(sp));
  };
  const updLineLayout = (l: LineLayout) => { setLineLayout(l); persist(LINE_LAYOUT_KEY, l); };
  const updEnFont = (f: EnFontKey) => { setEnFont(f); persist(EN_FONT_KEY, f); };
  const updKoFont = (f: KoFontKey) => { setKoFont(f); persist(KO_FONT_KEY, f); };
  const updFontScale = (v: number) => { const s = clampFontScale(v); setFontScale(s); persist(FONT_SCALE_KEY, String(s)); };
  // 유형 전환 시 카테고리(kicker)도 해당 유형 라벨로 자동 갱신
  const updMode = (m: LessonMode) => { setMode(m); persist(MODE_KEY, m); setKicker(LESSON_MODE_LABELS[m]); };
  const saveLineHeightDefault = () => {
    const v = clampLineHeight(lineHeight);
    setDefaultLineHeight(v);
    persist(LINE_HEIGHT_KEY, String(v));
    setLhSaved(true);
    setTimeout(() => setLhSaved(false), 2000);
  };

  const downloadPdf = async () => {
    if (!pairs.length || pdfBusy) return;
    setPdfBusy(true);
    try {
      const res = await fetch('/api/admin/class-kit/lesson-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kicker, title, number, mode, lineHeight, splitPct, lineLayout, enFont, koFont, fontScale, sentences: pairs.map(p => ({ en: p.en, ko: p.ko })) }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(`PDF 생성 실패: ${d?.error || res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filenameBase}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('PDF 생성 중 오류가 발생했습니다.');
    } finally {
      setPdfBusy(false);
    }
  };

  const openInNewTab = () => {
    if (!pairs.length) return;
    const blob = new Blob([previewHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) { alert('팝업이 차단되어 새 창을 열 수 없습니다.'); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const printPreview = () => {
    if (!pairs.length) return;
    const iframeDoc = previewIframeRef.current?.contentDocument;
    const html = iframeDoc ? '<!DOCTYPE html>' + iframeDoc.documentElement.outerHTML : previewHtml;
    const w = window.open('', '_blank');
    if (!w) { alert('팝업이 차단되어 인쇄 창을 열 수 없습니다.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 400);
  };

  return (
    <div className="flex flex-col h-svh">
      {/* 상단 바 */}
      <header className="shrink-0 border-b border-slate-700 px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-bold text-white mr-2">클래스키트</h1>
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
          >
            지문 불러오기
          </button>
          {passage && (
            <>
              {/* 이전/다음 지문 이동 */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => goSibling(-1)}
                  disabled={!hasPrev}
                  title="이전 지문"
                  aria-label="이전 지문"
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-base leading-none transition-colors"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => goSibling(1)}
                  disabled={!hasNext}
                  title="다음 지문"
                  aria-label="다음 지문"
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-base leading-none transition-colors"
                >
                  ›
                </button>
              </div>
              <span className="text-xs text-slate-400">
                <span className="font-mono bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">{passage.chapter} · {passage.number}</span>
                {passage.source_key && <span className="text-emerald-400 ml-2">{passage.source_key}</span>}
                <span className="text-slate-500 ml-2">{pairs.length}문장</span>
                {pairs.length > 0 && (
                  <span className={`ml-2 ${koCount === pairs.length ? 'text-emerald-400' : 'text-amber-400'}`}>
                    해석 {koCount}/{pairs.length}
                  </span>
                )}
                {curIndex >= 0 && siblings.length > 0 && (
                  <span className="text-slate-600 ml-2 tabular-nums">{curIndex + 1}/{siblings.length}</span>
                )}
              </span>
            </>
          )}
          {msg && <span className="text-xs text-emerald-300">{msg}</span>}

          <div className="flex-1" />

          <button
            type="button"
            onClick={openInNewTab}
            disabled={!pairs.length}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-base transition-colors"
            title="새 창에서 열기 (프로젝터·전자칠판 전체 화면)"
            aria-label="새 창에서 열기"
          >
            🖥️
          </button>
          <button
            type="button"
            onClick={downloadPdf}
            disabled={!pairs.length || pdfBusy}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-rose-700 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-base transition-colors"
            title={pdfBusy ? 'PDF 생성 중…' : 'PDF 다운로드'}
            aria-label="PDF 다운로드"
          >
            {pdfBusy ? '⏳' : '📄'}
          </button>
          <button
            type="button"
            onClick={printPreview}
            disabled={!pairs.length}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-base transition-colors"
            title="인쇄"
            aria-label="인쇄"
          >
            🖨️
          </button>
        </div>

        {/* 유형 탭 (강의용자료 포함) */}
        <div className="mt-3">
          <ClassKitTabs current={mode} onSelectLessonMode={updMode} />
        </div>
      </header>

      {/* 본문: 미리보기 + 오른쪽 설정 바 */}
      <div className="flex-1 min-h-0 flex">
        {/* 미리보기 */}
        <div className="flex-1 min-w-0 overflow-auto bg-slate-900/60 p-6 scrollbar-thin">
          {pairs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500">
              <p className="text-sm">불러온 지문이 없습니다.</p>
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="mt-3 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
              >
                지문 불러오기
              </button>
            </div>
          ) : isLandscape ? (
            // 영한대조 = A4 가로 비율(297:210) 한 화면
            <div className="mx-auto w-full max-w-[1100px] bg-white rounded-lg shadow-xl overflow-hidden" style={{ aspectRatio: '297 / 210' }}>
              <iframe
                ref={previewIframeRef}
                srcDoc={previewHtml}
                title="수업용자료 미리보기"
                className="w-full h-full bg-white"
                style={{ border: 'none' }}
              />
            </div>
          ) : (
            // 세로 워크시트 = A4 세로 폭, 길면 스크롤(다중 페이지)
            <div className="mx-auto w-full max-w-[820px] bg-white rounded-lg shadow-xl overflow-hidden">
              <iframe
                ref={previewIframeRef}
                srcDoc={previewHtml}
                title="수업용자료 미리보기"
                className="w-full bg-white"
                style={{ height: '80vh', border: 'none' }}
              />
            </div>
          )}
        </div>

        {/* 오른쪽 설정 바 (항상 표시 · 바로 편집) */}
        <aside className="w-72 shrink-0 border-l border-slate-700 bg-slate-800/40 overflow-y-auto scrollbar-thin">
          <div className="p-4 space-y-5">
            <h2 className="text-sm font-bold text-white">설정</h2>

            {/* 헤더 입력값 */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">카테고리</label>
                <input
                  value={kicker}
                  onChange={e => updKicker(e.target.value)}
                  placeholder="수업용자료"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">시험정보</label>
                <input
                  value={title}
                  onChange={e => updTitle(e.target.value)}
                  placeholder="예: 26년 고3 5월 영어모의고사"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">문항번호</label>
                <input
                  value={number}
                  onChange={e => updNumber(e.target.value)}
                  placeholder="18"
                  className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-500"
                />
              </div>
            </div>

            {/* 글씨체 & 글자 크기 */}
            <div className="border-t border-slate-700 pt-4 space-y-3">
              <span className="text-sm font-semibold text-white">글씨체</span>
              <div>
                <label className="block text-xs text-slate-500 mb-1">영어 글씨체</label>
                <select
                  value={enFont}
                  onChange={e => updEnFont(e.target.value as EnFontKey)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-slate-500"
                >
                  {EN_FONT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">한글 글씨체</label>
                <select
                  value={koFont}
                  onChange={e => updKoFont(e.target.value as KoFontKey)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-slate-500"
                >
                  {KO_FONT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500">글자 크기</span>
                  <span className="text-xs font-mono text-emerald-300 tabular-nums">{Math.round(fontScale * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.7}
                  max={1.6}
                  step={0.05}
                  value={fontScale}
                  onChange={e => updFontScale(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500"
                />
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>작게 70%</span>
                  <span>기본 100%</span>
                  <span>크게 160%</span>
                </div>
                {fontScale !== DEFAULT_FONT_SCALE && (
                  <button
                    type="button"
                    onClick={() => updFontScale(DEFAULT_FONT_SCALE)}
                    className="mt-2 w-full px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium transition-colors"
                  >
                    100%로 초기화
                  </button>
                )}
              </div>
            </div>

            {/* 한줄해석 레이아웃: 위아래 / 좌우 */}
            {mode === 'lineByLine' && (
            <div className="border-t border-slate-700 pt-4">
              <span className="text-sm font-semibold text-white">해석 배치</span>
              <div className="mt-2 flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => updLineLayout('stack')}
                  className={`flex-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${lineLayout === 'stack' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  위아래
                </button>
                <button
                  type="button"
                  onClick={() => updLineLayout('side')}
                  className={`flex-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${lineLayout === 'side' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  좌우
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500">위아래: 영어 아래에 해석 · 좌우: 영어 왼쪽 / 해석 오른쪽</p>
            </div>
            )}

            {/* 줄 간격 — 한줄해석엔 미적용 */}
            {mode !== 'lineByLine' && (
            <div className="border-t border-slate-700 pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white">줄 간격 <span className="text-xs font-normal text-slate-500">{mode === 'parallel' ? '(영어 · 판서)' : '(작성 줄 높이)'}</span></span>
                <span className="text-xs font-mono text-emerald-300 tabular-nums">{lineHeight.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={1.4}
                max={3.6}
                step={0.1}
                value={lineHeight}
                onChange={e => updLineHeight(parseFloat(e.target.value))}
                className="w-full accent-emerald-500"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                <span>좁게 1.4</span>
                <span>기본 2.6</span>
                <span>넓게 3.6</span>
              </div>

              <div className="mt-3 flex items-center justify-between text-[11px]">
                <span className="text-slate-500">
                  저장된 디폴트 <span className="font-mono text-slate-300 tabular-nums">{defaultLineHeight.toFixed(1)}</span>
                </span>
                {lineHeight !== defaultLineHeight && (
                  <span className="text-amber-400">미저장</span>
                )}
              </div>
              <button
                type="button"
                onClick={saveLineHeightDefault}
                disabled={lineHeight === defaultLineHeight}
                className="mt-2 w-full px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
                title="현재 줄 간격을 디폴트로 저장 — 다른 지문을 불러오면 이 값으로 적용됩니다"
              >
                {lhSaved ? '✓ 디폴트로 저장됨' : '현재 값을 디폴트로 저장'}
              </button>
              <button
                type="button"
                onClick={() => updLineHeight(DEFAULT_LINE_HEIGHT)}
                className="mt-2 w-full px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium transition-colors"
              >
                2.6으로 초기화
              </button>
            </div>
            )}

            {/* 구분선 위치 — 영한대조만 */}
            {isLandscape && (
            <div className="border-t border-slate-700 pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white">구분선 위치 <span className="text-xs font-normal text-slate-500">(영어 폭)</span></span>
                <span className="text-xs font-mono text-emerald-300 tabular-nums">{splitPct}%</span>
              </div>
              <input
                type="range"
                min={30}
                max={75}
                step={1}
                value={splitPct}
                onChange={e => updSplit(parseInt(e.target.value, 10))}
                className="w-full accent-emerald-500"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                <span>← 한국어 넓게</span>
                <span>영어 넓게 →</span>
              </div>
              <button
                type="button"
                onClick={() => updSplit(DEFAULT_SPLIT)}
                className="mt-2 w-full px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium transition-colors"
              >
                기본(60%)으로
              </button>
            </div>
            )}
          </div>
        </aside>
      </div>

      {showPicker && (
        <PassagePickerModal
          onSelect={handlePick}
          onClose={() => setShowPicker(false)}
          lastTextbookKey="class_kit_lesson_last_textbook"
          showCounts={false}
        />
      )}
    </div>
  );
}
