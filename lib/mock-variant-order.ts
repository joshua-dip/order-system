import type { Collection, Document } from 'mongodb';

export type MockExamSelection = { exam: string; numbers: string[] };

/**
 * 주문 orderMeta.exam( mock-exams.json 키 )와 passages.textbook(엑셀·관리자 등록명)이 다를 때 대비.
 * 예: 고1_2026_03월(서울시) → 원문 키 + 26년 3월 고1 영어모의고사 + 2026년 3월 고1 영어모의고사
 *                             + 26년 3월 고1 영어모의고사 (서울시) (지역 접미사 포함 업로드 대응)
 */
export function mockExamOrderKeyToPassageTextbookCandidates(orderExamKey: string): string[] {
  const raw = orderExamKey.trim();
  if (!raw) return [];
  const out = new Set<string>([raw]);

  const cleaned = raw.replace(/\[[^\]]*]\s*$/, '').trim();
  const m = cleaned.match(/^고([123])_(\d{4})_(\d{1,2})월(?:\(([^)]*)\))?$/);
  if (m) {
    const grade = m[1];
    const yyyy = parseInt(m[2], 10);
    const mo = parseInt(m[3], 10);
    const region = (m[4] ?? '').trim();
    if (Number.isFinite(yyyy) && Number.isFinite(mo) && mo >= 1 && mo <= 12) {
      const yy = String(yyyy % 100).padStart(2, '0');
      const moP = String(mo).padStart(2, '0');
      const bases = [
        `${yy}년 ${mo}월 고${grade} 영어모의고사`,
        `${yy}년 ${moP}월 고${grade} 영어모의고사`,
        `${yyyy}년 ${mo}월 고${grade} 영어모의고사`,
        `${yyyy}년 ${moP}월 고${grade} 영어모의고사`,
      ];
      for (const b of bases) out.add(b);
      if (region) {
        for (const b of bases) out.add(`${b} (${region})`);
      }
    }
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
