import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { extractJsonObject } from '@/lib/llm-json';

/**
 * 해당 문항의 선택지(Options)만 Claude로 새로 생성해 중복 해소.
 * 지문·발문·정답 의미는 유지, 선택지 문장만 다르게 만듦.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: '선택지 재생성에는 ANTHROPIC_API_KEY 설정이 필요합니다.' },
      { status: 400 }
    );
  }

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const doc = await col.findOne({ _id: new ObjectId(id) });
    if (!doc) {
      return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
    }

    const qd =
      doc.question_data && typeof doc.question_data === 'object' && !Array.isArray(doc.question_data)
        ? (doc.question_data as Record<string, unknown>)
        : {};
    const paragraph = typeof qd.Paragraph === 'string' ? qd.Paragraph : '';
    const question = typeof qd.Question === 'string' ? qd.Question : '';
    const currentOptions = typeof qd.Options === 'string' ? qd.Options : '';
    const correctAnswer = typeof qd.CorrectAnswer === 'string' ? qd.CorrectAnswer : '';
    const type = String(doc.type ?? '').trim();

    if (!paragraph.trim() || !question.trim()) {
      return NextResponse.json(
        { error: '지문(Paragraph) 또는 발문(Question)이 비어 있어 선택지만 재생성할 수 없습니다.' },
        { status: 400 }
      );
    }

    const model =
      (process.env.ANTHROPIC_SOLVE_MODEL && process.env.ANTHROPIC_SOLVE_MODEL.trim()) ||
      'claude-sonnet-4-6';

    const client = new Anthropic({ apiKey });
    const system = `You are helping fix duplicate multiple-choice options for a Korean English exam question.
The passage, question stem, and the MEANING of the correct answer must stay the same. Only generate NEW option texts so that this question no longer shares identical options with another.

Rules:
1) Output a single JSON object with keys: Options (string), CorrectAnswer (string).
2) Options: Same format as the current one (e.g. ① ... ② ... ③ ... ④ ... ⑤, or 1. ... 2. ...). Use English only for the option sentences. Keep the same number of options (typically 5).
3) CorrectAnswer: The same correct answer as before (e.g. "1", "2", "①", "②", or "①" etc. — match the numbering style you use in Options). The CONTENT of the correct option must express the same meaning as the original correct answer; only the wording can change.
4) Make the new options clearly different in wording from the current options so that duplicate detection will not match them.`;

    const userMsg = `Question type (유형): ${type || '(none)'}

[Paragraph]
${paragraph}

[Question stem]
${question}

[Current options - generate NEW options with same correct answer meaning, different wording]
${currentOptions}

[Current correct answer key]
${correctAnswer}

Return JSON: { "Options": "...", "CorrectAnswer": "..." }`;

    const message = await client.messages.create({
      model,
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: userMsg }],
    });
    const responseText = message.content[0]?.type === 'text' ? message.content[0].text : '';
    const parsed = extractJsonObject(responseText);
    if (!parsed || typeof parsed !== 'object') {
      return NextResponse.json(
        { error: 'AI 응답에서 JSON을 파싱하지 못했습니다. 다시 시도해 주세요.' },
        { status: 422 }
      );
    }

    const newOptions = typeof parsed.Options === 'string' && parsed.Options.trim() ? parsed.Options.trim() : '';
    const newCorrectAnswer =
      typeof parsed.CorrectAnswer === 'string' && parsed.CorrectAnswer.trim() ? parsed.CorrectAnswer.trim() : correctAnswer;

    if (!newOptions) {
      return NextResponse.json(
        { error: 'AI가 선택지(Options)를 반환하지 않았습니다. 다시 시도해 주세요.' },
        { status: 422 }
      );
    }

    const updatedQd = { ...qd, Options: newOptions, CorrectAnswer: newCorrectAnswer };
    await col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { question_data: updatedQd, updated_at: new Date() } }
    );

    return NextResponse.json({
      ok: true,
      id,
      Options: newOptions,
      CorrectAnswer: newCorrectAnswer,
    });
  } catch (e) {
    console.error('regenerate-options:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '선택지 재생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
