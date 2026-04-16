const STORAGE_KEY = 'bookVariantOrderPresets_v1';
const MAX_PRESETS = 24;

export type BookVariantPresetPayloadV1 = {
  v: 1;
  selectedTypes: string[];
  orderInsertExplanation: { 순서: boolean; 삽입: boolean };
  questionsPerType: number;
  email: string;
  useCustomHwp: boolean;
  hwpStorageModes: string[];
  usePoints: boolean;
  pointsToUse: number;
};

export type BookVariantPresetRow = {
  id: string;
  name: string;
  savedAt: number;
  /** 저장 시점 교재 — 적용 시 현재와 다르면 확인 */
  textbookAtSave: string;
  payload: BookVariantPresetPayloadV1;
};

type StoredShape = { presets: BookVariantPresetRow[] };

function safeParse(raw: string | null): StoredShape {
  if (!raw) return { presets: [] };
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object' || !Array.isArray((o as StoredShape).presets)) return { presets: [] };
    return { presets: (o as StoredShape).presets.filter(isValidRow) };
  } catch {
    return { presets: [] };
  }
}

function isValidRow(x: unknown): x is BookVariantPresetRow {
  if (!x || typeof x !== 'object') return false;
  const r = x as BookVariantPresetRow;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.savedAt !== 'number') return false;
  if (typeof r.textbookAtSave !== 'string') return false;
  const p = r.payload;
  if (!p || typeof p !== 'object' || p.v !== 1) return false;
  if (!Array.isArray(p.selectedTypes)) return false;
  if (typeof p.questionsPerType !== 'number') return false;
  if (typeof p.email !== 'string') return false;
  if (typeof p.useCustomHwp !== 'boolean') return false;
  if (!Array.isArray(p.hwpStorageModes)) return false;
  if (!p.orderInsertExplanation || typeof p.orderInsertExplanation !== 'object') return false;
  const oi = p.orderInsertExplanation as { 순서?: unknown; 삽입?: unknown };
  if (typeof oi.순서 !== 'boolean' || typeof oi.삽입 !== 'boolean') return false;
  if (typeof p.usePoints !== 'boolean') return false;
  if (typeof p.pointsToUse !== 'number') return false;
  return true;
}

export function loadBookVariantPresets(): BookVariantPresetRow[] {
  if (typeof window === 'undefined') return [];
  return safeParse(window.localStorage.getItem(STORAGE_KEY)).presets;
}

function writeAll(presets: BookVariantPresetRow[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ presets }));
}

export function saveBookVariantPreset(
  name: string,
  textbookAtSave: string,
  payload: BookVariantPresetPayloadV1
): BookVariantPresetRow {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) throw new Error('이름을 입력해 주세요.');

  const id =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const row: BookVariantPresetRow = {
    id,
    name: trimmed,
    savedAt: Date.now(),
    textbookAtSave,
    payload,
  };

  const prev = loadBookVariantPresets();
  const withoutDupName = prev.filter((p) => p.name !== trimmed);
  const next = [row, ...withoutDupName].slice(0, MAX_PRESETS);
  writeAll(next);
  return row;
}

export function deleteBookVariantPreset(id: string): void {
  const prev = loadBookVariantPresets();
  writeAll(prev.filter((p) => p.id !== id));
}
