import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { GRAMMAR_PROBLEMS_COLLECTION, formatGrammarSerial } from '@/lib/vip-grammar-problem-bank';
import { fetchWorksheetBlocks, flattenWorksheetItems } from '@/lib/vip-worksheet-pdf';
import { generateGradeToken } from '@/lib/final-exam-store';
import {
  GRAMMAR_WORKSHEETS_COLLECTION, ensureWorksheetIndexes,
  type GrammarWorksheet, type WorksheetItem,
} from '@/lib/vip-grammar-worksheet';
import type { BankFormat } from '@/app/my/vip/grammar-problems/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function summary(w: GrammarWorksheet) {
  const total = w.targets.length;
  const done = w.targets.filter((t) => t.status === 'done').length;
  const submitted = w.targets.filter((t) => t.status === 'submitted').length;
  return {
    id: String(w._id),
    title: w.title,
    topicCount: w.topicKeys.length,
    itemCount: w.items.length,
    gradableCount: w.gradableCount,
    category: w.category,
    gradeToken: w.gradeToken,
    createdAt: w.createdAt,
    targets: w.targets.map((t) => ({ studentId: String(t.studentId), studentName: t.studentName, status: t.status })),
    progress: { total, done, submitted, assigned: total - done - submitted },
  };
}

/** GET — 내 문법 학습지 목록. */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'grammar-problems');
  if (auth instanceof NextResponse) return auth;
  const db = await getDb('gomijoshua');
  await ensureWorksheetIndexes(db);
  const list = await db.collection<GrammarWorksheet>(GRAMMAR_WORKSHEETS_COLLECTION)
    .find({ userId: new ObjectId(auth.userId) }).sort({ createdAt: -1 }).limit(200).toArray();
  return NextResponse.json({ ok: true, worksheets: list.map(summary) });
}

/** POST — 문법 학습지 저장(문항 스냅샷 + QR 토큰). body: { title, topicKeys[], category?, source?, fmt?, includeConcepts?, withAnswers? } */
export async function POST(request: NextRequest) {
  const auth = await requireVipMenu(request, 'grammar-problems');
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const title = String(body?.title ?? '').trim().slice(0, 100);
  const topicKeys = Array.isArray(body?.topicKeys) ? (body!.topicKeys as unknown[]).map(String).filter(Boolean) : [];
  const category = String(body?.category ?? '').trim();
  const source = String(body?.source ?? '').trim();
  const fmt: BankFormat = body?.fmt === 'subjective' ? 'subjective' : 'mc';
  const includeConcepts = !!body?.includeConcepts;
  const withAnswers = body?.withAnswers !== false;
  if (!title) return NextResponse.json({ error: '학습지 제목을 입력하세요.' }, { status: 400 });
  if (topicKeys.length === 0) return NextResponse.json({ error: '범위(학습주제)를 1개 이상 선택하세요.' }, { status: 400 });

  const db = await getDb('gomijoshua');
  await ensureWorksheetIndexes(db);

  const blocks = await fetchWorksheetBlocks({
    db, collection: GRAMMAR_PROBLEMS_COLLECTION, userId: auth.userId, keys: topicKeys, source, category, formatSerial: formatGrammarSerial,
  });
  const flat = flattenWorksheetItems(blocks);
  const items: WorksheetItem[] = flat.map(({ num, topicKey, problem: p }) => ({
    num, serial: p.serial, topicKey, category: p.category ?? '',
    question: p.question, options: Array.isArray(p.options) ? p.options : undefined,
    answer: p.answer, explanation: p.explanation ?? '',
  }));
  if (items.length === 0) return NextResponse.json({ error: '선택한 범위에 문제가 없습니다.' }, { status: 400 });
  const gradableCount = items.filter((it) => it.options && it.options.length > 0).length;

  const now = new Date();
  const doc: GrammarWorksheet = {
    userId: new ObjectId(auth.userId), title, topicKeys, category, source, fmt, includeConcepts, withAnswers,
    gradeToken: generateGradeToken(), items, gradableCount, targets: [], createdAt: now, updatedAt: now,
  };
  const r = await db.collection(GRAMMAR_WORKSHEETS_COLLECTION).insertOne(doc);
  return NextResponse.json({ ok: true, id: String(r.insertedId), gradeToken: doc.gradeToken, gradableCount }, { status: 201 });
}
