'use client';

/**
 * 수업 화면 — 교실 화면(프로젝터·전자칠판)에 지문을 띄워 놓고 수업하는 화면.
 *   · 문장을 누르면 분석 패널(듣기·끊어읽기·성분·해석·문법·단어)
 *   · 글자를 드래그하면 그 부분만 듣기
 *   · 판서(펜·형광펜·지우개), 글자 크기, 전체 화면
 *   · 주제·요지·흐름 등 종합분석은 위쪽 칩으로
 * 인쇄물이 아니라 화면 수업용이라 DB 저장 없음(판서는 지문을 바꿔도 이 화면 안에서는 남아 있다).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PassagePickerModal, { type PassageItem } from '../../_components/PassagePickerModal';
import ClassKitTabs from '../ClassKitTabs';
import {
  ClassKitAccessBanner,
  ClassKitHeader,
  ClassKitIconButton,
  ClassKitPassageNav,
  ClassKitRoot,
  IconSpinner,
} from '../_components/ClassKitUI';
import type { LivePassagePayload } from '@/lib/passage-live-analysis';
import { chunkSentence } from '@/lib/passage-live-chunks';
import { speak, stopSpeaking, ttsSupported, type TtsRate } from './live-tts';
import { LiveFloatingPanel } from './LiveFloatingPanel';
import { LiveSentencePanelBody } from './LiveSentencePanel';
import { INK_COLORS, LiveInkLayer, type InkStroke, type InkTool } from './LiveInkLayer';

const LAST_PASSAGE_KEY = 'class_kit_live_last_passage_id';
const PREFS_KEY = 'class_kit_live_prefs';
const ZOOM_STEPS = [80, 90, 100, 115, 130, 150, 175, 200] as const;

type ViewMode = 'both' | 'en' | 'hideKo';
type Prefs = { view: ViewMode; breaks: boolean; topic: boolean; zoom: number; rate: TtsRate; svoc: boolean };
const DEFAULT_PREFS: Prefs = { view: 'both', breaks: false, topic: true, zoom: 115, rate: 'normal', svoc: true };

export interface ClassKitLiveViewProps {
  passagesApiBase?: string;
  routeBase?: string;
  homeHref?: string;
  onGuestGate?: () => void;
}

function IconPen() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.86 4.49l2.65 2.65M4 20l4.2-.9L19.1 8.2a1.9 1.9 0 000-2.66l-.64-.64a1.9 1.9 0 00-2.66 0L4.9 15.8 4 20z" />
    </svg>
  );
}
function IconExpand() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}
function IconSpeaker() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" />
    </svg>
  );
}

export function ClassKitLiveView({
  passagesApiBase = '/api/admin/passages',
  routeBase = '/admin/class-kit',
  homeHref,
  onGuestGate,
}: ClassKitLiveViewProps = {}) {
  const [passage, setPassage] = useState<PassageItem | null>(null);
  const [data, setData] = useState<LivePassagePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [siblings, setSiblings] = useState<PassageItem[]>([]);
  const [siblingsTextbook, setSiblingsTextbook] = useState('');

  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealedKo, setRevealedKo] = useState<Set<number>>(new Set());
  const [readingIdx, setReadingIdx] = useState<number | null>(null);
  const [selPop, setSelPop] = useState<{ x: number; y: number; text: string } | null>(null);
  const [overviewOpen, setOverviewOpen] = useState<string | null>(null);

  const [inkOn, setInkOn] = useState(false);
  const [inkTool, setInkTool] = useState<InkTool>('pen');
  const [inkColor, setInkColor] = useState<string>(INK_COLORS[1]);
  const [inkByPassage, setInkByPassage] = useState<Record<string, InkStroke[]>>({});
  const [fullscreen, setFullscreen] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  /** 듣기 지원 여부 — 서버 렌더와 첫 화면을 맞추려고 마운트 뒤에 판정 */
  const [canSpeak, setCanSpeak] = useState(false);
  useEffect(() => setCanSpeak(ttsSupported()), []);
  const isUserClassKit = !passagesApiBase.startsWith('/api/admin');

  // 설정·마지막 지문 복원(마운트 후)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) });
      const pid = localStorage.getItem(LAST_PASSAGE_KEY);
      if (pid) {
        fetch(`${passagesApiBase}/${encodeURIComponent(pid)}`, { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d?.item && setPassage(d.item as PassageItem))
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, [passagesApiBase]);

  const updPrefs = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  // 지문 + 분석 불러오기
  useEffect(() => {
    if (!passage) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setSelected(null);
    setRevealedKo(new Set());
    setOverviewOpen(null);
    stopSpeaking();
    setReadingIdx(null);
    fetch(`${passagesApiBase}/${encodeURIComponent(passage._id)}/live`, { credentials: 'include' })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || '지문을 불러오지 못했습니다.');
        return d as LivePassagePayload;
      })
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => {
        if (cancelled) return;
        setData(null);
        setError(e.message);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [passage, passagesApiBase]);

  // 같은 교재 지문 목록(좌우 이동)
  useEffect(() => {
    const tb = passage?.textbook;
    if (!tb || tb === siblingsTextbook) return;
    let cancelled = false;
    fetch(`${passagesApiBase}?textbook=${encodeURIComponent(tb)}&limit=500`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setSiblings(Array.isArray(d.items) ? (d.items as PassageItem[]) : []);
        setSiblingsTextbook(tb);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [passage?.textbook, siblingsTextbook, passagesApiBase]);

  useEffect(() => () => stopSpeaking(), []);

  const curIndex = useMemo(() => (passage ? siblings.findIndex((s) => s._id === passage._id) : -1), [siblings, passage]);
  const handlePick = (p: PassageItem) => {
    setPassage(p);
    setShowPicker(false);
    try {
      localStorage.setItem(LAST_PASSAGE_KEY, p._id);
    } catch {
      /* ignore */
    }
  };
  const goSibling = (dir: -1 | 1) => {
    const ni = curIndex + dir;
    if (curIndex >= 0 && ni >= 0 && ni < siblings.length) handlePick(siblings[ni]);
  };

  const sentences = data?.sentences ?? [];
  const topicSet = useMemo(() => new Set(data?.topicSentences ?? []), [data]);
  const vocabFor = useCallback((i: number) => (data?.vocabulary ?? []).filter((v) => v.sentences.includes(i)), [data]);

  // 문장 패널: ← → 로 이동, Esc 로 닫기
  useEffect(() => {
    if (selected === null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea')) return;
      if (e.key === 'Escape') setSelected(null);
      if (e.key === 'ArrowRight') setSelected((s) => (s === null ? s : Math.min(s + 1, sentences.length - 1)));
      if (e.key === 'ArrowLeft') setSelected((s) => (s === null ? s : Math.max(s - 1, 0)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, sentences.length]);

  // 전체 화면 상태 추적
  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen?.().catch(() => {});
  };

  /** 드래그로 고른 글자 → 듣기 버튼 */
  const onBoardMouseUp = () => {
    if (inkOn) return;
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().replace(/\s+/g, ' ').trim() : '';
    if (!text || !sel || !boardRef.current?.contains(sel.anchorNode) || !/[A-Za-z]/.test(text)) {
      setSelPop(null);
      return;
    }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setSelPop({ x: r.left + r.width / 2, y: r.top, text });
  };

  const readAll = () => {
    if (readingIdx !== null) {
      stopSpeaking();
      setReadingIdx(null);
      return;
    }
    speak(sentences, prefs.rate, { onIndex: (i) => setReadingIdx(i), onEnd: () => setReadingIdx(null) });
  };

  const zoomBy = (dir: -1 | 1) => {
    const i = ZOOM_STEPS.findIndex((z) => z >= prefs.zoom);
    const ni = Math.min(Math.max((i < 0 ? 2 : i) + dir, 0), ZOOM_STEPS.length - 1);
    updPrefs({ zoom: ZOOM_STEPS[ni] });
  };

  const strokes = (passage && inkByPassage[passage._id]) || [];
  const setStrokes = (next: InkStroke[]) => passage && setInkByPassage((m) => ({ ...m, [passage._id]: next }));

  const overviewTabs = useMemo(() => {
    const tabs: { key: string; label: string }[] = (data?.overview ?? []).map(([k]) => ({ key: k, label: k }));
    if (data?.vocabulary.length) tabs.push({ key: '__vocab', label: '어휘' });
    return tabs;
  }, [data]);

  const seg = (active: boolean) =>
    `rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${active ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'}`;
  const toggle = (on: boolean) =>
    `rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${on ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-100'}`;

  return (
    <ClassKitRoot>
      {isUserClassKit ? <ClassKitAccessBanner passagesApiBase={passagesApiBase} onSignup={onGuestGate} /> : null}
      <ClassKitHeader
        homeHref={homeHref ?? `${routeBase}/live`}
        onLoadPassage={() => setShowPicker(true)}
        passageInfo={
          passage ? (
            <ClassKitPassageNav
              onPrev={() => goSibling(-1)}
              onNext={() => goSibling(1)}
              hasPrev={curIndex > 0}
              hasNext={curIndex >= 0 && curIndex < siblings.length - 1}
              chapter={passage.chapter}
              number={passage.number}
              sourceKey={passage.source_key}
              sentenceCount={sentences.length}
              position={curIndex >= 0 && siblings.length > 0 ? `${curIndex + 1}/${siblings.length}` : undefined}
            />
          ) : undefined
        }
        actions={
          <>
            <ClassKitIconButton onClick={() => setInkOn((v) => !v)} disabled={!data} title="판서 (펜·형광펜·지우개)" label="판서">
              <IconPen />
            </ClassKitIconButton>
            <ClassKitIconButton onClick={toggleFullscreen} disabled={!data} title="전체 화면 (프로젝터·전자칠판)" label="전체 화면">
              <IconExpand />
            </ClassKitIconButton>
          </>
        }
        tabs={<ClassKitTabs current="live" routeBase={routeBase} />}
      />

      {/* 보기 설정 줄 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800/80 bg-zinc-950/70 px-4 py-2 lg:px-5">
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/80 p-0.5">
          {([
            ['both', '영·한 나란히'],
            ['en', '영어만'],
            ['hideKo', '해석 가리기'],
          ] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => updPrefs({ view: k })} className={seg(prefs.view === k)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => updPrefs({ breaks: !prefs.breaks })} className={toggle(prefs.breaks)} title="분석기의 끊어읽기 위치에 / 표시">
          끊어읽기 /
        </button>
        <button type="button" onClick={() => updPrefs({ topic: !prefs.topic })} className={toggle(prefs.topic)} title="주제문 강조">
          주제문
        </button>
        {canSpeak ? (
          <div className="flex items-center gap-1">
            <button type="button" onClick={readAll} disabled={!sentences.length} className={toggle(readingIdx !== null)}>
              <span className="inline-flex items-center gap-1">
                <IconSpeaker />
                {readingIdx !== null ? '■ 멈춤' : '지문 듣기'}
              </span>
            </button>
            <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/80 p-0.5">
              {(['slow', 'normal'] as const).map((r) => (
                <button key={r} type="button" onClick={() => updPrefs({ rate: r })} className={seg(prefs.rate === r)}>
                  {r === 'slow' ? '천천히' : '보통'}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {/* 좁은 화면에서는 오른쪽 도구 막대 대신 여기서 글자 크기 */}
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/80 p-0.5 md:hidden">
          <button type="button" onClick={() => zoomBy(-1)} className={seg(false)} aria-label="작게">
            －
          </button>
          <span className="px-1 text-[11px] tabular-nums text-zinc-400">{prefs.zoom}%</span>
          <button type="button" onClick={() => zoomBy(1)} className={seg(false)} aria-label="크게">
            ＋
          </button>
        </div>
        <div className="flex-1" />
        {data && !data.hasAnalysis ? (
          <span className="text-[11px] text-zinc-500">이 지문은 분석 전 — 문장·해석·듣기만 보여요</span>
        ) : null}
      </div>

      {/* 칠판 */}
      <div ref={stageRef} className="relative flex min-h-0 flex-1 overflow-hidden bg-zinc-200">
        <div className="min-h-0 flex-1 overflow-y-auto" onScroll={() => setSelPop(null)}>
          {!passage ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-600">
              <p className="text-sm">지문을 불러오면 교실 화면에 그대로 띄워 수업할 수 있어요.</p>
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                지문 불러오기
              </button>
            </div>
          ) : loading && !data ? (
            <div className="flex h-full items-center justify-center text-zinc-500">
              <IconSpinner />
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-sm text-rose-600">{error}</div>
          ) : data ? (
            <div className="mx-auto my-4 w-full max-w-5xl px-3 sm:my-6">
              <article
                className="relative rounded-xl bg-white px-5 py-6 text-slate-900 shadow-sm sm:px-10 sm:py-8"
                style={{ fontSize: `${prefs.zoom}%` }}
              >
                <header className="mb-4 flex flex-wrap items-end gap-x-3 gap-y-2 border-b-2 border-slate-900 pb-3">
                  <h2 className="text-[1.25em] font-bold">
                    {data.passage.sourceKey || `${data.passage.chapter} ${data.passage.number}`}
                  </h2>
                  <span className="text-[0.8em] text-slate-400">{data.passage.textbook}</span>
                  <div className="flex-1" />
                  {overviewTabs.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {overviewTabs.map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setOverviewOpen(t.key)}
                          className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[0.75em] font-semibold text-sky-700 hover:bg-sky-100"
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </header>

                <div ref={boardRef} className="relative" onMouseUp={onBoardMouseUp}>
                  <ol className="space-y-1">
                    {sentences.map((s, i) => {
                      const ko = data.koreanSentences[i];
                      const isSel = selected === i;
                      const isReading = readingIdx === i;
                      const isTopic = prefs.topic && topicSet.has(i);
                      const text = prefs.breaks && data.breaks[i] ? chunkSentence(s, data.breaks[i]).join('  /  ') : s;
                      return (
                        <li
                          key={i}
                          onClick={() => {
                            const sel = window.getSelection();
                            if (inkOn || (sel && !sel.isCollapsed)) return;
                            setSelPop(null);
                            setSelected(i);
                          }}
                          className={`grid cursor-pointer gap-x-6 rounded-lg px-2 py-2 transition-colors ${
                            prefs.view === 'both' ? 'md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]' : ''
                          } ${isSel ? 'bg-amber-100' : isReading ? 'bg-emerald-50' : 'hover:bg-indigo-50/70'}`}
                        >
                          <p className="flex gap-2 leading-[2]">
                            <span className="mt-[0.35em] w-5 shrink-0 text-right text-[0.7em] text-slate-400">{i + 1}</span>
                            <span className={isTopic ? 'underline decoration-amber-400 decoration-[3px] underline-offset-4' : ''}>
                              {text}
                            </span>
                          </p>
                          {prefs.view === 'both' && ko ? (
                            <p className="pl-7 text-[0.88em] leading-[1.9] text-slate-600 md:pl-0">{ko}</p>
                          ) : prefs.view === 'hideKo' && ko ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRevealedKo((m) => {
                                  const n = new Set(m);
                                  if (n.has(i)) n.delete(i);
                                  else n.add(i);
                                  return n;
                                });
                              }}
                              className={`ml-7 mt-1 rounded-md px-2 py-1 text-left text-[0.85em] ${
                                revealedKo.has(i) ? 'bg-slate-50 text-slate-600' : 'bg-slate-100 text-transparent [text-shadow:0_0_8px_rgba(100,116,139,0.6)]'
                              }`}
                              title={revealedKo.has(i) ? '해석 가리기' : '해석 보기'}
                            >
                              {ko}
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                  <LiveInkLayer active={inkOn} tool={inkTool} color={inkColor} strokes={strokes} onChange={setStrokes} />
                </div>
              </article>
            </div>
          ) : null}
        </div>

        {/* 오른쪽 도구 막대 — 판서·확대·전체 화면 */}
        {data ? (
          <div className="absolute right-3 top-3 z-30 hidden flex-col items-center gap-1 rounded-xl border border-zinc-300 bg-white/95 p-1 text-slate-700 shadow md:flex">
            <button type="button" onClick={() => setInkOn((v) => !v)} className={`flex h-10 w-10 flex-col items-center justify-center rounded-lg text-[10px] ${inkOn ? 'bg-emerald-600 text-white' : 'hover:bg-slate-100'}`} title="판서">
              <IconPen />
              판서
            </button>
            <button type="button" onClick={() => zoomBy(1)} className="h-9 w-10 rounded-lg text-lg hover:bg-slate-100" title="크게">
              ＋
            </button>
            <span className="text-[11px] tabular-nums text-slate-500">{prefs.zoom}%</span>
            <button type="button" onClick={() => zoomBy(-1)} className="h-9 w-10 rounded-lg text-lg hover:bg-slate-100" title="작게">
              －
            </button>
            <button type="button" onClick={toggleFullscreen} className="flex h-9 w-10 items-center justify-center rounded-lg hover:bg-slate-100" title={fullscreen ? '전체 화면 끝내기' : '전체 화면'}>
              <IconExpand />
            </button>
          </div>
        ) : null}

        {/* 판서 도구 */}
        {inkOn && data ? (
          <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-2xl border border-zinc-300 bg-white/95 px-2 py-1.5 text-slate-700 shadow-lg">
            {([
              ['pen', '펜'],
              ['highlighter', '형광펜'],
              ['eraser', '지우개'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setInkTool(k)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${inkTool === k ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'}`}
              >
                {label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-slate-200" />
            {INK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setInkColor(c);
                  if (inkTool === 'eraser') setInkTool('pen');
                }}
                className={`h-6 w-6 rounded-full ring-offset-2 ${inkColor === c ? 'ring-2 ring-slate-500' : ''}`}
                style={{ background: c }}
                aria-label={`색 ${c}`}
              />
            ))}
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <button type="button" onClick={() => setStrokes(strokes.slice(0, -1))} disabled={!strokes.length} className="rounded-lg px-2 py-1.5 text-xs hover:bg-slate-100 disabled:opacity-40" title="되돌리기">
              ↶ 되돌리기
            </button>
            <button type="button" onClick={() => setStrokes([])} disabled={!strokes.length} className="rounded-lg px-2 py-1.5 text-xs hover:bg-slate-100 disabled:opacity-40">
              모두 지우기
            </button>
            <button type="button" onClick={() => setInkOn(false)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">
              판서 끝
            </button>
          </div>
        ) : null}

        {/* 드래그한 글자 듣기 */}
        {selPop && canSpeak ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              speak(selPop.text, prefs.rate);
              setSelPop(null);
            }}
            className="fixed z-[55] -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-slate-700"
            style={{ left: selPop.x, top: selPop.y - 6 }}
          >
            ▶ 듣기
          </button>
        ) : null}

        {/* 문장 분석 패널 */}
        {data && selected !== null && sentences[selected] ? (
          <LiveFloatingPanel
            storageKey="class_kit_live_sentence_panel"
            defaultBox={() => ({ x: window.innerWidth - 640, y: 150, w: 600, h: 440 })}
            title={
              <span>
                {data.passage.sourceKey || data.passage.number} › {selected + 1}번 문장
              </span>
            }
            headerExtra={
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setSelected(Math.max(selected - 1, 0))} disabled={selected === 0} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-30" title="이전 문장 (←)">
                  ‹
                </button>
                <button type="button" onClick={() => setSelected(Math.min(selected + 1, sentences.length - 1))} disabled={selected === sentences.length - 1} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-30" title="다음 문장 (→)">
                  ›
                </button>
              </div>
            }
            onClose={() => setSelected(null)}
          >
            <LiveSentencePanelBody
              sentence={sentences[selected]}
              korean={data.koreanSentences[selected]}
              breaks={data.breaks[selected]}
              svoc={data.svoc[selected]}
              grammarPoints={data.grammarPoints[selected]}
              vocab={vocabFor(selected)}
              rate={prefs.rate}
              onRate={(r) => updPrefs({ rate: r })}
              showSvoc={prefs.svoc}
              onToggleSvoc={() => updPrefs({ svoc: !prefs.svoc })}
            />
          </LiveFloatingPanel>
        ) : null}

        {/* 종합분석 패널 */}
        {data && overviewOpen ? (
          <LiveFloatingPanel
            storageKey="class_kit_live_overview_panel"
            defaultBox={() => ({ x: 80, y: 150, w: 520, h: 380 })}
            accent="sky"
            title={<span>{data.passage.sourceKey || data.passage.number} · 지문 분석</span>}
            onClose={() => setOverviewOpen(null)}
          >
            <div className="flex flex-wrap gap-1 border-b border-slate-200 px-3 pt-2">
              {overviewTabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setOverviewOpen(t.key)}
                  className={`rounded-t-lg px-3 py-1.5 text-xs font-semibold ${overviewOpen === t.key ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="p-4 text-[0.95rem] leading-relaxed text-slate-800">
              {overviewOpen === '__vocab' ? (
                <table className="w-full text-sm">
                  <tbody>
                    {data.vocabulary.map((v) => (
                      <tr key={v.word} className="border-b border-slate-100">
                        <td className="py-1.5 pr-3">
                          <button type="button" onClick={() => canSpeak && speak(v.word, prefs.rate)} className="font-semibold hover:text-sky-700" title="발음 듣기">
                            {v.word}
                          </button>
                          {v.pos ? <span className="ml-1 text-[11px] text-slate-400">{v.pos}</span> : null}
                        </td>
                        <td className="py-1.5 text-slate-600">{v.meaning}</td>
                        <td className="py-1.5 text-right text-[11px] text-slate-400">
                          {v.sentences.map((n) => n + 1).join('·')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="whitespace-pre-wrap">{data.overview.find(([k]) => k === overviewOpen)?.[1]}</p>
              )}
            </div>
          </LiveFloatingPanel>
        ) : null}
      </div>

      {showPicker && (
        <PassagePickerModal
          onSelect={handlePick}
          onClose={() => setShowPicker(false)}
          lastTextbookKey="class_kit_live_last_textbook"
          showCounts={false}
          passagesApiBase={passagesApiBase}
          onSignupRequest={onGuestGate}
        />
      )}
    </ClassKitRoot>
  );
}
