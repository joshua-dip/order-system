/**
 * 모의고사 교재명에서 괄호 지역(서울시·경기도 등)을 제거합니다.
 *
 *   드라이런 (기본):
 *     DOTENV_CONFIG_PATH=.env.local npx tsx scripts/strip-mock-exam-region-textbooks.ts
 *
 *   적용:
 *     DOTENV_CONFIG_PATH=.env.local npx tsx scripts/strip-mock-exam-region-textbooks.ts --apply
 *
 * 대상
 *   - passages.textbook, passages.source_key (접두 교재명 치환)
 *   - generated_questions.textbook, narrative_questions.textbook
 *   - user_vocabularies.textbook
 *   - member_generated_questions.textbook (존재 시)
 *   - textbook_links.textbookKey, textbook_link_folder_assignments.textbookKey
 *   - orders.orderText (문자열 부분 치환)
 *   - Mongo converted_textbook_json merged + 로컬 converted_data.json (키·내부 중복 키 정리)
 */
import { config } from 'dotenv';
config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

import type { AnyBulkWriteOperation, Db } from 'mongodb';
import { getDb } from '../lib/mongodb';
import { readMergedConvertedData, writeMergedConvertedData } from '../lib/converted-data-store';
import { stripRegionFromMockExamTextbookKey } from '../lib/mock-exam-strip-region';
import { TEXTBOOK_LINKS_COLLECTION } from '../lib/textbook-links-db';

const APPLY = process.argv.includes('--apply');

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 객체 트리에서 키 oldK → newK 치환 (값 재귀) */
function replaceKeysDeep<T>(v: T, oldK: string, newK: string): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => replaceKeysDeep(x, oldK, newK)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const nk = k === oldK ? newK : k;
    out[nk] = replaceKeysDeep(val, oldK, newK);
  }
  return out as T;
}

/** 동일 객체에 from·to 키가 같이 있으면 replaceKeysDeep 시 덮어쓰기 위험 */
function hasSiblingKeyConflict(obj: unknown, from: string, to: string): boolean {
  if (obj === null || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return obj.some((el) => hasSiblingKeyConflict(el, from, to));
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (keys.includes(from) && keys.includes(to)) return true;
  return Object.values(rec).some((v) => hasSiblingKeyConflict(v, from, to));
}

function nextSourceKey(sourceKey: unknown, from: string, to: string): unknown {
  if (sourceKey == null) return sourceKey;
  if (typeof sourceKey !== 'string') return sourceKey;
  if (!sourceKey) return sourceKey;
  if (sourceKey === from) return to;
  if (sourceKey.startsWith(`${from} `)) return `${to}${sourceKey.slice(from.length)}`;
  if (sourceKey.includes(from)) return sourceKey.split(from).join(to);
  return sourceKey;
}

async function bulkUpdatePassagesTextbook(db: Db, from: string, to: string, now: Date): Promise<number> {
  const cursor = db.collection('passages').find({ textbook: from }).project({ _id: 1, source_key: 1 });
  const batch: AnyBulkWriteOperation[] = [];
  let modified = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const res = await db.collection('passages').bulkWrite(batch, { ordered: false });
    modified += res.modifiedCount;
    batch.length = 0;
  };
  for await (const doc of cursor) {
    const d = doc as { _id: import('mongodb').ObjectId; source_key?: unknown };
    batch.push({
      updateOne: {
        filter: { _id: d._id },
        update: {
          $set: {
            textbook: to,
            source_key: nextSourceKey(d.source_key, from, to),
            updated_at: now,
          },
        },
      },
    });
    if (batch.length >= 250) await flush();
  }
  await flush();
  return modified;
}

