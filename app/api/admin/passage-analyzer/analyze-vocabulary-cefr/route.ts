import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageAnalyzerAnthropic } from '@/lib/passage-analyzer-claude';
import { normalizeCefrLevel } from '@/lib/passage-analyzer-vocabulary';

export const maxDuration = 120;

function parseCefrFromModelText(text: string): string {
  const m1 = text.match(/CEFR\s*[:：]\s*([^\n]+)/i);
  if (m1) return normalizeCefrLevel(m1[1]);
  const m2 = text.match(/난이도\s*[:：]\s*([^\n]+)/i);
  if (m2) return normalizeCefrLevel(m2[1]);
  return normalizeCefrLevel(text);
}

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
    const word = typeof body.word === 'string' ? body.word.trim() : '';
    const englishSentences = Array.isArray(body.englishSentences)
      ? (body.englishSentences as unknown[]).map((x) => String(x ?? ''))
      : [];
    const koreanSentences = Array.isArray(body.koreanSentences)
      ? (body.koreanSentences as unknown[]).map((x) => String(x ?? ''))
      : [];
    const positions = Array.isArray(body.positions) ? body.positions : [];
    const meaning = typeof body.meaning === 'string' ? body.meaning.trim() : '';
    const partOfSpeech = typeof body.partOfSpeech === 'string' ? body.partOfSpeech.trim() : '';

    if (!word) {
      return NextResponse.json({ success: false, error: 'word가 필요합니다.' }, { status: 400 });
    }
    if (englishSentences.length === 0) {
      return NextResponse.json({ success: false, error: 'englishSentences가 필요합니다.' }, { status: 400 });
    }

    const wordContexts: { english: string; korean: string }[] = [];
    for (const pos of positions as { sentence?: number; position?: number }[]) {
      const si = typeof pos?.sentence === 'number' ? pos.sentence : -1;
      if (si < 0 || si >= englishSentences.length) continue;
      const englishSentence = englishSentences[si];
      const koreanSentence = koreanSentences[si] ?? '';
      if (englishSentence) wordContexts.push({ english: englishSentence, korean: koreanSentence });
    }
    if (wordContexts.length === 0) {
      const cap = Math.min(englishSentences.length, 4);
      for (let si = 0; si < cap; si++) {
        const englishSentence = englishSentences[si];
        if (englishSentence?.trim()) {
          wordContexts.push({ english: englishSentence, korean: koreanSentences[si] ?? '' });
        }
      }
    }
    if (wordContexts.length === 0) {
      return NextResponse.json({ success: false, error: '문맥 문장을 만들 수 없습니다.' }, { status: 400 });
    }

    const ctxBlock = wordContexts
      .map((c, j) => `${j + 1}. 영어: ${c.english}\n   한국어: ${c.korean}`)
      .join('\n');

    const hint =
      (meaning ? `\n이미 알려진 한글 뜻(참고): ${meaning}` : '') +
      (partOfSpeech ? `\n품사(참고): ${partOfSpeech}` : '');

    const prompt = `영어 단어 "${word}"의 CEFR 어휘 난이도만 판정하세요.

문맥:
${ctxBlock}
${hint}

규칙:
- 반드시 A1, A2, B1, B2, C1, C2 중 하나만 고릅니다.
- 이 지문·문맥에서 학습자에게 요구되는 수준을 기준으로 합니다.
- 답변은 반드시 한 줄만, 아래 형식으로만 씁니다.
CEFR: B1

답변:`;

    const message = await anthropic.messages.create({
      model,
      max_tokens: 80,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const cefr = parseCefrFromModelText(text);

    return NextResponse.json({ success: true, cefr });
  } catch (e) {
    console.error('analyze-vocabulary-cefr:', e);
    return NextResponse.json({ success: false, error: 'CEFR 분석에 실패했습니다.' }, { status: 500 });
  }
}
