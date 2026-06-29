/**
 * 부산진여자고등학교 2026학년도 2학년 1학기 중간고사(영어I) 시험지 분석 결과를
 * 기존 vip_school_exams 문서(examId=6a40a05868265d1b342a4e62)에 채운다.
 * 분석은 Claude Code(이 세션)가 PDF를 직접 읽어 작성 — Anthropic API 미사용.
 *
 * 출처 PDF: 26년 1학기 중간고사 시험지_부산진여고2.pdf (12쪽)
 * 객관식 27문항/70점 + 서·논술형 6문항/30점 (총 100점)
 */
import path from 'path';
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.resolve(process.cwd(), '.env.local') });
config({ path: path.resolve(process.cwd(), '.env') });
import { ObjectId } from 'mongodb';
import { getVipDb, col, type VipSchoolExam, type ExamQuestion } from '../lib/vip-db';

const EXAM_ID = '6a40a05868265d1b342a4e62';

// [번호, 유형, 배점, 한줄요약]
const OBJECTIVE: [number, string, number, string][] = [
  [1, '제목', 2.9, 'Hunter-gatherer lifestyle limits population size'],
  [2, '제목', 2.9, 'Technological innovation reduces uncertainty'],
  [3, '제목', 2.5, 'Chronic inflammation & defending with food choices'],
  [4, '제목', 2.8, "Competent professional's selective attention at a meeting"],
  [5, '제목', 2.8, 'Moral superiority requires being a moral agent'],
  [6, '주제', 2.8, 'Aesthetics of everyday life (Dewey)'],
  [7, '주제', 2.7, 'Hard & soft skills are complementary'],
  [8, '빈칸', 2.5, 'Why flightless birds did not re-evolve forelimbs'],
  [9, '빈칸', 2.5, 'Documentary look vs. messy real-life speech'],
  [10, '어법', 2.4, 'Good journalist & sympathetic imagination (밑줄 어법)'],
  [11, '어법', 2.4, 'Defamation & libel law (밑줄 어법)'],
  [12, '어법', 2.5, 'Picket fence orientation (어법 틀린 것 모두)'],
  [13, '어법', 2.2, 'Shy child → landscape architect ((a)~(g) 짝짓기)'],
  [14, '순서', 2.5, 'Change is accelerating & relative'],
  [15, '순서', 2.5, 'Joining groups when expecting personal failure'],
  [16, '순서', 2.6, 'Government money creation & gold backing'],
  [17, '순서', 2.6, 'Music bypasses the pictorial and the verbal'],
  [18, '함의', 2.9, '함의: "Rooms have their own sound"'],
  [19, '함의', 2.9, '함의: "they exhibited fear and avoidance of it"'],
  [20, '무관한문장', 2.4, '무관한 문장: baseball team coordination'],
  [21, '무관한문장', 2.4, '무관한 문장: justice principles & climate aid'],
  [22, '삽입', 2.9, 'Emotion socialization in adolescence (문장 삽입)'],
  [23, '내용불일치', 2.6, 'Race as a cultural construction (일치하지 않는 것)'],
  [24, '내용일치', 2.6, 'Microbes as masters of the living world (일치하는 것)'],
  [25, '요약', 2.4, 'Empathy, faith & reason synthesis (요약 A·B)'],
  [26, '요약', 2.4, 'Unconscious processing of information (요약 A·B)'],
  [27, '어휘', 2.4, 'Film continuity vs. real life (문맥상 부적절한 낱말)'],
];

// 서·논술형 1~6 → 문항번호 28~33
const SUBJECTIVE: [number, string, number, string][] = [
  [28, '서술형', 6, '서논술형1 plea-bargaining 이점 빈칸(ⓐ~ⓒ)+빈칸(A) 문장 찾아 해석'],
  [29, '서술형', 5, '서논술형2 thesis-based doctoral programme, narrowing the focus 해석 2문항'],
  [30, '영작', 5, '서논술형3 weeds & transportation 빈칸 (A)(B) 조건영작'],
  [31, '영작', 4, '서논술형4 communication 어법 수정(A)+빈칸(B) 조건영작'],
  [32, '서술형', 6, '서논술형5 conformity(Asch) 빈칸 (A)(B)+행동특징 서술'],
  [33, '영작', 4, '서논술형6 reading boundaries 24단어 조건영작'],
];

function buildQuestions(): Record<string, ExamQuestion> {
  const q: Record<string, ExamQuestion> = {};
  for (const [num, type, score, text] of OBJECTIVE) {
    q[String(num)] = { questionType: type, score, questionText: text, isSubjective: false };
  }
  for (const [num, type, score, text] of SUBJECTIVE) {
    q[String(num)] = { questionType: type, score, questionText: text, isSubjective: true };
  }
  return q;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = await getVipDb();
  const exams = col<VipSchoolExam>(db, 'schoolExams');

  const exam = await exams.findOne({ _id: new ObjectId(EXAM_ID) });
  if (!exam) { throw new Error(`시험 문서를 찾을 수 없습니다: ${EXAM_ID}`); }

  const questions = buildQuestions();
  const objectiveCount = OBJECTIVE.length;
  const subjectiveCount = SUBJECTIVE.length;
  const objScore = OBJECTIVE.reduce((s, x) => s + x[2], 0);
  const subjScore = SUBJECTIVE.reduce((s, x) => s + x[2], 0);

  console.log(`대상: ${exam.academicYear}/${exam.grade}학년/${exam.examType} (examId=${EXAM_ID})`);
  console.log(`객관식 ${objectiveCount}문항 ${objScore.toFixed(1)}점 / 서·논술형 ${subjectiveCount}문항 ${subjScore}점 / 합계 ${(objScore + subjScore).toFixed(1)}점`);
  console.log(`기존: obj=${exam.objectiveCount} subj=${exam.subjectiveCount} questions=${Object.keys(exam.questions ?? {}).length}`);

  if (dryRun) {
    console.log('\n[--dry-run] 저장하지 않음. questions 미리보기:');
    for (const k of Object.keys(questions)) {
      const q = questions[k];
      console.log(`  ${k.padStart(2)} ${q.isSubjective ? '주관' : '객관'} ${q.questionType}\t${q.score}\t${q.questionText}`);
    }
    process.exit(0);
  }

  await exams.updateOne(
    { _id: new ObjectId(EXAM_ID) },
    {
      $set: {
        questions,
        objectiveCount,
        subjectiveCount,
        analyzed: true,
        updatedAt: new Date(),
      },
    },
  );

  const after = await exams.findOne({ _id: new ObjectId(EXAM_ID) });
  console.log(`\n저장 완료. obj=${after?.objectiveCount} subj=${after?.subjectiveCount} questions=${Object.keys(after?.questions ?? {}).length} analyzed=${(after as { analyzed?: boolean } | null)?.analyzed}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
