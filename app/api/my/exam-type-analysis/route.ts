import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { notifySlack } from '@/lib/slack';
import { EXAM_TYPE_ANALYSIS_COLLECTION, parseRecommendedTypes } from '@/lib/exam-type-analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * 기출 유형 분석 요청 — 사용자가 학교 기출 시험지(pastExamUploads)를 올리고
 * 관리자에게 유형 분포 분석을 요청. 관리자가 추천 유형 세트를 등록하면
 * /unified 문제 유형 선택에서 원클릭 적용.
 */

async function requireLogin(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function GET(request: NextRequest) {
  const payload = await requireLogin(request);
  if (!payload) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  try {
    const db = await getDb('gomijoshua');
    const docs = await db
      .collection(EXAM_TYPE_ANALYSIS_COLLECTION)
      .find({ loginId: payload.loginId })
      .sort({ createdAt: -1 })
      .limit(30)
      .toArray();
    return NextResponse.json({
      items: docs.map((d) => ({
        id: String(d._id),
        schoolName: d.schoolName ?? '',
        grade: d.grade ?? '',
        examLabel: d.examLabel ?? '',
        status: d.status === 'done' ? 'done' : 'requested',
        recommendedTypes: parseRecommendedTypes(d.recommendedTypes),
        adminNote: typeof d.adminNote === 'string' ? d.adminNote : '',
        createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt ?? ''),
      })),
    });
  } catch (e) {
    console.error('[exam-type-analysis GET]', e);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const payload = await requireLogin(request);
  if (!payload) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  let body: {
    schoolName?: unknown;
    grade?: unknown;
    examLabel?: unknown;
    note?: unknown;
    pastExamUploadId?: unknown;
  };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const schoolName = typeof body.schoolName === 'string' ? body.schoolName.trim() : '';
  const grade = typeof body.grade === 'string' ? body.grade.trim() : '';
  const examLabel = typeof body.examLabel === 'string' ? body.examLabel.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
  const pastExamUploadId =
    typeof body.pastExamUploadId === 'string' && ObjectId.isValid(body.pastExamUploadId)
      ? body.pastExamUploadId
      : '';

  if (!schoolName) return NextResponse.json({ error: '학교명을 입력해주세요.' }, { status: 400 });
  if (!examLabel) return NextResponse.json({ error: '시험명을 입력해주세요.' }, { status: 400 });
  if (!pastExamUploadId) {
    return NextResponse.json({ error: '시험지 파일 업로드가 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    /* 업로드가 본인 것인지 확인 */
    const upload = await db
      .collection('pastExamUploads')
      .findOne({ _id: new ObjectId(pastExamUploadId) }, { projection: { loginId: 1, files: 1 } });
    if (!upload || upload.loginId !== payload.loginId) {
      return NextResponse.json({ error: '업로드한 시험지를 찾을 수 없습니다.' }, { status: 400 });
    }

    const now = new Date();
    const r = await db.collection(EXAM_TYPE_ANALYSIS_COLLECTION).insertOne({
      loginId: payload.loginId,
      schoolName,
      grade,
      examLabel,
      note,
      pastExamUploadId,
      status: 'requested',
      recommendedTypes: [],
      adminNote: '',
      createdAt: now,
      updatedAt: now,
    });

    notifySlack(
      [
        '📊 기출 유형 분석 요청',
        `회원: ${payload.loginId}`,
        `학교: ${schoolName} ${grade}`,
        `시험: ${examLabel}`,
        note ? `메모: ${note}` : '',
        `관리자 페이지 → 기출 유형 분석에서 처리`,
      ]
        .filter(Boolean)
        .join('\n'),
    ).catch((e) => console.error('[exam-type-analysis] Slack 실패:', e));

    return NextResponse.json({ ok: true, id: String(r.insertedId) });
  } catch (e) {
    console.error('[exam-type-analysis POST]', e);
    return NextResponse.json({ error: '요청 저장에 실패했습니다.' }, { status: 500 });
  }
}
