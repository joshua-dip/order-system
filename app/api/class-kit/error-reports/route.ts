import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { notifySlack } from '@/lib/slack';
import {
  CONTENT_ERROR_REPORTS_COLLECTION,
  countRecentReportsByIp,
  normalizeErrorReportInput,
  type ErrorReportDoc,
} from '@/lib/content-error-reports';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_PER_HOUR = 10;

function getIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

/** POST /api/class-kit/error-reports — 수업 화면 오류 신고(비로그인 가능, IP 시간당 10건) */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }
  const parsed = normalizeErrorReportInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  try {
    const db = await getDb('gomijoshua');
    const ip = getIp(request);
    if ((await countRecentReportsByIp(db, ip)) >= RATE_LIMIT_PER_HOUR) {
      return NextResponse.json({ error: '신고가 너무 많아요. 잠시 뒤에 다시 보내 주세요.' }, { status: 429 });
    }
    const passage = await db.collection('passages').findOne(
      { _id: new ObjectId(v.passageId) },
      { projection: { textbook: 1, source_key: 1 } },
    );
    if (!passage) return NextResponse.json({ error: '지문을 찾을 수 없습니다.' }, { status: 404 });

    const token = request.cookies.get(COOKIE_NAME)?.value;
    const payload = token ? await verifyToken(token) : null;
    const now = new Date();
    const doc: ErrorReportDoc = {
      passageId: new ObjectId(v.passageId),
      textbook: String(passage.textbook ?? ''),
      sourceKey: String(passage.source_key ?? ''),
      sentenceIndex: v.sentenceIndex,
      ...(v.questionId ? { questionId: new ObjectId(v.questionId) } : {}),
      kind: v.kind,
      message: v.message,
      reporter: { ...(payload ? { loginId: payload.loginId, role: payload.role } : {}), ip },
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
    const r = await db.collection<ErrorReportDoc>(CONTENT_ERROR_REPORTS_COLLECTION).insertOne(doc);

    const where = v.sentenceIndex < 0 ? '지문 전체' : `${v.sentenceIndex + 1}번 문장`;
    void notifySlack(
      [
        '🚩 *수업 화면 오류 신고* (gomijoshua)',
        `${doc.textbook}${doc.sourceKey ? ` · ${doc.sourceKey}` : ''} · ${where} · ${v.kind}`,
        `> ${v.message.slice(0, 160).replace(/`/g, "'")}`,
      ].join('\n'),
    ).catch(() => {});

    return NextResponse.json({ ok: true, id: String(r.insertedId) });
  } catch (e) {
    console.error('class-kit error report POST:', e);
    return NextResponse.json({ error: '신고를 저장하지 못했습니다.' }, { status: 500 });
  }
}
