import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, col, type VipSchoolExam } from '@/lib/vip-db';
import { getDropboxTempLink } from '@/lib/dropbox';

const SYSTEM_PROMPT = `당신은 한국 고등학교 영어 내신 시험지를 분석하는 전문가입니다.
시험지 PDF를 보고 아래 JSON 형식으로만 응답하세요. 다른 설명 없이 JSON만 출력하세요.

추출 항목:
- objectiveCount: 객관식 문항 수 (숫자)
- subjectiveCount: 주관식/서술형 문항 수 (숫자)
- questions: 각 문항 정보 (문항 번호 → 정보)
  - questionType: 문항 유형 (아래 목록 참고)
  - score: 배점 (숫자, 없으면 0)
  - questionText: 문항 핵심 내용 또는 지문 첫 줄 (한 줄 요약, 없으면 빈 문자열)

객관식 유형 목록: 주제, 제목, 요지, 빈칸, 순서, 삽입, 연결사, 지칭추론, 어법, 어휘, 요약, 내용일치, 내용불일치, 심경, 함의, 글의목적, 장문, 기타
주관식 유형 목록: 서술형, 영작, 요약서술, 기타

응답 형식:
{
  "objectiveCount": 25,
  "subjectiveCount": 5,
  "questions": {
    "1": { "questionType": "어법", "score": 2, "questionText": "" },
    "2": { "questionType": "빈칸", "score": 3, "questionText": "" }
  }
}

주의:
- 배점이 명시된 경우 정확히 추출
- 문항 유형이 불분명하면 "기타" 사용
- 주관식은 마지막 번호들(객관식 이후)에 해당
- JSON 이외 어떤 텍스트도 출력하지 마세요`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI 분석 기능을 사용할 수 없습니다.' }, { status: 503 });
  }

  const db = await getVipDb();
  const exam = await col<VipSchoolExam>(db, 'schoolExams').findOne({
    _id: new ObjectId(id),
    userId: new ObjectId(auth.userId),
  });

  if (!exam) {
    return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 });
  }

  if (!exam.pdfPath) {
    return NextResponse.json({ error: '시험지 PDF를 먼저 업로드해주세요.' }, { status: 400 });
  }

  // 1. Dropbox 임시 링크 생성 후 PDF 다운로드
  let pdfBuffer: Buffer;
  try {
    const tempUrl = await getDropboxTempLink(exam.pdfPath);
    const pdfRes = await fetch(tempUrl);
    if (!pdfRes.ok) throw new Error(`PDF 다운로드 실패: ${pdfRes.status}`);
    const arrayBuf = await pdfRes.arrayBuffer();
    pdfBuffer = Buffer.from(arrayBuf);
  } catch (err) {
    console.error('PDF 다운로드 오류:', err);
    return NextResponse.json({ error: 'PDF를 불러올 수 없습니다.' }, { status: 500 });
  }

  // 2. Claude에 PDF 전송하여 분석
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const userMsg: MessageParam = {
      role: 'user',
      content: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: pdfBuffer.toString('base64'),
          },
        } as unknown as Anthropic.TextBlockParam,
        {
          type: 'text',
          text: '이 시험지를 분석해서 문항 수, 문항 유형, 배점을 JSON 형식으로 추출해주세요. 객관식과 주관식을 구분하고 각 문항의 유형과 배점을 정확히 파악해주세요.',
        },
      ],
    };

    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [userMsg],
    });

    const rawText = message.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('');

    // JSON 파싱
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'AI 응답을 파싱할 수 없습니다.', raw: rawText }, { status: 500 });
    }

    const result = JSON.parse(jsonMatch[0]) as {
      objectiveCount: number;
      subjectiveCount: number;
      questions: Record<string, { questionType: string; score: number; questionText: string }>;
    };

    return NextResponse.json({ ok: true, analysis: result });
  } catch (err) {
    console.error('Claude PDF 분석 오류:', err);
    const msg = err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
