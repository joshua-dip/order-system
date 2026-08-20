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

    return NextResponse.json({ ok: true, samples });
  } catch (e) {
    console.error('[essay sample] 조회 실패', e);
    // 샘플은 부가 정보다 — 실패해도 주문 화면이 깨지지 않게 빈 배열로 응답
    return NextResponse.json({ ok: true, samples: [] });
  }
}
