/**
 * 일회성: BV-20260504-001 의 남은 7개 대기 문항에 대해 정답·풀이 일괄 기록.
 * 정답이 일치하면 서버가 자동으로 status=완료 로 갱신한다.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { recordReviewLogFromClaudeCode } from '@/lib/generated-question-review-cc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(root, '.env') });
config({ path: path.join(root, '.env.local') });

type Item = { id: string; answer: string; response: string };

const items: Item[] = [
  {
    id: '69fb76b5d4b286dea71d472b',
    answer: '⑤',
    response:
      "주어진 문장의 'Once such distortion takes root'는 ⑤ 앞 S5의 'creating an environment of portion distortion'을 직접 받는다. 'effects show up wherever Americans sit down to eat, both outside the home and within'은 ⑤ 뒤 S6의 'in restaurants'와 S7의 'in our homes' 사례를 차례로 예고한다. 정답 ⑤.",
  },
  {
    id: '69fb76b5d4b286dea71d472c',
    answer: '④',
    response:
      "주어진 문장의 'From the spectator's vantage point, then'은 ④ 앞 S4의 'unnecessarily conspicuous presence of a musical leader will detract from it'(관객 입장)을 받아 결론을 내고, 'transparency of leadership is a feature rather than a flaw'는 ④ 뒤 S5의 'audience is better off ... taking in the whole of a stage work rather than ... techniques'로 자연스럽게 이어진다. 정답 ④.",
  },
  {
    id: '69fb76b5d4b286dea71d472d',
    answer: '②',
    response:
      "주어진 문장의 'Such directional roles, however ancient and indispensable to the players'는 ② 앞 S2의 'gamelans of ancient Indonesia had leaders who would signal to the group'을 직접 받고, 'do not announce themselves to those gathered to listen'은 ② 뒤 S3의 'Yet listening audiences are rarely aware of any musical leadership'로 자연스럽게 이어진다. 정답 ②.",
  },
  {
    id: '69fb76b5d4b286dea71d472e',
    answer: '②',
    response:
      "주어진 문장의 'sorted by two distinct attributes, namely their general reading proficiency and their familiarity with the sport'는 ② 앞 S2의 'two groups of students who were asked to read a passage about baseball'을 받아 분류 기준을 구체화하고, ② 뒤 S3의 'first group was made up of strong readers who knew little about baseball'은 그 두 기준을 교차시킨 첫 조합으로 자연스럽게 이어진다. 정답 ②.",
  },
  {
    id: '69fb76b5d4b286dea71d472f',
    answer: '④',
    response:
      "주어진 문장의 'With those contrasting profiles in place'는 ④ 앞에서 정의된 두 대조 집단(첫 번째 = 강한 독해+낮은 친숙도, 두 번째 = 약한 독해+높은 친숙도)을 받아 측정 단계로 전환하고, 'gauge how each kind of preparation paid off in practice'는 ④ 뒤 S5의 'After reading the passage, students in each group had their comprehension tested'로 자연스럽게 이어진다. 정답 ④.",
  },
  {
    id: '69fb76b5d4b286dea71d4730',
    answer: '④',
    response:
      "주어진 문장의 'Even emotions traditionally regarded as negative can serve this performance-enhancing purpose'는 ④ 앞 S4의 'use emotion to elicit greater effort'(수행 향상 목적)를 받아 부정적 감정도 같은 목적에 기여 가능함을 전제하고, ④ 뒤 S5의 'anger and frustration ... more effortful punches and stronger kicks'(킥복싱 사례)는 그 부정적 감정 사례로 자연스럽게 이어진다. 정답 ④.",
  },
  {
    id: '69fb76b5d4b286dea71d4731',
    answer: '①',
    response:
      "주어진 문장의 'One reason emotion deserves a closer look in this context'는 ① 앞 S1의 'use of emotion may be important in exercise'를 받아 첫 번째 이유를 제시하고, 'shapes whether participants stay with a program at all'은 ① 뒤 S2의 'exercise enjoyment is associated with increased exercise adherence'로 자연스럽게 이어진다('stay with program' = 'adherence'). 정답 ①.",
  },
];

async function main() {
  const summary: Array<{
    id: string;
    is_correct: boolean | null | undefined;
    completed: boolean;
    mismatch: boolean;
    error?: string;
  }> = [];
  for (const it of items) {
    try {
      const out = await recordReviewLogFromClaudeCode({
        generated_question_id: it.id,
        claude_answer: it.answer,
        claude_response: it.response,
        admin_login_id: 'cc-review-bv-20260504-001',
        attemptNumber: 1,
      });
      const r = out as Record<string, unknown>;
      summary.push({
        id: it.id,
        is_correct: r.is_correct as boolean | null | undefined,
        completed: r.status_updated_to_complete === true,
        mismatch: r.status_updated_to_mismatch === true,
      });
      console.log(JSON.stringify({ id: it.id, ...out }));
    } catch (e) {
      summary.push({
        id: it.id,
        is_correct: null,
        completed: false,
        mismatch: false,
        error: e instanceof Error ? e.message : String(e),
      });
      console.error('ERR', it.id, e instanceof Error ? e.message : e);
    }
  }
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.message : e);
  process.exit(1);
});
