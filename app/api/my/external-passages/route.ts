import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { invalidatePassageSourceCache } from '@/lib/passage-source-detect';
import { externalTextbookKey } from '@/lib/external-variant';
import {
  externalPassageProblem,
  normalizePassageText,
  registerExternalPassages,
} from '@/lib/external-passages-store';

export const dynamic = 'force-dynamic';

async function loginIdOf(request: NextRequest): Promise<string> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token).catch(() => null) : null;
  return typeof payload?.loginId === 'string' ? payload.loginId.trim() : '';
}

const DERIVED_CONTENT_RESET = {
  'content.translation': '',
  'content.sentences_en': [],
  'content.sentences_ko': [],
  'content.tokenized_en': '',
  'content.tokenized_ko': '',
  'content.mixed': '',
};

/**
 * GET — 이 회원이 등록한 외부지문을 자료(강)별로 돌려준다(최근 자료부터).
 * 지문마다 이미 만들어진 문제 수를 함께 준다 — 문제가 있으면 본문을 잠근다(PATCH 참고).
 */
export async function GET(request: NextRequest) {
  const loginId = await loginIdOf(request);
  if (!loginId) return NextResponse.json({ error: '로그인 후 이용해 주세요.' }, { status: 401 });

  try {
    const db = await getDb('gomijoshua');
    const textbook = externalTextbookKey(loginId);
    const rows = await db
      .collection('passages')
      .find({ textbook })
      .project({ chapter: 1, number: 1, source_key: 1, order: 1, external_title: 1, 'content.original': 1, created_at: 1, edited_at: 1 })
      .sort({ created_at: -1, order: 1 })
      .limit(2000)
      .toArray();
    /* 문제는 교재+출처로 센다 — passage_id 는 문자열/ObjectId 가 섞여 있어 이쪽이 확실하다 */
    const counts = await db
      .collection('generated_questions')
      .aggregate([{ $match: { textbook } }, { $group: { _id: '$source', n: { $sum: 1 } } }])
      .toArray();
    const countBy = new Map(counts.map((c) => [String(c._id), Number(c.n) || 0]));

    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
    const batches: { chapter: string; createdAt: string | null; passages: Record<string, unknown>[] }[] = [];
    const byChapter = new Map<string, (typeof batches)[number]>();
    for (const r of rows as Record<string, any>[]) {
      const chapter = String(r.chapter ?? '');
      let b = byChapter.get(chapter);
      if (!b) {
        b = { chapter, createdAt: iso(r.created_at), passages: [] };
        byChapter.set(chapter, b);
        batches.push(b);
      }
      const sourceKey = String(r.source_key ?? '');
      b.passages.push({
        id: String(r._id),
        number: String(r.number ?? ''),
        sourceKey,
        order: typeof r.order === 'number' ? r.order : 0,
        title: typeof r.external_title === 'string' ? r.external_title : '',
        text: String(r.content?.original ?? ''),
        questionCount: countBy.get(sourceKey) ?? 0,
        editedAt: iso(r.edited_at),
      });
    }
    for (const b of batches) b.passages.sort((a, c) => Number(a.order) - Number(c.order));
    return NextResponse.json({ ok: true, textbook, batches: batches.slice(0, 100) });
  } catch (e) {
    console.error('external-passages GET:', e);
    return NextResponse.json({ error: '등록한 지문을 불러오지 못했습니다.' }, { status: 500 });
  }
}

/**
 * POST — 외부지문 변형문제 주문(/external) 1단계. 붙여넣은 지문을 **이 회원 전용 교재**로 등록한다.
 *
 * 교재 `외부지문_<loginId>` · 강(chapter) = 자료 이름(없으면 「YYMMDD 외부지문」) · 번호 01번~.
 * source_key = `${chapter} ${number}` — 부교재 변형 주문의 selectedLessons 와 같은 모양이라
 * 이어지는 주문서·제작 job·cc:variant pipeline 이 손대지 않고 그대로 동작한다.
 */
export async function POST(request: NextRequest) {
  const loginId = await loginIdOf(request);
  if (!loginId) return NextResponse.json({ error: '로그인 후 이용해 주세요.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const rawList: unknown[] = Array.isArray(body?.passages) ? body.passages : [];
  const passages = rawList.map((p) => {
    const o = (p && typeof p === 'object' ? p : {}) as { title?: unknown; text?: unknown };
    return {
      title: typeof o.title === 'string' ? o.title : '',
      text: typeof o.text === 'string' ? o.text : '',
    };
  });

  try {
    const db = await getDb('gomijoshua');
    const r = await registerExternalPassages(db, {
      loginId,
      batchTitle: typeof body?.batchTitle === 'string' ? body.batchTitle : '',
      passages,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({
      ok: true,
      textbook: r.textbook,
      chapter: r.chapter,
      lessons: r.lessons,
      count: r.lessons.length,
    });
  } catch (e) {
    console.error('external-passages POST:', e);
    return NextResponse.json({ error: '지문을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 });
  }
}

/**
 * PATCH — 등록한 지문 한 개의 제목·본문을 고친다. body: `{ id, title?, text? }`
 *
 * 그 지문으로 **이미 문제가 만들어졌으면 본문은 고칠 수 없다**(409). 문제와 지문이 어긋나기
 * 때문이다 — 본문을 바꾸려면 새 지문으로 등록한다. 제목은 문제와 무관해 언제든 고칠 수 있다.
 * 본문을 고치면 문장 분리·번역 등 파생 필드는 비운다(옛 본문 기준이라 틀린 값이 된다).
 */
export async function PATCH(request: NextRequest) {
  const loginId = await loginIdOf(request);
  if (!loginId) return NextResponse.json({ error: '로그인 후 이용해 주세요.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 지문입니다.' }, { status: 400 });

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('passages');
    const textbook = externalTextbookKey(loginId);
    /* 교재 키로 소유를 확인한다 — 다른 회원의 지문 id 를 넣어도 찾지 못한다 */
    const p = await col.findOne({ _id: new ObjectId(id), textbook });
    if (!p) return NextResponse.json({ error: '지문을 찾을 수 없습니다.' }, { status: 404 });

    const now = new Date();
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ''> = {};

    if (typeof body?.title === 'string') {
      const t = body.title.trim().slice(0, 60);
      if (t) $set.external_title = t;
      else $unset.external_title = '';
    }

    if (typeof body?.text === 'string') {
      const text = normalizePassageText(body.text);
      const current = String((p.content as { original?: unknown } | undefined)?.original ?? '');
      if (text !== current) {
        const used = await db.collection('generated_questions').countDocuments({ textbook, source: p.source_key });
        if (used > 0) {
          return NextResponse.json(
            { error: `이 지문으로 이미 문제가 ${used}개 만들어져 본문을 고칠 수 없습니다. 새 지문으로 등록해 주세요.` },
            { status: 409 },
          );
        }
        const problem = externalPassageProblem(text, String(p.number ?? '지문'));
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });
        $set['content.original'] = text;
        Object.assign($set, DERIVED_CONTENT_RESET);
        $set.edited_at = now;
      }
    }

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      return NextResponse.json({ ok: true, unchanged: true });
    }
    $set.updated_at = now;
    await col.updateOne(
      { _id: p._id },
      { $set, ...(Object.keys($unset).length > 0 ? { $unset } : {}) },
    );
    invalidatePassageSourceCache();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('external-passages PATCH:', e);
    return NextResponse.json({ error: '지문을 저장하지 못했습니다.' }, { status: 500 });
  }
}
