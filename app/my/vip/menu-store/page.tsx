'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PointChargeModal from '@/app/components/PointChargeModal';

interface MenuRow { id: string; label: string; paid: boolean; price: number; unlocked: boolean; requires: string[]; published: boolean; purchasable: boolean }

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
  review: '오답노트 — 영어(QR 자동 오답·약점 재시험 PDF) + 국어·수학(수동 기록)',
  report: '학생별 성적 추이·석차·출석률 리포트(인쇄·PDF)',
  tuition: '월별 수강료 청구·수납 관리',
  counseling: '상담 예약(예정)·기록(완료)·다음 계획 관리',
  lessons: '반별 수업 진도·과제 기록',
  videos: '강의영상 링크(YouTube·Vimeo) 강좌·회차별 정리·재생',
  materials: '특강·문법·리딩 교재를 블록으로 만들고 인쇄·PDF 출력',
  words: '단어장 만들고 단어장·영↔한 단어시험지 인쇄·PDF',
  assessments: '학교 수행평가 일정·유형·마감일·진행상태 관리',
  forms: '학원 문서 양식(동의서·안내문 등) 작성·보관·인쇄',
  inventory: '교재·물품 재고 수량 관리, 최소수량 부족 경고',
  expenses: '학원 운영비 지출 기록·분류, 월별 합계',
  academy: '학원/교습소 기본 정보(등록번호·주소·연락처 등)',
  'school-info': '학생들 학교 정보(급·연락처·시험일정) 관리',
  payroll: '직원·강사 급여(기본급·수당·공제) 월별 관리',
  admissions: '학생별 입시(대학·전형·지원/합불) 현황 관리',
  schedule: '학원 일정(수업·시험·상담·행사) 달력·관리',
  memo: '간단한 메모·할 일 기록(고정·검색)',
  writing: '영작 주제 출제 → 학생 영작 제출 → 직접 첨삭·피드백·점수',
  dictionary: '영단어 뜻·발음·예문 검색 (무료 사전)',
  'qbank-api': '내 문제은행을 외부에서 불러쓰는 API 키 발급',
  tutoring: '과외솔루션 — 학생별 요일·시간 수업을 주간 시간표로 관리(시간표관리)',
};

/** 상위 층 노드를 요구 노드들의 평균 x(무게중심)로 정렬해 엣지 교차를 줄임. */
function bary(id: string, pos: Record<string, { x: number; y: number }>, reqOf: (id: string) => string[], W: number): number {
  const rs = reqOf(id).filter((r) => pos[r]);
  return rs.length ? rs.reduce((s, r) => s + pos[r].x, 0) / rs.length : W / 2;
}

/** 관계도 노드 색 — 전부 「보유(파랑)」 톤으로 통일. */
const DIAGRAM_NODE = { fill: '#10243f', stroke: '#3b82f6', text: '#bfdbfe' };

interface DiagramData {
  pos: Record<string, { x: number; y: number }>;
  edges: { from: string; to: string }[];
  W: number; H: number; NODE_W: number; NODE_H: number; dividerY: number | null;
}

/** 관계도 SVG (인라인·확대 모달 공용). */
function MenuDiagram({ diagram, menus, maxH }: { diagram: DiagramData; menus: MenuRow[]; maxH: number | string }) {
  return (
    <svg viewBox={`0 0 ${diagram.W} ${diagram.H}`} className="w-full" style={{ maxHeight: maxH }}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#71717a" />
        </marker>
      </defs>
      {diagram.dividerY != null && (
        <>
          <line x1={20} y1={diagram.dividerY} x2={diagram.W - 20} y2={diagram.dividerY} stroke="#3f3f46" strokeWidth={1} strokeDasharray="5 5" />
          <text x={24} y={diagram.dividerY - 6} fontSize={11} fill="#71717a">↑ 독립 메뉴 (단독 사용)</text>
        </>
      )}
      {diagram.edges.map((e, i) => {
        const a = diagram.pos[e.from], b = diagram.pos[e.to];
        if (!a || !b) return null;
        const dx = b.x - a.x, dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const x1 = a.x + ux * (diagram.NODE_H / 2 + 4), y1 = a.y + uy * (diagram.NODE_H / 2 + 4);
        const x2 = b.x - ux * (diagram.NODE_H / 2 + 8), y2 = b.y - uy * (diagram.NODE_H / 2 + 8);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#52525b" strokeWidth={1.3} markerEnd="url(#arrow)" opacity={0.85} />;
      })}
      {menus.filter((m) => diagram.pos[m.id]).map((m) => {
        const p = diagram.pos[m.id];
        return (
          <g key={m.id}>
            <rect x={p.x - diagram.NODE_W / 2} y={p.y - diagram.NODE_H / 2} width={diagram.NODE_W} height={diagram.NODE_H} rx={8} fill={DIAGRAM_NODE.fill} stroke={DIAGRAM_NODE.stroke} strokeWidth={1.3} />
            <text x={p.x} y={p.y + 4.5} textAnchor="middle" fontSize={13} fontWeight={600} fill={DIAGRAM_NODE.text}>{m.label}</text>
          </g>
        );
      })}
    </svg>
  );
}


