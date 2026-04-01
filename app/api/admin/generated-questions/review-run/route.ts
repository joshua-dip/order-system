import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

export const maxDuration = 60;

/**
 * 검수 배치는 Claude Code MCP(list + record)만 지원합니다. Anthropic API를 태우지 않습니다.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  return NextResponse.json(
    {
      error:
        '웹에서 검수 배치를 실행할 수 없습니다. Claude Code MCP: variant_review_pending_list 로 대기 목록을 받은 뒤 풀이하고, 문항마다 variant_review_pending_record 로 로그를 남기세요. (Anthropic API 키 없이 목록·기록만 동작)',
    },
    { status: 403 }
  );
}
