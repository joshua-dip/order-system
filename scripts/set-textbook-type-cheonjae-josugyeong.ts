/**
 * 교재 '영어I_천재조수경' 을 교과서로 분류 (settings.textbookTypeMeta).
 * admin/passages 「교재 분류」 POST 와 동일한 read-modify-write — 기존 항목 보존.
 * 이렇게 하면 /my/vip/exams 「시험 범위 (교재)」의 교과서 그룹에 노출된다.
 */
import path from 'path';
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.resolve(process.cwd(), '.env.local') });
config({ path: path.resolve(process.cwd(), '.env') });
import { getDb } from '../lib/mongodb';

const SETTINGS_ID = 'textbookTypeMeta';
const TEXTBOOK_KEY = '영어I_천재조수경';
const TEXTBOOK_TYPE = '교과서';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = await getDb('gomijoshua');
  const col = db.collection('settings');

  // 교재가 실제 존재하는지 확인
  const passageCount = await db.collection('passages').countDocuments({ textbook: TEXTBOOK_KEY });
  const gqCount = await db.collection('generated_questions').countDocuments({ textbook: TEXTBOOK_KEY });
  console.log(`교재 "${TEXTBOOK_KEY}" — passages ${passageCount}건, generated_questions ${gqCount}건`);
  if (passageCount === 0 && gqCount === 0) {
    console.warn('⚠ 해당 교재명으로 지문/문항이 없습니다. 이름이 정확한지 확인하세요.');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await col.findOne({ _id: SETTINGS_ID } as any);
  const valueMap = (existing?.value ?? {}) as Record<string, string>;
  const before = valueMap[TEXTBOOK_KEY] ?? '(미설정 → 기본 부교재)';
  console.log(`현재 분류: ${before}`);
  console.log(`기존 교과서 목록: ${Object.entries(valueMap).filter(([, v]) => v === '교과서').map(([k]) => k).join(', ') || '(없음)'}`);

  if (dryRun) { console.log('\n[--dry-run] 저장하지 않음.'); process.exit(0); }

  valueMap[TEXTBOOK_KEY] = TEXTBOOK_TYPE;
  await col.replaceOne(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { _id: SETTINGS_ID } as any,
    { _id: SETTINGS_ID, value: valueMap, updated_at: new Date() },
    { upsert: true },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const after = await col.findOne({ _id: SETTINGS_ID } as any);
  const afterVal = (after?.value ?? {}) as Record<string, string>;
  console.log(`\n저장 완료. "${TEXTBOOK_KEY}" = ${afterVal[TEXTBOOK_KEY]}`);
  console.log(`교과서 목록: ${Object.entries(afterVal).filter(([, v]) => v === '교과서').map(([k]) => k).join(', ')}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
