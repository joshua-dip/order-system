import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });
config({ path: path.join(__dirname, '..', '.env.local') });

import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../lib/mongodb';
import { saveGeneratedQuestionToDb } from '../lib/variant-save-generated-question';

const CLAUDE = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CIRCLED = ['①','②','③','④','⑤'];

function extractSentences(raw: string): string[] {
  return raw.replace(/[①②③④⑤]/g,'').replace(/<[^>]+>/g,'')
    .split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(s=>s.length>10);
}

function buildMarkedPassage(sentences: string[]): string {
  const parts: string[] = [];
  for (let i=0; i<sentences.length; i++) {
    if (i>0 && i<=5) parts.push(CIRCLED[i-1]);
    parts.push(sentences[i]);
  }
  if (sentences.length<=5) parts.push(CIRCLED[Math.min(sentences.length-1,4)]);
  return parts.join(' ');
}

async function main() {
  const db = await getDb('gomijoshua');
  const SOURCE = '26년 3월 고1 영어모의고사 40번';
  const TEXTBOOK = '26년 3월 고1 영어모의고사';

  const base = await db.collection('generated_questions').findOne({
    textbook: TEXTBOOK, type: '삽입', difficulty: '상', source: SOURCE,
  });
  if (!base) { console.log('기준 문항 없음'); process.exit(1); }

  const qd = base.question_data as Record<string,unknown>;
  const para = String(qd.Paragraph ?? '');
  const sepIdx = para.indexOf('###');
  const passageRaw = para.slice(sepIdx+3).replace(/<[^>]+>/g,'').trim();
  const sentences = extractSentences(passageRaw);
  const pos = 2;
  const correctCircle = CIRCLED[pos-1];
  const markedPassage = buildMarkedPassage(sentences);

  console.log('문장수:', sentences.length, '/ 목표위치:', correctCircle);

  const prompt = [
    'You are an expert at creating Korean English exam sentence insertion problems (difficulty: 상).',
    '',
    `Create ONE new bridge sentence for position ${correctCircle} in this passage:`,
    markedPassage,
    '',
    'Rules:',
    '1. Entirely new — no copying from the passage',
    `2. Must contain a demonstrative (this/such/these) or connector (however/therefore/consequently) pointing to the sentence before ${correctCircle}`,
    '3. 15-35 words, 1 sentence',
    '',
    'Then write a Korean explanation (해설):',
    `- Start: "${correctCircle}이 정답입니다."`,
    '- 글 전체 논리 흐름 요약 2~3문장',
    '- 삽입 위치 근거',
    '- Max 600 chars, no line breaks, no markdown',
    '',
    'Output valid JSON only:',
    '{"sentence":"...","explanation":"..."}',
  ].join('\n');

  const msg = await CLAUDE.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 900,
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = msg.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('');
  console.log('RAW output:', raw.slice(0, 400));

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) { console.log('JSON 파싱 실패'); process.exit(1); }
  const parsed = JSON.parse(jsonMatch[0]);

  const existingCount = await db.collection('generated_questions').countDocuments({
    textbook: TEXTBOOK, type: '삽입', difficulty: '상', source: SOURCE,
  });

  const paragraph = `${parsed.sentence}\n###\n${markedPassage}`;
  const r = await saveGeneratedQuestionToDb({
    passage_id: String(base.passage_id),
    textbook: TEXTBOOK,
    source: SOURCE,
    type: '삽입',
    question_data: {
      순서: existingCount + 1,
      Source: SOURCE,
      Category: '삽입',
      DifficultyLevel: '상',
      Question: '글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오.',
      Paragraph: paragraph,
      Options: CIRCLED.join('\n'),
      OptionType: 'English',
      CorrectAnswer: correctCircle,
      Explanation: parsed.explanation,
      GeneratedSentence: true,
    },
    status: '완료',
    option_type: 'English',
    difficulty: '상',
  });

  console.log('저장:', r.ok ? `OK (${r.inserted_id})` : (r as any).error);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
