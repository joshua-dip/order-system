/**
 * 변형문제 주문 중복(겹침) 판정 — 단일 소스.
 *
 * 같은 고객이 동일한 (지문 × 유형) 조합을 다시 주문했는지 감지한다.
 *   - mockVariant : examSelections[{exam, numbers[]}] × selectedTypes
 *   - bookVariant : selectedTextbook + selectedLessons[] × selectedTypes
 * 겹침 = 두 주문의 (지문×유형) 키 집합 교집합이 1개 이상.
 *
 * 같은 지문·유형을 다시 주문해도 "새 문제로 재배정"이 가능하므로, 차단이 아니라
 * 경고(고객 확인) / 표시(관리자 뱃지) 용도로만 쓴다.
 */

type AnyMeta = Record<string, unknown> | null | undefined;

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** orderMeta 에서 (지문×유형) 정규화 키 집합 추출. 변형 주문이 아니면 빈 Set. */
export function extractOrderItemKeys(meta: AnyMeta): Set<string> {
  const keys = new Set<string>();
  if (!meta || typeof meta !== 'object') return keys;
  const flow = typeof meta.flow === 'string' ? meta.flow : '';
  const types = asArray(meta.selectedTypes).filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  if (types.length === 0) return keys;

  if (flow === 'mockVariant') {
    for (const sel of asArray(meta.examSelections)) {
      if (!sel || typeof sel !== 'object') continue;
      const s = sel as Record<string, unknown>;
      const exam = typeof s.exam === 'string' ? s.exam.trim() : '';
      if (!exam) continue;
      for (const num of asArray(s.numbers)) {
        const n = typeof num === 'string' ? num.trim() : String(num ?? '').trim();
        if (!n) continue;
        for (const t of types) keys.add(`M|${exam}|${n}|${t}`);
      }
    }
  } else if (flow === 'bookVariant') {
    const tb = typeof meta.selectedTextbook === 'string' ? meta.selectedTextbook.trim() : '';
    for (const lesson of asArray(meta.selectedLessons)) {
      const l = typeof lesson === 'string' ? lesson.trim() : '';
      if (!l) continue;
      for (const t of types) keys.add(`B|${tb}|${l}|${t}`);
    }
  }
  return keys;
}

/** 고객 식별 키 (이메일 우선, 없으면 빈 문자열). 소문자 정규화. */
export function orderCustomerEmail(meta: AnyMeta): string {
  if (!meta || typeof meta !== 'object') return '';
  return typeof meta.email === 'string' ? meta.email.trim().toLowerCase() : '';
}

/** 두 키 집합의 교집합 크기. */
export function overlapCount(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const k of small) if (big.has(k)) n += 1;
  return n;
}

/** 키에서 사람이 읽는 라벨 추출 — "exam #num · type" / "textbook lesson · type". */
export function describeOverlapKey(key: string): string {
  const parts = key.split('|');
  if (parts[0] === 'M') return `${parts[1]} ${parts[2]}번 · ${parts[3]}`;
  if (parts[0] === 'B') return `${parts[1]} ${parts[2]} · ${parts[3]}`;
  return key;
}
