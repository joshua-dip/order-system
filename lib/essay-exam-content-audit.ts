/**
 * 서술형 출제기 — 내용 품질 점검 (조건·intent 누설 검사).
 *
 * `lib/essay-generator-difficulty-appendix.ts` 의 정량 규칙을 그대로 옮긴 검증.
 * - 메타용어 화이트리스트: to부정사·be동사·-ing형·p.p.·S/V/O/C/M·SVOC/SVO/SV
 * - 2-gram 룰: 조건 ↔ answer.text 2단어 이상 연속 일치 금지
 * - 내용어 인용 금지: answer 의 영어 토큰이 조건에 등장하면 누설
 * - 하이픈 복합어 금지: 하이픈 안 단어 조각도 금지
 * - intent_content 두께: 너무 짧거나 키워드 나열만 있으면 부실
 * - 슬롯 과세분화: 「...」블록 안 `+` 슬롯이 너무 많으면 답 재구성 가능
 * - 표준 고정문구 제외: 검사 대상이 아닌 보일러플레이트
 *
 * 자동 수정은 불가 (조건 본문 재작성은 LLM 작업).
 * 검출만 하고 패턴 집계 리포트(`.essay-audit-reports/...md`)를 생성한다.
 */

import { ExamData, Question } from './essay-exam-html';
import { EssayExamDoc } from './essay-exams-store';

export interface ContentFinding {
  level: 'error' | 'warning';
  code: string;
  /** Q서·논술형-N */
  qid?: string;
  /** conditions[index] 위치 (해당하는 경우) */
  conditionIndex?: number;
  message: string;
  /** 추출된 위반 토큰 (있으면) */
  tokens?: string[];
}

export interface ContentAuditResult {
  examId: string;
  textbook: string;
  sourceKey: string;
  difficulty: string;
  folder: string;
  findings: ContentFinding[];
}

