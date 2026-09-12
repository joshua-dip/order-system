import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { renderHtmlToPdf } from '@/lib/chromium-pdf';
import { buildVariantPrintHtml, type VariantPrintQuestion } from '@/lib/variant-print-html';
import {
  pickFreeQuestions,
  PUBLIC_FREE_MAX_QUESTIONS_PER_PDF,
  PUBLIC_FREE_TYPES,
} from '@/lib/public-free-questions';
import {
  clientIpOf,
  consumeFreeDownload,
  PUBLIC_FREE_DAILY_LIMIT,
} from '@/lib/public-free-rate-limit';

/**
 * 공개 — 무료 배포 세트 PDF. 로그인·이름·전화 아무것도 받지 않는다.
 *
 * 통째로 긁어가는 것만 막는다: 한 번에 `PUBLIC_FREE_MAX_QUESTIONS_PER_PDF` 문항까지,
 * IP 당 하루 `PUBLIC_FREE_DAILY_LIMIT` 회.
 *
 * 문항은 `public_free_questions` 에서만 꺼낸다 — 판매 재고는 이 경로로 나가지 않는다.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** `① …` 로 갈라 놓기 — 구분자가 `###` 와 줄바꿈 두 가지로 섞여 있다 */
function parseOptions(raw: string): string[] {
  if (raw.includes('###')) return raw.split('###').map((o) => o.trim()).filter(Boolean);
  return raw.split('\n').map((l) => l.trim()).filter(Boolean);
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const textbook = (sp.get('textbook') ?? '').trim();
  if (!textbook) {
    return NextResponse.json({ error: '회차를 골라 주세요.' }, { status: 400 });
  }

  const sources = (sp.get('sources') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const types = (sp.get('types') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((t) => PUBLIC_FREE_TYPES.includes(t));
  const includeAnswers = sp.get('answers') !== '0';

  const db = await getDb('gomijoshua');

  const verdict = await consumeFreeDownload(db, clientIpOf(request.headers));
  if (!verdict.allowed) {
    return NextResponse.json(
      {
        error: `무료 자료는 하루 ${PUBLIC_FREE_DAILY_LIMIT}회까지 받을 수 있습니다. 내일 다시 받아 주세요.`,
        limit: verdict.limit,
      },
      { status: 429 },
    );
  }

  const docs = await pickFreeQuestions(db, {
    textbook,
    sources,
    types,
    limit: PUBLIC_FREE_MAX_QUESTIONS_PER_PDF,
  });
  if (docs.length === 0) {
    return NextResponse.json({ error: '고른 범위에 무료 문항이 없습니다.' }, { status: 404 });
  }

  const questions: VariantPrintQuestion[] = docs.map((d) => {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const numberLabel = /(\d+(?:~\d+)?번)/.exec(d.source)?.[1] ?? d.source;
    return {
      source: `${numberLabel} · ${d.type}`,
      question: String(qd.Question ?? ''),
      paragraph: String(qd.Paragraph ?? ''),
      options: parseOptions(String(qd.Options ?? '')),
      correctAnswer: String(qd.CorrectAnswer ?? ''),
      explanation: String(qd.Explanation ?? ''),
    };
  });

  const usedTypes = [...new Set(docs.map((d) => d.type))].sort(
    (a, b) => PUBLIC_FREE_TYPES.indexOf(a) - PUBLIC_FREE_TYPES.indexOf(b),
  );
  const html = buildVariantPrintHtml({
    title: `${textbook} · 무료 변형문제`,
    subtitle: [`유형 ${usedTypes.join('·')}`, `총 ${questions.length}문항`].join(' · '),
    questions,
    includeAnswers,
    /* 한 지문의 여러 유형을 한 부에 담으므로, 본문이 같은 문항은 지문을 한 번만 싣는다.
       (주제·제목·주장·일치·불일치는 본문이 원문 그대로라 묶지 않으면 같은 지문이 다섯 번 나온다.) */
    groupIdenticalPassages: true,
  });

  const pdf = await renderHtmlToPdf(html);
  /* 파일명에 한글을 그대로 넣으면 헤더가 깨지므로 RFC 5987 로 같이 준다. */
  const base = `${textbook} 무료 변형문제`.replace(/[\\/:*?"<>|]/g, '_');
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="free-variant.pdf"; filename*=UTF-8''${encodeURIComponent(`${base}.pdf`)}`,
      'Cache-Control': 'no-store',
      'X-Free-Remaining': String(verdict.remaining),
    },
  });
}
