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
    const { word, meaning, partOfSpeech, synonyms, antonyms } = await request.json();
    if (!word || !meaning) {
      return NextResponse.json({ error: '단어와 뜻이 필요합니다.' }, { status: 400 });
    }

    const message = await anthropic.messages.create({
      model,
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `단어: ${word}\n뜻: ${meaning}\n품사: ${partOfSpeech || 'v.'}\n동의어: ${synonyms || '없음'}\n반의어: ${antonyms || '없음'}\n\n수동태 여부 판단 후 be+과거분사 형태로 변환. 응답:\n수동태여부: [yes/no]\n변환단어: [...]\n변환동의어: [...]\n변환반의어: [...]`,
        },
      ],
    });

    const response = message.content[0];
    if (response.type !== 'text') {
      return NextResponse.json({ error: '응답 오류' }, { status: 500 });
    }
    const text = response.text;
    const passiveMatch = text.match(/수동태여부:\s*(.+?)(?=\n|$)/i);
    const convWord = text.match(/변환단어:\s*(.+?)(?=\n|$)/i);
    const convSyn = text.match(/변환동의어:\s*(.+?)(?=\n|$)/i);
    const convAnt = text.match(/변환반의어:\s*(.+?)(?=\n|$)/i);

    return NextResponse.json({
      isPassive: passiveMatch?.[1]?.trim().toLowerCase().includes('yes'),
      convertedWord: convWord?.[1]?.trim() || word,
      convertedSynonyms: convSyn?.[1]?.trim() || synonyms,
      convertedAntonyms: convAnt?.[1]?.trim() || antonyms,
    });
  } catch (e) {
    console.error('convert-to-passive:', e);
    return NextResponse.json({ error: '변환 실패' }, { status: 500 });
  }
}
