import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * source_key 끝의 문항 번호만 제거 (앞 본문은 묶음 접두로 사용).
 * 1) 공백/중점 뒤 `01번` — `고난도 모의고사 1회 · 01번`
 * 2) `회01번` / `강02번` 등 붙어 있는 형태
 */
function stripTrailingQuestionNumber(sk: string): string | null {
  const r1 = /(?:\s*[·•‧]\s*|\s+)제?\d{1,3}번\s*$/u;
  const t1 = sk.replace(r1, '').trim();
  if (t1 !== sk && t1.length >= 2) return t1;

  const r2 = /^(.*)(회|강|차|호)(\d{1,3})번\s*$/u;
  const m2 = sk.match(r2);
  if (m2) {
    const pre = (m2[1] + m2[2]).trim();
    if (pre.length >= 2) return pre;
  }
  return null;
}

/**
 * 같은 교재 안에서 묶을 "접두" 추출.
 * - 기존: `01강`, `12강` (source_key / chapter 앞부분 또는 sk 내 첫 NN강)
 * - 모의고사·유사: `고난도 모의고사 1회 01번`, `고난도 모의고사 1회 · 01번` → `고난도 모의고사 1회`
 * - chapter + number 만 있는 행: chapter 가 회·집 이름, number 가 `01번` 형태
 */
function extractLessonPrefix(
  sourceKey: string,
  chapter: string,
  number: string,
): string | null {
  const sk = (sourceKey || '').trim();
  const ch = (chapter || '').trim();
  const num = (number || '').trim();

  const fromSk = sk.match(/^(\d{1,3}강)\b/);
  if (fromSk) return fromSk[1];
  const fromCh = ch.match(/^(\d{1,3}강)\b/);
  if (fromCh) return fromCh[1];
  const loose = sk.match(/(\d{1,3}강)/);
  if (loose) return loose[1];

  if (sk) {
    const stripped = stripTrailingQuestionNumber(sk);
    if (stripped) return stripped;
  }

  if (ch.length >= 2 && /^(?:제)?\d{1,3}번$/u.test(num)) {
    return ch;
  }

  return null;
}

/**
 * GET ?passageId=hex
 * 선택 지문과 같은 교재·묶음(예: 01강, 고난도 모의고사 1회)에 속한 지문 목록 + passage_id
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const passageId = request.nextUrl.searchParams.get('passageId')?.trim();
  if (!passageId || !ObjectId.isValid(passageId)) {
    return NextResponse.json({ error: 'passageId(ObjectId)가 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const anchor = await db.collection('passages').findOne(
      { _id: new ObjectId(passageId) },
      { projection: { textbook: 1, source_key: 1, chapter: 1, number: 1 } },
    );
    if (!anchor) {
      return NextResponse.json({ error: '지문을 찾을 수 없습니다.' }, { status: 404 });
    }

    const textbook = String(anchor.textbook ?? '').trim();
    if (!textbook) {
      return NextResponse.json({ error: '교재명(textbook)이 비어 있습니다.' }, { status: 400 });
    }

    const sk = typeof anchor.source_key === 'string' ? anchor.source_key : '';
    const chapter = String(anchor.chapter ?? '');
    const number = anchor.number != null ? String(anchor.number) : '';
    const lesson = extractLessonPrefix(sk, chapter, number);
    if (!lesson) {
      return NextResponse.json(
        {
          error:
            '묶음 접두를 찾지 못했습니다. (예: "01강 01번", "고난도 모의고사 1회 01번", chapter+01번 조합)',
        },
        { status: 422 },
      );
    }

    const skPrefix = new RegExp(
      `^${escapeRegex(lesson)}(\\s|[·•‧]|[/]|$|\\d)`,
    );
    const chPrefix = new RegExp(`^${escapeRegex(lesson)}(\\s|[·•‧]|$)`);

    const docs = await db
      .collection('passages')
      .find({
        textbook,
        $or: [
          { source_key: skPrefix },
          { source_key: lesson },
          { chapter: lesson },
          { chapter: chPrefix },
        ],
      })
      .project({ _id: 1, source_key: 1, chapter: 1, number: 1 })
      .sort({ source_key: 1 })
      .limit(200)
      .toArray();

    const passages = docs.map(d => {
      const sourceKey =
        typeof d.source_key === 'string' && d.source_key.trim()
          ? d.source_key.trim()
          : `${d.chapter ?? ''} ${d.number ?? ''}`.trim();
      return {
        passage_id: String(d._id),
        source_key: sourceKey,
        chapter: String(d.chapter ?? ''),
        number: d.number != null ? String(d.number) : '',
      };
    });

    return NextResponse.json({
      ok: true,
      textbook,
      lesson,
      anchor_passage_id: passageId,
      count: passages.length,
      passages,
    });
  } catch (e) {
    console.error('[passages-by-lesson]', e);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}
