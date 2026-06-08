import type { VocabularyEntry } from './passage-analyzer-types';
import type { UserVocabularySerialized } from './vocabulary-library-types';

/** localStorage 키 — 브라우저(기기)별 체험 단어장 */
export const GUEST_VOCABULARY_LS_KEY = 'guest_vocabularies_v1';

export type GuestVocabularySerialized = UserVocabularySerialized & {
  login_id: 'guest';
};

/** URL 경로 안전 — 콜론(`guest:`)은 Next 동적 세그먼트에서 깨질 수 있음 */
export function guestVocabularyId(passageId: string): string {
  return `guest-${passageId}`;
}

export function isGuestVocabularyId(id: string): boolean {
  return id.startsWith('guest-') || id.startsWith('guest:');
}

function normalizeGuestId(id: string): string {
  if (id.startsWith('guest:')) return `guest-${id.slice('guest:'.length)}`;
  return id;
}

export function loadGuestVocabularies(): GuestVocabularySerialized[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(GUEST_VOCABULARY_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed
      .filter(
        (x): x is GuestVocabularySerialized =>
          x != null &&
          typeof x === 'object' &&
          typeof (x as GuestVocabularySerialized)._id === 'string' &&
          isGuestVocabularyId((x as GuestVocabularySerialized)._id),
      )
      .map((x) => {
        const nid = normalizeGuestId(x._id);
        return nid === x._id ? x : { ...x, _id: nid };
      });
    if (normalized.some((x, i) => x._id !== (parsed[i] as GuestVocabularySerialized)?._id)) {
      persistGuestVocabularies(normalized);
    }
    return normalized;
  } catch {
    return [];
  }
}

function persistGuestVocabularies(items: GuestVocabularySerialized[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(GUEST_VOCABULARY_LS_KEY, JSON.stringify(items));
}

export function upsertGuestVocabularies(incoming: GuestVocabularySerialized[]): GuestVocabularySerialized[] {
  const map = new Map<string, GuestVocabularySerialized>();
  for (const item of loadGuestVocabularies()) map.set(item._id, item);
  for (const item of incoming) map.set(item._id, item);
  const merged = [...map.values()].sort(
    (a, b) => new Date(b.last_edited_at).getTime() - new Date(a.last_edited_at).getTime(),
  );
  persistGuestVocabularies(merged);
  return merged;
}

export function getGuestVocabulary(id: string): GuestVocabularySerialized | null {
  const nid = normalizeGuestId(id);
  return loadGuestVocabularies().find((x) => x._id === nid || x._id === id) ?? null;
}

export function updateGuestVocabularyList(id: string, vocabularyList: VocabularyEntry[]): boolean {
  const items = loadGuestVocabularies();
  const idx = items.findIndex((x) => x._id === id);
  if (idx < 0) return false;
  items[idx] = {
    ...items[idx],
    vocabulary_list: vocabularyList,
    last_edited_at: new Date().toISOString(),
  };
  persistGuestVocabularies(items);
  return true;
}

export function resetGuestVocabulary(id: string): GuestVocabularySerialized | null {
  const items = loadGuestVocabularies();
  const idx = items.findIndex((x) => x._id === id);
  if (idx < 0) return null;
  items[idx] = {
    ...items[idx],
    vocabulary_list: items[idx].original_snapshot,
    last_edited_at: new Date().toISOString(),
  };
  persistGuestVocabularies(items);
  return items[idx];
}

export function removeGuestVocabulary(id: string): void {
  persistGuestVocabularies(loadGuestVocabularies().filter((x) => x._id !== id));
}
