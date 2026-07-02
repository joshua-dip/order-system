import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import {
  STUDIO_MATERIALS_COLLECTION,
  sanitizeStudioPages,
  buildGrammarSeedDoc,
  buildCoverPage,
  STUDIO_DIFFICULTIES,
  type StudioDifficulty,
} from '@/lib/vip-material-studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — 내 스튜디오 교재 목록 */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection(STUDIO_MATERIALS_COLLECTION)
    .find({ userId: new ObjectId(auth.userId) })
    .project({ title: 1, subtitle: 1, difficulty: 1, updatedAt: 1, createdAt: 1, pages: { $slice: 0 }, pageCount: 1 })
    .sort({ updatedAt: -1 })
    .limit(200)
    .toArray();
  return NextResponse.json({
    ok: true,
    items: docs.map((d) => ({
      id: String(d._id),
      title: d.title ?? '',
      subtitle: d.subtitle ?? '',
      difficulty: d.difficulty ?? '',
      pageCount: typeof d.pageCount === 'number' ? d.pageCount : 0,
      updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : null,
    })),
  });
}

/**
 * POST — 생성.
 *  · { seed: 'grammar8' } → 여름방학 문법특강 3난이도 세트(기초/심화/고난도) 3개 생성
 *  · { title, difficulty? } → 빈 교재(표지 1장) 생성
 */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const db = await getDb('gomijoshua');
  const col = db.collection(STUDIO_MATERIALS_COLLECTION);
  const userId = new ObjectId(auth.userId);
  const now = new Date();

  if (body.seed === 'grammar8') {
    const ids: string[] = [];
    for (const level of STUDIO_DIFFICULTIES) {
      const seed = buildGrammarSeedDoc(level);
      const r = await col.insertOne({
        userId,
        title: seed.title,
        subtitle: seed.subtitle ?? '',
        difficulty: seed.difficulty ?? '',
        pages: sanitizeStudioPages(seed.pages),
        pageCount: seed.pages.length,
        createdAt: now,
        updatedAt: now,
      });
      ids.push(String(r.insertedId));
    }
    return NextResponse.json({ ok: true, ids });
  }

  const title = (typeof body.title === 'string' ? body.title.trim() : '').slice(0, 120) || '새 교재';
  const diffRaw = typeof body.difficulty === 'string' ? body.difficulty : '';
  const difficulty = (STUDIO_DIFFICULTIES as readonly string[]).includes(diffRaw) ? (diffRaw as StudioDifficulty) : '기초';
  const cover = buildCoverPage({ title, subtitle: '', level: difficulty });
  const r = await col.insertOne({
    userId,
    title,
    subtitle: '',
    difficulty,
    pages: sanitizeStudioPages([cover]),
    pageCount: 1,
    createdAt: now,
    updatedAt: now,
  });
  return NextResponse.json({ ok: true, id: String(r.insertedId) });
}
