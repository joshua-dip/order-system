/**
 * 모의고사 textbook 이름에서 지역 괄호를 제거합니다.
 *
 *   현재 :  '11년 3월 고2 영어모의고사 (부산시)'
 *   결과 :  '11년 3월 고2 영어모의고사'
 *
 *   현재 :  '23년 11월 고2 영어모의고사 (경기도, 12월시행)' / '(12월 시행)' 단독
 *   결과 :  '23년 11월 고2 영어모의고사' (지역·「N월 시행」 제거 — lib/mock-exam-strip-region.ts)
 *
 *   드라이런 (기본):
 *     DOTENV_CONFIG_PATH=.env.local npx tsx scripts/strip-region-from-mock-textbooks.ts
 *
 *   실제 적용:
 *     DOTENV_CONFIG_PATH=.env.local npx tsx scripts/strip-region-from-mock-textbooks.ts --apply
 *
 * 변경 대상
 *   - passages.textbook / chapter / source_key
 *   - orders.orderText 안의 동일 라인
 */
import { config } from 'dotenv';
config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

import { getDb } from '../lib/mongodb';

const APPLY = process.argv.includes('--apply');

/** 시·도 + 평가원 화이트리스트 */
const REGIONS = new Set([
  '서울시',
  '부산시',
  '인천시',
  '대구시',
  '광주시',
  '대전시',
  '울산시',
  '세종시',
  '경기도',
  '강원도',
  '충북',
  '충남',
  '전북',
  '전남',
  '경북',
  '경남',
  '제주',
  '평가원',
]);

/** `XX년 M월 고N 영어모의고사 (...)` 형식만 표준화 대상 */
function stripRegion(name: string): string | null {
  const m = name.match(/^(\d{2}년 \d{1,2}월 고[123] 영어모의고사) \(([^)]+)\)$/);
  if (!m) return null;
  const head = m[1];
  const inner = m[2];
  const tokens = inner.split(',').map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  if (!REGIONS.has(tokens[0])) return null;
  const remaining = tokens.slice(1);
  if (remaining.length === 0) return head;
  return `${head} (${remaining.join(', ')})`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  const db = await getDb('gomijoshua');

  const distinct = (await db
    .collection('passages')
    .distinct('textbook', { textbook: { $regex: '영어모의고사' } })) as string[];

  type Mapping = { from: string; to: string; passages: number; merge: number };
  const mappings: Mapping[] = [];

  for (const from of distinct.sort()) {
    const to = stripRegion(from);
    if (!to || to === from) continue;
    const merge = await db.collection('passages').countDocuments({ textbook: to });
    const passages = await db.collection('passages').countDocuments({ textbook: from });
    mappings.push({ from, to, passages, merge });
  }

  console.log('───────────────────────────────────────────────');
  console.log(`${APPLY ? '적용' : '드라이런'} · 변환 대상: ${mappings.length}종`);
  console.log('───────────────────────────────────────────────');
  for (const m of mappings) {
    const mergeWarn =
      m.merge > 0 ? `   ⚠ 목표 이름에 이미 ${m.merge}건 존재 (병합됨)` : '';
    console.log(`  ${m.from}`);
    console.log(`    → ${m.to}   (passages ${m.passages}건)${mergeWarn}`);
  }

  if (mappings.length === 0) {
    console.log('변환 대상이 없습니다.');
    return;
  }

  // orders.orderText 영향 미리보기
  const ordersAffected = await db
    .collection('orders')
    .find({
      orderText: { $in: mappings.map((m) => new RegExp(escapeRegex(m.from))) },
    })
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

  let totalPassages = 0;
  let totalOrders = 0;
  for (const m of mappings) {
    const now = new Date();
    const r = await db.collection('passages').updateMany({ textbook: m.from }, [
      {
        $set: {
          textbook: m.to,
          chapter: m.to,
          source_key: { $concat: [m.to, ' ', { $ifNull: ['$number', ''] }] },
          updated_at: now,
        },
      },
    ]);
    totalPassages += r.modifiedCount;
    console.log(`✓ passages: ${m.from} → ${m.to} (${r.modifiedCount}건)`);
  }

  const allOrders = await db
    .collection('orders')
    .find({
      orderText: {
        $in: mappings.map((m) => new RegExp(escapeRegex(m.from))),
      },
    })
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
      await db
        .collection('orders')
        .updateOne({ _id: o._id }, { $set: { orderText: text } });
      totalOrders += 1;
      console.log(
        `✓ orders.orderText 치환: ${(o as { orderNumber?: string }).orderNumber ?? o._id}`,
      );
    }
  }

  console.log('\n완료');
  console.log(`  passages 변경:  ${totalPassages}건`);
  console.log(`  orders 변경:    ${totalOrders}건`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
