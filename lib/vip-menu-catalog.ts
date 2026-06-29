/**
 * VIP 사이드바 메뉴 카탈로그 + 메뉴별 유료/가격(à la carte) 권한.
 * - admin 이 settings(_id='vipMenuStore')에 메뉴별 paid·price(포인트) 설정
 * - 사용자는 포인트로 메뉴를 개별 언락(users.vipMenus[])
 * - 미설정/무료 메뉴는 누구나 사용(라이브 안전 기본값). 대시보드는 항상 무료.
 */

export interface VipMenuDef {
  id: string;
  label: string;
}

/** 판매 단위 = 사이드바 상위 메뉴 (대시보드 제외). */
export const VIP_MENU_CATALOG: VipMenuDef[] = [
  { id: 'students', label: '학생 관리' },
  { id: 'attendance', label: '출결관리' },
  { id: 'exams', label: '시험 관리' },
  { id: 'scores', label: '성적 관리' },
  { id: 'generate', label: '문제 생성' },
  { id: 'questions', label: '문제 관리' },
  { id: 'homework', label: '숙제 관리' },
  { id: 'analysis', label: '시험 분석' },
  { id: 'review', label: '오답노트' },
  { id: 'report', label: '성적표' },
  { id: 'tuition', label: '수강료 관리' },
  { id: 'counseling', label: '상담 관리' },
  { id: 'lessons', label: '수업일지' },
  { id: 'videos', label: '강의영상관리' },
  { id: 'materials', label: '교재 만들기' },
  { id: 'words', label: '단어 관리' },
  { id: 'assessments', label: '수행평가 관리' },
  { id: 'forms', label: '학원 양식 관리' },
  { id: 'inventory', label: '재고 관리' },
  { id: 'expenses', label: '운영비 관리' },
  { id: 'academy', label: '학원 교습소 정보' },
  { id: 'school-info', label: '학교 정보 관리' },
  { id: 'payroll', label: '급여 관리' },
  { id: 'admissions', label: '입시관리' },
  { id: 'schedule', label: '일정관리' },
  { id: 'memo', label: '메모장' },
  { id: 'writing', label: '영작 수업' },
  { id: 'dictionary', label: '전자사전' },
  { id: 'class-kit', label: '클래스키트' },
  { id: 'passage-analysis', label: '출제 스튜디오' },
  { id: 'qbank-api', label: '문제은행 API' },
];

export const VIP_MENU_IDS = new Set(VIP_MENU_CATALOG.map((m) => m.id));
export const VIP_MENU_LABEL: Record<string, string> = Object.fromEntries(VIP_MENU_CATALOG.map((m) => [m.id, m.label]));

/**
 * 메뉴 의존(함께 필요) 관계 — A: [B] = A를 제대로 쓰려면 B가 필요.
 * 제품 구조상 기본값(출결·성적은 학생 명단, 시험분석·문제생성은 시험 필요 등). admin이 override 가능.
 */
export const DEFAULT_MENU_DEPENDENCIES: Record<string, string[]> = {
  attendance: ['students'],          // 출결 = 학생 명단
  scores: ['students', 'exams'],     // 성적 = 학생 + 시험
  analysis: ['exams'],               // 시험분석 = 시험(기출)
  generate: ['students', 'exams'],   // 문제생성 = 학생(학생별)·시험(학교별)
  questions: [],
  exams: [],
  students: [],
  homework: ['questions'],           // 숙제 = 내 문제은행(문제 관리)
  review: ['generate'],              // 오답노트 = QR 자가채점(문제 생성) 결과
  report: ['scores'],                // 성적표 = 성적 관리
  tuition: ['students'],             // 수강료 = 학생 명단·과목 수강료
  counseling: ['students'],          // 상담 관리 = 학생 명단
  lessons: ['attendance'],           // 수업일지 = 반(출결관리)
  writing: ['students'],             // 영작 수업 = 학생 명단(학생별 첨삭)
  videos: [],                        // 강의영상관리 = 독립(영상 링크 라이브러리)
  materials: [],                     // 교재 만들기 = 독립(블록 기반 교재 빌더)
  words: [],                         // 단어 관리 = 독립(단어장·단어시험지)
  assessments: [],                   // 수행평가 관리 = 독립(학교 수행평가 일정)
  forms: [],                         // 학원 양식 관리 = 독립(문서 양식)
  inventory: [],                     // 재고 관리 = 독립(물품 재고)
  expenses: [],                      // 운영비 관리 = 독립(지출 내역)
  academy: [],                       // 학원 교습소 정보 = 독립(단일 정보)
  'school-info': [],                 // 학교 정보 관리 = 독립(학교 목록)
  payroll: [],                       // 급여 관리 = 독립(직원 급여)
  admissions: ['students'],          // 입시관리 = 학생 명단(학생별 입시 현황)
  schedule: [],                      // 일정관리 = 독립(학원 일정)
  memo: [],                          // 메모장 = 독립(개인 메모)
  dictionary: [],                    // 전자사전 = 독립(무료 사전 API)
  'class-kit': [],                   // 클래스키트 = 독립(모의고사 지문 수업자료·PDF)
  'passage-analysis': [],            // 출제 포인트 = 독립(교사가 문장별 출제 포인트 작성)
  'qbank-api': ['questions'],        // 문제은행 API = 내 문제은행(문제 관리)
};