export default function VipMenuStorePage() {
  const [menus, setMenus] = useState<MenuRow[]>([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // 결제 모달 — 포인트 충전 / VIP 월 구독 공용
  const [chargeOpen, setChargeOpen] = useState(false);
  const [chargePurpose, setChargePurpose] = useState<'points' | 'vip_subscription'>('points');
  const [me, setMe] = useState<{ loginId: string; name: string; email: string } | null>(null);
  // 월 구독 상태
  const [sub, setSub] = useState<{ active: boolean; until: string | null; monthlyWon: number }>({ active: false, until: null, monthlyWon: 175000 });
  const [diagramOpen, setDiagramOpen] = useState(false);

  const load = useCallback(async () => {
    const d = await fetch('/api/my/vip/menus', { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setMenus(d.menus); setPoints(d.points); if (d.subscription) setSub(d.subscription); }
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

  // 관계도 자동 레이아웃 — 의존관계 메뉴는 깊이별 층으로, 독립 메뉴는 맨 위 별도 행에 배치(전 메뉴 표시).
  const diagram = useMemo(() => {
    if (menus.length === 0) return null;
    const map: Record<string, MenuRow> = Object.fromEntries(menus.map((m) => [m.id, m]));
    const ids = new Set(menus.map((m) => m.id));
    const reqOf = (id: string) => (map[id]?.requires || []).filter((r) => ids.has(r) && r !== id);

    // 참여(의존) 노드 = 자신이 무언가를 요구하거나, 누군가에게 요구되는 메뉴
    const part = new Set<string>();
    for (const m of menus) { const rs = reqOf(m.id); if (rs.length) { part.add(m.id); rs.forEach((r) => part.add(r)); } }
    const partIds = menus.map((m) => m.id).filter((id) => part.has(id));

    // 깊이 = 요구 체인의 최대 길이 (root = 0)
    const dcache: Record<string, number> = {};
    const depth = (id: string, stack: Set<string> = new Set()): number => {
      if (dcache[id] != null) return dcache[id];
      if (stack.has(id)) return 0;
      stack.add(id);
      const rs = reqOf(id);
      const d = rs.length ? 1 + Math.max(...rs.map((r) => depth(r, stack))) : 0;
      stack.delete(id);
      dcache[id] = d;
      return d;
    };
    const maxD = partIds.length ? Math.max(...partIds.map((id) => depth(id))) : -1;
    const depLayers: string[][] = Array.from({ length: maxD + 1 }, () => []);
    partIds.forEach((id) => depLayers[depth(id)].push(id));

    // 독립 메뉴(의존관계 없음) — 균형있게 여러 행으로 wrap
    const standalone = menus.map((m) => m.id).filter((id) => !part.has(id));
    const widestDep = depLayers.length ? Math.max(1, ...depLayers.map((l) => l.length)) : 1;
    const perRow = Math.max(widestDep, 5);
    const stdNumRows = standalone.length ? Math.ceil(standalone.length / perRow) : 0;
    const stdPer = stdNumRows ? Math.ceil(standalone.length / stdNumRows) : 0;
    const stdRows: string[][] = [];
    for (let i = 0; i < standalone.length; i += stdPer || 1) stdRows.push(standalone.slice(i, i + (stdPer || 1)));

    // 행: 아래(=root, 기반 메뉴) → 위(의존 메뉴) → 맨 위(독립 메뉴)
    const rows = [...depLayers, ...stdRows];
    if (rows.length === 0) return null;

    const NODE_W = 104, NODE_H = 34, GAP_Y = 80, PAD = 28;
    const widest = Math.max(1, ...rows.map((r) => r.length));
    const W = Math.max(720, widest * (NODE_W + 24) + PAD * 2);
    const H = PAD * 2 + (rows.length - 1) * GAP_Y + NODE_H;
    const pos: Record<string, { x: number; y: number }> = {};
    rows.forEach((row, ri) => {
      const y = H - PAD - NODE_H / 2 - ri * GAP_Y;
      // 의존 층(1..maxD)만 무게중심 정렬, root/독립 행은 그대로.
      const ordered = ri >= 1 && ri <= maxD ? [...row].sort((a, b) => bary(a, pos, reqOf, W) - bary(b, pos, reqOf, W)) : row;
      const slot = W / (ordered.length + 1);
      ordered.forEach((id, i) => { pos[id] = { x: slot * (i + 1), y }; });
    });
    const edges: { from: string; to: string }[] = [];
    for (const id of partIds) for (const r of reqOf(id)) edges.push({ from: id, to: r });
    // 독립 메뉴 구분선 (의존 최상단 행과 독립 첫 행 사이)
    const dividerY = stdRows.length && maxD >= 0 ? H - PAD - NODE_H / 2 - maxD * GAP_Y - GAP_Y / 2 : null;
    return { pos, edges, W, H, NODE_W, NODE_H, dividerY };
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
          onClick={() => { setChargePurpose('points'); setChargeOpen(true); }}
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

      {/* VIP 월 구독 (수동 갱신) */}
      <div className={`rounded-xl border p-4 flex items-center justify-between gap-3 flex-wrap ${sub.active ? 'bg-emerald-950/20 border-emerald-800/50' : 'bg-[#c9a44e]/10 border-[#c9a44e]/30'}`}>
        <div>
          <div className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            VIP 월 구독
            {sub.active
              ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">이용 중</span>
              : <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#c9a44e]/20 text-[#e8d48b]">미구독</span>}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            {sub.active && sub.until
              ? `${new Date(sub.until).toLocaleDateString('ko-KR')} 까지 전 메뉴 사용 중 · 매월 직접 결제로 갱신`
              : `월 ${sub.monthlyWon.toLocaleString()}원으로 VIP 메뉴 전체 사용 (자동결제 아님 · 매월 직접 결제)`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setChargePurpose('vip_subscription'); setChargeOpen(true); }}
          className="px-4 py-2 rounded-xl bg-[#c9a44e]/20 text-[#e8d48b] text-sm font-medium hover:bg-[#c9a44e]/30 transition-colors shrink-0"
        >
          {sub.active ? '한 달 연장' : `구독하기 · 월 ${sub.monthlyWon.toLocaleString()}원`}
        </button>
      </div>

      {/* 메뉴 관계도 */}
      {!loading && diagram && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-sm font-medium text-zinc-300">메뉴 연결 관계도</h3>
            <button onClick={() => setDiagramOpen(true)} title="크게 보기" className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-300 text-[11px] hover:bg-zinc-700 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
              확대
            </button>
          </div>
          <p className="text-[11px] text-zinc-600 mb-2">화살표는 「함께 필요」 방향 — A → B 는 A를 쓰려면 B가 필요함을 뜻합니다. 화살표 없는 메뉴는 단독으로 쓸 수 있어요.</p>
          <MenuDiagram diagram={diagram} menus={menus} maxH={420} />
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
                  ) : m.purchasable ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/20 flex-shrink-0">잠금</span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-600/30 text-zinc-400 border border-zinc-600/30 flex-shrink-0">준비 중</span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 mb-2">{MENU_DESC[m.id] ?? ''}</p>
                {reqLabels.length > 0 && (
                  <p className="text-[11px] text-amber-300/70 mb-2">함께 필요: {reqLabels.join(' · ')}</p>
                )}
                {owned ? (
                  <div className="text-xs text-zinc-600">사이드바에서 사용 가능</div>
                ) : m.purchasable ? (
                  <button onClick={() => buy(m)} disabled={busy !== null}
                    className="w-full py-2 rounded-xl bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40">
                    {busy === m.id ? '구매 중…' : `구매 · ${m.price.toLocaleString()}P`}
                  </button>
                ) : (
                  <div className="w-full py-2 rounded-xl bg-zinc-800/50 text-zinc-500 text-sm text-center">아직 공개되지 않은 메뉴입니다</div>
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
          purpose={chargePurpose}
          subscriptionWon={sub.monthlyWon}
        />
      )}

      {/* 관계도 확대 모달 */}
      {diagramOpen && diagram && (
        <div onClick={() => setDiagramOpen(false)} className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-6xl max-h-[92vh] overflow-auto rounded-2xl bg-zinc-950 border border-zinc-800 p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-base font-semibold text-zinc-100">메뉴 연결 관계도</h3>
              <button onClick={() => setDiagramOpen(false)} className="text-zinc-400 hover:text-zinc-100 text-xl leading-none px-1">✕</button>
            </div>
            <p className="text-[12px] text-zinc-500 mb-3">화살표는 「함께 필요」 방향 — A → B 는 A를 쓰려면 B가 필요함을 뜻합니다. 화살표 없는 메뉴는 단독으로 쓸 수 있어요.</p>
            <MenuDiagram diagram={diagram} menus={menus} maxH="80vh" />
          </div>
        </div>
      )}
    </div>
  );
}
