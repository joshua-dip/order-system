import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { verifyToken, hashPassword, COOKIE_NAME } from '@/lib/auth';

const DEFAULT_PASSWORD = '123456';

async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return { error: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }), payload: null };
  }
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return { error: NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 }), payload: null };
  }
  return { error: null, payload };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, payload } = await requireAdmin(request);
    if (error) return error;
    const { id } = await params;
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const users = db.collection('users');
    const target = await users.findOne({ _id: new ObjectId(id) });
    if (!target) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (target.role !== 'user') {
      return NextResponse.json({ error: '일반 계정만 수정할 수 있습니다.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
    const email = typeof body?.email === 'string' ? body.email.trim() : undefined;
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : undefined;
    const dropboxFolderPath = typeof body?.dropboxFolderPath === 'string' ? body.dropboxFolderPath.trim() : undefined;
    const dropboxSharedLink = typeof body?.dropboxSharedLink === 'string' ? body.dropboxSharedLink.trim() : undefined;
    const resetPassword = body?.resetPassword === true;
    const canAccessAnalysis = body?.canAccessAnalysis === true || body?.canAccessAnalysis === false ? body.canAccessAnalysis : undefined;
    const canAccessEssay = body?.canAccessEssay === true || body?.canAccessEssay === false ? body.canAccessEssay : undefined;
    const myFormatApproved = body?.myFormatApproved === true || body?.myFormatApproved === false ? body.myFormatApproved : undefined;
    const allowedTextbooks = Array.isArray(body?.allowedTextbooks) ? body.allowedTextbooks : undefined;
    const allowedTextbooksAnalysis = Array.isArray(body?.allowedTextbooksAnalysis) ? body.allowedTextbooksAnalysis : undefined;
    const allowedTextbooksEssay = Array.isArray(body?.allowedTextbooksEssay) ? body.allowedTextbooksEssay : undefined;
    const hasAllowedTextbooksWorkbook = 'allowedTextbooksWorkbook' in body;
    const allowedTextbooksWorkbookRaw = hasAllowedTextbooksWorkbook ? body.allowedTextbooksWorkbook : undefined;
    const hasAllowedTextbooksVariant = 'allowedTextbooksVariant' in body;
    const allowedTextbooksVariantRaw = hasAllowedTextbooksVariant ? body.allowedTextbooksVariant : undefined;
    const allowedEssayTypeIds = Array.isArray(body?.allowedEssayTypeIds) ? body.allowedEssayTypeIds.filter((id: unknown) => typeof id === 'string') : undefined;
    const points = typeof body?.points === 'number' && body.points >= 0 ? body.points : undefined;
    const addPoints = typeof body?.addPoints === 'number' ? body.addPoints : undefined;
    const supplementaryNote = typeof body?.supplementaryNote === 'string' ? body.supplementaryNote.trim() : undefined;
    const hasAnnualMemberSince = 'annualMemberSince' in body;
    let annualMemberSinceValue: Date | null | undefined = undefined;
    if (hasAnnualMemberSince) {
      const v = body.annualMemberSince;
      if (v === null || v === '' || (typeof v === 'string' && v.trim() === ''))
        annualMemberSinceValue = null;
      else if (typeof v === 'string') {
        const d = new Date(v.trim());
        annualMemberSinceValue = Number.isNaN(d.getTime()) ? undefined : d;
      }
    }

    const updates: Record<string, unknown> = {};
    const unsetDoc: Record<string, string> = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (dropboxFolderPath !== undefined) updates.dropboxFolderPath = dropboxFolderPath;
    if (dropboxSharedLink !== undefined) updates.dropboxSharedLink = dropboxSharedLink;
    if (canAccessAnalysis !== undefined) updates.canAccessAnalysis = canAccessAnalysis;
    if (canAccessEssay !== undefined) updates.canAccessEssay = canAccessEssay;
    if (myFormatApproved !== undefined) updates.myFormatApproved = myFormatApproved;
    if (allowedTextbooks !== undefined) updates.allowedTextbooks = allowedTextbooks;
    if (allowedTextbooksAnalysis !== undefined) updates.allowedTextbooksAnalysis = allowedTextbooksAnalysis;
    if (allowedTextbooksEssay !== undefined) updates.allowedTextbooksEssay = allowedTextbooksEssay;
    if (hasAllowedTextbooksWorkbook) {
      if (allowedTextbooksWorkbookRaw === null) {
        unsetDoc.allowedTextbooksWorkbook = '';
      } else if (Array.isArray(allowedTextbooksWorkbookRaw)) {
        updates.allowedTextbooksWorkbook = allowedTextbooksWorkbookRaw.filter(
          (x: unknown): x is string => typeof x === 'string'
        );
      }
    }
    if (hasAllowedTextbooksVariant) {
      if (allowedTextbooksVariantRaw === null) {
        unsetDoc.allowedTextbooksVariant = '';
      } else if (Array.isArray(allowedTextbooksVariantRaw)) {
        updates.allowedTextbooksVariant = allowedTextbooksVariantRaw.filter(
          (x: unknown): x is string => typeof x === 'string'
        );
      }
    }
    if (allowedEssayTypeIds !== undefined) updates.allowedEssayTypeIds = allowedEssayTypeIds;
    if (points !== undefined) updates.points = points;
    if (supplementaryNote !== undefined) updates.supplementaryNote = supplementaryNote;
    if (hasAnnualMemberSince && annualMemberSinceValue !== undefined) updates.annualMemberSince = annualMemberSinceValue;
    if (addPoints !== undefined && addPoints > 0) {
      const t = target as { points?: number };
      const current = typeof t.points === 'number' && t.points >= 0 ? t.points : 0;
      updates.points = current + addPoints;
    }
    if (resetPassword) {
      updates.passwordHash = await hashPassword(DEFAULT_PASSWORD);
    }

    const mongoOp: Record<string, unknown> = {};
    if (Object.keys(updates).length > 0) mongoOp.$set = updates;
    if (Object.keys(unsetDoc).length > 0) mongoOp.$unset = unsetDoc;

    if (Object.keys(mongoOp).length === 0) {
      return NextResponse.json({ error: '변경할 내용이 없습니다.' }, { status: 400 });
    }

    await users.updateOne({ _id: new ObjectId(id) }, mongoOp);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('관리자 계정 수정 실패:', err);
    return NextResponse.json(
      { error: '수정 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, payload } = await requireAdmin(request);
    if (error) return error;
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
    }

    if (payload.sub === id) {
      return NextResponse.json({ error: '본인 계정은 삭제할 수 없습니다.' }, { status: 403 });
    }

    const db = await getDb('gomijoshua');
    const users = db.collection('users');
    const target = await users.findOne({ _id: new ObjectId(id) });
    if (!target) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (target.role !== 'user') {
      return NextResponse.json({ error: '일반 계정만 삭제할 수 있습니다.' }, { status: 403 });
    }

    await users.deleteOne({ _id: new ObjectId(id) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('관리자 계정 삭제 실패:', err);
    return NextResponse.json(
      { error: '삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
