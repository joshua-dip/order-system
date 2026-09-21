/**
 * 빈칸쓰기 생성 — payperic ADJ/KEYWORD/NOUN/PREP/VERB 샘플 규칙 복원.
 * spaCy POS 대신 전치사·형용사·동사 휴리스틱 + 불용어 (배포용 순수 TS).
 */
import type { BlankHit, BlankKind, BlankPassageResult, KitPassageInput } from './types';
import { joinTokens, tokenizeWords, type Token } from './tokenize';

const PREPS = new Set(
  `about above across after against along among around as at before behind below beneath beside between beyond by despite down during except for from in inside into near of off on onto out outside over past per since through throughout to toward towards under underneath until unto up upon via with within without`
    .split(/\s+/),
);

const STOP = new Set(
  `a an the and or but so if then than that this these those there here it its it's i i'm i've i'd i'll you your you're we we're they they're he she his her him them us me my mine our their theirs what which who whom whose when where why how not no nor can could may might must shall should will would do does did done have has had having be am is are was were been being to of in on at for from with as by about into onto upon over under between among during through after before against without within until while once just also only even still already yet too very much many more most some any each every both few other another such same own so than rather quite`
    .split(/\s+/),
);

const AUX = new Set(
  `am is are was were be been being have has had having do does did doing will would shall should can could may might must`
    .split(/\s+/),
);

const COMMON_ADJ = new Set(
  `good bad big small large little long short high low early late young old new next last first second third better best worse worst more most many much few several other another same different various personal private public free full empty open closed true false real hard soft easy difficult simple complex clear unclear important special great huge tiny pretty beautiful delicious colorful unexpected electrical upcoming original delayed long harsh key biographical revealing personal better tasty awesome poor proper amazing fascinating terrific`
    .split(/\s+/),
);

const IRREG_VERBS = new Set(
  `go goes went gone come comes came coming see saw seen take took taken make made give gave given get got gotten know knew known think thought say said tell told find found leave left feel felt keep kept begin began begun become became bring brought build built buy bought catch caught choose chose chosen cut draw drew drawn drink drank drive drove driven eat ate eaten fall fell fallen fight fought fly flew flown forget forgot forgotten grow grew grown hear heard hold held hurt lead led lose lost mean meant meet met pay paid put read ride rode ridden run ran sing sang sung sit sat sleep slept speak spoke spoken spend spent stand stood steal stole stolen swim swam teach taught throw threw thrown understand understood wake woke wear wore worn win won write wrote written`
    .split(/\s+/),
);

function stripPunct(w: string): string {
  return w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').toLowerCase();
}

function looksAdj(word: string): boolean {
  const w = stripPunct(word);
  if (!w || STOP.has(w) || PREPS.has(w)) return false;
  if (COMMON_ADJ.has(w)) return true;
  if (/^(un|in|im|ir|dis|non)/.test(w) && w.length > 5) return true;
  return /(?:ous|ious|ful|less|ive|ical|able|ible|al|ic|ish|ary|ory|ent|ant|ese|ian|ed|ing|y)$/.test(w) &&
    !AUX.has(w) &&
    w.length > 3;
}

function looksVerb(word: string, prev: string): boolean {
  const w = stripPunct(word);
  if (!w || STOP.has(w) || PREPS.has(w)) return false;
  if (IRREG_VERBS.has(w)) return true;
  if (AUX.has(w)) return true;
  if (AUX.has(prev) || prev === 'to') return true;
  return /(?:ed|ing|ize|ise|ate|ify|en)$/.test(w) && w.length > 3;
}

function looksNoun(word: string, prev: string, isFirst: boolean): boolean {
  const w = stripPunct(word);
  if (!w || STOP.has(w) || PREPS.has(w) || AUX.has(w)) return false;
  if (looksAdj(word) && !/^[A-Z]/.test(word.replace(/^[^A-Za-z]+/, ''))) {
    /* 형용사로도 잡히면 명사 후보에서 약하게 */
  }
  if (['a', 'an', 'the', 'my', 'your', 'his', 'her', 'their', 'our', 'this', 'that', 'these', 'those'].includes(prev)) {
    return true;
  }
  const surface = word.replace(/^[^A-Za-z]+/, '');
  if (!isFirst && /^[A-Z]/.test(surface) && w.length > 1) return true;
  if (/(?:tion|sion|ment|ness|ity|ance|ence|ship|hood|ism|ist|age|ure|er|or|ist|ee)$/.test(w)) return true;
  return !looksVerb(word, prev) && !looksAdj(word) && w.length > 2;
}

function isKeywordCandidate(word: string): boolean {
  const w = stripPunct(word);
  if (!w || w.length < 2) return false;
  if (STOP.has(w) || PREPS.has(w) || AUX.has(w)) return false;
  if (/^\d+$/.test(w)) return true; // 1st 등 숫자도 키워드 샘플에 있음
  return true;
}

function matchKind(kind: BlankKind, token: Token, prev: string, isFirst: boolean): boolean {
  if (!token.isWord) return false;
  switch (kind) {
    case 'prep':
      return PREPS.has(stripPunct(token.word));
    case 'adj':
      return looksAdj(token.raw);
    case 'verb':
      return looksVerb(token.raw, prev);
    case 'noun':
      return looksNoun(token.raw, prev, isFirst);
    case 'keyword':
      return isKeywordCandidate(token.raw);
    default:
      return false;
  }
}

function blankTokenDisplay(n: number): string {
  return `(${n}) __________`;
}

/**
 * 한 지문 → 빈칸 본문 + 정답열.
 * keyword 는 밀도가 높아 연속 빈칸이 많고, prep/adj 는 해당 POS만.
 */
export function generateBlankPassage(
  passage: KitPassageInput,
  kind: BlankKind,
): BlankPassageResult {
  const blankedLines: string[] = [];
  const koLines: string[] = [];
  const answers: BlankHit[] = [];
  let n = 0;

  const ens = passage.sentencesEn.length
    ? passage.sentencesEn
    : [];
  const kos = passage.sentencesKo;

  for (let si = 0; si < ens.length; si++) {
    const en = ens[si] ?? '';
    const tokens = tokenizeWords(en);
    const out: Token[] = [];
    let prevWord = '';
    let wordIdx = 0;
    for (const t of tokens) {
      if (!t.isWord) {
        out.push(t);
        continue;
      }
      const isFirst = wordIdx === 0;
      wordIdx++;
      if (matchKind(kind, t, prevWord, isFirst)) {
        n += 1;
        const answer = t.word || stripPunct(t.raw);
        answers.push({ n, answer });
        /* 앞뒤 구두점은 raw 에 있을 수 있음 — 앞 구두점 유지 */
        const lead = t.raw.match(/^[^A-Za-z0-9]*/)?.[0] ?? '';
        const trail = t.raw.match(/[^A-Za-z0-9]*$/)?.[0] ?? '';
        out.push({ raw: `${lead}${blankTokenDisplay(n)}${trail}`, word: '', isWord: false });
      } else {
        out.push(t);
      }
      prevWord = stripPunct(t.word);
    }
    blankedLines.push(joinTokens(out));
    koLines.push((kos[si] ?? '').trim());
  }

  return {
    sourceKey: passage.sourceKey,
    kind,
    blankedLines,
    koLines,
    answers,
  };
}

export function blankKindFromType(t: string): BlankKind | null {
  if (!t.startsWith('blank_')) return null;
  const k = t.slice(6) as BlankKind;
  return (['adj', 'keyword', 'noun', 'prep', 'verb'] as BlankKind[]).includes(k) ? k : null;
}
