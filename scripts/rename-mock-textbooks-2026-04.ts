/**
 * 2026-04-17 일괄 업로드된 12종 고2 학평 모의고사를 기존 명명 패턴으로 표준화합니다.
 *
 *   현재 :  고2_2021_03월(서울시)
 *   표준화: 21년 3월 고2 영어모의고사 (서울시)
 *
 *   드라이런 (기본):
 *     DOTENV_CONFIG_PATH=.env.local npx tsx scripts/rename-mock-textbooks-2026-04.ts
 *
 *   실제 적용:
 *     DOTENV_CONFIG_PATH=.env.local npx tsx scripts/rename-mock-textbooks-2026-04.ts --apply
 *
 * 변경 대상
 *   - passages.textbook / chapter / source_key (300건 예상)
 *   - orders.orderText 안에 등장하는 12종 라인 (현재 1건)
 */
import { config } from 'dotenv';
config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

import { getDb } from '../lib/mongodb';

const APPLY = process.argv.includes('--apply');

/** `고2_YYYY_MM월(지역)[메모]` → `YY년 M월 고2 영어모의고사 (지역)` 또는 `(지역, 메모)` */
function standardize(name: string): string | null {
  const m = name.match(/^(고[12])_(\d{4})_(\d{1,2})월\(([^)]+)\)(?:\[([^\]]+)\])?$/);
  if (!m) return null;
  const [, grade, yyyy, mm, region, memo] = m;
  const yy = yyyy.slice(-2);
  const monthNum = String(parseInt(mm, 10));
  const trailing = memo ? `(${region}, ${memo})` : `(${region})`;
  return `${yy}년 ${monthNum}월 ${grade} 영어모의고사 ${trailing}`;
}

async function main() {
  const db = await getDb('gomijoshua');

  const distinct = (await db
    .collection('passages')
    .distinct('textbook', { textbook: { $regex: /^고[12]_\d{4}_/ } })) as string[];

  if (distinct.length === 0) {
    console.log('변환 대상이 없습니다. 이미 표준화 완료된 것으로 보입니다.');
    return;
  }

  type Mapping = { from: string; to: string; passages: number };
  const mappings: Mapping[] = [];
  const conflicts: string[] = [];

  for (const from of distinct.sort()) {
    const to = standardize(from);
    if (!to) {
      console.warn(`패턴 매칭 실패 (건너뜀): ${from}`);
      continue;
    }
    const collide = await db.collection('passages').countDocuments({ textbook: to });
    if (collide > 0) {
      conflicts.push(`${from} → ${to} (목표 이름에 이미 ${collide}건 존재)`);
      continue;
    }
    const passages = await db.collection('passages').countDocuments({ textbook: from });
    mappings.push({ from, to, passages });
  }

  console.log('───────────────────────────────────────────────');
  console.log(`${APPLY ? '적용' : '드라이런'} · 변환 대상: ${mappings.length}종`);
  console.log('───────────────────────────────────────────────');
  for (const m of mappings) {
    console.log(`  ${m.from}`);
    console.log(`    → ${m.to}   (passages ${m.passages}건)`);
  }
  if (conflicts.length > 0) {
    console.log('\n⚠ 충돌(중복 이름) 때문에 건너뛴 항목:');
    for (const c of conflicts) console.log(`  - ${c}`);
  }

  // orders.orderText 안에 등장하는 12종 라인 수도 함께 미리보기
  const ordersAffected = await db
    .collection('orders')
    .find({ orderText: { $in: mappings.map((m) => new RegExp(escapeRegex(m.from))) } })
    .project({ _id: 1, orderNumber: 1 })
    .toArray();
  console.log(`\norders.orderText 영향: ${ordersAffected.length}건`);
  for (const o of ordersAffected) {
    console.log(`  - ${(o as { orderNumber?: string }).orderNumber ?? o._id}`);
  }

  if (!APPLY) {
    console.log('\n드라이런 종료. 실제 적용은 --apply 플래그를 추가하세요.');
    return;
  }

  // 적용
  let totalPassages = 0;
  let totalOrders = 0;
  for (const m of mappings) {
    const now = new Date();
    const r = await db.collection('passages').updateMany(
      { textbook: m.from },
      [
        {
          $set: {
            textbook: m.to,
            chapter: m.to,
            source_key: {
              $concat: [m.to, ' ', { $ifNull: ['$number', ''] }],
            },
            updated_at: now,
          },
        },
      ],
    );
    totalPassages += r.modifiedCount;
    console.log(`✓ passages: ${m.from} → ${m.to} (${r.modifiedCount}건)`);
  }

  // orders.orderText 단순 문자열 치환
  const allOrders = await db
    .collection('orders')
    .find({ orderText: { $regex: '고[12]_\\d{4}_' } })
    .toArray();
  for (const o of allOrders) {
    let text = (o as { orderText?: string }).orderText ?? '';
    let touched = false;
    for (const m of mappings) {
      if (text.includes(m.from)) {
        text = text.split(m.from).join(m.to);
        touched = true;
      }
    }
    if (touched) {
      await db.collection('orders').updateOne({ _id: o._id }, { $set: { orderText: text } });
      totalOrders += 1;
      console.log(`✓ orders.orderText 치환: ${(o as { orderNumber?: string }).orderNumber ?? o._id}`);
    }
  }

  console.log('\n완료');
  console.log(`  passages 변경:  ${totalPassages}건`);
  console.log(`  orders 변경:    ${totalOrders}건`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
