'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppBar from '@/app/components/AppBar';
import { BOOK_VARIANT_QUESTION_TYPES } from '@/lib/book-variant-types';
import {
  variantTypePointCostPerDraft,
  variantTypeRequiresHardInsertionPoints,
} from '@/lib/member-variant-points';
import { membershipPricingOneLiner } from '@/lib/membership-pricing';
import {
  byokAnthropicStorageKey,
  hasStoredByokAnthropicKey,
  readStoredByokAnthropicKey,
} from '@/lib/member-byok-anthropic-key-storage';
import {
  dismissVariantGenerateNoticeForTodayKst,
  dismissVariantGenerateNoticeThisSession,
  resetVariantGenerateNoticeDismissals,
  shouldShowVariantGenerateNotice,
} from '@/lib/variant-generate-notice-dismiss';
import QuestionFriendlyPreview from './QuestionFriendlyPreview';
import VariantSourceLoader from './VariantSourceLoader';
import MyMemberVariants from './MyMemberVariants';

const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

const TYPE_GROUPS: { label: string; types: string[] }[] = [
  { label: '내용 파악', types: ['주제', '제목', '주장'] },
  { label: '세부 정보', types: ['일치', '불일치'] },
  { label: '추론', types: ['함의', '빈칸', '요약'] },
  /** 포인트 차감 유형(예: 삽입-고난도)은 아래 `포인트 사용 유형` 블록에서만 노출 */
  { label: '언어·구조', types: ['어법', '순서', '삽입', '무관한문장'] },
];

const PAID_VARIANT_TYPES = (BOOK_VARIANT_QUESTION_TYPES as readonly string[]).filter((t) =>
  variantTypeRequiresHardInsertionPoints(t),
);

type VariantDraftItem = {
  type: string;
  passage_id: string;
  question_data: Record<string, unknown>;
};

