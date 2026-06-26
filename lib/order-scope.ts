import { parseMockExamSelections, mockExamNumberIdToLabel } from '@/lib/mock-variant-order';

/**
 * 주문 orderMeta(flow별) → 파이널 예비 모의고사 시험 범위(scope) 정규화.
 * - UV(unifiedVariant): orderMeta.dbEntries 직접
 * - MV(mockVariant): orderMeta.examSelections → mockexam dbEntries
 * - BV(bookVariant): orderMeta.selectedTextbook + selectedLessons → textbook dbEntry
 * 반환 dbEntries 는 UnifiedOrder 의 applyScopeEntries(=프리셋 복원) 가 그대로 받는다.
 */

export type OrderScopeEntry = {
  type: 'textbook' | 'mockexam';
  textbookKey: string;
  displayName: string;
  selectedSources: string[];
  textbookCategory?: string;
};

export type OrderScope = {
  dbEntries: OrderScopeEntry[];
  selectedTypes: string[];
  questionsPerTypeMap: Record<string, number>;
  orderInsertExplanation?: { 순서: boolean; 삽입: boolean };
};

function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** MV/BV 는 유형별 동일 문항수(questionsPerType: number) → 맵으로 전개. UV 는 questionsPerTypeMap 직접. */
function buildQuestionsPerTypeMap(meta: Record<string, unknown>, selectedTypes: string[]): Record<string, number> {
  const m = meta.questionsPerTypeMap;
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    if (Object.keys(out).length) return out;
  }
  const per = Number(meta.questionsPerType);
  const count = Number.isFinite(per) && per > 0 ? per : 3;
  return Object.fromEntries(selectedTypes.map((t) => [t, count]));
}

function readInsertExplanation(meta: Record<string, unknown>): { 순서: boolean; 삽입: boolean } | undefined {
  const o = meta.orderInsertExplanation;
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    const r = o as Record<string, unknown>;
    return { 순서: r.순서 !== false, 삽입: r.삽입 !== false };
  }
  return undefined;
}

export function normalizeOrderScope(meta: Record<string, unknown>): { scope: OrderScope | null; flow: string } {
  const flow = typeof meta.flow === 'string' ? meta.flow : '';
  const selectedTypes = asStrArr(meta.selectedTypes);
  const questionsPerTypeMap = buildQuestionsPerTypeMap(meta, selectedTypes);
  const orderInsertExplanation = readInsertExplanation(meta);
  const wrap = (dbEntries: OrderScopeEntry[]): { scope: OrderScope | null; flow: string } => ({
    scope: dbEntries.length ? { dbEntries, selectedTypes, questionsPerTypeMap, orderInsertExplanation } : null,
    flow,
  });

  if (flow === 'unifiedVariant') {
    const raw = Array.isArray(meta.dbEntries) ? (meta.dbEntries as Record<string, unknown>[]) : [];
    const dbEntries = raw
      .map((e): OrderScopeEntry | null => {
        const type = e.type === 'mockexam' ? 'mockexam' : e.type === 'textbook' ? 'textbook' : null;
        const textbookKey = String(e.textbookKey ?? '').trim();
        if (!type || !textbookKey) return null;
        const entry: OrderScopeEntry = {
          type,
          textbookKey,
          displayName: String(e.displayName ?? textbookKey).trim(),
          selectedSources: asStrArr(e.selectedSources),
        };
        if (type === 'textbook' && typeof e.textbookCategory === 'string') entry.textbookCategory = e.textbookCategory;
        return entry;
      })
      .filter((x): x is OrderScopeEntry => x !== null);
    return wrap(dbEntries);
  }

  if (flow === 'mockVariant') {
    const sels = parseMockExamSelections(meta.examSelections);
    return wrap(
      sels.map((s) => ({
        type: 'mockexam',
        textbookKey: s.exam,
        displayName: s.exam,
        selectedSources: s.numbers.map((id) => `${s.exam} ${mockExamNumberIdToLabel(id)}`),
      })),
    );
  }

  if (flow === 'bookVariant') {
    const tb = String(meta.selectedTextbook ?? '').trim();
    const isSolbook = !!meta.solbook && typeof meta.solbook === 'object';
    return wrap(
      tb
        ? [{
            type: 'textbook',
            textbookKey: tb,
            displayName: tb,
            selectedSources: asStrArr(meta.selectedLessons),
            textbookCategory: isSolbook ? 'solbook-suppl' : 'supplement',
          }]
        : [],
    );
  }

  return { scope: null, flow };
}
