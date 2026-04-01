import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageAnalyzerAnthropic } from '@/lib/passage-analyzer-claude';

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const claude = getPassageAnalyzerAnthropic();
  if ('error' in claude) {
    return NextResponse.json({ success: false, error: claude.error }, { status: 503 });
  }
  const { anthropic, model } = claude;

  try {
    const body = await request.json();
    const grammarType =
      body.grammarType || (body.tagName ? String(body.tagName).replace(/^#/, '') : null);
    const example = body.example || body.selectedText || '';
    const sentence = body.sentence || '';
    if (!grammarType) {
      return NextResponse.json({ error: '문법 유형이 필요합니다.' }, { status: 400 });
    }

    const message = await anthropic.messages.create({
      model,
      max_tokens: 3000,
      messages: [
        {
          role: 'user',
          content: `"${grammarType}" 문법에 대한 학습 교재를 작성해주세요.
${example ? `예문: ${example}` : ''}
${sentence ? `출처 문장: ${sentence}` : ''}
마크다운으로 개념, 예문, 주의사항, 연습문제를 포함해 주세요.`,
        },
      ],
    });
    const response = message.content[0];
    if (response.type !== 'text') {
      return NextResponse.json({ error: '응답 형식 오류' }, { status: 500 });
    }
    return NextResponse.json({ success: true, content: response.text });
  } catch (e) {
    console.error('generate-grammar-material:', e);
    return NextResponse.json({ error: '생성 실패' }, { status: 500 });
  }
}
