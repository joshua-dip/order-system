import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 헬스체크 응답은 절대 캐시되면 안 됨 — 매번 실제로 Lambda·DB 를 깨워야 keep-warm 효과가 있다. */
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

/**
 * 헬스체크 / keep-warm 핑.
 *  · 서버리스(Amplify) Lambda 인스턴스를 깨워 둔 상태로 유지하고,
 *  · Mongo 연결(getDb 는 globalThis 공유 캐시)을 함께 워밍해
 *    다음 요청(auth/me 등)이 콜드 연결 대기를 겪지 않게 한다.
 *
 * 사용: cron-job.org · UptimeRobot 등으로 5분 간격 GET 호출 (인증 불필요, 민감정보 없음).
 * 응답: { ok, db: 'up'|'down', ms }.  DB 정상 200 / DB 장애 503 (둘 다 Lambda 는 워밍됨).
 */
export async function GET() {
  const started = Date.now();
  let db: 'up' | 'down' = 'down';
  try {
    const database = await getDb('gomijoshua');
    await database.command({ ping: 1 });
    db = 'up';
  } catch {
    db = 'down';
  }
  const ms = Date.now() - started;
  return NextResponse.json(
    { ok: db === 'up', db, ms },
    { status: db === 'up' ? 200 : 503, headers: NO_STORE },
  );
}
