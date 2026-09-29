'use client';

/**
 * /admin/error-reports — 클래스키트 수업 화면에서 들어온 콘텐츠 오류 신고.
 * 지문을 열어 확인하고 「고침」·「넘김」으로 닫는다.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Status = 'open' | 'fixed' | 'dismissed' | 'all';

interface Report {
  id: string;
  passageId: string;
  textbook: string;
  sourceKey: string;
  sentenceIndex: number;
  questionId: string | null;
  kind: string;
  message: string;
  reporter: string;
  status: Exclude<Status, 'all'>;
  createdAt: string;
}

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: 'open', label: '확인 전' },
  { value: 'fixed', label: '고침' },
  { value: 'dismissed', label: '넘김' },
  { value: 'all', label: '전체' },
];

export default function AdminErrorReportsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [status, setStatus] = useState<Status>('open');
  const [items, setItems] = useState<Report[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => {
        if (j?.user?.role !== 'admin') router.push('/login');
        else setAuthChecked(true);
      })
      .catch(() => router.push('/login'));
  }, [router]);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/error-reports?status=${status}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setItems(Array.isArray(d.items) ? d.items : []);
        setOpenCount(typeof d.openCount === 'number' ? d.openCount : 0);
      })
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    if (authChecked) load();
  }, [authChecked, load]);

  const setReportStatus = async (id: string, next: Report['status']) => {
    setBusyId(id);
    await fetch('/api/admin/error-reports', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: next }),
    }).catch(() => {});
    setBusyId(null);
    load();
  };

  if (!authChecked) return <div className="p-8 text-slate-500">권한 확인 중…</div>;

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="container mx-auto max-w-5xl px-4">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-slate-900">콘텐츠 오류 신고</h1>
          <p className="mt-1 text-sm text-slate-500">
            클래스키트 「수업 화면」에서 들어온 신고입니다. 확인 전 {openCount}건 · 지문 열기로 바로 확인하세요.
          </p>
        </header>
        <div className="mb-4 flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setStatus(o.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                status === o.value ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500">표시할 신고가 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {items.map((r) => (
              <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="rounded bg-rose-50 px-2 py-0.5 font-semibold text-rose-700">{r.kind}</span>
                  <span className="font-medium text-slate-700">
                    {r.textbook}
                    {r.sourceKey ? ` · ${r.sourceKey}` : ''}
                  </span>
                  <span>{r.sentenceIndex < 0 ? '지문 전체' : `${r.sentenceIndex + 1}번 문장`}</span>
                  {r.questionId ? <span className="font-mono">문항 {r.questionId.slice(-6)}</span> : null}
                  <span className="ml-auto">
                    {r.reporter} · {new Date(r.createdAt).toLocaleString('ko-KR')}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-900">{r.message}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={`/admin/class-kit/live?passage=${r.passageId}`}
                    target="_blank"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    지문 열기 ↗
                  </Link>
                  {r.status !== 'fixed' ? (
                    <button type="button" disabled={busyId === r.id} onClick={() => setReportStatus(r.id, 'fixed')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                      고침
                    </button>
                  ) : null}
                  {r.status !== 'dismissed' ? (
                    <button type="button" disabled={busyId === r.id} onClick={() => setReportStatus(r.id, 'dismissed')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                      넘김
                    </button>
                  ) : null}
                  {r.status !== 'open' ? (
                    <button type="button" disabled={busyId === r.id} onClick={() => setReportStatus(r.id, 'open')} className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50">
                      다시 열기
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
