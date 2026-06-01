import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAdmin } from '@/lib/admin-auth';
import { findWordIndices } from '@/lib/syntax-analyzer-word-match';
import type { SvocSentenceData } from '@/lib/passage-analyzer-types';

export const maxDuration = 300;

/**
 * AI SVOC 분석 — 한 sentence 안에 등위접속절 등 여러 S+V 가 있으면 **모두** 반환.
 *
 * 응답 shape (per sentence):
 *  {
 *    sentenceIndex: number,
 *    clauses: SvocSentenceData[]   ← 절(clause) 별 분석 결과 배열
 *  }
 *
 * 단절 sentence 는 clauses.length === 1, 다절 sentence 는 length >= 2.
 * findWordIndices 로 word-index 변환 후 저장-호환 shape 으로 반환.
 */
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

정의:
- Subject / Verb: 필수. 동사구(구동사·조동사+본동사)는 한 덩어리로.
- Object: **목적어**만. 전치사 목적어는 동사의 목적어가 아니면 object에 넣지 않음.
- Complement: **주격보어(subject complement)** 또는 **목적격보어(object complement)** 만. 주어/목적어를 **명사·형용사적으로** 보충하는 성분.
- **전치사구·부사구**(장소·방향·속도·방식 등: around the ankle, a hundred miles an hour, in haste)는 보어가 아니라 부사적 수식이므로 **complement에 넣지 말고 null**. 문장에 목적어·보어가 없으면 object/complement는 null.

**다절(coordinated clauses) 처리** — 매우 중요:
- 한 sentence 안에 \`and / but / or\` 등으로 연결된 독립절이 여러 개면 **각 절을 별도 clause 로 분리**해 \`clauses\` 배열에 모두 담음.
- 예: "Paul's heart raced, and his hands grew sweaty."
  → clauses 2개: \`{subject:"Paul's heart", verb:"raced"}\`, \`{subject:"his hands", verb:"grew", complement:"sweaty"}\`
- 종속절(when/because/that 등)은 분리하지 말고 주절 하나만 분석.
- 단절(단일 S+V)이면 \`clauses\` 배열에 1개만 담음.

응답 형식 (JSON 배열):
[
  {
    "sentenceIndex": 0,
    "clauses": [
      {
        "subject": "원문의 주어 부분",
        "verb": "원문의 동사 부분",
        "object": "목적어 또는 null",
        "complement": "보어 또는 null"
      }
      // 다절이면 여기에 추가 절 객체
    ]
  }
]

조건: sentenceIndex 0부터, 텍스트는 원문과 정확히 일치, JSON만 출력.`,
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

    type RawClause = {
      subject?: string;
      verb?: string;
      object?: string | null;
      complement?: string | null;
    };
    type RawItem = {
      sentenceIndex: number;
      // 신규 shape
      clauses?: RawClause[];
      // 레거시 shape (단일 절) — 안전 fallback
      subject?: string;
      verb?: string;
      object?: string | null;
      complement?: string | null;
    };
    const rawResult = JSON.parse(jsonText) as RawItem[];

    /** sentence + raw clause → SvocSentenceData (word-index) */
    const buildClause = (sentence: string, c: RawClause): SvocSentenceData => {
      const subjectIdx = findWordIndices(sentence, c.subject || '');
      const verbIdx = findWordIndices(sentence, c.verb || '');
      const objectIdx = c.object
        ? findWordIndices(sentence, String(c.object))
        : { startWordIndex: -1, endWordIndex: -1 };
      const complementIdx = c.complement
        ? findWordIndices(sentence, String(c.complement))
        : { startWordIndex: -1, endWordIndex: -1 };
      return {
        subject: c.subject || '',
        verb: c.verb || '',
        object: c.object ?? null,
        complement: c.complement ?? null,
        subjectStart: subjectIdx.startWordIndex,
        subjectEnd: subjectIdx.endWordIndex,
        verbStart: verbIdx.startWordIndex,
        verbEnd: verbIdx.endWordIndex,
        objectStart: objectIdx.startWordIndex >= 0 ? objectIdx.startWordIndex : null,
        objectEnd: objectIdx.endWordIndex >= 0 ? objectIdx.endWordIndex : null,
        complementStart: complementIdx.startWordIndex >= 0 ? complementIdx.startWordIndex : null,
        complementEnd: complementIdx.endWordIndex >= 0 ? complementIdx.endWordIndex : null,
      };
    };

    const processed = rawResult.map((item) => {
      let idx = item.sentenceIndex;
      if (idx >= 1 && idx <= sentences.length && !sentences[idx] && sentences[idx - 1]) {
        idx = idx - 1;
      }
      const sentence = sentences[idx] || '';
      // 신규 shape (clauses array) 우선 — 없으면 레거시 단일 절을 [1개] 로 wrap.
      const rawClauses: RawClause[] = Array.isArray(item.clauses) && item.clauses.length > 0
        ? item.clauses
        : [{
            subject: item.subject,
            verb: item.verb,
            object: item.object,
            complement: item.complement,
          }];
      const clauses = rawClauses.map((c) => buildClause(sentence, c));
      return { sentenceIndex: idx, clauses };
    });

    console.log(`[syntax-analyzer] SVOC ${Date.now() - startTime}ms (sentences=${processed.length}, totalClauses=${processed.reduce((s, p) => s + p.clauses.length, 0)})`);
    return NextResponse.json({ success: true, result: processed });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error('[syntax-analyzer] analyze-svoc:', errMsg);
    return NextResponse.json({ error: 'SVOC 분석에 실패했습니다.' }, { status: 500 });
  }
}
