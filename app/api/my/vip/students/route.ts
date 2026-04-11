import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, ensureVipIndexes, col, type VipStudent } from '@/lib/vip-db';

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const db = await getVipDb();
  await ensureVipIndexes(db);
  const uid = new ObjectId(auth.userId);

  const sp = request.nextUrl.searchParams;
  const schoolId = sp.get('schoolId');
  const grade = sp.get('grade');
  const academicYear = sp.get('academicYear');
  const search = sp.get('search');
  const status = sp.get('status') || 'active';
  const page = Math.max(1, Number(sp.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit') || '50')));

  const filter: Record<string, unknown> = { userId: uid };
  if (schoolId) filter.schoolId = new ObjectId(schoolId);
  if (grade) filter.grade = Number(grade);
  if (academicYear) filter.academicYear = Number(academicYear);
  if (status !== 'all') filter.status = status;
  if (search) filter.name = { $regex: search, $options: 'i' };

  const [students, total] = await Promise.all([
    col<VipStudent>(db, 'students')
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    col<VipStudent>(db, 'students').countDocuments(filter),
  ]);

  const schoolIds = [...new Set(students.map((s) => s.schoolId.toString()))];
  const schools = schoolIds.length
    ? await col(db, 'schools')
        .find({ _id: { $in: schoolIds.map((id) => new ObjectId(id)) } })
        .project({ name: 1 })
        .toArray()
    : [];
  const schoolMap = new Map(schools.map((s) => [s._id.toString(), s.name as string]));

  return NextResponse.json({
    ok: true,
    items: students.map((s) => ({
      id: s._id!.toString(),
      schoolId: s.schoolId.toString(),
      schoolName: schoolMap.get(s.schoolId.toString()) ?? s.schoolName ?? '',
      name: s.name,
      grade: s.grade,
      academicYear: s.academicYear,
      status: s.status,
      examScope: s.examScope,
      memo: s.memo ?? '',
      phone: s.phone ?? '',
      parentPhone: s.parentPhone ?? '',
      createdAt: s.createdAt?.toISOString() ?? '',
    })),
    total,
    totalPages: Math.ceil(total / limit),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: '학생 이름을 입력해주세요.' }, { status: 400 });

  const schoolId = body.schoolId;
  const schoolName = (body.schoolName ?? '').trim();
  if (!schoolId && !schoolName) {
    return NextResponse.json({ error: '학교를 선택하거나 이름을 입력해주세요.' }, { status: 400 });
  }

  const db = await getVipDb();
  await ensureVipIndexes(db);
  const uid = new ObjectId(auth.userId);

  let resolvedSchoolId: ObjectId;
  if (schoolId) {
    resolvedSchoolId = new ObjectId(schoolId);
  } else {
    const existing = await col(db, 'schools').findOne({ userId: uid, name: schoolName });
    if (existing) {
      resolvedSchoolId = existing._id;
    } else {
      const res = await col(db, 'schools').insertOne({
        userId: uid,
        name: schoolName,
        createdAt: new Date(),
      } as any);
      resolvedSchoolId = res.insertedId;
    }
  }

  const currentYear = new Date().getFullYear();
  const doc: VipStudent = {
    userId: uid,
    schoolId: resolvedSchoolId,
    name,
    grade: Number(body.grade) || 1,
    academicYear: Number(body.academicYear) || currentYear,
    status: 'active',
    examScope: Array.isArray(body.examScope) ? body.examScope : [],
    memo: (body.memo ?? '').trim() || undefined,
    phone: (body.phone ?? '').trim() || undefined,
    parentPhone: (body.parentPhone ?? '').trim() || undefined,
    createdAt: new Date(),
  };

  const result = await col<VipStudent>(db, 'students').insertOne(doc as any);
  return NextResponse.json({ ok: true, id: result.insertedId.toString() }, { status: 201 });
}