async function main() {
  const db = await getDb('gomijoshua');

  const cols = [
    'passages',
    'generated_questions',
    'narrative_questions',
    'user_vocabularies',
    'member_generated_questions',
  ] as const;

  const distinctSet = new Set<string>();
  for (const c of cols) {
    try {
      const arr = (await db.collection(c).distinct('textbook')) as unknown[];
      for (const x of arr) {
        if (typeof x === 'string' && x.trim()) distinctSet.add(x.trim());
      }
    } catch {
      /* member_generated_questions 등 없을 수 있음 */
    }
  }
  try {
    const links = (await db.collection(TEXTBOOK_LINKS_COLLECTION).distinct('textbookKey')) as unknown[];
    for (const x of links) {
      if (typeof x === 'string' && x.trim()) distinctSet.add(x.trim());
    }
  } catch {
    /* */
  }
  try {
    const asg = (await db.collection('textbook_link_folder_assignments').distinct('textbookKey')) as unknown[];
    for (const x of asg) {
      if (typeof x === 'string' && x.trim()) distinctSet.add(x.trim());
    }
  } catch {
    /* */
  }

  const merged = await readMergedConvertedData();
  for (const k of Object.keys(merged)) {
    if (k.trim()) distinctSet.add(k.trim());
  }

  const mappings: { from: string; to: string }[] = [];
  const seenTo = new Map<string, string>();

  for (const from of [...distinctSet].sort((a, b) => a.localeCompare(b, 'ko'))) {
    const to = stripRegionFromMockExamTextbookKey(from);
    if (from === to) continue;
    const prev = seenTo.get(to);
    if (prev && prev !== from) {
      console.error(`충돌: "${from}" 과 "${prev}" 가 동일 목표 "${to}" 로 수렴합니다. 수동 확인 필요.`);
      process.exit(1);
    }
    seenTo.set(to, from);
    mappings.push({ from, to });
  }

  if (mappings.length === 0) {
    console.log('변경할 교재명이 없습니다.');
    return;
  }

  console.log('───────────────────────────────────────────────');
  console.log(`${APPLY ? '적용' : '드라이런'} · ${mappings.length}건`);
  console.log('───────────────────────────────────────────────');
  for (const { from, to } of mappings) {
    console.log(`  "${from}"\n    → "${to}"`);
  }

  /** passages: 목표 교재가 이미 있고, 원본과 다른 이름만 충돌 */
  const passageConflicts: string[] = [];
  for (const { from, to } of mappings) {
    if (from === to) continue;
    const nFrom = await db.collection('passages').countDocuments({ textbook: from });
    const nTo = await db.collection('passages').countDocuments({ textbook: to });
    if (nFrom > 0 && nTo > 0) {
      passageConflicts.push(`${from} → ${to} (passages 양쪽 존재: ${nFrom} / ${nTo}건)`);
    }
  }
  if (passageConflicts.length > 0) {
    console.error('\n⚠ passages 양쪽 교재명이 동시에 존재합니다. 병합 전에 수동 정리가 필요할 수 있습니다.');
    for (const c of passageConflicts) console.error(`  - ${c}`);
    process.exit(1);
  }

  for (const { from, to } of mappings) {
    if (hasSiblingKeyConflict(merged, from, to)) {
      console.error(
        `merged JSON 충돌: 어떤 객체에 "${from}" 과 "${to}" 키가 동시에 있습니다. 수동 병합 후 다시 실행하세요.`,
      );
      process.exit(1);
    }
  }

  if (!APPLY) {
    console.log('\n드라이런 종료. 적용: --apply');
    return;
  }

  const now = new Date();

  const mappingsByFromLen = [...mappings].sort((a, b) => b.from.length - a.from.length);

  for (const { from, to } of mappings) {
    const n = await bulkUpdatePassagesTextbook(db, from, to, now);
    if (n > 0) console.log(`✓ passages: ${from} → ${to} (${n})`);

    const rGq = await db
      .collection('generated_questions')
      .updateMany({ textbook: from }, { $set: { textbook: to, updated_at: now } });
    if (rGq.modifiedCount > 0) console.log(`  generated_questions ${rGq.modifiedCount}`);

    const rN = await db
      .collection('narrative_questions')
      .updateMany({ textbook: from }, { $set: { textbook: to, updated_at: now } });
    if (rN.modifiedCount > 0) console.log(`  narrative_questions ${rN.modifiedCount}`);

    const rUv = await db
      .collection('user_vocabularies')
      .updateMany({ textbook: from }, { $set: { textbook: to, last_edited_at: now } });
    if (rUv.modifiedCount > 0) console.log(`  user_vocabularies ${rUv.modifiedCount}`);

    try {
      const rM = await db
        .collection('member_generated_questions')
        .updateMany({ textbook: from }, { $set: { textbook: to, updated_at: now } });
      if (rM.modifiedCount > 0) console.log(`  member_generated_questions ${rM.modifiedCount}`);
    } catch {
      /* */
    }

    const rL = await db
      .collection(TEXTBOOK_LINKS_COLLECTION)
      .updateMany({ textbookKey: from }, { $set: { textbookKey: to, updated_at: now } });
    if (rL.modifiedCount > 0) console.log(`  textbook_links ${rL.modifiedCount}`);

    try {
      const rA = await db
        .collection('textbook_link_folder_assignments')
        .updateMany({ textbookKey: from }, { $set: { textbookKey: to, updatedAt: now } });
      if (rA.modifiedCount > 0) console.log(`  textbook_link_folder_assignments ${rA.modifiedCount}`);
    } catch {
      /* */
    }
  }

  let orderUpdates = 0;
  for (const { from, to } of mappingsByFromLen) {
    const rO = await db.collection('orders').updateMany(
      { orderText: { $regex: escapeRegex(from) } },
      [{ $set: { orderText: { $replaceAll: { input: '$orderText', find: from, replacement: to } } } }],
    );
    if (rO.modifiedCount > 0) {
      orderUpdates += rO.modifiedCount;
      console.log(`  orders.orderText "${from}" → "${to}" (${rO.modifiedCount})`);
    }
  }
  if (orderUpdates > 0) console.log(`✓ orders.orderText 합계 ${orderUpdates}건`);

  let data = await readMergedConvertedData();
  for (const { from, to } of mappingsByFromLen) {
    if (hasSiblingKeyConflict(data, from, to)) {
      console.error(
        `merged JSON 충돌: 어떤 객체에 "${from}" 과 "${to}" 키가 동시에 있습니다. 수동 병합 후 다시 실행하세요.`,
      );
      process.exit(1);
    }
    data = replaceKeysDeep(data, from, to) as Record<string, unknown>;
  }

  await writeMergedConvertedData(data);
  console.log('\n✅ writeMergedConvertedData (Mongo merged + converted_data.json 가능 시) 완료');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
