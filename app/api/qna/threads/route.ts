import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { isMockExamTextbookKey } from '@/lib/mock-exam-key';
import { notifySlackQnaQuestion } from '@/lib/slack';
import { getPublicSiteUrl } from '@/lib/site-branding';
import { countRecentThreadsByIp, createThread } from '@/lib/qna-store';

export const dynamic = 'force-dynamic';

const NICKNAME_MIN = 2;
const NICKNAME_MAX = 20;
const QUESTION_MIN = 1;
const QUESTION_MAX = 500;
const SELECTED_TEXT_MAX = 80;
const RATE_LIMIT_PER_HOUR = 5;

function getIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * POST /api/qna/threads
 *
 * 익명·로그인 모두 가능. admin 로그인 상태면 asker.role='admin', userId 자동 채움.
 * - 검증: nickname 2~20, question 1~500, selectedText ≤ 80, passageId 형식, 모의고사 교재만.
 * - IP rate-limit: 1시간 5건.
 * - Slack 알림은 fire-and-forget.
 */
export async function POST(request: NextRequest) {
  let body: {
    passageId?: unknown;
    sentenceIndex?: unknown;
    nickname?: unknown;
    question?: unknown;
    selectedText?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  // passageId
  const passageIdStr = String(body.passageId ?? '').trim();
  if (!passageIdStr) {
    return NextResponse.json({ error: 'passageId 가 필요합니다.' }, { status: 400 });
  }
  let passageOid: ObjectId;
  try {
    passageOid = new ObjectId(passageIdStr);
  } catch {
    return NextResponse.json({ error: '잘못된 passageId 입니다.' }, { status: 400 });
  }

  // sentenceIndex (number, -1 또는 0 이상)
  const sentenceIndexRaw =
    typeof body.sentenceIndex === 'number' ? body.sentenceIndex : Number(body.sentenceIndex);
  if (!Number.isInteger(sentenceIndexRaw) || sentenceIndexRaw < -1) {
    return NextResponse.json({ error: 'sentenceIndex 가 올바르지 않습니다.' }, { status: 400 });
  }

  // question
  const question = String(body.question ?? '').trim();
  if (question.length < QUESTION_MIN || question.length > QUESTION_MAX) {
    return NextResponse.json(
      { error: `질문은 ${QUESTION_MIN}~${QUESTION_MAX}자로 입력해주세요.` },
      { status: 400 },
    );
  }

  // selectedText (optional)
  const selectedRaw = typeof body.selectedText === 'string' ? body.selectedText.trim() : '';
  if (selectedRaw.length > SELECTED_TEXT_MAX) {
    return NextResponse.json(
      { error: `selectedText 는 ${SELECTED_TEXT_MAX}자 이내여야 합니다.` },
      { status: 400 },
    );
  }
  const selectedText = selectedRaw || undefined;

  // admin 로그인 여부 확인
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  const isAdmin = !!payload && payload.role === 'admin';

  // nickname
  let nickname = String(body.nickname ?? '').trim();
  if (isAdmin && !nickname) {
    nickname = payload?.loginId ?? 'admin';
  }
  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
    return NextResponse.json(
      { error: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해주세요.` },
      { status: 400 },
    );
  }

  // 지문이 모의고사 교재인지 확인 + textbook 가져오기
  const db = await getDb('gomijoshua');
  const passage = (await db
    .collection('passages')
    .findOne(
      { _id: passageOid },
      { projection: { textbook: 1, source_key: 1, 'content.sentences_en': 1 } },
    )) as
    | {
        _id: ObjectId;
        textbook?: string;
        source_key?: string;
        content?: { sentences_en?: unknown[] };
      }
    | null;
  if (!passage) {
    return NextResponse.json({ error: '지문을 찾을 수 없습니다.' }, { status: 404 });
  }
  const textbook = String(passage.textbook ?? '').trim();
  if (!textbook || !isMockExamTextbookKey(textbook)) {
    return NextResponse.json(
      { error: '모의고사 지문에만 질문을 작성할 수 있습니다.' },
      { status: 400 },
    );
  }

  // 문장 개수 범위 검증
  if (sentenceIndexRaw >= 0) {
    const senLen = Array.isArray(passage.content?.sentences_en)
      ? passage.content!.sentences_en!.length
      : 0;
    // sentences_en 이 비어 있으면 (=original split) 범위 검증을 건너뜀.
    // 잘못된 index 가 들어와도 thread 자체는 살아 있고, 화면에서 불일치 처리.
    if (senLen > 0 && sentenceIndexRaw >= senLen) {
      return NextResponse.json({ error: '존재하지 않는 문장입니다.' }, { status: 400 });
    }
  }

  // IP rate limit (guest 만 적용 — admin 면제)
  const ip = getIp(request);
  if (!isAdmin && ip !== 'unknown') {
    const ipCount = await countRecentThreadsByIp(ip);
    if (ipCount >= RATE_LIMIT_PER_HOUR) {
      return NextResponse.json(
        { error: '잠시 후 다시 시도해주세요. (1시간 이내 5회 초과)' },
        { status: 429 },
      );
    }
  }

  const userAgent = request.headers.get('user-agent') ?? undefined;

  const row = await createThread({
    passageId: passageIdStr,
    textbook,
    sentenceIndex: sentenceIndexRaw,
    nickname,
    question,
    selectedText,
    asker: {
      role: isAdmin ? 'admin' : 'guest',
      userId: isAdmin ? payload?.sub : undefined,
      ip,
      userAgent,
    },
  });

  // Slack 알림 — fire-and-forget. webhook 미설정 시 silent skip.
  const origin = getPublicSiteUrl();
  const deepUrl = origin ? `${origin}/qna/${passageIdStr}#thread-${row.id}` : undefined;
  void notifySlackQnaQuestion({
    threadId: row.id,
    textbook,
    sourceKey: passage.source_key ?? undefined,
    sentenceIndex: sentenceIndexRaw,
    nickname,
    question,
    deepUrl,
  }).catch((err) => {
    console.error('[qna POST] slack notify failed:', err);
  });

  return NextResponse.json({ ok: true, thread: row });
}
