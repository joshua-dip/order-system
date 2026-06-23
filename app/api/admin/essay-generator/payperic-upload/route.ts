import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { requireAdmin } from '@/lib/admin-auth';
import { listEssayExamsByTextbook } from '@/lib/essay-exams-store';
import {
  buildEssayBatchManifest,
  manifestTitles,
  type EssayProductSpec,
} from '@/lib/payperic-essay-manifest';
import { renderEssayGroupsToPdfs } from '@/lib/essay-pdf-render';
import {
  paypericConfigured,
  paypericStatus,
  paypericUploadOne,
  type IngestMeta,
} from '@/lib/payperic-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** 동시성 제한 map. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function metaOf(spec: EssayProductSpec, batchKey: string, overwrite: boolean): Omit<IngestMeta, 's3Key' | 'originalFileName' | 'fileSize'> {
  return {
    title: spec.title,
    description: spec.description,
    price: spec.price,
    originalPrice: spec.originalPrice,
    category: spec.category,
    tags: spec.tags,
    isFree: spec.isFree,
    batchKey,
    overwrite,
  };
}

/**
 * GET ?textbook=...  — 적재 상태(어떤 상품이 payperic 에 이미 있나).
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  if (!paypericConfigured()) {
    return NextResponse.json({ ok: false, error: 'payperic 연동 미설정 (PAYPERIC_INGEST_URL/SECRET)' }, { status: 503 });
  }

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim();
  if (!textbook) {
    return NextResponse.json({ ok: false, error: 'textbook 필요' }, { status: 400 });
  }

  let manifest;
  try {
    const exams = await listEssayExamsByTextbook(textbook);
    manifest = buildEssayBatchManifest(textbook, exams);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, notMock: true }, { status: 400 });
  }

  const allSpecs: EssayProductSpec[] = [...manifest.products, ...(manifest.fullset ? [manifest.fullset] : [])];
  if (allSpecs.length === 0) {
    return NextResponse.json({ ok: true, textbook, total: 0, uploaded: 0, items: [] });
  }

  try {
    const existing = await paypericStatus(manifestTitles(manifest));
    const byTitle = new Map(existing.map((e) => [e.title, e]));
    const items = allSpecs.map((s) => {
      const e = byTitle.get(s.title);
      return {
        title: s.title,
        kind: s.kind,
        exists: !!e,
        price: e?.price ?? s.price,
        isActive: e?.isActive ?? null,
        isFree: s.isFree,
      };
    });
    const uploaded = items.filter((i) => i.exists).length;
    return NextResponse.json({
      ok: true,
      textbook,
      total: items.length,
      uploaded,
      missing: items.filter((i) => !i.exists).map((i) => i.title),
      items,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `payperic 상태조회 실패: ${(e as Error).message}` }, { status: 502 });
  }
}

/**
 * POST { textbook, overwrite? } — 교재의 조건영작배열을 payperic 상품으로 적재.
 *
 * 번호별/난도별 PDF 를 렌더 → 풀세트 ZIP 구성 → presign→S3 PUT→상품 생성.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  if (!paypericConfigured()) {
    return NextResponse.json({ ok: false, error: 'payperic 연동 미설정 (PAYPERIC_INGEST_URL/SECRET)' }, { status: 503 });
  }

  let body: { textbook?: string; overwrite?: boolean };
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: '요청 형식 오류' }, { status: 400 });
  }
  const textbook = String(body.textbook ?? '').trim();
  const overwrite = body.overwrite === true;
  if (!textbook) {
    return NextResponse.json({ ok: false, error: 'textbook 필요' }, { status: 400 });
  }

  let manifest;
  try {
    const exams = await listEssayExamsByTextbook(textbook);
    manifest = buildEssayBatchManifest(textbook, exams);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, notMock: true }, { status: 400 });
  }

  if (manifest.products.length === 0) {
    return NextResponse.json({ ok: false, error: '이 교재에 조건영작배열 문항이 없습니다.' }, { status: 400 });
  }

  // 1) 번호별 + 난도별 그룹 PDF 렌더 (그룹당 단일 PDF — chunkSize 크게).
  const groups = manifest.products.map((p) => p.group!).filter(Boolean);
  let rendered;
  try {
    rendered = await renderEssayGroupsToPdfs(groups, { chunkSize: 1000 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `PDF 렌더 실패: ${(e as Error).message}` }, { status: 500 });
  }
  const pdfByGroupName = new Map<string, Buffer>();
  for (const r of rendered) {
    if (r.pdfs.length > 0) pdfByGroupName.set(r.name, Buffer.concat(r.pdfs));
  }

  // 2) 풀세트 ZIP 구성 (난이도별/ + 번호별/).
  let fullsetZip: Buffer | null = null;
  if (manifest.fullset) {
    const zip = new JSZip();
    for (const spec of manifest.products) {
      const pdf = spec.group ? pdfByGroupName.get(spec.group.name) : undefined;
      if (!pdf) continue;
      const dir = spec.kind === 'difficulty' ? '난이도별' : '번호별';
      zip.file(`${dir}/${spec.fileLabel}.pdf`, pdf);
    }
    const bytes = (await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })) as Uint8Array;
    fullsetZip = Buffer.from(bytes);
  }

  // 3) 업로드 작업 목록 구성.
  type Job = { spec: EssayProductSpec; data: Buffer | null };
  const jobs: Job[] = manifest.products.map((spec) => ({
    spec,
    data: spec.group ? pdfByGroupName.get(spec.group.name) ?? null : null,
  }));
  if (manifest.fullset) jobs.push({ spec: manifest.fullset, data: fullsetZip });

  // 4) 동시성 4 로 적재.
  const results = await mapLimit(jobs, 4, async ({ spec, data }) => {
    if (!data || data.length === 0) {
      return { title: spec.title, kind: spec.kind, ok: false, error: '렌더된 PDF 없음(문항 누락)' };
    }
    try {
      const fileName = `${spec.fileLabel}.${spec.ext}`;
      const r = await paypericUploadOne(data, fileName, metaOf(spec, manifest.batchKey, overwrite));
      return { title: spec.title, kind: spec.kind, ok: true, action: r.action, productId: r.productId };
    } catch (e) {
      return { title: spec.title, kind: spec.kind, ok: false, error: (e as Error).message };
    }
  });

  const summary = {
    created: results.filter((r) => r.ok && r.action === 'created').length,
    updated: results.filter((r) => r.ok && r.action === 'updated').length,
    skipped: results.filter((r) => r.ok && r.action === 'skipped').length,
    failed: results.filter((r) => !r.ok).length,
  };

  return NextResponse.json({ ok: summary.failed === 0, textbook, batchKey: manifest.batchKey, summary, results });
}
