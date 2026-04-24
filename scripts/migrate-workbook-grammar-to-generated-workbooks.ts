/**
 * 1회성 마이그레이션: generated_questions { type: '워크북어법' } → generated_workbooks
 *
 * 기본 dry-run (건수·status 분포만 출력).
 *   npx tsx scripts/migrate-workbook-grammar-to-generated-workbooks.ts
 *
 * 실제 실행:
 *   npx tsx scripts/migrate-workbook-grammar-to-generated-workbooks.ts --commit
 *
 * 안전 가드:
 *   1. $out 으로 백업 컬렉션 생성
 *   2. insertMany ordered:false
 *   3. insertedCount === sourceCount 검증
 *   4. 통과 시에만 deleteMany
 */
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';
import {
  GENERATED_WORKBOOKS_COLLECTION,
  type GeneratedWorkbookInsert,
} from '../lib/generated-workbooks-types';
import type { WorkbookGrammarPoint } from '../lib/workbook-grammar-types';

const BACKUP_COLLECTION = 'generated_questions_backup_workbook';
const COMMIT = process.argv.includes('--commit');

function mapStatus(old: unknown): 'draft' | 'reviewed' {
  const s = typeof old === 'string' ? old.trim() : '';
  if (s === '검수완료' || s === '완료') return 'reviewed';
  return 'draft';
}

function toGrammarPoints(qd: Record<string, unknown>): WorkbookGrammarPoint[] {
  const pts = qd.GrammarPoints;
  if (!Array.isArray(pts)) return [];
  return pts.map((p: Record<string, unknown>) => ({
    targetWord: String(p.targetWord ?? ''),
    correctForm: String(p.correctForm ?? ''),
    wrongForm: String(p.wrongForm ?? ''),
    grammarType: String(p.grammarType ?? ''),
    answerPosition: (p.answerPosition === '뒤' ? '뒤' : '앞') as '앞' | '뒤',
  }));
}

async function main() {
  const db = await getDb('gomijoshua');
  const gqCol = db.collection('generated_questions');
  const wbCol = db.collection(GENERATED_WORKBOOKS_COLLECTION);

  const sourceCount = await gqCol.countDocuments({ type: '워크북어법' });
  console.log(`source count (generated_questions type=워크북어법): ${sourceCount}`);

  if (sourceCount === 0) {
    console.log('이전할 문서가 없습니다.');
    process.exit(0);
  }

  const statusDist = await gqCol.distinct('status', { type: '워크북어법' });
  console.log('status 분포:', statusDist);

  if (!COMMIT) {
    console.log('\n--- DRY RUN --- 실제 마이그레이션은 --commit 으로 실행하세요.');
    process.exit(0);
  }

  console.log('\n[1/5] $out 으로 백업 컬렉션 생성...');
  await gqCol
    .aggregate([
      { $match: { type: '워크북어법' } },
      { $out: BACKUP_COLLECTION },
    ])
    .toArray();
  const backupCount = await db.collection(BACKUP_COLLECTION).countDocuments();
  console.log(`  백업 건수: ${backupCount}`);

  if (backupCount !== sourceCount) {
    throw new Error(`백업 건수 불일치: source=${sourceCount}, backup=${backupCount}`);
  }

  console.log('[2/5] 매핑...');
  const docs = await gqCol.find({ type: '워크북어법' }).toArray();
  const mapped: GeneratedWorkbookInsert[] = docs.map((old) => {
    const qd = (old.question_data ?? {}) as Record<string, unknown>;
    return {
      passage_id: old.passage_id instanceof ObjectId ? old.passage_id : new ObjectId(String(old.passage_id)),
      textbook: String(old.textbook ?? ''),
      passage_source_label: old.source ? String(old.source) : undefined,
      category: '워크북어법' as const,
      paragraph: String(qd.Paragraph ?? ''),
      grammar_points: toGrammarPoints(qd),
      answer_text: String(qd.AnswerText ?? ''),
      explanation: String(qd.Explanation ?? ''),
      status: mapStatus(old.status),
      truncated_points_count: null,
      created_at: old.created_at instanceof Date ? old.created_at : new Date(old.created_at ?? Date.now()),
      updated_at: old.updated_at instanceof Date ? old.updated_at : new Date(old.updated_at ?? Date.now()),
      deleted_at: null,
      created_by: old.created_by ? String(old.created_by) : undefined,
      legacy_question_id: old._id instanceof ObjectId ? old._id : new ObjectId(String(old._id)),
    };
  });

  console.log(`[3/5] insertMany (${mapped.length}건)...`);
  const r = await wbCol.insertMany(mapped, { ordered: false });
  console.log(`  insertedCount: ${r.insertedCount}`);

  if (r.insertedCount !== sourceCount) {
    throw new Error(
      `마이그 검증 실패: 원본 ${sourceCount} vs 신규 ${r.insertedCount}. 원본 삭제 중단.`,
    );
  }

  console.log('[4/5] 원본 삭제...');
  const del = await gqCol.deleteMany({ type: '워크북어법' });
  console.log(`  deletedCount: ${del.deletedCount}`);

  console.log(`[5/5] 완료. 백업 컬렉션 '${BACKUP_COLLECTION}' 은 유지됩니다.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('마이그레이션 실패:', e);
  process.exit(1);
});
