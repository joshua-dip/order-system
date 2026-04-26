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

    const sheetSections = parts.map((p, i) => {
      const exam = exams[i];
      const title = exam.title || exam.textbook || `문제 ${i + 1}`;
      const label = `<div style="font-family:'Noto Sans CJK KR',sans-serif;font-size:8pt;color:#888;margin-bottom:4pt;padding-bottom:2pt;border-bottom:0.3pt solid #ccc;">
        [${i + 1}/${exams.length}] ${title}
      </div>`;
      return label + p.sheet;
    });

    const answerSections = parts
      .map((p, i) => {
        if (!p.answer) return null;
        const exam = exams[i];
        const title = exam.title || exam.textbook || `문제 ${i + 1}`;
        const header = `<div style="font-family:'Noto Sans CJK KR',sans-serif;font-size:8pt;color:#888;margin-bottom:4pt;margin-top:${i === 0 ? '0' : '12pt'};padding-bottom:2pt;border-bottom:0.3pt solid #ccc;">
          [${i + 1}/${exams.length}] ${title}
        </div>`;
        return header + p.answer;
      })
      .filter(Boolean);

    const sheetsHtml = sheetSections.join('\n<div class="page-break"></div>\n');
    const answersHtml = answerSections.join('\n<div style="margin-top:16pt;border-top:0.5pt solid #ddd;padding-top:8pt;"></div>\n');

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
