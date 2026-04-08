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
    if (!word) {
      return NextResponse.json({ success: false, error: 'word 필요' }, { status: 400 });
    }

    const ctxStr = (contexts as { english: string; korean: string }[] | undefined)
      ?.slice(0, 3)
      .map((c, i) => `${i + 1}. 영어: ${c.english}\n   한국어: ${c.korean}`)
      .join('\n') || '(문맥 없음)';

    const prompt = `영어 단어를 동사 원형(기본형)으로 변환하고, 뜻도 원형에 맞게 수정해주세요.

단어: "${word}"
품사: ${partOfSpeech || '미정'}
유형: ${wordType || 'word'}
현재 뜻: ${currentMeaning || '(없음)'}

문맥:
${ctxStr}

규칙:
- 동명사(-ing), 과거형(-ed), 과거분사, 3인칭 단수(-s) 등 → 동사 원형으로
- 예: seeing → see, caused → cause, makes → make, written → write
- 이미 원형이면 그대로 유지
- 뜻도 원형에 맞게 수정 (예: "보고 있는" → "보다", "만들어진" → "만들다")
- 동사는 ~하다 형태로, 형용사는 ~한/~적인 형태로
- 유의어·반의어도 기본형으로

아래 형식으로만 답변:
원형: [동사 원형]
뜻: [수정된 한국어 뜻]
유의어: [영어 유의어 쉼표 구분, 없으면 없음]
반의어: [영어 반의어 쉼표 구분, 없으면 없음]

답변:`;

    const msg = await anthropic.messages.create({
      model, max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';

    const baseMatch = text.match(/원형:\s*(.+)/);
    const meaningMatch = text.match(/뜻:\s*(.+)/);
    const synonymMatch = text.match(/유의어:\s*(.+)/);
    const antonymMatch = text.match(/반의어:\s*(.+)/);

    const baseForm = baseMatch?.[1]?.trim() || word;
    const meaning = meaningMatch?.[1]?.trim() || currentMeaning;
    const synonym = synonymMatch?.[1]?.trim() || '';
    const antonym = antonymMatch?.[1]?.trim() || '';

    return NextResponse.json({
      success: true,
      baseForm,
      meaning,
      synonym: synonym === '없음' ? '' : synonym,
      antonym: antonym === '없음' ? '' : antonym,
    });
  } catch (e) {
    console.error('to-base-form:', e);
    return NextResponse.json({ success: false, error: '원형 변환 실패' }, { status: 500 });
  }
}
