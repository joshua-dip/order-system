import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAdmin } from '@/lib/admin-auth';
import { ESSAY_STEP_SYSTEM_PROMPT } from '@/lib/essay-step-prompt';
import { validateEssayStepData } from '@/lib/essay-step-validator';
import type { EssayStepWorkbookData } from '@/lib/essay-step-workbook';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/admin/workbook-maker/essay-step/fix
 *
 * 입력: { data: EssayStepWorkbookData, errors?: string[], warnings?: string[] }
 *   - errors/warnings 미지정 시 자동으로 검증해 사용
 * 출력: { data: 수정된 EssayStepWorkbookData, validation: 수정 후 검증 결과 }
 *
 * Claude opus-4-7 호출 — ANTHROPIC_API_KEY 필요. 보고된 오류만 핀셋 수정하고 나머지는 보존.
 */

const FIX_INSTRUCTIONS = `
== FIX MODE ==

너는 이미 작성된 「서술형집중 워크북」 JSON 을 받았다. 검증기가 발견한 오류만 핀셋 수정하고 **나머지 모든 필드는 그대로 보존**한다.

규칙:
1. 입력 \`data\` 의 모든 필드를 보존. 수정 대상이 아닌 필드는 한 글자도 바꾸지 말 것.
2. 보고된 \`errors\` 를 모두 해결. \`warnings\` 는 가능하면 해결 (불가능하면 무시).
3. 수정 시 위 시스템 프롬프트의 모든 규칙(A~M)을 다시 적용.
4. 출력은 **수정된 전체 JSON** (코드펜스 없이). 일부 필드만 출력하지 말 것.
5. 출력 첫 글자 \`{\` 마지막 \`}\`.
`;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY 가 설정돼 있지 않습니다.' }, { status: 503 });
  }

  let body: {
    data?: EssayStepWorkbookData;
    errors?: string[];
    warnings?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  if (!body.data || typeof body.data !== 'object') {
    return NextResponse.json({ error: 'data (EssayStepWorkbookData) 가 필요합니다.' }, { status: 400 });
  }

  // 입력에 errors/warnings 가 없으면 즉시 검증
  let errors = body.errors ?? [];
  let warnings = body.warnings ?? [];
  if (errors.length === 0 && warnings.length === 0) {
    const v = validateEssayStepData(body.data);
    errors = v.errors;
    warnings = v.warnings;
  }

  if (errors.length === 0 && warnings.length === 0) {
    return NextResponse.json({
      data: body.data,
      validation: { valid: true, errors: [], warnings: [] },
      note: '검증 오류·경고가 없어 수정할 게 없습니다.',
    });
  }

  const userMessage = [
    '== 현재 data (수정 대상) ==',
    JSON.stringify(body.data, null, 2),
    '',
    '== 검증 errors (반드시 해결) ==',
    errors.length === 0 ? '(없음)' : errors.map((e, i) => `${i + 1}. ${e}`).join('\n'),
    '',
    '== 검증 warnings (가능하면 해결) ==',
    warnings.length === 0 ? '(없음)' : warnings.map((w, i) => `${i + 1}. ${w}`).join('\n'),
    '',
    '위 오류들을 핀셋 수정한 전체 JSON 을 반환하세요. 오류 외 부분은 절대 변경하지 마세요.',
  ].join('\n');

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 16000,
      system: ESSAY_STEP_SYSTEM_PROMPT + '\n\n' + FIX_INSTRUCTIONS,
      messages: [{ role: 'user', content: userMessage }],
    });

    const first = response.content[0];
    if (!first || first.type !== 'text') {
      return NextResponse.json({ error: 'Claude 응답이 비어 있습니다.' }, { status: 502 });
    }
    let raw = first.text.trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
    }

    let fixed: EssayStepWorkbookData;
    try {
      fixed = JSON.parse(raw) as EssayStepWorkbookData;
    } catch (e) {
      console.error('[essay-step/fix] JSON parse error:', e, '\nraw head:', raw.slice(0, 400));
      return NextResponse.json(
        { error: '수정 결과 JSON 파싱 실패', raw: raw.slice(0, 800) },
        { status: 502 },
      );
    }

    if (!fixed?.meta || !Array.isArray(fixed.passage)) {
      return NextResponse.json({ error: '수정 결과가 스키마와 맞지 않습니다.' }, { status: 502 });
    }

    // 수정 후 재검증
    const validation = validateEssayStepData(fixed);
    return NextResponse.json({
      data: fixed,
      validation,
      before: { errorCount: errors.length, warningCount: warnings.length },
      after: { errorCount: validation.errors.length, warningCount: validation.warnings.length },
    });
  } catch (err) {
    console.error('[essay-step/fix]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '수정 중 오류 발생' },
      { status: 500 },
    );
  }
}
