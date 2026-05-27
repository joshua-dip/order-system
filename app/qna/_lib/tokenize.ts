/**
 * `sentence.split(/\s+/)` 기준 word index 와 정확히 맞는 토큰화.
 *
 * - svocData / grammarTags / syntaxPhrases 의 word index 컨벤션 (lib/syntax-analyzer-word-match.ts)
 *   과 동일한 split 규칙을 사용 → 토큰 인덱스로 그대로 매칭 가능.
 * - 한 토큰 안에서 알파벳·숫자 부분을 「클릭 가능한 본체」, 구두점·괄호 등을 「비클릭 trailing/leading」 으로 분리.
 *   학생 클릭 UX 는 본체만 활성화, OS 텍스트 선택은 그대로 동작.
 *
 * 예) "world."     → { leading: '',   core: 'world',   trailing: '.' }
 *     "(don't)"    → { leading: '(',  core: "don't",   trailing: ')' }
 *     "—dash"      → { leading: '—',  core: 'dash',    trailing: ''  }
 *
 * core 가 비면 부호만 있는 토큰 (예: "—") — 그땐 모두 trailing 으로 두고 클릭 비활성.
 */

export interface WordToken {
  /** split(/\s+/) 기준 인덱스 — svocData 매칭 키. */
  wordIndex: number;
  /** 원본 토큰 전체 ("world.") — 클립보드 복사 대상. */
  raw: string;
  /** 앞쪽 비-알파/숫자 (괄호·따옴표 등) */
  leading: string;
  /** 클릭 가능한 본체 (알파/숫자, 내부 아포스트로피·하이픈 허용) */
  core: string;
  /** 뒤쪽 구두점 (`.`, `?`, `)`, …) */
  trailing: string;
}

/**
 * 본체로 인정할 문자: 영문/숫자 + 한글 등 Unicode Letter/Number + 내부 분리자(아포스트로피·하이픈).
 *
 * `\p{L}` = Unicode Letter (라틴·한글·일문 등), `\p{N}` = Unicode Number.
 * 영문 토큰 동작은 그대로, 한글 어절("피아니스트가")도 본체로 인식되어 클릭 가능해진다.
 */
const CORE_RE = /^[\p{L}\p{N}][\p{L}\p{N}'’‘\-]*[\p{L}\p{N}]?$/u;
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

function splitOneToken(raw: string): { leading: string; core: string; trailing: string } {
  if (!raw) return { leading: '', core: '', trailing: '' };

  // 앞쪽 비-단어 문자 떼기
  let i = 0;
  while (i < raw.length && !WORD_CHAR_RE.test(raw[i])) i++;
  const leading = raw.slice(0, i);

  // 뒤쪽 비-단어 문자 떼기 (단, 본체 안의 ' 와 - 는 유지)
  let j = raw.length;
  while (j > i && !WORD_CHAR_RE.test(raw[j - 1])) j--;
  const trailing = raw.slice(j);

  const core = raw.slice(i, j);
  if (!core || !CORE_RE.test(core)) {
    return { leading: raw, core: '', trailing: '' };
  }
  return { leading, core, trailing };
}

export function tokenizeSentence(sentence: string): WordToken[] {
  if (!sentence) return [];
  const words = sentence.split(/\s+/).filter((w) => w.length > 0);
  return words.map((raw, idx) => {
    const { leading, core, trailing } = splitOneToken(raw);
    return { wordIndex: idx, raw, leading, core, trailing };
  });
}
