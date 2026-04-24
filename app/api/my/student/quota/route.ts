import { NextRequest, NextResponse } from 'next/server';
import { requireStudent } from '@/lib/student-auth';
import { getQuotaSummary } from '@/lib/student-ai-quota';

export async function GET(request: NextRequest) {
  const { error, payload } = await requireStudent(request);
  if (error) return error;

  const summary = await getQuotaSummary(payload!.loginId);
  return NextResponse.json(summary);
}
