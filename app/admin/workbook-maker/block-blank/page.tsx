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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PassagePickerModal, { PassageItem } from '../../_components/PassagePickerModal';
import BlockSelector from './_components/BlockSelector';
import {
  BlockUse,
  BlockWorkbookSelection,
  ELIGIBLE_USES_BY_KIND,
  SelectionBlock,
  WorkbookKind,
  blockUseIncludes,
  effectiveUses,
  sentenceUsesIncludes,
} from '@/lib/block-workbook-types';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import {
  buildAllHtml,
  buildCombinedHtml,
  buildConnectorBlankHtml,
  buildFolderHtml,
  buildGrammarTransformHtml,
  buildKeyExpressionHtml,
  buildPhraseBlankHtml,
  buildSentenceEssayHtml,
  buildSentenceOrderHtml,
  buildWordBlankHtml,
  estimateCombinedPageCount,
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
  I: 'I. 접속사·접속부사 빈칸',
  // 옛 데이터 호환을 위해 타입에는 남아 있지만 UI 노출 X
  E: 'E. 핵심 표현 (제거됨)',
  F: 'F. 어법 변형 (어법공략 워크북으로 이동)',
};

const TYPE_KINDS: WorkbookKind[] = ['A', 'B', 'C', 'D', 'I'];

