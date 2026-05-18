import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { listExamsByFolder, getEssayExam } from '@/lib/essay-exams-store';
import { readExamCss } from '@/lib/essay-exam-html';

export const dynamic = 'force-dynamic';

function splitHtml(html: string): { sheet: string; answer: string } {
  const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
  const body = bodyMatch ? bodyMatch[1] : html;

  const BREAK = '<div class="page-break"></div>';
  const breakIdx = body.indexOf(BREAK);
  if (breakIdx === -1) return { sheet: body.trim(), answer: '' };

  return {
    sheet: body.slice(0, breakIdx).trim(),
    answer: body.slice(breakIdx + BREAK.length).trim(),
  };
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const folder = request.nextUrl.searchParams.get('folder');
  const ids = request.nextUrl.searchParams.getAll('ids');

  try {
    let exams: Awaited<ReturnType<typeof listExamsByFolder>>;

    if (ids.length > 0) {
      const results = await Promise.all(
        ids.filter(id => ObjectId.isValid(id)).map(id => getEssayExam(id)),
      );
      exams = results.filter(
        (e): e is NonNullable<typeof e> =>
          e != null && !e.isPlaceholder && typeof e.html === 'string' && e.html.length > 0,
      );
    } else {
      const allExams = await listExamsByFolder(folder ?? '기본');
      exams = allExams.filter(
        (e) => !e.isPlaceholder && typeof e.html === 'string' && e.html.length > 0,
      );
    }

    if (exams.length === 0) {
      return NextResponse.json({ error: '해당 폴더에 출력할 문제가 없습니다.' }, { status: 404 });
    }

    const css = readExamCss();
    const parts = exams.map((e) => splitHtml(String(e.html)));

    /* 각 문항의 자체 헤더(시험지/정답지 양쪽)가 이미 경계 역할을 하므로
       [i/n] title 부 라벨은 생략. */
    const sheetSections = parts.map(p => p.sheet);

    const answerSections = parts
      .map((p, i) => {
        if (!p.answer) return null;
        /* 두 번째 항목부터는 새 페이지로 분리 — answer-header (정답 및 해설 검정 바) 가
           이전 페이지 말미에 orphan 으로 남는 문제 방지 */
        const sep = i === 0 ? '' : '<div class="page-break"></div>';
        return sep + p.answer;
      })
      .filter(Boolean);

    const sheetsHtml = sheetSections.join('\n<div class="page-break"></div>\n');
    /* 답지 사이는 항목 map 안에서 이미 처리한 sep 만 사용 (조용한 join) */
    const answersHtml = answerSections.join('\n');

    const combinedHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
${css}
</style>
</head>
<body>
${sheetsHtml}
<div class="page-break"></div>
${answersHtml}
</body>
</html>`;

    return NextResponse.json({ html: combinedHtml, count: exams.length });
  } catch (e) {
    console.error('[folder-print]', e);
    return NextResponse.json({ error: '출력 생성 실패' }, { status: 500 });
  }
}
