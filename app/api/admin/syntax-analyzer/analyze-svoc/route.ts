import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAdmin } from '@/lib/admin-auth';
import { findWordIndices } from '@/lib/syntax-analyzer-word-match';

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
      max_tokens: 6000,
      messages: [
        {
          role: 'user',
          content: `다음 영어 문장들을 SVOC(주어-동사-목적어-보어)로 분석해주세요.

문장들 (0번부터 시작):
${sentences.map((s: string, i: number) => `[${i}] ${s}`).join('\n')}

각 문장에서 주어(Subject), 동사(Verb), 목적어(Object, 있을 경우), 보어(Complement, 있을 경우)를 원문에서 정확히 일치하는 텍스트로 표시해주세요.

응답 형식 (JSON 배열):
[
  {
    "sentenceIndex": 0,
    "subject": "원문의 주어 부분",
    "verb": "원문의 동사 부분",
    "object": "목적어 또는 null",
    "complement": "보어 또는 null"
  }
]

조건: sentenceIndex 0부터, 텍스트는 원문 그대로, 동사구는 한 덩어리, JSON만 출력`,
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
      subject?: string;
      verb?: string;
      object?: string | null;
      complement?: string | null;
    }>;

    const processed = result.map((item) => {
      let idx = item.sentenceIndex;
      if (idx >= 1 && idx <= sentences.length && !sentences[idx] && sentences[idx - 1]) {
        idx = idx - 1;
      }
      const sentence = sentences[idx] || '';
      const subjectIdx = findWordIndices(sentence, item.subject || '');
      const verbIdx = findWordIndices(sentence, item.verb || '');
      const objectIdx = item.object
        ? findWordIndices(sentence, String(item.object))
        : { startWordIndex: -1, endWordIndex: -1 };
      const complementIdx = item.complement
        ? findWordIndices(sentence, String(item.complement))
        : { startWordIndex: -1, endWordIndex: -1 };

      return {
        sentenceIndex: idx,
        subject: item.subject || '',
        verb: item.verb || '',
        object: item.object ?? null,
        complement: item.complement ?? null,
        subjectStart: subjectIdx.startWordIndex,
        subjectEnd: subjectIdx.endWordIndex,
        verbStart: verbIdx.startWordIndex,
        verbEnd: verbIdx.endWordIndex,
        objectStart: objectIdx.startWordIndex >= 0 ? objectIdx.startWordIndex : null,
        objectEnd: objectIdx.endWordIndex >= 0 ? objectIdx.endWordIndex : null,
        complementStart: complementIdx.startWordIndex >= 0 ? complementIdx.startWordIndex : null,
        complementEnd: complementIdx.endWordIndex >= 0 ? complementIdx.endWordIndex : null,
      };
    });

    console.log(`[syntax-analyzer] SVOC ${Date.now() - startTime}ms`);
    return NextResponse.json({ success: true, result: processed });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error('[syntax-analyzer] analyze-svoc:', errMsg);
    return NextResponse.json({ error: 'SVOC 분석에 실패했습니다.' }, { status: 500 });
  }
}
