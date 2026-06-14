'use client';

/**
 * 파이널 예비 모의고사 — 내 다운로드 전용 페이지.
 * 원본 시험지 카드 아래에 오답 재학습 세트를 중첩 표시(학생 多 대비),
 * 학생별 채점 기록은 8명 초과 시 접기/펼치기.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppBar from '@/app/components/AppBar';

interface GradingRow {
  id: string;
  studentName: string;
  score: number;
  total: number;
  createdAt: string;
}

interface JobRow {
  id: string;
  title: string;
  scopeSummary: string;
  status: 'ready' | 'awaiting_admin';
  totalRequested: number;
  totalAssigned: number;
  totalShort: number;
  pointsCharged: number;
  shortageOrderNumber: string | null;
  gradeToken: string | null;
  retryIndex: number | null;
  parentJobId: string | null;
  createdAt: string;
  gradings?: GradingRow[];
}

const GRADING_PREVIEW_COUNT = 8;

function GradingChips({ job, expanded, onToggle }: { job: JobRow; expanded: boolean; onToggle: () => void }) {
  const list = job.gradings ?? [];
  if (list.length === 0 || !job.gradeToken) return null;
  const visible = expanded ? list : list.slice(0, GRADING_PREVIEW_COUNT);
  const hidden = list.length - visible.length;
  return (
    <div className="mt-2.5 border-t border-gray-100 pt-2">
      <p className="text-[10px] font-bold text-gray-400 mb-1.5">📊 채점 기록 ({list.length}) — 클릭하면 학생별 보고서</p>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((g) => {
          const p = g.total > 0 ? Math.round((g.score / g.total) * 100) : 0;
          return (
            <a
              key={g.id}
              href={`/grade/${job.gradeToken}?g=${g.id}`}
              target="_blank"
              rel="noreferrer"
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ring-1 hover:opacity-80 ${
                p >= 80 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : p >= 50 ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-rose-50 text-rose-700 ring-rose-200'
              }`}
              title={`${new Date(g.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })} 채점 — 보고서 열기`}
            >
              {g.studentName} {g.score}/{g.total} ({p}%)
            </a>
          );
        })}
        {hidden > 0 && (
          <button onClick={onToggle} className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-[11px] font-semibold text-gray-500 hover:bg-gray-200">
            +{hidden}명 더보기
          </button>
        )}
        {expanded && list.length > GRADING_PREVIEW_COUNT && (
          <button onClick={onToggle} className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-[11px] font-semibold text-gray-500 hover:bg-gray-200">
            접기
          </button>
        )}
      </div>
    </div>
  );
}

function ActionButtons({ job, compact }: { job: JobRow; compact?: boolean }) {
  const pad = compact ? 'px-2.5 py-1.5' : 'px-3.5 py-2';
  if (job.status !== 'ready') {
    return (
      <span className="text-[11px] text-gray-400">
        부족 문항이 완성되면 자동으로 다운로드 가능으로 바뀝니다 (새로고침으로 확인)
      </span>
    );
  }
  return (
    <>
      <a href={`/api/my/final-exams/${job.id}/download?kind=exam`} className={`rounded-lg bg-indigo-600 ${pad} text-xs font-bold text-white hover:bg-indigo-700`}>
        📄 문제지
      </a>
      <a href={`/api/my/final-exams/${job.id}/download?kind=answer`} className={`rounded-lg border border-indigo-300 ${pad} text-xs font-bold text-indigo-700 hover:bg-indigo-50`}>
        ✅ 정답·해설
      </a>
      {job.gradeToken && (
        <a
          href={`/grade/${job.gradeToken}`}
          target="_blank"
          rel="noreferrer"
          className={`rounded-lg border border-emerald-300 ${pad} text-xs font-bold text-emerald-700 hover:bg-emerald-50`}
          title="시험지 QR과 같은 채점 페이지"
        >
          📱 채점
        </a>
      )}
    </>
  );
}

export default function FinalExamDownloadsPage() {
  const [items, setItems] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [expandedGradings, setExpandedGradings] = useState<Set<string>>(new Set());

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/my/final-exams', { credentials: 'include' });
      if (r.status === 401 || r.status === 403) {
        const d = await r.json().catch(() => ({}));
        setAuthError(typeof d.error === 'string' ? d.error : '로그인이 필요합니다.');
        return;
      }
      const d = await r.json();
      if (Array.isArray(d.items)) setItems(d.items as JobRow[]);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchList(); }, [fetchList]);

  const toggleGradings = (id: string) => {
    setExpandedGradings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /* 원본(부모) 기준 그룹화 — 오답 세트는 부모 카드 안에 중첩. 부모가 목록에 없으면 단독 표시 */
  const ids = new Set(items.map((i) => i.id));
  const parents = items.filter((i) => !i.parentJobId || !ids.has(i.parentJobId));
  const childrenOf = (id: string) =>
    items
      .filter((i) => i.parentJobId === id)
      .sort((a, b) => (a.retryIndex ?? 0) - (b.retryIndex ?? 0));

  return (
    <>
      <AppBar title="내 다운로드" showBackButton />
      <div
        className="relative overflow-hidden px-6 py-7 text-white"
        style={{ background: 'linear-gradient(120deg, #1a1a6e 0%, #4b0082 55%, #7c3aed 100%)' }}
      >
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-extrabold tracking-tight">📥 내 다운로드</h1>
          <p className="mt-1 text-sm text-purple-200">
            발급한 파이널 예비 모의고사와 오답 재학습 세트 · 학생별 채점 기록
          </p>
        </div>
      </div>

      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
          <div className="flex items-center justify-between">
            <Link
              href="/unified"
              className="rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white hover:from-purple-700 hover:to-indigo-700"
            >
              ➕ 새 모의고사 만들기
            </Link>
            <button
              onClick={() => void fetchList()}
              disabled={loading}
              className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
            >
              {loading ? '확인 중…' : '↻ 새로고침'}
            </button>
          </div>

          {authError && (
            <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
              <p className="text-sm text-gray-600">{authError}</p>
              <Link href="/login?from=/unified/downloads" className="mt-4 inline-block rounded-xl bg-purple-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-800">
                로그인
              </Link>
            </div>
          )}

          {!authError && !loading && items.length === 0 && (
            <div className="rounded-2xl border bg-white p-10 text-center shadow-sm">
              <p className="text-3xl mb-2">🗂️</p>
              <p className="text-sm text-gray-500">아직 발급한 모의고사가 없습니다.</p>
              <Link href="/unified" className="mt-4 inline-block rounded-xl bg-purple-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-800">
                파이널 예비 모의고사 만들러 가기 →
              </Link>
            </div>
          )}

          {parents.map((j) => {
            const kids = childrenOf(j.id);
            return (
              <div key={j.id} className="rounded-2xl border bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-gray-800">{j.title}</span>
                  {j.status === 'ready' ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">다운로드 가능</span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                      제작 중 · {j.totalShort}문항 대기
                    </span>
                  )}
                  {j.retryIndex != null && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">무료 오답 세트</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500" title={j.scopeSummary}>
                  {j.scopeSummary} · {j.totalRequested}문항
                  {j.pointsCharged > 0 ? ` · ${j.pointsCharged.toLocaleString()}P` : ''}
                  {j.shortageOrderNumber ? ` · 제작요청 ${j.shortageOrderNumber}` : ''}
                  {' · '}{new Date(j.createdAt).toLocaleDateString('ko-KR', { dateStyle: 'medium' })}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionButtons job={j} />
                </div>

                <GradingChips job={j} expanded={expandedGradings.has(j.id)} onToggle={() => toggleGradings(j.id)} />

                {/* 오답 재학습 세트 — 부모 카드 안에 중첩 */}
                {kids.length > 0 && (
                  <div className="mt-3 space-y-2 rounded-xl bg-sky-50/60 p-3">
                    <p className="text-[10px] font-bold text-sky-700">📝 오답 재학습 세트 ({kids.length}/2)</p>
                    {kids.map((k) => (
                      <div key={k.id} className="rounded-lg bg-white p-3 ring-1 ring-sky-100">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">세트 {k.retryIndex}</span>
                          <span className="text-xs font-semibold text-gray-700">{k.scopeSummary}</span>
                          {k.status === 'ready' ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">다운로드 가능</span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">제작 중 · {k.totalShort}문항</span>
                          )}
                          <span className="ml-auto text-[10px] text-gray-400">
                            {new Date(k.createdAt).toLocaleDateString('ko-KR', { dateStyle: 'short' })}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <ActionButtons job={k} compact />
                        </div>
                        <GradingChips job={k} expanded={expandedGradings.has(k.id)} onToggle={() => toggleGradings(k.id)} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
