/**
 * 로그인 아이디 표기 흔들림 흡수.
 *
 * 회원 아이디는 대부분 휴대폰 번호인데 DB 에는 하이픈 없이(`01012345678`) 저장돼 있다.
 * 그런데 회원은 자기 번호를 자연스럽게 `010-1234-5678` 로 친다. 로그인은
 * `findOne({ loginId })` 정확일치라, 하이픈을 넣으면 계정을 못 찾고
 * "아이디 또는 비밀번호가 올바르지 않습니다" 가 뜬다 — 아이디 문제인데
 * 비밀번호를 의심하게 만드는 메시지라, 회원은 비밀번호만 계속 바꿔 넣게 된다.
 *
 * 그래서 **전화번호처럼 생긴 입력만** 숫자만 남긴 형태로 한 번 더 찾아본다.
 * `admin` 처럼 글자가 든 아이디는 손대지 않는다(숫자를 남기면 빈 값이 되거나
 * 엉뚱한 계정과 부딪칠 수 있다).
 */

/** 숫자와 구분기호(-, 공백, 점, 괄호)로만 이뤄졌는지 — 전화번호 표기로 볼 수 있는 형태 */
const PHONE_SHAPED = /^[\d\s().-]+$/;

/**
 * 전화번호형 입력이면 숫자만 남겨 돌려준다. 그 외에는 `null`.
 *
 * `null` 이면 호출부는 **원본을 그대로** 써야 한다 — 정규화가 필요 없다는 뜻이다.
 */
export function normalizePhoneLoginId(raw: string): string | null {
  const value = raw.trim();
  if (!value || !PHONE_SHAPED.test(value)) return null;

  const digits = value.replace(/\D/g, '');
  // 국내 휴대폰·유선 번호 길이만 받는다. 너무 짧거나 길면 오히려 남의 계정에 닿을 수 있다.
  if (digits.length < 9 || digits.length > 11) return null;
  // 이미 숫자뿐이면 다시 찾을 이유가 없다.
  if (digits === value) return null;

  return digits;
}
