'use client';

/**
 * 학습 플랜 — 시험범위를 정한 회원이 「지문마다 어떤 순서로 공부할지」를 정하고 진도를 체크한다.
 *   · 기본 플랜: 단계(구조화 → 문장분석 → …)와 단계별 활동. 처음엔 관리자 기본 설계, 고치면 내 플랜.
 *   · 진도판: 시험범위 하나를 고르면 지문 × 단계 진도. 활동을 누르면 클래스키트 화면이 그 지문으로 열린다.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppBar from '@/app/components/AppBar';
import type { ScopePassage, StudyActivity, StudyPlan, StudyStep } from '@/lib/study-plan';
import { FREE_VARIANT_TYPES } from '@/lib/variant-pricing';

type ScopeOption = { key: string; label: string; sub: string };
type Board = { scope: { key: string; label: string }; passages: ScopePassage[]; progress: Record<string, string[]> };

const CLASS_KIT_BASE = '/class-kit';
const LAST_SCOPE_KEY = 'study_plan_last_scope';
const FREE = new Set<string>(FREE_VARIANT_TYPES);

const STEP_TONES = ['bg-emerald-600', 'bg-sky-600', 'bg-amber-500', 'bg-rose-600', 'bg-violet-600', 'bg-cyan-600', 'bg-fuchsia-600', 'bg-slate-600'];
const tone = (i: number) => STEP_TONES[i % STEP_TONES.length];

/** 회원이 이 활동을 클래스키트에서 바로 열 수 있나 — 모의고사 지문만, 문항은 무료 유형만 */
function activityHref(a: StudyActivity | undefined, p: ScopePassage): string | null {
  if (!a || !p.isMock) return null;
  if (a.qtype && !FREE.has(a.qtype)) return null;
  const q = new URLSearchParams({ passage: p.id, ...(a.qtype ? { qtype: a.qtype } : {}) });
  return `${CLASS_KIT_BASE}${a.path}?${q}`;
}

