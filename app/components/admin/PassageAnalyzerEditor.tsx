'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type {
  EditorViewMode,
  PassageStateStored,
  SvocComponentId,
  SvocSentenceData,
  VocabularyEntry,
} from '@/lib/passage-analyzer-types';
import { SVOC_COMPONENTS, passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';
import { findWordIndices, getSyntaxColorForLabel, SYNTAX_LABEL_COLORS } from '@/lib/syntax-analyzer-word-match';
import {
  deriveSentencesFromPassageContent,
  mergeSavedOntoPassagesBase,
  sentenceIndicesMatchingTopicQuote,
} from '@/lib/passage-analyzer-passages';
import {
  COMPREHENSIVE_EXTRA_SLOT_HINT,
  COMPREHENSIVE_ITEM_LABELS,
  clampComprehensiveSlotCount,
  DEFAULT_PROMPTS,
  effectiveSlotOutputLang,
} from '@/lib/passage-analyzer-comprehensive';
import {
  DEFAULT_GRAMMAR_AI_PROMPT,
  GRAMMAR_AI_SENTENCES_PLACEHOLDER,
} from '@/lib/passage-analyzer-grammar-ai';
import {
  CONTEXT_AI_SENTENCES_PLACEHOLDER,
  DEFAULT_CONTEXT_AI_PROMPT,
} from '@/lib/passage-analyzer-context-ai';
import type { VocabularySortOrder } from '@/lib/passage-analyzer-vocabulary';
import {
  insertVocabularyAtSortedGap,
  mergeDuplicateVocabularyEntries,
  regenerateVocabularyPositions,
  sortVocabularyEntries,
  vocabularyPositionToDisplayIndex,
  VOCABULARY_CEFR_OPTIONS,
  VOCABULARY_POS_OPTIONS,
  VOCABULARY_WORD_TYPE_LABELS,
  VOCABULARY_WORD_TYPE_OPTIONS,
} from '@/lib/passage-analyzer-vocabulary';
import {
  buildVocabularyListFromSentences,
  filterVocabularyByStopwords,
} from '@/lib/passage-analyzer-vocabulary-generate';
import {
  buildSinglePassageVocabularyAoA,
  sanitizeExcelFileBase,
} from '@/lib/passage-analyzer-vocabulary-export';
import { VocabularyStopWordsModal } from '@/app/components/admin/VocabularyStopWordsModal';
import { apiJsonErrorMessage, parseApiResponseJson } from '@/lib/parse-api-response-json';
import { runPassageAnalyzerAiBatch } from '@/lib/passage-analyzer-run-ai-batch';

const SYNTAX_LABEL_OPTIONS = Object.keys(SYNTAX_LABEL_COLORS);

const EMPTY_VOCAB_CUSTOM_STOPWORDS: string[] = [];

/** CEFR 셀렉트에서 AI 단건 분석 트리거 (value는 저장하지 않음) */
const CEFR_SELECT_AI_VALUE = '__ai_cefr__';

type TextbookSibling = {
  _id: string;
  chapter: string;
  number: string;
  source_key: string;
  order: number;
};

function formatSiblingLabel(s: TextbookSibling): string {
  const ch = String(s.chapter || '').trim();
  const num = String(s.number || '').trim();
  const parts = [ch, num].filter(Boolean);
  const head = parts.length ? parts.join(' · ') : '';
  const sk = String(s.source_key || '').trim();
  const composite = `${ch} ${num}`.trim();
  const tail = sk && sk !== composite ? sk : '';
  if (head && tail) return `${head} — ${tail}`;
  if (head) return head;
  if (tail) return tail;
  return s._id.length >= 8 ? `…${s._id.slice(-8)}` : s._id;
}

const MODES: { id: EditorViewMode; label: string }[] = [
  { id: 'base', label: '기본' },
  { id: 'topicSentence', label: '주제문장' },
  { id: 'essaySentence', label: '서술형대비' },
  { id: 'grammar', label: '어법' },
  { id: 'context', label: '문맥' },
  { id: 'sentenceBreaks', label: '끊어읽기' },
  { id: 'svoc', label: 'SVOC' },
  { id: 'syntax', label: '구문' },
  { id: 'grammarTags', label: '문법태그' },
  { id: 'vocabulary', label: '단어장' },
];

const DEFAULT_EDITOR_MODE_ORDER: EditorViewMode[] = MODES.map((m) => m.id);
const EDITOR_MODE_ID_SET = new Set<EditorViewMode>(DEFAULT_EDITOR_MODE_ORDER);

function normalizeEditorViewModeOrder(raw: unknown): EditorViewMode[] {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set<EditorViewMode>();
  const out: EditorViewMode[] = [];
  for (const x of arr) {
    if (typeof x === 'string' && EDITOR_MODE_ID_SET.has(x as EditorViewMode) && !seen.has(x as EditorViewMode)) {
      out.push(x as EditorViewMode);
      seen.add(x as EditorViewMode);
    }
  }
  for (const id of DEFAULT_EDITOR_MODE_ORDER) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

function reorderEditorModes(order: EditorViewMode[], fromId: EditorViewMode, toId: EditorViewMode): EditorViewMode[] {
  const i = order.indexOf(fromId);
  const j = order.indexOf(toId);
  if (i < 0 || j < 0 || i === j) return order;
  const next = [...order];
  const [item] = next.splice(i, 1);
  const newJ = next.indexOf(toId);
  next.splice(newJ, 0, item);
  return next;
}

function ModeDragHandleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="10"
      height="14"
      viewBox="0 0 10 14"
      className="text-slate-500 shrink-0"
      aria-hidden
    >
      <circle cx="2.5" cy="3" r="1.25" fill="currentColor" />
      <circle cx="7.5" cy="3" r="1.25" fill="currentColor" />
      <circle cx="2.5" cy="7" r="1.25" fill="currentColor" />
      <circle cx="7.5" cy="7" r="1.25" fill="currentColor" />
      <circle cx="2.5" cy="11" r="1.25" fill="currentColor" />
      <circle cx="7.5" cy="11" r="1.25" fill="currentColor" />
    </svg>
  );
}

/** assets/구문분석관련코드 PassageAnalyzerMain 단계와 대응 (단일 지문·다크 UI) */
const PROGRESS_STEPS: { key: string; label: string }[] = [
  { key: 'comprehensive', label: '종합분석' },
  { key: 'topicSentence', label: '주제문장' },
  { key: 'essaySentence', label: '서술형대비' },
  { key: 'grammar', label: '어법' },
  { key: 'context', label: '문맥' },
  { key: 'sentenceBreaks', label: '끊어읽기' },
  { key: 'svoc', label: 'SVOC' },
  { key: 'syntax', label: '구문' },
  { key: 'grammarTags', label: '문법태그' },
  { key: 'vocabulary', label: '단어장' },
];

const PROGRESS_MODE_KEY = 'passageAnalyzerProgressMode';

const COMPREHENSIVE_RESULT_LABELS: Record<string, string> = {
  koreanTopic: '한글 주제',
  originalSentence: '원문 주제문장',
  englishSummary: '영문 요약',
  koreanTranslation: '한글 번역',
  implicitMeaning: '함축적 표현',
};

const COMPREHENSIVE_DISPLAY_ORDER = [
  'koreanTopic',
  'originalSentence',
  'englishSummary',
  'koreanTranslation',
  'implicitMeaning',
] as const;

function defaultPassageState(sentences: string[], koreanSentences: string[]): PassageStateStored {
  return {
    sentences,
    koreanSentences,
    vocabularyList: [],
    vocabularyCustomStopWords: [],
    vocabularySortOrder: 'position',
    showVocabulary: true,
    topicHighlightedSentences: [],
    essayHighlightedSentences: [],
    grammarSelectedWords: [],
    grammarAiPrompt: DEFAULT_GRAMMAR_AI_PROMPT,
    contextSelectedWords: [],
    contextAiPrompt: DEFAULT_CONTEXT_AI_PROMPT,
    grammarSelectedRanges: [],
    grammarTags: [],
    sentenceBreaks: {},
    syntaxPhrases: {},
    svocData: {},
    showAnalysis: false,
    analysisResults: {},
    manualStepStatus: {},
    comprehensiveOutputLang: 'ko',
    comprehensiveCustomPrompts: {},
    comprehensiveMasterPrompt: '',
  };
}

function wordKey(si: number, wi: number) {
  return `${si}:${wi}`;
}

const SVOC_FIELDS: Record<
  SvocComponentId,
  { text: keyof SvocSentenceData; start: keyof SvocSentenceData; end: keyof SvocSentenceData }
> = {
  subject: { text: 'subject', start: 'subjectStart', end: 'subjectEnd' },
  verb: { text: 'verb', start: 'verbStart', end: 'verbEnd' },
  indirectObject: { text: 'indirectObject', start: 'indirectObjectStart', end: 'indirectObjectEnd' },
  directObject: { text: 'directObject', start: 'directObjectStart', end: 'directObjectEnd' },
  subjectComplement: {
    text: 'subjectComplement',
    start: 'subjectComplementStart',
    end: 'subjectComplementEnd',
  },
  objectComplement: {
    text: 'objectComplement',
    start: 'objectComplementStart',
    end: 'objectComplementEnd',
  },
};

/** SVOC 단어 칠하기 (SVOC_COMPONENTS.color 와 동일 계열) */
const SVOC_WORD_BG: Record<(typeof SVOC_COMPONENTS)[number]['color'], string> = {
  yellow: 'rgba(234,179,8,0.42)',
  blue: 'rgba(59,130,246,0.42)',
  emerald: 'rgba(16,185,129,0.38)',
  green: 'rgba(34,197,94,0.38)',
  purple: 'rgba(168,85,247,0.38)',
  pink: 'rgba(236,72,153,0.38)',
};

function defaultSvocSentence(): SvocSentenceData {
  return {
    subject: '',
    verb: '',
    subjectStart: -1,
    subjectEnd: -1,
    verbStart: -1,
    verbEnd: -1,
  };
}

function clearSvocComponentFields(
  prev: SvocSentenceData,
  part: SvocComponentId
): SvocSentenceData {
  const f = SVOC_FIELDS[part];
  const next = { ...prev } as Record<string, unknown>;
  next[f.text] = part === 'subject' || part === 'verb' ? '' : null;
  next[f.start] = -1;
  next[f.end] = -1;
  return next as unknown as SvocSentenceData;
}


