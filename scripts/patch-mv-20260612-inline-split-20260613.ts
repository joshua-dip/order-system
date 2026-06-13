/** MV-20260612-001 함의·주장 영어/한글 인라인 Options → ### 분리 (보기 수≠5 해결) */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(ROOT, '.env') });
config({ path: path.join(ROOT, '.env.local') });

const APPLY = process.argv.includes('--apply');
const CIRCLED = ['①', '②', '③', '④', '⑤'];
const IDS = [
  '6a2bb2d6647637723fc4e403', '6a2bb2d6647637723fc4e404', // 2024수능33 함의
  '6a2bb2d0647637723fc4e3bb', '6a2bb2d0647637723fc4e3bc', // 22년9월38 함의
  '6a2bb2d3647637723fc4e3e7', '6a2bb2d3647637723fc4e3e8', // 2017수능31 주장
];

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const now = new Date();
  const report: Record<string, unknown>[] = [];
  for (const id of IDS) {
    const d = await col.findOne({ _id: new ObjectId(id) });
    const qd = (d?.question_data ?? {}) as Record<string, unknown>;
    const raw = String(qd.Options ?? '');
    if (!d || raw.includes('###') || raw.includes('\n')) { report.push({ id, error: '이미 분리됨/개행' }); continue; }
    const parts = raw.split(/(?=[①②③④⑤])/).map((s) => s.trim()).filter(Boolean);
    if (parts.length !== 5 || !parts.every((p, i) => p.startsWith(CIRCLED[i]))) {
      report.push({ id, error: `① 경계 분할 실패 (${parts.length})` }); continue;
    }
    const newOptions = parts.join(' ### ');
    report.push({ id, type: d.type, action: APPLY ? '분리' : '분리 예정' });
    if (APPLY) await col.updateOne({ _id: d._id }, { $set: { 'question_data.Options': newOptions, updated_at: now } });
  }
  console.log(JSON.stringify({ ok: true, apply: APPLY, applied: report.filter((r) => r.action).length, skipped: report.filter((r) => 'error' in r) }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
