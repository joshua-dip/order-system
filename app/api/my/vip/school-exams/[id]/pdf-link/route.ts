import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, col, type VipSchoolExam } from '@/lib/vip-db';
import { getDropboxTempLink } from '@/lib/dropbox';

/** 시험지 PDF 임시 링크 생성 (클릭 시 호출) */
export async function GET(
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
  const exam = await col<VipSchoolExam>(db, 'schoolExams').findOne({
    _id: new ObjectId(id),
    userId: new ObjectId(auth.userId),
  });

  if (!exam) {
    return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 });
  }

  if (!exam.pdfPath) {
    return NextResponse.json({ error: '업로드된 시험지가 없습니다.' }, { status: 404 });
  }

  try {
    const url = await getDropboxTempLink(exam.pdfPath);
    return NextResponse.json({ ok: true, url });
  } catch (err) {
    console.error('PDF 임시 링크 생성 실패:', err);
    const msg = err instanceof Error ? err.message : '링크 생성 실패';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
