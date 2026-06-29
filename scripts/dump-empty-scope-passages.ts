/**
 * READ-ONLY: 부산진여고2 기말 범위 중 '데이터 없는/희소' 지문의 _id + 영어 본문 덤프.
 * (변형 작성용 — Pro 채팅에서 question_data 작성)
 */
import path from 'path';
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.resolve(process.cwd(), '.env.local') });
config({ path: path.resolve(process.cwd(), '.env') });
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';

// inspect 리포트에서 데이터 0(또는 base 0)인 지문들
const TARGETS: [string, string][] = [
  ['영어I_천재조수경', 'Lesson 6. Art in Our Lives 본문3(p.136)'],
  ['영어I_천재조수경', 'Lesson 6. Art in Our Lives 본문4(p.137)'],
  ['19년 9월 고2 영어모의고사', '19년 9월 고2 영어모의고사 31번'],
  ['19년 9월 고2 영어모의고사', '19년 9월 고2 영어모의고사 39번'],
  ['21년 3월 고2 영어모의고사', '21년 3월 고2 영어모의고사 40번'],
  ['22년 11월 고2 영어모의고사', '22년 11월 고2 영어모의고사 30번'],
  ['22년 3월 고2 영어모의고사', '22년 3월 고2 영어모의고사 37번'],
  ['지금필수 고난도유형(2026)', '고난도 모의고사 9회 01번'],
  ['지금필수 고난도유형(2026)', '고난도 모의고사 9회 02번'],
];

function pickText(content: any): string {
  if (!content || typeof content !== 'object') return '';
  if (typeof content.original === 'string' && content.original.trim()) return content.original.trim();
  if (typeof content.mixed === 'string' && content.mixed.trim()) return content.mixed.trim();
  if (Array.isArray(content.sentences)) {
    return content.sentences.map((s: any) => (typeof s === 'string' ? s : (s?.en ?? s?.text ?? ''))).filter(Boolean).join(' ');
  }
  return '';
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? Number(onlyArg.split('=')[1]) : null; // 1-based index
  const db = await getDb('gomijoshua');
  let idx = 0;
  for (const [textbook, source_key] of TARGETS) {
    idx++;
    if (only && only !== idx) continue;
    const p = await db.collection('passages').findOne({ textbook, source_key });
    if (!p) { console.log(`\n#${idx} [${textbook}] ${source_key} — NOT FOUND`); continue; }
    const text = pickText(p.content);
    console.log(`\n===== #${idx} =====`);
    console.log(`passage_id: ${p._id}`);
    console.log(`textbook: ${textbook}`);
    console.log(`source_key: ${source_key}`);
    console.log(`--- 본문 ---\n${text}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
