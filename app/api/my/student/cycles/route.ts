import { NextRequest, NextResponse } from 'next/server';
import { requireStudent } from '@/lib/student-auth';
import { listCycles } from '@/lib/exam-cycles-store';

export async function GET(request: NextRequest) {
  const { error } = await requireStudent(request);
  if (error) return error;

  const cycles = await listCycles(true); // activeOnly
  return NextResponse.json({ cycles });
}
