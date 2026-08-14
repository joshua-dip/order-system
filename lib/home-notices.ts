/**
 * 홈 공지 — 관리자가 직접 쓰고 홈 상단 한 줄 배너로 노출한다.
 *
 * 팝업 모달(HomeNoticeModal)에 내용을 다 담기 어려워, 짧은 한 줄을 홈에 계속 띄우고
 * 누르면 상세를 보여 주는 방식으로 분리했다. 팝업은 팝업대로 유지된다.
 *
 * 본문은 **평문**으로만 저장·렌더한다(HTML 렌더 금지 — 관리자 입력이라도 XSS 여지를 두지 않는다).
 */
import type { Db, ObjectId } from 'mongodb';

export const HOME_NOTICE_COLLECTION = 'home_notices';

/** 누구에게 보일지 — 로그인 여부로 갈린다 */
export type HomeNoticeAudienceTarget = 'all' | 'guest' | 'member';

export interface HomeNoticeDoc {
  _id: ObjectId;
  /** 한 줄 배너에 나오는 문구 */
  title: string;
  /** 상세 모달 본문 (평문, 줄바꿈 유지) */
  body: string;
  /** 「이벤트」 「안내」 등 앞에 붙는 짧은 꼬리표 */
  badge?: string;
  /** 상세에서 이동할 링크 (선택) */
  linkUrl?: string;
  linkLabel?: string;
  audience: HomeNoticeAudienceTarget;
  active: boolean;
  /** 상단 고정 — 정렬에서 먼저 온다 */
  pinned: boolean;
  /** 같은 pinned 안에서의 정렬 (작을수록 먼저) */
  order: number;
  /** 게시 기간 (비우면 제한 없음) */
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

/** 화면으로 내보내는 형태 */
export interface HomeNoticePublic {
  id: string;
  title: string;
  body: string;
  badge: string;
  linkUrl: string;
  linkLabel: string;
}

export function toPublicNotice(d: HomeNoticeDoc): HomeNoticePublic {
  return {
    id: String(d._id),
    title: d.title,
    body: d.body,
    badge: d.badge ?? '',
    linkUrl: d.linkUrl ?? '',
    linkLabel: d.linkLabel ?? '',
  };
}

/** 지금 이 사용자에게 보여 줄 공지 (게시 기간·대상·활성 필터 + 정렬) */
export async function listVisibleHomeNotices(db: Db, isMember: boolean): Promise<HomeNoticePublic[]> {
  const now = new Date();
  const docs = (await db
    .collection(HOME_NOTICE_COLLECTION)
    .find({
      active: true,
      audience: { $in: ['all', isMember ? 'member' : 'guest'] },
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    })
    .sort({ pinned: -1, order: 1, createdAt: -1 })
    .limit(20)
    .toArray()) as unknown as HomeNoticeDoc[];
  return docs.map(toPublicNotice);
}

export async function ensureHomeNoticeIndexes(db: Db): Promise<void> {
  await db
    .collection(HOME_NOTICE_COLLECTION)
    .createIndex({ active: 1, audience: 1, pinned: -1, order: 1 })
    .catch(() => {});
}

/** 관리자 입력 정규화 — 빈 문자열은 저장하지 않고, 길이를 잘라 둔다 */
export function normalizeNoticeInput(raw: Record<string, unknown>) {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const date = (v: unknown): Date | null => {
    if (typeof v !== 'string' || !v.trim()) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const audience = raw.audience;
  return {
    title: str(raw.title, 200),
    body: str(raw.body, 5000),
    badge: str(raw.badge, 20),
    linkUrl: str(raw.linkUrl, 500),
    linkLabel: str(raw.linkLabel, 40),
    audience: (audience === 'guest' || audience === 'member' ? audience : 'all') as HomeNoticeAudienceTarget,
    active: raw.active !== false,
    pinned: raw.pinned === true,
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 0,
    startsAt: date(raw.startsAt),
    endsAt: date(raw.endsAt),
  };
}

/**
 * 링크는 내부 경로이거나 http(s) 만 허용한다.
 * (javascript: 같은 스킴이 관리자 실수로라도 들어가면 클릭 시 실행되므로 막는다)
 */
export function isSafeNoticeLink(url: string): boolean {
  if (!url) return true;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  return /^https?:\/\//i.test(url);
}
