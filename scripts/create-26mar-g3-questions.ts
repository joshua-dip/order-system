/**
 * 26년 3월 고3 영어모의고사 — 부족 문항 채우기
 *
 * 1) 기존 underfilled 40건 (표준 유형)
 * 2) 무관한문장 3개 × 25지문 = 75건
 *
 * 지문 원문은 기존 '주제' 또는 '제목' 변형문의 Paragraph에서 추출.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });
config({ path: path.join(__dirname, '..', '.env.local') });

import { getDb } from '../lib/mongodb';
import { saveGeneratedQuestionToDb } from '../lib/variant-save-generated-question';
import {
  buildVariantDraftSystemPrompt,
  buildVariantDraftUserMessage,
  normalizeClaudeDraftJsonToQuestionData,
} from '../lib/admin-variant-draft-claude';
import { extractJsonObject } from '../lib/llm-json.js';
import { GRAMMAR_VARIANT_OPTIONS_FIXED } from '../lib/variant-draft-grammar-rules';

const TEXTBOOK = '26년 3월 고3 영어모의고사';
const CLAUDE = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── 부족 목록 (variant_get_shortage 결과) ──────────────────────────
const UNDERFILLED: { passageId: string; label: string; type: string; shortBy: number }[] = [
  { passageId: '69c3e6b546f58f933b6dcd28', label: '26년 3월 고3 영어모의고사 18번', type: '함의', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd2b', label: '26년 3월 고3 영어모의고사 21번', type: '어법', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd2c', label: '26년 3월 고3 영어모의고사 22번', type: '요약', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd2d', label: '26년 3월 고3 영어모의고사 23번', type: '일치', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd2d', label: '26년 3월 고3 영어모의고사 23번', type: '어법', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd2e', label: '26년 3월 고3 영어모의고사 24번', type: '요약', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd2f', label: '26년 3월 고3 영어모의고사 25번', type: '함의', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd30', label: '26년 3월 고3 영어모의고사 26번', type: '일치', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd31', label: '26년 3월 고3 영어모의고사 27번', type: '함의', shortBy: 2 },
  { passageId: '69c3e6b546f58f933b6dcd32', label: '26년 3월 고3 영어모의고사 28번', type: '함의', shortBy: 2 },
  { passageId: '69c3e6b546f58f933b6dcd32', label: '26년 3월 고3 영어모의고사 28번', type: '어법', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd33', label: '26년 3월 고3 영어모의고사 29번', type: '일치', shortBy: 2 },
  { passageId: '69c3e6b546f58f933b6dcd33', label: '26년 3월 고3 영어모의고사 29번', type: '요약', shortBy: 2 },
  { passageId: '69c3e6b546f58f933b6dcd34', label: '26년 3월 고3 영어모의고사 30번', type: '주제', shortBy: 2 },
  { passageId: '69c3e6b546f58f933b6dcd34', label: '26년 3월 고3 영어모의고사 30번', type: '주장', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd34', label: '26년 3월 고3 영어모의고사 30번', type: '요약', shortBy: 2 },
  { passageId: '69c3e6b546f58f933b6dcd34', label: '26년 3월 고3 영어모의고사 30번', type: '어법', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd35', label: '26년 3월 고3 영어모의고사 31번', type: '일치', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd35', label: '26년 3월 고3 영어모의고사 31번', type: '어법', shortBy: 2 },
  { passageId: '69c3e6b546f58f933b6dcd37', label: '26년 3월 고3 영어모의고사 33번', type: '주장', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd37', label: '26년 3월 고3 영어모의고사 33번', type: '함의', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd38', label: '26년 3월 고3 영어모의고사 34번', type: '요약', shortBy: 2 },
  { passageId: '69c3e6b546f58f933b6dcd38', label: '26년 3월 고3 영어모의고사 34번', type: '어법', shortBy: 2 },
  { passageId: '69c3e6b546f58f933b6dcd3a', label: '26년 3월 고3 영어모의고사 36번', type: '일치', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd3a', label: '26년 3월 고3 영어모의고사 36번', type: '불일치', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd3a', label: '26년 3월 고3 영어모의고사 36번', type: '어법', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd3c', label: '26년 3월 고3 영어모의고사 38번', type: '어법', shortBy: 2 },
  { passageId: '69c3e6b546f58f933b6dcd3e', label: '26년 3월 고3 영어모의고사 40번', type: '주장', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd3f', label: '26년 3월 고3 영어모의고사 41~42번', type: '주장', shortBy: 1 },
  { passageId: '69c3e6b546f58f933b6dcd40', label: '26년 3월 고3 영어모의고사 43~45번', type: '요약', shortBy: 1 },
];

// ── 전체 25개 지문 (무관한문장용) ─────────────────────────────────
const ALL_PASSAGES: { passageId: string; label: string }[] = [
  { passageId: '69c3e6b546f58f933b6dcd28', label: '26년 3월 고3 영어모의고사 18번' },
  { passageId: '69c3e6b546f58f933b6dcd29', label: '26년 3월 고3 영어모의고사 19번' },
  { passageId: '69c3e6b546f58f933b6dcd2a', label: '26년 3월 고3 영어모의고사 20번' },
  { passageId: '69c3e6b546f58f933b6dcd2b', label: '26년 3월 고3 영어모의고사 21번' },
  { passageId: '69c3e6b546f58f933b6dcd2c', label: '26년 3월 고3 영어모의고사 22번' },
  { passageId: '69c3e6b546f58f933b6dcd2d', label: '26년 3월 고3 영어모의고사 23번' },
  { passageId: '69c3e6b546f58f933b6dcd2e', label: '26년 3월 고3 영어모의고사 24번' },
  { passageId: '69c3e6b546f58f933b6dcd2f', label: '26년 3월 고3 영어모의고사 25번' },
  { passageId: '69c3e6b546f58f933b6dcd30', label: '26년 3월 고3 영어모의고사 26번' },
  { passageId: '69c3e6b546f58f933b6dcd31', label: '26년 3월 고3 영어모의고사 27번' },
  { passageId: '69c3e6b546f58f933b6dcd32', label: '26년 3월 고3 영어모의고사 28번' },
  { passageId: '69c3e6b546f58f933b6dcd33', label: '26년 3월 고3 영어모의고사 29번' },
  { passageId: '69c3e6b546f58f933b6dcd34', label: '26년 3월 고3 영어모의고사 30번' },
  { passageId: '69c3e6b546f58f933b6dcd35', label: '26년 3월 고3 영어모의고사 31번' },
  { passageId: '69c3e6b546f58f933b6dcd36', label: '26년 3월 고3 영어모의고사 32번' },
  { passageId: '69c3e6b546f58f933b6dcd37', label: '26년 3월 고3 영어모의고사 33번' },
  { passageId: '69c3e6b546f58f933b6dcd38', label: '26년 3월 고3 영어모의고사 34번' },
  { passageId: '69c3e6b546f58f933b6dcd39', label: '26년 3월 고3 영어모의고사 35번' },
  { passageId: '69c3e6b546f58f933b6dcd3a', label: '26년 3월 고3 영어모의고사 36번' },
  { passageId: '69c3e6b546f58f933b6dcd3b', label: '26년 3월 고3 영어모의고사 37번' },
  { passageId: '69c3e6b546f58f933b6dcd3c', label: '26년 3월 고3 영어모의고사 38번' },
  { passageId: '69c3e6b546f58f933b6dcd3d', label: '26년 3월 고3 영어모의고사 39번' },
  { passageId: '69c3e6b546f58f933b6dcd3e', label: '26년 3월 고3 영어모의고사 40번' },
  { passageId: '69c3e6b546f58f933b6dcd3f', label: '26년 3월 고3 영어모의고사 41~42번' },
  { passageId: '69c3e6b546f58f933b6dcd40', label: '26년 3월 고3 영어모의고사 43~45번' },
];

// ── 지문 원문 캐시 (passage_id → clean paragraph text) ─────────────
const passageCache = new Map<string, string>();

/** 기존 변형문에서 지문 원문 추출 (주제 > 주장 > 제목 > 일치 순으로 시도) */
async function getPassageText(passageId: string, label: string): Promise<string> {
  if (passageCache.has(passageId)) return passageCache.get(passageId)!;

  const db = await getDb('gomijoshua');
  const cleanTypes = ['주제', '주장', '제목', '일치', '불일치', '빈칸'];
  for (const t of cleanTypes) {
    const q = await db.collection('generated_questions').findOne({
      textbook: TEXTBOOK, source: label, type: t,
    });
    const para = String((q?.question_data as any)?.Paragraph ?? '');
    if (para.length > 50 && !para.includes('<u>')) {
      passageCache.set(passageId, para);
      return para;
    }
  }
  // 함의·어법에서 <u> 제거 후 사용
  const q2 = await db.collection('generated_questions').findOne({
    textbook: TEXTBOOK, source: label,
  });
  const para2 = String((q2?.question_data as any)?.Paragraph ?? '').replace(/<[^>]+>/g, '');
  passageCache.set(passageId, para2);
  return para2;
}

