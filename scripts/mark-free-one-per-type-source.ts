import { getDb } from '@/lib/mongodb';
import type { ObjectId } from 'mongodb';

/**
 * 한 교재의 객관식 변형문제(generated_questions)를 (유형 type · 출처 source = 문항 번호) 조합마다
 * 1문항씩만 isFree=true 로 전환한다. 그 외에는 isFree=false 로 정리(해당 교재 범위 안에서만).
 *
 * - 객관식: type 이 '워크북' 으로 시작하지 않고 option_type 이 '서술형' 이 아닌 문항.
 * - 각 (type, source) 그룹에서 status='완료' 를 우선, 그다음 _id 오름차순으로 1개 선택.
 *
 * 사용:
 *   기본(dry-run, 변경 없음):
 *     node -r dotenv/config node_modules/.bin/tsx scripts/mark-free-one-per-type-source.ts dotenv_config_path=.env.local
 *   실제 적용:
 *     node -r dotenv/config node_modules/.bin/tsx scripts/mark-free-one-per-type-source.ts --apply dotenv_config_path=.env.local
 *   교재 지정:
 *     ... scripts/mark-free-one-per-type-source.ts --textbook "26년 6월 고2 영어모의고사" --apply ...
 */

const DEFAULT_TEXTBOOK = '26년 6월 고1 영어모의고사';

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  let textbook = DEFAULT_TEXTBOOK;
  const tbIdx = args.indexOf('--textbook');
  if (tbIdx >= 0 && args[tbIdx + 1]) textbook = args[tbIdx + 1];
  return { apply, textbook };
}

async function main() {
  const { apply, textbook } = parseArgs();
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const objectiveMatch = {
    textbook,
    type: { $not: /^워크북/ },
    option_type: { $ne: '서술형' },
  };

  const totalObjective = await col.countDocuments(objectiveMatch);
  console.log(`교재: ${textbook}`);
  console.log(`객관식 변형문제 총 ${totalObjective}건`);

  if (totalObjective === 0) {
    console.log('대상 문항이 없습니다. 종료.');
    return;
  }

  // (type, source) 그룹마다 대표 1개 선택 — 완료 우선, 그다음 _id 오름차순
  const groups = await col
    .aggregate<{ _id: { type: string; source: string }; chosen: ObjectId; count: number }>([
      { $match: objectiveMatch },
      {
        $addFields: {
          _isCompleted: { $cond: [{ $eq: ['$status', '완료'] }, 0, 1] },
        },
      },
      { $sort: { _isCompleted: 1, _id: 1 } },
      {
        $group: {
          _id: { type: '$type', source: '$source' },
          chosen: { $first: '$_id' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.source': 1, '_id.type': 1 } },
    ])
    .toArray();

  const chosenIds = groups.map((g) => g.chosen);
  console.log(`(유형·번호) 그룹 ${groups.length}개 → 무료 전환 대상 ${chosenIds.length}건`);
  console.log('— 그룹 미리보기 (최대 30개):');
  for (const g of groups.slice(0, 30)) {
    console.log(`  ${g._id.source} · ${g._id.type}  (그룹 ${g.count}건 중 1건 무료)`);
  }
  if (groups.length > 30) console.log(`  … 외 ${groups.length - 30}개 그룹`);

  if (!apply) {
    console.log('\n[dry-run] 실제 변경 없음. 적용하려면 --apply 를 붙여 다시 실행하세요.');
    return;
  }

  // 1) 해당 교재 객관식 전체 isFree=false 로 초기화
  const reset = await col.updateMany(objectiveMatch, { $set: { isFree: false } });
  // 2) 선택된 대표 문항만 isFree=true
  const setFree = await col.updateMany(
    { _id: { $in: chosenIds } },
    { $set: { isFree: true } }
  );

  console.log(`\n[적용 완료]`);
  console.log(`  초기화(isFree=false): ${reset.modifiedCount}건`);
  console.log(`  무료 전환(isFree=true): ${setFree.modifiedCount}건`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('실패:', e);
    process.exit(1);
  });
