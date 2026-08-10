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
  roundCount?: number;
}

export interface VariantJob {
  id?: string;
  name?: string;
  textbook: string;
  sources: string[];
  categories: string[];
  option_type: 'English';
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

// 주문서(QuestionSettings)가 쓰는 키 그대로. 이름이 어긋나면 옵션이 조용히 누락된다
// — BV-20260810-001 시험 주문에서 bySourceNumber·fullRandomPair 가 빠지는 것을 확인하고 맞춤.
const STORAGE_TO_SAVE: Record<string, keyof VariantJob['save']> = {
  bySourceNumber: 'by_number',
  byNumber: 'by_number',          // 구 이름 호환
  byCategory: 'by_category',
  byChapter: 'by_chapter',
  byRound: 'by_round',
  fullRandomPair: 'single_full',  // 전체 1파일 + 랜덤본
  singleFull: 'single_full',      // 구 이름 호환
};

const VALID_DIFFICULTY = new Set(['상', '중', '하']);

/**
 * 선택지 언어는 항상 English.
 * 2026-08 납품에서 주제·주장·일치·불일치 392문항이 한국어 선택지로 나가 전량 재생성했다.
 * 고객이 고를 수 있게 만들려면 생성 규칙(rules.py)까지 함께 바꿔야 한다 — 필드만으로는
 * 내용이 보증되지 않는다(당시 option_type 은 전부 English 였다).
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
    option_type: 'English',
    difficulty,
    n_per_source_category: meta.questionsPerType ?? null,
    output_mode: meta.outputMode || '지문통합+간단정답지+해설',
    save,
    shuffle_full_file: Boolean(meta.shuffleFullFile),
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
