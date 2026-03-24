import { ObjectId } from 'mongodb';

/**
 * 변형문 초안(generate-draft)과 동일한 우선순위로 passages 본문 추출.
 * original·mixed만 쓰면 translation만 채워진 문서에서 원문이 비어 변형도가 항상 100%가 될 수 있음.
 */
export function getPassageTextForVariantCompare(content: unknown): string {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return '';
  const c = content as {
    original?: unknown;
    mixed?: unknown;
    translation?: unknown;
  };
  const orig = typeof c.original === 'string' ? c.original.trim() : '';
  const mix = typeof c.mixed === 'string' ? c.mixed.trim() : '';
  const tr = typeof c.translation === 'string' ? c.translation.trim() : '';
  return orig || mix || tr || '';
}

/** generated_questions.passage_id → passages._id 조회용 24자 hex */
export function passageIdToValidHex(raw: unknown): string {
  if (raw == null) return '';
  if (raw instanceof ObjectId) return raw.toString();
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!ObjectId.isValid(s)) return '';
    try {
      return new ObjectId(s).toString();
    } catch {
      return '';
    }
  }
  return '';
}
