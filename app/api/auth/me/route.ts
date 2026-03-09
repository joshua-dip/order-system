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
      { projection: { loginId: 1, role: 1, name: 1, email: 1 } }
    );
    if (!user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }
    return NextResponse.json({
      user: {
        loginId: user.loginId,
        role: user.role,
        name: user.name ?? user.loginId,
        email: user.email ?? '',
      },
    });
  } catch {
    return NextResponse.json({
      user: { loginId: payload.loginId, role: payload.role, name: payload.loginId, email: '' },
    });
  }
}
