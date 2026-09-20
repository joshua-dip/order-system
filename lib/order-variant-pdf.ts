import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { renderHtmlEntriesToZip } from '@/lib/chromium-pdf';
import { splitQuestionOptionSegments } from '@/lib/question-options-segments';
import {
  buildVariantPrintHtml,
  normalizeVariantPrintFormat,
  variantTypePrintName,
  type VariantPrintFormat,
  type VariantPrintQuestion,
} from '@/lib/variant-print-html';
import {
  bundleTypeOrder,
  compareSourceLabel,
  fetchOrderBundles,
  fetchOrderQuestions,
  resolveOrderQuestionScope,
  type BundleTypeOrder,
  type OrderQuestionRow,
  type OrderQuestionScope,
  type OrderScopeTarget,
} from '@/lib/order-answer-sequence';
import {
  sanitizeHwpStorageModes,
  type HwpStorageModeKey,
} from '@/lib/variant-order-options';

/**
 * 주문 → 회원 인쇄 양식 PDF ZIP (cc:order-pdf 와 동일 조판).
 * 관리자 화면에서 바로 내려받기용 — 회차별·번호별·카테고리별·통합본 분할.
 */

type Doc = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** PDF 분할 모드 (HWP 저장 방식과 맞춘 이름) */
export type OrderPdfSplitMode =
  | 'byCategory'
  | 'byRound'
  | 'bySourceNumber'
  | 'singleFull'
  | 'byRoundCategory';

/** @deprecated → OrderPdfSplitMode. API 하위호환 */
export type OrderVariantPdfBy = 'type' | 'round' | 'round-type' | 'source' | 'full';

export const ORDER_PDF_SPLIT_OPTIONS: readonly {
  key: OrderPdfSplitMode;
  label: string;
  folder: string;
  hint: string;
}[] = [
  { key: 'byCategory', label: '카테고리별', folder: '카테고리별', hint: '문제 유형마다 파일' },
  { key: 'byRound', label: '회차별', folder: '회차별', hint: '회차마다 통합본 파일' },
  { key: 'bySourceNumber', label: '번호별', folder: '번호별', hint: '지문 번호마다 파일' },
  { key: 'singleFull', label: '통합본', folder: '통합본', hint: '주문 전체를 한 파일' },
  { key: 'byRoundCategory', label: '회차×유형', folder: '회차별_유형별', hint: '회차마다 유형별 낱장' },
] as const;

const HWP_TO_PDF: Partial<Record<HwpStorageModeKey, OrderPdfSplitMode>> = {
  byCategory: 'byCategory',
  byRound: 'byRound',
  bySourceNumber: 'bySourceNumber',
  singleFull: 'singleFull',
  /* 강별은 PDF에 아직 없음 — 카테고리별로 대체하지 않고 건너뜀 */
};

