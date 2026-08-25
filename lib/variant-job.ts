/**
 * 주문(orderMeta) → 변형문제 제작기 job JSON 변환.
 *
 * 제작기(multi_job_runner.py)가 소비하는 계약은 schemas/variant-job.schema.json 이다.
 * 이 파일은 그 계약을 향한 유일한 변환 지점이다 — 주문서 필드가 늘면 여기만 고친다.
 *
 * 배경: 2026-08 BV-20260806-001 처리 때 이 변환이 없어 job JSON 을 손으로 만들었고,
 * 주문서의 orderInsertExplanation 이 제작기까지 전달되지 않아 전역 설정 파일을
 * 매 실행마다 고쳐야 했다. (전역 파일이라 동시에 두 주문을 처리할 수 없었다.)
 */

export type HwpStorageModeKey = 'byNumber' | 'byCategory' | 'byChapter' | 'byRound' | 'singleFull';

export interface VariantOrderMeta {
  flow?: string;
  selectedTextbook?: string;
  selectedLessons?: string[];
  selectedTypes?: string[];
  questionsPerType?: number;
  email?: string;
  useCustomHwp?: boolean;
  hwpStorageModes?: string[];
  orderInsertExplanation?: Record<string, boolean>;
  difficulty?: string;
  shuffleFullFile?: boolean;
  excludeDelivered?: boolean;
  outputMode?: string;
  /** 선택지 언어. 'Korean' 은 주문 제작 요청(재고에서 뽑지 않고 새로 만든다) */
  optionType?: string;
  roundCount?: number;
}

export interface VariantJob {
  id?: string;
  name?: string;
  textbook: string;
  sources: string[];
  categories: string[];
  option_type: 'English' | 'Korean';
  difficulty: string;
  n_per_source_category: number | null;
  explanation_by_category?: Record<string, boolean>;
  output_mode: string;
  save: {
    single_full: boolean;
    by_number: boolean;
    by_category: boolean;
    by_chapter: boolean;
    by_round: boolean;
  };
  round_count?: number;
  shuffle_full_file: boolean;
  hwp_template?: string;
  output_file_tag?: string;
  exclude_delivered_for_email?: string;
  exclude_delivered_except_order?: string;
  auto_pdf: boolean;
  hwp_visible: boolean;
}

/**
 * 주문서 폼의 저장 방식 키 → job.save.
 *
 * 키 문자열은 QuestionSettings 의 HwpStorageModeKey 와 **정확히** 같아야 한다.
 * 처음 구현에서 'byNumber'/'singleFull' 로 적어 두는 바람에, 폼이 실제로 보내는
 * 'bySourceNumber'/'fullRandomPair' 가 조용히 버려졌다 — 고객이 「번호별」을 골라도
 * job 에 실리지 않아 강별로만 나갔다. 옛 주문 호환을 위해 두 이름 모두 받는다.
 */
const STORAGE_TO_SAVE: Record<string, keyof VariantJob['save']> = {
  bySourceNumber: 'by_number',
  byCategory: 'by_category',
  byChapter: 'by_chapter',
  byRound: 'by_round',
  fullRandomPair: 'single_full',
  /* 통합본 — 나눈 파일과 별도로 전체를 한 파일에 담는다. fullRandomPair 와 같은 save 플래그를
     쓰지만 셔플(shuffle_full_file)은 걸지 않는다는 점이 다르다.
     2026-08 이전 주문에 남아 있는 같은 이름도 뜻이 같아 그대로 받는다. */
  singleFull: 'single_full',
  // 옛 주문(2026-08 이전 표기) 호환
  byNumber: 'by_number',
};

const VALID_DIFFICULTY = new Set(['상', '중', '하']);

/**
 * 선택지 언어는 기본 English. 주문서에서 「한글 — 주문 제작 요청」을 고른 경우에만 Korean 이 된다.
 *
 * ⚠️ Korean 은 **재고에서 뽑는 값이 아니다.** 2026-08 기준 DB 의 완료 문항 중 option_type=Korean
 * 은 전 유형 0건이라, 이 값으로 그냥 돌리면 문항이 하나도 안 나온다. 운영자가 요청을 확인하고
 * 한글 선택지 문항을 새로 만들어야 한다(주문 제작).
 *
 * 또한 이 필드만으로는 내용이 보증되지 않는다 — 2026-08 납품에서 주제·주장·일치·불일치
 * 392문항이 option_type 은 English 인데 내용은 한국어로 나가 전량 재생성했다. 생성 규칙에서도
 * 언어를 강제해야 한다.
 */
