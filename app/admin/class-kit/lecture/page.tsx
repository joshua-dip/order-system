'use client';

/**
 * 강의용자료 — "한 지문 = 한 화면" 강의/판서용 자료 (gangui_kit 톤).
 * 지문을 불러와 페이퍼릭 그린 헤더 + 문장번호 단락으로 미리보기 →
 * 새 창(프로젝터/전자칠판) 또는 인쇄.
 * (DB 저장 없음 — 그때그때 지문을 골라 띄우는 용도.)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import PassagePickerModal, { PassageItem } from '../../_components/PassagePickerModal';
import ClassKitTabs from '../ClassKitTabs';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import { buildLectureMaterialHtml, clampLineHeight } from '@/lib/lecture-material-html';

const KICKER_KEY = 'class_kit_lecture_kicker';
const TITLE_KEY = 'class_kit_lecture_title';
const NUMBER_KEY = 'class_kit_lecture_number';
const LINE_HEIGHT_KEY = 'class_kit_lecture_line_height';
const LAST_PASSAGE_KEY = 'class_kit_lecture_last_passage_id';
const DEFAULT_LINE_HEIGHT = 2.6;

/** passage.number 에서 워터마크용 숫자만 추출 (없으면 원문 그대로). */
function deriveNumber(raw?: string): string {
  const s = (raw ?? '').trim();
  const m = s.match(/\d+/);
  return m ? m[0] : s;
}

