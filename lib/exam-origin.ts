/**
 * 기출 지문 → 원출처 지문 (「끌어오기」).
 *
 * 기출문제집(올림포스 전국연합 기출 등)이나 기출 지문이 섞인 부교재의 지문은 **원출처(모의고사·수능) 지문이 주인**이다.
 * 기출 지문 자신은 변형문제를 갖지 않고, 원출처 지문에 달린 변형문제를 끌어와 쓴다(2026-09-27 원장님 정책).
 * 그래서 문항 집계·부족분·주문 출고·새 문항 저장이 모두 이 함수로 지문을 원출처로 바꿔 본다.
 *
 * 연결 정보는 지문(passages)에 있다.
 *   - original_passage_id : 원출처 지문 _id (있으면 우선)
 *   - passage_source      : 원출처 source_key (예: "25년 9월 고1 영어모의고사 18번") — id 가 없을 때 이름으로 찾는다
 * 둘 다 없으면 기출 지문이 아니다(자기 자신).
 */
import { ObjectId, type Db } from 'mongodb';

export type ExamOrigin = {
  /** 원출처 지문 */
  originId: ObjectId;
  originTextbook: string;
  originSourceKey: string;
  /** 끌어온 쪽(기출 교재) 지문 */
  viaTextbook: string;
  viaSourceKey: string;
};

type PassageLinkDoc = {
  _id: ObjectId;
  textbook?: unknown;
  source_key?: unknown;
  original_passage_id?: unknown;
  passage_source?: unknown;
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const MOCK_TEXTBOOK = /영어모의고사|^수능_\d{4}|^고[123]_\d{4}_/;

function toOid(v: unknown): ObjectId | null {
  if (v instanceof ObjectId) return v;
  if (typeof v === 'string' && ObjectId.isValid(v)) return new ObjectId(v);
  return null;
}

/** "25년 9월 …" ↔ "2025년 9월 …" 두 표기를 모두 후보로 */
export function passageSourceVariants(ps: string): string[] {
  const s = ps.trim();
  if (!s) return [];
  const out = new Set([s]);
  const short = s.replace(/\b(19|20)(\d{2})년/, '$2년');
  out.add(short);
  const m = short.match(/^(\d{2})년/);
  if (m) out.add(short.replace(/^(\d{2})년/, `20${m[1]}년`));
  return [...out];
}

/**
 * 지문 id 들 → { 기출 지문 hex → 원출처 } . 기출이 아닌 지문은 결과에 없다.
 * 연결 필드가 없는 지문은 DB 조회 한 번으로 끝난다(대부분의 교재).
 */
export async function resolveExamOrigins(db: Db, passageIds: readonly (ObjectId | string)[]): Promise<Map<string, ExamOrigin>> {
  const out = new Map<string, ExamOrigin>();
  const ids = [...new Set(passageIds.map((x) => String(x)))].filter((x) => ObjectId.isValid(x)).map((x) => new ObjectId(x));
  if (ids.length === 0) return out;
  const col = db.collection<PassageLinkDoc>('passages');
  const linked = await col
    .find({
      _id: { $in: ids },
      $or: [
        { original_passage_id: { $nin: [null, ''] } },
        { passage_source: { $type: 'string', $ne: '' } },
      ],
    })
    .project<PassageLinkDoc>({ _id: 1, textbook: 1, source_key: 1, original_passage_id: 1, passage_source: 1 })
    .toArray();
  if (linked.length === 0) return out;

  const byId = new Map<string, PassageLinkDoc>();
  const wantIds: ObjectId[] = [];
  const wantKeys = new Set<string>();
  for (const p of linked) {
    const oid = toOid(p.original_passage_id);
    if (oid) wantIds.push(oid);
    else for (const k of passageSourceVariants(str(p.passage_source))) wantKeys.add(k);
  }
  const origins = await col
    .find({ $or: [{ _id: { $in: wantIds } }, ...(wantKeys.size ? [{ source_key: { $in: [...wantKeys] } }] : [])] })
    .project<PassageLinkDoc>({ _id: 1, textbook: 1, source_key: 1 })
    .toArray();
  const byKey = new Map<string, PassageLinkDoc[]>();
  for (const o of origins) {
    byId.set(String(o._id), o);
    const k = str(o.source_key);
    if (k) (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(o);
  }

  for (const p of linked) {
    const selfHex = String(p._id);
    const selfTb = str(p.textbook);
    let origin: PassageLinkDoc | undefined;
    const oid = toOid(p.original_passage_id);
    if (oid) origin = byId.get(String(oid));
    if (!origin) {
      const cands = passageSourceVariants(str(p.passage_source))
        .flatMap((k) => byKey.get(k) ?? [])
        .filter((o) => String(o._id) !== selfHex && str(o.textbook) !== selfTb);
      /* 같은 이름이 여러 교재에 있으면 모의고사 원문을 고른다 */
      origin = cands.find((o) => MOCK_TEXTBOOK.test(str(o.textbook))) ?? cands[0];
    }
    if (!origin || String(origin._id) === selfHex) continue;
    out.set(selfHex, {
      originId: origin._id,
      originTextbook: str(origin.textbook),
      originSourceKey: str(origin.source_key),
      viaTextbook: selfTb,
      viaSourceKey: str(p.source_key),
    });
  }
  return out;
}

/** 끌어온 곳 표기 — "2026 올림포스 … 고1 · UNIT 01 01번" */
export function pulledViaLabel(o: ExamOrigin): string {
  return [o.viaTextbook, o.viaSourceKey].filter(Boolean).join(' · ');
}

/**
 * 지문 문서 목록에서 기출 지문을 원출처 지문 문서로 바꾼다(중복 제거, 순서 유지).
 * 바뀐 문서에는 pulledVia(끌어온 곳)가 붙는다. 집계·부족분·검수 범위가 원출처를 보게 된다.
 */
export async function swapToExamOrigins<T extends { _id: ObjectId; textbook?: unknown; source_key?: unknown }>(
  db: Db,
  docs: T[],
): Promise<{ docs: (T & { pulledVia?: string })[]; origins: Map<string, ExamOrigin>; pulledCount: number }> {
  const origins = await resolveExamOrigins(db, docs.map((d) => d._id));
  if (origins.size === 0) return { docs, origins, pulledCount: 0 };
  const seen = new Set<string>();
  const outDocs: (T & { pulledVia?: string })[] = [];
  for (const d of docs) {
    const o = origins.get(String(d._id));
    const next = o
      ? ({ ...d, _id: o.originId, textbook: o.originTextbook, source_key: o.originSourceKey, pulledVia: pulledViaLabel(o) } as T & { pulledVia?: string })
      : d;
    const k = String(next._id);
    if (seen.has(k)) continue;
    seen.add(k);
    outDocs.push(next);
  }
  return { docs: outDocs, origins, pulledCount: origins.size };
}
