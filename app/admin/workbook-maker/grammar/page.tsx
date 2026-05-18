'use client';

/**
 * 어법공략 워크북 — 단어 블록 + baseForm → (lemma) 노출, 학생이 어형 변환.
 *
 * 흐름:
 *   1. PassagePickerModal 로 지문 선택
 *   2. 본문 토큰 클릭으로 단어 블록 토글
 *   3. 각 블록에 baseForm 입력 (예: revealed → reveal)
 *   4. buildGrammarTransformHtml 로 미리보기 — 단어 자리에 「(reveal)」 괄호
 *   5. Word/PDF 내보내기
 *
 * MVP: DB 저장은 보류. 미리보기 + 내보내기로 운영.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PassagePickerModal, { PassageItem } from '../../_components/PassagePickerModal';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import { buildGrammarTransformHtml } from '@/lib/block-workbook-html';
import { SelectionBlock } from '@/lib/block-workbook-types';

export default function GrammarWorkbookPage() {
  const [showPicker, setShowPicker] = useState(false);
  const [passage, setPassage] = useState<PassageItem | null>(null);
  const [title, setTitle] = useState('어법공략 워크북');
  const [blocks, setBlocks] = useState<SelectionBlock[]>([]);
  const [statusMsg, setStatusMsg] = useState('');

  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  /** A4 종이 미리보기 베이스. */
  const PREVIEW_BASE_W = 794;
  const PREVIEW_BASE_H = 1100;
  const [previewScale, setPreviewScale] = useState(0.75);

  const sentences = useMemo(() => {
    if (!passage?.content) return [];
    return tokenizePassageFromContent(passage.content);
  }, [passage]);

  const sourceKey = passage?.source_key ?? `${passage?.chapter ?? ''} ${passage?.number ?? ''}`.trim();

  const handlePickPassage = async (p: PassageItem) => {
    setPassage(p);
    setBlocks([]);
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
    } catch {
      /* ignore */
    }
  };

  /** 단어 블록 토글: 클릭한 토큰에 word 블록이 있으면 제거, 없으면 추가. */
  const toggleWord = (sentenceIdx: number, tokenIdx: number) => {
    setBlocks(prev => {
      const exact = prev.find(
        b => b.kind === 'word' && b.sentenceIdx === sentenceIdx && b.startTokenIdx === tokenIdx,
      );
      if (exact) return prev.filter(b => b !== exact);
      return [...prev, { sentenceIdx, startTokenIdx: tokenIdx, endTokenIdx: tokenIdx, kind: 'word' }];
    });
  };

  const updateBaseForm = (sentenceIdx: number, startTokenIdx: number, value: string) => {
    setBlocks(prev =>
      prev.map(b =>
        b.sentenceIdx === sentenceIdx && b.startTokenIdx === startTokenIdx && b.kind === 'word'
          ? { ...b, baseForm: value }
          : b,
      ),
    );
  };

  const sortedBlocks = useMemo(
    () => [...blocks].sort((a, b) => {
      if (a.sentenceIdx !== b.sentenceIdx) return a.sentenceIdx - b.sentenceIdx;
      return a.startTokenIdx - b.startTokenIdx;
    }),
    [blocks],
  );

  const previewHtml = useMemo(() => {
    if (!passage) return '';
    return buildGrammarTransformHtml({
      title,
      textbook: passage.textbook,
      sourceKey,
      selection: { sentences, blocks },
    });
  }, [passage, title, sourceKey, sentences, blocks]);

  const enableEditing = useCallback(() => {
    const doc = previewIframeRef.current?.contentDocument;
    if (!doc) return;
    try { doc.designMode = 'on'; } catch { /* ignore */ }
  }, []);

  const downloadAsDoc = () => {
    if (!previewHtml) return;
    const blob = new Blob([previewHtml], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'grammar-workbook'}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const printPreview = () => {
    const iframeDoc = previewIframeRef.current?.contentDocument;
    const html = iframeDoc
      ? '<!DOCTYPE html>' + iframeDoc.documentElement.outerHTML
      : previewHtml;
    if (!html) return;
    const w = window.open('', '_blank');
    if (!w) {
      alert('팝업이 차단되어 인쇄 창을 열 수 없습니다.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 300);
  };

  const missingBaseForm = sortedBlocks.filter(b => !((b.baseForm ?? '').trim())).length;

  return (
    <>
      {showPicker && (
        <PassagePickerModal
          onSelect={handlePickPassage}
          onClose={() => setShowPicker(false)}
          lastTextbookKey="grammar_workbook_last_textbook"
        />
      )}

      <main className="flex-1 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">어법공략 워크북</h1>
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

        <details className="mb-4 bg-slate-800/60 border border-slate-700 rounded-xl text-sm">
          <summary className="cursor-pointer select-none px-4 py-2.5 font-bold text-slate-200 hover:bg-slate-700/40 rounded-xl">
            ❓ 사용 안내 — 클릭해서 펼치기
          </summary>
          <div className="px-4 pb-4 pt-1 space-y-2 text-[13px] text-slate-300 leading-relaxed">
            <p>변형문제 「<b>어법</b>」 을 타겟합니다. 본문에서 어형 변환 학습 가치가 큰 단어(동사·관계사·분사·be동사 등) 를 클릭하여 블록으로 잡고, 각 블록에 <b>baseForm</b> (원형) 을 입력하세요.</p>
            <p>학생용 본문에서는 그 단어가 「<span className="text-blue-300 italic">(reveal)</span>」 처럼 괄호 형태로 노출됩니다 — 학생이 문맥에 맞는 어형으로 변환합니다.</p>
            <p className="text-slate-400">DB 저장은 보류 — 지금은 미리보기 + Word/PDF 내보내기로 운영.</p>
          </div>
        </details>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 좌: 메타 + 단어 블록 */}
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
              {statusMsg && <div className="text-[11px] text-slate-400">{statusMsg}</div>}
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold">단어 블록</h2>
                <span className="text-[11px] text-slate-500">토큰 클릭 = 토글</span>
              </div>
              {sentences.length === 0 ? (
                <p className="text-xs text-slate-500">지문을 먼저 선택하세요.</p>
              ) : (
                <div className="space-y-2 select-none">
                  {sentences.map(sent => (
                    <div key={sent.idx} className="flex flex-wrap gap-1 leading-relaxed">
                      {sent.tokens.map((tok, t) => {
                        const on = blocks.some(
                          b => b.kind === 'word' && b.sentenceIdx === sent.idx && b.startTokenIdx === t,
                        );
                        const cls = on
                          ? 'bg-blue-500/40 text-blue-100 border-blue-500/60'
                          : 'border-transparent text-slate-200 hover:bg-slate-700/50';
                        return (
                          <span
                            key={t}
                            onClick={() => toggleWord(sent.idx, t)}
                            className={`px-1.5 py-0.5 rounded text-sm cursor-pointer transition-colors border ${cls}`}
                          >
                            {tok}
                          </span>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 text-[11px] text-slate-400">
                선택된 단어 {blocks.length}개 · baseForm 미입력 {missingBaseForm}개
              </div>
            </div>

            {sortedBlocks.length > 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-2">
                <h2 className="text-sm font-bold">baseForm 입력</h2>
                {sortedBlocks.map(b => {
                  const sent = sentences.find(s => s.idx === b.sentenceIdx);
                  if (!sent) return null;
                  const word = sent.tokens[b.startTokenIdx] ?? '';
                  return (
                    <div key={`${b.sentenceIdx}:${b.startTokenIdx}`} className="flex items-center gap-2">
                      <span className="text-xs text-slate-300 w-32 truncate" title={word}>{word}</span>
                      <input
                        value={b.baseForm ?? ''}
                        onChange={e => updateBaseForm(b.sentenceIdx, b.startTokenIdx, e.target.value)}
                        placeholder="원형 (예: reveal)"
                        className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 우: 미리보기 */}
          <section className="bg-slate-800 border border-slate-700 rounded-xl flex flex-col overflow-hidden lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)]">
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-700 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="font-bold text-white">미리보기</span>
                {passage && (
                  <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full font-medium">
                    어법 변형
                  </span>
                )}
                {passage && (
                  <div className="flex items-center gap-1 ml-1 border-l border-slate-600 pl-3">
                    <button
                      type="button"
                      onClick={() => setPreviewScale(s => Math.max(0.4, Math.round((s - 0.1) * 10) / 10))}
                      className="w-7 h-7 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white text-sm font-bold leading-none"
                    >−</button>
                    <span className="text-xs text-slate-400 tabular-nums w-11 text-center">{Math.round(previewScale * 100)}%</span>
                    <button
                      type="button"
                      onClick={() => setPreviewScale(s => Math.min(1.6, Math.round((s + 0.1) * 10) / 10))}
                      className="w-7 h-7 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white text-sm font-bold leading-none"
                    >+</button>
                    <button
                      type="button"
                      onClick={() => setPreviewScale(0.75)}
                      className="px-2 py-1 rounded-md text-[10px] font-medium border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700"
                    >초기화</button>
                  </div>
                )}
              </div>
              {passage && (
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
                    onClick={printPreview}
                    className="px-4 py-1.5 text-xs rounded-lg bg-white text-slate-900 hover:bg-slate-200 transition-colors font-bold"
                  >
                    🖨 인쇄 / PDF
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-auto bg-slate-900/60 p-6">
              {passage ? (
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
                      title="어법 워크북 미리보기"
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
                  <p className="text-[10px] text-slate-500">미리보기 위에서 직접 텍스트를 편집할 수 있습니다.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 py-16">
                  <p className="text-base font-medium text-slate-400">지문을 선택하세요</p>
                  <p className="text-sm mt-1">우측 상단 「지문 불러오기」로 시작</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
