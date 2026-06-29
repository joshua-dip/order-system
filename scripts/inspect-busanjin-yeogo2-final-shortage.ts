/**
 * READ-ONLY: 부산진여고2 1학기 기말고사 시험범위(examScopePassages)의
 * 지문별 변형문제(generated_questions) 보유/부족 현황.
 * 목표: 베이스 유형당 3문항. '어휘'(신규) 포함.
 */
import path from 'path';
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.resolve(process.cwd(), '.env.local') });
config({ path: path.resolve(process.cwd(), '.env') });
import { ObjectId } from 'mongodb';
import { getVipDb, col } from '../lib/vip-db';
import { getDb } from '../lib/mongodb';

const BASE_TYPES = ['주제', '제목', '주장', '일치', '불일치', '함의', '빈칸', '요약', '어법', '어휘', '순서', '삽입', '무관한문장'];
const TARGET = 3;

function parseKey(key: string): { textbook: string; sourceKey: string } {
  const i = key.indexOf('::');
  if (i < 0) return { textbook: '', sourceKey: key };
  return { textbook: key.slice(0, i), sourceKey: key.slice(i + 2) };
}

async function main() {
  const vipDb = await getVipDb();
  // 부산진여자고등학교 기말 시험
  const schools = await col<any>(vipDb, 'schools').find({ name: { $regex: '부산진여' } }).toArray();
  const schoolIds = schools.map((s) => s._id);
  const exams = await col<any>(vipDb, 'schoolExams')
    .find({ schoolId: { $in: schoolIds } })
    .project({ _id: 1, academicYear: 1, grade: 1, examType: 1, examScopePassages: 1 })
    .toArray();
  console.log('=== 부산진여* 시험 목록 ===');
  for (const e of exams) {
    console.log(`  examId=${e._id} ${e.academicYear}/${e.grade}학년/${e.examType} scope=${(e.examScopePassages ?? []).length}개`);
  }

  // 기말 + 2학년 우선
  const target = exams.find((e) => /기말/.test(e.examType) && e.grade === 2)
    || exams.find((e) => /기말/.test(e.examType));
  if (!target) { console.log('\n기말 시험을 찾지 못했습니다.'); process.exit(0); }
  const scopeKeys: string[] = (target.examScopePassages ?? []).map(String);
  console.log(`\n대상 기말: examId=${target._id} ${target.academicYear}/${target.grade}학년/${target.examType} · 범위 ${scopeKeys.length}개`);

  if (scopeKeys.length === 0) { console.log('범위가 비어 있습니다.'); process.exit(0); }

  const db = await getDb('gomijoshua');
  const pairs = scopeKeys.map(parseKey).filter((p) => p.sourceKey);
  const or = pairs.map((p) => (p.textbook ? { textbook: p.textbook, source_key: p.sourceKey } : { source_key: p.sourceKey }));
  const passages = await db.collection('passages')
    .find({ $or: or }, { projection: { _id: 1, textbook: 1, source_key: 1 } })
    .toArray();
  const pidList = passages.map((p) => p._id as ObjectId);

  // 변형 카운트: passage_id × type (option_type=English, 완료+대기 모두 카운트해 보유 판단)
  const agg = await db.collection('generated_questions').aggregate([
    { $match: { passage_id: { $in: pidList }, option_type: { $in: ['English', null] } } },
    { $group: { _id: { pid: '$passage_id', type: '$type' }, n: { $sum: 1 } } },
  ]).toArray();
  const countMap = new Map<string, Map<string, number>>();
  for (const a of agg) {
    const pid = String(a._id.pid); const type = String(a._id.type);
    if (!countMap.has(pid)) countMap.set(pid, new Map());
    countMap.get(pid)!.set(type, (countMap.get(pid)!.get(type) ?? 0) + a.n);
  }

  // 미해결: 범위 키 중 passages 에 매칭 안 된 것
  const matchedKeys = new Set(passages.map((p) => `${p.textbook}::${p.source_key}`));
  const unmatched = scopeKeys.filter((k) => !matchedKeys.has(k));

  // 리포트
  let totalShort = 0;
  let vocabShort = 0;
  let emptyPassages = 0;
  const perTypeShort: Record<string, number> = {};
  const lines: string[] = [];
  const byTb = new Map<string, number>();

  // passages 를 source_key 순으로
  passages.sort((a, b) => String(a.source_key).localeCompare(String(b.source_key), 'ko'));
  for (const p of passages) {
    const pid = String(p._id);
    const tc = countMap.get(pid) ?? new Map<string, number>();
    const total = [...tc.values()].reduce((s, n) => s + n, 0);
    if (total === 0) emptyPassages++;
    byTb.set(String(p.textbook), (byTb.get(String(p.textbook)) ?? 0) + 1);
    const shortTypes = BASE_TYPES.filter((t) => (tc.get(t) ?? 0) < TARGET).map((t) => `${t}:${tc.get(t) ?? 0}`);
    for (const t of BASE_TYPES) {
      const need = Math.max(0, TARGET - (tc.get(t) ?? 0));
      if (need > 0) { perTypeShort[t] = (perTypeShort[t] ?? 0) + need; totalShort += need; if (t === '어휘') vocabShort += need; }
    }
    lines.push(`  [${String(p.textbook)}] ${p.source_key} · 총${total} · 부족(${shortTypes.length}): ${shortTypes.join(' ')}`);
  }

  console.log(`\n=== 범위 지문 ${passages.length}개 (매칭) / 미매칭 키 ${unmatched.length}개 ===`);
  console.log('교재별:', [...byTb.entries()].map(([t, n]) => `${t}=${n}`).join(', '));
  if (unmatched.length) console.log('미매칭 키:', unmatched.slice(0, 20).join(' | '));
  console.log(`\n빈 지문(변형 0건): ${emptyPassages}개`);
  console.log(`어휘 부족 합계: ${vocabShort}문항 (베이스 유형 전체 부족 합계: ${totalShort}문항)`);
  console.log('유형별 부족 합계:', Object.entries(perTypeShort).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join(' '));
  console.log('\n--- 지문별 ---');
  console.log(lines.join('\n'));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
