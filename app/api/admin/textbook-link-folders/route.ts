import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

const FOLDERS = 'textbook_link_folders';
const ASSIGN = 'textbook_link_folder_assignments';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const db = await getDb('gomijoshua');
    const folders = await db
      .collection(FOLDERS)
      .find({})
      .sort({ order: 1, createdAt: 1 })
      .toArray();
    return NextResponse.json({
      success: true,
      folders: folders.map((f) => ({
        id: String(f._id),
        name: (f as { name?: string }).name ?? '',
        order: (f as { order?: number }).order ?? 0,
      })),
    });
  } catch (e) {
    console.error('textbook-link-folders GET:', e);
    return NextResponse.json({ success: false, message: '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const { name } = await request.json();
    if (!name?.trim()) {
      return NextResponse.json({ success: false, message: 'name이 필요합니다.' }, { status: 400 });
    }
    const db = await getDb('gomijoshua');
    const count = await db.collection(FOLDERS).countDocuments({});
    const doc = { name: name.trim(), order: count, createdAt: new Date() };
    const result = await db.collection(FOLDERS).insertOne(doc);
    return NextResponse.json({
      success: true,
      folder: { id: String(result.insertedId), name: doc.name, order: doc.order },
    });
  } catch (e) {
    console.error('textbook-link-folders POST:', e);
    return NextResponse.json({ success: false, message: '생성 실패' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const { folderId, name } = await request.json();
    if (!folderId || !name?.trim()) {
      return NextResponse.json({ success: false, message: 'folderId와 name이 필요합니다.' }, { status: 400 });
    }
    const db = await getDb('gomijoshua');
    await db.collection(FOLDERS).updateOne(
      { _id: new ObjectId(folderId) },
      { $set: { name: name.trim(), updatedAt: new Date() } }
    );
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('textbook-link-folders PUT:', e);
    return NextResponse.json({ success: false, message: '수정 실패' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const folderId = request.nextUrl.searchParams.get('folderId')?.trim() || '';
  if (!folderId || !ObjectId.isValid(folderId)) {
    return NextResponse.json({ success: false, message: 'folderId가 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    await db.collection(FOLDERS).deleteOne({ _id: new ObjectId(folderId) });
    await db.collection(ASSIGN).deleteMany({ folderId });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('textbook-link-folders DELETE:', e);
    return NextResponse.json({ success: false, message: '삭제 실패' }, { status: 500 });
  }
}