export default function BlockWorkbookPage() {
  const [showPicker, setShowPicker] = useState(false);
  const [passage, setPassage] = useState<PassageItem | null>(null);
  const [title, setTitle] = useState('블록 빈칸 워크북');
  const [folder, setFolder] = useState('기본');
  const [blocks, setBlocks] = useState<SelectionBlock[]>([]);
  const [activeTypes, setActiveTypes] = useState<Record<WorkbookKind, boolean>>({
    A: true, B: true, C: true, D: false, I: false, E: false, F: false,
  });
  const [previewType, setPreviewType] = useState<WorkbookKind | 'ALL'>('ALL');
  /** 통합 미리보기 중에 A~F 개별 탭을 노출할지. 기본 false — 「▾ 유형별」 토글로 펼침. */
  const [showTypeTabs, setShowTypeTabs] = useState(false);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  /** 「생성할 유형」 칩 드래그 토글 — pointerdown 시 새 상태(true/false)를 기록, pointerover 로 같은 상태 적용. */
  const typeDragRef = useRef<boolean | null>(null);
  useEffect(() => {
    const end = () => { typeDragRef.current = null; };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);
  /** A4 종이 미리보기 베이스 — 너비/높이 px. 줌으로 확대/축소. */
  const PREVIEW_BASE_W = 794;
  const PREVIEW_BASE_H = 1100;
  const [previewScale, setPreviewScale] = useState(0.75);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

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
  /** 저장 목록에서 체크된 항목 id */
  const [listSelectedIds, setListSelectedIds] = useState<Set<string>>(new Set());
  const [movingSelectedFolder, setMovingSelectedFolder] = useState(false);

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
      case 'I': return buildConnectorBlankHtml(opts);
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

  /** 블록의 한국어 의미 / base form / distractor 입력 업데이트. */
  const updateBlockField = (
    sentenceIdx: number,
    startTokenIdx: number,
    field: 'koreanMeaning' | 'baseForm' | 'distractors',
    value: string,
  ) => {
    setBlocks(prev =>
      prev.map(b => {
        if (b.sentenceIdx !== sentenceIdx || b.startTokenIdx !== startTokenIdx) return b;
        if (field === 'distractors') {
          const arr = value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
          return { ...b, distractors: arr };
        }
        return { ...b, [field]: value };
      }),
    );
  };

  /** 한 블록의 특정 use(A~F) 토글. uses 가 비어 있으면 effectiveUses 로 풀어두고 토글. */
  const toggleBlockUse = (
    sentenceIdx: number,
    startTokenIdx: number,
    use: BlockUse,
  ) => {
    setBlocks(prev =>
      prev.map(b => {
        if (b.sentenceIdx !== sentenceIdx || b.startTokenIdx !== startTokenIdx) return b;
        const cur = effectiveUses(b);
        const next = cur.includes(use) ? cur.filter(u => u !== use) : [...cur, use];
        // ELIGIBLE 순서대로 정렬해서 일관성 유지
        const eligible = ELIGIBLE_USES_BY_KIND[b.kind];
        const sorted = eligible.filter(u => next.includes(u));
        return { ...b, uses: sorted };
      }),
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
      const arr = (d.items ?? []) as SavedItem[];
      // 폴더 → sourceKey 자연 정렬 (01번, 02번… 10번 순서 보장)
      arr.sort((a, b) => {
        const af = (a.folder || '').trim() || '기본';
        const bf = (b.folder || '').trim() || '기본';
        if (af !== bf) return af.localeCompare(bf, 'ko');
        return (a.sourceKey || '').localeCompare(b.sourceKey || '', 'ko', { numeric: true });
      });
      setItems(arr);
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
      const t: Record<WorkbookKind, boolean> = { A: false, B: false, C: false, D: false, I: false, E: false, F: false };
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

  /** 체크된 항목 N건의 폴더를 한 번에 일괄 이동. */
  const handleSelectedMoveFolder = async () => {
    if (listSelectedIds.size === 0) {
      alert('이동할 항목을 먼저 선택하세요.');
      return;
    }
    const allFolders = Array.from(
      new Set([...items.map(it => (it.folder || '').trim() || '기본'), ...extraFolders]),
    ).filter(Boolean);
    const hint = allFolders.length > 0 ? `\n\n현재 폴더: ${allFolders.join(', ')}` : '';
    const target = window.prompt(
      `선택한 ${listSelectedIds.size}건을 어느 폴더로 옮길까요?${hint}`,
      listFolderFilter || '기본',
    );
    const to = (target ?? '').trim();
    if (!to) return;
    setMovingSelectedFolder(true);
    setListError('');
    try {
      const ids = [...listSelectedIds];
      for (const id of ids) {
        const res = await fetch(`/api/admin/block-workbook/${id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder: to }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.ok) {
          setListError((d as { error?: string }).error ?? '일부 항목 이동 실패');
          break;
        }
      }
      setListSelectedIds(new Set());
      void fetchList();
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setMovingSelectedFolder(false);
    }
  };

  /** 폴더 단위 묶음 PDF 인쇄 — 항목 모두 fetch → buildFolderHtml → 새 창에서 print */
  const [folderPdfBusy, setFolderPdfBusy] = useState<string>('');
  /** 사이드바 폴더 행 옆 PDF 메뉴가 열린 폴더명 ('' = 닫힘) */
  const [pdfMenuFolder, setPdfMenuFolder] = useState<string>('');
  const handleDownloadFolderPdf = async (
    folder: string,
    mode: 'both' | 'with-ko' | 'no-ko' = 'both',
  ) => {
    const folderItems = items
      .filter(it => ((it.folder || '').trim() || '기본') === folder)
      .slice()
      .sort((a, b) =>
        (a.sourceKey || '').localeCompare(b.sourceKey || '', 'ko', { numeric: true }),
      );
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
      const html = buildFolderHtml(folder, entries, mode);
      const w = window.open('', '_blank');
      if (!w) {
        alert('팝업이 차단되어 PDF 인쇄 창을 열 수 없습니다. 팝업 허용 후 다시 시도하세요.');
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      const modeLabel = mode === 'with-ko' ? ' (해석 포함)' : mode === 'no-ko' ? ' (해석 제외)' : '';
      const docTitle = `폴더 ${folder} - 통합 PDF${modeLabel} (${entries.length}건)`;
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
    <>
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

        <details className="mb-4 bg-slate-800/60 border border-slate-700 rounded-xl text-sm">
          <summary className="cursor-pointer select-none px-4 py-2.5 font-bold text-slate-200 hover:bg-slate-700/40 rounded-xl">
            ❓ 사용 안내 — 클릭해서 펼치기
          </summary>
          <div className="px-4 pb-4 pt-1 space-y-3 text-[13px] text-slate-300 leading-relaxed">
            <div>
              <div className="font-bold text-emerald-300 mb-1">블록 빈칸 워크북의 정체성</div>
              <p className="text-slate-300/90">
                한 지문에서 단어/구/문장 블록을 잡아 <b>마스킹·치환·재배열</b> 방식의 변형문제 6종을 동시 생성. 어법 변형은 별도 「어법공략 워크북」 탭으로 분리됐습니다.
              </p>
            </div>
            <div>
              <div className="font-bold text-emerald-300 mb-1">1. 블록 잡기</div>
              <ul className="list-disc pl-5 space-y-0.5 text-slate-300/90">
                <li><b>단어</b>: 토큰 클릭 (1개)</li>
                <li><b>구</b>: 토큰 드래그 (2~5개)</li>
                <li><b>문장</b>: 좌측 「<span className="text-amber-300 font-bold">C</span>」(영작) / 「<span className="text-purple-300 font-bold">D</span>」(어순) 버튼 — 각각 독립 토글, 같은 문장에 둘 다 켜둘 수도 있음</li>
              </ul>
            </div>
            <div>
              <div className="font-bold text-emerald-300 mb-1">2. 유형(A~D) — 변형문제 매핑</div>
              <ul className="list-disc pl-5 space-y-0.5 text-slate-300/90">
                <li><b>A 단어 빈칸</b> — 빈칸 추론(어휘) · word 블록 자리 ___ 마스킹</li>
                <li><b>B 구 빈칸</b> — 빈칸 추론(어구) · phrase 블록 자리 ___ 마스킹</li>
                <li><b>C 문장 영작</b> — 서술형 영작 · sentence(C) 블록을 한국어로 치환</li>
                <li><b>D 어순 배열</b> — sentence(D) 블록을 5~8 청크로 셔플</li>
                <li><b>I 접속사·접속부사 빈칸</b> — word/phrase 블록 (예: However, On the other hand) 의 use 칩 「I」 켜기 → 5지선다 (정답 + distractor 4개)</li>
              </ul>
            </div>
            <div>
              <div className="font-bold text-emerald-300 mb-1">3. 입력란</div>
              <ul className="list-disc pl-5 space-y-0.5 text-slate-300/90">
                <li>C 활성 → sentence(C) 블록의 <b>한국어 해석</b> 입력 (DB sentences_ko fallback)</li>
                <li>phrase 블록 → 한국어 의미 (B 빈칸 힌트로 활용)</li>
                <li>D 는 별도 입력 불필요 — 시스템이 자동 청크 셔플</li>
                <li>I 활성 → 그 블록의 <b>distractor 4개</b> 입력 (콤마/줄바꿈). 비우거나 부족하면 기본 풀(However·Therefore·Moreover…) 에서 자동 채움. 정답 위치는 결정적 셔플.</li>
              </ul>
            </div>
            <div>
              <div className="font-bold text-emerald-300 mb-1">4. 미리보기 / 내보내기</div>
              <ul className="list-disc pl-5 space-y-0.5 text-slate-300/90">
                <li>우측 상단 「통합 / A B C D I」 탭</li>
                <li>「📄 통합 PDF」 → 본문(해석 포함) → 본문(해석 제외) → I → D → 통합 정답 → I 정답</li>
                <li>「📝 Word」 → 현재 미리보기를 .doc 로</li>
                <li>미리보기 위에서 텍스트를 직접 편집할 수 있고 인쇄·Word 에 반영됩니다</li>
              </ul>
            </div>
          </div>
        </details>

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
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-slate-400">생성할 유형</label>
                  <div className="flex gap-1">
                    {(() => {
                      const allOn = TYPE_KINDS.every(k => activeTypes[k]);
                      const noneOn = TYPE_KINDS.every(k => !activeTypes[k]);
                      return (
                        <>
                          <button
                            type="button"
                            onClick={() => setActiveTypes(Object.fromEntries(TYPE_KINDS.map(k => [k, true])) as Record<WorkbookKind, boolean>)}
                            disabled={allOn}
                            className="text-[10px] px-2 py-0.5 rounded border border-emerald-700/60 text-emerald-300 hover:bg-emerald-700/30 disabled:opacity-40"
                          >
                            전체 켜기
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveTypes(Object.fromEntries(TYPE_KINDS.map(k => [k, false])) as Record<WorkbookKind, boolean>)}
                            disabled={noneOn}
                            className="text-[10px] px-2 py-0.5 rounded border border-slate-600 text-slate-400 hover:bg-slate-700/40 disabled:opacity-40"
                          >
                            전체 끄기
                          </button>
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div
                  className="flex flex-wrap gap-1.5 select-none"
                  onPointerLeave={() => { typeDragRef.current = null; }}
                >
                  {TYPE_KINDS.map(k => {
                    const on = activeTypes[k];
                    return (
                      <button
                        key={k}
                        type="button"
                        onPointerDown={e => {
                          e.preventDefault();
                          // 첫 칩의 새 상태를 기준으로 드래그 모드 시작
                          const next = !on;
                          typeDragRef.current = next;
                          setActiveTypes(s => ({ ...s, [k]: next }));
                          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                        }}
                        onPointerEnter={() => {
                          if (typeDragRef.current === null) return;
                          const target = typeDragRef.current;
                          if (activeTypes[k] !== target) {
                            setActiveTypes(s => ({ ...s, [k]: target }));
                          }
                        }}
                        onPointerUp={() => { typeDragRef.current = null; }}
                        className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border transition-colors cursor-pointer ${
                          on
                            ? 'bg-emerald-600 text-white border-emerald-400'
                            : 'border-slate-600 text-slate-300 hover:bg-slate-700/50'
                        }`}
                        title={on ? '클릭/드래그로 끄기' : '클릭/드래그로 켜기'}
                      >
                        <span className={`text-[10px] w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${
                          on ? 'bg-white text-emerald-700 border-white' : 'border-slate-500 text-transparent'
                        }`}>
                          ✓
                        </span>
                        {TYPE_LABEL[k]}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-500 mt-1">칩 위에서 드래그하면 여러 개를 한 번에 켜거나 끌 수 있습니다.</p>
              </div>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold">블록 지정</h2>
                <span className="text-[11px] text-slate-500">클릭=단어 · 드래그=구 · 좌측 「C」=문장 영작 · 「D」=어순 배열 (각각 독립 토글)</span>
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
                <span className="px-2 py-0.5 rounded bg-amber-500/30 text-amber-100 border border-amber-500/40">문장 (C)</span>
                <span className="px-2 py-0.5 rounded bg-purple-500/30 text-purple-100 border border-purple-500/40">문장 (D)</span>
                <span className="ml-auto text-slate-500">총 블록 {blocks.length}개</span>
              </div>
            </div>

            {sortedBlocks.length > 0 && activeKindList.length > 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
                <h2 className="text-sm font-bold">블록 추가 정보 · 유형 토글</h2>
                <p className="text-[11px] text-slate-500">
                  각 블록 옆 「A·B·C·D·E·F」 칩으로 그 블록을 어떤 유형에 노출할지 켜고 끌 수 있습니다 (활성 유형만 표시).
                  {activeTypes.C && ' · 「C 문장 영작」: 한국어 해석'}
                  {activeTypes.E && ' · 「E 핵심 표현」: 모든 블록 한국어 의미'}
                  {activeTypes.F && ' · 「F 어법 변형」: 단어 블록 base form'}
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
                  // - sentence: C 활성 + 그 블록이 C 용도여야 (D 전용은 한국어 불필요)
                  // - phrase: 항상 (편집 가능 + 통합/E 에 활용)
                  // - word: E 활성
                  const sentenceUsesC = b.kind !== 'sentence' || sentenceUsesIncludes(b, 'C');
                  const needKorean = sentenceUsesC && (
                    (activeTypes.C && b.kind === 'sentence') ||
                    (b.kind === 'phrase' && (blockUseIncludes(b, 'B') || blockUseIncludes(b, 'E'))) ||
                    (activeTypes.E && blockUseIncludes(b, 'E'))
                  );
                  const needBaseForm = activeTypes.F && b.kind === 'word' && blockUseIncludes(b, 'F');
                  const needDistractors = activeTypes.I && (b.kind === 'word' || b.kind === 'phrase') && blockUseIncludes(b, 'I');

                  // use 토글 칩 — 활성 유형(activeTypes) 안에서만 표시
                  const eligibleUses = ELIGIBLE_USES_BY_KIND[b.kind];
                  const useChips = eligibleUses.filter(u => activeTypes[u]);

                  if (!needKorean && !needBaseForm && !needDistractors && useChips.length === 0) return null;

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
                        {useChips.length > 0 && (
                          <div className="flex gap-0.5 shrink-0">
                            {useChips.map(u => {
                              const on = blockUseIncludes(b, u);
                              return (
                                <button
                                  key={u}
                                  type="button"
                                  onClick={() => toggleBlockUse(b.sentenceIdx, b.startTokenIdx, u)}
                                  className={`text-[10px] px-1.5 py-0.5 rounded border font-bold transition-colors ${
                                    on
                                      ? 'bg-emerald-600 text-white border-emerald-400'
                                      : 'border-slate-600 text-slate-500 hover:bg-slate-700/40'
                                  }`}
                                  title={`${u} 유형에서 ${on ? '제외' : '포함'}`}
                                >
                                  {u}
                                </button>
                              );
                            })}
                          </div>
                        )}
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
                      {needDistractors && (() => {
                        const dArr = b.distractors ?? [];
                        const count = Math.min(dArr.length, 4);
                        return (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-slate-400">I. 오답 보기 (4개)</span>
                              <span className={count >= 4 ? 'text-emerald-400' : count > 0 ? 'text-amber-400' : 'text-slate-500'}>
                                {count}/4 입력{count < 4 ? ` · 나머지는 기본 풀에서 자동 채움` : ''}
                              </span>
                            </div>
                            <textarea
                              value={dArr.join('\n')}
                              onChange={e => updateBlockField(b.sentenceIdx, b.startTokenIdx, 'distractors', e.target.value)}
                              placeholder="한 줄에 하나, 또는 콤마로 구분 — 예) However, Therefore, Moreover, In addition"
                              rows={3}
                              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm leading-relaxed resize-y min-h-[3rem]"
                            />
                          </div>
                        );
                      })()}
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

          {/* 우: 미리보기 — 서술형 제작기 패턴 (A4 카드 + 줌 + designMode) */}
          <section className="bg-slate-800 border border-slate-700 rounded-xl flex flex-col overflow-hidden lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)]">
            {/* 헤더 — 제목 + 줌 + 액션 */}
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-700 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="font-bold text-white">미리보기</span>
                {passage && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium">
                    {previewType === 'ALL' ? '통합' : `유형 ${previewType}`}
                  </span>
                )}
                {passage && (
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
              {passage && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={downloadAsDoc}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/60 transition-colors font-medium"
                  >
                    📝 Word
                  </button>
                  {previewType === 'ALL' && (() => {
                    const pageCount = estimateCombinedPageCount(activeKindList);
                    return (
                      <button
                        type="button"
                        onClick={downloadCombinedPdf}
                        disabled={activeKindList.length === 0}
                        className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors font-semibold"
                        title="활성 유형 전체를 묶은 통합 PDF"
                      >
                        📄 통합 PDF ({pageCount}p)
                      </button>
                    );
                  })()}
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

            {/* 유형 탭 — 통합일 땐 A~F 접고, 작은 「유형별 ▾」 토글로 펼침 */}
            <div className="shrink-0 px-4 py-2 border-b border-slate-700/70 bg-slate-900/40 flex items-center gap-1 flex-wrap">
              <button
                type="button"
                onClick={() => setPreviewType('ALL')}
                title={`통합 (${activeKindList.join('+') || '비활성'})`}
                disabled={activeKindList.length === 0}
                className={`text-xs px-3 py-1.5 rounded-md border font-bold transition-colors ${
                  previewType === 'ALL'
                    ? 'bg-emerald-600 text-white border-emerald-400'
                    : 'border-emerald-600/60 text-emerald-300 hover:bg-emerald-700/30 disabled:opacity-40 disabled:cursor-not-allowed'
                }`}
              >
                통합
              </button>
              {(previewType !== 'ALL' || showTypeTabs) ? (
                <>
                  <span className="text-slate-600 mx-1">|</span>
                  {TYPE_KINDS.map(k => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setPreviewType(k)}
                      title={TYPE_LABEL[k]}
                      className={`text-xs px-2.5 py-1.5 rounded-md border font-medium transition-colors ${
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
                  {previewType === 'ALL' && (
                    <button
                      type="button"
                      onClick={() => setShowTypeTabs(false)}
                      className="ml-1 text-[11px] px-2 py-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-700/40"
                      title="유형별 탭 접기"
                    >
                      ▴ 접기
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowTypeTabs(true)}
                  className="ml-1 text-[11px] px-2 py-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-700/40"
                  title="개별 유형 미리보기 펼치기"
                >
                  ▾ 유형별
                </button>
              )}
            </div>

            {/* 겹침 경고 */}
            {overlapIssues.length > 0 && (
              <div className="shrink-0 mx-4 mt-3 p-2.5 rounded-lg border border-amber-500/50 bg-amber-950/40">
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

            {/* A4 카드 */}
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
                      title="블록 워크북 미리보기"
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
                  <p className="text-base font-medium text-slate-400">지문을 선택하세요</p>
                  <p className="text-sm mt-1">우측 상단 「지문 불러오기」로 시작</p>
                </div>
              )}
            </div>
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
                    const menuOpen = pdfMenuFolder === f;
                    return (
                      <div key={f} className="mb-0.5">
                        <div className="flex items-stretch gap-0.5">
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
                              onClick={() => setPdfMenuFolder(menuOpen ? '' : f)}
                              disabled={busy}
                              className={`px-1.5 text-[11px] disabled:opacity-50 ${
                                menuOpen
                                  ? 'text-white bg-emerald-700 rounded'
                                  : 'text-emerald-300 hover:text-emerald-200'
                              }`}
                              title={`「${f}」 폴더 ${count}건 통합 PDF — 한국어 해석 옵션 선택`}
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
                        {menuOpen && count > 0 && (
                          <div className="mt-1 mb-1 ml-2 p-1.5 rounded border border-emerald-700/60 bg-slate-900/80 flex flex-col gap-1">
                            <div className="text-[10px] text-slate-400 px-1">한국어 해석</div>
                            <button
                              type="button"
                              onClick={() => { setPdfMenuFolder(''); void handleDownloadFolderPdf(f, 'both'); }}
                              className="text-[11px] text-left px-2 py-1 rounded text-slate-200 hover:bg-emerald-700/40"
                            >
                              📦 전체 (포함 + 제외)
                            </button>
                            <button
                              type="button"
                              onClick={() => { setPdfMenuFolder(''); void handleDownloadFolderPdf(f, 'with-ko'); }}
                              className="text-[11px] text-left px-2 py-1 rounded text-emerald-200 hover:bg-emerald-700/40"
                            >
                              📄 해석 있는 것만
                            </button>
                            <button
                              type="button"
                              onClick={() => { setPdfMenuFolder(''); void handleDownloadFolderPdf(f, 'no-ko'); }}
                              className="text-[11px] text-left px-2 py-1 rounded text-rose-200 hover:bg-rose-700/40"
                            >
                              📄 해석 없는 것만
                            </button>
                          </div>
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
                  {!listLoading && filtered.length > 0 && (() => {
                    const visibleIds = filtered.map(it => it._id);
                    const allSelected = visibleIds.length > 0 && visibleIds.every(id => listSelectedIds.has(id));
                    const selectedCount = visibleIds.filter(id => listSelectedIds.has(id)).length;
                    return (
                      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-700/60 bg-slate-900/40 sticky top-0 z-[1]">
                        <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={el => { if (el) el.indeterminate = selectedCount > 0 && !allSelected; }}
                            onChange={() => {
                              setListSelectedIds(prev => {
                                const next = new Set(prev);
                                if (allSelected) visibleIds.forEach(id => next.delete(id));
                                else visibleIds.forEach(id => next.add(id));
                                return next;
                              });
                            }}
                            className="w-3.5 h-3.5 accent-blue-500"
                          />
                          전체 선택
                        </label>
                        {selectedCount > 0 && (
                          <button
                            type="button"
                            onClick={handleSelectedMoveFolder}
                            disabled={movingSelectedFolder}
                            className="text-xs px-2.5 py-1 rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50"
                            title="선택한 항목을 특정 폴더로 일괄 이동"
                          >
                            {movingSelectedFolder ? '이동 중…' : `선택 ${selectedCount}건 폴더 이동`}
                          </button>
                        )}
                        <span className="ml-auto text-[11px] text-slate-500">총 {filtered.length}건</span>
                      </div>
                    );
                  })()}
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
                        <label className="shrink-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={listSelectedIds.has(it._id)}
                            onChange={() => {
                              setListSelectedIds(prev => {
                                const n = new Set(prev);
                                if (n.has(it._id)) n.delete(it._id);
                                else n.add(it._id);
                                return n;
                              });
                            }}
                            className="w-3.5 h-3.5 accent-blue-500"
                          />
                        </label>
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
    </>
  );
}
