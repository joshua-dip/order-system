import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageAnalyzerAnthropic, stripJsonFence } from '@/lib/passage-analyzer-claude';
import {
  buildContextAiUserContent,
  contextAiJsonToWordKeys,
  DEFAULT_CONTEXT_AI_PROMPT,
  type ContextAiSelectionRow,
} from '@/lib/passage-analyzer-context-ai';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const claude = getPassageAnalyzerAnthropic();
  if ('error' in claude) {
    return NextResponse.json({ error: claude.error }, { status: 503 });
  }
  const { anthropic, model } = claude;

  try {
    const body = await request.json();
    const { sentences, customPrompt } = body as {
      sentences?: string[];
      customPrompt?: string;
    };
    if (!sentences || !Array.isArray(sentences) || sentences.length === 0) {
      return NextResponse.json({ error: '문장 배열이 필요합니다.' }, { status: 400 });
    }

    const promptText =
      typeof customPrompt === 'string' && customPrompt.trim()
        ? buildContextAiUserContent(sentences, customPrompt)
        : buildContextAiUserContent(sentences, DEFAULT_CONTEXT_AI_PROMPT);

    const message = await anthropic.messages.create({
      model,
      max_tokens: Math.min(4096, 400 + sentences.length * 40),
      messages: [{ role: 'user', content: promptText }],
    });

    const response = message.content[0];
    if (response.type !== 'text') {
      return NextResponse.json({ error: 'AI 응답 형식 오류' }, { status: 500 });
    }

    const jsonText = stripJsonFence(response.text);
    const parsed = JSON.parse(jsonText) as { selections?: ContextAiSelectionRow[] };
    const selections = Array.isArray(parsed.selections) ? parsed.selections : [];
    const wordKeys = contextAiJsonToWordKeys(sentences, selections);

    return NextResponse.json({ success: true, wordKeys, selections });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error('suggest-context-words:', e);
    return NextResponse.json({ error: errMsg || '문맥 AI 분석 실패' }, { status: 500 });
  }
}
