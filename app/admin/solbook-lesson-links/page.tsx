'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { SolbookLessonLink } from '@/lib/solbook-lesson-links-store';

interface LessonRow extends SolbookLessonLink {
  _key: string;
}

interface DocItem {
  id: string;
  textbookKey: string;
  groupTitle?: string;
  groupUrl?: string;
  groupLabel?: string;
  lessons: SolbookLessonLink[];
}

let rowCounter = 0;
function mkKey() {
  return `row_${++rowCounter}`;
}
function toRows(lessons: SolbookLessonLink[]): LessonRow[] {
  return lessons.map((l, i) => ({ ...l, order: l.order ?? i, _key: mkKey() }));
}

export default function AdminSolbookLessonLinksPage() {
  const [solbookKeys, setSolbookKeys] = useState<string[]>([]);
  const [registeredMap, setRegisteredMap] = useState<Record<string, DocItem>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [groupTitle, setGroupTitle] = useState('');
  const [groupUrl, setGroupUrl] = useState('');
  const [groupLabel, setGroupLabel] = useState('');
  const [rows, setRows] = useState<LessonRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [solbookRes, listRes] = await Promise.all([
      fetch('/api/settings/variant-solbook', { credentials: 'include' }),
      fetch('/api/admin/solbook-lesson-links', { credentials: 'include' }),
    ]);
    const solbookData = await solbookRes.json();
    const listData = await listRes.json();

    setSolbookKeys((solbookData.textbookKeys ?? []) as string[]);

    const map: Record<string, DocItem> = {};
    for (const item of (listData.items ?? []) as DocItem[]) {
      map[item.textbookKey] = item;
    }
    setRegisteredMap(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openEditor = (key: string) => {
    if (dirty && selectedKey && !confirm('변경 사항이 있습니다. 버리고 이동하시겠습니까?')) return;
    const existing = registeredMap[key];
    setSelectedKey(key);
    setGroupTitle(existing?.groupTitle ?? '');
    setGroupUrl(existing?.groupUrl ?? '');
    setGroupLabel(existing?.groupLabel ?? '');
    setRows(toRows(existing?.lessons ?? []));
    setDirty(false);
    setSaveMsg(null);
  };

  const addRow = () => {
    setRows((prev) => [...prev, { _key: mkKey(), lessonKey: '', url: '', label: '', order: prev.length }]);
    setDirty(true);
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r._key !== key));
    setDirty(true);
  };

  const moveRow = (key: string, dir: -1 | 1) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r._key === key);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr.map((r, i) => ({ ...r, order: i }));
    });
    setDirty(true);
  };

  const updateRow = (key: string, field: keyof Omit<LessonRow, '_key'>, value: string | number) => {
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, [field]: value } : r)));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!selectedKey) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/admin/solbook-lesson-links/${encodeURIComponent(selectedKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupTitle: groupTitle.trim(),
          groupUrl: groupUrl.trim(),
          groupLabel: groupLabel.trim(),
          lessons: rows
            .map((r, i) => ({
              lessonKey: r.lessonKey.trim(),
              url: r.url.trim(),
              label: r.label?.trim() ?? '',
              itemCount: r.itemCount ? Number(r.itemCount) : undefined,
              order: i,
            }))
            .filter((r) => r.lessonKey && r.url),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setSaveMsg({ type: 'err', text: d.error ?? '저장 실패' });
        return;
      }
      setSaveMsg({ type: 'ok', text: '저장되었습니다.' });
      setDirty(false);
      setRegisteredMap((prev) => ({ ...prev, [selectedKey]: d.item }));
    } catch {
      setSaveMsg({ type: 'err', text: '네트워크 오류' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedKey) return;
    if (!confirm(`「${selectedKey}」의 모든 강별 링크를 삭제하시겠습니까?`)) return;
    await fetch(`/api/admin/solbook-lesson-links/${encodeURIComponent(selectedKey)}`, { method: 'DELETE' });
    setRegisteredMap((prev) => {
      const next = { ...prev };
      delete next[selectedKey];
      return next;
    });
    setSelectedKey(null);
    setRows([]);
    setDirty(false);
  };

  const filteredKeys = solbookKeys.filter((k) => k.toLowerCase().includes(searchTerm.toLowerCase()));

  const lessonCount = (key: string) => registeredMap[key]?.lessons?.length ?? 0;

  const inputClass =
    'w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none transition';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">쏠북 강별 링크 관리</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            변형문제 쏠북 교재별로 Lesson 단위 구매 URL을 등록합니다. 주문 화면의 「쏠북에서 결제하기」 모달에 반영됩니다.
          </p>
        </div>
        <Link
          href="/admin"
          className="shrink-0 text-sm text-slate-500 hover:text-indigo-600 font-medium transition-colors"
        >
          ← 관리자 메인
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="교재명 검색…"
          className="flex-1 px-4 py-2 rounded-xl border border-slate-200 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none"
        />
        <Link
          href="/admin/passages"
          className="inline-flex items-center justify-center px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          원문 관리
        </Link>
      </div>

      {loading ? (
        <p className="text-slate-400 text-center py-10">불러오는 중…</p>
      ) : filteredKeys.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <p className="text-slate-600">쏠북으로 분류된 교재가 없습니다.</p>
          <p className="text-sm text-slate-400 mt-1">원문 관리에서 출판사(YBM·쎄듀·NE능률)를 설정하거나 설정 화면에서 교재를 확인하세요.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">교재 선택</h2>
          <div className="space-y-2">
            {filteredKeys.map((key) => {
              const n = lessonCount(key);
              const isSelected = selectedKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => openEditor(key)}
                  className={`w-full text-left rounded-xl border p-4 transition-all ${
                    isSelected
                      ? 'border-indigo-300 bg-indigo-50/80 ring-2 ring-indigo-200 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <p className={`text-sm font-semibold break-words ${isSelected ? 'text-indigo-900' : 'text-slate-800'}`}>
                      {key}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      {n > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold px-2.5 py-0.5 border border-emerald-100">
                          {n}강 등록됨
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-500 text-xs font-medium px-2.5 py-0.5">
                          미등록
                        </span>
                      )}
                      <span className={`text-xs font-medium ${isSelected ? 'text-indigo-600' : 'text-slate-400'}`}>
                        {isSelected ? '편집 중' : '편집하기 →'}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedKey && (
        <div className="mt-8 pt-8 border-t border-slate-200">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-800 break-words">{selectedKey}</h2>
              <p className="text-sm text-slate-500 mt-0.5">모음 정보와 강별 쏠북 상품 URL을 입력한 뒤 저장하세요.</p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setSelectedKey(null);
                  setRows([]);
                  setDirty(false);
                  setSaveMsg(null);
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                목록만 보기
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="px-4 py-2 rounded-xl border border-red-200 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                전체 삭제
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>

          {saveMsg && (
            <div
              className={`mb-4 px-4 py-3 rounded-xl text-sm ${
                saveMsg.type === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' : 'bg-red-50 text-red-800 border border-red-100'
              }`}
            >
              {saveMsg.text}
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
            <h3 className="text-sm font-bold text-slate-700 mb-3">모음 그룹 정보 (선택)</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">그룹 제목</label>
                <input
                  type="text"
                  value={groupTitle}
                  onChange={(e) => {
                    setGroupTitle(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="예: 영어I_NE능률오선영_변형문제_강별"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">전체 강 모음 페이지 URL</label>
                <input
                  type="url"
                  value={groupUrl}
                  onChange={(e) => {
                    setGroupUrl(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="https://solvook.com/… 또는 블로그 링크"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">모음 링크 라벨</label>
                <input
                  type="text"
                  value={groupLabel}
                  onChange={(e) => {
                    setGroupLabel(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="예: [쏠북링크] 전체 강 보기"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <h3 className="text-sm font-bold text-slate-700">강별 링크 ({rows.length}개)</h3>
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-xl bg-slate-100 text-slate-800 text-sm font-semibold hover:bg-slate-200 transition-colors"
              >
                + 행 추가
              </button>
            </div>

            {rows.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-10">행을 추가해 주세요.</p>
            ) : (
              <div className="space-y-4">
                {/* 데스크톱: 표 형태 */}
                <div className="hidden md:block overflow-x-auto rounded-lg border border-slate-100">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-600 w-[18%]">강 키</th>
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-600">쏠북 URL</th>
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-600 w-[14%]">라벨</th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-600 w-[7rem]">문항수</th>
                        <th className="text-center px-2 py-2.5 text-xs font-semibold text-slate-600 w-16">순서</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => (
                        <tr key={row._key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                          <td className="px-3 py-2 align-top">
                            <input
                              type="text"
                              value={row.lessonKey}
                              onChange={(e) => updateRow(row._key, 'lessonKey', e.target.value)}
                              placeholder="Lesson 1"
                              className={`${inputClass} py-1.5`}
                            />
                          </td>
                          <td className="px-3 py-2 align-top">
                            <input
                              type="url"
                              value={row.url}
                              onChange={(e) => updateRow(row._key, 'url', e.target.value)}
                              placeholder="https://solvook.com/products/…"
                              className={`${inputClass} py-1.5 font-mono text-xs`}
                            />
                          </td>
                          <td className="px-3 py-2 align-top">
                            <input
                              type="text"
                              value={row.label ?? ''}
                              onChange={(e) => updateRow(row._key, 'label', e.target.value)}
                              placeholder="[395문항]"
                              className={`${inputClass} py-1.5`}
                            />
                          </td>
                          <td className="px-3 py-2 align-top">
                            <input
                              type="number"
                              value={row.itemCount ?? ''}
                              onChange={(e) => updateRow(row._key, 'itemCount', Number(e.target.value))}
                              placeholder="395"
                              min={0}
                              className={`${inputClass} py-1.5 text-right tabular-nums`}
                            />
                          </td>
                          <td className="px-2 py-2 align-middle">
                            <div className="flex flex-col items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => moveRow(row._key, -1)}
                                disabled={idx === 0}
                                className="w-8 h-7 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 text-xs"
                                title="위로"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                onClick={() => removeRow(row._key)}
                                className="w-8 h-7 rounded-lg border border-red-100 text-red-600 hover:bg-red-50 text-xs"
                                title="삭제"
                              >
                                삭제
                              </button>
                              <button
                                type="button"
                                onClick={() => moveRow(row._key, 1)}
                                disabled={idx === rows.length - 1}
                                className="w-8 h-7 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-30 text-xs"
                                title="아래로"
                              >
                                ▼
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 모바일: 카드 스택 */}
                <div className="md:hidden space-y-3">
                  {rows.map((row, idx) => (
                    <div key={row._key} className="rounded-xl border border-slate-200 p-4 space-y-3 bg-slate-50/50">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500">행 {idx + 1}</span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => moveRow(row._key, -1)}
                            disabled={idx === 0}
                            className="px-2 py-1 rounded-lg border border-slate-200 text-xs disabled:opacity-30"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            onClick={() => moveRow(row._key, 1)}
                            disabled={idx === rows.length - 1}
                            className="px-2 py-1 rounded-lg border border-slate-200 text-xs disabled:opacity-30"
                          >
                            ▼
                          </button>
                          <button
                            type="button"
                            onClick={() => removeRow(row._key)}
                            className="px-2 py-1 rounded-lg border border-red-100 text-red-600 text-xs"
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">강 키</label>
                        <input
                          type="text"
                          value={row.lessonKey}
                          onChange={(e) => updateRow(row._key, 'lessonKey', e.target.value)}
                          placeholder="Lesson 1"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">쏠북 URL</label>
                        <input
                          type="url"
                          value={row.url}
                          onChange={(e) => updateRow(row._key, 'url', e.target.value)}
                          placeholder="https://…"
                          className={`${inputClass} font-mono text-xs`}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">라벨</label>
                          <input
                            type="text"
                            value={row.label ?? ''}
                            onChange={(e) => updateRow(row._key, 'label', e.target.value)}
                            placeholder="[395문항]"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">문항수</label>
                          <input
                            type="number"
                            value={row.itemCount ?? ''}
                            onChange={(e) => updateRow(row._key, 'itemCount', Number(e.target.value))}
                            placeholder="395"
                            min={0}
                            className={`${inputClass} tabular-nums`}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rows.some((r) => r.lessonKey && r.url) && (
              <details className="mt-5 border-t border-slate-100 pt-4">
                <summary className="text-sm font-medium text-slate-600 cursor-pointer hover:text-indigo-600">
                  주문 화면 모달 미리보기
                </summary>
                <div className="mt-3 rounded-xl border border-slate-200 p-4 bg-slate-50 space-y-2">
                  {groupTitle && <p className="text-sm font-bold text-slate-800">{groupTitle}</p>}
                  {rows
                    .filter((r) => r.lessonKey && r.url)
                    .map((r) => (
                      <div
                        key={r._key}
                        className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-slate-100"
                      >
                        <div>
                          <span className="text-sm font-semibold text-slate-800">{r.lessonKey}</span>
                          {r.label && <span className="ml-2 text-xs text-slate-500">{r.label}</span>}
                          {r.itemCount != null && !r.label && (
                            <span className="ml-2 text-xs text-slate-500">[{r.itemCount}문항]</span>
                          )}
                        </div>
                        <span className="text-xs text-indigo-600 font-medium">쏠북에서 보기 ↗</span>
                      </div>
                    ))}
                  {groupUrl && (
                    <p className="text-center text-xs text-slate-500 pt-1">{groupLabel || '전체 강 모음 페이지 ↗'}</p>
                  )}
                </div>
              </details>
            )}
          </div>

          {dirty && <p className="mt-3 text-xs text-amber-700 text-right font-medium">저장되지 않은 변경이 있습니다.</p>}
        </div>
      )}
    </div>
  );
}
