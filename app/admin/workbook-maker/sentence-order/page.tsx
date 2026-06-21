'use client';

/**
 * 순서배열 워크북 — 강별 배치 자동 생성기.
 *
 * 흐름:
 *   1. 교재 선택 → 그 교재의 모든 지문(강·번호)을 강별로 묶어 보여줌
 *   2. 강/번호 체크로 포함할 지문 선택 (강 헤더 체크 = 강 전체 토글)
 *   3. 분할 모드 다중 선택 (3분할 / 4~6분할 / 문장별 전체) + 도입 포함
 *      - 선택한 지문 × 선택한 모드마다 자동 분할+셔플로 1문제씩 생성
 *      - 3분할 = 표준 5지선다, 4~6분할 = 문장 수에 맞춰 4~6 자동, 문장별 전체 = 문장마다 1 chunk
 *   4. 미리보기 → 선택한 강만 PDF/Word 다운로드 (학생용 + 답지)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import { PassageItem } from '../../_components/PassagePickerModal';
import {
  ANSWER_TO_DISPLAY,
  buildSentenceOrderCombinedHtml,
  buildSentenceOrderStudentHtml,
  LETTERS,
  randomAnswer,
  randomPermutation,
  SentenceOrderItem,
  splitIntoChunks,
} from '@/lib/sentence-order-workbook';

type ModeKey = 'choice3' | 'mid' | 'all';
interface Modes {
  choice3: boolean;
  mid: boolean;
  all: boolean;
}

/** 한 지문 + 모드 → 자동 생성 item 들. 분할 불가한 모드는 건너뜀. */
function buildItemsForPassage(p: PassageItem, modes: Modes, withIntro: boolean): SentenceOrderItem[] {
  const sents = tokenizePassageFromContent(p.content)
    .map(t => String(t.text ?? '').trim())
    .filter(Boolean);
  const sk = p.source_key || `${p.chapter} ${p.number}`.trim();
  const out: SentenceOrderItem[] = [];
  const push = (count: number, format: 'choice' | 'arrange', tag: string) => {
    const s = splitIntoChunks(sents, count, withIntro);
    if (!s) return;
    const displayOrder = format === 'choice' ? ANSWER_TO_DISPLAY[randomAnswer()] : randomPermutation(count);
    out.push({
      title: `${sk} · ${tag}`,
      textbook: p.textbook,
      sourceKey: sk,
      intro: s.intro,
      chunks: s.chunks,
      displayOrder,
      format,
    });
  };

  // 도입 제외 가용 문장 수
  const introTaken = withIntro && sents.length > 3;
  const available = sents.length - (introTaken ? 1 : 0);

  if (modes.choice3) push(3, 'choice', '3분할');
  if (modes.mid && available >= 4) {
    const count = Math.min(6, Math.max(4, available)); // 문장 수에 맞춰 4~6
    push(count, 'arrange', `${count}분할`);
  }
  if (modes.all) {
    const start = withIntro && sents.length >= 4 ? 1 : 0;
    const count = Math.min(LETTERS.length, sents.length - start);
    if (count >= 3) push(count, 'arrange', `문장별 ${count}분할`);
  }
  return out;
}

