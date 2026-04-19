/**
 * 삽입-고난도 6개 문항: Options 구분자 통일 + CorrectAnswer 동그라미 + Explanation 재작성
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const NEW_OPTIONS = '① ### ② ### ③ ### ④ ### ⑤';
const CIRCLED = ['①', '②', '③', '④', '⑤'];

type Patch = { id: string; CorrectAnswer: string; Explanation: string };

const PATCHES: Patch[] = [
  {
    id: '69e39ea675254d46b7793c33',
    CorrectAnswer: '②',
    Explanation:
      '② 가 정답입니다. 이 글은 정지된 기차에서 옆 기차의 움직임으로 인해 자신이 움직인다고 착각하는 상대적 운동 현상을 다룬다. ' +
      '② 앞 문장 "Suddenly you seem to start moving"은 화자가 갑자기 움직이는 듯한 감각을 느낀다고 서술하는데, 주어진 문장의 \'the sensation\'이 바로 이 감각을 받아 그것이 너무 실감나서 기차가 움직이기 시작했다고 완전히 확신한다는 내용으로 부연된다. ' +
      '② 뒤 문장 "But then you realize that you aren\'t actually moving at all"이 역접 \'but\'으로 그 확신을 뒤집어 자연스럽게 이어진다. ' +
      '논리 흐름 요약: 움직이는 듯한 감각 → 완전한 확신 → 실제로는 움직이지 않음을 깨달음.',
  },
  {
    id: '69e39eac75254d46b7793c34',
    CorrectAnswer: '⑤',
    Explanation:
      '⑤ 가 정답입니다. 이 글은 옆 기차로 인한 자기 운동 착각의 양방향 사례들을 나열한 뒤 그 본질을 일반화하는 구조다. ' +
      '⑤ 앞 문장 "It can be hard to tell the difference between apparent movement and real movement"는 겉보기 움직임과 실제 움직임을 구별하기 어렵다는 일반화이며, 주어진 문장의 \'Such misperceptions\'가 바로 앞에서 제시된 모든 착각 사례를 받아 그것이 우리의 운동 판단이 주변 물체의 시각 단서에 얼마나 의존하는지를 드러낸다는 결론으로 이어진다. ' +
      '⑤ 뒤 문장 "It\'s easy if your train starts with a jolt..."는 시각이 아닌 물리적 단서가 있을 때의 예외를 덧붙인다. ' +
      '논리 흐름 요약: 사례 나열 → 시각 단서 의존 일반화 → 물리적 단서 예외.',
  },
  {
    id: '69e39eb375254d46b7793c35',
    CorrectAnswer: '④',
    Explanation:
      '④ 가 정답입니다. 이 글은 옆 기차로 인한 자기 운동 착각이 양방향으로 작동함을 보여주는 사례 구조다. ' +
      '④ 앞 문장 "The illusion of relative movement works the other way, too"는 이 착각이 반대 방향으로도 일어남을 일반화하며, 주어진 문장의 \'This tendency\'가 바로 이 착각 경향을 받아 물리적 충격이나 가속이 감각을 깨우지 않는 부드러운 움직임에서 특히 강해진다는 조건을 추가한다. ' +
      '④ 뒤 문장 "You think the other train has moved, only to discover that it is your own train that is moving"은 그 강한 경향이 만들어내는 구체적 예시 — 자신의 기차가 움직이는데 알아채지 못하는 사례 — 로 자연스럽게 이어진다. ' +
      '논리 흐름 요약: 양방향 착각 일반화 → 부드러운 움직임에서 강화 → 구체적 예시.',
  },
  {
    id: '69e3a01475254d46b7793c4e',
    CorrectAnswer: '③',
    Explanation:
      '③ 이 정답입니다. 이 글은 common blackberry가 망가니즈의 독성을 이용해 주변 식물을 제거하는 생태 전략을 설명한다. ' +
      '③ 앞 문장 "Manganese can be very harmful to plants, especially at high concentrations"는 망가니즈가 식물에 해롭다는 일반적 사실을 제시하며, 주어진 문장의 \'In fact\'와 \'this metal\'이 바로 이 망가니즈를 받아 대부분 식물의 생화학 과정을 방해한다는 구체적 메커니즘으로 보강한다. ' +
      '③ 뒤 문장 "Common blackberry is unaffected..."는 이 일반적 독성에도 불구하고 블랙베리만 영향받지 않는다는 대조로 자연스럽게 이어진다. ' +
      '논리 흐름 요약: 망가니즈 독성 일반 → 구체적 생화학 영향 → 블랙베리 예외.',
  },
  {
    id: '69e3a01975254d46b7793c4f',
    CorrectAnswer: '④',
    Explanation:
      '④ 가 정답입니다. 이 글은 common blackberry가 망가니즈를 활용하는 두 가지 전략을 차례로 소개한다. ' +
      '④ 앞 문장 "First, it redistributes manganese from deeper soil layers to shallow soil layers using its roots as a small pipe"는 첫 번째 전략(재분배)을 설명하며, 주어진 문장의 \'This first method\'가 바로 이 첫 번째 방법을 받아 그 결과로 얕은 토양에서 영양을 흡수하는 주변 식물의 뿌리 영역이 효과적으로 독성을 띠게 된다는 구체적 효과로 부연된다. ' +
      '④ 뒤 문장 "Second, it absorbs manganese as it grows..."는 두 번째 전략으로 자연스럽게 이어져 두 방법의 병렬 구조가 완성된다. ' +
      '논리 흐름 요약: 첫 번째 방법(재분배) → 그 효과(뿌리 영역 독성화) → 두 번째 방법(농축).',
  },
  {
    id: '69e3a01f75254d46b7793c50',
    CorrectAnswer: '⑤',
    Explanation:
      '⑤ 가 정답입니다. 이 글은 common blackberry의 두 가지 망가니즈 전략을 차례로 제시한 뒤, 그 결과를 종합하는 흐름이다. ' +
      '⑤ 앞 문장 "When the leaves drop and decay, their concentrated manganese deposits further poison the soil around the plant"는 두 번째 전략(농축)의 구체적 결과 — 낙엽이 토양을 더욱 오염시킴 — 를 제시한다. 주어진 문장의 \'these mechanisms\'가 두 전략(재분배+농축)을 통합 지칭하며, 그것들이 함께 작용해 독성 효과를 복합화하여 회복을 거의 불가능하게 만든다는 종합 평가로 이어진다. ' +
      '⑤ 뒤 문장 "For plants that are not immune to the toxic effects of manganese, this is very bad news"는 그 결과로 면역 없는 식물에게 매우 나쁜 소식이라는 결론으로 자연스럽게 이어진다. ' +
      '논리 흐름 요약: 두 전략의 결과 → 통합 효과(회복 불가) → 면역 없는 식물의 위기.',
  },
];

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  for (const p of PATCHES) {
    const r = await col.updateOne(
      { _id: new ObjectId(p.id) },
      {
        $set: {
          'question_data.Options': NEW_OPTIONS,
          'question_data.CorrectAnswer': p.CorrectAnswer,
          'question_data.Explanation': p.Explanation,
          updated_at: new Date(),
        },
      }
    );
    console.log(JSON.stringify({ id: p.id, modified: r.modifiedCount === 1 }));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
