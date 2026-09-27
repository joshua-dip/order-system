/**
 * 교과서 키(`공통영어1_NE능률민병천`) 해석 — 과목·출판사·저자.
 * DB 키는 그대로 두고 **표시용**으로만 나눈다(이름이 비슷한 교재를 합치지 않는다).
 * LessonSelection(/gyogwaseo)과 교과서 워크북 교재 선택이 같이 쓴다.
 */
export type GyogwaseoKeyMeta = {
  subject: string;
  publisher: string;
  author: string;
  raw: string;
};

/** 앞에서부터 접두사로 맞춰 본다 — 긴 이름(천재교과서·천재교육)을 짧은 이름(천재)보다 먼저 둔다 */
export const PUBLISHER_KEYS = [
  'NE능률', 'YBM', '능률', '천재교과서', '천재교육', '천재', '비상교육', '비상',
  '동아출판', '동아', '미래엔', '지학사', '금성', '교학사', '다락원',
] as const;

export const PUBLISHER_STYLE: Record<string, { stripe: string; badge: string }> = {
  'NE능률': { stripe: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  '능률':   { stripe: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'YBM':    { stripe: 'bg-sky-500',     badge: 'bg-sky-50 text-sky-700 border-sky-200' },
  '천재':   { stripe: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  '천재교육': { stripe: 'bg-rose-500',  badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  '천재교과서': { stripe: 'bg-rose-500', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  '비상':   { stripe: 'bg-orange-500',  badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  '비상교육': { stripe: 'bg-orange-500',badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  '동아':   { stripe: 'bg-indigo-500',  badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  '동아출판': { stripe: 'bg-indigo-500',badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  '미래엔': { stripe: 'bg-cyan-500',    badge: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  '지학사': { stripe: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  '금성':   { stripe: 'bg-yellow-500',  badge: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  '교학사': { stripe: 'bg-lime-500',    badge: 'bg-lime-50 text-lime-700 border-lime-200' },
  '다락원': { stripe: 'bg-fuchsia-500', badge: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' },
  '기타':   { stripe: 'bg-slate-400',   badge: 'bg-slate-100 text-slate-700 border-slate-200' },
};

export function parseGyogwaseoKey(raw: string): GyogwaseoKeyMeta {
  const idx = raw.indexOf('_');
  let subject = '';
  let rest = raw;
  if (idx > 0) {
    subject = raw.slice(0, idx).trim();
    rest = raw.slice(idx + 1).trim();
  }
  let publisher = '';
  let author = '';
  for (const p of PUBLISHER_KEYS) {
    if (rest.startsWith(p)) {
      publisher = p;
      author = rest.slice(p.length).trim();
      break;
    }
  }
  if (!publisher) {
    publisher = '기타';
    author = rest;
  }
  return { subject: subject || '교과서', publisher, author, raw };
}

/** 학년/과목 정렬: 공통영어1·2 → 영어I·II → 그 외 */
export const SUBJECT_ORDER = [
  '공통영어1', '공통영어2',
  '영어', '영어I', '영어II',
  '영어 독해와 작문', '영어독해와작문',
  '영어 회화', '영어회화',
  '진로영어', '실용영어', '직무영어', '심화영어',
];
export function subjectOrderIdx(s: string): number {
  if (s === '기타') return 1000; // 「기타」는 항상 맨 뒤
  const i = SUBJECT_ORDER.indexOf(s);
  return i === -1 ? 999 : i;
}

/** 과목 칩·섹션에서 「기타」로 모을 과목 — 카드 배지는 원래 과목명 그대로 둔다(2026-09-19 요청). */
export const ETC_SUBJECTS = new Set(['미디어영어']);
export function gyogwaseoSectionOf(key: string): string {
  const s = parseGyogwaseoKey(key).subject;
  return ETC_SUBJECTS.has(s) ? '기타' : s;
}

export type GyogwaseoDisplay = {
  subject: string;
  publisher: string;
  /** 저자 — 키의 첫 밑줄 뒤 조각에서 출판사를 뗀 나머지 */
  author: string;
  /** 저자 뒤에 붙은 내부 꼬리표(`_변형문제_강별` 등)를 사람이 읽는 말로 — 없으면 '' */
  extra: string;
  /** 한 줄 표시 이름 — 「공통영어2 · YBM · 박준언」 */
  label: string;
};

/**
 * 사용자용 표시 이름. 키 `공통영어2_YBM박준언_변형문제_강별` 은
 * { subject:'공통영어2', publisher:'YBM', author:'박준언', extra:'변형문제 강별' } 이 된다.
 * 개정연도는 키에 없어서 만들어 내지 않는다.
 */
export function gyogwaseoDisplay(raw: string): GyogwaseoDisplay {
  const meta = parseGyogwaseoKey(raw);
  const [authorPart, ...rest] = meta.author.split('_');
  const author = (authorPart ?? '').trim();
  const extra = rest.map((x) => x.trim()).filter(Boolean).join(' ');
  const publisher = meta.publisher === '기타' ? '' : meta.publisher;
  const label = [meta.subject, publisher, author].filter(Boolean).join(' · ') + (extra ? ` (${extra})` : '');
  return { subject: meta.subject, publisher, author, extra, label };
}

/**
 * 어떤 교재 키든 화면용 이름으로 — 교과서 키 모양(과목_출판사저자)이고 출판사를 알아볼 때만 바꾸고,
 * 그 밖의 부교재 키는 그대로 둔다(부교재 이름에도 밑줄이 있을 수 있어 함부로 쪼개지 않는다).
 */
export function friendlyTextbookName(key: string): string {
  if (!key.includes('_')) return key;
  const d = gyogwaseoDisplay(key);
  return d.publisher ? d.label : key;
}
