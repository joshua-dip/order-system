'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BOOK_VARIANT_QUESTION_TYPES,
  DEFAULT_QUESTIONS_PER_VARIANT_TYPE,
} from '@/lib/book-variant-types';
import { normalizeMockVariantSourceLabel } from '@/lib/mock-variant-source-normalize';
import { buildEnglishExamSolveUserPrompt } from '@/lib/generated-question-solve-prompt';
import { HARD_INSERTION_PROMPT } from '@/lib/hard-insertion-generator';
import { OpenIdFromQuery } from './OpenIdFromQuery';
import { OpenQCountFromQuery } from './OpenQCountFromQuery';
import { QuestionStatsModal } from './QuestionStatsModal';

const VALIDATE_EXCLUDE_STORAGE = 'admin-gq-validate-excluded-types';
/** 「+ 같은유형」 AI 초안 — 유형(type)별 추가 지침 (브라우저 저장) */
const TYPE_VARIANT_PROMPTS_STORAGE = 'admin-gq-variant-prompts-by-type';
const GQ_DENSITY_STORAGE_KEY = 'admin-gq-table-density';
const GQ_COL_STORAGE_NARROW = 'admin-gq-cols-v6-narrow';
const GQ_COL_STORAGE_WIDE = 'admin-gq-cols-v6-wide';
/** 구버전 한 키 — 넓게 보기 마이그레이션용 */
const GQ_COL_STORAGE_LEGACY = 'admin-generated-questions-col-widths-v5';

/** 열 순서: 작업, 등록일시, 교재, 유형, Paragraph, Options, Explanation, 출처, passage, 발문 */
const GQ_COL_MINS = [72, 118, 130, 100, 160, 200, 200, 88, 88, 180];
const GQ_COL_MAXS = [220, 240, 480, 280, 560, 720, 720, 280, 320, 800];
const GQ_COL_DEFAULTS_NARROW = [72, 124, 132, 100, 190, 220, 220, 88, 96, 180];
const GQ_COL_DEFAULTS_WIDE = [104, 140, 200, 140, 280, 320, 320, 120, 140, 260];

/** 변형도 분석 필터와 동일한 쿼리 문자열 (목록 페이지·API·모달 내 목록 공통) */
function buildVariationBucketQueryString(opts: {
  textbook: string;
  typeKey: string;
  bucket: number | 'all';
}): string {
  const sp = new URLSearchParams();
  if (opts.textbook.trim()) sp.set('textbook', opts.textbook.trim());
  if (opts.typeKey === '—') sp.set('typeEmpty', '1');
  else if (opts.typeKey.trim()) sp.set('type', opts.typeKey.trim());
  sp.set('bucket', String(opts.bucket));
  return sp.toString();
}

/** 변형도 분석 → 구간별 문항 목록 페이지 URL */
function buildVariationBucketListUrl(opts: {
  textbook: string;
  typeKey: string;
  bucket: number | 'all';
}): string {
  return `/admin/generated-questions/variation-bucket?${buildVariationBucketQueryString(opts)}`;
}

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

/** DB created_at(ISO·Date 문자열) → 한국 시간 표시 */
function formatDbCreatedAt(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Asia/Seoul',
  }).format(d);
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

/** HTML에서 태그만 제거한 평문 (미리보기 분할·검증용) */
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

/**
 * plain 문자열 인덱스 [plainStart, plainEnd) 에 대응하는 HTML 구간 (태그 보존).
 */
function sliceHtmlByPlainRange(html: string, plainStart: number, plainEnd: number): string {
  let pi = 0;
  let i = 0;
  let h0 = -1;
  let h1 = -1;
  while (i < html.length) {
    if (html[i] === '<') {
      const e = html.indexOf('>', i);
      if (e < 0) break;
      i = e + 1;
      continue;
    }
    if (pi === plainStart) h0 = i;
    pi++;
    i++;
    if (pi === plainEnd) {
      h1 = i;
      break;
    }
  }
  if (h0 < 0) return '';
  if (h1 < 0) h1 = html.length;
  return html.slice(h0, h1);
}

/**
 * passages.content.sentences_en 과 Paragraph 평문이 순서대로 일치할 때만 HTML 조각으로 분할.
 * 어법용 ① <u> 삽입 등으로 평문이 어긋나면 null → 아래 휴리스틱 분할로 대체.
 */
function trySplitParagraphByDbSentences(paragraphHtml: string, dbSents: string[]): string[] | null {
  const sents = dbSents.map((s) => s.trim()).filter(Boolean);
  if (sents.length === 0) return null;
  const plain = stripHtmlTags(paragraphHtml);
  let pCursor = 0;
  while (pCursor < plain.length && /\s/.test(plain[pCursor]!)) pCursor++;

  const htmlChunks: string[] = [];
  for (const needle of sents) {
    const idx = plain.indexOf(needle, pCursor);
    if (idx < 0) return null;
    const gap = plain.slice(pCursor, idx);
    if (gap.trim() !== '') return null;
    const end = idx + needle.length;
    htmlChunks.push(sliceHtmlByPlainRange(paragraphHtml, idx, end));
    pCursor = end;
  }
  while (pCursor < plain.length && /\s/.test(plain[pCursor]!)) pCursor++;
  if (pCursor !== plain.length) return null;
  return htmlChunks;
}

/**
 * Paragraph 미리보기용 휴리스틱: 구두점 + 따옴표 뒤 공백에서 분리 (<u> 유지).
 */
