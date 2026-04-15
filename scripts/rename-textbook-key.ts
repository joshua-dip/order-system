/**
 * MongoDB에서 교재명(문자열 키)을 한 값에서 다른 값으로 일괄 변경합니다.
 *
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/rename-textbook-key.ts --dry-run
 *   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/rename-textbook-key.ts
 *
 * 기본값: 빠른독해바른독해 구문독해(2024.10) → 빠른독해바른독해 구문독해
 * 덮어쓰기: RENAME_FROM=... RENAME_TO=...
 */
import { config } from 'dotenv';
config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });

import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';
import { TEXTBOOK_LINKS_COLLECTION } from '../lib/textbook-links-db';

const FROM = (process.env.RENAME_FROM ?? '빠른독해바른독해 구문독해(2024.10)').trim();
const TO = (process.env.RENAME_TO ?? '빠른독해바른독해 구문독해').trim();
const DRY = process.argv.includes('--dry-run');

const USER_ARRAY_FIELDS = [
  'allowedTextbooks',
  'allowedTextbooksAnalysis',
  'allowedTextbooksEssay',
  'allowedTextbooksWorkbook',
  'allowedTextbooksVariant',
] as const;

async function main() {
  if (!FROM || !TO || FROM === TO) {
    console.error('RENAME_FROM / RENAME_TO 가 올바른지 확인하세요.');
    process.exit(1);
  }

  const db = await getDb('gomijoshua');

  const toPassages = await db.collection('passages').countDocuments({ textbook: TO });
  if (toPassages > 0) {
    console.error(
      `목표 교재명 "${TO}" 로 이미 passages 가 ${toPassages}건 있습니다. 충돌을 피하려면 중단합니다.`
    );
    process.exit(1);
  }

  const report: Record<string, number | string> = {};

  const count = async (col: string, filter: object) => db.collection(col).countDocuments(filter as never);

  report.passages_from = await count('passages', { textbook: FROM });
  report.generated_questions_from = await count('generated_questions', { textbook: FROM });
  report.narrative_questions_from = await count('narrative_questions', { textbook: FROM });
  report.member_gq_from = await count('member_generated_questions', { textbook: FROM });

  if (DRY) {
    console.log(JSON.stringify({ dryRun: true, FROM, TO, ...report }, null, 2));
    process.exit(0);
  }

  const rPass = await db.collection('passages').updateMany({ textbook: FROM }, { $set: { textbook: TO, updated_at: new Date() } });
  report.passages_modified = rPass.modifiedCount;

  const rGq = await db.collection('generated_questions').updateMany({ textbook: FROM }, { $set: { textbook: TO, updated_at: new Date() } });
  report.generated_questions_modified = rGq.modifiedCount;

  const rNarr = await db.collection('narrative_questions').updateMany({ textbook: FROM }, { $set: { textbook: TO, updated_at: new Date() } });
  report.narrative_questions_modified = rNarr.modifiedCount;

  const rMem = await db.collection('member_generated_questions').updateMany({ textbook: FROM }, { $set: { textbook: TO, updated_at: new Date() } });
  report.member_generated_questions_modified = rMem.modifiedCount;

  const linkCol = db.collection(TEXTBOOK_LINKS_COLLECTION);
  const oldLink = await linkCol.findOne({ textbookKey: FROM });
  if (oldLink) {
    const existsTo = await linkCol.findOne({ textbookKey: TO });
    if (existsTo) {
      report.textbook_links = 'skip: target key already exists';
    } else {
      const { _id: _omit, ...rest } = oldLink as { _id: unknown; textbookKey?: string };
      await linkCol.insertOne({
        ...rest,
        textbookKey: TO,
        updatedAt: new Date(),
      });
      await linkCol.deleteOne({ textbookKey: FROM });
      report.textbook_links = 'moved 1';
    }
  } else {
    report.textbook_links = 'none';
  }

  const assignCol = db.collection('textbook_link_folder_assignments');
  const oldAssign = await assignCol.findOne({ textbookKey: FROM });
  if (oldAssign) {
    const folderId = (oldAssign as { folderId?: string }).folderId ?? '';
    await assignCol.deleteOne({ textbookKey: FROM });
    if (folderId) {
      await assignCol.updateOne(
        { textbookKey: TO },
        { $set: { textbookKey: TO, folderId, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
    }
    report.textbook_link_folder_assignments = 'moved';
  } else {
    report.textbook_link_folder_assignments = 'none';
  }

  const typeDoc = await db.collection('settings').findOne({ _id: 'textbookTypeMeta' as never });
  const typeVal = (typeDoc?.value ?? {}) as Record<string, string>;
  if (Object.prototype.hasOwnProperty.call(typeVal, FROM)) {
    typeVal[TO] = typeVal[FROM];
    delete typeVal[FROM];
    await db.collection('settings').replaceOne(
      { _id: 'textbookTypeMeta' as never },
      { _id: 'textbookTypeMeta', value: typeVal, updated_at: new Date() } as never,
      { upsert: true }
    );
    report.textbookTypeMeta = 'renamed key';
  } else {
    report.textbookTypeMeta = 'no key';
  }

  const defDoc = await db.collection('settings').findOne({ _id: 'defaultTextbooks' as never });
  const defArr = Array.isArray(defDoc?.value) ? [...defDoc.value] : [];
  const defNext = defArr.map((k: string) => (k === FROM ? TO : k));
  if (JSON.stringify(defArr) !== JSON.stringify(defNext)) {
    await db.collection('settings').updateOne(
      { _id: 'defaultTextbooks' as never },
      { $set: { value: defNext, updatedAt: new Date() } },
      { upsert: true }
    );
    report.defaultTextbooks = 'updated';
  } else {
    report.defaultTextbooks = 'unchanged';
  }

  const vsDoc = await db.collection('settings').findOne({ _id: 'variantSolbook' as never });
  const vsVal = (vsDoc?.value ?? {}) as { textbookKeys?: string[]; purchaseUrl?: string; extraFeeWon?: number };
  if (Array.isArray(vsVal.textbookKeys) && vsVal.textbookKeys.includes(FROM)) {
    vsVal.textbookKeys = vsVal.textbookKeys.map((k) => (k === FROM ? TO : k));
    await db.collection('settings').updateOne(
      { _id: 'variantSolbook' as never },
      { $set: { value: vsVal, updatedAt: new Date() } },
      { upsert: true }
    );
    report.variantSolbook = 'updated';
  } else {
    report.variantSolbook = 'unchanged';
  }

  let usersTouched = 0;
  const userFilter = { $or: USER_ARRAY_FIELDS.map((f) => ({ [f]: FROM })) };
  const users = await db.collection('users').find(userFilter).project({ _id: 1, ...Object.fromEntries(USER_ARRAY_FIELDS.map((f) => [f, 1])) }).toArray();
  for (const u of users) {
    const $set: Record<string, string[]> = {};
    for (const f of USER_ARRAY_FIELDS) {
      const arr = (u as Record<string, unknown>)[f];
      if (Array.isArray(arr) && arr.some((x) => x === FROM)) {
        $set[f] = arr.map((x: string) => (x === FROM ? TO : x));
      }
    }
    if (Object.keys($set).length > 0) {
      const oid = u._id;
      if (oid instanceof ObjectId) {
        await db.collection('users').updateOne({ _id: oid }, { $set: $set });
        usersTouched += 1;
      }
    }
  }
  report.users_updated = usersTouched;

  console.log(JSON.stringify({ ok: true, FROM, TO, ...report }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
