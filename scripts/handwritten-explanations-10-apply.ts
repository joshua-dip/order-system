import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const DRY_RUN = process.argv.includes('--dry-run');

const PATCHES: { id: string; explanation: string }[] = [
  // ═══════════════════════════════════════════════════════════════════
  //  03강 17번 — 큰 물고기-작은 연못 효과 나머지
  // ═══════════════════════════════════════════════════════════════════

  // 빈칸① "get worse"
  {
    id: '69e11eb445fcceb0f02f49b2',
    explanation:
      '① get worse\n*해설: 빈칸은 "그러나 고성과자들에 둘러싸이면, 자신의 능력에 대한 인식이 ________"라는 문장에 있습니다. 저성과자 주변에서 더 긍정적으로 느끼는 것(Likewise)과 반대로, 고성과자 주변에서는 능력 인식이 "나빠질 것(get worse)"이라는 흐름이 자연스럽습니다. stay the same·rapidly improve·become more accurate·grow stronger over time은 이 맥락과 어울리지 않습니다.',
  },
  // 빈칸① "emotionally stressful"
  {
    id: '69e11eb745fcceb0f02f49b3',
    explanation:
      '① emotionally stressful\n*해설: 빈칸은 "고성과자들 주변에 있는 것은 다른 학생들에게 ________일 수 있다"는 문장에 있습니다. 고성과자들에 둘러싸이면 자신의 능력 인식이 나빠진다는 본문 내용에서, 이것이 "감정적으로 스트레스가 되는(emotionally stressful)" 경험임이 가장 자연스럽습니다. academically helpful·socially rewarding·intellectually stimulating·surprisingly motivating은 이 부정적 맥락과 어울리지 않습니다.',
  },
  // 요약① (better/worse)
  {
    id: '69e11ebe45fcceb0f02f49b4',
    explanation:
      '①이 정답입니다. (A) better(더 좋게): 저성과자들에 둘러싸이면 자신의 능력에 대해 "더 긍정적(better)"으로 느낀다는 원문과 일치합니다. (B) worse(더 나쁘게): 고성과자들에 둘러싸이면 자신의 능력 인식이 "나빠진다(worse)"는 원문과 일치합니다. ②는 (A)와 (B)가 반대로 배치, ③은 "confident→proud", ④는 "anxious→calm", ⑤는 "motivated→confused"로 모두 지문 내용과 맞지 않습니다.',
  },
  // 요약① (perception/performance)
  {
    id: '69e11ec145fcceb0f02f49b5',
    explanation:
      '①이 정답입니다. (A) perception(인식): 자신의 능력에 대한 "인식(perception)"이 주변 환경에 의해 영향을 받는다는 원문과 일치합니다. (B) performance(성과): 주변 사람들의 "성과(performance)" 수준에 따라 자기 인식이 달라진다는 원문의 "low performing / high achieving"과 일치합니다. ②는 "memory→appearance", ③은 "improvement→attitude", ④는 "motivation→income", ⑤는 "evaluation→personality"로 모두 지문 내용과 맞지 않습니다.',
  },
  // 순서③ (C)-(A)-(B)
  {
    id: '69e11ec945fcceb0f02f49b6',
    explanation:
      '③ 가 정답입니다. 큰 물고기-작은 연못 효과가 큰 영향을 미치며 작은 연못의 물고기는 상대적으로 크다고 느낀다는 도입 뒤에, (C)는 마찬가지로 주변 사람들이 저성과이면 자신의 능력에 더 긍정적으로 느낀다는 긍정적 상황, (A)는 반면 고성과자들에 둘러싸이면 자신의 능력 인식이 나빠지고 Götz 교수가 이 현상을 연구했다는 역접·연구 소개, (B)는 수학 학생들이 저성과자들과 있을 때 더 자신을 좋게 느끼며 고성과자들 주변이 감정적 스트레스가 된다는 연구 결과·결론으로 이어집니다.\n논리 흐름 요약: 저성과자 주변=긍정적 → 고성과자 주변=나쁨·연구 소개 → 연구 결과·결론.',
  },
  // 순서② (B)-(A)
  {
    id: '69e11ecb45fcceb0f02f49b7',
    explanation:
      '② 가 정답입니다. 저성과자들에 둘러싸이면 자신의 능력에 더 긍정적이라는 도입 뒤에, (B)는 반면 고성과자들에 둘러싸이면 자신의 능력 인식이 나빠진다는 역접, (A)는 Götz 교수의 최근 연구에서 수학 학생들이 저성과자들과 있을 때 더 자신을 좋게 느끼며 고성과자들 주변이 감정적 스트레스가 된다는 연구 결과·결론으로 이어집니다.\n논리 흐름 요약: 저성과자=긍정적 → 고성과자=나쁨(역접) → 연구 결과·결론.',
  },
  // 어법④ "surrounding" → "surrounded"
  {
    id: '69e11ed845fcceb0f02f49b8',
    explanation:
      '④ 가 정답입니다. "be + 과거분사"의 수동태 패턴이므로 surrounded가 맞습니다. surrounding은 현재분사로 이 수동의 의미를 나타낼 수 없습니다. correctForm은 "if you are surrounded by people who are high achieving", wrongForm은 "if you are surrounding by people who are high achieving"입니다. ①은 현재동사 has, ②는 부사 relatively, ③은 관계부사 where, ⑤는 부사 emotionally로 모두 문법에 맞습니다.',
  },
  // 어법③ "positively" → "positive"
  {
    id: '69e11eda45fcceb0f02f49b9',
    explanation:
      '③ 가 정답입니다. feel 다음에는 형용사 보어가 와야 하므로 positive가 맞습니다. positively는 부사로 feel 뒤의 보어 자리에 올 수 없습니다. correctForm은 "you will feel more positive about your own abilities", wrongForm은 "you will feel more positively about your own abilities"입니다. ①은 관계부사 how, ②는 부사 relatively, ④는 관계대명사 who, ⑤는 과거동사 tested로 모두 문법에 맞습니다.',
  },
  // 삽입② "This is because people tend to evaluate themselves relative to those around them..."
  {
    id: '69e11ee145fcceb0f02f49ba',
    explanation:
      '② 가 정답입니다. 주어진 문장은 "This is because(이것은 ~때문이다)"로 시작해, ② 앞의 "작은 연못의 물고기는 환경 때문에 상대적으로 크다고 느낀다"는 비유의 이유를 설명합니다. 사람들이 절대적 기준이 아닌 주변 사람과의 비교로 자신을 평가한다는 원리를 제시한 뒤, ② 뒤에서 "Likewise"로 이 원리를 인간에게 적용하는 내용으로 이어지는 흐름이 자연스럽습니다.\n논리 흐름 요약: 작은 연못 물고기=크다고 느낌 → 주변과 비교해서 자신을 평가하기 때문(주어진 문장) → 마찬가지로 저성과자 주변=긍정적.',
  },
  // 삽입④ "This effect has been studied in various academic settings, particularly in competitive school environments."
  {
    id: '69e11ee445fcceb0f02f49bb',
    explanation:
      '④ 가 정답입니다. 주어진 문장은 "This effect(이 효과)"으로 시작해, ④ 앞의 "Götz 교수가 이 현상을 연구했다"는 내용을 받아, 이 효과가 다양한 학문적·경쟁적인 학교 환경에서 연구됐다고 보충합니다. ④ 뒤에서 "He found that(그는 ~를 발견했다)"으로 구체적인 수학 학생들의 연구 결과로 이어지는 흐름이 자연스럽습니다.\n논리 흐름 요약: Götz 교수 연구 소개 → 이 효과가 학교 환경에서 연구됨(주어진 문장) → 수학 학생 연구 결과.',
  },

  // ═══════════════════════════════════════════════════════════════════
  //  03강 18번 — 예술적 차용 (피카소)
  // ═══════════════════════════════════════════════════════════════════

  {
    id: '69e11f0745fcceb0f02f49bc',
    explanation:
      '①이 정답입니다. 글은 피카소의 인용("좋은 예술가는 복사하고 위대한 예술가는 훔친다")을 통해, 단순한 복사(모방)와 진정한 창의적 차용(변형해서 자신의 것으로 만들기)의 차이를 설명합니다. "the difference between copying and truly creative artistic borrowing"이 이 흐름을 담습니다. ②는 독창성의 역사적 기준, ③은 피카소가 최고 예술가인 이유, ④는 모방 회피의 이점(지문과 반대), ⑤는 예술 학교의 혁신 교육으로 모두 글의 초점 밖입니다.',
  },
  {
    id: '69e11f0a45fcceb0f02f49bd',
    explanation:
      '①이 정답입니다. 글은 위대한 예술가들이 단순히 다른 사람의 아이디어를 복사하는 것이 아니라 변형(Transform)해서 자신의 것으로 만든다는 내용입니다. "Great Artists Don\'t Just Copy — They Transform"은 이 핵심 메시지를 담습니다. ②는 독창성이 예술에서 가장 중요(지문과 반대), ③은 피카소의 진정한 독창성(지문과 다른 맥락), ④는 복사가 예술가의 경력을 망침(지문과 반대), ⑤는 성공을 위해 따라야 할 규칙으로 모두 글의 핵심 밖입니다.',
  },
  // 빈칸① "transforming"
  {
    id: '69e11f0f45fcceb0f02f49be',
    explanation:
      '① transforming\n*해설: 빈칸은 "훔치는 것은 다른 사람의 아이디어를 가져와 ________하는 것"이라는 문장에 있습니다. 이어서 "그렇게 함으로써 자신의 것으로 만든다"는 내용이 나오므로, 단순 복사가 아닌 아이디어를 "변형하는(transforming)" 것이 가장 자연스럽습니다. imitating(모방)·rejecting(거부)·hiding(숨기기)·repeating(반복)은 이 창의적 변형 맥락과 어울리지 않습니다.',
  },
  // 요약① (copy/transform)
  {
    id: '69e11f1345fcceb0f02f49bf',
    explanation:
      '①이 정답입니다. (A) copy(복사하다): 위대한 예술가들은 단순히 다른 사람의 아이디어를 "복사하는(copy)" 것에 그치지 않는다는 원문과 일치합니다. (B) transform(변형하다): 그들은 아이디어를 가져와 "변형해서(transform)" 자신의 것으로 만든다는 원문과 일치합니다. ②는 "ignore→replace", ③은 "share→imitate", ④는 "reject→copy", ⑤는 "praise→forget"으로 모두 지문 내용과 맞지 않습니다.',
  },
  // 순서③ (C)-(A)-(B)
  {
    id: '69e11f1945fcceb0f02f49c0',
    explanation:
      '③ 가 정답입니다. "진짜" 예술가는 항상 독창적이어야 한다는 믿음이 사실이 아니라는 도입 뒤에, (C)는 실제로 최고의 예술가들은 모두 다른 사람의 아이디어를 가져오며 피카소가 "좋은 예술가는 복사하고 위대한 예술가는 훔친다"고 말했다는 내용, (A)는 복사는 단순한 모방이지만 훔치는 것은 변형해서 자신의 것으로 만드는 것이라는 구분, (B)는 기본적으로 위대한 예술가들은 다른 사람의 아이디어에서 영감을 받아 더 나아지게 한다는 결론으로 이어집니다.\n논리 흐름 요약: 독창성 믿음 부정·실제(아이디어 차용)·피카소 인용 → 복사 vs 훔침 차이 → 결론.',
  },
  // 어법⑤ "inspiring" → "inspired"
  {
    id: '69e11f1c45fcceb0f02f49c1',
    explanation:
      '⑤ 가 정답입니다. "be + 과거분사"의 수동태 패턴에서 inspired(영감을 받다)가 맞습니다. inspiring은 "영감을 주는"이라는 능동형 분사로, "영감을 받는" 수동의 의미가 필요한 이 자리에 올 수 없습니다. correctForm은 "great artists are inspired by the ideas of others", wrongForm은 "great artists are inspiring by the ideas of others"입니다. ①은 형용사 original, ②는 부사 away, ③은 동명사 copying, ④는 동명사 Stealing으로 모두 문법에 맞습니다.',
  },
  // 삽입④ "Rather than being seen as theft, this process is the foundation of all genuine creative work."
  {
    id: '69e11f2445fcceb0f02f49c2',
    explanation:
      '④ 가 정답입니다. 주어진 문장은 "Rather than being seen as theft(도둑질로 보이기보다는)"으로 시작해, ④ 앞의 "훔치는 것은 다른 사람의 아이디어를 가져와 변형해서 자신의 것으로 만드는 것"이라는 내용을 받습니다. 주어진 문장이 이 과정이 실제로는 진정한 창의적 작업의 토대라고 재정의한 뒤, ④ 뒤에서 "기본적으로 위대한 예술가들은 다른 사람의 아이디어에서 영감을 받는다"는 결론으로 이어지는 흐름이 자연스럽습니다.\n논리 흐름 요약: 훔치기=변형해서 자신의 것으로 → 실제로는 창의적 작업의 토대(주어진 문장) → 결론.',
  },

  // ═══════════════════════════════════════════════════════════════════
  //  03강 19번 — Langston Hughes
  // ═══════════════════════════════════════════════════════════════════

  {
    id: '69e11f2d45fcceb0f02f49c3',
    explanation:
      '①이 정답입니다. 글은 랭스턴 휴즈의 출생·학창 시절의 영향·할렘 르네상스 참여·첫 시집과 소설·생애 내내의 창작 활동과 인기까지 생애와 문학적 업적을 소개합니다. "the life and literary achievements of Langston Hughes"가 이 흐름을 담습니다. ②는 월트 휘트먼의 영향, ③은 할렘 르네상스의 기원과 의의, ④는 20세기 초 아프리카계 미국 작가들이 직면한 어려움, ⑤는 컬럼비아 대학을 1년 만에 떠난 이유로 모두 글의 초점 밖입니다.',
  },
  {
    id: '69e11f3045fcceb0f02f49c4',
    explanation:
      '①이 정답입니다. 글은 랭스턴 휴즈가 학생 시절 시를 쓰기 시작해(From Student Poet) 할렘 르네상스·첫 시집과 소설을 거쳐 문학적 전설(Literary Legend)이 된 과정을 소개합니다. "Langston Hughes: From Student Poet to Literary Legend"는 이 성장과 업적의 흐름을 담습니다. ②는 할렘 르네상스와 현대 예술의 영향, ③은 월트 휘트먼의 젊은 시인들에 대한 영향, ④는 컬럼비아 대학이 미국 문학에 미친 영향, ⑤는 The Weary Blues가 걸작인 이유로 모두 글의 핵심 밖입니다.',
  },
  // 빈칸① "critics and average readers alike"
  {
    id: '69e11f3645fcceb0f02f49c5',
    explanation:
      '① critics and average readers alike\n*해설: 빈칸은 "그의 독특한 스타일과 미국 흑인 삶의 생동감 있는 묘사가 ________에게 인기를 끌게 했다"는 문장에 있습니다. 랭스턴 휴즈의 작품이 비평가와 일반 독자 모두에게 인기를 끌었다는 원문 그대로의 표현이 자연스럽습니다. only academic scholars·European writers exclusively·young poets in New York·Columbia University professors는 이 광범위한 인기 맥락과 어울리지 않습니다.',
  },

  // ═══════════════════════════════════════════════════════════════════
  //  15차 배치 — Langston Hughes 마무리 + Early Morning Exercise + Tall Poppy Syndrome
  // ═══════════════════════════════════════════════════════════════════

  // 요약문 (celebrated · vivid)
  {
    id: '69e11f3a45fcceb0f02f49c6',
    explanation:
      '①이 정답입니다. (A) celebrated: 지문에서 Hughes는 비평가와 일반 독자 모두에게 인기를 끌었고("made him popular with critics and average readers alike") Harmon 금메달까지 받은 저명한 인물이므로 \'저명한(celebrated)\'이 적절합니다. (B) vivid: 지문에서 "colorful descriptions of the lives of black people"라고 직접 명시했으므로 \'생생한(vivid)\'이 맞습니다. ②forgotten·dull, ③controversial·brief, ④unknown·technical, ⑤minor·exaggerated는 지문 내용과 반대이거나 근거가 없습니다.',
  },
  // 순서배열 (C)-(A)-(B)
  {
    id: '69e11f4245fcceb0f02f49c7',
    explanation:
      '③이 정답입니다. 주어진 글에서 Hughes의 학창 시절까지 소개한 뒤, (C)에서 "After high school"로 이어받아 Columbia University 입학·중퇴와 Harlem Renaissance 기여를 언급하고, (A)에서 1926년 첫 시집·1930년 첫 소설 출판과 Harmon 금메달 수상이라는 구체적 성취를 제시하며, (B)에서 평생 글쓰기와 최종 명성으로 마무리합니다.\n논리 흐름 요약: 학창 시절 → 대학·Harlem Renaissance → 출판·수상 → 평생 업적·명성',
  },
  // 어법 (⑤ making → made)
  {
    id: '69e11f4445fcceb0f02f49c8',
    explanation:
      '⑤가 정답입니다. "His unique style, as well as his colorful descriptions of the lives of black people in America, ⑤making him popular"에서 주어(His unique style, as well as his colorful descriptions...)에 대한 술어동사가 필요한데, making은 현재분사(준동사)이므로 완전한 술어동사가 될 수 없습니다. made로 고쳐야 주어+술어동사(made) 구조가 성립합니다. ①influenced(수동태 과거분사), ②attended(과거동사), ③contributor(명사), ④published(과거동사)는 모두 어법에 맞습니다.',
  },
  // 삽입 ④
  {
    id: '69e11f4a45fcceb0f02f49c9',
    explanation:
      '④가 정답입니다. 삽입 문장 "Despite leaving university early, this experience in New York shaped his artistic vision significantly."에서 \'leaving university early\'는 바로 앞 ③ 위치에서 언급된 Columbia University 중퇴를 가리키고, \'this experience in New York\'는 New York에서 Harlem Renaissance에 기여한 경험을 의미합니다. ③(Columbia 중퇴·Harlem Renaissance 기여) 직후인 ④에 삽입해야 지시어 this가 명확한 선행사를 갖고, 뒤이어 나오는 1926년 시집 출판으로 자연스럽게 이어집니다.',
  },

  // 주제 (Early Morning Exercise)
  {
    id: '69e11f6b45fcceb0f02f49ca',
    explanation:
      '①이 정답입니다. 글 전체가 이른 아침 운동의 장점(뇌 활성화·집중력 향상·상쾌함, 일정 충돌 없음, 삶의 일관성)을 차례로 제시하며 아침 운동을 권장합니다. ②는 수면 자체, ③은 주간 스케줄 작성법, ④는 운동 거르기의 부정적 영향, ⑤는 오후 훈련에 관한 내용으로 모두 지문의 핵심 논지와 다릅니다.',
  },
  // 제목 (Early Morning Exercise)
  {
    id: '69e11f6e45fcceb0f02f49cb',
    explanation:
      '①이 정답입니다. 글은 바쁜 사람들의 운동 시간 부족 문제를 이른 아침 운동으로 해결한다는 핵심 메시지를 담고 있어 \'Early Morning Exercise: A Simple Solution for Busy Lives\'가 제목으로 가장 적합합니다. ②는 저녁 운동이 더 낫다는 반대 방향, ③은 아침 공복 운동의 위험, ④는 주간 피트니스 계획 수립, ⑤는 수면·스트레스 관리에 관한 내용으로 지문의 논지와 다릅니다.',
  },
  // 빈칸① refreshed
  {
    id: '69e11f7245fcceb0f02f49cc',
    explanation:
      '① refreshed\n*해설: 빈칸이 포함된 "light exercise activates your sleepy brain, allowing you to concentrate better and making you feel ________"은 운동이 뇌를 활성화시켜 집중력을 높이고 기분을 어떻게 만드는지 묻습니다. 가벼운 아침 운동 후 느끼는 상태로 \'개운하고 상쾌한(refreshed)\'이 가장 자연스럽습니다. ②exhausted(지친), ③bored(지루한), ④distracted(산만한), ⑤anxious(불안한)는 운동의 긍정적 효과와 반대되거나 지문 내용과 무관합니다.',
  },
  // 빈칸② consistency
  {
    id: '69e11f7545fcceb0f02f49cd',
    explanation:
      '① consistency\n*해설: 빈칸이 포함된 "if you make exercise part of your routine, it can add ________ to your life"는 운동을 루틴화할 때 삶에 무엇이 더해지는지 묻습니다. 지문 전체가 규칙적인 아침 운동의 긍정적 효과를 강조하므로 \'일관성(consistency)\'이 가장 적절합니다. ②confusion(혼란), ③pressure(압박), ④boredom(권태), ⑤isolation(고립)은 긍정적 변화를 설명하는 문맥과 맞지 않습니다.',
  },
  // 요약문① (scheduling · activates)
  {
    id: '69e11f7d45fcceb0f02f49ce',
    explanation:
      '①이 정답입니다. (A) scheduling: 지문에서 "exercising is unlikely to create a scheduling conflict"라고 직접 언급했으므로 \'scheduling 충돌을 피한다\'가 정확합니다. (B) activates: 지문에서 "light exercise activates your sleepy brain"이라고 명시했으므로 뇌를 \'활성화시킨다(activates)\'가 적절합니다. ②~⑤는 지문에 없는 개념(financial, social, sleeping, dietary 충돌)이거나 반대 의미(relaxes, tires, slows, confuses)입니다.',
  },
  // 요약문② (habit · alertness)
  {
    id: '69e11f7f45fcceb0f02f49cf',
    explanation:
      '①이 정답입니다. (A) habit: 지문에서 "make exercise part of your routine"이라고 했으므로 운동을 \'습관(habit)\'으로 만드는 것으로 표현하는 것이 적절합니다. (B) alertness: 지문에서 가벼운 운동이 졸린 뇌를 활성화하고 집중력을 높인다고 했으므로 정신적 \'명민함·각성(alertness)\'이 맞습니다. ②burden(부담), ③competition(경쟁), ④choice(선택), ⑤reward(보상)는 지문의 핵심 개념과 거리가 있습니다.',
  },
  // 순서배열① (B)-(C)-(A)
  {
    id: '69e11f8645fcceb0f02f49d0',
    explanation:
      '③이 정답입니다. 주어진 글에서 이른 아침 운동이 해결책이라 밝힌 뒤, (B)에서 \'최대 장점(뇌 활성화·집중력·상쾌함)\'으로 첫 번째 이점을 제시하고, (C)에서 \'일정 충돌 없음\'이라는 두 번째 이점을 추가합니다. (A)에서는 처음의 어려움과 루틴화의 효과, 최종 결론으로 마무리합니다.\n논리 흐름 요약: 해결책 제시 → 첫 번째 장점(뇌) → 두 번째 장점(일정) → 실천 조언·결론',
  },
  // 순서배열② (B)-(A)-(C)
  {
    id: '69e11f8845fcceb0f02f49d1',
    explanation:
      '④가 정답입니다. 주어진 글에서 이른 아침 운동의 해결책과 뇌 활성화 장점까지 제시한 뒤, (B)에서 "And since..."로 일정 충돌 없음이라는 추가 장점을 연결하고, (A)에서 "At first...But if..."로 처음의 어려움과 루틴화 조언을 주며, (C)에서 "While starting isn\'t easy..."로 격려와 결론을 마무리합니다.\n논리 흐름 요약: 뇌 활성화 → 일정 충돌 없음 → 처음의 어려움·루틴화 → 결론',
  },
  // 어법① (③ allowed → allowing)
  {
    id: '69e11f8f45fcceb0f02f49d2',
    explanation:
      '③이 정답입니다. "activates your sleepy brain, ③allowed you to concentrate better and making you feel refreshed"에서 ③ allowed는 과거동사 형태인데, 이 위치에서는 앞의 activates를 보조하는 분사구문이 필요합니다. 뒤의 making과 병렬을 이루려면 현재분사 allowing으로 고쳐야 "activates ... → allowing you to concentrate better and making you feel refreshed"의 분사 병렬 구조가 성립합니다. ①to schedule(형식목적어 구문), ②solves(동명사 주어+단수 동사), ④to create(unlikely+to부정사), ⑤consistency(명사)는 모두 어법에 맞습니다.',
  },
  // 어법② (⑤ wake up → waking up)
  {
    id: '69e11f9045fcceb0f02f49d3',
    explanation:
      '⑤가 정답입니다. "difficult to get used to ⑤wake up earlier"에서 \'get used to\' 뒤에는 동명사(V-ing)가 와야 합니다(get used to + V-ing). 따라서 ⑤ wake up을 waking up으로 고쳐야 합니다. ①difficult(형식목적어 구문의 형용사 보어), ②solves(동명사 주어+단수 동사), ③to concentrate(allow+목적어+to부정사), ④difficult(형용사 보어)는 모두 어법에 맞습니다.',
  },
  // 삽입① ④ (This mental boost)
  {
    id: '69e11f9645fcceb0f02f49d4',
    explanation:
      '④가 정답입니다. 삽입 문장 "This mental boost alone makes morning workouts worth considering, even for those who are not natural early risers."에서 \'This mental boost\'는 바로 앞 ③ 위치의 내용("light exercise activates your sleepy brain, allowing you to concentrate better and making you feel refreshed")에서 설명한 정신적 효과를 가리킵니다. ③ 직후인 ④에 삽입해야 지시어 This가 명확한 선행사를 갖고, 뒤이어 나오는 "And since most people don\'t do much in the early morning..."으로 자연스럽게 이어집니다.',
  },
  // 삽입② ⑤ (Over time, this habit)
  {
    id: '69e11f9945fcceb0f02f49d5',
    explanation:
      '⑤가 정답입니다. 삽입 문장 "Over time, this habit can become one of the most rewarding parts of your daily schedule."에서 \'this habit\'은 ④ 위치의 내용("make exercise part of your routine, it can add consistency to your life")에서 언급된 루틴·습관을 가리킵니다. ④ 직후인 ⑤에 삽입하면 \'루틴화하면 삶에 일관성이 생기고 → 시간이 지나면 하루의 가장 보람 있는 부분이 되며 → 시작은 쉽지 않지만 결과를 보면 감사할 것\'이라는 자연스러운 마무리 흐름이 만들어집니다.',
  },

  // 주제 (Tall Poppy Syndrome)
  {
    id: '69e11fb845fcceb0f02f49d6',
    explanation:
      '①이 정답입니다. 글 전체가 타인의 성공을 비판하는 \'tall poppy syndrome\'의 문제점을 지적하고, 성공에 대한 태도를 바꿔야 한다는 주제를 전개합니다. ②는 용어의 기원, ③은 시기심이 개인 실패로 이어진다는 내용, ④는 성공을 위한 전략, ⑤는 재능과 성공의 관계에 관한 것으로 모두 지문의 핵심 논지와 다릅니다.',
  },
  // 제목 (Tall Poppy Syndrome)
  {
    id: '69e11fbd45fcceb0f02f49d7',
    explanation:
      '①이 정답입니다. 글의 핵심은 타인의 성공을 비판하는 태도를 버리고 지지해야 한다는 것이므로 \'Tall Poppy Syndrome: Why We Should Celebrate, Not Criticize, Success\'가 제목으로 가장 적합합니다. ②는 시기심이 혁신을 이끈다는 반대 방향, ③은 학업 성취 문화, ④는 지문이 명시적으로 부정하는 주장(\'성공은 제한적\'), ⑤는 비판이 재능인들에게 동기를 준다는 내용으로 지문과 맞지 않습니다.',
  },
  // 빈칸① limited
  {
    id: '69e11fc145fcceb0f02f49d8',
    explanation:
      '① limited\n*해설: 빈칸이 포함된 "the mistaken idea that there is a ________ amount of success available"에서 \'mistaken idea(잘못된 생각)\'가 핵심 단서입니다. 이어지는 "if one person is too successful, then everyone else suffers"가 그 잘못된 생각의 내용을 구체적으로 설명하므로, 성공의 양이 \'제한되어 있다(limited)\'는 것이 빈칸에 맞습니다. ②growing(늘어나는), ③shared(공유되는), ④deserved(자격에 따른), ⑤endless(끝없는)는 이 \'잘못된 생각\'의 내용으로 적합하지 않습니다.',
  },
  // 빈칸② connection
  {
    id: '69e11fc345fcceb0f02f49d9',
    explanation:
      '① connection\n*해설: 빈칸이 포함된 "How successful we are has no ________ to how successful others are"는 tall poppy syndrome의 잘못된 믿음(타인의 성공이 내 성공을 줄인다)을 정면으로 반박하는 문장입니다. \'have no connection to\'는 \'~와 아무 관련이 없다\'는 뜻으로 이 문맥에 가장 적합합니다. ②contribution(기여), ③similarity(유사성), ④opposition(반대), ⑤obligation(의무)는 \'no + ___\'로 이 문맥에서 의미가 통하지 않습니다.',
  },

  // ═══════════════════════════════════════════════════════════════════
  //  17차 배치 — Two-Minute Rule (나머지 한국어 주제/제목은 기존 해설 유지)
  // ═══════════════════════════════════════════════════════════════════

  // 주제 (Two-Minute Rule)
  {
    id: '69e1206645fcceb0f02f49ee',
    explanation:
      '①이 정답입니다. 글 전체가 미루기와 새 습관 시작의 어려움을 \'2분 규칙\'으로 해결한다는 내용입니다. 2분 미만 과제는 즉시 하고, 새 습관도 2분 이내 활동으로 시작하면 점진적으로 정착된다는 방법을 소개합니다. ②는 장기 목표 설정, ③은 일상 루틴 유지 실패 원인, ④는 글쓰기 습관과 직업적 성공의 관계, ⑤는 여러 과제를 효율적으로 관리하는 방법에 관한 것으로 지문의 핵심과 다릅니다.',
  },
  // 제목 (Two-Minute Rule)
  {
    id: '69e1206945fcceb0f02f49ef',
    explanation:
      '①이 정답입니다. 글의 핵심 메시지는 \'2분 규칙\'이 미루기를 극복하고 새 습관을 시작하는 간단한 방법이라는 것이므로 \'The Two-Minute Rule: A Simple Trick to Beat Procrastination\'이 제목으로 가장 적합합니다. ②는 장기 습관이 깨지기 어려운 이유, ③은 일상 글쓰기 루틴의 과학, ④는 1년 안에 생산적인 작가가 되는 방법, ⑤는 시간 관리와 직업적 성공에 관한 것으로 지문의 논지와 다릅니다.',
  },

  // ═══════════════════════════════════════════════════════════════════
  //  16차 배치 — Tall Poppy Syndrome 마무리 + Frost Quakes
  // ═══════════════════════════════════════════════════════════════════

  // 요약문① (limited · criticize)
  {
    id: '69e11fca45fcceb0f02f49da',
    explanation:
      '①이 정답입니다. (A) limited: 지문에서 "mistaken idea that there is a limited amount of success available"이라고 명시했으므로 성공이 \'제한적(limited)\'이라는 잘못된 믿음이 적절합니다. (B) criticize: tall poppy syndrome은 성공한 사람들을 \'나쁘게 말하는(speak badly about = criticize)\' 경향이므로 criticize가 맞습니다. ②unlimited·admire는 반대 의미, ③earned·copy, ④shared·ignore, ⑤rare·support는 지문 내용과 맞지 않습니다.',
  },
  // 요약문② (success · support)
  {
    id: '69e11fcd45fcceb0f02f49db',
    explanation:
      '①이 정답입니다. (A) success: "How successful we are has no connection to how successful others are"에서 한 사람의 \'성공(success)\'이 다른 사람의 성공을 줄이지 않는다는 것이 핵심 논리입니다. (B) support: "We should support those who have done well"이라고 지문에 직접 명시했으므로 \'지지하다(support)\'가 맞습니다. ②failure·avoid, ③talent·judge, ④wealth·envy, ⑤effort·compete with는 모두 지문 내용과 다릅니다.',
  },
  // 순서배열① (C)-(A)-(B)
  {
    id: '69e11fd345fcceb0f02f49dc',
    explanation:
      '③이 정답입니다. 주어진 글에서 tall poppy syndrome의 정의와 해악을 소개한 뒤, (C)에서 "It is partially caused by..."로 그 원인(성공이 제한되어 있다는 잘못된 생각)을 설명하고, (A)에서 "This, of course, is not true"로 반박하며 태도 변화의 필요성을 제시하고, (B)에서 구체적 결론(성공한 사람들을 지지하고 상호 응원)으로 마무리합니다.\n논리 흐름 요약: 정의·해악 → 원인 설명 → 반박·해결 방향 → 결론·실천',
  },
  // 순서배열② (C)-(B)-(A)
  {
    id: '69e11fd645fcceb0f02f49dd',
    explanation:
      '②가 정답입니다. 주어진 글의 마지막이 "성공의 양이 제한되어 있다는 잘못된 생각"이므로, (C)에서 "Therefore, if one person is too successful, then everyone else suffers"로 그 논리적 결론을 이어받고, (B)에서 "This, of course, is not true"로 반박하며, (A)에서 태도 변화와 지지라는 해결책으로 마무리합니다.\n논리 흐름 요약: 잘못된 생각(주어진 글) → 그 논리적 귀결(C) → 반박(B) → 해결책(A)',
  },
  // 어법① (⑤ viewed → view)
  {
    id: '69e11fdc45fcceb0f02f49de',
    explanation:
      '⑤가 정답입니다. "we must change the way we ⑤viewed success"에서 관계부사절 "we ___ success"는 일반적 사실(성공을 바라보는 방식)을 서술하므로 현재 시제 view가 맞습니다. viewed는 과거동사로, 이 문맥에서 일반적 현재 사실을 나타낼 수 없어 어법상 부적절합니다. ①refers(현재동사), ②seriously hurt(부사+동사), ③limited(형용사 보어), ④suffers(단수 주어 everyone과 일치하는 현재동사)는 모두 어법에 맞습니다.',
  },
  // 어법② (⑤ successfully → successful)
  {
    id: '69e11fdd45fcceb0f02f49df',
    explanation:
      '⑤가 정답입니다. "How ⑤successfully we are has no connection..."에서 be 동사(are)의 보어는 형용사가 와야 하는데, ⑤ successfully는 부사이므로 어법상 틀렸습니다. successful(형용사)로 고쳐야 합니다. ①to speak(부정사가 tendency를 수식), ②creative(형용사), ③mistaken(형용사), ④suffers(단수 주어 everyone과 일치하는 현재동사)는 모두 어법에 맞습니다.',
  },
  // 삽입① ④ (This false assumption)
  {
    id: '69e11fe545fcceb0f02f49e0',
    explanation:
      '④가 정답입니다. 삽입 문장 "This false assumption creates a competitive environment where people feel threatened by the achievements of others."에서 \'This false assumption\'은 ③ 위치의 내용("mistaken idea that there is a limited amount of success available")을 가리킵니다. ③ 직후인 ④에 삽입하면 \'잘못된 생각 → 경쟁적 환경 조성 → 따라서 한 사람의 성공이 다른 사람에게 피해\'라는 논리가 매끄럽게 이어지고, 뒤이어 나오는 ⑤ "This, of course, is not true"가 이 경쟁적 상황을 반박하는 흐름으로 자연스럽게 연결됩니다.',
  },
  // 삽입② ③ (In fact, one person's achievement)
  {
    id: '69e11fe745fcceb0f02f49e1',
    explanation:
      '③이 정답입니다. 삽입 문장 "In fact, one person\'s achievement can inspire and motivate others to pursue their own goals."는 ③ 위치의 "This, of course, is not true"(= 한 사람의 성공이 다른 모든 사람에게 피해를 준다는 생각은 사실이 아님)를 구체적으로 뒷받침합니다. ③ 직후에 삽입하면 \'사실이 아님 → In fact, 오히려 영감과 동기 부여 → 따라서 성공을 보는 방식을 바꿔야 함\'으로 논리가 자연스럽게 이어집니다.',
  },

  // 주제 (Frost Quakes)
  {
    id: '69e1200745fcceb0f02f49e2',
    explanation:
      '①이 정답입니다. 글 전체가 서리 지진의 발생 원인(물이 얼면 팽창 → 지면 균열·진동)과 발생 조건(지면 내 대량의 물 + 급격한 온도 하강)을 설명합니다. ②는 소규모·대규모 지진의 차이, ③은 추운 날씨에 지각이 팽창하는 이유, ④는 지하수 생성과 유지 방법, ⑤는 서리 지진이 초래하는 환경 피해에 관한 내용으로 모두 지문의 핵심 논지와 다릅니다.',
  },
  // 제목 (Frost Quakes)
  {
    id: '69e1200a45fcceb0f02f49e3',
    explanation:
      '①이 정답입니다. 글의 핵심 메커니즘은 \'얼어가는 물이 지면을 균열시켜 진동을 일으킨다\'는 것이므로 \'Frost Quakes: When Freezing Water Shakes the Ground\'가 제목으로 가장 적합합니다. ②는 지진이 가장 파괴적인 재난이라는 내용, ③은 추운 기후에서 지각이 움직이는 이유, ④는 지하수가 토양 안정성에 미치는 영향, ⑤는 온도와 지진 빈도의 관계에 관한 것으로 지문의 논지와 다릅니다.',
  },
  // 빈칸① expands
  {
    id: '69e1200f45fcceb0f02f49e4',
    explanation:
      '① expands\n*해설: 빈칸이 포함된 "The essential fact behind frost quakes is that water ________ when it freezes"는 서리 지진의 핵심 원리를 설명하는 문장입니다. 이어지는 문장이 물의 팽창으로 인한 지면 팽창을 설명하므로, 물이 얼면 \'팽창한다(expands)\'가 가장 자연스럽습니다. ②disappears(사라진다), ③contracts(수축한다), ④evaporates(증발한다), ⑤darkens(어두워진다)는 서리 지진의 원리와 반대이거나 무관합니다.',
  },
  // 빈칸② cracks
  {
    id: '69e1201145fcceb0f02f49e5',
    explanation:
      '① cracks\n*해설: 빈칸이 포함된 "This pressure ________ the ground, making vibrations and loud sounds"에서 \'This pressure(이 압력)\'는 물이 얼어 지면이 팽창하면서 생긴 압력을 가리킵니다. 그 결과 지면이 \'균열된다(cracks)\'는 것이 서리 지진의 메커니즘이며, 뒤이어 나오는 "making vibrations and loud sounds"가 균열로 인한 결과입니다. ②softens(부드러워진다), ③absorbs(흡수한다), ④heats(가열한다), ⑤hardens(단단해진다)는 이 메커니즘과 맞지 않습니다.',
  },
  // 요약문① (freezes · crack)
  {
    id: '69e1201945fcceb0f02f49e6',
    explanation:
      '①이 정답입니다. (A) freezes: 지문에서 온도가 급격히 떨어지면 물이 \'언다(freezes)\'가 서리 지진의 트리거입니다. (B) crack: 물이 얼면서 팽창 → 압력 → 지면이 \'균열됨(crack)\'이 서리 지진의 결과입니다. ②melts·soften(반대 방향), ③evaporates·dry, ④flows·flood, ⑤disappears·collapse는 모두 지문의 메커니즘과 반대이거나 무관합니다.',
  },
  // 요약문② (expansion · cracks)
  {
    id: '69e1201c45fcceb0f02f49e7',
    explanation:
      '①이 정답입니다. (A) expansion: 지문에서 "water expands when it freezes"라고 명시했으므로 \'팽창(expansion)\'이 서리 지진의 원인입니다. (B) cracks: "This pressure cracks the ground"라고 직접 명시했으므로 \'균열시킨다(cracks)\'가 맞습니다. ②reduction·hardens(반대 방향), ③movement·floods, ④absence·freezes, ⑤pressure·melts는 지문 내용과 맞지 않습니다.',
  },
  // 순서배열① (B)-(C)-(A)
  {
    id: '69e1202145fcceb0f02f49e8',
    explanation:
      '③이 정답입니다. 주어진 글에서 서리 지진을 도입한 뒤, (B)에서 \'핵심 원리(물이 얼면 팽창)\'를 제시하고, (C)에서 "Therefore"로 이 원리가 실제로 어떻게 적용되는지(지하수 + 온도 급강하 → 지면 팽창)를 설명하며, (A)에서 그 결과(압력 → 균열·진동)와 서리 지진에 필요한 특별 조건으로 마무리합니다.\n논리 흐름 요약: 도입 → 핵심 원리 → 적용 과정 → 결과·조건',
  },
  // 순서배열② (C)-(B)-(A)
  {
    id: '69e1202445fcceb0f02f49e9',
    explanation:
      '④가 정답입니다. 주어진 글에서 핵심 원리(물이 얼면 팽창)까지 제시한 뒤, (C)에서 "Therefore"로 그 원리의 적용(지하수 + 온도 급강하 → 지면 팽창)을 설명하고, (B)에서 결과(This pressure → 균열·진동)를 제시하며, (A)에서 서리 지진에 필요한 두 가지 조건을 나열하며 마무리합니다.\n논리 흐름 요약: 핵심 원리 → 적용 과정 → 결과(균열·진동) → 필요 조건',
  },
  // 어법① (③ expanded → expands)
  {
    id: '69e1202945fcceb0f02f49ea',
    explanation:
      '③이 정답입니다. "The essential fact behind frost quakes is that water ③expanded when it freezes"에서 ③ expanded는 과거동사이지만, 이 문장은 물의 물리적 성질이라는 일반적 사실을 서술하므로 현재 시제 expands로 고쳐야 합니다. 같은 문장의 "when it freezes"가 현재 시제이므로 시제 일치상 expanded도 어법상 부적절합니다. ①release(현재동사), ②different(형용사), ④because of(전치사구), ⑤making(결과·부대상황 분사구)은 모두 어법에 맞습니다.',
  },
  // 어법② (⑤ quick → quickly)
  {
    id: '69e1202c45fcceb0f02f49eb',
    explanation:
      '⑤가 정답입니다. "the temperature has to drop so ⑤quick that the water freezes before it can escape"에서 동사 drop을 수식하는 것은 부사여야 하는데, ⑤ quick은 형용사이므로 어법상 틀렸습니다. 부사 quickly로 고쳐야 합니다("drop so quickly that..."). ①push(복수 주어 parts와 일치하는 현재동사), ②different(형용사), ③freezes(현재동사), ④the water inside it(전치사구 수식을 받는 명사구)은 모두 어법에 맞습니다.',
  },
  // 삽입① ② (Unlike earthquakes, which are caused by tectonic movements)
  {
    id: '69e1203245fcceb0f02f49ec',
    explanation:
      '②가 정답입니다. 삽입 문장 "Unlike earthquakes, which are caused by tectonic movements, frost quakes are entirely a result of extreme temperature changes."는 ① 뒤에서 지진(지각 이동)을 언급한 직후인 ② 위치에 삽입하면 \'지진의 원인(지각 이동) → 이와 달리 서리 지진은 극단적 온도 변화의 결과\'로 대비 구조가 강화됩니다. 이어지는 "Frost quakes are similar, but..."가 이 대비를 이어받고, ③ "The essential fact..."가 서리 지진의 구체적 메커니즘으로 연결되는 흐름도 자연스럽습니다.',
  },
  // 삽입② ⑤ (Without these two key factors)
  {
    id: '69e1203545fcceb0f02f49ed',
    explanation:
      '⑤가 정답입니다. 삽입 문장 "Without these two key factors present at the same time, a frost quake cannot take place."에서 \'these two key factors\'는 ④ 위치의 내용("there must be a large amount of water in the ground, and the temperature has to drop so quickly...")에서 나열한 두 가지 조건을 가리킵니다. ④ 직후인 ⑤(마지막)에 삽입하면 \'두 가지 조건 나열 → 이 두 조건이 동시에 충족되지 않으면 서리 지진은 발생할 수 없다\'는 결론으로 글이 자연스럽게 마무리됩니다.',
  },
];

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  let updated = 0;
  for (const p of PATCHES) {
    const filter = { _id: new ObjectId(p.id) };
    const doc = await col.findOne(filter, { projection: { 'question_data.Explanation': 1 } });
    if (!doc) { console.warn(`⚠ 문서 없음: ${p.id}`); continue; }
    if (DRY_RUN) {
      console.log(`[dry] ${p.id}: ${p.explanation.slice(0, 60)}...`);
    } else {
      await col.updateOne(filter, { $set: { 'question_data.Explanation': p.explanation, updated_at: new Date() } });
      console.log(`✔ ${p.id}`);
      updated++;
    }
  }
  console.log(DRY_RUN ? `[dry-run] ${PATCHES.length}건 완료` : `완료: ${updated}건 업데이트`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