function splitParagraphIntoPreviewSentences(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const parts = t
    .split(/(?<=[.!?。])["'」』]?\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [t];
}

const GRAMMAR_MARKS = ['①', '②', '③', '④', '⑤'] as const;

function isHamyiQuestionType(formType: string, questionJson: string): boolean {
  let cat = '';
  try {
    const q = JSON.parse(questionJson) as Record<string, unknown>;
    cat = typeof q.Category === 'string' ? q.Category.trim() : '';
  } catch {
    /* ignore */
  }
  for (const s of [formType.trim(), cat]) {
    if (s === '함의' || s.includes('함의')) return true;
  }
  return false;
}

/** 함의·어법 등 Paragraph에 `<u>` 밑줄 태그를 쓰는 유형 — JSON 편집 도우미 표시 */
function isHamyiOrGrammarQuestionType(formType: string, questionJson: string): boolean {
  return isHamyiQuestionType(formType, questionJson) || isGrammarQuestionType(formType, questionJson);
}

function isGrammarQuestionType(formType: string, questionJson: string): boolean {
  let cat = '';
  try {
    const q = JSON.parse(questionJson) as Record<string, unknown>;
    cat = typeof q.Category === 'string' ? q.Category.trim() : '';
  } catch {
    /* ignore */
  }
  for (const s of [formType.trim(), cat]) {
    if (s === '어법' || s.includes('어법')) return true;
  }
  return false;
}

function normalizeCircledAnswer(raw: string | undefined): string | null {
  const t = String(raw ?? '').trim();
  const d = t.match(/^([1-5])$/);
  if (d) {
    const i = parseInt(d[1]!, 10) - 1;
    return GRAMMAR_MARKS[i] ?? null;
  }
  if (/^[①②③④⑤]$/.test(t)) return t;
  return null;
}

/** 원문 평문에 밑줄 표기와 동일한 구절이 있는지 (공백·대소문자 정규화, 단어 1개는 \\b 경계) */
function phraseAppearsInOriginal(needle: string, haystack: string): boolean {
  const n = needle.replace(/\s+/g, ' ').trim();
  const h = haystack.replace(/\s+/g, ' ');
  if (!n || !h) return false;
  const hl = h.toLowerCase();
  const nl = n.toLowerCase();
  if (nl.includes(' ')) {
    return hl.includes(nl);
  }
  if (nl.length < 2) return false;
  try {
    const escaped = nl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(hl);
  } catch {
    return hl.includes(nl);
  }
}

/** 어법: ①~⑤ 밑줄·Options ### 구간 점검 + 선택 시 원문(passage)과 동일 표기 안내 */
function validateGrammarUnderlineOptions(
  paragraph: string,
  options: string,
  extra?: {
    /** 원문 미리보기 텍스트(HTML 가능) — 없으면 원문 비교 생략 */
    originalPassage?: string | null;
    /** JSON CorrectAnswer 예: "⑤" 또는 "5" */
    correctAnswerRaw?: string;
  }
): { ok: boolean; issues: string[]; originalNotes: string[]; originalCompareSkipped?: string } {
  const issues: string[] = [];
  const originalNotes: string[] = [];
  const re = /([①②③④⑤])\s*<u>([^<]*)<\/u>/gi;
  const found: { mark: string; word: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(paragraph)) !== null) {
    found.push({ mark: m[1]!, word: (m[2] ?? '').trim() });
  }
  if (found.length !== 5) {
    issues.push(`밑줄 ① <u>…</u> 형태는 5개여야 합니다 (현재 ${found.length}개).`);
  }
  for (let i = 0; i < 5; i++) {
    const mk = GRAMMAR_MARKS[i];
    if (!found[i] || found[i]!.mark !== mk) {
      issues.push(`밑줄 번호가 지문 앞→뒤 순서로 ①②③④⑤가 아닙니다 (${i + 1}번째 확인).`);
      break;
    }
  }
  const optParts =
    typeof options === 'string'
      ? options
          .split(/###/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  if (optParts.length !== 5) {
    issues.push(`Options는 ### 로 구분된 보기 5개를 권장합니다 (현재 ${optParts.length}개).`);
  }
  const plainPara = stripHtmlTags(paragraph);
  for (let i = 0; i < Math.min(5, found.length); i++) {
    const w = found[i]!.word;
    if (!w) {
      issues.push(`${GRAMMAR_MARKS[i]} 밑줄 안 단어가 비어 있습니다.`);
      continue;
    }
    if (!plainPara.includes(w)) {
      issues.push(`${GRAMMAR_MARKS[i]} 밑줄 "${w}"(이)가 지문 평문에 나타나지 않습니다.`);
    }
  }
  for (let i = 0; i < Math.min(5, optParts.length, found.length); i++) {
    const stem = optParts[i]!.replace(/^[①②③④⑤]\s*/, '').trim();
    const w = found[i]!.word;
    if (!stem || !w) continue;
    if (stem !== w && !optParts[i]!.includes(w)) {
      issues.push(
        `보기 ${GRAMMAR_MARKS[i]}("${stem.slice(0, 24)}${stem.length > 24 ? '…' : ''}")와 밑줄 단어 "${w}"가 다릅니다.`
      );
    }
  }

  let originalCompareSkipped: string | undefined;
  const origSrc = extra?.originalPassage;
  if (origSrc == null || !String(origSrc).trim()) {
    originalCompareSkipped = '원문(passage) 미리보기가 없어 밑줄·원문 동일 여부는 비교하지 않았습니다.';
  } else {
    const origPlain = stripHtmlTags(String(origSrc)).replace(/\s+/g, ' ').trim();
    if (!origPlain) {
      originalCompareSkipped = '원문 내용이 비어 있어 동일 여부를 비교하지 않았습니다.';
    } else {
      const correctMark = normalizeCircledAnswer(extra?.correctAnswerRaw);
      for (let i = 0; i < Math.min(5, found.length); i++) {
        const mark = found[i]!.mark;
        const w = found[i]!.word.trim();
        if (!w || w.length < 2) continue;
        if (!phraseAppearsInOriginal(w, origPlain)) continue;
        const isCorrectSlot = correctMark != null && mark === correctMark;
        if (isCorrectSlot) {
          originalNotes.push(
            `${mark} 「${w}」 — 원문에도 같은 표기가 있습니다. 정답(CorrectAnswer)으로 지정된 번호인데 밑줄이 원문과 다르지 않다면, 실제로는 ‘틀린 어법’이 아닐 수 있으니 지문·정답·해설을 확인하세요.`
          );
        } else {
          originalNotes.push(
            `${mark} 「${w}」 — 원문에도 같은 표기가 있습니다. (오답 위치로 쓰려면 원문과 다른 형태로 바꾸는 것이 일반적입니다.)`
          );
        }
      }
    }
  }

  return { ok: issues.length === 0, issues, originalNotes, originalCompareSkipped };
}

/** 변형문제 수정 등: 문장마다 작은 번호를 붙여 Claude 지시(예: 3번 문장) 시 참조하기 쉽게 함 */
function ParagraphPreviewWithSentenceNumbers({
  text,
  dbSentences,
}: {
  text: string;
  /** passages 문장구분(영) — 평문이 Paragraph와 순서대로 같을 때만 번호 분할에 사용 */
  dbSentences?: string[] | null;
}) {
  const fromDb =
    dbSentences && dbSentences.length > 0 ? trySplitParagraphByDbSentences(text, dbSentences) : null;
  const sentences = fromDb ?? splitParagraphIntoPreviewSentences(text);
  const usedDb = fromDb != null;
  const dbTried = (dbSentences?.length ?? 0) > 0;
  return (
    <div className="w-full">
      {usedDb && (
        <p className="text-[10px] text-emerald-400/95 mb-1.5">문장 번호: 원문 passages · 문장구분(영) 기준</p>
      )}
      {!usedDb && dbTried && (
        <p className="text-[10px] text-amber-400/90 mb-1.5">
          문장구분(영) 평문과 지문이 순서대로 일치하지 않아, 구두점·따옴표 뒤 공백 휴리스틱으로 나눕니다.
        </p>
      )}
      <span className="inline-block w-full whitespace-pre-wrap break-words">
        {sentences.map((sent, idx) => (
          <span key={idx} className="inline">
            <span
              className="inline text-[9px] font-bold tabular-nums align-super mr-0.5 select-none text-lime-400 drop-shadow-[0_0_6px_rgba(163,230,53,0.95)]"
              title={`문장 ${idx + 1}`}
            >
              {idx + 1}
            </span>
            <ParagraphWithUnderline text={sent} className="inline" />
            {idx < sentences.length - 1 ? ' ' : null}
          </span>
        ))}
      </span>
    </div>
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
  status?: string;
  /** variant: 변형문제 generated_questions / narrative: 서술형 narrative_questions */
  record_kind?: 'variant' | 'narrative';
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
  created_at?: string | null;
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
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPassageId, setFilterPassageId] = useState('');
  const [filterQ, setFilterQ] = useState('');
  /** default: 교재·출처·유형 / newest: DB 입력(생성) 최신순 */
  const [filterSortOrder, setFilterSortOrder] = useState<'default' | 'newest'>('default');
  /** 목록 데이터: 변형문제만 / 서술형만 / 병합 */
  const [listDataScope, setListDataScope] = useState<'variant' | 'narrative' | 'all'>('all');
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<Row[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** 서술형(narrative_questions) 상세는 읽기 전용 */
  const [narrativeReadOnly, setNarrativeReadOnly] = useState(false);
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
  /** passages.content.sentences_en — Paragraph 번호 분할에 사용 */
  const [passageSentencesEn, setPassageSentencesEn] = useState<string[] | null>(null);
  /** 새 변형문제: 교재별 passages 목록(드롭다운) */
  const [passagePickerItems, setPassagePickerItems] = useState<
    Array<{ id: string; label: string; sourceForDb: string }>
  >([]);
  const [passagePickerLoading, setPassagePickerLoading] = useState(false);
  const questionJsonTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = useState({
    textbook: '',
    passage_id: '',
    source: '',
    type: '',
    option_type: 'English',
    difficulty: '중',
    status: '완료',
    error_msg: '',
  });
  const [questionJson, setQuestionJson] = useState(DEFAULT_QUESTION_JSON);
  /** 저장 직후 해당 문제 행으로 스크롤하기 위한 id (문제보러가기 버튼 표시) */
  const [goToRowId, setGoToRowId] = useState<string | null>(null);
  /** 변형도 구간 문항에서 「열기」로 들어온 뒤 저장 시 이 경로로 router.push */
  const bucketReturnAfterSaveRef = useRef<string | null>(null);
  /** 신규 저장 직후 「이어서 만들기」에 복원할 폼 스냅샷 */
  const postSaveFormSnapshotRef = useRef<{
    textbook: string;
    passage_id: string;
    source: string;
    type: string;
    option_type: string;
    difficulty: string;
    status: string;
    error_msg: string;
  } | null>(null);
  const [postSaveContinueOpen, setPostSaveContinueOpen] = useState(false);

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
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);

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
  const [bucketAdvice, setBucketAdvice] = useState<{ type: string; bucket: number } | null>(null);
  /** 변형도 분석 모달 안에서 구간 숫자 클릭 시 표시하는 문항 목록 */
  const [variationInlineBucket, setVariationInlineBucket] = useState<{ typeKey: string; bucket: number } | null>(null);
  const [variationInlineBucketLoading, setVariationInlineBucketLoading] = useState(false);
  const [variationInlineBucketError, setVariationInlineBucketError] = useState<string | null>(null);
  const [variationInlineBucketRows, setVariationInlineBucketRows] = useState<
    {
      _id: string;
      textbook: string;
      source: string;
      type: string;
      variation_pct: number;
      paragraphPreview: string;
      created_at: unknown;
      passage_id: string | null;
    }[]
  >([]);
  const [variationInlineBucketMeta, setVariationInlineBucketMeta] = useState<{
    scanned: number;
    maxScan: number;
    maxResults: number;
    scanStoppedReason: string;
    bucketLabel: string;
  } | null>(null);
  const [variationInlineListVersion, setVariationInlineListVersion] = useState(0);
  const [variationAnalysisError, setVariationAnalysisError] = useState<string | null>(null);
  const [variationAnalysisData, setVariationAnalysisData] = useState<{
    totalScanned: number;
    totalMatching?: number | null;
    scanLimit?: number;
    scanCap?: number;
    scanCapped?: boolean;
    filters: { textbook: string | null; type: string | null };
    byType: Record<
      string,
      { count: number; avg: number; min: number; max: number; distribution: number[] }
    >;
    /** 서버가 countDocuments를 건너뜀 */
    totalCountSkipped?: boolean;
  } | null>(null);
  /** 변형도 분석 최대 스캔 건수(서버 상한 내) */
  const [variationScanLimit, setVariationScanLimit] = useState(25_000);
  /** false면 총 건수 count 생략 → 훨씬 빠름 */
  const [variationIncludeTotalCount, setVariationIncludeTotalCount] = useState(false);
  /** 변형도 분석 모달 — 동일 필터 DB 문항 수(preview-count API) */
  const [variationDbCount, setVariationDbCount] = useState<number | null>(null);
  const [variationDbScanCap, setVariationDbScanCap] = useState<number | null>(null);
  const [variationDbCountLoading, setVariationDbCountLoading] = useState(false);
  const [variationDbCountError, setVariationDbCountError] = useState<string | null>(null);

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
  /** Explanation: nan 토큰·빈 해설·비문자 타입 등 */
  const [explanationNanOpen, setExplanationNanOpen] = useState(false);
  const [explanationNanLoading, setExplanationNanLoading] = useState(false);
  const [explanationNanError, setExplanationNanError] = useState<string | null>(null);
  const [explanationNanData, setExplanationNanData] = useState<{
    filters: { textbook: string | null; type: string | null };
    totalMatched: number;
    note?: string;
    items: {
      id: string;
      textbook: string;
      source: string;
      type: string;
      reason: string;
      snippet: string;
      full: string;
    }[];
    truncated?: boolean;
  } | null>(null);
  /** nan/누락 검증 모달 — 행별 Claude 해설 작성 중(단건·일괄 공통 표시) */
  const [explanationNanWritingId, setExplanationNanWritingId] = useState<string | null>(null);
  const [explanationNanBatchRunning, setExplanationNanBatchRunning] = useState(false);
  const [explanationNanBatchProgress, setExplanationNanBatchProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [explanationNanSelectedIds, setExplanationNanSelectedIds] = useState<Set<string>>(() => new Set());
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
  /** 어법: 구조·보기 일치·원문 대비 표기 변형 */
  const [grammarVariantOpen, setGrammarVariantOpen] = useState(false);
  const [grammarVariantLoading, setGrammarVariantLoading] = useState(false);
  const [grammarVariantError, setGrammarVariantError] = useState<string | null>(null);
  const [grammarVariantData, setGrammarVariantData] = useState<{
    filters: { textbook: string | null; type: string | null };
    totalScanned: number;
    scanned: number;
    truncated: boolean;
    maxScan: number;
    withErrors: number;
    withWarningsOnly: number;
    items: {
      id: string;
      textbook: string;
      source: string;
      passageId: string | null;
      errors: { code: string; message: string }[];
      warnings: { code: string; message: string }[];
      snippet: string;
    }[];
  } | null>(null);
  /** 어법 검증: code=blocks(밑줄 5곳 형식) 오류 문항 일괄 Claude 재생성 */
  const [grammarBlocksRegenLoading, setGrammarBlocksRegenLoading] = useState(false);
  const [grammarBlocksRegenMessage, setGrammarBlocksRegenMessage] = useState<string | null>(null);
  /** 어법 검증: code=wrong_slot_equals_original(정답 칸 밑줄=원문 동일) 문항 일괄 재생성 */
  const [grammarWrongSlotRegenLoading, setGrammarWrongSlotRegenLoading] = useState(false);
  const [grammarWrongSlotRegenMessage, setGrammarWrongSlotRegenMessage] = useState<string | null>(null);
  /** 어법 재생성 배치 크기 (사용자 조정, 최대 100) */
  const [grammarRegenBatchSize, setGrammarRegenBatchSize] = useState(30);
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
    statusBreakdown?: { 완료: number; 대기: number; 검수불일치?: number; 기타: number };
  };
  type QCountScope = 'textbook' | 'order';
  /** 문제수 검증 — 변형문 status 집계 범위 */
  type QCountQuestionStatus = 'all' | '대기' | '완료' | '검수불일치';
  type QCountOrderOption = {
    id: string;
    orderNumber: string | null;
    createdAt: string;
    orderMetaFlow: string | null;
    hasOrderMeta: boolean;
  };
  /** 문제수 검증 — 미충족·무관문 목록 최대 행(API maxListRows, 상한 35k) */
  const [qCountMaxListRows, setQCountMaxListRows] = useState(12_000);
  const [statsOpen, setStatsOpen] = useState(false);
  const [qCountOpen, setQCountOpen] = useState(false);
  const [qCountLoading, setQCountLoading] = useState(false);
  const [qCountError, setQCountError] = useState<string | null>(null);
  const [qCountScope, setQCountScope] = useState<QCountScope>('textbook');
  const [qCountQuestionStatus, setQCountQuestionStatus] = useState<QCountQuestionStatus>('all');
  const [qCountOrderId, setQCountOrderId] = useState('');
  const [qCountOrders, setQCountOrders] = useState<QCountOrderOption[]>([]);
  const [qCountOrdersLoading, setQCountOrdersLoading] = useState(false);
  /** 문제수 검증 모달 — 교재/주문 선택 시 DB 규모 미리보기(preview-stats API) */
  const [qCountPreviewLoading, setQCountPreviewLoading] = useState(false);
  const [qCountPreviewError, setQCountPreviewError] = useState<string | null>(null);
  const [qCountPreviewStats, setQCountPreviewStats] = useState<Record<string, unknown> | null>(null);
  const [qCountData, setQCountData] = useState<{
    scope: QCountScope;
    textbook: string;
    questionStatusScope: QCountQuestionStatus;
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
    pendingReviewTotal?: number;
    needCreateShortBySum?: number;
    needCreateFromEmptyPassagesTotal?: number;
    needCreateGrandTotal?: number;
    pendingInScopeTotal?: number;
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
  /** 문제수 검증 스냅샷(MongoDB question_count_validation_snapshots) */
  const [qCountSnapshotNote, setQCountSnapshotNote] = useState('');
  const [qCountSnapshotSaving, setQCountSnapshotSaving] = useState(false);
  const [qCountSnapshotMsg, setQCountSnapshotMsg] = useState<string | null>(null);
  const [qCountSnapshots, setQCountSnapshots] = useState<
    Array<{
      id: string;
      saved_at: string | null;
      saved_by_login_id: string | null;
      note: string | null;
      query: {
        scope: string;
        textbook: string;
        order_id: string | null;
        required_per_type: number;
        question_status?: string;
      };
      summary: Record<string, unknown> | null;
    }>
  >([]);
  const [qCountSnapshotsLoading, setQCountSnapshotsLoading] = useState(false);
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

  const ORDER_LOGS_PAGE_SIZE = 50;
  type OrderProcessingLogRow = {
    id: string;
    batch_id: string;
    order_id: string;
    order_number: string;
    textbook: string;
    status: string;
    reason: string;
    processed_at: string | null;
    shortage_count: number;
    shortage_preview: unknown[];
    needCreateGrandTotal: number | null;
    pendingReviewTotal: number | null;
    questionStatusScope: string | null;
    validationEngineVersion: string | null;
    order_data: Record<string, unknown> | null;
  };
  const [orderLogsOpen, setOrderLogsOpen] = useState(false);
  const [orderLogsLoading, setOrderLogsLoading] = useState(false);
  const [orderLogsError, setOrderLogsError] = useState<string | null>(null);
  const [orderLogsTotal, setOrderLogsTotal] = useState(0);
  const [orderLogsSkip, setOrderLogsSkip] = useState(0);
  const [orderLogsItems, setOrderLogsItems] = useState<OrderProcessingLogRow[]>([]);
  const [orderLogsStatusFilter, setOrderLogsStatusFilter] = useState('');
  const [orderLogsOrderNumberFilter, setOrderLogsOrderNumberFilter] = useState('');

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
    if (filterDifficulty) params.set('difficulty', filterDifficulty);
    if (filterStatus) params.set('status', filterStatus);
    if (filterPassageId.trim()) params.set('passage_id', filterPassageId.trim());
    if (filterQ) params.set('q', filterQ);
    if (filterSortOrder === 'newest') params.set('sort', 'newest');
    params.set('data_scope', listDataScope);
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
  }, [filterTextbook, filterType, filterDifficulty, filterStatus, filterPassageId, filterQ, filterSortOrder, listDataScope, page, limit]);

  useEffect(() => {
    if (!user) return;
    fetchList();
  }, [user, fetchList]);

  const openCreate = () => {
    postSaveFormSnapshotRef.current = null;
    setPostSaveContinueOpen(false);
    bucketReturnAfterSaveRef.current = null;
    setNarrativeReadOnly(false);
    setEditingId(null);
    setDraftError(null);
    setDraftUserHint('');
    setDraftGenerated(false);
    setPassagePreview(null);
    setPassageSentencesEn(null);
    setForm({
      textbook: filterTextbook || '',
      passage_id: filterPassageId.trim() || '',
      source: '',
      type: filterType || '',
      option_type: 'English',
      difficulty: '중',
      status: '완료',
      error_msg: '',
    });
    setQuestionJson(DEFAULT_QUESTION_JSON);
    setModalOpen(true);
  };

  /** 문제수 검증 — 부족 셀 클릭 시 해당 지문·유형으로 새 변형문제 모달 */
  const openCreateForQCountShortage = (r: QCountUnderRow, textbook: string) => {
    postSaveFormSnapshotRef.current = null;
    setPostSaveContinueOpen(false);
    bucketReturnAfterSaveRef.current = null;
    console.log('[openCreateForQCountShortage]', { label: r.label, type: r.type, passageId: r.passageId?.slice(0, 8), textbook });
    const tb = (textbook || '').trim();
    if (!tb || !r.passageId.trim()) {
      console.warn('[openCreateForQCountShortage] early return: no textbook or passageId', { tb: !!tb, passageId: r.passageId?.trim() });
      return;
    }
    // 문제수 검증 모달은 닫지 않음 — 저장 후에도 검증 결과·변형도 분석을 다시 돌리지 않도록 유지 (편집 모달 z-[60]이 더 위)
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
      difficulty: '중',
      status: '완료',
      error_msg: '',
    });
    setQuestionJson(DEFAULT_QUESTION_JSON);
    setDraftError(null);
    setDraftUserHint('');
    setDraftGenerated(false);
    setPassagePreview(null);
    setPassageSentencesEn(null);
    setPage(1);
    setModalOpen(true);
    if (types.length === 0) fetchMeta();
  };

  /** passage_id 유효 시 해당 교재 원문(passages) 로드 → 원문 미리보기 */
  useEffect(() => {
    if (!modalOpen || !form.passage_id.trim()) {
      setPassagePreview(null);
      setPassageSentencesEn(null);
      return;
    }
    const pid = form.passage_id.trim();
    if (!/^[a-f0-9]{24}$/i.test(pid)) {
      setPassagePreview(null);
      setPassageSentencesEn(null);
      return;
    }
    let cancelled = false;
    setPassagePreviewLoading(true);
    setPassagePreview(null);
    setPassageSentencesEn(null);
    fetch(`/api/admin/passages/${pid}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const item = d?.item;
        if (!item || typeof item !== 'object') {
          setPassagePreview(null);
          setPassageSentencesEn(null);
          return;
        }
        const content = item.content;
        const raw =
          (typeof content?.original === 'string' && content.original.trim()) ||
          (typeof content?.mixed === 'string' && content.mixed.trim()) ||
          (typeof content?.translation === 'string' && content.translation.trim()) ||
          '';
        setPassagePreview(raw || null);
        const se = content?.sentences_en;
        const arr = Array.isArray(se)
          ? se.filter((x: unknown): x is string => typeof x === 'string' && x.trim() !== '')
          : [];
        setPassageSentencesEn(arr.length > 0 ? arr.map((x: string) => x.trim()) : null);
      })
      .catch(() => {
        if (!cancelled) {
          setPassagePreview(null);
          setPassageSentencesEn(null);
        }
      })
      .finally(() => {
        if (!cancelled) setPassagePreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modalOpen, form.passage_id]);

  /** 새 변형문제: 선택한 교재의 passages 목록 로드 → 출처 드롭다운 */
  useEffect(() => {
    if (!modalOpen || editingId || !form.textbook.trim()) {
      setPassagePickerItems([]);
      setPassagePickerLoading(false);
      return;
    }
    let cancelled = false;
    setPassagePickerLoading(true);
    fetch(
      `/api/admin/passages?textbook=${encodeURIComponent(form.textbook.trim())}&limit=2000`,
      { credentials: 'include' }
    )
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const raw = Array.isArray(d?.items) ? d.items : [];
        const rows: Array<{ id: string; label: string; sourceForDb: string }> = [];
        for (const row of raw as Record<string, unknown>[]) {
          const id = String(row._id ?? '').trim();
          if (!id || !/^[a-f0-9]{24}$/i.test(id)) continue;
          const ch = String(row.chapter ?? '').trim();
          const num = String(row.number ?? '').trim();
          const sk = String(row.source_key ?? '').trim();
          const sourceForDb = (sk || [ch, num].filter(Boolean).join(' ').trim() || id).trim();
          const part = [ch, num].filter(Boolean).join(' · ');
          const label = sk ? (part ? `${sk} — ${part}` : sk) : part || id;
          rows.push({ id, label, sourceForDb });
        }
        rows.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
        setPassagePickerItems(rows);
      })
      .catch(() => {
        if (!cancelled) setPassagePickerItems([]);
      })
      .finally(() => {
        if (!cancelled) setPassagePickerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modalOpen, editingId, form.textbook]);

  const runGenerateDraft = async () => {
    if (!form.textbook.trim() || !form.passage_id.trim() || !form.source.trim() || !form.type.trim()) {
      setDraftError('교재·원문 지문(출처)·유형을 모두 선택·입력한 뒤 실행해 주세요.');
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
          difficulty: form.difficulty.trim(),
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

  /** JSON 편집창 선택 구간을 `<u>…</u>`로 감쌈 (직접 태그 입력 대신) */
  const wrapQuestionJsonSelectionWithUTags = useCallback(() => {
    const el = questionJsonTextareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) {
      alert('JSON 편집창에서 밑줄로 표시할 글자를 드래그로 선택한 뒤 다시 눌러 주세요.');
      return;
    }
    const body = questionJson;
    const selected = body.slice(start, end);
    if (/<\s*u\s*>/i.test(selected) || /<\s*\/\s*u\s*>/i.test(selected)) {
      alert('선택한 구간에 이미 <u> 태그가 있습니다. 제거는 「밑줄 태그 제거」를 사용하세요.');
      return;
    }
    const wrapped = `<u>${selected}</u>`;
    const next = body.slice(0, start) + wrapped + body.slice(end);
    setQuestionJson(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + wrapped.length;
      el.setSelectionRange(caret, caret);
    });
  }, [questionJson]);

  /** 선택 구간 안의 `<u>` `</u>`만 제거(내용은 유지) */
  const stripQuestionJsonSelectionUTags = useCallback(() => {
    const el = questionJsonTextareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) {
      alert('태그를 지울 구간을 드래그로 선택한 뒤 다시 눌러 주세요.');
      return;
    }
    const body = questionJson;
    const selected = body.slice(start, end);
    const stripped = selected.replace(/<\/?u\s*>/gi, '');
    if (stripped === selected) {
      alert('선택한 구간에 <u> 태그가 없습니다.');
      return;
    }
    const next = body.slice(0, start) + stripped + body.slice(end);
    setQuestionJson(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + stripped.length;
      el.setSelectionRange(caret, caret);
    });
  }, [questionJson]);

  /** 어법: 선택한 표현을 `① <u>…</u>` 형태로 삽입(동그라미와 태그 사이 공백 1칸) */
  const wrapQuestionJsonSelectionGrammarMarkAndU = useCallback(
    (mark: (typeof GRAMMAR_MARKS)[number]) => {
      const el = questionJsonTextareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start === end) {
        alert('JSON 편집창에서 밑줄로 넣을 영문 표현만 드래그로 선택한 뒤, 원하는 번호(①~⑤)를 눌러 주세요.');
        return;
      }
      const body = questionJson;
      const selected = body.slice(start, end);
      const inner = selected.trim();
      if (!inner) {
        alert('선택한 내용이 비어 있습니다.');
        return;
      }
      if (/<\s*u\s*>/i.test(inner) || /<\s*\/\s*u\s*>/i.test(inner)) {
        alert('이미 <u> 태그가 포함된 구간입니다. 먼저 「밑줄 태그 제거」로 정리한 뒤 다시 시도하세요.');
        return;
      }
      const wrapped = `${mark} <u>${inner}</u>`;
      const next = body.slice(0, start) + wrapped + body.slice(end);
      setQuestionJson(next);
      requestAnimationFrame(() => {
        el.focus();
        const caret = start + wrapped.length;
        el.setSelectionRange(caret, caret);
      });
    },
    [questionJson]
  );

  /** 함의: Paragraph 첫 `<u>…</u>` 구절로 발문(Question) 자동 채우기 (API 초안 정규화와 동일 문구) */
  const syncHamyiQuestionFromParagraphUnderline = useCallback(() => {
    let qd: Record<string, unknown>;
    try {
      qd = JSON.parse(questionJson) as Record<string, unknown>;
    } catch {
      alert('JSON 형식이 올바른지 확인한 뒤 다시 시도하세요.');
      return;
    }
    const para = typeof qd.Paragraph === 'string' ? qd.Paragraph : '';
    const uMatch = para.match(/<u>([\s\S]*?)<\/u>/i);
    const underlinedText = uMatch ? uMatch[1]!.trim() : '';
    if (!underlinedText) {
      alert('Paragraph에 <u>…</u> 밑줄 구절이 한 곳 이상 있어야 합니다.');
      return;
    }
    const questionText = `밑줄 친 "${underlinedText}" 표현이 다음 글에서 의미하는 바로 가장 적절한 것은?`;
    const next = { ...qd, Question: questionText };
    setQuestionJson(JSON.stringify(next, null, 2));
  }, [questionJson]);

  const isVariationBucketReturnPath = useCallback((path: string) => {
    const q = path.indexOf('?');
    const pathname = q >= 0 ? path.slice(0, q) : path;
    if (pathname !== '/admin/generated-questions/variation-bucket') return false;
    if (path.startsWith('//') || path.includes('://')) return false;
    return true;
  }, []);

  const openNarrativeDetail = useCallback(async (id: string) => {
    postSaveFormSnapshotRef.current = null;
    setPostSaveContinueOpen(false);
    bucketReturnAfterSaveRef.current = null;
    setNarrativeReadOnly(true);
    setEditingId(id);
    setDraftError(null);
    setDraftUserHint('');
    setDraftGenerated(false);
    setPassagePreview(null);
    setPassageSentencesEn(null);
    try {
      const res = await fetch(`/api/admin/narrative-questions/${id}`, { credentials: 'include' });
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
        option_type: String(it.option_type ?? '서술형'),
        difficulty: String(it.difficulty ?? '중'),
        status: String(it.status ?? ''),
        error_msg: '',
      });
      const qd = it.question_data;
      setQuestionJson(qd && typeof qd === 'object' ? JSON.stringify(qd, null, 2) : '{}');
      setModalOpen(true);
    } catch {
      alert('요청 실패');
    }
  }, []);

  const openEdit = useCallback(
    async (id: string, bucketReturnPath: string | null = null) => {
    postSaveFormSnapshotRef.current = null;
    setPostSaveContinueOpen(false);
    setNarrativeReadOnly(false);
    if (bucketReturnPath && isVariationBucketReturnPath(bucketReturnPath)) {
      bucketReturnAfterSaveRef.current = bucketReturnPath;
    } else {
      bucketReturnAfterSaveRef.current = null;
    }
    setEditingId(id);
    setDraftError(null);
    setDraftUserHint('');
    setDraftGenerated(false);
    setPassagePreview(null);
    setPassageSentencesEn(null);
    try {
      const res = await fetch(`/api/admin/generated-questions/${id}`, { credentials: 'include' });
      const d = await res.json();
      if (!res.ok || !d.item) {
        alert(d.error || '불러오기 실패');
        bucketReturnAfterSaveRef.current = null;
        return;
      }
      const it = d.item as Record<string, unknown>;
      setForm({
        textbook: String(it.textbook ?? ''),
        passage_id: String(it.passage_id ?? ''),
        source: String(it.source ?? ''),
        type: String(it.type ?? ''),
        option_type: String(it.option_type ?? 'English'),
        difficulty: String(it.difficulty ?? '중'),
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
      bucketReturnAfterSaveRef.current = null;
    }
  },
    [isVariationBucketReturnPath]
  );

  const handleSave = async () => {
    if (narrativeReadOnly) {
      alert('서술형 문항은 이 화면에서 저장할 수 없습니다. (narrative_questions)');
      return;
    }
    if (!form.textbook.trim() || !form.passage_id.trim()) {
      alert(
        editingId
          ? '교재명과 passage_id(원문 문서 ObjectId)는 필수입니다.'
          : '교재와 출처(원문 지문)를 선택해 주세요. passage_id는 선택 시 자동으로 설정됩니다.'
      );
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
            difficulty: form.difficulty.trim(),
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
            difficulty: form.difficulty.trim(),
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
          setPassageSentencesEn(null);
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

      /** 변형도 구간 문항 페이지에서 「열기」로 연 경우 저장 후 동일 버킷 목록으로 복귀 */
      if (editingId && bucketReturnAfterSaveRef.current) {
        const returnPath = bucketReturnAfterSaveRef.current;
        bucketReturnAfterSaveRef.current = null;
        setGoToRowId(null);
        setEditingId(null);
        setModalOpen(false);
        router.push(returnPath);
        return;
      }

      if (!editingId) {
        setPage(1);
        postSaveFormSnapshotRef.current = { ...form };
        setModalOpen(false);
        setPostSaveContinueOpen(true);
      } else {
        setModalOpen(false);
      }
    } catch {
      alert('요청 중 오류');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const dismissPostSaveContinue = useCallback(() => {
    postSaveFormSnapshotRef.current = null;
    setPostSaveContinueOpen(false);
  }, []);

  /** 변형문제 모달: ⌘↵ 저장 · Esc는 위에 떠 있는 패널부터 닫기(풀기·프롬프트·저장 후 이어하기·모달) */
  useEffect(() => {
    let inFlight = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (batchCreatingAll) return;
        if (postSaveContinueOpen) {
          e.preventDefault();
          dismissPostSaveContinue();
          return;
        }
        if (promptPreviewOpen) {
          e.preventDefault();
          setPromptPreviewOpen(false);
          return;
        }
        if (solveOpen) {
          e.preventDefault();
          setSolveOpen(false);
          return;
        }
        if (modalOpen) {
          e.preventDefault();
          setModalOpen(false);
          setNarrativeReadOnly(false);
        }
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter') return;
      if (!modalOpen || narrativeReadOnly) return;
      e.preventDefault();
      if (inFlight) return;
      inFlight = true;
      void (async () => {
        try {
          await handleSaveRef.current();
        } finally {
          inFlight = false;
        }
      })();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    modalOpen,
    narrativeReadOnly,
    batchCreatingAll,
    postSaveContinueOpen,
    promptPreviewOpen,
    solveOpen,
    dismissPostSaveContinue,
  ]);

  const handlePostSaveContinue = () => {
    const snap = postSaveFormSnapshotRef.current;
    postSaveFormSnapshotRef.current = null;
    setPostSaveContinueOpen(false);
    if (!snap) return;
    bucketReturnAfterSaveRef.current = null;
    shortageBatchRef.current = null;
    setShortageBatch(null);
    setEditingId(null);
    setFilterTextbook(snap.textbook.trim());
    setFilterPassageId(snap.passage_id.trim());
    setFilterType(snap.type.trim());
    setForm({
      ...snap,
      error_msg: '',
    });
    setQuestionJson(DEFAULT_QUESTION_JSON);
    setDraftError(null);
    setDraftUserHint('');
    setDraftGenerated(false);
    setPassagePreview(null);
    setPassageSentencesEn(null);
    setModalOpen(true);
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

  /** 새·수정 변형문제 모달의 question_data JSON으로 Claude 풀이(기존 solve API) */
  const openSolveFromDraftModal = async () => {
    let qd: Record<string, unknown>;
    try {
      qd = JSON.parse(questionJson) as Record<string, unknown>;
      if (!qd || typeof qd !== 'object' || Array.isArray(qd)) {
        setDraftError('question_data JSON 형식을 확인해 주세요.');
        return;
      }
    } catch {
      setDraftError('question_data JSON 파싱에 실패했습니다.');
      return;
    }
    const question = String(qd.Question ?? '').trim();
    const paragraph = String(qd.Paragraph ?? '').trim();
    const options = String(qd.Options ?? '').trim();
    const correctAnswer = String(qd.CorrectAnswer ?? '').trim();
    if (!question && !paragraph) {
      setDraftError('풀기에는 발문(Question) 또는 지문(Paragraph)이 필요합니다.');
      return;
    }
    const typeStr = form.type.trim() || String(qd.Category ?? '').trim();

    setSolveOpen(true);
    setSolveResult(null);
    setSolveError(null);
    const rowData = {
      id: '__draft__',
      source: form.source.trim() || '(모달 미저장)',
      type: typeStr || '(유형 미지정)',
      textbook: form.textbook.trim() || '(교재 미선택)',
      question,
      paragraph,
      options,
      correctAnswer,
    };
    setSolveRow(rowData);
    setSolveLoading(true);
    try {
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

  /** ChatGPT 웹: Claude API와 동일한 풀이용 프롬프트를 클립보드에 넣고 chatgpt.com 새 탭 */
  const openGptWebSolveFromRow = async (row: Row) => {
    const qd = row.question_data || {};
    const prompt = buildEnglishExamSolveUserPrompt({
      questionType: row.type,
      paragraph: typeof qd.Paragraph === 'string' ? qd.Paragraph : '',
      question: typeof qd.Question === 'string' ? qd.Question : '',
      options: typeof qd.Options === 'string' ? qd.Options : '',
    });
    try {
      await navigator.clipboard.writeText(prompt);
      window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
      alert(
        '풀이용 프롬프트를 클립보드에 복사했습니다.\n열린 ChatGPT 탭에서 붙여넣기(Cmd+V / Ctrl+V) 후 전송하세요.'
      );
    } catch {
      alert(
        '클립보드 복사에 실패했습니다. HTTPS 환경인지·브라우저 클립보드 권한을 확인하거나, 문제 내용을 직접 복사해 주세요.'
      );
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
          let draftData: Record<string, unknown> = {};
          let qd: Record<string, unknown> | null = null;
          const maxDraftAttempts = 3;
          for (let attempt = 0; attempt < maxDraftAttempts; attempt++) {
            if (attempt > 0) {
              await new Promise((r) => setTimeout(r, 1000 + attempt * 800));
            }
            const draftRes = await fetch('/api/admin/generated-questions/generate-draft', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify(draftBody),
            });
            draftData = await draftRes.json();
            const candidate =
              draftRes.ok &&
              draftData?.question_data &&
              typeof draftData.question_data === 'object' &&
              !Array.isArray(draftData.question_data)
                ? (draftData.question_data as Record<string, unknown>)
                : null;
            if (candidate) {
              qd = candidate;
              break;
            }
          }
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

  useEffect(() => {
    if (!qCountOpen) {
      setQCountPreviewStats(null);
      setQCountPreviewError(null);
      setQCountPreviewLoading(false);
      return;
    }
    let cancelled = false;
    const oidOk = (id: string) => /^[a-f0-9]{24}$/i.test(id.trim());

    const run = async () => {
      if (qCountScope === 'textbook') {
        const tb = filterTextbook.trim();
        if (!tb) {
          setQCountPreviewStats(null);
          setQCountPreviewError(null);
          setQCountPreviewLoading(false);
          return;
        }
        setQCountPreviewLoading(true);
        setQCountPreviewError(null);
        try {
          const qs =
            qCountQuestionStatus !== 'all'
              ? `&questionStatus=${encodeURIComponent(qCountQuestionStatus)}`
              : '';
          const res = await fetch(
            `/api/admin/generated-questions/validate/question-counts/preview-stats?textbook=${encodeURIComponent(tb)}${qs}`,
            { credentials: 'include' }
          );
          const d = (await res.json()) as Record<string, unknown>;
          if (cancelled) return;
          if (!res.ok) {
            setQCountPreviewStats(null);
            setQCountPreviewError(typeof d.error === 'string' ? d.error : '조회 실패');
            return;
          }
          setQCountPreviewStats(d);
        } catch {
          if (!cancelled) {
            setQCountPreviewStats(null);
            setQCountPreviewError('네트워크 오류');
          }
        } finally {
          if (!cancelled) setQCountPreviewLoading(false);
        }
        return;
      }

      const oid = qCountOrderId.trim();
      if (!oidOk(oid)) {
        setQCountPreviewStats(null);
        setQCountPreviewError(null);
        setQCountPreviewLoading(false);
        return;
      }
      setQCountPreviewLoading(true);
      setQCountPreviewError(null);
      try {
        const qs =
          qCountQuestionStatus !== 'all'
            ? `&questionStatus=${encodeURIComponent(qCountQuestionStatus)}`
            : '';
        const res = await fetch(
          `/api/admin/generated-questions/validate/question-counts/preview-stats?orderId=${encodeURIComponent(oid)}${qs}`,
          { credentials: 'include' }
        );
        const d = (await res.json()) as Record<string, unknown>;
        if (cancelled) return;
        if (!res.ok) {
          setQCountPreviewStats(null);
          setQCountPreviewError(typeof d.error === 'string' ? d.error : '조회 실패');
          return;
        }
        setQCountPreviewStats(d);
      } catch {
        if (!cancelled) {
          setQCountPreviewStats(null);
          setQCountPreviewError('네트워크 오류');
        }
      } finally {
        if (!cancelled) setQCountPreviewLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [qCountOpen, qCountScope, filterTextbook, qCountOrderId, qCountQuestionStatus]);

  function openQCountModal(prefillOrderId?: string | null) {
    const oid = (prefillOrderId ?? '').trim();
    const isPrefill = Boolean(oid && /^[a-f0-9]{24}$/i.test(oid));
    if (isPrefill) {
      setQCountScope('order');
      setQCountOrderId(oid);
      setQCountData(null);
    } else {
      setQCountData((prev) => {
        if (!prev) return null;
        if (prev.scope !== qCountScope) return null;
        if (qCountScope === 'textbook') {
          if (prev.textbook !== filterTextbook.trim()) return null;
        } else if ((prev.order?.id ?? '') !== qCountOrderId.trim()) {
          return null;
        }
        return prev;
      });
    }
    setQCountOpen(true);
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
  }

  const fetchOrderLogs = useCallback(
    async (skip: number) => {
      setOrderLogsLoading(true);
      setOrderLogsError(null);
      try {
        const sp = new URLSearchParams();
        sp.set('limit', String(ORDER_LOGS_PAGE_SIZE));
        sp.set('skip', String(skip));
        if (orderLogsStatusFilter.trim()) sp.set('status', orderLogsStatusFilter.trim());
        if (orderLogsOrderNumberFilter.trim()) sp.set('order_number', orderLogsOrderNumberFilter.trim());
        const res = await fetch(`/api/admin/order-processing-logs?${sp}`, { credentials: 'include' });
        const d = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          setOrderLogsError(typeof d.error === 'string' ? d.error : '조회 실패');
          setOrderLogsItems([]);
          setOrderLogsTotal(0);
          return;
        }
        setOrderLogsTotal(typeof d.total === 'number' ? d.total : 0);
        setOrderLogsSkip(typeof d.skip === 'number' ? d.skip : skip);
        setOrderLogsItems(Array.isArray(d.items) ? (d.items as OrderProcessingLogRow[]) : []);
      } catch {
        setOrderLogsError('네트워크 오류');
        setOrderLogsItems([]);
        setOrderLogsTotal(0);
      } finally {
        setOrderLogsLoading(false);
      }
    },
    [orderLogsStatusFilter, orderLogsOrderNumberFilter]
  );

  const openOrderLogsModal = useCallback(() => {
    setOrderLogsOpen(true);
    void fetchOrderLogs(0);
  }, [fetchOrderLogs]);

  const openVariationAnalysisModal = () => {
    setVariationAnalysisOpen(true);
    // 이전 집계 결과 유지 — 수정·저장 후 다시 열어도 긴 재분석 없이 이어서 작업 가능
    setVariationAnalysisData((prev) => {
      if (!prev) return null;
      const tbNow = filterTextbook.trim();
      const tyNow = filterType.trim();
      const tbPrev = (prev.filters.textbook ?? '').trim();
      const tyPrev = (prev.filters.type ?? '').trim();
      if (tbPrev !== tbNow || tyPrev !== tyNow) return null;
      return prev;
    });
    setVariationAnalysisError(null);
    if (textbooks.length === 0 || types.length === 0) fetchMeta();
  };

  useEffect(() => {
    if (!variationAnalysisOpen) {
      setVariationDbCount(null);
      setVariationDbScanCap(null);
      setVariationDbCountLoading(false);
      setVariationDbCountError(null);
      setVariationInlineBucket(null);
      setVariationInlineBucketRows([]);
      setVariationInlineBucketMeta(null);
      setVariationInlineBucketError(null);
      setVariationInlineBucketLoading(false);
      setBucketAdvice(null);
      return;
    }
    let cancelled = false;
    setVariationDbCountLoading(true);
    setVariationDbCountError(null);
    const params = new URLSearchParams();
    if (filterTextbook.trim()) params.set('textbook', filterTextbook.trim());
    if (filterType.trim()) params.set('type', filterType.trim());
    void fetch(
      `/api/admin/generated-questions/analyze/variation/preview-count?${params}`,
      { credentials: 'include' }
    )
      .then(async (r) => {
        const d = (await r.json()) as Record<string, unknown>;
        if (cancelled) return;
        if (!r.ok) {
          setVariationDbCount(null);
          setVariationDbScanCap(null);
          setVariationDbCountError(typeof d.error === 'string' ? d.error : '건수 조회 실패');
          return;
        }
        setVariationDbCount(typeof d.matchingCount === 'number' ? d.matchingCount : null);
        setVariationDbScanCap(typeof d.scanCap === 'number' ? d.scanCap : null);
        setVariationDbCountError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setVariationDbCount(null);
          setVariationDbScanCap(null);
          setVariationDbCountError('네트워크 오류');
        }
      })
      .finally(() => {
        if (!cancelled) setVariationDbCountLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [variationAnalysisOpen, filterTextbook, filterType]);

  const prevModalOpenForInlineBucketRef = useRef(modalOpen);
  useEffect(() => {
    if (
      prevModalOpenForInlineBucketRef.current &&
      !modalOpen &&
      variationInlineBucket &&
      variationAnalysisOpen
    ) {
      setVariationInlineListVersion((v) => v + 1);
    }
    prevModalOpenForInlineBucketRef.current = modalOpen;
  }, [modalOpen, variationInlineBucket, variationAnalysisOpen]);

  useEffect(() => {
    if (!variationAnalysisOpen || !variationInlineBucket || !variationAnalysisData) return;
    let cancelled = false;
    const qs = buildVariationBucketQueryString({
      textbook: variationAnalysisData.filters.textbook ?? '',
      typeKey: variationInlineBucket.typeKey,
      bucket: variationInlineBucket.bucket,
    });
    setVariationInlineBucketLoading(true);
    setVariationInlineBucketError(null);
    void fetch(`/api/admin/generated-questions/analyze/variation/bucket?${qs}`, { credentials: 'include' })
      .then(async (r) => {
        const d = (await r.json()) as Record<string, unknown>;
        if (!r.ok) throw new Error(typeof d.error === 'string' ? d.error : '요청 실패');
        return d;
      })
      .then((d) => {
        if (cancelled) return;
        setVariationInlineBucketRows(
          Array.isArray(d.items)
            ? (d.items as {
                _id: string;
                textbook: string;
                source: string;
                type: string;
                variation_pct: number;
                paragraphPreview: string;
                created_at: unknown;
                passage_id: string | null;
              }[])
            : []
        );
        setVariationInlineBucketMeta({
          scanned: typeof d.scanned === 'number' ? d.scanned : 0,
          maxScan: typeof d.maxScan === 'number' ? d.maxScan : 0,
          maxResults: typeof d.maxResults === 'number' ? d.maxResults : 500,
          scanStoppedReason: String(d.scanStoppedReason ?? ''),
          bucketLabel: String(d.bucketLabel ?? ''),
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setVariationInlineBucketRows([]);
          setVariationInlineBucketMeta(null);
          setVariationInlineBucketError(e instanceof Error ? e.message : '불러오기 실패');
        }
      })
      .finally(() => {
        if (!cancelled) setVariationInlineBucketLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [variationAnalysisOpen, variationInlineBucket, variationAnalysisData, variationInlineListVersion]);

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

  const openExplanationNanModal = () => {
    setExplanationNanOpen(true);
    setExplanationNanData(null);
    setExplanationNanError(null);
    setExplanationNanSelectedIds(new Set());
    setExplanationNanLoading(true);
    const params = new URLSearchParams();
    if (filterTextbook) params.set('textbook', filterTextbook);
    if (filterType) params.set('type', filterType);
    fetch(`/api/admin/generated-questions/validate/explanation-nan?${params}`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          setExplanationNanError(d.error || '검증 실패');
          return;
        }
        setExplanationNanData({
          filters: d.filters ?? { textbook: null, type: null },
          totalMatched: d.totalMatched ?? 0,
          note: typeof d.note === 'string' ? d.note : undefined,
          items: Array.isArray(d.items)
            ? d.items.map(
                (it: { full?: string; snippet?: string; reason?: string }) => ({
                  ...it,
                  full: it.full ?? it.snippet ?? '',
                  reason: typeof it.reason === 'string' ? it.reason : '',
                })
              )
            : [],
          truncated: !!d.truncated,
        });
      })
      .catch(() => setExplanationNanError('네트워크 오류'))
      .finally(() => setExplanationNanLoading(false));
  };

  const runExplanationNanValidate = () => {
    setExplanationNanLoading(true);
    setExplanationNanError(null);
    setExplanationNanData(null);
    setExplanationNanSelectedIds(new Set());
    const params = new URLSearchParams();
    if (filterTextbook) params.set('textbook', filterTextbook);
    if (filterType) params.set('type', filterType);
    fetch(`/api/admin/generated-questions/validate/explanation-nan?${params}`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          setExplanationNanError(d.error || '검증 실패');
          return;
        }
        setExplanationNanData({
          filters: d.filters ?? { textbook: null, type: null },
          totalMatched: d.totalMatched ?? 0,
          note: typeof d.note === 'string' ? d.note : undefined,
          items: Array.isArray(d.items)
            ? d.items.map(
                (it: { full?: string; snippet?: string; reason?: string }) => ({
                  ...it,
                  full: it.full ?? it.snippet ?? '',
                  reason: typeof it.reason === 'string' ? it.reason : '',
                })
              )
            : [],
          truncated: !!d.truncated,
        });
      })
      .catch(() => setExplanationNanError('네트워크 오류'))
      .finally(() => setExplanationNanLoading(false));
  };

  const runWriteExplanationForNanItem = async (
    itemId: string
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/admin/generated-questions/${itemId}/write-explanation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!res.ok) {
        return {
          ok: false,
          error: typeof d.error === 'string' ? d.error : '해설 작성에 실패했습니다.',
        };
      }
      setExplanationNanData((prev) => {
        if (!prev) return prev;
        const items = prev.items.filter((x) => x.id !== itemId);
        return {
          ...prev,
          items,
          totalMatched: Math.max(0, prev.totalMatched - 1),
        };
      });
      setExplanationNanSelectedIds((prev) => {
        const n = new Set(prev);
        n.delete(itemId);
        return n;
      });
      return { ok: true };
    } catch {
      return { ok: false, error: '네트워크 오류' };
    }
  };

  const writeExplanationFromNanModal = async (itemId: string) => {
    setExplanationNanWritingId(itemId);
    setExplanationNanError(null);
    try {
      const r = await runWriteExplanationForNanItem(itemId);
      if (!r.ok) setExplanationNanError(r.error || '해설 작성에 실패했습니다.');
      else fetchList();
    } finally {
      setExplanationNanWritingId(null);
    }
  };

  const writeExplanationBatchFromNanModal = async () => {
    if (!explanationNanData?.items.length) return;
    const ordered = explanationNanData.items
      .map((it) => it.id)
      .filter((id) => explanationNanSelectedIds.has(id));
    if (ordered.length === 0) return;

    setExplanationNanBatchRunning(true);
    setExplanationNanBatchProgress({ done: 0, total: ordered.length });
    setExplanationNanError(null);
    let failCount = 0;
    let lastError = '';
    try {
      for (let i = 0; i < ordered.length; i++) {
        const itemId = ordered[i];
        setExplanationNanWritingId(itemId);
        const r = await runWriteExplanationForNanItem(itemId);
        setExplanationNanBatchProgress({ done: i + 1, total: ordered.length });
        if (!r.ok) {
          failCount += 1;
          lastError = r.error || '';
        }
      }
    } finally {
      setExplanationNanWritingId(null);
      setExplanationNanBatchRunning(false);
      setExplanationNanBatchProgress(null);
      fetchList();
      if (failCount > 0) {
        setExplanationNanError(
          `${failCount}건 실패${lastError ? ` — ${lastError}` : ''}. 나머지는 저장되었습니다.`
        );
      }
    }
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

  const openGrammarVariantModal = () => {
    setGrammarVariantOpen(true);
    setGrammarVariantData(null);
    setGrammarVariantError(null);
    setGrammarBlocksRegenMessage(null);
    setGrammarVariantLoading(true);
    const params = new URLSearchParams();
    if (filterTextbook) params.set('textbook', filterTextbook);
    fetch(`/api/admin/generated-questions/validate/grammar-variant?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          setGrammarVariantError(d.error || '검증 실패');
          return;
        }
        setGrammarVariantData({
          filters: d.filters ?? { textbook: null, type: '어법' },
          totalScanned: d.totalScanned ?? 0,
          scanned: d.scanned ?? 0,
          truncated: !!d.truncated,
          maxScan: d.maxScan ?? 0,
          withErrors: d.withErrors ?? 0,
          withWarningsOnly: d.withWarningsOnly ?? 0,
          items: Array.isArray(d.items) ? d.items : [],
        });
      })
      .catch(() => setGrammarVariantError('네트워크 오류'))
      .finally(() => setGrammarVariantLoading(false));
  };

  const runGrammarVariantValidate = () => {
    setGrammarVariantLoading(true);
    setGrammarVariantError(null);
    setGrammarVariantData(null);
    const params = new URLSearchParams();
    if (filterTextbook) params.set('textbook', filterTextbook);
    fetch(`/api/admin/generated-questions/validate/grammar-variant?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          setGrammarVariantError(d.error || '검증 실패');
          return;
        }
        setGrammarVariantData({
          filters: d.filters ?? { textbook: null, type: '어법' },
          totalScanned: d.totalScanned ?? 0,
          scanned: d.scanned ?? 0,
          truncated: !!d.truncated,
          maxScan: d.maxScan ?? 0,
          withErrors: d.withErrors ?? 0,
          withWarningsOnly: d.withWarningsOnly ?? 0,
          items: Array.isArray(d.items) ? d.items : [],
        });
      })
      .catch(() => setGrammarVariantError('네트워크 오류'))
      .finally(() => setGrammarVariantLoading(false));
  };

  const grammarBlocksErrorIds = useMemo(() => {
    if (!grammarVariantData?.items?.length) return [];
    return grammarVariantData.items
      .filter((it) => it.errors.some((e) => e.code === 'blocks'))
      .map((it) => it.id);
  }, [grammarVariantData]);

  /** 정답 칸 밑줄이 원문과 동일한 오류(wrong_slot_equals_original) 문항 ID 목록 */
  const grammarWrongSlotErrorIds = useMemo(() => {
    if (!grammarVariantData?.items?.length) return [];
    return grammarVariantData.items
      .filter((it) => it.errors.some((e) => e.code === 'wrong_slot_equals_original'))
      .map((it) => it.id);
  }, [grammarVariantData]);

  const runGrammarBlocksBulkRegenerate = async () => {
    if (grammarBlocksErrorIds.length === 0) return;
    const batch = Math.min(grammarRegenBatchSize, grammarBlocksErrorIds.length);
    const ids = grammarBlocksErrorIds.slice(0, batch);
    const remaining = grammarBlocksErrorIds.length - batch;
    if (
      !confirm(
        `Paragraph 밑줄 형식 오류(①~⑤·<u>) 문항 ${ids.length}건을 passage 원문으로 Claude 재생성합니다.${remaining > 0 ? `\n(전체 ${grammarBlocksErrorIds.length}건 중 이번 ${ids.length}건. 완료 후 나머지 ${remaining}건은 다시 검증해서 재실행하세요.)` : ''}\n기존 문항 번호(NumQuestion)·Source·UniqueID는 유지됩니다. 시간이 다소 걸릴 수 있습니다. 계속할까요?`
      )
    ) {
      return;
    }
    setGrammarBlocksRegenLoading(true);
    setGrammarBlocksRegenMessage(null);
    setGrammarVariantError(null);
    let typePrompt = '';
    try {
      const raw = localStorage.getItem(TYPE_VARIANT_PROMPTS_STORAGE);
      if (raw) {
        const p = JSON.parse(raw) as unknown;
        if (p && typeof p === 'object' && !Array.isArray(p) && typeof (p as Record<string, unknown>)['어법'] === 'string') {
          typePrompt = String((p as Record<string, string>)['어법']).trim().slice(0, 12000);
        }
      }
    } catch {
      typePrompt = '';
    }
    try {
      const res = await fetch('/api/admin/generated-questions/bulk-regenerate-grammar-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ids,
          ...(typePrompt ? { typePrompt } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setGrammarVariantError(typeof d.error === 'string' ? d.error : '일괄 재생성 실패');
        return;
      }
      const ok = typeof d.succeeded === 'number' ? d.succeeded : 0;
      const fail = typeof d.failed === 'number' ? d.failed : 0;
      setGrammarBlocksRegenMessage(`재생성 완료: 성공 ${ok}건, 실패 ${fail}건${remaining > 0 ? ` · 나머지 ${remaining}건은 다시 검증 후 재실행` : ''}`);
      fetchList();
      fetchMeta();
      runGrammarVariantValidate();
    } catch {
      setGrammarVariantError('네트워크 오류');
    } finally {
      setGrammarBlocksRegenLoading(false);
    }
  };

  /** 정답 칸 밑줄=원문 동일 문항 일괄 재생성 */
  const runGrammarWrongSlotBulkRegenerate = async () => {
    if (grammarWrongSlotErrorIds.length === 0) return;
    const batch = Math.min(grammarRegenBatchSize, grammarWrongSlotErrorIds.length);
    const ids = grammarWrongSlotErrorIds.slice(0, batch);
    const remaining = grammarWrongSlotErrorIds.length - batch;
    if (
      !confirm(
        `CorrectAnswer 번호 밑줄이 원문과 동일한 어법 문항 ${ids.length}건을 passage 원문으로 Claude 재생성합니다.${remaining > 0 ? `\n(전체 ${grammarWrongSlotErrorIds.length}건 중 이번 ${ids.length}건. 완료 후 나머지 ${remaining}건은 다시 검증해서 재실행하세요.)` : ''}\n정답 칸은 반드시 원문과 다른 형태(틀린 어법)로 생성하도록 힌트가 추가됩니다.\n기존 NumQuestion·Source·UniqueID는 유지됩니다. 계속할까요?`
      )
    ) {
      return;
    }
    setGrammarWrongSlotRegenLoading(true);
    setGrammarWrongSlotRegenMessage(null);
    setGrammarVariantError(null);
    let typePrompt = '';
    try {
      const raw = localStorage.getItem(TYPE_VARIANT_PROMPTS_STORAGE);
      if (raw) {
        const p = JSON.parse(raw) as unknown;
        if (p && typeof p === 'object' && !Array.isArray(p) && typeof (p as Record<string, unknown>)['어법'] === 'string') {
          typePrompt = String((p as Record<string, string>)['어법']).trim().slice(0, 12000);
        }
      }
    } catch {
      typePrompt = '';
    }
    try {
      const res = await fetch('/api/admin/generated-questions/bulk-regenerate-grammar-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ids,
          userHint:
            '【중요】 정답(CorrectAnswer)으로 지정될 번호의 밑줄 표현은 반드시 원문의 해당 위치와 다른 형태(철자·품사형 등 틀린 어법)이어야 합니다. 원문과 동일한 표현을 그대로 밑줄로 쓰면 안 됩니다.',
          ...(typePrompt ? { typePrompt } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setGrammarVariantError(typeof d.error === 'string' ? d.error : '일괄 재생성 실패');
        return;
      }
      const ok = typeof d.succeeded === 'number' ? d.succeeded : 0;
      const fail = typeof d.failed === 'number' ? d.failed : 0;
      setGrammarWrongSlotRegenMessage(`재생성 완료: 성공 ${ok}건, 실패 ${fail}건${remaining > 0 ? ` · 나머지 ${remaining}건은 다시 검증 후 재실행` : ''}`);
      fetchList();
      fetchMeta();
      runGrammarVariantValidate();
    } catch {
      setGrammarVariantError('네트워크 오류');
    } finally {
      setGrammarWrongSlotRegenLoading(false);
    }
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
      params.set('limit', String(Math.max(1, variationScanLimit)));
      if (!variationIncludeTotalCount) params.set('skipTotal', '1');
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
        totalMatching: typeof d.totalMatching === 'number' ? d.totalMatching : d.totalMatching === null ? null : undefined,
        scanLimit: typeof d.scanLimit === 'number' ? d.scanLimit : undefined,
        scanCap: typeof d.scanCap === 'number' ? d.scanCap : undefined,
        scanCapped: !!d.scanCapped,
        filters: d.filters ?? { textbook: null, type: null },
        byType: d.byType && typeof d.byType === 'object' ? d.byType : {},
        totalCountSkipped: !!(d.performance && d.performance.totalCountSkipped),
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
      params.set('maxListRows', String(Math.max(400, qCountMaxListRows)));
      if (qCountQuestionStatus !== 'all') {
        params.set('questionStatus', qCountQuestionStatus);
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
      setQCountSnapshotMsg(null);
      const ord = d.order;
      const qss = d.questionStatusScope;
      const questionStatusScope: QCountQuestionStatus =
        qss === '대기' || qss === '완료' || qss === '검수불일치' ? qss : 'all';
      setQCountData({
        scope: d.scope === 'order' ? 'order' : 'textbook',
        textbook: String(d.textbook ?? ''),
        questionStatusScope,
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
        pendingReviewTotal: typeof d.pendingReviewTotal === 'number' ? d.pendingReviewTotal : undefined,
        needCreateShortBySum: typeof d.needCreateShortBySum === 'number' ? d.needCreateShortBySum : undefined,
        needCreateFromEmptyPassagesTotal:
          typeof d.needCreateFromEmptyPassagesTotal === 'number'
            ? d.needCreateFromEmptyPassagesTotal
            : undefined,
        needCreateGrandTotal: typeof d.needCreateGrandTotal === 'number' ? d.needCreateGrandTotal : undefined,
        pendingInScopeTotal: typeof d.pendingInScopeTotal === 'number' ? d.pendingInScopeTotal : undefined,
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

  const saveQuestionCountSnapshot = async () => {
    if (!qCountData) return;
    if (qCountScope === 'order' && !qCountOrderId.trim()) {
      alert('주문 기준일 때는 주문이 선택되어 있어야 합니다.');
      return;
    }
    if (qCountScope === 'textbook' && !filterTextbook.trim()) {
      alert('교재 필터를 맞춘 뒤 저장해 주세요.');
      return;
    }
    setQCountSnapshotSaving(true);
    setQCountSnapshotMsg(null);
    try {
      const res = await fetch('/api/admin/generated-questions/validate/question-counts/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          note: qCountSnapshotNote.trim(),
          textbook: qCountScope === 'textbook' ? filterTextbook.trim() : '',
          orderId: qCountScope === 'order' ? qCountOrderId.trim() : '',
          requiredPerType: qCountData.requiredPerType,
          questionStatus: qCountData.questionStatusScope,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        alert(typeof d.error === 'string' ? d.error : '스냅샷 저장 실패');
        return;
      }
      setQCountSnapshotMsg(`저장됨 · MongoDB id: ${d.id} · 컬렉션 question_count_validation_snapshots`);
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setQCountSnapshotSaving(false);
    }
  };

  const loadQuestionCountSnapshots = async () => {
    setQCountSnapshotsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (filterTextbook.trim()) params.set('textbook', filterTextbook.trim());
      const res = await fetch(
        `/api/admin/generated-questions/validate/question-counts/snapshots?${params}`,
        { credentials: 'include' }
      );
      const d = await res.json();
      if (res.ok && Array.isArray(d.items)) {
        setQCountSnapshots(d.items);
      } else {
        setQCountSnapshots([]);
        alert(typeof d.error === 'string' ? d.error : '목록 조회 실패');
      }
    } catch {
      setQCountSnapshots([]);
      alert('목록 조회 중 오류');
    } finally {
      setQCountSnapshotsLoading(false);
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
      <Suspense fallback={null}>
        <OpenIdFromQuery enabled={!!user} openEdit={openEdit} />
        <OpenQCountFromQuery enabled={!!user} openQCountWithOrderId={(id) => openQCountModal(id)} />
        <QuestionStatsModal open={statsOpen} onClose={() => setStatsOpen(false)} />
      </Suspense>
      <header className="border-b border-slate-700 bg-slate-800/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">변형·서술 문제 관리</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              MongoDB · <code className="text-slate-500">generated_questions</code>
              {listDataScope !== 'variant' && (
                <>
                  {' · '}
                  <code className="text-slate-500">narrative_questions</code>
                </>
              )}
            </p>
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
            <Link
              href="/admin/question-review"
              className="text-slate-300 hover:text-white text-sm px-3 py-2 rounded-lg border border-amber-600/50 hover:border-amber-400/60 text-amber-200/90 font-semibold"
            >
              문제 검수
            </Link>
            <Link
              href="/admin/generated-questions/review-logs"
              className="text-slate-300 hover:text-white text-sm px-3 py-2 rounded-lg border border-emerald-700/50 hover:border-emerald-500/60 text-emerald-200/90"
            >
              Claude Code 검수 로그
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
            <label className="block text-xs text-slate-400 mb-1">데이터</label>
            <select
              value={listDataScope}
              onChange={(e) => {
                const v = e.target.value;
                setListDataScope(v === 'narrative' || v === 'all' ? v : 'variant');
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm min-w-[200px] text-white"
              title="목록에 포함할 컬렉션"
            >
              <option value="variant">변형문제만 (generated_questions)</option>
              <option value="narrative">서술형만 (narrative_questions)</option>
              <option value="all">변형 + 서술 (병합)</option>
            </select>
          </div>
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
            <label className="block text-xs text-slate-400 mb-1">난이도</label>
            <select
              value={filterDifficulty}
              onChange={(e) => {
                setFilterDifficulty(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm min-w-[80px] text-white"
            >
              <option value="">전체</option>
              <option value="중">중</option>
              <option value="상">상</option>
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
            <label className="block text-xs text-slate-400 mb-1">정렬</label>
            <select
              value={filterSortOrder}
              onChange={(e) => {
                setFilterSortOrder(e.target.value === 'newest' ? 'newest' : 'default');
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm min-w-[180px] text-white"
              title="목록 정렬 방식"
            >
              <option value="default">기본 (교재·출처·유형)</option>
              <option value="newest">최신 입력순</option>
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
              placeholder="예: 26년 3월 고2 영어모의고사 32번 → 출처·교재만 매칭"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
            />
            <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">
              문장이 <span className="text-slate-400">…숫자번</span>으로 끝나면(앞부분 6자 이상) 본문·선지 검색을 하지 않아 다른 번호가 섞이지 않습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchList()}
            className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm font-medium"
          >
            새로고침
          </button>
          {(['pdf', 'docx'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              disabled={total === 0}
              onClick={() => {
                const params = new URLSearchParams();
                if (filterTextbook) params.set('textbook', filterTextbook);
                if (filterType) params.set('type', filterType);
                if (filterDifficulty) params.set('difficulty', filterDifficulty);
                if (filterStatus) params.set('status', filterStatus);
                if (filterPassageId.trim()) params.set('passage_id', filterPassageId.trim());
                params.set('format', fmt);
                window.open(`/api/admin/generated-questions/download-pdf?${params}`, '_blank');
              }}
              className={`${fmt === 'pdf' ? 'bg-indigo-700 hover:bg-indigo-600' : 'bg-emerald-700 hover:bg-emerald-600'} disabled:opacity-40 px-4 py-2 rounded-lg text-sm font-medium`}
              title={`현재 필터 조건의 문제를 ${fmt.toUpperCase()}로 다운로드 (최대 500문항)`}
            >
              {fmt.toUpperCase()} 다운로드
            </button>
          ))}
        </div>

        <div className="mb-3">
          <p className="text-slate-400 text-sm mb-2">
            총 <span className="text-white font-semibold">{total}</span>건 · {page}/{totalPages}페이지
          </p>
          <div className="rounded-lg border border-slate-700/50 bg-slate-900/35 px-3 py-2.5 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3">
              <span className="text-slate-500 text-[10px] sm:text-[11px] font-bold tracking-wide shrink-0 sm:w-[4.75rem] sm:pt-1.5">
                분석·통계
              </span>
              <div className="flex flex-wrap gap-2">
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
                  onClick={() => setStatsOpen(true)}
                  className="shrink-0 bg-indigo-900/80 hover:bg-indigo-800 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-indigo-100 border border-indigo-500/40"
                  title="교재별·유형별 문제수 시각화"
                >
                  문제수 시각화
                </button>
                <button
                  type="button"
                  disabled={qCountLoading}
                  onClick={() => openQCountModal()}
                  className="shrink-0 bg-cyan-900/80 hover:bg-cyan-800 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-cyan-100 border border-cyan-500/40"
                  title="MongoDB passages(원문) 대비 변형문 유무·표준 11유형별 문항 수(기본 3) 검증"
                >
                  문제수 검증
                </button>
                <button
                  type="button"
                  disabled={orderLogsLoading}
                  onClick={openOrderLogsModal}
                  className="shrink-0 bg-slate-700/90 hover:bg-slate-600 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-slate-100 border border-slate-500/50"
                  title="일괄 처리·HWP 큐 등 order_processing_logs — 행에서 문제수 검증으로 이동"
                >
                  주문 처리 로그
                </button>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3 pt-1 border-t border-slate-700/40">
              <span className="text-slate-500 text-[10px] sm:text-[11px] font-bold tracking-wide shrink-0 sm:w-[4.75rem] sm:pt-1.5">
                선택지 검증
              </span>
              <div className="flex flex-wrap gap-2">
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
                  disabled={optionsApiLoading}
                  onClick={openOptionsApiModal}
                  className="shrink-0 bg-amber-900/80 hover:bg-amber-800 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-amber-100 border border-amber-500/40"
                  title="Options 열에 'API' 텍스트 포함 여부 검증"
                >
                  Options &apos;API&apos; 검증
                </button>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3 pt-1 border-t border-slate-700/40">
              <span className="text-slate-500 text-[10px] sm:text-[11px] font-bold tracking-wide shrink-0 sm:w-[4.75rem] sm:pt-1.5">
                해설·어법
              </span>
              <div className="flex flex-wrap gap-2 items-center">
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
                  disabled={explanationNanLoading}
                  onClick={openExplanationNanModal}
                  className="shrink-0 bg-sky-900/80 hover:bg-sky-800 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-sky-100 border border-sky-500/40"
                  title="해설 없음(필드 없음·null·빈칸) 또는 문자열에 'nan' 포함·숫자 NaN 등"
                >
                  Explanation &apos;nan&apos;/누락 검증
                </button>
                <button
                  type="button"
                  disabled={grammarVariantLoading}
                  onClick={openGrammarVariantModal}
                  className="shrink-0 bg-indigo-900/80 hover:bg-indigo-800 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold text-indigo-100 border border-indigo-500/40"
                  title="type=어법만: ①~⑤·밑줄 형식, Options가 ①###②###③###④###⑤(번호만)이면 보기↔밑줄 비교 생략, 구형 보기는 CorrectAnswer만 일치 검사, 원문 대비 오답 칸·전체 평문"
                >
                  어법 변형 검증
                </button>
                <button
                  type="button"
                  onClick={() => setExtraMenuExpanded((e) => !e)}
                  className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium border border-slate-500/60 bg-slate-800/80 text-slate-300 hover:bg-slate-700/80 hover:text-slate-200 transition-colors"
                  title={extraMenuExpanded ? '추가 메뉴 접기' : '추가 메뉴 펼치기'}
                >
                  {extraMenuExpanded ? '추가 메뉴 접기' : '추가 메뉴'}
                  <span
                    className={`inline-block transition-transform duration-300 ease-out ${extraMenuExpanded ? 'rotate-180' : ''}`}
                    aria-hidden
                  >
                    ▼
                  </span>
                </button>
              </div>
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
                    {
                      label: '등록일시',
                      i: 1,
                      cls: 'text-slate-400 text-xs whitespace-nowrap',
                    },
                    { label: '교재', i: 2 },
                    { label: '유형 (type)', i: 3, cls: 'text-violet-300/90' },
                    { label: 'Paragraph (변형도)', i: 4 },
                    { label: 'Options', i: 5 },
                    { label: 'Explanation', i: 6 },
                    { label: '출처', i: 7 },
                    { label: 'passage', i: 8, cls: 'font-mono text-xs' },
                    { label: '발문', i: 9 },
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
                    <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                      불러오는 중…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
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
                    const rowStatus = String(row.status ?? '').trim();
                    const isPendingRow = rowStatus === '대기';
                    return (
                    <tr
                      key={`${row.record_kind ?? 'variant'}-${row._id}`}
                      id={`row-${row._id}`}
                      className={
                        isPendingRow
                          ? 'border-b border-amber-900/50 bg-amber-950/40 hover:bg-amber-950/55 border-l-[3px] border-l-amber-400/85'
                          : 'border-b border-slate-700/80 hover:bg-slate-800/40'
                      }
                      title={isPendingRow ? '검수 대기(대기)' : undefined}
                    >
                      <td
                        className="px-2 py-2 align-top border-r border-slate-700/30"
                        style={{ width: colWidths[0], maxWidth: colWidths[0] }}
                      >
                        <div className="flex flex-col gap-1.5">
                          {row.record_kind === 'narrative' ? (
                            <>
                              <span className="text-[10px] font-bold text-cyan-400/90 uppercase tracking-wide">서술형</span>
                              <button
                                type="button"
                                onClick={() => void openNarrativeDetail(row._id)}
                                className="text-left text-violet-400 hover:text-violet-300 text-xs font-medium"
                              >
                                상세
                              </button>
                            </>
                          ) : (
                            <>
                              {isPendingRow && (
                                <span className="text-[10px] font-bold text-amber-300/95 tracking-wide rounded px-1.5 py-0.5 bg-amber-950/80 border border-amber-600/50 w-fit">
                                  대기
                                </span>
                              )}
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
                                onClick={() => void openGptWebSolveFromRow(row)}
                                className="text-left text-teal-400 hover:text-teal-300 text-xs font-medium"
                                title="Claude API 대신 ChatGPT 웹에서 풀기 — 동일 프롬프트를 복사 후 새 탭에서 붙여넣기"
                              >
                                GPT웹 풀기
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
                            </>
                          )}
                        </div>
                      </td>
                      <td
                        className="px-2 py-2 text-slate-400 align-top tabular-nums border-r border-slate-700/30 text-xs whitespace-nowrap"
                        style={{ width: colWidths[1], maxWidth: colWidths[1] }}
                        title={
                          row.created_at
                            ? `${formatDbCreatedAt(row.created_at)} (DB 등록)`
                            : '등록 시각 없음(구 데이터 등)'
                        }
                      >
                        {formatDbCreatedAt(row.created_at ?? undefined)}
                      </td>
                      <td
                        className="px-2 py-2 text-slate-200 align-top truncate border-r border-slate-700/30"
                        style={{ width: colWidths[2], maxWidth: colWidths[2] }}
                        title={row.textbook}
                      >
                        {row.textbook}
                      </td>
                      <td
                        className="px-2 py-2 align-top border-r border-slate-700/30 overflow-hidden"
                        style={{ width: colWidths[3], maxWidth: colWidths[3] }}
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
                        style={{ width: colWidths[4], maxWidth: colWidths[4] }}
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
                        style={{ width: colWidths[5], maxWidth: colWidths[5] }}
                      >
                        <div className="max-h-52 overflow-y-auto break-words whitespace-pre-wrap pr-1 select-text">
                          {opt || '—'}
                        </div>
                      </td>
                      <td
                        className="px-2 py-2 text-slate-300 align-top border-r border-slate-700/30 text-[13px] leading-snug select-text"
                        style={{ width: colWidths[6], maxWidth: colWidths[6] }}
                      >
                        <div className="max-h-52 overflow-y-auto break-words whitespace-pre-wrap pr-1 select-text">
                          {expl || '—'}
                        </div>
                      </td>
                      <td
                        className="px-2 py-2 text-slate-400 align-top truncate border-r border-slate-700/30"
                        style={{ width: colWidths[7], maxWidth: colWidths[7] }}
                        title={row.source}
                      >
                        {row.source}
                      </td>
                      <td
                        className="px-2 py-2 text-slate-500 align-top font-mono text-[10px] truncate border-r border-slate-700/30"
                        style={{ width: colWidths[8], maxWidth: colWidths[8] }}
                        title={row.passage_id || ''}
                      >
                        {row.passage_id ? `${row.passage_id.slice(0, 8)}…` : '—'}
                      </td>
                      <td
                        className="px-2 py-2 text-slate-400 align-top border-r border-slate-700/30 overflow-hidden"
                        style={{ width: colWidths[9], maxWidth: colWidths[9] }}
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
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  원문(passages) 대비 지문(Paragraph) 변형도를 유형별로 집계합니다. 상단 목록의 <strong className="text-slate-300">교재·유형</strong> 필터와 동일하게 적용됩니다. 스캔 상한은 아래에서 선택하며, 서버는{' '}
                  <code className="text-slate-400 text-[10px]">ADMIN_VARIATION_MAX_SCAN</code> 환경변수로 최대 20만까지 조절할 수 있습니다.{' '}
                  <span className="text-slate-500">
                    집계는 지문을 청크로 묶어 passages를 배치 조회하고, 비교 문자열 길이는 서버에서 제한해 속도를 맞춥니다(
                    <code className="text-slate-500 text-[10px]">ADMIN_VARIATION_DOC_CHUNK</code>,{' '}
                    <code className="text-slate-500 text-[10px]">ADMIN_VARIATION_COMPARE_MAX_CHARS</code>).{' '}
                    ※ 변형도는 낮을수록 원문과 글자상 유사(0%에 가깝게 동일), 높을수록 다릅니다.{' '}
                    <strong className="text-slate-400">순서</strong>·<strong className="text-slate-400">삽입</strong>·
                    <strong className="text-slate-400">빈칸</strong>은 정답(CorrectAnswer·Options)으로 읽기 순서·삽입·빈칸 채움을
                    반영하고, <strong className="text-slate-400">어법</strong>은 정답 번호(틀린 밑줄)에 해당하는 부분을
                    정답 보기 문구·원문과 맞추어 교정한 뒤 비교합니다.
                  </span>
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
                  {variationDbCountLoading && (
                    <p className="text-xs text-slate-500 animate-pulse">DB 조건 일치 문항 수 조회 중…</p>
                  )}
                  {variationDbCountError && !variationDbCountLoading && (
                    <p className="text-xs text-amber-300/90">{variationDbCountError}</p>
                  )}
                  {variationDbCount != null && !variationDbCountLoading && (
                    <div className="rounded-lg border border-teal-900/50 bg-slate-950/70 px-3 py-2 text-xs text-slate-300 space-y-1">
                      <p>
                        위 필터와 <strong className="text-teal-200">동일 조건</strong>의 변형문제(
                        <code className="text-slate-500">generated_questions</code>):{' '}
                        <strong className="text-white tabular-nums text-sm">
                          {variationDbCount.toLocaleString()}
                        </strong>
                        건
                        {variationDbScanCap != null && (
                          <span className="text-slate-500">
                            {' '}
                            · 서버 스캔 상한 <strong className="text-slate-400">{variationDbScanCap.toLocaleString()}</strong>건
                          </span>
                        )}
                      </p>
                      {variationDbCount > 0 && variationScanLimit < variationDbCount && (
                        <p className="text-amber-200/90 leading-relaxed">
                          선택한 최대 스캔({variationScanLimit.toLocaleString()}건)이 DB보다 작으면{' '}
                          <strong className="text-amber-100">앞에서부터 일부만</strong> 집계됩니다. 전체를 보려면 스캔 건수를
                          늘리세요.
                        </p>
                      )}
                      {variationDbScanCap != null && variationDbCount > variationDbScanCap && (
                        <p className="text-slate-500 leading-relaxed">
                          DB가 서버 상한({variationDbScanCap.toLocaleString()}건)보다 많으면 환경변수{' '}
                          <code className="text-slate-600">ADMIN_VARIATION_MAX_SCAN</code>으로 상한을 올려야 전체 스캔이
                          가능합니다.
                        </p>
                      )}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">최대 스캔 건수 (조건 일치 문항 중 앞에서부터)</label>
                    <select
                      value={variationScanLimit}
                      onChange={(e) => setVariationScanLimit(Number(e.target.value) || 25_000)}
                      className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      {[5_000, 10_000, 25_000, 50_000, 80_000, 100_000, 150_000, 200_000].map((n) => (
                        <option key={n} value={n}>
                          {n.toLocaleString()}건
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer text-sm text-slate-300 max-w-xl">
                    <input
                      type="checkbox"
                      checked={variationIncludeTotalCount}
                      onChange={(e) => setVariationIncludeTotalCount(e.target.checked)}
                      className="mt-1 rounded border-slate-500"
                    />
                    <span>
                      <strong className="text-slate-200">조건 일치 총 건수</strong>도 조회 (MongoDB{' '}
                      <code className="text-slate-500 text-xs">countDocuments</code> — 데이터가 많으면 수십 초 걸릴 수 있음).{' '}
                      <span className="text-slate-500">끄면 집계만 빠르게 돌아갑니다.</span>
                    </span>
                  </label>
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
                      {variationAnalysisData.totalCountSkipped && (
                        <span className="text-slate-500"> · 총 건수는 생략(빠른 모드)</span>
                      )}
                      {typeof variationAnalysisData.totalMatching === 'number' && (
                        <>
                          {' '}
                          (조건 일치 <strong className="text-slate-200">{variationAnalysisData.totalMatching.toLocaleString()}</strong>건
                          {variationAnalysisData.scanCapped ? ' · 일부만 집계' : ' · 전부 집계'})
                        </>
                      )}
                      {variationAnalysisData.filters.textbook && (
                        <> · 교재: <strong className="text-teal-200">{variationAnalysisData.filters.textbook}</strong></>
                      )}
                      {variationAnalysisData.filters.type && (
                        <> · 유형: <strong className="text-teal-200">{variationAnalysisData.filters.type}</strong></>
                      )}
                    </p>
                    {variationDbCount != null && (
                      <p className="text-xs text-slate-500 basis-full w-full">
                        DB 동일 조건 변형문제{' '}
                        <strong className="text-teal-300/90 tabular-nums">
                          {variationDbCount.toLocaleString()}
                        </strong>
                        건 (최대 스캔 설정 참고)
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => void runVariationAnalysis()}
                      className="text-sm px-3 py-2 rounded-lg border border-teal-600/60 text-teal-200 hover:bg-teal-900/50"
                    >
                      다시 분석
                    </button>
                  </div>
                  {variationAnalysisData.scanCapped && (
                    <p className="text-amber-200/90 text-xs mb-4 leading-relaxed">
                      스캔 상한({(variationAnalysisData.scanLimit ?? variationAnalysisData.totalScanned).toLocaleString()}건)에 도달했습니다. 더 보려면 분석 전에 최대 스캔 건수를 늘리거나 서버{' '}
                      <code className="text-amber-100/80">ADMIN_VARIATION_MAX_SCAN</code>을 올려 주세요.
                      {typeof variationAnalysisData.scanCap === 'number' && (
                        <> (현재 서버 상한 약 {variationAnalysisData.scanCap.toLocaleString()}건)</>
                      )}
                    </p>
                  )}
                  <p className="text-slate-500 text-xs mb-2">
                    <strong className="text-slate-400">구간 숫자</strong>를 누르면 아래에 해당 문항 목록이 열리고 <strong className="text-slate-400">수정</strong>으로 바로 편집할 수 있습니다. 저장 후에는 같은 구간 목록이 다시 불러와집니다(최대 500건 표시).{' '}
                    <strong className="text-slate-400">전체 페이지</strong> 링크로 별도 탭에서 목록만 보기도 할 수 있습니다.
                  </p>
                  {(() => {
                    // 유형별 특성 설정: category로 변형도 기대 수준 분류
                    // low: 지문 원문 유지가 원칙 (선택지 변형), mid: 경미한 변형 권장, high: 적극 변형 필수
                    const TYPE_CONFIG: Record<string, { category: 'low' | 'mid' | 'high'; minAvg: number; warnAvg: number; maxSafe: number; zeroOk: boolean; desc: string; tip: string }> = {
                      '제목':   { category: 'low',  minAvg: 0,  warnAvg: 5,  maxSafe: 35, zeroOk: true,  desc: '글의 제목을 고르는 유형. 지문은 원문 그대로 유지하고 선택지(오답)를 변형하는 것이 원칙. 지문 변형도 0%가 정상.', tip: '지문 변형보다 오답 선택지의 매력도를 다양화하세요.' },
                      '주제':   { category: 'low',  minAvg: 0,  warnAvg: 5,  maxSafe: 35, zeroOk: true,  desc: '글의 주제를 파악하는 유형. 지문 원문 유지가 기본이며, 선택지 변형으로 변별력 확보.', tip: '선택지의 주제 표현을 다양화하세요.' },
                      '주장':   { category: 'low',  minAvg: 0,  warnAvg: 5,  maxSafe: 35, zeroOk: true,  desc: '필자의 주장을 파악하는 유형. 지문 원문 유지가 기본. 주장 선택지 표현 변형이 핵심.', tip: '선택지의 주장 표현을 다양화하세요.' },
                      '함의':   { category: 'mid',  minAvg: 5,  warnAvg: 12, maxSafe: 50, zeroOk: true,  desc: '글의 함축적 의미를 추론하는 유형. 약간의 표현 변형은 권장하나 핵심 함의 근거는 보존 필수.', tip: '핵심 함의 근거 문장은 보존하고 부가 표현만 변형하세요.' },
                      '어법':   { category: 'mid',  minAvg: 5,  warnAvg: 12, maxSafe: 40, zeroOk: false, desc: '어법 포인트(밑줄)는 반드시 유지하고 주변 문맥만 변형. 과도한 변형은 어법 포인트 훼손 위험.', tip: '밑줄 어법 포인트는 절대 보존, 나머지 표현만 변형하세요.' },
                      '빈칸':   { category: 'high', minAvg: 15, warnAvg: 25, maxSafe: 70, zeroOk: false, desc: '빈칸에 들어갈 어휘/구를 묻는 유형. 원문 그대로면 학생이 기억으로 답할 수 있어 반드시 변형 필요.', tip: '지문 표현을 바꾸되 빈칸 핵심어와 흐름은 유지하세요.' },
                      '순서':   { category: 'high', minAvg: 20, warnAvg: 30, maxSafe: 75, zeroOk: false, desc: '단락 배열 순서를 묻는 유형. 각 단락 내용을 변형해야 하며, 연결어·지시어 수정도 중요.', tip: '단락 첫 문장과 연결어를 중심으로 변형하세요.' },
                      '삽입':   { category: 'high', minAvg: 15, warnAvg: 25, maxSafe: 70, zeroOk: false, desc: '문장 삽입 위치를 묻는 유형. 지문 전체를 변형해야 기억 답변 방지.', tip: '삽입 문장 및 주변 단락을 함께 변형하세요.' },
                      '요약':   { category: 'high', minAvg: 15, warnAvg: 20, maxSafe: 45, zeroOk: false, desc: '본문 요약 빈칸 채우기 유형. 본문과 요약문 모두 변형 필수. 0% 문항이 없어야 함.', tip: '요약문 빈칸 단어와 본문 내용을 함께 변형하세요.' },
                      '일치':   { category: 'high', minAvg: 15, warnAvg: 25, maxSafe: 65, zeroOk: false, desc: '글의 내용과 일치하는 것을 찾는 유형. 세부 사실(수치·날짜·인물)을 변형해야 기억 답변 방지.', tip: '수치·날짜·장소·인물 등 세부 사실을 변형하세요.' },
                      '불일치': { category: 'high', minAvg: 15, warnAvg: 25, maxSafe: 65, zeroOk: false, desc: '내용과 불일치하는 선택지를 찾는 유형. 세부 정보(숫자·명칭 등) 변형이 핵심.', tip: '선택지의 세부 내용(수치·고유명사)을 변형하세요.' },
                    };

                    // 유형×구간별 평가: 유형 카테고리에 따라 같은 변형도라도 평가가 달라짐
                    const getBucketEval = (typeKey: string, bucketIdx: number): { label: string; color: string; bgColor: string } => {
                      const cat = TYPE_CONFIG[typeKey]?.category ?? 'high';
                      if (cat === 'low') {
                        if (bucketIdx <= 1) return { label: '적정', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10' };
                        if (bucketIdx <= 3) return { label: '양호', color: 'text-teal-300', bgColor: 'bg-teal-500/10' };
                        if (bucketIdx <= 5) return { label: '주의', color: 'text-amber-300', bgColor: 'bg-amber-500/10' };
                        if (bucketIdx <= 7) return { label: '과도', color: 'text-orange-300', bgColor: 'bg-orange-500/10' };
                        return { label: '위험', color: 'text-rose-400', bgColor: 'bg-rose-500/10' };
                      }
                      if (cat === 'mid') {
                        if (bucketIdx === 0) return { label: '양호', color: 'text-teal-300', bgColor: 'bg-teal-500/10' };
                        if (bucketIdx <= 3) return { label: '적정', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10' };
                        if (bucketIdx <= 5) return { label: '양호', color: 'text-teal-300', bgColor: 'bg-teal-500/10' };
                        if (bucketIdx <= 7) return { label: '과도', color: 'text-orange-300', bgColor: 'bg-orange-500/10' };
                        return { label: '위험', color: 'text-rose-400', bgColor: 'bg-rose-500/10' };
                      }
                      if (bucketIdx === 0) return { label: '위험', color: 'text-rose-400', bgColor: 'bg-rose-500/10' };
                      if (bucketIdx <= 3) return { label: '적정', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10' };
                      if (bucketIdx <= 5) return { label: '양호', color: 'text-teal-300', bgColor: 'bg-teal-500/10' };
                      if (bucketIdx <= 7) return { label: '주의', color: 'text-amber-300', bgColor: 'bg-amber-500/10' };
                      return { label: '위험', color: 'text-rose-400', bgColor: 'bg-rose-500/10' };
                    };

                    const getBucketAdvice = (typeKey: string, bucketIdx: number): string | null => {
                      const bEval = getBucketEval(typeKey, bucketIdx);
                      if (bEval.label === '적정' || bEval.label === '양호') return null;
                      const cat = TYPE_CONFIG[typeKey]?.category ?? 'high';

                      if (cat === 'low') {
                        const subj = typeKey === '제목' ? '글의 제목' : typeKey === '주제' ? '핵심 주제' : '필자의 주장';
                        if (bEval.label === '주의') return `${typeKey} 유형은 지문 원문 유지가 원칙입니다. 이 정도 변형이면 ${subj}이 달라질 수 있어요. 지문보다 선택지(오답) 변형에 집중하세요.`;
                        if (bEval.label === '과도') return `지문이 과도하게 변형되어 ${subj}을 묻는 문제로서 부적절할 수 있습니다. 원래 글의 핵심 메시지가 유지되는지 해당 문항을 직접 확인하세요.`;
                        return `지문이 거의 완전히 바뀌어 원문과 다른 글이 되었을 가능성이 높습니다. ${subj}이 유효한지 즉시 검토하세요.`;
                      }

                      if (cat === 'mid') {
                        if (typeKey === '어법') {
                          if (bEval.label === '과도') return '어법 포인트(밑줄 표현)가 문맥 변형으로 부자연스러워질 수 있습니다. 밑줄 표현의 어법적 정확성과 주변 문맥의 자연스러움을 재확인하세요.';
                          return '과도한 변형으로 어법 포인트 자체가 훼손되었을 가능성이 높습니다. 밑줄 표현과 선택지를 즉시 확인하세요.';
                        }
                        if (bEval.label === '과도') return '핵심 함의 근거 문장이 과도한 변형으로 약해질 수 있습니다. 학생이 추론할 수 있는 근거가 유지되는지 확인하세요.';
                        return '과도한 변형으로 함의/시사점의 근거가 사라졌을 가능성이 높습니다. 즉시 검토하세요.';
                      }

                      if (bucketIdx === 0) {
                        const zeroAdvice: Record<string, string> = {
                          '빈칸': '원문 그대로이면 학생이 빈칸 답을 기억할 수 있습니다. 지문 표현을 변형하되 빈칸 핵심어와 흐름은 유지하세요.',
                          '순서': '단락이 원문과 같으면 순서를 기억할 수 있습니다. 각 단락의 첫 문장과 연결어를 중심으로 변형하세요.',
                          '삽입': '지문이 원문과 같으면 삽입 위치를 기억할 수 있습니다. 지문 표현과 삽입 문장을 함께 변형하세요.',
                          '요약': '요약문이 원문과 같으면 답을 기억할 수 있습니다. 본문과 요약문 빈칸 단어 모두 변형하세요.',
                          '일치': '세부 사실이 원문 그대로이면 기억으로 답할 수 있습니다. 수치·날짜·인물 등을 변형하세요.',
                          '불일치': '세부 정보가 원문 그대로이면 기억으로 답할 수 있습니다. 선택지 세부 내용을 변형하세요.',
                        };
                        return zeroAdvice[typeKey] ?? '원문 미변형 문항입니다. 기억 답변 방지를 위해 변형이 필요합니다.';
                      }

                      if (bucketIdx >= 8) {
                        const highAdvice: Record<string, string> = {
                          '빈칸': '원문과 너무 달라져 빈칸의 정답 근거가 사라졌을 수 있습니다. 핵심어와 논리 흐름을 확인하세요.',
                          '순서': '단락이 너무 달라져 연결어·논리 흐름이 깨졌을 수 있습니다. 순서 판단 근거를 확인하세요.',
                          '삽입': '문맥이 너무 달라져 삽입 위치의 논리가 무너졌을 수 있습니다. 삽입 근거를 확인하세요.',
                          '요약': '본문이 너무 달라져 요약문 빈칸의 정답이 달라졌을 수 있습니다. 요약문과 본문의 정합성을 확인하세요.',
                          '일치': '내용이 너무 달라져 정답 선택지가 유효하지 않을 수 있습니다. 정답을 재검증하세요.',
                          '불일치': '내용이 너무 달라져 오답이 정답이 되거나 반대가 될 수 있습니다. 선택지 정확성을 재검증하세요.',
                        };
                        return highAdvice[typeKey] ?? '과도한 변형으로 의미가 왜곡되었을 수 있습니다. 즉시 검토하세요.';
                      }

                      const cautionAdvice: Record<string, string> = {
                        '빈칸': '빈칸 주변 문맥이 크게 바뀌면 정답이 달라질 수 있습니다. 빈칸 핵심어와 논리 흐름 유지 여부를 확인하세요.',
                        '순서': '단락이 크게 변형되면 연결어·논리 흐름이 깨질 수 있습니다. 순서 판단 근거가 유지되는지 확인하세요.',
                        '삽입': '주변 문맥이 크게 바뀌면 삽입 위치의 논리가 달라질 수 있습니다. 삽입 근거 확인을 권장합니다.',
                        '요약': '본문 변형이 크면 요약문 빈칸의 정답도 바뀔 수 있습니다. 요약문과 본문의 정합성 확인을 권장합니다.',
                        '일치': '세부 정보가 크게 바뀌면 정답 선택지도 수정이 필요할 수 있습니다. 정답 근거 확인을 권장합니다.',
                        '불일치': '세부 정보가 크게 바뀌면 오답↔정답이 바뀔 수 있습니다. 선택지 정확성 확인을 권장합니다.',
                      };
                      return cautionAdvice[typeKey] ?? '변형도가 높은 편입니다. 정답 근거 유지 여부를 확인하세요.';
                    };

                    const getInsights = (typeKey: string, stats: { count: number; avg: number; min: number; max: number; distribution: number[] }) => {
                      const cfg = TYPE_CONFIG[typeKey] ?? { category: 'high' as const, minAvg: 10, warnAvg: 20, maxSafe: 70, zeroOk: false, desc: '', tip: '' };
                      const issues: { level: 'danger' | 'warn' | 'ok' | 'info'; msg: string }[] = [];
                      const zeroRatio = stats.count > 0 ? stats.distribution[0] / stats.count : 0;
                      const highRatio = stats.count > 0 ? (stats.distribution[8] + stats.distribution[9]) / stats.count : 0;
                      const spread = stats.max - stats.avg;

                      if (stats.count < 10) issues.push({ level: 'info', msg: `문항 수(${stats.count})가 적어 통계 신뢰도가 낮습니다.` });

                      if (cfg.category === 'low') {
                        if (stats.avg > cfg.maxSafe && stats.count >= 5) issues.push({ level: 'danger', msg: `이 유형은 지문 원문 유지가 원칙인데 평균 변형도 ${stats.avg}%로 과도합니다. 지문 의미 왜곡 여부를 확인하세요.` });
                        else if (stats.avg > cfg.maxSafe * 0.7 && stats.count >= 5) issues.push({ level: 'warn', msg: `지문 변형도 ${stats.avg}%로 이 유형 치고는 높은 편입니다. 선택지 변형에 집중하세요.` });
                        if (highRatio > 0.1) issues.push({ level: 'warn', msg: `${Math.round(highRatio * 100)}%가 80%↑ — 이 유형은 지문 원문이 유지되어야 하므로 해당 문항을 확인하세요.` });
                        if (zeroRatio > 0.8 && stats.count >= 5) issues.push({ level: 'ok', msg: `${Math.round(zeroRatio * 100)}%가 0% 구간 — 이 유형에서 원문 유지는 정상입니다.` });
                      } else {
                        if (!cfg.zeroOk && zeroRatio > 0.6) issues.push({ level: 'danger', msg: `${Math.round(zeroRatio * 100)}%가 변형도 0% — 원문 그대로 사용 중. ${cfg.desc ? cfg.desc.split('.')[0] + '이므로 변형이 필수입니다.' : '즉시 변형 작업이 필요합니다.'}` });
                        else if (!cfg.zeroOk && zeroRatio > 0.3) issues.push({ level: 'warn', msg: `${Math.round(zeroRatio * 100)}%가 0% 구간. 원문 미변형 문항이 많습니다.` });
                        if (stats.avg < cfg.minAvg && stats.count >= 10) issues.push({ level: 'danger', msg: `평균 변형도 ${stats.avg}% — 이 유형의 권장 기준(${cfg.minAvg}%↑)에 크게 못 미칩니다.` });
                        else if (stats.avg < cfg.warnAvg && stats.count >= 10) issues.push({ level: 'warn', msg: `평균 변형도 ${stats.avg}% — 권장 수준(${cfg.warnAvg}%↑)보다 낮습니다.` });
                        if (highRatio > 0.2) issues.push({ level: 'warn', msg: `${Math.round(highRatio * 100)}%가 변형도 80%↑ — 원문 의미가 훼손될 수 있습니다. 해당 문항 품질 검토를 권장합니다.` });
                      }

                      if (spread > 45 && stats.count >= 5) issues.push({ level: 'warn', msg: `편차 큼(평균 ${stats.avg}% / 최대 ${stats.max}%) — 소수 문항에 변형이 집중됩니다.` });
                      if (issues.length === 0 || (issues.length === 1 && issues[0].level === 'info')) {
                        const okMsg = cfg.category === 'low'
                          ? `양호 — 지문 원문 유지 원칙에 부합합니다.`
                          : `양호 — 평균 ${stats.avg}%, 0%구간 ${Math.round(zeroRatio * 100)}%로 적정 수준입니다.`;
                        issues.push({ level: 'ok', msg: okMsg });
                      }
                      return { issues, cfg };
                    };

                    const entries = Object.entries(variationAnalysisData.byType).sort(([a], [b]) => (a === '—' ? 1 : b === '—' ? -1 : a.localeCompare(b, 'ko')));

                    const statusDot = (typeKey: string, stats: { count: number; avg: number; min: number; max: number; distribution: number[] }) => {
                      const { issues } = getInsights(typeKey, stats);
                      if (issues.some(i => i.level === 'danger')) return <span className="inline-block w-2 h-2 rounded-full bg-rose-500 shrink-0" title="위험" />;
                      if (issues.some(i => i.level === 'warn')) return <span className="inline-block w-2 h-2 rounded-full bg-amber-400 shrink-0" title="주의" />;
                      return <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="양호" />;
                    };

                    return (
                      <>
                        <div className="overflow-x-auto rounded-xl border border-slate-600">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-slate-800 text-left text-slate-300 border-b border-slate-600">
                                <th className="px-3 py-2 font-semibold w-6"></th>
                                <th className="px-3 py-2 font-semibold">유형</th>
                                <th className="px-3 py-2 font-semibold text-right">문항 수</th>
                                <th className="px-3 py-2 font-semibold text-right">평균 변형도</th>
                                <th className="px-3 py-2 font-semibold text-right">최소</th>
                                <th className="px-3 py-2 font-semibold text-right">최대</th>
                                {Array.from({ length: 10 }, (_, i) => (
                                  <th key={i} className="px-2 py-2 font-medium text-xs text-right text-slate-400">
                                    {i === 9 ? '90~100%' : `${i * 10}~${i * 10 + 9}%`}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {entries.map(([typeKey, stats]) => (
                                <tr key={typeKey} className="border-b border-slate-700/50 hover:bg-slate-800/40">
                                  <td className="px-3 py-2">{statusDot(typeKey, stats)}</td>
                                  <td className="px-3 py-2 text-teal-200 font-medium">{typeKey}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{stats.count.toLocaleString()}</td>
                                  <td className="px-3 py-2 text-right tabular-nums text-white">{stats.avg}%</td>
                                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">{stats.min}%</td>
                                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">{stats.max}%</td>
                                  {stats.distribution.map((n, i) => {
                                    const bEval = getBucketEval(typeKey, i);
                                    return (
                                      <td key={i} className="px-2 py-1.5 text-center tabular-nums text-xs">
                                        {n > 0 ? (
                                          <div className="flex flex-col items-center gap-0">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setBucketAdvice(null);
                                                setVariationInlineBucket((prev) =>
                                                  prev?.typeKey === typeKey && prev?.bucket === i ? null : { typeKey, bucket: i }
                                                );
                                              }}
                                              className={`inline-block px-1.5 py-0.5 rounded font-semibold hover:brightness-125 transition-all cursor-pointer ${bEval.color} ${bEval.bgColor}`}
                                            >
                                              {n.toLocaleString()}
                                            </button>
                                            {getBucketAdvice(typeKey, i) ? (
                                              <button
                                                onClick={(e) => { e.stopPropagation(); setBucketAdvice(prev => prev?.type === typeKey && prev?.bucket === i ? null : { type: typeKey, bucket: i }); }}
                                                className={`text-[8px] leading-tight mt-0.5 ${bEval.color} ${bucketAdvice?.type === typeKey && bucketAdvice?.bucket === i ? 'opacity-100 font-bold' : 'opacity-70'} hover:opacity-100 cursor-pointer underline decoration-dotted underline-offset-2`}
                                              >{bEval.label}</button>
                                            ) : (
                                              <span className={`text-[8px] leading-tight mt-0.5 ${bEval.color} opacity-60`}>{bEval.label}</span>
                                            )}
                                          </div>
                                        ) : <span className="text-slate-700">—</span>}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {variationInlineBucket && (
                          <div className="mt-4 rounded-xl border border-teal-800/50 bg-slate-900/60 overflow-hidden shrink-0">
                            <div className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-600/80 bg-slate-800/80">
                              <div className="min-w-0">
                                <span className="text-sm font-semibold text-teal-200">
                                  {variationInlineBucket.typeKey} ·{' '}
                                  {variationInlineBucket.bucket === 9
                                    ? '90~100%'
                                    : `${variationInlineBucket.bucket * 10}~${variationInlineBucket.bucket * 10 + 9}%`}
                                </span>
                                {variationInlineBucketMeta && (
                                  <span className="ml-2 text-[10px] text-slate-500 whitespace-nowrap">
                                    스캔 {variationInlineBucketMeta.scanned.toLocaleString()}건 · 표시 최대{' '}
                                    {variationInlineBucketMeta.maxResults.toLocaleString()}건
                                    {variationInlineBucketMeta.scanStoppedReason === 'maxResults' && (
                                      <span className="text-amber-400/90"> · 일부만 표시</span>
                                    )}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  disabled={variationInlineBucketLoading}
                                  onClick={() => setVariationInlineListVersion((v) => v + 1)}
                                  className="text-[11px] px-2 py-1 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/80 disabled:opacity-40"
                                >
                                  새로고침
                                </button>
                                <Link
                                  href={buildVariationBucketListUrl({
                                    textbook: variationAnalysisData.filters.textbook ?? '',
                                    typeKey: variationInlineBucket.typeKey,
                                    bucket: variationInlineBucket.bucket,
                                  })}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] px-2 py-1 rounded-lg border border-teal-700/50 text-teal-300 hover:bg-teal-950/40"
                                >
                                  전체 페이지
                                </Link>
                                <button
                                  type="button"
                                  onClick={() => setVariationInlineBucket(null)}
                                  className="text-[11px] px-2 py-1 rounded-lg border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700/80"
                                >
                                  목록 닫기
                                </button>
                              </div>
                            </div>
                            {variationInlineBucketLoading && (
                              <p className="p-4 text-slate-400 text-sm animate-pulse">문항 목록 불러오는 중…</p>
                            )}
                            {variationInlineBucketError && !variationInlineBucketLoading && (
                              <div className="p-3 text-sm text-red-300 bg-red-950/30">{variationInlineBucketError}</div>
                            )}
                            {!variationInlineBucketLoading &&
                              !variationInlineBucketError &&
                              variationInlineBucketRows.length === 0 && (
                                <p className="p-4 text-slate-500 text-sm">이 구간에 해당하는 문항이 없습니다.</p>
                              )}
                            {variationInlineBucketRows.length > 0 && (
                              <div className="max-h-[min(380px,48vh)] overflow-y-auto overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-slate-800/90 text-left text-slate-400 border-b border-slate-600 sticky top-0 z-[1]">
                                      <th className="px-2 py-2 font-medium">변형도</th>
                                      <th className="px-2 py-2 font-medium">교재</th>
                                      <th className="px-2 py-2 font-medium">유형</th>
                                      <th className="px-2 py-2 font-medium">출처</th>
                                      <th className="px-2 py-2 font-medium">지문 미리보기</th>
                                      <th className="px-2 py-2 font-medium">등록</th>
                                      <th className="px-2 py-2 font-medium">수정</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {variationInlineBucketRows.map((row) => {
                                      const returnPath = `/admin/generated-questions/variation-bucket?${buildVariationBucketQueryString({
                                        textbook: variationAnalysisData.filters.textbook ?? '',
                                        typeKey: variationInlineBucket.typeKey,
                                        bucket: variationInlineBucket.bucket,
                                      })}`;
                                      return (
                                        <tr key={row._id} className="border-b border-slate-700/40 hover:bg-slate-800/50">
                                          <td className="px-2 py-1.5 tabular-nums text-teal-300 font-medium whitespace-nowrap">
                                            {row.variation_pct}%
                                          </td>
                                          <td className="px-2 py-1.5 text-slate-300 max-w-[100px] truncate" title={row.textbook}>
                                            {row.textbook || '—'}
                                          </td>
                                          <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{row.type || '—'}</td>
                                          <td className="px-2 py-1.5 text-slate-500 max-w-[120px] truncate" title={row.source}>
                                            {row.source || '—'}
                                          </td>
                                          <td className="px-2 py-1.5 text-slate-400 max-w-[220px]">{row.paragraphPreview || '—'}</td>
                                          <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">
                                            {formatDbCreatedAt(typeof row.created_at === 'string' ? row.created_at : null)}
                                          </td>
                                          <td className="px-2 py-1.5 whitespace-nowrap">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                void openEdit(
                                                  row._id,
                                                  returnPath
                                                )
                                              }
                                              className="text-sky-400 hover:text-sky-300 font-medium underline-offset-2 hover:underline"
                                            >
                                              수정
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

                        {/* 클릭된 구간 조언 표시 */}
                        {bucketAdvice && (() => {
                          const advice = getBucketAdvice(bucketAdvice.type, bucketAdvice.bucket);
                          const bEval = getBucketEval(bucketAdvice.type, bucketAdvice.bucket);
                          const range = bucketAdvice.bucket === 9 ? '90~100%' : `${bucketAdvice.bucket * 10}~${bucketAdvice.bucket * 10 + 9}%`;
                          if (!advice) return null;
                          const borderColor = bEval.label === '위험' ? 'border-rose-700/60' : bEval.label === '과도' ? 'border-orange-700/50' : 'border-amber-700/50';
                          return (
                            <div className={`mt-2 p-3 rounded-xl bg-slate-800/80 border ${borderColor} flex items-start gap-3 animate-in fade-in duration-200`}>
                              <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-bold ${bEval.color} ${bEval.bgColor}`}>{bEval.label}</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold text-slate-300">{bucketAdvice.type} · {range} 구간</div>
                                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{advice}</p>
                              </div>
                              <button onClick={() => setBucketAdvice(null)} className="shrink-0 text-slate-500 hover:text-white text-lg leading-none px-1">×</button>
                            </div>
                          );
                        })()}

                        {/* 유형별 평가 기준 범례 */}
                        <div className="mt-3 space-y-2">
                          <div className="flex flex-wrap gap-3 text-[11px]">
                            <span className="flex items-center gap-1.5"><span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-semibold">적정</span>이 유형에 이상적인 변형 수준</span>
                            <span className="flex items-center gap-1.5"><span className="px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300 font-semibold">양호</span>허용 범위 내</span>
                            <span className="flex items-center gap-1.5"><span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 font-semibold">주의</span>품질 확인 권장</span>
                            <span className="flex items-center gap-1.5"><span className="px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-300 font-semibold">과도</span>의미 왜곡 가능성</span>
                            <span className="flex items-center gap-1.5"><span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 font-semibold">위험</span>즉시 검토 필요</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] text-slate-500 bg-slate-800/40 rounded-lg p-2.5">
                            <div><span className="text-teal-300 font-semibold">제목·주제·주장</span> — 지문 원문 유지가 원칙. 0%=적정, 선택지만 변형</div>
                            <div><span className="text-sky-300 font-semibold">함의·어법</span> — 핵심 포인트 보존, 주변 표현만 경미하게 변형</div>
                            <div><span className="text-amber-300 font-semibold">빈칸·순서·삽입·일치·불일치·요약</span> — 기억 답변 방지를 위해 적극 변형 필수</div>
                          </div>
                        </div>

                        {/* 유형별 진단 카드 */}
                        <div className="mt-5 space-y-2">
                          <div className="flex items-center gap-3">
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">유형별 진단</p>
                            <div className="flex items-center gap-2 text-[10px] text-slate-600">
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />위험</span>
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />주의</span>
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />양호</span>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {entries.map(([typeKey, stats]) => {
                              const { issues, cfg } = getInsights(typeKey, stats);
                              const topLevel = issues.some(i => i.level === 'danger') ? 'danger' : issues.some(i => i.level === 'warn') ? 'warn' : 'ok';
                              const border = topLevel === 'danger' ? 'border-rose-700/50' : topLevel === 'warn' ? 'border-amber-600/40' : 'border-emerald-700/35';
                              const dot = topLevel === 'danger' ? 'bg-rose-500' : topLevel === 'warn' ? 'bg-amber-400' : 'bg-emerald-500';
                              return (
                                <div key={typeKey} className={`rounded-xl border bg-slate-800/50 p-3.5 space-y-2 ${border}`}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                                      <span className="text-sm font-semibold text-slate-200">{typeKey}</span>
                                    </div>
                                    <span className="text-[10px] text-slate-500 tabular-nums">{stats.count}문항 · 평균 {stats.avg}%</span>
                                  </div>
                                  {cfg.desc && <p className="text-[11px] text-slate-400 leading-relaxed">{cfg.desc}</p>}
                                  <ul className="space-y-1">
                                    {issues.map((issue, i) => {
                                      const icon = issue.level === 'danger' ? '🔴' : issue.level === 'warn' ? '🟡' : issue.level === 'ok' ? '🟢' : 'ℹ️';
                                      const color = issue.level === 'danger' ? 'text-rose-200' : issue.level === 'warn' ? 'text-amber-200' : issue.level === 'ok' ? 'text-emerald-300' : 'text-slate-400';
                                      return (
                                        <li key={i} className={`text-xs leading-relaxed flex gap-1.5 ${color}`}>
                                          <span className="shrink-0">{icon}</span><span>{issue.msg}</span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                  {cfg.tip && (topLevel === 'danger' || topLevel === 'warn') && (
                                    <p className="text-[11px] text-teal-400/80 bg-teal-900/20 rounded-lg px-2.5 py-1.5 leading-relaxed">
                                      💡 {cfg.tip}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
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

      {explanationNanOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
          <div className="bg-slate-800 border border-sky-600/40 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-600 flex justify-between items-center shrink-0 bg-slate-800/95">
              <div>
                <h2 className="text-lg font-bold text-sky-200">Explanation &apos;nan&apos;/누락 검증</h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  <strong className="text-sky-300">사유</strong>로 해설이 비어 있는 경우와 문자열에{' '}
                  <strong className="text-sky-300">nan</strong>이 섞인 경우, BSON 숫자 NaN 등을 구분합니다. 상단{' '}
                  <strong className="text-slate-300">교재·유형</strong> 필터가 적용됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setExplanationNanOpen(false);
                  setExplanationNanSelectedIds(new Set());
                  setExplanationNanBatchRunning(false);
                  setExplanationNanBatchProgress(null);
                  setExplanationNanWritingId(null);
                }}
                className="text-slate-400 hover:text-white text-2xl leading-none px-2"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              {explanationNanLoading && !explanationNanData && (
                <div className="flex items-center justify-center gap-2 py-12 text-sky-300">
                  <span className="inline-block w-6 h-6 border-2 border-sky-500/50 border-t-sky-300 rounded-full animate-spin" />
                  검증 중…
                </div>
              )}
              {explanationNanError && (
                <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-800/50 text-red-300 text-sm">
                  {explanationNanError}
                </div>
              )}
              {explanationNanData && !explanationNanLoading && (() => {
                    const nanWriteBusy =
                      explanationNanWritingId !== null || explanationNanBatchRunning;
                    const visibleIds = explanationNanData.items.map((it) => it.id);
                    const selectedInView = visibleIds.filter((id) =>
                      explanationNanSelectedIds.has(id)
                    );
                    const allVisibleSelected =
                      visibleIds.length > 0 &&
                      visibleIds.every((id) => explanationNanSelectedIds.has(id));
                    const someVisibleSelected = selectedInView.length > 0 && !allVisibleSelected;
                    return (
                  <>
                  {explanationNanData.note && (
                    <p className="mb-3 text-xs text-slate-400 leading-relaxed border border-slate-600/80 rounded-lg p-3 bg-slate-900/50">
                      {explanationNanData.note}
                    </p>
                  )}
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-slate-300">
                      <strong className="text-sky-200">이상·누락 의심</strong>:{' '}
                      <strong className="text-white">{explanationNanData.totalMatched.toLocaleString()}</strong>건
                      {explanationNanData.filters.textbook && (
                        <> · 교재: <strong className="text-sky-200">{explanationNanData.filters.textbook}</strong></>
                      )}
                      {explanationNanData.filters.type && (
                        <> · 유형: <strong className="text-sky-200">{explanationNanData.filters.type}</strong></>
                      )}
                      {explanationNanData.truncated && (
                        <span className="ml-2 text-amber-400 text-xs">
                          (최대 {explanationNanData.items.length}건만 표시)
                        </span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={runExplanationNanValidate}
                      disabled={nanWriteBusy}
                      className="text-xs px-3 py-1.5 rounded-lg bg-sky-800/80 hover:bg-sky-700 text-sky-200 disabled:opacity-50"
                    >
                      다시 검증
                    </button>
                    <button
                      type="button"
                      onClick={() => void writeExplanationBatchFromNanModal()}
                      disabled={
                        nanWriteBusy || selectedInView.length === 0
                      }
                      className="text-xs px-3 py-1.5 rounded-lg bg-emerald-800/90 hover:bg-emerald-700 text-emerald-100 border border-emerald-600/50 disabled:opacity-50 font-semibold"
                      title="표시된 목록 중 체크한 문항만 순서대로 Claude 해설 작성"
                    >
                      {explanationNanBatchRunning && explanationNanBatchProgress
                        ? `일괄 작성 중… ${explanationNanBatchProgress.done}/${explanationNanBatchProgress.total}`
                        : `선택 ${selectedInView.length}건 해설 작성`}
                    </button>
                  </div>
                  {explanationNanData.totalMatched === 0 ? (
                    <p className="text-emerald-400/90 text-sm py-4">
                      해당 없음 — 선택한 필터에서 해설 누락·nan 이상이 없습니다.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-600 max-h-[50vh] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-900 z-[1]">
                          <tr className="text-left text-slate-400 border-b border-slate-600">
                            <th className="py-2 pl-2 pr-1 w-10 text-center align-middle">
                              <input
                                type="checkbox"
                                title="현재 표에 보이는 행만 전체 선택/해제"
                                disabled={nanWriteBusy || visibleIds.length === 0}
                                checked={allVisibleSelected}
                                ref={(el) => {
                                  if (el) el.indeterminate = someVisibleSelected;
                                }}
                                onChange={() => {
                                  setExplanationNanSelectedIds((prev) => {
                                    const n = new Set(prev);
                                    if (allVisibleSelected) {
                                      visibleIds.forEach((id) => n.delete(id));
                                    } else {
                                      visibleIds.forEach((id) => n.add(id));
                                    }
                                    return n;
                                  });
                                }}
                                className="rounded border-slate-500 bg-slate-800 text-sky-500 focus:ring-sky-500"
                              />
                            </th>
                            <th className="py-2 px-2">작업</th>
                            <th className="py-2 px-2">교재</th>
                            <th className="py-2 px-2">출처</th>
                            <th className="py-2 px-2">유형</th>
                            <th className="py-2 px-2">사유</th>
                            <th className="py-2 px-2">미리보기</th>
                          </tr>
                        </thead>
                        <tbody>
                          {explanationNanData.items.map((it) => (
                            <tr key={it.id} className="border-b border-slate-700/50 hover:bg-slate-800/40">
                              <td className="py-1.5 pl-2 pr-1 text-center align-middle">
                                <input
                                  type="checkbox"
                                  checked={explanationNanSelectedIds.has(it.id)}
                                  disabled={nanWriteBusy}
                                  onChange={() => {
                                    setExplanationNanSelectedIds((prev) => {
                                      const n = new Set(prev);
                                      if (n.has(it.id)) n.delete(it.id);
                                      else n.add(it.id);
                                      return n;
                                    });
                                  }}
                                  className="rounded border-slate-500 bg-slate-800 text-sky-500 focus:ring-sky-500"
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <div className="flex flex-col gap-1 items-start">
                                  <button
                                    type="button"
                                    disabled={nanWriteBusy}
                                    onClick={() => writeExplanationFromNanModal(it.id)}
                                    className="text-emerald-400 hover:text-emerald-300 underline disabled:opacity-40 disabled:no-underline text-left"
                                    title="Claude로 해설 생성 후 DB에 저장합니다. 지문·발문·선택지가 있어야 합니다."
                                  >
                                    {explanationNanWritingId === it.id ? '해설 작성 중…' : '해설 작성'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={nanWriteBusy}
                                    onClick={() => {
                                      setExplanationNanOpen(false);
                                      setExplanationNanSelectedIds(new Set());
                                      setExplanationNanBatchRunning(false);
                                      setExplanationNanBatchProgress(null);
                                      setExplanationNanWritingId(null);
                                      openEdit(it.id);
                                    }}
                                    className="text-sky-400 hover:text-sky-300 underline disabled:opacity-40 text-left"
                                  >
                                    수정
                                  </button>
                                </div>
                              </td>
                              <td className="py-1.5 px-2 text-slate-300">{it.textbook}</td>
                              <td className="py-1.5 px-2 text-slate-300 font-mono">{it.source}</td>
                              <td className="py-1.5 px-2 text-violet-300">{it.type}</td>
                              <td className="py-1.5 px-2 text-amber-200/95 whitespace-nowrap">{it.reason}</td>
                              <td
                                className="py-1.5 px-2 text-slate-400 max-w-[240px] truncate cursor-pointer hover:bg-slate-700/60 hover:text-slate-200 rounded transition-colors"
                                title="클릭하면 전체 내용 보기"
                                onClick={() =>
                                  setFullTextView({
                                    title: `Explanation · ${it.reason} · ${it.source} ${it.type}`,
                                    text: it.full || it.snippet,
                                  })
                                }
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
                    );
                  })()}
            </div>
          </div>
        </div>
      )}

      {grammarVariantOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
          <div className="bg-slate-800 border border-indigo-600/40 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-600 flex justify-between items-center shrink-0 bg-slate-800/95">
              <div>
                <h2 className="text-lg font-bold text-indigo-200">어법 변형 검증</h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  DB에서 <strong className="text-indigo-300">type=어법</strong>만 최대 {grammarVariantData?.maxScan ?? 1200}건 스캔합니다. 상단{' '}
                  <strong className="text-slate-300">교재</strong> 필터만 적용됩니다. 오류: 형식·보기 불일치·원문과 평문 동일(표기 변형 없음). 경고:{' '}
                  passage 미연결로 원문 비교 생략.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGrammarVariantOpen(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-2"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              {grammarVariantLoading && !grammarVariantData && (
                <div className="flex items-center justify-center gap-2 py-12 text-indigo-300">
                  <span className="inline-block w-6 h-6 border-2 border-indigo-500/50 border-t-indigo-300 rounded-full animate-spin" />
                  검증 중…
                </div>
              )}
              {grammarVariantError && (
                <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-800/50 text-red-300 text-sm">
                  {grammarVariantError}
                </div>
              )}
              {grammarVariantData && !grammarVariantLoading && (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-slate-300">
                      어법 전체 <strong className="text-white">{grammarVariantData.totalScanned.toLocaleString()}</strong>건 중{' '}
                      <strong className="text-white">{grammarVariantData.scanned.toLocaleString()}</strong>건 검사
                      {grammarVariantData.truncated && (
                        <span className="text-amber-400 text-xs ml-1">(스캔 상한 {grammarVariantData.maxScan.toLocaleString()}건)</span>
                      )}
                      {grammarVariantData.filters.textbook && (
                        <> · 교재: <strong className="text-indigo-200">{grammarVariantData.filters.textbook}</strong></>
                      )}
                      <br />
                      <span className="text-red-300">오류 {grammarVariantData.withErrors.toLocaleString()}건</span>
                      {' · '}
                      <span className="text-amber-200">경고만 {grammarVariantData.withWarningsOnly.toLocaleString()}건</span>
                    </p>
                    <button
                      type="button"
                      onClick={runGrammarVariantValidate}
                      disabled={grammarVariantLoading || grammarBlocksRegenLoading || grammarWrongSlotRegenLoading}
                      className="text-xs px-3 py-1.5 rounded-lg bg-indigo-800/80 hover:bg-indigo-700 text-indigo-200 disabled:opacity-50"
                    >
                      다시 검증
                    </button>
                    {/* 배치 크기 선택 */}
                    <label className="flex items-center gap-1.5 text-xs text-slate-400">
                      <span className="whitespace-nowrap">건씩 처리:</span>
                      <select
                        value={grammarRegenBatchSize}
                        onChange={(e) => setGrammarRegenBatchSize(Number(e.target.value))}
                        disabled={grammarBlocksRegenLoading || grammarWrongSlotRegenLoading}
                        className="bg-slate-700 border border-slate-600 text-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                      >
                        {[10, 20, 30, 50, 100].map((n) => (
                          <option key={n} value={n}>{n}건</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={runGrammarBlocksBulkRegenerate}
                      disabled={
                        grammarVariantLoading ||
                        grammarBlocksRegenLoading ||
                        grammarWrongSlotRegenLoading ||
                        grammarBlocksErrorIds.length === 0
                      }
                      title={`오류 코드「blocks」: ①~⑤ 밑줄 형식이 아닌 Paragraph 문항. passage 원문으로 Claude 재생성(문항 번호·Source·UniqueID 유지). 이번 ${Math.min(grammarRegenBatchSize, grammarBlocksErrorIds.length)}건 처리.`}
                      className="text-xs px-3 py-1.5 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-rose-100 border border-rose-600/40 disabled:opacity-50"
                    >
                      {grammarBlocksRegenLoading
                        ? '재생성 중…'
                        : `밑줄 형식 오류 ${grammarBlocksErrorIds.length}건 중 ${Math.min(grammarRegenBatchSize, grammarBlocksErrorIds.length)}건 재생성`}
                    </button>
                    <button
                      type="button"
                      onClick={runGrammarWrongSlotBulkRegenerate}
                      disabled={
                        grammarVariantLoading ||
                        grammarBlocksRegenLoading ||
                        grammarWrongSlotRegenLoading ||
                        grammarWrongSlotErrorIds.length === 0
                      }
                      title={`오류 코드「wrong_slot_equals_original」: 정답 번호 밑줄이 원문과 동일한 문항. 원문과 다른 형태(틀린 어법)로 바꾸도록 힌트를 추가해 Claude 재생성. 이번 ${Math.min(grammarRegenBatchSize, grammarWrongSlotErrorIds.length)}건 처리.`}
                      className="text-xs px-3 py-1.5 rounded-lg bg-amber-900/80 hover:bg-amber-800 text-amber-100 border border-amber-600/40 disabled:opacity-50"
                    >
                      {grammarWrongSlotRegenLoading
                        ? '재생성 중…'
                        : `정답칸=원문 오류 ${grammarWrongSlotErrorIds.length}건 중 ${Math.min(grammarRegenBatchSize, grammarWrongSlotErrorIds.length)}건 재생성`}
                    </button>
                  </div>
                  {grammarBlocksRegenMessage && (
                    <p className="text-xs text-emerald-400/90 mb-2">{grammarBlocksRegenMessage}</p>
                  )}
                  {grammarWrongSlotRegenMessage && (
                    <p className="text-xs text-emerald-400/90 mb-2">{grammarWrongSlotRegenMessage}</p>
                  )}
                  {grammarVariantData.items.length === 0 ? (
                    <p className="text-emerald-400/90 text-sm py-4">
                      검사한 범위에서 오류·경고가 없습니다. (구조·보기 일치·원문 대비 표기 변형)
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-600 max-h-[50vh] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-900 z-[1]">
                          <tr className="text-left text-slate-400 border-b border-slate-600">
                            <th className="py-2 px-2">작업</th>
                            <th className="py-2 px-2">구분</th>
                            <th className="py-2 px-2">교재</th>
                            <th className="py-2 px-2">출처</th>
                            <th className="py-2 px-2">내용</th>
                          </tr>
                        </thead>
                        <tbody>
                          {grammarVariantData.items.map((it) => (
                            <tr key={it.id} className="border-b border-slate-700/50 hover:bg-slate-800/40">
                              <td className="py-1.5 px-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setGrammarVariantOpen(false);
                                    openEdit(it.id);
                                  }}
                                  className="text-indigo-400 hover:text-indigo-300 underline"
                                >
                                  수정
                                </button>
                              </td>
                              <td className="py-1.5 px-2 whitespace-nowrap">
                                {it.errors.length > 0 ? (
                                  <span className="text-red-400 font-medium">오류</span>
                                ) : (
                                  <span className="text-amber-400 font-medium">경고</span>
                                )}
                              </td>
                              <td className="py-1.5 px-2 text-slate-300">{it.textbook}</td>
                              <td className="py-1.5 px-2 text-slate-300 font-mono">{it.source}</td>
                              <td className="py-1.5 px-2 text-slate-400">
                                <ul className="list-disc pl-4 space-y-1">
                                  {it.errors.map((e, i) => (
                                    <li key={`e-${i}`} className="text-red-300/90">
                                      {e.message}
                                    </li>
                                  ))}
                                  {it.warnings.map((w, i) => (
                                    <li key={`w-${i}`} className="text-amber-200/90">
                                      {w.message}
                                    </li>
                                  ))}
                                </ul>
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

      {orderLogsOpen && (
        <div className="fixed inset-0 z-[59] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-600 flex justify-between items-center shrink-0 bg-slate-800/95">
              <div>
                <h2 className="text-lg font-bold text-slate-100">주문 일괄 처리 로그</h2>
                <p className="text-xs text-slate-400 mt-1">
                  <code className="text-slate-500">gomijoshua.order_processing_logs</code> — 배치·HWP 큐 기록.{' '}
                  <strong className="text-slate-300">문제수 검증</strong> 버튼으로 동일 주문의{' '}
                  <span className="text-emerald-300/90">지금 DB 기준</span> 부족을 봅니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOrderLogsOpen(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none px-2"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">status</label>
                  <input
                    value={orderLogsStatusFilter}
                    onChange={(e) => setOrderLogsStatusFilter(e.target.value)}
                    placeholder="queued, completed …"
                    className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-40"
                  />
                </div>
                <div className="flex-1 min-w-[160px]">
                  <label className="block text-xs text-slate-400 mb-1">주문번호 포함 검색</label>
                  <input
                    value={orderLogsOrderNumberFilter}
                    onChange={(e) => setOrderLogsOrderNumberFilter(e.target.value)}
                    placeholder="BV-2026…"
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <button
                  type="button"
                  disabled={orderLogsLoading}
                  onClick={() => void fetchOrderLogs(0)}
                  className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-sm font-medium"
                >
                  조회
                </button>
              </div>
              {orderLogsError && (
                <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/50 text-red-200 text-sm">{orderLogsError}</div>
              )}
              {orderLogsLoading && <p className="text-slate-400 text-sm animate-pulse">불러오는 중…</p>}
              {!orderLogsLoading && !orderLogsError && (
                <>
                  <p className="text-xs text-slate-500">
                    총 <strong className="text-slate-300">{orderLogsTotal.toLocaleString()}</strong>건 ·{' '}
                    {orderLogsSkip + 1}–{Math.min(orderLogsSkip + ORDER_LOGS_PAGE_SIZE, orderLogsTotal)} 표시
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-slate-600">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-800 text-left text-slate-400 border-b border-slate-600">
                          <th className="px-3 py-2 font-semibold">처리 시각</th>
                          <th className="px-3 py-2 font-semibold">주문번호</th>
                          <th className="px-3 py-2 font-semibold">상태</th>
                          <th className="px-3 py-2 font-semibold">부족(건)</th>
                          <th className="px-3 py-2 font-semibold">로그 시점 needCreate</th>
                          <th className="px-3 py-2 font-semibold">사유</th>
                          <th className="px-3 py-2 font-semibold">작업</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderLogsItems.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                              로그가 없습니다.
                            </td>
                          </tr>
                        ) : (
                          orderLogsItems.map((row) => (
                            <tr key={row.id} className="border-b border-slate-700/50 hover:bg-slate-800/40">
                              <td className="px-3 py-2 text-slate-400 whitespace-nowrap text-xs">
                                {row.processed_at ? formatDbCreatedAt(row.processed_at) : '—'}
                              </td>
                              <td className="px-3 py-2 font-mono text-teal-200 text-xs">{row.order_number || '—'}</td>
                              <td className="px-3 py-2">
                                <span className="text-amber-200/90 text-xs">{row.status || '—'}</span>
                              </td>
                              <td className="px-3 py-2 tabular-nums text-slate-300">{row.shortage_count}</td>
                              <td className="px-3 py-2 text-xs text-slate-400">
                                {row.needCreateGrandTotal != null ? row.needCreateGrandTotal : '—'}
                              </td>
                              <td className="px-3 py-2 text-slate-400 text-xs max-w-xs truncate" title={row.reason}>
                                {row.reason || '—'}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                {row.order_id && /^[a-f0-9]{24}$/i.test(row.order_id) ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOrderLogsOpen(false);
                                      openQCountModal(row.order_id);
                                    }}
                                    className="text-cyan-400 hover:text-cyan-300 text-xs font-medium underline-offset-2 hover:underline"
                                  >
                                    문제수 검증
                                  </button>
                                ) : (
                                  <span className="text-slate-600 text-xs">—</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={orderLogsLoading || orderLogsSkip <= 0}
                        onClick={() => void fetchOrderLogs(Math.max(0, orderLogsSkip - ORDER_LOGS_PAGE_SIZE))}
                        className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                      >
                        이전
                      </button>
                      <button
                        type="button"
                        disabled={orderLogsLoading || orderLogsSkip + ORDER_LOGS_PAGE_SIZE >= orderLogsTotal}
                        onClick={() => void fetchOrderLogs(orderLogsSkip + ORDER_LOGS_PAGE_SIZE)}
                        className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                      >
                        다음
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-600 font-mono">
                      딥링크: /admin/generated-questions?qCountOrderId=&lt;order_id&gt;
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {qCountOpen && (
        <div className="fixed inset-0 z-[59] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
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
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed border-t border-slate-700/50 pt-2">
                  주문 범위 집계는 MCP <code className="text-slate-400">variant_get_shortage</code>와 동일한{' '}
                  <code className="text-slate-400">runQuestionCountValidation</code> 엔진입니다. 로그의{' '}
                  <code className="text-slate-400">shortage_details</code>는 기록 시점 스냅샷이며, 여기서 검증 실행 시{' '}
                  <strong className="text-slate-400">지금 DB 기준</strong>으로 다시 집계됩니다.
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

                  <div className="pt-3 border-t border-slate-700/60">
                    <span className="block text-sm font-medium text-cyan-100/90 mb-2">
                      변형문 집계 기준 (generated_questions.status)
                    </span>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <label className="inline-flex items-center gap-2 cursor-pointer text-slate-200">
                        <input
                          type="radio"
                          name="qCountQuestionStatus"
                          checked={qCountQuestionStatus === 'all'}
                          onChange={() => {
                            setQCountQuestionStatus('all');
                            setQCountError(null);
                          }}
                          className="text-cyan-500"
                        />
                        전체 (대기+완료+검수불일치 등)
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer text-slate-200">
                        <input
                          type="radio"
                          name="qCountQuestionStatus"
                          checked={qCountQuestionStatus === '대기'}
                          onChange={() => {
                            setQCountQuestionStatus('대기');
                            setQCountError(null);
                          }}
                          className="text-amber-500"
                        />
                        대기만
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer text-slate-200">
                        <input
                          type="radio"
                          name="qCountQuestionStatus"
                          checked={qCountQuestionStatus === '완료'}
                          onChange={() => {
                            setQCountQuestionStatus('완료');
                            setQCountError(null);
                          }}
                          className="text-emerald-500"
                        />
                        완료만
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer text-slate-200">
                        <input
                          type="radio"
                          name="qCountQuestionStatus"
                          checked={qCountQuestionStatus === '검수불일치'}
                          onChange={() => {
                            setQCountQuestionStatus('검수불일치');
                            setQCountError(null);
                          }}
                          className="text-rose-400"
                        />
                        검수불일치만
                      </label>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                      원문(passages)별로 연결된 변형문을 위 status로 한정해 개수를 셉니다. 「대기만」은 검수 전 초안,
                      「완료만」은 확정 문항, 「검수불일치만」은 재시도 검수 등으로 표시한 문항만 반영합니다.
                    </p>
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

                  {(qCountPreviewLoading ||
                    qCountPreviewError ||
                    (qCountPreviewStats && qCountPreviewStats.ok === true)) && (
                    <div className="rounded-xl border border-cyan-900/45 bg-slate-950/70 px-3 py-2.5 text-xs mb-3">
                      {qCountPreviewLoading && (
                        <p className="text-slate-500 animate-pulse">DB 규모 조회 중…</p>
                      )}
                      {qCountPreviewError && !qCountPreviewLoading && (
                        <p className="text-amber-300/90">{qCountPreviewError}</p>
                      )}
                      {qCountPreviewStats &&
                        qCountPreviewStats.ok === true &&
                        !qCountPreviewLoading &&
                        (qCountPreviewStats.orderMetaMissing === true ||
                        qCountPreviewStats.orderNotBookVariant === true ? (
                          <p className="text-amber-200/90">
                            {typeof qCountPreviewStats.message === 'string'
                              ? qCountPreviewStats.message
                              : '이 주문은 미리보기 집계를 지원하지 않습니다.'}
                            {qCountPreviewStats.orderNotBookVariant === true &&
                              typeof qCountPreviewStats.flow === 'string' && (
                                <span className="text-slate-500"> (flow: {qCountPreviewStats.flow})</span>
                              )}
                          </p>
                        ) : (
                          <div className="text-slate-300 space-y-1.5">
                            {typeof qCountPreviewStats.message === 'string' && (
                              <p className="text-amber-200/90">{qCountPreviewStats.message}</p>
                            )}
                            <p className="font-semibold text-cyan-200/95">선택 조건 DB 요약</p>
                            <ul className="list-disc list-inside text-slate-400 space-y-0.5 leading-relaxed">
                              <li>
                                <strong className="text-slate-300">passages</strong>{' '}
                                {Number(qCountPreviewStats.passageCount ?? 0).toLocaleString()}건
                                {qCountPreviewStats.scope === 'order' &&
                                  typeof qCountPreviewStats.orderLessonsRequested === 'number' && (
                                    <>
                                      {' '}
                                      <span className="text-slate-500">
                                        (주문 라벨 {qCountPreviewStats.orderLessonsRequested.toLocaleString()}개 중
                                        DB 매칭)
                                      </span>
                                    </>
                                  )}
                              </li>
                              <li>
                                <strong className="text-slate-300">generated_questions</strong> (교재명 동일
                                {qCountPreviewStats.questionStatusScope === '대기'
                                  ? ', status=대기'
                                  : qCountPreviewStats.questionStatusScope === '완료'
                                    ? ', status=완료'
                                    : qCountPreviewStats.questionStatusScope === '검수불일치'
                                      ? ', status=검수불일치'
                                      : ''}
                                ){' '}
                                {Number(qCountPreviewStats.generatedQuestionsCount ?? 0).toLocaleString()}건
                              </li>
                              <li>
                                유형 부족 표 이론상 최대 약{' '}
                                <strong className="text-white tabular-nums">
                                  {Number(qCountPreviewStats.underfilledRowsWorstCase ?? 0).toLocaleString()}
                                </strong>
                                행 (지문 × 표준 유형 {Number(qCountPreviewStats.standardTypeCount ?? 11)}개)
                              </li>
                              <li>
                                미생성(변형 0건) 표 최대{' '}
                                <strong className="text-white tabular-nums">
                                  {Number(qCountPreviewStats.noQuestionsRowsWorstCase ?? 0).toLocaleString()}
                                </strong>
                                행
                              </li>
                            </ul>
                            <p className="text-slate-500 mt-2 leading-relaxed border-t border-slate-700/60 pt-2">
                              아래 <strong className="text-slate-400">최대 행 수</strong>는 미생성·유형부족 표
                              <strong className="text-slate-400"> 각각</strong>에 따로 적용됩니다. 잘림을 줄이려면
                              실제 검증 결과의 총건(또는 위 이론상 최대) 이상으로 맞추면 됩니다. (요청 상한 35,000)
                            </p>
                          </div>
                        ))}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-cyan-100/90 mb-2">
                      화면에 표시할 목록 최대 행 수
                    </label>
                    <p className="text-xs text-slate-500 mb-2 leading-relaxed">
                      <strong className="text-slate-400">미생성·유형 부족</strong> 표만 잘립니다.{' '}
                      <strong className="text-slate-400">총 건수</strong>(숫자 요약)은 항상 전체 지문 기준입니다. 전체
                      행 목록은 <strong className="text-slate-400">스냅샷 저장</strong>으로 DB에 그대로 남길 수 있습니다. (요청
                      상한 35,000행)
                    </p>
                    <select
                      value={qCountMaxListRows}
                      onChange={(e) => setQCountMaxListRows(Number(e.target.value) || 12_000)}
                      className="bg-slate-900 border border-cyan-800/60 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      {[4000, 8000, 12_000, 16_000, 20_000, 25_000, 30_000, 35_000].map((n) => (
                        <option key={n} value={n}>
                          {n.toLocaleString()}행
                        </option>
                      ))}
                    </select>
                  </div>

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
                        setQCountSnapshotMsg(null);
                      }}
                      className="text-sm px-3 py-2 rounded-lg border border-slate-500 text-slate-300 hover:bg-slate-700"
                    >
                      ← 다시 검증
                    </button>
                  </div>

                  <div className="mb-4 p-3 rounded-lg border border-cyan-800/50 bg-slate-900/50 space-y-2">
                    <p className="text-xs text-slate-400 leading-relaxed">
                      검증 결과를 MongoDB 컬렉션{' '}
                      <code className="text-cyan-300/90 text-[11px]">question_count_validation_snapshots</code>에
                      남겨 두려면 아래를 사용하세요. 저장 시{' '}
                      <strong className="text-slate-300">같은 조건으로 서버에서 다시 집계</strong>한 뒤 전체 행이
                      기록됩니다(화면 2,500행 제한과 무관).
                    </p>
                    <input
                      type="text"
                      value={qCountSnapshotNote}
                      onChange={(e) => setQCountSnapshotNote(e.target.value)}
                      placeholder="메모 (선택, 예: 2025-03 검수 전)"
                      className="w-full max-w-md bg-slate-950 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={qCountSnapshotSaving}
                        onClick={() => void saveQuestionCountSnapshot()}
                        className="text-sm px-3 py-2 rounded-lg bg-cyan-800 hover:bg-cyan-700 disabled:opacity-50 text-white font-medium"
                      >
                        {qCountSnapshotSaving ? '저장 중…' : '이 조건으로 스냅샷 저장'}
                      </button>
                      <button
                        type="button"
                        disabled={qCountSnapshotsLoading}
                        onClick={() => void loadQuestionCountSnapshots()}
                        className="text-sm px-3 py-2 rounded-lg border border-slate-500 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                      >
                        {qCountSnapshotsLoading ? '불러오는 중…' : '최근 스냅샷 목록'}
                      </button>
                    </div>
                    {qCountSnapshotMsg && (
                      <p className="text-xs text-emerald-300/90 break-all">{qCountSnapshotMsg}</p>
                    )}
                    {qCountSnapshots.length > 0 && (
                      <div className="mt-2 max-h-40 overflow-y-auto rounded border border-slate-700/80 text-xs">
                        <table className="w-full text-left">
                          <thead className="sticky top-0 bg-slate-800 text-slate-400">
                            <tr>
                              <th className="px-2 py-1 font-medium">저장 시각</th>
                              <th className="px-2 py-1 font-medium">교재</th>
                              <th className="px-2 py-1 font-medium">집계</th>
                              <th className="px-2 py-1 font-medium">요약</th>
                              <th className="px-2 py-1 font-medium">메모</th>
                            </tr>
                          </thead>
                          <tbody>
                            {qCountSnapshots.map((s) => {
                              const sum = s.summary as Record<string, number | undefined> | null;
                              return (
                                <tr key={s.id} className="border-t border-slate-700/60 text-slate-300">
                                  <td className="px-2 py-1 whitespace-nowrap text-slate-400">
                                    {s.saved_at
                                      ? new Date(s.saved_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                                      : '—'}
                                  </td>
                                  <td className="px-2 py-1 max-w-[120px] truncate" title={s.query.textbook}>
                                    {s.query.textbook}
                                  </td>
                                  <td className="px-2 py-1 text-[11px] text-slate-400 whitespace-nowrap">
                                    {s.query.question_status === '대기'
                                      ? '대기'
                                      : s.query.question_status === '완료'
                                        ? '완료'
                                        : s.query.question_status === '검수불일치'
                                          ? '검수불일치'
                                          : '전체'}
                                  </td>
                                  <td className="px-2 py-1 text-[11px] text-slate-400">
                                    지문 {sum?.passageCount ?? '—'} · 미생성 {sum?.noQuestionsTotal ?? '—'} · 부족{' '}
                                    {sum?.underfilledTotal ?? '—'}
                                  </td>
                                  <td className="px-2 py-1 max-w-[100px] truncate" title={s.note || ''}>
                                    {s.note || '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <p className="px-2 py-1 text-[10px] text-slate-500 border-t border-slate-700/60">
                          상세(전체 행)는{' '}
                          <code className="text-slate-400">
                            GET /api/admin/generated-questions/validate/question-counts/snapshots/&#123;id&#125;
                          </code>
                        </p>
                      </div>
                    )}
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
                      변형 집계:{' '}
                      <strong
                        className={
                          qCountData.questionStatusScope === '대기'
                            ? 'text-amber-200'
                            : qCountData.questionStatusScope === '완료'
                              ? 'text-emerald-200'
                              : qCountData.questionStatusScope === '검수불일치'
                                ? 'text-rose-200'
                                : 'text-slate-100'
                        }
                      >
                        {qCountData.questionStatusScope === 'all'
                          ? '전체'
                          : qCountData.questionStatusScope === '대기'
                            ? '대기만'
                            : qCountData.questionStatusScope === '완료'
                              ? '완료만'
                              : '검수불일치만'}
                      </strong>
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
                    {(qCountData.pendingReviewTotal != null || qCountData.pendingInScopeTotal != null) && (
                      <span className="text-violet-200/90">
                        <strong className="text-violet-100">검수 대기</strong> 변형:{' '}
                        <strong>
                          {(qCountData.pendingReviewTotal ?? qCountData.pendingInScopeTotal ?? 0).toLocaleString()}
                        </strong>
                        건
                        <span className="text-slate-500 text-xs font-normal">
                          {' '}
                          (풀이·일치 시 완료 · MCP{' '}
                          <code className="text-slate-500">variant_review_pending_record</code>)
                        </span>
                      </span>
                    )}
                    {(qCountData.needCreateGrandTotal != null ||
                      qCountData.needCreateShortBySum != null) && (
                      <span className="text-amber-200/90">
                        <strong className="text-amber-100">신규 작성 필요</strong> 추정:{' '}
                        <strong>{(qCountData.needCreateGrandTotal ?? 0).toLocaleString()}</strong>건
                        <span className="text-slate-500 text-xs font-normal">
                          {' '}
                          (유형 부족 합 {qCountData.needCreateShortBySum?.toLocaleString() ?? '—'} + 무지문 슬롯{' '}
                          {qCountData.needCreateFromEmptyPassagesTotal?.toLocaleString() ?? '—'})
                        </span>
                      </span>
                    )}
                  </div>
                  {(qCountData.noQuestionsTruncated || qCountData.underfilledTruncated) && (
                    <p className="text-xs text-amber-500/90 mb-4">
                      표시는 각 목록 최대 2,500행까지입니다. 전체 건수는 위 요약 숫자를 참고하세요.
                    </p>
                  )}

                  <section className="mb-8">
                    <h3 className="text-sm font-bold text-rose-200 mb-2 border-b border-rose-900/40 pb-1">
                      변형문이 전혀 없는 지문 (passage_id 연결 0건
                      {qCountData.questionStatusScope !== 'all'
                        ? ` · ${qCountData.questionStatusScope}만 집계`
                        : ''}
                      )
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
                      유형별 기준 미충족 (각 유형 {qCountData.requiredPerType}문항 미만
                      {qCountData.questionStatusScope !== 'all'
                        ? ` · ${qCountData.questionStatusScope}만 집계`
                        : ''}
                      )
                    </h3>
                    {qCountData.underfilledTotal > 0 && (
                      <>
                        <p className="text-[11px] text-slate-500 mb-2">
                          <strong className="text-amber-400/90">부족</strong> 열의 숫자를 누르면 해당 지문·유형이
                          채워진 <strong className="text-slate-400">새 변형문제</strong> 작성 창이 열립니다. 같은
                          passage·type으로 부족한 만큼 저장하면 기준 문항 수에 맞출 수 있습니다.{' '}
                          <strong className="text-slate-400">유형(카테고리)</strong> 또는{' '}
                          <strong className="text-slate-400">지문 라벨</strong> 헤더를 누르면 유형별·지문 순으로 정렬이 바뀝니다.
                          {qCountData.questionStatusScope === 'all' && (
                            <>
                              {' '}
                              집계가 <strong className="text-violet-300/90">전체</strong>일 때{' '}
                              <strong className="text-slate-400">완료/대기/검수불일치/기타</strong> 열에 문항 수가 갈라져
                              보입니다. <strong className="text-violet-300/90">대기</strong>는 아직 검수 전이며, Claude
                              Code에서 풀이 후 <code className="text-slate-500">variant_review_pending_record</code>로
                              기록하고 정답이 맞으면 자동으로 <strong className="text-emerald-300/90">완료</strong>로
                              바뀝니다(재시도 시 <code className="text-slate-500">attemptNumber≥2</code>이면{' '}
                              <strong className="text-rose-300/90">검수불일치</strong>).
                            </>
                          )}
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
                              {qCountData.questionStatusScope === 'all' && (
                                <th className="py-2 px-2 text-right text-[10px] leading-tight text-violet-300/90">
                                  완료/대기/검수불일치/기타
                                </th>
                              )}
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
                                  {qCountData.questionStatusScope === 'all' && (
                                    <td className="py-1.5 px-2 text-right text-[10px] text-slate-400 whitespace-nowrap">
                                      {r.statusBreakdown ? (
                                        <>
                                          <span className="text-emerald-400/90">{r.statusBreakdown.완료}</span>/
                                          <span className="text-violet-300/90">{r.statusBreakdown.대기}</span>/
                                          <span className="text-rose-300/85">
                                            {r.statusBreakdown.검수불일치 ?? 0}
                                          </span>
                                          /
                                          <span className="text-slate-500">{r.statusBreakdown.기타}</span>
                                        </>
                                      ) : (
                                        '—'
                                      )}
                                    </td>
                                  )}
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
                    {solveRow.id === '__draft__' && (
                      <span className="mr-2 text-amber-400 font-medium">편집 중 JSON · </span>
                    )}
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
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 overflow-y-auto">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-600 px-5 py-4 flex justify-between items-center z-10">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold">
                  {editingId
                    ? narrativeReadOnly
                      ? '서술형 문항 상세 (읽기 전용)'
                      : '변형문제 수정'
                    : shortageBatch
                      ? `부족 문항 순차 처리 (${shortageBatch.totalCreated}/${shortageBatch.rows.reduce((s, r) => s + r.shortBy, 0)}건 완료 · 현재: ${shortageBatch.rows[shortageBatch.rowIndex].label} ${shortageBatch.rows[shortageBatch.rowIndex].type})`
                      : '새 변형문제'}
                </h2>
                {(draftLoading || saving || explanationOnlyLoading) && (
                  <span className="inline-flex items-center gap-2 text-sm text-amber-300">
                    <span className="inline-block w-4 h-4 border-2 border-amber-500/50 border-t-amber-300 rounded-full animate-spin shrink-0" />
                    {explanationOnlyLoading
                      ? '해설 생성 중…'
                      : draftLoading
                        ? 'Claude 작성 중…'
                        : '저장 중…'}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setNarrativeReadOnly(false);
                }}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              {narrativeReadOnly && (
                <div className="rounded-lg border border-cyan-600/45 bg-cyan-950/35 px-3 py-2 text-sm text-cyan-100/95">
                  <code className="text-cyan-300/90">narrative_questions</code> 문항입니다. 목록·JSON은 조회만 가능하며, 저장·삭제·Claude 초안은 변형문제(
                  <code className="text-slate-400">generated_questions</code>)에서 진행해 주세요.
                </div>
              )}
              <fieldset
                disabled={narrativeReadOnly}
                className="min-w-0 border-0 p-0 m-0 space-y-4 disabled:opacity-95"
              >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {editingId ? (
                  <div className="sm:col-span-2">
                    <label className="text-xs text-slate-400 block mb-1">passage_id (원문 passages._id) *</label>
                    <input
                      value={form.passage_id}
                      onChange={(e) => setForm((f) => ({ ...f, passage_id: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white font-mono"
                      placeholder="24자 hex ObjectId"
                    />
                  </div>
                ) : (
                  <>
                    <div className="sm:col-span-2">
                      <label className="text-xs text-slate-400 block mb-1">교재명 *</label>
                      <select
                        value={form.textbook}
                        onChange={(e) => {
                          const v = e.target.value;
                          setForm((f) => ({ ...f, textbook: v, passage_id: '', source: '' }));
                        }}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                      >
                        <option value="">교재 선택…</option>
                        {textbooks.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs text-slate-400 block mb-1">출처 (원문 지문) *</label>
                      <select
                        value={
                          passagePickerItems.some((p) => p.id === form.passage_id) ? form.passage_id : ''
                        }
                        onChange={(e) => {
                          const id = e.target.value;
                          const row = passagePickerItems.find((p) => p.id === id);
                          const rawSrc = row?.sourceForDb ?? '';
                          setForm((f) => ({
                            ...f,
                            passage_id: id,
                            source: normalizeMockVariantSourceLabel(f.textbook, rawSrc),
                          }));
                        }}
                        disabled={!form.textbook.trim() || passagePickerLoading}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
                      >
                        <option value="">
                          {passagePickerLoading
                            ? '지문 목록 불러오는 중…'
                            : !form.textbook.trim()
                              ? '먼저 교재를 선택하세요'
                              : '원문 지문(passage) 선택…'}
                        </option>
                        {passagePickerItems.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      {form.textbook.trim() &&
                        !passagePickerLoading &&
                        passagePickerItems.length === 0 && (
                          <p className="text-[11px] text-amber-400/90 mt-1">
                            이 교재에 등록된 passage가 없습니다. 원문 관리에서 먼저 등록하세요.
                          </p>
                        )}
                      {form.passage_id && /^[a-f0-9]{24}$/i.test(form.passage_id) && (
                        <p className="text-[11px] text-slate-500 mt-1.5 font-mono">
                          저장 시 사용되는 passages._id: {form.passage_id}
                          {form.source ? (
                            <span className="block text-slate-600 mt-0.5 font-sans">
                              source 필드: {form.source}
                            </span>
                          ) : null}
                        </p>
                      )}
                      {form.passage_id &&
                        /^[a-f0-9]{24}$/i.test(form.passage_id) &&
                        !passagePickerLoading &&
                        form.textbook.trim() &&
                        passagePickerItems.length > 0 &&
                        !passagePickerItems.some((p) => p.id === form.passage_id) && (
                          <p className="text-[11px] text-amber-300/90 mt-1.5">
                            선택 목록에 없는 passage입니다. 부족 문항 등에서 연 경우 그대로 저장·초안 생성할 수 있습니다.
                          </p>
                        )}
                    </div>
                  </>
                )}
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
                {editingId && (
                  <>
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
                        placeholder="부교재: 01강 기출 예제 / 모의고사: 26년 3월 고2 영어모의고사 34번 (번호 앞 중점·복붙 — 제거는 저장 시)"
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="text-xs text-slate-400 flex items-center gap-1.5 mb-1">
                    유형 (type) *
                    {(() => {
                      const stored = loadTypePromptsFromStorage();
                      const hasPrompt = form.difficulty === '상'
                        ? true
                        : !!(form.type.trim() && stored[form.type.trim()]);
                      if (!hasPrompt) return null;
                      return (
                        <button
                          type="button"
                          onClick={() => setPromptPreviewOpen(true)}
                          className="text-violet-400 hover:text-violet-300 transition-colors"
                          title="이 유형의 프롬프트 보기"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
                          </svg>
                        </button>
                      );
                    })()}
                  </label>
                  {form.difficulty === '상' ? (
                    <select
                      value={form.type}
                      onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      <option value="삽입">삽입</option>
                    </select>
                  ) : (
                    <>
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
                    </>
                  )}
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
                  <label className="text-xs text-slate-400 block mb-1">난이도</label>
                  <select
                    value={form.difficulty}
                    onChange={(e) => {
                      const d = e.target.value;
                      setForm((f) => ({
                        ...f,
                        difficulty: d,
                        ...(d === '상' && f.type !== '삽입' ? { type: '삽입' } : {}),
                      }));
                    }}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {['중', '상'].map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">상태</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {['완료', '대기', '검수불일치', '오류'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                    {statuses.filter((s) => !['완료', '대기', '검수불일치', '오류'].includes(s)).map((s) => (
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
                      title={
                        editingId
                          ? '현재 지문·유형으로 Claude가 새 초안 작성 (기존 JSON 덮어씀). ANTHROPIC_API_KEY 필요.'
                          : 'passages 원문 + 위 유형으로 Claude가 1문항 JSON 초안 작성. ANTHROPIC_API_KEY 필요.'
                      }
                    >
                      {draftLoading && (
                        <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                      )}
                      {draftLoading ? 'Claude 작성 중…' : editingId ? 'Claude로 초안 다시 생성' : 'Claude로 초안 생성'}
                    </button>
                    {form.difficulty === '상' && form.type === '삽입' && (
                      <>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            const parsed = JSON.parse(questionJson) as Record<string, unknown>;
                            const errors: string[] = [];

                            const requiredKeys = ['Question', 'Paragraph', 'Options', 'CorrectAnswer', 'Explanation'];
                            for (const k of requiredKeys) {
                              if (!parsed[k] || (typeof parsed[k] === 'string' && !(parsed[k] as string).trim())) {
                                errors.push(`"${k}" 필드가 비어 있습니다.`);
                              }
                            }

                            const para = String(parsed.Paragraph ?? '');
                            const parts = para.split(/\n\n|\n###\n|###/);
                            if (parts.length < 2) {
                              errors.push('Paragraph: "삽입 문장\\n\\n본문" 형식이어야 합니다 (구분이 없음).');
                            } else {
                              const givenSentence = parts[0].trim();
                              const body = parts.slice(1).join(' ').trim();

                              const wordCount = givenSentence.split(/\s+/).filter(Boolean).length;
                              if (wordCount < 10 || wordCount > 45) {
                                errors.push(`삽입 문장 길이: ${wordCount}단어 (권장 15~35).`);
                              }

                              if (!/\b(this|such|these|those|however|therefore|consequently|as a result|in other words|thus|hence|nevertheless|furthermore|moreover)\b/i.test(givenSentence)) {
                                errors.push('삽입 문장에 지시어/연결어(this, such, however 등)가 없습니다.');
                              }

                              const givenLower = givenSentence.toLowerCase().replace(/[^a-z\s]/g, '').trim();
                              if (givenLower.length > 20 && body.toLowerCase().includes(givenLower)) {
                                errors.push('삽입 문장이 본문에 그대로 존재합니다 — 새 문장을 생성해야 합니다.');
                              }

                              const markers = body.match(/[①②③④⑤]/g) ?? [];
                              if (markers.length < 5) {
                                errors.push(`본문에 ①~⑤ 위치 마커가 ${markers.length}개뿐입니다 (5개 필요).`);
                              }
                            }

                            const answer = String(parsed.CorrectAnswer ?? '').trim();
                            if (answer && !/^[①②③④⑤]$/.test(answer)) {
                              errors.push(`CorrectAnswer "${answer}"가 ①~⑤ 형식이 아닙니다.`);
                            }

                            if (errors.length === 0) {
                              alert('검증 통과: 양식이 올바릅니다.');
                            } else {
                              alert('검증 실패:\n\n' + errors.map((e, i) => `${i + 1}. ${e}`).join('\n'));
                            }
                          } catch {
                            alert('JSON 파싱 실패: 유효한 JSON 형식인지 확인하세요.');
                          }
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold shadow-md"
                        title="난이도 상 삽입 문제의 양식이 올바른지 검증합니다"
                      >
                        양식 검증
                      </button>
                      <button
                        type="button"
                        disabled={!passagePreview}
                        onClick={async () => {
                          const prompt = `${HARD_INSERTION_PROMPT}\n\n---\n\n[지문 Paragraph]\n${passagePreview ?? ''}`;
                          try {
                            await navigator.clipboard.writeText(prompt);
                            window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
                            alert('프롬프트 + 지문을 클립보드에 복사했습니다.\nChatGPT에서 붙여넣기(Cmd+V) 후 전송하세요.');
                          } catch {
                            alert('클립보드 복사에 실패했습니다.');
                          }
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white font-bold disabled:opacity-50 shadow-md"
                        title="난이도 상 삽입 프롬프트 + 원문을 클립보드에 복사하고 ChatGPT를 엽니다"
                      >
                        GPT로 문제 만들기
                      </button>
                      </>
                    )}
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
                  「유형별 AI 프롬프트」에 저장한 지침이 위 유형에 자동 반영됩니다. 초안 생성은 서버가 Anthropic API를
                  한 번 호출해 JSON을 채웁니다 (<code className="text-slate-400">ANTHROPIC_API_KEY</code>).{' '}
                  {editingId && '수정 시에도 새 초안으로 JSON을 덮어씁니다.'}
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
                {!narrativeReadOnly && isHamyiOrGrammarQuestionType(form.type, questionJson) && (
                  <div className="mb-2 rounded-lg border border-violet-800/40 bg-violet-950/25 px-3 py-2 space-y-2">
                    <p className="text-[11px] text-violet-200/95 leading-relaxed">
                      <strong className="text-violet-100">함의·어법</strong>은 DB·검증에 <code className="text-slate-400">&lt;u&gt;</code> 태그가
                      필요합니다. 아래에서 선택만 하고 태그는 자동으로 넣을 수 있습니다. (하단 <strong className="text-violet-100">저장</strong>은
                      서버에 반영하는 버튼과 별개입니다.)
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={draftLoading || saving || explanationOnlyLoading}
                        onClick={wrapQuestionJsonSelectionWithUTags}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 text-white font-semibold disabled:opacity-50 border border-violet-500/40"
                        title="JSON 편집창에서 텍스트를 선택한 뒤 클릭 → 선택 구간을 <u>…</u>로 감쌉니다. Mac: ⌘U"
                      >
                        밑줄 태그 적용
                      </button>
                      <button
                        type="button"
                        disabled={draftLoading || saving || explanationOnlyLoading}
                        onClick={stripQuestionJsonSelectionUTags}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-500/60 bg-slate-800/80 text-slate-200 hover:bg-slate-700 font-medium disabled:opacity-50"
                        title="선택 구간에서 <u> </u> 태그만 제거합니다."
                      >
                        밑줄 태그 제거
                      </button>
                      {isHamyiQuestionType(form.type, questionJson) && (
                        <button
                          type="button"
                          disabled={draftLoading || saving || explanationOnlyLoading}
                          onClick={syncHamyiQuestionFromParagraphUnderline}
                          className="text-[11px] px-2.5 py-1.5 rounded-lg border border-emerald-600/50 bg-emerald-950/40 text-emerald-100 hover:bg-emerald-900/50 font-semibold disabled:opacity-50"
                          title="Paragraph의 첫 <u>…</u> 내용으로 발문(Question)을 표준 문장으로 맞춥니다."
                        >
                          함의: 발문 자동
                        </button>
                      )}
                    </div>
                    {isGrammarQuestionType(form.type, questionJson) && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5 border-t border-violet-800/30">
                        <span className="text-[10px] text-slate-400 shrink-0 mr-1">어법 번호+밑줄:</span>
                        {GRAMMAR_MARKS.map((mk) => (
                          <button
                            key={mk}
                            type="button"
                            disabled={draftLoading || saving || explanationOnlyLoading}
                            onClick={() => wrapQuestionJsonSelectionGrammarMarkAndU(mk)}
                            className="min-w-[2rem] text-[11px] px-2 py-1 rounded-md bg-slate-800 border border-slate-600 text-amber-100 hover:bg-slate-700 font-mono disabled:opacity-50"
                            title={`선택한 표현을 「${mk} <u>…</u>」형태로 바꿉니다.`}
                          >
                            {mk}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {(() => {
                  let para = '';
                  let category = '';
                  let optionsStr = '';
                  let correctAnswerStr = '';
                  try {
                    const q = JSON.parse(questionJson) as Record<string, unknown>;
                    para = typeof q?.Paragraph === 'string' ? q.Paragraph : '';
                    category = typeof q?.Category === 'string' ? q.Category : '';
                    optionsStr = typeof q?.Options === 'string' ? q.Options : '';
                    correctAnswerStr = typeof q?.CorrectAnswer === 'string' ? q.CorrectAnswer : '';
                  } catch {
                    /* invalid JSON while typing */
                  }
                  const isGrammar =
                    category === '어법' || form.type.trim() === '어법';
                  const grammarCheck =
                    isGrammar && para
                      ? validateGrammarUnderlineOptions(para, optionsStr, {
                          originalPassage: passagePreview,
                          correctAnswerRaw: correctAnswerStr,
                        })
                      : null;
                  const grammarStructureOk = grammarCheck?.ok === true;
                  const hasOriginalSameNotes = (grammarCheck?.originalNotes?.length ?? 0) > 0;
                  const structureBoxTone =
                    grammarCheck && !grammarStructureOk
                      ? 'border-amber-600/50 bg-amber-950/35 text-amber-100'
                      : grammarCheck && hasOriginalSameNotes
                        ? 'border-violet-600/45 bg-violet-950/30 text-violet-100'
                        : 'border-emerald-600/50 bg-emerald-950/40 text-emerald-200';
                  return para ? (
                    <div className="mb-3 rounded-lg bg-slate-900/80 border border-slate-600 p-3">
                      <p className="text-[11px] text-slate-500 mb-2 font-semibold uppercase tracking-wider">Paragraph 미리보기</p>
                      <p className="text-[10px] text-slate-600 mb-2">
                        번호는 미리보기 전용입니다. passage에 문장구분(영)이 있으면 그 순서로 나누고, 아니면 구두점·따옴표 뒤 공백으로 나눕니다.
                      </p>
                      {grammarCheck && (
                        <div className="mb-2 space-y-2">
                          <div className={`rounded-lg border px-2.5 py-2 text-[11px] ${structureBoxTone}`}>
                            <span className="font-semibold">어법 점검(형식): </span>
                            {grammarStructureOk ? (
                              <>
                                ①~⑤ 밑줄 5개·순서, Options ### 구간 5개, 밑줄 단어와 지문 포함 관계를 통과했습니다.
                                {hasOriginalSameNotes &&
                                  ' 아래 「원문과 동일한 밑줄」을 함께 확인하세요.'}
                              </>
                            ) : (
                              <ul className="list-disc pl-4 mt-1 space-y-0.5">
                                {grammarCheck.issues.map((issue, i) => (
                                  <li key={i}>{issue}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                          {grammarCheck.originalCompareSkipped && !passagePreviewLoading && (
                            <p className="text-[10px] text-slate-500 leading-relaxed px-0.5">
                              {grammarCheck.originalCompareSkipped}{' '}
                              <span className="text-slate-600">
                                (passage_id가 맞으면 상단 「원문 미리보기」 로드 후 자동 비교됩니다.)
                              </span>
                            </p>
                          )}
                          {grammarCheck.originalNotes.length > 0 && (
                            <div className="rounded-lg border border-cyan-700/45 bg-cyan-950/25 px-2.5 py-2 text-[11px] text-cyan-100/95">
                              <p className="font-semibold text-cyan-200/95 mb-1">원문 대비 밑줄 표기</p>
                              <p className="text-[10px] text-cyan-200/75 leading-relaxed mb-1.5">
                                상단 「원문 미리보기」와 같은 표기가 밑줄 안에 그대로 있으면 아래에 표시합니다. 어법형은 보통 한 곳만 원문과 다른(틀린) 형태로
                                바꾸므로, 정답 번호(CorrectAnswer)에 해당하는 밑줄이 원문과 같다면
                                ‘틀린 것’이 아닐 수 있어 출제·JSON을 점검하는 것이 좋습니다.
                              </p>
                              <ul className="list-disc pl-4 space-y-1 text-cyan-100/90">
                                {grammarCheck.originalNotes.map((note, i) => (
                                  <li key={i}>{note}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="text-sm text-slate-200 leading-relaxed max-h-40 overflow-y-auto">
                        <ParagraphPreviewWithSentenceNumbers text={para} dbSentences={passageSentencesEn} />
                      </div>
                    </div>
                  ) : null;
                })()}
                <textarea
                  ref={questionJsonTextareaRef}
                  value={questionJson}
                  onChange={(e) => setQuestionJson(e.target.value)}
                  onKeyDown={(e) => {
                    if (!narrativeReadOnly && isHamyiOrGrammarQuestionType(form.type, questionJson)) {
                      if ((e.metaKey || e.ctrlKey) && (e.key === 'u' || e.key === 'U')) {
                        e.preventDefault();
                        wrapQuestionJsonSelectionWithUTags();
                      }
                    }
                  }}
                  rows={18}
                  className="w-full bg-slate-950 border border-violet-900/50 rounded-lg px-3 py-2 text-xs text-green-200 font-mono"
                />
              </div>
              </fieldset>
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalOpen(false);
                    setNarrativeReadOnly(false);
                  }}
                  className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={narrativeReadOnly || saving || draftLoading || explanationOnlyLoading || solveLoading}
                  onClick={() => void openSolveFromDraftModal()}
                  title="현재 question_data JSON으로 Claude가 풀고, 정답 일치 여부와 풀이를 표시합니다 (ANTHROPIC_API_KEY)."
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-teal-700 to-emerald-800 hover:from-teal-600 hover:to-emerald-700 text-white text-sm font-bold disabled:opacity-50 shadow-md"
                >
                  클로드코드로 생성된 문제 풀기
                </button>
                <button
                  type="button"
                  disabled={narrativeReadOnly || saving || draftLoading || explanationOnlyLoading}
                  onClick={async () => {
                    try {
                      const parsed = JSON.parse(questionJson) as Record<string, unknown>;
                      const prompt = buildEnglishExamSolveUserPrompt({
                        questionType: form.type,
                        paragraph: typeof parsed.Paragraph === 'string' ? parsed.Paragraph : '',
                        question: typeof parsed.Question === 'string' ? parsed.Question : '',
                        options: typeof parsed.Options === 'string' ? parsed.Options : '',
                      });
                      await navigator.clipboard.writeText(prompt);
                      window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
                      alert('풀이용 프롬프트를 클립보드에 복사했습니다.\nChatGPT 탭에서 붙여넣기(Cmd+V) 후 전송하세요.');
                    } catch {
                      alert('JSON 파싱 또는 클립보드 복사에 실패했습니다.');
                    }
                  }}
                  title="현재 question_data를 풀이 프롬프트로 변환 → 클립보드 복사 → ChatGPT 새 탭"
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-green-700 to-emerald-700 hover:from-green-600 hover:to-emerald-600 text-white text-sm font-bold disabled:opacity-50 shadow-md"
                >
                  GPT로 문제 풀기
                </button>
                <button
                  type="button"
                  disabled={narrativeReadOnly || saving || draftLoading || explanationOnlyLoading}
                  onClick={handleSave}
                  title="⌘↵(Mac) 또는 Ctrl+↵(Windows)로 저장"
                  className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 font-bold disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {saving && (
                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                  )}
                  {saving ? '저장 중…' : '저장'}
                  {!saving ? (
                    <span className="text-[10px] font-normal text-violet-200/80 tabular-nums hidden sm:inline">
                      ⌘↵ 저장 · Esc 닫기
                    </span>
                  ) : null}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {postSaveContinueOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75"
          onClick={dismissPostSaveContinue}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="post-save-continue-title"
            className="bg-slate-800 border border-violet-500/40 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="post-save-continue-title" className="text-lg font-bold text-white">
              이어서 문제 만들기
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              변형문제를 저장했습니다. 「이어서 만들기」를 누르면 <span className="text-violet-200 font-medium">새 변형문제</span> 창이 열리고, 방금 쓰던{' '}
              <span className="text-slate-200">교재·출처(지문)·유형</span>이 그대로 채워집니다. JSON만 초기 템플릿으로 비웁니다.
            </p>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={dismissPostSaveContinue}
                className="px-4 py-2.5 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-700 text-sm font-medium"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={handlePostSaveContinue}
                className="px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold"
              >
                이어서 만들기
              </button>
            </div>
          </div>
        </div>
      )}

      {promptPreviewOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-700">
              <h3 className="text-base font-bold text-white">
                {form.difficulty === '상'
                  ? `난이도 상 · ${form.type || '삽입'} 프롬프트`
                  : `${form.type || '유형'} 프롬프트`}
              </h3>
              <button
                type="button"
                onClick={() => setPromptPreviewOpen(false)}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <pre className="whitespace-pre-wrap text-sm text-slate-200 font-mono leading-relaxed">
                {form.difficulty === '상'
                  ? HARD_INSERTION_PROMPT
                  : (() => {
                      const stored = loadTypePromptsFromStorage();
                      const p = form.type.trim() ? (stored[form.type.trim()] ?? '') : '';
                      return p || '이 유형에 대한 프롬프트가 아직 설정되지 않았습니다.';
                    })()}
              </pre>
            </div>
            <div className="px-6 py-3 border-t border-slate-700 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const text = form.difficulty === '상'
                    ? HARD_INSERTION_PROMPT
                    : (() => {
                        const stored = loadTypePromptsFromStorage();
                        return form.type.trim() ? (stored[form.type.trim()] ?? '') : '';
                      })();
                  navigator.clipboard.writeText(text).then(() => {
                    alert('프롬프트가 클립보드에 복사되었습니다.');
                  });
                }}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold"
              >
                복사
              </button>
              <button
                type="button"
                onClick={() => setPromptPreviewOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm"
              >
                닫기
              </button>
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
