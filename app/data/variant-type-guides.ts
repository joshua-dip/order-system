/**
 * 변형문제 유형별 학습 가이드 — 샘플 페이지(/sample/[type]) 콘텐츠 단일 소스.
 *
 * 각 유형: 무엇을 묻는지(whatItTests) · 정답이 어떻게 구성되는지(answerStructure) ·
 * 어떻게 공부/활용하는지(studyDirection). 고난도는 base 가이드 + advancedNote 로 합성.
 *
 * node/브라우저 의존 없음 → server(page)·client 양쪽에서 import 가능.
 */

export interface VariantTypeGuide {
  /** 표시 유형명 (예: '빈칸-고난도') */
  label: string;
  isAdvanced: boolean;
  /** 한 줄 소개 */
  blurb: string;
  /** 이런 유형이에요 — 무엇을 묻고 무엇을 평가하는지 */
  whatItTests: string;
  /** 정답은 이렇게 구성돼요 — 정답·오답 구성 */
  answerStructure: string;
  /** 이렇게 공부하세요 — 풀이/학습 방향 */
  studyDirection: string;
  /** 고난도 전용 추가 설명 (있으면 페이지에서 강조) */
  advancedNote?: string;
}

type BaseGuide = Omit<VariantTypeGuide, 'label' | 'isAdvanced' | 'advancedNote'>;