export function PassageAnalyzerEditor({ passageId }: { passageId?: string | null }) {
  const router = useRouter();
  const [analysisFileName, setAnalysisFileName] = useState('');
  const [state, setState] = useState<PassageStateStored | null>(null);
  const [viewMode, setViewMode] = useState<EditorViewMode>('base');
  const [syntaxLabel, setSyntaxLabel] = useState(SYNTAX_LABEL_OPTIONS[0] || '명사구');
  const [svocPart, setSvocPart] = useState<SvocComponentId | null>(null);
  const [pending, setPending] = useState<{ si: number; wi: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progressTrackingMode, setProgressTrackingMode] = useState<'auto' | 'manual'>('auto');
  const [showProgressSettings, setShowProgressSettings] = useState(false);
  const [dragOverMode, setDragOverMode] = useState<EditorViewMode | null>(null);
  const [showSvOverlay, setShowSvOverlay] = useState(false);
  const [grammarSubMode, setGrammarSubMode] = useState<'manual' | 'ai'>('manual');
  const [contextSubMode, setContextSubMode] = useState<'manual' | 'ai'>('manual');
  const [vocabShowInputAt, setVocabShowInputAt] = useState<number | null>(null);
  const [vocabNewWord, setVocabNewWord] = useState({
    word: '',
    wordType: 'word',
    partOfSpeech: 'n.',
    cefr: '',
    meaning: '',
    synonym: '',
    antonym: '',
    opposite: '',
  });
  /** 문법태그 모드: 새 태그 추가 시 라벨(예: #전치사구) */
  const [newGrammarTagName, setNewGrammarTagName] = useState('');
  const [showStopWordsModal, setShowStopWordsModal] = useState(false);
  const [mongoPanelOpen, setMongoPanelOpen] = useState(false);
  const [mongoPanelJson, setMongoPanelJson] = useState<string | null>(null);
  const [mongoPanelLoading, setMongoPanelLoading] = useState(false);
  const [mongoPanelError, setMongoPanelError] = useState<string | null>(null);
  /** passages 문서 메타(교재 전체 단어장보내기·파일명용) */
  const [passageMeta, setPassageMeta] = useState<{
    textbook?: string;
    chapter?: string;
    number?: string;
    source_key?: string;
  } | null>(null);
  const [vocabExportBusy, setVocabExportBusy] = useState<'passage' | 'textbook' | null>(null);
  const [cefrAiRowIndex, setCefrAiRowIndex] = useState<number | null>(null);
  const [cefrAiInline, setCefrAiInline] = useState(false);
  const cefrAiLockRef = useRef(false);
  const [textbookSiblings, setTextbookSiblings] = useState<TextbookSibling[]>([]);
  const [textbookSiblingsLoading, setTextbookSiblingsLoading] = useState(false);
  /** 같은 분석 파일에서 빈 단어장일 때 자동 추출을 한 번만 시도 */
  const autoVocabFilledForFile = useRef<string>('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<PassageStateStored | null>(null);
  /** 서버에서 막 불러온 직후 빈 상태로 자동 저장해 단어장 등을 덮어쓰지 않도록, 실제 편집 시에만 저장 */
  const stateDirtyRef = useRef(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(PROGRESS_MODE_KEY);
      if (v === 'manual' || v === 'auto') setProgressTrackingMode(v);
    } catch {
      /* ignore */
    }
  }, []);

  const scheduleSave = useCallback(
    (fileName: string, next: PassageStateStored) => {
      if (!fileName) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await fetch('/api/admin/passage-analyzer/save-analysis', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName,
              data: { passageStates: { main: next }, fileName },
            }),
          });
        } catch {
          /* ignore */
        }
      }, 1500);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setMsg(null);
      try {
        let fileName = '';
        let initial: PassageStateStored | null = null;

        if (passageId) {
          fileName = passageAnalysisFileNameForPassageId(passageId);
          const pr = await fetch(`/api/admin/passages/${passageId}`, { credentials: 'include' });
          const pd = await parseApiResponseJson(pr);
          if (!pr.ok || !pd.item) {
            setPassageMeta(null);
            setMsg(apiJsonErrorMessage(pd, '지문을 불러오지 못했습니다.'));
            setLoading(false);
            return;
          }
          const item = pd.item as Record<string, unknown>;
          setPassageMeta({
            textbook: String(item.textbook ?? '').trim() || undefined,
            chapter: String(item.chapter ?? '').trim() || undefined,
            number: String(item.number ?? '').trim() || undefined,
            source_key: String(item.source_key ?? '').trim() || undefined,
          });
          const c = (((item.content || {}) as Record<string, unknown>) ?? {}) as Record<string, unknown>;
          const { sentences, koreanSentences } = deriveSentencesFromPassageContent(c);
          initial = defaultPassageState(sentences, koreanSentences);

          const lr = await fetch('/api/admin/passage-analyzer/load-analysis', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName }),
          });
          if (lr.ok) {
            const ld = await parseApiResponseJson(lr);
            const saved = (ld.data as { passageStates?: { main?: PassageStateStored } } | undefined)
              ?.passageStates?.main;
            initial = mergeSavedOntoPassagesBase(initial, saved);
          }
        }

        if (cancelled) return;
        stateDirtyRef.current = false;
        setAnalysisFileName(fileName);
        setState(initial);
      } catch {
        if (!cancelled) {
          setPassageMeta(null);
          setMsg('로드 오류');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [passageId]);

  useEffect(() => {
    autoVocabFilledForFile.current = '';
  }, [analysisFileName]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!state || !analysisFileName || !stateDirtyRef.current) return;
    scheduleSave(analysisFileName, state);
  }, [state, analysisFileName, scheduleSave]);

  const updateState = useCallback((fn: (s: PassageStateStored) => PassageStateStored) => {
    stateDirtyRef.current = true;
    setState((prev) => (prev ? fn({ ...prev }) : null));
  }, []);

  useEffect(() => {
    if (viewMode !== 'vocabulary' || !state || !analysisFileName) return;
    if ((state.vocabularyList?.length ?? 0) > 0) return;
    if (!state.sentences.some((s) => s.trim())) return;
    if (autoVocabFilledForFile.current === analysisFileName) return;
    autoVocabFilledForFile.current = analysisFileName;
    const built = buildVocabularyListFromSentences(state.sentences, {
      customStopWords: state.vocabularyCustomStopWords,
      sourcePassage: passageId ?? analysisFileName,
    });
    updateState((s) => ({ ...s, vocabularyList: built, showVocabulary: true }));
  }, [viewMode, state, analysisFileName, passageId, updateState]);

  const toggleSentence = useCallback((kind: 'topic' | 'essay', si: number) => {
    updateState((s) => {
      const arrKey = kind === 'topic' ? 'topicHighlightedSentences' : 'essayHighlightedSentences';
      const arr = new Set(s[arrKey] || []);
      if (arr.has(si)) arr.delete(si);
      else arr.add(si);
      return { ...s, [arrKey]: Array.from(arr).sort((a, b) => a - b) };
    });
  }, [updateState]);

  const onWordClick = (si: number, wi: number) => {
    if (!state) return;
    const sentence = state.sentences[si] || '';
    const words = sentence.split(/\s+/).filter(Boolean);

    if (viewMode === 'topicSentence') {
      toggleSentence('topic', si);
      return;
    }
    if (viewMode === 'essaySentence') {
      toggleSentence('essay', si);
      return;
    }

    if (viewMode === 'grammar') {
      const k = wordKey(si, wi);
      updateState((s) => {
        const g = new Set(s.grammarSelectedWords || []);
        if (g.has(k)) g.delete(k);
        else g.add(k);
        return { ...s, grammarSelectedWords: Array.from(g) };
      });
      return;
    }

    if (viewMode === 'context') {
      const k = wordKey(si, wi);
      updateState((s) => {
        const g = new Set(s.contextSelectedWords || []);
        if (g.has(k)) g.delete(k);
        else g.add(k);
        return { ...s, contextSelectedWords: Array.from(g) };
      });
      return;
    }

    if (viewMode === 'vocabulary') {
      const lemma = (words[wi] || '').replace(/[.,;:!?'"`]/g, '').trim();
      if (!lemma) return;
      updateState((s) => {
        const list = [...(s.vocabularyList || [])];
        const at = list.findIndex((x) =>
          (x.positions || []).some((p) => p.sentence === si && p.position === wi)
        );
        if (at >= 0) {
          list.splice(at, 1);
          return { ...s, vocabularyList: list };
        }
        list.push({
          word: lemma,
          meaning: '',
          wordType: 'word',
          partOfSpeech: 'n.',
          cefr: '',
          positions: [{ sentence: si, position: wi }],
        });
        return { ...s, vocabularyList: list };
      });
      return;
    }

    if (viewMode === 'sentenceBreaks') {
      updateState((s) => {
        const br = { ...(s.sentenceBreaks || {}) };
        const arr = new Set(br[si] || []);
        if (arr.has(wi)) arr.delete(wi);
        else arr.add(wi);
        br[si] = Array.from(arr).sort((a, b) => a - b);
        return { ...s, sentenceBreaks: br };
      });
      return;
    }

    if (viewMode === 'svoc') {
        if (!svocPart) {
        setMsg('오른쪽 SVOC 패널에서 요소(S, V, Oi …)를 먼저 선택하세요.');
        return;
      }
      const fields = SVOC_FIELDS[svocPart];
      const partLabel = SVOC_COMPONENTS.find((c) => c.id === svocPart)?.label ?? svocPart;

      if (!pending) {
        const cur = state.svocData?.[si];
        if (cur) {
          const rs = cur[fields.start] as unknown;
          const re = cur[fields.end] as unknown;
          if (
            typeof rs === 'number' &&
            rs >= 0 &&
            typeof re === 'number' &&
            re >= 0 &&
            wi >= rs &&
            wi <= re
          ) {
            updateState((s) => {
              const sv = { ...(s.svocData || {}) };
              const prev = (sv[si] as SvocSentenceData | undefined) || defaultSvocSentence();
              sv[si] = clearSvocComponentFields(prev, svocPart);
              return { ...s, svocData: sv };
            });
            setMsg(`${partLabel} 표시를 지웠습니다.`);
            return;
          }
        }
        setPending({ si, wi });
        setMsg(null);
        return;
      }

      if (pending.si !== si) {
        setPending({ si, wi });
        setMsg('다른 문장입니다. 이 문장에서 시작 단어를 다시 찍었습니다.');
        return;
      }

      const start = Math.min(pending.wi, wi);
      const end = Math.max(pending.wi, wi);
      const phrase = words.slice(start, end + 1).join(' ');
      const idx = findWordIndices(sentence, phrase);
      if (idx.startWordIndex < 0) {
        setPending(null);
        setMsg('구간을 문장에서 찾지 못했습니다. 다시 선택하세요.');
        return;
      }
      updateState((s) => {
        const sv = { ...(s.svocData || {}) };
        const prev = (sv[si] as SvocSentenceData | undefined) || defaultSvocSentence();
        const cur = { ...prev } as Record<string, unknown>;
        cur[fields.text] = phrase;
        cur[fields.start] = idx.startWordIndex;
        cur[fields.end] = idx.endWordIndex;
        sv[si] = cur as unknown as SvocSentenceData;
        return { ...s, svocData: sv };
      });
      setPending(null);
      setMsg(`${partLabel}에 「${phrase}」를 반영했습니다.`);
      return;
    }

    if (viewMode === 'syntax') {
      if (!pending) {
        setPending({ si, wi });
        return;
      }
      if (pending.si !== si) {
        setPending({ si, wi });
        return;
      }
      const start = Math.min(pending.wi, wi);
      const end = Math.max(pending.wi, wi);
      const phrase = words.slice(start, end + 1).join(' ');
      const idx = findWordIndices(sentence, phrase);
      if (idx.startWordIndex < 0) {
        setPending(null);
        return;
      }
      const color = getSyntaxColorForLabel(syntaxLabel);
      const type = syntaxLabel.includes('절') ? 'clause' : 'phrase';
      updateState((s) => {
        const sp = { ...(s.syntaxPhrases || {}) };
        const list = [...(sp[si] || [])];
        let depth = 0;
        for (const p of list) {
          if (p.startIndex <= idx.startWordIndex && p.endIndex >= idx.endWordIndex) depth++;
        }
        list.push({
          text: phrase,
          label: syntaxLabel,
          type,
          startIndex: idx.startWordIndex,
          endIndex: idx.endWordIndex,
          color,
          depth,
          modifies: null,
        });
        sp[si] = list;
        return { ...s, syntaxPhrases: sp };
      });
      setPending(null);
      return;
    }

    if (viewMode === 'grammarTags') {
      if (!pending) {
        setPending({ si, wi });
        return;
      }
      if (pending.si !== si) {
        setPending({ si, wi });
        return;
      }
      const start = Math.min(pending.wi, wi);
      const end = Math.max(pending.wi, wi);
      const phrase = words.slice(start, end + 1).join(' ');
      const idx = findWordIndices(sentence, phrase);
      if (idx.startWordIndex < 0) {
        setPending(null);
        return;
      }
      const tagName = newGrammarTagName.trim() || '#태그';
      updateState((s) => ({
        ...s,
        grammarTags: [
          ...(s.grammarTags || []),
          {
            sentenceIndex: si,
            tagName,
            selectedText: phrase,
            startWordIndex: idx.startWordIndex,
            endWordIndex: idx.endWordIndex,
            isAIGenerated: false,
          },
        ],
      }));
      setPending(null);
      setMsg(null);
    }
  };

  const handleProgressStepClick = useCallback(
    (stepKey: string, autoDetected: boolean) => {
      updateState((s) => {
        const prev = { ...(s.manualStepStatus || {}) };
        const next = { ...prev };
        if (progressTrackingMode === 'manual') {
          next[stepKey] = !prev[stepKey];
        } else if (next[stepKey] !== undefined) {
          if (next[stepKey] === !autoDetected) delete next[stepKey];
          else next[stepKey] = !next[stepKey];
        } else {
          next[stepKey] = !autoDetected;
        }
        return { ...s, manualStepStatus: next };
      });
    },
    [progressTrackingMode, updateState]
  );

  const progressView = useMemo(() => {
    if (!state) return { steps: [] as Array<{ key: string; label: string; n: number; done: boolean; autoDetected: boolean; manualVal: boolean | undefined }>, doneCount: 0, total: 0 };
    const s = state;
    const comp = s.analysisResults?.comprehensive;
    const comprehensiveOk =
      comp != null &&
      typeof comp === 'object' &&
      Object.keys(comp as Record<string, unknown>).some(
        (k) => String((comp as Record<string, unknown>)[k] ?? '').trim() !== ''
      );
    const autoDetect: Record<string, boolean> = {
      comprehensive: comprehensiveOk,
      topicSentence: (s.topicHighlightedSentences?.length ?? 0) > 0,
      essaySentence: (s.essayHighlightedSentences?.length ?? 0) > 0,
      grammar:
        (s.grammarSelectedWords?.length ?? 0) > 0 || (s.grammarSelectedRanges?.length ?? 0) > 0,
      context: (s.contextSelectedWords?.length ?? 0) > 0,
      sentenceBreaks: Object.keys(s.sentenceBreaks || {}).some(
        (k) => ((s.sentenceBreaks || {})[Number(k)] || []).length > 0
      ),
      svoc: Object.keys(s.svocData || {}).length > 0,
      syntax: Object.keys(s.syntaxPhrases || {}).length > 0,
      grammarTags: (s.grammarTags?.length ?? 0) > 0,
      vocabulary: (s.vocabularyList?.length ?? 0) > 0,
    };
    const manual = s.manualStepStatus || {};
    const steps = PROGRESS_STEPS.map((st, i) => {
      const autoDetected = autoDetect[st.key] || false;
      const manualVal = manual[st.key];
      const done =
        progressTrackingMode === 'manual'
          ? !!manualVal
          : manualVal !== undefined
            ? !!manualVal
            : autoDetected;
      return {
        key: st.key,
        label: st.label,
        n: i + 1,
        done,
        autoDetected,
        manualVal,
      };
    });
    const doneCount = steps.filter((x) => x.done).length;
    return { steps, doneCount, total: steps.length };
  }, [state, progressTrackingMode]);

  const runAiSyntax = async () => {
    if (!state?.sentences.length) return;
    setBusy('구문');
    setMsg(null);
    try {
      const res = await fetch('/api/admin/syntax-analyzer/analyze-syntax', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentences: state.sentences }),
      });
      const d = await parseApiResponseJson(res);
      if (!res.ok) throw new Error(apiJsonErrorMessage(d, '실패'));
      const result = d.result as Array<{ sentenceIndex: number; phrases: unknown[] }>;
      updateState((s) => {
        const sp: NonNullable<PassageStateStored['syntaxPhrases']> = { ...(s.syntaxPhrases || {}) };
        for (const row of result || []) {
          sp[row.sentenceIndex] = row.phrases as NonNullable<PassageStateStored['syntaxPhrases']>[number];
        }
        return { ...s, syntaxPhrases: sp };
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '구문 AI 실패');
    } finally {
      setBusy(null);
    }
  };

  const runAiSvoc = async () => {
    if (!state?.sentences.length) return;
    setBusy('SVOC');
    setMsg(null);
    try {
      const res = await fetch('/api/admin/syntax-analyzer/analyze-svoc', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentences: state.sentences }),
      });
      const d = await parseApiResponseJson(res);
      if (!res.ok) throw new Error(apiJsonErrorMessage(d, '실패'));
      const result = d.result as Array<Record<string, unknown>>;
      updateState((s) => {
        const sv = { ...(s.svocData || {}) };
        for (const row of result || []) {
          const idx = Number(row.sentenceIndex);
          const base = sv[idx] || {};
          sv[idx] = {
            ...(base as SvocSentenceData),
            subject: String(row.subject || ''),
            verb: String(row.verb || ''),
            object: row.object != null ? String(row.object) : null,
            complement: row.complement != null ? String(row.complement) : null,
            subjectStart: Number(row.subjectStart),
            subjectEnd: Number(row.subjectEnd),
            verbStart: Number(row.verbStart),
            verbEnd: Number(row.verbEnd),
            objectStart: row.objectStart as number | null,
            objectEnd: row.objectEnd as number | null,
            complementStart: row.complementStart as number | null,
            complementEnd: row.complementEnd as number | null,
          };
        }
        return { ...s, svocData: sv };
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'SVOC AI 실패');
    } finally {
      setBusy(null);
    }
  };

  const runComprehensive = async () => {
    const passage = state?.sentences.join(' ') || '';
    if (!passage) return;
    setBusy('종합');
    setMsg(null);
    try {
      const master = (state?.comprehensiveMasterPrompt || '').trim();
      const rawCp = state?.comprehensiveCustomPrompts || {};
      const customPrompts = Object.fromEntries(
        Object.entries(rawCp).filter(([, v]) => String(v ?? '').trim() !== '')
      );
      const sc = clampComprehensiveSlotCount(state?.comprehensiveSlotCount);
      const legacy = state?.comprehensiveOutputLang === 'en' ? 'en' : 'ko';
      const outputLangBySlot: Record<string, 'ko' | 'en'> = {};
      for (let i = 1; i <= sc; i++) {
        outputLangBySlot[String(i)] = effectiveSlotOutputLang(
          i,
          state?.comprehensiveOutputLangBySlot ?? null,
          legacy
        );
      }
      const body: Record<string, unknown> = {
        passage,
        analysisType: 'all',
        outputLang: legacy,
        outputLangBySlot,
        slotCount: sc,
      };
      if (master) body.customPrompt = master;
      else if (Object.keys(customPrompts).length > 0) body.customPrompts = customPrompts;

      const res = await fetch('/api/admin/passage-analyzer/comprehensive-analysis', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await parseApiResponseJson(res);
      if (!res.ok) throw new Error(apiJsonErrorMessage(d, '실패'));
      const quote =
        typeof d.originalSentence === 'string' ? String(d.originalSentence).trim() : '';
      const topicIdx =
        quote && state
          ? sentenceIndicesMatchingTopicQuote(state.sentences, quote)
          : [];
      updateState((s) => ({
        ...s,
        analysisResults: { ...(s.analysisResults || {}), comprehensive: d },
        showAnalysis: true,
        ...(topicIdx.length > 0 ? { topicHighlightedSentences: topicIdx } : {}),
      }));
      if (quote && topicIdx.length === 0) {
        setMsg(
          '종합분석 완료. 원문 주제문장(②)과 일치하는 문장을 찾지 못해 주제문장 표시는 그대로 두었습니다. 주제문장 모드에서 수동으로 지정할 수 있습니다.'
        );
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '종합 분석 실패');
    } finally {
      setBusy(null);
    }
  };

  const runGrammarTagsAi = async () => {
    if (!state?.sentences.length) return;
    setBusy('문법태그');
    setMsg(null);
    try {
      const res = await fetch('/api/admin/passage-analyzer/analyze-grammar-tags', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentences: state.sentences }),
      });
      const d = await parseApiResponseJson(res);
      if (!res.ok) throw new Error(apiJsonErrorMessage(d, '실패'));
      const result = d.result as Array<{ sentenceIndex: number; tags: PassageStateStored['grammarTags'] }>;
      updateState((s) => {
        const tags = [...(s.grammarTags || [])];
        for (const row of result || []) {
          for (const t of row.tags || []) {
            tags.push({
              sentenceIndex: row.sentenceIndex,
              tagName: t.tagName,
              selectedText: t.selectedText,
              startWordIndex: t.startWordIndex,
              endWordIndex: t.endWordIndex,
              isAIGenerated: true,
            });
          }
        }
        return { ...s, grammarTags: tags };
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '문법태그 실패');
    } finally {
      setBusy(null);
    }
  };

  const runGrammarAiSuggest = async () => {
    if (!state?.sentences.length) return;
    setBusy('어법AI');
    setMsg(null);
    try {
      const promptUsed = (state.grammarAiPrompt ?? '').trim() || DEFAULT_GRAMMAR_AI_PROMPT;
      const res = await fetch('/api/admin/passage-analyzer/suggest-grammar-words', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sentences: state.sentences,
          customPrompt: promptUsed,
        }),
      });
      const d = await parseApiResponseJson(res);
      if (!res.ok) throw new Error(apiJsonErrorMessage(d, '실패'));
      const wordKeys = (d.wordKeys as string[]) || [];
      updateState((s) => ({ ...s, grammarSelectedWords: wordKeys }));
      setMsg(
        wordKeys.length > 0
          ? `어법 AI: ${wordKeys.length}개 단어를 표시했습니다. 단어를 눌러 보완할 수 있습니다.`
          : '어법 AI: 선택된 단어가 없습니다. 프롬프트를 조정해 보세요.'
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '어법 AI 실패');
    } finally {
      setBusy(null);
    }
  };

  const runContextAiSuggest = async () => {
    if (!state?.sentences.length) return;
    setBusy('문맥AI');
    setMsg(null);
    try {
      const promptUsed = (state.contextAiPrompt ?? '').trim() || DEFAULT_CONTEXT_AI_PROMPT;
      const res = await fetch('/api/admin/passage-analyzer/suggest-context-words', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sentences: state.sentences,
          customPrompt: promptUsed,
        }),
      });
      const d = await parseApiResponseJson(res);
      if (!res.ok) throw new Error(apiJsonErrorMessage(d, '실패'));
      const wordKeys = (d.wordKeys as string[]) || [];
      updateState((s) => ({ ...s, contextSelectedWords: wordKeys }));
      setMsg(
        wordKeys.length > 0
          ? `문맥 AI: ${wordKeys.length}개 단어를 표시했습니다. 단어를 눌러 보완할 수 있습니다.`
          : '문맥 AI: 선택된 단어가 없습니다. 프롬프트를 조정해 보세요.'
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '문맥 AI 실패');
    } finally {
      setBusy(null);
    }
  };

  /** 종합·어법·문맥·구문·SVOC·문법태그·단어장(추출+뜻)까지 순차/병렬 AI. 서술형·끊어읽기는 수동. */
  const runBatchAiAll = async () => {
    const cur = stateRef.current;
    if (!cur?.sentences.length || busy) return;

    setBusy('일괄');
    setMsg(null);
    try {
      const { state: next, warnings } = await runPassageAnalyzerAiBatch({
        initial: cur,
        post: (path, body) =>
          fetch(path, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        sourcePassageLabel: passageId ?? analysisFileName,
        onProgress: setMsg,
      });
      stateDirtyRef.current = true;
      flushSync(() => setState(next));
      stateRef.current = next;
      setMsg(['일괄 AI 완료.', ...warnings].join(' '));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '일괄 AI 실패');
    } finally {
      setBusy(null);
    }
  };

  /** 자동 저장 대기 없이 즉시 반영(SVOC·구문 등 확인용) */
  const flushAnalysisSave = useCallback(async () => {
    const s = stateRef.current;
    if (!analysisFileName || !s) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    try {
      await fetch('/api/admin/passage-analyzer/save-analysis', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: analysisFileName,
          data: { passageStates: { main: s }, fileName: analysisFileName },
        }),
      });
      setMsg('서버에 저장했습니다.');
    } catch {
      setMsg('저장에 실패했습니다.');
    }
  }, [analysisFileName]);

  const refreshMongoDocumentJson = useCallback(async () => {
    if (!analysisFileName) return;
    setMongoPanelLoading(true);
    setMongoPanelError(null);
    try {
      const res = await fetch(
        `/api/admin/passage-analyzer/analysis-document?fileName=${encodeURIComponent(analysisFileName)}`,
        { credentials: 'include' }
      );
      const data = await parseApiResponseJson(res);
      if (!res.ok) {
        setMongoPanelError(apiJsonErrorMessage(data, '조회 실패'));
        setMongoPanelJson(null);
        return;
      }
      setMongoPanelJson(JSON.stringify(data, null, 2));
    } catch (e) {
      setMongoPanelError(e instanceof Error ? e.message : '조회 실패');
      setMongoPanelJson(null);
    } finally {
      setMongoPanelLoading(false);
    }
  }, [analysisFileName]);

  useEffect(() => {
    if (mongoPanelOpen && analysisFileName) void refreshMongoDocumentJson();
  }, [mongoPanelOpen, analysisFileName, refreshMongoDocumentJson]);

  /** SVOC: 1~6 요소, Alt+C 취소, Alt+S 저장, Esc 취소(참고 PassageAnalyzerMain) */
  useEffect(() => {
    if (viewMode !== 'svoc') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
        return;
      if (el instanceof HTMLElement && el.isContentEditable) return;

      const comp = SVOC_COMPONENTS.find((c) => c.key === e.key);
      if (comp) {
        e.preventDefault();
        setSvocPart((p) => (p === comp.id ? null : comp.id));
        setPending(null);
        setMsg(null);
        return;
      }

      if (e.altKey && e.code === 'KeyC') {
        e.preventDefault();
        setPending(null);
        setMsg('범위 선택을 취소했습니다. (Alt+C)');
        return;
      }

      if (e.altKey && e.code === 'KeyS') {
        e.preventDefault();
        void flushAnalysisSave();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        setPending(null);
        setSvocPart(null);
        setMsg(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode, flushAnalysisSave]);

  const addVocabFromSelection = () => {
    if (!state || viewMode !== 'vocabulary') return;
    const selected = new Set(state.grammarSelectedWords || []);
    if (selected.size === 0) {
      setMsg('어법 모드에서 단어를 선택한 뒤, 단어장 모드에서 추가하세요.');
      return;
    }
    updateState((s) => {
      const list = [...(s.vocabularyList || [])];
      for (const k of selected) {
        const [si, wi] = k.split(':').map(Number);
        const w = (s.sentences[si] || '').split(/\s+/).filter(Boolean)[wi];
        if (!w) continue;
        const clean = w.replace(/[.,;:!?'"`]/g, '').trim();
        const dupPos = list.some((x) =>
          (x.positions || []).some((p) => p.sentence === si && p.position === wi)
        );
        if (!dupPos) {
          list.push({
            word: clean,
            meaning: '',
            wordType: 'word',
            partOfSpeech: 'n.',
            cefr: '',
            positions: [{ sentence: si, position: wi }],
          });
        }
      }
      return { ...s, vocabularyList: list };
    });
    setMsg('단어장에 추가했습니다. (어법 선택 단어 기준)');
  };

  const runAnalyzeVocabulary = useCallback(async () => {
    if (!state?.vocabularyList?.length) {
      setMsg('단어장에 항목을 추가한 뒤 사용하세요. (지문에서 자동 생성 또는 단어 클릭)');
      return;
    }
    setBusy('단어장');
    setMsg(null);
    try {
      const res = await fetch('/api/admin/passage-analyzer/analyze-vocabulary', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vocabularyList: state.vocabularyList,
          englishSentences: state.sentences,
          koreanSentences: state.koreanSentences,
        }),
      });
      const d = await parseApiResponseJson(res);
      if (!res.ok) throw new Error(apiJsonErrorMessage(d, '실패'));
      updateState((s) => ({
        ...s,
        vocabularyList: (d.analyzedVocabulary as VocabularyEntry[] | undefined) ?? s.vocabularyList,
      }));
      setMsg('AI 단어장 분석을 반영했습니다.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '단어 분석 실패');
    } finally {
      setBusy(null);
    }
  }, [state, updateState]);

  const downloadCurrentVocabularyXlsx = useCallback(async () => {
    if (!state) return;
    setVocabExportBusy('passage');
    setMsg(null);
    try {
      const XLSX = await import('xlsx');
      const aoa = buildSinglePassageVocabularyAoA(
        state.vocabularyList || [],
        (state.vocabularySortOrder || 'position') as VocabularySortOrder
      );
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, '단어장');
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([out], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const parts = [passageMeta?.textbook, passageMeta?.chapter, passageMeta?.number].filter(
        (x): x is string => Boolean(x && String(x).trim())
      );
      const base =
        parts.length > 0
          ? parts.map((p) => sanitizeExcelFileBase(String(p), 24)).join('_')
          : passageId
            ? `passage_${passageId.slice(-8)}`
            : 'vocab';
      const name = `단어장_${base}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setMsg('엑셀 파일을 내려받았습니다. (현재 화면 편집 내용 기준)');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '엑셀 저장에 실패했습니다.');
    } finally {
      setVocabExportBusy(null);
    }
  }, [state, passageId, passageMeta]);

  const downloadTextbookVocabularyXlsx = useCallback(async () => {
    const tb = passageMeta?.textbook?.trim();
    if (!tb) {
      setMsg('이 지문에 교재명이 없어 교재 전체 보내기를 할 수 없습니다.');
      return;
    }
    setVocabExportBusy('textbook');
    setMsg(null);
    try {
      const res = await fetch('/api/admin/passage-analyzer/export-vocabulary-xlsx', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textbook: tb }),
      });
      const ct = res.headers.get('Content-Type') || '';
      if (!res.ok) {
        let err = `요청 실패 (${res.status})`;
        if (ct.includes('application/json')) {
          try {
            const d = (await res.json()) as { error?: string };
            if (d.error) err = d.error;
          } catch {
            /* ignore */
          }
        }
        throw new Error(err);
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition');
      let filename = `단어장_${sanitizeExcelFileBase(tb, 40)}_전체.xlsx`;
      const m = cd?.match(/filename\*=UTF-8''([^;]+)/i);
      if (m?.[1]) {
        try {
          filename = decodeURIComponent(m[1].trim());
        } catch {
          /* keep default */
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`교재 「${tb}」에 저장된 단어장을 엑셀로 내려받았습니다.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '교재 전체 보내기에 실패했습니다.');
    } finally {
      setVocabExportBusy(null);
    }
  }, [passageMeta]);

  const fetchCefrForWord = useCallback(
    async (opts: {
      word: string;
      positions?: VocabularyEntry['positions'];
      meaning?: string;
      partOfSpeech?: string;
    }) => {
      const s = stateRef.current;
      if (!s?.sentences?.length) throw new Error('지문 문장이 없습니다.');
      const res = await fetch('/api/admin/passage-analyzer/analyze-vocabulary-cefr', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: opts.word.trim(),
          positions: opts.positions ?? [],
          englishSentences: s.sentences,
          koreanSentences: s.koreanSentences,
          meaning: opts.meaning ?? '',
          partOfSpeech: opts.partOfSpeech ?? '',
        }),
      });
      const d = await parseApiResponseJson(res);
      if (!res.ok) throw new Error(apiJsonErrorMessage(d, 'CEFR 분석 실패'));
      return String((d as { cefr?: string }).cefr ?? '').trim();
    },
    []
  );

  const runCefrAiForRow = useCallback(
    async (oi: number) => {
      if (busy || cefrAiLockRef.current) return;
      const item = stateRef.current?.vocabularyList?.[oi];
      if (!item?.word?.trim()) {
        setMsg('단어가 비어 있으면 CEFR 분석을 할 수 없습니다.');
        return;
      }
      cefrAiLockRef.current = true;
      setCefrAiRowIndex(oi);
      setMsg(null);
      try {
        const cefr = await fetchCefrForWord({
          word: item.word,
          positions: item.positions,
          meaning: item.meaning,
          partOfSpeech: item.partOfSpeech,
        });
        updateState((prev) => {
          const list = [...(prev.vocabularyList || [])];
          if (list[oi]) list[oi] = { ...list[oi], cefr };
          return { ...prev, vocabularyList: list };
        });
        setMsg(
          cefr
            ? `「${item.word.trim()}」 CEFR → ${cefr}`
            : '모델이 CEFR을 확정하지 못했습니다. 수동으로 선택하세요.'
        );
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'CEFR 분석 실패');
      } finally {
        cefrAiLockRef.current = false;
        setCefrAiRowIndex(null);
      }
    },
    [busy, fetchCefrForWord, updateState]
  );

  const runCefrAiForVocabNewWord = useCallback(
    async (snap: { word: string; meaning: string; partOfSpeech: string }) => {
      if (busy || cefrAiLockRef.current) return;
      const w = snap.word.trim();
      if (!w) {
        setMsg('먼저 영단어를 입력하세요.');
        return;
      }
      cefrAiLockRef.current = true;
      setCefrAiInline(true);
      setMsg(null);
      try {
        const cefr = await fetchCefrForWord({
          word: w,
          positions: [],
          meaning: snap.meaning,
          partOfSpeech: snap.partOfSpeech,
        });
        setVocabNewWord((p) => ({ ...p, cefr }));
        setMsg(
          cefr ? `「${w}」 CEFR → ${cefr}` : '모델이 CEFR을 확정하지 못했습니다. 수동으로 선택하세요.'
        );
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'CEFR 분석 실패');
      } finally {
        cefrAiLockRef.current = false;
        setCefrAiInline(false);
      }
    },
    [busy, fetchCefrForWord]
  );

  const regenerateVocabularyFromPassage = () => {
    if (!state || !analysisFileName) return;
    const n = state.vocabularyList?.length ?? 0;
    if (
      n > 0 &&
      !window.confirm(`기존 ${n}개 항목을 지우고 지문에서 단어장을 다시 만듭니다. 계속할까요?`)
    ) {
      return;
    }
    const built = buildVocabularyListFromSentences(state.sentences, {
      customStopWords: state.vocabularyCustomStopWords,
      sourcePassage: passageId ?? analysisFileName,
    });
    updateState((s) => ({ ...s, vocabularyList: built, showVocabulary: true }));
    autoVocabFilledForFile.current = analysisFileName;
    setMsg(
      built.length > 0
        ? `지문에서 ${built.length}개 단어(고유)를 불용어 제외 후 채웠습니다.`
        : '추출된 단어가 없습니다. 문장·불용어 설정을 확인하세요.'
    );
  };

  const removeStopwordsFromVocabularyList = () => {
    if (!state) return;
    const before = state.vocabularyList?.length ?? 0;
    const filtered = filterVocabularyByStopwords(
      state.vocabularyList || [],
      state.vocabularyCustomStopWords
    );
    const removed = before - filtered.length;
    updateState((s) => ({ ...s, vocabularyList: filtered }));
    setMsg(
      removed === 0
        ? '목록에서 뺄 불용어 항목이 없습니다.'
        : `불용어에 해당하는 ${removed}개를 제거했습니다. (${before}개 → ${filtered.length}개)`
    );
  };

  const confirmVocabInlineAdd = () => {
    if (!state) return;
    if (!vocabNewWord.word.trim()) {
      setMsg('단어를 입력하세요.');
      return;
    }
    updateState((s) => {
      const list = s.vocabularyList || [];
      const sorted = sortVocabularyEntries(
        list,
        (s.vocabularySortOrder || 'position') as VocabularySortOrder
      );
      const newItem: VocabularyEntry = {
        word: vocabNewWord.word.trim(),
        meaning: vocabNewWord.meaning.trim(),
        wordType: vocabNewWord.wordType,
        partOfSpeech: vocabNewWord.partOfSpeech,
        cefr: vocabNewWord.cefr,
        synonym: vocabNewWord.synonym.trim(),
        antonym: vocabNewWord.antonym.trim(),
        opposite: vocabNewWord.opposite.trim(),
        positions: [],
      };
      return {
        ...s,
        vocabularyList: insertVocabularyAtSortedGap(list, sorted, vocabShowInputAt, newItem),
      };
    });
    setVocabShowInputAt(null);
    setVocabNewWord({
      word: '',
      wordType: 'word',
      partOfSpeech: 'n.',
      cefr: '',
      meaning: '',
      synonym: '',
      antonym: '',
      opposite: '',
    });
    setMsg(null);
  };

  const sortedVocabulary = useMemo(() => {
    if (!state) return [] as VocabularyEntry[];
    return sortVocabularyEntries(
      state.vocabularyList || [],
      (state.vocabularySortOrder || 'position') as VocabularySortOrder
    );
  }, [state]);

  const vocabularyDisplayByPosition = useMemo(
    () => vocabularyPositionToDisplayIndex(sortedVocabulary),
    [sortedVocabulary]
  );

  const wordStyle = useMemo(() => {
    return (si: number, wi: number, word: string) => {
      if (!state) return {};
      const k = wordKey(si, wi);
      let bg = 'transparent';
      let outline: string | undefined;

      if (viewMode === 'grammar' && state.grammarSelectedWords?.includes(k)) bg = 'rgba(251,191,36,0.35)';
      if (viewMode === 'context' && state.contextSelectedWords?.includes(k)) bg = 'rgba(34,197,94,0.35)';
      if (viewMode === 'vocabulary' && vocabularyDisplayByPosition.has(k)) bg = 'rgba(45,211,191,0.3)';
      if (viewMode === 'svoc' && pending?.si === si && pending.wi === wi) {
        outline = '2px solid rgba(252,211,77,0.85)';
        if (bg === 'transparent') bg = 'rgba(252,211,77,0.12)';
      }

      const br = state.sentenceBreaks?.[si] || [];
      const borderRight = br.includes(wi) ? '2px solid rgba(148,163,184,0.8)' : undefined;

      const spList = viewMode === 'svoc' ? [] : state.syntaxPhrases?.[si] || [];
      for (const p of spList) {
        if (wi >= p.startIndex && wi <= p.endIndex) {
          bg = `${p.color}44`;
        }
      }

      const sv = state.svocData?.[si];
      let textDecoration: string | undefined;
      let textDecorationColor: string | undefined;
      let textUnderlineOffset: string | undefined;

      if (sv && viewMode === 'svoc') {
        const hit = (start: unknown, end: unknown) =>
          typeof start === 'number' &&
          start >= 0 &&
          typeof end === 'number' &&
          end >= 0 &&
          wi >= start &&
          wi <= end;
        let painted = false;
        for (const comp of SVOC_COMPONENTS) {
          const f = SVOC_FIELDS[comp.id];
          const st = sv[f.start] as unknown;
          const en = sv[f.end] as unknown;
          if (hit(st, en)) {
            bg = SVOC_WORD_BG[comp.color];
            painted = true;
            break;
          }
        }
        if (!painted) {
          if (hit(sv.objectStart, sv.objectEnd)) bg = SVOC_WORD_BG.green;
          else if (hit(sv.complementStart, sv.complementEnd)) bg = SVOC_WORD_BG.purple;
        }
      } else if (sv && showSvOverlay) {
        const inRange = (s: unknown, e: unknown) =>
          typeof s === 'number' && s >= 0 && typeof e === 'number' && e >= 0 && wi >= s && wi <= e;
        if (inRange(sv.subjectStart, sv.subjectEnd)) {
          textDecoration = 'underline wavy';
          textDecorationColor = 'rgba(234,179,8,0.7)';
          textUnderlineOffset = '3px';
        } else if (inRange(sv.verbStart, sv.verbEnd)) {
          textDecoration = 'underline wavy';
          textDecorationColor = 'rgba(59,130,246,0.7)';
          textUnderlineOffset = '3px';
        }
      }

      return { backgroundColor: bg, borderRight, outline, outlineOffset: outline ? 1 : undefined, textDecoration, textDecorationColor, textUnderlineOffset };
    };
  }, [state, viewMode, vocabularyDisplayByPosition, pending, showSvOverlay]);

  const orderedModes = useMemo(() => {
    if (!state) return MODES;
    const order = normalizeEditorViewModeOrder(state.editorViewModeOrder);
    return order.map((id) => MODES.find((m) => m.id === id)!) as typeof MODES;
  }, [state]);

  useEffect(() => {
    const tb = passageMeta?.textbook?.trim();
    if (!tb) {
      setTextbookSiblings([]);
      setTextbookSiblingsLoading(false);
      return;
    }
    let cancelled = false;
    setTextbookSiblingsLoading(true);
    fetch(`/api/admin/passages?textbook=${encodeURIComponent(tb)}&limit=500&page=1`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d: { items?: unknown[] }) => {
        if (cancelled) return;
        const items = Array.isArray(d.items) ? d.items : [];
        setTextbookSiblings(
          items.map((row) => {
            const rec = row as Record<string, unknown>;
            const o = rec.order;
            return {
              _id: String(rec._id ?? ''),
              chapter: rec.chapter != null ? String(rec.chapter) : '',
              number: rec.number != null ? String(rec.number) : '',
              source_key: rec.source_key != null ? String(rec.source_key) : '',
              order: typeof o === 'number' && !Number.isNaN(o) ? o : 0,
            };
          })
        );
      })
      .catch(() => {
        if (!cancelled) setTextbookSiblings([]);
      })
      .finally(() => {
        if (!cancelled) setTextbookSiblingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [passageMeta?.textbook]);

  const siblingNav = useMemo(() => {
    const id = passageId?.trim().toLowerCase() ?? '';
    if (!id || textbookSiblings.length === 0) {
      return { index: -1, prev: null as string | null, next: null as string | null, total: 0 };
    }
    const idx = textbookSiblings.findIndex((s) => s._id.toLowerCase() === id);
    return {
      index: idx,
      prev: idx > 0 ? textbookSiblings[idx - 1]._id : null,
      next: idx >= 0 && idx < textbookSiblings.length - 1 ? textbookSiblings[idx + 1]._id : null,
      total: textbookSiblings.length,
    };
  }, [passageId, textbookSiblings]);

  const goPassage = useCallback(
    (nextPassageId: string) => {
      const next = nextPassageId.trim();
      if (!next || next === passageId?.trim()) return;
      if (stateDirtyRef.current) {
        if (!window.confirm('저장되지 않은 변경이 있을 수 있습니다. 다른 지문으로 이동할까요?')) return;
      }
      router.push(`/admin/syntax-analyzer/analyze?passageId=${encodeURIComponent(next)}`);
    },
    [passageId, router]
  );

  /** 같은 교재 지문: ⌘⇧← 이전 / ⌘⇧→ 다음 (Windows: Ctrl⇧← / →). 입력·셀렉트 포커스일 때는 무시 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || (!e.metaKey && !e.ctrlKey)) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

      const el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
        return;
      if (el instanceof HTMLElement && el.isContentEditable) return;

      if (textbookSiblingsLoading || !passageMeta?.textbook?.trim()) return;

      if (e.key === 'ArrowLeft' && siblingNav.prev) {
        e.preventDefault();
        goPassage(siblingNav.prev);
        return;
      }
      if (e.key === 'ArrowRight' && siblingNav.next) {
        e.preventDefault();
        goPassage(siblingNav.next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goPassage, siblingNav.prev, siblingNav.next, passageMeta?.textbook, textbookSiblingsLoading]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-10 h-10 border-4 border-slate-600 border-t-white rounded-full" />
      </div>
    );
  }

  if (!state || !analysisFileName) {
    return <p className="text-slate-400 p-6">{msg || '지문을 선택해 주세요.'}</p>;
  }

  const comprehensiveSlotCount = clampComprehensiveSlotCount(state.comprehensiveSlotCount);
  const slotIndices = Array.from({ length: comprehensiveSlotCount }, (_, idx) => idx + 1);

  return (
    <div className="w-full max-w-[min(100vw-1rem,104rem)] mx-auto px-4 py-4 overflow-visible">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between rounded-xl border border-slate-700/85 bg-slate-900/85 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 text-xs">
          <Link
            href="/admin/syntax-analyzer"
            className="text-sky-400 hover:text-sky-300 shrink-0 font-medium"
          >
            ← 구문분석 목록
          </Link>
          {passageMeta?.textbook ? (
            <span className="text-slate-400 truncate max-w-[min(100vw-6rem,32rem)]" title={passageMeta.textbook}>
              <span className="text-slate-600">교재</span>{' '}
              <span className="text-slate-100 font-semibold">{passageMeta.textbook}</span>
              {(passageMeta.chapter || passageMeta.number) && (
                <span className="text-slate-500 font-normal">
                  {' '}
                  · {passageMeta.chapter}
                  {passageMeta.number ? ` ${passageMeta.number}` : ''}
                </span>
              )}
            </span>
          ) : (
            <span className="text-slate-600">교재명 없음 — 이전/다음·목록 이동은 같은 교재로 묶인 지문만 가능합니다.</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => siblingNav.prev && goPassage(siblingNav.prev)}
            disabled={!siblingNav.prev || textbookSiblingsLoading || !passageMeta?.textbook}
            className="px-2.5 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-[11px] font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-35 disabled:pointer-events-none"
            title="같은 교재에서 이전 지문(목록 순서) · ⌘⇧← / Ctrl⇧←"
          >
            ← 이전
          </button>
          <select
            value={passageId || ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v && v !== passageId) goPassage(v);
            }}
            disabled={
              textbookSiblingsLoading ||
              (!textbookSiblings.length && !passageId) ||
              !passageMeta?.textbook
            }
            className="max-w-[min(100vw-11rem,22rem)] text-[11px] bg-slate-950 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-200"
            title="같은 교재 지문을 골라 바로 이동 (필터가 아니라 목록 점프)"
            aria-label="같은 교재 지문으로 이동"
          >
            {textbookSiblingsLoading ? (
              <option value={passageId || ''}>목록 불러오는 중…</option>
            ) : (
              <>
                {passageId && !textbookSiblings.some((s) => s._id === passageId) ? (
                  <option value={passageId}>현재 지문 (목록에 없음)</option>
                ) : null}
                {textbookSiblings.length === 0 && passageMeta?.textbook ? (
                  <option value={passageId || ''}>같은 교재 지문 없음</option>
                ) : null}
                {textbookSiblings.map((s) => (
                  <option key={s._id} value={s._id}>
                    {formatSiblingLabel(s)}
                  </option>
                ))}
              </>
            )}
          </select>
          <button
            type="button"
            onClick={() => siblingNav.next && goPassage(siblingNav.next)}
            disabled={!siblingNav.next || textbookSiblingsLoading || !passageMeta?.textbook}
            className="px-2.5 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-[11px] font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-35 disabled:pointer-events-none"
            title="같은 교재에서 다음 지문(목록 순서) · ⌘⇧→ / Ctrl⇧→"
          >
            다음 →
          </button>
          {passageMeta?.textbook && siblingNav.total > 0 ? (
            <span className="text-[10px] text-slate-500 tabular-nums whitespace-nowrap hidden sm:inline">
              {siblingNav.index >= 0 ? `${siblingNav.index + 1} / ${siblingNav.total}` : `총 ${siblingNav.total}`}
              <span className="text-slate-600 ml-1.5 hidden md:inline">· ⌘⇧←→</span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-xs text-slate-400">
            작업 진행{' '}
            <span className="text-slate-200 font-semibold tabular-nums">
              {progressView.doneCount}/{progressView.total}
            </span>
          </span>
          <div className="h-1.5 flex-1 min-w-[100px] max-w-md rounded-full bg-slate-900 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500/90 transition-all duration-300"
              style={{
                width: progressView.total ? `${(progressView.doneCount / progressView.total) * 100}%` : '0%',
              }}
            />
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-500 shrink-0">
            {progressTrackingMode === 'auto' ? '자동 감지' : '수기 표시'}
          </span>
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowProgressSettings((v) => !v)}
              className="p-1 rounded text-slate-500 hover:bg-slate-700 hover:text-slate-300"
              title="진행 표시 설정"
              aria-expanded={showProgressSettings}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {showProgressSettings ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default bg-transparent"
                  aria-label="닫기"
                  onClick={() => setShowProgressSettings(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border border-slate-600 bg-slate-900 p-3 shadow-xl">
                  <p className="text-[11px] font-semibold text-slate-300 mb-2">완료 단계 표시 방식</p>
                  <label className="flex items-start gap-2 cursor-pointer rounded p-1.5 hover:bg-slate-800/80">
                    <input
                      type="radio"
                      name="paProgressMode"
                      checked={progressTrackingMode === 'auto'}
                      onChange={() => {
                        setProgressTrackingMode('auto');
                        try {
                          localStorage.setItem(PROGRESS_MODE_KEY, 'auto');
                        } catch {
                          /* ignore */
                        }
                        setShowProgressSettings(false);
                      }}
                      className="mt-0.5"
                    />
                    <span className="text-xs text-slate-300">
                      <span className="font-medium text-emerald-400/90">자동 감지</span>
                      <span className="block text-[10px] text-slate-500 leading-snug">
                        입력·저장 데이터로 완료를 추정합니다. 칩을 눌러 덮어쓸 수 있습니다.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer rounded p-1.5 hover:bg-slate-800/80 mt-1">
                    <input
                      type="radio"
                      name="paProgressMode"
                      checked={progressTrackingMode === 'manual'}
                      onChange={() => {
                        setProgressTrackingMode('manual');
                        try {
                          localStorage.setItem(PROGRESS_MODE_KEY, 'manual');
                        } catch {
                          /* ignore */
                        }
                        setShowProgressSettings(false);
                      }}
                      className="mt-0.5"
                    />
                    <span className="text-xs text-slate-300">
                      <span className="font-medium text-sky-400/90">수기 표시</span>
                      <span className="block text-[10px] text-slate-500 leading-snug">칩만 눌러 완료 여부를 직접 표시합니다.</span>
                    </span>
                  </label>
                </div>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {progressView.steps.map((st) => {
            const isOverride = st.manualVal !== undefined;
            return (
              <button
                key={st.key}
                type="button"
                title={`${st.n}. ${st.label}\n클릭: 완료 토글${progressTrackingMode === 'auto' && st.autoDetected && !isOverride ? '\n(자동 감지됨)' : ''}`}
                onClick={() => handleProgressStepClick(st.key, st.autoDetected)}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                  st.done
                    ? progressTrackingMode === 'manual' || (isOverride && !st.autoDetected)
                      ? 'border-sky-500/50 bg-sky-950/40 text-sky-200'
                      : 'border-emerald-600/50 bg-emerald-950/35 text-emerald-200'
                    : isOverride
                      ? 'border-red-500/40 bg-red-950/25 text-red-300/90 line-through'
                      : 'border-slate-600/80 bg-slate-900/80 text-slate-500 hover:border-slate-500 hover:text-slate-300'
                }`}
              >
                <span className="text-slate-500 tabular-nums">{st.n}</span>
                <span>{st.done ? '✓' : '○'}</span>
                {st.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <h2 className="text-sm font-bold text-emerald-300/95 shrink-0">종합 분석</h2>
            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="text-slate-500">답변 일괄</span>
              <button
                type="button"
                onClick={() =>
                  updateState((s) => {
                    const n = clampComprehensiveSlotCount(s.comprehensiveSlotCount);
                    const next: Record<string, 'ko' | 'en'> = {};
                    for (let j = 1; j <= n; j++) next[String(j)] = 'ko';
                    return { ...s, comprehensiveOutputLangBySlot: next, comprehensiveOutputLang: 'ko' };
                  })
                }
                className="px-2 py-0.5 rounded border border-slate-600 bg-slate-900 text-slate-300 hover:bg-slate-800"
              >
                전체 한글
              </button>
              <button
                type="button"
                onClick={() =>
                  updateState((s) => {
                    const n = clampComprehensiveSlotCount(s.comprehensiveSlotCount);
                    const next: Record<string, 'ko' | 'en'> = {};
                    for (let j = 1; j <= n; j++) next[String(j)] = 'en';
                    return { ...s, comprehensiveOutputLangBySlot: next, comprehensiveOutputLang: 'en' };
                  })
                }
                className="px-2 py-0.5 rounded border border-slate-600 bg-slate-900 text-slate-300 hover:bg-slate-800"
              >
                전체 English
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={runComprehensive}
            disabled={!!busy || !state.sentences.length}
            className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-sm font-semibold disabled:opacity-40 shrink-0"
          >
            {busy === '종합' ? '분석 중…' : 'AI 종합분석 실행'}
          </button>
        </div>

        <details className="rounded-lg border border-slate-700/80 bg-slate-900/40">
          <summary className="cursor-pointer select-none px-2 py-2 text-xs text-slate-400 hover:text-slate-300">
            항목별 프롬프트 ({comprehensiveSlotCount}개) · 번호마다 답변 KO/EN · 비우면 기본 문구
          </summary>
          <div className="px-2 pb-3 pt-1 space-y-2 border-t border-slate-700/60 max-h-[min(22rem,50vh)] overflow-y-auto">
            {slotIndices.map((i) => {
              const legacy = state.comprehensiveOutputLang === 'en' ? 'en' : 'ko';
              const slotLang = effectiveSlotOutputLang(i, state.comprehensiveOutputLangBySlot ?? null, legacy);
              return (
                <div key={i} className="flex gap-2 items-start">
                  <label className="block flex-1 min-w-0">
                    <span className="text-[10px] text-slate-500 mb-0.5 block">
                      {COMPREHENSIVE_ITEM_LABELS[String(i)] || `추가 항목 ${i}`}
                    </span>
                    <textarea
                      value={state.comprehensiveCustomPrompts?.[String(i)] ?? ''}
                      onChange={(e) =>
                        updateState((s) => ({
                          ...s,
                          comprehensiveCustomPrompts: {
                            ...(s.comprehensiveCustomPrompts || {}),
                            [String(i)]: e.target.value,
                          },
                        }))
                      }
                      placeholder={DEFAULT_PROMPTS[i] ?? COMPREHENSIVE_EXTRA_SLOT_HINT}
                      rows={i > 5 ? 3 : 2}
                      disabled={!!(state.comprehensiveMasterPrompt || '').trim()}
                      className="w-full text-xs bg-slate-950 border border-slate-600 rounded-md px-2 py-1.5 text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
                    />
                  </label>
                  <div className="shrink-0 flex flex-col gap-0.5 pt-5">
                    <span className="text-[9px] text-slate-600 text-center leading-none">답변</span>
                    <div className="flex rounded-md border border-slate-600 overflow-hidden text-[10px]">
                      <button
                        type="button"
                        onClick={() =>
                          updateState((s) => ({
                            ...s,
                            comprehensiveOutputLangBySlot: {
                              ...(s.comprehensiveOutputLangBySlot || {}),
                              [String(i)]: 'ko',
                            },
                          }))
                        }
                        className={`px-2 py-1 ${slotLang !== 'en' ? 'bg-sky-800 text-white' : 'bg-slate-950 text-slate-500 hover:bg-slate-900'}`}
                      >
                        KO
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateState((s) => ({
                            ...s,
                            comprehensiveOutputLangBySlot: {
                              ...(s.comprehensiveOutputLangBySlot || {}),
                              [String(i)]: 'en',
                            },
                          }))
                        }
                        className={`px-2 py-1 border-l border-slate-600 ${slotLang === 'en' ? 'bg-sky-800 text-white' : 'bg-slate-950 text-slate-500 hover:bg-slate-900'}`}
                      >
                        EN
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() =>
                  updateState((s) => {
                    const prev = clampComprehensiveSlotCount(s.comprehensiveSlotCount);
                    const nextCount = clampComprehensiveSlotCount(prev + 1);
                    const legacy = s.comprehensiveOutputLang === 'en' ? 'en' : 'ko';
                    const inherit = effectiveSlotOutputLang(prev, s.comprehensiveOutputLangBySlot ?? null, legacy);
                    return {
                      ...s,
                      comprehensiveSlotCount: nextCount,
                      comprehensiveOutputLangBySlot: {
                        ...(s.comprehensiveOutputLangBySlot || {}),
                        [String(nextCount)]: inherit,
                      },
                    };
                  })
                }
                disabled={!!(state.comprehensiveMasterPrompt || '').trim() || comprehensiveSlotCount >= 30}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-700/60 bg-emerald-950/40 text-emerald-200 text-[11px] font-medium hover:bg-emerald-900/50 disabled:opacity-40"
                title="분석 항목 하나 추가 (최대 30)"
              >
                + 항목 추가
              </button>
              {comprehensiveSlotCount > 5 ? (
                <button
                  type="button"
                  onClick={() =>
                    updateState((s) => {
                      const cur = clampComprehensiveSlotCount(s.comprehensiveSlotCount);
                      if (cur <= 5) return s;
                      const next = cur - 1;
                      const cp = { ...(s.comprehensiveCustomPrompts || {}) };
                      delete cp[String(cur)];
                      const lbs = { ...(s.comprehensiveOutputLangBySlot || {}) };
                      delete lbs[String(cur)];
                      const comp = s.analysisResults?.comprehensive as Record<string, unknown> | undefined;
                      const nextComp = comp ? { ...comp } : null;
                      if (nextComp) delete nextComp[`item_${cur}`];
                      return {
                        ...s,
                        comprehensiveSlotCount: next,
                        comprehensiveCustomPrompts: cp,
                        comprehensiveOutputLangBySlot: lbs,
                        analysisResults:
                          nextComp && s.analysisResults
                            ? { ...s.analysisResults, comprehensive: nextComp }
                            : s.analysisResults,
                      };
                    })
                  }
                  disabled={!!(state.comprehensiveMasterPrompt || '').trim()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-600 bg-slate-900 text-slate-400 text-[11px] hover:text-slate-200 disabled:opacity-40"
                  title="마지막 추가 항목 제거"
                >
                  − 마지막 항목 제거
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() =>
                updateState((s) => ({ ...s, comprehensiveCustomPrompts: {} }))
              }
              disabled={!!(state.comprehensiveMasterPrompt || '').trim()}
              className="text-[11px] text-sky-400 hover:text-sky-300 disabled:opacity-40"
            >
              항목별 사용자 입력 전체 초기화
            </button>
          </div>
        </details>

        <details className="rounded-lg border border-slate-700/80 bg-slate-900/40">
          <summary className="cursor-pointer select-none px-2 py-2 text-xs text-slate-400 hover:text-slate-300">
            고급: 전체 프롬프트 한 번에 (비우면 위 항목 조합 사용)
          </summary>
          <div className="px-2 pb-3 pt-1 border-t border-slate-700/60 space-y-1">
            <textarea
              value={state.comprehensiveMasterPrompt ?? ''}
              onChange={(e) =>
                updateState((s) => ({ ...s, comprehensiveMasterPrompt: e.target.value }))
              }
              placeholder="예: 다음 지문을 분석하세요. 지문: {{지문}}"
              rows={4}
              className="w-full text-xs bg-slate-950 border border-slate-600 rounded-md px-2 py-1.5 text-slate-200 placeholder:text-slate-600 font-mono"
            />
            <p className="text-[10px] text-slate-500 leading-relaxed">
              <code className="text-slate-400">{'{{지문}}'}</code>에 현재 지문(문장 연결)이 들어갑니다. 입력 시 위 항목별 프롬프트는 무시됩니다.
            </p>
          </div>
        </details>

        {state.analysisResults &&
          typeof state.analysisResults.comprehensive === 'object' &&
          state.analysisResults.comprehensive != null && (
            <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/15 p-3 text-sm space-y-2">
              <p className="text-xs font-semibold text-emerald-200/90">분석 결과</p>
              {String((state.analysisResults.comprehensive as Record<string, unknown>).error || '').trim() ? (
                <p className="text-red-400 text-xs">
                  {(state.analysisResults.comprehensive as Record<string, unknown>).error as string}
                </p>
              ) : null}
              <div className="space-y-2">
                {COMPREHENSIVE_DISPLAY_ORDER.map((key) => {
                  const comp = state.analysisResults!.comprehensive as Record<string, unknown>;
                  const v = comp[key];
                  if (v == null || String(v).trim() === '') return null;
                  return (
                    <div key={key} className="text-slate-300">
                      <span className="text-slate-500 text-xs block mb-0.5">
                        {COMPREHENSIVE_RESULT_LABELS[key] || key}
                      </span>
                      <span className="text-[13px] leading-relaxed whitespace-pre-wrap">{String(v)}</span>
                    </div>
                  );
                })}
                {slotIndices
                  .filter((i) => i > 5)
                  .map((i) => {
                    const comp = state.analysisResults!.comprehensive as Record<string, unknown>;
                    const key = `item_${i}`;
                    const v = comp[key];
                    if (v == null || String(v).trim() === '') return null;
                    return (
                      <div key={key} className="text-slate-300">
                        <span className="text-slate-500 text-xs block mb-0.5">추가 항목 {i}</span>
                        <span className="text-[13px] leading-relaxed whitespace-pre-wrap">{String(v)}</span>
                      </div>
                    );
                  })}
              </div>
              {(() => {
                const comp = state.analysisResults!.comprehensive as Record<string, unknown>;
                const orderSet = new Set<string>([...COMPREHENSIVE_DISPLAY_ORDER]);
                const extra = Object.entries(comp).filter(
                  ([k, v]) =>
                    !orderSet.has(k) &&
                    k !== 'error' &&
                    !/^item_\d+$/.test(k) &&
                    v != null &&
                    String(v).trim() !== ''
                );
                if (extra.length === 0) return null;
                return (
                  <div className="pt-2 border-t border-slate-700/60 space-y-1">
                    {extra.map(([k, v]) => (
                      <p key={k} className="text-xs text-slate-400">
                        <span className="text-slate-600">{k}: </span>
                        {String(v)}
                      </p>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
      </div>

      <div className="flex flex-col lg:flex-row gap-4 overflow-visible">
      <aside className="lg:w-52 shrink-0 space-y-2">
        <p className="text-xs text-slate-500 font-mono break-all">{analysisFileName}</p>
        <button
          type="button"
          onClick={() => setMongoPanelOpen((v) => !v)}
          className="w-full py-1.5 rounded-lg border border-slate-600 bg-slate-800/90 text-[11px] text-slate-300 hover:bg-slate-700"
        >
          {mongoPanelOpen ? 'MongoDB JSON 닫기' : 'MongoDB JSON 보기'}
        </button>
        <p className="text-[10px] text-slate-600 px-0.5 -mt-1 mb-1">왼쪽 점 아이콘을 드래그하면 순서가 저장됩니다.</p>
        <button
          type="button"
          onClick={() => void runBatchAiAll()}
          disabled={!!busy || !state.sentences.length}
          title="종합분석 → 어법·문맥 → 구문·SVOC → 문법태그 → 단어장(비었으면 지문에서 추출 후 뜻·품사). 서술형·끊어읽기는 수동입니다."
          className="w-full py-2.5 rounded-lg bg-gradient-to-r from-emerald-800 to-teal-800 hover:from-emerald-700 hover:to-teal-700 text-sm font-semibold text-white border border-emerald-600/50 shadow-sm disabled:opacity-40 disabled:pointer-events-none"
        >
          {busy === '일괄' ? '일괄 AI 실행 중…' : 'AI 전체 자동 실행'}
        </button>
        <p className="text-[9px] text-slate-600 px-0.5 leading-snug">
          서술형 대비·끊어읽기(/)는 자동 없음 — 해당 모드에서 직접 표시합니다.
        </p>
        <label className="flex items-center gap-2 px-1 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 cursor-pointer select-none group">
          <input
            type="checkbox"
            checked={showSvOverlay}
            onChange={() => setShowSvOverlay((p) => !p)}
            className="accent-amber-500 w-3.5 h-3.5"
          />
          <span className="text-[11px] text-slate-400 group-hover:text-slate-200 transition-colors">
            <span className="inline-block w-3 h-0.5 rounded-full mr-0.5 align-middle" style={{ background: 'rgba(234,179,8,0.7)' }} />S
            <span className="inline-block w-3 h-0.5 rounded-full mx-0.5 align-middle" style={{ background: 'rgba(59,130,246,0.7)' }} />V
            {' '}오버레이 표시
          </span>
        </label>
        <ul className="space-y-2 list-none p-0 m-0" role="list">
          {orderedModes.map((m) => (
            <li key={m.id} className="m-0">
              <div
                className={`flex rounded-lg overflow-hidden border ${
                  dragOverMode === m.id ? 'border-sky-500 ring-1 ring-sky-500/60' : 'border-transparent'
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverMode(m.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverMode(null);
                  const raw =
                    e.dataTransfer.getData('application/x-editor-mode') ||
                    e.dataTransfer.getData('text/plain');
                  const from = raw as EditorViewMode;
                  if (!from || !EDITOR_MODE_ID_SET.has(from) || from === m.id) return;
                  updateState((s) => {
                    const cur = normalizeEditorViewModeOrder(s.editorViewModeOrder);
                    return { ...s, editorViewModeOrder: reorderEditorModes(cur, from, m.id) };
                  });
                }}
              >
                <button
                  type="button"
                  draggable
                  title="드래그하여 순서 변경"
                  aria-label={`${m.label} 순서 바꾸기`}
                  onClick={(e) => e.preventDefault()}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', m.id);
                    e.dataTransfer.setData('application/x-editor-mode', m.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDragOverMode(null)}
                  className="shrink-0 px-1.5 py-2 rounded-l-lg bg-slate-800/90 text-slate-400 cursor-grab active:cursor-grabbing hover:bg-slate-700/90 border-r border-slate-700/80 flex items-center justify-center"
                >
                  <ModeDragHandleIcon />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode(m.id);
                    setPending(null);
                  }}
                  className={`flex-1 min-w-0 text-left px-3 py-2 rounded-r-lg text-sm ${
                    viewMode === m.id ? 'bg-sky-800 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {m.label}
                </button>
              </div>
            </li>
          ))}
        </ul>
        {viewMode === 'grammar' && (
          <div className="pt-3 border-t border-slate-700 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 px-1">어법</p>
            <div className="flex rounded-lg border border-slate-600 overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setGrammarSubMode('manual')}
                className={`flex-1 py-1.5 ${grammarSubMode === 'manual' ? 'bg-amber-800 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}
              >
                수동
              </button>
              <button
                type="button"
                onClick={() => setGrammarSubMode('ai')}
                className={`flex-1 py-1.5 border-l border-slate-600 ${grammarSubMode === 'ai' ? 'bg-amber-800 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}
              >
                AI
              </button>
            </div>
            {grammarSubMode === 'ai' && (
              <>
                <button
                  type="button"
                  onClick={runGrammarAiSuggest}
                  disabled={!!busy || !state.sentences.length}
                  className="w-full py-2 rounded-lg bg-amber-700 text-sm font-medium disabled:opacity-40"
                >
                  {busy === '어법AI' ? '분석 중…' : 'AI로 어법 단어 표시'}
                </button>
                <details className="rounded-lg border border-slate-700/80 bg-slate-900/50">
                  <summary className="cursor-pointer select-none px-2 py-2 text-[11px] text-slate-400 hover:text-slate-300">
                    AI 프롬프트 설정
                  </summary>
                  <div className="px-2 pb-2 pt-0 space-y-2 border-t border-slate-700/60">
                    <p className="text-[10px] text-slate-500 leading-snug pt-1">
                      문장 목록은 전송 시 자동으로 붙습니다. 중간에 넣으려면{' '}
                      <code className="text-slate-400">{GRAMMAR_AI_SENTENCES_PLACEHOLDER}</code> 를 사용하세요.
                    </p>
                    <textarea
                      value={state.grammarAiPrompt ?? DEFAULT_GRAMMAR_AI_PROMPT}
                      onChange={(e) => updateState((s) => ({ ...s, grammarAiPrompt: e.target.value }))}
                      rows={14}
                      className="w-full text-[11px] bg-slate-950 border border-slate-600 rounded-md px-2 py-1.5 text-slate-200 placeholder:text-slate-600 font-mono leading-relaxed"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateState((s) => ({ ...s, grammarAiPrompt: DEFAULT_GRAMMAR_AI_PROMPT }))
                      }
                      className="text-[11px] text-amber-400/90 hover:text-amber-300"
                    >
                      기본 프롬프트로 되돌리기
                    </button>
                  </div>
                </details>
              </>
            )}
          </div>
        )}
        {viewMode === 'context' && (
          <div className="pt-3 border-t border-slate-700 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 px-1">문맥</p>
            <div className="flex rounded-lg border border-slate-600 overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setContextSubMode('manual')}
                className={`flex-1 py-1.5 ${contextSubMode === 'manual' ? 'bg-emerald-800 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}
              >
                수동
              </button>
              <button
                type="button"
                onClick={() => setContextSubMode('ai')}
                className={`flex-1 py-1.5 border-l border-slate-600 ${contextSubMode === 'ai' ? 'bg-emerald-800 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}
              >
                AI
              </button>
            </div>
            {contextSubMode === 'ai' && (
              <>
                <button
                  type="button"
                  onClick={runContextAiSuggest}
                  disabled={!!busy || !state.sentences.length}
                  className="w-full py-2 rounded-lg bg-emerald-700 text-sm font-medium disabled:opacity-40"
                >
                  {busy === '문맥AI' ? '분석 중…' : 'AI로 문맥 단어 표시'}
                </button>
                <details className="rounded-lg border border-slate-700/80 bg-slate-900/50">
                  <summary className="cursor-pointer select-none px-2 py-2 text-[11px] text-slate-400 hover:text-slate-300">
                    AI 프롬프트 설정
                  </summary>
                  <div className="px-2 pb-2 pt-0 space-y-2 border-t border-slate-700/60">
                    <p className="text-[10px] text-slate-500 leading-snug pt-1">
                      문장 목록은 전송 시 자동으로 붙습니다. 중간에 넣으려면{' '}
                      <code className="text-slate-400">{CONTEXT_AI_SENTENCES_PLACEHOLDER}</code> 를 사용하세요.
                    </p>
                    <textarea
                      value={state.contextAiPrompt ?? DEFAULT_CONTEXT_AI_PROMPT}
                      onChange={(e) => updateState((s) => ({ ...s, contextAiPrompt: e.target.value }))}
                      rows={14}
                      className="w-full text-[11px] bg-slate-950 border border-slate-600 rounded-md px-2 py-1.5 text-slate-200 placeholder:text-slate-600 font-mono leading-relaxed"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateState((s) => ({ ...s, contextAiPrompt: DEFAULT_CONTEXT_AI_PROMPT }))
                      }
                      className="text-[11px] text-emerald-400/90 hover:text-emerald-300"
                    >
                      기본 프롬프트로 되돌리기
                    </button>
                  </div>
                </details>
              </>
            )}
          </div>
        )}
        <div className="pt-4 border-t border-slate-700 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 px-1">AI 보조</p>
          <button
            type="button"
            onClick={runAiSyntax}
            disabled={!!busy}
            className="w-full py-2 rounded-lg bg-violet-700 text-sm disabled:opacity-40"
          >
            AI 구문
          </button>
          <button
            type="button"
            onClick={runAiSvoc}
            disabled={!!busy}
            className="w-full py-2 rounded-lg bg-amber-700 text-sm disabled:opacity-40"
          >
            AI SVOC
          </button>
          <button
            type="button"
            onClick={runGrammarTagsAi}
            disabled={!!busy}
            className="w-full py-2 rounded-lg bg-indigo-800 text-sm disabled:opacity-40"
          >
            AI 문법태그
          </button>
          <button
            type="button"
            onClick={() => void runAnalyzeVocabulary()}
            disabled={!!busy}
            className="w-full py-2 rounded-lg bg-teal-800 text-sm disabled:opacity-40"
          >
            AI 단어장
          </button>
        </div>
        {viewMode === 'syntax' && (
          <select
            value={syntaxLabel}
            onChange={(e) => setSyntaxLabel(e.target.value)}
            className="w-full mt-2 bg-slate-900 border border-slate-600 rounded text-xs p-2"
          >
            {SYNTAX_LABEL_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        )}
        {viewMode === 'grammarTags' && (
          <div className="mt-2 space-y-1.5">
            <label className="block text-[10px] text-slate-500">새 태그 이름</label>
            <input
              value={newGrammarTagName}
              onChange={(e) => setNewGrammarTagName(e.target.value)}
              placeholder="#전치사구"
              className="w-full bg-slate-900 border border-slate-600 rounded text-xs p-2 text-slate-200 placeholder:text-slate-600"
            />
            <p className="text-[10px] text-slate-500 leading-snug">
              비워 두면 「#태그」로 붙습니다. 범위 지정 전에 이름을 바꿀 수 있습니다.
            </p>
          </div>
        )}
        {viewMode === 'vocabulary' && (
          <div className="flex flex-col gap-1.5 mt-2">
            <button
              type="button"
              onClick={regenerateVocabularyFromPassage}
              disabled={!!busy || !state.sentences.some((s) => s.trim())}
              className="w-full py-2 rounded-lg bg-teal-900/80 border border-teal-700/60 text-xs text-teal-100 disabled:opacity-40"
            >
              지문에서 다시 생성
            </button>
            <button
              type="button"
              onClick={() => void runAnalyzeVocabulary()}
              disabled={!!busy || !(state.vocabularyList?.length ?? 0)}
              className="w-full py-2 rounded-lg bg-teal-800 text-xs font-medium disabled:opacity-40"
            >
              AI로 뜻·품사 채우기
            </button>
            <button
              type="button"
              onClick={addVocabFromSelection}
              className="w-full py-2 rounded-lg bg-slate-700 text-xs"
            >
              어법 선택 → 단어장
            </button>
            <button
              type="button"
              onClick={removeStopwordsFromVocabularyList}
              disabled={!(state.vocabularyList?.length ?? 0)}
              className="w-full py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-[11px] text-slate-300 disabled:opacity-40"
            >
              불용어 항목 제거
            </button>
            <button
              type="button"
              onClick={() => setShowStopWordsModal(true)}
              className="w-full py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-[11px] text-slate-300"
            >
              불용어 관리
            </button>
            <button
              type="button"
              onClick={() =>
                updateState((s) => ({
                  ...s,
                  vocabularyList: regenerateVocabularyPositions(s.vocabularyList || [], s.sentences),
                }))
              }
              className="w-full py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-[11px] text-slate-300"
            >
              단어 위치 재계산
            </button>
            <button
              type="button"
              onClick={() =>
                updateState((s) => ({
                  ...s,
                  vocabularyList: mergeDuplicateVocabularyEntries(s.vocabularyList || []),
                }))
              }
              className="w-full py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-[11px] text-slate-300"
            >
              같은 단어 병합
            </button>
          </div>
        )}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col lg:flex-row gap-4 items-start overflow-visible min-h-0">
        <div className="flex-1 min-w-0 space-y-4 w-full min-h-0">
        {busy && <p className="text-sky-400 text-sm">{busy} 분석 중…</p>}
        {msg && <p className="text-amber-400 text-sm">{msg}</p>}
        <p className="text-slate-500 text-xs">
          {viewMode === 'topicSentence'
            ? '상단 번호 칩 또는 문장 카드(영문·해석·단어)를 클릭해 주제문장을 켜고 끕니다. 다시 클릭하면 취소됩니다.'
            : viewMode === 'essaySentence'
              ? '상단 번호 칩 또는 문장 카드를 클릭해 서술형 대비 문장을 표시합니다. 다시 클릭하면 취소됩니다.'
              : viewMode === 'svoc'
                ? '오른쪽 패널에서 요소(S,V,Oi…)를 고른 뒤, 같은 문장에서 시작·끝 단어를 순서대로 클릭합니다. 이미 칠한 구간을 다시 누르면 해당 요소만 지워집니다. I\'m·don\'t처럼 한 단어에 주어+동사가 붙은 경우는 오른쪽 안내를 참고하세요.'
                : viewMode === 'syntax'
                  ? '같은 문장에서 시작 단어·끝 단어 순으로 클릭해 범위를 지정합니다.'
                : viewMode === 'grammarTags'
                  ? '왼쪽에 태그 이름을 입력한 뒤, 같은 문장에서 시작·끝 단어를 순서대로 클릭해 구간을 추가합니다. 문장 아래 목록에서 태그명·구절·설명을 수정하거나 삭제할 수 있습니다.'
                  : viewMode === 'sentenceBreaks'
                  ? '단어를 클릭하면 해당 위치 뒤에 끊어읽기(/)가 토글됩니다.'
                  : viewMode === 'grammar'
                    ? grammarSubMode === 'ai'
                      ? 'AI로 표시한 뒤에도 단어를 클릭해 어법 표시를 더하거나 뺄 수 있습니다. 프롬프트는 왼쪽 「AI 프롬프트 설정」에서 수정합니다.'
                      : '단어를 클릭해 어법으로 표시할 위치를 켜고 끕니다.'
                    : viewMode === 'context'
                      ? contextSubMode === 'ai'
                        ? 'AI로 표시한 뒤에도 단어를 클릭해 문맥 표시를 더하거나 뺄 수 있습니다. 프롬프트는 왼쪽 「AI 프롬프트 설정」에서 수정합니다.'
                        : '단어를 클릭해 문맥으로 표시할 위치를 켜고 끕니다.'
                      : viewMode === 'vocabulary'
                        ? '단어장이 비어 있으면 지문에서 고유 단어를 자동으로 채웁니다(불용어 제외). 왼쪽에서 「지문에서 다시 생성」「불용어 관리」를 쓸 수 있고, 단어를 클릭해 항목을 더하거나 빼며, 「AI로 뜻·품사 채우기」로 분석을 돌릴 수 있습니다. CEFR 칸 목록의 「✨ AI로 CEFR」을 고르면 해당 줄만 문맥·뜻 기준으로 난이도를 채웁니다.'
                        : null}
        </p>

        {(viewMode === 'topicSentence' || viewMode === 'essaySentence') && (
          <div className="sticky top-2 z-[5] rounded-xl border border-slate-700/90 bg-slate-900/92 backdrop-blur-md px-3 py-2.5 shadow-lg shadow-black/25 mb-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span
                className={`text-[11px] font-semibold tracking-wide shrink-0 ${
                  viewMode === 'topicSentence' ? 'text-amber-200/95' : 'text-pink-200/95'
                }`}
              >
                {viewMode === 'topicSentence' ? '주제문장' : '서술형 대비'}
              </span>
              <div className="flex flex-wrap gap-1" role="group" aria-label="문장 번호 선택">
                {state.sentences.map((_, si) => {
                  const topicOn = state.topicHighlightedSentences?.includes(si) ?? false;
                  const essayOn = state.essayHighlightedSentences?.includes(si) ?? false;
                  const bothOn = topicOn && essayOn;
                  const active =
                    viewMode === 'topicSentence' ? topicOn : essayOn;
                  return (
                    <button
                      key={si}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleSentence(viewMode === 'topicSentence' ? 'topic' : 'essay', si)}
                      title={
                        bothOn
                          ? `문장 ${si + 1} — 주제·서술형 대비 모두 선택됨`
                          : `문장 ${si + 1}`
                      }
                      className={`min-h-7 min-w-7 rounded-md text-xs font-semibold tabular-nums transition ${
                        active
                          ? bothOn
                            ? 'bg-gradient-to-br from-amber-500/35 via-fuchsia-500/25 to-pink-500/35 text-white ring-1 ring-amber-300/45 shadow-[inset_0_0_0_1px_rgba(244,114,182,0.35)]'
                            : viewMode === 'topicSentence'
                              ? 'bg-amber-500/20 text-amber-100 ring-1 ring-amber-400/55'
                              : 'bg-pink-500/20 text-pink-100 ring-1 ring-pink-400/55'
                          : 'bg-slate-800/90 text-slate-500 hover:bg-slate-700 hover:text-slate-200'
                      }`}
                    >
                      {si + 1}
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] text-slate-500 hidden sm:inline">토글 · 다중 선택</span>
            </div>
          </div>
        )}

        {viewMode === 'vocabulary' && (
          <div className="rounded-xl border border-teal-900/50 bg-slate-900/80 px-3 py-3 space-y-3 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-teal-200/95 shrink-0">단어장 편집</span>
                <div className="flex rounded-lg border border-slate-600 overflow-hidden text-[11px]">
                  {(
                    [
                      { id: 'original' as const, label: '원본순' },
                      { id: 'alphabetical' as const, label: '알파벳' },
                      { id: 'position' as const, label: '위치순' },
                    ] as const
                  ).map(({ id, label }, i) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => updateState((s) => ({ ...s, vocabularySortOrder: id }))}
                      className={`px-2 py-1 ${i > 0 ? 'border-l border-slate-600' : ''} ${
                        (state.vocabularySortOrder || 'position') === id
                          ? 'bg-teal-800 text-white'
                          : 'bg-slate-950 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => updateState((s) => ({ ...s, showVocabulary: !(s.showVocabulary !== false) }))}
                  className="text-[11px] px-2 py-1 rounded-md border border-slate-600 text-slate-400 hover:bg-slate-800"
                >
                  {state.showVocabulary === false ? '펼치기' : '접기'}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void downloadCurrentVocabularyXlsx()}
                  disabled={!!vocabExportBusy || !state}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg border border-emerald-700/70 bg-emerald-950/50 text-emerald-100 hover:bg-emerald-900/40 disabled:opacity-40 disabled:pointer-events-none"
                  title="현재 표에 보이는 단어장(정렬·편집 반영)을 .xlsx로 저장합니다."
                >
                  {vocabExportBusy === 'passage' ? '만드는 중…' : '이 지문 엑셀'}
                </button>
                <button
                  type="button"
                  onClick={() => void downloadTextbookVocabularyXlsx()}
                  disabled={
                    !!vocabExportBusy || !passageMeta?.textbook?.trim()
                  }
                  className="text-[11px] px-2.5 py-1.5 rounded-lg border border-sky-800/70 bg-sky-950/40 text-sky-100 hover:bg-sky-900/35 disabled:opacity-40 disabled:pointer-events-none"
                  title={
                    passageMeta?.textbook?.trim()
                      ? `같은 교재명「${passageMeta.textbook}」지문 중, MongoDB에 저장된 단어장만 모읍니다.`
                      : '지문에 교재명이 있어야 사용할 수 있습니다.'
                  }
                >
                  {vocabExportBusy === 'textbook' ? '모으는 중…' : '교재 전체 엑셀'}
                </button>
              </div>
            </div>
            {state.showVocabulary !== false && (
              <>
                <p className="text-[11px] text-slate-500">
                  지문 단어 수 약{' '}
                  <span className="text-slate-300 tabular-nums">
                    {state.sentences.reduce((n, s) => n + s.split(/\s+/).filter(Boolean).length, 0)}
                  </span>
                  개 · 단어장{' '}
                  <span className="text-slate-300 tabular-nums">{state.vocabularyList?.length ?? 0}</span>개
                </p>
                <div className="overflow-x-auto rounded-lg border border-slate-700">
                  <button
                    type="button"
                    onClick={() => setVocabShowInputAt((v) => (v === 0 ? null : 0))}
                    className="w-full py-1 text-[10px] text-teal-500/90 hover:bg-slate-800/80 border-b border-slate-700"
                  >
                    {vocabShowInputAt === 0 ? '— 취소 —' : '+ 맨 앞에 행 추가'}
                  </button>
                  {vocabShowInputAt === 0 && (
                    <div className="grid grid-cols-[minmax(0,2.5rem)_minmax(0,6rem)_minmax(0,4rem)_minmax(0,5rem)_minmax(0,3.25rem)_1fr_minmax(0,5rem)_minmax(0,5rem)_minmax(0,5rem)_auto] gap-1 p-2 bg-teal-950/40 border-b border-slate-700 text-[11px] min-w-[56rem]">
                      <span className="text-slate-500 self-center">새</span>
                      <input
                        value={vocabNewWord.word}
                        onChange={(e) => setVocabNewWord((p) => ({ ...p, word: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmVocabInlineAdd();
                          if (e.key === 'Escape') {
                            setVocabShowInputAt(null);
                            setVocabNewWord({
                              word: '',
                              wordType: 'word',
                              partOfSpeech: 'n.',
                              cefr: '',
                              meaning: '',
                              synonym: '',
                              antonym: '',
                              opposite: '',
                            });
                          }
                        }}
                        placeholder="영단어"
                        className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                      />
                      <select
                        value={vocabNewWord.wordType}
                        onChange={(e) => setVocabNewWord((p) => ({ ...p, wordType: e.target.value }))}
                        className="bg-slate-950 border border-slate-600 rounded text-slate-300"
                      >
                        {VOCABULARY_WORD_TYPE_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {VOCABULARY_WORD_TYPE_LABELS[o] ?? o}
                          </option>
                        ))}
                      </select>
                      <select
                        value={vocabNewWord.partOfSpeech}
                        onChange={(e) => setVocabNewWord((p) => ({ ...p, partOfSpeech: e.target.value }))}
                        className="bg-slate-950 border border-slate-600 rounded text-slate-300 text-[10px]"
                      >
                        {VOCABULARY_POS_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                      <select
                        value={vocabNewWord.cefr}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === CEFR_SELECT_AI_VALUE) {
                            void runCefrAiForVocabNewWord({
                              word: vocabNewWord.word,
                              meaning: vocabNewWord.meaning,
                              partOfSpeech: vocabNewWord.partOfSpeech,
                            });
                            return;
                          }
                          setVocabNewWord((p) => ({ ...p, cefr: v }));
                        }}
                        disabled={!!busy || cefrAiRowIndex !== null || cefrAiInline}
                        className="bg-slate-950 border border-slate-600 rounded text-slate-300 text-[10px]"
                        title="미지정·등급 또는 ✨ AI로 CEFR (문맥 기준, 새 행은 영단어 입력 후)"
                      >
                        <option value="">미지정</option>
                        <option value={CEFR_SELECT_AI_VALUE}>✨ AI로 CEFR</option>
                        {VOCABULARY_CEFR_OPTIONS.filter((o) => o !== '').map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                      <input
                        value={vocabNewWord.meaning}
                        onChange={(e) => setVocabNewWord((p) => ({ ...p, meaning: e.target.value }))}
                        placeholder="한글 뜻(·부가)"
                        className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                      />
                      <input
                        value={vocabNewWord.synonym}
                        onChange={(e) => setVocabNewWord((p) => ({ ...p, synonym: e.target.value }))}
                        placeholder="영어 유의어"
                        className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                      />
                      <input
                        value={vocabNewWord.antonym}
                        onChange={(e) => setVocabNewWord((p) => ({ ...p, antonym: e.target.value }))}
                        placeholder="영어 반의어"
                        className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                      />
                      <input
                        value={vocabNewWord.opposite}
                        onChange={(e) => setVocabNewWord((p) => ({ ...p, opposite: e.target.value }))}
                        placeholder="기타"
                        className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                      />
                      <div className="flex gap-1 self-center">
                        <button
                          type="button"
                          onClick={confirmVocabInlineAdd}
                          className="px-2 py-0.5 rounded bg-teal-700 text-white"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setVocabShowInputAt(null);
                            setVocabNewWord({
                              word: '',
                              wordType: 'word',
                              partOfSpeech: 'n.',
                              cefr: '',
                              meaning: '',
                              synonym: '',
                              antonym: '',
                              opposite: '',
                            });
                          }}
                          className="px-2 py-0.5 rounded bg-slate-700 text-slate-300"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-[minmax(0,2.5rem)_minmax(0,6rem)_minmax(0,4rem)_minmax(0,5rem)_minmax(0,3.25rem)_1fr_minmax(0,5rem)_minmax(0,5rem)_minmax(0,5rem)_minmax(0,6rem)_auto] gap-1 px-2 py-1.5 bg-slate-800/90 text-[10px] text-slate-400 font-medium border-b border-slate-700 min-w-[62rem]">
                    <span>#</span>
                    <span>단어</span>
                    <span>유형</span>
                    <span>품사</span>
                    <span title="목록에서 「✨ AI로 CEFR」 선택 시 AI가 문맥 기준으로 등급 제안">CEFR</span>
                    <span>뜻(·부가)</span>
                    <span>영어 유의어</span>
                    <span>영어 반의어</span>
                    <span>기타</span>
                    <span>위치</span>
                    <span />
                  </div>
                  {sortedVocabulary.map((item, displayIdx) => {
                    const oi = state.vocabularyList.indexOf(item);
                    const gapAfter = displayIdx + 1;
                    const posLabel =
                      (item.positions || [])
                        .map((p) => `${p.sentence + 1}-${p.position + 1}`)
                        .join(', ') || '—';
                    return (
                      <div key={`vr-${oi}-${displayIdx}`} className="border-b border-slate-800">
                        <div className="grid grid-cols-[minmax(0,2.5rem)_minmax(0,6rem)_minmax(0,4rem)_minmax(0,5rem)_minmax(0,3.25rem)_1fr_minmax(0,5rem)_minmax(0,5rem)_minmax(0,5rem)_minmax(0,6rem)_auto] gap-1 p-2 items-start text-[11px] min-w-[62rem]">
                          <span className="text-slate-500 tabular-nums pt-1">{displayIdx + 1}</span>
                          <input
                            value={item.word}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateState((s) => {
                                const list = [...(s.vocabularyList || [])];
                                if (list[oi]) list[oi] = { ...list[oi], word: v };
                                return { ...s, vocabularyList: list };
                              });
                            }}
                            className="bg-transparent border border-slate-700 rounded px-1 py-1 text-teal-100 font-medium w-full"
                          />
                          <select
                            value={item.wordType || 'word'}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateState((s) => {
                                const list = [...(s.vocabularyList || [])];
                                if (list[oi]) list[oi] = { ...list[oi], wordType: v };
                                return { ...s, vocabularyList: list };
                              });
                            }}
                            className="bg-slate-950 border border-slate-600 rounded text-slate-300 w-full text-[10px]"
                          >
                            {VOCABULARY_WORD_TYPE_OPTIONS.map((o) => (
                              <option key={o} value={o}>
                                {VOCABULARY_WORD_TYPE_LABELS[o] ?? o}
                              </option>
                            ))}
                          </select>
                          <select
                            value={item.partOfSpeech || 'n.'}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateState((s) => {
                                const list = [...(s.vocabularyList || [])];
                                if (list[oi]) list[oi] = { ...list[oi], partOfSpeech: v };
                                return { ...s, vocabularyList: list };
                              });
                            }}
                            className="bg-slate-950 border border-slate-600 rounded text-slate-300 w-full text-[10px]"
                          >
                            {VOCABULARY_POS_OPTIONS.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                          <select
                            value={item.cefr ?? ''}
                            disabled={!!busy || cefrAiRowIndex === oi || cefrAiInline}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === CEFR_SELECT_AI_VALUE) {
                                void runCefrAiForRow(oi);
                                return;
                              }
                              updateState((s) => {
                                const list = [...(s.vocabularyList || [])];
                                if (list[oi]) list[oi] = { ...list[oi], cefr: v };
                                return { ...s, vocabularyList: list };
                              });
                            }}
                            className="bg-slate-950 border border-slate-600 rounded text-slate-300 w-full text-[10px]"
                            title="CEFR — 목록에서 「✨ AI로 CEFR」을 고르면 문맥·뜻 기준 자동 채움"
                          >
                            <option value="">미지정</option>
                            <option value={CEFR_SELECT_AI_VALUE}>✨ AI로 CEFR</option>
                            {VOCABULARY_CEFR_OPTIONS.filter((o) => o !== '').map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                          <input
                            value={item.meaning || ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateState((s) => {
                                const list = [...(s.vocabularyList || [])];
                                if (list[oi]) list[oi] = { ...list[oi], meaning: v };
                                return { ...s, vocabularyList: list };
                              });
                            }}
                            placeholder="한글 뜻(·부가)"
                            className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200 w-full"
                          />
                          <input
                            value={item.synonym || ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateState((s) => {
                                const list = [...(s.vocabularyList || [])];
                                if (list[oi]) list[oi] = { ...list[oi], synonym: v };
                                return { ...s, vocabularyList: list };
                              });
                            }}
                            placeholder="영어 유의어"
                            className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200 w-full"
                          />
                          <input
                            value={item.antonym || ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateState((s) => {
                                const list = [...(s.vocabularyList || [])];
                                if (list[oi]) list[oi] = { ...list[oi], antonym: v };
                                return { ...s, vocabularyList: list };
                              });
                            }}
                            placeholder="영어 반의어"
                            className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200 w-full"
                          />
                          <input
                            value={item.opposite || ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateState((s) => {
                                const list = [...(s.vocabularyList || [])];
                                if (list[oi]) list[oi] = { ...list[oi], opposite: v };
                                return { ...s, vocabularyList: list };
                              });
                            }}
                            placeholder="기타"
                            className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200 w-full"
                          />
                          <span className="text-slate-500 text-[10px] pt-1 font-mono leading-tight">{posLabel}</span>
                          <button
                            type="button"
                            onClick={() =>
                              updateState((s) => ({
                                ...s,
                                vocabularyList: (s.vocabularyList || []).filter((_, i) => i !== oi),
                              }))
                            }
                            className="text-red-400 hover:text-red-300 text-xs pt-1"
                          >
                            삭제
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setVocabShowInputAt((cur) => (cur === gapAfter ? null : gapAfter))
                          }
                          className="w-full py-0.5 text-[10px] text-teal-500/80 hover:bg-slate-800/60"
                        >
                          {vocabShowInputAt === gapAfter ? '— 취소 —' : '+ 여기에 행 추가'}
                        </button>
                        {vocabShowInputAt === gapAfter && (
                          <div className="grid grid-cols-[minmax(0,2.5rem)_minmax(0,6rem)_minmax(0,4rem)_minmax(0,5rem)_minmax(0,3.25rem)_1fr_minmax(0,5rem)_minmax(0,5rem)_minmax(0,5rem)_auto] gap-1 p-2 bg-teal-950/30 border-b border-slate-700 text-[11px] min-w-[56rem]">
                            <span className="text-slate-500 self-center">새</span>
                            <input
                              value={vocabNewWord.word}
                              onChange={(e) => setVocabNewWord((p) => ({ ...p, word: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') confirmVocabInlineAdd();
                                if (e.key === 'Escape') {
                                  setVocabShowInputAt(null);
                                  setVocabNewWord({
                                    word: '',
                                    wordType: 'word',
                                    partOfSpeech: 'n.',
                                    cefr: '',
                                    meaning: '',
                                    synonym: '',
                                    antonym: '',
                                    opposite: '',
                                  });
                                }
                              }}
                              placeholder="영단어"
                              className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                            />
                            <select
                              value={vocabNewWord.wordType}
                              onChange={(e) => setVocabNewWord((p) => ({ ...p, wordType: e.target.value }))}
                              className="bg-slate-950 border border-slate-600 rounded text-slate-300"
                            >
                              {VOCABULARY_WORD_TYPE_OPTIONS.map((o) => (
                                <option key={o} value={o}>
                                  {VOCABULARY_WORD_TYPE_LABELS[o] ?? o}
                                </option>
                              ))}
                            </select>
                            <select
                              value={vocabNewWord.partOfSpeech}
                              onChange={(e) => setVocabNewWord((p) => ({ ...p, partOfSpeech: e.target.value }))}
                              className="bg-slate-950 border border-slate-600 rounded text-slate-300 text-[10px]"
                            >
                              {VOCABULARY_POS_OPTIONS.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                            <select
                              value={vocabNewWord.cefr}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === CEFR_SELECT_AI_VALUE) {
                                  void runCefrAiForVocabNewWord({
                                    word: vocabNewWord.word,
                                    meaning: vocabNewWord.meaning,
                                    partOfSpeech: vocabNewWord.partOfSpeech,
                                  });
                                  return;
                                }
                                setVocabNewWord((p) => ({ ...p, cefr: v }));
                              }}
                              disabled={!!busy || cefrAiRowIndex !== null || cefrAiInline}
                              className="bg-slate-950 border border-slate-600 rounded text-slate-300 text-[10px]"
                              title="미지정·등급 또는 ✨ AI로 CEFR (문맥 기준, 새 행은 영단어 입력 후)"
                            >
                              <option value="">미지정</option>
                              <option value={CEFR_SELECT_AI_VALUE}>✨ AI로 CEFR</option>
                              {VOCABULARY_CEFR_OPTIONS.filter((o) => o !== '').map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                            <input
                              value={vocabNewWord.meaning}
                              onChange={(e) => setVocabNewWord((p) => ({ ...p, meaning: e.target.value }))}
                              placeholder="한글 뜻(·부가)"
                              className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                            />
                            <input
                              value={vocabNewWord.synonym}
                              onChange={(e) => setVocabNewWord((p) => ({ ...p, synonym: e.target.value }))}
                              placeholder="영어 유의어"
                              className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                            />
                            <input
                              value={vocabNewWord.antonym}
                              onChange={(e) => setVocabNewWord((p) => ({ ...p, antonym: e.target.value }))}
                              placeholder="영어 반의어"
                              className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                            />
                            <input
                              value={vocabNewWord.opposite}
                              onChange={(e) => setVocabNewWord((p) => ({ ...p, opposite: e.target.value }))}
                              placeholder="기타"
                              className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                            />
                            <div className="flex gap-1 self-center">
                              <button
                                type="button"
                                onClick={confirmVocabInlineAdd}
                                className="px-2 py-0.5 rounded bg-teal-700 text-white"
                              >
                                ✓
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setVocabShowInputAt(null);
                                  setVocabNewWord({
                                    word: '',
                                    wordType: 'word',
                                    partOfSpeech: 'n.',
                                    cefr: '',
                                    meaning: '',
                                    synonym: '',
                                    antonym: '',
                                    opposite: '',
                                  });
                                }}
                                className="px-2 py-0.5 rounded bg-slate-700 text-slate-300"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      setVocabShowInputAt((cur) =>
                        cur === sortedVocabulary.length ? null : sortedVocabulary.length
                      )
                    }
                    className="w-full py-1 text-[10px] text-teal-500/90 hover:bg-slate-800/80"
                  >
                    {vocabShowInputAt === sortedVocabulary.length ? '— 취소 —' : '+ 맨 끝에 행 추가'}
                  </button>
                  {vocabShowInputAt === sortedVocabulary.length && (
                    <div className="grid grid-cols-[minmax(0,2.5rem)_minmax(0,6rem)_minmax(0,4rem)_minmax(0,5rem)_minmax(0,3.25rem)_1fr_minmax(0,5rem)_minmax(0,5rem)_minmax(0,5rem)_auto] gap-1 p-2 bg-teal-950/40 text-[11px] min-w-[56rem]">
                      <span className="text-slate-500 self-center">새</span>
                      <input
                        value={vocabNewWord.word}
                        onChange={(e) => setVocabNewWord((p) => ({ ...p, word: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmVocabInlineAdd();
                          if (e.key === 'Escape') {
                            setVocabShowInputAt(null);
                            setVocabNewWord({
                              word: '',
                              wordType: 'word',
                              partOfSpeech: 'n.',
                              cefr: '',
                              meaning: '',
                              synonym: '',
                              antonym: '',
                              opposite: '',
                            });
                          }
                        }}
                        placeholder="영단어"
                        className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                      />
                      <select
                        value={vocabNewWord.wordType}
                        onChange={(e) => setVocabNewWord((p) => ({ ...p, wordType: e.target.value }))}
                        className="bg-slate-950 border border-slate-600 rounded text-slate-300"
                      >
                        {VOCABULARY_WORD_TYPE_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {VOCABULARY_WORD_TYPE_LABELS[o] ?? o}
                          </option>
                        ))}
                      </select>
                      <select
                        value={vocabNewWord.partOfSpeech}
                        onChange={(e) => setVocabNewWord((p) => ({ ...p, partOfSpeech: e.target.value }))}
                        className="bg-slate-950 border border-slate-600 rounded text-slate-300 text-[10px]"
                      >
                        {VOCABULARY_POS_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                      <select
                        value={vocabNewWord.cefr}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === CEFR_SELECT_AI_VALUE) {
                            void runCefrAiForVocabNewWord({
                              word: vocabNewWord.word,
                              meaning: vocabNewWord.meaning,
                              partOfSpeech: vocabNewWord.partOfSpeech,
                            });
                            return;
                          }
                          setVocabNewWord((p) => ({ ...p, cefr: v }));
                        }}
                        disabled={!!busy || cefrAiRowIndex !== null || cefrAiInline}
                        className="bg-slate-950 border border-slate-600 rounded text-slate-300 text-[10px]"
                        title="미지정·등급 또는 ✨ AI로 CEFR (문맥 기준, 새 행은 영단어 입력 후)"
                      >
                        <option value="">미지정</option>
                        <option value={CEFR_SELECT_AI_VALUE}>✨ AI로 CEFR</option>
                        {VOCABULARY_CEFR_OPTIONS.filter((o) => o !== '').map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                      <input
                        value={vocabNewWord.meaning}
                        onChange={(e) => setVocabNewWord((p) => ({ ...p, meaning: e.target.value }))}
                        placeholder="한글 뜻(·부가)"
                        className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                      />
                      <input
                        value={vocabNewWord.synonym}
                        onChange={(e) => setVocabNewWord((p) => ({ ...p, synonym: e.target.value }))}
                        placeholder="영어 유의어"
                        className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                      />
                      <input
                        value={vocabNewWord.antonym}
                        onChange={(e) => setVocabNewWord((p) => ({ ...p, antonym: e.target.value }))}
                        placeholder="영어 반의어"
                        className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                      />
                      <input
                        value={vocabNewWord.opposite}
                        onChange={(e) => setVocabNewWord((p) => ({ ...p, opposite: e.target.value }))}
                        placeholder="기타"
                        className="bg-slate-950 border border-slate-600 rounded px-1 py-1 text-slate-200"
                      />
                      <div className="flex gap-1 self-center">
                        <button
                          type="button"
                          onClick={confirmVocabInlineAdd}
                          className="px-2 py-0.5 rounded bg-teal-700 text-white"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setVocabShowInputAt(null);
                            setVocabNewWord({
                              word: '',
                              wordType: 'word',
                              partOfSpeech: 'n.',
                              cefr: '',
                              meaning: '',
                              synonym: '',
                              antonym: '',
                              opposite: '',
                            });
                          }}
                          className="px-2 py-0.5 rounded bg-slate-700 text-slate-300"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {state.sentences.map((sentence, si) => {
          const topicSel = state.topicHighlightedSentences?.includes(si) ?? false;
          const essaySel = state.essayHighlightedSentences?.includes(si) ?? false;
          const bothSel = topicSel && essaySel;
          return (
          <div
            key={si}
            onClick={(e) => {
              if (viewMode !== 'topicSentence' && viewMode !== 'essaySentence') return;
              const el = e.target as HTMLElement;
              if (el.closest('button')) return;
              toggleSentence(viewMode === 'topicSentence' ? 'topic' : 'essay', si);
            }}
            className={`rounded-lg border p-3 ${
              bothSel
                ? 'border-slate-500/65 bg-gradient-to-br from-amber-950/50 via-fuchsia-950/28 to-pink-950/50 shadow-[0_0_0_1px_rgba(251,191,36,0.45),0_0_0_2px_rgba(236,72,153,0.28),inset_0_1px_24px_rgba(251,191,36,0.08),inset_0_-1px_24px_rgba(244,114,182,0.07)]'
                : topicSel
                  ? 'border-amber-400 ring-1 ring-amber-500/40 bg-amber-950/25'
                  : essaySel
                    ? 'border-pink-400 ring-1 ring-pink-500/40 bg-pink-950/25'
                    : 'border-slate-700 bg-slate-800/40'
            } ${
              viewMode === 'topicSentence' || viewMode === 'essaySentence'
                ? 'cursor-pointer select-none hover:border-slate-500/90'
                : ''
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-2">
              <span
                className={`text-xs tabular-nums ${
                  bothSel
                    ? 'font-semibold bg-gradient-to-r from-amber-200 via-fuchsia-200 to-pink-200 bg-clip-text text-transparent'
                    : viewMode === 'topicSentence' && topicSel
                      ? 'text-amber-300/90 font-medium'
                      : viewMode === 'essaySentence' && essaySel
                        ? 'text-pink-300/90 font-medium'
                        : topicSel
                          ? 'text-amber-300/80 font-medium'
                          : essaySel
                            ? 'text-pink-300/80 font-medium'
                            : 'text-slate-500'
                }`}
              >
                문장 {si + 1}
              </span>
              {bothSel && (
                <span className="text-[10px] font-medium tracking-tight">
                  <span className="text-amber-400/95">주제</span>
                  <span className="text-slate-500 mx-1">+</span>
                  <span className="text-pink-400/95">서술형</span>
                </span>
              )}
            </div>
            <p className="text-slate-200 leading-relaxed">
              {(sentence.split(/\s+/).filter(Boolean) || []).map((w, wi) => {
                const vk = wordKey(si, wi);
                const vocabSup =
                  viewMode === 'vocabulary' ? vocabularyDisplayByPosition.get(vk) : undefined;
                return (
                <span key={wi} className="inline-flex flex-wrap items-end gap-x-0">
                  <span className="inline-flex flex-col items-center align-bottom mr-0.5">
                    <span
                      className="text-[7px] leading-none font-mono tabular-nums text-slate-500/75 select-none mb-px"
                      title={`저장·API: sentence=${si}, position=${wi} (0부터) · 화면 표기 ${si + 1}:${wi + 1}`}
                    >
                      {si + 1}:{wi + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => onWordClick(si, wi)}
                      className="inline px-0.5 rounded hover:ring-1 hover:ring-slate-500 align-baseline"
                      style={wordStyle(si, wi, w)}
                    >
                      {w}
                      {vocabSup != null && (
                        <sup className="ml-0.5 text-[0.65em] font-semibold text-teal-300/95 tabular-nums align-super">
                          {vocabSup}
                        </sup>
                      )}
                    </button>
                  </span>
                  {(state.sentenceBreaks?.[si] || []).includes(wi) && (
                    <span className="text-slate-500 font-bold mx-0.5 self-end pb-0.5">/</span>
                  )}{' '}
                </span>
                );
              })}
            </p>
            {state.koreanSentences[si] && (
              <p className="text-slate-400 text-sm mt-2">{state.koreanSentences[si]}</p>
            )}
            {viewMode !== 'svoc' &&
              (state.grammarTags || []).some((t) => t.sentenceIndex === si) && (
              <ul className="mt-2 space-y-2">
                {(state.grammarTags || [])
                  .map((t, gi) => ({ t, gi }))
                  .filter((x) => x.t.sentenceIndex === si)
                  .map(({ t, gi }) => (
                    <li
                      key={gi}
                      className="rounded-lg border border-indigo-900/60 bg-indigo-950/25 p-2 text-[11px] text-indigo-100/95"
                    >
                      <div className="flex flex-wrap items-start gap-2">
                        <input
                          value={t.tagName}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateState((s) => {
                              const list = [...(s.grammarTags || [])];
                              if (!list[gi]) return s;
                              list[gi] = { ...list[gi], tagName: v };
                              return { ...s, grammarTags: list };
                            });
                          }}
                          className="min-w-[7rem] flex-1 bg-slate-950 border border-indigo-800/70 rounded px-2 py-1 text-indigo-100"
                          aria-label="태그 이름"
                        />
                        <input
                          value={t.selectedText}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateState((s) => {
                              const list = [...(s.grammarTags || [])];
                              if (!list[gi]) return s;
                              list[gi] = { ...list[gi], selectedText: v };
                              return { ...s, grammarTags: list };
                            });
                          }}
                          onBlur={(e) => {
                            const trimmed = e.target.value.trim();
                            const sent = state.sentences[si] || '';
                            if (!trimmed || !sent) return;
                            const idx = findWordIndices(sent, trimmed);
                            if (idx.startWordIndex < 0) return;
                            updateState((s) => {
                              const list = [...(s.grammarTags || [])];
                              const cur = list[gi];
                              if (!cur || cur.sentenceIndex !== si) return s;
                              list[gi] = {
                                ...cur,
                                selectedText: trimmed,
                                startWordIndex: idx.startWordIndex,
                                endWordIndex: idx.endWordIndex,
                              };
                              return { ...s, grammarTags: list };
                            });
                          }}
                          className="min-w-[10rem] flex-[2] bg-slate-950 border border-indigo-800/70 rounded px-2 py-1 text-slate-200"
                          aria-label="태그 구절"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateState((s) => ({
                              ...s,
                              grammarTags: (s.grammarTags || []).filter((_, i) => i !== gi),
                            }))
                          }
                          className="shrink-0 rounded-md border border-red-900/60 bg-red-950/40 px-2 py-1 text-[10px] text-red-300 hover:bg-red-950/70"
                        >
                          삭제
                        </button>
                      </div>
                      <input
                        value={t.explanation ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateState((s) => {
                            const list = [...(s.grammarTags || [])];
                            if (!list[gi]) return s;
                            list[gi] = { ...list[gi], explanation: v || undefined };
                            return { ...s, grammarTags: list };
                          });
                        }}
                        placeholder="설명(선택)"
                        className="mt-1.5 w-full bg-slate-950/80 border border-indigo-900/50 rounded px-2 py-1 text-[10px] text-slate-400 placeholder:text-slate-600"
                      />
                    </li>
                  ))}
              </ul>
            )}
          </div>
          );
        })}

        {viewMode !== 'vocabulary' && (state.vocabularyList || []).length > 0 && (
          <div className="border border-slate-700 rounded-lg p-3">
            <p className="text-sm font-bold text-slate-300 mb-2">단어장 요약</p>
            <ul className="text-sm space-y-1">
              {state.vocabularyList.map((v, i) => {
                const lv = v.cefr && String(v.cefr).trim();
                return (
                  <li key={i} className="text-slate-400">
                    <strong className="text-white">{v.word}</strong>
                    {lv ? (
                      <span className="text-teal-500/90 text-xs ml-1">({lv})</span>
                    ) : null}{' '}
                    — {v.meaning || '(뜻 입력)'}
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] text-slate-500 mt-2">전체 편집은 상단 「단어장」 모드에서 할 수 있습니다.</p>
          </div>
        )}
        </div>

        {viewMode === 'svoc' && (
          <div className="w-full lg:w-56 shrink-0 lg:self-start lg:sticky lg:top-24 lg:z-[25]">
            <div className="rounded-xl border border-amber-900/50 bg-amber-950/40 p-2 shadow-xl shadow-black/30 space-y-2 max-h-[min(70vh,calc(100vh-7rem))] overflow-y-auto backdrop-blur-md supports-[backdrop-filter]:bg-amber-950/30">
              <p className="text-[10px] font-semibold text-amber-200/95 tracking-wide">SVOC 요소</p>
              <p className="text-[9px] leading-snug text-amber-200/65 rounded-md bg-amber-950/40 border border-amber-900/40 px-2 py-1.5">
                <span className="font-medium text-amber-100/90">I&apos;m, you&apos;re, don&apos;t</span> 등은 공백 기준으로{' '}
                <span className="text-amber-100/90">한 덩어리</span>라 S와 V를 단어 단위로 나누어 칠 수 없습니다. 보통은{' '}
                <span className="text-sky-300/90">수업 관례 하나</span>로 통일합니다. 예:{' '}
                <span className="text-slate-200">① V(동사)에만 지정</span>하고 주어 I는 해설로 보완 ·{' '}
                <span className="text-slate-200">② S(주어)에만 지정</span>하고 &apos;m은 be의 일부로 설명. 둘 중 하나만
                칠하면 됩니다.
              </p>
              <div className="flex flex-col gap-1">
                {SVOC_COMPONENTS.map((c) => {
                  const tone: Record<string, string> = {
                    yellow: 'from-amber-600/90 to-amber-700/90',
                    blue: 'from-blue-600/90 to-blue-800/90',
                    emerald: 'from-emerald-600/90 to-emerald-800/90',
                    green: 'from-green-600/90 to-green-800/90',
                    purple: 'from-purple-600/90 to-purple-800/90',
                    pink: 'from-pink-600/90 to-pink-800/90',
                  };
                  const active = svocPart === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSvocPart((p) => (p === c.id ? null : c.id));
                        setPending(null);
                        setMsg(null);
                      }}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-medium transition ${
                        active
                          ? `bg-gradient-to-r ${tone[c.color] || 'from-amber-700 to-amber-900'} text-white shadow-sm ring-1 ring-amber-200/40`
                          : 'bg-slate-900/90 text-slate-300 border border-slate-600 hover:bg-slate-800'
                      }`}
                    >
                      <span
                        className={`flex h-5 min-w-5 items-center justify-center rounded text-[10px] font-bold ${
                          active ? 'bg-white/25 text-white' : 'bg-slate-700 text-slate-200'
                        }`}
                      >
                        {c.key}
                      </span>
                      <span>
                        {c.short} {c.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] leading-snug text-amber-100/75">
                {!svocPart
                  ? '요소를 선택한 뒤 지문에서 단어를 찍으세요. 숫자 1~6으로 요소를 고를 수 있습니다.'
                  : pending
                    ? `${SVOC_COMPONENTS.find((x) => x.id === svocPart)?.short ?? ''} — 끝 단어를 클릭하세요.`
                    : `${SVOC_COMPONENTS.find((x) => x.id === svocPart)?.short ?? ''} — 시작 단어를 클릭하세요. (이미 칠한 구간을 누르면 삭제)`}
              </p>
              <div className="flex flex-col gap-1.5 pt-1 border-t border-amber-900/40">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPending(null);
                      setMsg('범위 선택을 취소했습니다.');
                    }}
                    disabled={!pending}
                    className="min-w-0 flex-1 rounded-md border border-slate-500 bg-slate-900 py-1.5 px-2 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    범위 선택 취소
                  </button>
                  <kbd className="hidden sm:inline-flex shrink-0 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-400 font-mono">
                    Alt+C
                  </kbd>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void flushAnalysisSave()}
                    className="min-w-0 flex-1 rounded-md bg-amber-700/90 py-1.5 px-2 text-[11px] font-medium text-white hover:bg-amber-600"
                  >
                    지금 저장(확인)
                  </button>
                  <kbd className="hidden sm:inline-flex shrink-0 rounded border border-amber-800/80 bg-amber-950 px-1.5 py-0.5 text-[9px] text-amber-200/90 font-mono">
                    Alt+S
                  </kbd>
                </div>
                <p className="text-[9px] text-amber-200/50">
                  Esc — 요소·범위 선택 모두 취소 · 1~6 — S/V/Oi/Od/Cs/Co
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {mongoPanelOpen && (
        <aside
          className="w-full lg:w-[min(100%,24rem)] shrink-0 flex flex-col rounded-xl border border-slate-600 bg-slate-900/95 shadow-lg max-h-[min(70vh,36rem)] lg:max-h-[calc(100vh-5rem)] lg:sticky lg:top-4 z-20"
          aria-label="MongoDB passage_analyses JSON"
        >
          <div className="flex flex-wrap items-center gap-1 px-2 py-2 border-b border-slate-700 bg-slate-800/90 shrink-0">
            <span className="text-[10px] font-mono text-emerald-400/90 truncate flex-1 min-w-0">
              gomijoshua · passage_analyses
            </span>
            <button
              type="button"
              onClick={() => void refreshMongoDocumentJson()}
              disabled={mongoPanelLoading}
              className="text-[10px] px-2 py-1 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:opacity-50"
            >
              새로고침
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  if (mongoPanelJson) {
                    await navigator.clipboard.writeText(mongoPanelJson);
                    setMsg('JSON을 클립보드에 복사했습니다.');
                  }
                } catch {
                  setMsg('복사에 실패했습니다.');
                }
              }}
              disabled={!mongoPanelJson}
              className="text-[10px] px-2 py-1 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:opacity-40"
            >
              복사
            </button>
            <button
              type="button"
              onClick={() => setMongoPanelOpen(false)}
              className="text-[10px] px-2 py-1 rounded border border-slate-600 text-slate-400 hover:bg-slate-800"
            >
              닫기
            </button>
          </div>
          <pre className="flex-1 overflow-auto p-2 text-[10px] leading-relaxed font-mono text-slate-300 whitespace-pre-wrap break-words m-0 min-h-[12rem]">
            {mongoPanelLoading
              ? '불러오는 중…'
              : mongoPanelError
                ? mongoPanelError
                : mongoPanelJson ?? '—'}
          </pre>
        </aside>
      )}
      </div>
      <VocabularyStopWordsModal
        open={showStopWordsModal}
        onClose={() => setShowStopWordsModal(false)}
        customStopWords={state.vocabularyCustomStopWords ?? EMPTY_VOCAB_CUSTOM_STOPWORDS}
        onSave={(words) => updateState((s) => ({ ...s, vocabularyCustomStopWords: words }))}
      />
    </div>
  );
}
