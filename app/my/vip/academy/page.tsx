'use client';

import { useEffect, useState } from 'react';

interface AcademyInfo {
  name: string;
  regNumber: string;
  owner: string;
  address: string;
  phone: string;
  subjects: string;
  capacity: number | null;
  openDate: string;
  note: string;
}

const EMPTY: AcademyInfo = {
  name: '', regNumber: '', owner: '', address: '', phone: '', subjects: '', capacity: null, openDate: '', note: '',
};

const INPUT_CLS =
  'w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50';
const LABEL_CLS = 'block text-[12px] text-zinc-400 mb-1';

export default function AcademyPage() {
  const [form, setForm] = useState<AcademyInfo>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch('/api/my/vip/academy', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.info) {
          setForm({
            name: d.info.name ?? '',
            regNumber: d.info.regNumber ?? '',
            owner: d.info.owner ?? '',
            address: d.info.address ?? '',
            phone: d.info.phone ?? '',
            subjects: d.info.subjects ?? '',
            capacity: typeof d.info.capacity === 'number' ? d.info.capacity : null,
            openDate: d.info.openDate ?? '',
            note: d.info.note ?? '',
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const set = <K extends keyof AcademyInfo>(key: K, value: AcademyInfo[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/my/vip/academy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...form, capacity: form.capacity ?? '' }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      alert('저장 중 오류');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">학원 교습소 정보</h1>
          <p className="text-sm text-zinc-500 mt-0.5">학원/교습소 기본 정보를 입력해 두면 다른 메뉴·문서에서 참고할 수 있습니다.</p>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>학원/교습소명</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="OO영어학원" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>등록번호</label>
              <input value={form.regNumber} onChange={(e) => set('regNumber', e.target.value)} placeholder="제0000호" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>대표자</label>
              <input value={form.owner} onChange={(e) => set('owner', e.target.value)} placeholder="대표자 성명" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>전화</label>
              <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="02-000-0000" className={INPUT_CLS} />
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>주소</label>
            <input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="도로명 주소" className={INPUT_CLS} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>교습과목</label>
              <input value={form.subjects} onChange={(e) => set('subjects', e.target.value)} placeholder="영어, 수학 등" className={INPUT_CLS} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>정원</label>
                <input
                  type="number"
                  min={0}
                  value={form.capacity ?? ''}
                  onChange={(e) => set('capacity', e.target.value === '' ? null : Number(e.target.value))}
                  placeholder="명"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>개원일</label>
                <input
                  type="date"
                  value={form.openDate}
                  onChange={(e) => set('openDate', e.target.value)}
                  className={`${INPUT_CLS} [color-scheme:dark]`}
                />
              </div>
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>비고</label>
            <textarea
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="추가 메모 (선택)"
              rows={4}
              className={`${INPUT_CLS} resize-y`}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            {saved && <span className="text-[12px] text-emerald-400">저장되었습니다</span>}
            {!saved && dirty && <span className="text-[12px] text-amber-400/80">저장 안 됨</span>}
            <button
              onClick={save}
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40"
            >
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
