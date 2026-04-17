'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

type School = { id: string; name: string; createdAt: string };

type ExamPreset = { id: string; name: string; dbEntries: unknown[]; savedAt: string };

type Slot = {
  id: string;
  schoolId: string;
  schoolName: string;
  schoolYear: string;
  semester: string;
  dbEntries: { selectedSources?: unknown[] }[];
  updatedAt: string;
};

const SEMESTERS = ['1학기', '2학기', '여름방학', '겨울방학', '수능모의', '기타'] as const;

const YEARS = (() => {
  const y = new Date().getFullYear();
  return [y + 1, y, y - 1, y - 2, y - 3].map(String);
})();

export default function SchoolScopeManagement() {
  const [schools, setSchools] = useState<School[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [presets, setPresets] = useState<ExamPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSchoolName, setNewSchoolName] = useState('');
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [slotSchoolId, setSlotSchoolId] = useState('');
  const [slotYear, setSlotYear] = useState(YEARS[1] ?? String(new Date().getFullYear()));
  const [slotSem, setSlotSem] = useState<(typeof SEMESTERS)[number]>('1학기');
  const [slotPresetId, setSlotPresetId] = useState('');
  const [savingSlot, setSavingSlot] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [rs, rp, rt] = await Promise.all([
        fetch('/api/my/schools', { credentials: 'include' }),
        fetch('/api/my/school-exam-scopes', { credentials: 'include' }),
        fetch('/api/my/exam-scope', { credentials: 'include' }),
      ]);
      const ds = await rs.json();
      const dl = await rp.json();
      const dp = await rt.json();
      if (rs.ok && Array.isArray(ds.schools)) setSchools(ds.schools);
      else setSchools([]);
      if (rp.ok && Array.isArray(dl.slots)) {
        setSlots(
          dl.slots.map((x: Record<string, unknown>) => ({
            id: String(x.id ?? ''),
            schoolId: String(x.schoolId ?? ''),
            schoolName: String(x.schoolName ?? ''),
            schoolYear: String(x.schoolYear ?? ''),
            semester: String(x.semester ?? ''),
            dbEntries: Array.isArray(x.dbEntries) ? (x.dbEntries as { selectedSources?: unknown[] }[]) : [],
            updatedAt: String(x.updatedAt ?? ''),
          }))
        );
      } else setSlots([]);
      if (rt.ok && Array.isArray(dp.presets)) setPresets(dp.presets);
      else setPresets([]);
    } catch {
      setSchools([]);
      setSlots([]);
      setPresets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAddSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const name = newSchoolName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const res = await fetch('/api/my/schools', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setNewSchoolName('');
        setMessage({ type: 'success', text: '학교가 등록되었습니다.' });
        await refresh();
        if (data.school?.id) setSlotSchoolId(data.school.id);
      } else {
        setMessage({ type: 'error', text: data?.error || '등록에 실패했습니다.' });
      }
    } catch {
      setMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteSchool = async (id: string, name: string) => {
    if (!confirm(`「${name}」학교와 연결된 학기별 시험범위를 모두 삭제할까요?`)) return;
    try {
      const res = await fetch(`/api/my/schools?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({ type: 'success', text: '삭제했습니다.' });
        if (slotSchoolId === id) setSlotSchoolId('');
        await refresh();
      } else {
        setMessage({ type: 'error', text: data?.error || '삭제에 실패했습니다.' });
      }
    } catch {
      setMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    }
  };

  const handleSaveSlot = async () => {
    setMessage(null);
    if (!slotSchoolId) {
      setMessage({ type: 'error', text: '학교를 선택해 주세요.' });
      return;
    }
    const preset = presets.find((p) => p.id === slotPresetId);
    if (!preset) {
      setMessage({ type: 'error', text: '복사할 「저장된 시험범위」를 선택해 주세요. (없으면 파이널 예비고사에서 먼저 저장)' });
      return;
    }
    setSavingSlot(true);
    try {
      const res = await fetch('/api/my/school-exam-scopes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId: slotSchoolId,
          schoolYear: slotYear,
          semester: slotSem,
          dbEntries: preset.dbEntries,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({ type: 'success', text: '학기별 시험범위를 저장했습니다. 파이널 예비고사에서 불러올 수 있어요.' });
        await refresh();
      } else {
        setMessage({ type: 'error', text: data?.error || '저장에 실패했습니다.' });
      }
    } catch {
      setMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setSavingSlot(false);
    }
  };

  const handleDeleteSlot = async (id: string, label: string) => {
    if (!confirm(`「${label}」시험범위를 삭제할까요?`)) return;
    try {
      const res = await fetch(`/api/my/school-exam-scopes?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({ type: 'success', text: '삭제했습니다.' });
        await refresh();
      } else {
        setMessage({ type: 'error', text: data?.error || '삭제에 실패했습니다.' });
      }
    } catch {
      setMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    }
  };

  const passageCount = (db: unknown[]): number =>
    Array.isArray(db)
      ? db.reduce<number>((n, e) => {
          const src = (e as { selectedSources?: unknown }).selectedSources;
          return n + (Array.isArray(src) ? src.length : 0);
        }, 0)
      : 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5">
        <h2 className="text-base font-bold text-indigo-950">학교·학기별 시험범위</h2>
        <p className="mt-2 text-sm text-indigo-900/90 leading-relaxed">
          먼저 <strong>학교</strong>를 등록한 뒤, <strong>학년도·학기</strong>마다 마이페이지 「저장된 시험범위」에 있는 구성을 복사해 두면,{' '}
          <Link href="/unified" className="font-semibold text-indigo-700 underline underline-offset-2">
            파이널 예비 모의고사
          </Link>
          에서 한 번에 불러올 수 있습니다. 학생 관리에서는 등록된 학교만 선택할 수 있습니다.
        </p>
      </div>

      {message && (
        <p className={`text-sm font-medium ${message.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>{message.text}</p>
      )}

      <div className="rounded-2xl border border-[#e2e8f0] bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-[#f1f5f9]">
          <p className="text-sm font-bold text-[#0f172a]">학교 등록</p>
          <p className="text-[12px] text-[#94a3b8] mt-0.5">학교 이름을 추가합니다. (예: OO고등학교)</p>
        </div>
        <form onSubmit={handleAddSchool} className="p-5 flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={newSchoolName}
            onChange={(e) => setNewSchoolName(e.target.value)}
            placeholder="학교 이름"
            className="flex-1 px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            maxLength={80}
          />
          <button
            type="submit"
            disabled={adding || !newSchoolName.trim()}
            className="px-6 py-3 rounded-xl text-[13px] font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {adding ? '등록 중…' : '학교 추가'}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-[#e2e8f0] bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-[#f1f5f9]">
          <p className="text-sm font-bold text-[#0f172a]">학기별 시험범위 연결</p>
          <p className="text-[12px] text-[#94a3b8] mt-0.5">
            「저장된 시험범위」는 파이널 예비고사 1단계에서 시험범위로 저장한 목록입니다. 동일 구성을 이 학기에 복사합니다.
          </p>
        </div>
        <div className="p-5 space-y-4">
          {schools.length === 0 ? (
            <p className="text-sm text-[#64748b]">등록된 학교가 없습니다. 위에서 학교를 먼저 추가해 주세요.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">학교</label>
                  <select
                    value={slotSchoolId}
                    onChange={(e) => setSlotSchoolId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-[#e2e8f0] rounded-xl text-[13px] bg-white"
                  >
                    <option value="">선택</option>
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">학년도</label>
                  <select
                    value={slotYear}
                    onChange={(e) => setSlotYear(e.target.value)}
                    className="w-full px-3 py-2.5 border border-[#e2e8f0] rounded-xl text-[13px] bg-white"
                  >
                    {YEARS.map((y) => (
                      <option key={y} value={y}>
                        {y}년
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">학기</label>
                  <select
                    value={slotSem}
                    onChange={(e) => setSlotSem(e.target.value as (typeof SEMESTERS)[number])}
                    className="w-full px-3 py-2.5 border border-[#e2e8f0] rounded-xl text-[13px] bg-white"
                  >
                    {SEMESTERS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">저장된 시험범위에서 복사</label>
                  <select
                    value={slotPresetId}
                    onChange={(e) => setSlotPresetId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-[#e2e8f0] rounded-xl text-[13px] bg-white"
                  >
                    <option value="">선택</option>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleSaveSlot()}
                disabled={savingSlot || presets.length === 0}
                className="px-6 py-2.5 rounded-xl text-sm font-bold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {savingSlot ? '저장 중…' : '이 학기에 저장'}
              </button>
              {presets.length === 0 && (
                <p className="text-xs text-amber-700">
                  저장된 시험범위가 없습니다.{' '}
                  <Link href="/unified" className="underline font-semibold">
                    파이널 예비고사
                  </Link>
                  에서 범위를 만든 뒤 「시험범위로 저장」해 주세요.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-[#0f172a] mb-3">등록된 학교</h3>
        {loading ? (
          <p className="text-sm text-[#94a3b8] py-6 text-center">불러오는 중…</p>
        ) : schools.length === 0 ? (
          <p className="text-sm text-[#94a3b8] py-6 text-center rounded-2xl border border-dashed border-[#e2e8f0]">학교가 없습니다</p>
        ) : (
          <ul className="space-y-3">
            {schools.map((s) => (
              <li key={s.id} className="rounded-2xl border border-[#e2e8f0] bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <div>
                  <div className="font-bold text-[#0f172a]">{s.name}</div>
                  <div className="text-[11px] text-[#94a3b8] mt-0.5">
                    {slots.filter((x) => x.schoolId === s.id).length}개 학기 범위 저장됨
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteSchool(s.id, s.name)}
                  className="text-sm text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50 self-start sm:self-auto"
                >
                  학교 삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-bold text-[#0f172a] mb-3">학기별 저장 목록</h3>
        {loading ? null : slots.length === 0 ? (
          <p className="text-sm text-[#94a3b8] py-6 text-center rounded-2xl border border-dashed border-[#e2e8f0]">아직 저장된 학기 범위가 없습니다</p>
        ) : (
          <ul className="space-y-2">
            {slots.map((sl) => {
              const label = `${sl.schoolName} · ${sl.schoolYear}년 · ${sl.semester}`;
              const pc = passageCount(sl.dbEntries);
              return (
                <li
                  key={sl.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-[#e2e8f0] bg-[#fafafa] px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-[#0f172a]">{label}</div>
                    <div className="text-[11px] text-[#64748b] mt-0.5">
                      교재·모의 {sl.dbEntries.length}줄 · 선택 지문 합계 {pc}개
                      {sl.updatedAt ? ` · ${new Date(sl.updatedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeleteSlot(sl.id, label)}
                    className="text-xs text-red-600 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-50 self-start"
                  >
                    삭제
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
