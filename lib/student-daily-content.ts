/**
 * 학년별 영어 한 마디 정적 풀.
 * 날짜 + 학년으로 deterministic pick.
 */

type DailyContent = {
  en: string;
  ko: string;
  word: string;
  wordMeaning: string;
};

const POOL_COMMON: DailyContent[] = [
  { en: 'The secret of getting ahead is getting started.', ko: '앞서 나가는 비결은 시작하는 것이다.', word: 'ahead', wordMeaning: '앞서서, 미래에' },
  { en: 'Practice makes perfect.', ko: '연습이 완벽함을 만든다.', word: 'practice', wordMeaning: '연습; 연습하다' },
  { en: 'Every day is a new beginning.', ko: '매일이 새로운 시작이다.', word: 'beginning', wordMeaning: '시작, 출발' },
  { en: 'Believe you can and you\'re halfway there.', ko: '할 수 있다고 믿으면 이미 절반은 온 것이다.', word: 'halfway', wordMeaning: '절반쯤, 중간에' },
  { en: 'Small steps lead to big changes.', ko: '작은 발걸음이 큰 변화를 만든다.', word: 'lead to', wordMeaning: '~로 이어지다' },
  { en: 'Knowledge is power.', ko: '지식은 힘이다.', word: 'knowledge', wordMeaning: '지식, 앎' },
  { en: 'Curiosity is the engine of achievement.', ko: '호기심은 성취의 엔진이다.', word: 'curiosity', wordMeaning: '호기심' },
  { en: 'The more you read, the more you know.', ko: '많이 읽을수록 더 많이 알게 된다.', word: 'the more...', wordMeaning: '~할수록 더 ~' },
  { en: 'Mistakes are proof that you are trying.', ko: '실수는 네가 노력하고 있다는 증거다.', word: 'proof', wordMeaning: '증거, 증명' },
  { en: 'Success is not final; failure is not fatal.', ko: '성공이 끝이 아니고, 실패가 치명적인 것도 아니다.', word: 'fatal', wordMeaning: '치명적인' },
  { en: 'Hard work beats talent when talent doesn\'t work hard.', ko: '재능이 노력하지 않으면 노력이 재능을 이긴다.', word: 'beats', wordMeaning: '이기다, 앞서다' },
  { en: 'Focus on progress, not perfection.', ko: '완벽함보다 발전에 집중하라.', word: 'progress', wordMeaning: '발전, 진전' },
  { en: 'Your attitude determines your direction.', ko: '태도가 방향을 결정한다.', word: 'attitude', wordMeaning: '태도, 마음가짐' },
  { en: 'Dream big, start small, act now.', ko: '크게 꿈꾸고, 작게 시작하고, 지금 행동하라.', word: 'act', wordMeaning: '행동하다; 행동' },
  { en: 'Consistency is the key to mastery.', ko: '꾸준함이 숙달의 열쇠다.', word: 'consistency', wordMeaning: '일관성, 꾸준함' },
  { en: 'You don\'t have to be great to start, but you have to start to be great.', ko: '위대해야 시작할 수 있는 게 아니라, 시작해야 위대해질 수 있다.', word: 'great', wordMeaning: '위대한, 훌륭한' },
  { en: 'The journey of a thousand miles begins with one step.', ko: '천 리 길도 한 걸음부터.', word: 'journey', wordMeaning: '여정, 여행' },
  { en: 'Education is the passport to the future.', ko: '교육은 미래로 가는 여권이다.', word: 'passport', wordMeaning: '여권; 통행증' },
  { en: 'Challenge yourself every day.', ko: '매일 스스로에게 도전하라.', word: 'challenge', wordMeaning: '도전; 도전하다' },
  { en: 'A little progress each day adds up to big results.', ko: '매일 조금씩의 발전이 쌓여 큰 결과를 만든다.', word: 'adds up', wordMeaning: '쌓이다, 합산되다' },
  { en: 'Effort is the foundation of all achievement.', ko: '노력은 모든 성취의 기반이다.', word: 'foundation', wordMeaning: '기반, 토대' },
  { en: 'Learning never exhausts the mind.', ko: '배움은 마음을 지치게 하지 않는다.', word: 'exhausts', wordMeaning: '지치게 하다, 소진시키다' },
  { en: 'Stay hungry, stay foolish.', ko: '늘 배고프게, 늘 우직하게.', word: 'hungry', wordMeaning: '배고픈; 갈망하는' },
  { en: 'The only way to do great work is to love what you do.', ko: '훌륭한 일을 하는 유일한 방법은 자신이 하는 일을 사랑하는 것이다.', word: 'the only way', wordMeaning: '유일한 방법' },
  { en: 'Be the change you wish to see in the world.', ko: '세상에서 보고 싶은 변화가 있다면 네가 그 변화가 되어라.', word: 'wish', wordMeaning: '바라다, 원하다' },
  { en: 'Reading is to the mind what exercise is to the body.', ko: '독서가 정신에게 하는 것은 운동이 몸에게 하는 것과 같다.', word: 'exercise', wordMeaning: '운동; 연습' },
  { en: 'Persistence guarantees that results are inevitable.', ko: '끈기는 결과가 반드시 오게 만든다.', word: 'persistence', wordMeaning: '끈기, 인내' },
  { en: 'Great things never come from comfort zones.', ko: '위대한 것들은 편안함 속에서 오지 않는다.', word: 'comfort zone', wordMeaning: '안락한 영역, 편안한 구역' },
  { en: 'The pain of discipline is far less than the pain of regret.', ko: '훈련의 고통은 후회의 고통보다 훨씬 가볍다.', word: 'discipline', wordMeaning: '훈련, 규율' },
  { en: 'Don\'t watch the clock; do what it does. Keep going.', ko: '시계를 보지 말고, 시계처럼 행동하라. 계속 나아가라.', word: 'keep going', wordMeaning: '계속 나아가다' },
  { en: 'It always seems impossible until it\'s done.', ko: '끝나기 전에는 항상 불가능해 보인다.', word: 'impossible', wordMeaning: '불가능한' },
  { en: 'The beautiful thing about learning is that no one can take it away from you.', ko: '배움의 아름다운 점은 아무도 그것을 당신에게서 빼앗을 수 없다는 것이다.', word: 'take away', wordMeaning: '빼앗다, 가져가다' },
  { en: 'Genius is one percent inspiration and ninety-nine percent perspiration.', ko: '천재란 1%의 영감과 99%의 땀이다.', word: 'perspiration', wordMeaning: '땀, 노력' },
  { en: 'You are never too old to set another goal or dream a new dream.', ko: '새로운 목표를 세우거나 새 꿈을 꾸기에 너무 늦은 나이는 없다.', word: 'set a goal', wordMeaning: '목표를 세우다' },
  { en: 'Quality is not an act; it is a habit.', ko: '질은 행동이 아니라 습관이다.', word: 'habit', wordMeaning: '습관' },
  { en: 'Success is the sum of small efforts repeated day in and day out.', ko: '성공은 매일 반복되는 작은 노력들의 합이다.', word: 'sum', wordMeaning: '합계, 총합' },
  { en: 'There is no elevator to success. You have to take the stairs.', ko: '성공으로 가는 엘리베이터는 없다. 계단을 오를 뿐이다.', word: 'elevator', wordMeaning: '엘리베이터, 승강기' },
  { en: 'Do something today that your future self will thank you for.', ko: '미래의 네가 고마워할 일을 오늘 해라.', word: 'grateful', wordMeaning: '감사하는' },
  { en: 'Wake up with determination. Go to bed with satisfaction.', ko: '결의를 품고 일어나라. 만족을 안고 잠들어라.', word: 'determination', wordMeaning: '결의, 결단력' },
  { en: 'Vocabulary is the tool of the mind.', ko: '어휘는 마음의 도구다.', word: 'vocabulary', wordMeaning: '어휘, 단어' },
  { en: 'Grammar is the skeleton of language.', ko: '문법은 언어의 뼈대다.', word: 'skeleton', wordMeaning: '뼈대, 골격' },
  { en: 'Every expert was once a beginner.', ko: '모든 전문가는 한때 초보자였다.', word: 'expert', wordMeaning: '전문가' },
  { en: 'A book is a dream you hold in your hands.', ko: '책은 두 손에 쥔 꿈이다.', word: 'hold', wordMeaning: '붙잡다, 쥐다' },
  { en: 'The roots of education are bitter, but the fruit is sweet.', ko: '교육의 뿌리는 쓰지만 열매는 달다.', word: 'roots', wordMeaning: '뿌리; 근본' },
  { en: 'Learning is a treasure that follows its owner everywhere.', ko: '배움은 주인을 어디서나 따라다니는 보물이다.', word: 'treasure', wordMeaning: '보물' },
  { en: 'Failure is the opportunity to begin again more intelligently.', ko: '실패는 더 현명하게 다시 시작할 기회다.', word: 'intelligently', wordMeaning: '현명하게, 지능적으로' },
  { en: 'Work hard in silence; let your success be your noise.', ko: '조용히 열심히 하라. 네 성공이 소음이 되게 하라.', word: 'silence', wordMeaning: '침묵, 고요함' },
  { en: 'Today\'s preparation determines tomorrow\'s achievement.', ko: '오늘의 준비가 내일의 성취를 결정한다.', word: 'preparation', wordMeaning: '준비' },
  { en: 'Push yourself because no one else is going to do it for you.', ko: '스스로를 밀어붙여라. 아무도 대신 해주지 않는다.', word: 'push', wordMeaning: '밀다; 밀어붙이다' },
  { en: 'Your only limit is your mind.', ko: '너의 유일한 한계는 네 마음이다.', word: 'limit', wordMeaning: '한계, 제한' },
];

export function getDailyContent(grade?: string, seed?: number): DailyContent {
  const pool = POOL_COMMON;
  const today = new Date();
  const dayOfYear = Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000
  );
  const gradeOffset = grade ? grade.charCodeAt(0) : 0;
  const idx = ((dayOfYear + gradeOffset + (seed ?? 0)) % pool.length + pool.length) % pool.length;
  return pool[idx];
}
