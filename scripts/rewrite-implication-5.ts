/**
 * 함의 5개 문항: 한국어 Options + 정형 Explanation → 영어 Options + 상세 해설
 * (수동 작성된 페이로드를 적용)
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

type Patch = {
  id: string;
  Options: string;
  CorrectAnswer: string;
  Explanation: string;
};

const PATCHES: Patch[] = [
  {
    id: '69e39e6c75254d46b7793c2b',
    Options:
      '① The faster the train moves, the easier it becomes to identify real motion. ' +
      '### ② Distinguishing between apparent and real motion is not always straightforward. ' +
      '### ③ Human vision is more effective than hearing in detecting movement. ' +
      '### ④ The illusion of movement occurs only when standing inside train stations. ' +
      '### ⑤ Passengers can immediately recognize their direction the moment a train stops.',
    CorrectAnswer: '②',
    Explanation:
      '② 가 정답입니다. 밑줄 친 문장은 표면적으로는 "겉보기 움직임과 실제 움직임의 차이를 구별하는 것이 어려울 수 있다"는 뜻이다. ' +
      '함의는 — 옆 기차가 움직이거나 자신의 기차가 부드럽게 움직일 때, 시각적 단서만으로는 누가 실제로 움직이는지를 항상 분명하게 판단할 수 없다는 것이다. ' +
      '② "Distinguishing between apparent and real motion is not always straightforward."가 이 함의를 가장 정확히 반영한다.',
  },
  {
    id: '69e39e7175254d46b7793c2c',
    Options:
      '① feeling motion sickness from watching the other train pass by quickly ' +
      '### ② mistakenly thinking the other train is moving backward when in fact one\'s own train is moving forward ' +
      '### ③ noticing that other passengers experience the motion differently from oneself ' +
      '### ④ trusting that neither train is moving when both travel at similar speeds ' +
      '### ⑤ believing one\'s train has stopped when it has only slowed down momentarily',
    CorrectAnswer: '②',
    Explanation:
      '② 가 정답입니다. 밑줄 친 표현 "fool yourself"의 표면 의미는 "자기 자신을 속이다"이다. ' +
      '문맥상 함의는 — 자신의 기차가 더 느린 옆 기차를 추월할 때, 실제로는 자신의 기차가 앞으로 나아가고 있는데도 자신은 정지해 있고 옆 기차가 천천히 뒤로 움직인다고 잘못 인식하는 인지적 착각이다. ' +
      '② 가 바로 이 착각 — 사실은 내 기차가 앞으로 가고 있는데 옆 기차가 뒤로 가고 있다고 잘못 믿는 것 — 을 정확히 서술한다.',
  },
  {
    id: '69e39fb075254d46b7793c42',
    Options:
      '① helping competing plants absorb manganese so that they can grow stronger ' +
      '### ② securing an ecological advantage by removing rival plants through metal toxicity ' +
      '### ③ playing a neutral role in plant competition without affecting nearby species ' +
      '### ④ strengthening other plants by exposing them to controlled doses of toxins ' +
      '### ⑤ purifying its surrounding environment by removing heavy metals from the soil',
    CorrectAnswer: '②',
    Explanation:
      '② 가 정답입니다. 밑줄 친 부분의 표면 의미는 "중금속으로 이웃을 중독시켜 경쟁을 제거한다"이다. ' +
      '함의는 — common blackberry가 우연이 아니라 능동적인 생태 전략으로서 망가니즈를 잎에 농축하고 낙엽을 통해 토양을 오염시켜, 면역이 없는 주변 식물을 죽이고 자원·공간 경쟁에서 우위를 확보한다는 의미이다. ' +
      '② 가 이 전략 — 금속 독성을 통해 경쟁자를 제거함으로써 생태적 이점을 확보하는 것 — 을 정확히 압축해 표현한다.',
  },
  {
    id: '69e39fb775254d46b7793c43',
    Options:
      '① the ability to move manganese is valuable since it improves overall soil health ' +
      '### ② the true purpose of moving manganese lies in harming the surrounding plants ' +
      '### ③ neighboring plants benefit by receiving redistributed manganese from the blackberry ' +
      '### ④ even strange-looking traits can sometimes become a burden depending on the environment ' +
      '### ⑤ the talent of moving manganese is intended to enrich the entire soil ecosystem',
    CorrectAnswer: '②',
    Explanation:
      '② 가 정답입니다. 밑줄 친 부분의 표면 의미는 "주변 식물에 미치는 효과를 깨달으면 모든 것이 명확해진다"이다. ' +
      '함의는 — 망가니즈를 옮기는 능력이 처음에는 기이한 재능처럼 보이지만, 그 능력이 인근 식물에 미치는 결과(농축된 망가니즈로 토양을 오염시켜 경쟁 식물을 죽임)를 알고 나면 이 능력의 진짜 목적이 단순한 재능이 아니라 주변 식물에게 해를 끼쳐 경쟁자를 제거하는 것임이 분명해진다는 의미이다. ' +
      '② 가 이 진짜 목적을 정확히 표현한다.',
  },
  {
    id: '69e39fbc75254d46b7793c44',
    Options:
      '① plants without immunity to manganese face survival threats due to the blackberry\'s strategy ' +
      '### ② plants without immunity cannot remove manganese from the soil on their own ' +
      '### ③ neighboring plants find it difficult to use manganese as a beneficial resource ' +
      '### ④ all plants suffer equally when manganese concentrations rise in the soil ' +
      '### ⑤ even plants resistant to toxins become vulnerable under high manganese levels',
    CorrectAnswer: '①',
    Explanation:
      '① 이 정답입니다. 밑줄 친 "this is very bad news"의 표면 의미는 "이것은 매우 나쁜 소식이다"이며, "this"는 바로 앞 문장 — common blackberry가 잎의 망가니즈를 토양에 떨어뜨려 주변 토양을 더욱 독성으로 만든다는 사실 — 을 가리킨다. ' +
      '함의는 — 망가니즈 독성에 면역이 없는 인근 식물은 이렇게 농축된 토양 망가니즈에 노출되어 생존 자체가 위협받는다는 의미이다. ' +
      '① 이 이 함의 — 면역 없는 식물의 생존 위기 — 를 가장 정확히 반영한다.',
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
          'question_data.Options': p.Options,
          'question_data.OptionType': 'English',
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
