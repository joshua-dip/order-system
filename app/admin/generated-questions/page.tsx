'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BOOK_VARIANT_QUESTION_TYPES,
  DEFAULT_QUESTIONS_PER_VARIANT_TYPE,
} from '@/lib/book-variant-types';

const VALIDATE_EXCLUDE_STORAGE = 'admin-gq-validate-excluded-types';
/** 「+ 같은유형」 AI 초안 — 유형(type)별 추가 지침 (브라우저 저장) */
const TYPE_VARIANT_PROMPTS_STORAGE = 'admin-gq-variant-prompts-by-type';
const GQ_DENSITY_STORAGE_KEY = 'admin-gq-table-density';
const GQ_COL_STORAGE_NARROW = 'admin-gq-cols-v5-narrow';
const GQ_COL_STORAGE_WIDE = 'admin-gq-cols-v5-wide';
/** 구버전 한 키 — 넓게 보기 마이그레이션용 */
const GQ_COL_STORAGE_LEGACY = 'admin-generated-questions-col-widths-v5';

/** 열 순서: 작업, 교재, 유형, Paragraph, Options, Explanation, 출처, passage, 발문 */
const GQ_COL_MINS = [72, 130, 100, 160, 200, 200, 88, 88, 180];
const GQ_COL_MAXS = [220, 480, 280, 560, 720, 720, 280, 320, 800];
const GQ_COL_DEFAULTS_NARROW = [72, 132, 100, 190, 220, 220, 88, 96, 180];
const GQ_COL_DEFAULTS_WIDE = [104, 200, 140, 280, 320, 320, 120, 140, 260];

type TableDensity = 'narrow' | 'wide';

function clampColWidths(raw: number[] | null, defaults: number[]): number[] {
  if (!raw || raw.length !== defaults.length) return [...defaults];
  return defaults.map((d, i) => {
    const n = Number(raw[i]);
    if (!Number.isFinite(n)) return d;
    return Math.min(GQ_COL_MAXS[i], Math.max(GQ_COL_MINS[i], n));
  });
}

function loadColWidthsForDensity(d: TableDensity): number[] {
  const def = d === 'narrow' ? GQ_COL_DEFAULTS_NARROW : GQ_COL_DEFAULTS_WIDE;
  if (typeof window === 'undefined') return [...def];
  try {
    const key = d === 'narrow' ? GQ_COL_STORAGE_NARROW : GQ_COL_STORAGE_WIDE;
    let raw = localStorage.getItem(key);
    if (!raw && d === 'wide') raw = localStorage.getItem(GQ_COL_STORAGE_LEGACY);
    if (raw) {
      const p = JSON.parse(raw) as unknown;
      if (Array.isArray(p) && p.length === def.length) {
        return clampColWidths(p as number[], def);
      }
    }
  } catch {
    /* ignore */
  }
  return [...def];
}


