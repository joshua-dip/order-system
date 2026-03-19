import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { extractJsonObject } from '@/lib/llm-json';

/**
 * passages 원문 + 유형으로 Claude가 question_data JSON 초안만 생성 (DB 저장 없음).
 * 새 변형문제 모달에서 사용.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const passageIdStr = typeof body.passage_id === 'string' ? body.passage_id.trim() : '';
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    const type = typeof body.type === 'string' ? body.type.trim() : '';
    const userHint = typeof body.userHint === 'string' ? body.userHint.trim().slice(0, 2000) : '';
    const typePrompt =
      typeof body.typePrompt === 'string' ? body.typePrompt.trim().slice(0, 12000) : '';
    const optionTypeHint =
      typeof body.option_type === 'string' && body.option_type.trim()
        ? body.option_type.trim()
        : 'English';

    if (!passageIdStr || !ObjectId.isValid(passageIdStr)) {
      return NextResponse.json({ error: '유효한 passage_id(ObjectId)가 필요합니다.' }, { status: 400 });
    }
    if (!textbook || !source || !type) {
      return NextResponse.json(
        { error: '교재명(textbook), 출처(source), 유형(type)은 필수입니다.' },
        { status: 400 }
      );
    }

    const db = await getDb('gomijoshua');
    const passagesCol = db.collection('passages');
    const gqCol = db.collection('generated_questions');

    const passage = await passagesCol.findOne({ _id: new ObjectId(passageIdStr) });
    if (!passage) {
      return NextResponse.json({ error: '원문 passage를 찾을 수 없습니다.' }, { status: 404 });
    }

    const pTextbook = String(passage.textbook ?? '').trim();
    if (pTextbook !== textbook) {
      return NextResponse.json(
        {
          error: `원문의 교재명("${pTextbook || '—'}")과 입력 교재명이 일치하지 않습니다.`,
        },
        { status: 400 }
      );
    }

    const content =
      passage.content && typeof passage.content === 'object' && !Array.isArray(passage.content)
        ? (passage.content as Record<string, unknown>)
        : {};
    const paragraph =
      (typeof content.original === 'string' && content.original.trim()) ||
      (typeof content.mixed === 'string' && content.mixed.trim()) ||
      (typeof content.translation === 'string' && content.translation.trim()) ||
      '';

    if (!paragraph.trim()) {
      return NextResponse.json(
        { error: '원문에 영어 지문(content.original 등)이 없어 AI 초안을 만들 수 없습니다.' },
        { status: 400 }
      );
    }

    const passageOid = new ObjectId(passageIdStr);
    const maxAgg = await gqCol
      .aggregate<{ m: number | null }>([
        {
          $match: {
            textbook,
            passage_id: passageOid,
            source,
            type,
          },
        },
        { $group: { _id: null, m: { $max: '$question_data.NumQuestion' } } },
      ])
      .toArray();
    const prevMax = typeof maxAgg[0]?.m === 'number' && Number.isFinite(maxAgg[0].m) ? maxAgg[0].m : 0;
    const nextNum = prevMax + 1;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'AI 초안 생성에는 ANTHROPIC_API_KEY 설정이 필요합니다.' },
        { status: 400 }
      );
    }
    const model =
      (process.env.ANTHROPIC_SOLVE_MODEL && process.env.ANTHROPIC_SOLVE_MODEL.trim()) ||
      'claude-sonnet-4-6';
    const extra =
      (process.env.ANTHROPIC_VARIANT_DRAFT_EXTRA && process.env.ANTHROPIC_VARIANT_DRAFT_EXTRA.trim()) ||
      '';

    const client = new Anthropic({ apiKey });
    const sys = `당신은 한국 수능 영어 변형문제 출제자입니다. 주어진 지문과 문제 유형에 맞는 객관식 1문항을 새로 만듭니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 다른 설명·마크다운 금지.
키: 순서(number), Source(string, 보통 빈 문자열), NumQuestion(number), Category(string), Question(string, 발문), Paragraph(string), Options(string, ①②③④⑤ 보기 각 줄), OptionType(string, 보통 "${optionTypeHint}"), CorrectAnswer(string, 1~5 또는 ①~⑤), Explanation(string, 한국어 해설)
지문 Paragraph는 입력과 동일하게 복사하세요. NumQuestion은 ${nextNum} 로 두세요. 순서도 ${nextNum} 로 두세요.`;
    const userMsg = `문제 유형(type): ${type}
${extra ? `운영자 공통 지시(.env): ${extra}\n` : ''}${typePrompt ? `【이 유형 전용 출제 지침】\n${typePrompt}\n\n` : ''}${userHint ? `이번 문항만의 추가 지시: ${userHint}\n` : ''}
[지문 Paragraph]
${paragraph}`;

    const message = await client.messages.create({
      model,
      max_tokens: 4096,
      system: sys,
      messages: [{ role: 'user', content: userMsg }],
    });
    const responseText =
      message.content[0]?.type === 'text' ? message.content[0].text : '';
    const parsed = extractJsonObject(responseText);
    if (!parsed || typeof parsed !== 'object') {
      return NextResponse.json(
        {
          error:
            'AI 응답에서 JSON을 파싱하지 못했습니다. 다시 시도하거나 유형별 AI 프롬프트를 조정해 보세요.',
        },
        { status: 422 }
      );
    }

    const question_data: Record<string, unknown> = {
      순서: typeof parsed.순서 === 'number' ? parsed.순서 : nextNum,
      Source: typeof parsed.Source === 'string' ? parsed.Source : '',
      NumQuestion: typeof parsed.NumQuestion === 'number' ? parsed.NumQuestion : nextNum,
      Category: typeof parsed.Category === 'string' ? parsed.Category : type,
      Question: typeof parsed.Question === 'string' ? parsed.Question : '',
      Paragraph: paragraph,
      Options: typeof parsed.Options === 'string' ? parsed.Options : '',
      OptionType:
        typeof parsed.OptionType === 'string' && parsed.OptionType.trim()
          ? parsed.OptionType
          : optionTypeHint,
      CorrectAnswer: typeof parsed.CorrectAnswer === 'string' ? parsed.CorrectAnswer : '',
      Explanation: typeof parsed.Explanation === 'string' ? parsed.Explanation : '',
    };

    return NextResponse.json({
      ok: true,
      nextNum,
      question_data,
    });
  } catch (e) {
    console.error('generate-draft:', e);
    return NextResponse.json({ error: '초안 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
