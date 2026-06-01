/**
 * 어법 변형문제 해설(Explanation)이 "모든 밑줄이 옳다 / 정답이 없다 / 오류 없다"처럼
 * 5개 보기를 모두 정답으로 단언하여 사실상 정답 없는 문항이 되어버린 케이스 검출.
 *
 * 정상 패턴은 "정답 ④, 나머지는 모두 어법상 옳다" 형태이므로
 * 「나머지/그 외/이외/기타/다른」 같은 잔여 한정어가 같이 등장하면 정상으로 본다.
 * 단, "모든 밑줄", "5개 다 옳다", "오류 없다", "정답이 없다", "①~⑤ 모두 옳다",
 * "다섯 (개·곳) 다/모두 맞다·옳다" 류는 강한 시그널이라 잔여 한정어 여부와 무관하게 hit.
 */

export type AllCorrectMatch = {
  label: string;
  /** label 이 강한 시그널이라 "나머지…모두 옳다" 컨텍스트와 무관하게 적용됨 */
  strong: boolean;
};

const RULES: { label: string; re: RegExp; strong: boolean }[] = [
  {
    label: '모든 밑줄/보기 맞다',
    re: /모든\s*(밑줄|선택지|보기)[^。\.\n]{0,15}(맞|옳)/,
    strong: true,
  },
  {
    label: '다섯 밑줄/보기 다 맞다',
    re: /다섯\s*(개|곳)?\s*(밑줄|선택지|보기)?[^。\.\n]{0,15}(다|모두)[^。\.\n]{0,10}(맞|옳)/,
    strong: true,
  },
  {
    label: '①~⑤ 모두 옳다',
    re: /[①1]\s*[~∼\-]\s*[⑤5]\s*(은|는|이|가)?\s*모두/,
    strong: true,
  },
  {
    label: '5개 다 옳다',
    re: /(5|다섯)[^。\.\n]{0,10}(다|모두)\s*(옳|맞)/,
    strong: true,
  },
  {
    label: '오류/틀린 곳 없다',
    re: /(오류|틀린\s*(곳|것|부분))\s*(는|이|가)?\s*없/,
    strong: true,
  },
  { label: '정답이 없다', re: /정답\s*(이|은)?\s*없/, strong: true },
  // 약한 시그널: "모두 옳다" 만 있음. 잔여 한정어가 동반되면 정상 해설로 보고 제외.
  {
    label: '모두 옳다/맞다',
    re: /모두\s*(어법\s*상\s*)?(옳|맞)/,
    strong: false,
  },
  {
    label: '어법상 옳다(없다)',
    re: /어법\s*상\s*(틀린|잘못된)?[^。\.\n]{0,15}(없|옳)/,
    strong: false,
  },
];

const NORMAL_REMAINDER_RE = /(나머지|그\s*외|이외|이 외|기타|다른)[^。\.\n]{0,15}(은|는|이|가|모두)/;

/** 해설을 검사하고 hit한 레이블 목록을 돌려준다. 빈 배열이면 문제 없음. */
export function detectAllCorrectClaim(explanation: string): AllCorrectMatch[] {
  if (!explanation || typeof explanation !== 'string') return [];
  const hasRemainderQualifier = NORMAL_REMAINDER_RE.test(explanation);
  const out: AllCorrectMatch[] = [];
  const seen = new Set<string>();
  for (const r of RULES) {
    if (!r.re.test(explanation)) continue;
    if (!r.strong && hasRemainderQualifier) continue;
    if (seen.has(r.label)) continue;
    seen.add(r.label);
    out.push({ label: r.label, strong: r.strong });
  }
  return out;
}
