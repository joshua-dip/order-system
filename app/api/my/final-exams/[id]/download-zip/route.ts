import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { getDb } from '@/lib/mongodb';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';
import {
  getFinalExamJob,
  loadExamQuestions,
  refillJobShortages,
  ensureGradeToken,
  stableExamSeed,
} from '@/lib/final-exam-store';
import {
  buildFinalExamSheetHtml,
  buildFinalExamSheetMultiHtml,
  buildFinalExamAnswerHtml,
  type FinalExamBuildInput,
  type FinalExamQuestion,
} from '@/lib/final-exam-html';
import { renderExamPdfs, countPdfPages } from '@/lib/render-exam-pdf';
import { getEmbeddedKoreanFontFaceCss } from '@/lib/pdf-korean-font';
import { publicBaseUrl } from '@/lib/public-base-url';

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

    // ── 학생별 개별 문제지 — 학생마다 다른 랜덤 배치 + 그 배치에 맞는 QR 채점 ──
    //   students=1        → 학생별 ZIP (문제지 + 정답해설)
    //   students=combined → 모든 학생 합본 PDF 1장 (각 학생 홀수페이지에서 시작·짝수면 빈 페이지)
    const studentsMode = sp.get('students');
    if (studentsMode === '1' || studentsMode === 'combined') {
      const combined = studentsMode === 'combined';
      const names = Array.isArray(job.students) ? job.students : [];
      if (names.length === 0) {
        return NextResponse.json({ error: '학생 이름이 없습니다. 발급할 때 학생 이름을 입력하세요.' }, { status: 400 });
      }
      const fontCss = await getEmbeddedKoreanFontFaceCss();
      const token = await ensureGradeToken(db, job);
      const baseUrl = publicBaseUrl(request);
      const jobId = String(job._id);
      let QRCode: typeof import('qrcode') | null = null;
      try { QRCode = (await import('qrcode')).default as unknown as typeof import('qrcode'); } catch { QRCode = null; }

      const studentEntries: { name: string; html: string }[] = [];
      const examSheets: FinalExamBuildInput[] = []; // 합본용 — 학생별 문제지(QR 포함)
      for (let i = 0; i < names.length; i++) {
        const nm = names[i];
        // 학생마다 고유 시드 → 서로 다른 문제 배치(재다운로드해도 동일). 빈 지문이 있으면 시드 무관.
        const seed = stableExamSeed(`${jobId}:${nm}:${i}`);
        const qs = await loadExamQuestions(db, { ...job, orderMode: 'shuffle', shuffleSeed: seed });
        if (qs.length === 0) return NextResponse.json({ error: '문항을 불러오지 못했습니다.' }, { status: 500 });
        const subtitle = `${job.scopeSummary} · 총 ${qs.length}문항`;
        // QR 은 같은 시드(seed)를 실어 채점 페이지가 이 학생 배치 그대로 채점.
        let qrDataUrl: string | undefined;
        if (QRCode) {
          try { qrDataUrl = await QRCode.toDataURL(`${baseUrl}/grade/${token}?seed=${seed}`, { margin: 0, width: 240 }); } catch { /* QR 없이 진행 */ }
        }
        const examSheet: FinalExamBuildInput = { title: job!.title, subtitle, questions: qs, studentName: nm, qrDataUrl, qrLabel: 'QR 스캔 → 바로 채점', fontFaceCss: fontCss };
        examSheets.push(examSheet);
        if (combined) continue; // 합본은 ZIP 항목 안 만든다
        const idx2 = String(i + 1).padStart(2, '0');
        if (wantExam) {
          studentEntries.push({ name: `${idx2}_${safe(nm)}_문제지`, html: buildFinalExamSheetHtml(examSheet) });
        }
        if (wantAnswer) {
          // 정답·해설지 — 그 학생 배치(순서)에 맞춘 정답 및 해설
          studentEntries.push({
            name: `${idx2}_${safe(nm)}_정답해설`,
            html: buildFinalExamAnswerHtml({ title: job!.title, subtitle: `${subtitle} · ${nm}`, questions: qs, fontFaceCss: fontCss }),
          });
        }
      }
      const st = (job.createdAt instanceof Date ? job.createdAt : new Date()).toISOString().slice(0, 10).replace(/-/g, '');

      // 합본 PDF 1장 — 각 학생 첫 페이지가 홀수페이지에서 시작(양면 인쇄용 빈 페이지 삽입)
      if (combined) {
        // 1패스: 학생별 문제지를 개별 렌더해 페이지 수를 센다.
        const indivPdfs = await renderExamPdfs(examSheets.map((s) => buildFinalExamSheetHtml(s)));
        const pageCounts = indivPdfs.map((p) => countPdfPages(p));
        // 2패스: 각 학생이 홀수페이지에서 시작하도록, 누적 페이지가 홀수면 그 학생 앞에 빈 페이지.
        const blankBefore: boolean[] = [];
        let cum = 0;
        for (let i = 0; i < examSheets.length; i++) {
          if (i === 0) { blankBefore.push(false); cum = pageCounts[0] ?? 1; continue; }
          const needBlank = cum % 2 === 1; // 다음 학생이 홀수페이지에서 시작하려면 직전까지 누적이 짝수여야
          blankBefore.push(needBlank);
          cum += (needBlank ? 1 : 0) + (pageCounts[i] ?? 1);
        }
        const html = buildFinalExamSheetMultiHtml(examSheets, { fontFaceCss: fontCss, docTitle: job!.title, blankBefore });
        const [pdf] = await renderExamPdfs([html]);
        if (!pdf) return NextResponse.json({ error: '합본 PDF 생성에 실패했습니다.' }, { status: 500 });
        const fn = safe(`파이널예비모의고사_${st}_학생합본`) + '.pdf';
        return new NextResponse(new Uint8Array(pdf), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': String(pdf.byteLength),
            'Content-Disposition': `attachment; filename="final-exam-${st}-students-merged.pdf"; filename*=UTF-8''${encodeURIComponent(fn)}`,
            'Cache-Control': 'no-store',
          },
        });
      }

      if (studentEntries.length === 0) return NextResponse.json({ error: '생성할 문항이 없습니다.' }, { status: 400 });
      const pdfs = await renderExamPdfs(studentEntries.map((e) => e.html));
      const zip = new JSZip();
      studentEntries.forEach((e, i) => zip.file(`${e.name}.pdf`, pdfs[i]));
      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const fn = safe(`파이널예비모의고사_${st}_학생별`) + '.zip';
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': String(buf.byteLength),
          'Content-Disposition': `attachment; filename="final-exam-${st}-students.zip"; filename*=UTF-8''${encodeURIComponent(fn)}`,
          'Cache-Control': 'no-store',
        },
      });
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
    return NextResponse.json(
      { error: 'PDF 생성에 실패했습니다. 잠시 후 다시 시도해주세요. (학생 수가 많으면 시간이 더 걸릴 수 있습니다)' },
      { status: 500 },
    );
  }
}
