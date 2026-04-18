import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { GUEST_GENERATED_QUESTIONS_COLLECTION } from '@/lib/guest-generated-questions-store';
import {
  invalidatePassageSourceCache,
  normalizeForMatch,
} from '@/lib/passage-source-detect';
import { promoteGuestLog } from '@/lib/guest-variant-logs-promote';

const VALID_PUBLISHERS = ['YBM', '쎄듀', 'NE능률'] as const;
type Publisher = (typeof VALID_PUBLISHERS)[number];

/**
 * match_status='unknown' 로그의 input_paragraph 를 passages 컬렉션에 신규 등록하고,
 * 동일 paragraph_hash 를 가진 다른 unknown 로그까지 일괄 matched 로 back-fill.
 * 옵션으로 해당 로그의 승격까지 한 번에 실행.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문 필요' }, { status: 400 });
  }

  const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
  const chapter = typeof body.chapter === 'string' ? body.chapter.trim() : '';
  const number = typeof body.number === 'string' ? body.number.trim() : '';
  if (!textbook || !chapter || !number) {
    return NextResponse.json(
      { error: '교재명, 강(chapter), 번호(number)는 필수입니다.' },
      { status: 400 },
    );
  }
  const source_key =
    typeof body.source_key === 'string' && body.source_key.trim()
      ? body.source_key.trim()
      : `${chapter} ${number}`;
  const publisherRaw = typeof body.publisher === 'string' ? body.publisher.trim() : '';
  const publisher: Publisher | undefined = (VALID_PUBLISHERS as readonly string[]).includes(
    publisherRaw,
  )
    ? (publisherRaw as Publisher)
    : undefined;
  const pageNum =
    typeof body.page === 'number' && !Number.isNaN(body.page)
      ? body.page
      : typeof body.page === 'string' && body.page.trim()
        ? parseInt(body.page, 10) || undefined
        : undefined;
  const pageLabel = typeof body.page_label === 'string' ? body.page_label.trim() : '';
  const order =
    typeof body.order === 'number' && !Number.isNaN(body.order)
      ? body.order
      : typeof body.order === 'string'
        ? parseInt(body.order, 10) || 0
        : 0;
  const alsoPromote = body.also_promote === true || body.also_promote === 'true';
  const promoteStatusRaw = typeof body.promote_status === 'string' ? body.promote_status : '대기';
  const promoteStatus: '대기' | '완료' = promoteStatusRaw === '완료' ? '완료' : '대기';

  try {
    const db = await getDb('gomijoshua');
    const guestCol = db.collection(GUEST_GENERATED_QUESTIONS_COLLECTION);
    const passagesCol = db.collection('passages');

    const logOid = new ObjectId(id);
    const log = (await guestCol.findOne({ _id: logOid })) as
      | (Record<string, unknown> & {
          match_status?: 'matched' | 'unknown';
          passage_id?: ObjectId;
          input_paragraph?: string;
          paragraph_hash?: string;
        })
      | null;
    if (!log) return NextResponse.json({ error: '로그를 찾을 수 없습니다.' }, { status: 404 });
    if (log.match_status === 'matched' && log.passage_id) {
      return NextResponse.json(
        { error: '이미 매칭된 로그입니다. 지문 등록 대신 바로 승격하세요.' },
        { status: 409 },
      );
    }

    const original = (log.input_paragraph || '').trim();
    if (!original) {
      return NextResponse.json(
        { error: '입력 지문이 비어 있어 등록할 수 없습니다.' },
        { status: 422 },
      );
    }

    const existing = await passagesCol.findOne({
      textbook,
      chapter,
      number,
    });
    if (existing) {
      return NextResponse.json(
        {
          error: '이미 같은 교재·강·번호의 지문이 존재합니다.',
          existing_passage_id: String(existing._id),
        },
        { status: 409 },
      );
    }

    const now = new Date();
    const doc: Record<string, unknown> = {
      textbook,
      chapter,
      number,
      source_key,
      page: pageNum,
      page_label: pageLabel || undefined,
      order,
      content: {
        original,
        translation: '',
        sentences_en: [],
        sentences_ko: [],
        tokenized_en: '',
        tokenized_ko: '',
        mixed: '',
      },
      created_at: now,
      updated_at: now,
      created_from: 'guest_variant_log',
      created_from_log_id: logOid,
    };
    if (publisher) doc.publisher = publisher;

    const inserted = await passagesCol.insertOne(doc);
    const newPassageId = inserted.insertedId;

    invalidatePassageSourceCache();

    // 같은 paragraph_hash + unknown 을 갖는 모든 로그에 back-fill
    const inputNormLen = normalizeForMatch(original).length;
    const backfillFilter = {
      match_status: 'unknown',
      paragraph_hash: log.paragraph_hash,
    };
    const sourceLabel = source_key || `${chapter} ${number}`.trim() || '지문';
    await guestCol.updateMany(backfillFilter, {
      $set: {
        match_status: 'matched',
        passage_id: newPassageId,
        textbook,
        chapter,
        number,
        source_key,
        source: sourceLabel,
        match_kind: 'head',
      },
    });

    let promoteResult: unknown = null;
    if (alsoPromote) {
      const pr = await promoteGuestLog(id, {
        status: promoteStatus,
        adminLoginId: payload?.loginId,
      });
      promoteResult = pr;
    }

    return NextResponse.json({
      ok: true,
      passage_id: String(newPassageId),
      backfilled: true,
      normalized_length: inputNormLen,
      promote: promoteResult,
    });
  } catch (e) {
    console.error('guest-variant-logs register-passage:', e);
    return NextResponse.json({ error: '지문 등록에 실패했습니다.' }, { status: 500 });
  }
}