export function parseOrderPdfSplitModes(raw: string | null | undefined): OrderPdfSplitMode[] {
  if (!raw || !raw.trim()) return [];
  const allowed = new Set(ORDER_PDF_SPLIT_OPTIONS.map((o) => o.key));
  const out: OrderPdfSplitMode[] = [];
  for (const part of raw.split(/[,+\s]+/)) {
    const t = part.trim();
    if (!t) continue;
    /* 구 API by=type|round|round-type|source|full */
    const mapped: OrderPdfSplitMode | null =
      t === 'type' || t === 'byCategory'
        ? 'byCategory'
        : t === 'round' || t === 'byRound'
          ? 'byRound'
          : t === 'round-type' || t === 'byRoundCategory'
            ? 'byRoundCategory'
            : t === 'source' || t === 'bySourceNumber'
              ? 'bySourceNumber'
              : t === 'full' || t === 'singleFull'
                ? 'singleFull'
                : allowed.has(t as OrderPdfSplitMode)
                  ? (t as OrderPdfSplitMode)
                  : null;
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/** 주문서 HWP 저장 방식 → PDF 분할 모드 (지원되는 것만) */
export function orderPdfModesFromHwpStorage(raw: unknown): OrderPdfSplitMode[] {
  const modes = sanitizeHwpStorageModes(raw);
  const out: OrderPdfSplitMode[] = [];
  for (const m of modes) {
    const pdf = HWP_TO_PDF[m];
    if (pdf && !out.includes(pdf)) out.push(pdf);
  }
  return out.length > 0 ? out : ['byCategory'];
}

export type OrderVariantPdfResult =
  | {
      ok: true;
      zip: Buffer;
      orderNumber: string;
      fileCount: number;
      questionCount: number;
      missingSlots: number;
      modes: OrderPdfSplitMode[];
    }
  | { ok: false; status: number; error: string };

function toPrintQuestion(r: OrderQuestionRow, label: string): VariantPrintQuestion {
  return {
    source: label,
    question: str(r.qd.Question),
    paragraph: str(r.qd.Paragraph),
    options: splitQuestionOptionSegments(str(r.qd.Options)),
    correctAnswer: r.answer,
    explanation: str(r.qd.Explanation ?? r.qd['해설']),
  };
}

function entryHtml(
  format: VariantPrintFormat,
  title: string,
  subtitle: string,
  questions: VariantPrintQuestion[],
): string {
  return buildVariantPrintHtml({
    title,
    subtitle,
    brand: format.brand,
    questions,
    includeAnswers: format.includeAnswers,
  });
}

function folderPrefix(mode: OrderPdfSplitMode, multi: boolean): string {
  if (!multi) return '';
  const label = ORDER_PDF_SPLIT_OPTIONS.find((o) => o.key === mode)?.folder ?? mode;
  return `${label}/`;
}

async function collectByType(
  db: Db,
  scope: OrderQuestionScope,
  target: OrderScopeTarget,
): Promise<{ byType: Map<string, OrderQuestionRow[]>; missing: number }> {
  const byType = new Map<string, OrderQuestionRow[]>();
  let missing = 0;
  for (const type of scope.types) {
    const per = scope.perType(type);
    const rows = await fetchOrderQuestions(db, target, type, { statuses: ['완료'], perSource: per });
    const have = new Map<string, number>();
    for (const r of rows) have.set(r.source, (have.get(r.source) ?? 0) + 1);
    missing += target.sources.filter((s) => (have.get(s) ?? 0) < per).length;
    byType.set(type, rows);
  }
  return { byType, missing };
}

/** 카테고리별 — 유형마다 파일 (회원 splitByType 설정과 무관하게 유형 분할) */
async function buildCategoryEntries(
  db: Db,
  scope: OrderQuestionScope,
  format: VariantPrintFormat,
  target: OrderScopeTarget,
  title: string,
  prefix: string,
): Promise<{ entries: { fileName: string; html: string }[]; missing: number; questions: number }> {
  const { byType, missing } = await collectByType(db, scope, target);
  const entries: { fileName: string; html: string }[] = [];
  let questions = 0;
  for (const [type, rows] of byType) {
    if (!rows.length) continue;
    const typeName = variantTypePrintName(type, format.hardSuffix);
    questions += rows.length;
    entries.push({
      fileName: `${prefix}${target.label} ${typeName}.pdf`,
      html: entryHtml(
        format,
        `${title} · ${typeName}`,
        `${title} · 총 ${rows.length}문항`,
        rows.map((r) => toPrintQuestion(r, r.source)),
      ),
    });
  }
  return { entries, missing, questions };
}

/** 번호별 — 지문(source)마다 파일, 그 안 유형은 전부 */
async function buildSourceNumberEntries(
  db: Db,
  scope: OrderQuestionScope,
  format: VariantPrintFormat,
  target: OrderScopeTarget,
  title: string,
  prefix: string,
  typeOrder: BundleTypeOrder,
): Promise<{ entries: { fileName: string; html: string }[]; missing: number; questions: number }> {
  const types = bundleTypeOrder(scope.types, typeOrder);
  const bySource = new Map<string, VariantPrintQuestion[]>();
  let missing = 0;
  let questions = 0;

  for (const type of types) {
    const per = scope.perType(type);
    const rows = await fetchOrderQuestions(db, target, type, { statuses: ['완료'], perSource: per });
    const have = new Map<string, number>();
    for (const r of rows) have.set(r.source, (have.get(r.source) ?? 0) + 1);
    missing += target.sources.filter((s) => (have.get(s) ?? 0) < per).length;
    const typeName = variantTypePrintName(type, format.hardSuffix);
    for (const r of rows) {
      const list = bySource.get(r.source) ?? [];
      list.push(toPrintQuestion(r, typeName));
      bySource.set(r.source, list);
    }
  }

  const entries: { fileName: string; html: string }[] = [];
  for (const source of [...bySource.keys()].sort(compareSourceLabel)) {
    const qs = bySource.get(source)!;
    if (!qs.length) continue;
    questions += qs.length;
    entries.push({
      fileName: `${prefix}${source}.pdf`,
      html: entryHtml(format, `${title} · ${source}`, `${source} · 총 ${qs.length}문항`, qs),
    });
  }
  return { entries, missing, questions };
}

/** 통합본 — 주문 범위(교재) 전체를 한 파일 */
async function buildSingleFullEntries(
  db: Db,
  scope: OrderQuestionScope,
  format: VariantPrintFormat,
  target: OrderScopeTarget,
  title: string,
  prefix: string,
  typeOrder: BundleTypeOrder,
): Promise<{ entries: { fileName: string; html: string }[]; missing: number; questions: number }> {
  const types = bundleTypeOrder(scope.types, typeOrder);
  const all: VariantPrintQuestion[] = [];
  let missing = 0;
  for (const type of types) {
    const per = scope.perType(type);
    const rows = await fetchOrderQuestions(db, target, type, { statuses: ['완료'], perSource: per });
    const have = new Map<string, number>();
    for (const r of rows) have.set(r.source, (have.get(r.source) ?? 0) + 1);
    missing += target.sources.filter((s) => (have.get(s) ?? 0) < per).length;
    const typeName = variantTypePrintName(type, format.hardSuffix);
    for (const r of rows) {
      all.push(toPrintQuestion(r, `${r.source} · ${typeName}`));
    }
  }
  if (!all.length) return { entries: [], missing, questions: 0 };
  return {
    entries: [
      {
        fileName: `${prefix}${target.label} 통합본.pdf`,
        html: entryHtml(format, `${title} 통합본`, `${title} · 총 ${all.length}문항`, all),
      },
    ],
    missing,
    questions: all.length,
  };
}

async function buildRoundTypeEntries(
  db: Db,
  scope: OrderQuestionScope,
  format: VariantPrintFormat,
  target: OrderScopeTarget,
  typeOrder: BundleTypeOrder,
  prefix: string,
): Promise<{ entries: { fileName: string; html: string }[]; missing: number; questions: number }> {
  let missing = 0;
  let questions = 0;
  const entries: { fileName: string; html: string }[] = [];
  for (const b of await fetchOrderBundles(db, target, scope, { statuses: ['완료'], typeOrder })) {
    const roundTarget: OrderScopeTarget = {
      textbook: target.textbook,
      sources: b.sources,
      label: b.round || target.label,
    };
    const title = b.round ? `${target.textbook} ${b.round}` : target.textbook;
    const part = await buildCategoryEntries(db, scope, format, roundTarget, title, prefix);
    missing += part.missing;
    questions += part.questions;
    entries.push(...part.entries);
  }
  return { entries, missing, questions };
}

async function buildRoundEntries(
  db: Db,
  scope: OrderQuestionScope,
  format: VariantPrintFormat,
  target: OrderScopeTarget,
  typeOrder: BundleTypeOrder,
  prefix: string,
): Promise<{ entries: { fileName: string; html: string }[]; missing: number; questions: number }> {
  const types = bundleTypeOrder(scope.types, typeOrder);
  const kinds = types.every((t) => /-고난도$/.test(t)) ? `고난도 ${types.length}유형` : `${types.length}유형`;
  const shortSource = (s: string): string =>
    s.startsWith(`${target.textbook} `) ? s.slice(target.textbook.length + 1) : s;

  let missing = 0;
  let questions = 0;
  const entries: { fileName: string; html: string }[] = [];

  for (const b of await fetchOrderBundles(db, target, scope, { statuses: ['완료'], typeOrder })) {
    const scopeName = b.round ? `${target.textbook} ${b.round}` : target.textbook;
    for (const type of types) {
      const per = scope.perType(type);
      const have = new Map<string, number>();
      for (const r of b.rows) if (r.type === type) have.set(r.source, (have.get(r.source) ?? 0) + 1);
      missing += b.sources.filter((s) => (have.get(s) ?? 0) < per).length;
    }
    if (!b.rows.length) continue;
    questions += b.rows.length;
    entries.push({
      fileName: `${prefix}${b.round ? b.round.replace(/^0+(?=\d)/, '') : target.textbook} 통합본.pdf`,
      html: entryHtml(
        format,
        `${scopeName} 통합본`,
        `${scopeName} · 총 ${b.rows.length}문항 (${kinds})`,
        b.rows.map((r) =>
          toPrintQuestion(r, `${shortSource(r.source)} · ${variantTypePrintName(r.type, format.hardSuffix)}`),
        ),
      ),
    });
  }
  return { entries, missing, questions };
}

async function buildModeEntries(
  db: Db,
  scope: OrderQuestionScope,
  format: VariantPrintFormat,
  target: OrderScopeTarget,
  title: string,
  mode: OrderPdfSplitMode,
  typeOrder: BundleTypeOrder,
  multi: boolean,
): Promise<{ entries: { fileName: string; html: string }[]; missing: number; questions: number }> {
  const prefix = folderPrefix(mode, multi);
  switch (mode) {
    case 'byCategory':
      return buildCategoryEntries(db, scope, format, target, title, prefix);
    case 'bySourceNumber':
      return buildSourceNumberEntries(db, scope, format, target, title, prefix, typeOrder);
    case 'singleFull':
      return buildSingleFullEntries(db, scope, format, target, title, prefix, typeOrder);
    case 'byRound':
      return buildRoundEntries(db, scope, format, target, typeOrder, prefix);
    case 'byRoundCategory':
      return buildRoundTypeEntries(db, scope, format, target, typeOrder, prefix);
    default:
      return buildCategoryEntries(db, scope, format, target, title, prefix);
  }
}

export async function buildOrderVariantPdfZip(input: {
  orderId?: string | null;
  orderNumber?: string | null;
  /** 구 API 단일 by — modes 가 있으면 무시 */
  by?: OrderVariantPdfBy | OrderPdfSplitMode | string | null;
  /** 복수 분할 모드 (권장) */
  modes?: OrderPdfSplitMode[] | string | null;
  /** true 면 주문서 hwpStorageModes 에서 모드 추론 */
  fromOrderHwp?: boolean;
  typeOrder?: BundleTypeOrder;
}): Promise<OrderVariantPdfResult> {
  const orderId = (input.orderId ?? '').trim();
  const orderNumber = (input.orderNumber ?? '').trim();
  if (!orderId && !orderNumber) {
    return { ok: false, status: 400, error: 'orderId 또는 orderNumber가 필요합니다.' };
  }
  if (orderId && !ObjectId.isValid(orderId)) {
    return { ok: false, status: 400, error: '유효한 orderId가 아닙니다.' };
  }

  const typeOrder: BundleTypeOrder = input.typeOrder === 'order' ? 'order' : 'exam';

  const db = await getDb('gomijoshua');
  const order = (await db.collection('orders').findOne(
    orderId ? { _id: new ObjectId(orderId) } : { orderNumber },
  )) as Doc | null;
  if (!order) {
    return { ok: false, status: 404, error: '주문을 찾을 수 없습니다.' };
  }

  const on = str(order.orderNumber) || orderId || 'order';
  const scope = resolveOrderQuestionScope(order);
  if (!scope.targets.length) {
    return { ok: false, status: 400, error: '주문 범위(교재·지문)를 읽지 못했습니다.' };
  }

  const meta = order.orderMeta && typeof order.orderMeta === 'object' ? (order.orderMeta as Doc) : null;
  let modes: OrderPdfSplitMode[] = [];
  if (typeof input.modes === 'string') {
    modes = parseOrderPdfSplitModes(input.modes);
  } else if (Array.isArray(input.modes) && input.modes.length) {
    modes = input.modes;
  } else if (input.by) {
    modes = parseOrderPdfSplitModes(String(input.by));
  } else if (input.fromOrderHwp !== false) {
    modes = orderPdfModesFromHwpStorage(meta?.hwpStorageModes);
  }
  if (modes.length === 0) modes = ['byCategory'];

  const loginId = scope.loginId;
  const user = loginId
    ? ((await db.collection('users').findOne({ loginId })) as Doc | null)
    : null;
  const format = normalizeVariantPrintFormat(user?.variantPrintFormat);

  const allEntries: { fileName: string; html: string }[] = [];
  let missingSlots = 0;
  let questionCount = 0;
  const multi = modes.length > 1;

  for (const mode of modes) {
    for (const target of scope.targets) {
      const title =
        target.label === target.textbook ? target.textbook : `${target.textbook} ${target.label}`;
      const part = await buildModeEntries(db, scope, format, target, title, mode, typeOrder, multi);
      /* 부족·문항 수는 모드마다 같은 재고를 다시 세므로 첫 모드만 집계 */
      if (mode === modes[0]) {
        missingSlots += part.missing;
        questionCount += part.questions;
      }
      allEntries.push(...part.entries);
    }
  }

  if (allEntries.length === 0) {
    return {
      ok: false,
      status: 404,
      error:
        missingSlots > 0
          ? `완료 문항이 없어 PDF를 만들 수 없습니다. (부족 슬롯 ${missingSlots})`
          : '인쇄할 완료 문항이 없습니다.',
    };
  }

  const zip = await renderHtmlEntriesToZip(allEntries, {
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    zipFolder: on,
  });

  return {
    ok: true,
    zip,
    orderNumber: on,
    fileCount: allEntries.length,
    questionCount,
    missingSlots,
    modes,
  };
}
