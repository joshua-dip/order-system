'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface Stu { id: string; name: string; checkedIn: boolean }
interface Info {
  open: boolean;
  className: string;
  date: string;
  sessionLabel: string;
  students: Stu[];
}

export default function CheckinPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [justChecked, setJustChecked] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/checkin/${token}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) { setError(d.error || '오류'); return; }
      setInfo(d as Info);
    } catch {
      setError('네트워크 오류');
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const checkIn = async (s: Stu) => {
    if (s.checkedIn || busyId) return;
    setBusyId(s.id);
    try {
      const r = await fetch(`/api/checkin/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: s.id }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || '출석 실패'); return; }
      setJustChecked(s.name);
      setTimeout(() => setJustChecked(''), 2200);
      await load();
    } finally { setBusyId(''); }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-5">
          <div className="text-3xl mb-1">📋</div>
          <h1 className="text-lg font-extrabold">출석 체크</h1>
          {info && (
            <p className="text-sm text-slate-500 mt-1">
              {info.className} · {info.date}{info.sessionLabel ? ` · ${info.sessionLabel}` : ''}
            </p>
          )}
        </div>

        {loading ? (
          <p className="text-center text-slate-400 py-10">불러오는 중…</p>
        ) : error ? (
          <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-rose-600">{error}</p>
          </div>
        ) : info && !info.open ? (
          <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-slate-600">출석이 마감되었습니다.</p>
          </div>
        ) : info ? (
          <>
            <p className="text-center text-xs text-slate-500 mb-3">본인 이름을 눌러 출석하세요.</p>
            <div className="grid grid-cols-2 gap-2">
              {info.students.map((s) => (
                <button
                  key={s.id}
                  onClick={() => checkIn(s)}
                  disabled={s.checkedIn || busyId === s.id}
                  className={`rounded-xl px-3 py-4 text-sm font-bold border transition ${
                    s.checkedIn
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'bg-white border-slate-200 text-slate-800 hover:border-emerald-400 active:scale-95'
                  }`}
                >
                  {s.checkedIn ? `✓ ${s.name}` : s.name}
                </button>
              ))}
            </div>
            {info.students.length === 0 && (
              <p className="text-center text-sm text-slate-400 mt-6">이 반에 배정된 학생이 없습니다.</p>
            )}
          </>
        ) : null}

        {justChecked && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 px-5 py-3 bg-emerald-600 text-white text-sm font-bold rounded-xl shadow-lg">
            {justChecked} 출석 완료 ✓
          </div>
        )}
      </div>
    </div>
  );
}
