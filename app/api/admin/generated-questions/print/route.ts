import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import {
  buildVariantPrintHtml,
  normalizeVariantPrintFormat,
  variantTypePrintName,
  type VariantPrintQuestion,
} from '@/lib/variant-print-html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * 코드로 고정한 인쇄 양식(B 경로) — `lib/variant-print-html.ts` 의 첫 호출자.
 *
 * 관리자 다운로드(A, download-pdf)와 달리 브라우저 인쇄를 전제로 한 HTML 을 돌려준다:
 * `<u>` 밑줄이 살아 있고, 문항이 페이지 중간에서 끊기지 않으며, 정답·해설은 별지다.
 * 회원별 저장 양식(`users.variantPrintFormat`)을 `loginId` 로 읽어 그대로 적용한다 —
 * 지금까지는 회원 상세에서 저장만 되고 아무 데서도 쓰이지 않았다
 * (docs/handoff/2026-09-09-변형문제-인쇄양식.md).
 *
 * 쿼리: 필터는 download-pdf 와 같게 받는다(textbook·type·types·difficulty·status·
 * passage_id·sources·free). 추가로
 *   - `loginId`   회원 양식을 읽을 계정 (없으면 기본 양식)
 *   - `brand` · `answers=0|1` · `split=0|1` · `hardSuffix=0|1`  저장 양식 일회성 덮어쓰기
 *
 * 한 파일 = 한 유형이 원칙이라, splitByType 인데 결과에 유형이 여럿이면
 * 유형별 링크 목록(index)을 돌려준다 — 링크마다 이 라우트에 type 을 붙인 것.
 */

interface QDoc {
  source?: string;
  type?: string;
  question_data?: Record<string, unknown>;
}

function qd(doc: QDoc, upper: string, lower: string): string {
  const d = doc.question_data ?? {};
  const v = d[upper] ?? d[lower];
  const s = typeof v === 'string' ? v.trim() : '';
  return s === 'undefined' ? '' : s;
}

