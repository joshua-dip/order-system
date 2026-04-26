import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * 순서 유형 문항의 정답을 원문(passages.content.original) 대조 검증.
 *
 * 로직:
 * 1. question_data.Paragraph 에서 (A)(B)(C) 텍스트 추출
 * 2. passage_id 로 원문 가져오기
 * 3. 원문에서 각 (A)(B)(C) 텍스트의 위치를 찾아 읽기 순서 결정
 * 4. 읽기 순서 → 정답 번호(①~⑤) 매핑
 * 5. 저장된 CorrectAnswer 와 비교 → 불일치 문항 반환
 *
 * GET ?textbook=...
 */

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;
const ORDER_MAP: Record<string, string> = {
  'ACB': '①', 'BAC': '②', 'BCA': '③', 'CAB': '④', 'CBA': '⑤',
};

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

interface Parsed {
  intro: string;
  A: string;
  B: string;
  C: string;
}

function parseParagraph(raw: string): Parsed | null {
  const re1 = /^([\s\S]+?)\n###\n\(A\)\s*([\s\S]+?)\n###\n\(B\)\s*([\s\S]+?)\n###\n\(C\)\s*([\s\S]+)$/;
  const m1 = raw.match(re1);
  if (m1) return { intro: m1[1].trim(), A: m1[2].trim(), B: m1[3].trim(), C: m1[4].trim() };

  const re2 = /^([\s\S]+?)\n\n\(A\)\s*([\s\S]+?)\n\n\(B\)\s*([\s\S]+?)\n\n\(C\)\s*([\s\S]+)$/;
  const m2 = raw.match(re2);
  if (m2) return { intro: m2[1].trim(), A: m2[2].trim(), B: m2[3].trim(), C: m2[4].trim() };

  return null;
}

/** 원문에서 needle 의 시작 위치를 찾는다. 첫 N글자로 검색. */
function findPosition(original: string, segment: string): number {
  const normOrig = normalize(original);
  // 단계별로 검색 — 긴 것 우선, 점점 줄여서 시도
  for (const len of [80, 50, 30, 20]) {
    const needle = normalize(segment).slice(0, len);
    if (needle.length < 10) continue;
    const idx = normOrig.indexOf(needle);
    if (idx >= 0) return idx;
  }
  // 최후: 첫 단어 3개로 검색
  const words = normalize(segment).split(' ').slice(0, 4).join(' ');
  if (words.length >= 8) {
    const idx = normOrig.indexOf(words);
    if (idx >= 0) return idx;
  }
  return -1;
}

function computeSortedKey(positions: { A: number; B: number; C: number }): string | null {
  if (positions.A < 0 || positions.B < 0 || positions.C < 0) return null;
  return (['A', 'B', 'C'] as const)
    .map(k => ({ label: k, pos: positions[k] }))
    .sort((a, b) => a.pos - b.pos)
    .map(x => x.label)
    .join('');
}

