'use client';

/**
 * 블록 빈칸 워크북 생성기 — 메인 페이지.
 *
 * 흐름:
 *   1. PassagePickerModal 로 지문 선택
 *   2. 본문을 문장→토큰으로 분리해 BlockSelector 에 전달
 *   3. 사용자가 단어/구/문장 블록을 지정하고, 문장 블록은 한국어 해석 입력
 *   4. 활성화된 유형(A/B/C) 으로 HTML 미리보기를 갱신 (재계산은 클라이언트에서 수행 — API 호출 없음)
 *   5. 「저장」 → /api/admin/block-workbook/save 로 1건 insert
 *   6. 「📂 목록」 패널에서 기존 워크북 로드/삭제
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '../_components/AdminSidebar';
import PassagePickerModal, { PassageItem } from '../_components/PassagePickerModal';
import BlockSelector from './_components/BlockSelector';
import {
  BlockWorkbookSelection,
  SelectionBlock,
  WorkbookKind,
} from '@/lib/block-workbook-types';
import { tokenizePassage } from '@/lib/block-workbook-tokenize';
import {
  buildAllHtml,
  buildGrammarTransformHtml,
  buildKeyExpressionHtml,
  buildPhraseBlankHtml,
  buildSentenceEssayHtml,
  buildSentenceOrderHtml,
  buildWordBlankHtml,
} from '@/lib/block-workbook-html';

interface SavedItem {
  _id: string;
  title: string;
  textbook: string;
  sourceKey: string;
  folder: string;
  types: WorkbookKind[];
  createdAt: string;
  updatedAt: string;
}

const TYPE_LABEL: Record<WorkbookKind, string> = {
  A: 'A. 단어 빈칸',
  B: 'B. 구 빈칸',
  C: 'C. 문장 영작',
  D: 'D. 어순 배열',
  E: 'E. 핵심 표현 정리',
  F: 'F. 어법 변형',
};

const TYPE_KINDS: WorkbookKind[] = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function BlockWorkbookPage() {
  const router = useRouter();
  const [adminLoginId, setAdminLoginId] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [passage, setPassage] = useState<PassageItem | null>(null);
  const [title, setTitle] = useState('블록 빈칸 워크북');
  const [folder, setFolder] = useState('기본');
  const [blocks, setBlocks] = useState<SelectionBlock[]>([]);
  const [activeTypes, setActiveTypes] = useState<Record<WorkbookKind, boolean>>({
    A: true, B: true, C: true, D: false, E: false, F: false,
  });
  const [previewType, setPreviewType] = useState<WorkbookKind>('A');
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (!d?.user || d.user.role !== 'admin') { router.replace('/admin/login'); return; }
        setAdminLoginId(d.user.loginId ?? '');
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  // 저장 목록
  const [showList, setShowList] = useState(false);
  const [items, setItems] = useState<SavedItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  const sentences = useMemo(() => {
    if (!passage?.content?.original) return [];
    return tokenizePassage(passage.content.original);
  }, [passage]);

  const selection: BlockWorkbookSelection = useMemo(
    () => ({ sentences, blocks }),
    [sentences, blocks],
  );

  const sourceKey = passage?.source_key ?? `${passage?.chapter ?? ''} ${passage?.number ?? ''}`.trim();

  /** 블록 변경 시 미리보기 HTML 재계산 (클라이언트 동기 — 가볍다) */
  const previewHtml = useMemo(() => {
    if (!passage) return '';
    const opts = { title, textbook: passage.textbook, sourceKey, selection };
    switch (previewType) {
      case 'A': return buildWordBlankHtml(opts);
      case 'B': return buildPhraseBlankHtml(opts);
      case 'C': return buildSentenceEssayHtml(opts);
      case 'D': return buildSentenceOrderHtml(opts);
      case 'E': return buildKeyExpressionHtml(opts);
      case 'F': return buildGrammarTransformHtml(opts);
      default: return '';
    }
  }, [passage, title, sourceKey, selection, previewType]);

  /** 블록의 한국어 의미 / base form 업데이트. (sentenceIdx, startTokenIdx) 로 블록 식별. */
  const updateBlockField = (
    sentenceIdx: number,
    startTokenIdx: number,
    field: 'koreanMeaning' | 'baseForm',
    value: string,
  ) => {
    setBlocks(prev =>
      prev.map(b =>
        b.sentenceIdx === sentenceIdx && b.startTokenIdx === startTokenIdx
          ? { ...b, [field]: value }
          : b,
      ),
    );
  };

  /** 정렬된 블록 (sentenceIdx, startTokenIdx 오름차순) — 추가정보 패널·E 표 표시용 */
  const sortedBlocks = useMemo(
    () => [...blocks].sort((a, b) => {
      if (a.sentenceIdx !== b.sentenceIdx) return a.sentenceIdx - b.sentenceIdx;
      return a.startTokenIdx - b.startTokenIdx;
    }),
    [blocks],
  );

  /** 활성화된 유형 중 어떤 입력란이 패널에 보여야 하는지 */
  const showKoreanInput = activeTypes.C || activeTypes.E;
  const showBaseFormInput = activeTypes.F;

  // 내보내기
  const downloadAsDoc = () => {
    if (!previewHtml) return;
    const blob = new Blob([previewHtml], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'block-workbook'}-${previewType}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const printPreview = () => {
    const w = previewIframeRef.current?.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
  };

  const handlePickPassage = (p: PassageItem) => {
    setPassage(p);
    setBlocks([]);
    setSaveMsg('');
    setShowPicker(false);
  };

  const fetchList = async () => {
    setListLoading(true);
    setListError('');
    try {
      const r = await fetch('/api/admin/block-workbook/list', { credentials: 'include' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error ?? '목록 조회 실패');
      setItems(d.items ?? []);
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    if (showList) void fetchList();
  }, [showList]);

  const handleSave = async () => {
    if (!passage) {
      setSaveMsg('지문을 먼저 선택하세요.');
      return;
    }
    const types: WorkbookKind[] = (Object.keys(activeTypes) as WorkbookKind[]).filter(
      k => activeTypes[k],
    );
    if (types.length === 0) {
      setSaveMsg('저장할 유형을 1개 이상 선택하세요.');
      return;
    }
    setSaving(true);
    setSaveMsg('');
    try {
      const opts = { title, textbook: passage.textbook, sourceKey, selection };
      const html = buildAllHtml(opts, types);

      const r = await fetch('/api/admin/block-workbook/save', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passageId: passage._id,
          textbook: passage.textbook,
          sourceKey,
          title,
          folder,
          selection,
          types,
          html,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error ?? '저장 실패');
      setSaveMsg(`저장 완료: ${d.id}`);
      if (showList) void fetchList();
    } catch (e) {
      setSaveMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = async (id: string) => {
    try {
      const r = await fetch(`/api/admin/block-workbook/${id}`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error ?? '로드 실패');
      const item = d.item;
      setPassage({
        _id: item.passageId ?? '',
        textbook: item.textbook,
        chapter: '',
        number: '',
        source_key: item.sourceKey,
        content: {
          // selection.sentences 의 text 를 모아 본문 복원
          original: (item.selection.sentences as { text: string }[]).map(s => s.text).join(' '),
        },
      });
      setBlocks(item.selection.blocks);
      setTitle(item.title);
      setFolder(item.folder ?? '기본');
      const t: Record<WorkbookKind, boolean> = { A: false, B: false, C: false, D: false, E: false, F: false };
      for (const k of item.types as WorkbookKind[]) t[k] = true;
      setActiveTypes(t);
      setShowList(false);
      setSaveMsg(`불러옴: ${item.title}`);
    } catch (e) {
      setSaveMsg((e as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      const r = await fetch(`/api/admin/block-workbook/${id}`, { method: 'DELETE', credentials: 'include' });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error ?? '삭제 실패');
      void fetchList();
    } catch (e) {
      setListError((e as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      <AdminSidebar loginId={adminLoginId} />

      {showPicker && (
        <PassagePickerModal
          onSelect={handlePickPassage}
          onClose={() => setShowPicker(false)}
          lastTextbookKey="block_workbook_last_textbook"
        />
      )}

      <main className="flex-1 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">블록 빈칸 워크북 생성기</h1>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowList(true)}
              className="text-sm px-3 py-1.5 rounded-lg border border-slate-600 hover:bg-slate-700"
            >
              📂 목록
            </button>
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
          {/* 좌: 메타 + 블록 선택 */}
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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">폴더</label>
                  <input
                    value={folder}
                    onChange={e => setFolder(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">지문</label>
                  <div className="text-xs text-slate-300 truncate">
                    {passage ? `${passage.textbook} · ${sourceKey}` : '— 지문 미선택 —'}
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">생성할 유형</label>
                <div className="flex flex-wrap gap-1.5">
                  {TYPE_KINDS.map(k => (
                    <label key={k} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeTypes[k]}
                        onChange={e => setActiveTypes(s => ({ ...s, [k]: e.target.checked }))}
                      />
                      {TYPE_LABEL[k]}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold">블록 지정</h2>
                <span className="text-[11px] text-slate-500">클릭=토글 · 드래그=구 · 「+」=문장 영작</span>
              </div>
              {sentences.length === 0 ? (
                <p className="text-xs text-slate-500">지문을 먼저 선택하세요.</p>
              ) : (
                <BlockSelector sentences={sentences} blocks={blocks} onChangeBlocks={setBlocks} />
              )}
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                <span className="px-2 py-0.5 rounded bg-emerald-500/30 text-emerald-100 border border-emerald-500/40">단어</span>
                <span className="px-2 py-0.5 rounded bg-sky-500/30 text-sky-100 border border-sky-500/40">구</span>
                <span className="px-2 py-0.5 rounded bg-amber-500/30 text-amber-100 border border-amber-500/40">문장</span>
                <span className="ml-auto text-slate-500">총 블록 {blocks.length}개</span>
              </div>
            </div>

            {sortedBlocks.length > 0 && (showKoreanInput || showBaseFormInput) && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
                <h2 className="text-sm font-bold">블록 추가 정보</h2>
                <p className="text-[11px] text-slate-500">
                  활성화된 유형에 따라 입력란이 표시됩니다.
                  {activeTypes.C && ' · 「문장 영작」: 한국어 해석'}
                  {activeTypes.E && ' · 「핵심 표현 정리」: 모든 블록 한국어 의미'}
                  {activeTypes.F && ' · 「어법 변형」: 단어 블록 base form'}
                </p>
                {sortedBlocks.map(b => {
                  const sent = sentences.find(s => s.idx === b.sentenceIdx);
                  if (!sent) return null;
                  const phrase = sent.tokens.slice(b.startTokenIdx, b.endTokenIdx + 1).join(' ');
                  const kindBadge = b.kind === 'word' ? '단어' : b.kind === 'phrase' ? '구' : '문장';
                  const kindCls =
                    b.kind === 'word'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : b.kind === 'phrase'
                        ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                        : 'bg-amber-500/20 text-amber-300 border-amber-500/40';

                  // 해당 블록에 보여줄 한국어 입력란이 필요한 조건
                  const needKorean =
                    (activeTypes.C && b.kind === 'sentence') || activeTypes.E;
                  const needBaseForm = activeTypes.F && b.kind === 'word';

                  if (!needKorean && !needBaseForm) return null;

                  return (
                    <div
                      key={`${b.sentenceIdx}:${b.startTokenIdx}`}
                      className="space-y-1.5 p-2 rounded border border-slate-700 bg-slate-900/40"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${kindCls}`}>
                          {kindBadge}
                        </span>
                        <span className="text-xs text-slate-300 truncate flex-1">{phrase}</span>
                      </div>
                      {needKorean && (
                        <input
                          value={b.koreanMeaning ?? ''}
                          onChange={e =>
                            updateBlockField(b.sentenceIdx, b.startTokenIdx, 'koreanMeaning', e.target.value)
                          }
                          placeholder={
                            b.kind === 'sentence'
                              ? '한국어 해석문 (학생에게 보여줄 의미)'
                              : '한국어 의미 (예: 드러내다)'
                          }
                          className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm"
                        />
                      )}
                      {needBaseForm && (
                        <input
                          value={b.baseForm ?? ''}
                          onChange={e =>
                            updateBlockField(b.sentenceIdx, b.startTokenIdx, 'baseForm', e.target.value)
                          }
                          placeholder="base form (예: reveal — 학생이 어형 변환)"
                          className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !passage}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 disabled:opacity-50"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
              {saveMsg && <span className="text-xs text-slate-300">{saveMsg}</span>}
            </div>
          </section>

          {/* 우: 미리보기 */}
          <section className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3 lg:sticky lg:top-4 lg:self-start">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-sm font-bold">미리보기</h2>
              <div className="flex gap-1 flex-wrap">
                {TYPE_KINDS.map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setPreviewType(k)}
                    title={TYPE_LABEL[k]}
                    className={`text-xs px-2 py-1 rounded border ${
                      previewType === k
                        ? 'bg-slate-600 text-white border-slate-500'
                        : activeTypes[k]
                          ? 'border-slate-700 text-slate-300 hover:bg-slate-700/50'
                          : 'border-slate-700 text-slate-600 hover:bg-slate-700/30'
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
            {passage && (
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={printPreview}
                  className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-slate-700"
                >
                  🖨 인쇄/PDF
                </button>
                <button
                  type="button"
                  onClick={downloadAsDoc}
                  className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-slate-700"
                >
                  📝 Word(.doc)
                </button>
              </div>
            )}
            {passage ? (
              <iframe
                ref={previewIframeRef}
                title="preview"
                srcDoc={previewHtml}
                className="w-full h-[70vh] bg-white rounded border border-slate-600"
              />
            ) : (
              <p className="text-xs text-slate-500">지문을 선택하면 미리보기가 표시됩니다.</p>
            )}
          </section>
        </div>
      </main>

      {showList && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowList(false)}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-2xl w-[760px] max-h-[80vh] flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <span className="font-bold">📂 저장된 워크북</span>
              <button type="button" onClick={() => setShowList(false)} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {listLoading && <div className="p-6 text-sm text-slate-500">불러오는 중...</div>}
              {listError && <div className="p-6 text-sm text-red-400">{listError}</div>}
              {!listLoading && !listError && items.length === 0 && (
                <div className="p-6 text-sm text-slate-500">저장된 워크북이 없습니다.</div>
              )}
              {items.map(it => (
                <div key={it._id} className="px-5 py-3 border-b border-slate-700/60 flex items-center gap-3 hover:bg-slate-700/30">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{it.title}</div>
                    <div className="text-xs text-slate-400 truncate">
                      {it.textbook} · {it.sourceKey} · {it.folder}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex gap-1">
                      {it.types.map(t => (
                        <span key={t} className="px-1.5 py-0.5 rounded bg-slate-700">{t}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleLoad(it._id)}
                    className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-slate-700"
                  >
                    불러오기
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(it._id)}
                    className="text-xs px-2 py-1 rounded border border-red-700 text-red-300 hover:bg-red-900/30"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
