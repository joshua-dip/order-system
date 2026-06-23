import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getVipDb } from '@/lib/vip-db';
import {
  VIP_LECTURE_VIDEOS_COLLECTION,
  ensureLectureVideoIndexes,
  parseVideoUrl,
  type VipLectureVideo,
} from '@/lib/vip-lecture-video-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(v: VipLectureVideo) {
  return {
    id: String(v._id),
    title: v.title,
    url: v.url,
    provider: v.provider,
    videoId: v.videoId,
    embedUrl: v.embedUrl,
    thumbnailUrl: v.thumbnailUrl,
    description: v.description ?? '',
    folder: v.folder ?? '',
    order: typeof v.order === 'number' ? v.order : 0,
    textbook: v.textbook ?? '',
    durationMin: typeof v.durationMin === 'number' ? v.durationMin : null,
    createdAt: v.createdAt,
  };
}

const normUrl = (u: unknown): string => {
  const s = (typeof u === 'string' ? u : '').trim().slice(0, 600);
  return /^https?:\/\//i.test(s) ? s : '';
};

/** GET ?folder= &q= — 강의영상 목록(강좌·회차순) + 폴더(강좌) 목록. */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'videos');
  if (auth instanceof NextResponse) return auth;
  const db = await getVipDb();
  await ensureLectureVideoIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const folder = sp.get('folder');
  const q = (sp.get('q') || '').trim();

  const filter: Record<string, unknown> = { userId: uid };
  if (folder !== null && folder !== '__all__') filter.folder = folder;
  if (q) {
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ title: { $regex: esc, $options: 'i' } }, { description: { $regex: esc, $options: 'i' } }, { textbook: { $regex: esc, $options: 'i' } }];
  }

  const col = db.collection<VipLectureVideo>(VIP_LECTURE_VIDEOS_COLLECTION);
  const [videos, folders] = await Promise.all([
    col.find(filter).sort({ folder: 1, order: 1, createdAt: -1 }).limit(500).toArray(),
    col.aggregate([{ $match: { userId: uid } }, { $group: { _id: '$folder', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
  ]);

  return NextResponse.json({
    ok: true,
    videos: videos.map(view),
    folders: folders.map((f) => ({ name: String(f._id ?? ''), count: f.count as number })),
  });
}

/** POST { title, url, description?, folder?, order?, textbook?, durationMin? } — 영상 등록. */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'videos');
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const title = (typeof body.title === 'string' ? body.title : '').trim().slice(0, 160);
  const url = normUrl(body.url);
  if (!title) return NextResponse.json({ error: '영상 제목을 입력하세요.' }, { status: 400 });
  if (!url) return NextResponse.json({ error: '올바른 영상 URL(http…)을 입력하세요.' }, { status: 400 });

  const parsed = parseVideoUrl(url);
  const db = await getVipDb();
  await ensureLectureVideoIndexes(db);
  const uid = new ObjectId(auth.userId);

  const orderRaw = Number(body.order);
  const durRaw = Number(body.durationMin);
  const doc: VipLectureVideo = {
    userId: uid, title, url,
    provider: parsed.provider, videoId: parsed.videoId, embedUrl: parsed.embedUrl, thumbnailUrl: parsed.thumbnailUrl,
    description: typeof body.description === 'string' ? body.description.slice(0, 1000) : '',
    folder: typeof body.folder === 'string' ? body.folder.trim().slice(0, 60) : '',
    order: Number.isFinite(orderRaw) ? Math.max(0, Math.floor(orderRaw)) : 0,
    ...(typeof body.textbook === 'string' && body.textbook.trim() ? { textbook: body.textbook.trim().slice(0, 120) } : {}),
    ...(Number.isFinite(durRaw) && durRaw > 0 ? { durationMin: Math.min(1000, Math.floor(durRaw)) } : {}),
    createdAt: new Date(),
  };
  const r = await db.collection(VIP_LECTURE_VIDEOS_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId), provider: parsed.provider }, { status: 201 });
}

/** PATCH ?id= { title?, url?, description?, folder?, order?, textbook?, durationMin? } */
export async function PATCH(request: NextRequest) {
  const auth = await requireVipMenu(request, 'videos');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === 'string' && body.title.trim()) set.title = body.title.trim().slice(0, 160);
  if (body.url !== undefined) {
    const url = normUrl(body.url);
    if (!url) return NextResponse.json({ error: '올바른 영상 URL(http…)을 입력하세요.' }, { status: 400 });
    const parsed = parseVideoUrl(url);
    set.url = url; set.provider = parsed.provider; set.videoId = parsed.videoId; set.embedUrl = parsed.embedUrl; set.thumbnailUrl = parsed.thumbnailUrl;
  }
  if (typeof body.description === 'string') set.description = body.description.slice(0, 1000);
  if (typeof body.folder === 'string') set.folder = body.folder.trim().slice(0, 60);
  if (body.order !== undefined) { const n = Number(body.order); set.order = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; }
  if (typeof body.textbook === 'string') set.textbook = body.textbook.trim().slice(0, 120);
  if (body.durationMin !== undefined) { const n = Number(body.durationMin); set.durationMin = Number.isFinite(n) && n > 0 ? Math.min(1000, Math.floor(n)) : null; }

  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_LECTURE_VIDEOS_COLLECTION).updateOne({ _id: new ObjectId(id), userId: uid }, { $set: set });
  if (r.matchedCount === 0) return NextResponse.json({ error: '영상을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireVipMenu(request, 'videos');
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 });
  const db = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const r = await db.collection(VIP_LECTURE_VIDEOS_COLLECTION).deleteOne({ _id: new ObjectId(id), userId: uid });
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}
