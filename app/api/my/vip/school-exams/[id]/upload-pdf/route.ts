import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, col, type VipSchoolExam } from '@/lib/vip-db';
import { uploadVipExamPdf } from '@/lib/dropbox';

const MAX_SIZE = 20 * 1024 * 1024; // 20MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
  }

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);

  const exam = await col<VipSchoolExam>(db, 'schoolExams').findOne({
    _id: new ObjectId(id),
    userId: uid,
  });
  if (!exam) {
    return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: '파일 파싱에 실패했습니다.' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
  }
  if (file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'PDF 파일만 업로드 가능합니다.' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: '파일 크기는 20MB 이하여야 합니다.' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { path, name, tempUrl } = await uploadVipExamPdf(id, file.name, buffer);

    await col<VipSchoolExam>(db, 'schoolExams').updateOne(
      { _id: new ObjectId(id), userId: uid },
      { $set: { pdfPath: path, pdfName: name, pdfUrl: tempUrl, updatedAt: new Date() } },
    );

    return NextResponse.json({ ok: true, pdfPath: path, pdfName: name, pdfUrl: tempUrl });
  } catch (err) {
    console.error('VIP 시험지 PDF 업로드 실패:', err);
    const msg = err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
