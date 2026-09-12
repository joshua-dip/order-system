import { createHash } from 'node:crypto';
import { type Db } from 'mongodb';

/**
 * 공개 무료 PDF 다운로드의 IP 당 일일 제한.
 *
 * 로그인도 이름·전화 입력도 없는 완전 공개라, 재고를 통째로 긁어가는 것만 막는다.
 * 정확한 방어가 목적이 아니다(IP 는 우회된다) — **한 사람이 한 번에 회차 전체를
 * 쓸어 담는 것**을 어렵게 하는 정도다. 문항 수 상한(`PUBLIC_FREE_MAX_QUESTIONS_PER_PDF`)과
 * 함께 작동한다.
 *
 * IP 는 원문을 저장하지 않고 **해시만** 남긴다(개인정보 최소 수집).
 */
export const PUBLIC_FREE_DOWNLOADS_COLLECTION = 'public_free_downloads';

/** IP 당 하루 다운로드 허용 횟수 */
export const PUBLIC_FREE_DAILY_LIMIT = 5;

/** 한국 시간 기준 날짜 키 (YYYY-MM-DD) — 자정에 초기화된다 */
export function koreaDateKey(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function hashIp(ip: string): string {
  const salt = process.env.AUTH_SECRET || process.env.JWT_SECRET || 'next-order-free';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

/** 프록시를 거친 요청에서 클라이언트 IP 추정 */
export function clientIpOf(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for') ?? '';
  const first = fwd.split(',')[0]?.trim();
  return first || headers.get('x-real-ip') || 'unknown';
}

export type RateLimitVerdict = {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
};

/**
 * 다운로드 1회를 기록하고 허용 여부를 돌려준다.
 *
 * 상한을 넘으면 **증가시키지 않고** 거절한다(거절이 카운트를 더 올리면
 * 자정까지 영구 차단처럼 보인다).
 */
export async function consumeFreeDownload(db: Db, ip: string): Promise<RateLimitVerdict> {
  const col = db.collection(PUBLIC_FREE_DOWNLOADS_COLLECTION);
  const key = { ipHash: hashIp(ip), date: koreaDateKey() };

  const current = await col.findOne(key);
  const used = ((current?.count as number) ?? 0);
  if (used >= PUBLIC_FREE_DAILY_LIMIT) {
    return { allowed: false, used, limit: PUBLIC_FREE_DAILY_LIMIT, remaining: 0 };
  }

  const now = new Date();
  await col.updateOne(
    key,
    { $inc: { count: 1 }, $set: { updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
  /* 기록은 하루치만 의미가 있다. 30일 뒤 자동 파기(인덱스는 없으면 만든다). */
  await col.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }).catch(() => {});

  const nextUsed = used + 1;
  return {
    allowed: true,
    used: nextUsed,
    limit: PUBLIC_FREE_DAILY_LIMIT,
    remaining: Math.max(0, PUBLIC_FREE_DAILY_LIMIT - nextUsed),
  };
}
