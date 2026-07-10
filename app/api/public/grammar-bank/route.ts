import { NextRequest, NextResponse, after } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { VIP_API_KEYS_COLLECTION, ensureApiKeyIndexes, recordApiKeyUsage, lookupGeo, type VipApiKeyDoc } from '@/lib/vip-api-keys-store';
import { GRAMMAR_PROBLEMS_COLLECTION, formatGrammarSerial } from '@/lib/vip-grammar-problem-bank';
import { deriveProblemCategory, isProblemCategory } from '@/lib/vip-problem-category';

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

/** 요청에서 API 키 추출 — Authorization: Bearer <key> 또는 ?key= (문제은행 API 와 동일 키 사용) */
function extractKey(request: NextRequest): string {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  return (request.nextUrl.searchParams.get('key') || '').trim();
}

interface GrammarDoc {
  _id: ObjectId;
  serialNo?: number;
  topicKey?: string;
  과정?: string;
  대단원?: string;
  학습주제?: string;
  unit?: number;
  section?: string;
  no?: number;
  type?: string;
  category?: string;
  instruction?: string;
  choices?: string[];
  options?: string[];
  question?: string;
  answer?: string;
  explanation?: string;
  source?: string;
  subjective?: { type?: string; instruction?: string; answer?: string; choices?: string[] };
}

/** 형식(mc|subjective)에 맞춘 외부 노출 뷰 — 주관식 원형이 없으면(A 선택형 등) 저장 형태 그대로. */
function view(d: GrammarDoc, fmt: 'mc' | 'subjective') {
  const useSubj = fmt === 'subjective' && d.subjective;
  return {
    serialNo: d.serialNo ?? null,
    serial: formatGrammarSerial(d.serialNo),
    topicKey: d.topicKey ?? '',
    course: d.과정 ?? '',
    chapter: d.대단원 ?? '',
    topic: d.학습주제 ?? '',
    unit: d.unit ?? null,
    section: d.section ?? '',
    no: d.no ?? null,
    format: useSubj ? 'subjective' : (d.options?.length ? 'mc' : 'plain'),
    category: isProblemCategory(d.category) ? d.category : deriveProblemCategory(d),
    type: useSubj ? (d.subjective?.type ?? '') : (d.type ?? ''),
    instruction: useSubj ? (d.subjective?.instruction ?? '') : (d.instruction ?? ''),
    question: d.question ?? '', // <u>..</u> = 밑줄
    choices: useSubj ? (d.subjective?.choices ?? undefined) : (d.choices ?? undefined),
    options: useSubj ? undefined : (d.options ?? undefined), // ①~④ 순서
    answer: useSubj ? (d.subjective?.answer ?? '') : (d.answer ?? ''),
    explanation: d.explanation ?? '',
    source: d.source ?? '',
  };
}

