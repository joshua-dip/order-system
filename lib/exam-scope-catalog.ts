/**
 * 시험범위 만들기 — 교재 목록을 폴더(고1 모의고사·교과서 과목·EBS·부교재)로 나눠 준다.
 * 저장 형식은 기존 exam_scopes.dbEntries 그대로(/unified 프리셋과 호환).
 */
import type { Db } from 'mongodb';
import { getSchoolTextbookKeysWithPassages } from '@/lib/school-textbooks';
import { isEbsTextbook } from '@/lib/textbookSort';

export type CatalogTextbook = {
  key: string;
  label: string;
  type: 'mockexam' | 'textbook';
  category?: 'ebs' | 'school-textbook' | 'supplement';
};
export type CatalogFolder = { key: string; label: string; groups: { label: string; textbooks: CatalogTextbook[] }[] };

const MOCK_RE = /영어모의고사|^수능_\d{4}|^고[123]_\d{4}_/;

export function mockGrade(tb: string): string {
  const m = /고([123])/.exec(tb);
  if (m) return `고${m[1]}`;
  return /수능/.test(tb) ? '고3' : '기타';
}

export function mockYear(tb: string): number {
  const m = /^(\d{2})년/.exec(tb) ?? /(\d{4})/.exec(tb);
  if (!m) return 0;
  const n = Number(m[1]);
  return n < 100 ? 2000 + n : n;
}

function mockMonth(tb: string): number {
  return Number(/(\d{1,2})월/.exec(tb)?.[1] ?? 0);
}

/** 교과서 키 "공통영어1_NE능률민병천" → 과목 "공통영어 1" */
export function schoolSubject(key: string): string {
  const head = key.split('_')[0] ?? key;
  return head
    .replace(/II$|Ⅱ/, ' 2')
    .replace(/I$|Ⅰ/, ' 1')
    .replace(/(\D)(\d)$/, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildCatalogFolders(input: {
  allTextbooks: string[];
  schoolKeys: string[];
  /** null = 전부(관리자), 배열 = 회원 허용 부교재 */
  allowedSupplements: string[] | null;
}): CatalogFolder[] {
  const school = new Set(input.schoolKeys);
  const mock = input.allTextbooks.filter((t) => MOCK_RE.test(t) && !school.has(t));
  const ebs = input.allTextbooks.filter((t) => !MOCK_RE.test(t) && isEbsTextbook(t));
  const ebsSet = new Set(ebs);
  const allowed = input.allowedSupplements ? new Set(input.allowedSupplements) : null;
  const supplements = input.allTextbooks.filter(
    (t) => !MOCK_RE.test(t) && !ebsSet.has(t) && !school.has(t) && (!allowed || allowed.has(t)),
  );
  const ko = (a: string, b: string) => a.localeCompare(b, 'ko', { numeric: true });

  const folders: CatalogFolder[] = [];
  for (const g of ['고1', '고2', '고3']) {
    const list = mock
      .filter((t) => mockGrade(t) === g)
      .sort((a, b) => mockYear(b) - mockYear(a) || mockMonth(b) - mockMonth(a) || ko(a, b));
    if (!list.length) continue;
    const byYear = new Map<number, string[]>();
    for (const t of list) (byYear.get(mockYear(t)) ?? byYear.set(mockYear(t), []).get(mockYear(t))!).push(t);
    folders.push({
      key: `mock-${g}`,
      label: `${g} 모의고사`,
      groups: [...byYear].map(([y, tbs]) => ({
        label: y ? `${y}년` : '기타',
        textbooks: tbs.map((t) => ({ key: t, label: t, type: 'mockexam' as const })),
      })),
    });
  }

  const bySubject = new Map<string, string[]>();
  for (const k of [...school].sort(ko)) (bySubject.get(schoolSubject(k)) ?? bySubject.set(schoolSubject(k), []).get(schoolSubject(k))!).push(k);
  for (const [subject, keys] of [...bySubject].sort((a, b) => ko(a[0], b[0]))) {
    folders.push({
      key: `school-${subject}`,
      label: subject,
      groups: [
        {
          label: '',
          textbooks: keys.map((k) => ({
            key: k,
            label: k.split('_').slice(1).join(' ') || k,
            type: 'textbook' as const,
            category: 'school-textbook' as const,
          })),
        },
      ],
    });
  }

  if (ebs.length) {
    folders.push({
      key: 'ebs',
      label: 'EBS',
      groups: [{ label: '', textbooks: ebs.sort(ko).map((t) => ({ key: t, label: t, type: 'textbook' as const, category: 'ebs' as const })) }],
    });
  }
  if (supplements.length) {
    folders.push({
      key: 'supplement',
      label: '부교재',
      groups: [
        { label: '', textbooks: supplements.sort(ko).map((t) => ({ key: t, label: t, type: 'textbook' as const, category: 'supplement' as const })) },
      ],
    });
  }
  return folders;
}

export async function loadExamScopeCatalog(db: Db, allowedSupplements: string[] | null): Promise<CatalogFolder[]> {
  const [allTextbooks, schoolKeys] = await Promise.all([
    db.collection('passages').distinct('textbook'),
    getSchoolTextbookKeysWithPassages(db),
  ]);
  return buildCatalogFolders({
    allTextbooks: allTextbooks.map(String).filter(Boolean),
    schoolKeys,
    allowedSupplements,
  });
}
