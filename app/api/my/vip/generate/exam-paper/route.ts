import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getDb } from '@/lib/mongodb';
import { publicBaseUrl } from '@/lib/public-base-url';
import {
  GRADE_PAPERS_COLLECTION,
  generateGradeToken,
  type GradePaperDoc,
  type GradePaperQuestion,
  type GradePaperSubjective,
} from '@/lib/vip-grade-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MOCK = /^\d{2}년\s+\d{1,2}월\s+고[123]\s+영어모의고사|^\d{2}년\s+고[123]\s+영어모의고사/;
function classifyCategory(tb: string, typeMap: Record<string, string>): '교과서' | '부교재' | '모의고사' {
  const t = typeMap[tb];
  if (t === '교과서' || t === '부교재' || t === '모의고사') return t;
  return MOCK.test(tb) || /영어모의고사$/.test(tb) ? '모의고사' : '부교재';
}
function asCat(v: unknown): '교과서' | '부교재' | '모의고사' | null {
  return v === '교과서' || v === '부교재' || v === '모의고사' ? v : null;
}

interface SubjectiveIn {
  question?: string;
  paragraph?: string;
  source?: string;
  score?: number;
  category?: string;
  type?: string;
  textbook?: string;
  sourceKey?: string;
}

/**
 * 생성한 시험지 1장을 토큰과 함께 영구 저장(vip_grade_papers).
 * 반환된 url(/exam-grade/{token}) 이 표지 QR 이 가리키는 학생 자가채점 주소.
 */
export async function POST(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  let body: {
    ids?: unknown;
    scores?: unknown;
    categories?: unknown;
    subjectives?: unknown;
    title?: unknown;
    schoolId?: unknown;
    schoolName?: unknown;
    grade?: unknown;
  };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x)).filter(Boolean) : [];
  const scores = Array.isArray(body.scores) ? body.scores.map((x) => Number(x)) : [];
  const categories = Array.isArray(body.categories) ? body.categories.map((x) => String(x).trim()) : [];
  const subjectivesIn: SubjectiveIn[] = Array.isArray(body.subjectives) ? (body.subjectives as SubjectiveIn[]) : [];
  const title = (typeof body.title === 'string' ? body.title : '변형문제').slice(0, 80);
  const schoolName = typeof body.schoolName === 'string' ? body.schoolName.slice(0, 60) : '';
  const grade = Number.isFinite(Number(body.grade)) ? Number(body.grade) : null;
  let schoolId: ObjectId | null = null;
  if (typeof body.schoolId === 'string' && ObjectId.isValid(body.schoolId)) schoolId = new ObjectId(body.schoolId);

  if (ids.length === 0 && subjectivesIn.length === 0) {
    return NextResponse.json({ error: '문항이 없습니다.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const [rawDocs, typeMetaDoc] = await Promise.all([
    db
      .collection('generated_questions')
      .find({ _id: { $in: ids.map((id) => new ObjectId(id)) }, status: '완료' })
      .project({ type: 1, textbook: 1, source_key: 1, chapter: 1, number: 1, 'question_data.CorrectAnswer': 1, 'question_data.Answer': 1, 'question_data.Source': 1 })
      .toArray(),
    db.collection('settings').findOne({ _id: 'textbookTypeMeta' } as unknown as Record<string, unknown>),
  ]);
  const typeMap = (typeMetaDoc?.value && typeof typeMetaDoc.value === 'object') ? (typeMetaDoc.value as Record<string, string>) : {};

  const byId = new Map(rawDocs.map((d) => [d._id.toString(), d]));

  // 객관식 — ids 순서 = PDF 인쇄 순서 = OMR 번호 (num = i+1)
  const questions: GradePaperQuestion[] = [];
  ids.forEach((id, i) => {
    const d = byId.get(id);
    if (!d) return;
    const tb = typeof d.textbook === 'string' ? d.textbook : '';
    const sk = typeof d.source_key === 'string' ? d.source_key : (d.chapter && d.number ? `${d.chapter} ${d.number}` : '');
    const qd = (d.question_data ?? {}) as { CorrectAnswer?: string; Answer?: string };
    const correctAnswer = String(qd.CorrectAnswer || qd.Answer || '').trim();
    const cat = asCat(categories[i]) ?? classifyCategory(tb, typeMap);
    questions.push({
      num: questions.length + 1,
      questionId: id,
      type: String(d.type ?? ''),
      sourceKey: sk,
      textbook: tb,
      category: cat,
      correctAnswer,
      score: Number.isFinite(scores[i]) ? scores[i] : 0,
    });
  });

  // 서술형 — 객관식 뒤 (자동채점 제외, 배점·분포 집계만)
  const subjectives: GradePaperSubjective[] = subjectivesIn.map((sj, j) => {
    const tb = typeof sj.textbook === 'string' ? sj.textbook : '';
    const cat = asCat(sj.category) ?? (tb ? classifyCategory(tb, typeMap) : '교과서');
    return {
      num: questions.length + j + 1,
      type: typeof sj.type === 'string' && sj.type ? sj.type : '서술형',
      sourceKey: typeof sj.sourceKey === 'string' ? sj.sourceKey : (typeof sj.source === 'string' ? sj.source : ''),
      textbook: tb,
      category: cat,
      score: Number.isFinite(Number(sj.score)) ? Number(sj.score) : 0,
    };
  });

  const maxObjectiveScore = questions.reduce((s, q) => s + (Number(q.score) || 0), 0);
  const totalScore = maxObjectiveScore + subjectives.reduce((s, q) => s + (Number(q.score) || 0), 0);

  const token = generateGradeToken();
  const doc: GradePaperDoc = {
    userId: new ObjectId(auth.userId),
    token,
    title,
    schoolId,
    schoolName,
    grade,
    questions,
    subjectives,
    objectiveCount: questions.length,
    subjectiveCount: subjectives.length,
    maxObjectiveScore,
    totalScore,
    createdAt: new Date(),
  };
  await db.collection<GradePaperDoc>(GRADE_PAPERS_COLLECTION).insertOne(doc);

  const url = `${publicBaseUrl(request)}/exam-grade/${token}`;
  return NextResponse.json({ ok: true, token, url, objectiveCount: questions.length, subjectiveCount: subjectives.length });
}