export default function ClassKitLecturePage() {
  const [passage, setPassage] = useState<PassageItem | null>(null);
  const [kicker, setKicker] = useState('강의용자료');
  const [title, setTitle] = useState('');
  const [number, setNumber] = useState('');
  const [lineHeight, setLineHeight] = useState(DEFAULT_LINE_HEIGHT);
  const [showPicker, setShowPicker] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<'' | 'pdf' | 'zip'>('');
  const [msg, setMsg] = useState('');
  /** 저장된 디폴트 줄 간격 — 새 지문을 불러오면 이 값으로 적용. */
  const [defaultLineHeight, setDefaultLineHeight] = useState(DEFAULT_LINE_HEIGHT);
  const [lhSaved, setLhSaved] = useState(false);
  /** 같은 교재의 지문 목록 — 좌우 화살표로 이전/다음 지문 이동. */
  const [siblings, setSiblings] = useState<PassageItem[]>([]);
  const [siblingsTextbook, setSiblingsTextbook] = useState('');
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  // localStorage 복원 + 마지막 지문 자동 불러오기
  useEffect(() => {
    try {
      const k = localStorage.getItem(KICKER_KEY);
      if (k !== null) setKicker(k);
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
      const pid = localStorage.getItem(LAST_PASSAGE_KEY);
      if (pid) {
        fetch(`/api/admin/passages/${encodeURIComponent(pid)}`, { credentials: 'include' })
          .then(r => (r.ok ? r.json() : null))
          .then(d => { if (d?.item) setPassage(d.item as PassageItem); })
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
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

  const sentences = useMemo(() => {
    if (!passage?.content) return [];
    return tokenizePassageFromContent(passage.content).map(s => ({ idx: s.idx, text: s.text }));
  }, [passage]);

  const curIndex = useMemo(
    () => (passage ? siblings.findIndex(s => s._id === passage._id) : -1),
    [siblings, passage],
  );
  const hasPrev = curIndex > 0;
  const hasNext = curIndex >= 0 && curIndex < siblings.length - 1;

  const previewHtml = useMemo(
    () => buildLectureMaterialHtml({ kicker, title, number, sentences, lineHeight }),
    [kicker, title, number, sentences, lineHeight],
  );

  const filenameBase = useMemo(() => {
    const parts = [title.trim(), number.trim()]
      .filter(Boolean)
      .map(s => s.replace(/[\\/:*?"<>|]/g, '_'));
    const body = parts.join('_');
    return body ? `강의용자료_${body}` : '강의용자료';
  }, [title, number]);

  const persist = (key: string, v: string) => {
    try { localStorage.setItem(key, v); } catch { /* ignore */ }
  };

  const handlePick = (p: PassageItem) => {
    setPassage(p);
    setShowPicker(false);
    try { localStorage.setItem(LAST_PASSAGE_KEY, p._id); } catch { /* ignore */ }
    // 시험정보(title) 비어 있으면 교재명으로 채움 / 문항번호는 지문 번호로 갱신
    setTitle(prev => {
      if (prev.trim()) return prev;
      persist(TITLE_KEY, p.textbook);
      return p.textbook;
    });
    const num = deriveNumber(p.number);
    setNumber(num);
    persist(NUMBER_KEY, num);
    // 새 지문은 저장된 디폴트 줄 간격으로 적용
    setLineHeight(defaultLineHeight);
    const cnt = tokenizePassageFromContent(p.content).length;
    setMsg(`📂 ${p.chapter} · ${p.number} 불러옴 — ${cnt}문장`);
    setTimeout(() => setMsg(''), 3000);
  };

  /** 같은 교재 내 이전(-1)/다음(+1) 지문으로 이동. */
  const goSibling = (dir: -1 | 1) => {
    if (curIndex < 0) return;
    const ni = curIndex + dir;
    if (ni < 0 || ni >= siblings.length) return;
    handlePick(siblings[ni]);
  };

  const updKicker = (v: string) => { setKicker(v); persist(KICKER_KEY, v); };
  const updTitle = (v: string) => { setTitle(v); persist(TITLE_KEY, v); };
  const updNumber = (v: string) => { setNumber(v); persist(NUMBER_KEY, v); };
  // 슬라이더는 현재(미리보기) 값만 변경 — 디폴트는 「디폴트로 저장」을 눌러야 갱신
  const updLineHeight = (v: number) => setLineHeight(clampLineHeight(v));
  const saveLineHeightDefault = () => {
    const v = clampLineHeight(lineHeight);
    setDefaultLineHeight(v);
    persist(LINE_HEIGHT_KEY, String(v));
    setLhSaved(true);
    setTimeout(() => setLhSaved(false), 2000);
  };

  const downloadPdf = async () => {
    if (!sentences.length || pdfBusy) return;
    setPdfBusy(true);
    try {
      const res = await fetch('/api/admin/class-kit/lecture-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kicker, title, number, lineHeight, sentences: sentences.map(s => s.text) }),
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

  /** 현재 지문의 교재 전체를 한 번에 다운로드. mode='pdf' = 다 페이지 단일 PDF / 'zip' = 번호별 PDF zip. */
  const downloadBulk = async (mode: 'pdf' | 'zip') => {
    const tb = passage?.textbook;
    if (!tb || bulkBusy) return;
    setBulkBusy(mode);
    try {
      const res = await fetch('/api/admin/class-kit/lecture-pdf-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ textbook: tb, kicker, lineHeight, format: mode }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(`교재 전체 ${mode === 'pdf' ? 'PDF' : 'ZIP'} 생성 실패: ${d?.error || res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safe = tb.replace(/[\\/:*?"<>|]/g, '_');
      const date = new Date().toISOString().slice(0, 10);
      a.download = `강의용자료_${safe}_${date}.${mode === 'pdf' ? 'pdf' : 'zip'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('교재 전체 다운로드 중 오류가 발생했습니다.');
    } finally {
      setBulkBusy('');
    }
  };

  const openInNewTab = () => {
    if (!sentences.length) return;
    const blob = new Blob([previewHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) { alert('팝업이 차단되어 새 창을 열 수 없습니다.'); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const printPreview = () => {
    if (!sentences.length) return;
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
                <span className="text-slate-500 ml-2">{sentences.length}문장</span>
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
            disabled={!sentences.length}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-base transition-colors"
            title="새 창에서 열기 (프로젝터·전자칠판 전체 화면)"
            aria-label="새 창에서 열기"
          >
            🖥️
          </button>
          <button
            type="button"
            onClick={downloadPdf}
            disabled={!sentences.length || pdfBusy}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-rose-700 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-base transition-colors"
            title={pdfBusy ? 'PDF 생성 중…' : 'PDF 다운로드 (현재 지문 1장)'}
            aria-label="PDF 다운로드"
          >
            {pdfBusy ? '⏳' : '📄'}
          </button>
          <button
            type="button"
            onClick={() => downloadBulk('pdf')}
            disabled={!passage || !!bulkBusy}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-rose-800 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-base transition-colors"
            title={
              bulkBusy === 'pdf'
                ? '교재 전체 PDF 생성 중…'
                : '교재 전체 PDF (지문마다 1페이지, 다 페이지 단일 파일)'
            }
            aria-label="교재 전체 PDF 다운로드"
          >
            {bulkBusy === 'pdf' ? '⏳' : '📚'}
          </button>
          <button
            type="button"
            onClick={() => downloadBulk('zip')}
            disabled={!passage || !!bulkBusy}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-amber-700 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-base transition-colors"
            title={
              bulkBusy === 'zip'
                ? '교재 전체 ZIP 생성 중…'
                : '교재 전체 ZIP (번호별 개별 PDF 묶음)'
            }
            aria-label="교재 전체 ZIP 다운로드"
          >
            {bulkBusy === 'zip' ? '⏳' : '🗂️'}
          </button>
          <button
            type="button"
            onClick={printPreview}
            disabled={!sentences.length}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-base transition-colors"
            title="인쇄"
            aria-label="인쇄"
          >
            🖨️
          </button>
        </div>

        {/* 유형 탭 (강의용자료 활성) */}
        <div className="mt-3">
          <ClassKitTabs current="lecture" />
        </div>
      </header>

      {/* 본문: 미리보기 + 오른쪽 설정 바 */}
      <div className="flex-1 min-h-0 flex">
        {/* 미리보기 */}
        <div className="flex-1 min-w-0 overflow-auto bg-slate-900/60 p-6 scrollbar-thin">
          {sentences.length === 0 ? (
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
          ) : (
            <div className="mx-auto max-w-[900px] bg-white rounded-lg shadow-xl overflow-hidden">
              <iframe
                ref={previewIframeRef}
                srcDoc={previewHtml}
                title="강의용자료 미리보기"
                className="w-full bg-white"
                style={{ height: '78vh', border: 'none' }}
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
                  placeholder="강의용자료"
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
                <label className="block text-xs text-slate-500 mb-1">문항번호 (워터마크)</label>
                <input
                  value={number}
                  onChange={e => updNumber(e.target.value)}
                  placeholder="21"
                  className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-500"
                />
              </div>
            </div>

            {/* 줄 간격 */}
            <div className="border-t border-slate-700 pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white">줄 간격 <span className="text-xs font-normal text-slate-500">(판서 공간)</span></span>
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

              {/* 디폴트 저장 — 새 지문 불러올 때 적용될 값 */}
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
          </div>
        </aside>
      </div>

      {showPicker && (
        <PassagePickerModal
          onSelect={handlePick}
          onClose={() => setShowPicker(false)}
          lastTextbookKey="class_kit_lecture_last_textbook"
          showCounts={false}
        />
      )}
    </div>
  );
}
