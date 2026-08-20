import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { putPastExamFile, guessContentType, type PastExamFileRef } from '@/lib/past-exam-files';

const EXAM_TYPES = ['1학기중간고사', '1학기기말고사', '2학기중간고사', '2학기기말고사'] as const;
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_FILES = 10;

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }

  try {
    const db = await getDb('gomijoshua');
    // 회원상세 화면에서는 그 회원 건만 본다 (loginId 없으면 기존처럼 전체)
    const loginId = (request.nextUrl.searchParams.get('loginId') ?? '').trim();
    const docs = await db
      .collection('pastExamUploads')
      .find(loginId ? { loginId } : {})
      .sort({ createdAt: -1 })
      .toArray();

    const uploads = docs.map((d) => ({
      id: d._id.toString(),
      loginId: d.loginId,
      school: d.school,
      grade: d.grade,
      examYear: d.examYear,
      examType: d.examType,
      examScope: d.examScope,
      files: (d.files || []).map((f: { originalName: string }, idx: number) => ({
        originalName: f.originalName,
        fileIndex: idx,
      })),
      adminCategories: d.adminCategories || [],
      adminClassifiedAt: d.adminClassifiedAt,
      includesAnswerSheet: d.includesAnswerSheet === true,
      uploadedByAdmin: d.uploadedByAdmin === true,
      pointAwarded: d.pointAwarded === true,
      pointAwardedAt: d.pointAwardedAt ?? null,
      pointAwardAmount: typeof d.pointAwardAmount === 'number' ? d.pointAwardAmount : null,
      createdAt: d.createdAt,
    }));

    return NextResponse.json({ uploads });
  } catch (err) {
    console.error('관리자 기출문제 조회 실패:', err);
    return NextResponse.json({ error: '조회에 실패했습니다.' }, { status: 500 });
  }
}

/**
 * 관리자가 특정 회원 대신 기출문제를 등록합니다. (카톡으로 받은 사진 등 직접 업로드)
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const loginId = (formData.get('loginId') as string)?.trim() ?? '';
    const school = (formData.get('school') as string)?.trim() ?? '';
    const grade = (formData.get('grade') as string)?.trim() ?? '';
    const examYear = (formData.get('examYear') as string)?.trim() ?? '';
    const examType = (formData.get('examType') as string)?.trim() ?? '';
    const examScope = (formData.get('examScope') as string)?.trim() ?? '';
    const includesAnswerSheet = (formData.get('includesAnswerSheet') as string) === 'true';

    if (!loginId) return NextResponse.json({ error: '회원(아이디)을 선택해 주세요.' }, { status: 400 });
    // 학교는 선택 — 회원이 안 알려 주는 경우가 있어 비워 둔 채 등록하고 나중에 채운다.
    if (!grade) return NextResponse.json({ error: '학년을 선택해 주세요.' }, { status: 400 });
    if (!examYear) return NextResponse.json({ error: '시험 연도를 선택해 주세요.' }, { status: 400 });
    if (!EXAM_TYPES.includes(examType as (typeof EXAM_TYPES)[number])) {
      return NextResponse.json({ error: '시험 종류를 선택해 주세요.' }, { status: 400 });
    }

    const fileList: File[] = [];
    const filesField = formData.getAll('files');
    for (const f of filesField) {
      if (f && typeof f === 'object' && 'arrayBuffer' in f) fileList.push(f as File);
    }
    if (fileList.length === 0) {
      return NextResponse.json({ error: '파일을 1개 이상 선택해 주세요.' }, { status: 400 });
    }
    if (fileList.length > MAX_FILES) {
      return NextResponse.json({ error: `파일은 최대 ${MAX_FILES}개까지 첨부할 수 있습니다.` }, { status: 400 });
    }
    for (const f of fileList) {
      if (f.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `파일 크기는 각 15MB 이하여야 합니다. (${f.name})` }, { status: 400 });
      }
    }

    const db = await getDb('gomijoshua');
    const user = await db.collection('users').findOne({ loginId, role: 'user' });
    if (!user) {
      return NextResponse.json({ error: '해당 회원을 찾을 수 없습니다. 아이디를 확인해 주세요.' }, { status: 400 });
    }

    const doc = {
      loginId,
      // 관리자가 회원 대신 올린 건임을 남긴다
      uploadedByAdmin: true,
      uploadedByAdminLoginId: payload.loginId ?? '',
      school,
      grade,
      examYear,
      examType,
      examScope,
      includesAnswerSheet,
      files: [] as PastExamFileRef[],
      createdAt: new Date(),
    };
    const result = await db.collection('pastExamUploads').insertOne(doc);
    const uploadId = result.insertedId.toString();

    // 파일은 GridFS 에 저장한다 — Amplify(Lambda) 는 로컬 파일시스템이 영구적이지 않아
    // 예전 방식(uploads/past-exam/…)으로 저장하면 인스턴스 재활용 시 파일이 사라진다.
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const name = file.name || `file_${i}`;
      const buf = Buffer.from(await file.arrayBuffer());
      const contentType = file.type || guessContentType(name);
      const gridId = await putPastExamFile(db, buf, `${uploadId}_${i}_${name}`, contentType);
      doc.files.push({ originalName: name, gridId, contentType, size: buf.length });
    }

    if (doc.files.length > 0) {
      await db.collection('pastExamUploads').updateOne(
        { _id: result.insertedId },
        { $set: { files: doc.files } }
      );
    }

    return NextResponse.json({ ok: true, id: uploadId });
  } catch (err) {
    console.error('관리자 기출 등록 실패:', err);
    return NextResponse.json({ error: '등록에 실패했습니다.' }, { status: 500 });
  }
}
