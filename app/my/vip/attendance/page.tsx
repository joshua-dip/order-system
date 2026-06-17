'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const STATUSES: { key: AttStatus; label: string; cls: string }[] = [
  { key: 'present', label: '출석', cls: 'bg-emerald-600 border-emerald-500' },
  { key: 'late', label: '지각', cls: 'bg-amber-600 border-amber-500' },
  { key: 'earlyLeave', label: '조퇴', cls: 'bg-sky-600 border-sky-500' },
  { key: 'absent', label: '결석', cls: 'bg-rose-600 border-rose-500' },
];
const REASONS = ['무단', '공결', '병결', '인정', '기타'];

type AttStatus = 'present' | 'late' | 'earlyLeave' | 'absent';
interface ClassRow { id: string; name: string; studentCount: number }
interface Row {
  id: string; name: string; grade: number | null;
  status: AttStatus | null; reason: string | null; memo: string;
  source: 'teacher' | 'qr' | null; checkedInAt: string | null;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function VipAttendancePage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [sessionLabel, setSessionLabel] = useState('');

  const [roster, setRoster] = useState<Row[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // QR
  const [qrUrl, setQrUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  useEffect(() => {
    fetch('/api/my/vip/attendance/classes', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setClasses(d.classes); if (d.classes[0]) setClassId(d.classes[0].id); } })
      .catch(() => {});
  }, []);

  const loadSession = useCallback(async (opts?: { keepDirty?: boolean }) => {
    if (!classId || !date) { setRoster([]); return; }
    setLoading(true);
    try {
      const p = new URLSearchParams({ classId, date, sessionLabel });
      const r = await fetch(`/api/my/vip/attendance/session?${p}`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok) { showToast(d.error || '불러오기 실패'); setRoster([]); return; }
      setRoster((prev) => {
        if (!opts?.keepDirty) return d.students as Row[];
        // QR 폴링 중: 선생님이 만진(dirty) 행은 로컬 값 유지, 나머지는 서버 값
        const byId = new Map((d.students as Row[]).map((s) => [s.id, s]));
        return prev.map((row) => (dirty.has(row.id) ? row : byId.get(row.id) ?? row));
      });
      if (!opts?.keepDirty) setDirty(new Set());
    } finally { setLoading(false); }
  }, [classId, date, sessionLabel, dirty]);

  useEffect(() => { loadSession(); /* eslint-disable-next-line */ }, [classId, date, sessionLabel]);

