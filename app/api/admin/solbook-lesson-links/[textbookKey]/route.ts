import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  getSolbookLinksFor,
  upsertSolbookLinks,
  deleteSolbookLinks,
  type SolbookLessonLink,
} from '@/lib/solbook-lesson-links-store';

type Params = { params: Promise<{ textbookKey: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { textbookKey } = await params;
  const item = await getSolbookLinksFor(decodeURIComponent(textbookKey));
  if (!item) return NextResponse.json({ error: '없음' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  const { textbookKey } = await params;
  let body: {
    groupTitle?: string;
    groupUrl?: string;
    groupLabel?: string;
    lessons?: SolbookLessonLink[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  if (!Array.isArray(body.lessons)) {
    return NextResponse.json({ error: 'lessons 배열이 필요합니다.' }, { status: 400 });
  }

  const cleanedLessons: SolbookLessonLink[] = body.lessons.map((l, i) => ({
    lessonKey: String(l.lessonKey ?? '').trim(),
    url: String(l.url ?? '').trim(),
    ...(l.label !== undefined ? { label: String(l.label).trim() } : {}),
    ...(l.itemCount !== undefined && Number.isFinite(Number(l.itemCount))
      ? { itemCount: Math.round(Number(l.itemCount)) }
      : {}),
    order: l.order !== undefined ? Number(l.order) : i,
  })).filter((l) => l.lessonKey && l.url);

  const item = await upsertSolbookLinks(decodeURIComponent(textbookKey), {
    groupTitle: body.groupTitle,
    groupUrl: body.groupUrl,
    groupLabel: body.groupLabel,
    lessons: cleanedLessons,
    updatedBy: payload?.loginId,
  });

  return NextResponse.json({ item });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { textbookKey } = await params;
  const ok = await deleteSolbookLinks(decodeURIComponent(textbookKey));
  if (!ok) return NextResponse.json({ error: '없음' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
