'use client';

/**
 * 기출 유형 분석 — 회원이 올린 학교 기출 시험지를 보고 유형 분포를 분석해
 * 추천 유형 세트를 등록하는 관리자 페이지. 완료 처리하면 /unified 에서
 * 해당 회원이 「추천 유형 적용」 원클릭으로 사용.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '../_components/AdminSidebar';
import { BOOK_VARIANT_QUESTION_TYPES } from '@/lib/book-variant-types';

interface AnalysisItem {
  id: string;
  loginId: string;
  schoolName: string;
  grade: string;
  examLabel: string;
  note: string;
  status: 'requested' | 'done';
  recommendedTypes: { type: string; count: number }[];
  adminNote: string;
  pastExamUploadId: string;
  examScope: string;
  files: { originalName: string; fileIndex: number }[];
  createdAt: string;
  analyzedAt: string | null;
}

export default function ExamTypeAnalysisPage() {
  const router = useRouter();
  const [adminLoginId, setAdminLoginId] = useState('');
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<AnalysisItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'requested' | 'done' | ''>('requested');
  /** 편집 중 — id → {counts, note} */
  const [draft, setDraft] = useState<Record<string, { counts: Record<string, number>; note: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.user || d.user.role !== 'admin') { router.replace('/admin/login'); return; }
        setAdminLoginId(d.user.loginId ?? '');
        setReady(true);
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  const fetchList = useCallback(async (f: 'requested' | 'done' | '') => {
    setLoading(true);
    try {
      const qs = f ? `?status=${f}` : '';
      const r = await fetch(`/api/admin/exam-type-analysis${qs}`, { credentials: 'include' });
      const d = await r.json();
      if (Array.isArray(d.items)) {
        setItems(d.items as AnalysisItem[]);
        const next: Record<string, { counts: Record<string, number>; note: string }> = {};
        for (const it of d.items as AnalysisItem[]) {
          const counts: Record<string, number> = {};
          for (const rt of it.recommendedTypes) counts[rt.type] = rt.count;
          next[it.id] = { counts, note: it.adminNote };
        }
        setDraft(next);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (ready) void fetchList(filter); }, [ready, filter, fetchList]);

  const setCount = (id: string, type: string, count: number) => {
    setDraft((prev) => {
      const cur = prev[id] ?? { counts: {}, note: '' };
      const counts = { ...cur.counts };
      if (count <= 0) delete counts[type];
      else counts[type] = Math.min(10, count);
      return { ...prev, [id]: { ...cur, counts } };
    });
  };

  const handleSave = async (it: AnalysisItem, markDone: boolean) => {
    const d = draft[it.id] ?? { counts: {}, note: '' };
    const recommendedTypes = Object.entries(d.counts)
      .filter(([, c]) => c >= 1)
      .map(([type, count]) => ({ type, count }));
    if (markDone && recommendedTypes.length === 0) {
      alert('추천 유형을 1개 이상 입력하세요 (문항수 1 이상).');
      return;
    }
    setSavingId(it.id);
    try {
      const r = await fetch('/api/admin/exam-type-analysis', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: it.id,
          recommendedTypes,
          adminNote: d.note,
          status: markDone ? 'done' : 'requested',
        }),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) { alert(typeof res.error === 'string' ? res.error : '저장 실패'); return; }
      await fetchList(filter);
    } finally {
      setSavingId(null);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin w-10 h-10 border-4 border-slate-600 border-t-white rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      <AdminSidebar loginId={adminLoginId} />
      <main className="flex-1 min-w-0 overflow-x-hidden p-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold">📊 기출 유형 분석</h1>
              <p className="text-xs text-slate-400 mt-1">
                회원이 올린 기출 시험지의 유형 분포를 분석해 추천 유형 세트를 등록하면, 파이널 예비 모의고사에서 원클릭으로 적용됩니다.
              </p>
            </div>
            <div className="flex gap-1.5">
              {([
                ['requested', '대기'],
                ['done', '완료'],
                ['', '전체'],
              ] as const).map(([v, label]) => (
                <button
                  key={v || 'all'}
                  onClick={() => setFilter(v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                    filter === v ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading && <p className="text-slate-400 text-sm">불러오는 중…</p>}
          {!loading && items.length === 0 && (
            <p className="text-slate-500 text-sm rounded-xl border border-slate-700 bg-slate-800/60 p-6 text-center">
              {filter === 'requested' ? '대기 중인 분석 요청이 없습니다.' : '항목이 없습니다.'}
            </p>
          )}

          <div className="space-y-4">
            {items.map((it) => {
              const d = draft[it.id] ?? { counts: {}, note: '' };
              const totalCount = Object.values(d.counts).reduce((s, c) => s + c, 0);
              return (
                <div key={it.id} className="rounded-2xl border border-slate-700 bg-slate-800/70 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{it.schoolName} {it.grade}</span>
                    <span className="text-sm text-slate-300">· {it.examLabel}</span>
                    <span className="text-xs text-slate-500">· {it.loginId}</span>
                    {it.status === 'done' ? (
                      <span className="rounded-full bg-emerald-500/20 text-emerald-300 px-2 py-0.5 text-[10px] font-bold ring-1 ring-emerald-500/40">완료</span>
                    ) : (
                      <span className="rounded-full bg-amber-500/20 text-amber-300 px-2 py-0.5 text-[10px] font-bold ring-1 ring-amber-500/40">대기</span>
                    )}
                    <span className="ml-auto text-[11px] text-slate-500">
                      {new Date(it.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                  {(it.note || it.examScope) && (
                    <p className="mt-1.5 text-xs text-slate-400 whitespace-pre-wrap">
                      {it.examScope ? `범위: ${it.examScope}` : ''}{it.examScope && it.note ? ' · ' : ''}{it.note}
                    </p>
                  )}
                  {it.files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {it.files.map((f) => (
                        <a
                          key={f.fileIndex}
                          href={`/api/my/past-exam-upload/download?id=${it.pastExamUploadId}&fileIndex=${f.fileIndex}&inline=1`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg bg-slate-700 px-2.5 py-1 text-[11px] text-sky-300 hover:bg-slate-600"
                        >
                          📎 {f.originalName}
                        </a>
                      ))}
                    </div>
                  )}

                  {/* 유형별 문항수 입력 */}
                  <div className="mt-4 grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                    {BOOK_VARIANT_QUESTION_TYPES.map((t) => {
                      const c = d.counts[t] ?? 0;
                      return (
                        <label key={t} className={`flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-xs border ${c > 0 ? 'border-emerald-500/60 bg-emerald-900/30 text-emerald-100' : 'border-slate-700 bg-slate-900/40 text-slate-400'}`}>
                          <span className="truncate">{t}</span>
                          <input
                            type="number"
                            min={0}
                            max={10}
                            value={c}
                            onChange={(e) => setCount(it.id, t, Math.floor(Number(e.target.value) || 0))}
                            className="w-12 rounded bg-slate-800 border border-slate-600 px-1 py-0.5 text-right text-xs text-white"
                          />
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      placeholder="관리자 메모 (회원에게 노출)"
                      value={d.note}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [it.id]: { ...(prev[it.id] ?? { counts: {}, note: '' }), note: e.target.value } }))}
                      className="flex-1 min-w-[200px] rounded-lg bg-slate-900 border border-slate-600 px-3 py-1.5 text-xs text-white placeholder-slate-500"
                    />
                    <span className="text-[11px] text-slate-400 tabular-nums">합계 {totalCount}문항/지문</span>
                    <button
                      onClick={() => void handleSave(it, true)}
                      disabled={savingId === it.id}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {savingId === it.id ? '저장 중…' : it.status === 'done' ? '추천 수정 저장' : '✅ 분석 완료 처리'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
