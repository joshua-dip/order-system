import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { STUDIO_MATERIALS_COLLECTION, type StudioElement, type StudioPage } from '@/lib/vip-material-studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* ── 폰트 (generate/download 와 동일 소스) ── */
const fontCache: Record<string, Buffer> = {};
async function loadFont(variant: 'Regular' | 'Bold'): Promise<Buffer> {
  if (fontCache[variant]) return fontCache[variant];
  const name = `NanumGothic-${variant}.ttf`;
  const local = path.join(process.cwd(), 'lib', 'fonts', name);
  if (fs.existsSync(local)) { fontCache[variant] = fs.readFileSync(local); return fontCache[variant]; }
  const res = await fetch(`https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/${name}`, { signal: AbortSignal.timeout(8000) });
  if (res.ok) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 100_000) { fontCache[variant] = buf; return buf; }
  }
  if (variant === 'Bold') return loadFont('Regular');
  throw new Error('한글 폰트를 불러올 수 없습니다.');
}
let circledCache: Buffer | null | undefined;
function loadCircled(): Buffer | null {
  if (circledCache !== undefined) return circledCache;
  const local = path.join(process.cwd(), 'lib', 'fonts', 'CircledFallback-subset.ttf');
  circledCache = fs.existsSync(local) ? fs.readFileSync(local) : null;
  return circledCache;
}

const MM = 72 / 25.4; // mm → pt
const CIRCLED_RE = /([①②③④⑤⑥⑦⑧⑨⑩])/;
const CIRCLED = ['①', '②', '③', '④', '⑤'];

function stripTags(s: string): string {
  return (s || '').replace(/<\/?u>/g, '').replace(/<br\s*\/?>/g, '\n');
}

/** 원형숫자 폴백 폰트를 섞어 텍스트 출력 (좌측 정렬 흐름) */
function writeRuns(doc: PDFKit.PDFDocument, text: string, x: number, y: number, w: number, opts: { size: number; bold: boolean; color: string; lineGap: number; align: 'left' | 'center' | 'right'; hasCircled: boolean }) {
  const base = opts.bold ? 'B' : 'R';
  doc.fontSize(opts.size).fillColor(opts.color);
  if (!opts.hasCircled || !CIRCLED_RE.test(text)) {
    doc.font(base).text(text, x, y, { width: w, align: opts.align, lineGap: opts.lineGap });
    return;
  }
  // 원형숫자 포함 — 세그먼트 run (좌측 정렬로 흐름 출력)
  const segs = text.split(CIRCLED_RE).filter((s) => s !== '');
  doc.text('', x, y, { width: w, lineGap: opts.lineGap, continued: true });
  segs.forEach((seg, i) => {
    const isC = CIRCLED_RE.test(seg) && seg.length === 1;
    doc.font(isC ? 'C' : base);
    doc.text(seg, { width: w, lineGap: opts.lineGap, continued: i < segs.length - 1 });
  });
}

