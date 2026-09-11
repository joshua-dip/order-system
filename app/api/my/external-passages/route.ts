import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { invalidatePassageSourceCache } from '@/lib/passage-source-detect';
import {
  EXTERNAL_MIN_ENGLISH_RATIO,
  EXTERNAL_PASSAGE_LIMITS,
  englishLetterRatio,
  externalTextbookKey,
} from '@/lib/external-variant';

export const dynamic = 'force-dynamic';

/** 붙여넣은 글을 지문으로 저장할 모양으로 — 줄 끝 공백·보이지 않는 문자·3줄 이상 빈 줄을 정리 */
function normalizePassageText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[​-‍﻿]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** KST 기준 YYMMDD */
function kstYymmdd(d = new Date()): string {
  const k = new Date(d.getTime() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(k.getUTCFullYear()).slice(2)}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}`;
}

/**
 * POST — 외부지문 변형문제 주문(/external) 1단계. 붙여넣은 지문을 **이 회원 전용 교재**로 등록한다.
 *
 * 교재 `외부지문_<loginId>` · 강(chapter) = 자료 이름(없으면 「YYMMDD 외부지문」) · 번호 01번~.
 * source_key = `${chapter} ${number}` — 부교재 변형 주문의 selectedLessons 와 같은 모양이라
 * 이어지는 주문서·제작 job·cc:variant pipeline 이 손대지 않고 그대로 동작한다.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token).catch(() => null) : null;
  const loginId = typeof payload?.loginId === 'string' ? payload.loginId.trim() : '';
  if (!loginId) {
    return NextResponse.json({ error: '로그인 후 이용해 주세요.' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const rawList: unknown[] = Array.isArray(body?.passages) ? body.passages : [];
  const items = rawList
    .map((p) => {
      const o = (p && typeof p === 'object' ? p : {}) as { title?: unknown; text?: unknown };
      return {
        title: typeof o.title === 'string' ? o.title.trim().slice(0, 60) : '',
        text: normalizePassageText(typeof o.text === 'string' ? o.text : ''),
      };
    })
    .filter((p) => p.text !== '');

  const { maxPassages, minChars, maxChars } = EXTERNAL_PASSAGE_LIMITS;
  if (items.length === 0) {
    return NextResponse.json({ error: '지문을 하나 이상 붙여넣어 주세요.' }, { status: 400 });
  }
  if (items.length > maxPassages) {
    return NextResponse.json({ error: `한 번에 ${maxPassages}개 지문까지 올릴 수 있습니다.` }, { status: 400 });
  }
  for (let i = 0; i < items.length; i++) {
    const t = items[i].text;
    if (t.length < minChars) {
      return NextResponse.json({ error: `지문 ${i + 1}이 너무 짧습니다 (${minChars}자 이상).` }, { status: 400 });
    }
    if (t.length > maxChars) {
      return NextResponse.json({ error: `지문 ${i + 1}이 너무 깁니다 (${maxChars}자 이하).` }, { status: 400 });
    }
    if (englishLetterRatio(t) < EXTERNAL_MIN_ENGLISH_RATIO) {
      return NextResponse.json({ error: `지문 ${i + 1}: 영어 지문만 받을 수 있습니다.` }, { status: 400 });
    }
  }

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('passages');
    const textbook = externalTextbookKey(loginId);

    /* 같은 이름의 자료가 이미 있으면 (2)·(3) 을 붙인다 — 번호가 겹치면 지문이 섞인다 */
    const titleIn = typeof body?.batchTitle === 'string' ? body.batchTitle.trim().slice(0, 40) : '';
    const baseChapter = titleIn || `${kstYymmdd()} 외부지문`;
    let chapter = baseChapter;
    for (let n = 2; await col.findOne({ textbook, chapter }, { projection: { _id: 1 } }); n++) {
      chapter = `${baseChapter} (${n})`;
    }

    const now = new Date();
    const docs = items.map((p, i) => {
      const number = `${String(i + 1).padStart(2, '0')}번`;
      return {
        textbook,
        chapter,
        number,
        source_key: `${chapter} ${number}`,
        order: i + 1,
        content: {
          original: p.text,
          translation: '',
          sentences_en: [],
          sentences_ko: [],
          tokenized_en: '',
          tokenized_ko: '',
          mixed: '',
        },
        created_at: now,
        updated_at: now,
        created_from: 'member_external',
        owner_login_id: loginId,
        ...(p.title ? { external_title: p.title } : {}),
      };
    });
    await col.insertMany(docs);
    invalidatePassageSourceCache();

    return NextResponse.json({
      ok: true,
      textbook,
      chapter,
      lessons: docs.map((d) => d.source_key),
      count: docs.length,
    });
  } catch (e) {
    console.error('external-passages POST:', e);
    return NextResponse.json({ error: '지문을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 });
  }
}
