import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageAnalyzerAnthropic } from '@/lib/passage-analyzer-claude';
import { parseWordBlock, BATCH_SIZE } from '@/lib/passage-analyzer-vocabulary';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const claude = getPassageAnalyzerAnthropic();
  if ('error' in claude) {
    return NextResponse.json({ success: false, error: claude.error }, { status: 503 });
  }
  const { anthropic, model } = claude;
  const startTime = Date.now();

  try {
    const { vocabularyList, englishSentences, koreanSentences } = await request.json();
    if (!vocabularyList || !englishSentences || !koreanSentences) {
      return NextResponse.json(
        { success: false, error: 'vocabularyList, englishSentences, koreanSentences가 필요합니다.' },
        { status: 400 }
      );
    }

    const analyzedVocabulary: Record<string, unknown>[] = [];

    for (const item of vocabularyList as Record<string, unknown>[]) {
      const hasMeaning = !!(item.meaning && String(item.meaning).trim());
      const hasCefr = !!(item.cefr && String(item.cefr).trim());
      if (hasMeaning && hasCefr) {
        analyzedVocabulary.push(item);
        continue;
      }

      const wordContexts: { english: string; korean: string }[] = [];
      const positions = item.positions as { sentence: number; position: number }[] | undefined;
      if (positions && positions.length > 0) {
        for (const pos of positions) {
          const englishSentence = englishSentences[pos.sentence];
          const koreanSentence = koreanSentences[pos.sentence];
          if (englishSentence && koreanSentence) {
            wordContexts.push({ english: englishSentence, korean: koreanSentence });
          }
        }
      }

      if (wordContexts.length === 0) {
        analyzedVocabulary.push(item);
        continue;
      }

      analyzedVocabulary.push({ _needsAnalysis: true, _contexts: wordContexts, ...item });
    }

    const needsAnalysis = analyzedVocabulary.filter((a) => a._needsAnalysis);
    const alreadyDone = analyzedVocabulary.filter((a) => !a._needsAnalysis);

    if (needsAnalysis.length === 0) {
      return NextResponse.json({ success: true, analyzedVocabulary });
    }

    const results: Record<string, unknown>[] = [...alreadyDone];

    for (let i = 0; i < needsAnalysis.length; i += BATCH_SIZE) {
      const batch = needsAnalysis.slice(i, i + BATCH_SIZE);
      const batchPrompt = batch
        .map((item: Record<string, unknown>, idx: number) => {
          const ctx = ((item._contexts as { english: string; korean: string }[]) || [])
            .map((c, j) => `${j + 1}. 영어: ${c.english}\n   한국어: ${c.korean}`)
            .join('\n');
          return `[단어 ${idx + 1}: "${item.word}"]\n문맥:\n${ctx}`;
        })
        .join('\n\n');

      const formatExample = batch
        .map(
          (_: unknown, idx: number) =>
            `[단어 ${idx + 1}: "단어"]\n유형: word\n품사: n.\nCEFR: B1\n뜻: 한글 주요 뜻\n부가뜻: 다른 한글 표현(없으면 없음)\n영어유의어: really, truly(같은 뜻의 영어 단어, 쉼표)\n영어반의어: supposedly(반대·대조 뜻의 영어, 없으면 없음)`
        )
        .join('\n\n');

      const prompt = `다음 영어 단어들을 문맥에 맞게 각각 종합 분석해주세요.

${batchPrompt}

각 단어마다 아래 형식으로만 답변하세요. 라벨을 정확히 지키세요.
유형: [word 또는 phrase]
품사: [n., v., adj. 등]
CEFR: [반드시 A1, A2, B1, B2, C1, C2 중 하나만. 해당 지문·문맥에서의 어휘 난이도]
뜻: [문맥에 맞는 주요 뜻, 한국어]
부가뜻: [부가 한글 의미, 없으면 없음]
영어유의어: [뜻이 같은 영어 단어·구만 쉼표로. 동의어(synonym)이지 반의어가 아님]
영어반의어: [뜻이 정반대이거나 강하게 대조되는 영어 단어만. 없으면 없음]

중요:
- "영어반의어"에는 permit/enable 같은 유의어를 넣지 마세요(그건 영어유의어). allow ↔ forbid 처럼 반대 관계만 영어반의어에 넣으세요.
- 뜻은 반드시 단수 명사형으로 쓰세요(예: "공무원들" ✗ → "공무원" ✓, "아이들" ✗ → "아이" ✓).
- 영어유의어·영어반의어는 반드시 기본형(단수·원형)으로 쓰세요(예: administrators ✗ → administrator ✓).

답변 형식 예시:
${formatExample}

답변:`;

      try {
        const message = await anthropic.messages.create({
          model,
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        });
        const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
        const splits = text.split(/(?=\[단어\s*\d+[^\]]*\])/i);
        const wordBlocks = splits.filter((s) => /\[단어\s*\d+/i.test(s));
        const effectiveBlocks = wordBlocks.length >= batch.length ? wordBlocks : [text];
        for (let j = 0; j < batch.length; j++) {
          const block = effectiveBlocks[j] || effectiveBlocks[0] || text;
          const item = batch[j] as Record<string, unknown>;
          const { _needsAnalysis: _a, _contexts: _c, ...rest } = item;
          results.push(parseWordBlock(block, rest));
        }
      } catch {
        for (const item of batch) {
          const { _needsAnalysis: _a, _contexts: _c, ...rest } = item as Record<string, unknown>;
          results.push(rest);
        }
      }

      if (i + BATCH_SIZE < needsAnalysis.length) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    console.log(`[vocabulary] ${Date.now() - startTime}ms`);
    return NextResponse.json({ success: true, analyzedVocabulary: results });
  } catch (e) {
    console.error('analyze-vocabulary:', e);
    return NextResponse.json({ success: false, error: '단어 분석 실패' }, { status: 500 });
  }
}
