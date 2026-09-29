'use client';

/**
 * 클래스키트 작업 공간 — 한 화면에서 「교재·지문 고르기 → 자료 종류 고르기 → 미리보기 → 받기」.
 * 여러 교재의 지문을 섞어 담을 수 있고, 인쇄 자료는 기존 일괄 PDF API(passageIds)로 한 번에 받는다.
 * 수업 화면은 담은 지문을 차례로 띄운다.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { PassageItem } from '../../_components/PassagePickerModal';
import ClassKitTabs from '../ClassKitTabs';
import { ClassKitAccessBanner, ClassKitRoot, IconSpinner } from '../_components/ClassKitUI';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import { buildLectureMaterialHtml } from '@/lib/lecture-material-html';
import { buildLessonMaterialHtml, LESSON_MODE_LABELS, type LessonMode } from '@/lib/lesson-material-html';

type Kind = 'live' | 'analysis' | 'lecture' | LessonMode;
const KINDS: { key: Kind; label: string; hint: string }[] = [
  { key: 'live', label: '수업 화면', hint: '교실 화면에 띄워 수업 — 문장 분석·듣기·판서' },
  { key: 'analysis', label: '종합분석지', hint: '끊어읽기·성분·구문·어법 설명·단어장·종합분석 — 분석된 지문만 담겨요' },
  { key: 'lecture', label: '강의용자료', hint: '판서 공간이 넓은 한 지문 한 장' },
  { key: 'parallel', label: LESSON_MODE_LABELS.parallel, hint: '영어·해석 좌우 대조' },
  { key: 'lineByLine', label: LESSON_MODE_LABELS.lineByLine, hint: '문장마다 해석 줄' },
  { key: 'writeEn', label: LESSON_MODE_LABELS.writeEn, hint: '해석을 보고 영작' },
  { key: 'writeKo', label: LESSON_MODE_LABELS.writeKo, hint: '영어를 보고 해석 쓰기' },
];
const PICK_KEY = 'class_kit_workspace_picks';
const MAX_PICKS = 60;

type Pick = { id: string; textbook: string; label: string };

function deriveNumber(raw?: string): string {
  const m = (raw ?? '').match(/\d+/);
  return m ? m[0] : (raw ?? '').trim();
}

export function ClassKitWorkspaceView({
  passagesApiBase = '/api/admin/passages',
  classKitApiBase = '/api/admin/class-kit',
  routeBase = '/admin/class-kit',
  onGuestGate,
}: {
  passagesApiBase?: string;
  classKitApiBase?: string;
  routeBase?: string;
  onGuestGate?: () => void;
}) {
  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [tbQuery, setTbQuery] = useState('');
  const [openTb, setOpenTb] = useState('');
  const [tbPassages, setTbPassages] = useState<Record<string, PassageItem[]>>({});
  const [picks, setPicks] = useState<Pick[]>([]);
  const [kind, setKind] = useState<Kind>('lecture');
  const [focus, setFocus] = useState<string>('');
  const [focusDoc, setFocusDoc] = useState<PassageItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const isUserClassKit = !passagesApiBase.startsWith('/api/admin');

  useEffect(() => {
    fetch(`${passagesApiBase}/textbooks`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setTextbooks(Array.isArray(d.textbooks) ? d.textbooks : []))
      .catch(() => {});
    try {
      const raw = localStorage.getItem(PICK_KEY);
      if (raw) setPicks((JSON.parse(raw) as Pick[]).slice(0, MAX_PICKS));
    } catch {
      /* ignore */
    }
  }, [passagesApiBase]);

  const savePicks = (next: Pick[]) => {
    const v = next.slice(0, MAX_PICKS);
    setPicks(v);
    try {
      localStorage.setItem(PICK_KEY, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  };

  const openTextbook = (tb: string) => {
    setOpenTb((cur) => (cur === tb ? '' : tb));
    if (tbPassages[tb]) return;
    fetch(`${passagesApiBase}?textbook=${encodeURIComponent(tb)}&limit=500`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setTbPassages((m) => ({ ...m, [tb]: Array.isArray(d.items) ? d.items : [] })))
      .catch(() => {});
  };

  const pickedIds = useMemo(() => new Set(picks.map((p) => p.id)), [picks]);
  const labelOf = (p: PassageItem) => p.source_key || `${p.chapter} ${p.number}`.trim();
  const togglePick = (p: PassageItem) =>
    pickedIds.has(p._id)
      ? savePicks(picks.filter((x) => x.id !== p._id))
      : savePicks([...picks, { id: p._id, textbook: p.textbook, label: labelOf(p) }]);
  const toggleAll = (tb: string) => {
    const list = tbPassages[tb] ?? [];
    const allOn = list.length > 0 && list.every((p) => pickedIds.has(p._id));
    if (allOn) savePicks(picks.filter((x) => x.textbook !== tb));
    else savePicks([...picks, ...list.filter((p) => !pickedIds.has(p._id)).map((p) => ({ id: p._id, textbook: tb, label: labelOf(p) }))]);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= picks.length) return;
    const next = [...picks];
    [next[i], next[j]] = [next[j], next[i]];
    savePicks(next);
  };

  // 미리보기 지문 — 고른 것이 바뀌면 첫 지문
  useEffect(() => {
    if (!picks.some((p) => p.id === focus)) setFocus(picks[0]?.id ?? '');
  }, [picks, focus]);
  useEffect(() => {
    if (!focus) return setFocusDoc(null);
    let cancelled = false;
    fetch(`${passagesApiBase}/${encodeURIComponent(focus)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setFocusDoc(d?.item ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [focus, passagesApiBase]);

  /* 종합분석지 미리보기는 서버 조판(분석기 데이터)이라 따로 받아 온다 */
  const [sheetHtml, setSheetHtml] = useState<{ id: string; html: string; error: string } | null>(null);
  useEffect(() => {
    if (kind !== 'analysis' || !focus) return;
    let cancelled = false;
    setSheetHtml(null);
    fetch(`${classKitApiBase}/analysis-sheet`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passageIds: [focus], format: 'html' }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!cancelled) setSheetHtml({ id: focus, html: r.ok ? String(d.html ?? '') : '', error: r.ok ? '' : String(d.error ?? '미리보기를 만들지 못했어요.') });
      })
      .catch(() => !cancelled && setSheetHtml({ id: focus, html: '', error: '미리보기를 만들지 못했어요.' }));
    return () => {
      cancelled = true;
    };
  }, [kind, focus, classKitApiBase]);

  const previewHtml = useMemo(() => {
    if (!focusDoc || kind === 'live' || kind === 'analysis') return '';
    const toks = tokenizePassageFromContent(focusDoc.content);
    const title = focusDoc.textbook;
    const number = deriveNumber(focusDoc.number);
    if (kind === 'lecture') {
      return buildLectureMaterialHtml({ title, chapter: focusDoc.chapter, number, sentences: toks.map((t) => ({ idx: t.idx, text: t.text })) });
    }
    return buildLessonMaterialHtml({
      title,
      chapter: focusDoc.chapter,
      number,
      mode: kind,
      kicker: LESSON_MODE_LABELS[kind],
      sentences: toks.map((t) => ({ idx: t.idx, en: t.text, ko: t.korean ?? '' })),
    });
  }, [focusDoc, kind]);

  const download = async (format: 'pdf' | 'zip') => {
    if (!picks.length || busy || kind === 'live') return;
    setBusy(true);
    setMsg('');
    try {
      const isLecture = kind === 'lecture';
      const res =
        kind === 'analysis'
          ? await fetch(`${classKitApiBase}/analysis-sheet`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ passageIds: picks.map((p) => p.id), format: 'pdf' }),
            })
          : await fetch(`${classKitApiBase}/${isLecture ? 'lecture' : 'lesson'}-pdf-bulk`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                textbook: picks[0].textbook,
                passageIds: picks.map((p) => p.id),
                format,
                folderByChapter: true,
                ...(isLecture ? {} : { mode: kind, kicker: LESSON_MODE_LABELS[kind as LessonMode] }),
              }),
            });
      if (res.status === 401 && onGuestGate) {
        onGuestGate();
        throw new Error('PDF 받기는 회원가입 후 이용할 수 있어요.');
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error || `받기 실패 (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const tbs = new Set(picks.map((p) => p.textbook));
      const base = (tbs.size === 1 ? picks[0].textbook : '여러교재').replace(/[\\/:*?"<>|]/g, '_');
      a.href = url;
      a.download = `${KINDS.find((k) => k.key === kind)?.label}_${base}_${picks.length}지문.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMsg(`✔ ${picks.length}개 지문을 받았어요.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const shownTextbooks = useMemo(() => {
    const q = tbQuery.trim().toLowerCase();
    return q ? textbooks.filter((t) => t.toLowerCase().includes(q)) : textbooks;
  }, [textbooks, tbQuery]);

  const curKind = KINDS.find((k) => k.key === kind)!;
  const liveHref = (id: string) => `${routeBase}/live?passage=${encodeURIComponent(id)}`;

  return (
    <ClassKitRoot>
      {isUserClassKit ? <ClassKitAccessBanner passagesApiBase={passagesApiBase} onSignup={onGuestGate} /> : null}
      <header className="shrink-0 border-b border-zinc-800/90 bg-zinc-950/80 px-4 py-3 lg:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-500/90">Class Kit</p>
            <h1 className="text-base font-bold text-white">작업 공간</h1>
          </div>
          <p className="text-xs text-zinc-500">① 왼쪽에서 지문 담기 → ② 자료 종류 → ③ 미리보고 받기</p>
          {msg ? <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200">{msg}</span> : null}
        </div>
        <div className="mt-2">
          <ClassKitTabs current="workspace" routeBase={routeBase} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ① 교재·지문 */}
        <aside className="flex max-h-[40vh] w-full shrink-0 flex-col border-b border-zinc-800 bg-zinc-950/60 lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r">
          <div className="p-3">
            <input
              value={tbQuery}
              onChange={(e) => setTbQuery(e.target.value)}
              placeholder="교재 찾기"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {shownTextbooks.map((tb) => {
              const list = tbPassages[tb];
              const nPicked = picks.filter((p) => p.textbook === tb).length;
              return (
                <div key={tb} className="mb-1">
                  <button
                    type="button"
                    onClick={() => openTextbook(tb)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] ${openTb === tb ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}
                  >
                    <span className="text-zinc-500">{openTb === tb ? '▾' : '▸'}</span>
                    <span className="min-w-0 flex-1 truncate">{tb}</span>
                    {nPicked ? <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold text-white">{nPicked}</span> : null}
                  </button>
                  {openTb === tb ? (
                    !list ? (
                      <p className="px-6 py-2 text-xs text-zinc-500">불러오는 중…</p>
                    ) : (
                      <div className="ml-4 border-l border-zinc-800 pl-2">
                        <label className="flex cursor-pointer items-center gap-2 px-1 py-1 text-xs text-zinc-400">
                          <input type="checkbox" className="accent-emerald-500" checked={list.length > 0 && list.every((p) => pickedIds.has(p._id))} onChange={() => toggleAll(tb)} />
                          전체 ({list.length})
                        </label>
                        {list.map((p) => (
                          <label key={p._id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[13px] text-zinc-200 hover:bg-zinc-900">
                            <input type="checkbox" className="accent-emerald-500" checked={pickedIds.has(p._id)} onChange={() => togglePick(p)} />
                            <span className="truncate">{labelOf(p).replace(tb, '').trim() || labelOf(p)}</span>
                          </label>
                        ))}
                      </div>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>

        {/* ② 종류 + 담은 지문 */}
        <section className="flex min-h-0 w-full shrink-0 flex-col border-b border-zinc-800 lg:w-80 lg:border-b-0 lg:border-r">
          <div className="grid grid-cols-3 gap-1 p-3">
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => setKind(k.key)}
                className={`rounded-lg px-2 py-2 text-xs font-semibold ${kind === k.key ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'}`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="px-3 text-[11px] text-zinc-500">{curKind.hint}</p>
          <div className="mt-2 flex items-center justify-between px-3 text-xs text-zinc-400">
            <span>담은 지문 {picks.length}개{picks.length >= MAX_PICKS ? ` (최대 ${MAX_PICKS})` : ''}</span>
            {picks.length ? (
              <button type="button" onClick={() => savePicks([])} className="text-zinc-500 hover:text-rose-300">
                모두 빼기
              </button>
            ) : null}
          </div>
          <ol className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {picks.length === 0 ? (
              <li className="px-3 py-8 text-center text-xs text-zinc-500">왼쪽 교재를 펼쳐 지문을 체크하세요. 여러 교재를 섞어도 돼요.</li>
            ) : (
              picks.map((p, i) => (
                <li
                  key={p.id}
                  className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] ${focus === p.id ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}
                >
                  <span className="w-5 text-right text-[11px] tabular-nums text-zinc-500">{i + 1}</span>
                  <button type="button" onClick={() => setFocus(p.id)} className="min-w-0 flex-1 truncate text-left" title={`${p.textbook} · ${p.label}`}>
                    {p.label}
                  </button>
                  {kind === 'live' ? (
                    <Link href={liveHref(p.id)} target="_blank" className="rounded px-1.5 text-xs text-emerald-400 no-underline hover:bg-zinc-800">
                      띄우기
                    </Link>
                  ) : null}
                  <button type="button" onClick={() => move(i, -1)} className="hidden rounded px-1 text-zinc-500 hover:text-zinc-200 group-hover:inline" aria-label="위로">
                    ↑
                  </button>
                  <button type="button" onClick={() => move(i, 1)} className="hidden rounded px-1 text-zinc-500 hover:text-zinc-200 group-hover:inline" aria-label="아래로">
                    ↓
                  </button>
                  <button type="button" onClick={() => savePicks(picks.filter((x) => x.id !== p.id))} className="rounded px-1 text-zinc-500 hover:text-rose-300" aria-label="빼기">
                    ×
                  </button>
                </li>
              ))
            )}
          </ol>
          <div className="border-t border-zinc-800 p-3">
            {kind === 'live' ? (
              <Link
                href={picks[0] ? liveHref(focus || picks[0].id) : '#'}
                className={`block rounded-lg px-4 py-2.5 text-center text-sm font-bold no-underline ${picks.length ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'pointer-events-none bg-zinc-800 text-zinc-500'}`}
              >
                수업 화면으로 열기
              </Link>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => download('pdf')}
                  disabled={!picks.length || busy}
                  className="flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {busy ? '만드는 중…' : `PDF 받기 (${picks.length})`}
                </button>
                {kind === 'analysis' ? null : (
                <button
                  type="button"
                  onClick={() => download('zip')}
                  disabled={!picks.length || busy}
                  className="rounded-lg border border-zinc-700 px-3 py-2.5 text-xs font-semibold text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
                  title="지문마다 PDF 한 개씩, 강별 폴더"
                >
                  ZIP
                </button>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ③ 미리보기 */}
        <main className="min-h-0 flex-1 overflow-y-auto bg-zinc-200 p-3 lg:p-5">
          {!focus ? (
            <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-zinc-500">지문을 담으면 여기에 미리보기가 떠요.</div>
          ) : !focusDoc ? (
            <div className="flex h-full items-center justify-center text-zinc-500">
              <IconSpinner />
            </div>
          ) : kind === 'live' ? (
            <div className="mx-auto max-w-3xl rounded-xl bg-white p-6 text-slate-800 shadow-sm">
              <p className="mb-3 text-sm font-bold">{labelOf(focusDoc)}</p>
              <ol className="space-y-2 text-[15px] leading-relaxed">
                {tokenizePassageFromContent(focusDoc.content).map((t) => (
                  <li key={t.idx} className="flex gap-2">
                    <span className="w-5 shrink-0 text-right text-xs text-slate-400">{t.idx + 1}</span>
                    <span>{t.text}</span>
                  </li>
                ))}
              </ol>
              <Link href={liveHref(focusDoc._id)} target="_blank" className="mt-5 inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white no-underline hover:bg-emerald-500">
                이 지문 수업 화면으로 띄우기 ↗
              </Link>
            </div>
          ) : kind === 'analysis' ? (
            !sheetHtml || sheetHtml.id !== focus ? (
              <div className="flex h-full items-center justify-center text-zinc-500">
                <IconSpinner />
              </div>
            ) : sheetHtml.error ? (
              <div className="mx-auto max-w-lg rounded-xl bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
                <p className="font-semibold text-slate-800">{sheetHtml.error}</p>
                <p className="mt-2 text-xs text-slate-500">종합분석지는 지문분석기로 분석된 지문만 만들어져요. 다른 지문을 골라 보세요.</p>
              </div>
            ) : (
              <iframe title="종합분석지 미리보기" srcDoc={sheetHtml.html} className="mx-auto block w-full max-w-[900px] rounded-lg bg-white shadow-sm" style={{ height: '82vh', border: 'none' }} />
            )
          ) : (
            <iframe title="미리보기" srcDoc={previewHtml} className="mx-auto block w-full max-w-[900px] rounded-lg bg-white shadow-sm" style={{ height: '82vh', border: 'none' }} />
          )}
        </main>
      </div>
    </ClassKitRoot>
  );
}
