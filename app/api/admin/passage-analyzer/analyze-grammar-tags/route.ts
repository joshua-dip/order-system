import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageAnalyzerAnthropic, stripJsonFence } from '@/lib/passage-analyzer-claude';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const claude = getPassageAnalyzerAnthropic();
  if ('error' in claude) {
    return NextResponse.json({ error: claude.error }, { status: 503 });
  }
  const { anthropic, model } = claude;
  const startTime = Date.now();

  try {
    const { sentences } = await request.json();
    if (!sentences || !Array.isArray(sentences)) {
      return NextResponse.json({ error: '문장 배열이 필요합니다.' }, { status: 400 });
    }

    const message = await anthropic.messages.create({
      model,
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: `다음 영어 문장들을 분석하여 주요 문법 요소를 추출해주세요.

문장들:
${sentences.map((s: string, i: number) => `[${i}] ${s}`).join('\n')}

응답 형식 (JSON):
[
  {
    "sentenceIndex": 0,
    "tags": [
      {
        "tagName": "#분사구문",
        "selectedText": "원문과 정확히 일치",
        "startWord": "시작 단어",
        "endWord": "끝 단어"
      }
    ]
  }
]

조건: sentenceIndex 0부터, 문장당 최대 5개 태그, #으로 시작, JSON만`,
        },
      ],
    });

    const response = message.content[0];
    if (response.type !== 'text') {
      return NextResponse.json({ error: 'AI 응답 형식 오류' }, { status: 500 });
    }

    const jsonText = stripJsonFence(response.text);
    const result = JSON.parse(jsonText) as Array<{
      sentenceIndex: number;
      tags: Array<{ tagName: string; selectedText: string; startWord?: string; endWord?: string }>;
    }>;

    const processedResult = result
      .map((item) => {
        let idx = item.sentenceIndex;
        if (idx >= 1 && idx <= sentences.length && !sentences[idx] && sentences[idx - 1]) idx = idx - 1;
        if (idx < 0 || idx >= sentences.length) return null;
        const sentence = sentences[idx];
        const words = sentence.split(/\s+/);

        const processedTags = (item.tags || [])
          .map((tag) => {
            const tagWords = tag.selectedText.split(/\s+/);
            const startWord = tagWords[0];
            const endWord = tagWords[tagWords.length - 1];
            let startWordIndex = -1;
            let endWordIndex = -1;
            for (let i = 0; i < words.length; i++) {
              const word = words[i].replace(/[.,;:!?()]/g, '');
              const startWordClean = startWord.replace(/[.,;:!?()]/g, '');
              if (word.toLowerCase() === startWordClean.toLowerCase()) {
                let match = true;
                for (let j = 0; j < tagWords.length; j++) {
                  if (i + j >= words.length) {
                    match = false;
                    break;
                  }
                  const sentenceWord = words[i + j].replace(/[.,;:!?()]/g, '').toLowerCase();
                  const tagWord = tagWords[j].replace(/[.,;:!?()]/g, '').toLowerCase();
                  if (sentenceWord !== tagWord) {
                    match = false;
                    break;
                  }
                }
                if (match) {
                  startWordIndex = i;
                  endWordIndex = i + tagWords.length - 1;
                  break;
                }
              }
            }
            return {
              tagName: tag.tagName,
              selectedText: tag.selectedText,
              startWordIndex,
              endWordIndex,
            };
          })
          .filter((tag) => tag.startWordIndex !== -1);

        return { sentenceIndex: idx, tags: processedTags };
      })
      .filter(Boolean);

    console.log(`[grammar-tags] ok ${Date.now() - startTime}ms`);
    return NextResponse.json({ success: true, result: processedResult });
  } catch (e) {
    console.error('analyze-grammar-tags:', e);
    return NextResponse.json({ error: '문법 태그 분석 실패' }, { status: 500 });
  }
}