const BASE_GUIDES: Record<string, BaseGuide> = {
  주제: {
    blurb: '글 전체가 말하는 핵심 주제를 고르는 유형',
    whatItTests: '글 전체를 관통하는 중심 생각을 한 문장(영어)으로 고릅니다. 세부 정보가 아니라 글이 무엇에 관한 글인지를 파악하는지 평가합니다.',
    answerStructure: '정답은 글의 중심 내용을 가장 포괄적으로 담은 진술입니다. 오답은 ① 너무 지엽적(일부만 다룸) ② 너무 광범위·일반적 ③ 본문과 반대 ④ 언급은 되나 주제가 아닌 것으로 구성됩니다.',
    studyDirection: '첫 문장·마지막 문장과 반복되는 핵심어로 글의 방향을 먼저 잡고, 각 선택지를 「너무 좁다 / 너무 넓다 / 방향이 다르다」로 걸러내는 연습을 하세요.',
  },
  제목: {
    blurb: '글의 핵심을 함축한 제목을 고르는 유형',
    whatItTests: '글의 주제를 비유적·압축적으로 담은 제목을 고릅니다. 주제 파악에 더해 함축 표현을 포착하는 능력을 평가합니다.',
    answerStructure: '정답은 주제를 함축·비유적으로 표현한 것입니다. 오답은 지엽적 소재, 과장, 반대 방향, 또는 핵심을 놓친 평이한 표현입니다.',
    studyDirection: '먼저 주제를 한 문장으로 정리한 뒤, 그 주제를 가장 잘 함축한 제목을 고르는 2단계로 접근하세요.',
  },
  주장: {
    blurb: '필자가 내세우는 주장(요지)을 고르는 유형',
    whatItTests: '사실 정보가 아니라 필자의 의견·결론을 파악합니다. 글에서 필자가 권하거나 강조하는 바를 고릅니다.',
    answerStructure: '정답은 필자의 핵심 주장입니다. 오답은 본문 소재를 활용하되 필자 의견이 아니거나, 부분적·반대 진술입니다.',
    studyDirection: 'should·must·need to 같은 당위 표현과 결론부의 신호어(therefore, in short 등)에 주목하세요.',
  },
  일치: {
    blurb: '본문 내용과 일치하는 선택지를 고르는 유형',
    whatItTests: '선택지(영어 진술) 중 본문 사실과 정확히 일치하는 것을 고릅니다. 세부 정보의 정확한 독해를 평가합니다.',
    answerStructure: '정답은 본문과 사실이 정확히 일치하는 진술입니다. 오답은 숫자·대상·인과·한정어를 미세하게 바꿔 불일치하게 만든 것입니다.',
    studyDirection: '각 선택지의 키워드를 본문에서 찾아 1:1로 대조하세요. 특히 수치·범위·부정어를 꼼꼼히 확인합니다.',
  },
  불일치: {
    blurb: '본문과 일치하지 않는 선택지를 고르는 유형',
    whatItTests: '선택지 중 본문 내용과 일치하지 않는 하나를 고릅니다.',
    answerStructure: '정답(=불일치)은 본문 사실을 한 군데 틀리게 바꾼 진술이고, 나머지 4개는 본문과 일치합니다.',
    studyDirection: '일치 유형과 같은 방식으로 대조하되, 「틀린 한 곳」을 찾는 데 집중하세요.',
  },
  함의: {
    blurb: '밑줄 친 표현의 함축 의미를 고르는 유형',
    whatItTests: '밑줄 친 비유·함축 표현이 글에서 실제로 의미하는 바를 고릅니다.',
    answerStructure: '정답은 밑줄의 속뜻을 글 맥락으로 풀어낸 진술입니다. 오답은 표면적 직역, 반대 해석, 무관한 확대 해석입니다.',
    studyDirection: '밑줄 앞뒤 문맥에서 비유의 원관념을 찾고, 표면 뜻이 아니라 글의 논지에 맞는 해석을 고르세요.',
  },
  빈칸: {
    blurb: '논리 흐름상 빈칸에 들어갈 말을 추론하는 유형',
    whatItTests: '글의 논리 흐름상 빈칸에 들어갈 말을 추론합니다. 글의 핵심 논리를 파악하는지 평가합니다.',
    answerStructure: '정답은 빈칸 전후의 논리(인과·대조·예시·요약)에 부합합니다. 오답은 본문 어휘를 쓰되 논리가 어긋나거나 반대인 것입니다.',
    studyDirection: '빈칸 문장이 글에서 하는 역할(주제문/근거/전환)을 파악하고, 연결어·지시어로 앞뒤 논리를 추적하세요.',
  },
  요약: {
    blurb: '요약문 두 빈칸 (A)·(B)를 고르는 유형',
    whatItTests: '글 전체를 한 문장으로 요약한 문장의 두 빈칸 (A)·(B)에 들어갈 말을 고릅니다.',
    answerStructure: '정답은 (A)·(B)가 각각 글의 핵심 두 축을 정확히 대표합니다(흔히 상위어·일반화). 오답은 한쪽만 맞거나 본문과 반대입니다.',
    studyDirection: '요약문 골격을 먼저 읽어 글의 핵심 두 축을 잡은 뒤, (A)(B) 후보를 본문 근거로 검증하세요.',
  },
  어법: {
    blurb: '밑줄 중 어법상 틀린 곳을 고르는 유형',
    whatItTests: '밑줄 5곳 중 어법상 틀린 한 곳을 고릅니다. 수 일치·시제·준동사·관계사·병렬 등 문법 정확성을 평가합니다.',
    answerStructure: '정답은 어법상 틀린 한 곳이고 나머지 4곳은 모두 올바른 표현입니다. 해설은 틀린 형태↔올바른 형태를 대비해 설명합니다.',
    studyDirection: '밑줄별로 수 일치/시제/준동사/관계사/병렬 등 핵심 포인트를 체크리스트로 점검하는 습관을 들이세요.',
  },
  어휘: {
    blurb: '문맥상 부적절한 낱말을 고르는 유형',
    whatItTests: '밑줄 5곳 중 문맥상 낱말의 쓰임이 적절하지 않은 한 곳을 고릅니다.',
    answerStructure: '정답은 문맥과 반대·부적절한 낱말(흔히 반의어)이고, 나머지는 문맥에 맞습니다.',
    studyDirection: '각 밑줄 단어를 글의 긍정/부정·논리 방향과 대조하세요. 반의어 함정에 특히 유의합니다.',
  },
  순서: {
    blurb: '이어질 단락의 순서를 정하는 유형',
    whatItTests: '주어진 글 다음에 이어질 (A)(B)(C) 단락의 순서를 정합니다. 글의 논리적 전개를 파악합니다.',
    answerStructure: '정답은 연결어·지시어·내용 흐름으로 정해지는 유일한 순서입니다. 보기는 5가지 순열로 고정됩니다.',
    studyDirection: '각 단락 첫머리의 연결어·대명사·정관사가 가리키는 앞 내용을 단서로 연결 고리를 찾으세요.',
  },
  삽입: {
    blurb: '주어진 문장이 들어갈 위치를 고르는 유형',
    whatItTests: '주어진 문장이 들어갈 가장 적절한 위치(①~⑤)를 고릅니다.',
    answerStructure: '정답 위치는 주어진 문장의 지시어·연결어가 앞뒤 문맥과 맞아떨어지는 곳입니다. 오답 위치는 넣으면 흐름이 끊깁니다.',
    studyDirection: '주어진 문장의 연결 단서(however, this, such 등)를 찾아, 앞뒤에 논리 공백이 생기는 자리를 메우세요.',
  },
  무관한문장: {
    blurb: '흐름과 관계 없는 문장을 고르는 유형',
    whatItTests: '글의 전체 흐름과 관계 없는 문장(①~⑤)을 고릅니다.',
    answerStructure: '정답은 소재는 비슷하나 글의 논지에서 벗어난 문장이고, 나머지는 주제로 자연스럽게 연결됩니다.',
    studyDirection: '글의 중심 논지를 먼저 잡고, 각 문장이 그 논지에 기여하는지 점검하세요. 소재만 같고 방향이 다른 문장을 가려냅니다.',
  },
};

