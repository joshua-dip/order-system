import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getDb } from '@/lib/mongodb';
import { uploadVipExamPhoto, deleteDropboxFile, getDropboxTempLink, isDropboxConfigured } from '@/lib/dropbox';
import { EXAM_PHOTOS_COLLECTION, ensureExamPhotoIndexes, type ExamQuestionPhotoDoc } from '@/lib/vip-exam-photos-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SIZE = 12 * 1024 * 1024; // 12MB
const IMAGE_RE = /^image\//;

async function ownExam(db: Awaited<ReturnType<typeof getDb>>, userId: ObjectId, examId: string) {
  if (!ObjectId.isValid(examId)) return null;
  return db.collection('vip_school_exams').findOne({ _id: new ObjectId(examId), userId });
}

/** GET — 시험의 번호별 사진 목록 (임시링크 갱신해서 내려줌) */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const db = await getDb('gomijoshua');
  await ensureExamPhotoIndexes(db);
  const userId = new ObjectId(auth.userId);
  if (!(await ownExam(db, userId, id))) return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 });

  const photos = await db.collection<ExamQuestionPhotoDoc>(EXAM_PHOTOS_COLLECTION)
    .find({ userId, examId: new ObjectId(id) })
    .sort({ uploadedAt: 1 })
    .toArray();

  const withUrls = await Promise.all(photos.map(async (p) => {
    let url = '';
    try { url = await getDropboxTempLink(p.dropboxPath); } catch { url = ''; }
    return { id: String(p._id), questionNum: p.questionNum, name: p.name, url, uploadedAt: p.uploadedAt };
  }));

  const byNum: Record<string, typeof withUrls> = {};
  for (const p of withUrls) { (byNum[p.questionNum] ||= []).push(p); }
  return NextResponse.json({ ok: true, byNum, total: withUrls.length });
}

/** POST — 사진 업로드 (multipart: file, questionNum) */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isDropboxConfigured()) return NextResponse.json({ error: '파일 저장소가 설정되지 않았습니다.' }, { status: 500 });

  const db = await getDb('gomijoshua');
  await ensureExamPhotoIndexes(db);
  const userId = new ObjectId(auth.userId);
  if (!(await ownExam(db, userId, id))) return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 });

  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }
  const file = form.get('file') as File | null;
  const questionNum = String(form.get('questionNum') ?? '').trim().slice(0, 12);
  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
  if (!questionNum) return NextResponse.json({ error: '문항 번호가 없습니다.' }, { status: 400 });
  if (!IMAGE_RE.test(file.type)) return NextResponse.json({ error: '이미지 파일만 업로드할 수 있습니다.' }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: '파일이 너무 큽니다 (최대 12MB).' }, { status: 400 });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const stamp = Date.now();
    const { path, name, tempUrl } = await uploadVipExamPhoto(id, questionNum, file.name || `q${questionNum}.jpg`, buffer, stamp);
    const doc: ExamQuestionPhotoDoc = {
      userId, examId: new ObjectId(id), questionNum, dropboxPath: path, name, uploadedAt: new Date(),
    };
    const r = await db.collection(EXAM_PHOTOS_COLLECTION).insertOne(doc);
    return NextResponse.json({ ok: true, photo: { id: String(r.insertedId), questionNum, name, url: tempUrl } });
  } catch (e) {
    console.error('[question-photos POST]', e);
    return NextResponse.json({ error: '업로드에 실패했습니다.' }, { status: 500 });
  }
}

/** DELETE — 사진 제거 (?photoId=) */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const photoId = request.nextUrl.searchParams.get('photoId');
  if (!photoId || !ObjectId.isValid(photoId)) return NextResponse.json({ error: 'photoId 가 필요합니다.' }, { status: 400 });

  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const photo = await db.collection<ExamQuestionPhotoDoc>(EXAM_PHOTOS_COLLECTION).findOne({ _id: new ObjectId(photoId), userId, examId: new ObjectId(id) });
  if (!photo) return NextResponse.json({ error: '사진을 찾을 수 없습니다.' }, { status: 404 });

  await deleteDropboxFile(photo.dropboxPath);
  await db.collection(EXAM_PHOTOS_COLLECTION).deleteOne({ _id: photo._id });
  return NextResponse.json({ ok: true });
}
