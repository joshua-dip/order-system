import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  try {
    const db = await getDb('gomijoshua');
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(payload.sub) },
      {
        projection: {
          loginId: 1,
          role: 1,
          name: 1,
          email: 1,
          dropboxFolderPath: 1,
          dropboxSharedLink: 1,
          canAccessAnalysis: 1,
          canAccessEssay: 1,
          myFormatApproved: 1,
          allowedTextbooks: 1,
          allowedTextbooksAnalysis: 1,
          allowedTextbooksEssay: 1,
          allowedTextbooksWorkbook: 1,
          allowedTextbooksVariant: 1,
          points: 1,
        },
      }
    );
    if (!user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }
    const points = typeof user.points === 'number' && user.points >= 0 ? user.points : 0;
    const wb = user.allowedTextbooksWorkbook;
    const vb = (user as { allowedTextbooksVariant?: unknown }).allowedTextbooksVariant;
    return NextResponse.json({
      user: {
        loginId: user.loginId,
        role: user.role,
        name: user.name ?? user.loginId,
        email: user.email ?? '',
        dropboxFolderPath: user.dropboxFolderPath ?? '',
        dropboxSharedLink: user.dropboxSharedLink ?? '',
        canAccessAnalysis: !!user.canAccessAnalysis,
        canAccessEssay: !!user.canAccessEssay,
        myFormatApproved: !!user.myFormatApproved,
        allowedTextbooks: Array.isArray(user.allowedTextbooks) ? user.allowedTextbooks : [],
        allowedTextbooksAnalysis: Array.isArray(user.allowedTextbooksAnalysis) ? user.allowedTextbooksAnalysis : (Array.isArray(user.allowedTextbooks) ? user.allowedTextbooks : []),
        allowedTextbooksEssay: Array.isArray(user.allowedTextbooksEssay) ? user.allowedTextbooksEssay : (Array.isArray(user.allowedTextbooks) ? user.allowedTextbooks : []),
        ...(Array.isArray(wb) ? { allowedTextbooksWorkbook: wb } : {}),
        ...(Array.isArray(vb) ? { allowedTextbooksVariant: vb } : {}),
        points,
      },
    });
    } catch {
    return NextResponse.json({
      user: { loginId: payload.loginId, role: payload.role, name: payload.loginId, email: '', canAccessAnalysis: false, canAccessEssay: false, myFormatApproved: false, allowedTextbooks: [], allowedTextbooksAnalysis: [], allowedTextbooksEssay: [], points: 0 },
    });
  }
}