/** 고난도 유형별 추가 설명 (base 가이드에 덧붙임). key = 고난도 유형명 */
const ADVANCED_NOTES: Record<string, string> = {
  '삽입-고난도': '기본 삽입과 같지만 지시어·연결어 같은 위치 단서를 약하게 만들어, 내용 논리만으로 자리를 판단해야 합니다.',
  '어법-고난도': '어법상 틀린 곳이 2개 이상이며 「모두 고르시오」로 묻는 복수 정답 유형입니다(정답이 ①③ 처럼 2개 이상).',
  '빈칸-고난도': '단어 하나가 아니라 긴 구·절을 추론하며, 선택지가 정교한 패러프레이즈로 구성돼 변별력이 높습니다.',
  '어휘-고난도': '문맥상 부적절한 낱말이 2개 이상인 「모두 고르시오」 복수 정답 유형입니다.',
  '순서-고난도': '연결어·지시어 단서를 약화해, 단서보다 내용의 논리적 인과로 순서를 정해야 합니다.',
  '요약-고난도': '(A)·(B)에 본문 표현이 아니라 상위어·추상어가 들어가 한 단계 더 추론해야 합니다.',
  '무관한문장-고난도': '무관한 문장이 주제어를 공유해 표면상 자연스러워 보여, 위장 강도가 높습니다.',
  '함의-고난도': '밑줄이 더 비유적·반어적이고 선택지 함정이 정교해 깊은 맥락 추론이 필요합니다.',
  '주제-고난도': '선택지에 C2~C3 수준의 고난도 영어 어휘를 섞어, 주제 파악에 더해 어휘력까지 요구합니다. 해설에 어려운 단어의 뜻·유의어가 함께 제공됩니다.',
  '제목-고난도': '선택지에 C2~C3 수준의 고난도 영어 어휘를 섞어, 제목 추론에 더해 어휘력까지 요구합니다. 해설에 어려운 단어의 뜻·유의어가 함께 제공됩니다.',
  '주장-고난도': '선택지를 영어로 제시하고 C2~C3 고난도 어휘를 섞어, 주장 파악과 어휘력을 함께 평가합니다. 해설에 어려운 단어의 뜻·유의어가 제공됩니다.',
  '일치-고난도': '선택지(영어 진술)에 C2~C3 고난도 어휘를 섞어, 내용 일치 판단에 어휘력을 더합니다. 해설에 어려운 단어의 뜻·유의어가 제공됩니다.',
  '불일치-고난도': '선택지(영어 진술)에 C2~C3 고난도 어휘를 섞어, 내용 불일치 판단에 어휘력을 더합니다. 해설에 어려운 단어의 뜻·유의어가 제공됩니다.',
};

/** 고난도 유형명 → 기본 유형명 (예: '빈칸-고난도' → '빈칸') */
export function baseVariantType(type: string): string {
  return type.replace(/-고난도$/, '').trim();
}

/** 유형명으로 학습 가이드를 합성해 반환. 알 수 없는 유형이면 null. */
export function getVariantTypeGuide(type: string): VariantTypeGuide | null {
  const t = (type ?? '').trim();
  if (!t) return null;
  const isAdvanced = t.endsWith('-고난도');
  const base = BASE_GUIDES[baseVariantType(t)];
  if (!base) return null;
  return {
    label: t,
    isAdvanced,
    blurb: base.blurb,
    whatItTests: base.whatItTests,
    answerStructure: base.answerStructure,
    studyDirection: base.studyDirection,
    advancedNote: isAdvanced ? (ADVANCED_NOTES[t] ?? '난도를 높인 고난도 변형입니다.') : undefined,
  };
}

/** 가이드가 존재하는 모든 유형명 (base + 고난도). */
export function allGuideTypes(): string[] {
  return [...Object.keys(BASE_GUIDES), ...Object.keys(ADVANCED_NOTES)];
}
