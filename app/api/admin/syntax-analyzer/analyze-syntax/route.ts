import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAdmin } from '@/lib/admin-auth';
import { findWordIndices, getSyntaxColorForLabel } from '@/lib/syntax-analyzer-word-match';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY가 설정되어 있어야 합니다.' },
      { status: 503 }
    );
  }

  const model =
    (process.env.ANTHROPIC_SOLVE_MODEL && process.env.ANTHROPIC_SOLVE_MODEL.trim()) || 'claude-sonnet-4-6';
  const startTime = Date.now();
  const anthropic = new Anthropic({ apiKey });

  try {
    const body = await request.json();
    const sentences = body?.sentences;
    if (!sentences || !Array.isArray(sentences)) {
      return NextResponse.json({ error: '문장 배열(sentences)이 필요합니다.' }, { status: 400 });
    }

    const message = await anthropic.messages.create({
      model,
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: `다음 영어 문장들의 구문 구조(Syntax Structure)를 분석해주세요.

문장들 (0번부터 시작):
${sentences.map((s: string, i: number) => `[${i}] ${s}`).join('\n')}

각 문장에서 구(phrase)와 절(clause)의 경계를 식별하고, 각각의 문법적 기능을 분류해주세요.

분류 라벨 (아래 중에서 선택, 복합 기능이면 " | "로 구분):
- 절(Clause): 부사절, 명사절, 관계사절, 형용사절, 분사구문, 동격절, 조건절, 양보절, 시간절, 원인절, 목적절, 결과절, 삽입절
- 구(Phrase): 명사구, 전치사구, 형용사구, 부사구, to부정사(명), to부정사(형), to부정사(부), 동명사구, 분사구(현재), 분사구(과거)
- 복합 예시: "to부정사 | 형용사구"
- 수식 관계: 해당 구가 특정 단어를 수식하는 경우 "modifies" 필드에 피수식어 표시

응답 형식 (JSON 배열):
[
  {
    "sentenceIndex": 0,
    "phrases": [
      {
        "text": "해당 구/절의 원문 텍스트 (원문에서 정확히 복사)",
        "label": "분사구문",
        "type": "clause",
        "modifies": null
      }
    ]
  }
]

조건:
1. sentenceIndex는 0부터
2. 모든 text는 원문에서 정확히 복사
3. type은 "clause" 또는 "phrase"
4. 주요 구문만 분석 (과도하게 쪼개지 말 것)
5. 주절 자체는 포함하지 말 것
6. 응답은 유효한 JSON만`,
        },
      ],
    });

    const response = message.content[0];
    if (response.type !== 'text') {
      return NextResponse.json({ error: 'AI 응답 형식이 올바르지 않습니다.' }, { status: 500 });
    }

    let jsonText = response.text.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '');
    }

    const result = JSON.parse(jsonText) as Array<{
      sentenceIndex: number;
      phrases?: Array<{
        text?: string;
        label?: string;
        type?: string;
        modifies?: string | null;
      }>;
    }>;

    const processed = result.map((item) => {
      let idx = item.sentenceIndex;
      if (idx >= 1 && idx <= sentences.length && !sentences[idx] && sentences[idx - 1]) {
        idx = idx - 1;
      }
      const sentence = sentences[idx] || '';
      const phrases = (item.phrases || [])
        .map((p) => {
          const w = findWordIndices(sentence, p.text || '');
          return {
            text: p.text || '',
            label: p.label || '',
            type: (p.type || 'phrase') as 'clause' | 'phrase',
            startIndex: w.startWordIndex,
            endIndex: w.endWordIndex,
            color: getSyntaxColorForLabel(p.label || ''),
            modifies: p.modifies ?? null,
          };
        })
        .filter((p) => p.startIndex >= 0);

      phrases.sort((a, b) => {
        if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
        return b.endIndex - b.startIndex - (a.endIndex - a.startIndex);
      });

      for (let i = 0; i < phrases.length; i++) {
        let depth = 0;
        for (let j = 0; j < phrases.length; j++) {
          if (i === j) continue;
          if (
            phrases[j].startIndex <= phrases[i].startIndex &&
            phrases[j].endIndex >= phrases[i].endIndex &&
            !(phrases[j].startIndex === phrases[i].startIndex && phrases[j].endIndex === phrases[i].endIndex)
          ) {
            depth++;
          }
        }
        (phrases[i] as { depth?: number }).depth = depth;
      }

      return { sentenceIndex: idx, phrases };
    });

    console.log(`[syntax-analyzer] 구문 분석 ${Date.now() - startTime}ms`);
    return NextResponse.json({ success: true, result: processed });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error('[syntax-analyzer] analyze-syntax:', errMsg);
    if (errMsg.includes('JSON')) {
      return NextResponse.json({ error: 'AI 응답 JSON 파싱에 실패했습니다.' }, { status: 500 });
    }
    return NextResponse.json({ error: '구문 분석에 실패했습니다.' }, { status: 500 });
  }
}
