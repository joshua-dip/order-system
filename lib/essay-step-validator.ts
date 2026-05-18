/**
 * 서술형집중 워크북 — JSON 정합성 검증 (CLI save 전).
 *
 * 검증 정책:
 *   - errors: 저장 거부 사유 (필수 필드 누락·치명적 정합 깨짐)
 *   - warnings: 권장 위반 (저장은 가능). --force 로 errors 를 warnings 로 격하.
 */

import type {
  EssayStepWorkbookData,
  KoToEnItem,
  GrammarFixItem,
  GrammarBoxItem,
  GrammarPassageAnswer,
  WordArrangeItem,
  CondWriteItem,
  InflectionItem,
  BlankItem,
  BlankFirstLetterItem,
  SyntaxAnalysisItem,
  ComprehensiveItem,
} from './essay-step-workbook';

export interface EssayStepValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function isStr(v: unknown): v is string {
  return typeof v === 'string';
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isStrArr(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isStr);
}
function isArr(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isPair(v: unknown): v is [string, string] {
  return Array.isArray(v) && v.length === 2 && v.every(isStr);
}
function isTriple(v: unknown): v is [string, string, string] {
  return Array.isArray(v) && v.length === 3 && v.every(isStr);
}
function isQuad(v: unknown): v is [string, string, string, string] {
  return Array.isArray(v) && v.length === 4 && v.every(isStr);
}

export function validateEssayStepData(input: unknown): EssayStepValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObj(input)) {
    return { valid: false, errors: ['입력이 객체가 아닙니다.'], warnings };
  }

  // ── meta ──────────────────────────────────────────────────────────────
  const meta = input.meta;
  if (!isObj(meta)) errors.push('meta 객체가 없습니다.');
  else {
    if (!isStr(meta.topic) || !meta.topic.trim()) errors.push('meta.topic 이 비어 있습니다.');
    if (!isStr(meta.topic_ko)) warnings.push('meta.topic_ko 가 없습니다 (한국어 부제 권장).');
    if (!isStr(meta.academy)) warnings.push('meta.academy 가 없습니다.');
    if (!isStr(meta.publisher)) warnings.push('meta.publisher 가 없습니다.');
  }

  // ── passage ──────────────────────────────────────────────────────────
  if (!isStrArr(input.passage)) errors.push('passage 가 string[] 이 아닙니다.');
  else if (input.passage.length === 0) errors.push('passage 가 비어 있습니다.');
  else if (input.passage.length < 4) warnings.push(`passage 문장 수 ${input.passage.length} — 4개 이상 권장.`);

  // passage_ko (선택) — 있으면 passage 와 같은 길이여야 함
  if (input.passage_ko !== undefined) {
    if (!isStrArr(input.passage_ko)) {
      errors.push('passage_ko 가 string[] 이 아닙니다.');
    } else if (isStrArr(input.passage)) {
      if (input.passage_ko.length !== 0 && input.passage_ko.length !== input.passage.length) {
        warnings.push(`passage_ko 길이(${input.passage_ko.length}) ≠ passage 길이(${input.passage.length}) — Section 1 2단 노출 안 됨.`);
      }
    }
  }

  // ── 어휘 (vocab/definitions/def_shuffle) ──────────────────────────────
  const vocab = input.vocab;
  const definitions = input.definitions;
  if (!isArr(vocab) || !vocab.every(isPair)) errors.push('vocab 가 [string, string][] 이 아닙니다.');
  else if (vocab.length < 4) warnings.push(`vocab ${vocab.length}개 — 6~8개 권장.`);

  if (!isArr(definitions) || !definitions.every(isPair)) errors.push('definitions 가 [string, string][] 이 아닙니다.');
  else if (isArr(vocab) && definitions.length !== (vocab as KoToEnItem[]).length) {
    errors.push(`definitions 길이(${definitions.length}) 와 vocab 길이(${(vocab as KoToEnItem[]).length}) 가 다릅니다.`);
  }

  const defShuffle = input.def_shuffle;
  if (!Array.isArray(defShuffle) || !defShuffle.every(isNum)) {
    errors.push('def_shuffle 이 number[] 가 아닙니다.');
  } else if (isArr(definitions) && defShuffle.length !== (definitions as KoToEnItem[]).length) {
    errors.push(`def_shuffle 길이(${defShuffle.length}) 와 definitions 길이(${(definitions as KoToEnItem[]).length}) 가 다릅니다.`);
  } else if (isArr(definitions)) {
    const n = (definitions as KoToEnItem[]).length;
    const seen = new Set<number>();
    for (const v of defShuffle as number[]) {
      if (!Number.isInteger(v) || v < 0 || v >= n) {
        errors.push(`def_shuffle 값 ${v} 가 0..${n - 1} 범위 밖입니다.`);
        break;
      }
      if (seen.has(v)) { errors.push('def_shuffle 에 중복 인덱스가 있습니다 (순열이어야 함).'); break; }
      seen.add(v);
    }
  }

  // ── 동의어/반의어 ─────────────────────────────────────────────────────
  if (!isArr(input.syn_ant) || !input.syn_ant.every(isTriple)) errors.push('syn_ant 가 [string, string, string][] 이 아닙니다.');
  if (!isStrArr(input.syn_ant_answers)) errors.push('syn_ant_answers 가 string[] 이 아닙니다.');

  // ── 문맥상 어휘 ──────────────────────────────────────────────────────
  if (!isArr(input.context_choices) || !input.context_choices.every(isPair)) {
    errors.push('context_choices 가 [string, string][] 이 아닙니다.');
  }

  // ── 어법 ─────────────────────────────────────────────────────────────
  if (!isArr(input.grammar_fix) || !input.grammar_fix.every(isQuad)) {
    errors.push('grammar_fix 가 [string×4][] 이 아닙니다.');
  } else {
    const items = input.grammar_fix as GrammarFixItem[];
    if (items.length < 3) warnings.push('grammar_fix 가 3개 미만입니다.');
    // 「유지·맞음·수정 불필요」 류 정답 차단 — AI가 5개 채우려고 끼워넣는 패턴
    // 한글 키워드는 substring 매칭(어법 정답 자체에 한글이 들어가면 별도 errors 로 잡히므로 안전).
    // 영어 키워드는 단어 경계 \b 로 substring 오탐 차단 (예: "valid" 가 "validation" 에 매칭되는 사고 방지).
    const NO_FIX_PATTERN_KO = /(유지|맞음|올바름|수정\s*불필요|틀린\s*것\s*없음|그대로|✓)/;
    const NO_FIX_PATTERN_EN = /\b(correct|no\s+error|valid|same\s+as)\b/i;
    const isNoFix = (s: string) => NO_FIX_PATTERN_KO.test(s) || NO_FIX_PATTERN_EN.test(s);
    const HAS_HANGUL = /[가-힣]/;
    items.forEach(([sentHtml, wrong, right], i) => {
      const w = wrong.trim();
      const r = right.trim();
      if (!w || !r) {
        errors.push(`grammar_fix[${i}]: wrong/right 가 비어 있습니다.`);
        return;
      }
      if (w.toLowerCase() === r.toLowerCase()) {
        errors.push(`grammar_fix[${i}]: wrong("${w}") 와 right("${r}") 가 같습니다 — 모호한 문항.`);
      }
      if (isNoFix(r)) {
        errors.push(`grammar_fix[${i}]: right 가 「유지/맞음/correct」 류("${r}") 입니다 — 「틀린 것 없음」 정답 금지. 진짜 오류 5개를 못 만들면 3~4개만 출제하세요.`);
      }
      if (HAS_HANGUL.test(r)) {
        errors.push(`grammar_fix[${i}]: right("${r}") 에 한국어가 들어 있습니다 — 어법 정답은 영어 어형이어야 합니다.`);
      }
      // sentHtml 안에 <u>wrong</u> 마킹이 있는지 (느슨한 일치)
      const tag = `<u>${w}</u>`;
      if (!sentHtml.includes(tag)) {
        warnings.push(`grammar_fix[${i}]: sentHtml 에 \`${tag}\` 마킹이 없습니다. (wrong 과 마킹 단어가 정확히 일치해야 학생이 인식)`);
      }
    });
  }
  if (!isArr(input.grammar_box) || !input.grammar_box.every(isTriple)) {
    errors.push('grammar_box 가 [string×3][] 이 아닙니다.');
  } else if ((input.grammar_box as GrammarBoxItem[]).length < 3) {
    warnings.push('grammar_box 가 3개 미만입니다.');
  }
  if (!isStr(input.grammar_passage)) errors.push('grammar_passage 가 string 이 아닙니다.');
  if (!isArr(input.grammar_passage_answers) || !input.grammar_passage_answers.every(isTriple)) {
    errors.push('grammar_passage_answers 가 [string×3][] 이 아닙니다.');
  }
  if (!isStr(input.grammar_passage_summary)) warnings.push('grammar_passage_summary 가 비어 있습니다.');

  // ── 영작 ─────────────────────────────────────────────────────────────
  const wordArrange = input.word_arrange;
  if (!isArr(wordArrange) || !wordArrange.every(it => isObj(it) && isStr(it.ko) && isStr(it.words) && isStr(it.ans))) {
    errors.push('word_arrange 항목 형식 오류 (ko/words/ans 모두 string 필요).');
  } else {
    const arr = wordArrange as WordArrangeItem[];
    if (arr.length < 3) warnings.push('word_arrange 가 3개 미만.');
    // 모든 ans 가 본문 그대로면 변형 영작 부족
    if (isStrArr(input.passage) && arr.length >= 3) {
      const passageSet = new Set(input.passage.map(s => s.trim()));
      const allVerbatim = arr.every(it => passageSet.has(it.ans.trim()));
      if (allVerbatim) {
        warnings.push('word_arrange 모든 항목이 본문 문장 그대로입니다 — 5개 중 1~2개는 핵심 어휘 재구성 변형 영작 권장 (상위권 대비).');
      }
    }
    // K 규칙: words 의 슬래시 토큰이 모두 ans 안에 있는지.
    // 보기 토큰이 다중 단어 묶음("the wellbeing of residents")이면 단어 단위로 분해해서 검사.
    // 또한 multiset(중복 카운트) 비교로 "the" 가 보기에 2번이면 정답에도 2번 있어야 함을 확인.
    const norm = (s: string) => s.toLowerCase().replace(/[.,;:!?"'()]/g, '').trim();
    /** 토큰을 단어 단위로 분해. 슬래시로 1차 split 후, 각 토큰 안의 공백으로 2차 split. */
    const splitToWords = (raw: string): string[] => {
      return raw
        .split('/')
        .flatMap(s => norm(s).split(/\s+/))
        .filter(Boolean);
    };
    const buildCount = (xs: string[]): Map<string, number> => {
      const m = new Map<string, number>();
      for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
      return m;
    };
    arr.forEach((it, i) => {
      const wordsList = splitToWords(it.words);
      const ansList = norm(it.ans).split(/\s+/).filter(Boolean);
      const wordsCount = buildCount(wordsList);
      const ansCount = buildCount(ansList);

      // 보기 다중 단어 묶음 경고 (학생 혼란 유발 — 단어 단위 권장)
      const slashTokens = it.words.split('/').map(s => s.trim()).filter(Boolean);
      const multiWordChunks = slashTokens.filter(t => /\s/.test(t));
      if (multiWordChunks.length > 0) {
        warnings.push(`word_arrange[${i}]: 보기에 다중 단어 묶음 ${multiWordChunks.length}개 ([${multiWordChunks.slice(0, 3).map(t => `"${t}"`).join(', ')}…]) — 학생이 단어 단위로 받는지 묶음 단위로 받는지 모호합니다. 단어 단위로 분해 권장.`);
      }

      // missing: 보기에 있는데 정답에 카운트 모자란 단어 (학생이 배열 불가)
      const missing: string[] = [];
      for (const [w, n] of wordsCount) {
        if ((ansCount.get(w) ?? 0) < n) {
          missing.push(n > 1 ? `${w}×${n}` : w);
        }
      }
      if (missing.length > 0) {
        errors.push(`word_arrange[${i}]: 보기 단어 [${missing.join(', ')}] 가 정답 ans 에 (충분히) 없습니다 — 학생이 배열할 수 없습니다.`);
      }

      // extra: 정답에 있는데 보기에 없는 단어 (the/a 1~2개 OK, 3개 이상이면 의심)
      const extras: string[] = [];
      for (const [w, n] of ansCount) {
        const lack = n - (wordsCount.get(w) ?? 0);
        if (lack > 0) {
          for (let k = 0; k < lack; k++) extras.push(w);
        }
      }
      if (extras.length >= 3) {
        warnings.push(`word_arrange[${i}]: 정답 ans 에 보기에 없는 단어 ${extras.length}개 ([${extras.slice(0, 5).join(', ')}…]) — 학생이 추가해야 함. 의도 X 면 보기 보강.`);
      }
    });
  }
  if (!isArr(input.ko_to_en) || !input.ko_to_en.every(isPair)) {
    errors.push('ko_to_en 이 [string, string][] 이 아닙니다.');
  } else if (isStrArr(input.passage)) {
    // 모든 ko_to_en 의 영문이 본문 문장과 100% 일치하면 변형 영작이 부족하다는 신호
    const passageSet = new Set(input.passage.map(s => s.trim()));
    const allVerbatim = (input.ko_to_en as KoToEnItem[]).every(([, en]) => passageSet.has(en.trim()));
    if (allVerbatim && (input.ko_to_en as KoToEnItem[]).length >= 3) {
      warnings.push('ko_to_en 모든 항목이 본문 문장 그대로입니다 — 변형 영작 1~2개를 섞으면 상위권 대비 품질이 올라갑니다.');
    }
  }
  const condWrite = input.cond_write;
  if (!isArr(condWrite) || !condWrite.every(it => isObj(it) && isStr(it.ko) && isStrArr(it.conds) && isStr(it.ans))) {
    errors.push('cond_write 항목 형식 오류 (ko/conds[]/ans 필요).');
  } else if ((condWrite as CondWriteItem[]).length < 2) {
    warnings.push('cond_write 가 2개 미만.');
  }
  if (!isArr(input.inflection) || !input.inflection.every(isTriple)) {
    errors.push('inflection 이 [string×3][] 이 아닙니다.');
  }

  // ── 빈칸 (L 규칙 — 빈칸 개수 ↔ 정답 단어 수 정합) ─────────────────────
  // 공통 유틸
  const countBlanks = (s: string) => (s.match(/_{3,}/g) ?? []).length;
  const countWords = (s: string) => s.replace(/[,.;:!?"]/g, ' ').split(/\s+/).filter(Boolean).length;

  // 5-A 한 단어 빈칸 — 정답 1단어 + 빈칸 1개 강제
  if (!isArr(input.blank_one_word) || !input.blank_one_word.every(isPair)) {
    errors.push('blank_one_word 가 [string, string][] 이 아닙니다.');
  } else {
    const items = input.blank_one_word as BlankItem[];
    if (items.length < 5) warnings.push('blank_one_word 가 5개 미만.');
    items.forEach(([sentHtml, ans], i) => {
      const ansWordCount = countWords(ans);
      const blankCount = countBlanks(sentHtml);
      if (ansWordCount !== 1) {
        // 5-A 는 「한 단어」 빈칸. 다단어면 5-B 로 옮겨야 함.
        errors.push(`blank_one_word[${i}]: 정답이 ${ansWordCount}단어 ("${ans}") — 5-A 는 정확히 1단어여야 합니다. 다단어 어구는 5-B(blank_phrase) 로 이동.`);
      }
      if (blankCount === 0) {
        warnings.push(`blank_one_word[${i}]: sentHtml 에 빈칸(_____) 마킹이 없습니다.`);
      } else if (blankCount > 1) {
        warnings.push(`blank_one_word[${i}]: 빈칸 ${blankCount}개 — 5-A 는 1개 권장.`);
      }
    });
  }

  // 5-B 어구 빈칸 — 빈칸 개수와 정답 단어 수 일치 강제 (errors)
  if (!isArr(input.blank_phrase) || !input.blank_phrase.every(isPair)) {
    errors.push('blank_phrase 가 [string, string][] 이 아닙니다.');
  } else {
    (input.blank_phrase as BlankItem[]).forEach(([sentHtml, ans], i) => {
      const blankCount = countBlanks(sentHtml);
      const ansWordCount = countWords(ans);
      if (blankCount === 0) {
        errors.push(`blank_phrase[${i}]: sentHtml 에 빈칸(_____) 마킹이 없습니다.`);
        return;
      }
      if (ansWordCount < 2) {
        errors.push(`blank_phrase[${i}]: 정답이 1단어("${ans}") — 5-B 는 2단어 이상 어구여야 합니다 (1단어는 5-A 로).`);
      }
      // 「빈칸 1개에 다단어 정답」 패턴은 학생 혼란 (한 칸에 몇 단어를 적어야 할지 모름).
      // 빈칸 개수와 정답 단어 수가 정확히 일치해야 errors 안 발생.
      if (blankCount !== ansWordCount) {
        errors.push(`blank_phrase[${i}]: 빈칸 ${blankCount}개 ↔ 정답 단어 ${ansWordCount}개 — 학생이 한 칸에 몇 단어를 적어야 할지 모호합니다 (1칸/다단어 미스매치). 빈칸 개수와 정답 단어 수를 정확히 일치시키거나, ans 에서 부정어/관사를 제외해 한 칸에 1단어가 들어가도록 줄이세요. (정답: "${ans}")`);
      }
    });
  }
  if (!isArr(input.blank_first_letter) || !input.blank_first_letter.every(isTriple)) {
    errors.push('blank_first_letter 가 [string×3][] 이 아닙니다.');
  }

  // ── 해석/구문 ────────────────────────────────────────────────────────
  if (!isStrArr(input.translation_sentences)) errors.push('translation_sentences 가 string[] 이 아닙니다.');
  if (!isStrArr(input.translation_answers)) errors.push('translation_answers 가 string[] 이 아닙니다.');
  if (
    isStrArr(input.translation_sentences) &&
    isStrArr(input.translation_answers) &&
    input.translation_sentences.length !== input.translation_answers.length
  ) {
    errors.push(
      `translation_sentences 길이(${input.translation_sentences.length}) 와 translation_answers 길이(${input.translation_answers.length}) 가 다릅니다.`,
    );
  }
  const syntax = input.syntax_analysis;
  if (!isArr(syntax) || !syntax.every(it => isObj(it) && isStr(it.sent) && isStr(it.q) && isStr(it.ans))) {
    errors.push('syntax_analysis 항목 형식 오류 (sent/q/ans 모두 string 필요).');
  } else if (isStrArr(input.passage)) {
    // M 규칙: sent (HTML 태그 제거) 가 passage 의 어떤 문장에 substring 으로 포함돼야 함
    const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const passageJoined = input.passage.map(s => s.replace(/\s+/g, ' ').trim()).join(' ');
    (syntax as SyntaxAnalysisItem[]).forEach((it, i) => {
      const stripped = stripHtml(it.sent);
      if (!stripped) return;
      // 짧으면 정확 매칭 어려움 — 8단어 이상일 때만 엄격 검사
      const wordCount = stripped.split(/\s+/).length;
      if (wordCount >= 4 && !passageJoined.includes(stripped)) {
        warnings.push(`syntax_analysis[${i}]: sent (\"${stripped.slice(0, 50)}…\") 가 본문에서 그대로 발췌되지 않았습니다. 본문 한 문장에서만 추출하세요.`);
      }
    });
  }

  // ── 주제·요약·제목 ───────────────────────────────────────────────────
  if (!isStr(input.theme_answer) || !input.theme_answer.trim()) errors.push('theme_answer 가 비어 있습니다.');
  if (!isObj(input.summary) || !isStr((input.summary as Record<string, unknown>).text) || !isStr((input.summary as Record<string, unknown>).ans)) {
    errors.push('summary.text / summary.ans 가 모두 string 이어야 합니다.');
  }
  if (!isStrArr(input.title_examples)) errors.push('title_examples 가 string[] 이 아닙니다.');
  else if (input.title_examples.length < 2) warnings.push('title_examples 가 2개 미만.');

  // ── 종합 서술형 ──────────────────────────────────────────────────────
  const comp = input.comprehensive;
  if (!isArr(comp) || !comp.every(it => isObj(it) && isStr(it.q) && isStr(it.ans))) {
    errors.push('comprehensive 항목 형식 오류 (q/ans 모두 string 필요).');
  } else {
    const arr = comp as ComprehensiveItem[];
    if (arr.length < 2) warnings.push('comprehensive 가 2개 미만.');
    // 각 문항에 단어수/키워드 조건이 있는지 — 없으면 채점 모호
    const lacksCondition = arr.filter(it => {
      const q = it.q;
      return !/단어|이내|사용|포함|영문|한 문장|key/i.test(q);
    });
    if (lacksCondition.length > 0) {
      warnings.push(`comprehensive: ${lacksCondition.length}개 문항에 단어수/키워드 조건이 보이지 않습니다 — 채점 안정성 권장.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** 호환 — 캐스트된 형태로 받기 위함 */
export function validateAsEssayStepData(input: unknown): {
  result: EssayStepValidationResult;
  data: EssayStepWorkbookData;
} {
  const result = validateEssayStepData(input);
  return { result, data: input as EssayStepWorkbookData };
}

// 사용하지 않은 type import 제거 방지용 (린터)
type _Unused = SyntaxAnalysisItem | InflectionItem | BlankFirstLetterItem | GrammarPassageAnswer;
void (null as unknown as _Unused);
