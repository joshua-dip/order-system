'use client';

/**
 * 어법공략 워크북 — 4가지 유형(어형 변환·양자택일·어법 오류 수정·O/X 채점).
 *
 * UI: 서술형 출제기와 동일한 좌측 입력 패널(380px) + 우측 미리보기 패턴.
 *
 * 흐름:
 *   1. PassagePickerModal 로 지문 선택 (또는 O/X 는 직접 입력)
 *   2. 본문 토큰 클릭으로 블록 토글 (또는 O/X 는 보기 항목 추가)
 *   3. 각 블록·항목에 필요한 메타 입력 (baseForm / wrongForm / 정답 + 어법 설명)
 *   4. 우측 미리보기 + Word/PDF 내보내기
 *
 * 정답지의 「어법 설명」 — 학생이 왜 이게 답인지 이해할 수 있도록 각 정답 카드에 노출.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PassagePickerModal, { PassageItem } from '../../_components/PassagePickerModal';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import { SelectionBlock } from '@/lib/block-workbook-types';
import {
  buildTransformHtml,
  buildEitherOrHtml,
  buildCorrectionHtml,
  buildOxHtml,
  buildPointsAnalysisHtml,
  EitherOrPoint,
  CorrectionSpan,
  OxItem,
  GrammarPoint,
  DEFAULT_GRAMMAR_TYPES,
  syncPointsToModes,
} from '@/lib/grammar-workbook-html';
import type { GrammarMode } from '@/lib/grammar-workbooks-store';

interface SavedListItem {
  _id: string;
  passageId?: string;
  title: string;
  textbook: string;
  sourceKey: string;
  folder: string;
  modes: GrammarMode[];
  updatedAt: string;
}

interface CoverageItem {
  textbook: string;
  passagesTotal: number;
  workbookPassagesCovered: number;
  coverageRate: number;
  modeCounts: Record<GrammarMode, number>;
}

interface PassageGridRow {
  passage_id: string;
  chapter: string;
  number: string;
  source_key: string;
  has_F: boolean;
  has_G: boolean;
  has_H: boolean;
  has_J: boolean;
  doc_id?: string;
  folder?: string;
  updated_at?: string;
}

type Mode = 'points' | 'transform' | 'eitherOr' | 'correction' | 'ox';

const MODE_TABS: { key: Mode; label: string; tag: string; activeCls: string }[] = [
  { key: 'points', label: '포인트', tag: '✨', activeCls: 'bg-amber-600 text-white border-amber-600' },
  { key: 'transform', label: '어형 변환', tag: 'F', activeCls: 'bg-blue-700 text-white border-blue-700' },
  { key: 'eitherOr', label: '양자택일', tag: 'G', activeCls: 'bg-emerald-700 text-white border-emerald-700' },
  { key: 'correction', label: '어법 오류 수정', tag: 'H', activeCls: 'bg-red-700 text-white border-red-700' },
  { key: 'ox', label: 'O·X 채점', tag: 'J', activeCls: 'bg-purple-700 text-white border-purple-700' },
];

const META_KEYS = {
  examTitle: 'grammar_workbook_exam_title',
  schoolName: 'grammar_workbook_school_name',
  grade: 'grammar_workbook_grade',
  questionNumber: 'grammar_workbook_question_number',
  examSubtitle: 'grammar_workbook_exam_subtitle',
} as const;

/** 마지막으로 불러오거나 저장한 워크북 doc id — 페이지 재진입 시 자동 복원. */
const LAST_DOC_KEY = 'grammar_workbook_last_doc_id';

