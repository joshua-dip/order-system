/**
 * 클래스키트 「수업 화면」 — 지문 + 지문분석기 결과를 수업 화면에 쓰기 좋은 모양으로.
 *
 * 문장 인덱스는 분석기(passage_analyses.passageStates.main)가 저장한 sentences 기준이다.
 * 분석이 있으면 그 sentences/koreanSentences 를 그대로 쓰고(인덱스 정렬 보장),
 * 없으면 지문 content 에서 나눈 문장을 쓴다.
 */
import type { Db, ObjectId } from 'mongodb';
import { deriveSentencesFromPassageContent } from '@/lib/passage-analyzer-passages';
import {
  passageAnalysisFileNameForPassageId,
  type VocabularyEntry,
  type GrammarPointEntry,
  type SvocSentenceData,
} from '@/lib/passage-analyzer-types';
import { alignSvocDataToSentences, normalizeSvocDataToWordIndices } from '@/lib/svoc-index-normalize';
import { comprehensiveRows } from '@/lib/analysis-sheet-html';
import { vocabularyBySentence, type LiveVocab } from '@/lib/passage-live-chunks';

export { chunkSentence, vocabularyBySentence, type LiveVocab } from '@/lib/passage-live-chunks';

export type LivePassagePayload = {
  passage: { id: string; textbook: string; chapter: string; number: string; sourceKey: string };
  sentences: string[];
  koreanSentences: string[];
  /** 분석기 데이터가 있는지 — 없으면 화면이 문장·해석·듣기만 보여 준다 */
  hasAnalysis: boolean;
  /** 문장 idx → 끊어읽기 위치(단어 i 뒤에 /) */
  breaks: Record<number, number[]>;
  svoc: Record<number, SvocSentenceData[]>;
  grammarPoints: Record<number, GrammarPointEntry[]>;
  vocabulary: LiveVocab[];
  topicSentences: number[];
  /** 종합분석 — [제목, 내용] (주제·요지·요약·글의 흐름·출제 포인트 등) */
  overview: [string, string][];
};

/** 분석기 main 중 수업 화면이 읽는 필드 */
type LiveMainState = {
  sentences?: unknown[];
  koreanSentences?: unknown[];
  sentenceBreaks?: unknown;
  svocData?: unknown;
  grammarPointsBySentence?: unknown;
  vocabularyList?: VocabularyEntry[];
  topicHighlightedSentences?: unknown[];
  analysisResults?: unknown;
};

type PassageDoc = {
  _id: ObjectId;
  textbook?: unknown;
  chapter?: unknown;
  number?: unknown;
  source_key?: unknown;
  content?: Record<string, unknown>;
};

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

function numKeyed<T>(raw: unknown, keep: (v: unknown) => v is T): Record<number, T> {
  const out: Record<number, T> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(k);
    if (Number.isInteger(n) && n >= 0 && keep(v)) out[n] = v;
  }
  return out;
}

export async function loadPassageLive(db: Db, doc: PassageDoc): Promise<LivePassagePayload> {
  const id = String(doc._id);
  const derived = deriveSentencesFromPassageContent(doc.content);
  const analysis = (await db.collection('passage_analyses').findOne(
    { fileName: passageAnalysisFileNameForPassageId(id) },
    {
      projection: {
        'passageStates.main.sentences': 1,
        'passageStates.main.koreanSentences': 1,
        'passageStates.main.sentenceBreaks': 1,
        'passageStates.main.svocData': 1,
        'passageStates.main.grammarPointsBySentence': 1,
        'passageStates.main.vocabularyList': 1,
        'passageStates.main.topicHighlightedSentences': 1,
        'passageStates.main.analysisResults': 1,
      },
    },
  )) as { passageStates?: { main?: LiveMainState } } | null;
  const main = analysis?.passageStates?.main;

  const aSent: string[] = Array.isArray(main?.sentences) ? main!.sentences.map(str).filter(Boolean) : [];
  const useAnalysis = aSent.length > 0;
  const sentences = useAnalysis ? aSent : derived.sentences;
  const koSrc: string[] = useAnalysis && Array.isArray(main?.koreanSentences) ? main!.koreanSentences.map(str) : [];
  const koreanSentences = sentences.map((_, i) => koSrc[i] || derived.koreanSentences[i] || '');

  const inRange = (n: number) => n < sentences.length;
  const breaks = numKeyed(main?.sentenceBreaks, (v): v is number[] => Array.isArray(v) && v.every((x) => Number.isInteger(x)));
  const grammarPoints = numKeyed(main?.grammarPointsBySentence, (v): v is GrammarPointEntry[] =>
    Array.isArray(v) && v.some((g) => g && typeof g === 'object' && str((g as GrammarPointEntry).title)));
  const svocRaw = numKeyed(main?.svocData, (v): v is SvocSentenceData | SvocSentenceData[] => !!v && typeof v === 'object');
  const svoc = alignSvocDataToSentences(sentences, normalizeSvocDataToWordIndices(sentences, svocRaw)) ?? {};

  const overview = main ? comprehensiveRows(main).rows
    .map(([k, v]) => [k, str(v)] as [string, string])
    .filter(([, v]) => v) : [];

  return {
    passage: {
      id,
      textbook: str(doc.textbook),
      chapter: str(doc.chapter),
      number: str(doc.number),
      sourceKey: str(doc.source_key),
    },
    sentences,
    koreanSentences,
    hasAnalysis: !!main,
    breaks: Object.fromEntries(Object.entries(breaks).filter(([k]) => inRange(Number(k)))),
    svoc,
    grammarPoints: Object.fromEntries(Object.entries(grammarPoints).filter(([k]) => inRange(Number(k)))),
    vocabulary: vocabularyBySentence(sentences, main?.vocabularyList),
    topicSentences: Array.isArray(main?.topicHighlightedSentences)
      ? main!.topicHighlightedSentences.filter((n: unknown): n is number => Number.isInteger(n) && inRange(n as number))
      : [],
    overview,
  };
}

export const LIVE_PASSAGE_PROJECTION = {
  textbook: 1,
  chapter: 1,
  number: 1,
  source_key: 1,
  'content.original': 1,
  'content.sentences_en': 1,
  'content.sentences_ko': 1,
} as const;
