/**
 * 비로그인 작성자가 본인 글을 식별하기 위한 localStorage 토큰 저장소.
 *
 * - 키 1개(`qna.owners`)에 `{ [threadId]: token }` 단일 객체로 보관 → 글이 늘어도 키 N개로 안 흩어진다.
 * - 서버 응답으로 받은 plaintext token (UUID) 을 여기 저장하고, DELETE 시 헤더로 전송.
 * - 서버는 sha256 해시만 보유 — localStorage 가 비면 본인 글 식별·삭제 불가 (의도).
 */

const STORAGE_KEY = 'qna.owners';

type OwnerMap = Record<string, string>;

function readMap(): OwnerMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // 값이 string 인 것만 살림
      const out: OwnerMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && v.length > 0) out[k] = v;
      }
      return out;
    }
  } catch {
    /* fallthrough */
  }
  return {};
}

function writeMap(map: OwnerMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* 용량 초과 등 — 조용히 실패 */
  }
}

export function getOwnerToken(threadId: string): string | undefined {
  return readMap()[threadId];
}

export function setOwnerToken(threadId: string, token: string): void {
  const map = readMap();
  map[threadId] = token;
  writeMap(map);
}

export function removeOwnerToken(threadId: string): void {
  const map = readMap();
  if (map[threadId]) {
    delete map[threadId];
    writeMap(map);
  }
}

/** 한 페이지 진입 시 한 번에 본인 여부 매핑을 가져올 때 사용 */
export function getOwnerTokenSet(): Set<string> {
  return new Set(Object.keys(readMap()));
}