export function buildVariantJob(
  orderNumber: string,
  meta: VariantOrderMeta,
  opts: { hwpTemplatePath?: string; autoPdf?: boolean } = {}
): VariantJob {
  const textbook = (meta.selectedTextbook ?? '').trim();
  const sources = (meta.selectedLessons ?? []).filter((s) => typeof s === 'string' && s.trim());
  const categories = (meta.selectedTypes ?? []).filter((s) => typeof s === 'string' && s.trim());
  if (!textbook) throw new Error('orderMeta.selectedTextbook 없음');
  if (!sources.length) throw new Error('orderMeta.selectedLessons 비어 있음');
  if (!categories.length) throw new Error('orderMeta.selectedTypes 비어 있음');

  const save: VariantJob['save'] = {
    single_full: false,
    by_number: false,
    by_category: false,
    by_chapter: false,
    by_round: false,
  };
  for (const m of meta.hwpStorageModes ?? []) {
    const key = STORAGE_TO_SAVE[m];
    if (key) save[key] = true;
  }
  if (!Object.values(save).some(Boolean)) save.by_chapter = true;  // 아무것도 없으면 강별

  /**
   * 「전문항랜덤」은 폼 설명상 *기본 순서 1벌 + 무작위 순서 1벌* 이다.
   * 러너(multi_job_runner.py)는 job 하나당 파일 한 벌만 만들고 shuffle_full_file 은
   * 단순히 섞기 여부라, 두 벌은 job 하나로 표현할 수 없다. 여기서는 전체 1파일 + 섞기로
   * 내보내고, 기본 순서 벌이 함께 필요하면 같은 주문을 shuffle 없이 한 번 더 돌린다.
   */
  const wantsRandomPair = (meta.hwpStorageModes ?? []).includes('fullRandomPair');

  // 유형별 해설 포함 여부 — 주문서는 순서·삽입만 받는다. 나머지는 기본(포함).
  const explanation: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(meta.orderInsertExplanation ?? {})) {
    if (typeof v === 'boolean') explanation[k] = v;
  }
  // 고난도 변형은 원 유형의 설정을 따른다 — 따로 물어보지 않는다
  if ('순서' in explanation) explanation['순서-고난도'] = explanation['순서'];

  const email = (meta.email ?? '').trim();
  const difficulty = VALID_DIFFICULTY.has(meta.difficulty ?? '') ? (meta.difficulty as string) : '중';

  const job: VariantJob = {
    id: orderNumber,
    name: `${orderNumber} ${textbook}`,
    textbook,
    sources,
    categories,
    option_type: meta.optionType === 'Korean' ? 'Korean' : 'English',
    difficulty,
    n_per_source_category: meta.questionsPerType ?? null,
    output_mode: meta.outputMode || '지문통합+간단정답지+해설',
    save,
    shuffle_full_file: Boolean(meta.shuffleFullFile) || wantsRandomPair,
    auto_pdf: opts.autoPdf ?? true,
    hwp_visible: false,
  };
  if (Object.keys(explanation).length) job.explanation_by_category = explanation;
  if (save.by_round && meta.roundCount) job.round_count = meta.roundCount;
  if (email) job.output_file_tag = email;
  if (meta.excludeDelivered && email) {
    job.exclude_delivered_for_email = email;
    job.exclude_delivered_except_order = orderNumber;   // 같은 주문 재실행 시 자기 이력에 막히지 않게
  }
  if (meta.useCustomHwp && opts.hwpTemplatePath) job.hwp_template = opts.hwpTemplatePath;
  return job;
}

/** 이 주문으로 만들어질 문항 수(상한). 실제로는 DB 재고에 따라 줄 수 있다. */
export function estimateQuestionCount(meta: VariantOrderMeta): number {
  const s = (meta.selectedLessons ?? []).length;
  const c = (meta.selectedTypes ?? []).length;
  const n = meta.questionsPerType ?? 0;
  return s * c * n;
}
