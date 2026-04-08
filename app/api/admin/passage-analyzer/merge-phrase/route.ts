import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageAnalyzerAnthropic } from '@/lib/passage-analyzer-claude';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const claude = getPassageAnalyzerAnthropic();
  if ('error' in claude) {
    return NextResponse.json({ success: false, error: claude.error }, { status: 503 });
  }
  const { anthropic, model } = claude;

  try {
    const { word1, word2, contexts } = await request.json();
    if (!word1 || !word2) {
      return NextResponse.json({ success: false, error: 'word1, word2 필요' }, { status: 400 });
    }

    const ctxStr = (contexts as { english: string; korean: string }[] | undefined)
      ?.slice(0, 4)
      .map((c, i) => `${i + 1}. 영어: ${c.english}\n   한국어: ${c.korean}`)
      .join('\n') || '(문맥 없음)';

    const prompt = `두 영어 단어가 함께 쓰여 숙어/구동사/연어를 이루는지 판단하고, 맞다면 정보를 제공해주세요.

단어 1: "${word1}"
단어 2: "${word2}"

문맥:
${ctxStr}

판단 기준:
- 구동사 (phrasal verb): put off, give up, look forward to, open up 등
- 연어/숙어: as well, in addition, take place, make sense 등
- 두 단어가 문맥에서 하나의 의미 단위로 쓰이는 경우

아래 형식으로만 답변:
숙어여부: [예 또는 아니오]
숙어: [원형 숙어 (예: open up, put off)]
품사: [v., adv., adj., n. 등]
CEFR: [A1~C2]
뜻: [한국어 뜻, 동사면 ~하다 형태]
유의어: [영어 유의어, 없으면 없음]
반의어: [영어 반의어, 없으면 없음]

답변:`;

    const msg = await anthropic.messages.create({
      model, max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';

    const isPhraseMatch = text.match(/숙어여부:\s*(.+)/);
    const isPhrase = isPhraseMatch?.[1]?.trim() === '예';

    if (!isPhrase) {
      return NextResponse.json({ success: true, isPhrase: false });
    }

    const phraseMatch = text.match(/숙어:\s*(.+)/);
    const posMatch = text.match(/품사:\s*(.+)/);
    const cefrMatch = text.match(/CEFR:\s*(.+)/);
    const meaningMatch = text.match(/뜻:\s*(.+)/);
    const synonymMatch = text.match(/유의어:\s*(.+)/);
    const antonymMatch = text.match(/반의어:\s*(.+)/);

    const synonym = synonymMatch?.[1]?.trim() || '';
    const antonym = antonymMatch?.[1]?.trim() || '';

    return NextResponse.json({
      success: true,
      isPhrase: true,
      phrase: phraseMatch?.[1]?.trim() || `${word1} ${word2}`,
      partOfSpeech: posMatch?.[1]?.trim() || 'v.',
      cefr: cefrMatch?.[1]?.trim() || '',
      meaning: meaningMatch?.[1]?.trim() || '',
      synonym: synonym === '없음' ? '' : synonym,
      antonym: antonym === '없음' ? '' : antonym,
    });
  } catch (e) {
    console.error('merge-phrase:', e);
    return NextResponse.json({ success: false, error: '숙어 판단 실패' }, { status: 500 });
  }
}
