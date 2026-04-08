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
    const { word, partOfSpeech, wordType, currentMeaning, contexts } = await request.json();
    if (!word || !contexts?.length) {
      return NextResponse.json({ success: false, error: 'word, contexts 필요' }, { status: 400 });
    }

    const ctxStr = (contexts as { english: string; korean: string }[])
      .slice(0, 3)
      .map((c, i) => `${i + 1}. 영어: ${c.english}\n   한국어: ${c.korean}`)
      .join('\n');

    const prompt = `영어 단어/숙어의 한국어 뜻을 문맥(해석)에 기반하여 정확하게 수정해주세요.

단어: "${word}"
품사: ${partOfSpeech || '미정'}
유형: ${wordType || 'word'}
현재 뜻: ${currentMeaning || '(없음)'}

문맥:
${ctxStr}

규칙:
- 해석(한국어 문장)에서 이 단어가 어떤 의미로 쓰였는지 파악
- 동사는 동사형(~하다), 명사는 명사형, 형용사는 형용사형으로
- 뜻은 한국어 단수형
- "주요뜻 · 부가뜻1, 부가뜻2" 형식 유지
- 유의어·반의어도 기본형으로

아래 형식으로만 답변:
뜻: [수정된 한국어 뜻]
유의어: [영어 유의어 쉼표 구분]
반의어: [영어 반의어 쉼표 구분, 없으면 없음]

답변:`;

    const msg = await anthropic.messages.create({
      model, max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';

    const meaningMatch = text.match(/뜻:\s*(.+)/);
    const synonymMatch = text.match(/유의어:\s*(.+)/);
    const antonymMatch = text.match(/반의어:\s*(.+)/);

    const meaning = meaningMatch?.[1]?.trim() || currentMeaning;
    const synonym = synonymMatch?.[1]?.trim() || '';
    const antonym = antonymMatch?.[1]?.trim() || '';

    return NextResponse.json({
      success: true,
      meaning,
      synonym: synonym === '없음' ? '' : synonym,
      antonym: antonym === '없음' ? '' : antonym,
    });
  } catch (e) {
    console.error('fix-single-meaning:', e);
    return NextResponse.json({ success: false, error: '뜻 수정 실패' }, { status: 500 });
  }
}
