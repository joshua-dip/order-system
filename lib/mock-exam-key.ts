/**
 * 모의고사 교재 키 인식·파싱 헬퍼.
 *
 * 두 가지 표기를 모두 지원합니다.
 *
 *  - 신표기 (passages.textbook 과 동일): "26년 3월 고1 영어모의고사" / "23년 11월 고2 영어모의고사 (12월시행)"
 *  - 구표기 (예전 mock-exams.json + 옛 주문): "고1_2026_03월(서울시)" / "고2_2013_06월_A형(서울시)"
 *
 * 화면 분기 ("이건 모의고사 교재인가?") 와 라벨 표시 ("어떻게 보여줄까?") 모두 한 곳에서 처리하기 위함.
 */

/** 신표기 매칭. 캡처: 1=YY, 2=M(또는 MM), 3=학년, 4=괄호 안 메모(선택) */
const NEW_KEY_RE = /^(\d{2})년\s+(\d{1,2})월\s+고([123])\s+영어모의고사(?:\s*\(([^)]+)\))?$/;

/** 구표기 매칭. 캡처: 1=학년, 2=YYYY, 3=MM, 4=형(A/B 등 선택), 5=지역(선택), 6=대괄호 메모(선택) */
const OLD_KEY_RE = /^고([123])_(\d{4})_(\d{1,2})월(?:_([AB]형))?(?:\(([^)]+)\))?(?:\[([^\]]+)\])?$/;

/** 수능 등 그 외 모의고사 키 (예: "수능_2024_11월_2025수능(평가원)") */
const SUNEUNG_KEY_RE = /^수능_\d{4}_\d{1,2}월/;

export interface MockExamKeyParsed {
  /** 입력 그대로 */
  raw: string;
  /** "고1" / "고2" / "고3" — 수능은 null */
  grade: '고1' | '고2' | '고3' | null;
  /** 4자리 연도 (구표기) 또는 2000+YY (신표기) */
  year: number | null;
  /** 1~12 */
  month: number | null;
  /** A형/B형 (구표기 _A형/_B형) */
  variant: 'A형' | 'B형' | null;
  /** 지역(구표기) 또는 괄호 안 메모(신표기). 없으면 null */
  note: string | null;
  /** 구표기 [12월시행] 같은 대괄호 메모 (구표기에서만 채워짐) */
  bracketNote: string | null;
  /** 어떤 표기에서 왔는지 */
  format: 'new' | 'old' | 'suneung' | null;
}

export function parseMockExamKey(key: string): MockExamKeyParsed | null {
  const raw = (key ?? '').trim();
  if (!raw) return null;

  const mNew = raw.match(NEW_KEY_RE);
  if (mNew) {
    const yy = parseInt(mNew[1], 10);
    return {
      raw,
      grade: `고${mNew[3]}` as MockExamKeyParsed['grade'],
      year: 2000 + yy,
      month: parseInt(mNew[2], 10),
      variant: null,
      note: (mNew[4] ?? '').trim() || null,
      bracketNote: null,
      format: 'new',
    };
  }

  const mOld = raw.match(OLD_KEY_RE);
  if (mOld) {
    return {
      raw,
      grade: `고${mOld[1]}` as MockExamKeyParsed['grade'],
      year: parseInt(mOld[2], 10),
      month: parseInt(mOld[3], 10),
      variant: (mOld[4] as 'A형' | 'B형' | undefined) ?? null,
      note: (mOld[5] ?? '').trim() || null,
      bracketNote: (mOld[6] ?? '').trim() || null,
      format: 'old',
    };
  }

  if (SUNEUNG_KEY_RE.test(raw)) {
    return { raw, grade: null, year: null, month: null, variant: null, note: null, bracketNote: null, format: 'suneung' };
  }

  return null;
}

/** 구표기든 신표기든, 또는 수능 키든 모의고사 교재 키이면 true */
export function isMockExamTextbookKey(key: string): boolean {
  if (!key) return false;
  const parsed = parseMockExamKey(key);
  return parsed !== null;
}

/** 화면 표시용 라벨. 구표기는 신표기 형태로 변환해 보여주고, 신표기/수능은 그대로 */
export function mockExamDisplayLabel(key: string): string {
  const parsed = parseMockExamKey(key);
  if (!parsed) return key;
  if (parsed.format === 'new' || parsed.format === 'suneung') return parsed.raw;
  if (!parsed.grade || parsed.year == null || parsed.month == null) return parsed.raw;
  const yy = String(parsed.year % 100).padStart(2, '0');
  const variant = parsed.variant ? ` ${parsed.variant}` : '';
  const noteParts: string[] = [];
  if (parsed.bracketNote) noteParts.push(parsed.bracketNote);
  const note = noteParts.length > 0 ? ` (${noteParts.join(', ')})` : '';
  return `${yy}년 ${parsed.month}월 ${parsed.grade} 영어모의고사${variant}${note}`;
}

/** 모의고사 교재 키 들에서 학년 추출 ("고1"/"고2"/"고3"/null) */
export function mockExamGradeOf(key: string): MockExamKeyParsed['grade'] {
  return parseMockExamKey(key)?.grade ?? null;
}

/** 신표기인지 (passages.textbook 그대로) */
export function isNewMockExamKey(key: string): boolean {
  return parseMockExamKey(key)?.format === 'new';
}

/** 구표기인지 (옛 mock-exams.json 형식) */
export function isOldMockExamKey(key: string): boolean {
  return parseMockExamKey(key)?.format === 'old';
}

/** 수능 키인지 */
export function isSuneungKey(key: string): boolean {
  return parseMockExamKey(key)?.format === 'suneung';
}
