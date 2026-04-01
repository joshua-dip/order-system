import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageAnalyzerAnthropic } from '@/lib/passage-analyzer-claude';

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const claude = getPassageAnalyzerAnthropic();
  if ('error' in claude) {
    return NextResponse.json({ error: claude.error }, { status: 503 });
  }
  const { anthropic, model } = claude;

  try {
    const { passage } = await request.json();
    if (!passage || typeof passage !== 'string') {
      return NextResponse.json({ error: '지문이 필요합니다.' }, { status: 400 });
    }

    const message = await anthropic.messages.create({
      model,
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `다음 영어 지문의 주제를 한국어 한 문장으로 정리하세요.\n\n${passage}\n\n주제 정리: [한 문장]`,
        },
      ],
    });

    const response = message.content[0];
    if (response.type !== 'text') {
      return NextResponse.json({ topic: '' });
    }
    const t = response.text;
    const m = t.match(/주제\s*정리\s*[:：]\s*(.+)/i);
    return NextResponse.json({ topic: m ? m[1].trim() : t.trim() });
  } catch (e) {
    console.error('generate-topic:', e);
    return NextResponse.json({ error: '주제 생성 실패' }, { status: 500 });
  }
}
