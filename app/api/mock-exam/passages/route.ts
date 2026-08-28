import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { isMockExamTextbookKey } from '@/lib/mock-exam-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 모의고사 주문서용 지문 조회.
 *
 * 선생님들이 「이 번호가 무슨 지문이더라」에서 막힌다. 번호만 보고는 알 수 없어
 * 엉뚱한 번호를 담는 일이 생겼다. 그래서 두 가지를 준다.
 *
 *   ?exam=<교재명>      → 그 회차의 번호별 첫머리 (번호에 마우스 올리면 뜨는 미리보기)
 *   ?q=<검색어>         → 지문 내용으로 찾기 (어느 회차 몇 번인지 되짚어 준다)
 *
 * 본문은 **첫머리만** 내려준다. 어떤 지문인지 알아보는 용도지 읽는 용도가 아니다.
 * 모의고사 교재만 다룬다 — 부교재·시중 교재는 여기서 조회되지 않는다.
 */

/** 미리보기 길이. 지문을 알아보기에 충분하고 통째로 읽기에는 모자란 정도. */
const SNIPPET_LEN = 110;

function snippet(text: string, len = SNIPPET_LEN): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= len ? t : `${t.slice(0, len)}…`;
}

/** "41~42번" · "41-42번" · "18번" → "4142" · "18". UI 의 번호 id 와 맞추기 위한 정규화. */
function numberKey(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '');
}

export async function GET(request: NextRequest) {
  /* 지문 코퍼스를 통째로 훑을 수 있는 창구라 로그인은 받는다. */
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token).catch(() => null) : null;
  if (!payload) {
    return NextResponse.json({ error: '로그인이 필요합니다.', items: [] }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const exam = sp.get('exam')?.trim() || '';
  const q = sp.get('q')?.trim() || '';
  const limit = Math.min(50, Math.max(1, parseInt(sp.get('limit') || '20', 10) || 20));

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('passages');

    // ── 회차별 번호 미리보기 ──────────────────────────────────────────────
    if (exam) {
      if (!isMockExamTextbookKey(exam)) {
        return NextResponse.json({ error: '모의고사 교재만 조회할 수 있습니다.', items: [] }, { status: 400 });
      }
      const docs = await col
        .find({ textbook: exam })
        .project({ number: 1, 'content.original': 1 })
        .sort({ number: 1 })
        .limit(200)
        .toArray();
      const items = docs.map((d) => ({
        number: String(d.number ?? ''),
        numberKey: numberKey(d.number),
        snippet: snippet(String((d.content as { original?: unknown } | undefined)?.original ?? '')),
      }));
      return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // ── 지문 내용 검색 ────────────────────────────────────────────────────
    if (q) {
      if (q.length < 2) {
        return NextResponse.json({ error: '두 글자 이상 입력해 주세요.', items: [] }, { status: 400 });
      }
      /* 사용자가 넣은 문자열이 정규식 메타문자를 품을 수 있다. 반드시 이스케이프. */
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const docs = await col
        .find({ textbook: { $regex: '영어모의고사$' }, 'content.original': { $regex: safe, $options: 'i' } })
        .project({ textbook: 1, number: 1, 'content.original': 1 })
        .limit(limit)
        .toArray();

      const items = docs.map((d) => {
        const full = String((d.content as { original?: unknown } | undefined)?.original ?? '').replace(/\s+/g, ' ').trim();
        /* 찾은 자리 앞뒤를 보여 줘야 왜 걸렸는지 안다. 앞은 조금만 남긴다. */
        const at = full.toLowerCase().indexOf(q.toLowerCase());
        const from = at > 40 ? at - 40 : 0;
        const around = `${from > 0 ? '…' : ''}${full.slice(from, from + SNIPPET_LEN)}${from + SNIPPET_LEN < full.length ? '…' : ''}`;
        return {
          exam: String(d.textbook ?? ''),
          number: String(d.number ?? ''),
          numberKey: numberKey(d.number),
          snippet: around,
        };
      });
      return NextResponse.json({ items, total: items.length }, { headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({ error: 'exam 또는 q 가 필요합니다.', items: [] }, { status: 400 });
  } catch (e) {
    console.error('mock-exam passages:', e);
    return NextResponse.json({ error: '조회에 실패했습니다.', items: [] }, { status: 500 });
  }
}
