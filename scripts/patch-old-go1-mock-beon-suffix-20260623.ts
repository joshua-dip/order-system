/**
 * 옛 고1 영어모의고사(11~17년 계열) passages 의 비표준 번호 표기("38" → "38번") 정규화.
 *
 * 배경: 이 교재들만 passages.number / source_key 에 "번" 접미사가 빠진 채 import 됨
 *       (정상 모의고사는 "38번"). 그 결과 변형문제 생성 시 generated_questions.source 도
 *       "…38"(번 없음)으로 저장되어, source 문자열 일치로 집계하는 가용성/회차 리포트가
 *       해당 선택분을 통째 누락(주문 80인데 70 등)함. passage_id 기준 파이프라인은 정상.
 *
 * 대상: textbook 에 "모의고사" 포함 + number 가 "번" 없이 숫자/숫자~숫자 로 끝나는 지문.
 *       (현재 DB 기준 11~17년 고1 27개 교재 656지문. 17년 3월은 이전 패치로 이미 정상화 → 멱등.)
 *
 * 동작(지문당):
 *   - passages.number      : "38" → "38번", "41~42" → "41~42번"
 *   - passages.source_key  : "… 38" → "… 38번"
 *   - generated_questions.source : 같은 지문의 "… 38"(또는 "… · 38") → "… 38번" (문항 있는 지문만)
 *
 * 안전장치: 기본 dry-run(쓰기 없음). 충돌(이미 "번"형 존재) 검사. 관련 컬렉션 참조 스캔.
 *   실제 반영: --apply
 *
 *   npx tsx scripts/patch-old-go1-mock-beon-suffix-20260623.ts            # dry-run + 스캔
 *   npx tsx scripts/patch-old-go1-mock-beon-suffix-20260623.ts --apply    # 실제 반영
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId, type Document } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(ROOT, '.env') });
config({ path: path.join(ROOT, '.env.local') });

const APPLY = process.argv.includes('--apply');
const NUM_RE = /^\d{1,3}(?:~\d{1,3})?$/; // "번" 없는 숫자/숫자~숫자

async function main() {
  const db = await getDb('gomijoshua');
  const passagesCol = db.collection('passages');
  const gqCol = db.collection('generated_questions');

  // 1) 대상 지문 로드
  const affected = (await passagesCol
    .find({ textbook: /모의고사/, number: { $type: 'string', $regex: NUM_RE } })
    .project({ _id: 1, textbook: 1, number: 1, source_key: 1 })
    .toArray()) as Document[];

  const affectedTextbooks = [...new Set(affected.map((p) => String(p.textbook)))].sort();

  // 2) 충돌검사용: 대상 교재들의 기존 source_key 전체를 메모리에 적재
  const existingKeysByTextbook = new Map<string, Set<string>>();
  {
    const cur = passagesCol
      .find({ textbook: { $in: affectedTextbooks } })
      .project({ textbook: 1, source_key: 1 });
    for await (const d of cur) {
      const tb = String(d.textbook);
      if (!existingKeysByTextbook.has(tb)) existingKeysByTextbook.set(tb, new Set());
      existingKeysByTextbook.get(tb)!.add(String(d.source_key ?? ''));
    }
  }

  // 3) 문항이 있는 대상 지문 id 집합 (gq source 수정 대상 — 대부분 0)
  const idStrs = affected.map((p) => String(p._id));
  const ids = affected.map((p) => p._id as ObjectId);
  const gqPassageSet = new Set<string>();
  {
    const agg = await gqCol
      .aggregate([
        { $match: { $or: [{ passage_id: { $in: ids } }, { passage_id: { $in: idStrs } }] } },
        { $group: { _id: { $toString: '$passage_id' } } },
      ])
      .toArray();
    for (const r of agg) gqPassageSet.add(String(r._id));
  }

  // 4) 계획 + 충돌 검사
  const plan: Array<{
    _id: string;
    textbook: string;
    oldNumber: string;
    newNumber: string;
    oldSourceKey: string;
    newSourceKey: string;
    hasQuestions: boolean;
  }> = [];
  const collisions: string[] = [];

  for (const p of affected) {
    const textbook = String(p.textbook);
    const oldNumber = String(p.number ?? '');
    const oldSourceKey = String(p.source_key ?? '');
    if (!NUM_RE.test(oldNumber)) continue;
    const newNumber = `${oldNumber}번`;
    const expectedOld = `${textbook} ${oldNumber}`;
    const newSourceKey =
      oldSourceKey === expectedOld
        ? `${textbook} ${newNumber}`
        : oldSourceKey.replace(/(\d{1,3}(?:~\d{1,3})?)\s*$/, '$1번');

    if (existingKeysByTextbook.get(textbook)?.has(newSourceKey)) {
      collisions.push(`${oldSourceKey} → ${newSourceKey} (이미 존재)`);
    }
    plan.push({
      _id: String(p._id),
      textbook,
      oldNumber,
      newNumber,
      oldSourceKey,
      newSourceKey,
      hasQuestions: gqPassageSet.has(String(p._id)),
    });
  }

  // 5) 관련 제품 컬렉션이 옛 source_key 를 join 키로 들고 있는지 스캔(읽기 전용)
  const oldKeys = plan.map((x) => x.oldSourceKey);
  const refScan: Record<string, unknown> = {};
  for (const c of ['narrative_questions', 'essay_exams', 'essay_step_workbooks', 'block_workbooks', 'grammar_workbooks']) {
    try {
      const col = db.collection(c);
      const byTextbook = await col.countDocuments({ textbook: { $in: affectedTextbooks } }).catch(() => 0);
      const byOldSourceKey = oldKeys.length
        ? await col
            .countDocuments({ $or: [{ sourceKey: { $in: oldKeys } }, { source_key: { $in: oldKeys } }, { source: { $in: oldKeys } }] })
            .catch(() => 0)
        : 0;
      refScan[c] = { byTextbook, byOldSourceKey };
    } catch {
      refScan[c] = { error: 'scan failed' };
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? 'APPLY (쓰기)' : 'DRY-RUN (읽기 전용)',
        affectedTextbooks: affectedTextbooks.length,
        passagesToRename: plan.length,
        passagesWithQuestions: plan.filter((x) => x.hasQuestions).length,
        collisions,
        relatedCollectionRefScan: refScan,
        textbookList: affectedTextbooks,
        sample: plan.slice(0, 4),
      },
      null,
      2
    )
  );

  if (collisions.length > 0) {
    console.error('\n⛔ 충돌 발견 — 적용 중단.');
    process.exit(2);
  }
  if (!APPLY) {
    console.log('\n(드라이런입니다. 실제 반영하려면 --apply)');
    return;
  }

  // 6) 반영 — passages 는 bulkWrite, gq 는 문항 있는 지문만
  const ops = plan.map((x) => ({
    updateOne: {
      filter: { _id: new ObjectId(x._id) },
      update: { $set: { number: x.newNumber, source_key: x.newSourceKey } },
    },
  }));
  let pModified = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const res = await passagesCol.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    pModified += res.modifiedCount ?? 0;
  }

  let gqModified = 0;
  for (const x of plan) {
    if (!x.hasQuestions) continue;
    const passageIdOr: Record<string, unknown>[] = [{ passage_id: x._id }];
    if (ObjectId.isValid(x._id)) passageIdOr.push({ passage_id: new ObjectId(x._id) });
    const sourceCandidates = [x.oldSourceKey, `${x.textbook} ${x.oldNumber}`, `${x.textbook} · ${x.oldNumber}`];
    const r = await gqCol.updateMany(
      { $and: [{ $or: passageIdOr }, { source: { $in: sourceCandidates } }] },
      { $set: { source: x.newSourceKey } }
    );
    gqModified += r.modifiedCount;
  }

  console.log(`\n✅ 반영 완료 — passages ${pModified}건, generated_questions.source ${gqModified}건 갱신`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
