'use client';

/**
 * 자주 쓰는 메뉴 — 홈·내 정보 위쪽 바로가기 줄.
 * 회원은 계정(users.quickMenu)에, 비회원은 이 브라우저(localStorage)에 저장한다.
 * 홈 서비스 카드의 ☆(PinButton)와 같은 상태를 쓰도록 Provider 로 묶는다.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { QUICK_MENU_ITEMS, QUICK_MENU_MAX, QUICK_MENU_SUGGESTED, quickMenuItem, sanitizeQuickMenu } from '@/lib/quick-menu';

const LS_KEY = 'quick_menu_items';

type Ctx = {
  ready: boolean;
  /** null = 아직 한 번도 고르지 않음 */
  items: string[] | null;
  isMember: boolean;
  toggle: (id: string) => void;
  setItems: (next: string[]) => void;
  full: boolean;
};

const QuickMenuContext = createContext<Ctx | null>(null);

function readLocal(): string[] | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? sanitizeQuickMenu(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function QuickMenuProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [items, setItemsState] = useState<string[] | null>(null);
  const [isMember, setIsMember] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 연달아 누를 때도 최신 목록을 기준으로 — 상태 반영 전에 다음 클릭이 와도 덮어쓰지 않게 */
  const latest = useRef<string[] | null>(null);
  latest.current = items;

  useEffect(() => {
    let alive = true;
    fetch('/api/my/quick-menu', { credentials: 'include' })
      .then(async (r) => {
        if (!alive) return;
        const local = readLocal();
        if (r.status === 401) {
          setItemsState(local);
          return;
        }
        const d = (await r.json().catch(() => ({}))) as { items?: string[] | null };
        setIsMember(true);
        if (Array.isArray(d.items)) setItemsState(d.items);
        else if (local?.length) {
          // 로그인 전 이 브라우저에서 모아 둔 것을 계정으로 옮긴다
          setItemsState(local);
          void fetch('/api/my/quick-menu', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: local }),
          }).catch(() => {});
        }
      })
      .catch(() => alive && setItemsState(readLocal()))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback(
    (next: string[]) => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      if (!isMember) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void fetch('/api/my/quick-menu', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: next }),
        }).catch(() => {});
      }, 400);
    },
    [isMember],
  );

  const setItems = useCallback(
    (next: string[]) => {
      const clean = sanitizeQuickMenu(next);
      latest.current = clean;
      setItemsState(clean);
      persist(clean);
    },
    [persist],
  );

  const toggle = useCallback(
    (id: string) => {
      const cur = latest.current ?? [];
      if (cur.includes(id)) setItems(cur.filter((x) => x !== id));
      else if (cur.length < QUICK_MENU_MAX) setItems([...cur, id]);
    },
    [setItems],
  );

  const value = useMemo<Ctx>(
    () => ({ ready, items, isMember, toggle, setItems, full: (items?.length ?? 0) >= QUICK_MENU_MAX }),
    [ready, items, isMember, toggle, setItems],
  );
  return <QuickMenuContext.Provider value={value}>{children}</QuickMenuContext.Provider>;
}

/** 서비스 카드 모서리의 ☆ — Provider 밖이면 아무것도 그리지 않는다 */
export function PinButton({ id, title }: { id: string; title: string }) {
  const ctx = useContext(QuickMenuContext);
  if (!ctx?.ready) return null;
  const on = (ctx.items ?? []).includes(id);
  const disabled = !on && ctx.full;
  return (
    <button
      type="button"
      onClick={() => ctx.toggle(id)}
      disabled={disabled}
      aria-pressed={on}
      title={on ? `자주 쓰는 메뉴에서 빼기` : disabled ? `자주 쓰는 메뉴는 ${QUICK_MENU_MAX}개까지예요` : `「${title}」 자주 쓰는 메뉴에 담기`}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg leading-none transition-colors ${
        on ? 'text-amber-500 hover:bg-amber-50' : 'text-slate-300 hover:bg-slate-100 hover:text-amber-500'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {on ? '★' : '☆'}
    </button>
  );
}

export function QuickMenuBar({ className = '' }: { className?: string }) {
  const ctx = useContext(QuickMenuContext);
  const [editing, setEditing] = useState(false);
  if (!ctx?.ready) return <div className={`h-[58px] ${className}`} aria-hidden />;
  const { items, setItems, full, isMember } = ctx;
  const chosen = items ?? [];
  const shown = items === null ? QUICK_MENU_SUGGESTED : chosen;

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= chosen.length) return;
    const next = [...chosen];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };

  return (
    <section className={`rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm ${className}`} aria-label="자주 쓰는 메뉴">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-slate-900">⭐ 자주 쓰는 메뉴</span>
        {items === null ? <span className="text-xs text-slate-500">추천 — 카드의 ☆ 로 나만의 메뉴를 모아요</span> : null}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${editing ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          {editing ? '완료' : '편집'}
        </button>
      </div>

      {!editing ? (
        shown.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">비어 있어요. 「편집」이나 아래 카드의 ☆ 로 담아 보세요.</p>
        ) : (
          <nav className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {shown.map((id) => {
              const it = quickMenuItem(id);
              if (!it) return null;
              return (
                <Link
                  key={id}
                  href={it.href}
                  prefetch={false}
                  className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold no-underline transition-colors ${
                    items === null ? 'border-dashed border-slate-300 text-slate-600 hover:border-slate-500' : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-[#2563eb] hover:bg-white'
                  }`}
                >
                  <span aria-hidden>{it.icon}</span>
                  {it.title}
                </Link>
              );
            })}
          </nav>
        )
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-500">
              담은 메뉴 {chosen.length}/{QUICK_MENU_MAX} {isMember ? '· 계정에 저장돼요' : '· 이 브라우저에 저장돼요(로그인하면 계정으로 옮겨져요)'}
            </p>
            {chosen.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">오른쪽에서 + 로 담아요</p>
            ) : (
              <ol className="space-y-1">
                {chosen.map((id, i) => {
                  const it = quickMenuItem(id);
                  if (!it) return null;
                  return (
                    <li key={id} className="flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1.5 text-sm">
                      <span aria-hidden>{it.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{it.title}</span>
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="h-7 w-7 rounded text-slate-500 hover:bg-white disabled:opacity-30" aria-label="앞으로">
                        ↑
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === chosen.length - 1} className="h-7 w-7 rounded text-slate-500 hover:bg-white disabled:opacity-30" aria-label="뒤로">
                        ↓
                      </button>
                      <button type="button" onClick={() => setItems(chosen.filter((x) => x !== id))} className="h-7 w-7 rounded text-slate-400 hover:bg-white hover:text-rose-600" aria-label="빼기">
                        ×
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-500">담을 수 있는 메뉴</p>
            <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
              {QUICK_MENU_ITEMS.filter((it) => !chosen.includes(it.id)).map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setItems([...chosen, it.id])}
                  disabled={full}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 hover:border-[#2563eb] hover:text-[#1d4ed8] disabled:opacity-40"
                >
                  <span aria-hidden>{it.icon}</span>+ {it.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
