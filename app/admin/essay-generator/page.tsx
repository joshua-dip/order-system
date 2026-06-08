'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '../_components/AdminSidebar';
import PassagePickerModal, { PassageItem } from '../_components/PassagePickerModal';
import { ESSAY_DIFFICULTY_APPENDIX_TEXT, ESSAY_DIFFICULTY_APPENDIX_LAST_UPDATED } from '@/lib/essay-generator-difficulty-appendix';

// ── 인쇄 보정 CSS (기존 HTML에 오래된 CSS가 있을 때 최신 규칙 덮어쓰기) ──────────
const PRINT_FIX_CSS = `
  .diff-badge, .diff-badge.diff-mid, .diff-badge.diff-low,
  .q-head, .q-head .tag, .answer-header,
  .ans-q-tag, .ans-answer, .ans-table th, .word-count,
  .svoc-legend, .svoc-legend-chip,
  .svoc-S, .svoc-V, .svoc-O, .svoc-C, .svoc-M,
  .svoc-inner-S, .svoc-inner-V, .svoc-inner-O, .svoc-inner-C, .svoc-inner-M {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .sub-q { page-break-inside: avoid !important; break-inside: avoid !important; }
  .condition-box { page-break-after: avoid !important; break-after: avoid !important; }
  .ans-area { page-break-inside: avoid !important; break-inside: avoid !important; }
  .header { padding-bottom: 4pt !important; margin-bottom: 6pt !important; }
  .q-head { padding: 3.5pt 9pt !important; margin: 6pt 0 5pt 0 !important; }
  .passage { line-height: 1.45 !important; padding: 1pt 2pt !important; }
  .sub-q { margin-top: 5pt !important; }
  .sub-q-title { margin-bottom: 3pt !important; }
  .condition-box { padding: 4pt 8pt !important; line-height: 1.4 !important; }
  .condition-box .label { margin-bottom: 1pt !important; margin-top: 1.5pt !important; }
  .condition-box ul { margin: 0.5pt 0 1pt 0 !important; }
  .bogi { line-height: 1.4 !important; }
  .ans-area { margin-top: 4pt !important; }
  .ans-area .write-row { height: 13pt !important; margin-top: 2pt !important; }
`;

// ── PDF 파일명 유틸 ─────────────────────────────────────────────────────────────

/**
 * OS 금지 문자(`/ \ : * ? " < > |`) 를 공백으로 치환하고 길이 제한.
 * 브라우저 PDF 저장 다이얼로그가 document.title 을 그대로 파일명에 쓰므로 안전 처리.
 */
