import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import {
  checkContentIntegrity,
  summarizeAnswerDistribution,
} from '@/lib/content-integrity-validation';

const MAX_RESULTS = 500;

/**
 * 콘텐츠 정합 검증 — 기존 검증 버튼들이 다루지 않는 빈틈 모음.
 *
 *   - 해설 선언 정답(「정답은 ③」 등) ↔ CorrectAnswer 불일치
 *   - 영어 전용 유형(주제·제목·함의·일치·불일치·빈칸·요약·어휘)의 한글 선택지 — option_type=English 인 경우만 (option_type=Korean 은 의도적 한글 버전이라 정상, 주장 제외)
 *   - 함의 Paragraph 밑줄(<u>) 누락
 *   - 삽입·삽입-고난도·무관한문장 본문 ①~⑤ 마커 수 ≠ 5
 *   - 어법-고난도 ①~⑤·밑줄 5쌍 구조 깨짐
 *   - Paragraph/Question 누락 · 'API' 토큰 누출
 *   - source 가 textbook 으로 시작하지 않음 (모의고사·수능·평가원 계열만 — 부교재는 강·번호 source 가 정상이라 제외)
 *   + 부가 집계: 교재×유형 정답 분포 편중(60% 이상)
 *
 * GET ?textbook=...&type=...
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';
  const typeFilter = request.nextUrl.searchParams.get('type')?.trim() || '';

  const match: Record<string, unknown> = { deleted_at: null };
  if (textbook) match.textbook = textbook;
  if (typeFilter) match.type = typeFilter;

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');

    const docs = await col
      .find(match)
      .project({
        _id: 1,
        textbook: 1,
        source: 1,
        type: 1,
        status: 1,
        'question_data.Paragraph': 1,
        'question_data.Question': 1,
        'question_data.Options': 1,
        'question_data.Explanation': 1,
        'question_data.CorrectAnswer': 1,
      })
      .sort({ textbook: 1, source: 1 })
      .toArray();

    type Item = {
      id: string;
      textbook: string;
      source: string;
      type: string;
      status: string;
      severity: string;
      rule: string;
      reason: string;
    };

    const items: Item[] = [];
    const breakdown: Record<string, number> = {};
    let totalMatched = 0;

    for (const d of docs) {
      const issues = checkContentIntegrity(d);
      if (issues.length === 0) continue;
      totalMatched += 1;
      for (const issue of issues) {
        breakdown[issue.rule] = (breakdown[issue.rule] ?? 0) + 1;
        if (items.length < MAX_RESULTS) {
          items.push({
            id: String(d._id),
            textbook: String(d.textbook ?? ''),
            source: String(d.source ?? ''),
            type: String(d.type ?? ''),
            status: String(d.status ?? ''),
            severity: issue.severity,
            rule: issue.rule,
            reason: issue.message,
          });
        }
      }
    }

    const answerDistribution = summarizeAnswerDistribution(docs);
    const skewedTypes = answerDistribution.filter((r) => r.skewedAnswer !== null);

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null, type: typeFilter || null },
      totalScanned: docs.length,
      totalMatched,
      breakdown,
      items,
      truncated: items.length >= MAX_RESULTS,
      answerDistribution,
      skewedTypes,
      note:
        '해설 선언 정답↔CorrectAnswer · 영어 전용 유형 한글 선택지(option_type=English 만, Korean 의도적 한글은 제외) · 함의 밑줄 · 삽입/무관 마커 · 어법-고난도 구조 · 누락/API · source 접두사(모의고사·수능·평가원 계열만). 분포 편중은 교재×유형 60% 이상일 때 표시.',
    });
  } catch (e) {
    console.error('validate/content-integrity:', e);
    return NextResponse.json(
      { error: '콘텐츠 정합 검증 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
