import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 서술형 워크북 샘플 — 로그인 없이도 볼 수 있다.
 * 이미 제작된 자료에서 유형별 한 건씩 뽑아 지문·문항·조건을 그대로 보여 준다.
 */
function clip(s: unknown, max: number): string {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 샘플 미리보기용 — passage 의 marker/kr 등 인라인 HTML 태그를 걷어내 평문으로. */
function stripHtml(s: unknown): string {
  return typeof s === 'string' ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
}

export async function GET() {
  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('essay_exams');

    const picks: { key: string; label: string; filter: Record<string, unknown> }[] = [
      {
        key: 'arrange',
        label: '조건영작배열',
        filter: { isPlaceholder: { $ne: true }, 'data.meta.examType': { $exists: false }, difficulty: '기본난도' },
      },
      {
        key: 'meaning',
        label: '글의의미 서술형',
        filter: { isPlaceholder: { $ne: true }, 'data.meta.examType': '글의의미서술형' },
      },
    ];

    // 쇼케이스는 모의고사 샘플이 낫다 — 모의고사 교재("…영어모의고사")를 우선 뽑고,
    // 해당 유형의 모의고사 자료가 없으면 아무 교재로 fallback.
    const pickSampleDoc = async (baseFilter: Record<string, unknown>) => {
      const mockDoc = await col.findOne(
        { ...baseFilter, textbook: { $regex: '영어모의고사' } },
        { sort: { createdAt: -1 } },
      );
      return mockDoc ?? (await col.findOne(baseFilter, { sort: { createdAt: -1 } }));
    };

    const samples = [];
    for (const p of picks) {
      const doc = await pickSampleDoc(p.filter);
      if (!doc) continue;
      const data = (doc.data ?? {}) as Record<string, unknown>;
      const meta = (data.meta ?? {}) as Record<string, unknown>;
      const questions = Array.isArray(data.questions) ? (data.questions as Record<string, unknown>[]) : [];
      samples.push({
        key: p.key,
        label: p.label,
        textbook: String(doc.textbook ?? ''),
        sourceKey: String(doc.sourceKey ?? ''),
        difficulty: String(doc.difficulty ?? ''),
        배점: clip(
          (Array.isArray(meta.info) ? meta.info : []).find(
            (i) => (i as Record<string, unknown>)?.label === '배점',
          )?.['value'],
          40,
        ),
        passage: clip(stripHtml(data.passage), 800),
        questions: questions.slice(0, 2).map((q) => ({
          prompt: clip(q.prompt, 200),
          points: typeof q.points === 'number' ? q.points : null,
          conditions: (Array.isArray(q.conditions) ? q.conditions : []).slice(0, 6).map((c) => clip(c, 160)),
          bogi: clip((q as Record<string, unknown>).bogi ?? (q as Record<string, unknown>).보기, 300),
        })),
      });
    }

    return NextResponse.json({ ok: true, samples });
  } catch (e) {
    console.error('[essay-workbook sample]', e);
    return NextResponse.json({ ok: true, samples: [] });
  }
}
