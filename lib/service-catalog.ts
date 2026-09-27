/**
 * 홈 서비스 안내 — 카드·전체 목록·상세 상단이 같은 사실을 쓰도록 모은 단일 소스.
 *
 * 값은 **가격·권한 로직의 상수에서 끌어온다**(화면마다 하드코딩하지 않는다).
 * 코드로 확인되지 않는 항목(파일 형식 등)은 비워 둔다 — 추측해서 채우지 않는다.
 *
 * - 원(₩)과 포인트(P)는 섞지 않는다. 포인트로 매겨지는 상품(단어장·파이널·AI 고난도)만 P 로 쓴다.
 * - 「받는 시점」의 주문 제작 문구는 주문서 하단 안내(ORDER_FOOTER_MESSAGE)와 같은 정책을 따른다.
 */
import { VARIANT_PRICE, SOLBOOK_VARIANT_PRICE_TIERS } from './variant-pricing';
import { externalizeListPrice, EXTERNAL_PASSAGE_LIMITS } from './external-variant';
import { ESSAY_WORKBOOK_PRICE_PER_SOURCE } from './essay-workbook-pricing';
import { VOCABULARY_POINTS_PER_PASSAGE } from './vocabulary-library-types';
import { VARIANT_HARD_INSERTION_POINT_COST } from './member-variant-points';
import { PUBLIC_FREE_DAILY_LIMIT, PUBLIC_FREE_MAX_QUESTIONS_PER_PDF } from './public-free-limits';
import { MEMBERSHIP_MONTHLY_WON, MEMBERSHIP_ANNUAL_REFERENCE_WON } from './membership-pricing';
import { ANALYSIS_PRICE_PER_PASSAGE } from './analysis-pricing';

export type ServiceGroup = 'class' | 'exam' | 'compose' | 'free';

/** 카드 상태 배지 — 색만으로 구분하지 않도록 글자·기호를 함께 쓴다 */
export type ServiceBadge = 'free' | 'instant' | 'made-to-order' | 'member' | 'premium' | 'tool';

export type ServiceFacts = {
  /** 가격 또는 가격 산정 기준 */
  price: string;
  /** 자료를 받는 시점 */
  delivery: string;
  /** 파일 형식·편집 가능 여부 — 코드로 확인되지 않으면 undefined */
  format?: string;
  /** 회원·구독·별도 설정 등 이용 조건 */
  condition: string;
};

export type ServiceLink = { label: string; href: string };

export type ServiceDef = {
  id: string;
  group: ServiceGroup;
  title: string;
  /** 한 줄 설명 — 무엇을 받는지 */
  summary: string;
  href: string;
  /** 목적이 드러나는 버튼 문구 */
  cta: string;
  /** 같은 상품의 입구가 여럿일 때 (워크북: 모의고사·부교재·교과서) */
  links?: ServiceLink[];
  badges: ServiceBadge[];
  facts: ServiceFacts;
  /** 홈 카드에 바로 드러낼 예외·주의 한 줄 (긴 문장 속에 숨기지 않는다) */
  note?: string;
  /** 예전 홈 메뉴 이름 — 재방문자가 전체 목록에서 찾을 수 있게 */
  formerTitle?: string;
};

export const SERVICE_GROUPS: { id: ServiceGroup; title: string; description: string }[] = [
  { id: 'class', title: '수업자료 준비', description: '지문 설명·해석·어휘 등 수업에 바로 쓰는 자료' },
  { id: 'exam', title: '내신 문제 준비', description: '변형문제·서술형·워크북을 교재와 범위에 맞춰 주문하거나 직접 만들기' },
  { id: 'compose', title: '시험지 · 교재 구성', description: '여러 자료를 묶어 시험지나 번호별 교재로 구성' },
  { id: 'free', title: '무료 학습 · 체험', description: '가입·결제 없이 바로 받거나 풀어 보기' },
];

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const pts = (n: number) => `${n.toLocaleString('ko-KR')}P`;

const solbookMin = Math.min(...SOLBOOK_VARIANT_PRICE_TIERS.map((t) => t.price));
const solbookMax = Math.max(...SOLBOOK_VARIANT_PRICE_TIERS.map((t) => t.price));

/** 주문 제작 공통 — ORDER_FOOTER_MESSAGE 기본값과 같은 정책 */
export const MADE_TO_ORDER_DELIVERY = '입금 확인 후 제작 · 완료 시 안내 (최대 1일 소요될 수 있음)';

