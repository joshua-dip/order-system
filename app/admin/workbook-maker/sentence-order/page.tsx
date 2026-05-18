'use client';

/**
 * 순서배열(ABC 셔플) 워크북 생성기.
 *
 * 흐름:
 *   1. PassagePickerModal 로 지문 선택
 *   2. 지문 문장 목록을 표로 보여주고 각 문장에 라벨 (도입/A/B/C) 지정
 *      (또는 「자동 4분할」 버튼으로 도입 1문장 + 나머지 3등분)
 *   3. 「🎲 셔플」로 정답 1~5 무작위, 「①~⑤」 클릭으로 수동 지정
 *   4. 미리보기 iframe 에 학생용 본문 + 보기 5개
 *   5. Word/PDF 내보내기 (학생용+답지 2쪽)
 *
 * MVP: DB 저장은 추후. 미리보기 + 내보내기로 운영 가능.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PassagePickerModal, { PassageItem } from '../../_components/PassagePickerModal';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import {
  ANSWER_LABEL,
  AnswerKey,
  buildSentenceOrderCombinedHtml,
  buildSentenceOrderStudentHtml,
  CIRCLED,
  randomAnswer,
  SentenceOrderItem,
} from '@/lib/sentence-order-workbook';

type LabelKind = 'intro' | 'A' | 'B' | 'C' | '-';

const LABEL_COLOR: Record<LabelKind, string> = {
  intro: 'bg-slate-600 text-white border-slate-500',
  A: 'bg-emerald-600 text-white border-emerald-500',
  B: 'bg-sky-600 text-white border-sky-500',
  C: 'bg-amber-600 text-white border-amber-500',
  '-': 'bg-slate-700 text-slate-400 border-slate-600',
};

const LABELS: LabelKind[] = ['-', 'intro', 'A', 'B', 'C'];

/** 라벨 배열 → chunk 본문(공백 join). 같은 라벨이 여러 문장이면 공백으로 이어붙임. */
function joinByLabel(sentencesEn: string[], sentencesKo: string[], labels: LabelKind[], target: LabelKind): { en: string; ko: string } {
  const idxs = labels
    .map((l, i) => (l === target ? i : -1))
    .filter(i => i >= 0);
  return {
    en: idxs.map(i => sentencesEn[i] ?? '').filter(Boolean).join(' '),
    ko: idxs.map(i => sentencesKo[i] ?? '').filter(Boolean).join(' '),
  };
}

