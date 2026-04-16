import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { MEMBER_GENERATED_QUESTIONS_COLLECTION } from '@/lib/member-variant-storage';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const EMPTY_MARKER = '__none__';

function buildListFilter(
  ownerUserId: unknown,
  opts: {
    type?: string;
    textbook?: string;
    source?: string;
    status?: string;
    difficulty?: string;
    search?: string;
  }
): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [{ ownerUserId }];

  if (opts.type) parts.push({ type: opts.type });

  if (opts.textbook === EMPTY_MARKER) {
    parts.push({
      $or: [{ textbook: { $exists: false } }, { textbook: null }, { textbook: '' }],
    });
  } else if (opts.textbook) {
    parts.push({ textbook: opts.textbook });
  }

  if (opts.source === EMPTY_MARKER) {
    parts.push({
      $or: [{ source: { $exists: false } }, { source: null }, { source: '' }],
    });
  } else if (opts.source) {
    parts.push({ source: opts.source });
  }

  if (opts.status) parts.push({ status: opts.status });
  if (opts.difficulty) parts.push({ difficulty: opts.difficulty });

  if (opts.search) {
    const esc = opts.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc, 'i');
    parts.push({
      $or: [
        { textbook: re },
        { source: re },
        { type: re },
        { 'question_data.Question': re },
        { 'question_data.Paragraph': re },
      ],
    });
  }

  if (parts.length === 1) return parts[0]!;
  return { $and: parts };
}

function previewParagraph(s: string, max = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function previewOptions(s: string, max = 120): string {
  const flat = s.replace(/\s*###\s*/g, ' · ').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}

export async function GET(request: NextRequest) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const sp = request.nextUrl.searchParams;
  let limit = parseInt(sp.get('limit') ?? '', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);
  let skip = parseInt(sp.get('skip') ?? '', 10);
  if (!Number.isFinite(skip) || skip < 0) skip = 0;
  const typeParam = sp.get('type')?.trim() ?? '';
  const textbookParam = sp.get('textbook')?.trim() ?? '';
  const sourceParam = sp.get('source')?.trim() ?? '';
  const statusParam = sp.get('status')?.trim() ?? '';
  const difficultyParam = sp.get('difficulty')?.trim() ?? '';
  const searchParam = sp.get('search')?.trim() ?? '';
  const search =
    searchParam.length > 0 && searchParam.length <= 200 ? searchParam.slice(0, 200) : '';

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection(MEMBER_GENERATED_QUESTIONS_COLLECTION);
    const filter = buildListFilter(auth.userId, {
      type: typeParam || undefined,
      textbook: textbookParam || undefined,
      source: sourceParam || undefined,
      status: statusParam || undefined,
      difficulty: difficultyParam || undefined,
      search: search || undefined,
    });

    const [total, rows] = await Promise.all([
      col.countDocuments(filter),
      col
        .find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .project({
          created_at: 1,
          textbook: 1,
          source: 1,
          type: 1,
          status: 1,
          difficulty: 1,
          option_type: 1,
          'question_data.Question': 1,
          'question_data.Paragraph': 1,
          'question_data.Options': 1,
          'question_data.CorrectAnswer': 1,
          'question_data.Answer': 1,
        })
        .toArray(),
    ]);

    const items = rows.map((r) => {
      const qd = (r as { question_data?: Record<string, unknown> }).question_data ?? {};
      const q = typeof qd.Question === 'string' ? qd.Question : '';
      const p = typeof qd.Paragraph === 'string' ? qd.Paragraph : '';
      const opts = typeof qd.Options === 'string' ? qd.Options : '';
      const ansRaw =
        (typeof qd.CorrectAnswer === 'string' ? qd.CorrectAnswer : '') ||
        (typeof qd.Answer === 'string' ? qd.Answer : '');
      return {
        id: String(r._id),
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : null,
        textbook: typeof r.textbook === 'string' ? r.textbook : '',
        source: typeof r.source === 'string' ? r.source : '',
        type: typeof r.type === 'string' ? r.type : '',
        status: typeof r.status === 'string' ? r.status : '',
        difficulty: typeof r.difficulty === 'string' ? r.difficulty : '',
        option_type: typeof r.option_type === 'string' ? r.option_type : '',
        question_preview: previewParagraph(q || p),
        answer_preview: previewParagraph(ansRaw, 80),
        options_preview: opts.trim() ? previewOptions(opts, 140) : '',
      };
    });

    return NextResponse.json({
      ok: true,
      total,
      skip,
      limit,
      items,
    });
  } catch (e) {
    console.error('member-variant questions list:', e);
    return NextResponse.json({ error: '목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
