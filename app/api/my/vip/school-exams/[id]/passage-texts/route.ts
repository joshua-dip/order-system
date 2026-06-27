import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PREVIEW_MAX = 1000;

/** `교재::sourceKey` → {textbook, sourceKey} */
function parseKey(key: string): { textbook: string; sourceKey: string } {
  const idx = key.indexOf('::');
  if (idx < 0) return { textbook: '', sourceKey: key };
  return { textbook: key.slice(0, idx), sourceKey: key.slice(idx + 2) };
}

/** GET — 시험범위 지문(examScopePassages)별 영어 본문 미리보기 (필기 사진 모달 툴팁용). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 });

  const db = await getDb('gomijoshua');
  const userId = new ObjectId(auth.userId);
  const exam = await db.collection('vip_school_exams').findOne(
    { _id: new ObjectId(id), userId },
    { projection: { examScopePassages: 1 } },
  );
  if (!exam) return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 });

  const keys: string[] = Array.isArray(exam.examScopePassages) ? exam.examScopePassages.map(String) : [];
  const pairs = keys.map(parseKey).filter((p) => p.sourceKey);
  if (pairs.length === 0) return NextResponse.json({ ok: true, texts: {} });

  const or = pairs.map((p) => (p.textbook ? { textbook: p.textbook, source_key: p.sourceKey } : { source_key: p.sourceKey }));
  const docs = await db
    .collection('passages')
    .find({ $or: or }, { projection: { textbook: 1, source_key: 1, 'content.original': 1 } })
    .toArray();

  const texts: Record<string, string> = {};
  for (const d of docs) {
    const tb = String(d.textbook ?? '');
    const sk = String(d.source_key ?? '');
    const key = `${tb}::${sk}`;
    const en = String((d.content as { original?: unknown })?.original ?? '').replace(/\s+/g, ' ').trim();
    if (!en) continue;
    texts[key] = en.length > PREVIEW_MAX ? `${en.slice(0, PREVIEW_MAX)}…` : en;
  }
  return NextResponse.json({ ok: true, texts });
}
