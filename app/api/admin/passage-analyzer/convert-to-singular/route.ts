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
    const { word, synonyms, antonyms } = await request.json();
    if (!word) {
      return NextResponse.json({ error: '단어가 필요합니다.' }, { status: 400 });
    }

    const message = await anthropic.messages.create({
      model,
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: `복수형이면 단수형으로 변환. 메인: ${word}, 동의어: ${synonyms || '없음'}, 반의어: ${antonyms || '없음'}\n\n단어: [단수]\n동의어: [...]\n반의어: [...]`,
        },
      ],
    });

    const response = message.content[0];
    if (response.type !== 'text') {
      return NextResponse.json({ error: '응답 오류' }, { status: 500 });
    }
    const text = response.text;
    const wordMatch = text.match(/단어:\s*(.+?)(?=\n|$)/i);
    const synonymMatch = text.match(/동의어:\s*(.+?)(?=\n|$)/i);
    const antonymMatch = text.match(/반의어:\s*(.+?)(?=\n|$)/i);

    return NextResponse.json({
      singularWord: wordMatch?.[1]?.trim() || word,
      singularSynonyms: synonymMatch?.[1]?.trim() || synonyms,
      singularAntonyms: antonymMatch?.[1]?.trim() || antonyms,
    });
  } catch (e) {
    console.error('convert-to-singular:', e);
    return NextResponse.json({ error: '변환 실패' }, { status: 500 });
  }
}