/** 메뉴의 실효 의존 목록 (admin config 의 requires 우선, 없으면 기본값). 카탈로그 내 id 로만 한정. */
export function effectiveRequires(config: VipMenuStoreConfig | null | undefined, menuId: string): string[] {
  const fromCfg = config?.[menuId]?.requires;
  const base = Array.isArray(fromCfg) ? fromCfg : (DEFAULT_MENU_DEPENDENCIES[menuId] ?? []);
  return base.filter((id) => VIP_MENU_IDS.has(id) && id !== menuId);
}

/** 항상 무료(권한 무관 노출) 메뉴. */
export const ALWAYS_FREE_MENU_IDS = new Set(['dashboard']);

export const VIP_MENU_STORE_SETTINGS_ID = 'vipMenuStore';

/**
 * settings.value 형태: { [menuId]: { paid, price, requires?, published? } }
 * - paid=false/미설정 → 기본 제공(모든 VIP 무료)
 * - paid=true → 유료. published=true 인 것만 실제 구매 가능(공개). published=false 면 「준비 중」으로 구매 불가.
 */
export type VipMenuStoreConfig = Record<string, { paid?: boolean; price?: number; requires?: string[]; published?: boolean }>;

/** 전체 메뉴 접근 예외 계정(테스트 계정 '조슈아') — loginId 로 식별. */
export const VIP_ALL_ACCESS_LOGIN_IDS = new Set<string>(['01079270806']);
export function isVipAllAccess(loginId: string | null | undefined): boolean {
  return !!loginId && VIP_ALL_ACCESS_LOGIN_IDS.has(loginId);
}

export function menuPrice(config: VipMenuStoreConfig | null | undefined, menuId: string): number {
  const c = config?.[menuId];
  return c?.paid && Number.isFinite(c.price) && (c.price as number) > 0 ? Math.floor(c.price as number) : 0;
}

export function isMenuPaid(config: VipMenuStoreConfig | null | undefined, menuId: string): boolean {
  const c = config?.[menuId];
  return !!c?.paid && menuPrice(config, menuId) > 0;
}

/** 공개 여부 — 유료 메뉴는 published=true 일 때만 노출/구매 가능. */
export function isMenuPublished(config: VipMenuStoreConfig | null | undefined, menuId: string): boolean {
  return !!config?.[menuId]?.published;
}

/** 구매 가능 여부 — 유료 + 공개. */
export function isMenuPurchasable(config: VipMenuStoreConfig | null | undefined, menuId: string): boolean {
  return isMenuPaid(config, menuId) && isMenuPublished(config, menuId);
}

/** 메뉴 사용 가능 여부 — 무료이거나, 유료지만 사용자가 언락했으면 true. */
export function isMenuAccessible(menuId: string, config: VipMenuStoreConfig | null | undefined, userMenus: string[] | null | undefined): boolean {
  if (ALWAYS_FREE_MENU_IDS.has(menuId)) return true;
  if (!isMenuPaid(config, menuId)) return true; // 미설정/무료(기본 제공)
  return Array.isArray(userMenus) && userMenus.includes(menuId);
}

/** 접근 가능한 메뉴 id 집합. */
export function accessibleMenuIds(config: VipMenuStoreConfig | null | undefined, userMenus: string[] | null | undefined): Set<string> {
  const out = new Set<string>(ALWAYS_FREE_MENU_IDS);
  for (const m of VIP_MENU_CATALOG) if (isMenuAccessible(m.id, config, userMenus)) out.add(m.id);
  return out;
}
