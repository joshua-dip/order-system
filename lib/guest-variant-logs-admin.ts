import { ObjectId } from 'mongodb';

/** 관리자 API 공통 — URLSearchParams → MongoDB filter (loose typing) */
export function buildGuestLogsFilter(sp: URLSearchParams): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const ms = sp.get('match_status')?.trim();
  if (ms === 'matched' || ms === 'unknown') filter.match_status = ms;

  const type = sp.get('type')?.trim();
  if (type) filter.type = type;

  const textbook = sp.get('textbook')?.trim();
  if (textbook) filter.textbook = textbook;

  const ipHash = sp.get('ip_hash')?.trim();
  if (ipHash) filter.ip_hash = ipHash;

  const tag = sp.get('tag')?.trim();
  if (tag) filter.tags = tag;

  const archivedParam = sp.get('archived')?.trim();
  if (archivedParam === '1' || archivedParam === 'true') filter.archived = true;
  else if (archivedParam === '0' || archivedParam === 'false') {
    filter.archived = { $ne: true };
  }

  const promotedParam = sp.get('promoted')?.trim();
  if (promotedParam === '1' || promotedParam === 'true') {
    filter.promoted_to = { $exists: true };
  } else if (promotedParam === '0' || promotedParam === 'false') {
    filter.promoted_to = { $exists: false };
  }

  const q = sp.get('q')?.trim();
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.input_paragraph = { $regex: escaped, $options: 'i' };
  }

  const from = sp.get('from')?.trim();
  const to = sp.get('to')?.trim();
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) range.$gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) range.$lte = d;
    }
    if (Object.keys(range).length > 0) {
      filter.created_at = range;
    }
  }

  return filter;
}


/** 직렬화 — _id, ObjectId, Date 변환 */
export function serializeGuestLog(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...doc };
  for (const [k, v] of Object.entries(out)) {
    if (v instanceof ObjectId) out[k] = String(v);
    else if (v instanceof Date) out[k] = v.toISOString();
  }
  return out;
}