export default function SentenceOrderWorkbookPage() {
  const [showPicker, setShowPicker] = useState(false);
  const [passage, setPassage] = useState<PassageItem | null>(null);
  const [title, setTitle] = useState('순서배열 워크북');
  const [labels, setLabels] = useState<LabelKind[]>([]);
  const [answer, setAnswer] = useState<AnswerKey>(1);
  const [statusMsg, setStatusMsg] = useState('');
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  /** A4 종이 미리보기 베이스 — 너비/높이 px. 줌으로 확대/축소. */
  const PREVIEW_BASE_W = 794;
  const PREVIEW_BASE_H = 1100;
  const [previewScale, setPreviewScale] = useState(0.75);

  const sentenceObjs = useMemo(() => {
    if (!passage?.content) return [];
    return tokenizePassageFromContent(passage.content);
  }, [passage]);

  const sentencesEn = useMemo(() => sentenceObjs.map(s => s.text), [sentenceObjs]);
  const sentencesKo = useMemo(() => sentenceObjs.map(s => s.korean ?? ''), [sentenceObjs]);

  const sourceKey = passage?.source_key ?? `${passage?.chapter ?? ''} ${passage?.number ?? ''}`.trim();

  /** 자동 4분할: 도입 1문장 + 나머지 3등분 (반올림). 문장 4개 미만이면 도입 없이 3등분. */
  const autoSplit = () => {
    const n = sentencesEn.length;
    if (n === 0) return;
    const next: LabelKind[] = new Array(n).fill('-');
    if (n >= 4) {
      next[0] = 'intro';
      const rest = n - 1;
      const per = Math.ceil(rest / 3);
      for (let i = 0; i < rest; i++) {
        const labelIdx = Math.min(2, Math.floor(i / per));
        next[i + 1] = (['A', 'B', 'C'] as LabelKind[])[labelIdx];
      }
    } else if (n >= 3) {
      const per = Math.ceil(n / 3);
      for (let i = 0; i < n; i++) {
        const labelIdx = Math.min(2, Math.floor(i / per));
        next[i] = (['A', 'B', 'C'] as LabelKind[])[labelIdx];
      }
    } else {
      setStatusMsg('문장이 3개 이하라 자동 분할을 적용할 수 없습니다.');
      return;
    }
    setLabels(next);
    setStatusMsg('자동 분할 완료.');
  };

  /** 지문 선택 — 한국어 해석을 분석기/passages 에서 보강. */
  const handlePickPassage = async (p: PassageItem) => {
    setPassage(p);
    setLabels([]);
    setStatusMsg('');
    setShowPicker(false);
    try {
      const r = await fetch(`/api/admin/passages/${p._id}/korean`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok) return;
      const sentences_en = Array.isArray(d.sentences_en) ? (d.sentences_en as string[]) : [];
      const sentences_ko = Array.isArray(d.sentences_ko) ? (d.sentences_ko as string[]) : [];
      setPassage(prev =>
        prev
          ? {
              ...prev,
              content: {
                ...(prev.content ?? {}),
                sentences_en: sentences_en.length ? sentences_en : prev.content?.sentences_en,
                sentences_ko,
              },
            }
          : prev,
      );
      if (!sentences_ko.some(Boolean)) {
        setStatusMsg('한국어 해석이 DB·분석기 어디에도 저장되어 있지 않습니다. 답지 한국어가 비어 보일 수 있어요.');
      } else {
        setStatusMsg(
          d.source === 'analyzer'
            ? '한국어 해석을 분석기 데이터에서 불러왔습니다.'
            : d.source === 'passages'
              ? '한국어 해석을 DB 에서 불러왔습니다.'
              : '',
        );
      }
    } catch {
      /* ignore */
    }
  };

  /** 지문이 새로 들어왔을 때 labels 길이 동기화. */
  useEffect(() => {
    if (sentencesEn.length === 0) {
      setLabels([]);
      return;
    }
    setLabels(prev => {
      if (prev.length === sentencesEn.length) return prev;
      const next: LabelKind[] = new Array(sentencesEn.length).fill('-');
      // 길이가 0 이거나 다르면 새로 생성
      return next;
    });
  }, [sentencesEn.length]);

  const setLabelAt = (i: number, label: LabelKind) => {
    setLabels(prev => {
      const next = prev.slice();
      next[i] = label;
      return next;
    });
  };

  const intro = useMemo(() => joinByLabel(sentencesEn, sentencesKo, labels, 'intro'), [sentencesEn, sentencesKo, labels]);
  const chunkA = useMemo(() => joinByLabel(sentencesEn, sentencesKo, labels, 'A'), [sentencesEn, sentencesKo, labels]);
  const chunkB = useMemo(() => joinByLabel(sentencesEn, sentencesKo, labels, 'B'), [sentencesEn, sentencesKo, labels]);
  const chunkC = useMemo(() => joinByLabel(sentencesEn, sentencesKo, labels, 'C'), [sentencesEn, sentencesKo, labels]);

  /** 모든 chunk(A/B/C) 가 비어있지 않은가. */
  const ready = chunkA.en.length > 0 && chunkB.en.length > 0 && chunkC.en.length > 0;

  const item: SentenceOrderItem | null = useMemo(() => {
    if (!ready) return null;
    return {
      title: passage ? `${passage.textbook} · ${sourceKey}` : title,
      textbook: passage?.textbook,
      sourceKey,
      intro: intro.en,
      introKo: intro.ko,
      chunks: [chunkA.en, chunkB.en, chunkC.en],
      chunksKo: [chunkA.ko, chunkB.ko, chunkC.ko],
      answer,
    };
  }, [ready, passage, sourceKey, title, intro, chunkA, chunkB, chunkC, answer]);

  const previewHtml = useMemo(() => {
    if (!item) return '';
    return buildSentenceOrderStudentHtml({ title, items: [item] });
  }, [item, title]);

  const downloadAsDoc = () => {
    if (!item) return;
    const html = buildSentenceOrderCombinedHtml({ title, items: [item] });
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
    if (!item) return;
    const html = buildSentenceOrderCombinedHtml({ title, items: [item] });
    const w = window.open('', '_blank');
    if (!w) {
      alert('팝업이 차단되어 PDF 인쇄 창을 열 수 없습니다. 팝업 허용 후 다시 시도하세요.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    const docTitle = `${title} - ${passage?.textbook ?? ''} - ${sourceKey}`;
    try { w.document.title = docTitle; } catch { /* ignore */ }
    w.addEventListener('load', () => {
      try { w.document.title = docTitle; } catch { /* ignore */ }
      try { w.focus(); w.print(); } catch { /* ignore */ }
    });
  };

  /** iframe 로드 후 designMode='on' — 사용자가 미리보기 위에서 직접 텍스트 편집 가능. */
  const enableEditing = useCallback(() => {
    const doc = previewIframeRef.current?.contentDocument;
    if (!doc) return;
    try { doc.designMode = 'on'; } catch { /* ignore */ }
  }, []);

  /** 인쇄 — iframe 의 (편집된) 현재 DOM 을 새 창으로 옮겨 print. */
  const printPreview = () => {
    const iframeDoc = previewIframeRef.current?.contentDocument;
    const html = iframeDoc
      ? '<!DOCTYPE html>' + iframeDoc.documentElement.outerHTML
      : previewHtml;
    if (!html) return;
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

  return (
    <>
      {showPicker && (
        <PassagePickerModal
          onSelect={handlePickPassage}
          onClose={() => setShowPicker(false)}
          lastTextbookKey="sentence_order_workbook_last_textbook"
        />
      )}

      <main className="flex-1 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">순서배열 (ABC 셔플) 워크북</h1>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="text-sm px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-500"
            >
              지문 불러오기
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 좌: 메타 + 문장 라벨 */}
          <section className="space-y-3">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">제목</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">지문</label>
                <div className="text-xs text-slate-300 truncate">
                  {passage ? `${passage.textbook} · ${sourceKey}` : '— 지문 미선택 —'}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <button
                  type="button"
                  onClick={autoSplit}
                  disabled={sentencesEn.length === 0}
                  className="text-xs px-2.5 py-1 rounded border border-slate-600 hover:bg-slate-700 disabled:opacity-40"
                  title="도입 1문장 + 나머지 3등분"
                >
                  ⚙ 자동 4분할
                </button>
                <button
                  type="button"
                  onClick={() => setAnswer(randomAnswer())}
                  className="text-xs px-2.5 py-1 rounded border border-emerald-700 text-emerald-200 hover:bg-emerald-900/40"
                  title="정답을 1~5 중 무작위로 굴림"
                >
                  🎲 셔플
                </button>
                <div className="flex items-center gap-1">
                  {([1, 2, 3, 4, 5] as AnswerKey[]).map(k => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setAnswer(k)}
                      className={`text-xs px-2 py-1 rounded border ${
                        answer === k
                          ? 'bg-emerald-600 text-white border-emerald-400'
                          : 'border-slate-600 text-slate-300 hover:bg-slate-700/40'
                      }`}
                      title={ANSWER_LABEL[k]}
                    >
                      {CIRCLED[k]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-[11px] text-slate-400">
                현재 정답: <span className="text-emerald-300 font-bold">{ANSWER_LABEL[answer]}</span>
              </div>
              {statusMsg && <div className="text-[11px] text-slate-400">{statusMsg}</div>}
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold">문장 라벨링</h2>
                <span className="text-[11px] text-slate-500">각 문장을 도입/A/B/C 중 하나로 지정</span>
              </div>
              {sentencesEn.length === 0 ? (
                <p className="text-xs text-slate-500">지문을 먼저 선택하세요.</p>
              ) : (
                <div className="space-y-2">
                  {sentencesEn.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded border border-slate-700 bg-slate-900/40">
                      <span className="text-[10px] text-slate-500 mt-1 w-5 text-right shrink-0">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-slate-200 leading-relaxed break-words">{s}</div>
                        {sentencesKo[i] && (
                          <div className="text-[11px] text-blue-300/80 leading-relaxed break-words mt-0.5">
                            {sentencesKo[i]}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-0.5 shrink-0">
                        {LABELS.map(l => (
                          <button
                            key={l}
                            type="button"
                            onClick={() => setLabelAt(i, l)}
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${
                              labels[i] === l
                                ? LABEL_COLOR[l]
                                : 'border-slate-600 text-slate-500 hover:bg-slate-700/40'
                            }`}
                            title={l === '-' ? '제외' : l === 'intro' ? '도입' : l}
                          >
                            {l === 'intro' ? '도입' : l}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
                <span>도입 {labels.filter(l => l === 'intro').length}</span>
                <span className="text-emerald-400">A {labels.filter(l => l === 'A').length}</span>
                <span className="text-sky-400">B {labels.filter(l => l === 'B').length}</span>
                <span className="text-amber-400">C {labels.filter(l => l === 'C').length}</span>
                <span className="ml-auto">
                  {ready ? '✓ 준비 완료' : 'A/B/C 모두 1문장 이상 필요'}
                </span>
              </div>
            </div>
          </section>

          {/* 우: 미리보기 — A4 카드 + 줌 + designMode */}
          <section className="bg-slate-800 border border-slate-700 rounded-xl flex flex-col overflow-hidden lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)]">
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-700 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="font-bold text-white">미리보기 (학생용)</span>
                {item && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium">
                    준비 완료
                  </span>
                )}
                {item && (
                  <div className="flex items-center gap-1 ml-1 border-l border-slate-600 pl-3">
                    <button
                      type="button"
                      title="축소"
                      onClick={() => setPreviewScale(s => Math.max(0.4, Math.round((s - 0.1) * 10) / 10))}
                      className="w-7 h-7 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white text-sm font-bold leading-none"
                    >
                      −
                    </button>
                    <span className="text-xs text-slate-400 tabular-nums w-11 text-center">{Math.round(previewScale * 100)}%</span>
                    <button
                      type="button"
                      title="확대"
                      onClick={() => setPreviewScale(s => Math.min(1.6, Math.round((s + 0.1) * 10) / 10))}
                      className="w-7 h-7 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white text-sm font-bold leading-none"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      title="75%로 초기화"
                      onClick={() => setPreviewScale(0.75)}
                      className="px-2 py-1 rounded-md text-[10px] font-medium border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700"
                    >
                      초기화
                    </button>
                  </div>
                )}
              </div>
              {item && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={downloadAsDoc}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/60 transition-colors font-medium"
                  >
                    📝 Word
                  </button>
                  <button
                    type="button"
                    onClick={downloadCombinedPdf}
                    className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-semibold"
                    title="학생용 + 답지(해석 포함) 2쪽 PDF"
                  >
                    📄 PDF (학생+답지)
                  </button>
                  <button
                    type="button"
                    onClick={printPreview}
                    className="px-4 py-1.5 text-xs rounded-lg bg-white text-slate-900 hover:bg-slate-200 transition-colors font-bold"
                  >
                    🖨 인쇄 / PDF
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-auto bg-slate-900/60 p-6">
              {item ? (
                <div className="flex flex-col items-center gap-2 w-full">
                  <div
                    className="bg-white shadow-2xl rounded overflow-hidden mx-auto"
                    style={{
                      width: PREVIEW_BASE_W * previewScale,
                      height: PREVIEW_BASE_H * previewScale,
                    }}
                  >
                    <iframe
                      ref={previewIframeRef}
                      srcDoc={previewHtml}
                      title="순서배열 워크북 미리보기"
                      className="border-0 block"
                      style={{
                        width: PREVIEW_BASE_W,
                        height: PREVIEW_BASE_H,
                        transform: `scale(${previewScale})`,
                        transformOrigin: 'top left',
                      }}
                      sandbox="allow-same-origin allow-scripts"
                      onLoad={enableEditing}
                    />
                  </div>
                  <p className="text-[10px] text-slate-500">미리보기 위에서 직접 텍스트를 편집할 수 있습니다 — 인쇄·Word 에 반영됩니다.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 py-16">
                  <p className="text-base font-medium text-slate-400">지문을 선택하고 라벨을 지정하세요</p>
                  <p className="text-sm mt-1">A/B/C 모두 1문장 이상 필요</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
