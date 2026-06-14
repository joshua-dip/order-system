import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { EXAM_TYPE_ANALYSIS_COLLECTION, parseRecommendedTypes } from '@/lib/exam-type-analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 관리자 — 기출 유형 분석 요청 목록 (연결된 기출 업로드 파일 포함) */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  try {
    const db = await getDb('gomijoshua');
    const statusFilter = request.nextUrl.searchParams.get('status');
    const filter =
      statusFilter === 'requested' || statusFilter === 'done' ? { status: statusFilter } : {};
    const docs = await db
      .collection(EXAM_TYPE_ANALYSIS_COLLECTION)
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    /* 연결된 기출 업로드 파일 목록 join */
    const uploadIds = [...new Set(docs.map((d) => String(d.pastExamUploadId ?? '')).filter((s) => ObjectId.isValid(s)))];
    const uploads = uploadIds.length
      ? await db
          .collection('pastExamUploads')
          .find({ _id: { $in: uploadIds.map((s) => new ObjectId(s)) } })
          .project({ files: 1, school: 1, examScope: 1 })
          .toArray()
      : [];
    const uploadMap = new Map(uploads.map((u) => [String(u._id), u]));

    return NextResponse.json({
      items: docs.map((d) => {
        const up = uploadMap.get(String(d.pastExamUploadId ?? ''));
        const files = Array.isArray(up?.files)
          ? (up!.files as { originalName?: string }[]).map((f, idx) => ({
              originalName: String(f.originalName ?? `file-${idx}`),
              fileIndex: idx,
            }))
          : [];
        return {
          id: String(d._id),
          loginId: d.loginId ?? '',
          schoolName: d.schoolName ?? '',
          grade: d.grade ?? '',
          examLabel: d.examLabel ?? '',
          note: typeof d.note === 'string' ? d.note : '',
          status: d.status === 'done' ? 'done' : 'requested',
          recommendedTypes: parseRecommendedTypes(d.recommendedTypes),
          adminNote: typeof d.adminNote === 'string' ? d.adminNote : '',
          pastExamUploadId: String(d.pastExamUploadId ?? ''),
          examScope: typeof up?.examScope === 'string' ? up.examScope : '',
          files,
          createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt ?? ''),
          analyzedAt: d.analyzedAt instanceof Date ? d.analyzedAt.toISOString() : null,
        };
      }),
    });
  } catch (e) {
    console.error('[admin exam-type-analysis GET]', e);
    return NextResponse.json({ error: '목록 조회에 실패했습니다.' }, { status: 500 });
  }
}

/** 관리자 — 추천 유형 세트 등록(완료 처리) / 수정 */
export async function PATCH(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: { id?: unknown; recommendedTypes?: unknown; adminNote?: unknown; status?: unknown };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }
  const id = typeof body.id === 'string' && ObjectId.isValid(body.id) ? body.id : '';
  if (!id) return NextResponse.json({ error: '유효한 id가 필요합니다.' }, { status: 400 });

  const recommended = parseRecommendedTypes(body.recommendedTypes);
  const adminNote = typeof body.adminNote === 'string' ? body.adminNote.trim().slice(0, 2000) : '';
  const status = body.status === 'requested' ? 'requested' : 'done';
  if (status === 'done' && recommended.length === 0) {
    return NextResponse.json({ error: '완료 처리하려면 추천 유형을 1개 이상 입력하세요.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const now = new Date();
    const r = await db.collection(EXAM_TYPE_ANALYSIS_COLLECTION).updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          recommendedTypes: recommended,
          adminNote,
          status,
          updatedAt: now,
          ...(status === 'done' ? { analyzedAt: now } : {}),
        },
      },
    );
    if (r.matchedCount === 0) return NextResponse.json({ error: '요청을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[admin exam-type-analysis PATCH]', e);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}
