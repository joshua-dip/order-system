import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { extractJsonObject } from '@/lib/llm-json';
import { VARIANT_DRAFT_BLANK_AND_SUMMARY_RULES } from '@/lib/variant-draft-blank-summary-rules';
import {
  GRAMMAR_VARIANT_OPTIONS_FIXED,
  VARIANT_DRAFT_GRAMMAR_RULES,
} from '@/lib/variant-draft-grammar-rules';
import { normalizeMockVariantSourceLabel } from '@/lib/mock-variant-source-normalize';

export const maxDuration = 120;

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
    const source = normalizeMockVariantSourceLabel(textbook, String(src.source ?? '').trim());
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
        Source:
          typeof srcQd.Source === 'string'
            ? normalizeMockVariantSourceLabel(textbook, srcQd.Source)
            : '',
        NumQuestion: nextNum,
        Category: typeof srcQd.Category === 'string' ? srcQd.Category : '',
        Question: '',
        Paragraph: paragraph,
        Options: type.trim() === '어법' ? GRAMMAR_VARIANT_OPTIONS_FIXED : '',
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
1) Paragraph: 지문을 입력과 동일하게 유지. 주제·제목·주장·일치·불일치에서는 <u> 없이 원문 그대로 복사. 함의(함축의미)·어법은 지정 형식으로 <u>...</u> 사용. 빈칸 유형은 정답 구절 **한 곳만** 빼고 그 자리를 \`<u>_____</u>\` 밑줄로 두고 나머지는 원문과 동일. 어법은 5개 밑줄을 "③ <u>표현</u>" 형식(동그라미는 <u> 밖, 번호와 <u> 사이 공백 1칸)으로 표시. **지문 앞→뒤 읽는 순서가 곧 ①→②→③→④→⑤**(첫 밑줄=①, 건너뛰기 금지). 한 문장당 동그라미 1개. **어법의 Options**는 아래 어법 유형 규칙(번호만 \`①###②###③###④###⑤\`).
2) Options: **어법 제외** 유형은 반드시 영어로만(한글 선택지 금지). **5개 보기는 하나의 문자열**로, 보기 사이는 **오직 \`###\` 세 개**로만 구분. 예: \`① ... ### ② ... ### ③ ... ### ④ ... ### ⑤ ...\`. **어법**은 예외 — 아래 어법 규칙대로 \`①###②###③###④###⑤\`만.
3) OptionType: 항상 "English".
4) NumQuestion과 순서는 ${nextNum}.
5) Explanation(해설): **짧게**. 한국어 **450자 이하**(대략 4~7문장). 다른 보기·번호를 두고 **망설이다 결론을 바꾸는 서술**(실제로 맞다/틀리다가 엇갈리는 문장) 금지. CorrectAnswer와 **하나의 결론**만 명확히.

유형별 규칙:
- 함의(함축의미): Paragraph에서 함축적 의미가 담긴 구절을 <u>...</u>로 감싸고, Question은 "밑줄 친 부분이 다음 글에서 의미하는 바로 가장 적절한 것은?" 형식으로 작성. 정답은 밑줄 부분의 함축적 의미와 일치하는 보기 하나, 오답은 그럴듯하지만 지문과 맞지 않는 내용. 밑줄 부분이 소문자로 시작하면 모든 선택지도 소문자로 시작, 대문자로 시작하면 선택지도 대문자로 시작. 고등학교 수준 어휘·표현 사용.
- 주제: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "이 글의 주제로 가장 적절한 것은?", "이 글의 요지로 가장 적절한 것은?". 보기(Options) 규칙: 정답 1개+오답 4개, 각 8~12단어. 명사구(noun phrase) 형태로 작성(문장 X). reasons, roles, advantages, benefits, problems, ways, functions, effects, causes, difficulties, factors, policies, importance, impact, necessity, need, process 등 활용 가능. 지문 어휘 사용 가능하되 조동사 등 보조어는 피할 것. 정답은 소문자로 시작, 관사로 시작 금지. 오답은 지문과 어긋나거나 반대되는 내용. 고유명사·인명·책제목·우화·비유 이름을 주제로 삼지 말 것. MAIN IDEA·원리·개념에 집중하고, 예시·도구·비유 자체의 이름/라벨은 피할 것.
- 제목: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "이 글의 제목으로 가장 적절한 것은?", "위 글에 가장 잘 어울리는 제목은?". 보기 규칙: 정답 1개+오답 4개, 각 7~12단어. 뉴스 헤드라인 스타일로, 지문의 주제·핵심을 함축. 각 선택지는 대문자로 시작. 고유명사·인명·책제목·우화·비유 이름을 제목으로 쓰지 말 것. MAIN MESSAGE·CONCEPT에 집중, 예시나 도구 이름이 아닌 핵심 메시지로. 오답은 그럴듯하지만 틀린 제목(범위 어긋남·부적절). CEFR B1~C1 수준.
- 주장: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "이 글에서 글쓴이가 주장하는 바로 가장 적절한 것은?", "위 글의 필자의 주장과 일치하는 것은?". 보기 규칙: 정답 1개+오답 4개, 각 7~12단어. 필자가 전달하려는 핵심 메시지(사소한 세부 X). must, should, have to 등 조동사와 important, essential, significant, critical, vital, crucial, necessary, desirable, appropriate 등 형용사로 완전한 문장. you/he/she로 시작하지 말 것; dummy subject "it" 사용 가능. 구체적 예시·우화·스토리·비유를 이름으로 언급하지 말 것. 원리·교훈에 집중, 예시 자체가 아닌. 정답은 지문의 핵심 주장과 일치, 오답은 반대 주장 또는 지문에 없는 내용. CEFR B1~C1.
- 일치: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "다음 글의 내용과 일치하는 것은?", "위 글의 내용과 일치하는 것은?". 보기 규칙: 정답 1개+오답 4개, 각 8~15단어. 장소·인명·작품명 등은 원문 그대로. 직역 금지, 의역(paraphrasing) 필수. 대명사(you, your, he, his, she, her, they, their, it, its) 사용 금지. 한 문장에서 유도하거나 여러 문장을 합쳐 한 보기로 가능. 명령형 문장 피할 것. 정답은 지문과 의미적으로 동일한 한 보기, 오답은 지문과 다른 내용 또는 일부만 맞는 문장. CEFR B1~C1.
- 불일치: Paragraph에는 <u> 태그 사용하지 말 것(원문 그대로). Question 예: "다음 글의 내용과 일치하지 않는 것은?", "위 글의 내용과 일치하지 않는 것은?". 보기 규칙: 정답 1개(지문과 다른 내용)+오답 4개(지문과 일치하는 내용). 각 8~15단어. 장소·인명·작품명은 원문 그대로. 의역 필수, 대명사 금지, 명령형 피할 것(일치 유형과 동일). 정답은 지문에 없는 내용이거나 지문과 반대/틀린 한 보기, 오답은 지문과 일치하는 문장. CEFR B1~C1.
${VARIANT_DRAFT_GRAMMAR_RULES}
- 순서(글의순서): Question은 "주어진 글 다음에 이어질 글의 순서로 가장 적절한 것을 고르시오."로 작성. Paragraph는 (1) 맨 위에 주어진 문장(첫 문장) 한 줄, (2) 빈 줄 또는 구분 후 (A), (B), (C) 세 블록을 나열. 각 블록은 여러 문장으로 구성되며, (A)-(B)-(C)의 올바른 순서를 뒤섞어 제시(예: (B)-(A)-(C), (C)-(B)-(A) 등). 블록 구분은 줄바꿈 또는 ### 사용. Options는 반드시 5개를 **한 문자열**로, 보기 사이는 \`###\`만: \`① (A)-(C)-(B) ### ② (B)-(A)-(C) ### ③ (B)-(C)-(A) ### ④ (C)-(A)-(B) ### ⑤ (C)-(B)-(A)\` 형식. CorrectAnswer는 올바른 순서에 해당하는 ①~⑤ 중 하나. Explanation은 "① 가 정답입니다."로 시작, 흐름 설명은 압축하고 마지막에 "논리 흐름 요약:" 한 문장 — **전체 450자 이하**. Paragraph에 <u> 태그 사용하지 말 것.
- 삽입(문장삽입): Question은 "글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오."로 작성. Paragraph는 (1) 맨 위에 삽입할 문장(주어진 문장) 한 줄, (2) 구분 후 본문. 본문에는 삽입 가능한 위치 5곳을 ①②③④⑤로 표시해 문장 사이에 배치(예: ... ① 다음 문장 ② ...). 즉 주어진 문장이 들어갈 수 있는 위치가 ①~⑤로 표시된 본문. CorrectAnswer는 주어진 문장이 들어가야 할 위치 번호 ①~⑤ 중 하나. Options는 ①~⑤ **한 문자열·\`###\` 구분**(위치만 표시해도 됨). Explanation은 "① 가 정답입니다."로 시작, 연결 근거는 짧게, 마지막 "논리 흐름 요약:" 한 문장 — **전체 450자 이하**. Paragraph에 <u> 태그 사용하지 말 것.
${VARIANT_DRAFT_BLANK_AND_SUMMARY_RULES}`;
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
        Source:
          typeof parsed.Source === 'string'
            ? normalizeMockVariantSourceLabel(textbook, parsed.Source)
            : '',
        NumQuestion: typeof parsed.NumQuestion === 'number' ? parsed.NumQuestion : nextNum,
        Category: typeof parsed.Category === 'string' ? parsed.Category : String(srcQd.Category ?? ''),
        Question: questionText,
        Paragraph: parsedParagraph,
        Options: typeof parsed.Options === 'string' ? parsed.Options : '',
        OptionType: typeof parsed.OptionType === 'string' ? parsed.OptionType : 'English',
        CorrectAnswer: typeof parsed.CorrectAnswer === 'string' ? parsed.CorrectAnswer : '',
        Explanation: typeof parsed.Explanation === 'string' ? parsed.Explanation : '',
      };
      if (type.trim() === '어법') {
        question_data.Options = GRAMMAR_VARIANT_OPTIONS_FIXED;
      }
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
