import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import {
  TEXTBOOK_LINKS_COLLECTION,
  textbookLinksMapFromDb,
  type TextbookLinksMap,
} from '@/lib/textbook-links-db';

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return { error: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }) };
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return { error: NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 }) };
  }
  return { error: null };
}

/** 전체 맵 조회 (관리자) */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  try {
    const db = await getDb('gomijoshua');
    const map = await textbookLinksMapFromDb(db);
    return NextResponse.json({ links: map, count: Object.keys(map).length });
  } catch (e) {
    console.error('admin textbook-links GET:', e);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}

/**
 * 한 건 upsert: { textbookKey, kyoboUrl, description }
 * 또는 일괄: { links: { "교재명": { kyoboUrl, description }, ... } } → 전체 치환은 위험하므로 linksMerge만
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  try {
    const body = await request.json();
    const db = await getDb('gomijoshua');
    const col = db.collection(TEXTBOOK_LINKS_COLLECTION);
    const now = new Date();

    if (body?.links && typeof body.links === 'object' && !Array.isArray(body.links)) {
      const links = body.links as TextbookLinksMap;
      const entries = Object.entries(links).filter(
        ([k, v]) =>
          typeof k === 'string' &&
          k.trim() &&
          v &&
          typeof v === 'object' &&
          typeof (v as { kyoboUrl?: string }).kyoboUrl === 'string' &&
          typeof (v as { description?: string }).description === 'string'
      );
      if (entries.length === 0) {
        return NextResponse.json({ error: '유효한 links 항목이 없습니다.' }, { status: 400 });
      }
      await col.bulkWrite(
        entries.map(([textbookKey, v]) => ({
          updateOne: {
            filter: { textbookKey },
            update: {
              $set: {
                textbookKey,
                kyoboUrl: String(v.kyoboUrl).trim(),
                description: String(v.description).trim(),
                updatedAt: now,
              },
            },
            upsert: true,
          },
        }))
      );
      await col.createIndex({ textbookKey: 1 }, { unique: true }).catch(() => {});
      return NextResponse.json({ ok: true, upserted: entries.length });
    }

    const textbookKey = typeof body?.textbookKey === 'string' ? body.textbookKey.trim() : '';
    const kyoboUrl = typeof body?.kyoboUrl === 'string' ? body.kyoboUrl.trim() : '';
    const description = typeof body?.description === 'string' ? body.description.trim() : '';
    if (!textbookKey || !kyoboUrl) {
      return NextResponse.json({ error: 'textbookKey, kyoboUrl는 필수입니다.' }, { status: 400 });
    }
    await col.updateOne(
      { textbookKey },
      { $set: { textbookKey, kyoboUrl, description, updatedAt: now } },
      { upsert: true }
    );
    await col.createIndex({ textbookKey: 1 }, { unique: true }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('admin textbook-links POST:', e);
    return NextResponse.json({ error: '저장 실패' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const key = request.nextUrl.searchParams.get('key')?.trim();
  if (!key) {
    return NextResponse.json({ error: 'key 쿼리가 필요합니다.' }, { status: 400 });
  }
  try {
    const db = await getDb('gomijoshua');
    const result = await db.collection(TEXTBOOK_LINKS_COLLECTION).deleteOne({ textbookKey: key });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: '해당 교재 키가 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('admin textbook-links DELETE:', e);
    return NextResponse.json({ error: '삭제 실패' }, { status: 500 });
  }
}
