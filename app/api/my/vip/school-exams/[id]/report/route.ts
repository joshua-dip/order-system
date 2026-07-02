import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, col } from '@/lib/vip-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* 한글 폰트 로더 (download 라우트와 동일 방식) */
const fontCache: Record<string, Buffer> = {};
async function loadFont(variant: 'Regular' | 'Bold' = 'Regular'): Promise<Buffer> {
  if (fontCache[variant]) return fontCache[variant];
  const name = `NanumGothic-${variant}.ttf`;
  const local = path.join(process.cwd(), 'lib', 'fonts', name);
  if (fs.existsSync(local)) { fontCache[variant] = fs.readFileSync(local); return fontCache[variant]; }
  const url = `https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/${name}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (res.ok) { const buf = Buffer.from(await res.arrayBuffer()); if (buf.length > 100_000) { fontCache[variant] = buf; return buf; } }
  if (variant === 'Bold') return loadFont('Regular');
  throw new Error('한글 폰트를 불러올 수 없습니다.');
}

const num1 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** GET — 이 시험의 문항별 분석(유형·교재·출처·배점)을 PDF 리포트로 반환. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 });

  const vipDb = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const exam = await col<Record<string, unknown>>(vipDb, 'schoolExams').findOne({ _id: new ObjectId(id), userId: uid });
  if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 });

  let schoolName = '';
  if (exam.schoolId) {
    const sc = await vipDb.collection('vip_schools').findOne({ _id: exam.schoolId as ObjectId });
    schoolName = String((sc as { schoolName?: unknown; name?: unknown } | null)?.schoolName ?? (sc as { name?: unknown } | null)?.name ?? '');
  }

  const questions = (exam.questions ?? {}) as Record<string, { questionType?: string; score?: number; isSubjective?: boolean; textbook?: string; source?: string; questionTitle?: string; questionText?: string; questionBody?: string; answerKey?: string | number; choices?: string }>;
  // 발문(문제 제목)에서 <u> 등 태그·과한 공백 제거
  const cleanTitle = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const rows = Object.keys(questions)
    .sort((a, b) => Number(a) - Number(b))
    .map((n) => {
      const q = questions[n];
      const choiceList = String(q.choices ?? '').split('\n').map((c) => c.trim()).filter(Boolean);
      return {
        num: n,
        type: String(q.questionType ?? '').trim(),
        title: cleanTitle(String(q.questionTitle ?? q.questionText ?? '')),
        textbook: String(q.textbook ?? '').trim(),
        source: String(q.source ?? '').trim(),
        score: Number(q.score) || 0,
        subj: !!q.isSubjective,
        bodyRaw: String(q.questionBody ?? ''),
        answerKey: Number(q.answerKey) || 0,
        choiceList,
        deform: null as number | null, // 원문 대비 변형도(%) — 아래에서 계산
      };
    });

  // ── 원문 대비 변형도 계산 (정답 적용 기준) ──
  // 순서·삽입: 단어집합 비교라 순서무관(정답대로 풀면 원문 단어 그대로) / 빈칸: 정답으로 채워 비교 / 그 외: 본문 그대로
  const stripAll = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/[━─]+/g, ' ').replace(/\([A-C]\)/g, ' ').replace(/[①②③④⑤]/g, ' ').replace(/_{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  const wordsOf = (s: string) => stripAll(s).toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
  const jaccard = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return 0; let i = 0; for (const w of A) if (B.has(w)) i++; return i / (A.size + B.size - i); };
  const passagesCol = vipDb.collection('passages');
  await Promise.all(rows.map(async (r) => {
    if (!r.source) return;
    const proj = { projection: { 'content.original': 1 } };
    const orig = (await passagesCol.findOne({ textbook: r.textbook, source_key: r.source }, proj))
      ?? (await passagesCol.findOne({ source_key: r.source }, proj));
    const origText = String((orig as { content?: { original?: string } } | null)?.content?.original ?? '');
    if (!origText) return;
    let applied = r.bodyRaw;
    if (r.type === '빈칸' && r.answerKey > 0 && r.choiceList[r.answerKey - 1]) {
      applied = applied.replace(/(<u>\s*)?_{2,}(\s*<\/u>)?/g, ` ${r.choiceList[r.answerKey - 1]} `);
    }
    const j = jaccard(wordsOf(applied), wordsOf(origText));
    // 신뢰도 게이트: 원문이 본문 일부만 등록된 경우(교과서 등) 단어겹침이 낮아 측정 불가 → null
    if (j < 0.7) return;
    r.deform = Math.max(0, Math.min(100, Math.round((1 - j) * 100)));
  }));

  const objCount = rows.filter((r) => !r.subj).length;
  const subjCount = rows.filter((r) => r.subj).length;
  const totalScore = rows.reduce((s, r) => s + r.score, 0);
  const typeDist: Record<string, number> = {};
  const tbDist: Record<string, number> = {};
  for (const r of rows) { if (r.type) typeDist[r.type] = (typeDist[r.type] ?? 0) + 1; if (r.textbook) tbDist[r.textbook] = (tbDist[r.textbook] ?? 0) + 1; }

  const [reg, bold] = await Promise.all([loadFont('Regular'), loadFont('Bold')]);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 45, right: 45 } });
  doc.registerFont('R', reg); doc.registerFont('B', bold);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((res) => doc.on('end', () => res()));

  const L = 45, R = 550; // left/right edges
  // ── 제목 ──
  const title = [schoolName, exam.grade ? `${exam.grade}학년` : '', exam.academicYear ? `${exam.academicYear}년` : '', String(exam.examType ?? '')].filter(Boolean).join(' ');
  doc.font('B').fontSize(16).fillColor('#111').text(title || '시험 분석', L, doc.y, { width: R - L, align: 'center' });
  doc.font('R').fontSize(11).fillColor('#6b7280').text('문항 분석 리포트', { align: 'center' });
  doc.moveDown(0.9);

  // ── 요약 ──
  doc.fillColor('#111').font('B').fontSize(11).text('■ 요약', L);
  doc.font('R').fontSize(10).fillColor('#333').text(`총 ${rows.length}문항   ·   객관식 ${objCount}   ·   서술형 ${subjCount}   ·   총점 ${num1(totalScore)}점`, L, doc.y + 2);
  doc.moveDown(0.7);

  doc.font('B').fontSize(10).fillColor('#111').text('유형 분포', L);
  doc.font('R').fontSize(9.5).fillColor('#333').text(Object.entries(typeDist).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} ${c}`).join('   ·   ') || '—', L, doc.y + 1, { width: R - L });
  doc.moveDown(0.5);
  doc.font('B').fontSize(10).fillColor('#111').text('출처(교재) 분포', L);
  doc.font('R').fontSize(9.5).fillColor('#333').text(Object.entries(tbDist).sort((a, b) => b[1] - a[1]).map(([t, c]) => `· ${t} — ${c}문항`).join('\n') || '—', L, doc.y + 1, { width: R - L });
  doc.moveDown(0.9);

  // ── 문항별 표 ──
  doc.font('B').fontSize(11).fillColor('#111').text('■ 문항별 분석 (1번~)', L);
  doc.font('R').fontSize(7.5).fillColor('#9ca3af').text('변형도 = 정답 적용 후 원문 대비 내용 변형률 (순서·삽입·빈칸은 정답 반영). 낮을수록 원문에 충실. ‘—’는 원문 일부만 등록돼 측정 불가.', L, doc.y + 1, { width: R - L });
  doc.moveDown(0.3);

  const cNum = L, cType = L + 30, cScore = L + 74, cDeform = L + 104, cTag = L + 148, cMain = L + 184; // column x
  const wMain = R - cMain;
  const deformColor = (d: number) => (d <= 10 ? '#16a34a' : d <= 30 ? '#b45309' : '#dc2626');
  const drawHead = () => {
    const y = doc.y;
    doc.font('B').fontSize(9).fillColor('#374151');
    doc.text('번호', cNum, y, { width: 28 });
    doc.text('유형', cType, y, { width: 42 });
    doc.text('배점', cScore, y, { width: 28 });
    doc.text('변형도', cDeform, y, { width: 42 });
    doc.text('구분', cTag, y, { width: 34 });
    doc.text('문제 제목 / 출처', cMain, y, { width: wMain });
    doc.moveTo(L, y + 13).lineTo(R, y + 13).strokeColor('#d1d5db').lineWidth(0.8).stroke();
    doc.y = y + 17;
  };
  drawHead();

  for (const r of rows) {
    const titleText = r.title || '(제목 없음)';
    const srcText = [r.textbook, r.source].filter(Boolean).join(' · ') || '(출처 미분석)';
    const titleH = doc.font('R').fontSize(9).heightOfString(titleText, { width: wMain });
    const srcH = doc.font('R').fontSize(8).heightOfString(srcText, { width: wMain });
    const rowH = titleH + srcH + 7;
    if (doc.y + rowH > doc.page.height - 48) { doc.addPage(); drawHead(); }
    const y = doc.y;
    doc.font('B').fillColor('#111').fontSize(9).text(`${r.num}번`, cNum, y, { width: 28 });
    doc.font('R').fillColor('#333').fontSize(9).text(r.type || '—', cType, y, { width: 42 });
    doc.text(`${num1(r.score)}점`, cScore, y, { width: 28 });
    // 변형도 — 정답 적용 기준, 색상 구분
    if (r.deform === null) doc.fillColor('#9ca3af').text('—', cDeform, y, { width: 42 });
    else doc.fillColor(deformColor(r.deform)).text(`${r.deform}%`, cDeform, y, { width: 42 });
    doc.fillColor(r.subj ? '#b45309' : '#2563eb').fontSize(9).text(r.subj ? '서술형' : '객관식', cTag, y, { width: 34 });
    // 문제 제목(발문) — 진하게, 그 아래 교재·출처 — 작은 회색
    doc.fillColor('#111').fontSize(9).text(titleText, cMain, y, { width: wMain });
    doc.fillColor('#6b7280').fontSize(8).text(srcText, cMain, y + titleH + 1, { width: wMain });
    doc.y = y + rowH;
    doc.moveTo(L, doc.y - 3).lineTo(R, doc.y - 3).strokeColor('#f3f4f6').lineWidth(0.5).stroke();
  }

  doc.end();
  await done;
  const buf = Buffer.concat(chunks);
  const fname = `${(title || '시험').replace(/[\\/:*?"<>|]/g, '')} 분석리포트.pdf`;
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${encodeURIComponent(fname)}"` },
  });
}
