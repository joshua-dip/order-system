/**
 * VIP 문법 개념 저장소 — 진도(학습주제) topicKey 별 개념 설명 1문서.
 * 문제지 인쇄 시 "문법 개념 포함" 체크하면 해당 범위의 개념 페이지가 문제 앞에 삽입된다.
 * 소유자(userId) 스코프. 내용은 Pro 채팅/에이전트가 작성(자동 생성) 후 화면에서 편집 가능.
 */
export const GRAMMAR_CONCEPTS_COLLECTION = 'vip_grammar_concepts';

/** 개념 항목(용어/설명/예문). */
export interface ConceptPoint {
  term: string;      // 개념 소제목 (예: 주격, 소유격)
  detail: string;    // 설명
  example?: string;  // 예문(영어, <u> 밑줄 허용)
}

/** 문법 표(격변화·동사변화 등 사실 데이터). headers 열, rows 각 행. */
export interface ConceptTable {
  title?: string;
  headers: string[];
  rows: string[][];
}

export interface GrammarConcept {
  topicKey: string;
  title: string;     // 보통 학습주제명
  intro: string;     // 한두 줄 개념 요약
  table?: ConceptTable; // 격변화표 등(선택)
  points: ConceptPoint[];
  tip?: string;      // 주의/팁 한 줄
}

/** 저장 문서에서 개념만 안전하게 정규화. */
export function normalizeConcept(input: unknown): GrammarConcept | null {
  if (!input || typeof input !== 'object') return null;
  const d = input as Record<string, unknown>;
  const title = String(d.title ?? '').trim();
  const intro = String(d.intro ?? '').trim();
  const rawPoints = Array.isArray(d.points) ? d.points : [];
  const points: ConceptPoint[] = rawPoints
    .map((p) => {
      const pp = (p ?? {}) as Record<string, unknown>;
      return { term: String(pp.term ?? '').trim(), detail: String(pp.detail ?? '').trim(), example: String(pp.example ?? '').trim() || undefined };
    })
    .filter((p) => p.term || p.detail);
  const tip = String(d.tip ?? '').trim() || undefined;
  let table: ConceptTable | undefined;
  const t = d.table as Record<string, unknown> | undefined;
  if (t && Array.isArray(t.headers) && Array.isArray(t.rows)) {
    const headers = (t.headers as unknown[]).map((h) => String(h ?? ''));
    const rows = (t.rows as unknown[]).filter(Array.isArray).map((r) => (r as unknown[]).map((c) => String(c ?? '')));
    if (headers.length && rows.length) table = { title: String(t.title ?? '').trim() || undefined, headers, rows };
  }
  if (!title && !intro && points.length === 0 && !table) return null;
  return { topicKey: String(d.topicKey ?? '').trim(), title, intro, ...(table ? { table } : {}), points, tip };
}
