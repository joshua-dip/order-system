/**
 * 지문분석 작업대 상단 진행 칩과 동일한 기준(자동 감지 + manualStepStatus 덮어쓰기)으로 완료 비율을 계산합니다.
 * 목록·배치 API에서만 사용 — 편집기의 progressTrackingMode === 'manual' 전체 모드와는 다를 수 있음.
 */

export const PASSAGE_ANALYZER_PROGRESS_STEP_KEYS = [
  'comprehensive',
  'topicSentence',
  'essaySentence',
  'grammar',
  'context',
  'sentenceBreaks',
  'svoc',
  'syntax',
  'grammarTags',
  'vocabulary',
] as const;

type MainLoose = Record<string, unknown>;

function autoDetectStepDone(key: string, s: MainLoose): boolean {
  const compRaw = s.analysisResults;
  const comp =
    compRaw != null && typeof compRaw === 'object'
      ? (compRaw as MainLoose).comprehensive
      : undefined;
  const comprehensiveOk =
    comp != null &&
    typeof comp === 'object' &&
    Object.keys(comp as MainLoose).some((k) => String((comp as MainLoose)[k] ?? '').trim() !== '');

  const topic = s.topicHighlightedSentences;
  const essay = s.essayHighlightedSentences;
  const grammarW = s.grammarSelectedWords;
  const grammarR = s.grammarSelectedRanges;
  const contextW = s.contextSelectedWords;
  const breaks = s.sentenceBreaks;
  const svoc = s.svocData;
  const syntax = s.syntaxPhrases;
  const tags = s.grammarTags;
  const vocab = s.vocabularyList;

  const map: Record<string, boolean> = {
    comprehensive: comprehensiveOk,
    topicSentence: Array.isArray(topic) && topic.length > 0,
    essaySentence: Array.isArray(essay) && essay.length > 0,
    grammar:
      (Array.isArray(grammarW) && grammarW.length > 0) ||
      (Array.isArray(grammarR) && grammarR.length > 0),
    context: Array.isArray(contextW) && contextW.length > 0,
    sentenceBreaks:
      breaks != null &&
      typeof breaks === 'object' &&
      Object.keys(breaks as MainLoose).some((k) => {
        const arr = (breaks as Record<string, unknown>)[k];
        return Array.isArray(arr) && arr.length > 0;
      }),
    svoc: svoc != null && typeof svoc === 'object' && Object.keys(svoc as MainLoose).length > 0,
    syntax: syntax != null && typeof syntax === 'object' && Object.keys(syntax as MainLoose).length > 0,
    grammarTags: Array.isArray(tags) && tags.length > 0,
    vocabulary: Array.isArray(vocab) && vocab.length > 0,
  };
  return map[key] ?? false;
}

/** passageStates.main JSON(느슨한 타입) → 완료 단계 수·백분율 */
export function passageAnalyzerProgressFromMain(
  main: MainLoose | null | undefined
): { done: number; total: number; percent: number } {
  const total = PASSAGE_ANALYZER_PROGRESS_STEP_KEYS.length;
  if (!main || typeof main !== 'object') {
    return { done: 0, total, percent: 0 };
  }
  const manualRaw = main.manualStepStatus;
  const manual =
    manualRaw != null && typeof manualRaw === 'object' && !Array.isArray(manualRaw)
      ? (manualRaw as Record<string, boolean | undefined>)
      : {};

  let done = 0;
  for (const key of PASSAGE_ANALYZER_PROGRESS_STEP_KEYS) {
    const autoDetected = autoDetectStepDone(key, main);
    const manualVal = manual[key];
    const stepDone = manualVal !== undefined ? !!manualVal : autoDetected;
    if (stepDone) done++;
  }
  const percent = total ? Math.round((done / total) * 100) : 0;
  return { done, total, percent };
}
