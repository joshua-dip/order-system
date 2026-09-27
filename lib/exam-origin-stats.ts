/**
 * 「끌어오기」 집계 — 기출 지문이 원출처 지문에서 끌어온 변형문제 수.
 *
 * 기출 교재(또는 기출 지문이 섞인 부교재)의 문항은 자기 교재에 없고 원출처(모의고사) 지문에 달려 있다.
 * 문제수 시각화·관리 목록은 자체 문항과 끌어온 문항을 따로 보여 줘야 하므로(합계에 이중으로 넣지 않는다)
 * 그 둘을 가르는 조회를 여기 모은다. 원출처 판정 자체는 lib/exam-origin.ts.
 */
import { ObjectId, type Db } from 'mongodb';
import { resolveExamOrigins, type ExamOrigin } from '@/lib/exam-origin';

export type StatusCounts = { total: number; 완료: number; 대기: number; 검수불일치: number; 기타: number };

const LINKED_FILTER = {
  $or: [
    { original_passage_id: { $nin: [null, ''] } },
    { passage_source: { $type: 'string', $ne: '' } },
  ],
};

export function emptyStatusCounts(): StatusCounts {
  return { total: 0, 완료: 0, 대기: 0, 검수불일치: 0, 기타: 0 };
}

export function addStatus(c: StatusCounts, status: unknown, n: number): void {
  c.total += n;
  if (status === '완료' || status === '대기' || status === '검수불일치') c[status] += n;
  else c.기타 += n;
}

/** 원출처를 끌어오는 기출 지문들 (textbook 을 주면 그 교재만) */
export async function loadPulledPassages(db: Db, textbook?: string): Promise<ExamOrigin[]> {
  const linked = await db
    .collection('passages')
    .find(textbook ? { textbook, ...LINKED_FILTER } : LINKED_FILTER)
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  if (linked.length === 0) return [];
  const origins = await resolveExamOrigins(db, linked.map((p) => p._id));
  return [...origins.values()];
}

/** passage_id 는 ObjectId·문자열 두 형태로 저장돼 있어 둘 다 건다 */
export function passageIdInFilter(ids: readonly ObjectId[]): Record<string, unknown> {
  return { $or: [{ passage_id: { $in: [...ids] } }, { passage_id: { $in: ids.map((id) => id.toHexString()) } }] };
}

/** 원출처 지문별 × 유형별 상태 건수. 결과 키는 지문 hex. */
export async function countQuestionsByPassageType(
  db: Db,
  passageIds: readonly ObjectId[],
): Promise<Map<string, Map<string, StatusCounts>>> {
  const out = new Map<string, Map<string, StatusCounts>>();
  if (passageIds.length === 0) return out;
  const agg = await db
    .collection('generated_questions')
    .aggregate([
      { $match: { ...passageIdInFilter(passageIds), type: { $ne: '워크북어법' } } },
      { $group: { _id: { pid: { $toString: '$passage_id' }, type: '$type', status: '$status' }, n: { $sum: 1 } } },
    ])
    .toArray();
  for (const r of agg) {
    const pid = String(r._id?.pid ?? '');
    const type = String(r._id?.type ?? '');
    if (!pid || !type) continue;
    const byType = out.get(pid) ?? out.set(pid, new Map()).get(pid)!;
    const c = byType.get(type) ?? byType.set(type, emptyStatusCounts()).get(type)!;
    addStatus(c, r._id?.status, Number(r.n ?? 0));
  }
  return out;
}

/** 끌어오는 교재 → 연결된 기출 지문 수 (관리 화면 라벨용) */
export async function loadPullingTextbooks(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const o of await loadPulledPassages(db)) out[o.viaTextbook] = (out[o.viaTextbook] ?? 0) + 1;
  return out;
}
