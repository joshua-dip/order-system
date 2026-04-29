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
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import {
  buildAllHtml,
  buildCombinedHtml,
  buildFolderHtml,
  buildGrammarTransformHtml,
  buildKeyExpressionHtml,
  buildPhraseBlankHtml,
  buildSentenceEssayHtml,
  buildSentenceOrderHtml,
  buildWordBlankHtml,
} from '@/lib/block-workbook-html';
import { detectBlockOverlaps } from '@/lib/block-workbook-overlap';

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
  const [previewType, setPreviewType] = useState<WorkbookKind | 'ALL'>('ALL');
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
  /** 저장된 워크북 모달의 폴더 필터. '' = 전체 */
  const [listFolderFilter, setListFolderFilter] = useState('');
  /** 인라인 폴더 편집 중인 항목 id → 새 폴더명 */
  const [folderEditDraft, setFolderEditDraft] = useState<Record<string, string>>({});
  /** 항목이 없는 빈 폴더(사용자가 만든) — localStorage 에 저장돼 다음 세션에도 유지. */
  const [extraFolders, setExtraFolders] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('block_workbook_extra_folders');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setExtraFolders(arr.filter(s => typeof s === 'string'));
      }
    } catch {
      /* ignore */
    }
  }, []);
  const persistExtraFolders = (next: string[]) => {
    setExtraFolders(next);
    try {
      localStorage.setItem('block_workbook_extra_folders', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const sentences = useMemo(() => {
    if (!passage?.content) return [];
    return tokenizePassageFromContent(passage.content);
  }, [passage]);

  const selection: BlockWorkbookSelection = useMemo(
    () => ({ sentences, blocks }),
    [sentences, blocks],
  );

  const sourceKey = passage?.source_key ?? `${passage?.chapter ?? ''} ${passage?.number ?? ''}`.trim();

  /** 활성화된 유형 목록 (alphabet 순). 통합 미리보기·다운로드 파일명에 사용. */
  const activeKindList = useMemo<WorkbookKind[]>(
    () => (Object.keys(activeTypes) as WorkbookKind[]).filter(k => activeTypes[k]),
    [activeTypes],
  );

  /** 블록 변경 시 미리보기 HTML 재계산 (클라이언트 동기 — 가볍다) */
  const previewHtml = useMemo(() => {
    if (!passage) return '';
    const opts = { title, textbook: passage.textbook, sourceKey, selection };
    switch (previewType) {
      case 'ALL': return buildCombinedHtml(opts, activeKindList);
      case 'A': return buildWordBlankHtml(opts);
      case 'B': return buildPhraseBlankHtml(opts);
      case 'C': return buildSentenceEssayHtml(opts);
      case 'D': return buildSentenceOrderHtml(opts);
      case 'E': return buildKeyExpressionHtml(opts);
      case 'F': return buildGrammarTransformHtml(opts);
      default: return '';
    }
  }, [passage, title, sourceKey, selection, previewType, activeKindList]);

  /** 블록 겹침 검출 — 같은 문장 내에서 토큰 범위가 겹치는 블록 쌍을 찾는다. */
  const overlapIssues = useMemo(
    () => detectBlockOverlaps(sentences, blocks),
    [sentences, blocks],
  );

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

  /** 활성화된 유형 중 어떤 입력란이 패널에 보여야 하는지.
   * 구·표현(phrase)은 활성 유형과 무관하게 한국어 입력을 항상 노출 — 통합/E 에서 활용. */
  const showKoreanInput = activeTypes.C || activeTypes.E || blocks.some(b => b.kind === 'phrase');
  const showBaseFormInput = activeTypes.F;

  // 내보내기
  const downloadAsDoc = () => {
    if (!previewHtml) return;
    const blob = new Blob([previewHtml], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const suffix = previewType === 'ALL' ? `ALL-${activeKindList.join('')}` : previewType;
    a.download = `${title || 'block-workbook'}-${suffix}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /** 통합 3페이지(해석포함 → 해석제외 → 답지) 를 새 창에서 인쇄 → "PDF로 저장" 으로 받기 */
  const downloadCombinedPdf = () => {
    if (!passage || activeKindList.length === 0) return;
    const opts = { title, textbook: passage.textbook, sourceKey, selection };
    const html = buildCombinedHtml(opts, activeKindList);
    const w = window.open('', '_blank');
    if (!w) {
      alert('팝업이 차단되어 PDF 인쇄 창을 열 수 없습니다. 팝업 허용 후 다시 시도하세요.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    // 브라우저가 PDF 저장 시 기본 파일명에 document.title 을 사용 — 교재·소스 포함
    const docTitle = `${title} - ${passage.textbook} - ${sourceKey}`;
    try { w.document.title = docTitle; } catch { /* ignore */ }
    w.addEventListener('load', () => {
      try { w.document.title = docTitle; } catch { /* ignore */ }
      try {
        w.focus();
        w.print();
      } catch {
        /* ignore */
      }
    });
  };

  const printPreview = () => {
    const w = previewIframeRef.current?.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
  };

  const handlePickPassage = async (p: PassageItem) => {
    setPassage(p);
    setBlocks([]);
    setSaveMsg('');
    setShowPicker(false);
    // 항상 /api/admin/passages/:id/korean 으로 sentences_en + sentences_ko 동기화
    // (picker payload 와 별개로 인덱스 정합성을 보장)
    try {
      const r = await fetch(`/api/admin/passages/${p._id}/korean`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok) return;
      const sentences_en = Array.isArray(d.sentences_en) ? (d.sentences_en as string[]) : [];
      const sentences_ko = Array.isArray(d.sentences_ko) ? (d.sentences_ko as string[]) : [];
      if (!sentences_ko.some(Boolean)) {
        setSaveMsg('한국어 해석이 DB·분석기 어디에도 저장되어 있지 않습니다. 직접 입력하세요.');
        return;
      }
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
      setSaveMsg(
        d.source === 'analyzer'
          ? '한국어 해석을 분석기 데이터에서 불러왔습니다.'
          : d.source === 'passages'
            ? '한국어 해석을 DB 에서 불러왔습니다.'
            : '',
      );
    } catch {
      /* ignore */
    }
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

  /** 한 항목의 폴더만 PATCH. 빈 문자열이면 '기본' 으로 고정. */
  const handleChangeItemFolder = async (id: string, nextFolder: string) => {
    const target = (nextFolder || '').trim() || '기본';
    setListError('');
    try {
      const r = await fetch(`/api/admin/block-workbook/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: target }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error ?? '폴더 변경 실패');
      setFolderEditDraft(prev => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
      void fetchList();
    } catch (e) {
      setListError((e as Error).message);
    }
  };

  /** 현재 선택된 폴더명을 일괄 이름변경. extraFolders 도 같이 동기화. */
  const handleRenameFolder = async () => {
    const from = listFolderFilter.trim();
    if (!from) {
      setListError('이름을 바꿀 폴더를 먼저 선택하세요.');
      return;
    }
    const next = window.prompt(`폴더 「${from}」 의 새 이름을 입력하세요`, from);
    const to = (next ?? '').trim();
    if (!to || to === from) return;
    try {
      const r = await fetch('/api/admin/block-workbook/folders/rename', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error ?? '폴더 이름 변경 실패');
      // localStorage 빈 폴더 목록도 동기화
      if (extraFolders.includes(from)) {
        const replaced = extraFolders.map(f => (f === from ? to : f));
        persistExtraFolders(Array.from(new Set(replaced)));
      }
      setListFolderFilter(to);
      void fetchList();
    } catch (e) {
      setListError((e as Error).message);
    }
  };

  /** 빈 폴더 새로 만들기 — DB 변경 없이 localStorage 에만 추가 */
  const handleAddEmptyFolder = () => {
    const name = window.prompt('새 폴더 이름을 입력하세요');
    const v = (name ?? '').trim();
    if (!v) return;
    if (extraFolders.includes(v)) {
      setListFolderFilter(v);
      return;
    }
    persistExtraFolders([...extraFolders, v]);
    setListFolderFilter(v);
  };

  /** 항목이 없는 빈 폴더만 사이드바에서 제거. 항목이 있는 폴더는 항목을 옮겨야 사라짐. */
  const handleRemoveEmptyFolder = (name: string) => {
    if (!extraFolders.includes(name)) return;
    persistExtraFolders(extraFolders.filter(f => f !== name));
    if (listFolderFilter === name) setListFolderFilter('');
  };

  /** 폴더 단위 묶음 PDF 인쇄 — 항목 모두 fetch → buildFolderHtml → 새 창에서 print */
  const [folderPdfBusy, setFolderPdfBusy] = useState<string>('');
  const handleDownloadFolderPdf = async (folder: string) => {
    const folderItems = items.filter(it => ((it.folder || '').trim() || '기본') === folder);
    if (folderItems.length === 0) {
      alert(`폴더 「${folder}」 에 워크북이 없습니다.`);
      return;
    }
    setFolderPdfBusy(folder);
    setListError('');
    try {
      const fulls = await Promise.all(
        folderItems.map(async it => {
          const r = await fetch(`/api/admin/block-workbook/${it._id}`, { credentials: 'include' });
          const d = await r.json();
          if (!r.ok || !d.ok || !d.item) throw new Error(d.error ?? `${it.title} 불러오기 실패`);
          return d.item as {
            title: string;
            textbook: string;
            sourceKey: string;
            selection: typeof selection;
            types: WorkbookKind[];
          };
        }),
      );
      const entries = fulls.map(f => ({
        opts: { title: f.title, textbook: f.textbook, sourceKey: f.sourceKey, selection: f.selection },
        types: f.types,
      }));
      const html = buildFolderHtml(folder, entries);
      const w = window.open('', '_blank');
      if (!w) {
        alert('팝업이 차단되어 PDF 인쇄 창을 열 수 없습니다. 팝업 허용 후 다시 시도하세요.');
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      const docTitle = `폴더 ${folder} - 통합 PDF (${entries.length}건)`;
      try { w.document.title = docTitle; } catch { /* ignore */ }
      w.addEventListener('load', () => {
        try { w.document.title = docTitle; } catch { /* ignore */ }
        try { w.focus(); w.print(); } catch { /* ignore */ }
      });
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setFolderPdfBusy('');
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
          countsApi="/api/admin/block-workbook/passage-counts"
          countLabel={n => `워크북 ${n}개`}
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
              {overlapIssues.length > 0 && (
                <div className="mb-3 p-2.5 rounded-lg border border-amber-500/50 bg-amber-950/40">
                  <div className="text-[11px] font-bold text-amber-200 mb-1">
                    ⚠ 블록 겹침 {overlapIssues.length}건 — 통합 페이지에서 충돌할 수 있습니다.
                  </div>
                  <ul className="text-[11px] text-amber-100/90 space-y-0.5 list-disc pl-4">
                    {overlapIssues.slice(0, 6).map((it, i) => (
                      <li key={i}>{it.message}</li>
                    ))}
                    {overlapIssues.length > 6 && (
                      <li className="text-amber-300/80">
                        … 외 {overlapIssues.length - 6}건
                      </li>
                    )}
                  </ul>
                </div>
              )}
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
                  // - sentence: C 활성 또는 E 활성
                  // - phrase: 항상 (편집 가능 + 통합/E 에 활용)
                  // - word: E 활성
                  const needKorean =
                    (activeTypes.C && b.kind === 'sentence') ||
                    (b.kind === 'phrase') ||
                    activeTypes.E;
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
                      {needKorean && (() => {
                        const sentenceKo =
                          sentences.find(s => s.idx === b.sentenceIdx)?.korean ?? '';
                        const dbKorean = b.kind === 'sentence' ? sentenceKo : '';
                        return (
                          <>
                            <textarea
                              value={b.koreanMeaning ?? ''}
                              onChange={e =>
                                updateBlockField(b.sentenceIdx, b.startTokenIdx, 'koreanMeaning', e.target.value)
                              }
                              placeholder={
                                b.kind === 'sentence'
                                  ? dbKorean
                                    ? `비워두면 DB 자동: ${dbKorean.slice(0, 40)}${dbKorean.length > 40 ? '…' : ''}`
                                    : '한국어 해석문 (DB 미저장)'
                                  : b.kind === 'phrase'
                                    ? '구·표현 한국어 의미 (예: 그것을 드러내다)'
                                    : '한국어 의미 (예: 드러내다)'
                              }
                              rows={b.kind === 'sentence' ? 3 : 2}
                              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm leading-relaxed resize-y min-h-[3rem]"
                            />
                            {b.kind === 'sentence' && dbKorean && !(b.koreanMeaning ?? '').trim() && (
                              <div className="text-[10px] text-emerald-400/80">
                                ✓ DB 자동: {dbKorean}
                              </div>
                            )}
                            {b.kind === 'phrase' && sentenceKo && (
                              <div
                                className="text-[10px] text-slate-400 cursor-pointer hover:text-emerald-300"
                                title="클릭하면 입력란에 채워 넣고 다듬기"
                                onClick={() =>
                                  updateBlockField(
                                    b.sentenceIdx,
                                    b.startTokenIdx,
                                    'koreanMeaning',
                                    sentenceKo,
                                  )
                                }
                              >
                                <span className="text-emerald-400/80">📋 문장 해석:</span>{' '}
                                {sentenceKo}
                              </div>
                            )}
                          </>
                        );
                      })()}
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
                <button
                  type="button"
                  onClick={() => setPreviewType('ALL')}
                  title={`통합 (${activeKindList.join('+') || '비활성'})`}
                  disabled={activeKindList.length === 0}
                  className={`text-xs px-2 py-1 rounded border font-bold ${
                    previewType === 'ALL'
                      ? 'bg-emerald-600 text-white border-emerald-400'
                      : 'border-emerald-600/60 text-emerald-300 hover:bg-emerald-700/30 disabled:opacity-40 disabled:cursor-not-allowed'
                  }`}
                >
                  통합
                </button>
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
            {overlapIssues.length > 0 && (
              <div className="p-2.5 rounded-lg border border-amber-500/50 bg-amber-950/40">
                <div className="text-[11px] font-bold text-amber-200 mb-1">
                  ⚠ 블록 겹침 {overlapIssues.length}건 — {previewType === 'ALL' ? '통합 페이지' : '해당 섹션'}에서 충돌할 수 있습니다.
                </div>
                <ul className="text-[11px] text-amber-100/90 space-y-0.5 list-disc pl-4">
                  {overlapIssues.slice(0, 4).map((it, i) => (
                    <li key={i}>{it.message}</li>
                  ))}
                  {overlapIssues.length > 4 && (
                    <li className="text-amber-300/80">… 외 {overlapIssues.length - 4}건</li>
                  )}
                </ul>
              </div>
            )}
            {passage && (
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={printPreview}
                  className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-slate-700"
                >
                  🖨 인쇄
                </button>
                <button
                  type="button"
                  onClick={downloadAsDoc}
                  className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-slate-700"
                >
                  📝 Word(.doc)
                </button>
                {previewType === 'ALL' && (
                  <button
                    type="button"
                    onClick={downloadCombinedPdf}
                    disabled={!passage || activeKindList.length === 0}
                    className="text-xs px-2 py-1 rounded bg-emerald-700/80 hover:bg-emerald-600 text-white disabled:opacity-40"
                    title="해석 포함·제외·답지 3페이지를 PDF 로 저장 (브라우저 인쇄창에서 'PDF로 저장' 선택)"
                  >
                    📄 PDF (3페이지)
                  </button>
                )}
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

      {showList && (() => {
        const folderCounts = new Map<string, number>();
        for (const it of items) {
          const key = (it.folder || '').trim() || '기본';
          folderCounts.set(key, (folderCounts.get(key) ?? 0) + 1);
        }
        // 빈 폴더(localStorage) 도 카운트 0 으로 포함
        for (const f of extraFolders) if (!folderCounts.has(f)) folderCounts.set(f, 0);
        const folderList = Array.from(folderCounts.keys()).sort((a, b) => {
          if (a === '기본') return -1;
          if (b === '기본') return 1;
          return a.localeCompare(b);
        });
        const filtered = listFolderFilter
          ? items.filter(it => ((it.folder || '').trim() || '기본') === listFolderFilter)
          : items;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setShowList(false)}
          >
            <div
              className="bg-slate-800 border border-slate-700 rounded-2xl w-[920px] max-w-[95vw] max-h-[85vh] flex flex-col shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
                <span className="font-bold">📂 저장된 워크북</span>
                <button type="button" onClick={() => setShowList(false)} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
              </div>
              <div className="flex flex-1 overflow-hidden">
                {/* 좌: 폴더 목록 사이드바 */}
                <aside className="w-[200px] border-r border-slate-700/70 bg-slate-900/40 overflow-y-auto p-2">
                  <button
                    type="button"
                    onClick={() => setListFolderFilter('')}
                    className={`w-full text-left text-xs px-2 py-1.5 rounded ${
                      listFolderFilter === '' ? 'bg-emerald-700 text-white' : 'text-slate-300 hover:bg-slate-700/60'
                    }`}
                  >
                    📁 전체 ({items.length})
                  </button>
                  <div className="mt-2 mb-1 flex items-center justify-between px-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wide">폴더</span>
                    <button
                      type="button"
                      onClick={handleAddEmptyFolder}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300"
                      title="빈 폴더 새로 만들기"
                    >
                      ➕ 추가
                    </button>
                  </div>
                  {folderList.length === 0 && (
                    <div className="text-[11px] text-slate-500 px-2 py-1">없음</div>
                  )}
                  {folderList.map(f => {
                    const count = folderCounts.get(f) ?? 0;
                    const removable = count === 0 && extraFolders.includes(f);
                    const busy = folderPdfBusy === f;
                    return (
                      <div key={f} className="flex items-stretch gap-0.5 mb-0.5">
                        <button
                          type="button"
                          onClick={() => setListFolderFilter(f)}
                          className={`flex-1 text-left text-xs px-2 py-1.5 rounded truncate ${
                            listFolderFilter === f ? 'bg-emerald-700 text-white' : 'text-slate-300 hover:bg-slate-700/60'
                          }`}
                          title={f}
                        >
                          📂 {f} ({count})
                        </button>
                        {count > 0 && (
                          <button
                            type="button"
                            onClick={() => void handleDownloadFolderPdf(f)}
                            disabled={busy}
                            className="px-1.5 text-[11px] text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
                            title={`「${f}」 폴더 ${count}건 통합 PDF (문제지 → 답지 모음)`}
                          >
                            {busy ? '⏳' : '📄'}
                          </button>
                        )}
                        {removable && (
                          <button
                            type="button"
                            onClick={() => handleRemoveEmptyFolder(f)}
                            className="px-1.5 text-[11px] text-slate-500 hover:text-red-300"
                            title="빈 폴더 제거"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {listFolderFilter && (
                    <button
                      type="button"
                      onClick={handleRenameFolder}
                      className="w-full mt-3 text-[11px] px-2 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/60"
                      title={`폴더 「${listFolderFilter}」 이름 일괄 변경`}
                    >
                      ✏ 폴더명 변경
                    </button>
                  )}
                </aside>
                {/* 우: 항목 목록 */}
                <div className="flex-1 overflow-y-auto scrollbar-thin">
                  {listLoading && <div className="p-6 text-sm text-slate-500">불러오는 중...</div>}
                  {listError && (
                    <div className="m-4 p-3 text-sm text-red-300 bg-red-950/40 border border-red-800/60 rounded">
                      {listError}
                    </div>
                  )}
                  {!listLoading && filtered.length === 0 && (
                    <div className="p-6 text-sm text-slate-500">
                      {listFolderFilter ? `폴더 「${listFolderFilter}」 에 저장된 워크북이 없습니다.` : '저장된 워크북이 없습니다.'}
                    </div>
                  )}
                  {filtered.map(it => {
                    const folder = (it.folder || '').trim() || '기본';
                    const draft = folderEditDraft[it._id];
                    const editing = draft !== undefined;
                    const editValue = editing ? draft : folder;
                    return (
                      <div key={it._id} className="px-5 py-3 border-b border-slate-700/60 flex items-center gap-3 hover:bg-slate-700/30">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm truncate">{it.title}</div>
                          <div className="text-xs text-slate-400 truncate">
                            {it.textbook} · {it.sourceKey}
                          </div>
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-1">
                              <span className="text-[11px] text-slate-500">📂</span>
                              <input
                                value={editValue}
                                onChange={e =>
                                  setFolderEditDraft(prev => ({ ...prev, [it._id]: e.target.value }))
                                }
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    void handleChangeItemFolder(it._id, editValue);
                                  } else if (e.key === 'Escape') {
                                    setFolderEditDraft(prev => {
                                      const n = { ...prev };
                                      delete n[it._id];
                                      return n;
                                    });
                                  }
                                }}
                                onBlur={() => {
                                  if (editing && (draft ?? '').trim() !== folder) {
                                    void handleChangeItemFolder(it._id, editValue);
                                  } else if (editing) {
                                    setFolderEditDraft(prev => {
                                      const n = { ...prev };
                                      delete n[it._id];
                                      return n;
                                    });
                                  }
                                }}
                                placeholder="폴더명"
                                className="w-32 text-[11px] bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5"
                              />
                            </div>
                            <div className="text-[11px] text-slate-500 flex gap-1">
                              {it.types.map(t => (
                                <span key={t} className="px-1.5 py-0.5 rounded bg-slate-700">{t}</span>
                              ))}
                            </div>
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
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
