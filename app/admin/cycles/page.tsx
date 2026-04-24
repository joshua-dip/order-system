'use client';

import { useState, useEffect } from 'react';

interface Cycle {
  id: string;
  title: string;
  targetGrade: string;
  totalWeeks: number;
  priceWon: number;
  description: string;
  bulletPoints: string[];
  isActive: boolean;
  enrollmentCount: number;
  startAt?: string;
  endAt?: string;
}

const EMPTY: Partial<Cycle> = { title: '', targetGrade: '', totalWeeks: 6, priceWon: 0, description: '', bulletPoints: [], isActive: false };

export default function AdminCyclesPage() {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Partial<Cycle> | null>(null);
  const [saving, setSaving] = useState(false);
  const [bpInput, setBpInput] = useState('');
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/admin/cycles');
    const d = await res.json();
    setCycles(d.cycles ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setModal({ ...EMPTY, bulletPoints: [] });
    setBpInput('');
    setErr('');
  };

  const openEdit = (c: Cycle) => {
    setModal({ ...c });
    setBpInput(c.bulletPoints?.join('\n') ?? '');
    setErr('');
  };

  const handleSave = async () => {
    if (!modal?.title) { setErr('제목을 입력해 주세요.'); return; }
    setSaving(true);
    const bullets = bpInput.split('\n').map(s => s.trim()).filter(Boolean);
    const body = { ...modal, bulletPoints: bullets };

    let res: Response;
    if (modal.id) {
      res = await fetch(`/api/admin/cycles/${modal.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } else {
      res = await fetch('/api/admin/cycles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    if (!res.ok) { const d = await res.json(); setErr(d.error ?? '저장 실패'); setSaving(false); return; }
    setSaving(false);
    setModal(null);
    load();
  };

  const handleToggleActive = async (c: Cycle) => {
    await fetch(`/api/admin/cycles/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !c.isActive }) });
    load();
  };

  const handleDelete = async (c: Cycle) => {
    if (!confirm(`"${c.title}" 사이클을 삭제할까요?`)) return;
    const res = await fetch(`/api/admin/cycles/${c.id}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); alert(d.error ?? '삭제 실패'); return; }
    load();
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">사이클 관리</h1>
          <p className="text-sm text-slate-500 mt-0.5">학생에게 제공할 시험 대비 패키지를 만들고 관리합니다.</p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-colors"
        >
          + 새 사이클
        </button>
      </div>

      {loading && <p className="text-slate-400 text-center py-10">불러오는 중...</p>}

      <div className="space-y-3">
        {cycles.map(c => (
          <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {c.isActive ? '활성' : '비활성'}
                </span>
                <span className="text-xs text-slate-400">{c.targetGrade} · {c.totalWeeks}주 · {c.priceWon.toLocaleString()}원</span>
              </div>
              <p className="font-semibold text-slate-800 truncate">{c.title}</p>
              <p className="text-xs text-slate-400 mt-0.5">신청자 {c.enrollmentCount}명</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => handleToggleActive(c)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${c.isActive ? 'border-slate-200 text-slate-600 hover:bg-slate-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}
              >
                {c.isActive ? '비활성화' : '활성화'}
              </button>
              <button type="button" onClick={() => openEdit(c)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors font-medium">수정</button>
              <button type="button" onClick={() => handleDelete(c)} className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors font-medium">삭제</button>
            </div>
          </div>
        ))}
        {!loading && cycles.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p>아직 사이클이 없습니다.</p>
            <p className="text-sm mt-1">+ 새 사이클 버튼으로 만들어보세요.</p>
          </div>
        )}
      </div>

      {/* 모달 */}
      {modal !== null && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-slate-800 mb-4">{modal.id ? '사이클 수정' : '새 사이클 만들기'}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">제목 *</label>
                <input type="text" value={modal.title ?? ''} onChange={e => setModal(m => ({ ...m, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">대상 학년</label>
                  <input type="text" value={modal.targetGrade ?? ''} onChange={e => setModal(m => ({ ...m, targetGrade: e.target.value }))}
                    placeholder="예: 고2" className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">주차 수</label>
                  <input type="number" value={modal.totalWeeks ?? 6} onChange={e => setModal(m => ({ ...m, totalWeeks: parseInt(e.target.value) }))}
                    min={1} max={12} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">가격 (원)</label>
                <input type="number" value={modal.priceWon ?? 0} onChange={e => setModal(m => ({ ...m, priceWon: parseInt(e.target.value) }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">상세 설명</label>
                <textarea value={modal.description ?? ''} onChange={e => setModal(m => ({ ...m, description: e.target.value }))}
                  rows={3} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">핵심 포인트 (줄바꿈으로 구분)</label>
                <textarea value={bpInput} onChange={e => setBpInput(e.target.value)}
                  rows={3} placeholder="매주 AI 변형문제 5회 제공&#10;관리자 1:1 피드백&#10;오답 분석 리포트" className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none resize-none" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={modal.isActive ?? false} onChange={e => setModal(m => ({ ...m, isActive: e.target.checked }))}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-sm font-medium text-slate-700">학생 신청 페이지에 노출 (활성화)</span>
              </label>
            </div>
            {err && <p className="text-sm text-red-500 mt-3">{err}</p>}
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setModal(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors">취소</button>
              <button type="button" onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