/** Claude API로 문항 1개 생성 */
async function generateOne(
  paragraph: string,
  type: string,
  nextNum: number,
): Promise<Record<string, unknown> | null> {
  const systemPrompt = buildVariantDraftSystemPrompt(nextNum);
  const userMsg = buildVariantDraftUserMessage({ paragraph, type, nextNum, difficulty: '중' });

  try {
    const msg = await CLAUDE.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    });
    const raw = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const parsed = extractJsonObject(raw);
    if (!parsed) return null;
    return normalizeClaudeDraftJsonToQuestionData(parsed, { paragraph, type, nextNum });
  } catch (e) {
    console.error('    API error:', (e as Error).message.slice(0, 80));
    return null;
  }
}

async function saveOne(
  passageId: string,
  label: string,
  type: string,
  question_data: Record<string, unknown>,
): Promise<boolean> {
  const db = await getDb('gomijoshua');
  const existingCount = await db.collection('generated_questions').countDocuments({
    textbook: TEXTBOOK, source: label, type,
  });
  const r = await saveGeneratedQuestionToDb({
    passage_id: passageId,
    textbook: TEXTBOOK,
    source: label,
    type,
    question_data: { ...question_data, 순서: existingCount + 1 },
    status: '완료',
    option_type: 'English',
    difficulty: '중',
  });
  return r.ok;
}

