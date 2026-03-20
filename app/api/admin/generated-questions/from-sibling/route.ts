import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { extractJsonObject } from '@/lib/llm-json';

function serialize(doc: Record<string, unknown>) {
  const { _id, passage_id, ...rest } = doc;
  return {
    ...rest,
    _id: String(_id),
    passage_id: passage_id ? String(passage_id) : null,
    created_at: doc.created_at ?? null,
    updated_at: doc.updated_at ?? null,
  };
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : '';
    const mode = body.mode === 'ai' ? 'ai' : 'blank';
    const userHint = typeof body.userHint === 'string' ? body.userHint.trim().slice(0, 2000) : '';
    const typePrompt =
      typeof body.typePrompt === 'string' ? body.typePrompt.trim().slice(0, 12000) : '';

    if (!sourceId || !ObjectId.isValid(sourceId)) {
      return NextResponse.json({ error: '유효한 sourceId(원본 문서 _id)가 필요합니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const src = await col.findOne({ _id: new ObjectId(sourceId) });
    if (!src) {
      return NextResponse.json({ error: '원본 문서를 찾을 수 없습니다.' }, { status: 404 });
    }

    const passageId = src.passage_id;
    if (!passageId || !(passageId instanceof ObjectId)) {
      return NextResponse.json(
        { error: '원본에 passage_id가 없으면 같은 지문으로 복제할 수 없습니다.' },
        { status: 400 }
      );
    }

    const textbook = String(src.textbook ?? '').trim();
    const source = String(src.source ?? '').trim();
    const type = String(src.type ?? '').trim();
    const option_type = String(src.option_type ?? 'English').trim() || 'English';

    if (!textbook || !source || !type) {
      return NextResponse.json({ error: '원본의 교재·출처·유형이 비어 있으면 복제할 수 없습니다.' }, { status: 400 });
    }

    const srcQd =
      src.question_data && typeof src.question_data === 'object' && !Array.isArray(src.question_data)
        ? (src.question_data as Record<string, unknown>)
        : {};
    const paragraph = typeof srcQd.Paragraph === 'string' ? srcQd.Paragraph : '';

    const maxAgg = await col
      .aggregate<{ m: number | null }>([
        {
          $match: {
            textbook,
            passage_id: passageId,
            source,
            type,
          },
        },
        { $group: { _id: null, m: { $max: '$question_data.NumQuestion' } } },
      ])
      .toArray();
    const prevMax = typeof maxAgg[0]?.m === 'number' && Number.isFinite(maxAgg[0].m) ? maxAgg[0].m : 0;
    const nextNum = prevMax + 1;

    const now = new Date();
    let question_data: Record<string, unknown>;

    if (mode === 'blank') {
      question_data = {
        순서: nextNum,
        Source: typeof srcQd.Source === 'string' ? srcQd.Source : '',
        NumQuestion: nextNum,
        Category: typeof srcQd.Category === 'string' ? srcQd.Category : '',
        Question: '',
        Paragraph: paragraph,
        Options: '',
        OptionType: typeof srcQd.OptionType === 'string' ? srcQd.OptionType : 'English',
        CorrectAnswer: '',
        Explanation: '',
      };
    } else {
      if (!paragraph.trim()) {
        return NextResponse.json(
          { error: '원본 지문(Paragraph)이 비어 있으면 AI 초안을 만들 수 없습니다.' },
          { status: 400 }
        );
      }
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

키: 순서(number), Source(string, 보통 빈 문자열), NumQuestion(number), Category(string), Question(string, 발문), Paragraph(string), Options(string), OptionType(string), CorrectAnswer(string, 1~5 또는 ①~⑤), Explanation(string, 한국어 해설)

공통 규칙:
1) Paragraph: 지문을 입력과 동일하게 복사하되, 밑줄이 필요한 부분은 반드시 <u>...</u> HTML 태그로 감싸세요. 밑줄이 없으면 문제와 직결되는 핵심 구문에 <u>를 적용하세요.
2) Options: 반드시 영어로만 작성. ①②③④⑤ 보기 각 줄은 모두 영어 문장. 한글 선택지 금지.
3) OptionType: 항상 "English".
4) NumQuestion과 순서는 ${nextNum}.

유형별 규칙:
- 함의(함축의미): Paragraph에서 함축적 의미가 담긴 구절을 <u>...</u>로 감싸고, Question은 "밑줄 친 부분이 다음 글에서 의미하는 바로 가장 적절한 것은?" 형식으로 작성. 정답은 밑줄 부분의 함축적 의미와 일치하는 보기 하나, 오답은 그럴듯하지만 지문과 맞지 않는 내용. 밑줄 부분이 소문자로 시작하면 모든 선택지도 소문자로 시작, 대문자로 시작하면 선택지도 대문자로 시작. 고등학교 수준 어휘·표현 사용.
- 주제·제목·주장·일치·불일치·빈칸·요약·어법·순서·삽입: 수능/모의고사 해당 유형 발문 형식에 맞게 Question 작성.`;
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
          { error: 'AI 응답에서 JSON을 파싱하지 못했습니다. 다시 시도하거나 빈 양식으로 추가해 주세요.' },
          { status: 422 }
        );
      }
      const parsedParagraph =
        typeof parsed.Paragraph === 'string' && parsed.Paragraph.trim()
          ? parsed.Paragraph.trim()
          : paragraph;
      let questionText = typeof parsed.Question === 'string' ? parsed.Question : '';
      if (type === '함의') {
        const uMatch = parsedParagraph.match(/<u>([\s\S]*?)<\/u>/i);
        const underlinedText = uMatch ? uMatch[1].trim() : '';
        if (underlinedText) {
          questionText = `밑줄 친 "${underlinedText}" 표현이 다음 글에서 의미하는 바로 가장 적절한 것은?`;
        }
      }
      question_data = {
        순서: typeof parsed.순서 === 'number' ? parsed.순서 : nextNum,
        Source: typeof parsed.Source === 'string' ? parsed.Source : '',
        NumQuestion: typeof parsed.NumQuestion === 'number' ? parsed.NumQuestion : nextNum,
        Category: typeof parsed.Category === 'string' ? parsed.Category : String(srcQd.Category ?? ''),
        Question: questionText,
        Paragraph: parsedParagraph,
        Options: typeof parsed.Options === 'string' ? parsed.Options : '',
        OptionType: typeof parsed.OptionType === 'string' ? parsed.OptionType : 'English',
        CorrectAnswer: typeof parsed.CorrectAnswer === 'string' ? parsed.CorrectAnswer : '',
        Explanation: typeof parsed.Explanation === 'string' ? parsed.Explanation : '',
      };
    }

    const doc = {
      textbook,
      passage_id: passageId,
      source,
      type,
      option_type,
      question_data,
      status: mode === 'ai' ? '대기' : '대기',
      error_msg: null as string | null,
      created_at: now,
      updated_at: now,
    };

    const r = await col.insertOne(doc);
    const inserted = await col.findOne({ _id: r.insertedId });
    return NextResponse.json({
      ok: true,
      item: inserted ? serialize(inserted as Record<string, unknown>) : null,
      mode,
    });
  } catch (e) {
    console.error('from-sibling:', e);
    return NextResponse.json({ error: '복제·생성에 실패했습니다.' }, { status: 500 });
  }
}
