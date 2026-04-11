/**
 * 지금필수 고난도유형(2026) '상' 삽입 문제 해설 최신 형식으로 일괄 교체
 *
 * 기존(old) 템플릿 패턴: "바로 앞 문장에서...논의를 확장하므로..."
 * 신규(new) 형식:
 *   ① "X이 정답입니다."로 시작
 *   ② 글 전체 논리 흐름 요약 (2~3문장)
 *   ③ 삽입 위치 근거 (앞 문장 내용 + 지시어/연결어 + 뒤 문장 연결)
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });
config({ path: path.join(__dirname, '..', '.env.local') });

import { getDb } from '../lib/mongodb';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TEXTBOOK = '지금필수 고난도유형(2026)';

/** 기존 템플릿 해설인지 감지 */
function isOldFormat(explanation: string): boolean {
  return (
    explanation.includes('바로 앞 문장에서') &&
    explanation.includes('논의를 확장하므로')
  );
}

/** Paragraph에서 생성 문장과 지문(마커 포함) 분리 */
function parseParagraph(raw: string): { generatedSentence: string; passageWithMarkers: string } | null {
  const sepIdx = raw.indexOf('###');
  if (sepIdx < 0) return null;
  return {
    generatedSentence: raw.slice(0, sepIdx).replace(/<[^>]+>/g, '').trim(),
    passageWithMarkers: raw.slice(sepIdx + 3).replace(/<[^>]+>/g, '').trim(),
  };
}

/** Claude API로 새 해설 생성 */
async function generateNewExplanation(
  generatedSentence: string,
  passageWithMarkers: string,
  correctAnswer: string,
): Promise<string> {
  const prompt = `
당신은 수능 영어 문장삽입(난이도 '상') 문제의 해설 전문가입니다.

아래 정보를 바탕으로 한국어 해설을 작성하세요.

【주어진 문장 (삽입할 문장)】
${generatedSentence}

【지문 (①②③④⑤ 마커는 삽입 후보 위치)】
${passageWithMarkers}

【정답】${correctAnswer}

【해설 작성 규칙】
1. "${correctAnswer}이 정답입니다."로 시작 (단, ①이면 "①이", ②이면 "②이" 등 조사 자동 처리)
2. 글 전체 논리 흐름 요약: 이 지문이 어떤 논리 구조로 전개되는지 2~3문장으로 설명 (예: "이 글은 A를 소개한 뒤, B라는 원인을 분석하고, C라는 결론으로 이어진다.")
3. 삽입 위치 근거: 정답 위치 앞 문장이 어떤 내용을 다루고, 주어진 문장의 지시어/연결어(this, such, however 등)가 구체적으로 무엇을 가리키며, 삽입 후 뒤 문장과 어떻게 자연스럽게 이어지는지 설명
4. 전체 600자 이하 (한국어 기준)
5. 순수 텍스트만 출력 — 마크다운·번호 목록·줄바꿈 절대 금지. 모든 내용을 한 문단으로 이어서 작성할 것.
`.trim();

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')
    .trim();

  return text;
}

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const docs = await col
    .find({ textbook: TEXTBOOK, difficulty: '상', type: '삽입' })
    .toArray();

  console.log(`총 ${docs.length}건 로드`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const qd = doc.question_data as Record<string, unknown> | undefined;
    if (!qd) { skipped++; continue; }

    const explanation = String(qd.Explanation ?? '');
    const source = String(doc.source ?? doc.source_key ?? '');

    // 이미 최신 형식이면 스킵
    if (!isOldFormat(explanation)) {
      console.log(`[${i + 1}/${docs.length}] SKIP (새 형식): ${source}`);
      skipped++;
      continue;
    }

    const paragraphRaw = String(qd.Paragraph ?? '');
    const correctAnswer = String(qd.CorrectAnswer ?? '');
    const parsed = parseParagraph(paragraphRaw);

    if (!parsed || !correctAnswer) {
      console.log(`[${i + 1}/${docs.length}] SKIP (파싱 실패): ${source}`);
      skipped++;
      continue;
    }

    try {
      const newExp = await generateNewExplanation(
        parsed.generatedSentence,
        parsed.passageWithMarkers,
        correctAnswer,
      );

      await col.updateOne(
        { _id: doc._id },
        { $set: { 'question_data.Explanation': newExp, updated_at: new Date() } },
      );

      console.log(`[${i + 1}/${docs.length}] OK: ${source} → ${newExp.slice(0, 60)}…`);
      updated++;

      // API rate limit 대비 짧은 딜레이
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`[${i + 1}/${docs.length}] ERROR: ${source} —`, (err as Error).message);
      failed++;
    }
  }

  console.log(`\n완료: ${updated}건 업데이트, ${skipped}건 스킵, ${failed}건 실패`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
