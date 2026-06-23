'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PointChargeModal from '@/app/components/PointChargeModal';

interface MenuRow { id: string; label: string; paid: boolean; price: number; unlocked: boolean; requires: string[] }

/** 토스 customerKey (회원당 고유, 2~50자) — app/my/page.tsx 와 동일 규칙. */
function tossCustomerKeyFromLoginId(loginId: string): string {
  const raw = (loginId || 'member').replace(/[^a-zA-Z0-9._@-]/g, '_').slice(0, 44);
  return `u_${raw}`;
}

const MENU_DESC: Record<string, string> = {
  students: '학생·학교 명단 관리',
  attendance: 'QR·직접 출결 입력과 통계',
  exams: '시험 준비·기출 분석·예측, 학생 필기 사진',
  scores: '학생 성적 입력·관리',
  generate: '변형문제 시험지 자동 생성 (학생별·학교별·QR 채점)',
  questions: '변형문제 검색·내 문제은행',
  analysis: '시험별 유형·성적 분석',
  homework: '문제은행 문항을 학생에게 숙제로 배정·진행관리',
  review: 'QR 채점 오답 → 오답노트·약점 재시험 PDF',
  report: '학생별 성적 추이·석차·출석률 리포트(인쇄·PDF)',
  tuition: '월별 수강료 청구·수납 관리',
  counseling: '학생·학부모 상담 내용 기록·검색',
  lessons: '반별 수업 진도·과제 기록',
  'qbank-api': '내 문제은행을 외부에서 불러쓰는 API 키 발급',
};

/** 관계도 노드 위치 (viewBox 0 0 760 300) */
const NODE_POS: Record<string, { x: number; y: number }> = {
  questions: { x: 320, y: 26 },
  'qbank-api': { x: 560, y: 26 },
  students: { x: 205, y: 96 },
  exams: { x: 540, y: 96 },
  attendance: { x: 78, y: 200 },
  scores: { x: 300, y: 200 },
  generate: { x: 470, y: 200 },
  analysis: { x: 662, y: 200 },
  review: { x: 470, y: 272 },
};
const NODE_W = 108, NODE_H = 36;

function statusColor(m: MenuRow): { fill: string; stroke: string; text: string } {
  if (!m.paid) return { fill: '#0f2e22', stroke: '#10b981', text: '#a7f3d0' };       // 무료 emerald
  if (m.unlocked) return { fill: '#10243f', stroke: '#3b82f6', text: '#bfdbfe' };     // 보유 blue
  return { fill: '#2a210a', stroke: '#d97706', text: '#fcd34d' };                     // 잠금 amber
}

