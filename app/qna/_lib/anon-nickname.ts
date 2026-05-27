/**
 * 작성자 자동 익명 닉네임 생성·영속 저장.
 *
 * 개인정보 보호 목적 — 학생이 본인 학원 로그인 ID 를 그대로 닉네임에 입력하는
 * 사고를 방지하기 위해 질문 작성 시 닉네임 입력란을 제거하고 자동으로 부여한다.
 *
 * - 키 `qna.nick` 에 단일 문자열로 보관. 같은 브라우저는 항상 같은 닉네임 사용.
 * - 형식: `익명` + 4자리 hex (예: `익명a3f9`). 충돌 가능하지만 thread 본인 식별은
 *   `qna.owners` 의 ownerToken 으로 별도 처리하므로 문제 없음.
 * - localStorage 사용 불가(SSR / 시크릿) 시 매 호출마다 새로 발급.
 */

const STORAGE_KEY = 'qna.nick';
const PREFIX = '익명';
const RAND_HEX_LEN = 4;

function randomSuffix(): string {
  // crypto.getRandomValues 가 있으면 사용, 없으면 Math.random fallback.
  const bytes = new Uint8Array(Math.ceil(RAND_HEX_LEN / 2));
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, RAND_HEX_LEN);
}

function generate(): string {
  return `${PREFIX}${randomSuffix()}`;
}

/** 저장된 익명 닉네임을 반환. 없으면 새로 만들어 저장 후 반환. */
export function getOrCreateAnonNickname(): string {
  if (typeof window === 'undefined') return generate();
  try {
    const cached = window.localStorage.getItem(STORAGE_KEY);
    if (cached && cached.startsWith(PREFIX) && cached.length >= PREFIX.length + 2) {
      return cached;
    }
    const fresh = generate();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return generate();
  }
}
