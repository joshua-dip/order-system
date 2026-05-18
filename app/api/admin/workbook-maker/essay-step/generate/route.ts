import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAdmin } from '@/lib/admin-auth';
import { ESSAY_STEP_SYSTEM_PROMPT } from '@/lib/essay-step-prompt';
import type { EssayStepWorkbookData } from '@/lib/essay-step-workbook';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/admin/workbook-maker/essay-step/generate
 *
 * 입력: { passage: string, korean?: string, academy?: string, publisher?: string, topic?: string }
 * 출력: { data: EssayStepWorkbookData }
 *
 * Anthropic API (claude-opus-4-7) 호출 — ANTHROPIC_API_KEY 필요. Pro 구독과 별개 과금.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY 가 설정돼 있지 않습니다.' },
      { status: 503 },
    );
  }

  let body: {
    passage?: string;
    korean?: string;
    academy?: string;
    publisher?: string;
    topic?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const passage = (body.passage ?? '').trim();
  if (!passage) {
    return NextResponse.json({ error: '지문(passage) 이 필요합니다.' }, { status: 400 });
  }
  const korean = (body.korean ?? '').trim();
  const academy = (body.academy ?? '').trim() || '고미조슈아 영어 학원';
  const publisher = (body.publisher ?? '').trim() || 'Payperic';
  const topic = (body.topic ?? '').trim();

  let userMessage = `지문(영어):\n${passage}`;
  if (korean) userMessage += `\n\n한국어 해석(참고용):\n${korean}`;
  userMessage += `\n\n학원명: ${academy}\n발행처: ${publisher}`;
  if (topic) userMessage += `\n원하는 워크북 영문 제목: ${topic}`;
  userMessage += `\n\n위 정보로 8섹션 서술형집중 워크북 JSON 을 생성해 주세요.`;

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 16000,
      system: ESSAY_STEP_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const first = response.content[0];
    if (!first || first.type !== 'text') {
      return NextResponse.json({ error: 'Claude 응답이 비어 있습니다.' }, { status: 502 });
    }
    let raw = first.text.trim();
    // 코드펜스 제거 (있을 경우)
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
    }

    let data: EssayStepWorkbookData;
    try {
      data = JSON.parse(raw) as EssayStepWorkbookData;
    } catch (e) {
      console.error('[essay-step/generate] JSON parse error:', e, '\nraw head:', raw.slice(0, 400));
      return NextResponse.json(
        { error: 'Claude 가 반환한 JSON 을 파싱하지 못했습니다.', raw: raw.slice(0, 800) },
        { status: 502 },
      );
    }

    // 최소 정합 확인
    if (!data?.meta || !Array.isArray(data.passage)) {
      return NextResponse.json({ error: 'JSON 형식이 스키마와 맞지 않습니다.' }, { status: 502 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[essay-step/generate]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '생성 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
