/**
 * 클래스키트 다운로드 옵션 프리셋 (localStorage).
 * 「개별 선택」으로 고른 지문 ID 묶음을 교재명 단위로 저장 → 다음 번에 한 번에 복원.
 *
 * - 키: STORAGE_KEY, 값: { [textbook]: ClassKitDownloadPreset[] }
 * - 한 교재당 프리셋 최대 8개. 같은 이름 저장 시 덮어쓰기 + 최신화.
 * - `mode` / `format` 은 lesson 전용 메타. lecture 는 미사용.
 */

export interface ClassKitDownloadPreset {
  /** 클라이언트에서 만든 단순 id (Date.now() + 랜덤). */
  id: string;
  /** 사용자가 붙인 이름. 최대 30자. */
  name: string;
  /** 저장 시 적용된 scope — 복원 시 그대로 적용. */
  scope: 'manual' | 'range' | 'all' | 'current';
  passageIds?: string[];
  rangeFrom?: string;
  rangeTo?: string;
  /** lesson 전용. */
  mode?: string;
  /** 출력 형식. */
  format?: 'pdf' | 'zip';
  /** 마지막 저장/갱신 시각 (ISO). */
  savedAt: string;
}

const STORAGE_KEY = 'class_kit_download_presets_v1';
const MAX_PER_TEXTBOOK = 8;

type Store = Record<string, ClassKitDownloadPreset[]>;

function readStore(): Store {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(s: Store): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota / 비공개모드 */
  }
}

export function loadPresetsForTextbook(textbook: string): ClassKitDownloadPreset[] {
  const tb = (textbook ?? '').trim();
  if (!tb) return [];
  const store = readStore();
  const list = store[tb];
  return Array.isArray(list) ? list : [];
}

/** 같은 name 이 있으면 덮어쓰기. 없으면 추가. 최대 MAX_PER_TEXTBOOK 유지(오래된 항목 제거). */
export function savePresetForTextbook(
  textbook: string,
  preset: Omit<ClassKitDownloadPreset, 'savedAt'>,
): ClassKitDownloadPreset {
  const tb = (textbook ?? '').trim();
  const stored: ClassKitDownloadPreset = { ...preset, savedAt: new Date().toISOString() };
  if (!tb) return stored;
  const store = readStore();
  const list = Array.isArray(store[tb]) ? [...store[tb]] : [];
  const sameNameIdx = list.findIndex((p) => p.name === stored.name);
  if (sameNameIdx >= 0) {
    list[sameNameIdx] = { ...stored, id: list[sameNameIdx].id };
  } else {
    list.push(stored);
  }
  // 최신순 정렬 + 상한 유지
  list.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  store[tb] = list.slice(0, MAX_PER_TEXTBOOK);
  writeStore(store);
  return stored;
}

export function deletePresetForTextbook(textbook: string, id: string): void {
  const tb = (textbook ?? '').trim();
  if (!tb) return;
  const store = readStore();
  const list = Array.isArray(store[tb]) ? store[tb] : [];
  store[tb] = list.filter((p) => p.id !== id);
  writeStore(store);
}

export function newPresetId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
