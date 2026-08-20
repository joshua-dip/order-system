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

    const samples = [];
    for (const p of picks) {
      const doc = await col.findOne(p.filter, { sort: { createdAt: -1 } });
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
        passage: clip(data.passage, 800),
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