export default function GrammarWorkbookPage() {
  const [showPicker, setShowPicker] = useState(false);
  const [passage, setPassage] = useState<PassageItem | null>(null);
  const [mode, setMode] = useState<Mode>('transform');

  // ── 시험지 메타 (essay-generator 와 동일 패턴) ──
  const [examTitle, setExamTitle] = useState('영어 어법공략 평가');
  const [schoolName, setSchoolName] = useState('');
  const [grade, setGrade] = useState('');
  const [questionNumber, setQuestionNumber] = useState('어법공략');
  const [examSubtitle, setExamSubtitle] = useState('');

  // ── 모드별 state (탭 전환해도 보존) ──
  const [transformBlocks, setTransformBlocks] = useState<SelectionBlock[]>([]);
  const [eitherOrPoints, setEitherOrPoints] = useState<EitherOrPoint[]>([]);
  const [correctionSpans, setCorrectionSpans] = useState<CorrectionSpan[]>([]);
  const [oxItems, setOxItems] = useState<OxItem[]>([
    { text: '', isCorrect: true, correction: '', explanation: '' },
  ]);
  const [oxIntro, setOxIntro] = useState('');

  // 어법 오류 수정 — 다중 토큰 선택용 임시 anchor
  const [correctionAnchor, setCorrectionAnchor] = useState<{ sentenceIdx: number; tokenIdx: number } | null>(null);

  // ── ✨ 포인트 모드 ──
  const [grammarPoints, setGrammarPoints] = useState<GrammarPoint[]>([]);
  /** 포인트 모드 — Shift+클릭 으로 구간 만들기 위한 anchor. */
  const [pointAnchor, setPointAnchor] = useState<{ sentenceIdx: number; tokenIdx: number } | null>(null);
  /** 동기화 시 G·H·J 기존 데이터를 덮어쓸지 (기본 ON). */
  const [autoSyncOnSave, setAutoSyncOnSave] = useState(true);
  const [lastSyncMsg, setLastSyncMsg] = useState('');

  // 저장 폴더
  const [folder, setFolder] = useState('기본');

  // 저장 상태
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);

  // 모달
  const [showListModal, setShowListModal] = useState(false);
  const [showCoverageModal, setShowCoverageModal] = useState(false);
  const [showCliModal, setShowCliModal] = useState(false);
  /** CLI 모달의 「강별 작업」 — 현재 교재의 강 목록 + 부족 카운트 (없으면 빈 배열) */
  const [chapterList, setChapterList] = useState<{ chapter: string; passagesTotal: number; shortBy?: number }[]>([]);
  const [chapterListLoading, setChapterListLoading] = useState(false);

  // 모달 데이터
  const [listItems, setListItems] = useState<SavedListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listFilterText, setListFilterText] = useState('');
  const [coverageItems, setCoverageItems] = useState<CoverageItem[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageFilterText, setCoverageFilterText] = useState('');
  const [coverageSelectedTextbook, setCoverageSelectedTextbook] = useState<string | null>(null);
  const [coverageGridRows, setCoverageGridRows] = useState<PassageGridRow[]>([]);
  const [coverageGridLoading, setCoverageGridLoading] = useState(false);
  const [coverageHideCompleted, setCoverageHideCompleted] = useState(false);
  const [coverageGridSort, setCoverageGridSort] = useState<'natural' | 'progress'>('natural');
  const [coverageCopiedHint, setCoverageCopiedHint] = useState<string | null>(null);
  /** 클립보드 자동 복사 실패 시 사용자가 수동 복사할 수 있는 오버레이. */
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);
  /** PDF 출력 진행 중인 saved 아이템 id (버튼 disable 용) */
  const [printingSavedId, setPrintingSavedId] = useState<string | null>(null);
  /** 저장 목록의 폴더 필터 ('all' = 모두) + 폴더 메타 */
  const [listFolderFilter, setListFolderFilter] = useState<string>('all');
  const [listFolders, setListFolders] = useState<string[]>(['기본']);
  const [listFolderCounts, setListFolderCounts] = useState<Record<string, number>>({});
  const [listTotalCount, setListTotalCount] = useState(0);
  const [folderRenameDraft, setFolderRenameDraft] = useState<{ from: string; to: string } | null>(
    null,
  );
  /** 저장 목록의 선택 상태 — 일괄 폴더 이동/삭제용 */
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  /** 폴더 이동 모달: 열렸을 때 표시할 「새 폴더 이름」 입력 + 기존 폴더 선택 */
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMoveTarget, setBulkMoveTarget] = useState('');
  /** 일괄 PDF 모달 — 합본 / 개별 ZIP + 모드·답지 위치 옵션 */
  const [bulkPdfOpen, setBulkPdfOpen] = useState(false);
  const [bulkPdfMode, setBulkPdfMode] = useState<'combined' | 'zip'>('combined');
  const [bulkPdfLayout, setBulkPdfLayout] = useState<'interleaved' | 'back'>('interleaved');
  const [bulkPdfModes, setBulkPdfModes] = useState<Record<GrammarMode, boolean>>({
    F: true,
    G: true,
    H: true,
    J: true,
  });
  const [bulkPdfIncludePoints, setBulkPdfIncludePoints] = useState(false);
  const [bulkPdfRunning, setBulkPdfRunning] = useState(false);
  /** 목록 정렬 — recent: 최근 수정, name-asc: 이름 오름차순(자연정렬), name-desc: 이름 내림차순 */
  type ListSort = 'recent' | 'name-asc' | 'name-desc';
  const [listSort, setListSort] = useState<ListSort>('recent');
  /** PDF 옵션 다이얼로그 — 선택된 saved 아이템 + 답지 배치/모드 옵션 */
  const [printDialog, setPrintDialog] = useState<{
    id: string;
    title: string;
    modes: GrammarMode[];
  } | null>(null);
  const [printLayout, setPrintLayout] = useState<'interleaved' | 'back'>('interleaved');
  const [printModes, setPrintModes] = useState<Record<GrammarMode, boolean>>({
    F: true,
    G: true,
    H: true,
    J: true,
  });
  const [printIncludePoints, setPrintIncludePoints] = useState(false);

  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const PREVIEW_BASE_W = 794;
  const PREVIEW_BASE_H = 1100;
  const [previewScale, setPreviewScale] = useState(0.75);

  // localStorage 복원 (essay-generator 와 동일)
  // 학교·학년은 기본값을 비워둠 — 세션 간 자동 채움 안 함 (저장된 doc 에서만 복원).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = localStorage.getItem(META_KEYS.examTitle);
    if (t) setExamTitle(t);
    const qn = localStorage.getItem(META_KEYS.questionNumber);
    if (qn) setQuestionNumber(qn);
    const sub = localStorage.getItem(META_KEYS.examSubtitle);
    if (sub !== null) setExamSubtitle(sub);
  }, []);

  const sentences = useMemo(() => {
    if (!passage?.content) return [];
    return tokenizePassageFromContent(passage.content);
  }, [passage]);

  const sourceKey = passage?.source_key ?? `${passage?.chapter ?? ''} ${passage?.number ?? ''}`.trim();

  const handlePickPassage = async (p: PassageItem) => {
    setPassage(p);
    setTransformBlocks([]);
    setEitherOrPoints([]);
    setCorrectionSpans([]);
    setGrammarPoints([]);
    setPointAnchor(null);
    setCorrectionAnchor(null);
    setShowPicker(false);
    if (!examSubtitle.trim()) {
      setExamSubtitle(p.textbook);
      if (typeof window !== 'undefined') localStorage.setItem(META_KEYS.examSubtitle, p.textbook);
    }
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

  // ── transform (F) ─────────────────────────────────────────────────────────
  const toggleTransformWord = (sentenceIdx: number, tokenIdx: number) => {
    setTransformBlocks(prev => {
      const exact = prev.find(
        b => b.kind === 'word' && b.sentenceIdx === sentenceIdx && b.startTokenIdx === tokenIdx,
      );
      if (exact) return prev.filter(b => b !== exact);
      return [...prev, { sentenceIdx, startTokenIdx: tokenIdx, endTokenIdx: tokenIdx, kind: 'word' }];
    });
  };
  const updateTransformBaseForm = (sentenceIdx: number, startTokenIdx: number, value: string) => {
    setTransformBlocks(prev =>
      prev.map(b =>
        b.sentenceIdx === sentenceIdx && b.startTokenIdx === startTokenIdx && b.kind === 'word'
          ? { ...b, baseForm: value }
          : b,
      ),
    );
  };

  // ── eitherOr (G) ──────────────────────────────────────────────────────────
  const toggleEitherOrToken = (sentenceIdx: number, tokenIdx: number, original: string) => {
    setEitherOrPoints(prev => {
      const exact = prev.find(p => p.sentenceIdx === sentenceIdx && p.startTokenIdx === tokenIdx);
      if (exact) return prev.filter(p => p !== exact);
      return [
        ...prev,
        { sentenceIdx, startTokenIdx: tokenIdx, endTokenIdx: tokenIdx, correctForm: original, wrongForm: '', explanation: '' },
      ];
    });
  };
  const updateEitherOrField = (
    sentenceIdx: number,
    startTokenIdx: number,
    patch: Partial<EitherOrPoint>,
  ) => {
    setEitherOrPoints(prev =>
      prev.map(p =>
        p.sentenceIdx === sentenceIdx && p.startTokenIdx === startTokenIdx ? { ...p, ...patch } : p,
      ),
    );
  };

  // ── correction (H) ────────────────────────────────────────────────────────
  const toggleCorrectionToken = (sentenceIdx: number, tokenIdx: number, shift: boolean) => {
    if (shift && correctionAnchor && correctionAnchor.sentenceIdx === sentenceIdx) {
      const start = Math.min(correctionAnchor.tokenIdx, tokenIdx);
      const end = Math.max(correctionAnchor.tokenIdx, tokenIdx);
      setCorrectionSpans(prev => {
        const exact = prev.find(
          s => s.sentenceIdx === sentenceIdx && s.startTokenIdx === start && s.endTokenIdx === end,
        );
        if (exact) return prev.filter(s => s !== exact);
        const filtered = prev.filter(
          s =>
            s.sentenceIdx !== sentenceIdx ||
            end < s.startTokenIdx ||
            start > s.endTokenIdx,
        );
        return [
          ...filtered,
          { sentenceIdx, startTokenIdx: start, endTokenIdx: end, isError: true, wrongForm: '', correction: '', explanation: '' },
        ];
      });
      setCorrectionAnchor(null);
      return;
    }
    setCorrectionAnchor({ sentenceIdx, tokenIdx });
    setCorrectionSpans(prev => {
      const exact = prev.find(
        s => s.sentenceIdx === sentenceIdx && s.startTokenIdx === tokenIdx && s.endTokenIdx === tokenIdx,
      );
      if (exact) return prev.filter(s => s !== exact);
      return [
        ...prev,
        { sentenceIdx, startTokenIdx: tokenIdx, endTokenIdx: tokenIdx, isError: true, wrongForm: '', correction: '', explanation: '' },
      ];
    });
  };
  const updateCorrectionField = (
    sentenceIdx: number,
    startTokenIdx: number,
    endTokenIdx: number,
    patch: Partial<CorrectionSpan>,
  ) => {
    setCorrectionSpans(prev =>
      prev.map(s =>
        s.sentenceIdx === sentenceIdx && s.startTokenIdx === startTokenIdx && s.endTokenIdx === endTokenIdx
          ? { ...s, ...patch }
          : s,
      ),
    );
  };

  // ── ✨ points (P) — primary input ────────────────────────────────────────

  /** 한 문장당 포인트 상한 (2~3개 권장). 동기화 시 F·G·H·J 로 1개씩 분배되어 유형마다 다른 문항. */
  const PER_SENTENCE_CAP = 3;
  /** 권장 목표 = 문장당 2개. 상한 = 문장당 3개. */
  const targetPoints = sentences.length * 2;
  const maxPoints = sentences.length * PER_SENTENCE_CAP;
  /** 권장 최소 = 문장당 1개 (문장 수). */
  const minPoints = Math.max(1, sentences.length);
  const pointsOverLimit = grammarPoints.length >= maxPoints;
  const pointsBelowMin = grammarPoints.length > 0 && grammarPoints.length < minPoints;
  /** 권장 목표 미달 — 안내용. */
  const pointsBelowMax = grammarPoints.length > 0 && grammarPoints.length < targetPoints;

  /**
   * 클릭 = 단일 토큰 포인트 추가 (또는 동일 위치면 제거).
   * Shift+클릭 = 구간.
   *
   * 문장당 2~3개 포인트 규칙:
   *  - 한 문장에 여러 포인트를 잡을 수 있음 (상한 PER_SENTENCE_CAP).
   *  - 정확히 같은 위치/범위를 다시 클릭하면 → 제거 (toggle off).
   *  - 동기화 시 F·G·H·J 에 문장당 1개씩 서로 다른 포인트로 분배됨.
   */
  const togglePointToken = (sentenceIdx: number, tokenIdx: number, shift: boolean) => {
    const sent = sentences.find(s => s.idx === sentenceIdx);
    if (!sent) return;

    if (shift && pointAnchor && pointAnchor.sentenceIdx === sentenceIdx) {
      const start = Math.min(pointAnchor.tokenIdx, tokenIdx);
      const end = Math.max(pointAnchor.tokenIdx, tokenIdx);
      const tokens = sent.tokens.slice(start, end + 1).join(' ');
      setGrammarPoints(prev => {
        // 정확히 같은 범위면 toggle off
        const exact = prev.find(p => p.sentenceIdx === sentenceIdx && p.startTokenIdx === start && p.endTokenIdx === end);
        if (exact) return prev.filter(p => p !== exact);
        // 문장당 상한 체크
        if (prev.filter(p => p.sentenceIdx === sentenceIdx).length >= PER_SENTENCE_CAP) {
          setLastSyncMsg(`⚠ 한 문장 최대 ${PER_SENTENCE_CAP}개 포인트 — 기존 포인트 삭제 후 추가`);
          setTimeout(() => setLastSyncMsg(''), 3000);
          return prev;
        }
        return [
          ...prev,
          {
            id: `${sentenceIdx}-${start}-${end}-${Date.now()}`,
            sentenceIdx, startTokenIdx: start, endTokenIdx: end,
            correctForm: tokens, wrongCandidates: [''], grammarType: DEFAULT_GRAMMAR_TYPES[0],
            explanation: '', uses: ['F', 'G', 'H', 'J'], hRole: 'error', jVariant: 'wrong',
          },
        ];
      });
      setPointAnchor(null);
      return;
    }

    setPointAnchor({ sentenceIdx, tokenIdx });
    setGrammarPoints(prev => {
      // 정확히 같은 위치(단일 토큰) 면 toggle off
      const exact = prev.find(p => p.sentenceIdx === sentenceIdx && p.startTokenIdx === tokenIdx && p.endTokenIdx === tokenIdx);
      if (exact) return prev.filter(p => p !== exact);
      // 문장당 상한 체크
      if (prev.filter(p => p.sentenceIdx === sentenceIdx).length >= PER_SENTENCE_CAP) {
        setLastSyncMsg(`⚠ 한 문장 최대 ${PER_SENTENCE_CAP}개 포인트 — 기존 포인트 삭제 후 추가`);
        setTimeout(() => setLastSyncMsg(''), 3000);
        return prev;
      }
      return [
        ...prev,
        {
          id: `${sentenceIdx}-${tokenIdx}-${tokenIdx}-${Date.now()}`,
          sentenceIdx, startTokenIdx: tokenIdx, endTokenIdx: tokenIdx,
          correctForm: sent.tokens[tokenIdx] ?? '',
          wrongCandidates: [''], grammarType: DEFAULT_GRAMMAR_TYPES[0],
          explanation: '', uses: ['F', 'G', 'H', 'J'], hRole: 'error', jVariant: 'wrong',
        },
      ];
    });
  };

  const updatePoint = (id: string, patch: Partial<GrammarPoint>) =>
    setGrammarPoints(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));

  const removePoint = (id: string) =>
    setGrammarPoints(prev => prev.filter(p => p.id !== id));

  const togglePointUse = (id: string, use: 'F' | 'G' | 'H' | 'J') =>
    setGrammarPoints(prev => prev.map(p => {
      if (p.id !== id) return p;
      const has = p.uses.includes(use);
      return { ...p, uses: has ? p.uses.filter(u => u !== use) : [...p.uses, use] };
    }));

  const updateWrongCandidate = (id: string, idx: number, value: string) =>
    setGrammarPoints(prev => prev.map(p => {
      if (p.id !== id) return p;
      const arr = [...p.wrongCandidates];
      arr[idx] = value;
      return { ...p, wrongCandidates: arr };
    }));

  const addWrongCandidate = (id: string) =>
    setGrammarPoints(prev => prev.map(p => p.id === id ? { ...p, wrongCandidates: [...p.wrongCandidates, ''] } : p));

  const removeWrongCandidate = (id: string, idx: number) =>
    setGrammarPoints(prev => prev.map(p => {
      if (p.id !== id) return p;
      const arr = p.wrongCandidates.filter((_, i) => i !== idx);
      return { ...p, wrongCandidates: arr.length > 0 ? arr : [''] };
    }));

  /** 포인트 풀 → F·G·H·J 자동 채움. 기존 데이터는 덮어씀. */
  const syncPointsToAllModes = () => {
    if (grammarPoints.length === 0) {
      setLastSyncMsg('⚠ 동기화할 포인트가 없습니다.');
      setTimeout(() => setLastSyncMsg(''), 2500);
      return;
    }
    const { transformBlocks: f, eitherOrPoints: g, correctionSpans: h, oxItems: j } = syncPointsToModes(grammarPoints, sentences);
    setTransformBlocks(f);
    setEitherOrPoints(g);
    setCorrectionSpans(h);
    setOxItems(j.length > 0 ? j : [{ text: '', isCorrect: true, correction: '', explanation: '' }]);
    setLastSyncMsg(`🔄 동기화됨 — F ${f.length}·G ${g.length}·H ${h.length}·J ${j.length} (포인트 ${grammarPoints.length}개)`);
    setTimeout(() => setLastSyncMsg(''), 3500);
  };

  // ── ox (J) ────────────────────────────────────────────────────────────────
  const addOxItem = () => setOxItems(prev => [...prev, { text: '', isCorrect: true, correction: '', explanation: '' }]);
  const removeOxItem = (i: number) => setOxItems(prev => prev.filter((_, idx) => idx !== i));
  const updateOxItem = (i: number, patch: Partial<OxItem>) =>
    setOxItems(prev => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  // ── 미리보기 HTML ────────────────────────────────────────────────────────
  const examMeta = useMemo(
    () => ({
      examTitle: examTitle.trim() || undefined,
      schoolName: schoolName.trim() || undefined,
      grade: grade.trim() || undefined,
      questionNumber: questionNumber.trim() || undefined,
      examSubtitle: examSubtitle.trim() || undefined,
    }),
    [examTitle, schoolName, grade, questionNumber, examSubtitle],
  );

  const previewHtml = useMemo(() => {
    if (!passage && mode !== 'ox') return '';
    const commonTitle = examTitle.trim() || '어법공략 워크북';
    if (mode === 'points') {
      // 포인트 모드 — 학생 배부용 「어법 포인트 분석지」 형식으로 시각화
      return buildPointsAnalysisHtml({
        title: commonTitle,
        textbook: passage?.textbook ?? '',
        sourceKey,
        sentences,
        points: grammarPoints,
        ...examMeta,
      });
    }
    if (mode === 'transform') {
      return buildTransformHtml({
        title: commonTitle,
        textbook: passage?.textbook ?? '',
        sourceKey,
        sentences,
        blocks: transformBlocks,
        ...examMeta,
      });
    }
    if (mode === 'eitherOr') {
      return buildEitherOrHtml({
        title: commonTitle,
        textbook: passage?.textbook ?? '',
        sourceKey,
        sentences,
        points: eitherOrPoints,
        ...examMeta,
      });
    }
    if (mode === 'correction') {
      return buildCorrectionHtml({
        title: commonTitle,
        textbook: passage?.textbook ?? '',
        sourceKey,
        sentences,
        spans: correctionSpans,
        ...examMeta,
      });
    }
    return buildOxHtml({
      title: commonTitle,
      textbook: passage?.textbook ?? '',
      sourceKey,
      intro: oxIntro,
      items: oxItems,
      ...examMeta,
    });
  }, [passage, mode, examTitle, sourceKey, sentences, grammarPoints, transformBlocks, eitherOrPoints, correctionSpans, oxItems, oxIntro, examMeta]);

  const enableEditing = useCallback(() => {
    const doc = previewIframeRef.current?.contentDocument;
    if (!doc) return;
    try { doc.designMode = 'on'; } catch { /* ignore */ }
  }, []);

  const filenameBase = useMemo(() => {
    const t = (examTitle.trim() || '어법공략 워크북');
    const suffix = MODE_TABS.find(m => m.key === mode)?.label ?? '';
    return suffix ? `${t}_${suffix}` : t;
  }, [examTitle, mode]);

  const downloadAsDoc = () => {
    if (!previewHtml) return;
    const blob = new Blob([previewHtml], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameBase}.doc`;
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

  // 현재 모드에서 클릭된 토큰 판정
  const isTokenActive = (sentenceIdx: number, tokenIdx: number): boolean => {
    if (mode === 'points') {
      return grammarPoints.some(
        p => p.sentenceIdx === sentenceIdx && tokenIdx >= p.startTokenIdx && tokenIdx <= p.endTokenIdx,
      );
    }
    if (mode === 'transform') {
      return transformBlocks.some(b => b.sentenceIdx === sentenceIdx && b.startTokenIdx === tokenIdx);
    }
    if (mode === 'eitherOr') {
      return eitherOrPoints.some(p => p.sentenceIdx === sentenceIdx && p.startTokenIdx === tokenIdx);
    }
    if (mode === 'correction') {
      return correctionSpans.some(
        s => s.sentenceIdx === sentenceIdx && tokenIdx >= s.startTokenIdx && tokenIdx <= s.endTokenIdx,
      );
    }
    return false;
  };

  const isAnchor = (sentenceIdx: number, tokenIdx: number): boolean => {
    if (mode === 'correction' && correctionAnchor) {
      return correctionAnchor.sentenceIdx === sentenceIdx && correctionAnchor.tokenIdx === tokenIdx;
    }
    if (mode === 'points' && pointAnchor) {
      return pointAnchor.sentenceIdx === sentenceIdx && pointAnchor.tokenIdx === tokenIdx;
    }
    return false;
  };

  const handleTokenClick = (sentenceIdx: number, tokenIdx: number, original: string, shift: boolean) => {
    if (mode === 'points') return togglePointToken(sentenceIdx, tokenIdx, shift);
    if (mode === 'transform') return toggleTransformWord(sentenceIdx, tokenIdx);
    if (mode === 'eitherOr') return toggleEitherOrToken(sentenceIdx, tokenIdx, original);
    if (mode === 'correction') return toggleCorrectionToken(sentenceIdx, tokenIdx, shift);
  };

  // 사이드 카운터
  const sideCounter = useMemo(() => {
    if (mode === 'points') {
      const total = grammarPoints.length;
      const noWrong = grammarPoints.filter(p => !(p.wrongCandidates[0] ?? '').trim()).length;
      const noExpl = grammarPoints.filter(p => !p.explanation.trim()).length;
      const range = sentences.length > 0 ? ` / 권장 ${targetPoints}` : '';
      return `포인트 ${total}${range}개 (문장당 2~3) · 함정 미입력 ${noWrong} · 설명 미입력 ${noExpl}`;
    }
    if (mode === 'transform') {
      const total = transformBlocks.length;
      const missing = transformBlocks.filter(b => !(b.baseForm ?? '').trim()).length;
      return `선택 ${total}개 · base form 미입력 ${missing}개`;
    }
    if (mode === 'eitherOr') {
      const total = eitherOrPoints.length;
      const missing = eitherOrPoints.filter(p => !p.wrongForm.trim()).length;
      const ne = eitherOrPoints.filter(p => !(p.explanation ?? '').trim()).length;
      return `포인트 ${total}개 · 함정 미입력 ${missing} · 설명 미입력 ${ne}`;
    }
    if (mode === 'correction') {
      const total = correctionSpans.length;
      const errors = correctionSpans.filter(s => s.isError).length;
      const ne = correctionSpans.filter(s => s.isError && !(s.explanation ?? '').trim()).length;
      return `구간 ${total} (오류 ${errors} · 함정 ${total - errors}) · 설명 미입력 ${ne}`;
    }
    const valid = oxItems.filter(i => i.text.trim()).length;
    const ne = oxItems.filter(i => i.text.trim() && !(i.explanation ?? '').trim()).length;
    return `보기 ${valid}개 · 설명 미입력 ${ne}`;
  }, [mode, grammarPoints, transformBlocks, eitherOrPoints, correctionSpans, oxItems, sentences]);

  // 탭 전환 시 anchor 초기화
  useEffect(() => {
    setCorrectionAnchor(null);
    setPointAnchor(null);
  }, [mode]);

  // ── 활성 모드 산정 (입력이 있는 모드를 자동 활성) ──
  // points 가 있어도 동기화 전이면 G·H·J 가 비어있을 수 있음 — autoSyncOnSave 가 ON 이면 저장 직전 동기화 후 산정.
  const activeModes = useMemo((): GrammarMode[] => {
    const ms: GrammarMode[] = [];
    if (transformBlocks.length > 0) ms.push('F');
    if (eitherOrPoints.length > 0) ms.push('G');
    if (correctionSpans.length > 0) ms.push('H');
    if (oxItems.some(it => it.text.trim())) ms.push('J');
    // points 가 있고 G/H/J 가 없을 때 — autoSyncOnSave 가 ON 이면 활성 후보로 포함 (저장 시 sync 후 채워짐)
    if (autoSyncOnSave && grammarPoints.length > 0) {
      for (const p of grammarPoints) {
        for (const u of p.uses) {
          const m: GrammarMode = u;
          if (!ms.includes(m)) ms.push(m);
        }
      }
    }
    return ms;
  }, [transformBlocks, eitherOrPoints, correctionSpans, oxItems, grammarPoints, autoSyncOnSave]);

  // ── 저장 (현재 4 모드 한 번에) ──
  const handleSaveAll = async () => {
    if (activeModes.length === 0) {
      setSaveMsg('⚠ 활성 모드가 없습니다. 한 모드 이상 입력하세요.');
      setTimeout(() => setSaveMsg(''), 2500);
      return;
    }
    // F/G/H 는 passage 필요, J 만 있으면 passage 없어도 OK
    const needsPassage = activeModes.some(m => m !== 'J');
    if (needsPassage && !passage) {
      setSaveMsg('⚠ F/G/H 모드 저장에는 지문이 필요합니다.');
      setTimeout(() => setSaveMsg(''), 2500);
      return;
    }
    setSaving(true);
    setSaveMsg('');
    // 저장 직전 — autoSyncOnSave 가 ON 이고 points 가 있으면 F·G·H·J 자동 동기화 (기존 데이터 덮어쓰기).
    let effF = transformBlocks;
    let effG = eitherOrPoints;
    let effH = correctionSpans;
    let effJ = oxItems;
    if (autoSyncOnSave && grammarPoints.length > 0) {
      const sync = syncPointsToModes(grammarPoints, sentences);
      effF = sync.transformBlocks;
      effG = sync.eitherOrPoints;
      effH = sync.correctionSpans;
      effJ = sync.oxItems.length > 0 ? sync.oxItems : [{ text: '', isCorrect: true, correction: '', explanation: '' }];
      // 상태도 업데이트 — UI 가 즉시 반영하도록
      setTransformBlocks(effF);
      setEitherOrPoints(effG);
      setCorrectionSpans(effH);
      setOxItems(effJ);
    }
    try {
      const body = {
        passageId: passage?._id,
        textbook: passage?.textbook ?? '',
        sourceKey,
        title: examTitle.trim() || '어법공략 워크북',
        folder: folder.trim() || '기본',
        examMeta: {
          examTitle: examTitle.trim() || undefined,
          schoolName: schoolName.trim() || undefined,
          grade: grade.trim() || undefined,
          questionNumber: questionNumber.trim() || undefined,
          examSubtitle: examSubtitle.trim() || undefined,
        },
        sentences,
        modes: activeModes,
        modeData: {
          ...(activeModes.includes('F') && effF.length > 0 ? { F: { blocks: effF } } : {}),
          ...(activeModes.includes('G') && effG.length > 0 ? { G: { points: effG } } : {}),
          ...(activeModes.includes('H') && effH.length > 0 ? { H: { spans: effH } } : {}),
          ...(activeModes.includes('J') && effJ.some(it => it.text.trim()) ? { J: { items: effJ, intro: oxIntro || undefined } } : {}),
          ...(grammarPoints.length > 0 ? { P: { points: grammarPoints } } : {}),
        },
      };
      const r = await fetch('/api/admin/grammar-workbook/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) {
        setSaveMsg(`❌ 저장 실패: ${d.error ?? 'unknown'}`);
      } else {
        setCurrentDocId(d.id);
        if (typeof window !== 'undefined' && d.id) localStorage.setItem(LAST_DOC_KEY, d.id);
        setSaveMsg(`💾 저장됨 ${d.created ? '(신규)' : '(덮어쓰기)'} — ${activeModes.join('·')}`);
        setTimeout(() => setSaveMsg(''), 3000);
      }
    } catch (e) {
      setSaveMsg(`❌ 오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  /** 저장 목록에서 검색·폴더 필터 + 정렬을 적용한 visible items (전체 선택·일괄 작업 기준) */
  const visibleListItems = useMemo(() => {
    const q = listFilterText.trim().toLowerCase();
    const filtered = listItems.filter(it => {
      if (!q) return true;
      return (
        it.textbook.toLowerCase().includes(q) ||
        it.sourceKey.toLowerCase().includes(q) ||
        it.folder.toLowerCase().includes(q) ||
        it.title.toLowerCase().includes(q)
      );
    });
    if (listSort === 'recent') return filtered; // 서버에서 updatedAt desc 로 받음
    // 이름 자연 정렬 — title 우선, 없으면 sourceKey, 그 다음 textbook
    const keyOf = (it: SavedListItem) =>
      (it.title || it.sourceKey || it.textbook || '').trim();
    const cmp = (a: SavedListItem, b: SavedListItem) =>
      keyOf(a).localeCompare(keyOf(b), 'ko', { numeric: true, sensitivity: 'base' });
    const sorted = [...filtered].sort(cmp);
    return listSort === 'name-desc' ? sorted.reverse() : sorted;
  }, [listItems, listFilterText, listSort]);
  const allVisibleSelected =
    visibleListItems.length > 0 && visibleListItems.every(it => selectedListIds.has(it._id));
  const someVisibleSelected = visibleListItems.some(it => selectedListIds.has(it._id));
  const selectedInView = visibleListItems.filter(it => selectedListIds.has(it._id)).length;

  const toggleSelectListItem = (id: string) => {
    setSelectedListIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedListIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const it of visibleListItems) next.delete(it._id);
      } else {
        for (const it of visibleListItems) next.add(it._id);
      }
      return next;
    });
  };

  /** 폴더 이동 모달 열기 — 기본 입력값은 현재 폴더 (또는 「기본」) */
  const openBulkMoveDialog = () => {
    if (selectedListIds.size === 0) {
      alert('이동할 항목을 먼저 선택하세요.');
      return;
    }
    setBulkMoveTarget(listFolderFilter !== 'all' ? listFolderFilter : '');
    setBulkMoveOpen(true);
  };

  /** 모달의 확인 — 입력된 폴더명(기존이든 신규든)으로 일괄 PATCH */
  const handleBulkMoveConfirm = async () => {
    const to = bulkMoveTarget.trim();
    if (!to) {
      alert('이동할 폴더 이름을 입력하거나 기존 폴더를 선택하세요.');
      return;
    }
    if (selectedListIds.size === 0) {
      setBulkMoveOpen(false);
      return;
    }
    setBulkActionLoading(true);
    try {
      const ids = visibleListItems
        .filter(it => selectedListIds.has(it._id))
        .map(it => it._id);
      let failed = 0;
      for (const id of ids) {
        try {
          const r = await fetch(`/api/admin/grammar-workbook/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: to }),
          });
          if (!r.ok) failed += 1;
        } catch {
          failed += 1;
        }
      }
      setSelectedListIds(new Set());
      setBulkMoveOpen(false);
      // 신규 폴더로 옮긴 경우 그 폴더로 자동 필터 전환 (옮긴 결과 즉시 보임)
      if (!listFolders.includes(to)) {
        setListFolderFilter(to);
      } else {
        await refreshList();
      }
      setSaveMsg(
        failed > 0
          ? `이동 일부 실패 — 성공 ${ids.length - failed}건 / 실패 ${failed}건`
          : `📂 ${ids.length}건을 「${to}」 폴더로 이동`,
      );
      setTimeout(() => setSaveMsg(''), 2500);
    } finally {
      setBulkActionLoading(false);
    }
  };

  /** 일괄 PDF 모달 열기 — 선택된 항목들의 활성 모드 합집합으로 체크박스 초기화 */
  const openBulkPdfDialog = () => {
    if (selectedListIds.size === 0) {
      alert('PDF로 만들 항목을 먼저 선택하세요.');
      return;
    }
    const union: Record<GrammarMode, boolean> = { F: false, G: false, H: false, J: false };
    for (const it of visibleListItems) {
      if (!selectedListIds.has(it._id)) continue;
      for (const m of it.modes) union[m] = true;
    }
    setBulkPdfModes(union);
    setBulkPdfIncludePoints(false);
    setBulkPdfLayout('interleaved');
    setBulkPdfMode('combined');
    setBulkPdfOpen(true);
  };

  /** 일괄 PDF 실행 — combined: 새 창 인쇄 / zip: 서버 puppeteer PDF ZIP 다운로드 */
  const runBulkPdf = async () => {
    if (selectedListIds.size === 0) return;
    // 현재 정렬(이름순·최근수정 등) 화면에 보이는 순서대로 보냄 — 출력·ZIP 파일 순서가 사용자 정렬과 일치하도록.
    const ids = visibleListItems
      .filter(it => selectedListIds.has(it._id))
      .map(it => it._id);
    const selectedModes = (Object.entries(bulkPdfModes) as [GrammarMode, boolean][])
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (selectedModes.length === 0 && !bulkPdfIncludePoints) {
      alert('출력할 모드를 1개 이상 선택해 주세요.');
      return;
    }
    const modesPayload: ('F' | 'G' | 'H' | 'J' | 'P')[] = bulkPdfIncludePoints
      ? ['P', ...selectedModes]
      : selectedModes;

    setBulkPdfRunning(true);
    try {
      if (bulkPdfMode === 'combined') {
        // 합본 — 서버에서 HTML 반환 → 새 창에서 인쇄
        const folderTag =
          listFolderFilter !== 'all' ? listFolderFilter : '선택';
        const title = `어법공략 ${folderTag} (${ids.length}건)`;
        const r = await fetch('/api/admin/grammar-workbook/bulk-print', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids,
            modes: modesPayload,
            includePoints: bulkPdfIncludePoints,
            layout: bulkPdfLayout,
            title,
          }),
        });
        const d = await r.json();
        if (!r.ok || !d.html) {
          alert(d.error || '합본 생성 실패');
          return;
        }
        const blob = new Blob([d.html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const w = window.open(url, '_blank');
        if (!w) {
          URL.revokeObjectURL(url);
          alert('팝업이 차단되어 인쇄 창을 열 수 없습니다.');
          return;
        }
        const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
        w.addEventListener('afterprint', () => URL.revokeObjectURL(url));
        w.onload = () => {
          try { w.document.title = safeTitle; } catch { /* ignore */ }
          w.focus();
          setTimeout(() => {
            try { w.print(); } catch { /* ignore */ }
          }, 300);
        };
        setBulkPdfOpen(false);
      } else {
        // 개별 ZIP — 서버에서 puppeteer 로 각 워크북 PDF 만들어 ZIP 다운로드
        const folderTag = listFolderFilter !== 'all' ? listFolderFilter : '선택';
        const zipName = `어법공략_${folderTag}_${ids.length}건`;
        const r = await fetch('/api/admin/grammar-workbook/bulk-pdf-zip', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids,
            modes: modesPayload,
            includePoints: bulkPdfIncludePoints,
            layout: bulkPdfLayout,
            zipName,
          }),
        });
        if (!r.ok) {
          let msg = `ZIP 생성 실패 (${r.status})`;
          try {
            const d = await r.json();
            if (d?.error) msg = d.error;
          } catch { /* ignore */ }
          alert(msg);
          return;
        }
        const blob = await r.blob();
        // Content-Disposition 에서 파일명 추출
        let filename = `${zipName}.zip`;
        const cd = r.headers.get('Content-Disposition');
        if (cd) {
          const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
          if (star?.[1]) {
            try { filename = decodeURIComponent(star[1]); } catch { /* keep default */ }
          } else {
            const plain = cd.match(/filename="?([^";]+)"?/i);
            if (plain?.[1]) filename = plain[1];
          }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        setBulkPdfOpen(false);
        setSaveMsg(`📦 ${ids.length}건을 ZIP 으로 다운로드`);
        setTimeout(() => setSaveMsg(''), 2500);
      }
    } catch (e) {
      console.error('[bulk pdf]', e);
      alert('PDF 처리 중 오류');
    } finally {
      setBulkPdfRunning(false);
    }
  };

  /** 선택된 항목 일괄 삭제 */
  const handleBulkDelete = async () => {
    if (selectedListIds.size === 0) {
      alert('삭제할 항목을 먼저 선택하세요.');
      return;
    }
    if (!confirm(`선택한 ${selectedListIds.size}건을 정말 삭제할까요? (되돌릴 수 없음)`)) return;
    setBulkActionLoading(true);
    try {
      const ids = visibleListItems
        .filter(it => selectedListIds.has(it._id))
        .map(it => it._id);
      let failed = 0;
      for (const id of ids) {
        try {
          const r = await fetch(`/api/admin/grammar-workbook/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            credentials: 'include',
          });
          if (!r.ok) failed += 1;
        } catch {
          failed += 1;
        }
      }
      setSelectedListIds(new Set());
      if (ids.includes(currentDocId ?? '')) setCurrentDocId(null);
      await refreshList();
      setSaveMsg(
        failed > 0
          ? `삭제 일부 실패 — 성공 ${ids.length - failed}건 / 실패 ${failed}건`
          : `🗑 ${ids.length}건 삭제됨`,
      );
      setTimeout(() => setSaveMsg(''), 2500);
    } finally {
      setBulkActionLoading(false);
    }
  };

  // ── 목록 불러오기 ──
  const refreshList = async () => {
    setListLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '300');
      if (listFolderFilter && listFolderFilter !== 'all') {
        params.set('folder', listFolderFilter);
      }
      const r = await fetch(`/api/admin/grammar-workbook/list?${params}`, { credentials: 'include' });
      const d = await r.json();
      if (r.ok) {
        setListItems(d.items ?? []);
        setListFolders(Array.isArray(d.folders) ? d.folders : ['기본']);
        setListFolderCounts(
          d.folderCounts && typeof d.folderCounts === 'object' ? d.folderCounts : {},
        );
        setListTotalCount(typeof d.total === 'number' ? d.total : (d.items?.length ?? 0));
      }
    } catch {
      /* ignore */
    } finally {
      setListLoading(false);
    }
  };

  const refreshCoverage = async () => {
    setCoverageLoading(true);
    try {
      const r = await fetch('/api/admin/grammar-workbook/coverage', { credentials: 'include' });
      const d = await r.json();
      if (r.ok) setCoverageItems(d.items ?? []);
    } catch {
      /* ignore */
    } finally {
      setCoverageLoading(false);
    }
  };

  const loadCoverageGrid = async (textbook: string) => {
    setCoverageGridLoading(true);
    setCoverageGridRows([]);
    try {
      const r = await fetch(`/api/admin/grammar-workbook/passage-grid?textbook=${encodeURIComponent(textbook)}`, { credentials: 'include' });
      const d = await r.json();
      if (r.ok) setCoverageGridRows(d.passages ?? []);
    } catch {
      /* ignore */
    } finally {
      setCoverageGridLoading(false);
    }
  };

  // 모달 자동 로드
  useEffect(() => {
    if (coverageSelectedTextbook) void loadCoverageGrid(coverageSelectedTextbook);
  }, [coverageSelectedTextbook]);

  /** 「열기」 — 해당 지문의 저장 doc 이 있으면 load, 없으면 passage 만 set. */
  const handleCoverageOpen = async (row: PassageGridRow) => {
    setShowCoverageModal(false);
    if (row.doc_id) {
      await handleLoadSaved(row.doc_id);
      return;
    }
    // 저장 doc 없음 — passage 만 가져와 setPassage
    try {
      const pr = await fetch(`/api/admin/passages/${encodeURIComponent(row.passage_id)}`, { credentials: 'include' });
      const pd = await pr.json();
      if (pr.ok && pd.item) {
        await handlePickPassage(pd.item as PassageItem);
        setSaveMsg(`📂 지문 불러옴 — 4 모드 모두 비어 있음 (신규 작성)`);
        setTimeout(() => setSaveMsg(''), 3000);
      }
    } catch {
      /* ignore */
    }
  };

  const coverageCopy = async (text: string, label: string) => {
    /**
     * 모달 안에서 navigator.clipboard 가 종종 거부됨 (document focus / permissions).
     * Async API 실패 시 execCommand 폴백.
     */
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.top = '0';
        ta.style.left = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCoverageCopiedHint(label);
      setTimeout(() => setCoverageCopiedHint(null), 1500);
    } else {
      // 자동 복사 모두 실패 — 수동 복사 오버레이로 명령 노출
      setManualCopyText(text);
      setCoverageCopiedHint(`fail-${label}`);
      setTimeout(() => setCoverageCopiedHint(null), 2500);
    }
  };

  const filteredCoverageGrid = useMemo(() => {
    let rows = [...coverageGridRows];
    if (coverageHideCompleted) {
      rows = rows.filter(r => !(r.has_F && r.has_G && r.has_H && r.has_J));
    }
    if (coverageGridSort === 'progress') {
      rows.sort((a, b) => {
        const ca = (a.has_F ? 1 : 0) + (a.has_G ? 1 : 0) + (a.has_H ? 1 : 0) + (a.has_J ? 1 : 0);
        const cb = (b.has_F ? 1 : 0) + (b.has_G ? 1 : 0) + (b.has_H ? 1 : 0) + (b.has_J ? 1 : 0);
        if (cb !== ca) return cb - ca;
        return (a.chapter + a.source_key).localeCompare(b.chapter + b.source_key, 'ko');
      });
    } else {
      rows.sort((a, b) => {
        if (a.chapter !== b.chapter) return a.chapter.localeCompare(b.chapter, 'ko', { numeric: true });
        return a.source_key.localeCompare(b.source_key, 'ko', { numeric: true });
      });
    }
    return rows;
  }, [coverageGridRows, coverageHideCompleted, coverageGridSort]);

  // 모달 열릴 때마다 자동 로드
  useEffect(() => {
    if (showListModal) void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showListModal, listFolderFilter]);
  // 모달이 닫히거나 폴더 필터가 바뀌면 선택 상태 리셋
  useEffect(() => {
    setSelectedListIds(new Set());
  }, [showListModal, listFolderFilter]);

  // CLI 모달 열릴 때 현재 교재의 강 목록 + 강별 부족 카운트 로드
  useEffect(() => {
    if (!showCliModal) return;
    const tb = passage?.textbook?.trim();
    if (!tb) {
      setChapterList([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setChapterListLoading(true);
      try {
        const r = await fetch(
          `/api/admin/grammar-workbook/shortage?textbook=${encodeURIComponent(tb)}&modes=FGHJ`,
          { credentials: 'include' },
        );
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setChapterList([]);
          return;
        }
        // 강별 부족 집계
        const shortByChapter = new Map<string, number>();
        for (const row of d.shortage ?? []) {
          const c = String(row.chapter ?? '').trim();
          if (!c) continue;
          shortByChapter.set(c, (shortByChapter.get(c) ?? 0) + 1);
        }
        const chapters = (d.chapters ?? []).map(
          (c: { chapter: string; passagesTotal: number }) => ({
            chapter: c.chapter,
            passagesTotal: c.passagesTotal,
            shortBy: shortByChapter.get(c.chapter) ?? 0,
          }),
        );
        setChapterList(chapters);
      } catch {
        if (!cancelled) setChapterList([]);
      } finally {
        if (!cancelled) setChapterListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showCliModal, passage?.textbook]);
  useEffect(() => {
    if (showCoverageModal) void refreshCoverage();
  }, [showCoverageModal]);

  // 목록에서 문서 로드 (passage + selection 복원). silent=true 면 토스트·모달 변경 없이 조용히 복원(마운트 자동 복원용).
  const handleLoadSaved = async (id: string, opts?: { silent?: boolean }): Promise<boolean> => {
    try {
      const r = await fetch(`/api/admin/grammar-workbook/${encodeURIComponent(id)}`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok || !d.item) return false;
      const item = d.item;
      // 메타 복원
      if (item.examMeta) {
        if (item.examMeta.examTitle) setExamTitle(item.examMeta.examTitle);
        if (item.examMeta.schoolName) setSchoolName(item.examMeta.schoolName);
        if (item.examMeta.grade) setGrade(item.examMeta.grade);
        if (item.examMeta.questionNumber) setQuestionNumber(item.examMeta.questionNumber);
        if (item.examMeta.examSubtitle) setExamSubtitle(item.examMeta.examSubtitle);
      }
      if (item.folder) setFolder(item.folder);
      // passage 복원 — passageId 가 있으면 fetch 해서 PassageItem 구성
      if (item.passageId) {
        try {
          const pr = await fetch(`/api/admin/passages/${encodeURIComponent(item.passageId)}`, { credentials: 'include' });
          const pd = await pr.json();
          if (pr.ok && pd.item) {
            setPassage(pd.item as PassageItem);
          }
        } catch { /* ignore */ }
      }
      // 모드 데이터 복원
      const md = item.modeData ?? {};
      setTransformBlocks(md.F?.blocks ?? []);
      setEitherOrPoints(md.G?.points ?? []);
      setCorrectionSpans(md.H?.spans ?? []);
      if (md.J?.items) setOxItems(md.J.items);
      if (md.J?.intro != null) setOxIntro(md.J.intro);
      // ✨ 포인트 복원 — 옛 doc (P 없음) 은 빈 배열로
      setGrammarPoints(md.P?.points ?? []);
      setCurrentDocId(id);
      if (typeof window !== 'undefined') localStorage.setItem(LAST_DOC_KEY, id);
      if (!opts?.silent) {
        setShowListModal(false);
        setSaveMsg('📂 불러옴 — 같은 폴더에 저장하면 덮어쓰기');
        setTimeout(() => setSaveMsg(''), 3000);
      }
      return true;
    } catch {
      return false;
    }
  };

  /** 다이얼로그 열기 — 모드 체크박스를 doc 의 활성 모드로 초기화 */
  const openPrintDialog = (it: SavedListItem) => {
    setPrintDialog({ id: it._id, title: it.title || '', modes: it.modes });
    const next: Record<GrammarMode, boolean> = { F: false, G: false, H: false, J: false };
    for (const m of it.modes) next[m] = true;
    setPrintModes(next);
    setPrintIncludePoints(false);
    setPrintLayout('interleaved');
  };

  /** 저장된 워크북 1건을 새 창에서 PDF 인쇄 — 다이얼로그에서 선택된 옵션으로 */
  const runPrintSaved = async () => {
    const pd = printDialog;
    if (!pd || printingSavedId) return;
    const selectedModes = (Object.entries(printModes) as [GrammarMode, boolean][])
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (selectedModes.length === 0 && !printIncludePoints) {
      alert('출력할 모드를 1개 이상 선택해 주세요.');
      return;
    }
    setPrintingSavedId(pd.id);
    try {
      const params = new URLSearchParams();
      params.set('layout', printLayout);
      params.set('points', printIncludePoints ? '1' : '0');
      const modesParam = printIncludePoints
        ? ['P', ...selectedModes].join(',')
        : selectedModes.join(',');
      params.set('modes', modesParam);
      const r = await fetch(
        `/api/admin/grammar-workbook/${encodeURIComponent(pd.id)}/print?${params}`,
        { credentials: 'include' },
      );
      const d = await r.json();
      if (!r.ok || !d.html) {
        alert(d.error || 'PDF 생성 실패');
        return;
      }
      const blob = new Blob([d.html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (!w) {
        URL.revokeObjectURL(url);
        alert('팝업이 차단되어 인쇄 창을 열 수 없습니다.');
        return;
      }
      const safeTitle = (pd.title || d.title || '어법공략 워크북').replace(/[\\/:*?"<>|]/g, '_');
      w.addEventListener('afterprint', () => {
        URL.revokeObjectURL(url);
      });
      w.onload = () => {
        try {
          w.document.title = safeTitle;
        } catch {
          /* ignore */
        }
        w.focus();
        setTimeout(() => {
          try {
            w.print();
          } catch {
            /* ignore */
          }
        }, 300);
      };
      setPrintDialog(null);
    } catch (e) {
      console.error('[grammar print]', e);
      alert('PDF 생성 중 오류');
    } finally {
      setPrintingSavedId(null);
    }
  };

  // 삭제
  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제할까요?')) return;
    try {
      const r = await fetch(`/api/admin/grammar-workbook/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
      if (r.ok) {
        setListItems(prev => prev.filter(it => it._id !== id));
        if (currentDocId === id) setCurrentDocId(null);
        // 삭제한 게 마지막 복원 대상이면 키 제거
        if (typeof window !== 'undefined' && localStorage.getItem(LAST_DOC_KEY) === id) {
          localStorage.removeItem(LAST_DOC_KEY);
        }
      }
    } catch {
      /* ignore */
    }
  };

  // 페이지 진입 시 — 마지막으로 불러온/저장한 워크북 자동 복원 (1회)
  const autoRestoredRef = useRef(false);
  useEffect(() => {
    if (autoRestoredRef.current) return;
    autoRestoredRef.current = true;
    if (typeof window === 'undefined') return;
    const lastId = localStorage.getItem(LAST_DOC_KEY);
    if (!lastId) return;
    // 이미 무언가 로드돼 있으면(예: 다른 경로로 진입) 건너뜀
    if (passage || grammarPoints.length > 0) return;
    void (async () => {
      const ok = await handleLoadSaved(lastId, { silent: true });
      if (ok) {
        setSaveMsg('📂 최근 작업 자동 복원됨');
        setTimeout(() => setSaveMsg(''), 2500);
      } else if (typeof window !== 'undefined') {
        // 삭제됐거나 없는 doc → 키 정리
        localStorage.removeItem(LAST_DOC_KEY);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 메타 저장 헬퍼
  const persistMeta = (key: keyof typeof META_KEYS, value: string) => {
    if (typeof window !== 'undefined') localStorage.setItem(META_KEYS[key], value);
  };

  // 좌측 패널 축소 토글
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {showPicker && (
        <PassagePickerModal
          onSelect={handlePickPassage}
          onClose={() => setShowPicker(false)}
          lastTextbookKey="grammar_workbook_last_textbook"
        />
      )}

      {showListModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowListModal(false)}>
          <div
            className="bg-slate-800 border border-slate-600 rounded-2xl w-[min(820px,94vw)] max-h-[85vh] flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <div>
                <h3 className="text-lg font-bold text-white">📂 저장된 어법공략 워크북</h3>
                <p className="text-sm text-slate-400 mt-0.5">클릭하면 불러옴</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1" role="group" aria-label="정렬">
                  {([
                    { v: 'recent', t: '최근수정', title: '최근 수정 순' },
                    { v: 'name-asc', t: '이름 ↑', title: '이름 오름차순 (숫자 자연정렬)' },
                    { v: 'name-desc', t: '이름 ↓', title: '이름 내림차순' },
                  ] as { v: ListSort; t: string; title: string }[]).map(opt => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setListSort(opt.v)}
                      title={opt.title}
                      className={`text-[11px] px-2 py-1 rounded-md border ${
                        listSort === opt.v
                          ? 'border-emerald-500/60 bg-emerald-900/40 text-emerald-100'
                          : 'border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700'
                      }`}
                    >
                      {opt.t}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void refreshList()}
                  className="text-[11px] px-2 py-1 rounded-md border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700"
                >
                  ↻ 새로고침
                </button>
                <button type="button" onClick={() => setShowListModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none px-2">×</button>
              </div>
            </div>
            <div className="px-6 py-3 border-b border-slate-700 space-y-2">
              <input
                value={listFilterText}
                onChange={e => setListFilterText(e.target.value)}
                placeholder="교재명 / sourceKey / 폴더 검색"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={el => {
                      if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                    }}
                    onChange={toggleSelectAllVisible}
                    className="accent-emerald-500"
                  />
                  전체 선택
                  {selectedListIds.size > 0 && (
                    <span className="text-emerald-300 font-semibold">
                      ({selectedInView}/{visibleListItems.length})
                    </span>
                  )}
                </label>
                {selectedListIds.size > 0 && (
                  <>
                    <button
                      type="button"
                      disabled={bulkActionLoading || bulkPdfRunning}
                      onClick={openBulkPdfDialog}
                      title="선택한 항목을 합본 1 PDF 로 묶거나 개별 PDF ZIP 으로 다운로드"
                      className="text-[11px] px-2 py-0.5 rounded border border-sky-600/60 bg-sky-900/40 text-sky-100 hover:bg-sky-800/60 disabled:opacity-50"
                    >
                      {bulkPdfRunning ? '처리 중…' : `📄 PDF (${selectedListIds.size})`}
                    </button>
                    <button
                      type="button"
                      disabled={bulkActionLoading}
                      onClick={openBulkMoveDialog}
                      title="선택한 항목을 한 폴더로 일괄 이동 (없는 폴더면 새로 생성)"
                      className="text-[11px] px-2 py-0.5 rounded border border-amber-500/60 bg-amber-900/40 text-amber-100 hover:bg-amber-800/60 disabled:opacity-50"
                    >
                      {bulkActionLoading ? '처리 중…' : `📂 폴더 이동 (${selectedListIds.size})`}
                    </button>
                    <button
                      type="button"
                      disabled={bulkActionLoading}
                      onClick={() => void handleBulkDelete()}
                      title="선택한 항목을 일괄 삭제"
                      className="text-[11px] px-2 py-0.5 rounded border border-rose-700/60 bg-rose-950/40 text-rose-200 hover:bg-rose-900/60 disabled:opacity-50"
                    >
                      🗑 삭제 ({selectedListIds.size})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedListIds(new Set())}
                      className="text-[11px] px-2 py-0.5 rounded border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700"
                    >
                      선택 해제
                    </button>
                  </>
                )}
                <span className="h-3 w-px bg-slate-700 mx-1" />
                <span className="text-[11px] text-slate-500 font-semibold">폴더</span>
                <button
                  type="button"
                  onClick={() => setListFolderFilter('all')}
                  className={`text-[11px] px-2 py-0.5 rounded border ${
                    listFolderFilter === 'all'
                      ? 'border-emerald-500/60 bg-emerald-900/50 text-emerald-100'
                      : 'border-slate-600 bg-slate-700/50 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  전체 ({listTotalCount})
                </button>
                {listFolders.map(f => {
                  const active = listFolderFilter === f;
                  const count = listFolderCounts[f] ?? 0;
                  return (
                    <span key={f} className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setListFolderFilter(f)}
                        className={`text-[11px] px-2 py-0.5 rounded-l border ${
                          active
                            ? 'border-amber-500/60 bg-amber-900/50 text-amber-100'
                            : 'border-slate-600 bg-slate-700/50 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        📁 {f} ({count})
                      </button>
                      <button
                        type="button"
                        onClick={() => setFolderRenameDraft({ from: f, to: f })}
                        title={`「${f}」 폴더 이름 변경 / 삭제`}
                        className={`text-[10px] px-1 py-0.5 rounded-r border-y border-r border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700 ${
                          active ? 'border-amber-500/60 bg-amber-900/30' : 'bg-slate-700/30'
                        }`}
                      >
                        ⚙
                      </button>
                    </span>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    const name = prompt('새 폴더 이름 (저장 시점에 적용)');
                    if (!name?.trim()) return;
                    setFolder(name.trim());
                    setShowListModal(false);
                  }}
                  className="text-[11px] px-2 py-0.5 rounded border border-slate-600 bg-slate-700/40 text-slate-300 hover:bg-slate-700 hover:text-white"
                  title="새 폴더 이름을 현재 작업의 「폴더」 칸에 적용 (저장 시 생성)"
                >
                  ＋ 새 폴더
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-3">
              {listLoading ? (
                <p className="text-slate-400 text-sm py-4 text-center">불러오는 중…</p>
              ) : listItems.length === 0 ? (
                <p className="text-slate-500 text-sm py-4 text-center">저장된 워크북이 없습니다.</p>
              ) : (
                <div className="space-y-1.5">
                  {visibleListItems
                    .map(it => (
                      <div
                        key={it._id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer group ${
                          selectedListIds.has(it._id)
                            ? 'border-emerald-600/60 bg-emerald-900/20 hover:bg-emerald-900/30'
                            : 'border-slate-700 hover:bg-slate-700/40'
                        }`}
                        onClick={() => void handleLoadSaved(it._id)}
                      >
                        <input
                          type="checkbox"
                          checked={selectedListIds.has(it._id)}
                          onChange={() => toggleSelectListItem(it._id)}
                          onClick={e => e.stopPropagation()}
                          className="accent-emerald-500 cursor-pointer shrink-0"
                          aria-label="이 항목 선택"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate">{it.title || '(제목 없음)'}</div>
                          <div className="text-xs text-slate-400 truncate mt-0.5">
                            {it.textbook} · {it.sourceKey} <span className="text-slate-600">|</span> 폴더: <span className="text-amber-300">{it.folder}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {(['F','G','H','J'] as GrammarMode[]).map(m => (
                            <span
                              key={m}
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                it.modes.includes(m)
                                  ? 'bg-emerald-700 text-white'
                                  : 'bg-slate-700 text-slate-500'
                              }`}
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                        <span className="text-[10px] text-slate-500 shrink-0 tabular-nums">
                          {it.updatedAt ? new Date(it.updatedAt).toLocaleDateString('ko-KR') : ''}
                        </span>
                        <button
                          type="button"
                          disabled={printingSavedId === it._id}
                          onClick={e => { e.stopPropagation(); openPrintDialog(it); }}
                          title="모드·답지 위치 선택 후 PDF 출력 (브라우저 인쇄 → PDF로 저장)"
                          className="text-[11px] px-2 py-0.5 rounded border border-sky-700/60 bg-sky-900/40 text-sky-200 hover:bg-sky-800/60 hover:text-white disabled:opacity-50 shrink-0"
                        >
                          {printingSavedId === it._id ? '준비 중…' : '📄 PDF'}
                        </button>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); void handleDelete(it._id); }}
                          className="text-[11px] text-rose-400 hover:text-rose-300 opacity-0 group-hover:opacity-100 shrink-0"
                        >
                          삭제
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {bulkPdfOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
          onClick={() => !bulkPdfRunning && setBulkPdfOpen(false)}
        >
          <div
            className="bg-slate-800 border border-sky-600/40 rounded-2xl w-[min(560px,94vw)] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
              <div>
                <h3 className="text-base font-bold text-white">📄 일괄 PDF 출력</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  선택한 <span className="text-sky-300 font-semibold">{selectedListIds.size}건</span> 의 출력 방식·모드·답지 위치를 선택하세요.
                </p>
              </div>
              <button
                type="button"
                disabled={bulkPdfRunning}
                onClick={() => setBulkPdfOpen(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-1 disabled:opacity-50"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-xs font-semibold text-slate-300 mb-2">다운로드 형식</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    {
                      v: 'combined',
                      t: '📑 합본 1 PDF',
                      d: '모든 워크북을 한 PDF 로 묶음. 새 창 → 인쇄 다이얼로그.',
                    },
                    {
                      v: 'zip',
                      t: '📦 개별 PDF (ZIP)',
                      d: '워크북당 1 PDF 씩 ZIP 으로 자동 다운로드 (서버 puppeteer).',
                    },
                  ] as { v: 'combined' | 'zip'; t: string; d: string }[]).map(opt => (
                    <label
                      key={opt.v}
                      className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded border cursor-pointer ${
                        bulkPdfMode === opt.v
                          ? 'border-sky-500/60 bg-sky-900/40'
                          : 'border-slate-600 bg-slate-700/40 hover:bg-slate-700/70'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="bulkPdfMode"
                          checked={bulkPdfMode === opt.v}
                          onChange={() => setBulkPdfMode(opt.v)}
                          className="accent-sky-500"
                        />
                        <span className="text-sm font-semibold text-white">{opt.t}</span>
                      </div>
                      <span className="text-[11px] text-slate-400 leading-snug pl-5">{opt.d}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-300 mb-2">출력할 모드 (선택된 워크북들의 합집합 기준)</p>
                <div className="flex flex-wrap gap-2">
                  {(['F', 'G', 'H', 'J'] as GrammarMode[]).map(m => {
                    const label =
                      m === 'F' ? '어형 변환'
                        : m === 'G' ? '양자택일'
                          : m === 'H' ? '오류 수정'
                            : 'O·X 채점';
                    return (
                      <label
                        key={m}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs cursor-pointer ${
                          bulkPdfModes[m]
                            ? 'border-emerald-600/60 bg-emerald-900/40 text-emerald-200'
                            : 'border-slate-600 bg-slate-700/40 text-slate-300 hover:bg-slate-700/70'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={!!bulkPdfModes[m]}
                          onChange={e =>
                            setBulkPdfModes(prev => ({ ...prev, [m]: e.target.checked }))
                          }
                          className="accent-emerald-500"
                        />
                        <span className="font-bold">{m}</span>
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
                <label className="mt-2 flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={bulkPdfIncludePoints}
                    onChange={e => setBulkPdfIncludePoints(e.target.checked)}
                    className="accent-amber-500"
                  />
                  ✨ 어법 포인트 분석지(P)도 맨 앞에 포함 (P 가 있는 워크북에 한정)
                </label>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-300 mb-2">답지(정답·해설) 위치</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { v: 'interleaved', t: '각 모드 옆에', d: '한 워크북 안에서 시험지→정답지 묶임 (기본)' },
                    { v: 'back', t: '모두 뒤로', d: '모든 시험지 먼저 → 정답·해설은 끝에' },
                  ] as { v: 'interleaved' | 'back'; t: string; d: string }[]).map(opt => (
                    <label
                      key={opt.v}
                      className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded border cursor-pointer ${
                        bulkPdfLayout === opt.v
                          ? 'border-sky-500/60 bg-sky-900/40'
                          : 'border-slate-600 bg-slate-700/40 hover:bg-slate-700/70'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="bulkPdfLayout"
                          checked={bulkPdfLayout === opt.v}
                          onChange={() => setBulkPdfLayout(opt.v)}
                          className="accent-sky-500"
                        />
                        <span className="text-sm font-semibold text-white">{opt.t}</span>
                      </div>
                      <span className="text-[11px] text-slate-400 leading-snug pl-5">{opt.d}</span>
                    </label>
                  ))}
                </div>
              </div>
              {bulkPdfMode === 'zip' && (
                <p className="text-[11px] text-amber-300/90 leading-snug">
                  ⚙ 서버에서 puppeteer 로 각 워크북을 PDF 로 렌더링합니다. 다건이면 십 수 초 이상 걸릴 수 있습니다.
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-700 bg-slate-800/60">
              <button
                type="button"
                disabled={bulkPdfRunning}
                onClick={() => setBulkPdfOpen(false)}
                className="text-sm px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                disabled={bulkPdfRunning}
                onClick={() => void runBulkPdf()}
                className="text-sm px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:opacity-50"
              >
                {bulkPdfRunning
                  ? bulkPdfMode === 'zip'
                    ? 'ZIP 만드는 중…'
                    : '합본 만드는 중…'
                  : bulkPdfMode === 'zip'
                    ? `📦 ${selectedListIds.size}건 ZIP 다운로드`
                    : `📑 ${selectedListIds.size}건 합본 인쇄`}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkMoveOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
          onClick={() => !bulkActionLoading && setBulkMoveOpen(false)}
        >
          <div
            className="bg-slate-800 border border-amber-500/40 rounded-2xl w-[min(520px,94vw)] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
              <div>
                <h3 className="text-base font-bold text-white">📂 폴더 이동</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  선택한 <span className="text-amber-300 font-semibold">{selectedListIds.size}건</span> 을 기존 폴더로 옮기거나, 새 폴더를 만들어 한꺼번에 이동합니다.
                </p>
              </div>
              <button
                type="button"
                disabled={bulkActionLoading}
                onClick={() => setBulkMoveOpen(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-1 disabled:opacity-50"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-xs font-semibold text-slate-300 mb-1.5">기존 폴더에서 선택</p>
                {listFolders.length === 0 ? (
                  <p className="text-[11px] text-slate-500">아직 폴더가 없습니다.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {listFolders.map(f => {
                      const active = bulkMoveTarget.trim() === f;
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setBulkMoveTarget(f)}
                          className={`text-[11px] px-2 py-0.5 rounded border ${
                            active
                              ? 'border-amber-500/60 bg-amber-900/50 text-amber-100'
                              : 'border-slate-600 bg-slate-700/50 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          📁 {f} ({listFolderCounts[f] ?? 0})
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300">
                  새 폴더 이름 (입력하면 자동 생성 후 이동)
                </label>
                <input
                  type="text"
                  value={bulkMoveTarget}
                  onChange={e => setBulkMoveTarget(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !bulkActionLoading) void handleBulkMoveConfirm();
                  }}
                  placeholder="예: 26년 3월 고3"
                  autoFocus
                  className="mt-1 w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
                {bulkMoveTarget.trim() && !listFolders.includes(bulkMoveTarget.trim()) && (
                  <p className="text-[11px] text-emerald-300 mt-1">
                    ＋ 「{bulkMoveTarget.trim()}」 폴더가 새로 만들어집니다.
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-700 bg-slate-800/60">
              <button
                type="button"
                disabled={bulkActionLoading}
                onClick={() => setBulkMoveOpen(false)}
                className="text-sm px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                disabled={bulkActionLoading || !bulkMoveTarget.trim()}
                onClick={() => void handleBulkMoveConfirm()}
                className="text-sm px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-50"
              >
                {bulkActionLoading
                  ? '이동 중…'
                  : bulkMoveTarget.trim() && !listFolders.includes(bulkMoveTarget.trim())
                    ? `＋ 새 폴더 만들고 ${selectedListIds.size}건 이동`
                    : `📂 ${selectedListIds.size}건 이동`}
              </button>
            </div>
          </div>
        </div>
      )}

      {folderRenameDraft && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setFolderRenameDraft(null)}
        >
          <div
            className="bg-slate-800 border border-amber-600/40 rounded-2xl w-[min(440px,94vw)] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
              <h3 className="text-base font-bold text-white">📁 폴더 관리</h3>
              <button
                type="button"
                onClick={() => setFolderRenameDraft(null)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-1"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-400">
                현재 폴더:{' '}
                <span className="text-amber-300 font-semibold">{folderRenameDraft.from}</span>{' '}
                ({listFolderCounts[folderRenameDraft.from] ?? 0}건)
              </p>
              <div>
                <label className="text-xs text-slate-300 font-semibold">새 이름</label>
                <input
                  type="text"
                  value={folderRenameDraft.to}
                  onChange={e =>
                    setFolderRenameDraft(prev => (prev ? { ...prev, to: e.target.value } : prev))
                  }
                  className="mt-1 w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  같은 passageId 의 doc 이 이미 새 이름 폴더에 있으면 충돌 doc 은 옮기지 않습니다.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-700 bg-slate-800/60">
              <button
                type="button"
                onClick={async () => {
                  const name = folderRenameDraft.from;
                  if (!confirm(`「${name}」 폴더의 모든 워크북을 정말 삭제할까요? (되돌릴 수 없음)`)) return;
                  const r = await fetch(
                    `/api/admin/grammar-workbook/folder?name=${encodeURIComponent(name)}`,
                    { method: 'DELETE', credentials: 'include' },
                  );
                  const d = await r.json();
                  if (!r.ok) {
                    alert(d.error || '삭제 실패');
                    return;
                  }
                  setFolderRenameDraft(null);
                  if (listFolderFilter === name) setListFolderFilter('all');
                  void refreshList();
                }}
                className="text-xs px-3 py-1.5 rounded-lg border border-rose-700/60 text-rose-300 hover:bg-rose-900/40"
              >
                🗑 폴더 전체 삭제
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFolderRenameDraft(null)}
                  className="text-sm px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const { from, to } = folderRenameDraft;
                    const newName = to.trim();
                    if (!newName) {
                      alert('새 이름을 입력해 주세요.');
                      return;
                    }
                    if (newName === from) {
                      setFolderRenameDraft(null);
                      return;
                    }
                    const r = await fetch('/api/admin/grammar-workbook/folder', {
                      method: 'PATCH',
                      credentials: 'include',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ from, to: newName }),
                    });
                    const d = await r.json();
                    if (!r.ok) {
                      alert(d.error || '이름 변경 실패');
                      return;
                    }
                    setFolderRenameDraft(null);
                    if (listFolderFilter === from) setListFolderFilter(newName);
                    void refreshList();
                  }}
                  className="text-sm px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold"
                >
                  이름 변경
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {printDialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPrintDialog(null)}
        >
          <div
            className="bg-slate-800 border border-sky-600/40 rounded-2xl w-[min(520px,94vw)] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
              <h3 className="text-base font-bold text-white">📄 PDF 출력 옵션</h3>
              <button
                type="button"
                onClick={() => setPrintDialog(null)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-1"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                <span className="text-sky-300 font-semibold">{printDialog.title || '(제목 없음)'}</span>
                <br />
                활성 모드: {printDialog.modes.join(' · ') || '없음'}
              </p>
              <div>
                <p className="text-xs font-semibold text-slate-300 mb-2">출력할 모드</p>
                <div className="flex flex-wrap gap-2">
                  {(['F', 'G', 'H', 'J'] as GrammarMode[]).map(m => {
                    const available = printDialog.modes.includes(m);
                    const label =
                      m === 'F' ? '어형 변환'
                        : m === 'G' ? '양자택일'
                          : m === 'H' ? '오류 수정'
                            : 'O·X 채점';
                    return (
                      <label
                        key={m}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs cursor-pointer ${
                          !available
                            ? 'border-slate-700 bg-slate-900/40 text-slate-600 cursor-not-allowed'
                            : printModes[m]
                              ? 'border-emerald-600/60 bg-emerald-900/40 text-emerald-200'
                              : 'border-slate-600 bg-slate-700/40 text-slate-300 hover:bg-slate-700/70'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={!available}
                          checked={!!printModes[m] && available}
                          onChange={e => setPrintModes(prev => ({ ...prev, [m]: e.target.checked }))}
                          className="accent-emerald-500"
                        />
                        <span className="font-bold">{m}</span>
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
                <label className="mt-2 flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={printIncludePoints}
                    onChange={e => setPrintIncludePoints(e.target.checked)}
                    className="accent-amber-500"
                  />
                  ✨ 어법 포인트 분석지(P)도 맨 앞에 포함
                </label>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-300 mb-2">답지(정답·해설) 위치</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { v: 'interleaved', t: '각 모드 옆에', d: '모드마다 시험지→정답지가 묶여 인쇄됨 (기본)' },
                    { v: 'back', t: '모두 뒤로', d: '모든 시험지를 먼저, 정답·해설은 끝에 한꺼번에' },
                  ] as { v: 'interleaved' | 'back'; t: string; d: string }[]).map(opt => (
                    <label
                      key={opt.v}
                      className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded border cursor-pointer ${
                        printLayout === opt.v
                          ? 'border-sky-500/60 bg-sky-900/40'
                          : 'border-slate-600 bg-slate-700/40 hover:bg-slate-700/70'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="printLayout"
                          checked={printLayout === opt.v}
                          onChange={() => setPrintLayout(opt.v)}
                          className="accent-sky-500"
                        />
                        <span className="text-sm font-semibold text-white">{opt.t}</span>
                      </div>
                      <span className="text-[11px] text-slate-400 leading-snug pl-5">{opt.d}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-700 bg-slate-800/60">
              <button
                type="button"
                onClick={() => setPrintDialog(null)}
                className="text-sm px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700"
              >
                취소
              </button>
              <button
                type="button"
                disabled={printingSavedId === printDialog.id}
                onClick={() => void runPrintSaved()}
                className="text-sm px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:opacity-50"
              >
                {printingSavedId === printDialog.id ? '준비 중…' : '인쇄 / PDF 저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {manualCopyText && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setManualCopyText(null)}>
          <div
            className="bg-slate-800 border-2 border-emerald-500/60 rounded-2xl w-[min(640px,94vw)] p-5 shadow-2xl space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">⚠ 자동 복사 차단됨</h3>
              <button type="button" onClick={() => setManualCopyText(null)} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              브라우저가 클립보드 API 를 거부했습니다. 아래 명령을 <b className="text-emerald-300">전체 선택 후 Ctrl+C / ⌘+C</b> 로 직접 복사하세요.
            </p>
            <textarea
              readOnly
              value={manualCopyText}
              onFocus={e => e.currentTarget.select()}
              ref={el => {
                if (el) {
                  // 자동 포커스 + 전체 선택
                  setTimeout(() => { el.focus(); el.select(); }, 50);
                }
              }}
              className="w-full bg-slate-950 border border-emerald-700 rounded-lg px-3 py-2 text-sm text-emerald-200 font-mono leading-relaxed"
              rows={Math.min(6, Math.max(2, manualCopyText.split('\n').length))}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  // 재시도 — 다시 user gesture 안에서 clipboard 시도
                  const t = manualCopyText;
                  if (!t) return;
                  navigator.clipboard?.writeText(t).then(
                    () => { setManualCopyText(null); setCoverageCopiedHint('manual-retry-ok'); setTimeout(() => setCoverageCopiedHint(null), 1500); },
                    () => { /* still failed — keep overlay open */ },
                  );
                }}
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-700 text-white hover:bg-emerald-600 font-semibold"
              >
                ↻ 다시 시도
              </button>
              <button
                type="button"
                onClick={() => setManualCopyText(null)}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {showCoverageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowCoverageModal(false)}>
          <div
            className="bg-slate-800 border border-slate-600 rounded-2xl w-[min(1100px,96vw)] h-[min(85vh,800px)] flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 shrink-0">
              <div>
                <h3 className="text-lg font-bold text-white">📊 교재별 어법공략 현황</h3>
                <p className="text-sm text-slate-400 mt-0.5">왼쪽 교재 선택 → 오른쪽 강·번호별 모드 매트릭스</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void refreshCoverage();
                    if (coverageSelectedTextbook) void loadCoverageGrid(coverageSelectedTextbook);
                  }}
                  className="text-[11px] px-2 py-1 rounded-md border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700"
                >
                  ↻ 새로고침
                </button>
                <button type="button" onClick={() => setShowCoverageModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none px-2">×</button>
              </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* 좌: 교재 목록 */}
              <aside className="w-[340px] shrink-0 border-r border-slate-700/70 bg-slate-900/40 flex flex-col">
                <div className="px-3 py-2 border-b border-slate-700/60 shrink-0">
                  <input
                    value={coverageFilterText}
                    onChange={e => setCoverageFilterText(e.target.value)}
                    placeholder="교재명 검색"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500"
                  />
                </div>
                <div className="flex-1 overflow-y-auto">
                  {coverageLoading ? (
                    <p className="text-slate-400 text-xs py-6 text-center">불러오는 중…</p>
                  ) : coverageItems.length === 0 ? (
                    <p className="text-slate-500 text-xs py-6 text-center">교재가 없습니다.</p>
                  ) : (
                    coverageItems
                      .filter(it => !coverageFilterText.trim() || it.textbook.toLowerCase().includes(coverageFilterText.trim().toLowerCase()))
                      .sort((a, b) => b.coverageRate - a.coverageRate || a.textbook.localeCompare(b.textbook, 'ko'))
                      .map(it => {
                        const pct = Math.round(it.coverageRate * 100);
                        const barCls = pct === 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : pct > 0 ? 'bg-rose-500' : 'bg-slate-600';
                        const isSelected = coverageSelectedTextbook === it.textbook;
                        return (
                          <button
                            key={it.textbook}
                            type="button"
                            onClick={() => setCoverageSelectedTextbook(it.textbook)}
                            className={`w-full text-left px-3 py-2.5 border-b border-slate-800/60 hover:bg-slate-800/60 transition-colors ${
                              isSelected ? 'bg-emerald-950/40 border-l-2 border-l-emerald-500' : ''
                            }`}
                          >
                            <div className="text-sm font-medium text-slate-100 truncate" title={it.textbook}>
                              {it.textbook}
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-700/70 rounded overflow-hidden">
                                <div className={`h-full ${barCls}`} style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[11px] text-slate-400 tabular-nums w-9 text-right">{pct}%</span>
                            </div>
                            <div className="mt-1 text-[11px] text-slate-400 flex items-center gap-1.5">
                              <span>지문 {it.workbookPassagesCovered}/{it.passagesTotal}</span>
                              <span className="text-slate-600">·</span>
                              {(['F','G','H','J'] as GrammarMode[]).map(m => (
                                <span
                                  key={m}
                                  className={`text-[10px] font-bold px-1 py-0 rounded tabular-nums ${
                                    (it.modeCounts[m] ?? 0) > 0 ? 'text-emerald-300' : 'text-slate-600'
                                  }`}
                                  title={`${m}: ${it.modeCounts[m] ?? 0}개`}
                                >
                                  {m}·{it.modeCounts[m] ?? 0}
                                </span>
                              ))}
                            </div>
                          </button>
                        );
                      })
                  )}
                </div>
              </aside>

              {/* 우: 강/번호 매트릭스 */}
              <div className="flex-1 overflow-y-auto min-w-0">
                {!coverageSelectedTextbook && (
                  <div className="p-6 text-sm text-slate-400">왼쪽에서 교재를 선택하세요.</div>
                )}

                {coverageSelectedTextbook && (
                  <div className="p-4">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-100 truncate">{coverageSelectedTextbook}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {(() => {
                            const total = filteredCoverageGrid.length;
                            const complete = filteredCoverageGrid.filter(r => r.has_F && r.has_G && r.has_H && r.has_J).length;
                            return `표시 ${total}개 · 4 모드 완료 ${complete}개`;
                          })()}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-300 flex-wrap">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={coverageHideCompleted}
                            onChange={e => setCoverageHideCompleted(e.target.checked)}
                            className="rounded border-slate-600 bg-slate-800"
                          />
                          <span>미완성만</span>
                        </label>
                        <div className="flex items-center gap-1 text-[11px]">
                          <span className="text-slate-500">정렬</span>
                          <button
                            type="button"
                            onClick={() => setCoverageGridSort('natural')}
                            className={`px-2 py-0.5 rounded ${coverageGridSort === 'natural' ? 'bg-emerald-700/40 text-emerald-200 border border-emerald-600/60' : 'text-slate-400 border border-transparent hover:bg-slate-800'}`}
                          >
                            강/번호
                          </button>
                          <button
                            type="button"
                            onClick={() => setCoverageGridSort('progress')}
                            className={`px-2 py-0.5 rounded ${coverageGridSort === 'progress' ? 'bg-emerald-700/40 text-emerald-200 border border-emerald-600/60' : 'text-slate-400 border border-transparent hover:bg-slate-800'}`}
                          >
                            완료순
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => void coverageCopy(`npm run cc:grammar -- shortage --textbook "${coverageSelectedTextbook}"`, 'shortage-cli')}
                          className="px-2 py-1 rounded border border-emerald-700/60 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40 font-medium"
                          title="CLI shortage 명령 복사"
                        >
                          {coverageCopiedHint === 'shortage-cli' ? '복사됨 ✓' : coverageCopiedHint === 'fail-shortage-cli' ? '복사 실패 ✗' : '🔗 shortage CLI'}
                        </button>
                      </div>
                    </div>

                    {coverageGridLoading && (
                      <div className="text-xs text-slate-400 py-6 text-center">불러오는 중…</div>
                    )}

                    {!coverageGridLoading && filteredCoverageGrid.length === 0 && (
                      <div className="text-xs text-slate-400 py-6 text-center">표시할 지문이 없습니다.</div>
                    )}

                    {!coverageGridLoading && filteredCoverageGrid.length > 0 && (
                      <div className="border border-slate-700/60 rounded-lg overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-900/60 text-slate-400 uppercase tracking-wide">
                            <tr>
                              <th className="text-left px-2 py-2 font-medium">강/번호</th>
                              <th className="text-left px-2 py-2 font-medium">source_key</th>
                              {(['F','G','H','J'] as GrammarMode[]).map(m => (
                                <th key={m} className="text-center px-1 py-2 font-medium" title={
                                  m === 'F' ? '어형 변환' : m === 'G' ? '양자택일' : m === 'H' ? '어법 오류 수정' : 'O·X 채점'
                                }>{m}</th>
                              ))}
                              <th className="text-center px-2 py-2 font-medium">합계</th>
                              <th className="text-center px-2 py-2 font-medium">폴더</th>
                              <th className="text-center px-2 py-2 font-medium">액션</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredCoverageGrid.map(r => {
                              const total = (r.has_F ? 1 : 0) + (r.has_G ? 1 : 0) + (r.has_H ? 1 : 0) + (r.has_J ? 1 : 0);
                              const cellCls = (on: boolean) => on ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-600';
                              return (
                                <tr key={r.passage_id} className="border-t border-slate-800/80 hover:bg-slate-800/40">
                                  <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">
                                    {r.chapter}{r.number ? ` ${r.number}` : ''}
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-400 truncate max-w-[200px]" title={r.source_key}>
                                    {r.source_key}
                                  </td>
                                  {(['F','G','H','J'] as const).map(m => {
                                    const on = m === 'F' ? r.has_F : m === 'G' ? r.has_G : m === 'H' ? r.has_H : r.has_J;
                                    return (
                                      <td key={m} className="text-center px-1 py-1">
                                        <span className={`inline-block w-6 px-1 py-0.5 rounded text-[10px] font-bold ${cellCls(on)}`}>
                                          {on ? '✓' : '·'}
                                        </span>
                                      </td>
                                    );
                                  })}
                                  <td className="text-center px-2 py-1">
                                    <span className={`tabular-nums font-medium ${
                                      total === 4 ? 'text-emerald-300' : total >= 2 ? 'text-amber-300' : total >= 1 ? 'text-rose-300' : 'text-slate-600'
                                    }`}>{total}/4</span>
                                  </td>
                                  <td className="text-center px-2 py-1 text-slate-400 truncate max-w-[80px]" title={r.folder ?? ''}>
                                    {r.folder ?? '—'}
                                  </td>
                                  <td className="text-center px-2 py-1 whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => void handleCoverageOpen(r)}
                                      className="text-[11px] px-2 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 mr-1"
                                      title={r.doc_id ? '저장된 doc 불러오기' : '지문만 불러오기 (4 모드 비어 있음)'}
                                    >
                                      열기
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        // 단일 라인(줄바꿈 없음) — 멀티라인 paste 시 터미널이 [B 등 escape 으로 잘리는 문제 회피.
                                        // 워크플로우 디테일은 cc-grammar-prompt.md 가 가지고 있음.
                                        const tb = (coverageSelectedTextbook ?? '').replace(/"/g, '\\"');
                                        const sk = r.source_key.replace(/"/g, '\\"');
                                        const prompt = `@scripts/cc-grammar-prompt.md 워크플로우대로 passageId=${r.passage_id} textbook="${tb}" source_key="${sk}" folder="기본" 에 어법 포인트를 ⭐문장당 2~3개(어법 요소 없는 문장만 예외) 추출 — 8 유형 골고루 + md 의 「고빈도 출제 함정」 체크리스트 반드시 스캔 → modeData.P.points 저장 → F·G·H·J 4모드 동기화(문장당 1개씩 서로 다른 포인트로 자동 분배되어 유형마다 다른 문항) → dry-run → errors 0 이면 반드시 실제 save 까지. F: 단일토큰 동사·어형 포인트는 uses 에 'F' + baseForm 채움(관계사·접속사·전치사·멀티토큰은 F 제외). worktree 무관. save 응답(id, created) 보고 전까지 멈추지 마. 모든 포인트에 explanation 필수. --force 금지.`;
                                        void coverageCopy(prompt, `prompt-${r.passage_id}`);
                                      }}
                                      className="text-[11px] px-0.5 py-0.5 rounded border border-amber-600/80 bg-amber-950/30 text-amber-200 hover:bg-amber-900/50 font-semibold"
                                      title={`이 지문 (${r.source_key}) 의 F·G·H·J 4 모드를 Claude Code 채팅이 끝까-지 자동 작성·저장하도록 시키는 한 줄 prompt. 복사해서 claude 채팅에 paste.`}
                                    >
                                      {coverageCopiedHint === `prompt-${r.passage_id}` ? '복사됨 ✓' : coverageCopiedHint === `fail-prompt-${r.passage_id}` ? '실패 ✗' : '🚀 전체작업'}
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
        </div>
      )}

      {showCliModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowCliModal(false)}>
          <div
            className="bg-slate-800 border border-slate-600 rounded-2xl w-[min(720px,94vw)] max-h-[85vh] flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <div>
                <h3 className="text-lg font-bold text-white">cc:grammar CLI</h3>
                <p className="text-sm text-slate-400 mt-0.5">Anthropic API 없이 · Pro 무과금 · F·G·H·J 한 번에 저장</p>
              </div>
              <button type="button" onClick={() => setShowCliModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none px-2">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 scrollbar-thin text-sm text-slate-200 leading-relaxed">
              <p>각 명령 옆 <span className="text-emerald-300 font-bold">「복사」</span> 버튼을 누르세요. 자세한 워크플로우는 <code className="text-amber-200">@scripts/cc-grammar-prompt.md</code> 첨부.</p>

              {[
                { label: '1. 교재 목록', cmd: 'npm run cc:grammar -- textbooks' },
                { label: '2. 교재 부족 지문 (FGHJ 전부 안 채워진 것)', cmd: `npm run cc:grammar -- shortage --textbook "${passage?.textbook ?? '<교재명>'}"` },
                { label: '3. 지문·문장표 받기', cmd: `npm run cc:grammar -- passage --id ${passage?._id ?? '<passageId>'}` },
                { label: '4. 검증 (dry-run)', cmd: 'npm run cc:grammar -- save --json .grammar-drafts/<sourceKey>.json --dry-run' },
                { label: '5. 저장 (실제 insert/upsert)', cmd: 'npm run cc:grammar -- save --json .grammar-drafts/<sourceKey>.json' },
                { label: '6. 배치 저장 (여러 draft)', cmd: 'npm run cc:grammar -- save-all .grammar-drafts/*.json' },
                { label: '7. 교재별 현황', cmd: 'npm run cc:grammar -- coverage --limit 50' },
              ].map(({ label, cmd }) => (
                <div key={label} className="space-y-1.5">
                  <h4 className="text-sm font-bold text-white">{label}</h4>
                  <div className="flex items-start gap-2">
                    <pre className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono overflow-x-auto whitespace-pre-wrap break-all">
                      <code>{cmd}</code>
                    </pre>
                    <button
                      type="button"
                      onClick={async () => {
                        let ok = false;
                        try {
                          if (navigator.clipboard?.writeText) {
                            await navigator.clipboard.writeText(cmd);
                            ok = true;
                          }
                        } catch { ok = false; }
                        if (!ok) {
                          try {
                            const ta = document.createElement('textarea');
                            ta.value = cmd;
                            ta.style.position = 'fixed';
                            ta.style.opacity = '0';
                            document.body.appendChild(ta);
                            ta.focus();
                            ta.select();
                            ok = document.execCommand('copy');
                            document.body.removeChild(ta);
                          } catch { ok = false; }
                        }
                        setSaveMsg(ok ? `📋 복사됨: ${label}` : `❌ 복사 실패: ${label} — 명령을 직접 선택해 복사하세요`);
                        setTimeout(() => setSaveMsg(''), ok ? 1500 : 3000);
                      }}
                      className="shrink-0 text-sm font-bold px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 border border-emerald-500"
                    >
                      복사
                    </button>
                  </div>
                </div>
              ))}

              <div className="rounded-xl border border-sky-600/40 bg-sky-950/20 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-bold text-sky-200">📚 강별 작업 — {passage?.textbook ?? '(교재 미선택)'}</h4>
                  {chapterListLoading && (
                    <span className="text-[10px] text-slate-400">불러오는 중…</span>
                  )}
                </div>
                {!passage?.textbook ? (
                  <p className="text-[11px] text-slate-400">먼저 좌측 「지문 선택」으로 교재를 골라야 강 목록이 나타납니다.</p>
                ) : chapterList.length === 0 && !chapterListLoading ? (
                  <p className="text-[11px] text-slate-400">이 교재에 등록된 「강」이 없습니다.</p>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-slate-400">강 단위로 shortage 조회 + 채팅 워크플로우 1줄을 복사. (부족: 4모드 중 1개라도 안 채워진 지문 수)</p>
                    <div className="grid grid-cols-1 gap-1.5 max-h-[260px] overflow-y-auto pr-1">
                      {chapterList.map(c => {
                        const tb = passage?.textbook ?? '';
                        const shortCmd = `npm run cc:grammar -- shortage --textbook "${tb}" --chapter "${c.chapter}"`;
                        const chatCmd = `@scripts/cc-grammar-prompt.md 워크플로우대로 "${tb}" 의 "${c.chapter}" 부족 지문 모두에 어법 포인트를 문장당 2~3개로 추출(md 「고빈도 출제 함정」 체크리스트 스캔) → F·G·H·J 4모드 동기화(문장당 1개씩 서로 다른 포인트 분배) → dry-run → save 까지 한 강 끝까지 진행해줘. F: 동사·어형 포인트는 baseForm 넣어 F 포함.`;
                        const isShort = (c.shortBy ?? 0) > 0;
                        return (
                          <div
                            key={c.chapter}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded border ${
                              isShort
                                ? 'border-amber-700/50 bg-amber-950/30'
                                : 'border-slate-700 bg-slate-900/40'
                            }`}
                          >
                            <span
                              className="text-xs font-semibold text-white shrink-0 min-w-[3rem]"
                              title={c.chapter}
                            >
                              {c.chapter}
                            </span>
                            <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                              {c.passagesTotal}지문
                            </span>
                            <span
                              className={`text-[11px] shrink-0 tabular-nums ${
                                isShort ? 'text-amber-300 font-bold' : 'text-emerald-300'
                              }`}
                            >
                              {isShort ? `부족 ${c.shortBy}` : '완료'}
                            </span>
                            <div className="flex-1" />
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                void coverageCopy(shortCmd, `chap-short-${c.chapter}`);
                              }}
                              title={shortCmd}
                              className="text-[11px] px-2 py-0.5 rounded border border-slate-600 bg-slate-800/80 text-slate-200 hover:bg-slate-700 shrink-0"
                            >
                              {coverageCopiedHint === `chap-short-${c.chapter}`
                                ? '복사됨 ✓'
                                : coverageCopiedHint === `fail-chap-short-${c.chapter}`
                                  ? '실패 ✗'
                                  : '📋 shortage'}
                            </button>
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                void coverageCopy(chatCmd, `chap-prompt-${c.chapter}`);
                              }}
                              title={chatCmd}
                              className="text-[11px] px-2 py-0.5 rounded border border-amber-600/60 bg-amber-900/40 text-amber-100 hover:bg-amber-800/60 shrink-0"
                            >
                              {coverageCopiedHint === `chap-prompt-${c.chapter}`
                                ? '복사됨 ✓'
                                : coverageCopiedHint === `fail-chap-prompt-${c.chapter}`
                                  ? '실패 ✗ (수동 복사 창 열림)'
                                  : '📋 채팅 프롬프트'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-amber-600/40 bg-amber-950/20 p-4 space-y-2">
                <h4 className="text-sm font-bold text-amber-200">🎯 Claude Code 채팅용 (한 줄)</h4>
                <pre className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-amber-200 font-mono overflow-x-auto whitespace-pre-wrap break-all">
                  <code>{`@scripts/cc-grammar-prompt.md 워크플로우대로 ${passage?.textbook ? `"${passage.textbook}"` : '<교재명>'} 의 부족 지문 1 건에 어법 포인트를 문장당 2~3개로 추출(md 「고빈도 출제 함정」 체크리스트 스캔) → F·G·H·J 4모드 동기화(문장당 1개씩 서로 다른 포인트) → dry-run → save 까지 자동 진행해줘. F: 동사·어형 포인트는 baseForm 넣어 F 포함.`}</code>
                </pre>
                <p className="text-[11px] text-amber-200/70">Claude Code 가 shortage → passage → 포인트 추출 → 모드 동기화 → save 까지 자동 처리.</p>
              </div>

              <div className="rounded-xl border border-slate-600 bg-slate-900/40 p-4 space-y-1.5">
                <h4 className="text-sm font-bold text-white">⚠ 규칙</h4>
                <ul className="text-xs text-slate-300 leading-relaxed list-disc list-inside space-y-0.5">
                  <li>API 키 호출 없음 — 모든 JSON 은 채팅에서 직접 작성.</li>
                  <li>같은 (passageId, folder) 면 저장 시 <b className="text-amber-300">덮어쓰기</b>.</li>
                  <li>F·G·H 인덱스는 passage 응답의 sentences 토큰 범위 안 — 검증으로 확인.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 flex min-h-0 overflow-hidden" style={{ height: 'calc(100vh - 48px)' }}>
        {/* ── 좌측 입력 패널 ── */}
        <div
          className={`shrink-0 flex min-h-0 min-w-0 flex-col border-r border-slate-700 overflow-hidden transition-all duration-200 ${
            collapsed ? 'w-0 overflow-hidden border-r-0' : 'w-[400px]'
          }`}
        >
          <div className="shrink-0 px-5 pt-5 pb-3 border-b border-slate-700 space-y-3">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-white tracking-tight whitespace-nowrap">어법공략 워크북</h2>
              <p className="text-slate-400 text-sm mt-0.5">4가지 유형 · 정답지 어법 설명</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowCliModal(true)}
                className="text-[11px] px-2 py-1 rounded-md border border-emerald-600/70 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50 hover:border-emerald-500 transition-colors font-medium whitespace-nowrap"
                title="Claude Code CLI 사용 안내"
              >
                cc:grammar
              </button>
              <button
                type="button"
                onClick={() => setShowCoverageModal(true)}
                className="text-[11px] px-2 py-1 rounded-md border border-amber-700/70 bg-amber-950/30 text-amber-200 hover:bg-amber-900/40 hover:border-amber-600 transition-colors font-medium whitespace-nowrap"
                title="교재별 출제 진행 현황"
              >
                📊 현황
              </button>
              <button
                type="button"
                onClick={() => setShowListModal(true)}
                className="text-[11px] px-2 py-1 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors font-medium whitespace-nowrap"
                title="저장된 어법공략 워크북 목록"
              >
                📂 목록
              </button>
              <button
                type="button"
                onClick={handleSaveAll}
                disabled={saving || activeModes.length === 0}
                className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed font-bold"
                title={activeModes.length === 0 ? '활성 모드 없음 (최소 1모드 입력)' : `${activeModes.join('·')} 모드 동시 저장`}
              >
                {saving ? '저장 중…' : `💾 저장 (${activeModes.join('·') || '비활성'})`}
              </button>
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-500 font-medium"
              >
                지문 불러오기
              </button>
            </div>
            {saveMsg && (
              <div className={`text-[11px] px-2 py-1 rounded ${saveMsg.includes('❌') || saveMsg.includes('⚠') ? 'text-rose-200 bg-rose-950/40 border border-rose-700/40' : 'text-emerald-200 bg-emerald-950/40 border border-emerald-700/40'}`}>
                {saveMsg}
              </div>
            )}
            {grammarPoints.length > 0 && (
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSyncOnSave}
                  onChange={e => setAutoSyncOnSave(e.target.checked)}
                />
                <span>저장 시 포인트 → F·G·H·J 자동 동기화 (포인트 {grammarPoints.length}개)</span>
              </label>
            )}

            {/* 탭 (모드 선택) */}
            <div className="flex gap-1.5 flex-wrap">
              {MODE_TABS.map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setMode(t.key)}
                  className={`flex-1 min-w-[5.5rem] py-2 rounded-lg text-xs font-semibold transition-colors border ${
                    mode === t.key
                      ? t.activeCls
                      : 'border-slate-600 text-slate-400 hover:bg-slate-700/60 hover:text-white'
                  }`}
                >
                  <span className="inline-block mr-1 px-1.5 py-0.5 text-[10px] bg-black/20 rounded">{t.tag}</span>
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">{sideCounter}</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 flex flex-col gap-5 scrollbar-thin">
            {/* 시험지 제목 */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">시험지 제목</label>
              <input
                value={examTitle}
                onChange={e => { setExamTitle(e.target.value); persistMeta('examTitle', e.target.value); }}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                placeholder="영어 어법공략 평가"
              />
            </div>

            {/* 학교명·학년 — 기본값 비움 (예시 placeholder 없음, 세션 자동 채움 없음) */}
            <div className="flex gap-3">
              <div className="flex-1 min-w-0">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">고등학교 이름</label>
                <input
                  value={schoolName}
                  onChange={e => setSchoolName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                  placeholder="(선택)"
                />
              </div>
              <div className="w-24 shrink-0">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">학년</label>
                <input
                  value={grade}
                  onChange={e => setGrade(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                  placeholder="(선택)"
                />
              </div>
            </div>

            {/* 지문 정보 */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-slate-300">
                  영어 지문 {mode !== 'ox' && <span className="text-red-400">*</span>}
                </label>
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="text-xs px-2.5 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white transition-colors font-medium"
                >
                  DB에서 불러오기
                </button>
              </div>
              {passage ? (
                <div className="flex items-center gap-2 text-xs bg-blue-500/15 border border-blue-500/30 rounded-lg px-3 py-1.5">
                  <span className="text-blue-300 font-medium truncate">
                    {passage.textbook} · {sourceKey}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setPassage(null); setTransformBlocks([]); setEitherOrPoints([]); setCorrectionSpans([]); }}
                    className="ml-auto shrink-0 text-slate-500 hover:text-white"
                  >×</button>
                </div>
              ) : (
                <p className="text-xs text-slate-600 px-1 py-2 border border-dashed border-slate-700 rounded-lg text-center">
                  {mode === 'ox' ? '지문 불필요 — 보기 항목 직접 입력' : 'DB에서 불러와 시작'}
                </p>
              )}
            </div>

            {/* 문항 번호 */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">문항 번호</label>
              <input
                value={questionNumber}
                onChange={e => { setQuestionNumber(e.target.value); persistMeta('questionNumber', e.target.value); }}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                placeholder="어법공략"
              />
            </div>

            {/* 시험지 부제 */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                시험지 부제 <span className="text-slate-500 font-normal">(선택)</span>
              </label>
              <input
                value={examSubtitle}
                onChange={e => { setExamSubtitle(e.target.value); persistMeta('examSubtitle', e.target.value); }}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                placeholder="예: 2026 3월 모의고사 · 어법 집중"
              />
            </div>

            {/* 저장 폴더 */}
            <div className="rounded-xl border border-slate-600/80 bg-slate-800/40 px-3 py-3 space-y-2">
              <label className="text-sm font-medium text-slate-200 block">💾 저장 폴더</label>
              <input
                value={folder}
                onChange={e => setFolder(e.target.value.trim() ? e.target.value : '기본')}
                placeholder="예: 기본, 26년 3월 어법"
                className="w-full text-sm bg-slate-800 border border-slate-600 rounded-lg px-2.5 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-slate-400"
              />
              <p className="text-[10px] text-slate-500">
                같은 (지문, 폴더) 조합이면 저장 시 <b className="text-amber-200">덮어쓰기</b>.
                {currentDocId && <span className="block text-emerald-300 mt-0.5">현재 문서 ID: {currentDocId.slice(0, 8)}…</span>}
              </p>
            </div>

            {/* 사용 안내 */}
            <details className="bg-slate-800/60 border border-slate-700 rounded-xl text-sm">
              <summary className="cursor-pointer select-none px-3 py-2 font-bold text-slate-200 hover:bg-slate-700/40 rounded-xl text-[13px]">
                ❓ 사용 안내
              </summary>
              <div className="px-3 pb-3 pt-1 space-y-1.5 text-[12px] text-slate-300 leading-relaxed">
                <p><b className="text-blue-300">F. 어형 변환</b> — 단어 클릭 → baseForm 입력. 학생용 본문에 「(reveal)」 괄호로 노출.</p>
                <p><b className="text-emerald-300">G. 양자택일</b> — 단어 클릭 → 함정 형태(wrongForm) + 어법 설명 입력. 본문에 「[ 정답 / 오답 ]」 셔플.</p>
                <p><b className="text-red-300">H. 어법 오류 수정</b> — 단어/구문 클릭 (Shift+클릭 = 구간) → wrongForm·correction·설명 입력. 함정 구간은 번호만.</p>
                <p><b className="text-purple-300">J. O·X 채점</b> — 보기 직접 입력 + 옳음/틀림 + 정답 + 어법 설명.</p>
                <p className="text-slate-400">정답지에 「어법 설명」 카드가 자동 노출됩니다 — 학생이 왜 그게 답인지 이해.</p>
              </div>
            </details>

            {/* 토큰 클릭 영역 (지문 기반 모드) */}
            {mode !== 'ox' && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-slate-200">
                    {mode === 'points' && `✨ 어법 포인트 (문장당 2~3개 · 권장 ${targetPoints}개 — F·G·H·J 로 분배)`}
                    {mode === 'transform' && '단어 블록 (클릭)'}
                    {mode === 'eitherOr' && '어법 포인트 (클릭)'}
                    {mode === 'correction' && '오류·함정 구간 (클릭 / Shift+클릭=구간)'}
                  </h3>
                  {mode === 'points' && grammarPoints.length > 0 && (
                    <button
                      type="button"
                      onClick={syncPointsToAllModes}
                      className="text-xs px-3 py-1 rounded-lg bg-emerald-700 text-white hover:bg-emerald-600 font-bold"
                      title="포인트 풀에서 F·G·H·J 4 모드 데이터를 자동 생성합니다 (기존 모드 데이터 덮어쓰기)"
                    >
                      🔄 F·G·H·J 동기화
                    </button>
                  )}
                </div>
                {sentences.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">지문을 먼저 선택하세요.</p>
                ) : (
                  <>
                    {mode === 'points' && pointsOverLimit && (
                      <div className="mb-2 text-[11px] px-2 py-1 rounded bg-rose-950/50 border border-rose-700/60 text-rose-200">
                        ⚠ 상한 도달 ({grammarPoints.length}/{maxPoints}). 한 문장 최대 {PER_SENTENCE_CAP}개.
                      </div>
                    )}
                    {mode === 'points' && pointsBelowMin && (
                      <div className="mb-2 text-[11px] px-2 py-1 rounded bg-amber-950/40 border border-amber-700/50 text-amber-200">
                        ℹ️ 모든 문장에서 최소 1개씩 ({grammarPoints.length}/{minPoints}). 권장은 문장당 2~3개 (총 {targetPoints}개).
                      </div>
                    )}
                    {mode === 'points' && !pointsBelowMin && pointsBelowMax && (
                      <div className="mb-2 text-[11px] px-2 py-1 rounded bg-slate-700/40 border border-slate-600/50 text-slate-300">
                        💡 현재 {grammarPoints.length}개. 문장당 2~3개씩 잡으면 F·G·H·J 가 서로 다른 문항이 됩니다 (권장 {targetPoints}개).
                      </div>
                    )}
                    <div className="space-y-2 select-none max-h-80 overflow-y-auto scrollbar-thin">
                      {sentences.map(sent => {
                        // 포인트 모드: 이 문장에 이미 포인트가 있는지
                        const sentHasPoint = mode === 'points' && grammarPoints.some(p => p.sentenceIdx === sent.idx);
                        return (
                        <div key={sent.idx} className="flex flex-wrap gap-1 leading-relaxed">
                          {sent.tokens.map((tok, t) => {
                            const on = isTokenActive(sent.idx, t);
                            const anchor = isAnchor(sent.idx, t);
                            // 포인트 모드에서 한도 초과 + 이 문장에 포인트 없음 = 새 포인트 추가 불가 → dim
                            // (같은 문장에 포인트가 있으면 replace 로 이동 가능하므로 dim 안 함)
                            const dimmed = mode === 'points' && pointsOverLimit && !sentHasPoint && !on && !anchor;
                            const cls = on
                              ? 'bg-blue-500/40 text-blue-100 border-blue-500/60'
                              : anchor
                                ? 'bg-amber-500/30 text-amber-100 border-amber-500/60 border-dashed'
                                : dimmed
                                  ? 'border-transparent text-slate-600 cursor-not-allowed'
                                  : 'border-transparent text-slate-200 hover:bg-slate-700/50';
                            return (
                              <span
                                key={t}
                                onClick={e => handleTokenClick(sent.idx, t, tok, e.shiftKey)}
                                className={`px-1.5 py-0.5 rounded text-sm cursor-pointer transition-colors border ${cls}`}
                              >
                                {tok}
                              </span>
                            );
                          })}
                        </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ✨ 포인트 메타 입력 (primary) */}
            {mode === 'points' && grammarPoints.length > 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-200">포인트 메타 입력</h3>
                  {lastSyncMsg && (
                    <span className="text-[11px] text-emerald-300">{lastSyncMsg}</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  포인트 1 개당 정답·함정 후보·문법 유형·설명 입력 → <b className="text-emerald-300">🔄 F·G·H·J 동기화</b> 누르면 모든 모드에 자동 채워짐.
                  uses 체크박스 = 이 포인트가 어느 모드에 들어갈지. F 는 단일 토큰 + baseForm 입력이 있을 때만 동기화.
                </p>
                {[...grammarPoints]
                  .sort((a, b) =>
                    a.sentenceIdx !== b.sentenceIdx
                      ? a.sentenceIdx - b.sentenceIdx
                      : a.startTokenIdx - b.startTokenIdx,
                  )
                  .map((p, idx) => {
                    const sent = sentences.find(s => s.idx === p.sentenceIdx);
                    const original = sent ? sent.tokens.slice(p.startTokenIdx, p.endTokenIdx + 1).join(' ') : '';
                    return (
                      <div key={p.id} className="border border-slate-700 rounded-lg p-2.5 space-y-2 bg-slate-900/30">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-amber-300 font-bold w-7">#{idx + 1}</span>
                          <span className="text-slate-400 truncate flex-1" title={original}>
                            S{p.sentenceIdx}[{p.startTokenIdx}{p.endTokenIdx !== p.startTokenIdx ? `-${p.endTokenIdx}` : ''}] · <i className="text-slate-300">{original}</i>
                          </span>
                          <button
                            type="button"
                            onClick={() => removePoint(p.id)}
                            className="text-[11px] text-rose-400 hover:text-rose-300"
                          >
                            삭제
                          </button>
                        </div>

                        {/* correctForm + grammar type */}
                        <div className="flex items-center gap-2">
                          <input
                            value={p.correctForm}
                            onChange={e => updatePoint(p.id, { correctForm: e.target.value })}
                            placeholder="정답 (원문 표현)"
                            className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-emerald-200"
                          />
                          <select
                            value={DEFAULT_GRAMMAR_TYPES.includes(p.grammarType as typeof DEFAULT_GRAMMAR_TYPES[number]) ? p.grammarType : '기타'}
                            onChange={e => {
                              const v = e.target.value;
                              if (v === '기타') {
                                updatePoint(p.id, { grammarType: '' });
                              } else {
                                updatePoint(p.id, { grammarType: v });
                              }
                            }}
                            className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100"
                          >
                            {DEFAULT_GRAMMAR_TYPES.map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                            <option value="기타">기타 (직접)</option>
                          </select>
                          {!DEFAULT_GRAMMAR_TYPES.includes(p.grammarType as typeof DEFAULT_GRAMMAR_TYPES[number]) && (
                            <input
                              value={p.grammarType}
                              onChange={e => updatePoint(p.id, { grammarType: e.target.value })}
                              placeholder="유형 이름"
                              className="w-28 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100"
                            />
                          )}
                        </div>

                        {/* wrongCandidates */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] text-slate-500">함정 후보 (1~3)</span>
                            {p.wrongCandidates.length < 3 && (
                              <button
                                type="button"
                                onClick={() => addWrongCandidate(p.id)}
                                className="text-[11px] text-emerald-400 hover:text-emerald-300"
                              >
                                + 추가
                              </button>
                            )}
                          </div>
                          {p.wrongCandidates.map((w, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <input
                                value={w}
                                onChange={e => updateWrongCandidate(p.id, i, e.target.value)}
                                placeholder={`함정 ${i + 1}${i === 0 ? ' (모드 변환 기본값)' : ''}`}
                                className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-rose-200"
                              />
                              {p.wrongCandidates.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeWrongCandidate(p.id, i)}
                                  className="text-[11px] text-rose-400 hover:text-rose-300"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* explanation */}
                        <textarea
                          value={p.explanation}
                          onChange={e => updatePoint(p.id, { explanation: e.target.value })}
                          placeholder="어법 설명 — 왜 정답이고 함정이 왜 틀린지"
                          rows={2}
                          className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 resize-none"
                        />

                        {/* koCorrect — 해석에서 정답에 해당하는 한국어 부분 (분석지에서 색칠) */}
                        <input
                          value={p.koCorrect ?? ''}
                          onChange={e => updatePoint(p.id, { koCorrect: e.target.value })}
                          placeholder={`해석 강조 (선택) — 정답 '${(p.correctForm || '').trim() || '단어'}' 에 해당하는 한국어 (예: 표현한다)`}
                          className="w-full bg-slate-700/70 border border-emerald-700/40 rounded px-2 py-1 text-xs text-emerald-100 placeholder-slate-500"
                        />

                        {/* uses + F baseForm + H 역할 + J 변형 */}
                        <div className="flex items-center gap-3 text-[11px] flex-wrap">
                          <span className="text-slate-500">사용 모드:</span>
                          {(() => {
                            const isSingle = p.endTokenIdx === p.startTokenIdx;
                            const modes: ('F' | 'G' | 'H' | 'J')[] = isSingle ? ['F', 'G', 'H', 'J'] : ['G', 'H', 'J'];
                            return modes.map(u => (
                              <label
                                key={u}
                                className={`flex items-center gap-1 cursor-pointer ${u === 'F' && !isSingle ? 'opacity-30 cursor-not-allowed' : 'text-slate-300'}`}
                                title={u === 'F' && !isSingle ? 'F 모드는 단일 토큰 포인트만 가능' : ''}
                              >
                                <input
                                  type="checkbox"
                                  checked={p.uses.includes(u)}
                                  onChange={() => togglePointUse(p.id, u)}
                                  disabled={u === 'F' && !isSingle}
                                />
                                <span className={p.uses.includes(u) ? 'text-emerald-300 font-bold' : ''}>{u}</span>
                              </label>
                            ));
                          })()}
                          {p.uses.includes('F') && p.endTokenIdx === p.startTokenIdx && (
                            <span className="ml-2 flex items-center gap-1">
                              <span className="text-slate-500">F baseForm:</span>
                              <input
                                value={p.baseForm ?? ''}
                                onChange={e => updatePoint(p.id, { baseForm: e.target.value })}
                                placeholder="원형 (예: reveal)"
                                className="w-32 bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-[11px] text-blue-200"
                              />
                            </span>
                          )}
                          {p.uses.includes('H') && (
                            <span className="ml-2 flex items-center gap-1">
                              <span className="text-slate-500">H:</span>
                              <select
                                value={p.hRole ?? 'error'}
                                onChange={e => updatePoint(p.id, { hRole: e.target.value as 'error' | 'decoy' })}
                                className="bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-[11px]"
                              >
                                <option value="error">오류(치환)</option>
                                <option value="decoy">함정(번호만)</option>
                              </select>
                            </span>
                          )}
                          {p.uses.includes('J') && (
                            <span className="ml-2 flex items-center gap-1">
                              <span className="text-slate-500">J:</span>
                              <select
                                value={p.jVariant ?? 'wrong'}
                                onChange={e => updatePoint(p.id, { jVariant: e.target.value as 'wrong' | 'correct' })}
                                className="bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-[11px]"
                              >
                                <option value="wrong">X 보기(오답형)</option>
                                <option value="correct">O 보기(원문)</option>
                              </select>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            {/* 모드별 메타 입력 */}
            {mode === 'transform' && transformBlocks.length > 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-2">
                <h3 className="text-sm font-bold text-slate-200">baseForm 입력</h3>
                {[...transformBlocks]
                  .sort((a, b) =>
                    a.sentenceIdx !== b.sentenceIdx
                      ? a.sentenceIdx - b.sentenceIdx
                      : a.startTokenIdx - b.startTokenIdx,
                  )
                  .map(b => {
                    const sent = sentences.find(s => s.idx === b.sentenceIdx);
                    if (!sent) return null;
                    const word = sent.tokens[b.startTokenIdx] ?? '';
                    return (
                      <div key={`${b.sentenceIdx}:${b.startTokenIdx}`} className="flex items-center gap-2">
                        <span className="text-xs text-slate-300 w-32 truncate" title={word}>{word}</span>
                        <input
                          value={b.baseForm ?? ''}
                          onChange={e => updateTransformBaseForm(b.sentenceIdx, b.startTokenIdx, e.target.value)}
                          placeholder="원형 (예: reveal)"
                          className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
                        />
                      </div>
                    );
                  })}
              </div>
            )}

            {mode === 'eitherOr' && eitherOrPoints.length > 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-bold text-slate-200">포인트 메타 (함정·어법 설명)</h3>
                {[...eitherOrPoints]
                  .sort((a, b) =>
                    a.sentenceIdx !== b.sentenceIdx
                      ? a.sentenceIdx - b.sentenceIdx
                      : a.startTokenIdx - b.startTokenIdx,
                  )
                  .map((p, idx) => (
                    <div key={`${p.sentenceIdx}:${p.startTokenIdx}`} className="border border-slate-700 rounded-lg p-2.5 space-y-1.5 bg-slate-900/30">
                      <div className="text-[11px] text-slate-500 font-semibold">{idx + 1}번 포인트</div>
                      <div className="flex items-center gap-2">
                        <input
                          value={p.correctForm}
                          onChange={e => updateEitherOrField(p.sentenceIdx, p.startTokenIdx, { correctForm: e.target.value })}
                          className="w-32 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-emerald-200"
                          title="정답 (원문)"
                        />
                        <span className="text-slate-500">↔</span>
                        <input
                          value={p.wrongForm}
                          onChange={e => updateEitherOrField(p.sentenceIdx, p.startTokenIdx, { wrongForm: e.target.value })}
                          placeholder="함정 (오답)"
                          className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-rose-200"
                        />
                      </div>
                      <textarea
                        value={p.explanation ?? ''}
                        onChange={e => updateEitherOrField(p.sentenceIdx, p.startTokenIdx, { explanation: e.target.value })}
                        placeholder="어법 설명 — 왜 이게 답인지 (예: 주어 data 는 복수형이므로 are. is 는 단수 주어와 결합)"
                        rows={2}
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 resize-none"
                      />
                    </div>
                  ))}
              </div>
            )}

            {mode === 'correction' && correctionSpans.length > 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-bold text-slate-200">구간 메타</h3>
                <p className="text-[11px] text-slate-500">오류 ✓ = 지문에 wrongForm 치환 + 정답·설명 노출. 해제 = 함정(번호만).</p>
                {[...correctionSpans]
                  .sort((a, b) =>
                    a.sentenceIdx !== b.sentenceIdx
                      ? a.sentenceIdx - b.sentenceIdx
                      : a.startTokenIdx - b.startTokenIdx,
                  )
                  .map((s, idx) => {
                    const sent = sentences.find(x => x.idx === s.sentenceIdx);
                    if (!sent) return null;
                    const original = sent.tokens.slice(s.startTokenIdx, s.endTokenIdx + 1).join(' ');
                    return (
                      <div
                        key={`${s.sentenceIdx}:${s.startTokenIdx}:${s.endTokenIdx}`}
                        className="border border-slate-700 rounded-lg p-2.5 space-y-1.5 bg-slate-900/30"
                      >
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-[11px] text-slate-500 font-semibold">{idx + 1}번 구간</span>
                          <label className="flex items-center gap-1 text-slate-300">
                            <input
                              type="checkbox"
                              checked={s.isError}
                              onChange={e =>
                                updateCorrectionField(s.sentenceIdx, s.startTokenIdx, s.endTokenIdx, {
                                  isError: e.target.checked,
                                })
                              }
                            />
                            오류
                          </label>
                          <span className="text-slate-400 truncate flex-1" title={original}>
                            {original}
                          </span>
                        </div>
                        {s.isError && (
                          <>
                            <div className="flex items-center gap-2">
                              <input
                                value={s.wrongForm ?? ''}
                                onChange={e =>
                                  updateCorrectionField(s.sentenceIdx, s.startTokenIdx, s.endTokenIdx, {
                                    wrongForm: e.target.value,
                                  })
                                }
                                placeholder="오답 (지문에 치환)"
                                className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-rose-200"
                              />
                              <span className="text-slate-500">→</span>
                              <input
                                value={s.correction ?? ''}
                                onChange={e =>
                                  updateCorrectionField(s.sentenceIdx, s.startTokenIdx, s.endTokenIdx, {
                                    correction: e.target.value,
                                  })
                                }
                                placeholder={`정답 (기본: ${original})`}
                                className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-emerald-200"
                              />
                            </div>
                            <textarea
                              value={s.explanation ?? ''}
                              onChange={e =>
                                updateCorrectionField(s.sentenceIdx, s.startTokenIdx, s.endTokenIdx, {
                                  explanation: e.target.value,
                                })
                              }
                              placeholder="어법 설명 — 왜 오류인지 + 어떻게 고쳐야 하는지"
                              rows={2}
                              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 resize-none"
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}

            {mode === 'ox' && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-200">O·X 보기 항목</h3>
                  <button
                    type="button"
                    onClick={addOxItem}
                    className="text-xs px-2 py-1 rounded-lg bg-emerald-700 text-white hover:bg-emerald-600 font-semibold"
                  >
                    + 보기 추가
                  </button>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">지시문 (선택)</label>
                  <input
                    value={oxIntro}
                    onChange={e => setOxIntro(e.target.value)}
                    placeholder="※ 보기가 옳으면 O, 틀리면 X. 틀린 것은 바르게 고쳐 쓰세요."
                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm"
                  />
                </div>
                {oxItems.map((it, i) => (
                  <div key={i} className="border border-slate-700 rounded-lg p-2.5 space-y-1.5 bg-slate-900/30">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-amber-300 font-bold w-5">{i + 1}.</span>
                      <label className="flex items-center gap-1 text-slate-300">
                        <input
                          type="checkbox"
                          checked={it.isCorrect}
                          onChange={e => updateOxItem(i, { isCorrect: e.target.checked })}
                        />
                        옳음(O)
                      </label>
                      <button
                        type="button"
                        onClick={() => removeOxItem(i)}
                        className="ml-auto text-[11px] text-rose-400 hover:text-rose-300"
                      >
                        삭제
                      </button>
                    </div>
                    <textarea
                      value={it.text}
                      onChange={e => updateOxItem(i, { text: e.target.value })}
                      placeholder="보기 문장 (영문)"
                      rows={2}
                      className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm font-serif resize-none"
                    />
                    {!it.isCorrect && (
                      <input
                        value={it.correction ?? ''}
                        onChange={e => updateOxItem(i, { correction: e.target.value })}
                        placeholder="올바른 표현(정답)"
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-emerald-200"
                      />
                    )}
                    <textarea
                      value={it.explanation ?? ''}
                      onChange={e => updateOxItem(i, { explanation: e.target.value })}
                      placeholder={it.isCorrect ? '어법 설명 — 왜 옳은지' : '어법 설명 — 왜 오류이고 어떻게 고치는지'}
                      rows={2}
                      className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 resize-none"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── 우측 미리보기 ── */}
        <div className="flex-1 min-w-0 flex flex-col bg-slate-900">
          <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-700 flex-wrap bg-slate-950/40">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setCollapsed(v => !v)}
                className="px-2 py-1 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white text-xs font-bold leading-none"
                title={collapsed ? '입력 패널 열기' : '입력 패널 접기'}
              >
                {collapsed ? '⏵' : '⏴'}
              </button>
              <span className="font-bold text-white">미리보기</span>
              <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full font-medium">
                {MODE_TABS.find(m => m.key === mode)?.label}
              </span>
              {previewHtml && (
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
            {previewHtml && (
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
          <div className="flex-1 min-h-0 overflow-auto bg-slate-900/60 p-6 scrollbar-thin">
            {previewHtml ? (
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
                <p className="text-base font-medium text-slate-400">
                  {mode === 'ox' ? '보기 항목을 입력하세요' : '지문을 선택하세요'}
                </p>
                <p className="text-sm mt-1">
                  {mode === 'ox' ? '왼쪽에서 보기 추가/편집' : '왼쪽 「DB에서 불러오기」로 시작'}
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
