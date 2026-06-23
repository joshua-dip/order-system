import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { VIP_API_KEYS_COLLECTION, ensureApiKeyIndexes, recordApiKeyUsage, type VipApiKeyDoc } from '@/lib/vip-api-keys-store';
import { QUESTION_BANK_COLLECTION, type SavedQuestionDoc } from '@/lib/vip-question-bank-store';
import { sanitizeQuestionDataForExport } from '@/lib/question-options-segments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** 요청에서 API 키 추출 — Authorization: Bearer <key> 또는 ?key= */
function extractKey(request: NextRequest): string {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  return (request.nextUrl.searchParams.get('key') || '').trim();
}

/**
 * GET /api/public/question-bank — 내 문제은행(저장 문항)을 본문과 함께 외부로 제공.
 * 인증: Authorization: Bearer <qbk_...>  또는  ?key=<qbk_...>
 * 필터: ?folder= &type= &limit=(기본 50, 최대 200) &offset=
 */
export async function GET(request: NextRequest) {
  const key = extractKey(request);
  if (!key) return json({ ok: false, error: 'API 키가 필요합니다. (Authorization: Bearer <key> 또는 ?key=)' }, 401);

  const db = await getDb('gomijoshua');
  const keyDoc = await db.collection<VipApiKeyDoc>(VIP_API_KEYS_COLLECTION).findOne({ key });
  if (!keyDoc) return json({ ok: false, error: '유효하지 않은 API 키입니다.' }, 403);

  const userId = keyDoc.userId;
  await ensureApiKeyIndexes(db);
  // 마지막 사용 시각 (best-effort)
  db.collection(VIP_API_KEYS_COLLECTION).updateOne({ _id: keyDoc._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});

  const sp = request.nextUrl.searchParams;
  const folder = sp.get('folder');
  const type = (sp.get('type') || '').trim();
  const limit = Math.min(200, Math.max(1, Number(sp.get('limit')) || 50));
  const offset = Math.max(0, Number(sp.get('offset')) || 0);

  const filter: Record<string, unknown> = { userId };
  if (folder !== null && folder !== '__all__') filter.folder = folder;
  if (type) filter.type = type;

  const col = db.collection<SavedQuestionDoc>(QUESTION_BANK_COLLECTION);
  const total = await col.countDocuments(filter);
  const saved = await col.find(filter).sort({ savedAt: -1 }).skip(offset).limit(limit).toArray();

  // 원본 본문(question_data) 조인
  const qids = saved.map((s) => s.questionId).filter(Boolean);
  const originals = qids.length
    ? await db.collection('generated_questions')
        .find({ _id: { $in: qids } })
        .project({ question_data: 1, type: 1, textbook: 1, source: 1, difficulty: 1, serialNo: 1 })
        .toArray()
    : [];
  const origById = new Map(originals.map((o) => [String(o._id), o]));

  const items = saved.map((s) => {
    const o = origById.get(String(s.questionId));
    return {
      serialNo: s.serialNo ?? null,
      type: s.type,
      textbook: s.textbook,
      source: s.source,
      difficulty: s.difficulty,
      folder: s.folder ?? '',
      tags: s.tags ?? [],
      savedAt: s.savedAt,
      questionId: String(s.questionId),
      // 원본이 삭제됐으면 null. `###` 구분자는 외부 노출용으로 정규화(Options→배열·줄바꿈, Paragraph 블록→빈 줄).
      questionData: o ? sanitizeQuestionDataForExport(o.question_data ?? null) : null,
    };
  });

  // 호출 사용 로그 기록 (best-effort)
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || '';
  recordApiKeyUsage(db, {
    userId,
    keyId: keyDoc._id as ObjectId,
    keyLabel: keyDoc.label,
    at: new Date(),
    endpoint: 'question-bank',
    ...(folder && folder !== '__all__' ? { folder } : {}),
    ...(type ? { type } : {}),
    limit, offset,
    count: items.length,
    status: 200,
    ...(ip ? { ip } : {}),
    ...(request.headers.get('user-agent') ? { userAgent: String(request.headers.get('user-agent')).slice(0, 200) } : {}),
  }).catch(() => {});

  return json({ ok: true, total, count: items.length, limit, offset, items });
}