/** Options — `###` 구분 우선, 없으면 줄바꿈 구분(레거시 72%). download-pdf 와 동일 규칙. */
function parseOptions(raw: string): string[] {
  if (raw.includes('###')) return raw.split('###').map((o) => o.trim()).filter(Boolean);
  return raw.split('\n').map((l) => l.trim()).filter(Boolean);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const textbook = sp.get('textbook')?.trim() || '';
  const type = sp.get('type')?.trim() || '';
  const difficulty = sp.get('difficulty')?.trim() || '';
  const status = sp.get('status')?.trim() || '';
  const passageId = sp.get('passage_id')?.trim() || '';
  const sources = (sp.get('sources') || '').split(',').map((x) => x.trim()).filter(Boolean);
  const types = (sp.get('types') || '').split(',').map((x) => x.trim()).filter(Boolean);
  const freeRaw = sp.get('free')?.trim().toLowerCase() || '';
  const free: 'only' | 'paid' | '' = freeRaw === 'only' ? 'only' : freeRaw === 'paid' ? 'paid' : '';
  const loginId = sp.get('loginId')?.trim() || '';

  const db = await getDb('gomijoshua');

  /* 회원 저장 양식 → 쿼리 파라미터로 일회성 덮어쓰기 */
  let format = normalizeVariantPrintFormat(undefined);
  let formatOwner = '';
  if (loginId) {
    const u = await db.collection('users').findOne({ loginId });
    if (u) { format = normalizeVariantPrintFormat(u.variantPrintFormat); formatOwner = String(u.name ?? loginId); }
  }
  const flag = (k: string, cur: boolean) => (sp.get(k) === null ? cur : sp.get(k) !== '0');
  format = {
    brand: sp.get('brand') !== null ? String(sp.get('brand')).trim().slice(0, 60) : format.brand,
    includeAnswers: flag('answers', format.includeAnswers),
    splitByType: flag('split', format.splitByType),
    hardSuffix: flag('hardSuffix', format.hardSuffix),
  };

  /* 필터 — download-pdf 의 queryDocs 와 같은 조건·정렬·상한 */
  const filter: Record<string, unknown> = {};
  if (textbook) filter.textbook = textbook;
  if (type) filter.type = type;
  else if (types.length > 0) filter.type = { $in: types };
  if (difficulty) filter.difficulty = difficulty;
  if (status) filter.status = status;
  if (passageId) filter.passage_id = passageId;
  if (sources.length > 0) filter.source = { $in: sources };
  if (free === 'only') filter.isFree = true;
  else if (free === 'paid') filter.isFree = { $ne: true };

  const docs = (await db
    .collection('generated_questions')
    .find(filter)
    .sort({ textbook: 1, source: 1, type: 1, 'question_data.순서': 1 })
    .limit(sources.length > 0 ? 2000 : 500)
    .toArray()) as QDoc[];

  if (docs.length === 0) {
    return new NextResponse('<meta charset="utf-8"><p style="font-family:sans-serif;padding:2rem">조건에 맞는 문항이 없습니다.</p>', {
      status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const distinctTypes = [...new Set(docs.map((d) => String(d.type ?? '')).filter(Boolean))];

  /* 유형이 여럿인데 유형별 분리 양식이면 — 파일을 합치지 않고 유형별 링크 목록을 준다 */
  if (format.splitByType && !type && distinctTypes.length > 1) {
    const links = distinctTypes
      .map((t) => {
        const p = new URLSearchParams(sp);
        p.set('type', t);
        const count = docs.filter((d) => d.type === t).length;
        return `<li><a href="?${esc(p.toString())}" target="_blank">${esc(variantTypePrintName(t, format.hardSuffix))}</a>
          <span class="c">${count}문항 · ${esc(t)}</span></li>`;
      })
      .join('\n');
    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<title>인쇄 양식 — 유형 선택</title>
<style>
body{font-family:'Pretendard','Noto Sans KR',sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem;color:#111}
h1{font-size:1.15rem} p{color:#555;font-size:.85rem}
ul{list-style:none;padding:0} li{margin:.4rem 0;padding:.55rem .8rem;border:1px solid #ddd;border-radius:6px}
a{font-weight:700;color:#1a56db;text-decoration:none} a:hover{text-decoration:underline}
.c{margin-left:.5rem;color:#888;font-size:.8rem}
</style></head><body>
<h1>인쇄 양식 — 한 파일 = 한 유형</h1>
<p>${esc(textbook || '전체')} · 총 ${docs.length}문항 · 유형 ${distinctTypes.length}종${
      formatOwner ? ` · 양식: ${esc(formatOwner)}` : ' · 기본 양식'
    }</p>
<p>유형이 섞이지 않도록 파일을 나눕니다. 유형을 눌러 인쇄 화면을 열고 브라우저에서 PDF로 저장하세요.</p>
<ul>${links}</ul>
</body></html>`;
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const questions: VariantPrintQuestion[] = docs.map((d) => ({
    source: String(d.source ?? ''),
    question: qd(d, 'Question', 'question'),
    paragraph: qd(d, 'Paragraph', 'paragraph'),
    options: parseOptions(qd(d, 'Options', 'options')),
    correctAnswer: qd(d, 'CorrectAnswer', 'correctAnswer'),
    explanation: qd(d, 'Explanation', 'explanation'),
  }));

  const onlyType = type || (distinctTypes.length === 1 ? distinctTypes[0] : '');
  const title = onlyType
    ? `${textbook || '변형문제'} · ${variantTypePrintName(onlyType, format.hardSuffix)}`
    : `${textbook || '변형문제 모음'}`;
  const subtitle = [
    textbook,
    sources.length > 0 ? `범위 ${sources.length}개 번호` : '',
    difficulty,
    status,
    `총 ${questions.length}문항`,
  ].filter(Boolean).join(' · ');

  const html = buildVariantPrintHtml({
    title,
    subtitle,
    brand: format.brand,
    questions,
    includeAnswers: format.includeAnswers,
  });
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
