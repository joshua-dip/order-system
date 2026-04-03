import {
  clampComprehensiveSlotCount,
  effectiveSlotOutputLang,
} from '@/lib/passage-analyzer-comprehensive';
import { DEFAULT_CONTEXT_AI_PROMPT } from '@/lib/passage-analyzer-context-ai';
import { DEFAULT_GRAMMAR_AI_PROMPT } from '@/lib/passage-analyzer-grammar-ai';
import { sentenceIndicesMatchingTopicQuote } from '@/lib/passage-analyzer-passages';
import type { PassageStateStored, SvocSentenceData, VocabularyEntry } from '@/lib/passage-analyzer-types';
import { buildVocabularyListFromSentences } from '@/lib/passage-analyzer-vocabulary-generate';
import { apiJsonErrorMessage, parseApiResponseJson } from '@/lib/parse-api-response-json';

export type PassageAnalyzerBatchPost = (
  path: string,
  body: unknown
) => Promise<Response>;

/**
 * 지문분석기 「AI 전체 자동 실행」과 동일한 API 호출 순서.
 * `post`는 절대 URL 또는 동일 오리진 경로(`/api/...`)를 처리하면 됨.
 */
export async function runPassageAnalyzerAiBatch(opts: {
  initial: PassageStateStored;
  post: PassageAnalyzerBatchPost;
  /** 단어장 자동 추출 시 sourcePassage 메타 */
  sourcePassageLabel: string;
  onProgress?: (label: string) => void;
}): Promise<{ state: PassageStateStored; warnings: string[] }> {
  const { initial, post, sourcePassageLabel, onProgress } = opts;
  let cur: PassageStateStored = { ...initial };
  const warnings: string[] = [];

  const postJson = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    const res = await post(path, body);
    const data = await parseApiResponseJson(res);
    if (!res.ok) throw new Error(apiJsonErrorMessage(data, path));
    return data;
  };

  onProgress?.('일괄: 종합분석…');
  const passage = cur.sentences.join(' ');
  const master = (cur.comprehensiveMasterPrompt || '').trim();
  const rawCp = cur.comprehensiveCustomPrompts || {};
  const customPrompts = Object.fromEntries(
    Object.entries(rawCp).filter(([, v]) => String(v ?? '').trim() !== '')
  );
  const sc = clampComprehensiveSlotCount(cur.comprehensiveSlotCount);
  const legacy = cur.comprehensiveOutputLang === 'en' ? 'en' : 'ko';
  const outputLangBySlot: Record<string, 'ko' | 'en'> = {};
  for (let i = 1; i <= sc; i++) {
    outputLangBySlot[String(i)] = effectiveSlotOutputLang(
      i,
      cur.comprehensiveOutputLangBySlot ?? null,
      legacy
    );
  }
  const compBody: Record<string, unknown> = {
    passage,
    analysisType: 'all',
    outputLang: legacy,
    outputLangBySlot,
    slotCount: sc,
  };
  if (master) compBody.customPrompt = master;
  else if (Object.keys(customPrompts).length > 0) compBody.customPrompts = customPrompts;

  const compData = await postJson('/api/admin/passage-analyzer/comprehensive-analysis', compBody);
  const quote =
    typeof compData.originalSentence === 'string' ? String(compData.originalSentence).trim() : '';
  const topicIdx = quote ? sentenceIndicesMatchingTopicQuote(cur.sentences, quote) : [];
  cur = {
    ...cur,
    analysisResults: { ...(cur.analysisResults || {}), comprehensive: compData },
    showAnalysis: true,
    ...(topicIdx.length > 0 ? { topicHighlightedSentences: topicIdx } : {}),
  };
  if (quote && topicIdx.length === 0) {
    warnings.push('원문 주제문장(②)과 일치하는 문장을 찾지 못해 주제문장 칩은 그대로입니다.');
  }

  onProgress?.('일괄: 어법·문맥…');
  const promptGrammar = (cur.grammarAiPrompt ?? '').trim() || DEFAULT_GRAMMAR_AI_PROMPT;
  const promptContext = (cur.contextAiPrompt ?? '').trim() || DEFAULT_CONTEXT_AI_PROMPT;
  const [gd, cd] = await Promise.all([
    postJson('/api/admin/passage-analyzer/suggest-grammar-words', {
      sentences: cur.sentences,
      customPrompt: promptGrammar,
    }),
    postJson('/api/admin/passage-analyzer/suggest-context-words', {
      sentences: cur.sentences,
      customPrompt: promptContext,
    }),
  ]);
  const grammarKeys = (gd.wordKeys as string[]) || [];
  const contextKeys = (cd.wordKeys as string[]) || [];
  cur = {
    ...cur,
    grammarSelectedWords: grammarKeys,
    contextSelectedWords: contextKeys,
  };

  onProgress?.('일괄: 구문·SVOC…');
  const [sd, vd] = await Promise.all([
    postJson('/api/admin/syntax-analyzer/analyze-syntax', { sentences: cur.sentences }),
    postJson('/api/admin/syntax-analyzer/analyze-svoc', { sentences: cur.sentences }),
  ]);
  const syntaxResult = sd.result as Array<{ sentenceIndex: number; phrases: unknown[] }>;
  const svocResult = vd.result as Array<Record<string, unknown>>;
  const sp: NonNullable<PassageStateStored['syntaxPhrases']> = { ...(cur.syntaxPhrases || {}) };
  for (const row of syntaxResult || []) {
    sp[row.sentenceIndex] = row.phrases as NonNullable<PassageStateStored['syntaxPhrases']>[number];
  }
  const sv = { ...(cur.svocData || {}) };
  for (const row of svocResult || []) {
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
  cur = { ...cur, syntaxPhrases: sp, svocData: sv };

  onProgress?.('일괄: 문법태그…');
  const tagData = await postJson('/api/admin/passage-analyzer/analyze-grammar-tags', {
    sentences: cur.sentences,
  });
  const tagRows = tagData.result as Array<{ sentenceIndex: number; tags: PassageStateStored['grammarTags'] }>;
  const tags = [...(cur.grammarTags || [])];
  for (const row of tagRows || []) {
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
  cur = { ...cur, grammarTags: tags };

  onProgress?.('일괄: 단어장…');
  let list = [...(cur.vocabularyList || [])];
  if (list.length === 0) {
    list = buildVocabularyListFromSentences(cur.sentences, {
      customStopWords: cur.vocabularyCustomStopWords,
      sourcePassage: sourcePassageLabel,
    });
    cur = { ...cur, vocabularyList: list, showVocabulary: true };
  }
  if (list.length === 0) {
    warnings.push('단어장 자동 추출 결과가 없어 뜻·품사 단계를 건너뜁니다.');
    warnings.push('서술형 대비·끊어읽기(/)는 웹에서 수동으로 지정하세요.');
    return { state: cur, warnings };
  }

  const vocData = await postJson('/api/admin/passage-analyzer/analyze-vocabulary', {
    vocabularyList: list,
    englishSentences: cur.sentences,
    koreanSentences: cur.koreanSentences,
  });
  cur = {
    ...cur,
    vocabularyList: (vocData.analyzedVocabulary as VocabularyEntry[] | undefined) ?? cur.vocabularyList,
  };

  warnings.push('서술형 대비·끊어읽기(/)는 웹에서 수동으로 지정하세요.');
  return { state: cur, warnings };
}
