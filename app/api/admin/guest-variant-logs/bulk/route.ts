import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { GUEST_GENERATED_QUESTIONS_COLLECTION } from '@/lib/guest-generated-questions-store';
import { promoteGuestLog, type PromoteGuestLogResult } from '@/lib/guest-variant-logs-promote';

const MAX_IDS = 50;

type Action = 'delete' | 'promote' | 'addTag' | 'removeTag' | 'archive' | 'unarchive';

function parseIds(raw: unknown): ObjectId[] {
  if (!Array.isArray(raw)) return [];
  const out: ObjectId[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && ObjectId.isValid(v)) out.push(new ObjectId(v));
    if (out.length >= MAX_IDS) break;
  }
  return out;
}

export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문 필요' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? (body.action as Action) : null;
  const ids = parseIds(body.ids);
  if (!action || ids.length === 0) {
    return NextResponse.json({ error: 'action과 ids 필수 (최대 50건)' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection(GUEST_GENERATED_QUESTIONS_COLLECTION);

    switch (action) {
      case 'delete': {
        const r = await col.deleteMany({ _id: { $in: ids } });
        return NextResponse.json({ ok: true, affected: r.deletedCount });
      }

      case 'archive':
      case 'unarchive': {
        const r = await col.updateMany(
          { _id: { $in: ids } },
          {
            $set: {
              archived: action === 'archive',
              reviewed_at: new Date(),
              ...(payload?.loginId ? { reviewed_by: payload.loginId } : {}),
            },
          },
        );
        return NextResponse.json({ ok: true, affected: r.modifiedCount });
      }

      case 'addTag': {
        const tag =
          typeof body.tag === 'string' ? body.tag.trim().slice(0, 40) : '';
        if (!tag) return NextResponse.json({ error: 'tag 필요' }, { status: 400 });
        const r = await col.updateMany(
          { _id: { $in: ids } },
          { $addToSet: { tags: tag }, $set: { reviewed_at: new Date() } },
        );
        return NextResponse.json({ ok: true, affected: r.modifiedCount });
      }

      case 'removeTag': {
        const tag =
          typeof body.tag === 'string' ? body.tag.trim().slice(0, 40) : '';
        if (!tag) return NextResponse.json({ error: 'tag 필요' }, { status: 400 });
        const r = await col.updateMany(
          { _id: { $in: ids } },
          { $pull: { tags: tag as unknown as never }, $set: { reviewed_at: new Date() } },
        );
        return NextResponse.json({ ok: true, affected: r.modifiedCount });
      }

      case 'promote': {
        const statusRaw = typeof body.status === 'string' ? body.status : '대기';
        const status: '대기' | '완료' = statusRaw === '완료' ? '완료' : '대기';
        const results: PromoteGuestLogResult[] = [];
        for (const oid of ids) {
          const r = await promoteGuestLog(String(oid), {
            status,
            adminLoginId: payload?.loginId,
          });
          results.push(r);
        }
        const ok = results.filter((r) => r.ok).length;
        const failed = results.filter((r) => !r.ok).length;
        return NextResponse.json({ ok: true, affected: ok, failed, results });
      }

      default:
        return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 });
    }
  } catch (e) {
    console.error('guest-variant-logs bulk:', e);
    return NextResponse.json({ error: '일괄 작업 실패' }, { status: 500 });
  }
}
