import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { GUEST_GENERATED_QUESTIONS_COLLECTION } from '@/lib/guest-generated-questions-store';
import { buildGuestLogsFilter } from '@/lib/guest-variant-logs-admin';

const MAX_ROWS = 2000;

function qd(doc: Record<string, unknown>, key: string): string {
  const q = (doc.question_data as Record<string, unknown> | undefined) || {};
  const v = q[key];
  return typeof v === 'string' ? v : '';
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    body = {};
  }

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection(GUEST_GENERATED_QUESTIONS_COLLECTION);

    let filter: Record<string, unknown> = {};

    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const oids: ObjectId[] = [];
      for (const v of body.ids) {
        if (typeof v === 'string' && ObjectId.isValid(v)) oids.push(new ObjectId(v));
      }
      if (oids.length === 0) {
        return NextResponse.json({ error: '유효한 ids 필요' }, { status: 400 });
      }
      filter = { _id: { $in: oids } };
    } else if (body.filter && typeof body.filter === 'object') {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(body.filter as Record<string, unknown>)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          sp.set(k, String(v));
        }
      }
      filter = buildGuestLogsFilter(sp);
    }

    const items = await col
      .find(filter)
      .sort({ created_at: -1 })
      .limit(MAX_ROWS)
      .toArray();

    const rows = items.map((raw) => {
      const doc = raw as unknown as Record<string, unknown>;
      return {
        생성일시: doc.created_at instanceof Date
          ? (doc.created_at as Date).toISOString()
          : String(doc.created_at ?? ''),
        상태: doc.match_status,
        교재: (doc.textbook as string | undefined) ?? '',
        강: (doc.chapter as string | undefined) ?? '',
        번호: (doc.number as string | undefined) ?? '',
        출처: (doc.source as string | undefined) ?? '',
        유형: (doc.type as string | undefined) ?? '',
        난이도: (doc.difficulty as string | undefined) ?? '',
        지문: (doc.input_paragraph as string | undefined) ?? '',
        문제: qd(doc, 'Question'),
        지문_가공: qd(doc, 'Paragraph'),
        보기: qd(doc, 'Options').replace(/\s*###\s*/g, '\n'),
        정답: qd(doc, 'CorrectAnswer'),
        해설: qd(doc, 'Explanation'),
        태그: Array.isArray(doc.tags) ? (doc.tags as string[]).join(', ') : '',
        메모: (doc.note as string | undefined) ?? '',
        IP해시: (doc.ip_hash as string | undefined) ?? '',
        승격여부: doc.promoted_to ? 'Y' : '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'guest_variant_logs');
    const buf: Buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    const ymd = new Date().toISOString().slice(0, 10);
    return new NextResponse(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="guest-variant-logs-${ymd}.xlsx"`,
      },
    });
  } catch (e) {
    console.error('guest-variant-logs export:', e);
    return NextResponse.json({ error: '내보내기 실패' }, { status: 500 });
  }
}