export default function MemberVariantGeneratePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [deniedReason, setDeniedReason] = useState<null | 'login' | 'premium'>(null);
  const [loginId, setLoginId] = useState('');
  const [byokKeyStored, setByokKeyStored] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null);
  const [paragraph, setParagraph] = useState('');
  const [textbook, setTextbook] = useState('');
  const [source, setSource] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['주제']);
  const [userHint, setUserHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [drafts, setDrafts] = useState<VariantDraftItem[]>([]);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [editMode, setEditMode] = useState(false);
  /** 초안이 여러 개일 때 보고 있는 인덱스 */
  const [activeDraftIdx, setActiveDraftIdx] = useState(0);
  const [myListOpen, setMyListOpen] = useState(false);
  const [keyInfoOpen, setKeyInfoOpen] = useState(false);
  const keyInfoWrapRef = useRef<HTMLDivElement>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const msgTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 유형 칩 러버밴드(드래그) 선택 */
  const variantChipMarqueeRef = useRef<HTMLDivElement>(null);
  const marqueeSuppressClickRef = useRef(false);
  const marqueeDragRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
    pointerId: number;
  } | null>(null);
  const [marqueeBox, setMarqueeBox] = useState<null | { left: number; top: number; width: number; height: number }>(
    null,
  );

  const charCount = paragraph.length;
  const wordCount = useMemo(
    () => paragraph.trim().split(/\s+/).filter(Boolean).length,
    [paragraph],
  );

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(100, Math.min(el.scrollHeight, 500))}px`;
  }, []);

  useEffect(() => { autoGrow(); }, [paragraph, autoGrow]);

  /** 언마운트·탭 이탈 시 드래그 리스너 정리 */
  const marqueeListenersCleanupRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      marqueeListenersCleanupRef.current?.();
      marqueeListenersCleanupRef.current = null;
      setMarqueeBox(null);
      document.body.style.userSelect = '';
    },
    [],
  );

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const showMessage = useCallback((msg: { kind: 'ok' | 'err'; text: string }, autoHide = false) => {
    if (msgTimeoutRef.current) clearTimeout(msgTimeoutRef.current);
    setMessage(msg);
    if (autoHide) {
      msgTimeoutRef.current = setTimeout(() => setMessage(null), 5000);
    }
  }, []);

  useEffect(() => {
    setNoticeVisible(shouldShowVariantGenerateNotice());
  }, []);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.user) { setDeniedReason('login'); router.replace('/login?from=/my/premium/variant-generate'); return; }
        const premium = d.user.isPremiumMember === true;
        setIsPremium(premium);
        const trial = d.user.variantTrial;
        if (!premium && (!trial || !trial.eligible)) { setDeniedReason('premium'); return; }
        if (!premium && trial?.eligible) setTrialDaysLeft(trial.daysLeft ?? 0);
        const id = typeof d.user.loginId === 'string' ? d.user.loginId : '';
        setLoginId(id);
        setByokKeyStored(id ? hasStoredByokAnthropicKey(id) : false);
        setDeniedReason(null);
      })
      .catch(() => { setDeniedReason('login'); router.replace('/login?from=/my/premium/variant-generate'); })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    setActiveDraftIdx((idx) => {
      if (drafts.length === 0) return 0;
      return Math.min(idx, drafts.length - 1);
    });
  }, [drafts.length]);

  useEffect(() => {
    if (!loginId) return;
    const sync = () => setByokKeyStored(hasStoredByokAnthropicKey(loginId));
    const onVis = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', sync);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', sync); };
  }, [loginId]);

  useEffect(() => {
    if (!loginId) return;
    const storageKey = byokAnthropicStorageKey(loginId);
    const onStorage = (e: StorageEvent) => { if (e.key === storageKey) setByokKeyStored(hasStoredByokAnthropicKey(loginId)); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [loginId]);

  useEffect(() => {
    if (!byokKeyStored) setKeyInfoOpen(false);
  }, [byokKeyStored]);

  useEffect(() => {
    if (!keyInfoOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = keyInfoWrapRef.current;
      if (el && !el.contains(e.target as Node)) setKeyInfoOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [keyInfoOpen]);

  /** 초안 만들기 전 필수 입력 — API 키는 상단에 이미 표시되므로, 저장된 경우 체크리스트에서 생략 */
  const generateReadinessSteps = useMemo(() => {
    const base = [
      {
        key: 'paragraph' as const,
        done: charCount >= 10,
        label: '영어 지문 10자 이상',
        hint: '지문을 붙여 넣거나 소스에서 불러오세요.',
        scrollId: 'variant-step-paragraph',
      },
      {
        key: 'types' as const,
        done: selectedTypes.length > 0,
        label: '문제 유형 1개 이상',
        hint: '아래에서 만들 유형을 선택하세요.',
        scrollId: 'variant-step-types',
      },
    ];
    if (byokKeyStored) return base;
    return [
      ...base,
      {
        key: 'api' as const,
        done: false,
        label: 'API 키 등록',
        hint: '내 정보(탭)에서 키를 저장해야 합니다.',
        scrollId: 'variant-editor-top',
      },
    ];
  }, [charCount, selectedTypes.length, byokKeyStored]);

  const canGenerate = generateReadinessSteps.every((s) => s.done);
  const firstBlockingStep = generateReadinessSteps.find((s) => !s.done) ?? null;

  const toggleType = (t: string) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  };

  const marqueeRectFromPoints = useCallback((x0: number, y0: number, x1: number, y1: number) => {
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const width = Math.max(1, Math.abs(x1 - x0));
    const height = Math.max(1, Math.abs(y1 - y0));
    return { left, top, width, height };
  }, []);

  const rectIntersectsMarquee = useCallback(
    (chip: DOMRect, box: { left: number; top: number; width: number; height: number }) => {
      const bx2 = box.left + box.width;
      const by2 = box.top + box.height;
      return chip.left < bx2 && chip.right > box.left && chip.top < by2 && chip.bottom > box.top;
    },
    [],
  );

  const handleVariantChipMarqueePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || busy) return;
      const root = variantChipMarqueeRef.current;
      if (!root?.contains(e.target as Node)) return;

      const startX = e.clientX;
      const startY = e.clientY;
      marqueeDragRef.current = { startX, startY, active: false, pointerId: e.pointerId };

      const onMove = (ev: PointerEvent) => {
        const d = marqueeDragRef.current;
        if (!d) return;
        const dx = ev.clientX - d.startX;
        const dy = ev.clientY - d.startY;
        if (!d.active && dx * dx + dy * dy >= 25) {
          d.active = true;
          try {
            root.setPointerCapture(ev.pointerId);
          } catch {
            /* ignore */
          }
          document.body.style.userSelect = 'none';
        }
        if (d.active) {
          setMarqueeBox(marqueeRectFromPoints(d.startX, d.startY, ev.clientX, ev.clientY));
        }
      };

      const finish = (ev: PointerEvent) => {
        marqueeListenersCleanupRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        document.body.style.userSelect = '';
        const d = marqueeDragRef.current;
        marqueeDragRef.current = null;
        try {
          if (root.hasPointerCapture(ev.pointerId)) root.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }

        if (d?.active) {
          const box = marqueeRectFromPoints(d.startX, d.startY, ev.clientX, ev.clientY);
          setMarqueeBox(null);
          const nodes = root.querySelectorAll<HTMLElement>('[data-type-chip]');
          const hits: string[] = [];
          for (const node of nodes) {
            const typ = node.getAttribute('data-type');
            if (!typ) continue;
            if (rectIntersectsMarquee(node.getBoundingClientRect(), box)) hits.push(typ);
          }
          if (hits.length > 0) {
            marqueeSuppressClickRef.current = true;
            setSelectedTypes((prev) => {
              const next = new Set(prev);
              for (const h of hits) next.add(h);
              return [...next];
            });
            setTimeout(() => {
              marqueeSuppressClickRef.current = false;
            }, 0);
          }
        } else {
          setMarqueeBox(null);
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
      marqueeListenersCleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        document.body.style.userSelect = '';
        try {
          if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        marqueeDragRef.current = null;
        setMarqueeBox(null);
      };
    },
    [busy, marqueeRectFromPoints, rectIntersectsMarquee],
  );

  const handleResetForm = () => {
    const hasDirty =
      paragraph.trim().length >= 10 || drafts.length > 0 || textbook.trim() || source.trim();
    if (hasDirty && !window.confirm('입력한 지문·설정·만든 초안을 모두 지울까요?')) return;
    setParagraph('');
    setTextbook('');
    setSource('');
    setSelectedTypes(['주제']);
    setUserHint('');
    setDrafts([]);
    setMessage(null);
    setEditMode(false);
  };

  const handleGenerate = async () => {
    setMessage(null);
    if (charCount < 10) {
      showMessage({ kind: 'err', text: '지문을 먼저 입력해 주세요.' });
      return;
    }
    if (selectedTypes.length === 0) {
      showMessage({ kind: 'err', text: '유형을 하나 이상 선택해 주세요.' });
      return;
    }
    const apiKey = loginId ? readStoredByokAnthropicKey(loginId) : '';
    if (!apiKey) {
      showMessage({ kind: 'err', text: 'API 키가 없습니다. 내 정보(탭)에서 키를 저장해 주세요.' });
      return;
    }
    setBusy(true);
    setEditMode(false);
    setDrafts([]);
    const tb = textbook.trim() || '회원지문';
    const src = source.trim() || '직접입력';
    const types = selectedTypes.filter((t) => (BOOK_VARIANT_QUESTION_TYPES as readonly string[]).includes(t));
    if (types.length === 0) {
      showMessage({ kind: 'err', text: '유효한 유형을 선택해 주세요.' });
      setBusy(false);
      return;
    }
    const hint = userHint.trim() || undefined;
    const successes: VariantDraftItem[] = [];
    const failures: string[] = [];
    try {
      for (let i = 0; i < types.length; i++) {
        const type = types[i];
        const res = await fetch('/api/my/member-variant/generate', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-anthropic-api-key': apiKey },
          body: JSON.stringify({ paragraph, textbook: tb, source: src, type, userHint: hint }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          failures.push(`${type}: ${typeof data?.error === 'string' ? data.error : '실패'}`);
          continue;
        }
        const pid = typeof data.passage_id === 'string' ? data.passage_id : '';
        const qd = data.question_data && typeof data.question_data === 'object' && !Array.isArray(data.question_data)
          ? (data.question_data as Record<string, unknown>)
          : null;
        if (!pid || !qd) {
          failures.push(`${type}: 응답 형식 오류`);
          continue;
        }
        successes.push({
          type: typeof data.type === 'string' ? data.type : type,
          passage_id: pid,
          question_data: qd,
        });
      }

      if (successes.length === 0) {
        showMessage({
          kind: 'err',
          text: failures.length ? failures.join(' ') : '만들기에 실패했습니다.',
        });
        return;
      }
      setDrafts(successes);
      setActiveDraftIdx(0);
      if (failures.length > 0) {
        showMessage({
          kind: 'ok',
          text: `${successes.length}개 초안을 만들었습니다. 일부 유형은 실패했습니다: ${failures.join(' ')}`,
        });
      } else {
        showMessage({
          kind: 'ok',
          text:
            successes.length > 1
              ? `${successes.length}개 유형의 초안이 준비되었습니다. 확인 후 저장하세요.`
              : '초안이 준비되었습니다. 확인 후 저장하세요.',
        });
      }
      setTimeout(() => scrollTo('variant-preview'), 150);
    } catch {
      showMessage({ kind: 'err', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    setMessage(null);
    if (drafts.length === 0) {
      showMessage({ kind: 'err', text: '먼저 초안을 만들어 주세요.' });
      return;
    }
    setBusy(true);
    setEditMode(false);
    const tb = textbook.trim() || '회원지문';
    const src = source.trim() || '직접입력';
    try {
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i];
        const res = await fetch('/api/my/member-variant/save', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            passage_id: d.passage_id,
            textbook: tb,
            source: src,
            type: d.type,
            question_data: d.question_data,
            status: '대기',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showMessage({
            kind: 'err',
            text: `${d.type} 저장 실패: ${typeof data?.error === 'string' ? data.error : '오류'} (${i + 1}/${drafts.length}번째)`,
          });
          return;
        }
      }
      showMessage({ kind: 'ok', text: drafts.length > 1 ? `${drafts.length}개 문항을 저장했습니다.` : '저장 완료!' }, true);
      setDrafts([]);
      setListRefreshKey((k) => k + 1);
      setMyListOpen(true);
      setTimeout(() => scrollTo('my-member-variants'), 200);
    } catch {
      showMessage({ kind: 'err', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  /* ---------- Early returns ---------- */
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="w-full max-w-xs rounded-3xl bg-white p-10 text-center shadow-xl">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
          <p className="mt-4 text-sm font-medium text-slate-600">준비하는 중…</p>
        </div>
      </div>
    );
  }

  if (deniedReason === 'login') {
    return (
      <>
        <AppBar title="변형문제 만들기" showBackButton />
        <div className="flex min-h-[60vh] items-center justify-center px-4">
          <p className="text-sm text-slate-600">로그인 페이지로 이동합니다…</p>
        </div>
      </>
    );
  }

  if (deniedReason === 'premium') {
    return (
      <>
        <AppBar title="변형문제 만들기" showBackButton />
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-violet-50/40 px-4 py-14">
          <div className="mx-auto max-w-md rounded-3xl border border-violet-100 bg-white p-10 text-center shadow-xl shadow-violet-200/25">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-2xl">🔐</div>
            <h1 className="text-xl font-bold text-slate-900">체험 기간 만료</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              가입 후 7일 무료 체험이 끝났습니다. 계속 사용하려면 <strong>월구독</strong> 또는 <strong>연회원</strong>으로 가입해 주세요.
            </p>
            <p className="mt-4 text-xs text-slate-500">{membershipPricingOneLiner()}</p>
            <div className="mt-8 flex flex-col gap-2 text-sm font-semibold">
              <Link href="/" className="rounded-xl bg-slate-900 py-3 text-white hover:bg-slate-800">메인으로</Link>
              <Link href="/my" className="rounded-xl border border-slate-200 py-3 text-violet-800 hover:bg-slate-50">내 정보</Link>
              <a href={KAKAO_INQUIRY_URL} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-amber-200 bg-amber-50 py-3 text-amber-900 hover:bg-amber-100">카카오톡 문의</a>
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ---------- Toast ---------- */
  const Toast = ({ inline }: { inline?: boolean }) => {
    if (!message) return null;
    return (
      <div
        className={`pointer-events-auto rounded-2xl px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur ${
          inline ? '' : 'max-w-md'
        } ${
          message.kind === 'ok'
            ? 'border border-emerald-200 bg-emerald-50/95 text-emerald-900'
            : 'border border-red-200 bg-red-50/95 text-red-800'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1">{message.text}</span>
          {message.kind === 'ok' && myListOpen && (
            <button type="button" onClick={() => scrollTo('my-member-variants')} className="shrink-0 text-xs font-bold text-emerald-700 underline underline-offset-2 hover:text-emerald-900">
              목록 보기
            </button>
          )}
          <button type="button" onClick={() => setMessage(null)} className="shrink-0 text-slate-400 hover:text-slate-600" aria-label="닫기">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
    );
  };

  const renderVariantTypeChip = (t: string) => {
    const active = selectedTypes.includes(t);
    return (
      <button
        key={t}
        type="button"
        data-type-chip
        data-type={t}
        disabled={busy}
        onClick={() => {
          if (marqueeSuppressClickRef.current) return;
          toggleType(t);
        }}
        className={`rounded-full px-3 py-1 text-xs font-bold transition ${
          active
            ? 'bg-violet-600 text-white shadow-sm shadow-violet-400/20'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        } disabled:opacity-50`}
      >
        {active && (
          <svg className="-ml-0.5 mr-0.5 inline-block h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
        {t}
      </button>
    );
  };

  /* ---------- Main UI ---------- */
  return (
    <>
      <AppBar title="변형문제 만들기" showBackButton />

      {marqueeBox && (
        <div
          className="pointer-events-none fixed z-[160] box-border rounded-sm border-2 border-violet-500 bg-violet-500/15 shadow-md ring-1 ring-violet-400/30"
          style={{
            left: marqueeBox.left,
            top: marqueeBox.top,
            width: marqueeBox.width,
            height: marqueeBox.height,
          }}
          aria-hidden
        />
      )}

      <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-violet-50/30 pb-10">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-8">

          {/* --- 안내 배너 --- */}
          {noticeVisible && (
            <div className="rounded-2xl border border-indigo-400/30 bg-indigo-900 px-5 py-4 text-sm text-indigo-100 shadow-lg shadow-indigo-950/20">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0 flex-1 space-y-2 leading-relaxed">
                  <p>
                    <strong className="text-white">API 키는 이 화면에서 입력하지 않습니다.</strong>{' '}
                    <Link href="/my#byok-api-key" className="font-semibold text-amber-200 underline hover:text-white">내 정보(탭)</Link>
                    에서 등록해 주세요. 키는 이 기기에만 저장됩니다.
                  </p>
                  <p className="text-xs text-indigo-300">
                    {byokKeyStored
                      ? <span className="font-semibold text-emerald-300">저장된 키를 사용합니다.</span>
                      : <span className="text-amber-200">키가 아직 없습니다.</span>}
                    {' '}({membershipPricingOneLiner()})
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => { dismissVariantGenerateNoticeThisSession(); setNoticeVisible(false); }} className="rounded-xl border border-white/25 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/20">닫기</button>
                  <button type="button" onClick={() => { dismissVariantGenerateNoticeForTodayKst(); setNoticeVisible(false); }} className="rounded-xl bg-amber-400 px-4 py-2 text-xs font-bold text-indigo-950 hover:bg-amber-300">오늘 숨기기</button>
                </div>
              </div>
            </div>
          )}

          {/* --- 체험 기간 배너 --- */}
          {!isPremium && trialDaysLeft !== null && (
            <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3.5 text-sm font-medium shadow-sm ${
              trialDaysLeft <= 2 ? 'border border-red-200 bg-red-50 text-red-900'
                : trialDaysLeft <= 4 ? 'border border-amber-200 bg-amber-50 text-amber-900'
                  : 'border border-sky-200 bg-sky-50 text-sky-900'
            }`}>
              <span>
                {trialDaysLeft <= 1 ? '무료 체험이 오늘 종료됩니다.' : `무료 체험 ${trialDaysLeft}일 남았습니다.`}
                {' '}구독하면 제한 없이 사용할 수 있어요.
              </span>
              <Link href="/my" className={`shrink-0 rounded-xl px-4 py-1.5 text-xs font-bold text-white ${
                trialDaysLeft <= 2 ? 'bg-red-600 hover:bg-red-700' : trialDaysLeft <= 4 ? 'bg-amber-600 hover:bg-amber-700' : 'bg-sky-600 hover:bg-sky-700'
              }`}>구독하기</Link>
            </div>
          )}

          {/* --- 헤더 --- */}
          <header id="variant-editor-top" className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-violet-600">{isPremium ? 'Premium' : '무료 체험'}</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 md:text-3xl">변형문제 만들기</h1>
              <p className="mt-2 text-sm text-slate-600">지문과 유형을 정하면 AI 초안을 받을 수 있어요.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {byokKeyStored ? (
                <div ref={keyInfoWrapRef} className="relative flex items-center gap-1">
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-100">
                    API 키 준비됨
                  </span>
                  <button
                    type="button"
                    aria-expanded={keyInfoOpen}
                    aria-label="API 키 변경 안내"
                    onClick={() => setKeyInfoOpen((o) => !o)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-700 shadow-sm transition hover:bg-emerald-50"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                      <circle cx="12" cy="12" r="10" />
                      <path strokeLinecap="round" d="M12 16v-4M12 8h.01" />
                    </svg>
                  </button>
                  {keyInfoOpen && (
                    <div
                      role="tooltip"
                      className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-3.5 text-left text-xs leading-relaxed text-slate-600 shadow-lg ring-1 ring-slate-100"
                    >
                      <p>
                        API 키를 바꾸려면{' '}
                        <Link
                          href="/my#byok-api-key"
                          className="font-bold text-violet-700 underline decoration-violet-200 underline-offset-2 hover:text-violet-900"
                          onClick={() => setKeyInfoOpen(false)}
                        >
                          내 정보
                        </Link>
                        의 <strong className="text-slate-800">내 정보(탭)</strong>에서 등록·삭제할 수 있어요. 이
                        브라우저에만 저장됩니다.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900 ring-1 ring-amber-100">
                    API 키 필요
                  </span>
                  <Link
                    href="/my#byok-api-key"
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    키 설정
                  </Link>
                </>
              )}
            </div>
          </header>

          {/* --- 지문 --- */}
          <section
            id="variant-step-paragraph"
            className="scroll-mt-20 rounded-2xl border border-slate-200/80 bg-white shadow-md ring-1 ring-slate-100"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-gradient-to-r from-violet-50/80 to-white px-5 py-3">
              <h2 className="text-sm font-bold text-slate-900">영어 지문</h2>
              <VariantSourceLoader
                disabled={busy}
                currentParagraph={paragraph}
                onApply={({ paragraph: p, textbook: tb, source: src }) => { setParagraph(p); setTextbook(tb); setSource(src); }}
              />
            </div>
            <div className="p-4">
              <textarea
                ref={textareaRef}
                value={paragraph}
                onChange={(e) => setParagraph(e.target.value)}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50/40 px-4 py-3 font-mono text-sm leading-relaxed text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100"
                style={{ minHeight: 100 }}
                placeholder="지문 전체를 붙여 넣거나, 소스 불러오기를 사용하세요."
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  글자 <strong className="text-slate-700">{charCount.toLocaleString()}</strong> · 단어 약{' '}
                  <strong className="text-slate-700">{wordCount.toLocaleString()}</strong>
                </span>
                {charCount > 0 && (
                  <button type="button" onClick={() => void navigator.clipboard.writeText(paragraph)} className="font-semibold text-violet-700 underline decoration-violet-200 underline-offset-2 hover:text-violet-900">
                    지문 복사
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* --- 유형·메모 --- */}
          <section
            id="variant-step-types"
            className="scroll-mt-20 rounded-2xl border border-slate-200/80 bg-white shadow-md ring-1 ring-slate-100"
          >
            <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-violet-50/30 px-5 py-3">
              <h2 className="text-sm font-bold text-slate-900">유형 · 메모</h2>
            </div>
            <div className="space-y-4 p-4">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 px-3 py-2.5 text-[11px] leading-relaxed text-emerald-950">
                <p className="font-bold text-emerald-900">포인트 안내</p>
                <p className="mt-1 text-emerald-900/95">
                  <strong className="text-emerald-950">내용 파악</strong>(주제·제목·주장),{' '}
                  <strong className="text-emerald-950">세부 정보</strong>(일치·불일치),{' '}
                  <strong className="text-emerald-950">추론</strong>(함의·빈칸·요약),{' '}
                  <strong className="text-emerald-950">언어·구조</strong>(어법·순서·삽입·무관한문장) 유형은 초안을 만들 때{' '}
                  <span className="font-bold text-emerald-950">포인트가 차감되지 않습니다.</span>
                  {PAID_VARIANT_TYPES.length > 0 ? (
                    <>
                      {' '}
                      아래 <strong className="text-emerald-950">고난도</strong>에 있는 유형만 포인트가 사용돼요.
                    </>
                  ) : null}
                </p>
              </div>

              {/* 유형 — 소그룹 (드래그로 다중 선택) */}
              <div
                ref={variantChipMarqueeRef}
                className="relative space-y-3 select-none"
                onPointerDown={handleVariantChipMarqueePointerDown}
              >
                {TYPE_GROUPS.map((g) => (
                  <div key={g.label}>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{g.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {g.types
                        .filter((t) => (BOOK_VARIANT_QUESTION_TYPES as readonly string[]).includes(t))
                        .map((t) => renderVariantTypeChip(t))}
                    </div>
                  </div>
                ))}

                {PAID_VARIANT_TYPES.length > 0 && (
                  <div id="variant-step-hard-types">
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">고난도</p>
                    <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
                      {PAID_VARIANT_TYPES.map((t) => {
                        const cost = variantTypePointCostPerDraft(t);
                        return (
                          <span key={t}>
                            <span className="font-semibold text-slate-700">{t}</span>
                            {cost != null ? (
                              <span>
                                {' '}
                                초안 1개당 <span className="font-bold text-slate-700">{cost}포인트</span> 차감.
                              </span>
                            ) : null}{' '}
                          </span>
                        );
                      })}
                      포인트가 부족하면 해당 유형 초안만 건너뜁니다.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {PAID_VARIANT_TYPES.map((t) => renderVariantTypeChip(t))}
                    </div>
                  </div>
                )}

                <p className="text-[11px] leading-relaxed text-slate-400">
                  화면 캡처처럼 <strong className="text-slate-600">드래그하여 사각형을 그리면</strong> 겹치는 유형이 한꺼번에
                  선택됩니다. 개별 선택은 칩을 눌러 주세요.
                </p>

                {selectedTypes.length > 1 && (
                  <p className="text-[11px] text-slate-500">
                    선택한 유형마다 초안을 하나씩 만듭니다. 유형이 많으면 시간이 조금 더 걸릴 수 있어요.
                  </p>
                )}
              </div>

              {/* 교재/출처 — placeholder */}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-bold text-slate-600">교재 이름</span>
                  <input
                    value={textbook}
                    onChange={(e) => setTextbook(e.target.value)}
                    placeholder="예: 수특영어, EBS 2026"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-slate-600">출처·단원</span>
                  <input
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="예: 1강, 3번 지문"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-bold text-slate-600">추가 메모 <span className="font-normal text-slate-400">(선택)</span></span>
                <textarea value={userHint} onChange={(e) => setUserHint(e.target.value)} rows={2} placeholder="예: 보기 길이, 톤, 피하고 싶은 주제 등" className="mt-1 w-full resize-none rounded-xl border border-slate-200 px-4 py-2.5 text-sm placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
              </label>

              {/* 입력 초기화 — 텍스트 링크 */}
              {(paragraph.trim() || textbook.trim() || source.trim() || drafts.length > 0) && (
                <div className="text-right">
                  <button type="button" disabled={busy} onClick={handleResetForm} className="text-xs font-medium text-slate-400 underline decoration-slate-300 underline-offset-2 hover:text-red-500 disabled:opacity-50">
                    입력 초기화
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* --- 초안 만들기 (필수 입력 체크) — 하단 고정바 대신 인라인 --- */}
          {drafts.length === 0 && (
            <section className="scroll-mt-20 rounded-2xl border border-violet-200/60 bg-gradient-to-br from-white to-violet-50/40 p-4 shadow-md ring-1 ring-violet-100 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:gap-5">
                <div className="flex shrink-0 flex-col justify-center sm:w-auto">
                  <button
                    type="button"
                    disabled={busy || !canGenerate}
                    onClick={() => void handleGenerate()}
                    className="w-full min-w-[10rem] rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-500/20 transition hover:brightness-105 disabled:pointer-events-none disabled:opacity-45 sm:w-auto sm:py-4 sm:text-[15px]"
                  >
                    {busy ? '만드는 중…' : '초안 만들기'}
                  </button>
                </div>
                <div className="min-w-0 flex-1 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-3 sm:px-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">입력 순서</p>
                  <ul className="mt-2 space-y-2">
                    {generateReadinessSteps.map((step, idx) => {
                      const isNext = firstBlockingStep?.key === step.key;
                      return (
                        <li key={step.key}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => scrollTo(step.scrollId)}
                            className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                              step.done
                                ? 'bg-emerald-50/80 text-emerald-900'
                                : isNext
                                  ? 'bg-amber-50 ring-2 ring-amber-300/80 hover:bg-amber-100/90'
                                  : 'bg-slate-50/90 text-slate-600 hover:bg-slate-100'
                            } ${!busy ? 'cursor-pointer' : ''} disabled:cursor-wait disabled:opacity-70`}
                          >
                            <span
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                                step.done ? 'bg-emerald-500 text-white' : 'border-2 border-slate-300 bg-white text-slate-500'
                              }`}
                              aria-hidden
                            >
                              {step.done ? '✓' : idx + 1}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className={`text-xs font-bold ${step.done ? 'text-emerald-900' : 'text-slate-800'}`}>
                                  {step.label}
                                </span>
                                {!step.done && isNext && (
                                  <span className="rounded-full bg-amber-600 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white">
                                    우선
                                  </span>
                                )}
                              </span>
                              {!step.done && (
                                <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{step.hint}</span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
              {message && (
                <div className="mt-4">
                  <Toast />
                </div>
              )}
            </section>
          )}

          {/* --- 초안 미리보기 --- */}
          {drafts.length > 0 && (
            <section
              id="variant-preview"
              className="scroll-mt-20 rounded-2xl border border-slate-200/80 bg-white shadow-md ring-1 ring-slate-100"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-emerald-50/80 to-white px-5 py-3">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3">
                  <h2 className="text-sm font-bold text-slate-900">
                    만든 초안{drafts.length > 1 ? ` (${drafts.length}개)` : ''}
                  </h2>
                  {drafts.length > 1 && (
                    <div className="flex items-center gap-0.5 rounded-xl border border-slate-200/90 bg-white p-0.5 shadow-sm">
                      <button
                        type="button"
                        aria-label="이전 초안"
                        disabled={activeDraftIdx <= 0}
                        onClick={() => setActiveDraftIdx((k) => Math.max(0, k - 1))}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-lg font-bold text-slate-600 transition hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-30"
                      >
                        ‹
                      </button>
                      <span className="min-w-[3.25rem] select-none text-center text-xs font-bold tabular-nums text-slate-600">
                        {activeDraftIdx + 1} / {drafts.length}
                      </span>
                      <button
                        type="button"
                        aria-label="다음 초안"
                        disabled={activeDraftIdx >= drafts.length - 1}
                        onClick={() => setActiveDraftIdx((k) => Math.min(drafts.length - 1, k + 1))}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-lg font-bold text-slate-600 transition hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-30"
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleGenerate()}
                    className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-900 transition hover:bg-violet-100 disabled:opacity-50"
                  >
                    다시 만들기
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditMode(!editMode)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                      editMode
                        ? 'bg-violet-600 text-white hover:bg-violet-700'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {editMode ? '수정 완료' : '수정하기'}
                  </button>
                </div>
              </div>
              <div className="p-4">
                {(() => {
                  const i = drafts.length > 1 ? activeDraftIdx : 0;
                  const d = drafts[i];
                  if (!d) return null;
                  return (
                    <div
                      key={`${d.type}-${d.passage_id}-${i}`}
                      className="rounded-xl border border-slate-100 bg-slate-50/40 p-4"
                    >
                      <p className="mb-3 text-xs font-bold text-violet-700">유형: {d.type}</p>
                      <QuestionFriendlyPreview
                        data={d.question_data}
                        editable={editMode}
                        onDataChange={(updated) => {
                          setDrafts((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, question_data: updated } : x)),
                          );
                        }}
                      />
                    </div>
                  );
                })()}
              </div>
              <div className="space-y-3 border-t border-slate-100 bg-gradient-to-r from-emerald-50/60 to-white px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSave()}
                    className="rounded-2xl bg-emerald-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {drafts.length > 1 ? `전부 저장 (${drafts.length}개)` : '저장하기'}
                  </button>
                  {message && <Toast />}
                </div>
              </div>
            </section>
          )}

          {/* --- 내가 만든 문항 (접기/펴기) --- */}
          <section id="my-member-variants" className="scroll-mt-20">
            <button
              type="button"
              onClick={() => setMyListOpen(!myListOpen)}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-5 py-3.5 text-left shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50"
            >
              <span className="text-sm font-bold text-slate-900">내가 만든 문항</span>
              <svg
                className={`h-5 w-5 text-slate-400 transition-transform ${myListOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {myListOpen && (
              <div className="mt-2">
                <MyMemberVariants refreshKey={listRefreshKey} listMode="preview" />
              </div>
            )}
          </section>

          <p className="pb-4 text-center text-[11px] text-slate-400">
            <button type="button" className="underline decoration-slate-300 underline-offset-2 hover:text-slate-600" onClick={() => { resetVariantGenerateNoticeDismissals(); setNoticeVisible(true); }}>
              안내 다시 보기
            </button>
          </p>
        </div>
      </div>
    </>
  );
}
