import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAdmin } from '@/lib/admin-auth';
import { essayGeneratorDifficultyAppendix } from '@/lib/essay-generator-difficulty-appendix';
import {
  ExamData,
  buildExamHtmlWithOverrides,
  readExamCss,
} from '@/lib/essay-exam-html';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

// ── POST 핸들러 ────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: {
    passage?: string;
    examTitle?: string;
    schoolName?: string;
    grade?: string;
    difficulty?: string;
    questionNumber?: string;
    examSubtitle?: string;
    totalPoints?: number;   // 없으면 Claude 자동 결정 (최대 10)
    targetSentences?: string[];
    /** 비우면 assets/exam_kit/generation_prompt.md 사용 */
    systemPrompt?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const {
    passage,
    examTitle = '영어 서·논술형 평가',
    schoolName = '',
    grade = '',
    difficulty = '고난도',
    questionNumber = '서·논술형 1',
    examSubtitle = '',
    totalPoints,          // undefined이면 Claude가 자동 결정
    targetSentences = [],
    systemPrompt: systemPromptOverride,
  } = body;

  if (!passage?.trim()) {
    return NextResponse.json({ error: '지문이 필요합니다.' }, { status: 400 });
  }

  const kitDir = path.join(process.cwd(), 'assets/exam_kit');
  const defaultSystem = fs.readFileSync(path.join(kitDir, 'generation_prompt.md'), 'utf-8');
  const systemPrompt =
    typeof systemPromptOverride === 'string' && systemPromptOverride.trim().length > 0
      ? systemPromptOverride.trim()
      : defaultSystem;

  let userMessage = `지문:\n${passage}\n\n난이도: ${difficulty}`;
  if (targetSentences.length > 0) {
    userMessage += `\n반드시 포함할 문장: ${JSON.stringify(targetSentences)}`;
  }
  userMessage += `\n문항 번호: ${questionNumber}`;
  if (examSubtitle) userMessage += `\n시험지 부제: ${examSubtitle}`;
  if (totalPoints != null) {
    userMessage += `\n총 배점: ${totalPoints} (최대 10점)`;
  } else {
    userMessage += `\n총 배점: 자동 결정 (최대 10점, 4점+3점 또는 6점+4점 등 난이도에 맞게)`;
  }

  const diffAppend = essayGeneratorDifficultyAppendix(difficulty);
  if (diffAppend) {
    userMessage += `\n\n---\n${diffAppend}`;
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    let rawText = (response.content[0] as { type: string; text: string }).text.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    }

    const rawData: ExamData = JSON.parse(rawText);
    /* 라우트는 기존 동작을 유지: title 만 덮어쓰고 subtitle 은 Claude 결과 그대로.
       (examSubtitle 은 Claude 프롬프트에만 전달됨) */
    const { data, html } = buildExamHtmlWithOverrides(
      rawData,
      { examTitle, schoolName, grade },
      readExamCss(),
    );

    return NextResponse.json({ data, html });
  } catch (err) {
    console.error('[essay-generator/generate]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '생성 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