function sanitizeFilename(name: string, max: number = 120): string {
  return name
    .replace(/[/\\:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** "기본난도" → "기본", "최고난도" → "최고" */
function shortDifficulty(d: string): string {
  return (d ?? '').replace(/난도$/, '').trim() || d;
}

/** 새 창의 <title> 을 안전하게 교체·삽입 + document.title 도 보강 설정. */
function escapeHtmlInline(s: string): string {
  return s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
}

// ── 타입 ───────────────────────────────────────────────────────────────────────

interface ExamQuestion {
  id: string;
  points: number;
  prompt: string;
  conditions: string[];
  bogi: string;
  answer_lines?: number;
  answer: {
    text: string;
    structure_analysis?: { label: string; content: string }[];
    grammar_points: { title: string; content: string }[];
    word_count: { total: number; words: string[]; note: string | null };
    intent_title?: string;
    intent_content: string;
  };
}

interface ExamData {
  meta: {
    title: string;
    difficulty?: string;
    subtitle: string;
    answer_subtitle?: string;
    info: { label: string; value: string }[];
  };
  question_set: { tag: string; instruction: string };
  passage: string;
  questions: ExamQuestion[];
}

// ── 저장 목록 타입 ──────────────────────────────────────────────────────────────

interface SavedExamItem {
  _id: string;
  title: string;
  textbook: string;
  sourceKey: string;
  difficulty: string;
  folder: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

// ── 저장된 목록 패널 ───────────────────────────────────────────────────────────

function SavedListPanel({
  onLoad,
  onClose,
  currentId,
}: {
  onLoad: (item: { data: ExamData; html: string; id: string; title: string; folder?: string; textbook?: string; sourceKey?: string; passageId?: string; difficulty?: string }) => void;
  onClose: () => void;
  currentId: string | null;
}) {
  const [items, setItems] = useState<SavedExamItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [movingFolderId, setMovingFolderId] = useState<string | null>(null);
  const [printingFolder, setPrintingFolder] = useState<string | null>(null);
  const [printingGroupKey, setPrintingGroupKey] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [printingSelected, setPrintingSelected] = useState(false);
  /** 접힌 sourceKey 그룹. 명시적으로 접힘으로 표시된 키만 들어있고, 다른 키는 펼침. */
  const [collapsedSourceKeys, setCollapsedSourceKeys] = useState<Set<string>>(new Set());
  /** 사이드바 폴더 필터. '' = 전체 */
  const [folderFilter, setFolderFilter] = useState('');
  /** 인라인 폴더 편집 중인 항목 id → 새 폴더명 */
  const [folderEditDraft, setFolderEditDraft] = useState<Record<string, string>>({});
  /** 드래그 중인 그룹 sourceKey */
  const [draggingSk, setDraggingSk] = useState<string | null>(null);
  /** drop target hover 표시용 sourceKey */
  const [dropTargetSk, setDropTargetSk] = useState<string | null>(null);
  /** 전체선택 출력 모드 선택 모달 */
  const [bulkPrintModalOpen, setBulkPrintModalOpen] = useState(false);

  /** 서버측 폴더별 도큐먼트 카운트 (사이드바용). 폴더 필터와 무관하게 항상 정확. */
  const [serverFolderCounts, setServerFolderCounts] = useState<Record<string, number>>({});

  const fetchList = useCallback(async (overrideFolder?: string) => {
    setLoading(true);
    const f = overrideFolder !== undefined ? overrideFolder : folderFilter;
    const qs = f ? `?folder=${encodeURIComponent(f)}` : '';
    const res = await fetch(`/api/admin/essay-generator/exams${qs}`, { credentials: 'include' });
    const d = await res.json();
    setItems(d.items ?? []);
    setFolders(d.folders ?? ['기본']);
    if (d.folderCounts && typeof d.folderCounts === 'object') {
      setServerFolderCounts(d.folderCounts as Record<string, number>);
    }
    setLoading(false);
  }, [folderFilter]);

  useEffect(() => { fetchList(); }, [fetchList]);

  /** 목록이 갱신될 때 2개 이상 그룹은 자동으로 접힘 상태로 시작. 사용자가 토글로 펼침. */
  useEffect(() => {
    if (items.length === 0) return;
    const counts = new Map<string, number>();
    for (const it of items) {
      const sk = (it.sourceKey ?? '').trim();
      if (!sk) continue;
      counts.set(sk, (counts.get(sk) ?? 0) + 1);
    }
    const toCollapse = new Set<string>();
    for (const [sk, n] of counts) if (n >= 2) toCollapse.add(sk);
    setCollapsedSourceKeys(prev => {
      /* 이미 사용자가 펼쳐둔 상태는 보존 — 새로 등장한 그룹만 접힘 적용 */
      const next = new Set(prev);
      for (const sk of toCollapse) if (!next.has(sk)) next.add(sk);
      /* 사라진 sourceKey 제거 */
      const presentSks = new Set(counts.keys());
      for (const sk of [...next]) if (!presentSks.has(sk)) next.delete(sk);
      return next;
    });
  }, [items]);

  const toggleGroupCollapse = useCallback((sourceKey: string) => {
    setCollapsedSourceKeys(prev => {
      const next = new Set(prev);
      if (next.has(sourceKey)) next.delete(sourceKey); else next.add(sourceKey);
      return next;
    });
  }, []);

  const handleLoad = async (id: string) => {
    const res = await fetch(`/api/admin/essay-generator/exams/${id}`, { credentials: 'include' });
    const d = await res.json();
    if (d.item) {
      const it = d.item as { data: ExamData; html: string; title: string; folder?: string; textbook?: string; sourceKey?: string; passageId?: string; difficulty?: string };
      onLoad({
        data: it.data,
        html: it.html,
        id,
        title: it.title,
        folder: typeof it.folder === 'string' ? it.folder : undefined,
        textbook: it.textbook,
        sourceKey: it.sourceKey,
        passageId: it.passageId,
        difficulty: it.difficulty,
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    setDeletingId(id);
    await fetch(`/api/admin/essay-generator/exams/${id}`, { method: 'DELETE', credentials: 'include' });
    setItems(prev => prev.filter(i => i._id !== id));
    setDeletingId(null);
  };

  const handleMove = async (id: string, dir: 'up' | 'down') => {
    setMovingId(id);
    await fetch(`/api/admin/essay-generator/exams/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ move: dir }),
    });
    await fetchList();
    setMovingId(null);
  };

  const handleChangeItemFolder = async (id: string, newFolder: string) => {
    const target = (newFolder || '').trim() || '기본';
    setMovingFolderId(id);
    setError('');
    try {
      const res = await fetch(`/api/admin/essay-generator/exams/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ folder: target }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(typeof d.error === 'string' ? d.error : '폴더 이동 실패');
        return;
      }
      setFolderEditDraft(prev => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
      await fetchList();
    } catch (e) {
      console.error(e);
      setError('폴더 이동 실패');
    } finally {
      setMovingFolderId(null);
    }
  };

  const handleFolderPrint = async (folder: string) => {
    setPrintingFolder(folder);
    try {
      const res = await fetch(`/api/admin/essay-generator/folder-print?folder=${encodeURIComponent(folder)}`, { credentials: 'include' });
      const d = await res.json();
      if (!d.html) { alert('출력 실패'); return; }

      const count = typeof d.count === 'number' ? d.count : 0;
      const pdfTitle = sanitizeFilename(count > 0 ? `${folder} 폴더 (${count}건)` : `${folder} 폴더`);
      let injected: string = d.html;
      if (/<title[^>]*>[\s\S]*?<\/title>/i.test(injected)) {
        injected = injected.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeHtmlInline(pdfTitle)}</title>`);
      } else if (injected.includes('</head>')) {
        injected = injected.replace('</head>', `<title>${escapeHtmlInline(pdfTitle)}</title></head>`);
      }
      injected = injected.replace('</head>', `<style>${PRINT_FIX_CSS}</style></head>`);
      const blob = new Blob([injected], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (!w) { URL.revokeObjectURL(url); alert('팝업이 차단되었습니다.'); return; }
      w.addEventListener('afterprint', () => { URL.revokeObjectURL(url); });
      w.onload = () => {
        try { w.document.title = pdfTitle; } catch { /* ignore */ }
        w.focus();
        w.print();
      };
    } catch (err) {
      console.error('[folder-print]', err);
      alert('출력 중 오류: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setPrintingFolder(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /** 체크된 항목 N건의 폴더를 한 번에 이동. */
  const [movingSelected, setMovingSelected] = useState(false);
  const handleSelectedMoveFolder = async () => {
    if (selectedIds.size === 0) {
      alert('이동할 항목을 먼저 선택하세요.');
      return;
    }
    const hint = folders.length > 0 ? `\n\n현재 폴더: ${folders.join(', ')}` : '';
    const target = window.prompt(
      `선택한 ${selectedIds.size}건을 어느 폴더로 옮길까요?${hint}`,
      folderFilter || '기본',
    );
    const to = (target ?? '').trim();
    if (!to) return;
    setMovingSelected(true);
    setError('');
    try {
      const ids = [...selectedIds];
      for (const id of ids) {
        const res = await fetch(`/api/admin/essay-generator/exams/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ folder: to }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError(typeof d.error === 'string' ? d.error : '일부 항목 이동 실패');
          break;
        }
      }
      setSelectedIds(new Set());
      await fetchList();
    } catch (e) {
      console.error(e);
      setError('폴더 이동 실패');
    } finally {
      setMovingSelected(false);
    }
  };

  /** 같은 sourceKey 를 공유하는 항목들을 한 PDF 로 묶어 출력 (예: 한 지문의 4 난이도) */
  /**
   * sourceKey 그룹 단위 드래그앤드랍 순서 변경.
   * fromSk 의 모든 항목을 toSk 그룹의 위(또는 아래)로 이동.
   */
  const reorderGroups = async (fromSk: string, toSk: string) => {
    if (fromSk === toSk) return;
    /* 같은 폴더 안에서만 reorder */
    const fromItems = items.filter(i => (i.sourceKey ?? '').trim() === fromSk.trim());
    const toItems = items.filter(i => (i.sourceKey ?? '').trim() === toSk.trim());
    if (fromItems.length === 0 || toItems.length === 0) return;
    const fromFolder = fromItems[0].folder ?? '기본';
    const toFolder = toItems[0].folder ?? '기본';
    if (fromFolder !== toFolder) return;  /* 다른 폴더 간 reorder 는 미지원 */

    /* 같은 폴더의 모든 items 를 sourceKey 그룹 순서대로 펼친 배열 만들기 */
    const folderItems = items.filter(i => (i.folder ?? '기본') === fromFolder);
    /* sourceKey 별로 묶기 (등장 순서 유지) */
    const groupMap = new Map<string, SavedExamItem[]>();
    for (const it of folderItems) {
      const sk = (it.sourceKey ?? '').trim() || '__nosk__';
      if (!groupMap.has(sk)) groupMap.set(sk, []);
      groupMap.get(sk)!.push(it);
    }
    const groupOrder = [...groupMap.keys()];
    const fromIdx = groupOrder.indexOf(fromSk);
    const toIdx = groupOrder.indexOf(toSk);
    if (fromIdx < 0 || toIdx < 0) return;
    groupOrder.splice(fromIdx, 1);
    /* fromIdx < toIdx 일 때 toIdx 위치가 1 줄어드는 점 보정 — splice 후 toSk 인덱스를 다시 찾는 게 안전 */
    const newToIdx = groupOrder.indexOf(toSk);
    groupOrder.splice(newToIdx, 0, fromSk);

    /* 새 ordered id 배열 */
    const orderedIds: string[] = [];
    for (const sk of groupOrder) {
      for (const it of groupMap.get(sk) ?? []) orderedIds.push(it._id);
    }

    /* optimistic UI: 클라이언트 즉시 reorder */
    setItems(prev => {
      const byId = new Map(prev.map(it => [it._id, it] as const));
      const otherFolder = prev.filter(i => (i.folder ?? '기본') !== fromFolder);
      const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean) as SavedExamItem[];
      return [...otherFolder, ...reordered];
    });

    try {
      await fetch('/api/admin/essay-generator/exams/reorder', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
    } catch (err) {
      console.error('[reorder]', err);
      setError('재정렬 실패 — 새로고침 후 다시 시도하세요.');
      void fetchList();
    }
  };

  const handleGroupPrint = async (sourceKey: string) => {
    const group = items.filter(it => (it.sourceKey ?? '').trim() === sourceKey.trim());
    if (group.length === 0) return;
    /* 난이도 순서로 정렬 (기본 → 중 → 고 → 최고) */
    const diffOrder: Record<string, number> = { 기본난도: 0, 중난도: 1, 고난도: 2, 최고난도: 3 };
    const ordered = [...group].sort((a, b) => (diffOrder[a.difficulty] ?? 99) - (diffOrder[b.difficulty] ?? 99));

    setPrintingGroupKey(sourceKey);
    try {
      const params = new URLSearchParams();
      ordered.forEach(g => params.append('ids', g._id));
      const res = await fetch(`/api/admin/essay-generator/folder-print?${params}`, { credentials: 'include' });
      const d = await res.json();
      if (!d.html) { alert('출력 실패'); return; }

      const diffsLabel = ordered.map(x => shortDifficulty(x.difficulty)).filter(Boolean).join('·');
      const pdfTitle = sanitizeFilename(`${sourceKey} (${diffsLabel})`);
      const escTitle = escapeHtmlInline(pdfTitle);
      let injected: string = d.html;
      if (/<title[^>]*>[\s\S]*?<\/title>/i.test(injected)) {
        injected = injected.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${escTitle}</title>`);
      } else if (injected.includes('</head>')) {
        injected = injected.replace('</head>', `<title>${escTitle}</title></head>`);
      } else {
        injected = `<title>${escTitle}</title>${injected}`;
      }
      injected = injected.includes('</head>')
        ? injected.replace('</head>', `<style>${PRINT_FIX_CSS}</style></head>`)
        : `<style>${PRINT_FIX_CSS}</style>${injected}`;

      const blob = new Blob([injected], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (!w) { URL.revokeObjectURL(url); alert('팝업이 차단되었습니다.'); return; }
      w.addEventListener('afterprint', () => { URL.revokeObjectURL(url); });
      w.onload = () => {
        try { w.document.title = pdfTitle; } catch { /* ignore */ }
        w.focus();
        w.print();
      };
    } catch (err) {
      console.error('[group-print]', err);
      alert('출력 중 오류: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setPrintingGroupKey(null);
    }
  };

  /** PDF 생성·창 띄우기 공통 헬퍼 — 받은 ids 로 folder-print 호출 후 새 창에서 print(). */
  const openPrintForIds = async (ids: string[], pdfTitle: string) => {
    if (ids.length === 0) return;
    const params = new URLSearchParams();
    ids.forEach(id => params.append('ids', id));
    const res = await fetch(`/api/admin/essay-generator/folder-print?${params}`, { credentials: 'include' });
    const d = await res.json();
    if (!d.html) throw new Error('출력 실패');

    let injected: string = d.html;
    const escTitle = escapeHtmlInline(pdfTitle);
    if (/<title[^>]*>[\s\S]*?<\/title>/i.test(injected)) {
      injected = injected.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${escTitle}</title>`);
    } else if (injected.includes('</head>')) {
      injected = injected.replace('</head>', `<title>${escTitle}</title></head>`);
    }
    injected = injected.includes('</head>')
      ? injected.replace('</head>', `<style>${PRINT_FIX_CSS}</style></head>`)
      : `<style>${PRINT_FIX_CSS}</style>${injected}`;

    const blob = new Blob([injected], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) { URL.revokeObjectURL(url); throw new Error('팝업이 차단되었습니다.'); }
    w.addEventListener('afterprint', () => { URL.revokeObjectURL(url); });
    w.onload = () => {
      try { w.document.title = pdfTitle; } catch { /* ignore */ }
      w.focus();
      w.print();
    };
  };

  /** 선택된 항목들을 mode 에 따라 분할 출력 */
  const runBulkPrint = async (mode: 'single' | 'per-source' | 'per-difficulty') => {
    if (selectedIds.size === 0) { alert('출력할 항목을 선택해 주세요.'); return; }
    setPrintingSelected(true);
    setBulkPrintModalOpen(false);
    try {
      const selectedItems = items.filter(it => selectedIds.has(it._id));

      const diffOrder: Record<string, number> = { 기본난도: 0, 중난도: 1, 고난도: 2, 최고난도: 3 };

      if (mode === 'single') {
        /* 단일 모드 — 한 PDF 합본. 파일명: 「교재명 폴더명 전체」 패턴.
           단일 항목이면 sourceKey 그대로, 여러 교재면 "외 N개" 폴백. */
        const textbookSet = new Set<string>();
        const folderSet = new Set<string>();
        for (const it of selectedItems) {
          const tb = (it.textbook ?? '').trim();
          if (tb) textbookSet.add(tb);
          const fd = (it.folder ?? '').trim();
          if (fd) folderSet.add(fd);
        }
        const textbooks = [...textbookSet];
        const folders = [...folderSet];

        let rawTitle: string;
        if (selectedItems.length === 1) {
          rawTitle = selectedItems[0]?.sourceKey?.trim() || selectedItems[0]?.textbook?.trim() || '선택 1건';
        } else if (textbooks.length === 0) {
          rawTitle = `선택 ${selectedItems.length}건`;
        } else if (textbooks.length === 1 && folders.length === 1) {
          rawTitle = `${textbooks[0]} ${folders[0]} 전체`;
        } else if (textbooks.length === 1) {
          rawTitle = `${textbooks[0]} 전체`;
        } else {
          rawTitle = `${textbooks[0]} 외 ${textbooks.length - 1}개`;
        }
        const title = sanitizeFilename(rawTitle);
        await openPrintForIds(selectedItems.map(i => i._id), title);
        return;
      }

      /* per-source / per-difficulty — 서버에서 그룹별 PDF 생성 후 ZIP 으로 묶어 한 번에 다운로드.
         다이얼로그 1번 + ZIP 풀면 한 폴더에 PDF N개 (파일명: 그룹명.pdf). */
      let groups: Array<{ name: string; ids: string[] }>;

      if (mode === 'per-source') {
        const bySk = new Map<string, SavedExamItem[]>();
        for (const it of selectedItems) {
          const sk = (it.sourceKey ?? '').trim() || '미분류';
          if (!bySk.has(sk)) bySk.set(sk, []);
          bySk.get(sk)!.push(it);
        }
        groups = [...bySk.entries()].map(([sk, items]) => ({
          name: sk,
          ids: [...items]
            .sort((a, b) => (diffOrder[a.difficulty] ?? 99) - (diffOrder[b.difficulty] ?? 99))
            .map(i => i._id),
        }));
      } else {
        const byDiff = new Map<string, SavedExamItem[]>();
        for (const it of selectedItems) {
          const d = it.difficulty || '기타';
          if (!byDiff.has(d)) byDiff.set(d, []);
          byDiff.get(d)!.push(it);
        }
        const diffOrderList = ['기본난도', '중난도', '고난도', '최고난도'];
        const orderedKeys = [
          ...diffOrderList.filter(d => byDiff.has(d)),
          ...[...byDiff.keys()].filter(d => !diffOrderList.includes(d)),
        ];
        groups = orderedKeys.map(d => ({
          name: d,
          ids: byDiff.get(d)!.map(i => i._id),
        }));
      }

      /* ZIP 파일명 — 선택 항목의 교재명 기반. 같은 교재만 있으면 그 이름 그대로,
         여러 교재 섞이면 "교재A 외 N개". 난도별 모드는 뒤에 _난도별 접미사. */
      const textbookSet = new Set<string>();
      for (const it of selectedItems) {
        const tb = (it.textbook ?? '').trim();
        if (tb) textbookSet.add(tb);
      }
      const textbookList = [...textbookSet];
      const firstTextbook = textbookList[0] ?? '서술형';
      const textbookLabel =
        textbookList.length <= 1
          ? firstTextbook
          : `${firstTextbook} 외 ${textbookList.length - 1}개`;
      const zipName = sanitizeFilename(
        mode === 'per-difficulty' ? `${textbookLabel}_난도별` : textbookLabel,
      ) + '.zip';

      const res = await fetch('/api/admin/essay-generator/bulk-pdf-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ groups, zipName }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(typeof d.error === 'string' ? d.error : `ZIP 생성 실패 (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      /* 서버가 Content-Disposition 으로 한글 파일명 제안 — 브라우저가 그걸 우선 사용 */
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      console.error('[selected-print]', err);
      alert('출력 중 오류: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setPrintingSelected(false);
    }
  };

  /** 빈 폴더 생성 — placeholder 항목 1개 insert (서버에 폴더 자체 컬렉션이 없어 항목으로 표현) */
  const handleAddEmptyFolder = async () => {
    const name = window.prompt('새 폴더 이름을 입력하세요');
    const trimmed = (name ?? '').trim();
    if (!trimmed) return;
    if (folders.includes(trimmed)) {
      setFolderFilter(trimmed);
      return;
    }
    setError('');
    try {
      const res = await fetch('/api/admin/essay-generator/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: `[${trimmed}] 폴더`,
          textbook: '',
          sourceKey: '',
          difficulty: '',
          folder: trimmed,
          isPlaceholder: true,
          data: { meta: { title: '', subtitle: '', info: [] }, question_set: { tag: '', instruction: '' }, passage: '', questions: [] },
          html: '',
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof d.error === 'string' ? d.error : '폴더 생성에 실패했습니다.');
        return;
      }
      await fetchList();
      setFolderFilter(trimmed);
    } catch (e) {
      console.error(e);
      setError('폴더 생성에 실패했습니다.');
    }
  };

  /** 현재 선택된 폴더명을 일괄 이름변경. */
  const handleRenameFolder = async () => {
    const from = folderFilter.trim();
    if (!from) {
      setError('이름을 바꿀 폴더를 먼저 선택하세요.');
      return;
    }
    const next = window.prompt(`폴더 「${from}」 의 새 이름을 입력하세요`, from);
    const to = (next ?? '').trim();
    if (!to || to === from) return;
    if (folders.includes(to)) {
      setError(`폴더 「${to}」 가 이미 있습니다.`);
      return;
    }
    setError('');
    try {
      const res = await fetch('/api/admin/essay-generator/rename-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ oldName: from, newName: to }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        setError(typeof d.error === 'string' ? d.error : '폴더 이름 변경 실패');
        return;
      }
      await fetchList();
      setFolderFilter(to);
    } catch (e) {
      console.error(e);
      setError('폴더 이름 변경 실패');
    }
  };

  const handleDeleteFolder = async (folder: string, itemCount: number) => {
    const msg = itemCount > 0
      ? `"${folder}" 폴더와 그 안의 문제 ${itemCount}개를 모두 삭제합니다. 계속할까요?`
      : `"${folder}" 폴더를 삭제합니다.`;
    if (!confirm(msg)) return;
    try {
      await fetch('/api/admin/essay-generator/delete-folder', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ folder }),
      });
      await fetchList();
    } catch (e) {
      console.error(e);
    }
  };

  const fmt = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  /** 사이드바 카운트는 서버 aggregation 우선 (limit 영향 없음). 서버 값 없으면 client items 로 폴백. */
  const folderCounts = new Map<string, number>();
  if (Object.keys(serverFolderCounts).length > 0) {
    for (const [k, v] of Object.entries(serverFolderCounts)) folderCounts.set(k, v);
  } else {
    for (const it of items) {
      const key = (it.folder || '').trim() || '기본';
      folderCounts.set(key, (folderCounts.get(key) ?? 0) + 1);
    }
  }
  for (const f of folders) if (!folderCounts.has(f)) folderCounts.set(f, 0);
  const folderList = Array.from(folderCounts.keys()).sort((a, b) => {
    if (a === '기본') return -1;
    if (b === '기본') return 1;
    return a.localeCompare(b, 'ko');
  });
  /* 서버측에서 이미 folder 로 필터링했으므로 클라이언트 추가 필터링 불필요.
     단, 전체 모드(folderFilter === '')에선 items 가 전체이고 사용자가 즉시 폴더 클릭하면 fetchList 가 재요청. */
  const filteredItems = items;
  const visibleIds = filteredItems.map(it => it._id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
  const selectedInView = visibleIds.filter(id => selectedIds.has(id)).length;

  /* filteredItems 를 sourceKey 별로 그룹화 (첫 등장 순서 보존).
     2 개 이상이면 그룹 헤더 + 접기/펼치기. 1 개면 헤더 없이 단독 행. */
  interface GroupedItem { sk: string; items: SavedExamItem[] }
  const groupedItems: GroupedItem[] = [];
  const groupIdx = new Map<string, number>();
  for (const it of filteredItems) {
    const sk = (it.sourceKey ?? '').trim();
    const key = sk || `__nosk__${it._id}`;
    if (groupIdx.has(key)) {
      groupedItems[groupIdx.get(key)!].items.push(it);
    } else {
      groupIdx.set(key, groupedItems.length);
      groupedItems.push({ sk: key, items: [it] });
    }
  }
  /* 난이도 정렬 — 그룹 헤더에서 칩 표시 시 사용 */
  const diffOrderMap: Record<string, number> = { 기본난도: 0, 중난도: 1, 고난도: 2, 최고난도: 3 };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-2xl w-[920px] max-w-[95vw] max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <span className="font-bold">📂 저장된 문제 목록</span>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          {/* 좌: 폴더 사이드바 — 한글 교재명이 길어 2줄까지 wrap, 슬림 스크롤바 */}
          <aside
            className="w-[240px] shrink-0 border-r border-slate-700/70 bg-slate-900/40 overflow-y-auto p-2
              [scrollbar-gutter:stable]
              [&::-webkit-scrollbar]:w-1.5
              [&::-webkit-scrollbar-track]:bg-transparent
              [&::-webkit-scrollbar-thumb]:bg-slate-600/70 [&::-webkit-scrollbar-thumb]:rounded-full
              [&::-webkit-scrollbar-thumb:hover]:bg-slate-500"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgb(71 85 105 / 0.7) transparent' }}
          >
            <button
              type="button"
              onClick={() => setFolderFilter('')}
              className={`w-full text-left text-xs px-2 py-1.5 rounded ${
                folderFilter === '' ? 'bg-emerald-700 text-white' : 'text-slate-300 hover:bg-slate-700/60'
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
              const printing = printingFolder === f;
              return (
                <div key={f} className="flex items-start gap-0.5 mb-0.5">
                  <button
                    type="button"
                    onClick={() => setFolderFilter(f)}
                    className={`flex-1 min-w-0 text-left text-xs px-2 py-1.5 rounded leading-snug break-keep ${
                      folderFilter === f ? 'bg-emerald-700 text-white' : 'text-slate-300 hover:bg-slate-700/60'
                    }`}
                    title={`${f} (${count})`}
                  >
                    <span className="line-clamp-2">📂 {f} <span className="text-slate-400">({count})</span></span>
                  </button>
                  {count > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleFolderPrint(f)}
                      disabled={printing}
                      className="px-1.5 text-[11px] text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
                      title={`「${f}」 폴더 ${count}건 통합 출력 (PDF로 저장 가능)`}
                    >
                      {printing ? '⏳' : '📄'}
                    </button>
                  )}
                  {f !== '기본' && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteFolder(f, count)}
                      className="px-1.5 text-[11px] text-slate-500 hover:text-red-300"
                      title={count > 0 ? `폴더 「${f}」 와 그 안의 ${count}건 삭제` : '빈 폴더 삭제'}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
            {folderFilter && (
              <button
                type="button"
                onClick={handleRenameFolder}
                className="w-full mt-3 text-[11px] px-2 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/60"
                title={`폴더 「${folderFilter}」 이름 일괄 변경`}
              >
                ✏ 폴더명 변경
              </button>
            )}
          </aside>

          {/* 우: 항목 목록 */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {error && (
              <div className="m-3 p-2.5 text-xs text-red-300 bg-red-950/40 border border-red-800/60 rounded">
                {error}
              </div>
            )}
            {!loading && filteredItems.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-700/60 bg-slate-900/40 sticky top-0 z-[1]">
                <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={el => {
                      if (el) el.indeterminate = selectedInView > 0 && !allVisibleSelected;
                    }}
                    onChange={() => {
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        if (allVisibleSelected) visibleIds.forEach(id => next.delete(id));
                        else visibleIds.forEach(id => next.add(id));
                        return next;
                      });
                    }}
                    className="w-3.5 h-3.5 accent-blue-500"
                  />
                  전체 선택
                </label>
                {selectedInView > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setBulkPrintModalOpen(true)}
                      disabled={printingSelected}
                      className="text-xs px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      {printingSelected ? (
                        <>
                          <Spinner className="w-3 h-3" />
                          <span>생성 중<LoadingDots /></span>
                        </>
                      ) : (
                        `선택 ${selectedInView}건 출력 ▾`
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleSelectedMoveFolder}
                      disabled={movingSelected}
                      className="text-xs px-2.5 py-1 rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50 inline-flex items-center gap-1.5"
                      title="선택한 항목을 특정 폴더로 일괄 이동"
                    >
                      {movingSelected ? (
                        <>
                          <Spinner className="w-3 h-3" />
                          <span>이동 중<LoadingDots /></span>
                        </>
                      ) : (
                        `선택 ${selectedInView}건 폴더 이동`
                      )}
                    </button>
                  </>
                )}
                <span className="ml-auto text-[11px] text-slate-500">총 {filteredItems.length}건</span>
              </div>
            )}
            {loading && (
              <div className="flex items-center justify-center h-32 text-slate-500 text-sm">불러오는 중...</div>
            )}
            {!loading && filteredItems.length === 0 && (
              <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
                {folderFilter ? `폴더 「${folderFilter}」 에 저장된 문제가 없습니다` : '저장된 문제가 없습니다'}
              </div>
            )}
            {!loading && (() => {
              const renderItem = (item: SavedExamItem, idx: number) => {
                const folder = (item.folder || '').trim() || '기본';
                const draft = folderEditDraft[item._id];
                const editing = draft !== undefined;
                const editValue = editing ? draft : folder;
                return (
                  <div
                    key={item._id}
                    className={`border-b border-slate-700/50 px-4 py-3 ${currentId === item._id ? 'bg-blue-600/10 border-l-2 border-l-blue-500' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      <label className="shrink-0 pt-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item._id)}
                          onChange={() => toggleSelect(item._id)}
                          className="w-3.5 h-3.5 accent-blue-500"
                        />
                      </label>
                      <div className="flex flex-col gap-0.5 shrink-0 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleMove(item._id, 'up')}
                          disabled={idx === 0 || movingId === item._id}
                          className="w-5 h-5 flex items-center justify-center rounded text-slate-600 hover:text-slate-300 disabled:opacity-20 text-xs"
                        >▲</button>
                        <span className="text-[10px] text-slate-600 text-center">{idx + 1}</span>
                        <button
                          type="button"
                          onClick={() => handleMove(item._id, 'down')}
                          disabled={idx === filteredItems.length - 1 || movingId === item._id}
                          className="w-5 h-5 flex items-center justify-center rounded text-slate-600 hover:text-slate-300 disabled:opacity-20 text-xs"
                        >▼</button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white text-sm truncate">{item.title || '(제목 없음)'}</p>
                        <p className="text-xs text-slate-400 mt-0.5 break-words leading-relaxed">
                          {item.textbook}{item.sourceKey ? ` · ${item.sourceKey}` : ''}
                        </p>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] text-slate-500">📂</span>
                            <input
                              value={editValue}
                              onChange={e =>
                                setFolderEditDraft(prev => ({ ...prev, [item._id]: e.target.value }))
                              }
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  void handleChangeItemFolder(item._id, editValue);
                                } else if (e.key === 'Escape') {
                                  setFolderEditDraft(prev => {
                                    const n = { ...prev };
                                    delete n[item._id];
                                    return n;
                                  });
                                }
                              }}
                              onBlur={() => {
                                if (editing && (draft ?? '').trim() !== folder) {
                                  void handleChangeItemFolder(item._id, editValue);
                                } else if (editing) {
                                  setFolderEditDraft(prev => {
                                    const n = { ...prev };
                                    delete n[item._id];
                                    return n;
                                  });
                                }
                              }}
                              disabled={movingFolderId === item._id}
                              placeholder="폴더명"
                              className="w-32 text-[11px] bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 disabled:opacity-50"
                            />
                          </div>
                          {item.difficulty && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${item.difficulty === '최고난도' ? 'bg-purple-700/50 text-purple-300' : item.difficulty === '고난도' ? 'bg-red-700/50 text-red-300' : item.difficulty === '중난도' ? 'bg-amber-700/50 text-amber-300' : 'bg-emerald-700/50 text-emerald-300'}`}>
                              {item.difficulty}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-500">{fmt(item.updatedAt)}</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleLoad(item._id)}
                          className="text-xs px-3 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-500 font-medium"
                        >
                          불러오기
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item._id)}
                          disabled={deletingId === item._id}
                          className="text-xs px-3 py-1 rounded-lg border border-slate-600 text-slate-400 hover:border-red-500 hover:text-red-400"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>
                );
              };

              return groupedItems.map(group => {
                const isMultiGroup = group.items.length >= 2 && !group.sk.startsWith('__nosk__');
                if (!isMultiGroup) {
                  const idx = filteredItems.indexOf(group.items[0]);
                  return renderItem(group.items[0], idx);
                }
                const isCollapsed = collapsedSourceKeys.has(group.sk);
                const isPrinting = printingGroupKey === group.sk;
                const sortedItems = [...group.items].sort(
                  (a, b) => (diffOrderMap[a.difficulty] ?? 99) - (diffOrderMap[b.difficulty] ?? 99),
                );
                /** 그룹 헤더 칩 — 난이도별 카운트 (같은 난이도 2건 이상이면 ×N 표시) */
                const diffCounts = sortedItems.reduce<Record<string, number>>((acc, it) => {
                  if (it.difficulty) acc[it.difficulty] = (acc[it.difficulty] ?? 0) + 1;
                  return acc;
                }, {});
                const presentDiffs = Object.keys(diffCounts);
                const latestUpdated = group.items
                  .map(i => i.updatedAt)
                  .filter(Boolean)
                  .sort()
                  .reverse()[0] ?? '';
                const allSelected = group.items.every(it => selectedIds.has(it._id));
                const someSelected = group.items.some(it => selectedIds.has(it._id));
                return (
                  <div
                    key={`group:${group.sk}`}
                    className={`border-b border-slate-700/50 ${
                      dropTargetSk === group.sk && draggingSk && draggingSk !== group.sk
                        ? 'outline outline-2 outline-emerald-500/60 outline-offset-[-2px]'
                        : ''
                    } ${draggingSk === group.sk ? 'opacity-50' : ''}`}
                    onDragOver={e => {
                      if (draggingSk && draggingSk !== group.sk) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dropTargetSk !== group.sk) setDropTargetSk(group.sk);
                      }
                    }}
                    onDragLeave={() => {
                      if (dropTargetSk === group.sk) setDropTargetSk(null);
                    }}
                    onDrop={e => {
                      e.preventDefault();
                      const fromSk = e.dataTransfer.getData('text/source-key');
                      setDropTargetSk(null);
                      setDraggingSk(null);
                      if (fromSk && fromSk !== group.sk) void reorderGroups(fromSk, group.sk);
                    }}
                  >
                    {/* 그룹 헤더 */}
                    <div
                      className="flex items-center gap-2 px-3 py-2 bg-slate-900/70 hover:bg-slate-900/90 transition-colors"
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData('text/source-key', group.sk);
                        e.dataTransfer.effectAllowed = 'move';
                        setDraggingSk(group.sk);
                      }}
                      onDragEnd={() => {
                        setDraggingSk(null);
                        setDropTargetSk(null);
                      }}
                    >
                      <span
                        className="shrink-0 text-slate-600 hover:text-slate-300 cursor-grab active:cursor-grabbing select-none"
                        title="드래그하여 순서 변경"
                      >⋮⋮</span>
                      <label className="shrink-0 cursor-pointer" title="그룹 일괄 선택" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                          onChange={() => {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              if (allSelected) group.items.forEach(it => next.delete(it._id));
                              else group.items.forEach(it => next.add(it._id));
                              return next;
                            });
                          }}
                          className="w-3.5 h-3.5 accent-blue-500"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => toggleGroupCollapse(group.sk)}
                        className="flex-1 min-w-0 flex items-center gap-2 text-left"
                      >
                        <span className="text-slate-400 text-xs w-3 shrink-0">{isCollapsed ? '▶' : '▼'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-slate-100 truncate">{group.sk}</span>
                            <span className="text-[10px] text-slate-500 whitespace-nowrap">{group.items.length}건</span>
                            {presentDiffs.map(d => {
                              const n = diffCounts[d] ?? 1;
                              return (
                                <span
                                  key={d}
                                  className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                    d === '최고난도' ? 'bg-purple-700/50 text-purple-300'
                                    : d === '고난도' ? 'bg-red-700/50 text-red-300'
                                    : d === '중난도' ? 'bg-amber-700/50 text-amber-300'
                                    : 'bg-emerald-700/50 text-emerald-300'
                                  }`}
                                  title={n > 1 ? `${d} ${n}건` : d}
                                >
                                  {d.replace('난도', '')}{n > 1 ? ` ×${n}` : ''}
                                </span>
                              );
                            })}
                            <span className="text-[10px] text-slate-500 whitespace-nowrap">{fmt(latestUpdated)}</span>
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleGroupPrint(group.sk)}
                        disabled={isPrinting}
                        className="shrink-0 text-[11px] px-2.5 py-1 rounded border border-emerald-500/80 bg-emerald-900/50 text-emerald-200 hover:bg-emerald-800/60 disabled:opacity-50 font-semibold whitespace-nowrap"
                        title={`「${group.sk}」 ${group.items.length}난도(기본→최고 순) 한 PDF 묶음 출력`}
                      >
                        {isPrinting ? '⏳' : `📦 묶음 출력`}
                      </button>
                    </div>
                    {/* 그룹 항목들 (펼침 상태일 때만) */}
                    {!isCollapsed && (
                      <div className="bg-slate-950/30">
                        {sortedItems.map(it => renderItem(it, filteredItems.indexOf(it)))}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>

      {/* 전체선택 출력 모드 선택 모달 */}
      {bulkPrintModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
          onClick={() => !printingSelected && setBulkPrintModalOpen(false)}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-2xl w-[480px] max-w-[92vw] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
              <span className="font-bold">📦 출력 방식 선택</span>
              <button
                type="button"
                disabled={printingSelected}
                onClick={() => setBulkPrintModalOpen(false)}
                className="text-slate-400 hover:text-white text-xl leading-none disabled:opacity-40"
              >×</button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-2">
              <div className="text-xs text-slate-400 mb-2">선택 <b className="text-slate-200">{selectedIds.size}</b>건 — 어떻게 저장할까요?</div>
              <button
                type="button"
                disabled={printingSelected}
                onClick={() => void runBulkPrint('single')}
                className="text-left px-4 py-3 rounded-lg border border-blue-500/60 bg-blue-900/30 hover:bg-blue-800/40 text-blue-100 disabled:opacity-50"
              >
                <div className="font-bold text-sm">📄 한번에 다 저장</div>
                <div className="text-[11px] text-blue-200/70 mt-0.5">하나의 PDF로 합본 — 브라우저 print 다이얼로그 1번</div>
              </button>
              <button
                type="button"
                disabled={printingSelected}
                onClick={() => void runBulkPrint('per-source')}
                className="text-left px-4 py-3 rounded-lg border border-emerald-500/60 bg-emerald-900/30 hover:bg-emerald-800/40 text-emerald-100 disabled:opacity-50"
              >
                <div className="font-bold text-sm">📚 번호별로 분리 (ZIP)</div>
                <div className="text-[11px] text-emerald-200/70 mt-0.5">「18번.pdf · 19번.pdf …」 N개 PDF 를 ZIP 하나로 다운로드 (다이얼로그 1번, ZIP 풀면 한 폴더에 모두)</div>
              </button>
              <button
                type="button"
                disabled={printingSelected}
                onClick={() => void runBulkPrint('per-difficulty')}
                className="text-left px-4 py-3 rounded-lg border border-fuchsia-500/60 bg-fuchsia-900/30 hover:bg-fuchsia-800/40 text-fuchsia-100 disabled:opacity-50"
              >
                <div className="font-bold text-sm">🎯 난도별로 분리 (ZIP)</div>
                <div className="text-[11px] text-fuchsia-200/70 mt-0.5">「기본난도.pdf · 중난도.pdf …」 N개 PDF 를 ZIP 하나로 다운로드</div>
              </button>
              {printingSelected && (
                <div className="mt-2 px-3 py-3 rounded-lg bg-emerald-950/40 border border-emerald-700/50">
                  <div className="flex items-center justify-center gap-2 text-emerald-200">
                    <Spinner className="w-4 h-4" />
                    <span className="text-sm font-semibold">
                      PDF 생성 중<LoadingDots />
                    </span>
                  </div>
                  <div className="mt-2 h-1 rounded-full bg-emerald-900/60 overflow-hidden">
                    <div className="h-full w-1/3 bg-emerald-400/80 animate-[shimmer_1.4s_ease-in-out_infinite]"
                         style={{ backgroundImage: 'linear-gradient(90deg, transparent, rgba(110,231,183,0.9), transparent)' }} />
                  </div>
                  <p className="mt-2 text-[11px] text-emerald-300/70 text-center">
                    선택 항목 수에 따라 30초~2분 정도 소요됩니다. 창을 닫지 마세요.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * 로딩 표시 컴포넌트들
 * ────────────────────────────────────────────────────────────────────────── */

function Spinner({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function LoadingDots() {
  return (
    <span className="inline-flex gap-0.5 ml-0.5 align-middle">
      <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  );
}

// ── 현황 패널 ───────────────────────────────────────────────────────────────────

const DIFFICULTY_LABELS = ['기본난도', '중난도', '고난도', '최고난도'] as const;
type CoverageDifficulty = (typeof DIFFICULTY_LABELS)[number];

interface CoverageItem {
  textbook: string;
  passages_total: number;
  /** 어떤 난이도라도 1 건 이상 만들어진 지문 수 (rounds 무관) */
  passages_with_any: number;
  /** 4 난이도 모두 회분 수만큼 채운 지문 수 (rounds 기준) */
  passages_with_target?: number;
  exams_total: number;
  pinned_total: number;
  by_difficulty: Record<CoverageDifficulty, number>;
  audit_clean?: number;
  audit_with_errors?: number;
}

interface PassageRow {
  passage_id: string;
  source_key: string;
  chapter: string;
  number: string;
  total: number;
  by_difficulty: Record<CoverageDifficulty, number>;
  priority: number;
}

function CoveragePanel({
  onClose,
  onJumpToPassage,
}: {
  onClose: () => void;
  onJumpToPassage: (passageId: string, textbook: string) => void;
}) {
  const [coverage, setCoverage] = useState<CoverageItem[]>([]);
  const [loadingCoverage, setLoadingCoverage] = useState(true);
  const [selectedTextbook, setSelectedTextbook] = useState<string | null>(null);
  const [rows, setRows] = useState<PassageRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [onlyPriority, setOnlyPriority] = useState(false);
  const [savingPriority, setSavingPriority] = useState<string | null>(null);
  const [copiedHint, setCopiedHint] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<'percent' | 'name'>('percent');
  /** 회분 수 — 한 지문에 각 난이도 N건씩 채울 목표. 1 = 옛 동작. coverage API 와 자동 채움 명령에 반영 */
  const [rounds, setRounds] = useState<number>(1);
  const [batchSelection, setBatchSelection] = useState<Set<string>>(new Set());

  const toggleBatch = useCallback((tb: string) => {
    setBatchSelection(prev => {
      const next = new Set(prev);
      if (next.has(tb)) next.delete(tb); else next.add(tb);
      return next;
    });
  }, []);
  const clearBatch = useCallback(() => setBatchSelection(new Set()), []);

  /** 점검 모달 상태 */
  type AuditFinding = {
    level: 'error' | 'warning';
    code: string;
    qid?: string;
    conditionIndex?: number;
    message: string;
    fixable?: boolean;
    tokens?: string[];
  };
  type AuditItem = {
    examId: string;
    textbook: string;
    sourceKey: string;
    difficulty: string;
    folder: string;
    findings: AuditFinding[];
    validatorPassed: boolean;
    htmlStale: boolean;
    hasFixable: boolean;
    fix?: { applied: string[]; saved: boolean; dryRun: boolean };
  };
  type AuditSummary = {
    total: number;
    clean: number;
    with_errors: number;
    with_warnings: number;
    fixable: number;
    fixed: number;
    code_frequency?: Record<string, number>;
  };
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditScope, setAuditScope] = useState<{ kind: 'passage' | 'textbook'; label: string; passageId?: string; textbook?: string } | null>(null);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [auditFixBusy, setAuditFixBusy] = useState(false);
  const [auditFilter, setAuditFilter] = useState<'all' | 'errors' | 'unclean'>('unclean');

  const loadCoverage = useCallback(async () => {
    setLoadingCoverage(true);
    try {
      const res = await fetch(`/api/admin/essay-generator/coverage?rounds=${rounds}`, { credentials: 'include' });
      const d = await res.json();
      const items = (d.items ?? []) as CoverageItem[];
      setCoverage(items);
      setSelectedTextbook(prev => prev ?? (items.length > 0 ? items[0].textbook : null));
    } finally {
      setLoadingCoverage(false);
    }
  }, [rounds]);

  useEffect(() => {
    void loadCoverage();
  }, [loadCoverage]);

  const loadRows = useCallback(async (textbook: string) => {
    setLoadingRows(true);
    try {
      const res = await fetch(
        `/api/admin/essay-generator/passage-exam-counts?textbook=${encodeURIComponent(textbook)}`,
        { credentials: 'include' },
      );
      const d = await res.json();
      setRows((d.passages ?? []) as PassageRow[]);
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    if (selectedTextbook) void loadRows(selectedTextbook);
  }, [selectedTextbook, loadRows]);

  const handlePriority = async (passageId: string, next: number) => {
    setSavingPriority(passageId);
    try {
      await fetch('/api/admin/essay-generator/passage-priority', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passageId, priority: next }),
      });
      setRows(prev =>
        prev
          .map(r => (r.passage_id === passageId ? { ...r, priority: next } : r))
          .sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            if (a.chapter !== b.chapter) return a.chapter.localeCompare(b.chapter, 'ko');
            return a.source_key.localeCompare(b.source_key, 'ko');
          }),
      );
      const delta = next > 0 ? 1 : -1;
      setCoverage(prev =>
        prev.map(c =>
          c.textbook === selectedTextbook
            ? { ...c, pinned_total: Math.max(0, c.pinned_total + delta) }
            : c,
        ),
      );
    } finally {
      setSavingPriority(null);
    }
  };

  const runAudit = useCallback(async (
    scope: { kind: 'passage' | 'textbook'; label: string; passageId?: string; textbook?: string },
    opts?: { fix?: boolean; dryRun?: boolean },
  ) => {
    setAuditOpen(true);
    setAuditScope(scope);
    setAuditLoading(true);
    if (opts?.fix) setAuditFixBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (scope.passageId) body.passageId = scope.passageId;
      if (scope.textbook) body.textbook = scope.textbook;
      if (opts?.fix) body.fix = true;
      if (opts?.dryRun) body.dryRun = true;
      const res = await fetch('/api/admin/essay-generator/audit', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      setAuditItems((d.items ?? []) as AuditItem[]);
      setAuditSummary((d.summary ?? null) as AuditSummary | null);
    } finally {
      setAuditLoading(false);
      setAuditFixBusy(false);
    }
  }, []);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedHint(label);
      setTimeout(() => setCopiedHint(null), 1200);
    } catch {
      /* ignore */
    }
  };

  const filteredRows = rows.filter(r => {
    if (hideCompleted && r.total > 0) return false;
    if (onlyPriority && r.priority <= 0) return false;
    return true;
  });

  const selectedCov = coverage.find(c => c.textbook === selectedTextbook) ?? null;

  /** 진행률 계산용 — rounds=1 이면 옛 기준(passages_with_any), rounds>1 이면 passages_with_target */
  const progressOf = useCallback((c: CoverageItem): number => {
    if (c.passages_total <= 0) return 0;
    const numerator = rounds > 1
      ? (c.passages_with_target ?? 0)
      : c.passages_with_any;
    return numerator / c.passages_total;
  }, [rounds]);

  const sortedCoverage = useMemo(() => {
    const arr = [...coverage];
    if (sortMode === 'name') {
      arr.sort((a, b) => a.textbook.localeCompare(b.textbook, 'ko'));
    } else {
      arr.sort((a, b) => {
        const pa = progressOf(a);
        const pb = progressOf(b);
        if (pb !== pa) return pb - pa;
        return a.textbook.localeCompare(b.textbook, 'ko');
      });
    }
    return arr;
  }, [coverage, sortMode, progressOf]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-2xl w-[1150px] max-w-[97vw] max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <span className="font-bold">📊 서술형 출제 현황</span>
            <span className="text-xs text-slate-400">교재별 진행도와 지문 단위 우선순위를 관리합니다.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copy('claude --dangerously-skip-permissions', 'claude-enter')}
              className="text-xs px-2.5 py-1 rounded border border-amber-600/60 bg-amber-950/30 text-amber-200 hover:bg-amber-900/40 font-mono"
              title="터미널 처음 띄울 때 — 권한 프롬프트 모두 우회. 헬퍼 스크립트(run-essay-loop.sh / audit.sh)는 자동으로 이 플래그를 붙이지만, 직접 claude 띄울 땐 이걸 복사해 쓰세요."
            >
              {copiedHint === 'claude-enter' ? '복사됨 ✓' : '💻 claude --dangerously-skip-permissions'}
            </button>
            <button
              type="button"
              onClick={() => {
                void loadCoverage();
                if (selectedTextbook) void loadRows(selectedTextbook);
              }}
              disabled={loadingCoverage}
              className="text-xs px-2.5 py-1 rounded border border-slate-600 text-slate-200 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title="교재 진행도와 지문 매트릭스를 다시 불러옵니다"
            >
              {loadingCoverage ? '새로고침 중…' : '↻ 새로고침'}
            </button>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* 좌: 교재 진행도 목록 */}
          <aside className="w-[340px] border-r border-slate-700/70 bg-slate-900/40 overflow-y-auto scrollbar-thin">
            {!loadingCoverage && coverage.length > 0 && (
              <>
                <div className="sticky top-0 z-20 px-3 py-2 bg-slate-900/95 backdrop-blur border-b border-slate-700/60 flex items-center gap-1.5 text-[11px]">
                  <span className="text-slate-500">정렬</span>
                  <button
                    type="button"
                    onClick={() => setSortMode('percent')}
                    className={`px-2 py-0.5 rounded ${sortMode === 'percent' ? 'bg-emerald-700/40 text-emerald-200 border border-emerald-600/60' : 'text-slate-400 border border-transparent hover:bg-slate-800'}`}
                  >
                    완료율
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortMode('name')}
                    className={`px-2 py-0.5 rounded ${sortMode === 'name' ? 'bg-emerald-700/40 text-emerald-200 border border-emerald-600/60' : 'text-slate-400 border border-transparent hover:bg-slate-800'}`}
                  >
                    교재명
                  </button>
                  <span className="ml-1 text-slate-500" title="한 지문에 각 난이도 N건씩 채울 목표. 1=옛 동작 (지문당 4난도 1셋만), 4=4회분 시험지">
                    회분
                  </span>
                  <select
                    value={rounds}
                    onChange={e => setRounds(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))}
                    className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 text-[11px] focus:outline-none focus:border-emerald-500"
                    title="회분 수 — 진행률·shortage·자동 채움 명령 모두 이 값 기준"
                  >
                    {[1, 2, 3, 4, 5, 6, 8, 10].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const targets = sortedCoverage.filter(c => {
                          if (c.exams_total === 0) return false;
                          if (typeof c.audit_clean !== 'number') return true;
                          const total = (c.audit_clean ?? 0) + (c.audit_with_errors ?? 0);
                          if (total === 0) return true;
                          return c.audit_clean! < total;
                        }).map(c => c.textbook);
                        setBatchSelection(new Set(targets));
                      }}
                      className="px-2 py-0.5 rounded text-fuchsia-300 border border-fuchsia-700/50 hover:bg-fuchsia-900/30"
                      title="검증율 100% 미만 교재만 선택 (audit 일괄 시작 대상)"
                    >
                      🔍 미검증
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const allSelected = sortedCoverage.length > 0 && sortedCoverage.every(c => batchSelection.has(c.textbook));
                        if (allSelected) clearBatch();
                        else setBatchSelection(new Set(sortedCoverage.map(c => c.textbook)));
                      }}
                      className="px-2 py-0.5 rounded text-slate-300 border border-slate-700 hover:bg-slate-800"
                      title="현재 정렬·필터에 보이는 교재 전체 선택/해제"
                    >
                      {sortedCoverage.length > 0 && sortedCoverage.every(c => batchSelection.has(c.textbook)) ? '☑ 전체' : '☐ 전체'}
                    </button>
                  </div>
                </div>

                {batchSelection.size > 0 && (
                  <div className="sticky top-[34px] z-10 px-3 py-2 bg-emerald-950/80 backdrop-blur border-b border-emerald-700/60 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-emerald-200 font-semibold">선택 {batchSelection.size}개 — 일괄 시작</span>
                      <button
                        type="button"
                        onClick={clearBatch}
                        className="text-emerald-400/80 hover:text-emerald-200 underline-offset-2 hover:underline"
                      >
                        해제
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const args = Array.from(batchSelection).map(t => `"${t}"`).join(' ');
                        const roundsFlag = rounds > 1 ? `--rounds ${rounds} ` : '';
                        void copy(`./scripts/run-essay-loop-multi.sh ${roundsFlag}${args}`, 'batch-loop');
                      }}
                      className="w-full px-2 py-1.5 rounded border border-emerald-500/80 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-800/50 font-semibold text-[11px] text-left whitespace-nowrap overflow-hidden truncate"
                      title="터미널에 붙여넣어 선택한 교재들을 각자 새 창에서 자동 채움 시작"
                    >
                      {copiedHint === 'batch-loop' ? '복사됨 ✓ — 터미널에 붙여넣기' : `⭐ 일괄 자동 채움 (${batchSelection.size}개 병렬)`}
                    </button>
                    {(() => {
                      const eligible = Array.from(batchSelection).filter(tb => {
                        const c = coverage.find(x => x.textbook === tb);
                        if (!c || c.exams_total === 0) return false;
                        if (typeof c.audit_clean !== 'number') return true;
                        const total = (c.audit_clean ?? 0) + (c.audit_with_errors ?? 0);
                        if (total === 0) return true;
                        return c.audit_clean! < total;
                      });
                      const skipped = batchSelection.size - eligible.length;
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            if (eligible.length === 0) {
                              alert('선택한 교재가 모두 검증 100% — audit 할 항목이 없습니다.');
                              return;
                            }
                            const args = eligible.map(t => `"${t}"`).join(' ');
                            void copy(`./scripts/run-essay-audit-multi.sh ${args}`, 'batch-audit');
                          }}
                          disabled={eligible.length === 0}
                          className="w-full px-2 py-1.5 rounded border border-fuchsia-500/80 bg-fuchsia-900/40 text-fuchsia-200 hover:bg-fuchsia-800/50 disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-[11px] text-left whitespace-nowrap overflow-hidden truncate"
                          title={skipped > 0 ? `검증 100% 교재 ${skipped}개는 자동 제외됨` : '터미널에 붙여넣어 선택한 교재들 audit-content ERROR 자동 검증·개선'}
                        >
                          {copiedHint === 'batch-audit'
                            ? '복사됨 ✓ — 터미널에 붙여넣기'
                            : eligible.length === 0
                              ? '🔍 audit 대상 없음 (모두 검증 완료)'
                              : `🔍 일괄 audit (${eligible.length}개 병렬${skipped > 0 ? ` · 완료 ${skipped}개 제외` : ''})`}
                        </button>
                      );
                    })()}
                  </div>
                )}
              </>
            )}
            {loadingCoverage && (
              <div className="p-4 text-xs text-slate-400">불러오는 중…</div>
            )}
            {!loadingCoverage && coverage.length === 0 && (
              <div className="p-4 text-xs text-slate-400">표시할 교재가 없습니다.</div>
            )}
            {!loadingCoverage && sortedCoverage.map(c => {
              const pct = Math.round(progressOf(c) * 100);
              const filledNum = rounds > 1 ? (c.passages_with_target ?? 0) : c.passages_with_any;
              const isSelected = selectedTextbook === c.textbook;
              const isBatched = batchSelection.has(c.textbook);
              return (
                <div
                  key={c.textbook}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedTextbook(c.textbook)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedTextbook(c.textbook); } }}
                  className={`w-full text-left px-3 py-2.5 border-b border-slate-800 hover:bg-slate-800/60 transition-colors cursor-pointer ${
                    isSelected ? 'bg-emerald-950/40 border-l-2 border-l-emerald-500' : ''
                  } ${isBatched ? 'ring-1 ring-emerald-500/40 ring-inset' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isBatched}
                      onChange={() => toggleBatch(c.textbook)}
                      onClick={e => e.stopPropagation()}
                      className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500/50 cursor-pointer flex-shrink-0"
                      title="일괄 작업에 포함"
                    />
                    <div className="text-sm font-medium text-slate-100 truncate flex-1" title={c.textbook}>
                      {c.textbook}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-700/70 rounded overflow-hidden">
                      <div
                        className={`h-full ${pct === 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-slate-400 tabular-nums w-8 text-right">{pct}%</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400 flex items-center gap-2">
                    <span title={rounds > 1 ? `4 난이도 모두 ${rounds}건씩 충족한 지문` : '최소 1건 이상 만들어진 지문'}>
                      지문 {filledNum}/{c.passages_total}{rounds > 1 ? ` ×${rounds}회분` : ''}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span>문항 {c.exams_total}</span>
                    {c.pinned_total > 0 && (
                      <>
                        <span className="text-slate-600">·</span>
                        <span className="text-amber-300">⭐ {c.pinned_total}</span>
                      </>
                    )}
                  </div>
                  {typeof c.audit_clean === 'number' && c.exams_total > 0 && (() => {
                    const total = (c.audit_clean ?? 0) + (c.audit_with_errors ?? 0);
                    if (total === 0) return null;
                    const vpct = Math.round((c.audit_clean! / total) * 100);
                    return (
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wide w-7 shrink-0">검증</span>
                        <div className="flex-1 h-1 bg-slate-700/70 rounded overflow-hidden">
                          <div
                            className={`h-full ${vpct === 100 ? 'bg-sky-500' : vpct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${vpct}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-slate-400 tabular-nums w-8 text-right">{vpct}%</span>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </aside>

          {/* 우: 지문별 매트릭스 */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {!selectedTextbook && (
              <div className="p-6 text-sm text-slate-400">왼쪽에서 교재를 선택하세요.</div>
            )}

            {selectedTextbook && (
              <div className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-100 truncate">{selectedTextbook}</div>
                    {selectedCov && (
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {DIFFICULTY_LABELS.map(d => (
                          <span key={d} className="mr-3">
                            {d.replace('난도', '')} <span className="text-slate-200 tabular-nums">{selectedCov.by_difficulty[d] ?? 0}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-300">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hideCompleted}
                        onChange={e => setHideCompleted(e.target.checked)}
                        className="rounded border-slate-600 bg-slate-800"
                      />
                      <span>미생성만</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={onlyPriority}
                        onChange={e => setOnlyPriority(e.target.checked)}
                        className="rounded border-slate-600 bg-slate-800"
                      />
                      <span>⭐ 핀만</span>
                    </label>
                    {selectedTextbook && (() => {
                      const tb = selectedTextbook;
                      const envPrefix = rounds > 1 ? `ESSAY_TARGET_PER_DIFFICULTY=${rounds} ` : '';
                      const targetParam = rounds > 1 ? ` (target_per_difficulty=${rounds})` : '';
                      const scriptCmd = `${envPrefix}./scripts/run-essay-loop.sh "${tb}"`;
                      const oneLiner = `/loop 10m @scripts/cc-essay-loop-prompt.md 워크플로우대로 교재 "${tb}" 1 cycle 돌려줘${targetParam}. ScheduleWakeup 은 /loop 가 대신하니 호출하지 마.`;
                      const longPrompt = [
                        `교재 "${tb}" 에서 essay_exams 가 0 건인 지문 1 건을 찾아 4 난도(기본·중·고·최고) 모두 만들어 저장해줘.`,
                        `저장 폴더는 "${tb}".`,
                        ``,
                        `실행 순서:`,
                        `1. npm run cc:essay -- next-empty --textbook "${tb}"  로 다음 지문 받기`,
                        `2. 응답이 {done: true} 면 — 모두 완료. 사용자에게 "「${tb}」 자동 채움 완료" 알리고 ScheduleWakeup 호출하지 말고 종료.`,
                        `3. 응답에 next.passage_id 가 있으면:`,
                        `   a. npm run cc:essay -- passage --id <passage_id>  로 지문·문장표 받기`,
                        `   b. assets/exam_kit/generation_prompt.md + 난이도 부록 규칙대로 4 개 ExamData JSON 작성`,
                        `      - 기본 → .essay-drafts/<sourceKey_slug>_basic.json`,
                        `      - 중   → .essay-drafts/<sourceKey_slug>_mid.json`,
                        `      - 고   → .essay-drafts/<sourceKey_slug>_hard.json`,
                        `      - 최고 → .essay-drafts/<sourceKey_slug>_max.json`,
                        `      (sourceKey_slug 는 영문·숫자·한글 외 문자를 _ 로 치환)`,
                        `   c. npm run cc:essay -- save-all 의 4 개 인자로 위 파일들을 묶어 일괄 저장`,
                        `   d. 검증 실패가 한 건이라도 있으면 — 멈추고 사용자에게 오류 알리고 ScheduleWakeup 호출 안 함 (--force 자동 우회 금지)`,
                        `4. 정상 저장 완료 시 — 다음 tick 은 10 분 후 자동 재호출됨`,
                        ``,
                        `난이도별 핵심 차이 — 기본: 변형 0 (셔플만) / 중: 1~2 청크 어형 변형 / 고: 키워드 lemma 알파벳순 / 최고: 한국어 해석만. 난이도별 문법 포인트 겹침 최소화.`,
                      ].join('\n');
                      return (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => void copy(scriptCmd, 'loop-script-cov')}
                            className="px-2 py-1 rounded border border-emerald-500/80 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-800/50 font-semibold"
                            title={`터미널에 붙여넣어 「${tb}」 자동 채움 즉시 시작 (claude --dangerously-skip-permissions 자동 적용)`}
                          >
                            {copiedHint === 'loop-script-cov' ? '복사됨 ✓ — 터미널로' : '⭐ 스크립트'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void copy(oneLiner, 'loop-oneliner-cov')}
                            className="px-2 py-1 rounded border border-fuchsia-500/80 bg-fuchsia-900/40 text-fuchsia-200 hover:bg-fuchsia-800/50 font-semibold"
                            title="이미 띄운 claude 채팅에 한 줄 paste — /loop 10m 으로 10 분 간격 자동 진행"
                          >
                            {copiedHint === 'loop-oneliner-cov' ? '복사됨 ✓ — claude 채팅으로' : '🔗 /loop 한 줄'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void copy(longPrompt, 'loop-prompt')}
                            className="px-2 py-1 rounded border border-slate-600 bg-slate-800/40 text-slate-300 hover:bg-slate-700/50"
                            title="옛 방식 — 멀티라인 paste 가 [Pasted text #N] 첨부로 변환되면 /loop 가 못 읽음. 권장 옵션 사용."
                          >
                            {copiedHint === 'loop-prompt' ? '복사됨 ✓' : '📋 긴 프롬프트'}
                          </button>
                        </span>
                      );
                    })()}
                    {selectedTextbook && (
                      <button
                        type="button"
                        onClick={() => void runAudit({
                          kind: 'textbook',
                          label: selectedTextbook,
                          textbook: selectedTextbook,
                        })}
                        className="px-2 py-1 rounded border border-sky-500/80 bg-sky-900/40 text-sky-200 hover:bg-sky-800/50 font-semibold whitespace-nowrap"
                        title={`「${selectedTextbook}」 의 모든 essay_exams 점검`}
                      >
                        🔍 교재 전체 점검
                      </button>
                    )}
                  </div>
                </div>

                {loadingRows && (
                  <div className="text-xs text-slate-400 py-6 text-center">불러오는 중…</div>
                )}

                {!loadingRows && filteredRows.length === 0 && (
                  <div className="text-xs text-slate-400 py-6 text-center">표시할 지문이 없습니다.</div>
                )}

                {!loadingRows && filteredRows.length > 0 && (
                  <div className="border border-slate-700/60 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-900/60 text-slate-400 uppercase tracking-wide">
                        <tr>
                          <th className="text-left px-2 py-2 font-medium">강/번호</th>
                          <th className="text-left px-2 py-2 font-medium">source_key</th>
                          {DIFFICULTY_LABELS.map(d => (
                            <th key={d} className="text-center px-1 py-2 font-medium" title={d}>
                              {d.replace('난도', '')}
                            </th>
                          ))}
                          <th className="text-center px-2 py-2 font-medium">합계</th>
                          <th className="text-center px-2 py-2 font-medium">우선순위</th>
                          <th className="text-center px-2 py-2 font-medium">액션</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.map(r => {
                          const cellCls = (n: number) =>
                            n === 0
                              ? 'bg-red-950/40 text-red-300'
                              : n === 1
                              ? 'bg-amber-950/40 text-amber-200'
                              : 'bg-emerald-950/40 text-emerald-200';
                          return (
                            <tr key={r.passage_id} className="border-t border-slate-800/80 hover:bg-slate-800/40">
                              <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">
                                {r.chapter}{r.number ? ` ${r.number}` : ''}
                              </td>
                              <td className="px-2 py-1.5 text-slate-400 truncate max-w-[260px]" title={r.source_key}>
                                {r.source_key}
                              </td>
                              {DIFFICULTY_LABELS.map(d => {
                                const n = r.by_difficulty[d] ?? 0;
                                return (
                                  <td key={d} className="text-center px-1 py-1">
                                    <span className={`inline-block min-w-[20px] px-1.5 py-0.5 rounded tabular-nums ${cellCls(n)}`}>
                                      {n}
                                    </span>
                                  </td>
                                );
                              })}
                              <td className="text-center px-2 py-1 text-slate-200 tabular-nums">{r.total}</td>
                              <td className="text-center px-2 py-1">
                                <button
                                  type="button"
                                  disabled={savingPriority === r.passage_id}
                                  onClick={() => void handlePriority(r.passage_id, r.priority > 0 ? 0 : 1)}
                                  className={`px-2 py-0.5 rounded text-base leading-none ${
                                    r.priority > 0 ? 'text-amber-300' : 'text-slate-600 hover:text-amber-300'
                                  } disabled:opacity-50`}
                                  title={r.priority > 0 ? '핀 해제' : '핀 추가'}
                                >
                                  {r.priority > 0 ? '⭐' : '☆'}
                                </button>
                              </td>
                              <td className="text-center px-2 py-1 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onJumpToPassage(r.passage_id, selectedTextbook!);
                                    onClose();
                                  }}
                                  className="text-[11px] px-2 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 mr-1"
                                  title="이 지문을 출제 패널에 불러오기"
                                >
                                  열기
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    copy(
                                      `npm run cc:essay -- passage --id ${r.passage_id}`,
                                      `cmd-${r.passage_id}`,
                                    )
                                  }
                                  className="text-[11px] px-2 py-0.5 rounded border border-emerald-700 text-emerald-300 hover:bg-emerald-950/40 mr-1"
                                  title="cc:essay passage 명령 복사"
                                >
                                  {copiedHint === `cmd-${r.passage_id}` ? '복사됨 ✓' : 'CLI'}
                                </button>
                                <button
                                  type="button"
                                  disabled={r.total === 0}
                                  onClick={() => void runAudit({
                                    kind: 'passage',
                                    label: `${r.chapter}${r.number ? ' ' + r.number : ''} (${r.total}건)`,
                                    passageId: r.passage_id,
                                  })}
                                  className="text-[11px] px-2 py-0.5 rounded border border-sky-700 text-sky-300 hover:bg-sky-950/40 disabled:opacity-30 disabled:cursor-not-allowed"
                                  title={r.total === 0 ? '저장된 출제가 없어 점검 대상이 없습니다' : '이 지문에 저장된 모든 essay_exams 점검'}
                                >
                                  🔍 점검
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {auditOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
          onClick={() => !auditFixBusy && setAuditOpen(false)}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-2xl w-[900px] max-w-[95vw] max-h-[88vh] flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-bold">🔍 점검 결과</span>
                <span className="text-xs text-slate-400 truncate">{auditScope?.label ?? ''}</span>
              </div>
              <button
                type="button"
                disabled={auditFixBusy}
                onClick={() => setAuditOpen(false)}
                className="text-slate-400 hover:text-white text-xl leading-none disabled:opacity-40"
              >×</button>
            </div>

            <div className="px-5 py-3 border-b border-slate-700/60 flex items-center gap-3 flex-wrap text-xs">
              {auditLoading && <span className="text-slate-400">점검 중…</span>}
              {!auditLoading && auditSummary && (
                <>
                  <span className="text-slate-300">총 <b className="text-slate-100">{auditSummary.total}</b>건</span>
                  <span className="text-emerald-300">클린 {auditSummary.clean}</span>
                  <span className="text-red-300">오류 {auditSummary.with_errors}</span>
                  <span className="text-amber-300">경고 {auditSummary.with_warnings}</span>
                  <span className="text-sky-300">자동수정 가능 {auditSummary.fixable}</span>
                  {auditSummary.fixed > 0 && (
                    <span className="text-fuchsia-300">수정 완료 {auditSummary.fixed}</span>
                  )}
                  <span className="ml-2 inline-flex items-center gap-1 rounded border border-slate-700 px-1 py-0.5">
                    {(['unclean', 'errors', 'all'] as const).map(f => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setAuditFilter(f)}
                        className={`px-1.5 py-0.5 rounded ${auditFilter === f ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        {f === 'unclean' ? '이상만' : f === 'errors' ? '오류만' : '전체'}
                      </button>
                    ))}
                  </span>
                  {auditScope && (() => {
                    const tb = auditScope.textbook ?? auditScope.label;
                    const scriptCmd = `./scripts/run-essay-audit.sh "${tb}"`;
                    const oneLiner = `@scripts/cc-essay-audit-prompt.md 워크플로우대로 교재 "${tb}" 의 audit-content ERROR 를 모두 검증·개선해. ERROR 가 0 이 될 때까지 반복.`;
                    const longPrompt = [
                      `교재 "${tb}" 의 essay_exams 에서 audit-content ERROR 가 있는 항목을 모두 검증·개선해.`,
                      ``,
                      `점검 체크리스트:`,
                      `1. SVOC 더블 체크 — colorizeStructure 매칭 (unmatched 0건) + structure_analysis label 에 (S)/(V)/(O)/(C)/(M) 표지 일관성`,
                      `2. 문법 포인트 미비 여부 — answer.text 의 문법 구조 대비 grammar_points / structure_analysis 가 충분히 다루는지`,
                      `3. 최고난도 문장은 짧지 않게 — Q1 ≥ 25단어, Q2 ≥ 15단어, 최소 3종 이상 문법 결합. 7~14단어 단순 단문이면 같은 지문 다른 문장으로 swap`,
                      `4. 합의 룰 — POS 원자 ≥ 5 연속 (COND_POS_ENUM) 없음 / 슬롯 ≤ 14 / 함수어·내용어 누설 ERROR 없음 / 메타용어 화이트리스트 / intent_content ≥ 30자 + 평가능력/감점 서술`,
                      ``,
                      `실행:`,
                      `- npm run cc:essay -- audit-content --textbook "${tb}"  로 ERROR 위치 확인`,
                      `- ERROR 보유 examId 마다 데이터 직접 fetch (essay_exams 컬렉션) → conditions / structure_analysis / intent_content 검토`,
                      `- patch 스크립트 작성·실행 (HTML 재빌드 포함)`,
                      `- ERROR 없는 항목은 건드리지 말 것. 모든 ERROR 가 0 이 될 때까지 반복.`,
                    ].join('\n');
                    return (
                      <span className="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void copy(scriptCmd, 'audit-script')}
                          className="px-2.5 py-1 rounded border border-emerald-500/80 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-800/50 font-semibold"
                          title="터미널에서 실행 — claude 자동 띄움 + 권한 우회 + 첫 메시지 자동 입력"
                        >
                          {copiedHint === 'audit-script' ? '복사됨 ✓ — 터미널에 붙여넣기' : '⭐ 헬퍼 스크립트'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void copy(oneLiner, 'audit-oneliner')}
                          className="px-2.5 py-1 rounded border border-fuchsia-500/80 bg-fuchsia-900/40 text-fuchsia-200 hover:bg-fuchsia-800/50 font-semibold"
                          title="이미 띄운 claude 채팅에 한 줄로 paste — truncate 안 됨"
                        >
                          {copiedHint === 'audit-oneliner' ? '복사됨 ✓ — claude 채팅에 붙여넣기' : '🔗 한 줄'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void copy(longPrompt, 'audit-prompt')}
                          className="px-2.5 py-1 rounded border border-slate-600 bg-slate-800/40 text-slate-300 hover:bg-slate-700/50"
                          title="옛 방식 — 멀티라인 paste 가 [Pasted text #N] 첨부로 변환되면 /loop·slash 가 못 읽음. 권장 옵션 사용."
                        >
                          {copiedHint === 'audit-prompt' ? '복사됨 ✓' : '📋 긴 프롬프트'}
                        </button>
                      </span>
                    );
                  })()}
                  {auditSummary.fixable > 0 && auditScope && (
                    <button
                      type="button"
                      disabled={auditFixBusy}
                      onClick={() => void runAudit(auditScope, { fix: true })}
                      className="px-3 py-1 rounded border border-sky-500/80 bg-sky-900/40 text-sky-200 hover:bg-sky-800/50 font-semibold disabled:opacity-50"
                      title="자동 수정 가능한 항목을 즉시 DB에 반영"
                    >
                      {auditFixBusy ? '수정 중…' : `🛠 자동 수정 (${auditSummary.fixable}건)`}
                    </button>
                  )}
                </>
              )}
            </div>
            {!auditLoading && auditSummary?.code_frequency && Object.keys(auditSummary.code_frequency).length > 0 && (
              <div className="px-5 py-2 border-b border-slate-700/60 flex items-center gap-1.5 flex-wrap text-[10px]">
                <span className="text-slate-500">패턴</span>
                {Object.entries(auditSummary.code_frequency).map(([code, n]) => (
                  <span
                    key={code}
                    className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900/60 text-slate-300"
                  >
                    {code} <span className="text-slate-400 tabular-nums">{n}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-3 text-xs">
              {!auditLoading && auditItems.length === 0 && (
                <div className="text-slate-400 py-6 text-center">점검 대상 essay_exam 이 없습니다.</div>
              )}
              {!auditLoading && auditItems
                .filter(item => {
                  if (auditFilter === 'all') return true;
                  if (auditFilter === 'errors') return item.findings.some(f => f.level === 'error');
                  return item.findings.length > 0;
                })
                .map(item => {
                const hasErr = item.findings.some(f => f.level === 'error');
                const clean = item.findings.length === 0;
                return (
                  <div
                    key={item.examId}
                    className={`mb-2 rounded border ${clean ? 'border-emerald-900/60 bg-emerald-950/20' : hasErr ? 'border-red-900/60 bg-red-950/20' : 'border-amber-900/60 bg-amber-950/20'} p-2`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="font-medium text-slate-100 truncate">
                        {item.sourceKey} · <span className="text-slate-400">{item.difficulty}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 tabular-nums">{item.examId}</div>
                    </div>
                    {clean && (
                      <div className="text-emerald-300">✓ 이상 없음 (validator 통과 · html 최신 · 내용 누설 없음)</div>
                    )}
                    {item.findings.map((f, i) => (
                      <div key={i} className="flex items-start gap-2 mt-0.5">
                        <span className={`text-[10px] uppercase font-bold tabular-nums ${f.level === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
                          {f.level === 'error' ? '오류' : '경고'}
                        </span>
                        <span className="text-slate-500 text-[10px]">[{f.code}]</span>
                        <span className="text-slate-200 flex-1">{f.message}</span>
                        {f.fixable && (
                          <span className="text-[10px] px-1 rounded bg-fuchsia-900/40 text-fuchsia-300 border border-fuchsia-700/60 whitespace-nowrap">🛠 자동수정 가능</span>
                        )}
                      </div>
                    ))}
                    {item.fix && (
                      <div className="mt-1 pt-1 border-t border-slate-700/40 text-fuchsia-200">
                        <span className="font-medium">{item.fix.saved ? '✓ 수정 완료' : '미리보기'} ({item.fix.applied.length}건):</span>
                        <ul className="mt-0.5 ml-3 list-disc list-inside text-slate-300">
                          {item.fix.applied.map((a, i) => <li key={i}>{a}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 메인 페이지 ────────────────────────────────────────────────────────────────

export default function EssayGeneratorPage() {
  const router = useRouter();
  const [adminLoginId, setAdminLoginId] = useState('');

  const EXAM_TITLE_KEY = 'essay_generator_exam_title';
  const SAVE_FOLDER_KEY = 'essay_generator_save_folder';
  const SYSTEM_PROMPT_KEY = 'essay_generator_system_prompt';
  /** localStorage는 mount 후 복원 — 초기값은 서버·클라이언트 동일해야 hydration 일치 */
  const [examTitle, setExamTitle] = useState('영어 서·논술형 평가');
  const [schoolName, setSchoolName] = useState('');
  const [grade, setGrade] = useState('');
  const [passage, setPassage] = useState('');
  const [selectedPassageInfo, setSelectedPassageInfo] = useState<{ textbook: string; sourceKey: string; passageId?: string } | null>(null);
  const [essaySentenceIndices, setEssaySentenceIndices] = useState<number[]>([]);
  const [sentenceListExpanded, setSentenceListExpanded] = useState(false);
  const [difficulty, setDifficulty] = useState<'최고난도' | '고난도' | '중난도' | '기본난도'>('중난도');
  const [questionNumber, setQuestionNumber] = useState('서·논술형');
  const [examSubtitle, setExamSubtitle] = useState('');
  const [totalPoints, setTotalPoints] = useState<number | ''>('');
  const [targetSentences, setTargetSentences] = useState<Set<string>>(new Set());
  /** Claude system — 비우면 서버에서 기본 파일 사용 */
  const [systemPrompt, setSystemPrompt] = useState('');
  const [systemPromptMtime, setSystemPromptMtime] = useState<string | null>(null);
  const [conditionPromptOpen, setConditionPromptOpen] = useState(false);
  /** Claude Code CLI 사용예 모달 */
  const [ccEssayModalOpen, setCcEssayModalOpen] = useState(false);
  const [copiedHint, setCopiedHint] = useState<string | null>(null);
  /** cc:essay 모달 — 강별 passageId 목록 */
  const [lessonBatch, setLessonBatch] = useState<{
    lesson: string;
    textbook: string;
    count: number;
    bullets: string;
    claudePrompt: string;
  } | null>(null);
  const [lessonBatchLoading, setLessonBatchLoading] = useState(false);
  const [lessonBatchError, setLessonBatchError] = useState('');

  useEffect(() => {
    if (!ccEssayModalOpen) {
      setLessonBatch(null);
      setLessonBatchError('');
      setLessonBatchLoading(false);
    }
  }, [ccEssayModalOpen]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [examData, setExamData] = useState<ExamData | null>(null);
  const [examHtml, setExamHtml] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [jsonEdit, setJsonEdit] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  // 저장/불러오기
  const [currentSavedId, setCurrentSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [showSavedList, setShowSavedList] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const [saveFolder, setSaveFolder] = useState('기본');
  const [folderOptions, setFolderOptions] = useState<string[]>(['기본']);

  // 사이드패널 접기
  const [collapsed, setCollapsed] = useState(false);

  /** 미리보기 확대 (1 = 100%) */
  const [previewScale, setPreviewScale] = useState(1);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);

  /** 미리보기 ← / → 네비게이션용 saved 목록 (id + folder 만 필요) */
  type SavedNavItem = { _id: string; folder: string };
  const [savedNavList, setSavedNavList] = useState<SavedNavItem[]>([]);
  const refreshSavedNavList = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/essay-generator/exams', { credentials: 'include' });
      const d = await res.json();
      const items = (d.items ?? []) as Array<{ _id: string; folder?: string }>;
      setSavedNavList(items.map(i => ({ _id: i._id, folder: i.folder ?? '기본' })));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { void refreshSavedNavList(); }, [refreshSavedNavList]);
  const PREVIEW_BASE_W = 794;
  const PREVIEW_BASE_H = 1300;

  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    try {
      const t = localStorage.getItem(EXAM_TITLE_KEY);
      if (t !== null) setExamTitle(t);
      // 학교명·학년은 자동 채움 없이 항상 빈칸으로 시작
      const f = localStorage.getItem(SAVE_FOLDER_KEY);
      if (f !== null && f.trim()) setSaveFolder(f.trim());
    } catch {
      /* ignore */
    }
    void fetch('/api/admin/essay-generator/exams', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.folders) && d.folders.length > 0) setFolderOptions(d.folders);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SAVE_FOLDER_KEY, saveFolder || '기본');
    } catch {
      /* ignore */
    }
  }, [saveFolder]);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (!d?.user || d.user.role !== 'admin') { router.replace('/admin/login'); return; }
        setAdminLoginId(d.user.loginId ?? '');
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(SYSTEM_PROMPT_KEY) : null;
    /* mtime 은 캐시 여부와 무관하게 항상 서버에서 가져온다 */
    fetch('/api/admin/essay-generator/generation-prompt', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (typeof d.mtime === 'string') setSystemPromptMtime(d.mtime);
        if (saved != null && saved !== '') {
          setSystemPrompt(saved);
        } else if (typeof d.prompt === 'string') {
          setSystemPrompt(d.prompt);
        }
      })
      .catch(() => {
        if (saved != null && saved !== '') setSystemPrompt(saved);
      });
  }, []);

  // 지문 → 문장 배열 파싱
  const parseSentences = useCallback((text: string): string[] => {
    // 마침표/느낌표/물음표 + 공백 기준 분리, 단 약어(Mr. Dr. 등) 오류 최소화
    return text
      .replace(/\s+/g, ' ')
      .trim()
      .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
      .map(s => s.trim())
      .filter(s => s.length > 10);
  }, []);

  const sentences = parseSentences(passage);

  /** cc:essay 모달 — 선택 지문과 같은 강의 passageId 목록 + Claude 배치 프롬프트 */
  const fetchLessonPassageBatch = useCallback(async () => {
    const id = selectedPassageInfo?.passageId;
    if (!id) return;
    setLessonBatchLoading(true);
    setLessonBatchError('');
    setLessonBatch(null);
    try {
      const r = await fetch(
        `/api/admin/essay-generator/passages-by-lesson?passageId=${encodeURIComponent(id)}`,
        { credentials: 'include' },
      );
      const d = await r.json();
      if (!r.ok) {
        setLessonBatchError(typeof d.error === 'string' ? d.error : '목록을 불러오지 못했습니다.');
        return;
      }
      const textbook = String(d.textbook ?? '');
      const lesson = String(d.lesson ?? '');
      const list = (d.passages ?? []) as { passage_id: string; source_key: string }[];
      const bullets = list
        .map(p => `- "${textbook}" ${(p.source_key || '').trim()} (passageId: ${p.passage_id})`)
        .join('\n');

      const sents = parseSentences(passage);
      const parts: string[] = [];
      parts.push(
        `아래 ${list.length}개 지문은 교재 "${textbook}"의 동일 강(${lesson})에 속합니다. 순서대로 모두 ${difficulty}로 서술형 출제하고, 각 지문마다 cc:essay save 로 저장까지 진행해줘.`,
      );
      parts.push(`저장 폴더는 모두 "${(saveFolder || '기본').trim() || '기본'}".`);
      if (examTitle && examTitle !== '영어 서·논술형 평가') {
        parts.push(`시험 제목은 모두 "${examTitle}"로 설정하고,`);
      }
      if (schoolName) parts.push(`학교는 "${schoolName}",`);
      if (grade) parts.push(`학년은 "${grade}",`);
      if (questionNumber && questionNumber !== '서·논술형') parts.push(`문항번호는 "${questionNumber}",`);
      if (typeof totalPoints === 'number') parts.push(`총배점은 각 ${totalPoints}점,`);
      const ts = [...targetSentences];
      if (ts.length > 0 && sents.length > 0) {
        const indices = sents.map((s, i) => (ts.includes(s) ? i : -1)).filter(i => i >= 0);
        if (indices.length > 0) {
          parts.push(`가능하면 각 지문 출제 시 문장 [${indices.join('], [')}] 을 반영해줘.`);
        }
      }
      parts.push('');
      parts.push(bullets);
      parts.push('');
      parts.push(
        '각 지문마다: npm run cc:essay -- passage --id <passageId> 로 지문·문장표 확인 → generation_prompt.md 대로 ExamData JSON(.essay-drafts/<sourceKey>.json) 작성 → --dry-run → save 순으로 진행해줘.',
      );

      setLessonBatch({
        lesson,
        textbook,
        count: list.length,
        bullets,
        claudePrompt: parts.join('\n'),
      });
    } catch {
      setLessonBatchError('네트워크 오류');
    } finally {
      setLessonBatchLoading(false);
    }
  }, [
    selectedPassageInfo?.passageId,
    passage,
    parseSentences,
    difficulty,
    examTitle,
    schoolName,
    grade,
    questionNumber,
    totalPoints,
    targetSentences,
    saveFolder,
  ]);

  const toggleSentence = useCallback((s: string) => {
    setTargetSentences(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }, []);

  const handlePickPassage = useCallback(async (p: PassageItem) => {
    const original = p.content?.original ?? '';
    setPassage(original);
    setTargetSentences(new Set());
    setEssaySentenceIndices([]);
    setSentenceListExpanded(false);
    setSelectedPassageInfo({ textbook: p.textbook, sourceKey: p.source_key ?? `${p.chapter} ${p.number}`, passageId: p._id });
    setExamSubtitle(prev => prev || p.textbook);
    setShowPicker(false);

    // 구문 분석기에서 서술형 대비로 체크한 문장 인덱스 가져오기
    try {
      const res = await fetch(`/api/admin/essay-generator/passage-essay-sentences?passageId=${p._id}`, { credentials: 'include' });
      const d = await res.json();
      if (d.indices?.length > 0) setEssaySentenceIndices(d.indices);
    } catch { /* 조용히 무시 */ }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!passage.trim()) { setError('지문을 입력하세요.'); return; }
    setLoading(true);
    setError('');
    setExamData(null);
    setExamHtml('');
    setShowJson(false);

    const targetArr = [...targetSentences];

    try {
      const res = await fetch('/api/admin/essay-generator/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passage,
          examTitle,
          schoolName,
          grade,
          difficulty,
          questionNumber,
          examSubtitle,
          ...(totalPoints !== '' ? { totalPoints } : {}),
          targetSentences: targetArr,
          ...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? '생성 실패');
      setExamData(body.data);
      setExamHtml(body.html);
      setJsonEdit(JSON.stringify(body.data, null, 2));
      setPreviewScale(1);
      setCurrentSavedId(null); // 새로 생성했으므로 저장 ID 초기화
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류 발생');
    } finally {
      setLoading(false);
    }
  }, [passage, examTitle, schoolName, grade, difficulty, questionNumber, examSubtitle, totalPoints, targetSentences, systemPrompt]);

  const handleJsonApply = useCallback(() => {
    try {
      const parsed: ExamData = JSON.parse(jsonEdit);
      setExamData(parsed);
      setError('');
    } catch {
      setError('JSON 파싱 오류: 형식을 확인하세요.');
    }
  }, [jsonEdit]);

  // ── 저장 ────────────────────────────────────────────────────────────────────

  const getCurrentHtml = useCallback(() => {
    const iframeDoc = iframeRef.current?.contentDocument;
    return iframeDoc ? '<!DOCTYPE html>' + iframeDoc.documentElement.outerHTML : examHtml;
  }, [examHtml]);

  const handleSave = useCallback(async () => {
    if (!examData) return;
    setSaving(true);
    setSaveMsg('');
    const html = getCurrentHtml();
    const title = examData.meta.subtitle || examData.meta.title || '';

    try {
      if (currentSavedId) {
        // 덮어쓰기
        await fetch(`/api/admin/essay-generator/exams/${currentSavedId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            data: examData,
            html,
            folder: (saveFolder || '기본').trim() || '기본',
          }),
        });
        setSaveMsg('저장됨');
      } else {
        // 신규 저장
        const res = await fetch('/api/admin/essay-generator/exams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            title,
            textbook: selectedPassageInfo?.textbook ?? '',
            sourceKey: selectedPassageInfo?.sourceKey ?? '',
            difficulty,
            folder: saveFolder || '기본',
            data: examData,
            html,
          }),
        });
        const d = await res.json();
        setCurrentSavedId(d.id);
        setSaveMsg('저장됨');
      }
      void refreshSavedNavList();
    } catch {
      setSaveMsg('저장 실패');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 2000);
    }
  }, [examData, currentSavedId, difficulty, selectedPassageInfo, getCurrentHtml, saveFolder, refreshSavedNavList]);

  const handleLoadSaved = useCallback(
    ({ data, html, id, title, folder, textbook, sourceKey, passageId, difficulty: loadedDifficulty }: { data: ExamData; html: string; id: string; title: string; folder?: string; textbook?: string; sourceKey?: string; passageId?: string; difficulty?: string }) => {
      setExamData(data);
      setExamHtml(html);
      setJsonEdit(JSON.stringify(data, null, 2));
      setCurrentSavedId(id);
      if (folder && folder.trim()) setSaveFolder(folder.trim());
      /* PDF 저장 시 파일명으로 쓸 sourceKey·passageId·textbook 도 함께 복원 */
      if (textbook || sourceKey) {
        setSelectedPassageInfo({
          textbook: textbook ?? '',
          sourceKey: sourceKey ?? '',
          passageId: passageId || undefined,
        });
      }
      if (loadedDifficulty && (['최고난도', '고난도', '중난도', '기본난도'] as const).includes(loadedDifficulty as '최고난도' | '고난도' | '중난도' | '기본난도')) {
        setDifficulty(loadedDifficulty as '최고난도' | '고난도' | '중난도' | '기본난도');
      }
      setShowSavedList(false);
      setSaveMsg(`"${title}" 불러옴`);
      setTimeout(() => setSaveMsg(''), 2000);
    },
    [],
  );

  /** 미리보기 ← / → : 같은 폴더 내 인접 항목으로 이동 */
  const navigateExam = useCallback(async (dir: 'prev' | 'next') => {
    if (!currentSavedId) return;
    const cur = savedNavList.find(i => i._id === currentSavedId);
    if (!cur) return;
    const sameFolder = savedNavList.filter(i => i.folder === cur.folder);
    const idx = sameFolder.findIndex(i => i._id === currentSavedId);
    if (idx < 0) return;
    const targetIdx = dir === 'prev' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= sameFolder.length) return;
    const targetId = sameFolder[targetIdx]._id;
    try {
      const res = await fetch(`/api/admin/essay-generator/exams/${targetId}`, { credentials: 'include' });
      const d = await res.json();
      if (!d.item) return;
      handleLoadSaved({
        data: d.item.data,
        html: d.item.html,
        id: d.item._id,
        title: d.item.title,
        folder: d.item.folder,
        textbook: d.item.textbook,
        sourceKey: d.item.sourceKey,
        passageId: d.item.passageId,
        difficulty: d.item.difficulty,
      });
    } catch { /* ignore */ }
  }, [currentSavedId, savedNavList, handleLoadSaved]);

  /** 같은 폴더에 인접 항목이 있는지 (← / → 활성화 판단) */
  const navAvailability = useMemo(() => {
    if (!currentSavedId) return { prev: false, next: false };
    const cur = savedNavList.find(i => i._id === currentSavedId);
    if (!cur) return { prev: false, next: false };
    const sameFolder = savedNavList.filter(i => i.folder === cur.folder);
    const idx = sameFolder.findIndex(i => i._id === currentSavedId);
    return { prev: idx > 0, next: idx >= 0 && idx < sameFolder.length - 1 };
  }, [currentSavedId, savedNavList]);

  /* ⌘+← / ⌘+→ 단축키로 이전/다음 항목 이동 (Ctrl+ on Windows/Linux).
     ref 로 최신 nav 상태 유지 — handleNavKey 는 stable 한 함수 (재첨부 X). */
  const navStateRef = useRef({ navigateExam, navAvailability });
  useEffect(() => {
    navStateRef.current = { navigateExam, navAvailability };
  });
  const handleNavKey = useCallback((e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = e.target as HTMLElement | null;
    /* INPUT / TEXTAREA 만 skip (iframe body 의 contentEditable 은 응답) */
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const { navigateExam: nav, navAvailability: avail } = navStateRef.current;
    if (e.key === 'ArrowLeft' && avail.prev) {
      e.preventDefault();
      void nav('prev');
    } else if (e.key === 'ArrowRight' && avail.next) {
      e.preventDefault();
      void nav('next');
    }
  }, []);

  /** 미리보기에 드래그 선택이 있을 때 S/V/O/C/M = 색칠, 0 = 지우기. 선택 없으면 일반 입력 허용. */
  const applySvocRef = useRef<((k: 'S' | 'V' | 'O' | 'C' | 'M' | 'clear') => void) | null>(null);
  const handleSvocKey = useCallback((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const map: Record<string, 'S' | 'V' | 'O' | 'C' | 'M' | 'clear'> = { s: 'S', v: 'V', o: 'O', c: 'C', m: 'M', '0': 'clear' };
    const kind = map[e.key.toLowerCase()];
    if (!kind) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; // 좌측 입력칸은 제외
    const sel = iframeRef.current?.contentWindow?.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return; // 미리보기에 선택이 있을 때만 가로챔
    e.preventDefault();
    applySvocRef.current?.(kind);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleNavKey);
    window.addEventListener('keydown', handleSvocKey);
    return () => {
      window.removeEventListener('keydown', handleNavKey);
      window.removeEventListener('keydown', handleSvocKey);
    };
  }, [handleNavKey, handleSvocKey]);

  // 폴더 목록 새로고침
  const refreshFolders = useCallback(async () => {
    const res = await fetch('/api/admin/essay-generator/exams', { credentials: 'include' });
    const d = await res.json();
    if (d.folders) setFolderOptions(d.folders);
  }, []);

  const enableEditing = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.designMode = 'on';
    /* iframe 안 focus 일 때도 ⌘+← / ⌘+→ + SVOC 단축키 동작하도록 iframe doc 에도 부착 */
    doc.removeEventListener('keydown', handleNavKey);
    doc.addEventListener('keydown', handleNavKey);
    doc.removeEventListener('keydown', handleSvocKey);
    doc.addEventListener('keydown', handleSvocKey);
  }, [handleNavKey, handleSvocKey]);

  /**
   * 미리보기에서 드래그 선택한 텍스트에 SVOC 색상 span 적용 (또는 풀기).
   * - kind = 'S'|'V'|'O'|'C'|'M' → 해당 클래스 span 으로 감싼다.
   * - kind = 'clear' → 선택 영역 안의 svoc-* 클래스 모두 제거.
   * iframe content 가 변경되면 examHtml state 도 동기화 → 저장·인쇄에 반영.
   */
  const applySvocToSelection = useCallback((kind: 'S' | 'V' | 'O' | 'C' | 'M' | 'clear') => {
    const win = iframeRef.current?.contentWindow;
    const doc = iframeRef.current?.contentDocument;
    if (!win || !doc) return;
    const sel = win.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSaveMsg('드래그로 텍스트를 선택한 뒤 누르세요');
      setTimeout(() => setSaveMsg(''), 1500);
      return;
    }
    const range = sel.getRangeAt(0);
    const fragment = range.extractContents();

    if (kind === 'clear') {
      /* svoc-* 클래스만 제거 (다른 클래스 보존). 클래스 0 이면 span 자체 풀기. */
      const unwrapSpans = (root: Node) => {
        const spans: HTMLElement[] = [];
        const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node = walker.currentNode as HTMLElement | null;
        while (node) {
          if (
            node instanceof HTMLElement &&
            (node.className || '').split(/\s+/).some(c => c.startsWith('svoc-'))
          ) {
            spans.push(node);
          }
          node = walker.nextNode() as HTMLElement | null;
        }
        for (const s of spans) {
          const remaining = (s.className || '').split(/\s+/).filter(c => !c.startsWith('svoc-')).join(' ');
          if (remaining) {
            s.className = remaining;
          } else {
            const parent = s.parentNode;
            if (!parent) continue;
            while (s.firstChild) parent.insertBefore(s.firstChild, s);
            parent.removeChild(s);
          }
        }
      };
      unwrapSpans(fragment);
      range.insertNode(fragment);
    } else {
      const span = doc.createElement('span');
      span.className = `svoc-${kind}`;
      span.appendChild(fragment);
      range.insertNode(span);
    }

    sel.removeAllRanges();
    /* iframe html 변경을 examHtml 에 sync — 저장/PDF 출력에 반영 */
    setExamHtml('<!DOCTYPE html>' + doc.documentElement.outerHTML);
    setSaveMsg(kind === 'clear' ? '색상 제거됨' : `${kind} 적용`);
    setTimeout(() => setSaveMsg(''), 1200);
  }, []);
  // 단축키 핸들러가 최신 applySvocToSelection 을 참조하도록 ref 동기화
  applySvocRef.current = applySvocToSelection;

  /**
   * 미리보기에서 드래그 선택한 텍스트에 글자 서식 적용 — 선택 영역을 span 으로 감싼다.
   * (SVOC 와 동일 방식이라 포커스가 버튼으로 옮겨가도 안정적. execCommand 미사용.)
   *  - bold/italic/underline/strike : 굵게·기울임·밑줄·취소선
   *  - sizeUp/sizeDown : 글자 크기 ±(상대 em, 반복 시 누적)
   *  - clearFmt : 선택 영역 인라인 서식(style·b/i/u 태그) 제거 (SVOC 색은 보존)
   */
  const applyFormatToSelection = useCallback((kind: 'bold' | 'italic' | 'underline' | 'strike' | 'sizeUp' | 'sizeDown' | 'clearFmt') => {
    const win = iframeRef.current?.contentWindow;
    const doc = iframeRef.current?.contentDocument;
    if (!win || !doc) return;
    const sel = win.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSaveMsg('드래그로 텍스트를 선택한 뒤 누르세요');
      setTimeout(() => setSaveMsg(''), 1500);
      return;
    }
    const range = sel.getRangeAt(0);
    const fragment = range.extractContents();

    if (kind === 'clearFmt') {
      const els: HTMLElement[] = [];
      const walker = doc.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
      let n = walker.currentNode as HTMLElement | null;
      while (n) { if (n instanceof HTMLElement) els.push(n); n = walker.nextNode() as HTMLElement | null; }
      for (const el of els) {
        const tag = el.tagName;
        const styleTag = tag === 'B' || tag === 'I' || tag === 'U' || tag === 'STRONG' || tag === 'EM' || tag === 'S' || tag === 'STRIKE';
        if (tag === 'SPAN' || styleTag) {
          el.removeAttribute('style');
          const hasClass = (el.className || '').trim().length > 0; // svoc-* 색 span 은 보존
          if (styleTag || (tag === 'SPAN' && !hasClass)) {
            const parent = el.parentNode;
            if (!parent) continue;
            while (el.firstChild) parent.insertBefore(el.firstChild, el);
            parent.removeChild(el);
          }
        }
      }
      range.insertNode(fragment);
    } else {
      const span = doc.createElement('span');
      const s = span.style;
      if (kind === 'bold') s.fontWeight = '700';
      else if (kind === 'italic') s.fontStyle = 'italic';
      else if (kind === 'underline') s.textDecoration = 'underline';
      else if (kind === 'strike') s.textDecoration = 'line-through';
      else if (kind === 'sizeUp') s.fontSize = '1.15em';
      else if (kind === 'sizeDown') s.fontSize = '0.87em';
      span.appendChild(fragment);
      range.insertNode(span);
    }

    sel.removeAllRanges();
    setExamHtml('<!DOCTYPE html>' + doc.documentElement.outerHTML);
    const label: Record<typeof kind, string> = { bold: '굵게', italic: '기울임', underline: '밑줄', strike: '취소선', sizeUp: '글자 크게', sizeDown: '글자 작게', clearFmt: '서식 지움' };
    setSaveMsg(label[kind]);
    setTimeout(() => setSaveMsg(''), 1000);
  }, []);

  const handlePrint = useCallback(() => {
    const iframeDoc = iframeRef.current?.contentDocument;
    const htmlToPrint = iframeDoc
      ? '<!DOCTYPE html>' + iframeDoc.documentElement.outerHTML
      : examHtml;
    if (!htmlToPrint) return;
    const w = window.open('', '_blank');
    if (!w) return;

    /* PDF 저장 시 브라우저는 document.title 을 기본 파일명으로 사용.
       「<sourceKey> · <difficulty>」 로 설정. */
    const sk = (selectedPassageInfo?.sourceKey ?? '').trim();
    const diff = (examData?.meta.difficulty ?? difficulty ?? '').trim();
    const pdfTitleParts = [sk || '서술형', diff].filter(Boolean);
    const pdfTitle = sanitizeFilename(pdfTitleParts.join(' · '));
    const titleTag = `<title>${escapeHtmlInline(pdfTitle)}</title>`;

    let injected = htmlToPrint;
    /* 기존 <title> 이 있으면 교체, 없으면 <head> 에 삽입 */
    if (/<title[^>]*>[\s\S]*?<\/title>/i.test(injected)) {
      injected = injected.replace(/<title[^>]*>[\s\S]*?<\/title>/i, titleTag);
    } else if (injected.includes('</head>')) {
      injected = injected.replace('</head>', `${titleTag}</head>`);
    } else {
      injected = `${titleTag}${injected}`;
    }
    injected = injected.includes('</head>')
      ? injected.replace('</head>', `<style>${PRINT_FIX_CSS}</style></head>`)
      : `<style>${PRINT_FIX_CSS}</style>` + injected;

    w.document.write(injected);
    w.document.close();
    /* 일부 브라우저(특히 Safari)는 document.write 후 title 이 무시될 수 있어 명시 재설정 */
    try { w.document.title = pdfTitle; } catch { /* ignore */ }
    w.focus();
    setTimeout(() => w.print(), 400);
  }, [examHtml, selectedPassageInfo, examData, difficulty]);

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      <AdminSidebar loginId={adminLoginId} />

      {showPicker && (
        <PassagePickerModal
          onSelect={handlePickPassage}
          onClose={() => setShowPicker(false)}
          lastTextbookKey="essay_generator_last_textbook"
        />
      )}

      {showSavedList && (
        <SavedListPanel
          onLoad={handleLoadSaved}
          onClose={() => setShowSavedList(false)}
          currentId={currentSavedId}
        />
      )}

      {showCoverage && (
        <CoveragePanel
          onClose={() => setShowCoverage(false)}
          onJumpToPassage={async (pid) => {
            try {
              const r = await fetch(`/api/admin/passages/${encodeURIComponent(pid)}`, { credentials: 'include' });
              const d = await r.json();
              if (!r.ok || !d.item) return;
              const item = d.item as { textbook?: string; source_key?: string; chapter?: string; number?: string | number; content?: { original?: string } };
              const original = item.content?.original ?? '';
              const tb = String(item.textbook ?? '');
              const sk = String(item.source_key ?? `${item.chapter ?? ''} ${item.number ?? ''}`).trim();
              setPassage(original);
              setTargetSentences(new Set());
              setEssaySentenceIndices([]);
              setSentenceListExpanded(false);
              setSelectedPassageInfo({ textbook: tb, sourceKey: sk, passageId: pid });
              setExamSubtitle(prev => prev || tb);
              try {
                const r2 = await fetch(
                  `/api/admin/essay-generator/passage-essay-sentences?passageId=${encodeURIComponent(pid)}`,
                  { credentials: 'include' },
                );
                const d2 = await r2.json();
                if (Array.isArray(d2.indices) && d2.indices.length > 0) setEssaySentenceIndices(d2.indices);
              } catch { /* ignore */ }
            } catch {
              /* ignore */
            }
          }}
        />
      )}

      {/* ── cc:essay CLI 모달 ── */}
      {ccEssayModalOpen && (() => {
        const pid = selectedPassageInfo?.passageId ?? '<passageId>';
        const tb = selectedPassageInfo?.textbook ?? '<교재명>';
        const sk = selectedPassageInfo?.sourceKey ?? `${tb} 21번`;
        const fold = (saveFolder || '기본').trim() || '기본';
        const draftPath = `.essay-drafts/${(selectedPassageInfo?.sourceKey ?? 'draft').replace(/[^A-Za-z0-9가-힣]/g, '_')}.json`;
        const sampleJson = JSON.stringify({
          passageId: pid, textbook: tb, sourceKey: sk, difficulty,
          folder: fold, examTitle: examTitle || '직전보강 서술형 파이널',
          ...(schoolName ? { schoolName } : {}), ...(grade ? { grade } : {}),
          ...(examSubtitle ? { examSubtitle } : {}),
          data: {
            meta: { title: examTitle || '직전보강 서술형 파이널', subtitle: examSubtitle || tb, info: [] },
            question_set: { tag: '[01]', instruction: '다음 글을 읽고 질문에 답하시오.' },
            passage: '...본문 영문...',
            questions: [{
              id: '1', points: 6,
              prompt: '밑줄 친 (A)를 아래 조건과 보기에 맞게 영어로 쓰시오.',
              conditions: ['7개의 단어를 모두 사용할 것', '...'],
              bogi: 'chunk1 / chunk2 / ...',
              answer: { text: 'Final answer sentence.', grammar_points: [{ title: '관계대명사', content: 'who' }], word_count: { total: 7, words: ['Final','answer','sentence','...'], note: null }, intent_content: '출제 의도 설명' },
            }],
          },
        }, null, 2);

        const copy = async (text: string, label: string) => {
          try { await navigator.clipboard.writeText(text); setCopiedHint(label); setTimeout(() => setCopiedHint(null), 1500); } catch { /* ignore */ }
        };

        const buildFullCmd = () => {
          if (!selectedPassageInfo?.passageId) return '';
          const parts = [`"${tb} ${sk}" 지문을 ${difficulty}로 만들어줘.`];
          if (examTitle && examTitle !== '영어 서·논술형 평가') parts.push(`제목은 "${examTitle}"`);
          if (schoolName) parts.push(`학교는 "${schoolName}"`);
          if (grade) parts.push(`학년은 "${grade}"`);
          const metaParts = parts.slice(1);
          if (metaParts.length > 0) { parts[0] = parts[0] + ' ' + metaParts.join(', ') + '로 설정하고,'; parts.splice(1, metaParts.length); }
          const selected = Array.from(targetSentences);
          if (selected.length > 0) {
            const indices = sentences.map((s, i) => (selected.includes(s) ? i : -1)).filter(i => i >= 0);
            parts.push(`문장 [${indices.join('], [')}]을 반드시 포함해서 출제해줘.`);
          }
          if (questionNumber && questionNumber !== '서·논술형') parts.push(`문항번호는 "${questionNumber}".`);
          if (typeof totalPoints === 'number') parts.push(`총배점 ${totalPoints}점.`);
          parts.push(`저장 폴더는 "${fold}".`);
          parts.push(`완성되면 cc:essay save 로 저장까지 진행해줘 (passageId: ${pid})`);
          return parts.join(' ');
        };

        const CmdBlock = ({ cmd, label }: { cmd: string; label: string }) => (
          <div className="flex items-start gap-2">
            <pre className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono overflow-x-auto scrollbar-thin whitespace-pre-wrap break-all">
              <code>{cmd}</code>
            </pre>
            <button
              type="button"
              onClick={() => copy(cmd, label)}
              className="shrink-0 text-sm font-bold px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 border border-emerald-500"
            >
              {copiedHint === label ? '복사됨 ✓' : '복사'}
            </button>
          </div>
        );

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setCcEssayModalOpen(false)}>
            <div
              className="bg-slate-800 border border-slate-600 rounded-2xl w-[min(720px,94vw)] max-h-[85vh] flex flex-col shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {/* 헤더 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
                <div>
                  <h3 className="text-lg font-bold text-white">Claude Code 자동화 (cc:essay)</h3>
                  <p className="text-sm text-slate-400 mt-0.5">Anthropic API 키 없이 · Pro 무과금</p>
                </div>
                <button type="button" onClick={() => setCcEssayModalOpen(false)} className="text-slate-400 hover:text-white text-2xl leading-none px-2">×</button>
              </div>

              {/* 본문 — 스크롤 */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 scrollbar-thin">

                <p className="text-sm text-slate-300 leading-relaxed">
                  각 단계의 <span className="font-bold text-emerald-300">「복사」</span> 버튼을 누르면
                  바로 왼쪽 회색 칸의 명령 전체가 클립보드에 들어갑니다.
                </p>

                {/* 1 */}
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white">1. 부족 지문 확인 (선택)</h4>
                  <CmdBlock label="shortage" cmd={`npm run cc:essay -- shortage --textbook "${tb}" --required 1 --difficulty ${difficulty}`} />
                </div>

                {/* 2 */}
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white">2. 지문 받기 (문장표 + 서술형대비 인덱스)</h4>
                  <CmdBlock label="passage" cmd={`npm run cc:essay -- passage --id ${pid}`} />
                </div>

                {/* 2b — 강 단위 passageId */}
                <div className="rounded-xl border border-violet-600/40 bg-violet-950/15 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-violet-200">강별로 작업하기</h4>
                    <button
                      type="button"
                      disabled={!selectedPassageInfo?.passageId || lessonBatchLoading}
                      onClick={() => { void fetchLessonPassageBatch(); }}
                      className="text-sm font-bold px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed border border-violet-500"
                    >
                      {lessonBatchLoading ? '불러오는 중…' : '강별 passageId 목록 만들기'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    현재 선택한 지문의 <code className="text-slate-300">source_key</code> / <code className="text-slate-300">chapter</code> 에서 묶음 접두를 찾습니다.
                    예: <b className="text-violet-200">01강</b>, <b className="text-violet-200">고난도 모의고사 1회</b>(… 01번·중점·<code className="text-slate-500">회01번</code> 형태),
                    같은 <code className="text-slate-300">textbook</code> 안의 지문 <code className="text-slate-300">passageId</code> 를 한 번에 나열합니다.
                    (지문을 먼저 DB에서 고른 뒤 누르세요.)
                  </p>
                  {lessonBatchError && (
                    <p className="text-xs text-red-300">{lessonBatchError}</p>
                  )}
                  {lessonBatch && (
                    <>
                      <p className="text-xs text-violet-300">
                        {lessonBatch.textbook} · <b>{lessonBatch.lesson}</b> — 총 <b>{lessonBatch.count}</b>개
                      </p>
                      <div className="space-y-1">
                        <span className="text-xs font-semibold text-slate-400">passageId 목록 (한 줄씩)</span>
                        <CmdBlock label="lesson-ids" cmd={lessonBatch.bullets} />
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-semibold text-slate-400">Claude Code 배치용 (복사)</span>
                        <CmdBlock label="lesson-claude" cmd={lessonBatch.claudePrompt} />
                      </div>
                    </>
                  )}
                </div>

                {/* 3 */}
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white">3. ExamData JSON 작성 → 파일로 저장</h4>
                  <p className="text-xs text-slate-400">채팅에서 JSON 을 만들고 <code className="text-slate-300">{draftPath}</code> 에 저장합니다.</p>
                  <details className="border border-slate-600 rounded-lg bg-slate-900/50">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-200 hover:text-white select-none">JSON 스키마 예시 보기</summary>
                    <div className="px-3 pb-3 pt-1">
                      <CmdBlock label="schema" cmd={sampleJson} />
                    </div>
                  </details>
                </div>

                {/* 4 */}
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white">4. 검증 (dry-run)</h4>
                  <CmdBlock label="dry-run" cmd={`npm run cc:essay -- save --json ${draftPath} --dry-run`} />
                </div>

                {/* 5 */}
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white">5. 저장 (HTML 자동 생성)</h4>
                  <CmdBlock label="save" cmd={`npm run cc:essay -- save --json ${draftPath}`} />
                  <p className="text-xs text-slate-400">
                    검증 실패 시 <code className="text-slate-300">--force</code> 우회 가능. stdin: <code className="text-slate-300">cat draft.json | npm run cc:essay -- save --json -</code>
                  </p>
                </div>

                {/* Claude Code 채팅용 한 줄 — 단일 지문 */}
                <div className="rounded-xl border border-amber-600/50 bg-amber-950/20 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-amber-200">Claude Code 채팅용 — 지문 1개</h4>
                    <button
                      type="button"
                      disabled={!selectedPassageInfo?.passageId}
                      onClick={() => copy(buildFullCmd(), 'full-cmd')}
                      className="text-sm font-bold px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed border border-amber-500"
                    >
                      {copiedHint === 'full-cmd' ? '복사됨 ✓' : '명령어 복사'}
                    </button>
                  </div>
                  {selectedPassageInfo?.passageId ? (
                    <code className="block text-xs text-emerald-300 font-mono break-all whitespace-pre-wrap leading-relaxed bg-slate-950 rounded-lg p-3 border border-slate-700">
                      {buildFullCmd()}
                    </code>
                  ) : (
                    <p className="text-sm text-amber-200/80">
                      위 <span className="font-bold text-white">「영어 지문 → DB에서 불러오기」</span>로 지문을 먼저 고르면 활성화됩니다.
                    </p>
                  )}
                </div>

                {/* 구분선 */}
                <div className="border-t border-slate-600 pt-1" />

                {/* 한 지문 4난도 묶음 생성 */}
                <div className="rounded-xl border border-emerald-600/40 bg-emerald-950/20 p-4 space-y-4">
                  <h4 className="text-sm font-bold text-emerald-200">📦 한 지문 4난도 한 번에 (기본·중·고·최고)</h4>

                  {/* Step A — Claude Code 채팅 프롬프트 */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-emerald-300">① Claude Code 채팅에 붙여넣어 4 개 draft 자동 작성</p>
                    {selectedPassageInfo?.passageId ? (
                      <CmdBlock
                        label="all4-prompt"
                        cmd={[
                          `"${tb} ${sk}" 지문(passageId: ${pid})을 기본난도·중난도·고난도·최고난도 4 종 모두 만들어줘.`,
                          ...(examTitle && examTitle !== '영어 서·논술형 평가' ? [`시험지 제목: "${examTitle}"`] : []),
                          ...(schoolName ? [`학교: "${schoolName}"`] : []),
                          ...(grade ? [`학년: "${grade}"`] : []),
                          `저장 폴더: "${fold}"`,
                          ``,
                          `각 난이도마다 다음 절차로 진행:`,
                          `1. npm run cc:essay -- passage --id ${pid}  로 지문·문장표 확인 (한 번만 받으면 됨)`,
                          `2. assets/exam_kit/generation_prompt.md + 난이도 부록 규칙대로 ExamData JSON 작성`,
                          `   - 기본난도 → .essay-drafts/${sk.replace(/[^A-Za-z0-9가-힣]/g, '_')}_basic.json`,
                          `   - 중난도   → .essay-drafts/${sk.replace(/[^A-Za-z0-9가-힣]/g, '_')}_mid.json`,
                          `   - 고난도   → .essay-drafts/${sk.replace(/[^A-Za-z0-9가-힣]/g, '_')}_hard.json`,
                          `   - 최고난도 → .essay-drafts/${sk.replace(/[^A-Za-z0-9가-힣]/g, '_')}_max.json`,
                          `3. 4 개 draft 모두 작성 완료되면 마지막에 한 번 save-all 로 일괄 저장:`,
                          `   npm run cc:essay -- save-all .essay-drafts/${sk.replace(/[^A-Za-z0-9가-힣]/g, '_')}_basic.json .essay-drafts/${sk.replace(/[^A-Za-z0-9가-힣]/g, '_')}_mid.json .essay-drafts/${sk.replace(/[^A-Za-z0-9가-힣]/g, '_')}_hard.json .essay-drafts/${sk.replace(/[^A-Za-z0-9가-힣]/g, '_')}_max.json`,
                          ``,
                          `난이도별 핵심 차이 — 기본: 변형 0 (셔플만) / 중: 1~2 청크 어형 변형 / 고: 키워드 lemma 알파벳순 (완전 영작) / 최고: 키워드 없음 한국어 해석만 (완전 영작).`,
                          `4 개 모두 같은 지문 다른 문장 선택해도 됨 — 난이도 간 문법 포인트 겹침 최소화.`,
                        ].join('\n')}
                      />
                    ) : (
                      <p className="text-xs text-emerald-200/70 px-2 py-2 rounded bg-slate-900/40">
                        위 <span className="font-bold text-white">「영어 지문 → DB에서 불러오기」</span>로 지문을 먼저 고르면 명령어가 채워집니다.
                      </p>
                    )}
                  </div>

                  {/* Step B — save-all 단독 명령 */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-emerald-300">② draft 4 개가 이미 있을 때 — save-all 단독 호출</p>
                    <CmdBlock
                      label="save-all"
                      cmd={`npm run cc:essay -- save-all ${
                        selectedPassageInfo
                          ? [
                              `.essay-drafts/${sk.replace(/[^A-Za-z0-9가-힣]/g, '_')}_basic.json`,
                              `.essay-drafts/${sk.replace(/[^A-Za-z0-9가-힣]/g, '_')}_mid.json`,
                              `.essay-drafts/${sk.replace(/[^A-Za-z0-9가-힣]/g, '_')}_hard.json`,
                              `.essay-drafts/${sk.replace(/[^A-Za-z0-9가-힣]/g, '_')}_max.json`,
                            ].join(' ')
                          : '<basic.json> <mid.json> <hard.json> <max.json>'
                      } [--dry-run] [--force]`}
                    />
                    <p className="text-xs text-slate-400 leading-relaxed">
                      각 파일이 차례로 검증·저장됨. <code className="text-slate-300">--dry-run</code> 으로 먼저 검증만 가능. 결과는 JSON 한 덩어리로 출력되며, 일부 실패해도 나머지는 저장 시도 후 exit code 2 로 종료.
                    </p>
                  </div>
                </div>

                {/* 4난도 자동 채움 스케줄러 (/loop) */}
                <div className="rounded-xl border border-fuchsia-600/40 bg-fuchsia-950/20 p-4 space-y-4">
                  <h4 className="text-sm font-bold text-fuchsia-200">🔄 4난도 자동 채움 (10분 간격 · 자동 종료)</h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    교재 전체에서 <span className="text-white font-semibold">essay_exams 가 0 건인 지문</span>들을 자동으로 큐에 올려, 10 분 간격으로 한 지문씩 4 난도 작업을 진행합니다. 우선순위(<span className="text-amber-300">⭐</span>) 가 높은 지문부터. 모두 채워지면 <code className="text-fuchsia-200">{`{done: true}`}</code> 응답을 받고 <span className="text-white font-semibold">자동 종료</span>.
                  </p>

                  {/* ⭐ 권장 — 헬퍼 스크립트 한 줄 (터미널) */}
                  <div className="space-y-1.5 border-l-2 border-emerald-500/60 pl-3">
                    <p className="text-xs font-semibold text-emerald-300">⭐ 권장 ① 헬퍼 스크립트 한 줄 — 터미널에서 실행</p>
                    <CmdBlock
                      label="loop-script"
                      cmd={`./scripts/run-essay-loop.sh "${tb}"`}
                    />
                    <p className="text-xs text-slate-400 leading-relaxed">
                      자동으로 <code className="text-slate-300">claude --dangerously-skip-permissions</code> 띄우고 첫 메시지까지 입력합니다. ScheduleWakeup 으로 10 분마다 자동 진행 — <span className="text-emerald-300 font-semibold">권한 프롬프트·paste 사고 없음</span>. 8 교재 병렬은 <code className="text-slate-300">./scripts/run-essay-loop-multi.sh &quot;교재1&quot; &quot;교재2&quot; ...</code>
                    </p>
                  </div>

                  {/* ② claude 안에서 /loop 한 줄 */}
                  <div className="space-y-1.5 border-l-2 border-fuchsia-500/60 pl-3">
                    <p className="text-xs font-semibold text-fuchsia-300">② claude 안에서 한 줄 호출 — 이미 띄운 세션에서</p>
                    <CmdBlock
                      label="loop-one-liner"
                      cmd={`/loop 10m @scripts/cc-essay-loop-prompt.md 워크플로우대로 교재 "${tb}" 1 cycle 돌려줘. ScheduleWakeup 은 /loop 가 대신하니 호출하지 마.`}
                    />
                    <p className="text-xs text-slate-400 leading-relaxed">
                      이미 띄워둔 claude 세션에 위 한 줄을 paste. <span className="text-fuchsia-200">단일 라인이라 truncate 위험 없음</span>. <code>@scripts/cc-essay-loop-prompt.md</code> 가 워크플로우를 inline expansion. 권한 우회가 필요하면 claude 를 <code className="text-slate-300">claude --dangerously-skip-permissions</code> 로 미리 띄워둘 것.
                    </p>
                  </div>

                  <details className="border border-fuchsia-700/40 rounded-lg bg-slate-900/40">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-fuchsia-300 hover:text-white select-none">
                      📋 (옛 방식) 긴 프롬프트 paste — 멀티라인이라 [Pasted text #N] 첨부로 변환되면 /loop 가 못 읽음
                    </summary>
                    <div className="px-3 pb-3 pt-1 space-y-1.5">
                      <CmdBlock
                        label="loop-prompt"
                        cmd={[
                          `교재 "${tb}" 에서 essay_exams 가 0 건인 지문 1 건을 찾아 4 난도(기본·중·고·최고) 모두 만들어 저장해줘.`,
                          `저장 폴더는 "${fold}".`,
                          ``,
                          `실행 순서:`,
                          `1. npm run cc:essay -- next-empty --textbook "${tb}"  로 다음 지문 받기`,
                          `2. 응답이 {done: true} 면 — 모두 완료. 사용자에게 "「${tb}」 자동 채움 완료" 알리고 ScheduleWakeup 호출하지 말고 종료.`,
                          `3. 응답에 next.passage_id 가 있으면:`,
                          `   a. npm run cc:essay -- passage --id <passage_id>  로 지문·문장표 받기`,
                          `   b. assets/exam_kit/generation_prompt.md + 난이도 부록 규칙대로 4 개 ExamData JSON 작성`,
                          `      - 기본 → .essay-drafts/<sourceKey_slug>_basic.json`,
                          `      - 중   → .essay-drafts/<sourceKey_slug>_mid.json`,
                          `      - 고   → .essay-drafts/<sourceKey_slug>_hard.json`,
                          `      - 최고 → .essay-drafts/<sourceKey_slug>_max.json`,
                          `      (sourceKey_slug 는 영문·숫자·한글 외 문자를 _ 로 치환)`,
                          `   c. npm run cc:essay -- save-all 의 4 개 인자로 위 파일들을 묶어 일괄 저장`,
                          `   d. 검증 실패가 한 건이라도 있으면 — 멈추고 사용자에게 오류 알리고 ScheduleWakeup 호출 안 함 (--force 자동 우회 금지)`,
                          `4. 정상 저장 완료 시 — 다음 tick 은 10 분 후 자동 재호출됨 (사용자는 채팅에 아무 입력 안 하면 됨)`,
                          ``,
                          `난이도별 핵심 차이 — 기본: 변형 0 (셔플만) / 중: 1~2 청크 어형 변형 / 고: 키워드 lemma 알파벳순 (완전 영작) / 최고: 키워드 없음 한국어 해석만 (완전 영작). 난이도별 문법 포인트가 겹치지 않도록 문장 선택.`,
                        ].join('\n')}
                      />
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Claude Code 채팅에 paste 시 「[Pasted text #1 +N lines]」 첨부로 자동 변환되면 <code className="text-fuchsia-200">/loop</code> skill 이 내용을 못 읽어 실패합니다. 가능하면 위의 ⭐ 권장 ① 또는 ② 옵션 사용.
                      </p>
                    </div>
                  </details>

                  <details className="border border-fuchsia-700/40 rounded-lg bg-slate-900/40">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-fuchsia-300 hover:text-white select-none">
                      💡 큐 상태만 확인하고 싶다면? (생성 안 함)
                    </summary>
                    <div className="px-3 pb-3 pt-1 text-xs text-slate-300 leading-relaxed space-y-1">
                      <p>아래 명령 한 번으로 다음 작업 대상 지문과 남은 건수를 확인할 수 있습니다.</p>
                      <CmdBlock
                        label="loop-peek"
                        cmd={`npm run cc:essay -- next-empty --textbook "${tb}"`}
                      />
                      <p className="text-slate-400 mt-1">
                        응답의 <code>empty_passages</code> = 아직 0 건인 지문 수, <code>next.priority</code> = ⭐ 우선순위. <code>done: true</code> 면 큐가 비어있음.
                      </p>
                    </div>
                  </details>
                </div>

                {/* 배치 처리 — 2개 이상 */}
                <div className="rounded-xl border border-sky-600/40 bg-sky-950/20 p-4 space-y-4">
                  <h4 className="text-sm font-bold text-sky-200">📦 배치 처리 — 여러 지문 한 난이도</h4>

                  {/* Step A */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-sky-300">① shortage 실행 → 부족 지문 목록 확인</p>
                    <CmdBlock
                      label="batch-shortage"
                      cmd={`npm run cc:essay -- shortage --textbook "${tb}" --required 1 --difficulty ${difficulty}`}
                    />
                    <p className="text-xs text-slate-400 leading-relaxed">
                      출력의 <code className="text-slate-300">shortage[]</code> 배열에 처리해야 할 지문 목록(passage_id 포함)이 나옵니다.
                    </p>
                  </div>

                  {/* Step B */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-sky-300">② 아래 배치 프롬프트를 Claude Code 채팅에 붙여넣기</p>
                    <CmdBlock
                      label="batch-prompt"
                      cmd={[
                        `위 shortage 결과의 shortage[] 배열에 있는 지문들을 순서대로 모두 처리해줘.`,
                        `교재: "${tb}" / 난이도: ${difficulty} / 폴더: ${fold}`,
                        ``,
                        `각 지문마다 아래 순서로 진행해줘:`,
                        `1. npm run cc:essay -- passage --id <passage_id>  로 지문·문장표 받기`,
                        `2. generation_prompt.md 규칙대로 ExamData JSON 작성 (.essay-drafts/<sourceKey>.json 에 저장)`,
                        `3. npm run cc:essay -- save --json .essay-drafts/<sourceKey>.json --dry-run  으로 검증`,
                        `4. 검증 통과 시 npm run cc:essay -- save --json .essay-drafts/<sourceKey>.json  으로 저장`,
                        `모든 지문 저장 완료 후 결과 요약을 보여줘.`,
                      ].join('\n')}
                    />
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Claude Code가 shortage 결과를 읽고 부족한 지문을 <span className="text-white font-semibold">자동으로 하나씩 반복</span>해서 완성까지 처리합니다.
                    </p>
                  </div>

                  {/* 팁 */}
                  <details className="border border-sky-700/40 rounded-lg bg-slate-900/40">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-sky-300 hover:text-white select-none">
                      💡 passageId를 직접 지정하고 싶다면?
                    </summary>
                    <div className="px-3 pb-3 pt-1 text-xs text-slate-300 leading-relaxed space-y-1">
                      <p>아래처럼 여러 passageId를 나열하면 순서대로 처리합니다.</p>
                      <CmdBlock
                        label="batch-manual"
                        cmd={[
                          `아래 지문들을 순서대로 ${difficulty}로 만들어 cc:essay save로 저장해줘.`,
                          `교재: "${tb}" / 난이도: ${difficulty} / 폴더: ${fold}`,
                          ``,
                          `- [교재] [문제번호] (passageId: aaa111...)`,
                          `- [교재] [문제번호] (passageId: bbb222...)`,
                          `- [교재] [문제번호] (passageId: ccc333...)`,
                          ``,
                          `각 지문마다 passage --id → JSON 작성 → save 순으로 진행해줘.`,
                        ].join('\n')}
                      />
                      <p className="text-slate-400 mt-1">
                        passageId는 위 「2. 지문 받기」 명령의 <code>--id</code> 뒤에 있는 값, 또는 shortage 결과의 <code>passage_id</code> 필드입니다.
                      </p>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <main className="flex-1 flex min-h-0 overflow-hidden" style={{ height: '100vh' }}>
        {/* ── 좌측 입력 패널 ── (min-h-0 + 내부 스크롤로 flex 자식이 뷰포트 밖으로 잘리지 않게) */}
        <div
          className={`shrink-0 flex min-h-0 min-w-0 flex-col border-r border-slate-700 overflow-hidden transition-all duration-200 ${
            collapsed ? 'w-0 overflow-hidden border-r-0' : 'w-[380px]'
          }`}
        >
          <div className="shrink-0 px-6 pt-6 pb-4 border-b border-slate-700 space-y-3">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-white tracking-tight whitespace-nowrap">서술형 출제기</h2>
              <p className="text-slate-400 text-sm mt-0.5">배열 쓰기(서·논술형) 문제 자동 생성</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText('claude --dangerously-skip-permissions');
                    setSaveMsg('💻 claude --dangerously-skip-permissions 복사됨 — 터미널에 붙여넣기');
                    setTimeout(() => setSaveMsg(''), 2000);
                  } catch {}
                }}
                className="text-[11px] px-2 py-1 rounded-md border border-amber-600/60 bg-amber-950/30 text-amber-200 hover:bg-amber-900/40 hover:border-amber-500 transition-colors font-mono whitespace-nowrap"
                title="터미널 첫 진입 — 권한 프롬프트 모두 우회. claude --dangerously-skip-permissions 복사. 헬퍼 스크립트(run-essay-loop.sh 등)는 자동으로 이 플래그를 붙입니다."
              >
                💻 진입
              </button>
              <button
                type="button"
                onClick={() => setCcEssayModalOpen(true)}
                className="text-[11px] px-2 py-1 rounded-md border border-emerald-600/70 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50 hover:border-emerald-500 transition-colors font-medium whitespace-nowrap"
                title="Claude Code CLI 사용 안내 모달"
              >
                cc:essay
              </button>
              <button
                type="button"
                onClick={() => setShowCoverage(true)}
                className="text-[11px] px-2 py-1 rounded-md border border-amber-700/70 bg-amber-950/30 text-amber-200 hover:bg-amber-900/40 hover:border-amber-600 transition-colors font-medium whitespace-nowrap"
                title="교재별 출제 진행 현황과 지문 우선순위"
              >
                📊 현황
              </button>
              <button
                type="button"
                onClick={() => setShowSavedList(true)}
                className="text-[11px] px-2 py-1 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors font-medium whitespace-nowrap"
                title="저장된 서술형 시험지 목록"
              >
                📂 목록
              </button>
            </div>
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 flex flex-col gap-5 scrollbar-thin"
          >
            {/* 제목 */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">시험지 제목</label>
              <input
                value={examTitle}
                onChange={e => {
                  setExamTitle(e.target.value);
                  localStorage.setItem(EXAM_TITLE_KEY, e.target.value);
                }}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                placeholder="영어 서·논술형 평가"
              />
            </div>

            {/* 학교명 / 학년 */}
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
              <div className="flex-1 min-w-0">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">고등학교 이름</label>
                <input
                  value={schoolName}
                  onChange={e => setSchoolName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                  placeholder="(선택)"
                />
              </div>
              <div className="w-full sm:w-32 shrink-0">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">학년</label>
                <input
                  value={grade}
                  onChange={e => setGrade(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                  placeholder="(선택)"
                />
              </div>
            </div>

            {/* 저장 폴더 (신규 저장·CLI 예시·덮어쓰기 시 폴더 반영) */}
            <div className="rounded-xl border border-slate-600/80 bg-slate-800/40 px-3 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-slate-200">저장 폴더</label>
                <button
                  type="button"
                  onClick={() => { void refreshFolders(); }}
                  className="text-[11px] px-2 py-1 rounded-md border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700"
                >
                  목록 새로고침
                </button>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                💾 저장·cc:essay 예시 JSON 의 <code className="text-slate-400">folder</code> 값입니다. 오른쪽 「저장」·덮어쓰기에도 적용됩니다. 아래에서 기존 폴더를 고르거나 새 이름을 입력하세요.
              </p>
              <input
                list="essay-save-folder-datalist"
                value={saveFolder}
                onChange={e => setSaveFolder(e.target.value.trim() ? e.target.value : '기본')}
                onFocus={() => { void refreshFolders(); }}
                placeholder="예: 기본, 지금필수 고난도유형"
                className="w-full text-sm bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-slate-400"
              />
              <datalist id="essay-save-folder-datalist">
                {folderOptions.map(f => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>

            {/* 지문 */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-slate-300">
                  영어 지문 <span className="text-red-400">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="text-xs px-2.5 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white transition-colors font-medium"
                >
                  DB에서 불러오기
                </button>
              </div>

              {selectedPassageInfo && (
                <div className="mb-1.5 flex items-center gap-2 text-xs bg-blue-500/15 border border-blue-500/30 rounded-lg px-3 py-1.5">
                  <span className="text-blue-400 font-medium truncate">
                    {selectedPassageInfo.textbook} · {selectedPassageInfo.sourceKey}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setSelectedPassageInfo(null); setPassage(''); }}
                    className="ml-auto shrink-0 text-slate-500 hover:text-white"
                  >×</button>
                </div>
              )}

              <textarea
                value={passage}
                onChange={e => { setPassage(e.target.value); setSelectedPassageInfo(null); setTargetSentences(new Set()); }}
                placeholder="영어 원문 지문을 붙여넣거나 DB에서 불러오세요..."
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 font-mono leading-relaxed resize-none h-44 overflow-y-auto scrollbar-thin"
              />
            </div>

            {/* 난이도 */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">난이도</label>
              <div className="flex gap-2 flex-wrap">
                {([
                  { key: '기본난도' as const, label: '기본난도', activeCls: 'bg-emerald-700 text-white border-emerald-700' },
                  { key: '중난도' as const, label: '중난도', activeCls: 'bg-amber-600 text-white border-amber-600' },
                  { key: '고난도' as const, label: '고난도', activeCls: 'bg-red-700 text-white border-red-700' },
                  { key: '최고난도' as const, label: '최고난도', activeCls: 'bg-purple-700 text-white border-purple-700' },
                ]).map(({ key, label, activeCls }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDifficulty(key)}
                    className={`flex-1 min-w-[5rem] py-2 rounded-lg text-xs font-semibold transition-colors border ${
                      difficulty === key
                        ? activeCls
                        : 'border-slate-600 text-slate-400 hover:bg-slate-700/60 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-2 rounded-xl border border-slate-700/80 bg-slate-900/40 p-2.5">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-[11px] text-slate-500 leading-snug">
                    이 난이도로 생성할 때 Claude <span className="text-slate-400">user</span> 메시지 끝에 붙는{' '}
                    <span className="text-slate-400">추가 출제 지시</span>입니다. (시험지에 찍히는 문항 조건 문장과는 별개)
                  </p>
                  <span
                    className="shrink-0 text-[10px] text-slate-500 whitespace-nowrap"
                    title="부록 본문을 수정할 때 lib/essay-generator-difficulty-appendix.ts 의 LAST_UPDATED 를 함께 bump"
                  >
                    최종 수정: {ESSAY_DIFFICULTY_APPENDIX_LAST_UPDATED}
                  </span>
                </div>
                <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap leading-relaxed max-h-44 overflow-y-auto scrollbar-thin">
                  {ESSAY_DIFFICULTY_APPENDIX_TEXT[difficulty]}
                </pre>
              </div>
            </div>

            {/* 문항 번호 + 배점 */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">문항 번호</label>
                <input
                  value={questionNumber}
                  onChange={e => setQuestionNumber(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                  placeholder="서·논술형"
                />
              </div>
              <div className="w-28">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  총 배점 <span className="text-slate-500 font-normal">(최대 10)</span>
                </label>
                <input
                  type="number"
                  value={totalPoints}
                  onChange={e => setTotalPoints(e.target.value === '' ? '' : Math.min(10, Number(e.target.value)))}
                  placeholder="자동"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                  min={1}
                  max={10}
                />
              </div>
            </div>

            {/* 시험지 부제 */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                시험지 부제 <span className="text-slate-500 font-normal">(선택)</span>
              </label>
              <input
                value={examSubtitle}
                onChange={e => setExamSubtitle(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                placeholder="예: 2026학년도 모의고사 3회 · Lyceum"
              />
            </div>

            {/* 조건·출제 프롬프트 (Claude system) */}
            <div className="rounded-xl border border-slate-700 overflow-hidden bg-slate-800/40">
              <button
                type="button"
                onClick={() => setConditionPromptOpen(v => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-300 hover:bg-slate-700/40 transition-colors"
              >
                <span>조건·출제 프롬프트 <span className="text-slate-500 font-normal">(Claude system)</span></span>
                <span className="flex items-center gap-3 shrink-0">
                  {systemPromptMtime && (
                    <span
                      className="text-[10px] text-slate-500 whitespace-nowrap font-normal"
                      title={`generation_prompt.md 마지막 수정 (서버 파일 기준)\n${systemPromptMtime}`}
                    >
                      서버 파일: {new Date(systemPromptMtime).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  )}
                  <span className="text-slate-500">{conditionPromptOpen ? '접기 ▲' : '펼치기 ▼'}</span>
                </span>
              </button>
              {conditionPromptOpen && (
                <div className="px-3 pb-3 pt-0 border-t border-slate-700/80 space-y-2">
                  <p className="text-xs text-slate-500 leading-relaxed">
                    출제 규칙·JSON 형식 등이 정의된 시스템 프롬프트입니다. 비우고 생성하면 저장소 기본 파일(<code className="text-slate-400">generation_prompt.md</code>)이 적용됩니다. 수정 내용은 이 브라우저에 저장됩니다.
                  </p>
                  <textarea
                    value={systemPrompt}
                    onChange={e => {
                      const v = e.target.value;
                      setSystemPrompt(v);
                      if (typeof window !== 'undefined') localStorage.setItem(SYSTEM_PROMPT_KEY, v);
                    }}
                    spellCheck={false}
                    className="w-full min-h-[200px] max-h-72 overflow-y-auto scrollbar-thin bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:border-slate-500"
                    placeholder="불러오는 중…"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const r = await fetch('/api/admin/essay-generator/generation-prompt', { credentials: 'include' });
                          const d = await r.json();
                          if (typeof d.prompt === 'string') {
                            setSystemPrompt(d.prompt);
                            if (typeof window !== 'undefined') localStorage.removeItem(SYSTEM_PROMPT_KEY);
                          }
                        } catch { /* ignore */ }
                      }}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                      기본 파일로 되돌리기
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSystemPrompt('');
                        if (typeof window !== 'undefined') localStorage.removeItem(SYSTEM_PROMPT_KEY);
                      }}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                      비우기 (서버 기본)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 반드시 포함할 문장 */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-slate-300">
                    반드시 포함할 문장 <span className="text-slate-500 font-normal">(선택)</span>
                  </label>
                  {essaySentenceIndices.length > 0 && (
                    <span className="text-xs text-emerald-400 font-medium">
                      ● 서술형대비 {essaySentenceIndices.length}개
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {sentences.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSentenceListExpanded(v => !v)}
                      className="text-xs text-slate-500 hover:text-white transition-colors"
                    >
                      {sentenceListExpanded ? '접기 ▲' : '펼치기 ▼'}
                    </button>
                  )}
                  {targetSentences.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setTargetSentences(new Set())}
                      className="text-xs text-slate-500 hover:text-white transition-colors"
                    >
                      선택 해제
                    </button>
                  )}
                </div>
              </div>

              {sentences.length === 0 ? (
                <p className="text-xs text-slate-600 px-1">지문을 입력하면 문장 목록이 나타납니다</p>
              ) : (
                <div className={`flex flex-col gap-1 overflow-y-auto pr-1 transition-all scrollbar-thin ${sentenceListExpanded ? 'max-h-[36rem]' : 'max-h-44'}`}>
                  {sentences.map((s, i) => {
                    const selected = targetSentences.has(s);
                    const isEssay = essaySentenceIndices.includes(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleSentence(s)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs leading-relaxed transition-colors border font-mono ${
                          selected
                            ? 'bg-blue-600/25 border-blue-500/60 text-blue-200'
                            : isEssay
                            ? 'bg-emerald-900/30 border-emerald-600/50 text-emerald-200 hover:bg-emerald-800/40 hover:border-emerald-500/70'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                        }`}
                      >
                        <span className={`inline-block mr-1.5 font-bold ${selected ? 'text-blue-400' : isEssay ? 'text-emerald-400' : 'text-slate-600'}`}>
                          {selected ? '✓' : isEssay ? '★' : `${i + 1}.`}
                        </span>
                        {s}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 오류 */}
            {error && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-xl px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {/* 생성 버튼 */}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="w-full py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 transition-colors text-sm"
            >
              {loading ? '생성 중 (약 20~40초)...' : '✦ 서술형 문제 생성'}
            </button>
          </div>
        </div>

        {/* ── 우측 프리뷰 패널 ── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* Row 1: 타이틀 + 네비 + 상태 + 액션 (저장·JSON·인쇄) */}
          <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-slate-700 whitespace-nowrap">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setCollapsed(v => !v)}
                title={collapsed ? '패널 펼치기' : '패널 접기'}
                className="text-slate-400 hover:text-white transition-colors p-1 rounded hover:bg-slate-700 leading-none"
              >
                {collapsed ? '→|' : '|←'}
              </button>
              <span className="font-semibold text-white text-sm">미리보기</span>
              {currentSavedId && (
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={!navAvailability.prev}
                    onClick={() => void navigateExam('prev')}
                    title="같은 폴더 내 이전 항목 (⌘+←)"
                    className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold leading-none"
                  >←</button>
                  <button
                    type="button"
                    disabled={!navAvailability.next}
                    onClick={() => void navigateExam('next')}
                    title="같은 폴더 내 다음 항목 (⌘+→)"
                    className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold leading-none"
                  >→</button>
                </div>
              )}
              {examData && (
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-full font-medium leading-none">
                  ✓ 생성
                </span>
              )}
              {saveMsg && (
                <span className="text-xs text-emerald-400 font-medium ml-1">{saveMsg}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {examData && (
                <>
                  <span
                    className="text-[10px] text-slate-500 max-w-[8rem] truncate shrink-0"
                    title={`저장 폴더: ${saveFolder} — 왼쪽 「저장 폴더」에서 변경`}
                  >
                    📁 {saveFolder}
                  </span>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-2.5 py-1 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors font-semibold whitespace-nowrap"
                  >
                    {saving ? '저장…' : currentSavedId ? '💾 덮어쓰기' : '💾 저장'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowJson(v => !v)}
                    className="px-2.5 py-1 text-xs rounded-md border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors font-medium whitespace-nowrap"
                  >
                    {showJson ? '← 프리뷰' : 'JSON'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="px-2.5 py-1 text-xs rounded-md bg-white text-slate-900 hover:bg-slate-200 transition-colors font-bold whitespace-nowrap"
                  >
                    🖨 PDF
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Row 2: 줌 / SVOC 도구 (examData 있을 때만) */}
          {examData && !showJson && (
            <div className="shrink-0 flex items-center gap-3 px-4 py-1.5 border-b border-slate-700/60 bg-slate-900/40 whitespace-nowrap">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">보기</span>
                <button
                  type="button"
                  title="축소"
                  onClick={() => setPreviewScale(s => Math.max(0.6, Math.round((s - 0.1) * 10) / 10))}
                  className="w-6 h-6 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white text-sm font-bold leading-none"
                >−</button>
                <span className="text-[11px] text-slate-400 tabular-nums w-10 text-center">{Math.round(previewScale * 100)}%</span>
                <button
                  type="button"
                  title="확대"
                  onClick={() => setPreviewScale(s => Math.min(1.8, Math.round((s + 0.1) * 10) / 10))}
                  className="w-6 h-6 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white text-sm font-bold leading-none"
                >+</button>
                <button
                  type="button"
                  title="100%로 초기화"
                  onClick={() => setPreviewScale(1)}
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700"
                >초기화</button>
              </div>

              <div className="flex items-center gap-1 pl-3 border-l border-slate-700">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide" title="미리보기에서 텍스트를 드래그한 뒤 누르면(또는 단축키) 그 부분에 색칠 — 단축키: 선택 후 S·V·O·C·M, 지우기 0">SVOC<span className="ml-1 normal-case text-slate-600">(단축키 S V O C M · 지우기 0)</span></span>
                <button
                  type="button"
                  onClick={() => applySvocToSelection('S')}
                  title="주어(S) · 단축키 S"
                  className="w-6 h-6 rounded text-[11px] font-bold border border-sky-500/70 bg-sky-500/15 text-sky-100 hover:bg-sky-500/30 leading-none"
                >S</button>
                <button
                  type="button"
                  onClick={() => applySvocToSelection('V')}
                  title="동사(V) · 단축키 V"
                  className="w-6 h-6 rounded text-[11px] font-bold border border-orange-500/70 bg-orange-500/15 text-orange-100 hover:bg-orange-500/30 leading-none"
                >V</button>
                <button
                  type="button"
                  onClick={() => applySvocToSelection('O')}
                  title="목적어(O) · 단축키 O"
                  className="w-6 h-6 rounded text-[11px] font-bold border border-emerald-500/70 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/30 leading-none"
                >O</button>
                <button
                  type="button"
                  onClick={() => applySvocToSelection('C')}
                  title="보어(C) · 단축키 C"
                  className="w-6 h-6 rounded text-[11px] font-bold border border-violet-500/70 bg-violet-500/15 text-violet-100 hover:bg-violet-500/30 leading-none"
                >C</button>
                <button
                  type="button"
                  onClick={() => applySvocToSelection('M')}
                  title="수식어·구·절(M) · 단축키 M"
                  className="w-6 h-6 rounded text-[11px] font-bold border border-slate-500/70 bg-slate-500/15 text-slate-100 hover:bg-slate-500/30 leading-none"
                >M</button>
                <button
                  type="button"
                  onClick={() => applySvocToSelection('clear')}
                  title="선택 영역의 SVOC 색 제거 · 단축키 0"
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700"
                >지우기</button>
              </div>

              {/* 글자 편집 — 선택 영역에 서식 적용 (미리보기 편집) */}
              <div className="flex items-center gap-1 pl-3 border-l border-slate-700">
                <span className="text-[10px] text-slate-500 uppercase tracking-wide" title="미리보기에서 텍스트를 드래그한 뒤 누르면 그 부분에 서식 적용 (편집 가능)">글자</span>
                <button type="button" onClick={() => applyFormatToSelection('bold')} title="굵게 (선택 후) · ⌘B"
                  className="w-6 h-6 rounded text-[12px] font-bold border border-slate-600 text-slate-100 hover:bg-slate-700 leading-none">B</button>
                <button type="button" onClick={() => applyFormatToSelection('italic')} title="기울임 · ⌘I"
                  className="w-6 h-6 rounded text-[12px] italic font-serif border border-slate-600 text-slate-100 hover:bg-slate-700 leading-none">I</button>
                <button type="button" onClick={() => applyFormatToSelection('underline')} title="밑줄 · ⌘U"
                  className="w-6 h-6 rounded text-[12px] underline border border-slate-600 text-slate-100 hover:bg-slate-700 leading-none">U</button>
                <button type="button" onClick={() => applyFormatToSelection('strike')} title="취소선"
                  className="w-6 h-6 rounded text-[12px] line-through border border-slate-600 text-slate-100 hover:bg-slate-700 leading-none">S</button>
                <button type="button" onClick={() => applyFormatToSelection('sizeUp')} title="글자 크게"
                  className="px-1.5 h-6 rounded text-[12px] font-bold border border-slate-600 text-slate-100 hover:bg-slate-700 leading-none">A+</button>
                <button type="button" onClick={() => applyFormatToSelection('sizeDown')} title="글자 작게"
                  className="px-1.5 h-6 rounded text-[10px] font-bold border border-slate-600 text-slate-300 hover:bg-slate-700 leading-none">A−</button>
                <button type="button" onClick={() => applyFormatToSelection('clearFmt')} title="선택 영역 서식 지우기 (SVOC 색은 유지)"
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700">서식지우기</button>
              </div>

              {/* 단축키 사용법 도움말 */}
              <div className="relative flex items-center pl-3 border-l border-slate-700 ml-auto">
                <button
                  type="button"
                  onClick={() => setShortcutHelpOpen((v) => !v)}
                  title="단축키 사용법 보기"
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${shortcutHelpOpen ? 'border-sky-500/60 bg-sky-950/60 text-sky-200' : 'border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white'}`}
                >
                  <span className="text-sm leading-none">⌨️</span> 단축키
                </button>
                {shortcutHelpOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShortcutHelpOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 z-50 w-[22rem] max-w-[90vw] rounded-xl border border-slate-600 bg-slate-900/98 shadow-2xl shadow-black/50 p-4 text-left">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-bold text-white">단축키 사용법</p>
                        <button type="button" onClick={() => setShortcutHelpOpen(false)} className="text-slate-500 hover:text-white text-sm leading-none">✕</button>
                      </div>
                      <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                        미리보기에서 <b className="text-slate-200">텍스트를 드래그해 선택</b>한 뒤, 아래 키를 누르거나 버튼을 클릭하면 그 부분에 적용됩니다. (미리보기가 편집 모드일 때)
                      </p>
                      <div className="space-y-3">
                        <div>
                          <p className="text-[11px] font-bold text-sky-300 mb-1.5">SVOC 문장성분 색칠</p>
                          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                            <kbd className="justify-self-start px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-100 font-mono text-[11px]">S</kbd><span className="text-slate-300 self-center">주어 (파랑)</span>
                            <kbd className="justify-self-start px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-100 font-mono text-[11px]">V</kbd><span className="text-slate-300 self-center">동사 (주황)</span>
                            <kbd className="justify-self-start px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-100 font-mono text-[11px]">O</kbd><span className="text-slate-300 self-center">목적어 (초록)</span>
                            <kbd className="justify-self-start px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-100 font-mono text-[11px]">C</kbd><span className="text-slate-300 self-center">보어 (보라)</span>
                            <kbd className="justify-self-start px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-100 font-mono text-[11px]">M</kbd><span className="text-slate-300 self-center">수식어 (회색)</span>
                            <kbd className="justify-self-start px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-100 font-mono text-[11px]">0</kbd><span className="text-slate-300 self-center">선택 영역 태그 지우기</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold text-emerald-300 mb-1.5">글자 서식</p>
                          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                            <kbd className="justify-self-start px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-100 font-mono text-[11px]">⌘/Ctrl B</kbd><span className="text-slate-300 self-center">굵게 (버튼 <b>B</b>)</span>
                            <kbd className="justify-self-start px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-100 font-mono text-[11px]">⌘/Ctrl I</kbd><span className="text-slate-300 self-center">기울임 (버튼 <i>I</i>)</span>
                            <kbd className="justify-self-start px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-100 font-mono text-[11px]">⌘/Ctrl U</kbd><span className="text-slate-300 self-center">밑줄 (버튼 <u>U</u>)</span>
                            <span className="justify-self-start text-slate-500 text-[11px] self-center">버튼</span><span className="text-slate-300 self-center"><b>S</b> 취소선 · <b>A+</b>/<b>A−</b> 크게/작게 · <b>서식지우기</b></span>
                          </div>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold text-amber-300 mb-1.5">보기 · 이동</p>
                          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                            <kbd className="justify-self-start px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-100 font-mono text-[11px]">−／＋</kbd><span className="text-slate-300 self-center">미리보기 축소／확대 (초기화 100%)</span>
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-3 pt-2 border-t border-slate-700 leading-relaxed">
                        ※ 단축키는 미리보기 안에서 텍스트가 <b className="text-slate-400">선택된 상태</b>일 때만 동작하며, 입력칸(제목 등)에 커서가 있을 땐 무시됩니다.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-auto p-6">
            {!examData && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <p className="text-base font-medium text-slate-400">지문을 입력하고 생성 버튼을 누르세요</p>
                <p className="text-sm mt-1">배열 쓰기(서·논술형) 문제와 해설이 자동 생성됩니다</p>
              </div>
            )}

            {loading && (
              <div className="flex flex-col items-center justify-center h-full text-slate-500">
                <div className="w-10 h-10 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-4" />
                <p className="font-medium text-slate-300">Claude가 문제를 출제 중입니다...</p>
                <p className="text-sm mt-1">지문 분석 → 문법 포인트 선정 → JSON 생성</p>
              </div>
            )}

            {examData && !loading && (
              <>
                {showJson ? (
                  <div className="flex flex-col gap-3 h-full">
                    <textarea
                      value={jsonEdit}
                      onChange={e => setJsonEdit(e.target.value)}
                      className="flex-1 w-full bg-slate-800 border border-slate-700 rounded-xl p-4 text-xs font-mono text-slate-200 resize-none focus:outline-none focus:border-slate-500 leading-relaxed"
                      style={{ minHeight: '500px' }}
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleJsonApply}
                        className="px-5 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors font-semibold"
                      >
                        JSON 적용
                      </button>
                      <span className="text-xs text-slate-500">수정 후 적용하면 미리보기가 갱신됩니다</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 w-full">
                    <div
                      className="bg-white shadow-2xl rounded overflow-hidden mx-auto"
                      style={{
                        width: PREVIEW_BASE_W * previewScale,
                        height: PREVIEW_BASE_H * previewScale,
                      }}
                    >
                      <iframe
                        ref={iframeRef}
                        srcDoc={examHtml}
                        title="서술형 문제 프리뷰"
                        className="border-0 rounded block"
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
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
