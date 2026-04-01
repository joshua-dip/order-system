import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageAnalyzerAnthropic } from '@/lib/passage-analyzer-claude';
import {
  generateByProblemTypeKey,
  PROBLEM_TYPE_KEYS,
  type ProblemTypeKey,
} from '@/lib/descriptive-blank-rearrange';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const claude = getPassageAnalyzerAnthropic();
  if ('error' in claude) {
    return NextResponse.json({ success: false, error: claude.error }, { status: 503 });
  }
  const { anthropic, model } = claude;

  try {
    const body = await request.json();
    const passageText = typeof body.passageText === 'string' ? body.passageText.trim() : '';
    const problemTypeKey = body.problemTypeKey as string;

    if (!passageText) {
      return NextResponse.json(
        { success: false, error: '지문(passageText)이 필요합니다.' },
        { status: 400 },
      );
    }

    if (!PROBLEM_TYPE_KEYS.includes(problemTypeKey as ProblemTypeKey)) {
      return NextResponse.json(
        { success: false, error: '유효하지 않은 problemTypeKey입니다.' },
        { status: 400 },
      );
    }

    const problems = await generateByProblemTypeKey(
      problemTypeKey as ProblemTypeKey,
      anthropic,
      model,
      passageText,
    );

    if (!problems.length) {
      return NextResponse.json({
        success: true,
        problems: [],
        message:
          '조건에 맞는 빈칸 후보를 찾지 못했습니다. 지문을 길게 하거나 문장 수를 늘려 다시 시도해 보세요.',
      });
    }

    return NextResponse.json({ success: true, problems });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '생성 중 오류가 발생했습니다.';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