export default function SentenceOrderWorkbookPage() {
  const [title, setTitle] = useState('순서배열 워크북');
  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [textbook, setTextbook] = useState('');
  const [allPassages, setAllPassages] = useState<PassageItem[]>([]);
  const [loadingPassages, setLoadingPassages] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [modes, setModes] = useState<Modes>({ choice3: true, mid: false, all: false });
  const [withIntro, setWithIntro] = useState(true);
  const [genSeed, setGenSeed] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');

  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const PREVIEW_BASE_W = 794;
  const PREVIEW_BASE_H = 1100;
  const [previewScale, setPreviewScale] = useState(0.7);

  // 교재 목록
  useEffect(() => {
    fetch('/api/admin/passages/textbooks', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setTextbooks(Array.isArray(d.textbooks) ? d.textbooks : []))
      .catch(() => {});
    try {
      const v = localStorage.getItem('sentence_order_workbook_last_textbook');
      if (v) setTextbook(v);
    } catch { /* ignore */ }
  }, []);

  // 교재 선택 → 지문 목록
  useEffect(() => {
    if (!textbook) { setAllPassages([]); setSelectedIds(new Set()); return; }
    try { localStorage.setItem('sentence_order_workbook_last_textbook', textbook); } catch { /* ignore */ }
    setLoadingPassages(true);
    setSelectedIds(new Set());
    fetch(`/api/admin/passages?textbook=${encodeURIComponent(textbook)}&limit=500`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setAllPassages(Array.isArray(d.items) ? d.items : []))
      .catch(() => setAllPassages([]))
      .finally(() => setLoadingPassages(false));
  }, [textbook]);

  // 강별 그룹
  const chapters = useMemo(() => {
    const map = new Map<string, PassageItem[]>();
    for (const p of allPassages) {
      const c = p.chapter || '(강 없음)';
      if (!map.has(c)) map.set(c, []);
      map.get(c)!.push(p);
    }
    return Array.from(map.entries()).map(([chapter, passages]) => ({ chapter, passages }));
  }, [allPassages]);

  const togglePassage = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleChapter = (passages: PassageItem[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSel = passages.every(p => next.has(p._id));
      for (const p of passages) {
        if (allSel) next.delete(p._id);
        else next.add(p._id);
      }
      return next;
    });
  };
  const toggleCollapse = (chapter: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(chapter)) next.delete(chapter);
      else next.add(chapter);
      return next;
    });
  };
  const selectAll = () => setSelectedIds(new Set(allPassages.map(p => p._id)));
  const clearAll = () => setSelectedIds(new Set());

  const toggleMode = (k: ModeKey) => setModes(m => ({ ...m, [k]: !m[k] }));
  const anyMode = modes.choice3 || modes.mid || modes.all;

  // 생성 — 선택 지문 × 모드 (chapter/number 순서 유지)
  const items = useMemo(() => {
    if (!anyMode || selectedIds.size === 0) return [];
    const sel = allPassages.filter(p => selectedIds.has(p._id));
    const out: SentenceOrderItem[] = [];
    for (const p of sel) out.push(...buildItemsForPassage(p, modes, withIntro));
    void genSeed; // 다시 섞기 트리거
    return out;
  }, [allPassages, selectedIds, modes, withIntro, anyMode, genSeed]);

  const selectedCount = selectedIds.size;
  const skippedNote = useMemo(() => {
    // 선택했는데 모드 조건 미달로 0문제가 된 지문 수
    if (!anyMode || selectedCount === 0) return 0;
    const sel = allPassages.filter(p => selectedIds.has(p._id));
    let zero = 0;
    for (const p of sel) if (buildItemsForPassage(p, modes, withIntro).length === 0) zero++;
    return zero;
  }, [allPassages, selectedIds, modes, withIntro, anyMode, selectedCount]);

  // 미리보기는 앞 6문제만 (다운로드는 전체)
  const previewHtml = useMemo(() => {
    if (items.length === 0) return '';
    return buildSentenceOrderStudentHtml({ title, items: items.slice(0, 6) });
  }, [items, title]);

  const downloadAsDoc = () => {
    if (items.length === 0) return;
    const html = buildSentenceOrderCombinedHtml({ title, items });
    const blob = new Blob([html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'sentence-order'}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadCombinedPdf = () => {
    if (items.length === 0) return;
    const html = buildSentenceOrderCombinedHtml({ title, items });
    const w = window.open('', '_blank');
    if (!w) {
      alert('팝업이 차단되어 PDF 인쇄 창을 열 수 없습니다. 팝업 허용 후 다시 시도하세요.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    const docTitle = `${title} - ${textbook}`;
    try { w.document.title = docTitle; } catch { /* ignore */ }
    w.addEventListener('load', () => {
      try { w.document.title = docTitle; } catch { /* ignore */ }
      try { w.focus(); w.print(); } catch { /* ignore */ }
    });
  };

  const enableEditing = useCallback(() => {
    const doc = previewIframeRef.current?.contentDocument;
    if (!doc) return;
    try { doc.designMode = 'on'; } catch { /* ignore */ }
  }, []);

  const printPreview = () => {
    if (items.length === 0) return;
    const html = buildSentenceOrderCombinedHtml({ title, items });
    const w = window.open('', '_blank');
    if (!w) {
      alert('팝업이 차단되어 인쇄 창을 열 수 없습니다. 팝업 허용 후 다시 시도하세요.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 300);
  };

  const MODE_BTN = (k: ModeKey, label: string, hint: string) => (
    <button
      type="button"
      onClick={() => toggleMode(k)}
      className={`text-xs px-2.5 py-1.5 rounded border ${
        modes[k] ? 'bg-emerald-600 text-white border-emerald-400' : 'border-slate-600 text-slate-300 hover:bg-slate-700/40'
      }`}
      title={hint}
    >
      {modes[k] ? '☑ ' : '☐ '}{label}
    </button>
  );

  return (
    <main className="flex-1 p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-xl font-bold">순서배열 워크북 — 강별 배치 생성</h1>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm w-56"
          placeholder="워크북 제목"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 좌: 교재/강 선택 + 모드 */}
        <section className="space-y-3">
          {/* 분할 모드 */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-slate-400">분할 모드 (복수 선택 — 각각 1문제씩 생성)</label>
              <label className="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer select-none">
                <input type="checkbox" checked={withIntro} onChange={e => setWithIntro(e.target.checked)} className="h-3 w-3 accent-slate-400" />
                도입(주어진 글) 포함
              </label>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {MODE_BTN('choice3', '3분할 (표준 5지선다)', '도입 + (A)(B)(C), 표준 글의 순서 5지선다')}
              {MODE_BTN('mid', '4~6분할', '문장 수에 맞춰 4~6분할, 배열형')}
              {MODE_BTN('all', '문장별 전체', '문장마다 1 chunk, 배열형')}
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              4~6분할은 문장 수에 맞춰 자동(4→4·5→5·6문장↑→6). 문장이 부족한 모드는 해당 지문에서 자동 생략됩니다.
            </p>
          </div>

          {/* 교재 + 강별 지문 선택 */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <select
                value={textbook}
                onChange={e => setTextbook(e.target.value)}
                className="flex-1 min-w-[12rem] bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
              >
                <option value="">교재 선택…</option>
                {textbooks.map(tb => <option key={tb} value={tb}>{tb}</option>)}
              </select>
              {allPassages.length > 0 && (
                <div className="flex items-center gap-1">
                  <button type="button" onClick={selectAll} className="text-[11px] px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/50">전체 선택</button>
                  <button type="button" onClick={clearAll} className="text-[11px] px-2 py-1 rounded border border-slate-600 text-slate-400 hover:bg-slate-700/50">해제</button>
                </div>
              )}
            </div>

            {loadingPassages ? (
              <p className="text-xs text-slate-500 py-6 text-center">불러오는 중…</p>
            ) : !textbook ? (
              <p className="text-xs text-slate-500 py-6 text-center">교재를 먼저 선택하세요.</p>
            ) : chapters.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">지문이 없습니다.</p>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {chapters.map(({ chapter, passages }) => {
                  const selN = passages.filter(p => selectedIds.has(p._id)).length;
                  const allSel = selN === passages.length;
                  const someSel = selN > 0 && !allSel;
                  const isCollapsed = collapsed.has(chapter);
                  return (
                    <div key={chapter} className="border border-slate-700 rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 px-2.5 py-2 bg-slate-900/50">
                        <input
                          type="checkbox"
                          checked={allSel}
                          ref={el => { if (el) el.indeterminate = someSel; }}
                          onChange={() => toggleChapter(passages)}
                          className="h-3.5 w-3.5 accent-emerald-500"
                        />
                        <button type="button" onClick={() => toggleCollapse(chapter)} className="flex-1 flex items-center gap-2 text-left">
                          <span className="text-slate-500 text-[10px]">{isCollapsed ? '▸' : '▾'}</span>
                          <span className="text-sm font-semibold text-slate-200">{chapter}</span>
                          <span className="text-[10px] text-slate-500">{selN}/{passages.length}</span>
                        </button>
                      </div>
                      {!isCollapsed && (
                        <div className="flex flex-wrap gap-1 p-2">
                          {passages.map(p => {
                            const on = selectedIds.has(p._id);
                            return (
                              <button
                                key={p._id}
                                type="button"
                                onClick={() => togglePassage(p._id)}
                                className={`text-[11px] px-2 py-1 rounded border ${
                                  on ? 'bg-emerald-600 text-white border-emerald-400' : 'border-slate-600 text-slate-400 hover:bg-slate-700/40'
                                }`}
                                title={p.content?.original?.slice(0, 120) ?? ''}
                              >
                                {p.number || p.source_key || '?'}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* 우: 미리보기 + 다운로드 */}
        <section className="bg-slate-800 border border-slate-700 rounded-xl flex flex-col overflow-hidden lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)]">
          <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-700 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-bold text-white">미리보기</span>
              <span className="text-[11px] text-slate-400">
                지문 {selectedCount} · 모드 {(['choice3', 'mid', 'all'] as ModeKey[]).filter(k => modes[k]).length} → <span className="text-emerald-300 font-bold">총 {items.length}문제</span>
                {skippedNote > 0 && <span className="text-amber-400/90 ml-1">(문장 부족 {skippedNote}지문 생략)</span>}
                {items.length > 6 && <span className="text-slate-500 ml-1">· 미리보기 6문제</span>}
              </span>
            </div>
            {items.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => setGenSeed(s => s + 1)} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/60" title="모든 문제 순서 다시 섞기">🎲 다시 섞기</button>
                <button type="button" onClick={downloadAsDoc} className="px-3 py-1.5 text-xs rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/60 font-medium">📝 Word</button>
                <button type="button" onClick={downloadCombinedPdf} className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 font-semibold" title="선택한 강 전체 — 학생용 + 답지 PDF">📄 PDF</button>
                <button type="button" onClick={printPreview} className="px-3 py-1.5 text-xs rounded-lg bg-white text-slate-900 hover:bg-slate-200 font-bold">🖨 인쇄</button>
              </div>
            )}
          </div>

          {/* 줌 */}
          {items.length > 0 && (
            <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-slate-700">
              <button type="button" onClick={() => setPreviewScale(s => Math.max(0.4, Math.round((s - 0.1) * 10) / 10))} className="w-7 h-7 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 text-sm font-bold leading-none">−</button>
              <span className="text-xs text-slate-400 tabular-nums w-11 text-center">{Math.round(previewScale * 100)}%</span>
              <button type="button" onClick={() => setPreviewScale(s => Math.min(1.4, Math.round((s + 0.1) * 10) / 10))} className="w-7 h-7 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 text-sm font-bold leading-none">+</button>
              <button type="button" onClick={() => setPreviewScale(0.7)} className="px-2 py-1 rounded-md text-[10px] border border-slate-600 text-slate-400 hover:bg-slate-700">초기화</button>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-auto bg-slate-900/60 p-6">
            {items.length > 0 ? (
              <div className="flex flex-col items-center gap-2 w-full">
                <div className="bg-white shadow-2xl rounded overflow-hidden mx-auto" style={{ width: PREVIEW_BASE_W * previewScale, height: PREVIEW_BASE_H * previewScale }}>
                  <iframe
                    ref={previewIframeRef}
                    srcDoc={previewHtml}
                    title="순서배열 워크북 미리보기"
                    className="border-0 block"
                    style={{ width: PREVIEW_BASE_W, height: PREVIEW_BASE_H, transform: `scale(${previewScale})`, transformOrigin: 'top left' }}
                    sandbox="allow-same-origin allow-scripts"
                    onLoad={enableEditing}
                  />
                </div>
                <p className="text-[10px] text-slate-500">미리보기 위에서 직접 텍스트를 편집할 수 있습니다 — 인쇄·Word 에 반영됩니다. (다운로드는 전체 {items.length}문제)</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 py-16">
                <p className="text-base font-medium text-slate-400">교재·강을 선택하고 분할 모드를 켜세요</p>
                <p className="text-sm mt-1">{!anyMode ? '분할 모드를 1개 이상 선택' : selectedCount === 0 ? '지문(강/번호)을 1개 이상 선택' : '생성할 문제가 없습니다'}</p>
                {statusMsg && <p className="text-xs mt-2 text-slate-500">{statusMsg}</p>}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