  // QR 세션 상태 복원
  useEffect(() => {
    setQrOpen(false); setQrDataUrl(''); setQrUrl('');
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, [classId, date, sessionLabel]);

  const edit = (id: string, patch: Partial<Row>) => {
    setRoster((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty((prev) => new Set(prev).add(id));
  };
  const setStatus = (id: string, status: AttStatus) =>
    edit(id, { status, reason: status === 'present' ? null : roster.find((r) => r.id === id)?.reason ?? null });

  const markAll = (status: AttStatus) => {
    setRoster((prev) => prev.map((r) => ({ ...r, status, reason: status === 'present' ? null : r.reason })));
    setDirty(new Set(roster.map((r) => r.id)));
  };

  const save = async () => {
    const records = roster.filter((r) => r.status).map((r) => ({ studentId: r.id, status: r.status, reason: r.reason, memo: r.memo }));
    if (records.length === 0) { showToast('출결을 입력하세요.'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/my/vip/attendance/session', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, date, sessionLabel, records }),
      });
      const d = await r.json();
      if (!r.ok) { showToast(d.error || '저장 실패'); return; }
      showToast(`${d.saved}명 저장되었습니다.`);
      await loadSession();
    } finally { setSaving(false); }
  };

  const openQr = async () => {
    if (!classId || !date) { showToast('반과 날짜를 선택하세요.'); return; }
    const r = await fetch('/api/my/vip/attendance/checkin-session', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId, date, sessionLabel }),
    });
    const d = await r.json();
    if (!r.ok) { showToast(d.error || 'QR 열기 실패'); return; }
    setQrUrl(d.url);
    try {
      const QRCode = (await import('qrcode')).default;
      setQrDataUrl(await QRCode.toDataURL(d.url, { width: 240, margin: 1 }));
    } catch { /* ignore */ }
    setQrOpen(true);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => loadSession({ keepDirty: true }), 4000);
  };

  const closeQr = async () => {
    setQrOpen(false);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    await fetch('/api/my/vip/attendance/checkin-session', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId, date, sessionLabel }),
    }).catch(() => {});
    await loadSession();
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const counts = STATUSES.map((s) => ({ ...s, n: roster.filter((r) => r.status === s.key).length }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">출결 입력</h1>
          <p className="text-sm text-zinc-500 mt-1">반·날짜·교시를 고르고 학생별 출결을 체크하세요.</p>
        </div>
        <a href="/my/vip/attendance/classes" className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-2 rounded-lg border border-zinc-800">반 관리 →</a>
      </div>

      {/* 선택 바 */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">반</label>
          <select value={classId} onChange={(e) => setClassId(e.target.value)}
            className="px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800 text-zinc-100 text-sm min-w-[160px]">
            {classes.length === 0 && <option value="">반 없음</option>}
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.studentCount})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">날짜</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800 text-zinc-100 text-sm" />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">교시(선택)</label>
          <input value={sessionLabel} onChange={(e) => setSessionLabel(e.target.value)} placeholder="예: 1교시"
            className="px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800 text-zinc-100 text-sm w-28" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => markAll('present')} disabled={roster.length === 0}
            className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-xs hover:bg-zinc-700 disabled:opacity-40">전체 출석</button>
          <button onClick={openQr} disabled={!classId}
            className="px-3 py-2 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-500 disabled:opacity-40">📱 QR 출석</button>
        </div>
      </div>

      {/* 요약 */}
      {roster.length > 0 && (
        <div className="flex gap-2 text-xs">
          {counts.map((c) => (
            <span key={c.key} className="px-2.5 py-1 rounded-lg bg-zinc-900/60 border border-zinc-800 text-zinc-300">{c.label} {c.n}</span>
          ))}
          <span className="px-2.5 py-1 rounded-lg bg-zinc-900/60 border border-zinc-800 text-zinc-500">미체크 {roster.filter((r) => !r.status).length}</span>
        </div>
      )}

      {/* 명단 */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-zinc-500">로딩 중…</div>
        ) : roster.length === 0 ? (
          <div className="p-10 text-center text-zinc-600 text-sm">학생이 없습니다. “반 관리”에서 반에 학생을 배정하세요.</div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {roster.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="min-w-[120px]">
                    <span className="text-zinc-100 text-sm font-medium">{r.name}</span>
                    {r.source === 'qr' && r.status && <span className="ml-1.5 text-[10px] text-violet-300">QR</span>}
                  </div>
                  <div className="flex gap-1">
                    {STATUSES.map((s) => (
                      <button key={s.key} onClick={() => setStatus(r.id, s.key)}
                        className={`px-2.5 py-1 rounded-md text-xs border ${r.status === s.key ? `${s.cls} text-white` : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'}`}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {r.status && r.status !== 'present' && (
                    <select value={r.reason ?? ''} onChange={(e) => edit(r.id, { reason: e.target.value || null })}
                      className="px-2 py-1 rounded-md bg-zinc-900/60 border border-zinc-800 text-zinc-200 text-xs">
                      <option value="">사유</option>
                      {REASONS.map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  )}
                  <input value={r.memo} onChange={(e) => edit(r.id, { memo: e.target.value })} placeholder="메모"
                    className="flex-1 min-w-[100px] px-2 py-1 rounded-md bg-zinc-900/40 border border-zinc-800 text-zinc-300 text-xs" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {roster.length > 0 && (
        <div className="flex justify-end">
          <button onClick={save} disabled={saving}
            className="px-6 py-2.5 rounded-xl bg-zinc-100 text-zinc-900 font-semibold hover:bg-white disabled:opacity-50">
            {saving ? '저장 중…' : '출결 저장'}
          </button>
        </div>
      )}

      {/* QR 모달 */}
      {qrOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={closeQr}>
          <div className="bg-zinc-900 rounded-2xl border border-white/10 w-full max-w-sm p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-1">QR 출석</h3>
            <p className="text-xs text-zinc-500 mb-4">학생이 스캔하면 본인 이름을 눌러 출석합니다. (실시간 반영)</p>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="출석 QR" className="mx-auto rounded-lg bg-white p-2" width={220} height={220} />
            ) : (
              <div className="h-[220px] flex items-center justify-center text-zinc-600 text-sm">QR 생성 중…</div>
            )}
            <p className="text-[11px] text-zinc-500 mt-3 break-all">{qrUrl}</p>
            <div className="mt-3 text-xs text-violet-300">QR 출석 {roster.filter((r) => r.source === 'qr' && r.status).length}명</div>
            <button onClick={closeQr} className="mt-4 w-full py-2.5 bg-zinc-800 text-zinc-200 rounded-xl text-sm">출석 마감 · 닫기</button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-emerald-600 text-zinc-100 text-sm rounded-xl shadow-lg">{toast}</div>
      )}
    </div>
  );
}
