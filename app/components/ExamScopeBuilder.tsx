'use client';

/**
 * 시험범위 만들기 — 한 화면에서 교재 찾기 → 단원 체크(단원 안 지문이 통째로) → 이름 붙여 저장.
 * 저장은 기존 exam_scopes(프리셋)라 /unified·학습 플랜·학교 관리에서 그대로 쓴다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CatalogFolder, CatalogTextbook } from '@/lib/exam-scope-catalog';

type Entry = {
  type: 'mockexam' | 'textbook';
  textbookKey: string;
  displayName: string;
  textbookCategory?: string;
  selectedSources: string[];
};
type Preset = { id: string; name: string; dbEntries: Entry[] };
type Units = Record<string, string[]>; // 단원 → 지문 라벨(source)

const count = (entries: Entry[]) => entries.reduce((n, e) => n + e.selectedSources.length, 0);

/** 모의고사는 번호만 오므로 source 는 "교재 18번" (exam_scopes·source_key 와 같은 모양) */
function unitsToSources(tb: CatalogTextbook, units: Units): Units {
  if (tb.type !== 'mockexam') return units;
  const out: Units = {};
  for (const [u, labels] of Object.entries(units)) out[u] = labels.map((l) => (l.startsWith(tb.key) ? l : `${tb.key} ${l}`));
  return out;
}
const shortLabel = (tb: string, s: string) => s.replace(tb, '').trim() || s;

