/**
 * 서술형 워크북 지문 묶기 — 「01강 01번」 같은 키에서 단원을 뽑는다.
 *
 * 지문이 수백 개인 교재(첫단추 297·메가스터디 236·2027수능특강 219)가 평면
 * 격자로 깔려 있어 「3강만 담기」 같은 일상적인 선택이 스크롤 노동이었다.
 *
 * 교재마다 키 모양이 제각각이라(01강 01번 / Lesson 1 본문1 / CHAPTER 01 주어의 이해 1번 /
 * Chapter 0 ─ QN 21 수능 Check-Up 01번 / 고난도 모의고사 11회 18번) 접두사를
 * 열거하는 방식은 곧 깨진다. 대신 **숫자를 품은 첫 토큰까지**를 단원으로 본다 —
 * 위 다섯 가지가 각각 01강 · Lesson 1 · CHAPTER 01 · Chapter 0 · 고난도 모의고사 11회
 * 로 떨어진다.
 */

/** 숫자를 품은 첫 토큰까지가 단원. 숫자가 없으면 라벨 전체. */
export function unitOf(label: string): string {
  const toks = String(label ?? '').trim().split(/\s+/);
  for (let i = 0; i < toks.length; i += 1) {
    if (/\d/.test(toks[i])) return toks.slice(0, i + 1).join(' ');
  }
  return toks.join(' ');
}

export interface PassageGroup<T> {
  unit: string;
  items: T[];
}

/**
 * 라벨 기준으로 묶는다. 원래 순서를 유지한다(API 가 이미 번호순으로 준다).
 *
 * 묶어도 의미가 없을 때 — 단원 수가 지문 수와 별로 다르지 않을 때 — 는 `null`.
 * 모의고사처럼 라벨이 「18번」뿐인 교재는 단원이 지문 수만큼 생겨 오히려 방해가 된다.
 */
export function groupPassages<T>(
  items: T[],
  labelOf: (item: T) => string,
): PassageGroup<T>[] | null {
  if (items.length === 0) return null;
  const map = new Map<string, T[]>();
  for (const it of items) {
    const u = unitOf(labelOf(it));
    const arr = map.get(u);
    if (arr) arr.push(it);
    else map.set(u, [it]);
  }
  /* 단원당 평균 2개도 안 되면 묶는 뜻이 없다. */
  if (map.size * 2 > items.length) return null;
  return [...map.entries()].map(([unit, list]) => ({ unit, items: list }));
}
