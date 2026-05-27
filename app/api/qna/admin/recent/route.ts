import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { listRecentThreads, type QnaThreadStatus } from '@/lib/qna-store';

export const dynamic = 'force-dynamic';

const VALID_STATUS: Array<QnaThreadStatus | 'all'> = ['open', 'answered', 'hidden', 'all'];

/**
 * GET /api/qna/admin/recent?status=open|answered|hidden|all&limit=50
 *
 * 트리아지 화면용. 각 thread 에 sourceKey 를 비정규화해 같이 내려준다 (passages 한 번 join).
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 });
  }

  const statusRaw = request.nextUrl.searchParams.get('status');
  const limitRaw = request.nextUrl.searchParams.get('limit');
  const status = (statusRaw && VALID_STATUS.includes(statusRaw as QnaThreadStatus | 'all')
    ? (statusRaw as QnaThreadStatus | 'all')
    : 'all');
  const limit = Math.min(Math.max(parseInt(limitRaw || '50', 10) || 50, 1), 200);

  try {
    const threads = await listRecentThreads({ status, limit });
    if (threads.length === 0) {
      return NextResponse.json({ threads: [] });
    }
    const passageOids = Array.from(
      new Set(threads.map((t) => t.passageId)),
    ).map((id) => {
      try {
        return new ObjectId(id);
      } catch {
        return null;
      }
    }).filter((x): x is ObjectId => !!x);

    const db = await getDb('gomijoshua');
    const passages = passageOids.length > 0
      ? await db
          .collection('passages')
          .find({ _id: { $in: passageOids } })
          .project({ source_key: 1, textbook: 1 })
          .toArray()
      : [];

    const meta = new Map<string, { sourceKey: string | null; textbook: string | null }>();
    for (const p of passages) {
      const id = String((p as { _id: ObjectId })._id);
      meta.set(id, {
        sourceKey: (p as { source_key?: string }).source_key ?? null,
        textbook: (p as { textbook?: string }).textbook ?? null,
      });
    }

    const enriched = threads.map((t) => ({
      ...t,
      sourceKey: meta.get(t.passageId)?.sourceKey ?? null,
      // textbook 은 thread 안에도 있으니 추가하지 않음.
    }));

    return NextResponse.json({ threads: enriched });
  } catch (e) {
    console.error('qna admin recent:', e);
    return NextResponse.json({ error: '목록 조회에 실패했습니다.' }, { status: 500 });
  }
}