export default function VipMenuStorePage() {
  const [menus, setMenus] = useState<MenuRow[]>([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // 포인트 충전 모달
  const [chargeOpen, setChargeOpen] = useState(false);
  const [me, setMe] = useState<{ loginId: string; name: string; email: string } | null>(null);

  const load = useCallback(async () => {
    const d = await fetch('/api/my/vip/menus', { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setMenus(d.menus); setPoints(d.points); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json()).then((d) => {
      if (d.user) setMe({ loginId: d.user.loginId, name: d.user.name || d.user.loginId, email: d.user.email || '' });
    }).catch(() => {});
  }, []);

  const byId = useMemo(() => Object.fromEntries(menus.map((m) => [m.id, m])), [menus]);
  const labelOf = (id: string) => byId[id]?.label ?? id;

  const buy = async (m: MenuRow) => {
    // 함께 써야 하는 유료·미보유 의존 메뉴를 묶어 구매 유도
    const lockedDeps = (m.requires || []).map((id) => byId[id]).filter((d): d is MenuRow => !!d && d.paid && !d.unlocked);
    const bundle = [m, ...lockedDeps];
    const ids = bundle.map((b) => b.id);
    const total = bundle.reduce((s, b) => s + b.price, 0);
    const msg = lockedDeps.length
      ? `「${m.label}」은(는) ${lockedDeps.map((d) => `「${d.label}」`).join('·')}와(과) 함께 써야 합니다.\n\n${bundle.map((b) => `· ${b.label} ${b.price.toLocaleString()}P`).join('\n')}\n\n함께 구매할까요? (총 ${total.toLocaleString()}P)`
      : `「${m.label}」 메뉴를 ${m.price.toLocaleString()}P로 구매할까요?`;
    if (!confirm(msg)) return;
    setBusy(m.id);
    try {
      const res = await fetch('/api/my/vip/menus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ menuIds: ids }) });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '구매에 실패했습니다.'); setBusy(null); return; }
      window.location.reload();
    } catch { alert('구매 중 오류가 발생했습니다.'); setBusy(null); }
  };

  // 관계도 엣지 (A → A.requires)
  const edges = useMemo(() => {
    const out: { from: string; to: string }[] = [];
    for (const m of menus) for (const req of m.requires || []) if (NODE_POS[m.id] && NODE_POS[req]) out.push({ from: m.id, to: req });
    return out;
  }, [menus]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">메뉴 설정</h1>
          <p className="text-sm text-zinc-500 mt-0.5">필요한 메뉴를 구매하면 사이드바에 추가됩니다. 무료 메뉴는 항상 사용할 수 있어요.</p>
        </div>
        <button
          type="button"
          onClick={() => setChargeOpen(true)}
          title="포인트 충전하기"
          className="group px-4 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 hover:border-[#c9a44e]/50 hover:bg-zinc-900 text-sm transition-colors flex items-center gap-2"
        >
          <span>
            <span className="text-zinc-500">보유 포인트 </span>
            <span className="text-zinc-100 font-semibold">{points.toLocaleString()}P</span>
          </span>
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-[#c9a44e]/15 text-[#e8d48b] text-[11px] font-medium group-hover:bg-[#c9a44e]/25 transition-colors">
            <span className="text-sm leading-none">＋</span>충전
          </span>
        </button>
      </div>

      {/* 메뉴 관계도 */}
      {!loading && menus.length > 0 && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-medium text-zinc-300">메뉴 연결 관계도</h3>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />무료</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500/80 inline-block" />보유</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />잠금</span>
            </div>
          </div>
          <p className="text-[11px] text-zinc-600 mb-2">화살표는 「함께 필요」 방향 — A → B 는 A를 쓰려면 B가 필요함을 뜻합니다.</p>
          <svg viewBox="0 0 760 300" className="w-full" style={{ maxHeight: 380 }}>
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" fill="#71717a" />
              </marker>
            </defs>
            {edges.map((e, i) => {
              const a = NODE_POS[e.from], b = NODE_POS[e.to];
              // 노드 박스 가장자리에서 시작/끝 (단순히 중심 기준, 박스 절반만큼 줄임)
              const dx = b.x - a.x, dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len, uy = dy / len;
              const x1 = a.x + ux * (NODE_H / 2 + 4), y1 = a.y + uy * (NODE_H / 2 + 4);
              const x2 = b.x - ux * (NODE_W / 2 + 6), y2 = b.y - uy * (NODE_H / 2 + 6);
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#52525b" strokeWidth={1.3} markerEnd="url(#arrow)" opacity={0.85} />;
            })}
            {menus.filter((m) => NODE_POS[m.id]).map((m) => {
              const p = NODE_POS[m.id]; const c = statusColor(m);
              return (
                <g key={m.id}>
                  <rect x={p.x - NODE_W / 2} y={p.y - NODE_H / 2} width={NODE_W} height={NODE_H} rx={8} fill={c.fill} stroke={c.stroke} strokeWidth={1.3} />
                  <text x={p.x} y={p.y + 4.5} textAnchor="middle" fontSize={13} fontWeight={600} fill={c.text}>{m.label}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {menus.map((m) => {
            const owned = !m.paid || m.unlocked;
            const reqLabels = (m.requires || []).map(labelOf);
            return (
              <div key={m.id} className={`rounded-xl border p-5 ${owned ? 'bg-zinc-900/50 border-zinc-800/80' : 'bg-zinc-900/40 border-zinc-800/60'}`}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="text-sm font-semibold text-zinc-100">{m.label}</div>
                  {owned ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 flex-shrink-0">{m.paid ? '사용 중' : '무료'}</span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/20 flex-shrink-0">잠금</span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 mb-2">{MENU_DESC[m.id] ?? ''}</p>
                {reqLabels.length > 0 && (
                  <p className="text-[11px] text-amber-300/70 mb-2">함께 필요: {reqLabels.join(' · ')}</p>
                )}
                {owned ? (
                  <div className="text-xs text-zinc-600">사이드바에서 사용 가능</div>
                ) : (
                  <button onClick={() => buy(m)} disabled={busy !== null}
                    className="w-full py-2 rounded-xl bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40">
                    {busy === m.id ? '구매 중…' : `구매 · ${m.price.toLocaleString()}P`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-zinc-600">
        포인트가 부족하면 위 <span className="text-[#e8d48b]">보유 포인트</span>를 눌러 충전할 수 있어요. 구매한 메뉴는 영구적으로 사용할 수 있습니다.
      </p>

      {me && (
        <PointChargeModal
          open={chargeOpen}
          onClose={() => { setChargeOpen(false); load(); }}
          customerKey={tossCustomerKeyFromLoginId(me.loginId)}
          customerName={me.name}
          customerEmail={me.email}
        />
      )}
    </div>
  );
}
