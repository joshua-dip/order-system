/**
 * 내신 예비시험지 — 잡 한 건을 시험지/정답과 해설 HTML 로. PDF 다운로드와 보관함 미리보기가 같이 쓴다
 * (미리보기에서 인쇄한 것과 PDF 가 같은 순서·같은 양식이 되도록).
 *
 * 정렬(order)을 넘기면 잡에 저장한다 — 채점(QR)도 그 순서를 따르므로, 미리보기에서 순서를 바꾸고
 * 브라우저로 인쇄해도 채점이 맞는다. 전부 랜덤은 jobId 기반 고정 시드, 「다시 섞기」(reshuffle)만 새 시드.
 */
import type { Db } from 'mongodb';
import {
  ensureGradeToken,
  loadExamQuestions,
  FINAL_EXAM_JOBS_COLLECTION,
  type FinalExamJobDoc,
} from './final-exam-store';
import {
  buildFinalExamSheetHtml,
  buildFinalExamAnswerHtml,
  finalExamHeader,
  type FinalExamQuestion,
} from './final-exam-html';

export type FinalExamOrder = 'default' | 'interleave' | 'shuffle';
export type FinalExamKind = 'exam' | 'answer';

/** jobId 로부터 고정 시드 — 셔플이 재진입마다 바뀌지 않도록(문제지·답지 동일 순서 보장). */
export function stableSeedFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return (h >>> 0) || 1;
}

export function parseFinalExamOrder(v: string | null): FinalExamOrder | null {
  return v === 'interleave' || v === 'shuffle' || v === 'default' ? v : null;
}

/** 정렬 옵션을 잡에 저장하고 갱신된 잡을 돌려준다 */
export async function applyFinalExamOrder(
  db: Db,
  job: FinalExamJobDoc,
  loginId: string,
  order: FinalExamOrder | null,
  reshuffle: boolean,
): Promise<FinalExamJobDoc> {
  if (!order) return job;
  const update: Record<string, unknown> = { orderMode: order, updatedAt: new Date() };
  if (order === 'shuffle') {
    if (reshuffle) update.shuffleSeed = Math.floor(Math.random() * 1_000_000_000) + 1;
    else if (typeof job.shuffleSeed !== 'number') update.shuffleSeed = stableSeedFromId(String(job._id));
  }
  await db.collection(FINAL_EXAM_JOBS_COLLECTION).updateOne({ _id: job._id, loginId }, { $set: update });
  return { ...job, ...update } as FinalExamJobDoc;
}

export type FinalExamHtmlResult =
  | { ok: true; html: string; questions: FinalExamQuestion[] }
  | { ok: false; status: number; error: string };

/**
 * 준비(ready)된 잡 → HTML.
 *  source: 지문(출처)별 — 그 지문 문항만 1번부터 재번호(회차 구분·QR 없음)
 *  baseUrl: 있으면 문제지 머리글에 채점 QR
 *  fontFaceCss: 서버 PDF 용 한글 폰트 임베드(미리보기는 브라우저 폰트로 충분해서 생략)
 */
export async function buildFinalExamHtmlForJob(
  db: Db,
  job: FinalExamJobDoc,
  opts: { kind: FinalExamKind; source?: string; baseUrl?: string; fontFaceCss?: string },
): Promise<FinalExamHtmlResult> {
  let questions = await loadExamQuestions(db, job);
  if (questions.length === 0) return { ok: false, status: 500, error: '문항을 불러오지 못했습니다.' };

  const source = (opts.source ?? '').trim();
  if (source) {
    questions = questions
      .filter((q) => q.sourceKey === source)
      .map((q, i) => ({ ...q, num: i + 1, round: undefined }));
    if (questions.length === 0) return { ok: false, status: 404, error: '해당 지문의 문항을 찾을 수 없습니다.' };
  }

  const subtitle = source ? `${source} · ${questions.length}문항` : `총 ${questions.length}문항`;
  const header = finalExamHeader({
    title: job.title,
    subtitle,
    school: job.school,
    scopeSummary: job.scopeSummary,
    createdAt: job.createdAt,
  });

  if (opts.kind === 'answer') {
    const html = buildFinalExamAnswerHtml({
      title: job.title,
      subtitle: source ? subtitle : `${job.scopeSummary} · ${subtitle}`,
      questions,
      fontFaceCss: opts.fontFaceCss,
    });
    return { ok: true, html, questions };
  }

  /* QR 채점 — 지문별은 전체 채점과 번호가 달라 QR 생략 */
  let qrDataUrl: string | undefined;
  if (!source && opts.baseUrl) {
    const token = await ensureGradeToken(db, job);
    try {
      const QRCode = (await import('qrcode')).default;
      qrDataUrl = await QRCode.toDataURL(`${opts.baseUrl}/grade/${token}`, { margin: 0, width: 240 });
    } catch (e) {
      console.error('[final-exam] QR 생성 실패:', e);
    }
  }
  const html = buildFinalExamSheetHtml({
    title: job.title,
    subtitle,
    header,
    questions,
    qrDataUrl,
    qrLabel: 'QR 스캔 → 바로 채점',
    fontFaceCss: opts.fontFaceCss,
  });
  return { ok: true, html, questions };
}

/**
 * puppeteer 페이지에서 웹폰트(나눔명조·Tinos)가 다 받아질 때까지 기다린다.
 * Lambda 가 Google Fonts 에 못 닿으면 최대 waitMs 뒤 임베드 고딕으로 그대로 찍는다.
 */
export async function waitForPaperFonts(
  page: { evaluate: <T>(fn: (ms: number) => Promise<T>, ms: number) => Promise<T> },
  waitMs = 8000,
): Promise<void> {
  try {
    await page.evaluate(
      (ms: number) =>
        Promise.race([
          (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready ?? Promise.resolve(),
          new Promise((r) => setTimeout(r, ms)),
        ]).then(() => undefined),
      waitMs,
    );
  } catch {
    /* 폰트 대기 실패는 무시 — 폴백 글꼴로 찍힌다 */
  }
}