/** Paragraph 내 <u>...</u> 구간을 색상·밑줄로 강조해 렌더 (XSS 방지: 태그 제거 후 텍스트만 표시) */
function ParagraphWithUnderline({ text, className = '' }: { text: string; className?: string }) {
  if (!text) return <span className={className}>—</span>;
  const parts = text.split(/(<u>[\s\S]*?<\/u>)/gi);
  return (
    <span className={`whitespace-pre-wrap break-words ${className}`}>
      {parts.map((part, i) => {
        const m = part.match(/^<u>([\s\S]*)<\/u>$/i);
        if (m) {
          return (
            <span
              key={i}
              className="bg-amber-500/25 text-amber-200 underline underline-offset-2 decoration-amber-400 decoration-2"
            >
              {m[1]}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

const DEFAULT_QUESTION_JSON = `{
  "순서": 1,
  "Source": "",
  "NumQuestion": 1,
  "Category": "",
  "Question": "",
  "Paragraph": "",
  "Options": "",
  "OptionType": "English",
  "CorrectAnswer": "",
  "Explanation": ""
}`;

type Row = {
  _id: string;
  textbook: string;
  passage_id: string | null;
  source: string;
  type: string;
  option_type?: string;
  /** 원문 대비 지문 변형도 0~100 (API 계산) */
  variation_pct?: number | null;
  question_data?: {
    Question?: string;
    Paragraph?: string;
    NumQuestion?: number;
    Category?: string;
    Options?: string;
    Explanation?: string;
  };
  created_at?: string;
};

export default function AdminGeneratedQuestionsPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ loginId: string; role: string } | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);

  const [filterTextbook, setFilterTextbook] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPassageId, setFilterPassageId] = useState('');
  const [filterQ, setFilterQ] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<Row[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftUserHint, setDraftUserHint] = useState('');
  /** Claude 초안 생성 성공 후 true → "생성됨" 표시 및 추가 수정 버튼 노출 */
  const [draftGenerated, setDraftGenerated] = useState(false);
  /** Claude로 해설(Explanation)만 생성 중 */
  const [explanationOnlyLoading, setExplanationOnlyLoading] = useState(false);
  /** 해당 교재 passage_id의 원문(원문 미리보기) */
  const [passagePreview, setPassagePreview] = useState<string | null>(null);
  const [passagePreviewLoading, setPassagePreviewLoading] = useState(false);
  const questionJsonTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = useState({
    textbook: '',
    passage_id: '',
    source: '',
    type: '',
    option_type: 'English',
    status: '완료',
    error_msg: '',
  });
  const [questionJson, setQuestionJson] = useState(DEFAULT_QUESTION_JSON);
  /** 저장 직후 해당 문제 행으로 스크롤하기 위한 id (문제보러가기 버튼 표시) */
  const [goToRowId, setGoToRowId] = useState<string | null>(null);

  type SolveResult = {
    claudeAnswer: string;
    claudeResponse: string;
    correctAnswer: string | null;
    isCorrect: boolean | null;
  };

  const [solveOpen, setSolveOpen] = useState(false);
  const [solveLoading, setSolveLoading] = useState(false);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);
  const [solveRow, setSolveRow] = useState<{
    id: string; source: string; type: string; textbook: string;
    question: string; paragraph: string; options: string; correctAnswer: string;
  } | null>(null);

  const [siblingModalId, setSiblingModalId] = useState<string | null>(null);
  const [siblingLoading, setSiblingLoading] = useState(false);
  const [siblingErr, setSiblingErr] = useState<string | null>(null);
  const [siblingHint, setSiblingHint] = useState('');

  const [typePromptModalOpen, setTypePromptModalOpen] = useState(false);
  const [typePromptList, setTypePromptList] = useState<string[]>([]);
  const [typePromptMap, setTypePromptMap] = useState<Record<string, string>>({});
  const [typePromptNewName, setTypePromptNewName] = useState('');
  const [typePromptSavedFlash, setTypePromptSavedFlash] = useState(false);

  type DuplicateGroup = {
    questionType: string;
    optionsFull: string;
    optionsPreview: string;
    duplicateCount: number;
    sampleItems: { id: string; textbook: string; source: string; type: string }[];
    truncated: boolean;
  };
  const [validateOpen, setValidateOpen] = useState(false);
  const [validateLoading, setValidateLoading] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [validateData, setValidateData] = useState<{
    scannedDocuments: number;
    duplicateGroupCount: number;
    summaryByType: Record<string, number>;
    excludedTypes: string[];
    groups: DuplicateGroup[];
    filters: { textbook: string | null; type: string | null };
  } | null>(null);
  const [validateExpanded, setValidateExpanded] = useState<Record<number, boolean>>({});
  const [validateExcludedTypes, setValidateExcludedTypes] = useState<string[]>([]);
  /** 선택지만 수정(Claude) 진행 중인 문서 id */
  const [regenerateOptionsLoading, setRegenerateOptionsLoading] = useState<string | null>(null);

  /** 변형도 분석 모달 */
  const [variationAnalysisOpen, setVariationAnalysisOpen] = useState(false);
  const [variationAnalysisLoading, setVariationAnalysisLoading] = useState(false);
  const [variationAnalysisError, setVariationAnalysisError] = useState<string | null>(null);
  const [variationAnalysisData, setVariationAnalysisData] = useState<{
    totalScanned: number;
    filters: { textbook: string | null; type: string | null };
    byType: Record<
      string,
      { count: number; avg: number; min: number; max: number; distribution: number[] }
    >;
  } | null>(null);

  /** 선택지 데이터 검증 (교재·강·category 그룹별 상호 일치도) */
  const [optionsOverlapOpen, setOptionsOverlapOpen] = useState(false);
  const [optionsOverlapLoading, setOptionsOverlapLoading] = useState(false);
  const [optionsOverlapError, setOptionsOverlapError] = useState<string | null>(null);
  const [optionsOverlapData, setOptionsOverlapData] = useState<{
    filters: { textbook: string | null; category: string | null };
    totalScanned: number;
    totalGroups: number;
    groups: {
      textbook: string;
      lessonKey: string;
      category: string;
      itemCount: number;
      items: { id: string; source: string; type: string; avgOverlapWithOthers: number }[];
      pairwiseOverlaps: { i: number; j: number; overlapPct: number }[];
    }[];
  } | null>(null);
  /** 선택지 데이터 검증 결과에서 숨길 category (체크한 것은 목록에 안 보임) */
  const [optionsOverlapExcludedCategories, setOptionsOverlapExcludedCategories] = useState<string[]>([]);

  /** Explanation 'API' 검증: Explanation에 'API' 텍스트 포함 여부 */
  const [explanationApiOpen, setExplanationApiOpen] = useState(false);
  const [explanationApiLoading, setExplanationApiLoading] = useState(false);
  const [explanationApiError, setExplanationApiError] = useState<string | null>(null);
  const [explanationApiData, setExplanationApiData] = useState<{
    filters: { textbook: string | null; type: string | null };
    totalScanned: number;
    totalMatched: number;
    items: { id: string; textbook: string; source: string; type: string; snippet: string; full: string }[];
    truncated?: boolean;
  } | null>(null);
  /** Explanation/Options 검증 모달에서 셀 클릭 시 전체 텍스트 보기 */
  const [fullTextView, setFullTextView] = useState<{ title: string; text: string } | null>(null);
  /** Options 'API' 검증 */
  const [optionsApiOpen, setOptionsApiOpen] = useState(false);
  const [optionsApiLoading, setOptionsApiLoading] = useState(false);
  const [optionsApiError, setOptionsApiError] = useState<string | null>(null);
  const [optionsApiData, setOptionsApiData] = useState<{
    filters: { textbook: string | null; type: string | null };
    totalScanned: number;
    totalMatched: number;
    items: { id: string; textbook: string; source: string; type: string; snippet: string; full: string }[];
    truncated?: boolean;
  } | null>(null);
  /** 메뉴 접기/펼치기 (검증 버튼 아래 나머지 메뉴) */
  const [extraMenuExpanded, setExtraMenuExpanded] = useState(false);

  type QCountNoRow = {
    passageId: string;
    textbook: string;
    chapter: unknown;
    number: unknown;
    source_key: unknown;
    label: string;
  };
  type QCountUnderRow = {
    passageId: string;
    label: string;
    type: string;
    count: number;
    required: number;
    shortBy: number;
  };
  type QCountScope = 'textbook' | 'order';
  type QCountOrderOption = {
    id: string;
    orderNumber: string | null;
    createdAt: string;
    orderMetaFlow: string | null;
    hasOrderMeta: boolean;
  };
  const [qCountOpen, setQCountOpen] = useState(false);
  const [qCountLoading, setQCountLoading] = useState(false);
  const [qCountError, setQCountError] = useState<string | null>(null);
  const [qCountScope, setQCountScope] = useState<QCountScope>('textbook');
  const [qCountOrderId, setQCountOrderId] = useState('');
  const [qCountOrders, setQCountOrders] = useState<QCountOrderOption[]>([]);
  const [qCountOrdersLoading, setQCountOrdersLoading] = useState(false);
  const [qCountData, setQCountData] = useState<{
    scope: QCountScope;
    textbook: string;
    requiredPerType: number;
    passageCount: number;
    standardTypes: string[];
    typesChecked: string[];
    noQuestionsTotal: number;
    underfilledTotal: number;
    noQuestionsTruncated: boolean;
    underfilledTruncated: boolean;
    noQuestions: QCountNoRow[];
    underfilled: QCountUnderRow[];
    message?: string;
    orderLessonsRequested?: number;
    orderLessonsMatched?: number;
    lessonsWithoutPassage?: string[];
    order: { id: string; orderNumber: string | null; flow: string } | null;
  } | null>(null);
  /** 문제수 검증 — 유형 부족 표: 지문 라벨 순 vs 유형(카테고리)별 그룹 정렬 */
  const [qCountUnderfilledSortBy, setQCountUnderfilledSortBy] = useState<'label' | 'type'>('label');
  /** 문제수 검증 디버깅 정보 (주문서 기반 검증 시 상세 데이터) */
  const [qCountDebugData, setQCountDebugData] = useState<{
    order: { _id: string; orderNumber: string | null; flow: string };
    orderMeta: { selectedTextbook: string; selectedLessons: string[]; selectedTypes: string[]; questionsPerType: number };
    passages: { total: number; requestedLessons: number; matchedLessons: number; lessonsWithoutPassage: string[]; sample: Array<{ _id: string; textbook: string; chapter: string; number: string; source_key: string }> };
    generatedQuestions: { total: number; byPassageType: Array<{ passageId: string; type: string; count: number }>; sample: Array<{ _id: string; passage_id: string; type: string; source: string; textbook: string }> };
    analysis: { issue: string };
  } | null>(null);
  const [qCountDebugLoading, setQCountDebugLoading] = useState(false);
  /** 부족 문항 한번에 처리: 남은 작업 큐. 처리 중이면 모달 저장 시 다음으로 넘어가고, 다 끝나면 검수 창으로 이동 */
  const [shortageBatch, setShortageBatch] = useState<{
    rows: QCountUnderRow[];
    textbook: string;
    rowIndex: number;
    remainingInRow: number;
    totalCreated: number;
  } | null>(null);
  /** 검수 창(목록 테이블)으로 스크롤하기 위한 ref */
  const listSectionRef = useRef<HTMLDivElement>(null);
  /** 부족 문항 일괄 처리 큐 ref — 저장 시 클로저에서 state가 비어 있을 수 있어 ref로 보강 */
  const shortageBatchRef = useRef<{
    rows: QCountUnderRow[];
    textbook: string;
    rowIndex: number;
    remainingInRow: number;
    totalCreated: number;
  } | null>(null);
  /** 부족 문항 일괄 처리 완료 시 표시할 건수 (검수 창 배너) */
  const [shortageBatchFinishedCount, setShortageBatchFinishedCount] = useState<number | null>(null);
  /** 한번에 먼저 생성: Claude 초안 생성 후 자동 저장 진행 중 */
  const [batchCreatingAll, setBatchCreatingAll] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    label: string;
    type: string;
  } | null>(null);
  const [batchCreateError, setBatchCreateError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const s = localStorage.getItem(VALIDATE_EXCLUDE_STORAGE);
      if (s) {
        const p = JSON.parse(s) as unknown;
        if (Array.isArray(p)) {
          setValidateExcludedTypes(p.filter((x): x is string => typeof x === 'string'));
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VALIDATE_EXCLUDE_STORAGE, JSON.stringify(validateExcludedTypes));
    } catch {
      /* ignore */
    }
  }, [validateExcludedTypes]);

  const [tableDensity, setTableDensity] = useState<TableDensity>('wide');
  const [colWidths, setColWidths] = useState<number[]>(() => [...GQ_COL_DEFAULTS_WIDE]);
  const dragRef = useRef<{ i: number; startX: number; startW: number } | null>(null);
  const skipFirstColSave = useRef(true);

  useEffect(() => {
    let d: TableDensity = 'wide';
    try {
      const s = localStorage.getItem(GQ_DENSITY_STORAGE_KEY);
      if (s === 'narrow' || s === 'wide') d = s;
    } catch {
      /* ignore */
    }
    setTableDensity(d);
    setColWidths(loadColWidthsForDensity(d));
  }, []);

  useEffect(() => {
    if (skipFirstColSave.current) {
      skipFirstColSave.current = false;
      return;
    }
    try {
      const key = tableDensity === 'narrow' ? GQ_COL_STORAGE_NARROW : GQ_COL_STORAGE_WIDE;
      localStorage.setItem(key, JSON.stringify(colWidths));
    } catch {
      /* ignore */
    }
  }, [colWidths, tableDensity]);

  const setTableDensityAndLoad = useCallback((d: TableDensity) => {
    setTableDensity(d);
    setColWidths(loadColWidthsForDensity(d));
    try {
      localStorage.setItem(GQ_DENSITY_STORAGE_KEY, d);
    } catch {
      /* ignore */
    }
  }, []);

  const startColResize = (colIndex: number, clientX: number) => {
    dragRef.current = {
      i: colIndex,
      startX: clientX,
      startW: colWidths[colIndex],
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const w = Math.min(
        GQ_COL_MAXS[d.i],
        Math.max(GQ_COL_MINS[d.i], d.startW + e.clientX - d.startX)
      );
      setColWidths((prev) => {
        const next = [...prev];
        next[d.i] = w;
        return next;
      });
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });
  };

  const resetColWidths = () => {
    const def = tableDensity === 'narrow' ? GQ_COL_DEFAULTS_NARROW : GQ_COL_DEFAULTS_WIDE;
    setColWidths([...def]);
    try {
      const key = tableDensity === 'narrow' ? GQ_COL_STORAGE_NARROW : GQ_COL_STORAGE_WIDE;
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.user || d.user.role !== 'admin') {
          router.replace('/admin/login?from=/admin/generated-questions');
          return;
        }
        setUser(d.user);
      })
      .catch(() => router.replace('/admin/login?from=/admin/generated-questions'))
      .finally(() => setLoadingAuth(false));
  }, [router]);

  const fetchMeta = useCallback(() => {
    fetch('/api/admin/generated-questions/meta', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setTextbooks(Array.isArray(d.textbooks) ? d.textbooks : []);
        setTypes(Array.isArray(d.types) ? d.types : []);
        setStatuses(Array.isArray(d.statuses) ? d.statuses : []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchMeta();
  }, [user, fetchMeta]);

  const fetchList = useCallback(() => {
    setListLoading(true);
    const params = new URLSearchParams();
    if (filterTextbook) params.set('textbook', filterTextbook);
    if (filterType) params.set('type', filterType);
    if (filterStatus) params.set('status', filterStatus);
    if (filterPassageId.trim()) params.set('passage_id', filterPassageId.trim());
    if (filterQ) params.set('q', filterQ);
    params.set('page', String(page));
    params.set('limit', String(limit));
    fetch(`/api/admin/generated-questions?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setItems(Array.isArray(d.items) ? d.items : []);
        setTotal(typeof d.total === 'number' ? d.total : 0);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setListLoading(false));
  }, [filterTextbook, filterType, filterStatus, filterPassageId, filterQ, page, limit]);

  useEffect(() => {
    if (!user) return;
    fetchList();
  }, [user, fetchList]);

  const openCreate = () => {
    setEditingId(null);
    setDraftError(null);
    setDraftUserHint('');
    setDraftGenerated(false);
    setPassagePreview(null);
    setForm({
      textbook: filterTextbook || '',
      passage_id: filterPassageId.trim() || '',
      source: '',
      type: filterType || '',
      option_type: 'English',
      status: '완료',
      error_msg: '',
    });
    setQuestionJson(DEFAULT_QUESTION_JSON);
    setModalOpen(true);
  };

  /** 문제수 검증 — 부족 셀 클릭 시 해당 지문·유형으로 새 변형문제 모달 */
  const openCreateForQCountShortage = (r: QCountUnderRow, textbook: string) => {
    console.log('[openCreateForQCountShortage]', { label: r.label, type: r.type, passageId: r.passageId?.slice(0, 8), textbook });
    const tb = (textbook || '').trim();
    if (!tb || !r.passageId.trim()) {
      console.warn('[openCreateForQCountShortage] early return: no textbook or passageId', { tb: !!tb, passageId: r.passageId?.trim() });
      return;
    }
    setQCountOpen(false);
    setValidateOpen(false);
    setEditingId(null);
    setFilterTextbook(tb);
    setFilterType(r.type);
    setFilterPassageId(r.passageId);
    setForm({
      textbook: tb,
      passage_id: r.passageId.trim(),
      source: (r.label || '').trim() || `${r.type} 변형`,
      type: r.type,
      option_type: 'English',
      status: '완료',
      error_msg: '',
    });
    setQuestionJson(DEFAULT_QUESTION_JSON);
    setDraftError(null);
    setDraftUserHint('');
    setDraftGenerated(false);
    setPassagePreview(null);
    setPage(1);
    setModalOpen(true);
    if (types.length === 0) fetchMeta();
  };

  /** passage_id 유효 시 해당 교재 원문(passages) 로드 → 원문 미리보기 */
  useEffect(() => {
    if (!modalOpen || !form.passage_id.trim()) {
      setPassagePreview(null);
      return;
    }
    const pid = form.passage_id.trim();
    if (!/^[a-f0-9]{24}$/i.test(pid)) {
      setPassagePreview(null);
      return;
    }
    let cancelled = false;
    setPassagePreviewLoading(true);
    setPassagePreview(null);
    fetch(`/api/admin/passages/${pid}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const item = d?.item;
        if (!item || typeof item !== 'object') {
          setPassagePreview(null);
          return;
        }
        const content = item.content;
        const raw =
          (typeof content?.original === 'string' && content.original.trim()) ||
          (typeof content?.mixed === 'string' && content.mixed.trim()) ||
          (typeof content?.translation === 'string' && content.translation.trim()) ||
          '';
        setPassagePreview(raw || null);
      })
      .catch(() => {
        if (!cancelled) setPassagePreview(null);
      })
      .finally(() => {
        if (!cancelled) setPassagePreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modalOpen, form.passage_id]);

  const runGenerateDraft = async () => {
    if (!form.textbook.trim() || !form.passage_id.trim() || !form.source.trim() || !form.type.trim()) {
      setDraftError('교재·passage_id·출처·유형을 모두 채운 뒤 실행해 주세요.');
      return;
    }
    const pid = form.passage_id.trim();
    if (!/^[a-f0-9]{24}$/i.test(pid)) {
      setDraftError('passage_id가 올바른 ObjectId(24자 hex)인지 확인해 주세요.');
      return;
    }
    setDraftLoading(true);
    setDraftError(null);
    const stored = loadTypePromptsFromStorage();
    const typePrompt = (stored[form.type.trim()] ?? '').trim();
    try {
      const res = await fetch('/api/admin/generated-questions/generate-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          passage_id: pid,
          textbook: form.textbook.trim(),
          source: form.source.trim(),
          type: form.type.trim(),
          userHint: draftUserHint.trim(),
          ...(typePrompt ? { typePrompt } : {}),
          option_type: form.option_type.trim() || 'English',
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setDraftError(typeof d.error === 'string' ? d.error : '초안 생성 실패');
        return;
      }
      const qd = d.question_data;
      if (qd && typeof qd === 'object' && !Array.isArray(qd)) {
        setQuestionJson(JSON.stringify(qd, null, 2));
        setForm((f) => ({ ...f, status: '대기' }));
        setDraftGenerated(true);
      }
    } catch {
      setDraftError('네트워크 오류');
    } finally {
      setDraftLoading(false);
    }
  };

  /** Claude로 Explanation(해설)만 생성해 question_data.Explanation만 덮어쓰기 */
  const runGenerateExplanationOnly = async () => {
    let question_data: Record<string, unknown>;
    try {
      question_data = JSON.parse(questionJson) as Record<string, unknown>;
      if (!question_data || typeof question_data !== 'object' || Array.isArray(question_data)) {
        setDraftError('question_data JSON 형식을 확인해 주세요.');
        return;
      }
    } catch {
      setDraftError('question_data JSON 형식을 확인해 주세요.');
      return;
    }
    const paragraph = question_data.Paragraph;
    if (typeof paragraph !== 'string' || !paragraph.trim()) {
      setDraftError('Paragraph가 비어 있으면 해설을 생성할 수 없습니다.');
      return;
    }
    setExplanationOnlyLoading(true);
    setDraftError(null);
    try {
      const res = await fetch('/api/admin/generated-questions/generate-explanation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          question_data,
          type: form.type.trim(),
          userHint: draftUserHint.trim(),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setDraftError(d.error || '해설 생성 실패');
        return;
      }
      const explanation = typeof d.explanation === 'string' ? d.explanation : '';
      setQuestionJson(
        JSON.stringify({ ...question_data, Explanation: explanation }, null, 2)
      );
    } catch {
      setDraftError('네트워크 오류');
    } finally {
      setExplanationOnlyLoading(false);
    }
  };

  const focusQuestionJsonForEdit = () => {
    questionJsonTextareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => questionJsonTextareaRef.current?.focus(), 300);
  };

  const openEdit = async (id: string) => {
    setEditingId(id);
    setDraftError(null);
    setDraftUserHint('');
    setDraftGenerated(false);
    setPassagePreview(null);
    try {
      const res = await fetch(`/api/admin/generated-questions/${id}`, { credentials: 'include' });
      const d = await res.json();
      if (!res.ok || !d.item) {
        alert(d.error || '불러오기 실패');
        return;
      }
      const it = d.item as Record<string, unknown>;
      setForm({
        textbook: String(it.textbook ?? ''),
        passage_id: String(it.passage_id ?? ''),
        source: String(it.source ?? ''),
        type: String(it.type ?? ''),
        option_type: String(it.option_type ?? 'English'),
        status: String(it.status ?? '완료'),
        error_msg: it.error_msg == null ? '' : String(it.error_msg),
      });
      const qd = it.question_data;
      setQuestionJson(
        qd && typeof qd === 'object' ? JSON.stringify(qd, null, 2) : DEFAULT_QUESTION_JSON
      );
      setModalOpen(true);
    } catch {
      alert('요청 실패');
    }
  };

  const handleSave = async () => {
    if (!form.textbook.trim() || !form.passage_id.trim()) {
      alert('교재명과 passage_id(원문 문서 ObjectId)는 필수입니다.');
      return;
    }
    if (!editingId && (!form.source.trim() || !form.type.trim())) {
      alert('출처(source)와 유형(type)은 필수입니다.');
      return;
    }
    let question_data: Record<string, unknown>;
    try {
      question_data = JSON.parse(questionJson) as Record<string, unknown>;
      if (!question_data || typeof question_data !== 'object' || Array.isArray(question_data)) {
        throw new Error('invalid');
      }
    } catch {
      alert('question_data JSON 형식을 확인해 주세요.');
      return;
    }

    setSaving(true);
    console.log('[handleSave] start', { editingId: !!editingId, hasShortageBatch: !!shortageBatch });
    try {
      const url = editingId ? `/api/admin/generated-questions/${editingId}` : '/api/admin/generated-questions';
      const method = editingId ? 'PATCH' : 'POST';
      const body = editingId
        ? {
            textbook: form.textbook.trim(),
            passage_id: form.passage_id.trim(),
            source: form.source.trim(),
            type: form.type.trim(),
            option_type: form.option_type.trim(),
            status: form.status.trim(),
            error_msg: form.error_msg.trim() || null,
            question_data,
          }
        : {
            textbook: form.textbook.trim(),
            passage_id: form.passage_id.trim(),
            source: form.source.trim(),
            type: form.type.trim(),
            option_type: form.option_type.trim(),
            status: form.status.trim(),
            error_msg: form.error_msg.trim() || null,
            question_data,
          };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        console.warn('[handleSave] API not ok', res.status, data?.error);
        alert(data.error || '저장 실패');
        return;
      }
      const batch = shortageBatchRef.current ?? shortageBatch;
      console.log('[handleSave] saved ok', { editingId: !!editingId, shortageBatch: !!shortageBatch, batchRef: !!shortageBatchRef.current });
      const savedId = editingId ?? (typeof data.item?._id === 'string' ? data.item._id : null);
      if (savedId) setGoToRowId(savedId);
      fetchList();
      fetchMeta();

      if (!editingId && batch) {
        const { rows, textbook, rowIndex, remainingInRow, totalCreated } = batch;
        const nextTotal = totalCreated + 1;
        console.log('[handleSave] shortageBatch branch', { rowIndex, remainingInRow, rowsLength: rows.length, nextTotal });
        if (remainingInRow > 1) {
          console.log('[handleSave] same row: one more (remainingInRow - 1)');
          const nextBatch = { ...batch, remainingInRow: remainingInRow - 1, totalCreated: nextTotal };
          shortageBatchRef.current = nextBatch;
          setShortageBatch(nextBatch);
          setForm((f) => ({ ...f, source: (rows[rowIndex].label || '').trim() || `${rows[rowIndex].type} 변형` }));
          setQuestionJson(DEFAULT_QUESTION_JSON);
          setDraftGenerated(false);
          setDraftError(null);
          setPassagePreview(null);
          setModalOpen(true);
          return;
        }
        if (rowIndex + 1 < rows.length) {
          const nextIndex = rowIndex + 1;
          const nextRow = rows[nextIndex];
          console.log('[handleSave] next row', { nextIndex, nextLabel: nextRow.label, nextType: nextRow.type });
          const nextBatch = { rows, textbook, rowIndex: nextIndex, remainingInRow: nextRow.shortBy, totalCreated: nextTotal };
          shortageBatchRef.current = nextBatch;
          setShortageBatch(nextBatch);
          openCreateForQCountShortage(nextRow, textbook);
          return;
        }
        console.log('[handleSave] batch complete, scroll to list', { nextTotal, listSectionRef: !!listSectionRef.current });
        shortageBatchRef.current = null;
        setShortageBatch(null);
        setModalOpen(false);
        setFilterTextbook(textbook);
        setPage(1);
        setShortageBatchFinishedCount(nextTotal);
        fetchList();
        listSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setGoToRowId(null);
        return;
      }

      if (!editingId) setPage(1);
      setModalOpen(false);
    } catch {
      alert('요청 중 오류');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 변형문제를 삭제할까요? 되돌릴 수 없습니다.')) return;
    try {
      const res = await fetch(`/api/admin/generated-questions/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok) {
        alert(d.error || '삭제 실패');
        return;
      }
      fetchList();
      fetchMeta();
    } catch {
      alert('요청 실패');
    }
  };

  const openSolve = async (id: string) => {
    setSolveOpen(true);
    setSolveResult(null);
    setSolveError(null);
    setSolveRow(null);
    setSolveLoading(true);
    try {
      const res = await fetch(`/api/admin/generated-questions/${id}`, { credentials: 'include' });
      const d = await res.json();
      if (!res.ok || !d.item) {
        setSolveError(d.error || '문제 데이터 불러오기 실패');
        setSolveLoading(false);
        return;
      }
      const it = d.item as Record<string, unknown>;
      const qd = (it.question_data as Record<string, unknown>) || {};
      const rowData = {
        id,
        source: String(it.source ?? ''),
        type: String(it.type ?? ''),
        textbook: String(it.textbook ?? ''),
        question: String(qd.Question ?? ''),
        paragraph: String(qd.Paragraph ?? ''),
        options: String(qd.Options ?? ''),
        correctAnswer: String(qd.CorrectAnswer ?? ''),
      };
      setSolveRow(rowData);

      const solveRes = await fetch('/api/admin/generated-questions/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          question: rowData.question,
          paragraph: rowData.paragraph,
          options: rowData.options,
          correctAnswer: rowData.correctAnswer,
          questionType: rowData.type,
        }),
      });
      const sd = await solveRes.json();
      if (!solveRes.ok) {
        setSolveError(sd.error || '풀기 요청 실패');
        return;
      }
      setSolveResult(sd as SolveResult);
    } catch {
      setSolveError('네트워크 오류');
    } finally {
      setSolveLoading(false);
    }
  };

  const runFromSibling = async (mode: 'blank' | 'ai') => {
    if (!siblingModalId) return;
    setSiblingLoading(true);
    setSiblingErr(null);
    const rowType =
      items.find((r) => r._id === siblingModalId)?.type?.trim() || '';
    const storedPrompts = loadTypePromptsFromStorage();
    const typePrompt = rowType ? (storedPrompts[rowType] ?? '').trim() : '';

    try {
      const res = await fetch('/api/admin/generated-questions/from-sibling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sourceId: siblingModalId,
          mode,
          userHint: siblingHint.trim(),
          ...(mode === 'ai' && typePrompt ? { typePrompt } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setSiblingErr(typeof d.error === 'string' ? d.error : '실패');
        return;
      }
      const newId = d.item && typeof d.item._id === 'string' ? d.item._id : null;
      setSiblingModalId(null);
      setSiblingHint('');
      fetchList();
      fetchMeta();
      if (newId) await openEdit(newId);
    } catch {
      setSiblingErr('네트워크 오류');
    } finally {
      setSiblingLoading(false);
    }
  };

  const loadTypePromptsFromStorage = useCallback((): Record<string, string> => {
    try {
      const raw = localStorage.getItem(TYPE_VARIANT_PROMPTS_STORAGE);
      if (!raw) return {};
      const p = JSON.parse(raw) as unknown;
      if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(p)) {
        if (typeof k === 'string' && k.trim() && typeof v === 'string') out[k.trim()] = v;
      }
      return out;
    } catch {
      return {};
    }
  }, []);

  const openTypePromptModal = () => {
    const stored = loadTypePromptsFromStorage();
    const mergedTypes = [
      ...new Set([
        ...BOOK_VARIANT_QUESTION_TYPES,
        ...types,
        ...Object.keys(stored),
      ]),
    ].sort((a, b) => a.localeCompare(b, 'ko'));
    setTypePromptList(mergedTypes);
    const map: Record<string, string> = {};
    for (const t of mergedTypes) map[t] = stored[t] ?? '';
    setTypePromptMap(map);
    setTypePromptNewName('');
    setTypePromptModalOpen(true);
    if (types.length === 0) fetchMeta();
  };

  /** 한번에 먼저 생성: 부족한 문항만큼 Claude 초안 생성 후 자동 저장. 완료 시 검수 창으로 이동 */
  const runBatchCreateAll = async (sorted: QCountUnderRow[], textbook: string) => {
    const total = sorted.reduce((s, r) => s + r.shortBy, 0);
    if (total === 0) return;
    const stored = loadTypePromptsFromStorage();
    setBatchCreateError(null);
    setBatchCreatingAll(true);
    setBatchProgress({ current: 0, total, label: sorted[0]?.label ?? '', type: sorted[0]?.type ?? '' });
    setQCountOpen(false);
    setValidateOpen(false);
    let created = 0;
    let placeholderCount = 0;
    const errors: string[] = [];
    try {
      for (const row of sorted) {
        const typePrompt = (stored[row.type] ?? '').trim();
        for (let i = 0; i < row.shortBy; i++) {
          setBatchProgress({ current: created, total, label: row.label, type: row.type });
          const draftBody = {
            passage_id: row.passageId.trim(),
            textbook: textbook.trim(),
            source: (row.label || '').trim() || `${row.type} 변형`,
            type: row.type,
            userHint: '',
            ...(typePrompt ? { typePrompt } : {}),
            option_type: 'English',
          };
          let draftRes = await fetch('/api/admin/generated-questions/generate-draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(draftBody),
          });
          let draftData = await draftRes.json();
          if (draftRes.status === 422 && !draftData?.question_data) {
            await new Promise((r) => setTimeout(r, 1500));
            draftRes = await fetch('/api/admin/generated-questions/generate-draft', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify(draftBody),
            });
            draftData = await draftRes.json();
          }
          let qd: Record<string, unknown> | null = draftRes.ok && draftData?.question_data && typeof draftData.question_data === 'object' && !Array.isArray(draftData.question_data)
            ? (draftData.question_data as Record<string, unknown>)
            : null;
          if (!qd) {
            const nextNum = (draftData?.nextNum as number) ?? 1;
            qd = {
              순서: nextNum,
              Source: '',
              NumQuestion: nextNum,
              Category: row.type,
              Question: `[AI 초안 파싱 실패 — 검수에서 수정] ${row.label} ${row.type}`,
              Paragraph: '',
              Options: '',
              OptionType: 'English',
              CorrectAnswer: '',
              Explanation: '한번에 먼저 생성 시 AI 응답 JSON 파싱에 실패했습니다. 검수에서 수정해 주세요.',
            };
            placeholderCount++;
            errors.push(`${row.label} ${row.type}`);
          }
          const createRes = await fetch('/api/admin/generated-questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              textbook: textbook.trim(),
              passage_id: row.passageId.trim(),
              source: (row.label || '').trim() || `${row.type} 변형`,
              type: row.type,
              option_type: 'English',
              status: '대기',
              error_msg: qd?.Question?.toString().startsWith('[AI 초안') ? 'AI 파싱 실패(검수 필요)' : null,
              question_data: qd,
            }),
          });
          const createData = await createRes.json();
          if (!createRes.ok) {
            setBatchCreateError(createData?.error ?? '저장 실패');
            setBatchCreatingAll(false);
            setBatchProgress(null);
            return;
          }
          created++;
        }
      }
      setBatchCreatingAll(false);
      setBatchProgress(null);
      if (placeholderCount > 0) {
        setBatchCreateError(`${placeholderCount}건은 AI 파싱 실패로 플레이스홀더 저장됨. 검수에서 수정: ${errors.slice(0, 3).join(', ')}${errors.length > 3 ? ' 외' : ''}`);
      }
      setFilterTextbook(textbook.trim());
      setFilterStatus('대기');
      setPage(1);
      setShortageBatchFinishedCount(created);
      fetchList();
      fetchMeta();
      listSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      setBatchCreateError(e instanceof Error ? e.message : '오류 발생');
      setBatchCreatingAll(false);
      setBatchProgress(null);
    }
  };

  const saveTypePrompts = () => {
    const toSave: Record<string, string> = {};
    for (const t of typePromptList) {
      const v = (typePromptMap[t] ?? '').trim();
      if (v) toSave[t] = typePromptMap[t] ?? '';
    }
    try {
      localStorage.setItem(TYPE_VARIANT_PROMPTS_STORAGE, JSON.stringify(toSave));
    } catch {
      alert('저장에 실패했습니다.');
      return;
    }
    setTypePromptSavedFlash(true);
    window.setTimeout(() => setTypePromptSavedFlash(false), 2000);
  };

  const addTypePromptRow = () => {
    const name = typePromptNewName.trim();
    if (!name) return;
    if (typePromptList.includes(name)) {
      setTypePromptNewName('');
      return;
    }
    setTypePromptList((prev) => [...prev, name].sort((a, b) => a.localeCompare(b, 'ko')));
    setTypePromptMap((m) => ({ ...m, [name]: '' }));
    setTypePromptNewName('');
  };

  const openValidateModal = () => {
    setValidateOpen(true);
    setValidateData(null);
    setValidateError(null);
    setValidateExpanded({});
    if (types.length === 0) fetchMeta();
  };

  const openQCountModal = () => {
    setQCountOpen(true);
    setQCountData(null);
    setQCountError(null);
    if (textbooks.length === 0) fetchMeta();
    setQCountOrdersLoading(true);
    fetch('/api/admin/orders?limit=100', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const raw = Array.isArray(d.orders) ? d.orders : [];
        setQCountOrders(
          raw.map((o: Record<string, unknown>) => ({
            id: String(o.id ?? ''),
            orderNumber: o.orderNumber != null ? String(o.orderNumber) : null,
            createdAt:
              o.createdAt instanceof Date
                ? o.createdAt.toISOString()
                : typeof o.createdAt === 'string'
                  ? o.createdAt
                  : '',
            orderMetaFlow: typeof o.orderMetaFlow === 'string' ? o.orderMetaFlow : null,
            hasOrderMeta: !!o.hasOrderMeta,
          }))
        );
      })
      .catch(() => setQCountOrders([]))
      .finally(() => setQCountOrdersLoading(false));
  };

  const openVariationAnalysisModal = () => {
    setVariationAnalysisOpen(true);
    setVariationAnalysisData(null);
    setVariationAnalysisError(null);
    if (textbooks.length === 0 || types.length === 0) fetchMeta();
  };

  const openOptionsOverlapModal = () => {
    setOptionsOverlapOpen(true);
    setOptionsOverlapData(null);
    setOptionsOverlapError(null);
    if (textbooks.length === 0) fetchMeta();
  };

  const openExplanationApiModal = () => {
    setExplanationApiOpen(true);
    setExplanationApiData(null);
    setExplanationApiError(null);
    setExplanationApiLoading(true);
    const params = new URLSearchParams();
    if (filterTextbook) params.set('textbook', filterTextbook);
    if (filterType) params.set('type', filterType);
    fetch(`/api/admin/generated-questions/validate/explanation-api?${params}`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          setExplanationApiError(d.error || '검증 실패');
          return;
        }
        setExplanationApiData({
          filters: d.filters ?? { textbook: null, type: null },
          totalScanned: d.totalScanned ?? 0,
          totalMatched: d.totalMatched ?? 0,
          items: Array.isArray(d.items) ? d.items.map((it: { full?: string; snippet?: string }) => ({ ...it, full: it.full ?? it.snippet ?? '' })) : [],
          truncated: !!d.truncated,
        });
      })
      .catch(() => setExplanationApiError('네트워크 오류'))
      .finally(() => setExplanationApiLoading(false));
  };

  const runExplanationApiValidate = () => {
    setExplanationApiLoading(true);
    setExplanationApiError(null);
    setExplanationApiData(null);
    const params = new URLSearchParams();
    if (filterTextbook) params.set('textbook', filterTextbook);
    if (filterType) params.set('type', filterType);
    fetch(`/api/admin/generated-questions/validate/explanation-api?${params}`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          setExplanationApiError(d.error || '검증 실패');
          return;
        }
        setExplanationApiData({
          filters: d.filters ?? { textbook: null, type: null },
          totalScanned: d.totalScanned ?? 0,
          totalMatched: d.totalMatched ?? 0,
          items: Array.isArray(d.items) ? d.items.map((it: { full?: string; snippet?: string }) => ({ ...it, full: it.full ?? it.snippet ?? '' })) : [],
          truncated: !!d.truncated,
        });
      })
      .catch(() => setExplanationApiError('네트워크 오류'))
      .finally(() => setExplanationApiLoading(false));
  };

  const openOptionsApiModal = () => {
    setOptionsApiOpen(true);
    setOptionsApiData(null);
    setOptionsApiError(null);
    setOptionsApiLoading(true);
    const params = new URLSearchParams();
    if (filterTextbook) params.set('textbook', filterTextbook);
    if (filterType) params.set('type', filterType);
    fetch(`/api/admin/generated-questions/validate/options-api?${params}`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          setOptionsApiError(d.error || '검증 실패');
          return;
        }
        setOptionsApiData({
          filters: d.filters ?? { textbook: null, type: null },
          totalScanned: d.totalScanned ?? 0,
          totalMatched: d.totalMatched ?? 0,
          items: Array.isArray(d.items) ? d.items.map((it: { full?: string; snippet?: string }) => ({ ...it, full: it.full ?? it.snippet ?? '' })) : [],
          truncated: !!d.truncated,
        });
      })
      .catch(() => setOptionsApiError('네트워크 오류'))
      .finally(() => setOptionsApiLoading(false));
  };

  const runOptionsApiValidate = () => {
    setOptionsApiLoading(true);
    setOptionsApiError(null);
    setOptionsApiData(null);
    const params = new URLSearchParams();
    if (filterTextbook) params.set('textbook', filterTextbook);
    if (filterType) params.set('type', filterType);
    fetch(`/api/admin/generated-questions/validate/options-api?${params}`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          setOptionsApiError(d.error || '검증 실패');
          return;
        }
        setOptionsApiData({
          filters: d.filters ?? { textbook: null, type: null },
          totalScanned: d.totalScanned ?? 0,
          totalMatched: d.totalMatched ?? 0,
          items: Array.isArray(d.items) ? d.items.map((it: { full?: string; snippet?: string }) => ({ ...it, full: it.full ?? it.snippet ?? '' })) : [],
          truncated: !!d.truncated,
        });
      })
      .catch(() => setOptionsApiError('네트워크 오류'))
      .finally(() => setOptionsApiLoading(false));
  };

  const runOptionsOverlapValidate = async () => {
    setOptionsOverlapLoading(true);
    setOptionsOverlapError(null);
    setOptionsOverlapData(null);
    try {
      const params = new URLSearchParams();
      if (filterTextbook) params.set('textbook', filterTextbook);
      const res = await fetch(
        `/api/admin/generated-questions/validate/options-overlap?${params}`,
        { credentials: 'include' }
      );
      const d = await res.json();
      if (!res.ok) {
        setOptionsOverlapError(d.error || '선택지 데이터 검증 실패');
        return;
      }
      setOptionsOverlapData({
        filters: d.filters ?? { textbook: null, category: null },
        totalScanned: d.totalScanned ?? 0,
        totalGroups: d.totalGroups ?? 0,
        groups: Array.isArray(d.groups) ? d.groups : [],
      });
    } catch {
      setOptionsOverlapError('네트워크 오류');
    } finally {
      setOptionsOverlapLoading(false);
    }
  };

  const runVariationAnalysis = async () => {
    setVariationAnalysisLoading(true);
    setVariationAnalysisError(null);
    setVariationAnalysisData(null);
    try {
      const params = new URLSearchParams();
      if (filterTextbook) params.set('textbook', filterTextbook);
      if (filterType) params.set('type', filterType);
      params.set('limit', '3000');
      const res = await fetch(
        `/api/admin/generated-questions/analyze/variation?${params}`,
        { credentials: 'include' }
      );
      const d = await res.json();
      if (!res.ok) {
        setVariationAnalysisError(d.error || '변형도 분석 실패');
        return;
      }
      setVariationAnalysisData({
        totalScanned: d.totalScanned ?? 0,
        filters: d.filters ?? { textbook: null, type: null },
        byType: d.byType && typeof d.byType === 'object' ? d.byType : {},
      });
    } catch {
      setVariationAnalysisError('네트워크 오류');
    } finally {
      setVariationAnalysisLoading(false);
    }
  };

  const runQuestionCountValidate = async () => {
    if (qCountScope === 'order') {
      if (!qCountOrderId.trim()) {
        setQCountError('주문을 선택해 주세요.');
        return;
      }
    } else if (!filterTextbook.trim()) {
      setQCountError('교재를 선택해 주세요.');
      return;
    }
    setQCountLoading(true);
    setQCountError(null);
    setQCountData(null);
    try {
      const params = new URLSearchParams();
      if (qCountScope === 'order') {
        params.set('orderId', qCountOrderId.trim());
      } else {
        params.set('textbook', filterTextbook.trim());
        params.set('requiredPerType', String(DEFAULT_QUESTIONS_PER_VARIANT_TYPE));
      }
      const res = await fetch(
        `/api/admin/generated-questions/validate/question-counts?${params}`,
        { credentials: 'include' }
      );
      const d = await res.json();
      if (!res.ok) {
        setQCountError(d.error || '검증 요청 실패');
        return;
      }
      const ord = d.order;
      setQCountData({
        scope: d.scope === 'order' ? 'order' : 'textbook',
        textbook: String(d.textbook ?? ''),
        requiredPerType: Number(d.requiredPerType) || DEFAULT_QUESTIONS_PER_VARIANT_TYPE,
        passageCount: Number(d.passageCount) || 0,
        standardTypes: Array.isArray(d.standardTypes) ? d.standardTypes : [...BOOK_VARIANT_QUESTION_TYPES],
        typesChecked: Array.isArray(d.typesChecked) ? d.typesChecked : [...BOOK_VARIANT_QUESTION_TYPES],
        noQuestionsTotal: Number(d.noQuestionsTotal) || 0,
        underfilledTotal: Number(d.underfilledTotal) || 0,
        noQuestionsTruncated: !!d.noQuestionsTruncated,
        underfilledTruncated: !!d.underfilledTruncated,
        noQuestions: Array.isArray(d.noQuestions) ? d.noQuestions : [],
        underfilled: Array.isArray(d.underfilled) ? d.underfilled : [],
        message: typeof d.message === 'string' ? d.message : undefined,
        orderLessonsRequested:
          typeof d.orderLessonsRequested === 'number' ? d.orderLessonsRequested : undefined,
        orderLessonsMatched:
          typeof d.orderLessonsMatched === 'number' ? d.orderLessonsMatched : undefined,
        lessonsWithoutPassage: Array.isArray(d.lessonsWithoutPassage)
          ? (d.lessonsWithoutPassage as string[])
          : undefined,
        order:
          ord && typeof ord === 'object' && ord !== null
            ? {
                id: String((ord as { id?: unknown }).id ?? ''),
                orderNumber:
                  (ord as { orderNumber?: unknown }).orderNumber != null
                    ? String((ord as { orderNumber?: unknown }).orderNumber)
                    : null,
                flow: String((ord as { flow?: unknown }).flow ?? ''),
              }
            : null,
      });
    } catch {
      setQCountError('네트워크 오류');
    } finally {
      setQCountLoading(false);
    }
  };

  const runOptionsDuplicateValidate = async () => {
    setValidateLoading(true);
    setValidateError(null);
    setValidateData(null);
    setValidateExpanded({});
    try {
      const params = new URLSearchParams();
      if (filterTextbook) params.set('textbook', filterTextbook);
      if (filterType) params.set('type', filterType);
      validateExcludedTypes.forEach((t) => params.append('exclude_type', t));
      const res = await fetch(
        `/api/admin/generated-questions/validate/duplicate-options?${params}`,
        { credentials: 'include' }
      );
      const d = await res.json();
      if (!res.ok) {
        setValidateError(d.error || '검증 요청 실패');
        return;
      }
      const rawGroups: DuplicateGroup[] = Array.isArray(d.groups)
        ? d.groups.map((g: Record<string, unknown>) => ({
            questionType: String(g.questionType ?? '—'),
            optionsFull: String(g.optionsFull ?? ''),
            optionsPreview: String(g.optionsPreview ?? ''),
            duplicateCount: Number(g.duplicateCount) || 0,
            sampleItems: Array.isArray(g.sampleItems) ? g.sampleItems : [],
            truncated: !!g.truncated,
          }))
        : [];
      setValidateData({
        scannedDocuments: d.scannedDocuments ?? 0,
        duplicateGroupCount: d.duplicateGroupCount ?? 0,
        summaryByType:
          d.summaryByType && typeof d.summaryByType === 'object' ? d.summaryByType : {},
        excludedTypes: Array.isArray(d.excludedTypes) ? d.excludedTypes : [],
        groups: rawGroups,
        filters: d.filters ?? { textbook: null, type: null },
      });
    } catch {
      setValidateError('네트워크 오류');
    } finally {
      setValidateLoading(false);
    }
  };

  const openEditFromValidate = (id: string) => {
    setValidateOpen(false);
    openEdit(id);
  };

  const handleRegenerateOptionsOnly = async (id: string) => {
    if (!confirm('이 문항의 선택지만 Claude로 새로 생성해 중복을 해소할까요?\n지문·발문·정답 의미는 유지됩니다.')) return;
    setRegenerateOptionsLoading(id);
    try {
      const res = await fetch(`/api/admin/generated-questions/${id}/regenerate-options`, {
        method: 'POST',
        credentials: 'include',
      });
      const d = await res.json();
      if (!res.ok) {
        alert(d.error || '선택지 재생성 실패');
        return;
      }
      alert('선택지가 재생성되었습니다.');
      await runOptionsDuplicateValidate();
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setRegenerateOptionsLoading(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const questionPreview = (row: Row) => row.question_data?.Question || '—';

  if (loadingAuth || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin w-10 h-10 border-4 border-slate-600 border-t-violet-400 rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="border-b border-slate-700 bg-slate-800/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">변형문제 관리</h1>
            <p className="text-slate-400 text-sm mt-0.5">MongoDB · gomijoshua.generated_questions</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5" role="group" aria-label="표 너비">
              <span className="text-slate-500 text-xs hidden sm:inline">표</span>
              <div className="flex rounded-lg border border-slate-600 overflow-hidden text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setTableDensityAndLoad('narrow')}
                  className={`px-3 py-2 transition-colors ${
                    tableDensity === 'narrow'
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  좁게
                </button>
                <button
                  type="button"
                  onClick={() => setTableDensityAndLoad('wide')}
                  className={`px-3 py-2 border-l border-slate-600 transition-colors ${
                    tableDensity === 'wide'
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  넓게
                </button>
              </div>
            </div>
            <Link
              href="/admin"
              className="text-slate-300 hover:text-white text-sm px-3 py-2 rounded-lg border border-slate-600 hover:border-slate-500"
            >
              ← 관리자 홈
            </Link>
            <Link
              href="/admin/passages"
              className="text-slate-300 hover:text-white text-sm px-3 py-2 rounded-lg border border-slate-600 hover:border-slate-500"
            >
              원문 관리
            </Link>
            <button
              type="button"
              onClick={openCreate}
              className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold px-4 py-2 rounded-lg"
            >
              + 새 변형문제
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 pt-4">
        <div className="rounded-xl border border-cyan-500/35 bg-cyan-950/25 px-4 py-3 text-sm">
          <p className="font-semibold text-cyan-200 mb-1">
            제작 기준 · 동일 지문에서 유형(type)당 {DEFAULT_QUESTIONS_PER_VARIANT_TYPE}문항
          </p>
          <p className="text-cyan-100/85 text-xs leading-relaxed">
            같은 <strong className="text-slate-200">교재</strong>·<strong className="text-slate-200">강(출처)</strong>·
            <strong className="text-slate-200">원문(passage_id)</strong> 조합에서, 예를 들어 type이{' '}
            <span className="text-violet-300">빈칸</span>이면 <strong>{DEFAULT_QUESTIONS_PER_VARIANT_TYPE}건의 행</strong>(순서·NumQuestion
            1~{DEFAULT_QUESTIONS_PER_VARIANT_TYPE})이 되어야 합니다. <strong>주제·어법·순서</strong> 등{' '}
            <strong>각 유형마다 동일하게 {DEFAULT_QUESTIONS_PER_VARIANT_TYPE}문항</strong>이 기준입니다. 고객 변형 주문의 기본
            &quot;유형별 문항 수&quot;도 {DEFAULT_QUESTIONS_PER_VARIANT_TYPE}으로 통일했습니다.
          </p>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 mb-6 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">교재</label>
            <select
              value={filterTextbook}
              onChange={(e) => {
                setFilterTextbook(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm min-w-[200px] text-white"
            >
              <option value="">전체</option>
              {textbooks.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">유형</label>
            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm min-w-[120px] text-white"
            >
              <option value="">전체</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">상태</label>
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm min-w-[100px] text-white"
            >
              <option value="">전체</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">passage_id</label>
            <input
              value={filterPassageId}
              onChange={(e) => {
                setFilterPassageId(e.target.value);
                setPage(1);
              }}
              placeholder="원문 ObjectId"
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 w-48 text-white font-mono text-xs placeholder:text-slate-500"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs text-slate-400 mb-1">검색 (출처·발문·지문)</label>
            <input
              value={filterQ}
              onChange={(e) => {
                setFilterQ(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
            />
          </div>
          <button
            type="button"
            onClick={() => fetchList()}
            className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm font-medium"
          >
            새로고침
          </button>
        </div>

        <div className="mb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-slate-400 text-sm">
              총 <span className="text-white font-semibold">{total}</span>건 · {page}/{totalPages}페이지
            </p>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button
                type="button"
                disabled={variationAnalysisLoading}
                onClick={openVariationAnalysisModal}
                className="shrink-0 bg-teal-900/80 hover:bg-teal-800 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-teal-100 border border-teal-500/40"
                title="원문(passages) 대비 지문 변형도 유형별 평균·구간·분포"
              >
                변형도 분석
              </button>
              <button
                type="button"
                disabled={qCountLoading}
                onClick={openQCountModal}
                className="shrink-0 bg-cyan-900/80 hover:bg-cyan-800 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-cyan-100 border border-cyan-500/40"
                title="MongoDB passages(원문) 대비 변형문 유무·표준 11유형별 문항 수(기본 3) 검증"
              >
                문제수 검증
              </button>
              <button
                type="button"
                disabled={validateLoading}
                onClick={openValidateModal}
                className="shrink-0 bg-amber-800/90 hover:bg-amber-700 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-amber-100 border border-amber-500/40"
                title="표의 Options 열 기준 · 모달에서 제외 유형 선택 후 검증"
              >
                Options 중복 검증
              </button>
              <button
                type="button"
                disabled={optionsOverlapLoading}
                onClick={openOptionsOverlapModal}
                className="shrink-0 bg-rose-900/80 hover:bg-rose-800 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-rose-100 border border-rose-500/40"
                title="교재·강·category 동일 그룹 내 선택지 상호 일치도 · 내보낼 때 겹침 적은 문항 우선 추천"
              >
                선택지 데이터 검증
              </button>
              <button
                type="button"
                disabled={explanationApiLoading}
                onClick={openExplanationApiModal}
                className="shrink-0 bg-teal-900/80 hover:bg-teal-800 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-teal-100 border border-teal-500/40"
                title="Explanation 열에 'API' 텍스트 포함 여부 검증"
              >
              Explanation &apos;API&apos; 검증
            </button>
              <button
                type="button"
                disabled={optionsApiLoading}
                onClick={openOptionsApiModal}
                className="shrink-0 bg-amber-900/80 hover:bg-amber-800 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-amber-100 border border-amber-500/40"
                title="Options 열에 'API' 텍스트 포함 여부 검증"
              >
                Options &apos;API&apos; 검증
              </button>
              <button
                type="button"
                onClick={() => setExtraMenuExpanded((e) => !e)}
                className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium border border-slate-500/60 bg-slate-800/80 text-slate-300 hover:bg-slate-700/80 hover:text-slate-200 transition-colors"
                title={extraMenuExpanded ? '메뉴 접기' : '메뉴 펼치기'}
              >
                {extraMenuExpanded ? '접기' : '메뉴'}
                <span
                  className={`inline-block transition-transform duration-300 ease-out ${extraMenuExpanded ? 'rotate-180' : ''}`}
                  aria-hidden
                >
                  ▼
                </span>
              </button>
            </div>
          </div>
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${extraMenuExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
          >
            <div className="min-h-0 overflow-hidden">
              <div
                className={`flex flex-wrap items-center gap-2 sm:gap-3 pt-2 border-t border-slate-700/60 mt-2 transition-opacity duration-300 ease-out ${extraMenuExpanded ? 'opacity-100' : 'opacity-0'}`}
              >
                <button
                  type="button"
                  onClick={openTypePromptModal}
                  className="shrink-0 bg-violet-900/80 hover:bg-violet-800 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-violet-100 border border-violet-500/40"
                  title="「+ 같은유형」AI 초안 시 유형별로 붙는 지침 (이 브라우저에 저장)"
                >
                  유형별 AI 프롬프트
                </button>
                <span className="hidden sm:inline h-4 w-px bg-slate-600" aria-hidden />
                <p className="text-slate-500 text-xs flex items-center gap-2">
                  <span className="hidden md:inline">헤더 오른쪽 가장자리를 드래그하면 열 너비 조절</span>
                  <button
                    type="button"
                    onClick={resetColWidths}
                    className="text-violet-400 hover:text-violet-300 underline text-xs whitespace-nowrap"
                  >
                    열 너비 초기화
                  </button>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div ref={listSectionRef}>
        {shortageBatchFinishedCount != null && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-cyan-900/40 border border-cyan-600/60 px-4 py-2">
            <span className="text-cyan-200 text-sm">
              부족 문항 {shortageBatchFinishedCount}건 생성 완료. 아래 목록에서 검수하세요.
            </span>
            <button
              type="button"
              onClick={() => setShortageBatchFinishedCount(null)}
              className="shrink-0 bg-cyan-600 hover:bg-cyan-500 text-white font-medium px-3 py-1.5 rounded-lg text-sm"
            >
              닫기
            </button>
          </div>
        )}
        {goToRowId && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-emerald-900/40 border border-emerald-600/60 px-4 py-2">
            <span className="text-emerald-200 text-sm">저장되었습니다.</span>
            <button
              type="button"
              onClick={() => {
                document.getElementById(`row-${goToRowId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                setGoToRowId(null);
              }}
              className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-3 py-1.5 rounded-lg text-sm"
            >
              문제보러가기
            </button>
          </div>
        )}

        <div className="border border-slate-700 rounded-xl overflow-hidden bg-slate-800/30">
          <div className="overflow-x-auto">
            <table className="text-sm table-fixed border-collapse" style={{ width: colWidths.reduce((a, b) => a + b, 0) }}>
              <thead>
                <tr className="bg-slate-800 text-left text-slate-300 border-b border-slate-700">
                  {[
                    { label: '작업', i: 0, cls: 'text-left' },
                    { label: '교재', i: 1 },
                    { label: '유형 (type)', i: 2, cls: 'text-violet-300/90' },
                    { label: 'Paragraph (변형도)', i: 3 },
                    { label: 'Options', i: 4 },
                    { label: 'Explanation', i: 5 },
                    { label: '출처', i: 6 },
                    { label: 'passage', i: 7, cls: 'font-mono text-xs' },
                    { label: '발문', i: 8 },
                  ].map(({ label, i, cls }) => (
                    <th
                      key={`gq-col-${i}`}
                      className={`relative px-2 py-3 font-medium align-top select-none ${cls || ''}`}
                      style={{
                        width: colWidths[i],
                        minWidth: colWidths[i],
                        maxWidth: colWidths[i],
                        boxSizing: 'border-box',
                      }}
                    >
                      <span className="block truncate pr-3" title={label}>
                        {label}
                      </span>
                      <div
                        role="separator"
                        aria-hidden
                        className="absolute top-0 right-0 h-full w-2 cursor-col-resize z-10 flex items-center justify-end pr-0"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          startColResize(i, e.clientX);
                        }}
                      >
                        <span className="h-[60%] w-px bg-slate-600 hover:bg-violet-500 hover:w-0.5 block" />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listLoading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                      불러오는 중…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                      데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  items.map((row) => {
                    const qd = row.question_data || {};
                    const para = typeof qd.Paragraph === 'string' ? qd.Paragraph : '';
                    const opt = typeof qd.Options === 'string' ? qd.Options : '';
                    const expl = typeof qd.Explanation === 'string' ? qd.Explanation : '';
                    const cat = (typeof qd.Category === 'string' ? qd.Category : '').trim();
                    const typeStr = (row.type || '').trim();
                    const showCategoryNote = cat && cat !== typeStr;
                    return (
                    <tr key={row._id} id={`row-${row._id}`} className="border-b border-slate-700/80 hover:bg-slate-800/40">
                      <td
                        className="px-2 py-2 align-top border-r border-slate-700/30"
                        style={{ width: colWidths[0], maxWidth: colWidths[0] }}
                      >
                        <div className="flex flex-col gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSiblingModalId(row._id);
                              setSiblingHint('');
                              setSiblingErr(null);
                            }}
                            className="text-left text-sky-400 hover:text-sky-300 text-xs font-bold"
                            title="같은 지문·같은 유형으로 새 문항"
                          >
                            ＋ 같은유형
                          </button>
                          <button
                            type="button"
                            onClick={() => openSolve(row._id)}
                            className="text-left text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                          >
                            풀기
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(row._id)}
                            className="text-left text-violet-400 hover:text-violet-300 text-xs font-medium"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(row._id)}
                            className="text-left text-red-400 hover:text-red-300 text-xs font-medium"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                      <td
                        className="px-2 py-2 text-slate-200 align-top truncate border-r border-slate-700/30"
                        style={{ width: colWidths[1], maxWidth: colWidths[1] }}
                        title={row.textbook}
                      >
                        {row.textbook}
                      </td>
                      <td
                        className="px-2 py-2 align-top border-r border-slate-700/30 overflow-hidden"
                        style={{ width: colWidths[2], maxWidth: colWidths[2] }}
                        title={showCategoryNote ? `${typeStr} · Category: ${cat}` : typeStr}
                      >
                        <span className="text-violet-300 font-medium break-words">{typeStr || '—'}</span>
                        {showCategoryNote && (
                          <div className="text-[11px] text-amber-200/80 mt-1 leading-snug border-t border-slate-600/50 pt-1">
                            <span className="text-slate-500">Category: </span>
                            {cat}
                          </div>
                        )}
                      </td>
                      <td
                        className="px-2 py-2 text-slate-300 align-top border-r border-slate-700/30 text-[13px] leading-snug select-text"
                        style={{ width: colWidths[3], maxWidth: colWidths[3] }}
                        title={para.length > 200 ? para.slice(0, 200) + '…' : para || undefined}
                      >
                        <div className="flex flex-col gap-1 select-text">
                          {row.variation_pct != null && (
                            <span className="text-[11px] text-slate-500 font-medium tabular-nums shrink-0" title="원문 대비 지문 변형도 (0=동일, 100=완전 다름)">
                              변형도 {row.variation_pct}%
                            </span>
                          )}
                          <div className="max-h-52 overflow-y-auto break-words pr-1 text-slate-200/95 select-text">
                            <ParagraphWithUnderline text={para} />
                          </div>
                        </div>
                      </td>
                      <td
                        className="px-2 py-2 text-slate-300 align-top border-r border-slate-700/30 text-[13px] leading-snug select-text"
                        style={{ width: colWidths[4], maxWidth: colWidths[4] }}
                      >
                        <div className="max-h-52 overflow-y-auto break-words whitespace-pre-wrap pr-1 select-text">
                          {opt || '—'}
                        </div>
                      </td>
                      <td
                        className="px-2 py-2 text-slate-300 align-top border-r border-slate-700/30 text-[13px] leading-snug select-text"
                        style={{ width: colWidths[5], maxWidth: colWidths[5] }}
                      >
                        <div className="max-h-52 overflow-y-auto break-words whitespace-pre-wrap pr-1 select-text">
                          {expl || '—'}
                        </div>
                      </td>
                      <td
                        className="px-2 py-2 text-slate-400 align-top truncate border-r border-slate-700/30"
                        style={{ width: colWidths[6], maxWidth: colWidths[6] }}
                        title={row.source}
                      >
                        {row.source}
                      </td>
                      <td
                        className="px-2 py-2 text-slate-500 align-top font-mono text-[10px] truncate border-r border-slate-700/30"
                        style={{ width: colWidths[7], maxWidth: colWidths[7] }}
                        title={row.passage_id || ''}
                      >
                        {row.passage_id ? `${row.passage_id.slice(0, 8)}…` : '—'}
                      </td>
                      <td
                        className="px-2 py-2 text-slate-400 align-top border-r border-slate-700/30 overflow-hidden"
                        style={{ width: colWidths[8], maxWidth: colWidths[8] }}
                      >
                        <span className="line-clamp-3 break-words" title={questionPreview(row)}>
                          {questionPreview(row)}
                        </span>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-6">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-600 disabled:opacity-40"
            >
              이전
            </button>
            <span className="px-4 py-2 text-slate-400">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-600 disabled:opacity-40"
            >
              다음
            </button>
          </div>
        )}
        </div>
      </main>

      {variationAnalysisOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
          <div className="bg-slate-800 border border-teal-700/40 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-600 flex justify-between items-center shrink-0 bg-slate-800/95">
              <div>
                <h2 className="text-lg font-bold text-teal-200">변형도 분석</h2>
                <p className="text-xs text-slate-400 mt-1">
                  원문(passages) 대비 지문(Paragraph) 변형도를 유형별로 집계합니다. 상단 목록의 <strong className="text-slate-300">교재·유형</strong> 필터와 동일하게 적용되며, 최대 3,000건을 스캔합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVariationAnalysisOpen(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-2"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              {!variationAnalysisData && !variationAnalysisLoading && (
                <div className="mb-4 p-4 rounded-xl border-2 border-teal-800/50 bg-slate-900/60 space-y-4">
                  <p className="text-sm text-slate-300">
                    현재 필터: <strong className="text-teal-200">{filterTextbook || '전체 교재'}</strong>
                    {filterType ? ` / ${filterType}` : ' / 전체 유형'}
                  </p>
                  <button
                    type="button"
                    disabled={variationAnalysisLoading}
                    onClick={() => void runVariationAnalysis()}
                    className="px-6 py-3 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-bold text-sm shadow-lg"
                  >
                    분석 실행
                  </button>
                </div>
              )}
              {variationAnalysisLoading && (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <span className="animate-pulse">변형도 집계 중…</span>
                </div>
              )}
              {variationAnalysisError && (
                <div className="mb-4 p-3 rounded-lg bg-red-950/40 border border-red-800/50">
                  <p className="text-red-300 text-sm">{variationAnalysisError}</p>
                </div>
              )}
              {variationAnalysisData && !variationAnalysisLoading && (
                <>
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <p className="text-sm text-slate-300">
                      총 <strong className="text-white">{variationAnalysisData.totalScanned.toLocaleString()}</strong>건 분석
                      {variationAnalysisData.filters.textbook && (
                        <> · 교재: <strong className="text-teal-200">{variationAnalysisData.filters.textbook}</strong></>
                      )}
                      {variationAnalysisData.filters.type && (
                        <> · 유형: <strong className="text-teal-200">{variationAnalysisData.filters.type}</strong></>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => void runVariationAnalysis()}
                      className="text-sm px-3 py-2 rounded-lg border border-teal-600/60 text-teal-200 hover:bg-teal-900/50"
                    >
                      다시 분석
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-600">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-800 text-left text-slate-300 border-b border-slate-600">
                          <th className="px-3 py-2 font-semibold">유형</th>
                          <th className="px-3 py-2 font-semibold text-right">문항 수</th>
                          <th className="px-3 py-2 font-semibold text-right">평균 변형도</th>
                          <th className="px-3 py-2 font-semibold text-right">최소</th>
                          <th className="px-3 py-2 font-semibold text-right">최대</th>
                          {Array.from({ length: 10 }, (_, i) => (
                            <th key={i} className="px-2 py-2 font-medium text-slate-500 text-xs text-right" title={i === 9 ? '90~100%' : `${i * 10}~${i * 10 + 9}%`}>
                              {i === 9 ? '90~100%' : `${i * 10}~${i * 10 + 9}%`}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(variationAnalysisData.byType)
                          .sort(([a], [b]) => (a === '—' ? 1 : b === '—' ? -1 : a.localeCompare(b, 'ko')))
                          .map(([typeKey, stats]) => (
                            <tr key={typeKey} className="border-b border-slate-700/50 hover:bg-slate-800/40">
                              <td className="px-3 py-2 text-teal-200 font-medium">{typeKey}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{stats.count.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-white">{stats.avg}%</td>
                              <td className="px-3 py-2 text-right tabular-nums text-slate-400">{stats.min}%</td>
                              <td className="px-3 py-2 text-right tabular-nums text-slate-400">{stats.max}%</td>
                              {stats.distribution.map((n, i) => (
                                <td key={i} className="px-2 py-2 text-right tabular-nums text-slate-400 text-xs">
                                  {n > 0 ? n : '—'}
                                </td>
                              ))}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {optionsOverlapOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
          <div className="bg-slate-800 border border-rose-700/40 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-600 flex justify-between items-center shrink-0 bg-slate-800/95">
              <div>
                <h2 className="text-lg font-bold text-rose-200">선택지 데이터 검증</h2>
                <p className="text-xs text-slate-400 mt-1">
                  <strong className="text-slate-300">교재 · 강 번호(출처 첫 토큰) · category</strong>가 같은 문항끼리 그룹화한 뒤,
                  동그라미번호(①②③④⑤)로 나뉜 선택지가 그룹 내 다른 문항과 얼마나 겹치는지 <strong className="text-rose-200">상호 일치도</strong>로 분석합니다.
                  내보낼 때 <strong className="text-emerald-300">일치도가 낮은 문항</strong>을 우선 선택하면 선택지 겹침을 줄일 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOptionsOverlapOpen(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-2"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              {!optionsOverlapData && !optionsOverlapLoading && (
                <div className="mb-4 p-4 rounded-xl border-2 border-rose-800/50 bg-slate-900/60 space-y-4">
                  <p className="text-sm text-slate-300">
                    현재 필터: <strong className="text-rose-200">{filterTextbook || '전체 교재'}</strong>
                  </p>
                  <button
                    type="button"
                    disabled={optionsOverlapLoading}
                    onClick={() => void runOptionsOverlapValidate()}
                    className="px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-sm shadow-lg"
                  >
                    검증 실행
                  </button>
                </div>
              )}
              {optionsOverlapLoading && (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <span className="animate-pulse">선택지 상호 일치도 분석 중…</span>
                </div>
              )}
              {optionsOverlapError && (
                <div className="mb-4 p-3 rounded-lg bg-red-950/40 border border-red-800/50">
                  <p className="text-red-300 text-sm">{optionsOverlapError}</p>
                </div>
              )}
              {optionsOverlapData && !optionsOverlapLoading && (
                <>
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <p className="text-sm text-slate-300">
                      총 <strong className="text-white">{optionsOverlapData.totalScanned.toLocaleString()}</strong>건 스캔 ·{' '}
                      <strong className="text-rose-200">{optionsOverlapData.totalGroups}</strong>개 그룹 (동일 교재·강·category, 2문항 이상)
                      {optionsOverlapData.filters.textbook && (
                        <> · 교재: <strong className="text-rose-200">{optionsOverlapData.filters.textbook}</strong></>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => void runOptionsOverlapValidate()}
                      className="text-sm px-3 py-2 rounded-lg border border-rose-600/60 text-rose-200 hover:bg-rose-900/50"
                    >
                      다시 검증
                    </button>
                  </div>
                  {(() => {
                    const uniqueCategories = [...new Set(optionsOverlapData.groups.map((g) => g.category))].sort((a, b) => a.localeCompare(b, 'ko'));
                    const visibleGroups = optionsOverlapData.groups.filter((grp) => !optionsOverlapExcludedCategories.includes(grp.category));
                    const hiddenCount = optionsOverlapData.groups.length - visibleGroups.length;
                    return (
                      <>
                        {uniqueCategories.length > 0 && (
                          <div className="mb-4 p-3 rounded-xl border border-rose-800/50 bg-slate-900/60">
                            <h3 className="text-sm font-bold text-rose-200 mb-2">검증 결과에서 숨길 category</h3>
                            <p className="text-xs text-slate-400 mb-2">체크한 category는 아래 목록에 표시되지 않습니다.</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              {uniqueCategories.map((cat) => (
                                <label key={cat} className="inline-flex items-center gap-2 cursor-pointer text-slate-200 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={optionsOverlapExcludedCategories.includes(cat)}
                                    onChange={() => {
                                      setOptionsOverlapExcludedCategories((prev) =>
                                        prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
                                      );
                                    }}
                                    className="rounded border-slate-500 text-rose-500"
                                  />
                                  <span className={optionsOverlapExcludedCategories.includes(cat) ? 'text-slate-500 line-through' : ''}>{cat}</span>
                                </label>
                              ))}
                            </div>
                            {hiddenCount > 0 && (
                              <p className="text-xs text-slate-500 mt-2">현재 {hiddenCount}개 그룹 숨김 · {visibleGroups.length}개 그룹 표시</p>
                            )}
                          </div>
                        )}
                        <div className="space-y-6">
                          {visibleGroups.map((grp, gIdx) => (
                      <div key={`${grp.textbook}-${grp.lessonKey}-${grp.category}-${gIdx}`} className="rounded-xl border border-slate-600 bg-slate-900/50 overflow-hidden">
                        <div className="px-4 py-2 bg-rose-950/40 border-b border-slate-600 flex flex-wrap items-center gap-2">
                          <span className="font-bold text-rose-200">{grp.textbook}</span>
                          <span className="text-slate-500">·</span>
                          <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-300 text-xs font-mono">{grp.lessonKey}</span>
                          <span className="text-slate-500">·</span>
                          <span className="px-2 py-0.5 rounded bg-violet-900/60 text-violet-200 text-xs">{grp.category}</span>
                          <span className="text-slate-500 text-xs">({grp.itemCount}문항)</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-slate-500 border-b border-slate-700">
                                <th className="px-3 py-2">출처</th>
                                <th className="px-3 py-2">유형</th>
                                <th className="px-3 py-2 text-right">평균 상호 일치도</th>
                                <th className="px-3 py-2 w-20">내보낼 때</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...grp.items]
                                .map((it, idx) => ({ ...it, idx }))
                                .sort((a, b) => a.avgOverlapWithOthers - b.avgOverlapWithOthers)
                                .map((it) => (
                                  <tr key={it.id} className="border-b border-slate-700/50 hover:bg-slate-800/40">
                                    <td className="px-3 py-1.5 text-slate-300 font-mono">{it.source}</td>
                                    <td className="px-3 py-1.5 text-violet-300">{it.type}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums">
                                      <span className={it.avgOverlapWithOthers <= 20 ? 'text-emerald-400 font-semibold' : it.avgOverlapWithOthers <= 50 ? 'text-amber-400' : 'text-rose-400'}>
                                        {it.avgOverlapWithOthers}%
                                      </span>
                                    </td>
                                    <td className="px-3 py-1.5 text-slate-500 text-[11px]">
                                      {it.avgOverlapWithOthers <= 20 ? '우선 추천' : it.avgOverlapWithOthers <= 50 ? '보통' : '겹침 많음'}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                        </div>
                      </>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {explanationApiOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
          <div className="bg-slate-800 border border-teal-700/40 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-600 flex justify-between items-center shrink-0 bg-slate-800/95">
              <div>
                <h2 className="text-lg font-bold text-teal-200">Explanation &apos;API&apos; 검증</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Explanation 열에 <strong className="text-teal-300">&apos;API&apos;</strong> 텍스트가 포함된 문항만 표시합니다. 상단 교재·유형 필터 적용.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExplanationApiOpen(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-2"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              {explanationApiLoading && !explanationApiData && (
                <div className="flex items-center justify-center gap-2 py-12 text-teal-300">
                  <span className="inline-block w-6 h-6 border-2 border-teal-500/50 border-t-teal-300 rounded-full animate-spin" />
                  검증 중…
                </div>
              )}
              {explanationApiError && (
                <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-800/50 text-red-300 text-sm">
                  {explanationApiError}
                </div>
              )}
              {explanationApiData && !explanationApiLoading && (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-slate-300">
                      <strong className="text-teal-200">Explanation에 &apos;API&apos; 포함</strong>:{' '}
                      <strong className="text-white">{explanationApiData.totalMatched.toLocaleString()}</strong>건
                      {explanationApiData.filters.textbook && (
                        <> · 교재: <strong className="text-teal-200">{explanationApiData.filters.textbook}</strong></>
                      )}
                      {explanationApiData.filters.type && (
                        <> · 유형: <strong className="text-teal-200">{explanationApiData.filters.type}</strong></>
                      )}
                      {explanationApiData.truncated && (
                        <span className="ml-2 text-amber-400 text-xs">(최대 {explanationApiData.items.length}건만 표시)</span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={runExplanationApiValidate}
                      className="text-xs px-3 py-1.5 rounded-lg bg-teal-800/80 hover:bg-teal-700 text-teal-200"
                    >
                      다시 검증
                    </button>
                  </div>
                  {explanationApiData.totalMatched === 0 ? (
                    <p className="text-emerald-400/90 text-sm py-4">해당 없음 — 선택한 필터에서 Explanation에 &apos;API&apos;가 포함된 문항이 없습니다.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-600 max-h-[50vh] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-900 z-[1]">
                          <tr className="text-left text-slate-400 border-b border-slate-600">
                            <th className="py-2 px-2">작업</th>
                            <th className="py-2 px-2">교재</th>
                            <th className="py-2 px-2">출처</th>
                            <th className="py-2 px-2">유형</th>
                            <th className="py-2 px-2">Explanation 일부</th>
                          </tr>
                        </thead>
                        <tbody>
                          {explanationApiData.items.map((it) => (
                            <tr key={it.id} className="border-b border-slate-700/50 hover:bg-slate-800/40">
                              <td className="py-1.5 px-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExplanationApiOpen(false);
                                    openEdit(it.id);
                                  }}
                                  className="text-teal-400 hover:text-teal-300 underline"
                                >
                                  수정
                                </button>
                              </td>
                              <td className="py-1.5 px-2 text-slate-300">{it.textbook}</td>
                              <td className="py-1.5 px-2 text-slate-300 font-mono">{it.source}</td>
                              <td className="py-1.5 px-2 text-violet-300">{it.type}</td>
                              <td
                                className="py-1.5 px-2 text-slate-400 max-w-[320px] truncate cursor-pointer hover:bg-slate-700/60 hover:text-slate-200 rounded transition-colors"
                                title="클릭하면 전체 내용 보기"
                                onClick={() => setFullTextView({ title: `Explanation · ${it.source} ${it.type}`, text: (it as { full?: string }).full ?? it.snippet })}
                              >
                                {it.snippet}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {optionsApiOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
          <div className="bg-slate-800 border border-amber-700/40 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-600 flex justify-between items-center shrink-0 bg-slate-800/95">
              <div>
                <h2 className="text-lg font-bold text-amber-200">Options &apos;API&apos; 검증</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Options 열에 <strong className="text-amber-300">&apos;API&apos;</strong> 텍스트가 포함된 문항만 표시합니다. 상단 교재·유형 필터 적용.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOptionsApiOpen(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-2"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              {optionsApiLoading && !optionsApiData && (
                <div className="flex items-center justify-center gap-2 py-12 text-amber-300">
                  <span className="inline-block w-6 h-6 border-2 border-amber-500/50 border-t-amber-300 rounded-full animate-spin" />
                  검증 중…
                </div>
              )}
              {optionsApiError && (
                <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-800/50 text-red-300 text-sm">
                  {optionsApiError}
                </div>
              )}
              {optionsApiData && !optionsApiLoading && (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-slate-300">
                      <strong className="text-amber-200">Options에 &apos;API&apos; 포함</strong>:{' '}
                      <strong className="text-white">{optionsApiData.totalMatched.toLocaleString()}</strong>건
                      {optionsApiData.filters.textbook && (
                        <> · 교재: <strong className="text-amber-200">{optionsApiData.filters.textbook}</strong></>
                      )}
                      {optionsApiData.filters.type && (
                        <> · 유형: <strong className="text-amber-200">{optionsApiData.filters.type}</strong></>
                      )}
                      {optionsApiData.truncated && (
                        <span className="ml-2 text-amber-400 text-xs">(최대 {optionsApiData.items.length}건만 표시)</span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={runOptionsApiValidate}
                      className="text-xs px-3 py-1.5 rounded-lg bg-amber-800/80 hover:bg-amber-700 text-amber-200"
                    >
                      다시 검증
                    </button>
                  </div>
                  {optionsApiData.totalMatched === 0 ? (
                    <p className="text-emerald-400/90 text-sm py-4">해당 없음 — 선택한 필터에서 Options에 &apos;API&apos;가 포함된 문항이 없습니다.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-600 max-h-[50vh] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-900 z-[1]">
                          <tr className="text-left text-slate-400 border-b border-slate-600">
                            <th className="py-2 px-2">작업</th>
                            <th className="py-2 px-2">교재</th>
                            <th className="py-2 px-2">출처</th>
                            <th className="py-2 px-2">유형</th>
                            <th className="py-2 px-2">Options 일부</th>
                          </tr>
                        </thead>
                        <tbody>
                          {optionsApiData.items.map((it) => (
                            <tr key={it.id} className="border-b border-slate-700/50 hover:bg-slate-800/40">
                              <td className="py-1.5 px-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOptionsApiOpen(false);
                                    openEdit(it.id);
                                  }}
                                  className="text-amber-400 hover:text-amber-300 underline"
                                >
                                  수정
                                </button>
                              </td>
                              <td className="py-1.5 px-2 text-slate-300">{it.textbook}</td>
                              <td className="py-1.5 px-2 text-slate-300 font-mono">{it.source}</td>
                              <td className="py-1.5 px-2 text-violet-300">{it.type}</td>
                              <td
                                className="py-1.5 px-2 text-slate-400 max-w-[320px] truncate cursor-pointer hover:bg-slate-700/60 hover:text-slate-200 rounded transition-colors"
                                title="클릭하면 전체 내용 보기"
                                onClick={() => setFullTextView({ title: `Options · ${it.source} ${it.type}`, text: (it as { full?: string }).full ?? it.snippet })}
                              >
                                {it.snippet}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {fullTextView && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70"
          onClick={() => setFullTextView(null)}
        >
          <div
            className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-600 flex justify-between items-center shrink-0">
              <span className="text-sm font-semibold text-slate-200 truncate pr-2">{fullTextView.title}</span>
              <button
                type="button"
                onClick={() => setFullTextView(null)}
                className="text-slate-400 hover:text-white text-xl leading-none px-2"
              >
                ×
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words font-sans">{fullTextView.text || '(비어 있음)'}</pre>
            </div>
          </div>
        </div>
      )}

      {validateOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
          <div className="bg-slate-800 border border-amber-700/40 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-600 flex justify-between items-center shrink-0 bg-slate-800/95">
              <div>
                <h2 className="text-lg font-bold text-amber-200">Options 중복 데이터 검증</h2>
                <p className="text-xs text-slate-400 mt-1">
                  <strong className="text-slate-300">같은 유형(type)</strong> 안에서만 Options가 완전히 같으면 중복으로 묶습니다(trim 기준).
                  교재·유형 필터 적용, 체크한 유형은 검증 제외됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setValidateOpen(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-2"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              {!validateData && !validateLoading && (
                <div className="mb-6 p-4 rounded-xl border-2 border-amber-800/50 bg-slate-900/60">
                  <h3 className="text-sm font-bold text-amber-200 mb-2">
                    중복 검증에서 제외할 유형
                  </h3>
                  <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                    체크한 유형은 <strong className="text-slate-200">검사 대상에서 완전히 제외</strong>
                    됩니다. (예: 어법 등 동일 Options 플레이스홀더가 많은 유형) 선택은 브라우저에
                    저장됩니다.
                  </p>
                  {types.length === 0 ? (
                    <p className="text-amber-500/90 text-sm py-4">
                      유형 목록을 불러오는 중입니다… 잠시 후 다시 열어 보거나 상단 필터로 목록을 한 번
                      불러온 뒤 시도해 주세요.
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2 mb-3">
                        <button
                          type="button"
                          onClick={() => setValidateExcludedTypes([...types])}
                          className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600"
                        >
                          전체 유형 제외
                        </button>
                        <button
                          type="button"
                          onClick={() => setValidateExcludedTypes([])}
                          className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600"
                        >
                          제외 전부 해제
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 max-h-48 overflow-y-auto pr-1">
                        {types.map((t) => (
                          <label
                            key={t}
                            className="inline-flex items-center gap-2 text-sm text-slate-200 cursor-pointer hover:text-white"
                          >
                            <input
                              type="checkbox"
                              checked={validateExcludedTypes.includes(t)}
                              onChange={() =>
                                setValidateExcludedTypes((prev) =>
                                  prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                                )
                              }
                              className="rounded border-slate-500 text-amber-600 focus:ring-amber-500 w-4 h-4"
                            />
                            <span className={validateExcludedTypes.includes(t) ? 'text-amber-200' : ''}>
                              {t}
                            </span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="mt-4 pt-4 border-t border-slate-600 text-xs text-slate-500">
                    적용 필터: 교재{' '}
                    <strong className="text-slate-300">{filterTextbook || '전체'}</strong> · 목록 유형{' '}
                    <strong className="text-slate-300">{filterType || '전체'}</strong>
                    {filterType && (
                      <span className="block mt-1 text-amber-600/90">
                        ※ 목록에서 특정 유형만 고른 경우, 제외 설정보다 해당 유형만 검사됩니다.
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={validateLoading || types.length === 0}
                    onClick={runOptionsDuplicateValidate}
                    className="mt-5 w-full sm:w-auto px-6 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold text-sm shadow-lg"
                  >
                    {validateLoading ? '검증 중…' : '검증 실행'}
                  </button>
                </div>
              )}

              {validateLoading && !validateData && (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <span className="animate-pulse">중복 검증 중…</span>
                </div>
              )}

              {validateError && (
                <div className="mb-4 p-3 rounded-lg bg-red-950/40 border border-red-800/50">
                  <p className="text-red-300 text-sm">{validateError}</p>
                  <button
                    type="button"
                    onClick={() => setValidateError(null)}
                    className="mt-2 text-xs text-red-400 underline"
                  >
                    닫기
                  </button>
                </div>
              )}
              {validateData && !validateError && (
                <>
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <button
                      type="button"
                      onClick={() => {
                        setValidateData(null);
                        setValidateError(null);
                        setValidateExpanded({});
                      }}
                      className="text-sm px-3 py-2 rounded-lg border border-slate-500 text-slate-300 hover:bg-slate-700"
                    >
                      ← 제외 유형 바꿔 다시 검증
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-4 mb-6 text-sm">
                    <span className="text-slate-300">
                      검사 대상 문서:{' '}
                      <strong className="text-white">{validateData.scannedDocuments.toLocaleString()}</strong>건
                    </span>
                    <span className="text-amber-200 inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                      중복 그룹{' '}
                      <strong>{validateData.duplicateGroupCount.toLocaleString()}</strong>개
                      {validateData.groups.length > 0 && (
                        <span className="text-slate-400 font-normal text-xs hidden sm:inline">
                          (아래 요약 참고)
                        </span>
                      )}
                    </span>
                    {(validateData.filters.textbook || validateData.filters.type) && (
                      <span className="text-slate-500">
                        필터: {validateData.filters.textbook || '전체 교재'} /{' '}
                        {validateData.filters.type || '전체 유형'}
                      </span>
                    )}
                  </div>
                  {validateData.excludedTypes.length > 0 && (
                    <p className="text-xs text-slate-500 mb-3">
                      검증 제외 유형:{' '}
                      <span className="text-amber-400/90 font-medium">
                        {validateData.excludedTypes.join(', ')}
                      </span>
                    </p>
                  )}
                  {Object.keys(validateData.summaryByType || {}).length > 0 && (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-500 shrink-0">유형별 중복 그룹 수:</span>
                      {Object.entries(validateData.summaryByType)
                        .sort(([a], [b]) => a.localeCompare(b, 'ko'))
                        .map(([t, n]) => (
                          <span
                            key={t}
                            className="inline-flex items-baseline gap-1 px-2 py-1 rounded-lg bg-violet-950/80 border border-violet-800/50 text-xs"
                          >
                            <span className="text-violet-200 font-semibold">{t}</span>
                            <span className="text-amber-300 font-bold">{n}</span>
                            <span className="text-slate-500">그룹</span>
                          </span>
                        ))}
                    </div>
                  )}
                  {validateData.duplicateGroupCount > 0 && validateData.groups.length > 0 && (
                    <div className="mb-4 p-3 rounded-xl bg-slate-900/90 border border-amber-900/40">
                      <p className="text-amber-200/90 text-xs font-bold mb-2 tracking-wide">
                        그룹 요약 — 유형 + 겹치는 Options
                      </p>
                      <ul className="space-y-2 text-sm">
                        {[...validateData.groups]
                          .sort((a, b) => {
                            const c = (a.questionType || '').localeCompare(b.questionType || '', 'ko');
                            if (c !== 0) return c;
                            return b.duplicateCount - a.duplicateCount;
                          })
                          .map((g, i) => {
                            const raw = (g.optionsFull || g.optionsPreview || '').replace(/\s+/g, ' ').trim();
                            const short =
                              raw.length > 100 ? `${raw.slice(0, 100)}…` : raw || '(빈 문자열)';
                            return (
                              <li
                                key={`${g.questionType}-${i}-${short.slice(0, 20)}`}
                                className="flex flex-wrap items-start gap-2 gap-y-1 border-b border-slate-700/50 pb-2 last:border-0 last:pb-0"
                              >
                                <span className="text-slate-500 font-mono text-xs w-6 shrink-0 pt-0.5">
                                  {i + 1}.
                                </span>
                                <span className="shrink-0 px-2 py-0.5 rounded bg-violet-900/60 text-violet-200 text-xs font-bold">
                                  {g.questionType}
                                </span>
                                <span
                                  className="text-slate-200 text-xs font-mono bg-slate-950/80 px-2 py-1 rounded border border-slate-700 flex-1 min-w-0 break-all"
                                  title={g.optionsFull || g.optionsPreview}
                                >
                                  {short}
                                </span>
                                <span className="text-amber-400 font-bold text-xs whitespace-nowrap shrink-0">
                                  ×{g.duplicateCount}건
                                </span>
                              </li>
                            );
                          })}
                      </ul>
                    </div>
                  )}
                  {validateData.duplicateGroupCount === 0 ? (
                    <p className="text-emerald-400 font-medium py-8 text-center">
                      중복된 Options 조합이 없습니다.
                    </p>
                  ) : (
                    <ul className="space-y-4">
                      {[...validateData.groups]
                        .sort((a, b) => {
                          const c = (a.questionType || '').localeCompare(b.questionType || '', 'ko');
                          if (c !== 0) return c;
                          return b.duplicateCount - a.duplicateCount;
                        })
                        .map((g, idx) => (
                        <li
                          key={`detail-${g.questionType}-${idx}-${g.optionsFull.slice(0, 40)}`}
                          className="border border-slate-600 rounded-xl bg-slate-900/50 overflow-hidden"
                        >
                          <div className="px-4 py-2 bg-amber-950/40 border-b border-slate-600 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-amber-300 font-bold text-sm flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-violet-800 text-violet-100 text-xs">
                                {g.questionType}
                              </span>
                              동일 Options × {g.duplicateCount}건
                            </span>
                            {g.truncated && (
                              <span className="text-xs text-amber-500/90">
                                아래 목록은 최대 50건만 표시
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setValidateExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }))
                              }
                              className="text-xs text-violet-400 hover:text-violet-300 underline"
                            >
                              {validateExpanded[idx] ? 'Options 접기' : 'Options 전문 펼치기'}
                            </button>
                          </div>
                          <div className="px-4 py-3">
                            {validateExpanded[idx] ? (
                              <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words max-h-48 overflow-y-auto bg-slate-950 p-3 rounded-lg border border-slate-700">
                                {g.optionsFull}
                              </pre>
                            ) : (
                              <p className="text-sm text-slate-400 line-clamp-3 whitespace-pre-wrap">
                                {g.optionsPreview}
                              </p>
                            )}
                            <div className="mt-3 overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-slate-500 border-b border-slate-700">
                                    <th className="py-2 pr-2">교재</th>
                                    <th className="py-2 pr-2">유형</th>
                                    <th className="py-2 pr-2">출처</th>
                                    <th className="py-2 text-right">작업</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.sampleItems.map((it) => (
                                    <tr key={it.id} className="border-b border-slate-700/50">
                                      <td className="py-1.5 pr-2 text-slate-300 max-w-[140px] truncate" title={it.textbook}>
                                        {it.textbook}
                                      </td>
                                      <td className="py-1.5 pr-2 text-violet-300">{it.type}</td>
                                      <td className="py-1.5 pr-2 text-slate-400">{it.source}</td>
                                      <td className="py-1.5 text-right">
                                        <button
                                          type="button"
                                          disabled={regenerateOptionsLoading === it.id}
                                          onClick={() => handleRegenerateOptionsOnly(it.id)}
                                          className="text-violet-400 hover:text-violet-300 font-medium disabled:opacity-50"
                                          title="선택지만 Claude로 새로 생성해 중복 해소"
                                        >
                                          {regenerateOptionsLoading === it.id ? '생성 중…' : '선택지만 수정'}
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {qCountOpen && (
        <div className="fixed inset-0 z-[61] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
          <div className="bg-slate-800 border border-cyan-700/40 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-600 flex justify-between items-center shrink-0 bg-slate-800/95">
              <div>
                <h2 className="text-lg font-bold text-cyan-200">문제수 검증 (원문 passages 기준)</h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  MongoDB <strong className="text-slate-300">passages</strong>와{' '}
                  <strong className="text-slate-300">generated_questions</strong>(passage_id)을 집계합니다.{' '}
                  <strong className="text-cyan-200">교재 전체</strong> 또는{' '}
                  <strong className="text-cyan-200">부교재 변형 주문서(bookVariant)</strong>에 담긴 지문만
                  골라 검증할 수 있습니다. 주문 기준은 주문서의 유형·유형별 문항수를 그대로 반영합니다.{' '}
                  <span className="text-slate-500">passage_id 없이만 등록된 변형은 제외됩니다.</span>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={
                    qCountLoading ||
                    (qCountScope === 'textbook' && (!filterTextbook.trim() || textbooks.length === 0)) ||
                    (qCountScope === 'order' && !qCountOrderId.trim())
                  }
                  onClick={() => void runQuestionCountValidate()}
                  className="px-3 py-1.5 rounded-lg border border-cyan-600/60 bg-cyan-900/50 hover:bg-cyan-800/60 disabled:opacity-50 text-cyan-200 text-sm font-medium"
                  title="현재 선택한 범위로 다시 집계"
                >
                  새로고침
                </button>
                <button
                  type="button"
                  onClick={() => setQCountOpen(false)}
                  className="text-slate-400 hover:text-white text-2xl leading-none px-2"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              {!qCountData && !qCountLoading && (
                <div className="mb-4 p-4 rounded-xl border-2 border-cyan-800/50 bg-slate-900/60 space-y-4">
                  <div>
                    <span className="block text-sm font-medium text-cyan-100/90 mb-2">검증 범위</span>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <label className="inline-flex items-center gap-2 cursor-pointer text-slate-200">
                        <input
                          type="radio"
                          name="qCountScope"
                          checked={qCountScope === 'textbook'}
                          onChange={() => {
                            setQCountScope('textbook');
                            setQCountError(null);
                          }}
                          className="text-cyan-500"
                        />
                        교재 전체 지문
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer text-slate-200">
                        <input
                          type="radio"
                          name="qCountScope"
                          checked={qCountScope === 'order'}
                          onChange={() => {
                            setQCountScope('order');
                            setQCountError(null);
                          }}
                          className="text-cyan-500"
                        />
                        주문서(부교재 변형)에 선택된 지문만
                      </label>
                    </div>
                  </div>

                  {qCountScope === 'textbook' ? (
                    <div>
                      <label className="block text-sm font-medium text-cyan-100/90 mb-2">검증할 교재</label>
                      <p className="text-xs text-slate-500 mb-2">
                        상단 목록 <strong className="text-slate-400">교재</strong> 필터와 동일하게 맞춰집니다.
                        표준 11유형 × 각 {DEFAULT_QUESTIONS_PER_VARIANT_TYPE}문항 기준입니다.
                      </p>
                      {textbooks.length === 0 ? (
                        <p className="text-amber-400/90 text-sm py-2">교재 목록을 불러오는 중입니다…</p>
                      ) : (
                        <select
                          value={filterTextbook}
                          onChange={(e) => {
                            setFilterTextbook(e.target.value);
                            setPage(1);
                          }}
                          className="w-full max-w-md bg-slate-900 border border-cyan-800/60 rounded-lg px-3 py-2.5 text-sm text-white"
                        >
                          <option value="">— 교재를 선택하세요 —</option>
                          {textbooks.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-cyan-100/90 mb-2">주문 선택</label>
                      <p className="text-xs text-slate-500 mb-2">
                        최근 주문 100건 중, <code className="text-slate-400">orderMeta</code>가 있는{' '}
                        <strong className="text-slate-300">bookVariant</strong>(부교재 변형) 주문만 선택할 수
                        있습니다. 유형·문항수는 주문 메타 값을 따릅니다.{' '}
                        <span className="text-slate-600">
                          (예전 주문이 전부 「메타없음」이면, 당시 비회원 주문은 서버에 메타를 안 남기던 버그였습니다.
                          코드 수정 후 새로 접수되는 주문부터는 비회원도 메타가 저장됩니다.)
                        </span>
                      </p>
                      {qCountOrdersLoading ? (
                        <p className="text-amber-400/90 text-sm py-2">주문 목록 불러오는 중…</p>
                      ) : (
                        <select
                          value={qCountOrderId}
                          onChange={(e) => setQCountOrderId(e.target.value)}
                          className="w-full max-w-xl bg-slate-900 border border-cyan-800/60 rounded-lg px-3 py-2.5 text-sm text-white"
                        >
                          <option value="">— 주문을 선택하세요 —</option>
                          {qCountOrders.map((o) => {
                            const ok = o.orderMetaFlow === 'bookVariant' && o.hasOrderMeta;
                            const when = o.createdAt
                              ? new Date(o.createdAt).toLocaleString('ko-KR', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '';
                            const label = `${o.orderNumber || o.id.slice(-8)} · ${when}${ok ? '' : ` · (${o.orderMetaFlow || '메타없음'})`}`;
                            return (
                              <option key={o.id} value={o.id} disabled={!ok}>
                                {label}
                              </option>
                            );
                          })}
                        </select>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={
                      qCountLoading ||
                      (qCountScope === 'textbook' &&
                        (!filterTextbook.trim() || textbooks.length === 0)) ||
                      (qCountScope === 'order' && !qCountOrderId.trim())
                    }
                    onClick={() => void runQuestionCountValidate()}
                    className="w-full sm:w-auto px-6 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold text-sm shadow-lg"
                  >
                    검증 실행
                  </button>
                </div>
              )}

              {qCountLoading && !qCountData && (
                <div className="flex items-center justify-center py-12 text-slate-400">
                  <span className="animate-pulse">원문·변형 집계 중…</span>
                </div>
              )}

              {qCountError && (
                <div className="mb-4 p-3 rounded-lg bg-red-950/40 border border-red-800/50">
                  <p className="text-red-300 text-sm">{qCountError}</p>
                  <button
                    type="button"
                    onClick={() => setQCountError(null)}
                    className="mt-2 text-xs text-red-400 underline"
                  >
                    닫기
                  </button>
                </div>
              )}

              {qCountData && !qCountError && (
                <>
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <button
                      type="button"
                      onClick={() => {
                        setQCountData(null);
                        setQCountError(null);
                      }}
                      className="text-sm px-3 py-2 rounded-lg border border-slate-500 text-slate-300 hover:bg-slate-700"
                    >
                      ← 다시 검증
                    </button>
                  </div>
                  {qCountData.message && (
                    <p className="text-amber-300/90 text-sm mb-4">{qCountData.message}</p>
                  )}
                  {qCountData.scope === 'order' && qCountData.order && (
                    <div className="mb-3 space-y-2">
                      <p className="text-xs text-cyan-400/90">
                        주문 기준 검증 · 주문번호{' '}
                        <strong className="text-cyan-200">{qCountData.order.orderNumber || qCountData.order.id}</strong>
                        {typeof qCountData.orderLessonsRequested === 'number' && (
                          <>
                            {' '}
                            · 주문 지문 {qCountData.orderLessonsRequested}개 중 DB 매칭{' '}
                            {qCountData.orderLessonsMatched ?? qCountData.passageCount}개
                          </>
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!qCountData.order?.orderNumber) return;
                          setQCountDebugLoading(true);
                          setQCountDebugData(null);
                          try {
                            const res = await fetch(
                              `/api/admin/debug/question-count-order?orderNumber=${encodeURIComponent(qCountData.order.orderNumber)}`,
                              { credentials: 'include' }
                            );
                            const d = await res.json();
                            if (res.ok && d.order) {
                              setQCountDebugData(d);
                            } else {
                              alert(d.error || '디버깅 정보 조회 실패');
                            }
                          } catch {
                            alert('요청 중 오류가 발생했습니다.');
                          } finally {
                            setQCountDebugLoading(false);
                          }
                        }}
                        disabled={qCountDebugLoading || !qCountData.order?.orderNumber}
                        className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/80 hover:bg-slate-600/80 text-slate-200 disabled:opacity-50"
                      >
                        {qCountDebugLoading ? '조회 중…' : 'MongoDB 데이터 직접 비교'}
                      </button>
                    </div>
                  )}
                  {qCountDebugData && (
                    <div className="mb-4 p-4 rounded-xl border border-slate-600 bg-slate-900/60 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-cyan-200">MongoDB 직접 조회 결과</h3>
                        <button
                          type="button"
                          onClick={() => setQCountDebugData(null)}
                          className="text-xs text-slate-400 hover:text-slate-200"
                        >
                          닫기
                        </button>
                      </div>
                      <div className="space-y-3 text-xs">
                        <div>
                          <p className="text-slate-400 mb-1">주문서 orderMeta</p>
                          <div className="bg-slate-950/80 p-2 rounded border border-slate-700 font-mono text-[11px] text-slate-300">
                            <div>교재: {qCountDebugData.orderMeta.selectedTextbook}</div>
                            <div>선택 지문: {qCountDebugData.orderMeta.selectedLessons.length}개</div>
                            <div>선택 유형: {qCountDebugData.orderMeta.selectedTypes.length > 0 ? qCountDebugData.orderMeta.selectedTypes.join(', ') : '전체'}</div>
                            <div>유형당 기준: {qCountDebugData.orderMeta.questionsPerType}문항</div>
                          </div>
                        </div>
                        <div>
                          <p className="text-slate-400 mb-1">passages 매칭</p>
                          <div className="bg-slate-950/80 p-2 rounded border border-slate-700 text-slate-300">
                            <div>요청 지문: {qCountDebugData.passages.requestedLessons}개</div>
                            <div>매칭된 지문: <strong className="text-cyan-200">{qCountDebugData.passages.matchedLessons}</strong>개</div>
                            <div>passages 총: <strong className="text-white">{qCountDebugData.passages.total}</strong>개</div>
                            {qCountDebugData.passages.lessonsWithoutPassage.length > 0 && (
                              <div className="mt-1 text-amber-300">
                                매칭 실패: {qCountDebugData.passages.lessonsWithoutPassage.slice(0, 5).join(', ')}
                                {qCountDebugData.passages.lessonsWithoutPassage.length > 5 && ` 외 ${qCountDebugData.passages.lessonsWithoutPassage.length - 5}개`}
                              </div>
                            )}
                            {qCountDebugData.passages.sample.length > 0 && (
                              <details className="mt-2">
                                <summary className="cursor-pointer text-slate-400 hover:text-slate-200">샘플 passages (최대 5개)</summary>
                                <ul className="mt-1 space-y-1 pl-4">
                                  {qCountDebugData.passages.sample.map((p) => (
                                    <li key={p._id} className="text-[11px] font-mono">
                                      {p.source_key} (chapter: {p.chapter}, number: {p.number}) - _id: {p._id.slice(0, 12)}...
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </div>
                        </div>
                        <div>
                          <p className="text-slate-400 mb-1">generated_questions</p>
                          <div className="bg-slate-950/80 p-2 rounded border border-slate-700 text-slate-300">
                            <div>총 문제 수: <strong className={qCountDebugData.generatedQuestions.total > 0 ? 'text-emerald-300' : 'text-rose-300'}>{qCountDebugData.generatedQuestions.total}</strong>건</div>
                            {qCountDebugData.generatedQuestions.byPassageType.length > 0 && (
                              <details className="mt-2">
                                <summary className="cursor-pointer text-slate-400 hover:text-slate-200">passage_id + type별 집계 (최대 20개)</summary>
                                <ul className="mt-1 space-y-1 pl-4 text-[11px]">
                                  {qCountDebugData.generatedQuestions.byPassageType.slice(0, 20).map((g, i) => (
                                    <li key={i} className="font-mono">
                                      passage_id: {g.passageId.slice(0, 12)}... · type: {g.type} · {g.count}건
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            {qCountDebugData.generatedQuestions.sample.length > 0 && (
                              <details className="mt-2">
                                <summary className="cursor-pointer text-slate-400 hover:text-slate-200">샘플 generated_questions (최대 10개)</summary>
                                <ul className="mt-1 space-y-1 pl-4 text-[11px]">
                                  {qCountDebugData.generatedQuestions.sample.map((g) => (
                                    <li key={g._id} className="font-mono">
                                      {g.source} ({g.type}) - passage_id: {g.passage_id.slice(0, 12)}...
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-amber-950/30 border border-amber-800/50">
                          <p className="text-amber-200 font-semibold text-xs">분석</p>
                          <p className="text-amber-100/90 text-xs mt-1">{qCountDebugData.analysis.issue}</p>
                        </div>
                      </div>
                    </div>
                  )}
                  {qCountData.lessonsWithoutPassage && qCountData.lessonsWithoutPassage.length > 0 && (
                    <div className="mb-4 p-3 rounded-lg bg-amber-950/40 border border-amber-800/50 text-amber-100 text-xs">
                      <p className="font-bold text-amber-200 mb-1">passages에 없는 주문 라벨 (source_key 불일치)</p>
                      <p className="text-amber-100/80 mb-2">
                        아래 문자열과 정확히 같은 <code className="text-slate-300">source_key</code>인 원문이
                        없습니다. 지문 등록 또는 라벨 표기를 확인하세요.
                      </p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {qCountData.lessonsWithoutPassage.map((s) => (
                          <li key={s} className="font-mono text-[11px]">
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {qCountData.typesChecked.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mb-3">
                      <span className="text-[11px] text-slate-500 shrink-0">검사 유형:</span>
                      {qCountData.typesChecked.map((t) => (
                        <span
                          key={t}
                          className="text-[11px] px-1.5 py-0.5 rounded bg-violet-950/80 text-violet-200 border border-violet-800/40"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-4 mb-4 text-sm text-slate-300">
                    <span>
                      교재: <strong className="text-white">{qCountData.textbook}</strong>
                    </span>
                    <span>
                      {qCountData.scope === 'order' ? '검증 지문 수' : '원문 지문 수'}:{' '}
                      <strong className="text-white">{qCountData.passageCount.toLocaleString()}</strong>
                    </span>
                    <span>
                      유형당 기준:{' '}
                      <strong className="text-cyan-200">{qCountData.requiredPerType}</strong>문항
                    </span>
                    <span className="text-rose-300/90">
                      변형 0건 지문:{' '}
                      <strong>{qCountData.noQuestionsTotal.toLocaleString()}</strong>개
                    </span>
                    <span className="text-amber-200/90">
                      유형 부족 행:{' '}
                      <strong>{qCountData.underfilledTotal.toLocaleString()}</strong>건
                      <span className="text-slate-500 text-xs font-normal">
                        {' '}
                        (지문×유형 조합)
                      </span>
                    </span>
                  </div>
                  {(qCountData.noQuestionsTruncated || qCountData.underfilledTruncated) && (
                    <p className="text-xs text-amber-500/90 mb-4">
                      표시는 각 목록 최대 2,500행까지입니다. 전체 건수는 위 요약 숫자를 참고하세요.
                    </p>
                  )}

                  <section className="mb-8">
                    <h3 className="text-sm font-bold text-rose-200 mb-2 border-b border-rose-900/40 pb-1">
                      변형문이 전혀 없는 지문 (passage_id 연결 0건)
                    </h3>
                    {qCountData.noQuestionsTotal === 0 ? (
                      <p className="text-emerald-400/90 text-sm py-4">해당 없음 — 모든 원문에 최소 1건 이상 연결되었습니다.</p>
                    ) : (
                      <div className="overflow-x-auto max-h-64 overflow-y-auto rounded-lg border border-slate-600">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-slate-900 z-[1]">
                            <tr className="text-left text-slate-400 border-b border-slate-600">
                              <th className="py-2 px-2">라벨 (source_key / 강·번호)</th>
                              <th className="py-2 px-2">강</th>
                              <th className="py-2 px-2">번호</th>
                              <th className="py-2 px-2 font-mono">passage_id</th>
                            </tr>
                          </thead>
                          <tbody>
                            {qCountData.noQuestions.map((r) => (
                              <tr key={r.passageId} className="border-b border-slate-700/50">
                                <td className="py-1.5 px-2 text-slate-200">{r.label}</td>
                                <td className="py-1.5 px-2 text-slate-400">{String(r.chapter ?? '—')}</td>
                                <td className="py-1.5 px-2 text-slate-400">{String(r.number ?? '—')}</td>
                                <td className="py-1.5 px-2 font-mono text-[10px] text-cyan-300/80">
                                  {r.passageId}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <section>
                    <h3 className="text-sm font-bold text-amber-200 mb-1 border-b border-amber-900/40 pb-1">
                      유형별 기준 미충족 (각 유형 {qCountData.requiredPerType}문항 미만)
                    </h3>
                    {qCountData.underfilledTotal > 0 && (
                      <>
                        <p className="text-[11px] text-slate-500 mb-2">
                          <strong className="text-amber-400/90">부족</strong> 열의 숫자를 누르면 해당 지문·유형이
                          채워진 <strong className="text-slate-400">새 변형문제</strong> 작성 창이 열립니다. 같은
                          passage·type으로 부족한 만큼 저장하면 기준 문항 수에 맞출 수 있습니다.{' '}
                          <strong className="text-slate-400">유형(카테고리)</strong> 또는{' '}
                          <strong className="text-slate-400">지문 라벨</strong> 헤더를 누르면 유형별·지문 순으로 정렬이 바뀝니다.
                        </p>
                        {!shortageBatch && !batchCreatingAll && (
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const sorted = [...qCountData.underfilled].sort((a, b) => {
                                  if (qCountUnderfilledSortBy === 'type') {
                                    const t = a.type.localeCompare(b.type, 'ko');
                                    if (t !== 0) return t;
                                    return a.label.localeCompare(b.label, 'ko');
                                  }
                                  const l = a.label.localeCompare(b.label, 'ko');
                                  if (l !== 0) return l;
                                  return a.type.localeCompare(b.type, 'ko');
                                });
                                const total = sorted.reduce((s, r) => s + r.shortBy, 0);
                                if (total === 0) return;
                                void runBatchCreateAll(sorted, qCountData.textbook);
                              }}
                              className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium text-sm"
                            >
                              한번에 먼저 생성 ({qCountData.underfilled.reduce((s, r) => s + r.shortBy, 0)}건 → Claude 초안 후 자동 저장, 나중에 검수)
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const sorted = [...qCountData.underfilled].sort((a, b) => {
                                  if (qCountUnderfilledSortBy === 'type') {
                                    const t = a.type.localeCompare(b.type, 'ko');
                                    if (t !== 0) return t;
                                    return a.label.localeCompare(b.label, 'ko');
                                  }
                                  const l = a.label.localeCompare(b.label, 'ko');
                                  if (l !== 0) return l;
                                  return a.type.localeCompare(b.type, 'ko');
                                });
                                const total = sorted.reduce((s, r) => s + r.shortBy, 0);
                                if (total === 0) return;
                                const batch = {
                                  rows: sorted,
                                  textbook: qCountData.textbook,
                                  rowIndex: 0,
                                  remainingInRow: sorted[0].shortBy,
                                  totalCreated: 0,
                                };
                                console.log('[부족 문항 한번에 처리] click', { total, rows: sorted.length, first: sorted[0]?.label, firstType: sorted[0]?.type });
                                shortageBatchRef.current = batch;
                                setQCountOpen(false);
                                setValidateOpen(false);
                                setShortageBatch(batch);
                                openCreateForQCountShortage(sorted[0], qCountData.textbook);
                              }}
                              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium text-sm"
                            >
                              하나씩 처리 (저장할 때마다 다음으로)
                            </button>
                          </div>
                        )}
                        {batchCreateError && (
                          <div className="mb-3 p-2 rounded-lg bg-red-950/50 border border-red-800/50 text-red-300 text-sm flex items-center justify-between gap-2">
                            <span>{batchCreateError}</span>
                            <button type="button" onClick={() => setBatchCreateError(null)} className="text-red-400 hover:text-white shrink-0">닫기</button>
                          </div>
                        )}
                      </>
                    )}
                    {qCountData.underfilledTotal === 0 ? (
                      <p className="text-emerald-400/90 text-sm py-4">
                        해당 없음 — 변형이 있는 모든 지문에서 선택된{' '}
                        {qCountData.typesChecked.length}개 유형이 각각 {qCountData.requiredPerType}문항 이상입니다.
                      </p>
                    ) : (
                      <div className="overflow-x-auto max-h-[min(50vh,420px)] overflow-y-auto rounded-lg border border-slate-600">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-slate-900 z-[1]">
                            <tr className="text-left text-slate-400 border-b border-slate-600">
                              <th className="py-2 px-2">
                                <button
                                  type="button"
                                  onClick={() => setQCountUnderfilledSortBy('label')}
                                  className={`text-left w-full rounded px-1 py-0.5 -mx-1 transition-colors ${
                                    qCountUnderfilledSortBy === 'label'
                                      ? 'text-cyan-200 font-semibold bg-cyan-950/50'
                                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                                  }`}
                                  title="지문 라벨 순으로 정렬"
                                >
                                  지문 라벨
                                  {qCountUnderfilledSortBy === 'label' && (
                                    <span className="ml-1 text-[10px] opacity-80">▼</span>
                                  )}
                                </button>
                              </th>
                              <th className="py-2 px-2">
                                <button
                                  type="button"
                                  onClick={() => setQCountUnderfilledSortBy('type')}
                                  className={`text-left w-full rounded px-1 py-0.5 -mx-1 transition-colors ${
                                    qCountUnderfilledSortBy === 'type'
                                      ? 'text-violet-200 font-semibold bg-violet-950/50'
                                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                                  }`}
                                  title="유형(카테고리)별로 묶어서 보기"
                                >
                                  유형(카테고리)
                                  {qCountUnderfilledSortBy === 'type' && (
                                    <span className="ml-1 text-[10px] opacity-80">▼</span>
                                  )}
                                </button>
                              </th>
                              <th className="py-2 px-2 text-right">현재</th>
                              <th className="py-2 px-2 text-right">기준</th>
                              <th className="py-2 px-2 text-right" title="클릭 시 새 변형문제">
                                부족
                              </th>
                              <th className="py-2 px-2 font-mono">passage_id</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...qCountData.underfilled]
                              .sort((a, b) => {
                                if (qCountUnderfilledSortBy === 'type') {
                                  const t = a.type.localeCompare(b.type, 'ko');
                                  if (t !== 0) return t;
                                  return a.label.localeCompare(b.label, 'ko');
                                }
                                const l = a.label.localeCompare(b.label, 'ko');
                                if (l !== 0) return l;
                                return a.type.localeCompare(b.type, 'ko');
                              })
                              .map((r, i) => (
                                <tr key={`${r.passageId}-${r.type}-${i}`} className="border-b border-slate-700/50">
                                  <td className="py-1.5 px-2 text-slate-200">{r.label}</td>
                                  <td className="py-1.5 px-2 text-violet-300 font-medium">{r.type}</td>
                                  <td className="py-1.5 px-2 text-right text-slate-300">{r.count}</td>
                                  <td className="py-1.5 px-2 text-right text-slate-500">{r.required}</td>
                                  <td className="py-1.5 px-2 text-right">
                                    <button
                                      type="button"
                                      onClick={() => openCreateForQCountShortage(r, qCountData.textbook)}
                                      className="text-amber-400 font-semibold hover:text-amber-300 hover:underline underline-offset-2 cursor-pointer"
                                      title={`부족 ${r.shortBy}문항 — ${r.type} 유형으로 새 변형문제 작성`}
                                    >
                                      −{r.shortBy}
                                    </button>
                                  </td>
                                  <td className="py-1.5 px-2 font-mono text-[10px] text-cyan-300/70">
                                    {r.passageId}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {typePromptModalOpen && (
        <div className="fixed inset-0 z-[58] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
          <div className="bg-slate-800 border border-violet-600/40 rounded-2xl w-full max-w-3xl max-h-[92vh] my-4 shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-600 flex flex-wrap items-start justify-between gap-2 shrink-0">
              <div>
                <h3 className="text-lg font-bold text-violet-200">유형별 AI 프롬프트</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-xl">
                  「＋ 같은유형」→ <strong className="text-slate-300">AI 초안 생성</strong> 시, 원본 행의{' '}
                  <strong className="text-violet-300">type</strong>과 이름이 같은 칸의 지침이 API 요청에 붙습니다.
                  이 브라우저 <code className="text-slate-500">localStorage</code>에만 저장됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTypePromptModalOpen(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-2"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-xs text-slate-500 mb-1">유형 이름 추가 (DB에만 있는 유형 등)</label>
                  <input
                    value={typePromptNewName}
                    onChange={(e) => setTypePromptNewName(e.target.value)}
                    list="gq-types-prompt-modal"
                    placeholder="예: 어휘변형"
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  />
                  <datalist id="gq-types-prompt-modal">
                    {types.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>
                <button
                  type="button"
                  onClick={addTypePromptRow}
                  className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium"
                >
                  줄 추가
                </button>
              </div>
              {typePromptList.length === 0 && (
                <p className="text-sm text-slate-500">유형이 없습니다. 위에서 이름을 넣고 「줄 추가」하거나 메타를 불러오세요.</p>
              )}
              {typePromptList.map((t) => (
                <div key={t} className="rounded-xl border border-slate-600/80 bg-slate-900/40 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-sm font-bold text-violet-300">{t}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setTypePromptList((prev) => prev.filter((x) => x !== t));
                        setTypePromptMap((m) => {
                          const next = { ...m };
                          delete next[t];
                          return next;
                        });
                      }}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      줄 제거
                    </button>
                  </div>
                  <textarea
                    value={typePromptMap[t] ?? ''}
                    onChange={(e) =>
                      setTypePromptMap((m) => ({
                        ...m,
                        [t]: e.target.value,
                      }))
                    }
                    rows={4}
                    placeholder={`「${t}」유형으로 새 문항을 만들 때 AI에 줄 지침 (난이도, 함정 금지, 보기 개수 등)`}
                    className="w-full bg-slate-950 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
                  />
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-slate-600 flex flex-wrap items-center justify-between gap-2 shrink-0 bg-slate-800/95">
              <span className={`text-sm ${typePromptSavedFlash ? 'text-emerald-400' : 'text-slate-500'}`}>
                {typePromptSavedFlash ? '✓ 저장됨' : '저장 후 이 브라우저에서만 유지'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTypePromptModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 text-sm"
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={saveTypePrompts}
                  className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {siblingModalId && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-black/75">
          <div className="bg-slate-800 border border-sky-700/50 rounded-2xl w-full max-w-lg shadow-2xl p-5">
            <h3 className="text-lg font-bold text-sky-200 mb-2">같은 지문 · 같은 유형으로 추가</h3>
            <p className="text-sm text-slate-400 mb-3 leading-relaxed">
              교재·출처·유형·passage_id·지문(Paragraph)은 원본과 동일하게 두고,{' '}
              <strong className="text-slate-300">새 행</strong>을 만듭니다. NumQuestion은 같은 조합에서 자동으로
              이어집니다.
            </p>
            <label className="block text-xs text-slate-500 mb-1">AI 생성 시 추가 지시 (선택)</label>
            <textarea
              value={siblingHint}
              onChange={(e) => setSiblingHint(e.target.value)}
              rows={2}
              placeholder="예: 난이도 상향, 함의형 느낌으로…"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white mb-3"
            />
            <p className="text-[11px] text-slate-500 mb-3">
              <strong className="text-amber-200/90">빈 양식</strong>: 발문·선택지를 직접 채우면 됩니다.{' '}
              <strong className="text-violet-200/90">AI 초안</strong>: 상단 <strong>유형별 AI 프롬프트</strong>에 적은
              지침이 해당 유형에 자동 반영됩니다. 공통 문구는 .env{' '}
              <code className="text-slate-400">ANTHROPIC_VARIANT_DRAFT_EXTRA</code>. 키 필요.
            </p>
            {siblingErr && (
              <p className="text-sm text-red-400 mb-3">{siblingErr}</p>
            )}
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                disabled={siblingLoading}
                onClick={() => {
                  setSiblingModalId(null);
                  setSiblingErr(null);
                }}
                className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 text-sm"
              >
                취소
              </button>
              <button
                type="button"
                disabled={siblingLoading}
                onClick={() => runFromSibling('blank')}
                className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium inline-flex items-center gap-2"
              >
                {siblingLoading && (
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                )}
                {siblingLoading ? '처리 중…' : '빈 양식으로 추가'}
              </button>
              <button
                type="button"
                disabled={siblingLoading}
                onClick={() => runFromSibling('ai')}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold inline-flex items-center gap-2"
              >
                {siblingLoading && (
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                )}
                {siblingLoading ? 'AI 생성 중…' : 'AI 초안 생성'}
              </button>
            </div>
          </div>
        </div>
      )}

      {solveOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
          <div className="bg-slate-800 border border-emerald-700/40 rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-600 flex justify-between items-center shrink-0 bg-slate-800/95">
              <div>
                <h2 className="text-lg font-bold text-emerald-300">Claude로 문제 풀기</h2>
                {solveRow && (
                  <p className="text-xs text-slate-400 mt-1">
                    <span className="text-violet-300">{solveRow.type}</span>
                    {' · '}{solveRow.source}
                    {' · '}<span className="text-slate-500">{solveRow.textbook}</span>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSolveOpen(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-2"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {solveLoading && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                  <div className="animate-spin w-8 h-8 border-4 border-slate-600 border-t-emerald-400 rounded-full" />
                  <span className="text-sm">Claude가 문제를 풀고 있습니다…</span>
                </div>
              )}

              {solveError && !solveLoading && (
                <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/50">
                  <p className="text-red-300 text-sm">{solveError}</p>
                </div>
              )}

              {!solveLoading && solveRow && (
                <>
                  {solveRow.paragraph && (
                    <div className="rounded-xl bg-slate-900/70 border border-slate-600 p-4">
                      <p className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wider">지문</p>
                      <p className="text-sm text-slate-200 leading-relaxed">
                        <ParagraphWithUnderline text={solveRow.paragraph} />
                      </p>
                    </div>
                  )}
                  {solveRow.question && (
                    <div className="rounded-xl bg-slate-900/50 border border-slate-600 p-4">
                      <p className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wider">발문</p>
                      <p className="text-sm text-slate-100 whitespace-pre-wrap">{solveRow.question}</p>
                    </div>
                  )}
                  {solveRow.options && (
                    <div className="rounded-xl bg-slate-900/50 border border-slate-600 p-4">
                      <p className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wider">선택지</p>
                      <p className="text-sm text-slate-200 whitespace-pre-wrap font-mono">{solveRow.options}</p>
                    </div>
                  )}
                </>
              )}

              {!solveLoading && solveResult && (
                <>
                  <div
                    className={`rounded-xl border-2 p-4 ${
                      solveResult.isCorrect === true
                        ? 'border-emerald-500/60 bg-emerald-950/40'
                        : solveResult.isCorrect === false
                        ? 'border-red-500/60 bg-red-950/40'
                        : 'border-slate-500/60 bg-slate-900/40'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-3 mb-3">
                      <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Claude의 답</p>
                      {solveResult.isCorrect === true && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-600/80 text-white">✓ 정답</span>
                      )}
                      {solveResult.isCorrect === false && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-600/80 text-white">✗ 오답</span>
                      )}
                    </div>
                    <p className="text-emerald-300 font-bold text-base mb-3">{solveResult.claudeAnswer}</p>
                    <div className="border-t border-slate-600 pt-3">
                      <p className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">풀이</p>
                      <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{solveResult.claudeResponse}</p>
                    </div>
                  </div>

                  {solveResult.correctAnswer && (
                    <div className="rounded-xl bg-slate-900/70 border border-slate-600 p-4">
                      <p className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">정답 (CorrectAnswer)</p>
                      <p className="text-base font-bold text-amber-300">{solveResult.correctAnswer}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {!solveLoading && solveRow && (
              <div className="px-5 py-3 border-t border-slate-600 flex justify-between items-center shrink-0 bg-slate-800/95">
                <button
                  type="button"
                  disabled={solveLoading}
                  onClick={() => {
                    if (!solveRow) return;
                    setSolveResult(null);
                    setSolveError(null);
                    setSolveLoading(true);
                    fetch('/api/admin/generated-questions/solve', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({
                        question: solveRow.question,
                        paragraph: solveRow.paragraph,
                        options: solveRow.options,
                        correctAnswer: solveRow.correctAnswer,
                        questionType: solveRow.type,
                      }),
                    })
                      .then((r) => r.json())
                      .then((d) => {
                        if (d.ok) setSolveResult(d as SolveResult);
                        else setSolveError(d.error || '오류');
                      })
                      .catch(() => setSolveError('네트워크 오류'))
                      .finally(() => setSolveLoading(false));
                  }}
                  className="text-sm px-4 py-2 rounded-lg bg-emerald-700/60 hover:bg-emerald-600/80 text-emerald-200 font-medium disabled:opacity-50"
                >
                  다시 풀기
                </button>
                <button
                  type="button"
                  onClick={() => setSolveOpen(false)}
                  className="text-sm px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  닫기
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 overflow-y-auto">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-600 px-5 py-4 flex justify-between items-center z-10">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold">
                  {editingId ? '변형문제 수정' : shortageBatch
                    ? `부족 문항 순차 처리 (${shortageBatch.totalCreated}/${shortageBatch.rows.reduce((s, r) => s + r.shortBy, 0)}건 완료 · 현재: ${shortageBatch.rows[shortageBatch.rowIndex].label} ${shortageBatch.rows[shortageBatch.rowIndex].type})`
                    : '새 변형문제'}
                </h2>
                {(draftLoading || saving || explanationOnlyLoading) && (
                  <span className="inline-flex items-center gap-2 text-sm text-amber-300">
                    <span className="inline-block w-4 h-4 border-2 border-amber-500/50 border-t-amber-300 rounded-full animate-spin shrink-0" />
                    {explanationOnlyLoading ? '해설 생성 중…' : draftLoading ? 'Claude 작성 중…' : '저장 중…'}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-400 block mb-1">passage_id (원문 passages._id) *</label>
                  <input
                    value={form.passage_id}
                    onChange={(e) => setForm((f) => ({ ...f, passage_id: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white font-mono"
                    placeholder="24자 hex ObjectId"
                  />
                </div>
                {passagePreviewLoading && (
                  <div className="sm:col-span-2 flex items-center gap-2 text-slate-400 text-sm">
                    <span className="inline-block w-4 h-4 border-2 border-slate-500 border-t-cyan-400 rounded-full animate-spin" />
                    원문 불러오는 중…
                  </div>
                )}
                {!passagePreviewLoading && passagePreview != null && (
                  <div className="sm:col-span-2 rounded-lg bg-slate-900/80 border border-slate-600 p-3">
                    <p className="text-[11px] text-cyan-400 mb-2 font-semibold uppercase tracking-wider">원문 미리보기 (해당 교재 passage)</p>
                    <div className="text-sm text-slate-200 leading-relaxed max-h-44 overflow-y-auto">
                      <ParagraphWithUnderline text={passagePreview} />
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-xs text-slate-400 block mb-1">교재명 *</label>
                  <input
                    value={form.textbook}
                    onChange={(e) => setForm((f) => ({ ...f, textbook: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">출처 (source) *</label>
                  <input
                    value={form.source}
                    onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="예: 01강 기출 예제"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">유형 (type) *</label>
                  <input
                    list="gq-types"
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="빈칸, 주제, …"
                  />
                  <datalist id="gq-types">
                    {types.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">option_type</label>
                  <input
                    value={form.option_type}
                    onChange={(e) => setForm((f) => ({ ...f, option_type: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">상태</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {['완료', '대기', '오류'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                    {statuses.filter((s) => !['완료', '대기', '오류'].includes(s)).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-slate-400 block mb-1">error_msg (비우면 null)</label>
                  <input
                    value={form.error_msg}
                    onChange={(e) => setForm((f) => ({ ...f, error_msg: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
              <div>
                <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                  <label className="text-xs text-violet-300 font-semibold">question_data (JSON) *</label>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {draftGenerated && (
                      <>
                        <span className="text-xs px-2 py-1 rounded-md bg-emerald-900/60 text-emerald-300 font-medium">
                          생성됨
                        </span>
                        <button
                          type="button"
                          onClick={focusQuestionJsonForEdit}
                          className="text-xs px-3 py-1.5 rounded-lg border border-amber-600/60 bg-amber-900/40 hover:bg-amber-800/50 text-amber-200 font-medium"
                        >
                          추가 수정
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={draftLoading || saving}
                      onClick={() => void runGenerateDraft()}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-700 hover:from-violet-500 hover:to-fuchsia-600 text-white font-bold disabled:opacity-50 shadow-md inline-flex items-center gap-2"
                      title={editingId ? '현재 지문·유형으로 Claude가 새 초안 작성 (기존 JSON 덮어씀)' : 'passages 원문 + 위 유형으로 Claude가 1문항 JSON 초안 작성'}
                    >
                      {draftLoading && (
                        <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                      )}
                      {draftLoading ? 'Claude 작성 중…' : editingId ? 'Claude로 초안 다시 생성' : 'Claude로 초안 생성'}
                    </button>
                    <button
                      type="button"
                      disabled={draftLoading || saving || explanationOnlyLoading}
                      onClick={() => void runGenerateExplanationOnly()}
                      className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold disabled:opacity-50 shadow-md inline-flex items-center gap-2"
                      title="지문·발문·선택지·정답은 그대로 두고 Explanation(한국어 해설)만 Claude가 생성해 덮어씁니다."
                    >
                      {explanationOnlyLoading && (
                        <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                      )}
                      {explanationOnlyLoading ? '해설 생성 중…' : 'Claude로 해설만 수정'}
                    </button>
                  </div>
                </div>
                <input
                  value={draftUserHint}
                  onChange={(e) => setDraftUserHint(e.target.value)}
                  placeholder="AI 추가 지시 (선택)"
                  className="w-full mb-2 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500"
                />
                <p className="text-[11px] text-slate-500 mb-1">
                  「유형별 AI 프롬프트」에 저장한 지침이 위 유형에 자동 반영됩니다.{' '}
                  <code className="text-slate-400">ANTHROPIC_API_KEY</code> 필요 (미설정 시 버튼은
                  오류를 표시합니다). {editingId && '수정 시에는 기존 question_data를 새 초안으로 덮어씁니다.'}
                </p>
                {draftError && (
                  <div className="mb-2 p-2 rounded-lg bg-red-950/50 border border-red-800/40 text-red-300 text-xs whitespace-pre-wrap">
                    {draftError}
                  </div>
                )}
                <p className="text-[11px] text-slate-500 mb-1">
                  같은 교재·출처·passage·type 조합에서는 유형당 총 {DEFAULT_QUESTIONS_PER_VARIANT_TYPE}문항(행)이 되도록 NumQuestion·순서를
                  맞추면 됩니다.
                </p>
                {(() => {
                  let para = '';
                  try {
                    const q = JSON.parse(questionJson) as Record<string, unknown>;
                    para = typeof q?.Paragraph === 'string' ? q.Paragraph : '';
                  } catch {
                    /* invalid JSON while typing */
                  }
                  return para ? (
                    <div className="mb-3 rounded-lg bg-slate-900/80 border border-slate-600 p-3">
                      <p className="text-[11px] text-slate-500 mb-2 font-semibold uppercase tracking-wider">Paragraph 미리보기</p>
                      <div className="text-sm text-slate-200 leading-relaxed max-h-40 overflow-y-auto">
                        <ParagraphWithUnderline text={para} />
                      </div>
                    </div>
                  ) : null;
                })()}
                <textarea
                  ref={questionJsonTextareaRef}
                  value={questionJson}
                  onChange={(e) => setQuestionJson(e.target.value)}
                  rows={18}
                  className="w-full bg-slate-950 border border-violet-900/50 rounded-lg px-3 py-2 text-xs text-green-200 font-mono"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 font-bold disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {saving && (
                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                  )}
                  {saving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {batchCreatingAll && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4">
          <div className="bg-slate-800 border border-violet-600/60 rounded-2xl shadow-2xl px-8 py-6 max-w-md w-full text-center">
            <div className="inline-block w-12 h-12 border-4 border-slate-600 border-t-violet-400 rounded-full animate-spin mb-4" />
            <p className="text-lg font-bold text-white mb-1">한번에 먼저 생성 중</p>
            {batchProgress && (
              <p className="text-slate-300 text-sm">
                {batchProgress.current}/{batchProgress.total}건 · 현재: {batchProgress.label} {batchProgress.type}
              </p>
            )}
            <p className="text-slate-500 text-xs mt-2">완료 후 아래 목록에서 검수하세요.</p>
          </div>
        </div>
      )}
    </div>
  );
}