const MAX_ITEMS = 3000;

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';

  const match: Record<string, unknown> = {
    type: '순서',
    deleted_at: null,
    'question_data.Paragraph': { $exists: true },
  };
  if (textbook) match.textbook = textbook;

  try {
    const db = await getDb('gomijoshua');
    const qCol = db.collection('generated_questions');
    const pCol = db.collection('passages');

    const docs = await qCol
      .find(match)
      .project({
        _id: 1, source: 1, textbook: 1, passage_id: 1,
        'question_data.Paragraph': 1,
        'question_data.CorrectAnswer': 1,
        'question_data.순서': 1,
      })
      .sort({ textbook: 1, source: 1, 'question_data.순서': 1 })
      .limit(5000)
      .toArray();

    // 배치로 passage 원문 가져오기
    const passageIds = [...new Set(docs.map(d => String(d.passage_id)).filter(Boolean))];
    const passageMap = new Map<string, string>();

    if (passageIds.length > 0) {
      const passages = await pCol
        .find({ _id: { $in: passageIds.map(id => new ObjectId(id)) } })
        .project({ _id: 1, 'content.original': 1 })
        .toArray();
      for (const p of passages) {
        const orig = (p.content as Record<string, unknown>)?.original;
        if (typeof orig === 'string') {
          passageMap.set(String(p._id), orig);
        }
      }
    }

    const mismatched: {
      id: string;
      textbook: string;
      source: string;
      seq: number;
      currentAnswer: string;
      correctAnswer: string;
      positions: { A: number; B: number; C: number };
      readingOrder: string;
      status: 'mismatch' | 'unverifiable' | 'unshuffled';
    }[] = [];

    let verified = 0;
    let unverifiableNoPush = 0;

    for (const doc of docs) {
      const qd = doc.question_data as Record<string, unknown>;
      const paragraph = String(qd?.Paragraph ?? '');
      const currentAnswer = String(qd?.CorrectAnswer ?? '').trim();
      const seq = Number(qd?.순서 ?? 0);

      const parsed = parseParagraph(paragraph);
      if (!parsed) { unverifiableNoPush++; continue; }

      const original = passageMap.get(String(doc.passage_id));
      if (!original) { unverifiableNoPush++; continue; }

      const positions = {
        A: findPosition(original, parsed.A),
        B: findPosition(original, parsed.B),
        C: findPosition(original, parsed.C),
      };

      const sortedKey = computeSortedKey(positions);
      const correctAnswer = sortedKey ? (ORDER_MAP[sortedKey] ?? null) : null;

      if (!correctAnswer) {
        const isUnshuffled = sortedKey === 'ABC';
        if (mismatched.length < MAX_ITEMS) {
          mismatched.push({
            id: String(doc._id),
            textbook: String(doc.textbook ?? ''),
            source: String(doc.source ?? ''),
            seq,
            currentAnswer,
            correctAnswer: '?',
            positions,
            readingOrder: isUnshuffled ? '(A)-(B)-(C)' : '?',
            status: isUnshuffled ? 'unshuffled' : 'unverifiable',
          });
        }
        continue;
      }

      verified++;

      if (correctAnswer !== currentAnswer) {
        const sorted = (['A', 'B', 'C'] as const)
          .map(k => ({ label: k, pos: positions[k] }))
          .sort((a, b) => a.pos - b.pos)
          .map(x => `(${x.label})`)
          .join('-');

        if (mismatched.length < MAX_ITEMS) {
          mismatched.push({
            id: String(doc._id),
            textbook: String(doc.textbook ?? ''),
            source: String(doc.source ?? ''),
            seq,
            currentAnswer,
            correctAnswer,
            positions,
            readingOrder: sorted,
            status: 'mismatch',
          });
        }
      }
    }

    const totalMismatched = mismatched.filter(m => m.status === 'mismatch').length;
    const totalUnshuffled = mismatched.filter(m => m.status === 'unshuffled').length;
    const totalUnverifiable = mismatched.filter(m => m.status === 'unverifiable').length + unverifiableNoPush;

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null },
      totalScanned: docs.length,
      totalVerified: verified,
      totalMismatched,
      totalUnshuffled,
      totalUnverifiable,
      totalCorrect: verified - totalMismatched,
      truncated: mismatched.length >= MAX_ITEMS,
      items: mismatched,
    });
  } catch (e) {
    console.error('validate/order-answer-verify GET:', e);
    return NextResponse.json({ error: '검증 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** POST: 불일치 문항 일괄 자동수정 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const fixes: { id: string; answer: string }[] = Array.isArray(body?.fixes) ? body.fixes : [];

  if (fixes.length === 0) {
    return NextResponse.json({ error: 'fixes 배열이 필요합니다.' }, { status: 400 });
  }

  const validAnswers = new Set(CIRCLED);

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');

    let modifiedCount = 0;
    for (const fix of fixes) {
      if (!ObjectId.isValid(fix.id) || !validAnswers.has(fix.answer as typeof CIRCLED[number])) continue;
      const res = await col.updateOne(
        { _id: new ObjectId(fix.id) },
        { $set: { 'question_data.CorrectAnswer': fix.answer, updated_at: new Date() } },
      );
      modifiedCount += res.modifiedCount;
    }

    return NextResponse.json({ ok: true, modifiedCount });
  } catch (e) {
    console.error('validate/order-answer-verify POST:', e);
    return NextResponse.json({ error: '수정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** DELETE: 미셔플 등 불량 문항 일괄 하드 삭제 (body: { ids: string[] }) */
export async function DELETE(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids 배열이 필요합니다.' }, { status: 400 });
  }

  const validIds = ids.filter(id => typeof id === 'string' && ObjectId.isValid(id)).map(id => new ObjectId(id));
  if (validIds.length === 0) {
    return NextResponse.json({ error: '유효한 ObjectId가 없습니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const r = await db.collection('generated_questions').deleteMany({ _id: { $in: validIds } });
    return NextResponse.json({ ok: true, deletedCount: r.deletedCount });
  } catch (e) {
    console.error('validate/order-answer-verify DELETE:', e);
    return NextResponse.json({ error: '삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
