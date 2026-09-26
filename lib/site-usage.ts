/**
 * 사이트 사용 기록 — 어떤 메뉴를 누가(회원이면 loginId, 아니면 쿠키 방문자) 언제 썼는지.
 *
 * - 페이지 조회는 SiteVisitTracker → /api/public/track-visit 가 site_events 에 type 'pageview' 로 남긴다.
 * - 버튼 같은 행동은 trackEvent() → /api/public/track-event 가 type 'event' 로 남긴다.
 * - 경로는 id·토큰 조각을 ':id' 로 접어 메뉴(menu)로 묶는다. 180일 뒤 자동 삭제(TTL).
 * 일별 방문 합계(site_stats_daily)는 기존 그대로 두고, 이 로그는 분석용으로만 쓴다.
 */
import type { Db } from 'mongodb';
import { pathToMenuId } from '@/lib/vip-menu-path';
import { VIP_MENU_LABEL } from '@/lib/vip-menu-catalog';

export const SITE_EVENTS_COLLECTION = 'site_events';
export const SITE_EVENTS_TTL_DAYS = 180;

export interface UsageMenu {
  key: string;
  label: string;
  group: string;
}

/** 쿼리·해시를 떼고, id·토큰처럼 보이는 경로 조각은 ':id' 로 접는다 */
export function normalizeUsagePath(raw: string): string {
  let p = String(raw || '/').split(/[?#]/)[0].trim() || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  p = p
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (/^[a-f0-9]{24}$/i.test(seg)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return ':id';
      if (/^\d{3,}$/.test(seg)) return ':id';
      if (seg.length >= 16 && /^[A-Za-z0-9_-]+$/.test(seg) && /\d/.test(seg)) return ':id';
      return seg;
    })
    .join('/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p.slice(0, 200);
}

/** 경로 앞머리 → 메뉴. 위에서부터 처음 맞는 것. */
const MENU_RULES: [RegExp, string, string, string][] = [
  [/^\/$/, 'home', '홈', '홈'],
  [/^\/mockexam/, 'mockexam', '모의고사 변형 주문', '주문'],
  [/^\/textbook/, 'textbook', '부교재 변형 주문', '주문'],
  [/^\/gyogwaseo/, 'gyogwaseo', '교과서 주문', '주문'],
  [/^\/external/, 'external', '외부지문 변형 주문', '주문'],
  [/^\/unified\/downloads/, 'unified-downloads', '파이널 다운로드', '주문'],
  [/^\/unified/, 'unified', '파이널 예비 모의고사', '주문'],
  [/^\/order-num/, 'order-num', '번호별 교재 제작', '주문'],
  [/^\/bundle/, 'bundle', '통합 주문', '주문'],
  [/^\/free/, 'free', '무료 변형', '주문'],
  [/^\/variant/, 'variant', '변형문제 만들기', '주문'],
  [/^\/workbook/, 'workbook', '워크북 주문', '주문'],
  [/^\/essay-workbook/, 'essay-workbook', '서술형 워크북', '주문'],
  [/^\/essay/, 'essay', '서술형문제 주문제작', '주문'],
  [/^\/analysis/, 'analysis', '분석지', '주문'],
  [/^\/vocabulary-order/, 'vocabulary-order', '단어장', '주문'],
  [/^\/class-kit/, 'class-kit', '클래스키트', '주문'],
  [/^\/order\/done/, 'order-done', '주문 완료', '주문'],
  [/^\/solbook/, 'solbook', '쏠북 바로구매', '쏠북'],
  [/^\/practice/, 'practice', '학습실 순서·삽입 연습', '학습'],
  [/^\/qna/, 'qna', '모고 Q&A 분석지', '학습'],
  [/^\/shared-resources/, 'shared-resources', '공유 자료실', '학습'],
  [/^\/sample/, 'sample', '유형 샘플', '학습'],
  [/^\/(grade|grade-g|exam-grade|math-grade)\//, 'grading', 'QR 자가채점', '채점'],
  [/^\/checkin/, 'checkin', 'QR 출석', '채점'],
  [/^\/my\/point-charge/, 'point-charge', '포인트·멤버십 결제', '내정보'],
  [/^\/my\/premium/, 'premium', '프리미엄 변형', '내정보'],
  [/^\/my\/students/, 'my-students', '학생 성적·채점', '내정보'],
  [/^\/my\/student/, 'student', '학생 화면', '학생'],
  [/^\/student-(login|signup)/, 'student-auth', '학생 로그인·가입', '학생'],
  [/^\/my$/, 'my', '내정보', '내정보'],
  [/^\/login/, 'login', '로그인', '계정'],
  [/^\/print\//, 'print', '인쇄 화면', '기타'],
  [/^\/docs\//, 'docs', '문서', '기타'],
];

export function usageMenuOf(path: string): UsageMenu {
  if (path.startsWith('/my/vip')) {
    const id = pathToMenuId(path);
    const label = id === 'dashboard' ? '대시보드' : VIP_MENU_LABEL[id] ?? id;
    return { key: `vip:${id}`, label: `VIP · ${label}`, group: 'VIP' };
  }
  for (const [re, key, label, group] of MENU_RULES) if (re.test(path)) return { key, label, group };
  return { key: 'other', label: '기타', group: '기타' };
}

/** 메뉴 key → 화면 표기 */
export function usageMenuLabel(key: string): { label: string; group: string } {
  if (key.startsWith('vip:')) {
    const id = key.slice(4);
    return { label: `VIP · ${id === 'dashboard' ? '대시보드' : VIP_MENU_LABEL[id] ?? id}`, group: 'VIP' };
  }
  const r = MENU_RULES.find((x) => x[1] === key);
  return r ? { label: r[2], group: r[3] } : { label: key === 'other' ? '기타' : key, group: '기타' };
}

/** 행동 이벤트 이름 → 화면 표기 */
export const USAGE_EVENT_LABEL: Record<string, string> = {
  order_submit: '주문서 생성 누름',
  solbook_product_click: '쏠북 상품 클릭',
  solbook_store_click: '쏠북 매장 클릭',
  practice_start: '학습실 세트 시작',
  file_download: 'PDF·파일 다운로드',
  signup_open: '가입신청 창 열기',
  signup_submit: '가입신청 완료',
  signup_kakao_click: '가입신청 후 카톡 알림',
};

let indexesReady = false;
export async function ensureSiteEventIndexes(db: Db): Promise<void> {
  if (indexesReady) return;
  indexesReady = true;
  const col = db.collection(SITE_EVENTS_COLLECTION);
  await Promise.all([
    col.createIndex({ ts: 1 }, { expireAfterSeconds: SITE_EVENTS_TTL_DAYS * 24 * 60 * 60 }),
    col.createIndex({ date: 1, type: 1 }),
    col.createIndex({ loginId: 1, ts: -1 }),
  ]).catch(() => {
    indexesReady = false;
  });
}

export interface SiteEventDoc {
  ts: Date;
  /** 한국 날짜 YYYY-MM-DD */
  date: string;
  type: 'pageview' | 'event';
  /** event 이름(type=event) */
  name?: string;
  path: string;
  menu: string;
  visitorId: string;
  loginId?: string;
  role?: string;
  /** 외부 유입 출처 호스트(첫 조회만 의미가 있다) */
  refHost?: string;
  props?: Record<string, string | number | boolean>;
}

/** 이벤트 props 정리 — 키 12개, 문자열 200자까지 */
export function sanitizeProps(raw: unknown): Record<string, string | number | boolean> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 12)) {
    const key = k.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
    if (!key) continue;
    if (typeof v === 'string') out[key] = v.slice(0, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
