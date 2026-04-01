import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageAnalyzerAnthropic } from '@/lib/passage-analyzer-claude';
import { getDb } from '@/lib/mongodb';

const QCOL = 'passage_analyzer_question_types';

interface GrammarItem {
  type: 'single' | 'range';
  sentenceIndex: number;
  wordIndex?: number;
  startWordIndex?: number;
  endWordIndex?: number;
  text: string;
}

interface ContextItem {
  sentenceIndex: number;
  wordIndex: number;
  text: string;
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
    const {
      sentences = [],
      koreanSentences = [],
      grammarItems = [],
      contextItems = [],
      grammarTags = [],
      vocabularyList = [],
      questionTypes = ['grammar', 'context', 'reading'],
      questionCount = 8,
      promptOverrides = {},
    } = body;

    if (!sentences.length) {
      return NextResponse.json(
        { success: false, error: '지문 데이터가 없습니다.' },
        { status: 400 }
      );
    }

    const passageText = sentences
      .map((s: string, i: number) => `${i + 1}. ${s}${koreanSentences[i] ? `\n   → ${koreanSentences[i]}` : ''}`)
      .join('\n\n');

    const grammarInfo =
      grammarItems.length > 0
        ? `\n[선택된 어법 단어]\n${(grammarItems as GrammarItem[])
            .map((g) => `- 문장 ${g.sentenceIndex + 1}: "${g.text}"`)
            .join('\n')}`
        : '';
    const contextInfo =
      contextItems.length > 0
        ? `\n[선택된 문맥 단어]\n${(contextItems as ContextItem[])
            .map((c) => `- 문장 ${c.sentenceIndex + 1}: "${c.text}"`)
            .join('\n')}`
        : '';
    const tagInfo =
      grammarTags.length > 0
        ? `\n[문법 태그]\n${grammarTags
            .map((t: { tagName: string; selectedText: string }) => `- ${t.tagName}: "${t.selectedText}"`)
            .join('\n')}`
        : '';
    const vocabInfo =
      vocabularyList.length > 0
        ? `\n[단어장]\n${vocabularyList
            .slice(0, 30)
            .map((v: { word: string; meaning: string }) => `- ${v.word}: ${v.meaning}`)
            .join('\n')}`
        : '';

    const requestedIds = Array.isArray(questionTypes) ? questionTypes : ['grammar', 'context', 'reading'];
    const db = await getDb('gomijoshua');
    const typeConfigs = await db
      .collection(QCOL)
      .find({ id: { $in: requestedIds }, isActive: { $ne: false } })
      .sort({ order: 1 })
      .toArray();

    const fallbackMap: Record<string, string> = {
      grammar: '어법',
      context: '문맥',
      reading: '독해',
      vocabulary: '어휘',
      blank: '빈칸추론',
      order: '순서배치',
      insert: '문장삽입',
    };
    const fallbackPrompts: Record<string, string> = {
      grammar: '문법 오류 수정, 구문 분석',
      context: '문맥상 적절한 의미, 대명사 지시',
      reading: '주제, 요지, 추론',
      vocabulary: '어휘 추론',
      blank: '빈칸 추론',
      order: '순서 배치',
      insert: '문장 삽입',
    };

    const typeLabels = typeConfigs.map((t) => (t as { label?: string }).label).filter(Boolean);
    const resolvedLabels =
      typeLabels.length > 0
        ? typeLabels
        : requestedIds.map((t: string) => fallbackMap[t] || t).filter(Boolean);
    const allowedTypesSet = new Set(resolvedLabels);

    const effectivePrompt = (t: { id?: string; prompt?: string; label?: string }) => {
      const override =
        typeof promptOverrides === 'object' && t.id && (promptOverrides as Record<string, string>)[t.id];
      return (override && String(override).trim()) || t.prompt || fallbackPrompts[t.id || ''] || t.label;
    };

    const typePromptLines =
      typeConfigs.length > 0
        ? typeConfigs
            .map((t) => {
              const x = t as { id?: string; label?: string; prompt?: string };
              return `- **${x.label}**: ${effectivePrompt(x)}`;
            })
            .join('\n')
        : requestedIds
            .map((id: string) => {
              const o = (promptOverrides as Record<string, string>)[id];
              return `- **${fallbackMap[id] || id}**: ${(o && String(o).trim()) || fallbackPrompts[id] || fallbackMap[id]}`;
            })
            .join('\n');

    const hasTargets =
      grammarItems.length > 0 || contextItems.length > 0 || grammarTags.length > 0;
    const targetInstruction = hasTargets
      ? `표시된 어법/문맥을 활용하세요.${grammarInfo}${contextInfo}${tagInfo}${vocabInfo}\n\n각 유형:\n${typePromptLines}`
      : `지문 전체로 출제하세요.${vocabInfo}\n\n${typePromptLines}`;

    const count = Math.min(Math.max(Number(questionCount) || 8, 3), 15);

    const message = await anthropic.messages.create({
      model,
      max_tokens: 6000,
      messages: [
        {
          role: 'user',
          content: `고등학교 영어 수준 4지선다 문제를 출제하세요.

## 지문
${passageText}

## 지시
${targetInstruction}

## 개수
총 ${count}문제. type 필드는 반드시 다음 중 하나만: ${resolvedLabels.join(', ')}

각 문제를 JSON 블록으로:
\`\`\`json
{
  "number": 1,
  "type": "${resolvedLabels[0] || '어법'}",
  "question": "...",
  "stem": "...",
  "options": ["①", "②", "③", "④"],
  "answer": 1,
  "explanation": "..."
}
\`\`\``,
        },
      ],
    });

    const response = message.content[0];
    if (response.type !== 'text') {
      return NextResponse.json({ success: false, error: 'AI 응답 오류' }, { status: 500 });
    }

    const text = response.text;
    let questions: Record<string, unknown>[] = [];
    const jsonBlocks = text.split(/```json\s*([\s\S]*?)```/);
    for (let i = 1; i < jsonBlocks.length; i += 2) {
      try {
        const parsed = JSON.parse(jsonBlocks[i].trim());
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const p of items) {
          if (p?.number && p?.question && p?.options && p?.answer) questions.push(p);
        }
      } catch {
        /* ignore */
      }
    }
    if (questions.length === 0) {
      try {
        const m = text.match(/\[[\s\S]*\]/);
        if (m) {
          const arr = JSON.parse(m[0]);
          for (const p of arr) {
            if (p?.number && p?.question && p?.options && p?.answer) questions.push(p);
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (resolvedLabels.length > 0 && questions.length > 0) {
      questions = questions.filter((q) => allowedTypesSet.has(q.type as string));
      questions.forEach((q, i) => {
        q.number = i + 1;
      });
    }

    return NextResponse.json({ success: true, questions, raw: text });
  } catch (e) {
    console.error('generate-questions:', e);
    return NextResponse.json({ success: false, error: '문제 생성 실패' }, { status: 500 });
  }
}