function PlanColumns({
  plan,
  activities,
  editing,
  onChange,
}: {
  plan: StudyPlan;
  activities: StudyActivity[];
  editing: boolean;
  onChange: (p: StudyPlan) => void;
}) {
  const label = (k: string) => activities.find((a) => a.key === k)?.label ?? k;
  const setStep = (i: number, patch: Partial<StudyStep>) =>
    onChange({ ...plan, steps: plan.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= plan.steps.length) return;
    const steps = [...plan.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    onChange({ ...plan, steps });
  };

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex items-start gap-3">
        {plan.steps.map((s, i) => (
          <div key={s.id} className="w-52 shrink-0 rounded-xl border border-[#e2e8f0] bg-white p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${tone(i)}`}>{i + 1}</span>
              {editing ? (
                <input
                  value={s.title}
                  maxLength={20}
                  onChange={(e) => setStep(i, { title: e.target.value })}
                  className="min-w-0 flex-1 rounded border border-[#cbd5e1] px-1.5 py-0.5 text-sm font-bold"
                />
              ) : (
                <span className="flex-1 truncate text-sm font-bold text-[#0f172a]">{s.title}</span>
              )}
              <span className="text-xs text-[#94a3b8]">{s.items.length}</span>
            </div>
            <ul className="space-y-1.5">
              {s.items.map((k, n) => (
                <li key={k} className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] px-2 py-1.5 text-[13px] text-[#334155]">
                  <span className="w-4 text-[11px] text-[#94a3b8]">{n + 1}</span>
                  <span className="flex-1 truncate">{label(k)}</span>
                  {editing ? (
                    <button type="button" onClick={() => setStep(i, { items: s.items.filter((x) => x !== k) })} className="text-[#94a3b8] hover:text-rose-600" aria-label="활동 빼기">
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {editing ? (
              <div className="mt-2 space-y-1.5">
                <select
                  value=""
                  onChange={(e) => e.target.value && setStep(i, { items: [...s.items, e.target.value] })}
                  className="w-full rounded-lg border border-dashed border-[#cbd5e1] bg-white px-2 py-1.5 text-xs text-[#475569]"
                >
                  <option value="">+ 활동 넣기</option>
                  {activities
                    .filter((a) => !s.items.includes(a.key))
                    .map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label}
                      </option>
                    ))}
                </select>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded px-1.5 py-0.5 text-[#475569] hover:bg-[#f1f5f9] disabled:opacity-30" aria-label="앞으로">
                      ←
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === plan.steps.length - 1} className="rounded px-1.5 py-0.5 text-[#475569] hover:bg-[#f1f5f9] disabled:opacity-30" aria-label="뒤로">
                      →
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange({ ...plan, steps: plan.steps.filter((_, j) => j !== i) })}
                    className="rounded px-1.5 py-0.5 text-rose-600 hover:bg-rose-50"
                  >
                    단계 삭제
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
        {editing ? (
          <button
            type="button"
            onClick={() =>
              onChange({
                ...plan,
                steps: [...plan.steps, { id: `s${Date.now().toString(36).slice(-5)}`, title: `${plan.steps.length + 1}단계`, items: [] }],
              })
            }
            className="w-40 shrink-0 rounded-xl border-2 border-dashed border-[#cbd5e1] text-sm font-semibold text-[#64748b] hover:border-[#2563eb] hover:text-[#2563eb]"
          >
            + 단계 추가
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function StudyPlanPage() {
  const [authState, setAuthState] = useState<'loading' | 'in' | 'out'>('loading');
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [isAdminDefault, setIsAdminDefault] = useState(true);
  const [activities, setActivities] = useState<StudyActivity[]>([]);
  const [draft, setDraft] = useState<StudyPlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [scopeKey, setScopeKey] = useState('');
  const [board, setBoard] = useState<Board | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(''), 2500);
  };

  useEffect(() => {
    fetch('/api/my/study-plan', { credentials: 'include' })
      .then(async (r) => {
        if (r.status === 401) return setAuthState('out');
        const d = await r.json();
        setPlan(d.plan);
        setIsAdminDefault(!!d.isAdminDefault);
        setActivities(d.activities ?? []);
        setAuthState('in');
      })
      .catch(() => setAuthState('out'));
  }, []);

  // 내 시험범위 목록 — 저장한 범위 + 학교별 학기 범위
  useEffect(() => {
    if (authState !== 'in') return;
    Promise.all([
      fetch('/api/my/exam-scope', { credentials: 'include' }).then((r) => (r.ok ? r.json() : { presets: [] })),
      fetch('/api/my/school-exam-scopes', { credentials: 'include' }).then((r) => (r.ok ? r.json() : { slots: [] })),
    ])
      .then(([a, b]) => {
        const count = (entries: { selectedSources?: unknown[] }[]) =>
          (entries ?? []).reduce((n, e) => n + (Array.isArray(e.selectedSources) ? e.selectedSources.length : 0), 0);
        const opts: ScopeOption[] = [
          ...(b.slots ?? []).map((s: { id: string; schoolName: string; schoolYear: string; semester: string; dbEntries: [] }) => ({
            key: `school:${s.id}`,
            label: [s.schoolName, s.schoolYear, s.semester].filter(Boolean).join(' · '),
            sub: `학교 범위 · 지문 ${count(s.dbEntries)}개`,
          })),
          ...(a.presets ?? []).map((p: { id: string; name: string; dbEntries: [] }) => ({
            key: `preset:${p.id}`,
            label: p.name,
            sub: `저장한 범위 · 지문 ${count(p.dbEntries)}개`,
          })),
        ];
        setScopes(opts);
        let last = '';
        try {
          last = localStorage.getItem(LAST_SCOPE_KEY) ?? '';
        } catch {
          /* ignore */
        }
        setScopeKey(opts.some((o) => o.key === last) ? last : (opts[0]?.key ?? ''));
      })
      .catch(() => {});
  }, [authState]);

  const loadBoard = useCallback((key: string) => {
    if (!key) return;
    setBoardLoading(true);
    fetch(`/api/my/study-plan/board?scope=${encodeURIComponent(key)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBoard(d))
      .finally(() => setBoardLoading(false));
  }, []);

  useEffect(() => {
    if (!scopeKey) return;
    try {
      localStorage.setItem(LAST_SCOPE_KEY, scopeKey);
    } catch {
      /* ignore */
    }
    loadBoard(scopeKey);
  }, [scopeKey, loadBoard]);

  const shownPlan = draft ?? plan;
  const allItems = useMemo(() => (plan?.steps ?? []).flatMap((s) => s.items), [plan]);

  const toggleDone = async (passageId: string, itemKey: string, done: boolean) => {
    if (!board) return;
    // 먼저 화면에 반영하고, 실패하면 되돌린다
    const prev = board.progress[passageId] ?? [];
    const next = done ? [...new Set([...prev, itemKey])] : prev.filter((k) => k !== itemKey);
    setBoard({ ...board, progress: { ...board.progress, [passageId]: next } });
    const r = await fetch('/api/my/study-plan/progress', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: board.scope.key, passageId, itemKey, done }),
    }).catch(() => null);
    if (!r?.ok) {
      setBoard((b) => (b ? { ...b, progress: { ...b.progress, [passageId]: prev } } : b));
      flash('저장하지 못했어요. 다시 눌러 주세요.');
    }
  };

  const savePlan = async () => {
    if (!draft) return;
    setSaving(true);
    const r = await fetch('/api/my/study-plan', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: draft }),
    }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    setSaving(false);
    if (!r?.ok) return flash(d?.error || '저장하지 못했어요.');
    setPlan(d.plan);
    setIsAdminDefault(false);
    setDraft(null);
    flash('내 기본 플랜으로 저장했어요.');
  };

  const resetPlan = async () => {
    const r = await fetch('/api/my/study-plan', { method: 'DELETE', credentials: 'include' }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    if (r?.ok) {
      setPlan(d.plan);
      setIsAdminDefault(true);
      setDraft(null);
      flash('관리자 기본 설계로 되돌렸어요.');
    }
  };

  const totalPct = useMemo(() => {
    if (!board || !allItems.length || !board.passages.length) return 0;
    const done = board.passages.reduce((n, p) => n + (board.progress[p.id] ?? []).filter((k) => allItems.includes(k)).length, 0);
    return Math.round((done / (allItems.length * board.passages.length)) * 100);
  }, [board, allItems]);

  return (
    <>
      <AppBar title="학습 플랜" />
      <div className="min-h-screen bg-[#f8fafc] pb-28">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-5">
          {authState === 'loading' ? (
            <div className="flex justify-center py-24">
              <div className="h-9 w-9 animate-spin rounded-full border-4 border-[#2563eb] border-t-transparent" />
            </div>
          ) : authState === 'out' ? (
            <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center">
              <p className="mb-5 text-sm text-[#475569]">학습 플랜은 로그인 후 이용할 수 있어요.</p>
              <Link href="/login?from=/my/study-plan" className="inline-flex rounded-xl bg-[#2563eb] px-5 py-3 text-sm font-bold text-white no-underline">
                로그인하러 가기
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              {msg ? (
                <div className="fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-full bg-[#0f172a] px-4 py-2 text-sm text-white shadow-lg">{msg}</div>
              ) : null}

              {isAdminDefault && !draft ? (
                <div className="rounded-2xl border-2 border-[#2563eb] bg-white px-5 py-4">
                  <p className="font-bold text-[#0f172a]">다음 할 일 — 지문마다 따라갈 기본 순서를 하나 정해요</p>
                  <p className="mt-1 text-sm text-[#475569]">
                    지금은 <b>관리자 기본 설계</b>가 적용돼 있어요. 「내 기본 플랜으로 고치기」를 누르면 이 설계를 복사해 그 자리에서 고칠 수 있어요.
                  </p>
                </div>
              ) : null}

              <section className="rounded-2xl border border-[#e2e8f0] bg-[#f1f5f9] p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-[#0f172a]">기본 플랜</h2>
                  <span className="text-xs text-[#64748b]">
                    {draft ? '고치는 중' : isAdminDefault ? '🔒 관리자 기본 설계 · 7단계' : plan?.name}
                  </span>
                  <div className="flex-1" />
                  {draft ? (
                    <>
                      <button type="button" onClick={() => setDraft(null)} className="rounded-lg px-3 py-1.5 text-sm text-[#475569] hover:bg-white">
                        취소
                      </button>
                      <button type="button" onClick={savePlan} disabled={saving} className="rounded-lg bg-[#2563eb] px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50">
                        {saving ? '저장 중…' : '내 기본 플랜으로 저장'}
                      </button>
                    </>
                  ) : (
                    <>
                      {!isAdminDefault ? (
                        <button type="button" onClick={resetPlan} className="rounded-lg px-3 py-1.5 text-sm text-[#475569] hover:bg-white">
                          관리자 설계로 되돌리기
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => plan && setDraft(JSON.parse(JSON.stringify(plan)) as StudyPlan)}
                        className="rounded-lg bg-[#0f172a] px-4 py-1.5 text-sm font-bold text-white"
                      >
                        ✎ {isAdminDefault ? '내 기본 플랜으로 고치기' : '플랜 고치기'}
                      </button>
                    </>
                  )}
                </div>
                {shownPlan ? <PlanColumns plan={shownPlan} activities={activities} editing={!!draft} onChange={setDraft} /> : null}
              </section>

              <section className="rounded-2xl border border-[#e2e8f0] bg-white p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-[#0f172a]">진도</h2>
                  {scopes.length > 0 ? (
                    <select
                      value={scopeKey}
                      onChange={(e) => {
                        setScopeKey(e.target.value);
                        setOpenRow(null);
                      }}
                      className="max-w-full rounded-lg border border-[#cbd5e1] bg-white px-3 py-1.5 text-sm"
                    >
                      {scopes.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label} — {s.sub}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <div className="flex-1" />
                  {board ? <span className="text-sm font-semibold text-[#2563eb]">전체 {totalPct}%</span> : null}
                </div>

                {scopes.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#cbd5e1] px-5 py-10 text-center">
                    <p className="font-semibold text-[#0f172a]">아직 시험범위가 없어요</p>
                    <p className="mt-1 text-sm text-[#64748b]">이번 시험에 나올 지문을 묶어 시험범위로 저장하면 여기서 지문별 진도를 관리할 수 있어요.</p>
                    <Link href="/unified" className="mt-4 inline-flex rounded-xl bg-[#2563eb] px-4 py-2 text-sm font-bold text-white no-underline">
                      + 시험범위 만들기
                    </Link>
                  </div>
                ) : boardLoading && !board ? (
                  <p className="py-10 text-center text-sm text-[#94a3b8]">불러오는 중…</p>
                ) : board && plan ? (
                  board.passages.length === 0 ? (
                    <p className="py-10 text-center text-sm text-[#94a3b8]">이 시험범위에서 지문을 찾지 못했어요.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
                        <thead>
                          <tr>
                            <th className="sticky left-0 bg-white px-2 py-2 text-left text-xs font-semibold text-[#64748b]">지문</th>
                            {plan.steps.map((s, i) => (
                              <th key={s.id} className="px-1 py-2 text-center text-xs font-semibold text-[#334155]">
                                <span className={`mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-white ${tone(i)}`}>{i + 1}</span>
                                {s.title}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {board.passages.map((p) => {
                            const done = new Set(board.progress[p.id] ?? []);
                            const open = openRow === p.id;
                            return (
                              <Fragment key={p.id}>
                                <tr className={`cursor-pointer ${open ? 'bg-[#eff6ff]' : 'hover:bg-[#f8fafc]'}`} onClick={() => setOpenRow(open ? null : p.id)}>
                                  <td className="sticky left-0 border-t border-[#f1f5f9] bg-inherit px-2 py-2">
                                    <span className="font-semibold text-[#0f172a]">{p.label}</span>
                                    {!p.isMock ? <span className="ml-1 text-[11px] text-[#94a3b8]">{p.textbook}</span> : null}
                                  </td>
                                  {plan.steps.map((s) => {
                                    const n = s.items.filter((k) => done.has(k)).length;
                                    const full = n === s.items.length;
                                    return (
                                      <td key={s.id} className="border-t border-[#f1f5f9] px-1 py-2 text-center">
                                        <span
                                          className={`inline-flex min-w-[2.5rem] justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                                            full ? 'bg-[#2563eb] text-white' : n > 0 ? 'bg-[#dbeafe] text-[#1d4ed8]' : 'bg-[#f1f5f9] text-[#94a3b8]'
                                          }`}
                                        >
                                          {n}/{s.items.length}
                                        </span>
                                      </td>
                                    );
                                  })}
                                </tr>
                                {open ? (
                                  <tr>
                                    <td colSpan={plan.steps.length + 1} className="border-t border-[#dbeafe] bg-[#f8fafc] px-3 py-3">
                                      <div className="flex gap-3 overflow-x-auto pb-1">
                                        {plan.steps.map((s, i) => (
                                          <div key={s.id} className="w-48 shrink-0">
                                            <p className="mb-1.5 text-xs font-bold text-[#334155]">
                                              <span className={`mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] text-white ${tone(i)}`}>{i + 1}</span>
                                              {s.title}
                                            </p>
                                            <ul className="space-y-1">
                                              {s.items.map((k) => {
                                                const a = activities.find((x) => x.key === k);
                                                const href = activityHref(a, p);
                                                return (
                                                  <li key={k} className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-[13px] shadow-sm">
                                                    <input
                                                      type="checkbox"
                                                      checked={done.has(k)}
                                                      onChange={(e) => toggleDone(p.id, k, e.target.checked)}
                                                      className="h-4 w-4 accent-[#2563eb]"
                                                      aria-label={`${a?.label ?? k} 완료`}
                                                    />
                                                    <span className={`flex-1 truncate ${done.has(k) ? 'text-[#94a3b8] line-through' : 'text-[#334155]'}`}>{a?.label ?? k}</span>
                                                    {href ? (
                                                      <Link href={href} target="_blank" className="shrink-0 text-xs font-semibold text-[#2563eb] no-underline hover:underline">
                                                        열기
                                                      </Link>
                                                    ) : a?.qtype && p.isMock ? (
                                                      <Link href="/unified" className="shrink-0 text-xs text-[#64748b] no-underline hover:underline" title="유료 유형은 변형문제 주문으로 받을 수 있어요">
                                                        주문
                                                      </Link>
                                                    ) : null}
                                                  </li>
                                                );
                                              })}
                                            </ul>
                                          </div>
                                        ))}
                                      </div>
                                      {!p.isMock ? (
                                        <p className="mt-2 text-[11px] text-[#94a3b8]">클래스키트 화면은 모의고사 지문에서 열려요. 이 지문은 체크로만 진도를 관리해요.</p>
                                      ) : null}
                                    </td>
                                  </tr>
                                ) : null}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : null}
              </section>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

