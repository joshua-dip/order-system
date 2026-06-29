/**
 * READ-ONLY 점검: 부산진여자고등학교 / 부산진여고2 VIP 시험 상태.
 * MONGODB_URI 등 비밀은 절대 출력하지 않음.
 */
import path from 'path';
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.resolve(process.cwd(), '.env.local') });
config({ path: path.resolve(process.cwd(), '.env') });
import { getVipDb, col } from '../lib/vip-db';

async function main() {
  const db = await getVipDb();

  // 1) 부산진여자고등학교(또는 부산진여고) 학교 문서
  const schools = await col<any>(db, 'schools')
    .find({ name: { $regex: '부산진여' } })
    .project({ _id: 1, userId: 1, name: 1 })
    .toArray();
  console.log('=== vip_schools (부산진여*) ===');
  for (const s of schools) {
    console.log(`  schoolId=${s._id}  userId=${s.userId}  name="${s.name}"`);
  }

  // 2) 그 학교들의 시험 문서
  const schoolIds = schools.map((s) => s._id);
  if (schoolIds.length) {
    const exams = await col<any>(db, 'schoolExams')
      .find({ schoolId: { $in: schoolIds } })
      .project({ _id: 1, userId: 1, schoolId: 1, academicYear: 1, grade: 1, examType: 1, subject: 1, objectiveCount: 1, subjectiveCount: 1, analyzed: 1, pdfName: 1 })
      .toArray();
    console.log('\n=== vip_school_exams (해당 학교) ===');
    for (const e of exams) {
      console.log(`  examId=${e._id}  userId=${e.userId}  ${e.academicYear}/${e.grade}학년/${e.examType}/${e.subject ?? '(영어레거시)'}  obj=${e.objectiveCount} subj=${e.subjectiveCount} analyzed=${!!e.analyzed} pdf="${e.pdfName ?? ''}"`);
    }
  } else {
    console.log('\n(부산진여* 학교 문서 없음)');
  }

  // 3) 같은 userId가 가진 다른 부산진 학교(부산진고1 등)도 참고용
  const userIds = [...new Set(schools.map((s) => String(s.userId)))];
  console.log('\n=== 관련 userId 의 전체 학교 목록 (참고) ===');
  for (const uid of userIds) {
    const { ObjectId } = await import('mongodb');
    const all = await col<any>(db, 'schools').find({ userId: new ObjectId(uid) }).project({ name: 1 }).toArray();
    console.log(`  userId=${uid}: ${all.map((x) => x.name).join(', ')}`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
