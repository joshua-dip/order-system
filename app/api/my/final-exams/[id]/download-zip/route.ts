import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { getDb } from '@/lib/mongodb';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';
import {
  getFinalExamJob,
  loadExamQuestions,
  refillJobShortages,
} from '@/lib/final-exam-store';
import {
  buildFinalExamSheetHtml,
  buildFinalExamAnswerHtml,
  type FinalExamQuestion,
} from '@/lib/final-exam-html';
import { renderExamPdfs } from '@/lib/render-exam-pdf';
import { getEmbeddedKoreanFontFaceCss } from '@/lib/pdf-korean-font';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/* 지문 수만큼 PDF 를 렌더하므로 여유 있게 */
export const maxDuration = 300;

function safe(name: string): string {
  return name.replace(/[\\/:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '지문';
}

/** jobId 기반 고정 셔플 시드 (download 라우트와 동일 규칙 — 전부랜덤 순서 재현). */
function stableSeedFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return (h >>> 0) || 1;
}

/**
 * 시험지 PDF 를 한 번에 ZIP 으로.
 *  - 기본(scope=source): 지문별 문제지+정답해설
 *  - scope=full: 전체(기본순·회차별·전부랜덤) + 지문별 × 문제·정답 모두
 * ?kind=exam|answer 면 해당 종류만.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const kindParam = sp.get('kind');
  const wantExam = kindParam !== 'answer';
  const wantAnswer = kindParam !== 'exam';
  const full = sp.get('scope') === 'full';

  try {
    const db = await getDb('gomijoshua');
    const me = await db.collection('users').findOne({ _id: auth.userId }, { projection: { loginId: 1 } });
    const loginId = typeof me?.loginId === 'string' ? me.loginId : '';
    if (!loginId) return NextResponse.json({ error: '사용자 정보를 찾을 수 없습니다.' }, { status: 404 });

    let job = await getFinalExamJob(db, id, loginId);
    if (!job) return NextResponse.json({ error: '다운로드 항목을 찾을 수 없습니다.' }, { status: 404 });
    if (job.status === 'awaiting_admin') job = await refillJobShortages(db, job);
    if (job.status !== 'ready') {
      const short = job.totalRequested - job.totalAssigned;
      return NextResponse.json({ error: `아직 제작 중입니다. 부족 문항 ${short}개가 완성되면 다운로드할 수 있습니다.`, status: job.status }, { status: 409 });
    }

    const fontFaceCss = await getEmbeddedKoreanFontFaceCss();
    const entries: { name: string; html: string }[] = [];
    const exam = (subtitle: string, qs: FinalExamQuestion[]) =>
      buildFinalExamSheetHtml({ title: job!.title, subtitle, questions: qs, fontFaceCss }); // ZIP 은 QR 미포함(정렬마다 번호가 달라 채점 혼동 방지)
    const answer = (subtitle: string, qs: FinalExamQuestion[]) =>
      buildFinalExamAnswerHtml({ title: job!.title, subtitle, questions: qs, fontFaceCss });

    // ── 전체(기본순·회차별·전부랜덤) — scope=full 일 때 ──
    if (full) {
      const shuffleSeed = typeof job.shuffleSeed === 'number' ? job.shuffleSeed : stableSeedFromId(String(job._id));
      const modes: { key: 'default' | 'interleave' | 'shuffle'; folder: string }[] = [
        { key: 'default', folder: '전체(기본순-유형별)' },
        { key: 'interleave', folder: '전체(회차별)' },
        { key: 'shuffle', folder: '전체(전부랜덤)' },
      ];
      for (const m of modes) {
        const qs = await loadExamQuestions(db, { ...job, orderMode: m.key, ...(m.key === 'shuffle' ? { shuffleSeed } : {}) });
        if (qs.length === 0) continue;
        const subtitle = `${job.scopeSummary} · 총 ${qs.length}문항`;
        if (wantExam) entries.push({ name: `${m.folder}/문제지`, html: exam(subtitle, qs) });
        if (wantAnswer) entries.push({ name: `${m.folder}/정답해설`, html: answer(subtitle, qs) });
      }
    }

    // ── 지문(출처)별 — 각 지문 1번부터 재번호 ──
    const baseQuestions = await loadExamQuestions(db, { ...job, orderMode: 'default' });
    if (baseQuestions.length === 0 && entries.length === 0) {
      return NextResponse.json({ error: '문항을 불러오지 못했습니다.' }, { status: 500 });
    }
    const order: string[] = [];
    const seen = new Set<string>();
    for (const it of job.items) { if (!seen.has(it.sourceKey)) { seen.add(it.sourceKey); order.push(it.sourceKey); } }
    const bySource = new Map<string, FinalExamQuestion[]>();
    for (const q of baseQuestions) {
      if (!bySource.has(q.sourceKey)) bySource.set(q.sourceKey, []);
      bySource.get(q.sourceKey)!.push(q);
    }
    const srcPrefix = full ? '지문별/' : '';
    order.forEach((sk, i) => {
      const raw = bySource.get(sk);
      if (!raw || raw.length === 0) return;
      const qs = raw.map((q, idx) => ({ ...q, num: idx + 1, round: undefined }));
      const subtitle = `${sk} · ${qs.length}문항`;
      const idx2 = String(i + 1).padStart(2, '0');
      if (wantExam) entries.push({ name: `${srcPrefix}${idx2}_${safe(sk)}_문제지`, html: exam(subtitle, qs) });
      if (wantAnswer) entries.push({ name: `${srcPrefix}${idx2}_${safe(sk)}_정답해설`, html: answer(subtitle, qs) });
    });
    if (entries.length === 0) return NextResponse.json({ error: '문항을 찾을 수 없습니다.' }, { status: 404 });

    const pdfs = await renderExamPdfs(entries.map((e) => e.html));
    const zip = new JSZip();
    entries.forEach((e, i) => zip.file(`${e.name}.pdf`, pdfs[i]));
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });

    const stamp = (job.createdAt instanceof Date ? job.createdAt : new Date()).toISOString().slice(0, 10).replace(/-/g, '');
    const tag = full ? '전체묶음' : '지문별';
    const fname = safe(`파이널예비모의고사_${stamp}_${tag}`) + '.zip';
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(buf.byteLength),
        'Content-Disposition': `attachment; filename="final-exam-${stamp}-${full ? 'all' : 'bysource'}.zip"; filename*=UTF-8''${encodeURIComponent(fname)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[final-exams download-zip]', e);
    return NextResponse.json({ error: 'ZIP 생성에 실패했습니다.' }, { status: 500 });
  }
}
