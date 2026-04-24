import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { listExamsByFolder } from '@/lib/essay-exams-store';

export const dynamic = 'force-dynamic';

// 각 시험 HTML을 시험지 파트 / 답안지 파트로 분리
function splitHtml(html: string): { sheet: string; answer: string; css: string } {
  // CSS 추출
  const cssMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  const css = cssMatch ? cssMatch[1] : '';

  // body 내용 추출
  const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
  const body = bodyMatch ? bodyMatch[1] : html;

  const BREAK = '<div class="page-break"></div>';
  const breakIdx = body.indexOf(BREAK);

  if (breakIdx === -1) {
    return { sheet: body.trim(), answer: '', css };
  }

  const sheet = body.slice(0, breakIdx).trim();
  const answer = body.slice(breakIdx + BREAK.length).trim();
  return { sheet, answer, css };
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const folder = request.nextUrl.searchParams.get('folder') ?? '기본';

  try {
    const exams = await listExamsByFolder(folder);

    if (exams.length === 0) {
      return NextResponse.json({ error: '해당 폴더에 문제가 없습니다.' }, { status: 404 });
    }

    // CSS는 첫 번째 시험에서 추출
    const parts = exams.map(e => splitHtml(String(e.html ?? '')));
    const css = parts[0]?.css ?? '';

    // 시험지 파트: 각 시험지를 page-break로 구분
    const sheetSections = parts.map((p, i) => {
      const exam = exams[i];
      const title = exam.title || exam.textbook || `문제 ${i + 1}`;
      // 시험지 앞에 문제 번호 라벨 추가
      const label = `<div style="font-family:'Noto Sans CJK KR',sans-serif;font-size:8pt;color:#888;margin-bottom:4pt;padding-bottom:2pt;border-bottom:0.3pt solid #ccc;">
        [${i + 1}번 문제] ${title}
      </div>`;
      return label + p.sheet;
    });

    // 답안지 파트: 각 답안지 앞에 구분 헤더 추가
    const answerSections = parts
      .map((p, i) => {
        if (!p.answer) return null;
        const exam = exams[i];
        const title = exam.title || exam.textbook || `문제 ${i + 1}`;
        const header = `<div style="font-family:'Noto Sans CJK KR',sans-serif;font-size:8pt;color:#888;margin-bottom:4pt;margin-top:${i === 0 ? '0' : '12pt'};padding-bottom:2pt;border-bottom:0.3pt solid #ccc;">
          [${i + 1}번 문제] ${title}
        </div>`;
        return header + p.answer;
      })
      .filter(Boolean);

    // 합친 HTML 조립
    // 구조: 시험지1 | break | 시험지2 | break | ... | break | 답안지 전체
    const sheetsHtml = sheetSections.join('\n<div class="page-break"></div>\n');
    const answersHtml = answerSections.join('\n<div style="margin-top:16pt;border-top:0.5pt solid #ddd;padding-top:8pt;"></div>\n');

    const combinedHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
${css}
/* 폴더 출력 전용 — 답안 구분선 */
.folder-answer-divider { border-top: 0.5pt solid #ddd; margin: 12pt 0 8pt; }
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