const VARIANT_BASE_PRICE =
  `문항당 ${won(VARIANT_PRICE.base)} · 고난도 ${won(VARIANT_PRICE.advanced)}` +
  ` · 순서·삽입 해설 없이 ${won(VARIANT_PRICE.orderInsertNoExplanation)}`;

export const FREE_SEVEN_RULE = '무료 7종(주제·제목·주장·일치·불일치·순서·삽입)은 유료 유형을 1개 이상 함께 주문할 때 0원';

export const SERVICES: ServiceDef[] = [
  /* ── 수업자료 준비 ─────────────────────────── */
  {
    id: 'classkit',
    group: 'class',
    title: '클래스키트',
    summary: '강의용·수업용 자료, 한줄해석·영작하기·해석쓰기를 교재 지문에서 바로 변환',
    href: '/class-kit/lecture',
    cta: '자료 보기',
    badges: ['free', 'instant'],
    facts: {
      price: '무료',
      delivery: '바로 — 화면에서 변환 후 다운로드',
      format: 'PDF (여러 지문은 ZIP)',
      condition: '비회원은 체험 회차만 · 회원은 모의고사 전체',
    },
  },
  {
    id: 'vocabulary',
    group: 'class',
    title: '단어장',
    summary: '지문별 단어장을 고른 뒤 첫글자제시·뜻가리기·플래시카드 등으로 편집',
    href: '/vocabulary-order',
    cta: '교재 선택',
    badges: ['instant'],
    facts: {
      price: `고1·2·3 영어모의고사 무료 · 그 외 지문당 ${pts(VOCABULARY_POINTS_PER_PASSAGE)}`,
      delivery: '구매 즉시 웹에서 편집·다운로드',
      format: '엑셀·PDF·시험지·플래시카드 등으로 내보내기',
      condition: '포인트 구매는 로그인 필요 · 비회원은 체험 교재만',
    },
  },
  {
    id: 'qna',
    group: 'class',
    title: '모고 Q&A 분석지',
    summary: '모의고사 회차·번호별 문장 해석·SVOC, 단어를 눌러 바로 질문',
    href: '/qna',
    cta: '자료 보기',
    badges: ['free', 'instant'],
    facts: {
      price: '무료',
      delivery: '바로 — 웹에서 열람',
      format: '웹 화면 (파일 아님)',
      condition: '로그인 없이 누구나',
    },
  },
  {
    id: 'analysis',
    formerTitle: '분석지 주문제작',
    group: 'class',
    title: '분석지 주문',
    summary: '교재 지문의 맞춤 분석지를 주문 제작',
    href: '/analysis',
    cta: '분석지 주문',
    badges: ['made-to-order', 'member'],
    facts: {
      price: `지문당 ${won(ANALYSIS_PRICE_PER_PASSAGE)}`,
      delivery: MADE_TO_ORDER_DELIVERY,
      format: 'PDF',
      condition: '분석지 이용 권한이 있는 회원 (카카오톡으로 신청)',
    },
  },

  /* ── 내신 문제 준비 ─────────────────────────── */
  {
    id: 'mock',
    formerTitle: '모의고사 변형문제 주문',
    group: 'exam',
    title: '모의고사 변형문제',
    summary: '회차와 번호(18~45번)를 골라 유형별 변형문제 주문',
    href: '/mockexam',
    cta: '문제 주문',
    badges: ['made-to-order'],
    facts: {
      price: VARIANT_BASE_PRICE,
      delivery: MADE_TO_ORDER_DELIVERY,
      format: 'HWP (주문 시 저장 방식 선택)',
      condition: '비회원도 주문 가능 · 포인트·멤버십 무료 한도는 로그인 시',
    },
    note: FREE_SEVEN_RULE,
  },
  {
    id: 'textbook',
    formerTitle: '부교재 변형문제 주문',
    group: 'exam',
    title: '부교재 변형문제',
    summary: '교재·강을 골라 유형별 변형문제 주문 (쏠북 교재 포함)',
    href: '/textbook',
    cta: '교재 선택',
    badges: ['made-to-order'],
    facts: {
      price: `${VARIANT_BASE_PRICE} · 쏠북 교재는 쏠북 정책 단가`,
      delivery: MADE_TO_ORDER_DELIVERY,
      format: 'HWP (주문 시 저장 방식 선택)',
      condition: '비회원도 주문 가능 · 쏠북 교재는 무료 7종 미적용',
    },
    note: FREE_SEVEN_RULE,
  },
  {
    id: 'gyogwaseo',
    formerTitle: '교과서 자료 주문',
    group: 'exam',
    title: '교과서 변형문제',
    summary: '교과서 강·시험 범위를 골라 주문 — 쏠북 정식 구매로 전달',
    href: '/gyogwaseo',
    cta: '교재 선택',
    badges: ['made-to-order'],
    facts: {
      price: `쏠북 정책 단가 문항당 ${won(solbookMin)}~${won(solbookMax)} (총 문항 수 구간) · 고난도 ${won(VARIANT_PRICE.advanced)} + 맞춤 제작비(주문 화면에 표시)`,
      delivery: '입금 확인 후 제작 · 쏠북 구매 링크로 안내',
      condition: '변형문제 비용은 쏠북에서 결제 · 무료 7종 미적용',
    },
  },
  {
    id: 'external',
    formerTitle: '외부지문 변형문제 주문',
    group: 'exam',
    title: '외부지문 변형문제',
    summary: '가지고 있는 지문을 붙여 넣어 변형문제 주문',
    href: '/external',
    cta: '지문 붙여넣기',
    badges: ['made-to-order', 'member'],
    facts: {
      price: `문항당 ${won(externalizeListPrice(VARIANT_PRICE.base))} · 고난도 ${won(externalizeListPrice(VARIANT_PRICE.advanced))} (기본 단가의 1.3배)`,
      delivery: MADE_TO_ORDER_DELIVERY,
      condition: `로그인 필요 · 한 번에 최대 ${EXTERNAL_PASSAGE_LIMITS.maxPassages}지문`,
    },
  },
  {
    id: 'essay',
    formerTitle: '서술형문제 주문제작',
    group: 'exam',
    title: '서술형문제',
    summary: '빈칸재배열·요약문조건영작·이중요지·글의의미 — 지문마다 새로 제작',
    href: '/essay',
    cta: '문제 주문',
    badges: ['made-to-order'],
    facts: {
      price: '유형별 지문당 가격 (주문 화면에 표시)',
      delivery: MADE_TO_ORDER_DELIVERY,
      format: 'HWP (편집 가능)',
      condition: 'EBS·모의고사는 누구나 · 부교재는 회원',
    },
  },
  {
    id: 'essay-workbook',
    formerTitle: '서술형 워크북 주문제작',
    group: 'exam',
    title: '서술형 워크북',
    summary: '조건영작배열·글의의미 서술형을 지문 단위 난도 묶음으로',
    href: '/essay-workbook',
    cta: '주문하기',
    badges: ['made-to-order', 'member'],
    facts: {
      price: `지문당 ${won(ESSAY_WORKBOOK_PRICE_PER_SOURCE)}`,
      delivery: '주문 접수 후 확인하여 PDF 발송',
      format: 'PDF',
      condition: '로그인 필요 · 부교재 (모의고사판은 payperic)',
    },
  },
  {
    id: 'workbook',
    formerTitle: '모의고사·부교재·교과서 워크북 주문',
    group: 'exam',
    title: '워크북',
    summary: '빈칸쓰기·낱말배열·어법 등 워크북을 모의고사·부교재·교과서별로',
    href: '/workbook/mockexam',
    cta: '워크북 주문',
    links: [
      { label: '모의고사', href: '/workbook/mockexam' },
      { label: '부교재', href: '/workbook/textbook' },
      { label: '교과서', href: '/workbook/gyogwaseo' },
    ],
    badges: ['made-to-order'],
    facts: {
      price: `자료별 지문당 ${won(100)}~${won(300)} · 50지문 이상 10%, 100지문 이상 20% 할인`,
      delivery: MADE_TO_ORDER_DELIVERY,
      condition: '모의고사 워크북은 월·연회원 무료',
    },
  },
  {
    id: 'ai',
    formerTitle: '변형문제 만들기',
    group: 'exam',
    title: 'AI 변형문제 만들기',
    summary: '지문을 넣으면 객관식·서술형·워크북 어법 초안을 직접 생성하는 도구 (주문 아님)',
    href: '/variant',
    cta: '직접 만들기',
    badges: ['tool'],
    facts: {
      price: `본인 Anthropic API 키 사용 — 생성 비용은 Anthropic이 키 소유자에게 청구 · 회원판 고난도는 문항당 ${pts(VARIANT_HARD_INSERTION_POINT_COST)} 추가`,
      delivery: '바로 — 화면에서 생성',
      format: '회원: HWP·Excel로 내보내기',
      condition: 'API 키 필요 · 저장·내보내기는 월구독·연회원 (가입 후 7일 체험)',
    },
  },

  /* ── 시험지 · 교재 구성 ─────────────────────── */
  {
    id: 'final-mock',
    group: 'compose',
    title: '파이널 예비 모의고사',
    summary: '시험 범위(부교재+모의고사)를 정해 예비 시험지를 바로 발급',
    href: '/unified',
    cta: '범위 설정',
    badges: ['premium', 'instant'],
    facts: {
      price: '선택 문항 가격만큼 포인트 차감 (쏠북 교재 포함 시 원화 입금)',
      delivery: '포인트 차감 즉시 발급 — 「내 다운로드」',
      format: '문제지·정답해설 PDF',
      condition: `연회원·월구독 전용 (월 ${won(MEMBERSHIP_MONTHLY_WON)} · 연 ${won(MEMBERSHIP_ANNUAL_REFERENCE_WON)})`,
    },
  },
  {
    id: 'order-num',
    formerTitle: '번호별 교재 제작하기',
    group: 'compose',
    title: '번호별 교재 제작',
    summary: '모의고사를 번호별로 묶어 강의·수업용 자료와 변형문제로 교재 구성',
    href: '/order-num',
    cta: '교재 구성',
    badges: ['made-to-order'],
    facts: {
      price: `자료별 지문당 가격 · 변형 유형 문항당 ${won(VARIANT_PRICE.base)}·고난도 ${won(VARIANT_PRICE.advanced)}`,
      delivery: MADE_TO_ORDER_DELIVERY,
      condition: '비회원도 주문 가능 · 이메일로 전달',
    },
    note: '이 상품에는 무료 7종 0원 규칙이 적용되지 않습니다',
  },
  {
    id: 'bundle',
    group: 'compose',
    title: '통합 주문',
    summary: '교과서·부교재 하나를 기준으로 변형·워크북·서술형·분석지·단어장을 한 번에',
    href: '/bundle',
    cta: '자료 담기',
    badges: ['made-to-order', 'member'],
    facts: {
      price: '담은 자료별 가격의 합',
      delivery: MADE_TO_ORDER_DELIVERY,
      condition: '회원 전용 (로그인)',
    },
  },

  /* ── 무료 학습 · 체험 ─────────────────────── */
  {
    id: 'free-variant',
    formerTitle: '무료 변형문제',
    group: 'free',
    title: '무료 변형문제 PDF',
    summary: '모의고사 지문 무료 7종 변형문제를 가입 없이 PDF로',
    href: '/free',
    cta: '무료 PDF 받기',
    badges: ['free', 'instant'],
    facts: {
      price: '무료',
      delivery: '바로 — PDF 다운로드',
      format: 'PDF',
      condition: `로그인 없음 · PDF당 최대 ${PUBLIC_FREE_MAX_QUESTIONS_PER_PDF}문항 · 하루 ${PUBLIC_FREE_DAILY_LIMIT}회`,
    },
  },
  {
    id: 'practice',
    group: 'free',
    title: '순서·삽입 연습',
    summary: '모의고사 지문으로 새 순서·삽입 문항을 웹에서 바로 풀기',
    href: '/practice',
    cta: '연습하기',
    badges: ['free', 'instant'],
    facts: {
      price: '무료',
      delivery: '바로 — 웹에서 풀이',
      format: '웹 화면 (파일 아님)',
      condition: '누구나 · 해설·오답 분석은 회원',
    },
  },
];

/** 쏠북 바로구매 — 찾기 쉬운 별도 바로가기 */
export const SOLBOOK_SHORTCUT = {
  title: '쏠북 바로구매',
  summary: '쏠북에 올린 변형문제·워크북을 교재·단원별로 찾아 바로 구매',
  href: '/solbook',
} as const;

export function servicesInGroup(group: ServiceGroup): ServiceDef[] {
  return SERVICES.filter((s) => s.group === group);
}

export function serviceById(id: string): ServiceDef | undefined {
  return SERVICES.find((s) => s.id === id);
}