export default function ExamScopeBuilder({
  open,
  onClose,
  onSaved,
  editPresetId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (preset: { id: string; name: string }) => void;
  /** 열 때 바로 고칠 프리셋 */
  editPresetId?: string;
}) {
  const [folders, setFolders] = useState<CatalogFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [openTb, setOpenTb] = useState<string>('');
  const [unitsByTb, setUnitsByTb] = useState<Record<string, Units>>({});
  const [openUnit, setOpenUnit] = useState<string>('');
  const [picked, setPicked] = useState<Record<string, Entry>>({});
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadPresets = useCallback(() => {
    fetch('/api/my/exam-scope', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { presets: [] }))
      .then((d) => setPresets(Array.isArray(d.presets) ? d.presets : []))
      .catch(() => {});
  }, []);

  const loadIntoEditor = useCallback((p: Preset | null) => {
    setError('');
    setConfirmDel(null);
    if (!p) {
      setEditingId(null);
      setName('');
      setPicked({});
      return;
    }
    setEditingId(p.id);
    setName(p.name);
    const next: Record<string, Entry> = {};
    for (const e of p.dbEntries ?? []) next[e.textbookKey] = { ...e, selectedSources: [...(e.selectedSources ?? [])] };
    setPicked(next);
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/my/exam-scope/catalog', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { folders: [] }))
      .then((d) => setFolders(Array.isArray(d.folders) ? d.folders : []))
      .finally(() => setLoading(false));
    fetch('/api/my/exam-scope', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { presets: [] }))
      .then((d) => {
        const list: Preset[] = Array.isArray(d.presets) ? d.presets : [];
        setPresets(list);
        loadIntoEditor(list.find((p) => p.id === editPresetId) ?? null);
      })
      .catch(() => {});
  }, [open, editPresetId, loadIntoEditor]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const ensureUnits = (tb: CatalogTextbook) => {
    if (unitsByTb[tb.key]) return;
    fetch(`/api/textbooks/lesson-index?textbook=${encodeURIComponent(tb.key)}`)
      .then((r) => (r.ok ? r.json() : { groups: {} }))
      .then((d) => setUnitsByTb((m) => ({ ...m, [tb.key]: unitsToSources(tb, (d.groups ?? {}) as Units) })))
      .catch(() => setUnitsByTb((m) => ({ ...m, [tb.key]: {} })));
  };

  const toggleTextbook = (tb: CatalogTextbook) => {
    setOpenTb((cur) => (cur === tb.key ? '' : tb.key));
    setOpenUnit('');
    ensureUnits(tb);
  };

  const setSources = (tb: CatalogTextbook, sources: string[]) =>
    setPicked((m) => {
      const next = { ...m };
      if (sources.length === 0) delete next[tb.key];
      else
        next[tb.key] = {
          type: tb.type,
          textbookKey: tb.key,
          displayName: tb.key,
          ...(tb.category ? { textbookCategory: tb.category } : {}),
          selectedSources: sources,
        };
      return next;
    });

  const selectedOf = (key: string) => new Set(picked[key]?.selectedSources ?? []);

  const toggleSources = (tb: CatalogTextbook, sources: string[], on: boolean) => {
    const cur = selectedOf(tb.key);
    for (const s of sources) {
      if (on) cur.add(s);
      else cur.delete(s);
    }
    // 교재 안 순서를 지킨다
    const order = Object.values(unitsByTb[tb.key] ?? {}).flat();
    setSources(tb, [...cur].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  };

  const q = query.trim().toLowerCase();
  const matches = (t: CatalogTextbook) => !q || t.key.toLowerCase().includes(q) || t.label.toLowerCase().includes(q);
  const visibleFolders = useMemo(
    () =>
      folders
        .map((f) => ({ ...f, groups: f.groups.map((g) => ({ ...g, textbooks: g.textbooks.filter(matches) })).filter((g) => g.textbooks.length) }))
        .filter((f) => f.groups.length > 0 || (q && f.label.toLowerCase().includes(q))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folders, q],
  );

  const entries = Object.values(picked);

  /** 담은 지문 요약 — 단원이 불러와져 있으면 「단원 전체 n / 단원 n개」, 아니면 번호 나열 */
  const summarize = (e: Entry): string => {
    const units = unitsByTb[e.textbookKey];
    if (!units) return e.selectedSources.map((s) => shortLabel(e.textbookKey, s)).join(' · ');
    const sel = new Set(e.selectedSources);
    return Object.entries(units)
      .map(([u, srcs]) => {
        const n = srcs.filter((x) => sel.has(x)).length;
        if (!n) return '';
        if (u === '전체') return srcs.filter((x) => sel.has(x)).map((x) => shortLabel(e.textbookKey, x)).join(' · ');
        return n === srcs.length ? `${u} 전체 ${n}` : `${u} ${n}개`;
      })
      .filter(Boolean)
      .join(' · ');
  };
  const entryTitle = (e: Entry) => (e.textbookCategory === 'school-textbook' ? e.textbookKey.replace('_', ' · ') : e.displayName);
  const total = count(entries);

  const save = async () => {
    if (!name.trim()) return setError('시험범위 이름을 적어 주세요.');
    if (!entries.length) return setError('단원이나 지문을 하나 이상 체크해 주세요.');
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/my/exam-scope', {
        method: editingId ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(editingId ? { id: editingId } : {}), name: name.trim(), dbEntries: entries }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || '저장하지 못했어요.');
      const id = String(d.id ?? editingId);
      onSaved?.({ id, name: name.trim() });
      loadPresets();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/my/exam-scope?id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    setConfirmDel(null);
    if (editingId === id) loadIntoEditor(null);
    loadPresets();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#0f172a]/50 p-2 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="시험범위 만들기"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col rounded-2xl bg-white text-[#0f172a] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-[#e2e8f0] px-5 py-4">
          <div className="flex-1">
            <h2 className="text-lg font-bold">{editingId ? '시험범위 고치기' : '시험범위 추가'}</h2>
            <p className="mt-0.5 text-sm text-[#64748b]">
              우리 반 교재를 찾아 <b className="text-[#0f172a]">이번 시험에 나오는 단원</b>을 체크하세요. 단원을 체크하면 그 안 지문이 통째로 담깁니다.
            </p>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 rounded-lg text-[#64748b] hover:bg-[#f1f5f9]" aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.75fr)] lg:overflow-hidden">
          {/* 교재 찾기 */}
          <div className="flex min-h-[320px] flex-col lg:min-h-0">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="교재 이름으로 찾기 (예: 영어1 비상, 수능특강, 26년 6월 고2)"
              className="mb-2 w-full rounded-xl border-2 border-[#cbd5e1] px-3 py-2.5 text-sm outline-none focus:border-[#2563eb]"
            />
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#e2e8f0] p-2">
              {loading ? (
                <p className="py-10 text-center text-sm text-[#94a3b8]">교재 목록 불러오는 중…</p>
              ) : visibleFolders.length === 0 ? (
                <p className="py-10 text-center text-sm text-[#94a3b8]">찾는 교재가 없어요.</p>
              ) : (
                visibleFolders.map((f) => {
                  const fOpen = !!q || openFolders.has(f.key);
                  const nIn = f.groups.flatMap((g) => g.textbooks).reduce((n, t) => n + (picked[t.key]?.selectedSources.length ?? 0), 0);
                  return (
                    <div key={f.key} className="mb-1">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenFolders((s) => {
                            const n = new Set(s);
                            if (n.has(f.key)) n.delete(f.key);
                            else n.add(f.key);
                            return n;
                          })
                        }
                        className="flex w-full items-center gap-2 rounded-lg bg-[#f8fafc] px-3 py-2 text-left text-sm font-bold hover:bg-[#f1f5f9]"
                      >
                        <span className="text-[#94a3b8]">{fOpen ? '▾' : '▸'}</span>
                        <span className="flex-1">📁 {f.label}</span>
                        {nIn ? <span className="rounded-full bg-[#2563eb] px-2 text-[11px] text-white">{nIn}</span> : null}
                      </button>
                      {fOpen
                        ? f.groups.map((g) => (
                            <div key={g.label || f.key} className="ml-3 mt-1">
                              {g.label ? <p className="px-2 pt-1 text-[11px] font-semibold text-[#94a3b8]">{g.label}</p> : null}
                              {g.textbooks.map((t) => {
                                const units = unitsByTb[t.key];
                                const sel = selectedOf(t.key);
                                const isOpen = openTb === t.key;
                                return (
                                  <div key={t.key}>
                                    <button
                                      type="button"
                                      onClick={() => toggleTextbook(t)}
                                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] ${isOpen ? 'bg-[#eff6ff] text-[#1d4ed8]' : 'hover:bg-[#f8fafc]'}`}
                                    >
                                      <span className="text-[#94a3b8]">{isOpen ? '▾' : '▸'}</span>
                                      <span className="min-w-0 flex-1 truncate">{t.label}</span>
                                      {sel.size ? <span className="text-[11px] font-semibold text-[#2563eb]">{sel.size}개</span> : null}
                                    </button>
                                    {isOpen ? (
                                      !units ? (
                                        <p className="px-8 py-2 text-xs text-[#94a3b8]">단원 불러오는 중…</p>
                                      ) : Object.keys(units).length === 0 ? (
                                        <p className="px-8 py-2 text-xs text-[#94a3b8]">지문이 없어요.</p>
                                      ) : (
                                        <div className="ml-5 border-l border-[#e2e8f0] py-1 pl-2">
                                          {Object.entries(units).map(([u, srcs]) => {
                                            const n = srcs.filter((s) => sel.has(s)).length;
                                            const all = n === srcs.length;
                                            const uOpen = openUnit === `${t.key}|${u}` || (t.type === 'mockexam' && Object.keys(units).length === 1);
                                            return (
                                              <div key={u}>
                                                <div className="flex items-center gap-2 rounded px-1 py-1 hover:bg-[#f8fafc]">
                                                  <input
                                                    type="checkbox"
                                                    checked={all}
                                                    ref={(el) => {
                                                      if (el) el.indeterminate = n > 0 && !all;
                                                    }}
                                                    onChange={() => toggleSources(t, srcs, !all)}
                                                    className="h-4 w-4 accent-[#2563eb]"
                                                    aria-label={`${u} 전체`}
                                                  />
                                                  <button type="button" onClick={() => setOpenUnit(uOpen ? '' : `${t.key}|${u}`)} className="flex-1 text-left text-[13px]">
                                                    {t.type === 'mockexam' && u === '전체' ? '전체 번호' : u}
                                                    <span className="ml-1 text-[11px] text-[#94a3b8]">
                                                      {n ? `${n}/` : ''}
                                                      {srcs.length}지문 {uOpen ? '▴' : '▾'}
                                                    </span>
                                                  </button>
                                                </div>
                                                {uOpen ? (
                                                  <div className="mb-1 ml-6 flex flex-wrap gap-1">
                                                    {srcs.map((s) => (
                                                      <button
                                                        key={s}
                                                        type="button"
                                                        onClick={() => toggleSources(t, [s], !sel.has(s))}
                                                        className={`rounded-md border px-2 py-0.5 text-xs ${sel.has(s) ? 'border-[#2563eb] bg-[#2563eb] text-white' : 'border-[#cbd5e1] text-[#475569] hover:border-[#2563eb]'}`}
                                                      >
                                                        {shortLabel(u === '전체' ? t.key : u, s)}
                                                      </button>
                                                    ))}
                                                  </div>
                                                ) : null}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          ))
                        : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 이름·담은 지문 */}
          <div className="flex min-h-0 flex-col gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-bold">시험범위 이름 *</span>
              <input
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 2026 2학기 중간 · 영어1 비상(홍) 3과"
                className="w-full rounded-xl border border-[#cbd5e1] px-3 py-2.5 text-sm outline-none focus:border-[#2563eb]"
              />
            </label>
            <div className="flex min-h-[160px] flex-1 flex-col rounded-xl border border-[#e2e8f0]">
              <div className="flex items-center justify-between border-b border-[#f1f5f9] px-3 py-2">
                <span className="text-sm font-bold">담은 지문</span>
                <span className="text-sm font-bold text-[#2563eb]">{total}개</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {entries.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs leading-relaxed text-[#94a3b8]">
                    왼쪽에서 교재를 열고 이번 시험에 나오는 단원을 체크하세요. 보통 2~3개 단원이면 충분해요.
                  </p>
                ) : (
                  entries.map((e) => (
                    <div key={e.textbookKey} className="mb-2 rounded-lg bg-[#f8fafc] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{entryTitle(e)}</span>
                        <span className="text-xs text-[#2563eb]">{e.selectedSources.length}</span>
                        <button type="button" onClick={() => setPicked((m) => { const n = { ...m }; delete n[e.textbookKey]; return n; })} className="text-[#94a3b8] hover:text-rose-600" aria-label="교재 빼기">
                          ×
                        </button>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] text-[#64748b]">{summarize(e)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* 내 시험범위 */}
          <div className="flex min-h-0 flex-col">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold">내 시험범위</span>
              <span className="text-xs text-[#94a3b8]">{presets.length}개</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#e2e8f0] p-1.5">
              {editingId ? (
                <button type="button" onClick={() => loadIntoEditor(null)} className="mb-1 w-full rounded-lg border border-dashed border-[#cbd5e1] px-3 py-2 text-xs font-semibold text-[#2563eb] hover:bg-[#eff6ff]">
                  + 새 시험범위
                </button>
              ) : null}
              {presets.length === 0 ? (
                <p className="px-2 py-4 text-xs text-[#94a3b8]">아직 없어요 — 왼쪽에서 첫 범위를 만들어요.</p>
              ) : (
                presets.map((p) => (
                  <div key={p.id} className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 ${editingId === p.id ? 'bg-[#eff6ff]' : 'hover:bg-[#f8fafc]'}`}>
                    <button type="button" onClick={() => loadIntoEditor(p)} className="min-w-0 flex-1 text-left" title="눌러서 고치기">
                      <span className="block truncate text-[13px] font-semibold">{p.name}</span>
                      <span className="text-[11px] text-[#94a3b8]">지문 {count(p.dbEntries ?? [])}개</span>
                    </button>
                    {confirmDel === p.id ? (
                      <button type="button" onClick={() => remove(p.id)} className="rounded bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white">
                        삭제
                      </button>
                    ) : (
                      <button type="button" onClick={() => setConfirmDel(p.id)} className="rounded px-1.5 text-[#cbd5e1] hover:text-rose-600 group-hover:text-[#94a3b8]" aria-label="삭제">
                        🗑
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-[#94a3b8]">이름을 누르면 바로 고쳐요. 숫자는 지문 수.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-[#e2e8f0] px-5 py-3">
          <span className="flex-1 text-sm text-[#64748b]">
            {error ? <span className="text-rose-600">{error}</span> : total ? `교재 ${entries.length}권 · 지문 ${total}개를 담았어요` : '단원을 체크하면 여기에 개수가 보여요'}
          </span>
          <button type="button" onClick={onClose} className="rounded-xl border border-[#cbd5e1] px-4 py-2.5 text-sm font-semibold text-[#475569] hover:bg-[#f8fafc]">
            취소
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !total || !name.trim()}
            className="rounded-xl bg-[#2563eb] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#1d4ed8] disabled:bg-[#94a3b8]"
          >
            {saving ? '저장 중…' : editingId ? '고친 내용 저장' : '이 범위로 만들기'}
          </button>
        </div>
      </div>
    </div>
  );
}
