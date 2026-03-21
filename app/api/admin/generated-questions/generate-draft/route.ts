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

키: 순서(number), Source(string, 보통 빈 문자열), NumQuestion(number), Category(string), Question(string, 발문), Paragraph(string), Options(string), OptionType(string), CorrectAnswer(string, 1~5 또는 ①~⑤), Explanation(string, 한국어 해설)

공통 규칙:
1) Paragraph: 지문을 입력과 동일하게 복사. 주제·제목·주장·일치·불일치 유형에서는 <u> 태그를 넣지 말고 원문 그대로 복사만 하세요. 함의(함축의미)·어법 등 밑줄이 필요한 유형에서만 해당 구절을 <u>...</u>로 감싸세요. 어법은 5개 부분을 "① <u>단어</u>" 형식(번호와 단어 사이 공백)으로 표시.
2) Options: 반드시 영어로만 작성. ①②③④⑤ 보기 각 줄은 모두 영어 문장. 한글 선택지 금지.
3) OptionType: 항상 "English".
4) NumQuestion과 순서는 ${nextNum}.

유형별 규칙:
- 함의(함축의미): Paragraph에서 함축적 의미가 담긴 구절을 <u>...</u>로 감싸고, Question은 "밑줄 친 부분이 다음 글에서 의미하는 바로 가장 적절한 것은?" 형식으로 작성. 정답은 밑줄 부분의 함축적 의미와 일치하는 보기 하나, 오답은 그럴듯하지만 지문과 맞지 않는 내용. 밑줄 부분이 소문자로 시작하면 모든 선택지도 소문자로 시작, 대문자로 시작하면 선택지도 대문자로 시작. 고등학교 수준 어휘·표현 사용.
- 주제: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "이 글의 주제로 가장 적절한 것은?", "이 글의 요지로 가장 적절한 것은?". 보기(Options) 규칙: 정답 1개+오답 4개, 각 8~12단어. 명사구(noun phrase) 형태로 작성(문장 X). reasons, roles, advantages, benefits, problems, ways, functions, effects, causes, difficulties, factors, policies, importance, impact, necessity, need, process 등 활용 가능. 지문 어휘 사용 가능하되 조동사 등 보조어는 피할 것. 정답은 소문자로 시작, 관사로 시작 금지. 오답은 지문과 어긋나거나 반대되는 내용. 고유명사·인명·책제목·우화·비유 이름을 주제로 삼지 말 것. MAIN IDEA·원리·개념에 집중하고, 예시·도구·비유 자체의 이름/라벨은 피할 것.
- 제목: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "이 글의 제목으로 가장 적절한 것은?", "위 글에 가장 잘 어울리는 제목은?". 보기 규칙: 정답 1개+오답 4개, 각 7~12단어. 뉴스 헤드라인 스타일로, 지문의 주제·핵심을 함축. 각 선택지는 대문자로 시작. 고유명사·인명·책제목·우화·비유 이름을 제목으로 쓰지 말 것. MAIN MESSAGE·CONCEPT에 집중, 예시나 도구 이름이 아닌 핵심 메시지로. 오답은 그럴듯하지만 틀린 제목(범위 어긋남·부적절). CEFR B1~C1 수준.
- 주장: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "이 글에서 글쓴이가 주장하는 바로 가장 적절한 것은?", "위 글의 필자의 주장과 일치하는 것은?". 보기 규칙: 정답 1개+오답 4개, 각 7~12단어. 필자가 전달하려는 핵심 메시지(사소한 세부 X). must, should, have to 등 조동사와 important, essential, significant, critical, vital, crucial, necessary, desirable, appropriate 등 형용사로 완전한 문장. you/he/she로 시작하지 말 것; dummy subject "it" 사용 가능. 구체적 예시·우화·스토리·비유를 이름으로 언급하지 말 것. 원리·교훈에 집중, 예시 자체가 아닌. 정답은 지문의 핵심 주장과 일치, 오답은 반대 주장 또는 지문에 없는 내용. CEFR B1~C1.
- 일치: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "다음 글의 내용과 일치하는 것은?", "위 글의 내용과 일치하는 것은?". 보기 규칙: 정답 1개+오답 4개, 각 8~15단어. 장소·인명·작품명 등은 원문 그대로. 직역 금지, 의역(paraphrasing) 필수. 대명사(you, your, he, his, she, her, they, their, it, its) 사용 금지. 한 문장에서 유도하거나 여러 문장을 합쳐 한 보기로 가능. 명령형 문장 피할 것. 정답은 지문과 의미적으로 동일한 한 보기, 오답은 지문과 다른 내용 또는 일부만 맞는 문장. CEFR B1~C1.
- 불일치: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "다음 글의 내용과 일치하지 않는 것은?", "위 글의 내용과 일치하지 않는 것은?". 보기 규칙: 정답 1개(지문과 다른 내용)+오답 4개(지문과 일치하는 내용). 각 8~15단어. 장소·인명·작품명은 원문 그대로. 의역 필수, 대명사 금지, 명령형 피할 것(일치 유형과 동일). 정답은 지문에 없는 내용이거나 지문과 반대/틀린 한 보기, 오답은 지문과 일치하는 문장. CEFR B1~C1.
- 어법: Question은 반드시 "다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?"으로 작성. Paragraph는 원문 전체를 유지하되, 정확히 5개 부분만 밑줄·번호 표시. 밑줄 표시 형식: 동그라미 번호와 단어 사이 한 칸 띄어쓰기 필수, 번호는 밑줄 밖. 올바른 형식 예: ① <u>overlooking</u> / 잘못된 형식: <u>①overlooking</u>. 5개 부분은 문장 곳곳에 자연스럽게 분산. 5개 중 정확히 1개만 어법상 틀린 형태로 두고 나머지 4개는 올바른 형태. CorrectAnswer는 어법상 틀린 번호 하나(①~⑤). Options는 ①②③④⑤ 각 한 줄로 해당 번호의 밑줄 친 단어/구문만 영어로 나열. 어법 오류 후보: 관계사/접속사 오류(that/which/what/where, 불필요한 관계사, because vs because of), 준동사 오류(to부정사/동명사 병렬, 목적격보어·사역/지각동사 뒤 형태), 시제/조동사/동사형(시제 불일치, 조동사 뒤 원형, 수동태), 수 일치(주어-동사, 단수/복수), 분사/형용사(현재/과거분사 혼동), 병렬구조(품사·형태 불일치), 대명사/참조(지칭 불일치). Explanation은 틀린 부분의 번호로 시작해 해당 어법 오류 이유를 한국어로 설명.
- 순서(글의순서): Question은 "주어진 글 다음에 이어질 글의 순서로 가장 적절한 것을 고르시오."로 작성. Paragraph는 (1) 맨 위에 주어진 문장(첫 문장) 한 줄, (2) 빈 줄 또는 구분 후 (A), (B), (C) 세 블록을 나열. 각 블록은 여러 문장으로 구성되며, (A)-(B)-(C)의 올바른 순서를 뒤섞어 제시(예: (B)-(A)-(C), (C)-(B)-(A) 등). 블록 구분은 줄바꿈 또는 ### 사용. Options는 반드시 5개: ① (A)-(C)-(B), ② (B)-(A)-(C), ③ (B)-(C)-(A), ④ (C)-(A)-(B), ⑤ (C)-(B)-(A) 형식으로 한 줄씩. CorrectAnswer는 올바른 순서에 해당하는 ①~⑤ 중 하나. Explanation은 "① 가 정답입니다."(또는 해당 번호)로 시작하고, (A)(B)(C) 각 블록의 핵심·흐름과 왜 그 순서인지 논리적으로 설명한 뒤 "논리 흐름 요약:" 한 문장으로 마침. Paragraph에 <u> 태그 사용하지 말 것.
- 삽입(문장삽입): Question은 "글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오."로 작성. Paragraph는 (1) 맨 위에 삽입할 문장(주어진 문장) 한 줄, (2) 구분 후 본문. 본문에는 삽입 가능한 위치 5곳을 ①②③④⑤로 표시해 문장 사이에 배치(예: ... ① 다음 문장 ② ...). 즉 주어진 문장이 들어갈 수 있는 위치가 ①~⑤로 표시된 본문. CorrectAnswer는 주어진 문장이 들어가야 할 위치 번호 ①~⑤ 중 하나. Options는 ①~⑤ 각 한 줄(위치만 표시해도 됨). Explanation은 "① 가 정답입니다."(또는 해당 번호)로 시작하고, 주어진 문장의 핵심, 정답 위치 앞·뒤 문장과의 연결 고리, 삽입 시 흐름을 설명한 뒤 "논리 흐름 요약:" 한 문장으로 마침. Paragraph에 <u> 태그 사용하지 말 것.
- 빈칸·요약: 수능/모의고사 해당 유형 발문 형식에 맞게 Question 작성. 빈칸은 빈칸에 들어갈 말 고르기, 요약은 문장 삽입·요약문 완성 등.`;
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
    const question_data: Record<string, unknown> = {
      순서: typeof parsed.순서 === 'number' ? parsed.순서 : nextNum,
      Source: typeof parsed.Source === 'string' ? parsed.Source : '',
      NumQuestion: typeof parsed.NumQuestion === 'number' ? parsed.NumQuestion : nextNum,
      Category: typeof parsed.Category === 'string' ? parsed.Category : type,
      Question: questionText,
      Paragraph: parsedParagraph,
      Options: typeof parsed.Options === 'string' ? parsed.Options : '',
      OptionType: 'English',
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
