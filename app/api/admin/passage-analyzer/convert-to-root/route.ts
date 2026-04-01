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
    const { word, partOfSpeech, synonyms, antonyms } = await request.json();
    if (!word) {
      return NextResponse.json({ error: '단어가 필요합니다.' }, { status: 400 });
    }

    const message = await anthropic.messages.create({
      model,
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: `동사 원형으로 변환. 단어: ${word}, 품사: ${partOfSpeech || 'v.'}, 동의어: ${synonyms || '없음'}, 반의어: ${antonyms || '없음'}\n\n원형단어: [...]\n원형동의어: [...]\n원형반의어: [...]`,
        },
      ],
    });

    const response = message.content[0];
    if (response.type !== 'text') {
      return NextResponse.json({ error: '응답 오류' }, { status: 500 });
    }
    const text = response.text;
    const w = text.match(/원형단어:\s*(.+?)(?=\n|$)/i);
    const s = text.match(/원형동의어:\s*(.+?)(?=\n|$)/i);
    const a = text.match(/원형반의어:\s*(.+?)(?=\n|$)/i);

    return NextResponse.json({
      rootWord: w?.[1]?.trim() || word,
      rootSynonyms: s?.[1]?.trim() || synonyms,
      rootAntonyms: a?.[1]?.trim() || antonyms,
    });
  } catch (e) {
    console.error('convert-to-root:', e);
    return NextResponse.json({ error: '변환 실패' }, { status: 500 });
  }
}
