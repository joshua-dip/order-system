import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 서술형 주문 화면 「샘플 보기」 — 로그인 없이도 볼 수 있다.
 *
 * 실제로 만들어 둔 서술형 문항(narrative_questions)에서 대분류별로 한 건씩 뽑아
 * 문제·지문·조건·모범답안·해설을 그대로 보여 준다. 별도 예시 파일을 관리하지 않아도
 * 자료 품질이 그대로 드러난다.
 */
const SUBTYPE_BY_CATEGORY: Record<string, string[]> = {
  빈칸재배열형: ['빈칸재배열형(A+B·주제·Hard)', '빈칸재배열형(A+B·어법·Hard)'],
  이중요지요약형: ['이중요지영작형'],
  요약문조건영작형: ['요약문빈칸완성형'],
  글의의미서술형: ['주제완성형'],
};

/**
 * 아직 제작분이 없는 유형의 예시.
 * 학교 기출(서술형 5~6번)의 지시문·조건을 그대로 따른 형태로, 실제 지문으로 만들었다.
 * 제작분이 쌓이면 위 매핑에 subtype 을 넣어 DB 샘플로 바꾼다.
 */
const CURATED_SAMPLES: Record<string, Record<string, unknown>> = {
  일반요지요약형: {
    대분류: '일반요지요약형',
    subtype: '요지 한 문장 영작',
    점수: 5,
    문제:
      '다음 글의 요지를 <보기>에 주어진 단어만 모두 한 번씩 순서대로 사용하여 ' +
      '10단어 이상 20단어 이내의 완전한 형식의 영어 문장으로 영작하시오. ' +
      '(단, 어형변화 금지, 철자 오류 시 오답 처리, 부분 점수 있음)',
    본문:
      'We know that women are underrepresented in math. What we do not know is why it happens. ' +
      'There are various theories, and many of them focus on childhood. Researchers found that girls ' +
      'often score higher than boys on name-blind math tests, but once presented with recognizable boy ' +
      'and girl names on the same tests, teachers award higher scores to boys. The long-term effects are ' +
      'amplified by socioeconomic factors and family structure.',
    키워드: 'teachers / unconscious / bias / lowers / girls / math / scores',
    요약문: '',
    조건:
      '① <보기>의 단어를 모두 한 번씩, 주어진 순서대로 사용할 것\n' +
      '② 어형 변화 금지 (주어진 형태 그대로 쓸 것)\n' +
      '③ 10단어 이상 20단어 이내의 완전한 문장으로 쓸 것\n' +
      '④ 철자 오류 시 오답 처리, 부분 점수 있음',
    모범답안: "Teachers' unconscious bias lowers girls' math scores even when their actual ability is higher.",
    해설:
      '글의 요지는 「교사의 무의식적 편견이 여학생의 수학 점수를 낮춘다」이다. 이름을 가린 시험에서는 ' +
      '여학생이 더 높은 점수를 받지만 이름이 드러나면 교사가 남학생에게 더 높은 점수를 준다는 실험 결과가 근거다. ' +
      '<보기>가 순서대로 주어지므로 teachers → unconscious bias(주어) → lowers(동사) → girls math scores(목적어) 로 ' +
      '뼈대를 세우고, 단어 수를 맞추기 위해 뒤에 부사절을 덧붙인다.',
  },
};

/** 지문이 너무 길면 앞부분만 (샘플이므로 전문을 다 주지는 않는다) */
function clip(s: unknown, max: number): string {
  const t = typeof s === 'string' ? s.replace(/###/g, '\n\n').trim() : '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export async function GET() {
  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('narrative_questions');
    const samples: Record<string, unknown>[] = [];

    for (const [대분류, subtypes] of Object.entries(SUBTYPE_BY_CATEGORY)) {
      const doc = await col.findOne(
        { narrative_subtype: { $in: subtypes }, 'question_data.처리상태': '성공' },
        { sort: { created_at: -1 } },
      );
      if (!doc) continue;
      const q = (doc.question_data ?? {}) as Record<string, unknown>;
      samples.push({
        대분류,
        subtype: doc.narrative_subtype,
        점수: q['점수'] ?? null,
        문제: clip(q['문제'], 400),
        본문: clip(q['본문'] ?? q['원문'], 700),
        키워드: clip(q['키워드'] ?? q['주어진표현'], 300),
        요약문: clip(q['요약문'], 300),
        조건: clip(q['조건'], 300),
        모범답안: clip(q['모범답안'], 400),
        해설: clip(q['해설'], 400),
      });
    }

    // 제작분이 없는 유형은 준비된 예시로 채운다
    for (const [대분류, curated] of Object.entries(CURATED_SAMPLES)) {
      if (!samples.some((x) => x.대분류 === 대분류)) samples.push(curated);
    }

    return NextResponse.json({ ok: true, samples });
  } catch (e) {
    console.error('[essay sample] 조회 실패', e);
    // 샘플은 부가 정보다 — 실패해도 주문 화면이 깨지지 않게 빈 배열로 응답
    return NextResponse.json({ ok: true, samples: [] });
  }
}