/* ── 표준 고정문구 패턴 (검사 제외) ────────────────────────────────────────── */
const BOILERPLATE_PATTERNS: RegExp[] = [
  /본문에 제시한 우리말 해석과 의미가 일치할 것/,
  /올바른 어법을 사용하여 완전한 문장을 작성할 것/,
  /\d+\s*개의?\s*단어로 답안을 작성할 것/,
  /주어진 한국어 해석에 부합하도록 영어 문장을 ['"`]작성['"`]할 것/,
  /아래 보기의 단어를 모두 사용하여 올바른 문장을 ['"`]작성['"`]할 것/,
  /아래 보기의 단어\(구\)들을 모두 사용하여 올바른 순서로 ['"`]배열['"`]할 것/,
];

function isBoilerplate(cond: string): boolean {
  return BOILERPLATE_PATTERNS.some(re => re.test(cond));
}

/* ── 메타용어 화이트리스트 ─────────────────────────────────────────────────── */
/**
 * 영어 알파벳을 포함해도 누설로 보지 않는 토큰 패턴.
 * - 합성어 (to부정사, be동사, p.p., S/V/O/C/M, SVOC 등)
 * - 단독 형태 (to, be, ing, S, V, O, C, M)
 */
const META_COMPOUND_RE = /(to부정사|be동사|-ing형|p\.p\.|S\/V\/O\/C\/M|SVOC|SVO|SV\b)/g;
const META_BARE_WHITELIST = new Set([
  'to', 'be', 'ing', 'pp',
  's', 'v', 'o', 'c', 'm',  // 한 글자 SVOC 라벨 (대소문자 모두 허용)
]);

/**
 * 함수어 (관사·be·조동사·전치사·접속사·대명사·부정·정도) 집합.
 * 부록 규칙상으론 이들도 누설이지만, 슬롯 패턴 `+ of +` 형태로 자주 등장하고
 * 답 어휘를 직접 노출하진 않으므로 warning 으로 격하.
 * 내용어 (명사·동사·형용사·부사 본문) 는 error.
 */
const FUNCTION_WORDS = new Set([
  /* 관사 */
  'a', 'an', 'the',
  /* be 활용 */
  'is', 'are', 'was', 'were', 'am', 'been', 'being',
  "isn't", "aren't", "wasn't", "weren't",
  /* do 활용 */
  'do', 'does', 'did', "don't", "doesn't", "didn't",
  /* have 활용 (조동사 용법) */
  'have', 'has', 'had', "haven't", "hasn't", "hadn't",
  /* 조동사 */
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  "can't", "couldn't", "won't", "wouldn't", "shouldn't",
  /* 단순 전치사 */
  'in', 'on', 'at', 'of', 'by', 'for', 'with', 'from', 'into', 'onto',
  'upon', 'about', 'under', 'over', 'through', 'against', 'between', 'among',
  'across', 'around', 'after', 'before', 'during', 'until', 'while', 'within',
  'without', 'as', 'out', 'up', 'down', 'off',
  /* 등위·접속·종속 */
  'and', 'or', 'but', 'so', 'nor', 'yet', 'if', 'then', 'because',
  /* 대명사·소유격 */
  'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours',
  'you', 'your', 'yours',
  'he', 'him', 'his', 'she', 'her', 'hers',
  'it', 'its', 'they', 'them', 'their', 'theirs',
  'this', 'that', 'these', 'those', 'such', 'one', 'ones',
  /* 의문·관계 */
  'who', 'whom', 'whose', 'which', 'what', 'when', 'where', 'why', 'how',
  /* 부정·정도 */
  'not', 'no', 'never', 'none',
  'most', 'very', 'so', 'too', 'much', 'more', 'less', 'few', 'many',
  'than', 'else', 'also', 'still', 'just',
]);

type LeakClass = 'content' | 'function' | 'generic';

function classifyToken(token: string, answerTokens: Set<string>): LeakClass {
  const lower = token.toLowerCase();
  /* 우선순위: 함수어 > 정답 토큰 > 일반 */
  if (FUNCTION_WORDS.has(lower)) return 'function';
  if (answerTokens.has(lower)) return 'content';
  return 'generic';
}

/* ── 토크나이저 ─────────────────────────────────────────────────────────────── */
function tokenizeEnglish(text: string): string[] {
  return (text.match(/[A-Za-z][A-Za-z'-]*/g) ?? []);
}

/**
 * 텍스트에서 메타용어 화이트리스트 부분을 마스킹한 뒤,
 * 남은 영어 토큰을 (위치 + 토큰) 으로 반환.
 */
function extractSuspectEnglishTokens(text: string): Array<{ token: string; index: number }> {
  /* 화이트리스트 범위 수집 */
  const masked = text.replace(META_COMPOUND_RE, m => ' '.repeat(m.length));
  const out: Array<{ token: string; index: number }> = [];
  const re = /[A-Za-z][A-Za-z'-]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const tok = m[0];
    if (META_BARE_WHITELIST.has(tok.toLowerCase())) continue;
    out.push({ token: tok, index: m.index });
  }
  return out;
}

/* ── answer 의 핵심 영어 토큰 셋 ───────────────────────────────────────────── */
function extractAnswerTokenSet(answerText: string): Set<string> {
  const tokens = tokenizeEnglish(answerText).map(t => t.toLowerCase());
  return new Set(tokens);
}

/**
 * answer 의 하이픈 복합어 (e.g. motion-sensing) 와 그 조각 (motion, sensing) 을 함께 반환.
 */
function extractAnswerHyphenWords(answerText: string): { compound: string[]; parts: string[] } {
  const compound = [...answerText.matchAll(/[A-Za-z]+(?:-[A-Za-z]+)+/g)].map(m => m[0]);
  const parts: string[] = [];
  for (const c of compound) parts.push(...c.split('-'));
  return { compound, parts };
}

/* ── 검사 1: 조건의 영어 토큰 누설 ─────────────────────────────────────────── */
function checkConditionEnglishLeak(
  q: Question,
  answerTokens: Set<string>,
  hyphen: { compound: string[]; parts: string[] },
  findings: ContentFinding[],
): void {
  if (!Array.isArray(q.conditions)) return;

  for (let ci = 0; ci < q.conditions.length; ci++) {
    const cond = String(q.conditions[ci] ?? '');
    if (isBoilerplate(cond)) continue;

    const suspects = extractSuspectEnglishTokens(cond);
    if (suspects.length === 0) continue;

    /* a) 토큰을 함수어 / 내용어 / generic 으로 분류 */
    const contentLeak: string[] = [];
    const genericLeak: string[] = [];
    const functionLeak: string[] = [];
    for (const s of suspects) {
      const cls = classifyToken(s.token, answerTokens);
      if (cls === 'content') contentLeak.push(s.token);
      else if (cls === 'generic') genericLeak.push(s.token);
      else functionLeak.push(s.token);
    }

    if (contentLeak.length > 0) {
      const unique = [...new Set(contentLeak)];
      findings.push({
        level: 'error',
        code: 'COND_ENG_LEAK',
        qid: q.id,
        conditionIndex: ci,
        message: `Q${q.id} conditions[${ci}]: 내용어가 조건 본문에 직접 등장 — ${unique.map(t => `"${t}"`).join(', ')}`,
        tokens: unique,
      });
    }
    if (genericLeak.length > 0) {
      const unique = [...new Set(genericLeak)];
      findings.push({
        level: 'error',
        code: 'COND_ENG_GENERIC',
        qid: q.id,
        conditionIndex: ci,
        message: `Q${q.id} conditions[${ci}]: 화이트리스트 외 영어 토큰 — ${unique.map(t => `"${t}"`).join(', ')}`,
        tokens: unique,
      });
    }
    if (functionLeak.length > 0) {
      const unique = [...new Set(functionLeak)];
      findings.push({
        level: 'warning',
        code: 'COND_ENG_FUNC',
        qid: q.id,
        conditionIndex: ci,
        message: `Q${q.id} conditions[${ci}]: 함수어 인용 (관사·be·조동사·전치사·접속사·대명사 등) — ${unique.map(t => `"${t}"`).join(', ')}`,
        tokens: unique,
      });
    }

    /* b) 2-gram 룰: 영어 토큰 2개 연속이 answer 에 등장 — 항상 error */
    const twoGrams: Array<{ a: string; b: string }> = [];
    for (let i = 0; i < suspects.length - 1; i++) {
      const gap = suspects[i + 1].index - (suspects[i].index + suspects[i].token.length);
      if (gap >= 0 && gap <= 5) {
        twoGrams.push({ a: suspects[i].token, b: suspects[i + 1].token });
      }
    }
    for (const g of twoGrams) {
      const bigram = `${g.a} ${g.b}`.toLowerCase();
      const aLower = q.answer?.text?.toLowerCase() ?? '';
      if (aLower.includes(bigram)) {
        findings.push({
          level: 'error',
          code: 'COND_2GRAM_LEAK',
          qid: q.id,
          conditionIndex: ci,
          message: `Q${q.id} conditions[${ci}]: 2-gram "${g.a} ${g.b}" 가 answer.text 와 연속 일치 — 누설`,
          tokens: [g.a, g.b],
        });
      }
    }

    /* c) 하이픈 복합어 / 조각 인용 금지 */
    for (const c of hyphen.compound) {
      if (cond.includes(c)) {
        findings.push({
          level: 'error',
          code: 'COND_HYPHEN_LEAK',
          qid: q.id,
          conditionIndex: ci,
          message: `Q${q.id} conditions[${ci}]: answer 의 하이픈 복합어 "${c}" 가 조건에 등장`,
          tokens: [c],
        });
      }
    }
    for (const p of hyphen.parts) {
      const re = new RegExp(`(^|[^A-Za-z])${p}([^A-Za-z]|$)`, 'i');
      if (re.test(cond) && !cond.toLowerCase().includes(p.toLowerCase() + '-')) {
        const alreadyCompound = hyphen.compound.some(cw => cond.includes(cw) && cw.toLowerCase().includes(p.toLowerCase()));
        if (!alreadyCompound) {
          findings.push({
            level: 'warning',
            code: 'COND_HYPHEN_PART_LEAK',
            qid: q.id,
            conditionIndex: ci,
            message: `Q${q.id} conditions[${ci}]: 하이픈 복합어 조각 "${p}" 가 조건에 등장`,
            tokens: [p],
          });
        }
      }
    }
  }
}

/* ── 검사 2: intent_content 부실 ───────────────────────────────────────────── */
function checkIntentContent(q: Question, findings: ContentFinding[]): void {
  const text = String(q.answer?.intent_content ?? '').trim();
  if (text.length === 0) {
    findings.push({
      level: 'error',
      code: 'INTENT_MISSING',
      qid: q.id,
      message: `Q${q.id}: intent_content 가 비어 있음`,
    });
    return;
  }

  if (text.length < 30) {
    findings.push({
      level: 'warning',
      code: 'INTENT_TOO_SHORT',
      qid: q.id,
      message: `Q${q.id}: intent_content 가 ${text.length}자로 너무 짧음 (≥30자 권장)`,
    });
  }

  /* 키워드 라벨 나열만 패턴: "X·Y·Z 통합." 같은 한 줄짜리 */
  const dotCount = (text.match(/·/g) ?? []).length;
  const verbHints = /[다가나는을를에의(은|는)\s].*(평가|확인|검증|식별|작성|복원|구성|통합)/.test(text);
  if (dotCount >= 2 && text.length < 60 && !verbHints) {
    findings.push({
      level: 'warning',
      code: 'INTENT_THIN',
      qid: q.id,
      message: `Q${q.id}: intent_content 가 키워드 라벨 나열에 가까움 (출제 의도·감점 포인트 서술 부족)`,
    });
  }
}

/* ── 검사 3a/b: 슬롯 과세분화 + POS 원자 나열 ────────────────────────────── */

/**
 * 슬롯 한 개를 atomic POS / structural chunk / punctuation 으로 분류.
 * - atomic   : 단어 단위 품사 라벨 (명사, 정관사, 주어, 전치사, 소유격 등)
 * - structural: 구 / 절 / 시제 + 태 / 비교 / 화법 등 청크 단위 라벨
 * - other    : punctuation marker 또는 분류 불가 (카운트 제외)
 */
function classifySlot(raw: string): 'atomic' | 'structural' | 'other' {
  const s = raw.trim();
  if (!s) return 'other';

  /* punctuation marker — 답을 노출하지 않으므로 카운트 제외 */
  if (/^(콤마|줄표|세미콜론|콜론|괄호|소괄호|인용 부호|따옴표|작은 따옴표|큰 따옴표|마침표|물음표|느낌표|하이픈)$/.test(s)) {
    return 'other';
  }

  /* 청크 단위 라벨 — 한 청크로 묶인 단위 */
  if (/(구\b|구$|절\b|절$)/.test(s)) return 'structural';
  if (/완료|진행|단순 수동|조동사 수동|능동태|수동태|단순 현재|단순 과거|단순 미래/.test(s)) return 'structural';
  if (/(비교급|최상급|동등 비교|동격|강조 구문|가목적어|가주어|분사구문|직접 화법|간접 화법|관용 표현|관용구|구동사|이중 부정)/.test(s)) return 'structural';
  if (/(부사절|명사절|형용사절|부사구|명사구|동사구|전치사구|형용사구)/.test(s)) return 'structural';
  if (/(양보|시간 부사|이유 부사|결과 부사|목적 부사|조건 부사|부대 상황|대조).*절/.test(s)) return 'structural';

  /* atomic POS 라벨 — 단어 단위 품사 (정확히 일치 또는 좁은 패턴) */
  const ATOMIC = [
    '명사', '동사', '본동사', '형용사', '부사', '대명사', '정관사', '부정관사', '관사', '한정사',
    '소유격', '인칭 대명사', '복수 명사', '단수 명사', '복수 대명사', '의문사', '전치사', '접속사',
    '등위', '등위 접속사', '종속 접속사', '부정어', '고유명사', '주어', '목적어', '보어',
    '소유/관계', '위치/범위', '현재완료 도움동사', '분사', '분사 전위', '분사 후위',
    '과거분사', '현재분사', 'be동사', 'p.p.', '-ing형', 'to부정사',
    '수치', '이니셜', '재귀대명사',
  ];
  if (ATOMIC.includes(s)) return 'atomic';
  /* 형용사/명사 등 단어로 시작하는 합성 — `자격 의미의 전치사`, `1인칭 단수 주어` 등도 atomic 으로 봄 (끝이 POS 라벨) */
  for (const a of ATOMIC) {
    if (s.endsWith(a) || s.endsWith(a + '구') || s.endsWith(a + '절')) {
      /* `명사구`/`명사절` 는 structural 로 위에서 이미 잡힘 */
      if (s.endsWith(a + '구') || s.endsWith(a + '절')) return 'structural';
      return 'atomic';
    }
  }

  return 'other';
}

function checkConditionGranularity(q: Question, findings: ContentFinding[]): void {
  if (!Array.isArray(q.conditions)) return;

  for (let ci = 0; ci < q.conditions.length; ci++) {
    const cond = String(q.conditions[ci] ?? '');
    if (isBoilerplate(cond)) continue;

    /* 「...」 블록 또는 [...] 블록 안의 + 슬롯 개수
       부록 룰: ≤7 권장, ≤14 절대 상한 */
    const blocks = [...cond.matchAll(/[「\[]([^」\]]+)[」\]]/g)].map(m => m[1]);
    for (const block of blocks) {
      const slotsRaw = block.split('+').map(s => s.trim()).filter(Boolean);
      const slots = slotsRaw.length;
      if (slots >= 15) {
        findings.push({
          level: 'error',
          code: 'COND_TOO_GRANULAR',
          qid: q.id,
          conditionIndex: ci,
          message: `Q${q.id} conditions[${ci}]: 블록 안 슬롯 ${slots}개 — 절대 상한 초과 (≤ 14)`,
          tokens: [String(slots)],
        });
      } else if (slots >= 8) {
        findings.push({
          level: 'warning',
          code: 'COND_GRANULAR',
          qid: q.id,
          conditionIndex: ci,
          message: `Q${q.id} conditions[${ci}]: 블록 안 슬롯 ${slots}개 — 단어 단위 나열 가능성 (권장 ≤ 7, 구조명 + 간단 슬롯힌트 형식 권장)`,
          tokens: [String(slots)],
        });
      }

      /* POS 원자 나열 검출: atomic 비율이 높고 structural 이 없거나 적으면 노출 */
      const classes = slotsRaw.map(classifySlot);
      const atomicCount = classes.filter(c => c === 'atomic').length;
      const structuralCount = classes.filter(c => c === 'structural').length;
      const known = atomicCount + structuralCount;
      if (known === 0) continue;
      const atomicRatio = atomicCount / known;

      if (atomicCount >= 5 && atomicRatio >= 0.8) {
        findings.push({
          level: 'error',
          code: 'COND_POS_ENUM',
          qid: q.id,
          conditionIndex: ci,
          message: `Q${q.id} conditions[${ci}]: 단어 단위 POS 원자 ${atomicCount}개 나열 (청크 ${structuralCount}개) — 「${block.trim()}」 형식. 구조명(명사구·관계대명사절·현재완료 수동 등)으로 묶어 단어 단위 어순 노출을 피할 것`,
          tokens: [`atomic=${atomicCount}`, `structural=${structuralCount}`],
        });
      } else if (atomicCount >= 4 && atomicRatio >= 0.7) {
        findings.push({
          level: 'warning',
          code: 'COND_POS_ENUM_HEAVY',
          qid: q.id,
          conditionIndex: ci,
          message: `Q${q.id} conditions[${ci}]: 단어 단위 POS 원자 ${atomicCount}개 (청크 ${structuralCount}개) — 청크 단위로 더 묶을 여지가 있음`,
          tokens: [`atomic=${atomicCount}`, `structural=${structuralCount}`],
        });
      }
    }
  }
}

/* ── 검사 4: 조건 ↔ answer punctuation/접속사 불일치 ──────────────────────── */
function checkConditionAnswerMismatch(q: Question, findings: ContentFinding[]): void {
  const ans = String(q.answer?.text ?? '');
  const condsJoined = (q.conditions ?? []).join('\n');

  /* punctuation 동기화 */
  const checks: Array<{ chars: RegExp; label: string; condTerm: RegExp; code: string }> = [
    { chars: /;/, label: '세미콜론', condTerm: /세미콜론/, code: 'COND_MISS_SEMICOLON' },
    { chars: /[─—–]/, label: '줄표', condTerm: /줄표|대시|—|─|–/, code: 'COND_MISS_EMDASH' },
    { chars: /:/, label: '콜론', condTerm: /콜론/, code: 'COND_MISS_COLON' },
    { chars: /\(/, label: '괄호', condTerm: /괄호|소괄호/, code: 'COND_MISS_PAREN' },
  ];
  for (const c of checks) {
    if (c.chars.test(ans) && !c.condTerm.test(condsJoined)) {
      findings.push({
        level: 'warning',
        code: c.code,
        qid: q.id,
        message: `Q${q.id}: answer 에 ${c.label} 이 있는데 조건에 명시 안 됨`,
      });
    }
  }

  /* 등위접속사 동기화 — answer 의 주요 등위가 조건에 언급되어야 함.
     단, 영어 단어로 직접 적으면 누설이므로 조건에는 "but 등위" 같은 형태가 흔히 등장.
     여기서는 단순 검사: answer 가 but 등위 라면 조건들 중 어딘가에 "but" 또는 "역접" 또는 "대조" 표현이 있어야 함. */
  if (/\bbut\b/i.test(ans) && !/but|역접|대조/i.test(condsJoined)) {
    findings.push({
      level: 'warning',
      code: 'COND_MISS_BUT',
      qid: q.id,
      message: `Q${q.id}: answer 의 but 등위가 조건에서 언급되지 않음`,
    });
  }
}

/* ── 종합 ───────────────────────────────────────────────────────────────────── */
export function auditContent(doc: EssayExamDoc & { _id: string }): ContentAuditResult {
  const findings: ContentFinding[] = [];
  const data = doc.data as ExamData | undefined;
  if (!data || !Array.isArray(data.questions)) {
    return {
      examId: doc._id,
      textbook: doc.textbook,
      sourceKey: doc.sourceKey,
      difficulty: doc.difficulty,
      folder: doc.folder,
      findings: [{ level: 'error', code: 'NO_DATA', message: 'data.questions 가 없음' }],
    };
  }

  for (const q of data.questions) {
    if (!q?.answer?.text) continue;
    const answerTokens = extractAnswerTokenSet(q.answer.text);
    const hyphen = extractAnswerHyphenWords(q.answer.text);

    checkConditionEnglishLeak(q, answerTokens, hyphen, findings);
    checkIntentContent(q, findings);
    checkConditionGranularity(q, findings);
    checkConditionAnswerMismatch(q, findings);
  }

  return {
    examId: doc._id,
    textbook: doc.textbook,
    sourceKey: doc.sourceKey,
    difficulty: doc.difficulty,
    folder: doc.folder,
    findings,
  };
}

/* ── 패턴 집계 리포트 (Markdown) ────────────────────────────────────────────── */
export interface ReportEntry {
  examId: string;
  textbook: string;
  sourceKey: string;
  difficulty: string;
  findings: ContentFinding[];
}

export function buildAuditReportMarkdown(
  textbook: string,
  entries: ReportEntry[],
  generatedAt: Date = new Date(),
): string {
  const dateStr = generatedAt.toISOString().slice(0, 10);
  const total = entries.length;
  const clean = entries.filter(e => e.findings.length === 0).length;
  const withErrors = entries.filter(e => e.findings.some(f => f.level === 'error')).length;
  const withWarnings = entries.filter(e => e.findings.some(f => f.level === 'warning')).length;

  /* 코드별 빈도 */
  const codeFreq = new Map<string, number>();
  for (const e of entries) {
    for (const f of e.findings) {
      codeFreq.set(f.code, (codeFreq.get(f.code) ?? 0) + 1);
    }
  }
  const sortedCodes = [...codeFreq.entries()].sort((a, b) => b[1] - a[1]);

  /* 토큰별 빈도 (COND_ENG_LEAK / COND_ENG_GENERIC 등) */
  const tokenFreq = new Map<string, number>();
  for (const e of entries) {
    for (const f of e.findings) {
      for (const t of f.tokens ?? []) {
        tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
      }
    }
  }
  const sortedTokens = [...tokenFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);

  const lines: string[] = [];
  lines.push(`# 점검 리포트 — ${textbook}`);
  lines.push(``);
  lines.push(`- 생성일: ${dateStr}`);
  lines.push(`- 총 ${total}건 · 클린 ${clean} · 오류 ${withErrors} · 경고 ${withWarnings}`);
  lines.push(``);
  lines.push(`## 핵심 패턴 빈도`);
  lines.push(``);
  for (const [code, n] of sortedCodes) {
    lines.push(`- ${code}: ${n}건`);
  }
  if (sortedTokens.length > 0) {
    lines.push(``);
    lines.push(`## 누설 영어 토큰 TOP ${sortedTokens.length}`);
    lines.push(``);
    for (const [tok, n] of sortedTokens) {
      lines.push(`- \`${tok}\` — ${n}건`);
    }
  }

  lines.push(``);
  lines.push(`## 프롬프트 보완 제안 (패턴 → 부록 §개정)`);
  lines.push(``);
  const suggestions: string[] = [];
  if ((codeFreq.get('COND_ENG_LEAK') ?? 0) > 0 || (codeFreq.get('COND_2GRAM_LEAK') ?? 0) > 0) {
    suggestions.push(
      `- **영어 본문 어휘 누설** (${(codeFreq.get('COND_ENG_LEAK') ?? 0) + (codeFreq.get('COND_2GRAM_LEAK') ?? 0)}건) → 부록 "조건 누설 금지" 룰을 모델이 무시 중. \`appendix\` 에 "조건 본문에 영어 알파벳이 등장하면 메타용어 화이트리스트(\`to부정사\`/\`be동사\`/\`-ing형\`/\`p.p.\`/\`S/V/O/C/M\`/\`SVOC\`/\`SVO\`/\`SV\`) 외에는 즉시 누설 — JSON 출력 전 (a)~(d) 자가검증 통과 필수" 를 더 strong 하게 반복.`,
    );
  }
  if ((codeFreq.get('COND_HYPHEN_LEAK') ?? 0) > 0 || (codeFreq.get('COND_HYPHEN_PART_LEAK') ?? 0) > 0) {
    suggestions.push(
      `- **하이픈 복합어 노출** (${(codeFreq.get('COND_HYPHEN_LEAK') ?? 0) + (codeFreq.get('COND_HYPHEN_PART_LEAK') ?? 0)}건) → 부록 §"3 단어 한 조각도 금지" 강조. 예: \`motion-sensing\` 통째로도 \`motion\`/\`sensing\` 조각도 X.`,
    );
  }
  if ((codeFreq.get('COND_TOO_GRANULAR') ?? 0) > 0 || (codeFreq.get('COND_GRANULAR') ?? 0) > 0) {
    suggestions.push(
      `- **슬롯 과세분화** (${(codeFreq.get('COND_TOO_GRANULAR') ?? 0) + (codeFreq.get('COND_GRANULAR') ?? 0)}건) → 부록에 "한 「...」블록 안 \`+\` 슬롯 ≤ 14, 초과 시 절·구 단위로 묶어 별 조건으로 분리" 명시.`,
    );
  }
  if ((codeFreq.get('INTENT_THIN') ?? 0) > 0 || (codeFreq.get('INTENT_TOO_SHORT') ?? 0) > 0 || (codeFreq.get('INTENT_MISSING') ?? 0) > 0) {
    suggestions.push(
      `- **intent_content 부실** (${(codeFreq.get('INTENT_THIN') ?? 0) + (codeFreq.get('INTENT_TOO_SHORT') ?? 0) + (codeFreq.get('INTENT_MISSING') ?? 0)}건) → 부록에 "intent_content 는 ① 평가 능력 ② 학생이 흔히 틀리는 지점 ③ 감점 기준 을 30자 이상으로 서술하라. 키워드 \`X·Y·Z 통합.\` 형태 금지" 추가.`,
    );
  }
  if (suggestions.length === 0) {
    suggestions.push(`- (자동 제안 없음. 패턴 빈도가 낮거나 클린.)`);
  }
  for (const s of suggestions) lines.push(s);

  lines.push(``);
  lines.push(`## 위반 상세 (오류만)`);
  lines.push(``);
  const errEntries = entries.filter(e => e.findings.some(f => f.level === 'error'));
  if (errEntries.length === 0) {
    lines.push(`- (오류 없음)`);
  } else {
    for (const e of errEntries) {
      const errs = e.findings.filter(f => f.level === 'error');
      lines.push(`### ${e.sourceKey} · ${e.difficulty} — \`${e.examId}\``);
      for (const f of errs) {
        lines.push(`- [${f.code}] ${f.message}`);
      }
      lines.push(``);
    }
  }

  return lines.join('\n');
}