/**
 * GET /api/public/grammar-bank — 문법 문제은행을 외부 웹에서 사용 (문제은행 API 와 같은 키).
 * 인증: Authorization: Bearer <qbk_...> 또는 ?key=<qbk_...>
 * 조회: ?meta=topics → 진도(topicKey)별 문항 수 목록
 *      ?topicKey= (정확 일치) 또는 ?course=&chapter=&topic= 부분 필터 + ?source=
 *      ?format=mc(기본)|subjective  ?sample=N(무작위 N개, offset 무시)  ?limit=(기본 50, 최대 200) &offset=
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const key = extractKey(request);
  if (!key) return json({ ok: false, error: 'API 키가 필요합니다. (Authorization: Bearer <key> 또는 ?key=)' }, 401);

  const db = await getDb('gomijoshua');
  const keyDoc = await db.collection<VipApiKeyDoc>(VIP_API_KEYS_COLLECTION).findOne({ key });
  if (!keyDoc) return json({ ok: false, error: '유효하지 않은 API 키입니다.' }, 403);

  const userId = keyDoc.userId;
  await ensureApiKeyIndexes(db);
  db.collection(VIP_API_KEYS_COLLECTION).updateOne({ _id: keyDoc._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});

  const sp = request.nextUrl.searchParams;
  const meta = (sp.get('meta') || '').trim();
  const topicKey = (sp.get('topicKey') || '').trim();
  const course = (sp.get('course') || '').trim();
  const chapter = (sp.get('chapter') || '').trim();
  const topic = (sp.get('topic') || '').trim();
  const source = (sp.get('source') || '').trim();
  const categories = (sp.get('category') || '').split(',').map((s) => s.trim()).filter(isProblemCategory);
  const fmt: 'mc' | 'subjective' = sp.get('format') === 'subjective' ? 'subjective' : 'mc';
  const sample = Math.min(200, Math.max(0, Number(sp.get('sample')) || 0));
  const limit = Math.min(200, Math.max(1, Number(sp.get('limit')) || 50));
  const offset = Math.max(0, Number(sp.get('offset')) || 0);

  const filter: Record<string, unknown> = { userId };
  if (topicKey) filter.topicKey = topicKey;
  else {
    if (course) filter.과정 = course;
    if (chapter) filter.대단원 = chapter;
    if (topic) filter.학습주제 = topic;
  }
  if (source) filter.source = source;
  if (categories.length) filter.category = { $in: categories };

  const col = db.collection<GrammarDoc>(GRAMMAR_PROBLEMS_COLLECTION);

  let body: Record<string, unknown>;
  let count = 0;

  if (meta === 'topics') {
    // 진도별 문항 수 — 외부에서 자체 트리/셀렉터 구성용
    const rows = await col.aggregate([
      { $match: filter },
      { $group: { _id: '$topicKey', course: { $first: '$과정' }, chapter: { $first: '$대단원' }, topic: { $first: '$학습주제' }, unit: { $first: '$unit' }, count: { $sum: 1 } } },
      { $sort: { course: 1, unit: 1 } },
    ]).toArray();
    const topics = rows.map((r) => ({ topicKey: String(r._id), course: r.course ?? '', chapter: r.chapter ?? '', topic: r.topic ?? '', unit: r.unit ?? null, count: r.count as number }));
    count = topics.length;
    body = { ok: true, topics };
  } else if (sample > 0) {
    // 무작위 표본 — 문제지 출제용
    const docs = await col.aggregate<GrammarDoc>([{ $match: filter }, { $sample: { size: sample } }]).toArray();
    docs.sort((a, b) => (a.unit ?? 0) - (b.unit ?? 0) || String(a.section).localeCompare(String(b.section)) || (a.no ?? 0) - (b.no ?? 0));
    const items = docs.map((d) => view(d, fmt));
    count = items.length;
    body = { ok: true, total: await col.countDocuments(filter), count, sample, format: fmt, items };
  } else {
    const total = await col.countDocuments(filter);
    const docs = await col.find(filter).sort({ unit: 1, section: 1, no: 1, serialNo: 1 }).skip(offset).limit(limit).toArray();
    const items = docs.map((d) => view(d, fmt));
    count = items.length;
    body = { ok: true, total, count, limit, offset, format: fmt, items };
  }

  // 사용 로그 (question-bank 와 동일 방식 — 응답 후 지오 조회 포함)
  const h = request.headers;
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || '';
  const ua = h.get('user-agent') || '';
  const referer = h.get('referer') || h.get('referrer') || '';
  const origin = h.get('origin') || '';
  const acceptLanguage = h.get('accept-language') || '';
  let bytes = 0;
  try { bytes = Buffer.byteLength(JSON.stringify(body)); } catch { /* ignore */ }
  const responseMs = Date.now() - startedAt;
  after(async () => {
    const geo = await lookupGeo(ip);
    await recordApiKeyUsage(db, {
      userId,
      keyId: keyDoc._id as ObjectId,
      keyLabel: keyDoc.label,
      at: new Date(),
      endpoint: 'grammar-bank',
      ...(topicKey || topic ? { folder: (topicKey || topic).slice(0, 120) } : {}),
      type: meta === 'topics' ? 'meta:topics' : fmt,
      limit, offset,
      count,
      status: 200,
      ...(ip ? { ip } : {}),
      ...(ua ? { userAgent: ua.slice(0, 300) } : {}),
      ...(referer ? { referer: referer.slice(0, 300) } : {}),
      ...(origin ? { origin: origin.slice(0, 200) } : {}),
      ...(acceptLanguage ? { acceptLanguage: acceptLanguage.slice(0, 80) } : {}),
      ...(geo.country ? { country: geo.country } : {}),
      ...(geo.city ? { city: geo.city } : {}),
      responseMs, bytes,
    });
  });

  return json(body);
}
