import { ObjectId, type Document } from 'mongodb';

export type ListDataScope = 'variant' | 'narrative' | 'all';

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** narrative_questions용 필터 (variant와 동일한 쿼리 파라미터 의미로 매핑) */
export function buildNarrativeQuestionsFilter(opts: {
  textbook: string;
  type: string;
  passageIdHex: string;
  q: string;
}): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (opts.textbook) filter.textbook = opts.textbook;
  if (opts.type) filter.narrative_subtype = opts.type;
  if (opts.passageIdHex && ObjectId.isValid(opts.passageIdHex)) {
    filter.passage_id = new ObjectId(opts.passageIdHex);
  }
  if (opts.q) {
    const rx = escapeRegex(opts.q);
    filter.$or = [
      { source_file: { $regex: rx, $options: 'i' } },
      { source_key_matched: { $regex: rx, $options: 'i' } },
      { 'question_data.문제': { $regex: rx, $options: 'i' } },
      { 'question_data.본문': { $regex: rx, $options: 'i' } },
      { 'question_data.원문': { $regex: rx, $options: 'i' } },
      { 'question_data.해설': { $regex: rx, $options: 'i' } },
      { 'question_data.모범답안': { $regex: rx, $options: 'i' } },
      { narrative_subtype: { $regex: rx, $options: 'i' } },
    ];
  }
  return filter;
}

export function mapNarrativeDocToListRow(d: Document) {
  const qd = (d.question_data || {}) as Record<string, unknown>;
  const question = typeof qd['문제'] === 'string' ? qd['문제'] : '';
  const para =
    typeof qd['본문'] === 'string'
      ? qd['본문']
      : typeof qd['원문'] === 'string'
        ? qd['원문']
        : '';
  const expl = typeof qd['해설'] === 'string' ? qd['해설'] : '';
  const optsText = typeof qd['모범답안'] === 'string' ? qd['모범답안'] : '';
  const cat = typeof qd['문제유형'] === 'string' ? qd['문제유형'] : '';
  const numQ = typeof qd['번호'] === 'number' ? qd['번호'] : undefined;
  const src =
    (typeof d.source_key_matched === 'string' && d.source_key_matched.trim()) ||
    (typeof d.source_file === 'string' && d.source_file.trim()) ||
    '';
  const created = d.created_at;
  let created_at: string | null = null;
  if (created instanceof Date) created_at = created.toISOString();
  else if (typeof created === 'string') created_at = created;

  return {
    _id: String(d._id),
    textbook: String(d.textbook ?? ''),
    passage_id: d.passage_id ? String(d.passage_id) : null,
    source: src,
    type: String(d.narrative_subtype ?? ''),
    option_type: '서술형',
    status: String(d.excel_row_status ?? ''),
    question_data: {
      Question: question,
      Paragraph: para,
      Options: optsText,
      Explanation: expl,
      Category: cat,
      NumQuestion: numQ,
    },
    created_at,
    record_kind: 'narrative' as const,
    variation_pct: null as number | null,
  };
}
