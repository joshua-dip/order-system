import type { Collection, Document } from 'mongodb';
import { parseMockExamKey } from './mock-exam-key';

export type MockExamSelection = { exam: string; numbers: string[] };

/**
 * 주문 orderMeta.exam ↔ passages.textbook 매칭.
 *
 * 입력은 신표기("26년 3월 고1 영어모의고사") 또는 옛 키("고1_2026_03월(서울시)") 중 하나일 수 있고,
 * passages 에는 둘 중 어느 표기로 저장돼 있을지 모르므로 가능한 후보를 모두 만들어 둔다.
 */
export function mockExamOrderKeyToPassageTextbookCandidates(orderExamKey: string): string[] {
  const raw = orderExamKey.trim();
  if (!raw) return [];
  const out = new Set<string>([raw]);

  const parsed = parseMockExamKey(raw);
  if (!parsed || !parsed.grade || parsed.year == null || parsed.month == null) return [...out];

  const grade = parsed.grade.replace('고', '');
  const yyyy = parsed.year;
  const mo = parsed.month;
  const yy = String(yyyy % 100).padStart(2, '0');
  const moP = String(mo).padStart(2, '0');

  const bases = [
    `${yy}년 ${mo}월 고${grade} 영어모의고사`,
    `${yy}년 ${moP}월 고${grade} 영어모의고사`,
    `${yyyy}년 ${mo}월 고${grade} 영어모의고사`,
    `${yyyy}년 ${moP}월 고${grade} 영어모의고사`,
  ];
  for (const b of bases) out.add(b);

  // 옛 키에서 변환된 경우 — 지역(note)·메모(bracketNote) 접미사 변형도 포함
  const noteParts: string[] = [];
  if (parsed.bracketNote) noteParts.push(parsed.bracketNote);
  if (noteParts.length > 0) {
    for (const b of bases) out.add(`${b} (${noteParts.join(', ')})`);
  }
  if (parsed.format === 'old' && parsed.note) {
    for (const b of bases) out.add(`${b} (${parsed.note})`);
    if (parsed.bracketNote) {
      for (const b of bases) out.add(`${b} (${parsed.note}, ${parsed.bracketNote})`);
    }
  }

  // 신표기 → 옛 키 후보까지 추가 (passages 에 옛 키로 남아있는 항목 대비)
  if (parsed.format === 'new') {
    out.add(`고${grade}_${yyyy}_${moP}월`);
  }

  return [...out];
}

/** MockExamSettings 문항 번호 id → passages/source_key에 쓰이는 표시(예: 18 → 18번, 41-42 → 41~42번) */
export function mockExamNumberIdToLabel(id: string): string {
  const t = id.trim();
  if (t === '41-42') return '41~42번';
  if (t === '43-45') return '43~45번';
  if (/^\d+$/.test(t)) return `${t}번`;
  return t;
}

export function parseMockExamSelections(raw: unknown): MockExamSelection[] {
  if (!Array.isArray(raw)) return [];
  const out: MockExamSelection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const exam = typeof o.exam === 'string' ? o.exam.trim() : '';
    const numbers = Array.isArray(o.numbers)
      ? o.numbers.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
      : [];
    if (exam && numbers.length > 0) out.push({ exam, numbers });
  }
  return out;
}

function pickPassageFromPool(
  pool: Document[],
  orderExamKey: string,
  textbookCandidates: string[],
  label: string,
  numId: string
): Document | null {
  const sk = (d: Document) => String(d.source_key ?? '').trim();
  const num = (d: Document) => String(d.number ?? '').trim();

  const trySk = (p: string): Document | null => pool.find((d) => sk(d) === p) ?? null;
  const a = trySk(label);
  if (a) return a;
  const b = trySk(`${orderExamKey} ${label}`);
  if (b) return b;
  for (const tb of textbookCandidates) {
    const hit = trySk(`${tb} ${label}`);
    if (hit) return hit;
  }
  return (
    pool.find((d) => num(d) === label) ??
    pool.find((d) => num(d) === numId) ??
    pool.find((d) => sk(d).endsWith(label)) ??
    null
  );
}

/**
 * orderMeta.examSelections 기준으로 passages 조회 (교재명=textbook = 모의고사 키 문자열).
 */
export async function passagesForMockVariantOrder(
  passagesCol: Collection<Document>,
  examSelectionsRaw: unknown
): Promise<{
  passageDocs: Document[];
  lessonsWithoutPassage: string[];
  primaryTextbook: string;
  totalSlotsRequested: number;
}> {
  const selections = parseMockExamSelections(examSelectionsRaw);
  if (selections.length === 0) {
    return { passageDocs: [], lessonsWithoutPassage: [], primaryTextbook: '', totalSlotsRequested: 0 };
  }

  const passageDocs: Document[] = [];
  const lessonsWithoutPassage: string[] = [];
  const seenIds = new Set<string>();
  let totalSlotsRequested = 0;

  for (const sel of selections) {
    const exam = sel.exam.trim();
    if (!exam) continue;

    const textbookCandidates = mockExamOrderKeyToPassageTextbookCandidates(exam);

    const labels = sel.numbers.map(mockExamNumberIdToLabel);
    const sourceCandidates = new Set<string>();
    for (const L of labels) {
      sourceCandidates.add(L);
      sourceCandidates.add(`${exam} ${L}`);
      for (const tb of textbookCandidates) {
        sourceCandidates.add(`${tb} ${L}`);
      }
    }

    const numsForQuery = Array.from(new Set([...labels, ...sel.numbers]));
    const skList = Array.from(sourceCandidates);
    const pool = await passagesCol
      .find({
        textbook: { $in: textbookCandidates },
        $or: [{ source_key: { $in: skList } }, { number: { $in: numsForQuery } }],
      })
      .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1 })
      .toArray();

    for (let i = 0; i < sel.numbers.length; i++) {
      totalSlotsRequested++;
      const numId = sel.numbers[i];
      const label = labels[i];
      const doc = pickPassageFromPool(pool, exam, textbookCandidates, label, numId);
      if (!doc) {
        lessonsWithoutPassage.push(`${exam} · ${label}`);
        continue;
      }
      const id = String(doc._id);
      if (!seenIds.has(id)) {
        seenIds.add(id);
        passageDocs.push(doc);
      }
    }
  }

  const primaryTextbook =
    passageDocs.length > 0
      ? String(passageDocs[0].textbook ?? '').trim() || (selections[0]?.exam?.trim() ?? '')
      : selections[0]?.exam?.trim() ?? '';
  return { passageDocs, lessonsWithoutPassage, primaryTextbook, totalSlotsRequested };
}
