import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import JSZip from 'jszip';
import { requireUser } from '@/lib/user-auth';
import { getDb } from '@/lib/mongodb';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import {
  classKitTextbookDeniedMessage,
  isClassKitTextbookAllowed,
  resolveClassKitAccess,
} from '@/lib/class-kit-access';
import {
  buildLectureMaterialHtml,
  buildLectureMaterialMultiPageHtml,
  clampLineHeight,
  type LectureSentence,
} from '@/lib/lecture-material-html';
import { prepareKoreanPdfHtml } from '@/lib/pdf-korean-font';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/* 다건 PDF 렌더링 — Lambda 기본 30s 초과 가능 → 300s */
export const maxDuration = 300;

/**
 * 강의용자료 — 한 교재의 다수 지문 PDF/ZIP 다운로드.
 * body: { textbook, passageIds?, kicker?, lineHeight?, format: 'zip' | 'pdf' }
 *   - passageIds 미지정 시 textbook 전체.
 *   - format=zip → 지문마다 A4 1장 PDF 를 zip 으로 묶음
 *   - format=pdf → 지문마다 A4 1페이지로 합친 다 페이지 PDF
 */
export async function POST(request: NextRequest) {
  const { error } = await requireUser(request);
  if (error) return error;
  const { level } = await resolveClassKitAccess(request);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
  const kicker =
    typeof body.kicker === 'string' && body.kicker.trim() ? body.kicker.trim() : '강의용자료';
  const lineHeight = clampLineHeight(body.lineHeight);
  const format: 'pdf' | 'zip' = body.format === 'pdf' ? 'pdf' : 'zip';
  const passageIdsRaw = Array.isArray(body.passageIds) ? body.passageIds : null;
  const passageIds = passageIdsRaw
    ?.filter((v): v is string => typeof v === 'string' && ObjectId.isValid(v))
    .slice(0, 500);

  // 1) 대상 지문 — passageIds 가 있으면 그 ID 만, 없으면 textbook 전체
  const hasIds = !!(passageIds && passageIds.length > 0);
  if (!textbook && !hasIds) {
    return NextResponse.json({ error: '교재명(textbook) 또는 지문 선택(passageIds)이 필요합니다.' }, { status: 400 });
  }
  // 단일 교재 모드는 조회 전 권한 체크(빠른 거부). 혼합(passageIds) 모드는 조회 후 지문별 교재로 필터.
  if (!hasIds && !isClassKitTextbookAllowed(textbook, level)) {
    return NextResponse.json({ error: classKitTextbookDeniedMessage(level) }, { status: 403 });
  }
  const db = await getDb('gomijoshua');
  // passageIds 가 오면 여러 교재를 섞은 묶음일 수 있어 교재 필터 없이 _id 로 조회하고
  // 입력(선택) 순서를 그대로 유지한다. passageIds 가 없을 때만 textbook 전체(기존 정렬).
  const col = db.collection('passages');
  let docs: Record<string, unknown>[];
  if (hasIds) {
    const found = await col
      .find({ _id: { $in: passageIds!.map((s) => new ObjectId(s)) } })
      .limit(500)
      .toArray();
    const byId = new Map(found.map((d) => [String(d._id), d]));
    docs = passageIds!
      .map((id) => byId.get(id))
      .filter((d): d is NonNullable<typeof d> => !!d)
      // 접근 권한 없는 교재의 지문은 제외(공개 클래스키트 — 등급별 모의고사 접근)
      .filter((d) => isClassKitTextbookAllowed(String(d.textbook ?? ''), level));
    if (docs.length === 0) {
      return NextResponse.json({ error: classKitTextbookDeniedMessage(level) }, { status: 403 });
    }
  } else {
    docs = await col
      .find({ textbook })
      .sort({ chapter: 1, order: 1, number: 1 })
      .limit(500)
      .toArray();
  }

  type Built = { number: string; textbook: string; sentences: LectureSentence[] };
  const built: Built[] = [];
  for (const d of docs) {
    const doc = d as Record<string, unknown>;
    const content = (doc.content as Parameters<typeof tokenizePassageFromContent>[0]) ?? undefined;
    if (!content) continue;
    const toks = tokenizePassageFromContent(content);
    const sentences: LectureSentence[] = toks
      .map((t) => ({ idx: t.idx, text: String(t.text ?? '').trim() }))
      .filter((s) => s.text);
    if (sentences.length === 0) continue;
    const rawNumber = String(doc.number ?? '');
    built.push({ number: deriveNumber(rawNumber) || rawNumber, textbook: String(doc.textbook ?? '').trim(), sentences });
  }
  if (built.length === 0) {
    return NextResponse.json({ error: '지문이 없습니다.' }, { status: 404 });
  }

  // 2) puppeteer — lecture-pdf · grammar bulk-pdf-zip 와 동일 패턴
  const [{ default: chromium }, puppeteer] = await Promise.all([
    import('@sparticuz/chromium'),
    import('puppeteer-core'),
  ]);

  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  const localChromeCandidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean) as string[];

  const executablePath = isLambda
    ? await chromium.executablePath()
    : (localChromeCandidates[0] ?? (await chromium.executablePath()));

  const browser = await puppeteer.default.launch({
    args: isLambda ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 2 },
    executablePath,
    headless: true,
    /* 큰/다건 PDF 의 CDP printToPDF 가 기본 protocolTimeout(180s)을 넘기지 않도록
       maxDuration(300s)에 맞춰 늘린다. */
    protocolTimeout: 280_000,
  });

  try {
    const dateSlug = new Date().toISOString().slice(0, 10);
    const baseName = `강의용자료_${sanitizeFilename(textbook || '여러교재')}`;

    if (format === 'zip') {
      const zip = new JSZip();
      const used = new Set<string>();
      let idx = 0;
      for (const w of built) {
        idx += 1;
        const html = buildLectureMaterialHtml({
          kicker,
          title: w.textbook || textbook,
          number: w.number,
          sentences: w.sentences,
          lineHeight,
        });
        const page = await browser.newPage();
        try {
          await page.setContent(await prepareKoreanPdfHtml(html, { remapNames: ['Malgun Gothic'] }),{ waitUntil: 'load', timeout: 60_000 });
          await page.evaluate(async () => {
            try {
              await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
            } catch {
              /* ignore */
            }
          });
          const pdfBuf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
            pageRanges: '1',
            timeout: 0, // 30s 기본 타임아웃 해제
          });
          const numLabel = sanitizeFilename(w.number || String(idx));
          const filename = uniqueFilename(used, `${numLabel}.pdf`);
          zip.file(filename, pdfBuf);
        } finally {
          await page.close();
        }
      }

      const zipBytes = (await zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      })) as Uint8Array;

      const zipName = `${baseName}_${dateSlug}.zip`;
      const encoded = encodeURIComponent(zipName);
      const fallback = `lecture-bulk-${Date.now()}.zip`;
      return new NextResponse(new Uint8Array(zipBytes), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': String(zipBytes.byteLength),
          'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // format === 'pdf' — 다 페이지 단일 PDF
    const html = buildLectureMaterialMultiPageHtml({
      kicker,
      items: built.map((b) => ({
        title: b.textbook || textbook,
        number: b.number,
        sentences: b.sentences,
        lineHeight,
      })),
    });
    const page = await browser.newPage();
    try {
      await page.setContent(await prepareKoreanPdfHtml(html, { remapNames: ['Malgun Gothic'] }),{ waitUntil: 'load', timeout: 120_000 });
      await page.evaluate(async () => {
        try {
          await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
        } catch {
          /* ignore */
        }
      });
      const pdfBuf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        timeout: 0, // 30s 기본 타임아웃 해제 (단일 합본 PDF 는 렌더가 길다)
      });
      const fileName = `${baseName}_${dateSlug}.pdf`;
      const encoded = encodeURIComponent(fileName);
      const bytes = new Uint8Array(pdfBuf);
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(bytes.byteLength),
          'Content-Disposition': `attachment; filename="lecture-bulk.pdf"; filename*=UTF-8''${encoded}`,
          'Cache-Control': 'no-store',
        },
      });
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

/** passage.number → 워터마크 숫자(없으면 원문). page.tsx 의 deriveNumber 와 동일. */
function deriveNumber(raw?: string): string {
  const s = (raw ?? '').trim();
  const m = s.match(/\d+/);
  return m ? m[0] : s;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'untitled';
}

function uniqueFilename(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (used.has(`${base} (${i})${ext}`)) i++;
  const out = `${base} (${i})${ext}`;
  used.add(out);
  return out;
}