async function main() {
  let created = 0;
  let failed = 0;

  // ── Phase 1: 부족분 40건 ────────────────────────────────────────
  console.log('=== Phase 1: 부족분 40건 ===');
  for (const item of UNDERFILLED) {
    const paragraph = await getPassageText(item.passageId, item.label);
    if (!paragraph) {
      console.log(`  SKIP (지문없음): ${item.label} / ${item.type}`);
      failed += item.shortBy;
      continue;
    }
    for (let i = 0; i < item.shortBy; i++) {
      const db = await getDb('gomijoshua');
      const nextNum = await db.collection('generated_questions').countDocuments({
        textbook: TEXTBOOK, source: item.label, type: item.type,
      }) + 1 + i;

      const qd = await generateOne(paragraph, item.type, nextNum);
      if (!qd) {
        console.log(`  FAIL: ${item.label} / ${item.type} #${nextNum}`);
        failed++;
        continue;
      }
      const ok = await saveOne(item.passageId, item.label, item.type, qd);
      console.log(`  ${ok ? 'OK' : 'SAVE-FAIL'}: ${item.label} / ${item.type} #${nextNum}`);
      ok ? created++ : failed++;
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // ── Phase 2: 무관한문장 3개 × 25지문 ────────────────────────────
  console.log('\n=== Phase 2: 무관한문장 75건 ===');
  for (const p of ALL_PASSAGES) {
    const paragraph = await getPassageText(p.passageId, p.label);
    if (!paragraph) {
      console.log(`  SKIP (지문없음): ${p.label}`);
      failed += 3;
      continue;
    }
    for (let i = 0; i < 3; i++) {
      const db = await getDb('gomijoshua');
      const nextNum = await db.collection('generated_questions').countDocuments({
        textbook: TEXTBOOK, source: p.label, type: '무관한문장',
      }) + 1 + i;

      const qd = await generateOne(paragraph, '무관한문장', nextNum);
      if (!qd) {
        console.log(`  FAIL: ${p.label} / 무관한문장 #${nextNum}`);
        failed++;
        continue;
      }
      const ok = await saveOne(p.passageId, p.label, '무관한문장', qd);
      console.log(`  ${ok ? 'OK' : 'SAVE-FAIL'}: ${p.label} / 무관한문장 #${nextNum}`);
      ok ? created++ : failed++;
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  console.log(`\n완료: ${created}건 생성, ${failed}건 실패`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
