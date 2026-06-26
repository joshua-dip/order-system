'use client';

/**
 * QR 채점 — 비로그인 공개 페이지 (모바일 우선).
 * 시험지의 QR 로 진입 → 이름 입력 + OMR 마킹 → 제출 → 결과 보고서.
 * ?g=<gradingId> 로 재방문하면 보고서 바로 표시.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;

interface SheetInfo {
  title: string;
  scopeSummary: string;
  total: number;
  isOwner: boolean;
  questions: { num: number; type: string; multi: boolean }[];
}

interface ReportData {
  title: string;
  scopeSummary: string;
  studentName: string;
  score: number;
  total: number;
  byType: { type: string; correct: number; total: number }[];
  bySource: { sourceKey: string; correct: number; total: number }[];
  wrongDetails: { num: number; type: string; sourceKey: string; chosen: string; correct: string; question: string; explanation: string }[];
  createdAt: string;
  retry: { used: number; limit: number; canIssue: boolean; isOwner: boolean; jobId: string };
}

function pct(c: number, t: number): number {
  return t > 0 ? Math.round((c / t) * 100) : 0;
}

function Bar({ label, correct, total }: { label: string; correct: number; total: number }) {
  const p = pct(correct, total);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 truncate text-gray-600" title={label}>{label}</span>
      <div className="flex-1 h-3 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${p >= 80 ? 'bg-emerald-500' : p >= 50 ? 'bg-amber-400' : 'bg-rose-400'}`}
          style={{ width: `${p}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-right tabular-nums text-gray-500">{correct}/{total} ({p}%)</span>
    </div>
  );
}

function GradePageInner() {
  const params = useParams();
  const search = useSearchParams();
  const token = typeof params.token === 'string' ? params.token : '';
  const initialGradingId = search.get('g') ?? '';
  /** 학생별 개별 문제지 QR 은 ?seed= 를 달고 옴 → 그 학생 배치 그대로 채점/보고서 */
  const seed = search.get('seed') ?? '';
  const seedQ = seed ? `&seed=${encodeURIComponent(seed)}` : '';

  const [info, setInfo] = useState<SheetInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  /** num → 선택된 동그라미 집합 */
  const [marks, setMarks] = useState<Record<number, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [report, setReport] = useState<ReportData | null>(null);
  const [issueMsg, setIssueMsg] = useState('');
  const [issuing, setIssuing] = useState(false);

  const fetchReport = useCallback(async (gid: string) => {
    const r = await fetch(`/api/grade/${token}/result?g=${gid}${seedQ}`, { credentials: 'include' });
    const d = await r.json();
    if (r.ok) setReport(d as ReportData);
    else setLoadError(typeof d.error === 'string' ? d.error : '보고서를 불러오지 못했습니다.');
  }, [token, seedQ]);

  useEffect(() => {
    if (!token) { setLoadError('잘못된 주소입니다.'); return; }
    if (initialGradingId) {
      void fetchReport(initialGradingId);
      return;
    }
    fetch(`/api/grade/${token}?_=1${seedQ}`, { credentials: 'include' })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { setLoadError(typeof d.error === 'string' ? d.error : '시험 정보를 불러오지 못했습니다.'); return; }
        setInfo(d as SheetInfo);
      })
      .catch(() => setLoadError('네트워크 오류가 발생했습니다.'));
  }, [token, initialGradingId, fetchReport, seedQ]);

  const toggleMark = (num: number, circle: string, multi: boolean) => {
    setMarks((prev) => {
      const cur = prev[num] ?? [];
      if (multi) {
        const next = cur.includes(circle) ? cur.filter((c) => c !== circle) : [...cur, circle];
        return { ...prev, [num]: next };
      }
      return { ...prev, [num]: cur.length === 1 && cur[0] === circle ? [] : [circle] };
    });
  };

  const answeredCount = useMemo(
    () => Object.values(marks).filter((v) => v.length > 0).length,
    [marks],
  );

  const handleSubmit = async () => {
    if (!info) return;
    if (!name.trim()) { alert('이름을 입력해주세요.'); return; }
    const unanswered = info.total - answeredCount;
    if (unanswered > 0 && !window.confirm(`${unanswered}문항이 무응답입니다. 그대로 제출할까요? (무응답은 오답 처리)`)) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/grade/${token}?_=1${seedQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: name.trim(),
          answers: info.questions.map((q) => ({ num: q.num, chosen: (marks[q.num] ?? []).join('') })),
        }),
      });
      const d = await r.json();
      if (!r.ok) { alert(typeof d.error === 'string' ? d.error : '채점에 실패했습니다.'); return; }
      /* URL 에 g= (+seed) 를 남겨 보고서 재방문 가능하게 */
      window.history.replaceState(null, '', `/grade/${token}?g=${d.gradingId}${seed ? `&seed=${encodeURIComponent(seed)}` : ''}`);
      await fetchReport(d.gradingId);
      window.scrollTo({ top: 0 });
    } catch {
      alert('채점 처리 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleIssueRetry = async () => {
    if (!report || issuing) return;
    const gid = new URLSearchParams(window.location.search).get('g') ?? initialGradingId;
    setIssuing(true);
    try {
      const r = await fetch(`/api/my/final-exams/${report.retry.jobId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gradingId: gid }),
      });
      const d = await r.json();
      if (!r.ok) { setIssueMsg(typeof d.error === 'string' ? d.error : '발급에 실패했습니다.'); return; }
      setIssueMsg(
        d.status === 'ready'
          ? `✅ 오답 재학습 세트 ${d.retryIndex} 발급 완료! 파이널 메뉴 「내 다운로드」에서 PDF를 받으세요. (남은 무료 ${d.remaining}회)`
          : `✅ 세트 ${d.retryIndex} 접수 완료 — 부족 문항 ${d.totalShort}개 제작 후 다운로드 가능해집니다. (남은 무료 ${d.remaining}회)`,
      );
      setReport({ ...report, retry: { ...report.retry, used: d.retryIndex, canIssue: d.remaining > 0 && report.retry.isOwner } });
    } catch {
      setIssueMsg('발급 처리 중 오류가 발생했습니다.');
    } finally {
      setIssuing(false);
    }
  };

  /* ── 에러 ── */
  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-4xl mb-3">😥</p>
          <p className="text-sm text-gray-600">{loadError}</p>
        </div>
      </div>
    );
  }

  /* ── 보고서 ── */
  if (report) {
    const p = pct(report.score, report.total);
    const perfect = report.wrongDetails.length === 0;
    const exhausted = report.retry.used >= report.retry.limit;
    return (
      <div className="min-h-screen bg-gray-50 pb-16">
        <div className="bg-gradient-to-r from-indigo-700 to-purple-700 px-5 py-6 text-white">
          <p className="text-xs text-indigo-200">📊 시험 결과 보고서</p>
          <h1 className="mt-1 font-bold leading-snug">{report.title}</h1>
          <p className="mt-0.5 text-[11px] text-indigo-200">{report.scopeSummary}</p>
        </div>
        <div className="mx-auto max-w-lg px-4 -mt-4 space-y-4">
          {/* 점수 카드 */}
          <div className="rounded-2xl bg-white p-5 shadow-md text-center">
            <p className="text-sm text-gray-500">{report.studentName} 님의 점수</p>
            <p className="mt-1 text-4xl font-extrabold text-gray-900">
              {report.score}<span className="text-xl text-gray-400"> / {report.total}</span>
            </p>
            <p className={`mt-1 text-sm font-bold ${p >= 80 ? 'text-emerald-600' : p >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>
              정답률 {p}%{perfect ? ' · 만점! 🎉' : ''}
            </p>
          </div>

          {/* 유형별 */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-gray-800 mb-3">유형별 정답률</h2>
            <div className="space-y-2">
              {report.byType.map((t) => <Bar key={t.type} label={t.type} correct={t.correct} total={t.total} />)}
            </div>
          </div>

          {/* 지문별 */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-gray-800 mb-3">지문별 정답률</h2>
            <div className="space-y-2">
              {report.bySource.map((s) => (
                <Bar key={s.sourceKey} label={s.sourceKey.replace(/영어모의고사\s*/, '')} correct={s.correct} total={s.total} />
              ))}
            </div>
          </div>

          {/* 오답 상세 */}
          {report.wrongDetails.length > 0 && (
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-gray-800 mb-3">오답 노트 ({report.wrongDetails.length}문항)</h2>
              <div className="space-y-3">
                {report.wrongDetails.map((w) => (
                  <details key={w.num} className="group rounded-xl border border-rose-100 bg-rose-50/50 p-3">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-gray-700">
                      <span className="font-extrabold">{w.num}.</span>
                      <span className="text-gray-400">[{w.type}]</span>
                      <span>내 답 <span className="font-bold text-rose-600">{w.chosen}</span> → 정답 <span className="font-bold text-emerald-700">{w.correct}</span></span>
                      <span className="ml-auto shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-600 group-open:bg-gray-100 group-open:text-gray-500">
                        <span className="group-open:hidden">💡 해설 ▾</span>
                        <span className="hidden group-open:inline">접기 ▴</span>
                      </span>
                    </summary>
                    <div className="mt-2 space-y-1.5 text-xs text-gray-600">
                      <p className="font-medium text-gray-700">{w.question}</p>
                      <p className="text-[11px] text-gray-400">{w.sourceKey}</p>
                      <div className="rounded-lg bg-white p-2.5 leading-relaxed text-gray-700">
                        <span className="mb-1 block text-[11px] font-extrabold text-indigo-600">💡 해설</span>
                        {w.explanation || '이 문항은 해설이 제공되지 않았습니다.'}
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}

          {/* 다음 행동 */}
          <div className="rounded-2xl bg-white p-5 shadow-sm space-y-2">
            {issueMsg && (
              <div className="rounded-lg bg-indigo-50 p-2.5 space-y-2">
                <p className="text-xs font-medium text-indigo-700">{issueMsg}</p>
                {issueMsg.startsWith('✅') && (
                  <Link href="/unified/downloads" className="block rounded-lg bg-indigo-600 py-2 text-center text-xs font-bold text-white hover:bg-indigo-700">
                    📥 내 다운로드에서 받기 →
                  </Link>
                )}
              </div>
            )}
            {perfect ? (
              <Link href="/unified" className="block rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 py-3 text-center text-sm font-extrabold text-white">
                만점! 🎉 새 파이널 예비 모의고사에 도전하기 →
              </Link>
            ) : report.retry.canIssue ? (
              <>
                <button
                  onClick={() => void handleIssueRetry()}
                  disabled={issuing}
                  className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {issuing ? '발급 중…' : `📝 오답 다시 풀기 세트 받기 (무료 ${report.retry.used + 1}/${report.retry.limit})`}
                </button>
                <p className="text-center text-[11px] text-gray-400">틀린 지문×유형으로 새 문항을 구성해 드립니다</p>
              </>
            ) : exhausted ? (
              <Link href="/unified" className="block rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 py-3 text-center text-sm font-extrabold text-white">
                🎯 무료 세트를 모두 풀었어요! 새 파이널 모의고사 만들러 가기 →
              </Link>
            ) : !report.retry.isOwner ? (
              <p className="text-center text-[11px] text-gray-400">
                오답 재학습 세트(무료 {report.retry.limit}회)는 이 시험지의 구매자가 로그인 후 발급할 수 있어요.
              </p>
            ) : null}
            <button
              onClick={() => { setReport(null); setMarks({}); window.history.replaceState(null, '', `/grade/${token}${seed ? `?seed=${encodeURIComponent(seed)}` : ''}`); window.location.reload(); }}
              className="w-full rounded-xl border border-gray-200 py-2.5 text-xs font-semibold text-gray-500 hover:bg-gray-50"
            >
              다른 학생 채점하기
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── 로딩 ── */
  if (!info) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-9 h-9 border-4 border-gray-200 border-t-indigo-500 rounded-full" />
      </div>
    );
  }

  /* ── OMR 입력 ── */
  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <div className="bg-gradient-to-r from-indigo-700 to-purple-700 px-5 py-6 text-white">
        <p className="text-xs text-indigo-200">📱 QR 채점</p>
        <h1 className="mt-1 font-bold leading-snug">{info.title}</h1>
        <p className="mt-0.5 text-[11px] text-indigo-200">{info.scopeSummary} · 총 {info.total}문항</p>
      </div>
      <div className="mx-auto max-w-lg px-4 mt-4 space-y-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <label className="block text-xs font-bold text-gray-600 mb-1.5">이름 *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="채점 결과에 표시될 이름"
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800">답안 마킹</h2>
            <span className="text-[11px] text-gray-400 tabular-nums">{answeredCount}/{info.total}</span>
          </div>
          <div className="space-y-1">
            {info.questions.map((q) => {
              const cur = marks[q.num] ?? [];
              return (
                <div key={q.num} className={`flex items-center gap-1.5 rounded-xl px-1.5 py-1.5 ${cur.length > 0 ? 'bg-indigo-50/60' : ''}`}>
                  <span className="w-6 shrink-0 text-right text-sm font-extrabold text-gray-700 tabular-nums">{q.num}</span>
                  <span className="w-14 shrink-0 truncate text-[10px] leading-tight text-gray-400">{q.type}{q.multi ? ' (복수)' : ''}</span>
                  <div className="flex gap-1.5 ml-auto">
                    {CIRCLED.map((c) => {
                      const on = cur.includes(c);
                      return (
                        <button
                          key={c}
                          onClick={() => toggleMark(q.num, c, q.multi)}
                          className={`w-8 h-8 rounded-full text-sm font-bold transition-colors ${
                            on ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 하단 고정 제출 바 */}
      <div className="fixed inset-x-0 bottom-0 bg-white/95 backdrop-blur border-t border-gray-200 p-3">
        <div className="mx-auto max-w-lg">
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting || !name.trim()}
            className="w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-extrabold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {submitting ? '채점 중…' : `✅ 제출하고 채점하기 (${answeredCount}/${info.total})`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GradePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="animate-spin w-9 h-9 border-4 border-gray-200 border-t-indigo-500 rounded-full" />
        </div>
      }
    >
      <GradePageInner />
    </Suspense>
  );
}
