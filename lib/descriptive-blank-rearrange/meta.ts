export const PROBLEM_TYPE_KEYS = [
  'blank_rearrangement_subject',
  'blank_rearrangement_gram',
  'blank_rearrangement_blank2_subject',
  'blank_rearrangement_blank2_gram',
  'blank_rearrangement_subject_hard',
  'blank_rearrangement_gram_hard',
  'blank_rearrangement_blank2_subject_hard',
  'blank_rearrangement_blank2_gram_hard',
] as const;

export type ProblemTypeKey = (typeof PROBLEM_TYPE_KEYS)[number];

export const PROBLEM_TYPE_META: Record<ProblemTypeKey, { name: string; description: string }> = {
  blank_rearrangement_subject: {
    name: '빈칸재배열형(주제)',
    description: '주제문에서 핵심 구를 뽑아 재배열하여 완성',
  },
  blank_rearrangement_gram: {
    name: '빈칸재배열형(어법)',
    description: '어법상 중요한 구조에서 구를 뽑아 재배열하여 완성',
  },
  blank_rearrangement_blank2_subject: {
    name: '빈칸재배열형(A+B·주제)',
    description: '같은 지문에서 주제문 중심으로 빈칸 (A)+(B) 두 개를 재배열하여 완성',
  },
  blank_rearrangement_blank2_gram: {
    name: '빈칸재배열형(A+B·어법)',
    description: '같은 지문에서 어법 구조 중심으로 빈칸 (A)+(B) 두 개를 재배열하여 완성',
  },
  blank_rearrangement_subject_hard: {
    name: '빈칸재배열형(주제·Hard)',
    description: '주제문에서 긴 구를 뽑아 낱단어 8~13개로 재배열 (Hard)',
  },
  blank_rearrangement_gram_hard: {
    name: '빈칸재배열형(어법·Hard)',
    description: '어법 구조에서 긴 구를 뽑아 낱단어 8~13개로 재배열 (Hard)',
  },
  blank_rearrangement_blank2_subject_hard: {
    name: '빈칸재배열형(A+B·주제·Hard)',
    description: '같은 지문에서 주제문 중심으로 빈칸 (A)+(B) 낱단어 8~13개로 재배열 (Hard)',
  },
  blank_rearrangement_blank2_gram_hard: {
    name: '빈칸재배열형(A+B·어법·Hard)',
    description: '같은 지문에서 어법 구조 중심으로 빈칸 (A)+(B) 낱단어 8~13개로 재배열 (Hard)',
  },
};