function drawElement(doc: PDFKit.PDFDocument, el: StudioElement, assets: { images: Map<string, Buffer>; qrs: Map<string, Buffer>; hasCircled: boolean }) {
  const x = el.x * MM, y = el.y * MM, w = el.w * MM, h = el.h * MM;
  if (el.kind === 'rect' || el.kind === 'line') {
    const r = (el.radius ?? 0) * MM;
    doc.save();
    if (el.fill && el.fill !== 'transparent') {
      (r > 0 ? doc.roundedRect(x, y, w, h, r) : doc.rect(x, y, w, h)).fill(el.fill);
    }
    if (el.borderColor && (el.borderWidth ?? 0) > 0) {
      doc.lineWidth((el.borderWidth ?? 0.3) * MM);
      (r > 0 ? doc.roundedRect(x, y, w, h, r) : doc.rect(x, y, w, h)).stroke(el.borderColor);
    }
    doc.restore();
    return;
  }
  if (el.kind === 'text') {
    doc.save();
    if (el.bg && el.bg !== 'transparent') doc.rect(x, y, w, h).fill(el.bg);
    if (el.borderColor && (el.borderWidth ?? 0) > 0) {
      doc.lineWidth((el.borderWidth ?? 0.3) * MM);
      doc.rect(x, y, w, h).stroke(el.borderColor);
    }
    doc.restore();
    const size = el.fontSize ?? 11;
    const lineGap = size * ((el.lineHeight ?? 1.35) - 1);
    writeRuns(doc, stripTags(el.text ?? ''), x + 1.2 * MM, y + 1.2 * MM, w - 2.4 * MM, {
      size, bold: el.bold === true, color: el.color || '#111111', lineGap, align: el.align ?? 'left', hasCircled: assets.hasCircled,
    });
    return;
  }
  if (el.kind === 'image') {
    const buf = el.src ? assets.images.get(el.src) : undefined;
    if (buf) {
      try { doc.image(buf, x, y, { fit: [w, h], align: 'center', valign: 'center' }); } catch { /* 손상 이미지 무시 */ }
    }
    return;
  }
  if (el.kind === 'qr') {
    const buf = el.qrUrl ? assets.qrs.get(el.qrUrl) : undefined;
    const side = Math.min(w, h - (el.qrLabel ? 5 * MM : 0));
    if (buf) doc.image(buf, x + (w - side) / 2, y, { width: side, height: side });
    if (el.qrLabel) {
      doc.font('R').fontSize(8).fillColor('#374151').text(el.qrLabel, x, y + side + 1.5 * MM, { width: w, align: 'center' });
    }
    return;
  }
  if (el.kind === 'question' && el.q) {
    const q = el.q;
    const size = el.fontSize ?? 10;
    const inX = x + 1.5 * MM, inW = w - 3 * MM;
    let cy = y + 1.5 * MM;
    const head = `${q.num ? `${q.num}. ` : ''}${stripTags(q.question ?? '')}`;
    doc.font('B').fontSize(size).fillColor('#111111');
    doc.text(head, inX, cy, { width: inW, lineGap: size * 0.3 });
    cy = doc.y + 1.5 * MM;
    if (q.paragraph) {
      const paraText = stripTags(q.paragraph);
      doc.save();
      const paraH = doc.font('R').fontSize(size - 0.5).heightOfString(paraText, { width: inW - 4 * MM, lineGap: size * 0.35 }) + 4 * MM;
      doc.rect(inX, cy, inW, paraH).lineWidth(0.5).stroke('#9ca3af');
      doc.restore();
      writeRuns(doc, paraText, inX + 2 * MM, cy + 2 * MM, inW - 4 * MM, { size: size - 0.5, bold: false, color: '#111111', lineGap: size * 0.35, align: 'left', hasCircled: assets.hasCircled });
      cy = doc.y + 3 * MM;
    }
    const opts = (q.options ?? []).filter((o) => o.trim());
    if (opts.length > 0) {
      const optText = opts.map((o, i) => `${CIRCLED[i] ?? `${i + 1})`} ${o}`).join('\n');
      writeRuns(doc, optText, inX, cy, inW, { size: size - 0.5, bold: false, color: '#111111', lineGap: size * 0.45, align: 'left', hasCircled: assets.hasCircled });
      cy = doc.y;
    }
    if (q.showAnswer && q.answer) {
      writeRuns(doc, `정답 ${q.answer}${q.explanation ? `  |  ${stripTags(q.explanation)}` : ''}`, inX, cy + 1.5 * MM, inW, { size: size - 1.5, bold: false, color: '#6b7280', lineGap: size * 0.3, align: 'left', hasCircled: assets.hasCircled });
    }
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '유효하지 않은 ID' }, { status: 400 });
  const db = await getDb('gomijoshua');
  const doc = await db.collection(STUDIO_MATERIALS_COLLECTION).findOne({ _id: new ObjectId(id), userId: new ObjectId(auth.userId) });
  if (!doc) return NextResponse.json({ error: '교재를 찾을 수 없습니다.' }, { status: 404 });

  const pages = (Array.isArray(doc.pages) ? doc.pages : []) as StudioPage[];
  const [regular, bold] = await Promise.all([loadFont('Regular'), loadFont('Bold')]);
  const circled = loadCircled();

  // 이미지·QR 미리 로드
  const images = new Map<string, Buffer>();
  const qrs = new Map<string, Buffer>();
  for (const p of pages) {
    for (const el of p.elements ?? []) {
      if (el.kind === 'image' && el.src && !images.has(el.src)) {
        const m = el.src.match(/\/file\/([a-f0-9]{24})\/([^/?]+)$/);
        if (m && m[1] === auth.userId) {
          const fp = path.join(process.cwd(), 'uploads/vip-material-studio', m[1], path.basename(m[2]));
          if (fs.existsSync(fp)) images.set(el.src, fs.readFileSync(fp));
        }
      }
      if (el.kind === 'qr' && el.qrUrl && !qrs.has(el.qrUrl)) {
        try { qrs.set(el.qrUrl, await QRCode.toBuffer(el.qrUrl, { margin: 0, width: 512 })); } catch { /* URL 오류 무시 */ }
      }
    }
  }

  const pdf = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true });
  pdf.registerFont('R', regular);
  pdf.registerFont('B', bold);
  if (circled) pdf.registerFont('C', circled);
  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => pdf.on('end', () => resolve(Buffer.concat(chunks))));

  const assets = { images, qrs, hasCircled: !!circled };
  for (const page of pages) {
    pdf.addPage({ size: 'A4', margin: 0 });
    const els = [...(page.elements ?? [])].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    for (const el of els) {
      try { drawElement(pdf, el as StudioElement, assets); } catch (e) { console.error('studio pdf element:', e); }
    }
  }
  if (pages.length === 0) pdf.addPage({ size: 'A4', margin: 0 });
  pdf.end();
  const buf = await done;

  const fname = encodeURIComponent(`${doc.title || '교재'}.pdf`);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${fname}`,
    },
  });
}
