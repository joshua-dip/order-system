import type { Db } from 'mongodb';
import { koreaDateKey } from '@/lib/korea-date-key';
import { SITE_EVENTS_COLLECTION, USAGE_EVENT_LABEL, usageMenuLabel } from '@/lib/site-usage';

function daysAgoKey(days: number): string {
  return koreaDateKey(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

/** 회원 한 명의 최근 기록(최대 500건) */
export async function getMemberUsage(db: Db, loginId: string, days: number) {
  const from = daysAgoKey(days - 1);
  const col = db.collection(SITE_EVENTS_COLLECTION);
  const rows = await col
    .find({ loginId, date: { $gte: from } }, { projection: { _id: 0, ts: 1, type: 1, name: 1, path: 1, menu: 1, props: 1 } })
    .sort({ ts: -1 })
    .limit(500)
    .toArray();
  const user = await db.collection('users').findOne({ loginId }, { projection: { name: 1, email: 1, role: 1 } });
  return {
    ok: true,
    member: { loginId, name: user?.name ?? '', role: user?.role ?? '' },
    events: rows.map((r) => ({
      ts: r.ts,
      type: r.type,
      label: r.type === 'event' ? USAGE_EVENT_LABEL[r.name] ?? r.name : usageMenuLabel(r.menu).label,
      path: r.path,
      props: r.props ?? null,
    })),
  };
}

/** 기간 사용 기록 분석 */
export async function getUsageReport(db: Db, opts: { days: number; includeAdmin: boolean }) {
  const { days, includeAdmin } = opts;
  const from = daysAgoKey(days - 1);
  const col = db.collection(SITE_EVENTS_COLLECTION);
  const base: Record<string, unknown> = { date: { $gte: from } };
  if (!includeAdmin) base.role = { $ne: 'admin' };

  const pv = { ...base, type: 'pageview' };
  const [summary, menus, daily, events, refs, members, hours, solbookTop, downloads, signupPages] = await Promise.all([
    col
      .aggregate([
        { $match: base },
        {
          $group: {
            _id: null,
            pageviews: { $sum: { $cond: [{ $eq: ['$type', 'pageview'] }, 1, 0] } },
            events: { $sum: { $cond: [{ $eq: ['$type', 'event'] }, 1, 0] } },
            visitors: { $addToSet: '$visitorId' },
            members: { $addToSet: '$loginId' },
          },
        },
        { $project: { _id: 0, pageviews: 1, events: 1, visitors: { $size: '$visitors' }, members: { $size: { $setDifference: ['$members', [null]] } } } },
      ])
      .toArray(),
    col
      .aggregate([
        { $match: pv },
        { $group: { _id: '$menu', pageviews: { $sum: 1 }, visitors: { $addToSet: '$visitorId' }, members: { $addToSet: '$loginId' } } },
        { $project: { pageviews: 1, visitors: { $size: '$visitors' }, members: { $size: { $setDifference: ['$members', [null]] } } } },
        { $sort: { pageviews: -1 } },
      ])
      .toArray(),
    col
      .aggregate([
        { $match: pv },
        { $group: { _id: '$date', pageviews: { $sum: 1 }, visitors: { $addToSet: '$visitorId' }, members: { $addToSet: '$loginId' } } },
        { $project: { pageviews: 1, visitors: { $size: '$visitors' }, members: { $size: { $setDifference: ['$members', [null]] } } } },
        { $sort: { _id: -1 } },
      ])
      .toArray(),
    col
      .aggregate([
        { $match: { ...base, type: 'event' } },
        { $group: { _id: '$name', count: { $sum: 1 }, visitors: { $addToSet: '$visitorId' } } },
        { $project: { count: 1, visitors: { $size: '$visitors' } } },
        { $sort: { count: -1 } },
      ])
      .toArray(),
    col
      .aggregate([
        { $match: { ...pv, refHost: { $exists: true } } },
        { $group: { _id: '$refHost', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
      ])
      .toArray(),
    col
      .aggregate([
        { $match: { ...base, loginId: { $exists: true } } },
        {
          $group: {
            _id: { loginId: '$loginId', menu: '$menu' },
            n: { $sum: 1 },
            last: { $max: '$ts' },
            days: { $addToSet: '$date' },
            role: { $first: '$role' },
          },
        },
        { $sort: { n: -1 } },
        {
          $group: {
            _id: '$_id.loginId',
            total: { $sum: '$n' },
            last: { $max: '$last' },
            days: { $push: '$days' },
            role: { $first: '$role' },
            menus: { $push: { menu: '$_id.menu', n: '$n' } },
          },
        },
        { $sort: { total: -1 } },
        { $limit: 300 },
      ])
      .toArray(),
    col
      .aggregate([
        { $match: pv },
        { $group: { _id: { $hour: { date: '$ts', timezone: 'Asia/Seoul' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    col
      .aggregate([
        { $match: { ...base, type: 'event', name: 'solbook_product_click' } },
        { $group: { _id: '$props.productId', title: { $first: '$props.title' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ])
      .toArray(),
    /* 파일 다운로드 — 종류별 */
    col
      .aggregate([
        { $match: { ...base, type: 'event', name: 'file_download' } },
        { $group: { _id: '$props.kind', count: { $sum: 1 }, visitors: { $addToSet: '$visitorId' }, members: { $addToSet: '$loginId' } } },
        { $project: { count: 1, visitors: { $size: '$visitors' }, members: { $size: { $setDifference: ['$members', [null]] } } } },
        { $sort: { count: -1 } },
      ])
      .toArray(),
    /* 가입 신청 — 어느 화면에서 열었고 얼마나 신청까지 갔는지 */
    col
      .aggregate([
        { $match: { ...base, type: 'event', name: { $in: ['signup_open', 'signup_submit'] } } },
        { $group: { _id: { menu: '$menu', name: '$name' }, count: { $sum: 1 }, visitors: { $addToSet: '$visitorId' } } },
        { $project: { count: 1, visitors: { $size: '$visitors' } } },
      ])
      .toArray(),
  ]);

  const signupByMenu = new Map<string, { opens: number; openVisitors: number; submits: number }>();
  for (const r of signupPages) {
    const k = String(r._id.menu);
    const row = signupByMenu.get(k) ?? { opens: 0, openVisitors: 0, submits: 0 };
    if (r._id.name === 'signup_open') {
      row.opens += r.count;
      row.openVisitors += r.visitors;
    } else row.submits += r.count;
    signupByMenu.set(k, row);
  }
  const signup = {
    opens: [...signupByMenu.values()].reduce((n, r) => n + r.opens, 0),
    openVisitors: [...signupByMenu.values()].reduce((n, r) => n + r.openVisitors, 0),
    submits: [...signupByMenu.values()].reduce((n, r) => n + r.submits, 0),
    byMenu: [...signupByMenu.entries()]
      .map(([menu, r]) => ({ menu, label: usageMenuLabel(menu).label, ...r }))
      .sort((a, b) => b.opens - a.opens),
  };

  const ids = members.map((m) => String(m._id));
  const users = ids.length
    ? await db.collection('users').find({ loginId: { $in: ids } }, { projection: { loginId: 1, name: 1 } }).toArray()
    : [];
  const nameOf = new Map(users.map((u) => [String(u.loginId), String(u.name ?? '')]));

  return {
    ok: true,
    days,
    from,
    includeAdmin,
    summary: summary[0] ?? { pageviews: 0, events: 0, visitors: 0, members: 0 },
    menus: menus.map((m) => ({ key: m._id, ...usageMenuLabel(String(m._id)), pageviews: m.pageviews, visitors: m.visitors, members: m.members })),
    daily: daily.map((d) => ({ date: d._id, pageviews: d.pageviews, visitors: d.visitors, members: d.members })),
    events: events.map((e) => ({ name: e._id, label: USAGE_EVENT_LABEL[e._id] ?? e._id, count: e.count, visitors: e.visitors })),
    referrers: refs.map((r) => ({ host: r._id, count: r.count })),
    hours: hours.map((h) => ({ hour: h._id, count: h.count })),
    solbookTop: solbookTop.map((s) => ({ productId: s._id, title: s.title ?? '', count: s.count })),
    downloads: downloads.map((d) => ({ kind: d._id ?? '(미상)', count: d.count, visitors: d.visitors, members: d.members })),
    signup,
    members: members.map((m) => ({
      loginId: String(m._id),
      name: nameOf.get(String(m._id)) ?? '',
      role: m.role ?? '',
      total: m.total,
      last: m.last,
      activeDays: new Set((m.days as string[][]).flat()).size,
      topMenus: (m.menus as { menu: string; n: number }[]).slice(0, 4).map((x) => ({ label: usageMenuLabel(x.menu).label, n: x.n })),
    })),
  };
}
