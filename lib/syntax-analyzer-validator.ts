/**
 * cc:syntax CLI 용 PassageStateStored 검증.
 *
 * 목표: dry-run·save 양쪽에서 사용. 사용자가 채팅에서 작성한 JSON 이
 * 분석기 웹과 호환되는지 확인하고, 잘못 작성된 인덱스·범위·구조를 잡아낸다.
 *
 * 정책: sentences/koreanSentences 만 필수, 나머지는 선택. 항목별로
 * 비어 있어도 OK 단 들어왔으면 형식·인덱스 일치를 강제.
 */

import type {
  PassageStateStored,
  SvocSentenceData,
  SyntaxPhraseStored,
  GrammarTagStored,
  GrammarPointEntry,
  VocabularyEntry,
} from './passage-analyzer-types';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSyntaxAnalyzerJson(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['JSON 최상위가 객체가 아닙니다.'], warnings };
  }

  /* { main: {...} } wrap 또는 raw PassageStateStored 둘 다 허용. */
  const raw = ('main' in (input as Record<string, unknown>))
    ? (input as { main: unknown }).main
    : input;

  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['main 또는 본문이 객체가 아닙니다.'], warnings };
  }
  const m = raw as PassageStateStored;

  /* 1. 필수 — sentences / koreanSentences */
  if (!Array.isArray(m.sentences) || m.sentences.length === 0) {
    errors.push('sentences 가 비었거나 배열이 아닙니다.');
    return { ok: false, errors, warnings };
  }
  if (!Array.isArray(m.koreanSentences)) {
    errors.push('koreanSentences 가 배열이 아닙니다.');
  } else if (m.koreanSentences.length !== m.sentences.length) {
    warnings.push(`koreanSentences 길이(${m.koreanSentences.length}) 가 sentences(${m.sentences.length}) 와 다릅니다.`);
  }
  for (let i = 0; i < m.sentences.length; i++) {
    if (typeof m.sentences[i] !== 'string') errors.push(`sentences[${i}] 가 문자열이 아닙니다.`);
  }

  const nSent = m.sentences.length;
  const isSentIdx = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < nSent;

  /* 2. 인덱스 배열 — topicHighlightedSentences / essayHighlightedSentences / insertionHighlightedSentences */
  for (const key of ['topicHighlightedSentences', 'essayHighlightedSentences', 'insertionHighlightedSentences'] as const) {
    const v = m[key];
    if (v === undefined) continue;
    if (!Array.isArray(v)) { errors.push(`${key} 는 number[] 여야 합니다.`); continue; }
    for (let i = 0; i < v.length; i++) {
      if (!isSentIdx(v[i])) errors.push(`${key}[${i}]=${v[i]} 가 0~${nSent - 1} 범위의 정수가 아닙니다.`);
    }
  }

  /* 3. svocData */
  if (m.svocData !== undefined) {
    if (typeof m.svocData !== 'object' || m.svocData === null) {
      errors.push('svocData 는 객체여야 합니다.');
    } else {
      for (const [k, v] of Object.entries(m.svocData)) {
        const idx = Number(k);
        if (!isSentIdx(idx)) { errors.push(`svocData key ${k} 가 문장 인덱스가 아닙니다.`); continue; }
        validateSvoc(v as SvocSentenceData, idx, m.sentences[idx], errors);
      }
    }
  }

  /* 4. syntaxPhrases */
  if (m.syntaxPhrases !== undefined) {
    if (typeof m.syntaxPhrases !== 'object' || m.syntaxPhrases === null) {
      errors.push('syntaxPhrases 는 객체여야 합니다.');
    } else {
      for (const [k, arr] of Object.entries(m.syntaxPhrases)) {
        const idx = Number(k);
        if (!isSentIdx(idx)) { errors.push(`syntaxPhrases key ${k} 가 문장 인덱스가 아닙니다.`); continue; }
        if (!Array.isArray(arr)) { errors.push(`syntaxPhrases[${k}] 가 배열이 아닙니다.`); continue; }
        validateSyntaxPhraseList(arr as SyntaxPhraseStored[], idx, m.sentences[idx], errors);
      }
    }
  }

  /* 5. sentenceBreaks */
  if (m.sentenceBreaks !== undefined) {
    if (typeof m.sentenceBreaks !== 'object' || m.sentenceBreaks === null) {
      errors.push('sentenceBreaks 는 객체여야 합니다.');
    } else {
      for (const [k, arr] of Object.entries(m.sentenceBreaks)) {
        const idx = Number(k);
        if (!isSentIdx(idx)) { errors.push(`sentenceBreaks key ${k} 가 문장 인덱스가 아닙니다.`); continue; }
        if (!Array.isArray(arr) || !arr.every(n => typeof n === 'number' && n >= 0)) {
          errors.push(`sentenceBreaks[${k}] 는 number[] 여야 합니다.`);
        }
      }
    }
  }

  /* 6. grammarTags */
  if (m.grammarTags !== undefined) {
    if (!Array.isArray(m.grammarTags)) errors.push('grammarTags 는 배열이어야 합니다.');
    else m.grammarTags.forEach((t, i) => validateGrammarTag(t as GrammarTagStored, i, nSent, errors));
  }

  /* 7. grammarPointsBySentence */
  if (m.grammarPointsBySentence !== undefined) {
    if (typeof m.grammarPointsBySentence !== 'object' || m.grammarPointsBySentence === null) {
      errors.push('grammarPointsBySentence 는 객체여야 합니다.');
    } else {
      for (const [k, arr] of Object.entries(m.grammarPointsBySentence)) {
        const idx = Number(k);
        if (!isSentIdx(idx)) { errors.push(`grammarPointsBySentence key ${k} 가 문장 인덱스가 아닙니다.`); continue; }
        if (!Array.isArray(arr)) { errors.push(`grammarPointsBySentence[${k}] 가 배열이 아닙니다.`); continue; }
        (arr as GrammarPointEntry[]).forEach((e, i) => {
          if (typeof e?.title !== 'string' || typeof e?.content !== 'string') {
            errors.push(`grammarPointsBySentence[${k}][${i}] 가 {title, content} 형식이 아닙니다.`);
          }
        });
      }
    }
  }

  /* 8. vocabularyList */
  if (m.vocabularyList !== undefined) {
    if (!Array.isArray(m.vocabularyList)) errors.push('vocabularyList 는 배열이어야 합니다.');
    else (m.vocabularyList as VocabularyEntry[]).forEach((v, i) => validateVocab(v, i, nSent, errors));
  } else {
    warnings.push('vocabularyList 가 없습니다. 빈 배열 [] 이라도 두는 것을 권장.');
  }

  /* 9. grammarSelectedWords / contextSelectedWords */
  for (const key of ['grammarSelectedWords', 'contextSelectedWords'] as const) {
    const v = m[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || !v.every(s => typeof s === 'string')) {
      errors.push(`${key} 는 string[] 여야 합니다.`);
    }
  }

  /* 10. comprehensive 슬롯 수 */
  if (m.comprehensiveSlotCount !== undefined) {
    if (!Number.isInteger(m.comprehensiveSlotCount) || m.comprehensiveSlotCount < 5 || m.comprehensiveSlotCount > 30) {
      errors.push('comprehensiveSlotCount 는 5~30 정수여야 합니다.');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateSvoc(v: SvocSentenceData, idx: number, sentence: string, errors: string[]) {
  const sLen = sentence.length;
  const must = ['subject', 'verb', 'subjectStart', 'subjectEnd', 'verbStart', 'verbEnd'] as const;
  for (const k of must) {
    if (v?.[k] === undefined || v[k] === null) errors.push(`svocData[${idx}].${k} 누락.`);
  }
  const inRange = (n: unknown) => typeof n === 'number' && n >= 0 && n <= sLen;
  if (!inRange(v?.subjectStart) || !inRange(v?.subjectEnd)) errors.push(`svocData[${idx}] subject 범위가 0~${sLen} 밖.`);
  if (!inRange(v?.verbStart) || !inRange(v?.verbEnd)) errors.push(`svocData[${idx}] verb 범위가 0~${sLen} 밖.`);
}

function validateSyntaxPhraseList(arr: SyntaxPhraseStored[], idx: number, sentence: string, errors: string[]) {
  /* sentence 의 단어 수 — 공백 split 기준. SyntaxPhraseStored 의 startIndex/endIndex 는 단어 인덱스. */
  const wordCount = sentence.trim().split(/\s+/).length;
  arr.forEach((p, i) => {
    if (typeof p?.text !== 'string') errors.push(`syntaxPhrases[${idx}][${i}].text 누락.`);
    if (typeof p?.label !== 'string') errors.push(`syntaxPhrases[${idx}][${i}].label 누락.`);
    if (p?.type !== 'clause' && p?.type !== 'phrase') errors.push(`syntaxPhrases[${idx}][${i}].type 는 'clause'|'phrase' 여야 합니다.`);
    if (!Number.isInteger(p?.startIndex) || p.startIndex < 0 || p.startIndex >= wordCount) {
      errors.push(`syntaxPhrases[${idx}][${i}].startIndex=${p?.startIndex} 가 0~${wordCount - 1} 밖.`);
    }
    if (!Number.isInteger(p?.endIndex) || p.endIndex < p?.startIndex || p.endIndex >= wordCount) {
      errors.push(`syntaxPhrases[${idx}][${i}].endIndex=${p?.endIndex} 가 startIndex~${wordCount - 1} 밖.`);
    }
    if (typeof p?.depth !== 'number' || p.depth < 0) errors.push(`syntaxPhrases[${idx}][${i}].depth 가 0 이상의 수가 아닙니다.`);
    if (typeof p?.color !== 'string') errors.push(`syntaxPhrases[${idx}][${i}].color 누락.`);
  });
}

function validateGrammarTag(t: GrammarTagStored, i: number, nSent: number, errors: string[]) {
  if (!Number.isInteger(t?.sentenceIndex) || t.sentenceIndex < 0 || t.sentenceIndex >= nSent) {
    errors.push(`grammarTags[${i}].sentenceIndex=${t?.sentenceIndex} 가 0~${nSent - 1} 밖.`);
  }
  if (typeof t?.tagName !== 'string' || !t.tagName.trim()) errors.push(`grammarTags[${i}].tagName 누락.`);
  if (typeof t?.selectedText !== 'string') errors.push(`grammarTags[${i}].selectedText 누락.`);
  if (!Number.isInteger(t?.startWordIndex) || t.startWordIndex < 0) errors.push(`grammarTags[${i}].startWordIndex 음수.`);
  if (!Number.isInteger(t?.endWordIndex) || t.endWordIndex < t?.startWordIndex) errors.push(`grammarTags[${i}].endWordIndex < startWordIndex.`);
}

function validateVocab(v: VocabularyEntry, i: number, nSent: number, errors: string[]) {
  if (typeof v?.word !== 'string' || !v.word.trim()) errors.push(`vocabularyList[${i}].word 누락.`);
  if (typeof v?.meaning !== 'string') errors.push(`vocabularyList[${i}].meaning 누락.`);
  if (v?.positions !== undefined) {
    if (!Array.isArray(v.positions)) errors.push(`vocabularyList[${i}].positions 가 배열이 아닙니다.`);
    else v.positions.forEach((p, j) => {
      if (!Number.isInteger(p?.sentence) || p.sentence < 0 || p.sentence >= nSent) {
        errors.push(`vocabularyList[${i}].positions[${j}].sentence=${p?.sentence} 가 0~${nSent - 1} 밖.`);
      }
    });
  }
}
