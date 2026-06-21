import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getDb } from '@/lib/mongodb';
import {
  QUESTION_BANK_COLLECTION,
  ensureQuestionBankIndexes,
  previewText,
  type SavedQuestionDoc,
} from '@/lib/vip-question-bank-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — 내 문제은행 목록 (folder/type/q 필터) + 폴더 목록 */
export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  await ensureQuestionBankIndexes(db);
  const userId = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const folder = sp.get('folder');
  const type = (sp.get('type') || '').trim();
  const q = (sp.get('q') || '').trim();

  const filter: Record<string, unknown> = { userId };
  if (folder !== null && folder !== '__all__') filter.folder = folder; // '' = 미분류
  if (type) filter.type = type;
  if (q) {
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const serialMatch = q.match(/^v?-?\s*0*(\d{1,7})$/i);
    if (serialMatch) filter.serialNo = Number(serialMatch[1]);
    else filter.$or = [{ source: { $regex: esc, $options: 'i' } }, { textbook: { $regex: esc, $options: 'i' } }, { question: { $regex: esc, $options: 'i' } }];
  }

  const col = db.collection<SavedQuestionDoc>(QUESTION_BANK_COLLECTION);
  const [items, folders] = await Promise.all([
    col.find(filter).sort({ savedAt: -1 }).limit(500).toArray(),
    col.aggregate([{ $match: { userId } }, { $group: { _id: '$folder', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
  ]);

  return NextResponse.json({
    ok: true,
    items: items.map((s) => ({
      id: String(s._id),
      questionId: String(s.questionId),
      serialNo: s.serialNo ?? null,
      type: s.type,
      textbook: s.textbook,
      source: s.source,
      difficulty: s.difficulty,
      question: s.question,
      preview: s.preview,
      folder: s.folder ?? '',
      tags: s.tags ?? [],
      savedAt: s.savedAt,
    })),
    folders: folders.map((f) => ({ name: String(f._id ?? ''), count: f.count as number })),
  });
}

/** POST — 문제 담기 ({ questionIds: string[], folder?: string }) */
export async function POST(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  let body: { questionIds?: unknown; folder?: unknown };
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }

  const ids = Array.isArray(body.questionIds)
    ? body.questionIds.map((x) => String(x)).filter((x) => ObjectId.isValid(x))
    : [];
  if (ids.length === 0) return NextResponse.json({ error: '담을 문제가 없습니다.' }, { status: 400 });
  const folder = typeof body.folder === 'string' ? body.folder.slice(0, 40) : '';

  const db = await getDb('gomijoshua');
  await ensureQuestionBankIndexes(db);
  const userId = new ObjectId(auth.userId);

  const oids = ids.map((id) => new ObjectId(id));
  const docs = await db.collection('generated_questions')
    .find({ _id: { $in: oids }, status: '완료' })
    .project({ serialNo: 1, type: 1, textbook: 1, source: 1, difficulty: 1, 'question_data.Question': 1, 'question_data.Paragraph': 1, 'question_data.Source': 1 })
    .toArray();

  const now = new Date();
  const ops = docs.map((d) => {
    const qd = (d.question_data ?? {}) as { Question?: string; Paragraph?: string; Source?: string };
    const set: SavedQuestionDoc = {
      userId,
      questionId: d._id as ObjectId,
      serialNo: typeof d.serialNo === 'number' ? d.serialNo : undefined,
      type: String(d.type ?? ''),
      textbook: String(d.textbook ?? ''),
      source: String(d.source ?? qd.Source ?? ''),
      difficulty: String(d.difficulty ?? ''),
      question: previewText(qd.Question, 90),
      preview: previewText(qd.Paragraph, 140),
      folder,
      tags: [],
      savedAt: now,
    };
    return {
      updateOne: {
        filter: { userId, questionId: d._id },
        // 이미 담긴 건 folder/표시필드만 갱신하지 않고 유지(중복 방지) — savedAt 등은 최초만
        update: { $setOnInsert: set },
        upsert: true,
      },
    };
  });

  let added = 0;
  if (ops.length > 0) {
    const r = await db.collection(QUESTION_BANK_COLLECTION).bulkWrite(ops, { ordered: false });
    added = r.upsertedCount;
  }
  return NextResponse.json({ ok: true, added, requested: ids.length, alreadySaved: ids.length - added });
}

/** DELETE — 내 문제은행에서 제거 (?id= 저장항목 / ?questionId=) */
export async function DELETE(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const sp = request.nextUrl.searchParams;
  const id = sp.get('id');
  const questionId = sp.get('questionId');

  let filter: Record<string, unknown> | null = null;
  if (id && ObjectId.isValid(id)) filter = { _id: new ObjectId(id), userId };
  else if (questionId && ObjectId.isValid(questionId)) filter = { questionId: new ObjectId(questionId), userId };
  if (!filter) return NextResponse.json({ error: 'id 또는 questionId 가 필요합니다.' }, { status: 400 });

  const r = await db.collection(QUESTION_BANK_COLLECTION).deleteOne(filter);
  return NextResponse.json({ ok: true, deleted: r.deletedCount });
}

/** PATCH — 폴더/태그 변경 ({ ids: string[], folder?: string }) */
export async function PATCH(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  let body: { ids?: unknown; folder?: unknown };
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }); }
  const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x)).filter((x) => ObjectId.isValid(x)) : [];
  if (ids.length === 0) return NextResponse.json({ error: '대상이 없습니다.' }, { status: 400 });
  const folder = typeof body.folder === 'string' ? body.folder.slice(0, 40) : '';

  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const r = await db.collection(QUESTION_BANK_COLLECTION).updateMany(
    { userId, _id: { $in: ids.map((id) => new ObjectId(id)) } },
    { $set: { folder } },
  );
  return NextResponse.json({ ok: true, updated: r.modifiedCount });
}
