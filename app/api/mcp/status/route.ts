import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

export const maxDuration = 30;

/**
 * 브리지(3100) 헬스 + Next 쪽 토큰 설정 여부만 알려 줍니다. 토큰 값은 노출하지 않습니다.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const bridgeUrl = (process.env.MCP_BRIDGE_URL || "http://localhost:3100").replace(/\/$/, "");
  const hasToken = Boolean(process.env.MCP_BRIDGE_TOKEN?.trim());

  let bridgeReachable = false;
  let bridgeError: string | null = null;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 4000);
    const res = await fetch(`${bridgeUrl}/health`, { signal: ac.signal });
    clearTimeout(t);
    bridgeReachable = res.ok;
    if (!res.ok) bridgeError = `HTTP ${res.status}`;
  } catch (e) {
    bridgeError = e instanceof Error ? e.message : "연결 실패";
  }

  return NextResponse.json({
    bridgeUrl,
    hasToken,
    bridgeReachable,
    bridgeError,
    claudeCliHint: process.env.CLAUDE_PATH || "claude (PATH)",
  });
}
