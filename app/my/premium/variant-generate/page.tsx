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
import EssayQuestionPreview from './EssayQuestionPreview';
import VariantSourceLoader from './VariantSourceLoader';
import MemberVariantsMini from './MemberVariantsMini';
import { MEMBER_ESSAY_QUESTION_TYPES } from '@/lib/member-essay-draft-claude';

const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

type IconName =
  | 'target' | 'heading' | 'quote' | 'check' | 'x' | 'bulb' | 'puzzle' | 'note'
  | 'search' | 'order' | 'insert' | 'block'
  | 'key' | 'shield' | 'sparkle' | 'gem' | 'book' | 'save' | 'download' | 'bolt'
  | 'arrowRight' | 'plus' | 'lock' | 'list' | 'refresh';

type TypeMeta = {
  key: string;
  label: string;
  desc: string;
  icon: IconName;
};

const TYPE_GROUPS: { label: string; items: TypeMeta[] }[] = [
  {
    label: '내용 파악',
    items: [
      { key: '주제', label: '주제', desc: '글의 핵심 주제 묻기', icon: 'target' },
      { key: '제목', label: '제목', desc: '글에 어울리는 제목', icon: 'heading' },
      { key: '주장', label: '주장', desc: '필자가 말하려는 주장', icon: 'quote' },
    ],
  },
  {
    label: '세부 정보',
    items: [
      { key: '일치', label: '일치', desc: '글과 일치하는 것', icon: 'check' },
      { key: '불일치', label: '불일치', desc: '글과 일치하지 않는 것', icon: 'x' },
    ],
  },
  {
    label: '추론',
    items: [
      { key: '함의', label: '함의', desc: '밑줄 친 표현의 함축 의미', icon: 'bulb' },
      { key: '빈칸', label: '빈칸', desc: '빈칸에 들어갈 말 추론', icon: 'puzzle' },
      { key: '요약', label: '요약', desc: '한 문장으로 요약', icon: 'note' },
    ],
  },
  {
    label: '언어·구조',
    items: [
      { key: '어법', label: '어법', desc: '문법 오류 찾기', icon: 'search' },
      { key: '순서', label: '순서', desc: '문단 순서 배열', icon: 'order' },
      { key: '삽입', label: '삽입', desc: '주어진 문장 위치', icon: 'insert' },
      { key: '무관한문장', label: '무관한문장', desc: '글의 흐름과 무관한 문장', icon: 'block' },
    ],
  },
];

const ALL_TYPES: TypeMeta[] = TYPE_GROUPS.flatMap((g) => g.items);

/** 서술형 유형 메타 */
const ESSAY_TYPE_META: TypeMeta[] = [
  {
    key: '빈칸재배열형',
    label: '빈칸재배열형',
    desc: '주제문의 핵심 구를 보기 단어로 재배열해 빈칸 완성',
    icon: 'puzzle',
  },
  {
    key: '요약문조건영작형',
    label: '요약문 조건 영작형',
    desc: '한 문장 요약 빈칸을 문법 조건 3개에 맞게 영작',
    icon: 'note',
  },
  {
    key: '이중요지영작형',
    label: '이중요지 영작형',
    desc: '지문 기반 두 가지 관점을 영어로 통합 서술 (40–50어)',
    icon: 'quote',
  },
  {
    key: '요약문본문어휘',
    label: '요약문 본문 어휘',
    desc: '본문에서 단어를 직접 찾아 요약문 빈칸 완성',
    icon: 'search',
  },
  {
    key: '요약문조건영작배열',
    label: '요약문 조건 영작 (배열)',
    desc: '주어진 단어를 올바른 순서로 배열하여 요약문 완성',
    icon: 'order',
  },
];

type PageMode = 'multiple-choice' | 'essay';

const PAID_VARIANT_TYPES = (BOOK_VARIANT_QUESTION_TYPES as readonly string[]).filter((t) =>
  variantTypeRequiresHardInsertionPoints(t),
);

const PROGRESS_STAGES = [
  '지문을 분석하는 중',
  '핵심 아이디어를 추출하는 중',
  '변형문제를 작성하는 중',
  '선택지·해설을 다듬는 중',
];

type VariantDraftItem = {
  type: string;
  passage_id: string;
  question_data: Record<string, unknown>;
};

type GenerationProgress = {
  current: number;
  total: number;
  currentLabel: string;
};

type PerTypeResult = {
  type: string;
  ok: boolean;
  error?: string;
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

  /** 생성 진행률 (다중 유형 처리) */
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [stageIdx, setStageIdx] = useState(0);
  const [perTypeResults, setPerTypeResults] = useState<PerTypeResult[]>([]);
  /** 저장 성공 직후 1회 강조용 */
  const [lastSavedIds, setLastSavedIds] = useState<string[]>([]);
  /** 객관식 / 서술형 모드 */
  const [pageMode, setPageMode] = useState<PageMode>('multiple-choice');
  /** 서술형 선택 유형 (단일 선택) */
  const [selectedEssayType, setSelectedEssayType] = useState<string>('요약문본문어휘');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typeSectionRef = useRef<HTMLDivElement>(null);
  const paragraphSectionRef = useRef<HTMLDivElement>(null);
  const previewAnchorRef = useRef<HTMLDivElement>(null);
  const mobileResultRef = useRef<HTMLDivElement>(null);
  const myListRef = useRef<HTMLDivElement>(null);
  const msgTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 유형 카드 러버밴드(드래그) 다중 선택 */
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
    el.style.height = `${Math.max(120, Math.min(el.scrollHeight, 480))}px`;
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
      msgTimeoutRef.current = setTimeout(() => setMessage(null), 6000);
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

  /** 생성 중 단계 문구 롤링 */
  useEffect(() => {
    if (busy) {
      setStageIdx(0);
      stageTimerRef.current = setInterval(() => {
        setStageIdx((i) => (i + 1) % PROGRESS_STAGES.length);
      }, 1800);
    } else if (stageTimerRef.current) {
      clearInterval(stageTimerRef.current);
      stageTimerRef.current = null;
    }
    return () => {
      if (stageTimerRef.current) {
        clearInterval(stageTimerRef.current);
        stageTimerRef.current = null;
      }
    };
  }, [busy]);

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
        if (!d.active && dx * dx + dy * dy >= 36) {
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
    setPerTypeResults([]);
    setLastSavedIds([]);
  };

  const handleEssayGenerate = async () => {
    setMessage(null);
    setPerTypeResults([]);
    setLastSavedIds([]);
    if (charCount < 10) {
      showMessage({ kind: 'err', text: '지문을 먼저 입력해 주세요.' });
      return;
    }
    const apiKey = loginId ? readStoredByokAnthropicKey(loginId) : '';
    if (!apiKey) {
      showMessage({ kind: 'err', text: 'API 키가 없습니다. 내 정보(탭)에서 키를 저장해 주세요.' });
      return;
    }
    if (!(MEMBER_ESSAY_QUESTION_TYPES as readonly string[]).includes(selectedEssayType)) {
      showMessage({ kind: 'err', text: '유효한 서술형 유형을 선택해 주세요.' });
      return;
    }
    setBusy(true);
    setEditMode(false);
    setDrafts([]);
    const tb = textbook.trim() || '회원지문';
    const src = source.trim() || '직접입력';
    const hint = userHint.trim() || undefined;
    try {
      const res = await fetch('/api/my/member-variant/essay-generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-anthropic-api-key': apiKey },
        body: JSON.stringify({
          paragraph,
          textbook: tb,
          source: src,
          type: selectedEssayType,
          userHint: hint,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMessage({
          kind: 'err',
          text: typeof data?.error === 'string' ? data.error : '생성에 실패했습니다.',
        });
        return;
      }
      const pid = typeof data.passage_id === 'string' ? data.passage_id : '';
      const qd =
        data.question_data && typeof data.question_data === 'object' && !Array.isArray(data.question_data)
          ? (data.question_data as Record<string, unknown>)
          : null;
      if (!pid || !qd) {
        showMessage({ kind: 'err', text: '응답 형식 오류' });
        return;
      }
      setDrafts([{ type: selectedEssayType, passage_id: pid, question_data: qd }]);
      setActiveDraftIdx(0);
      showMessage({ kind: 'ok', text: '서술형 초안이 준비되었습니다. 확인 후 저장하세요.' }, true);
      setTimeout(() => {
        mobileResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 180);
    } catch {
      showMessage({ kind: 'err', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleGenerate = async () => {
    setMessage(null);
    setPerTypeResults([]);
    setLastSavedIds([]);
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
    const results: PerTypeResult[] = [];
    try {
      for (let i = 0; i < types.length; i++) {
        const type = types[i];
        setProgress({ current: i + 1, total: types.length, currentLabel: type });
        const res = await fetch('/api/my/member-variant/generate', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-anthropic-api-key': apiKey },
          body: JSON.stringify({ paragraph, textbook: tb, source: src, type, userHint: hint }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          results.push({ type, ok: false, error: typeof data?.error === 'string' ? data.error : '실패' });
          continue;
        }
        const pid = typeof data.passage_id === 'string' ? data.passage_id : '';
        const qd = data.question_data && typeof data.question_data === 'object' && !Array.isArray(data.question_data)
          ? (data.question_data as Record<string, unknown>)
          : null;
        if (!pid || !qd) {
          results.push({ type, ok: false, error: '응답 형식 오류' });
          continue;
        }
        successes.push({
          type: typeof data.type === 'string' ? data.type : type,
          passage_id: pid,
          question_data: qd,
        });
        results.push({ type, ok: true });
      }

      setPerTypeResults(results);
      if (successes.length === 0) {
        const firstErr = results.find((r) => !r.ok);
        showMessage({
          kind: 'err',
          text: firstErr?.error ? `만들기 실패: ${firstErr.error}` : '만들기에 실패했습니다.',
        });
        return;
      }
      setDrafts(successes);
      setActiveDraftIdx(0);
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        showMessage({
          kind: 'ok',
          text: `${successes.length}개 초안 완료. ${failed.length}개 유형은 실패했습니다.`,
        }, true);
      } else {
        showMessage({
          kind: 'ok',
          text:
            successes.length > 1
              ? `${successes.length}개 유형의 초안이 준비되었습니다.`
              : '초안이 준비되었습니다. 확인 후 저장하세요.',
        }, true);
      }
      setTimeout(() => {
        mobileResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 180);
    } catch {
      showMessage({ kind: 'err', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setBusy(false);
      setProgress(null);
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
    const savedIds: string[] = [];
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
        if (typeof data.inserted_id === 'string') savedIds.push(data.inserted_id);
      }
      showMessage(
        { kind: 'ok', text: drafts.length > 1 ? `${drafts.length}개 문항을 저장했습니다.` : '저장 완료!' },
        true,
      );
      setDrafts([]);
      setLastSavedIds(savedIds);
      setListRefreshKey((k) => k + 1);
    } catch {
      showMessage({ kind: 'err', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  /** 결과 패널 → 자세히 보기 페이지로 이동 (방금 저장 항목 자동 강조) */
  const jumpToList = useCallback(() => {
    const focusId = lastSavedIds[0];
    const href = focusId
      ? `/my/premium/member-variants?focus=${encodeURIComponent(focusId)}`
      : '/my/premium/member-variants';
    router.push(href);
  }, [lastSavedIds, router]);

  /** 다른 유형 더 만들기 — 저장 후 초안은 비어있음, 유형만 초기화하고 지문·설정은 유지 */
  const handleMakeMore = useCallback(() => {
    setLastSavedIds([]);
    setPerTypeResults([]);
    setDrafts([]);
    setSelectedTypes(['주제']);
    setTimeout(() => {
      typeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, []);

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
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <Icon name="lock" className="h-6 w-6" />
            </div>
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

  /* ---------- Step indicator state ---------- */
  const stepParagraph = charCount >= 10;
  const stepType = pageMode === 'essay' ? !!selectedEssayType : selectedTypes.length > 0;
  const stepGenerated = drafts.length > 0 || lastSavedIds.length > 0;
  const stepSaved = lastSavedIds.length > 0;
  const stepFlags = [stepParagraph, stepType, stepGenerated, stepSaved];
  const firstIncompleteIdx = stepFlags.findIndex((d) => !d);
  const currentStepIdx = firstIncompleteIdx === -1 ? -1 : firstIncompleteIdx;

  const canGenerate = byokKeyStored && stepParagraph && stepType && !busy;
  const generateHintMsg = !byokKeyStored
    ? 'API 키를 먼저 등록해 주세요 (내 정보)'
    : !stepParagraph
      ? '영어 지문을 10자 이상 입력해 주세요'
      : !stepType
        ? '문제 유형을 1개 이상 선택해 주세요'
        : '';

  /* ---------- Render ---------- */
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-violet-50/30">
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

      {/* 상단 얇은 알림 바 — 안내/체험 통합 */}
      {(noticeVisible || (!isPremium && trialDaysLeft !== null)) && (
        <div className="border-b border-violet-100 bg-gradient-to-r from-violet-50/80 via-indigo-50/60 to-violet-50/80">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2 text-xs">
            {!isPremium && trialDaysLeft !== null && (
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-bold ${
                  trialDaysLeft <= 2 ? 'bg-red-100 text-red-800' : trialDaysLeft <= 4 ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-900'
                }`}
              >
                <Icon name="sparkle" className="h-3 w-3" />
                {trialDaysLeft <= 1 ? '무료 체험 오늘 종료' : `무료 체험 ${trialDaysLeft}일 남음`}
              </span>
            )}
            {noticeVisible && (
              <span className="min-w-0 flex-1 text-slate-700">
                API 키는{' '}
                <Link href="/my#byok-api-key" className="font-bold text-violet-700 underline decoration-violet-200 underline-offset-2 hover:text-violet-900">
                  내 정보
                </Link>
                에서 등록하며 이 기기에만 저장됩니다. {byokKeyStored ? (
                  <strong className="text-emerald-700">키 준비됨</strong>
                ) : (
                  <strong className="text-amber-700">키 필요</strong>
                )}
              </span>
            )}
            <div className="ml-auto flex shrink-0 gap-1.5">
              {!isPremium && trialDaysLeft !== null && (
                <Link
                  href="/my"
                  className={`rounded-full px-3 py-1 font-bold text-white ${
                    trialDaysLeft <= 2 ? 'bg-red-600 hover:bg-red-700' : trialDaysLeft <= 4 ? 'bg-amber-600 hover:bg-amber-700' : 'bg-sky-600 hover:bg-sky-700'
                  }`}
                >
                  구독
                </Link>
              )}
              {noticeVisible && (
                <button
                  type="button"
                  onClick={() => { dismissVariantGenerateNoticeThisSession(); setNoticeVisible(false); }}
                  className="rounded-full border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-600 hover:bg-slate-50"
                >
                  닫기
                </button>
              )}
              {noticeVisible && (
                <button
                  type="button"
                  onClick={() => { dismissVariantGenerateNoticeForTodayKst(); setNoticeVisible(false); }}
                  className="rounded-full bg-slate-900 px-2.5 py-1 font-bold text-white hover:bg-slate-800"
                >
                  오늘 숨기기
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* STEP INDICATOR (sticky) */}
      <div className="sticky top-16 z-30 border-b border-slate-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <StepIndicator
            steps={[
              { num: 1, label: '지문 입력', done: stepParagraph, onClick: () => textareaRef.current?.focus() },
              { num: 2, label: '유형 선택', done: stepType, onClick: () => paragraphSectionRef.current && typeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
              { num: 3, label: '초안 생성', done: stepGenerated },
              { num: 4, label: '저장·Export', done: stepSaved, onClick: () => stepSaved ? jumpToList() : undefined },
            ]}
            currentIdx={currentStepIdx}
          />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6 pb-32 lg:grid lg:grid-cols-12 lg:gap-8">

        {/* ===== 좌측: 입력 ===== */}
        <div className="space-y-6 lg:col-span-7">

          {/* 헤더 */}
          <header id="variant-editor-top" className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-violet-600">{isPremium ? 'Premium' : '무료 체험'}</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 md:text-3xl">변형문제 만들기</h1>
              <p className="mt-2 text-sm text-slate-600">
                지문과 유형을 정하면 AI 초안이 우측에 표시됩니다. 여러 유형을 한 번에 만들고, 저장 즉시 내보내기·검수까지 이어 가세요.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {byokKeyStored ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-100">
                  <Icon name="key" className="h-3.5 w-3.5" />
                  API 키 준비
                </span>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900 ring-1 ring-amber-100">
                    <Icon name="key" className="h-3.5 w-3.5" />
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

          {/* 1. 지문 */}
          <section ref={paragraphSectionRef} id="variant-step-paragraph" className="scroll-mt-32">
            <SectionHeader num={1} title="영어 지문" done={stepParagraph} />
            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <div className="flex items-center gap-3 text-xs">
                  <span className={charCount >= 10 ? 'font-bold text-emerald-600' : 'text-slate-400'}>
                    {charCount.toLocaleString()}자
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="text-slate-500">{wordCount.toLocaleString()}단어</span>
                </div>
                <div className="flex items-center gap-2">
                  {charCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(paragraph)}
                      className="text-[11px] font-semibold text-slate-500 hover:text-violet-700"
                    >
                      복사
                    </button>
                  )}
                  <VariantSourceLoader
                    disabled={busy}
                    currentParagraph={paragraph}
                    onApply={({ paragraph: p, textbook: tb, source: src }) => {
                      setParagraph(p);
                      setTextbook(tb);
                      setSource(src);
                    }}
                  />
                </div>
              </div>
              <textarea
                ref={textareaRef}
                value={paragraph}
                onChange={(e) => setParagraph(e.target.value)}
                placeholder="이곳에 영어 지문을 붙여 넣거나, 소스 불러오기에서 EBS·모의고사 지문을 가져오세요."
                className="w-full resize-none px-5 py-4 text-[15px] leading-relaxed text-slate-800 placeholder-slate-400 focus:outline-none"
                style={{ minHeight: 120 }}
              />
            </div>
          </section>

          {/* 모드 탭 — 객관식 / 서술형 */}
          <div className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => {
                setPageMode('multiple-choice');
                setDrafts([]);
                setMessage(null);
                setLastSavedIds([]);
              }}
              disabled={busy}
              className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
                pageMode === 'multiple-choice'
                  ? 'bg-white text-violet-700 shadow-sm ring-1 ring-violet-200'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              객관식 (13유형)
            </button>
            <button
              type="button"
              onClick={() => {
                setPageMode('essay');
                setDrafts([]);
                setMessage(null);
                setLastSavedIds([]);
                setSelectedEssayType('요약문본문어휘');
              }}
              disabled={busy}
              className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
                pageMode === 'essay'
                  ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              서술형 (5유형)
            </button>
          </div>

          {/* 2. 유형 */}
          <section ref={typeSectionRef} id="variant-step-types" className="scroll-mt-32">
            <SectionHeader
              num={2}
              title={
                pageMode === 'essay'
                  ? '서술형 유형'
                  : `문제 유형 (${selectedTypes.length}개 선택)`
              }
              done={pageMode === 'essay' ? !!selectedEssayType : stepType}
              right={
                pageMode === 'multiple-choice' && selectedTypes.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSelectedTypes([])}
                    className="text-[11px] font-semibold text-slate-400 underline decoration-slate-300 underline-offset-2 hover:text-red-500"
                  >
                    선택 해제
                  </button>
                ) : null
              }
            />

            {/* ── 서술형 모드 유형 카드 ── */}
            {pageMode === 'essay' && (
              <div className="mt-3 space-y-3">
                <p className="px-1 text-[11px] leading-relaxed text-slate-500">
                  빈칸재배열·조건영작·이중요지 등 수능형 서술형 5가지 유형을 지원합니다. 하나를 선택하면 AI가 지문 기반으로 문항을 생성합니다.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {ESSAY_TYPE_META.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      disabled={busy}
                      onClick={() => setSelectedEssayType(t.key)}
                      className={`rounded-2xl border-2 p-4 text-left transition disabled:opacity-50 ${
                        selectedEssayType === t.key
                          ? 'scale-[1.02] border-emerald-600 bg-emerald-600 text-white shadow-md'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/50'
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-sm font-bold">{t.label}</span>
                        {selectedEssayType === t.key && (
                          <svg className="ml-auto h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <p className={`text-[11px] leading-snug ${selectedEssayType === t.key ? 'text-emerald-100' : 'text-slate-500'}`}>
                        {t.desc}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── 객관식 모드 유형 카드 ── */}
            {pageMode === 'multiple-choice' && (
            <>
            <p className="mt-2 px-1 text-[11px] leading-relaxed text-slate-500">
              카드를 클릭하거나 <strong className="text-slate-700">사각형을 드래그</strong>해 여러 유형을 한번에 선택할 수 있어요.
              여러 유형을 고르면 하나씩 순차 생성됩니다.
            </p>

            <div
              ref={variantChipMarqueeRef}
              className="relative mt-3 select-none space-y-5"
              onPointerDown={handleVariantChipMarqueePointerDown}
            >
              {TYPE_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">{group.label}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {group.items
                      .filter((t) => (BOOK_VARIANT_QUESTION_TYPES as readonly string[]).includes(t.key))
                      .map((t) => (
                        <TypeCard
                          key={t.key}
                          meta={t}
                          active={selectedTypes.includes(t.key)}
                          disabled={busy}
                          onClick={() => {
                            if (marqueeSuppressClickRef.current) return;
                            toggleType(t.key);
                          }}
                        />
                      ))}
                  </div>
                </div>
              ))}

              {PAID_VARIANT_TYPES.length > 0 && (
                <div id="variant-step-hard-types">
                  <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">고난도</p>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900 ring-1 ring-amber-200">
                      포인트 차감
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {PAID_VARIANT_TYPES.map((typeKey) => {
                      const cost = variantTypePointCostPerDraft(typeKey);
                      const meta: TypeMeta = {
                        key: typeKey,
                        label: typeKey,
                        desc: cost != null ? `1개당 ${cost}P` : '고난도',
                        icon: 'bolt',
                      };
                      return (
                        <TypeCard
                          key={typeKey}
                          meta={meta}
                          active={selectedTypes.includes(typeKey)}
                          disabled={busy}
                          paid
                          onClick={() => {
                            if (marqueeSuppressClickRef.current) return;
                            toggleType(typeKey);
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            </>
            )}
          </section>

          {/* 3. 추가 정보 */}
          <section className="scroll-mt-32">
            <SectionHeader num={3} title="교재 · 출처 · 메모 (선택)" done={false} optional />
            <div className="mt-3 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
                <span className="text-xs font-bold text-slate-600">
                  추가 메모 <span className="font-normal text-slate-400">(AI에 힌트로 전달됩니다)</span>
                </span>
                <textarea
                  value={userHint}
                  onChange={(e) => setUserHint(e.target.value)}
                  rows={2}
                  placeholder="예: 보기 길이, 톤, 피하고 싶은 주제 등"
                  className="mt-1 w-full resize-none rounded-xl border border-slate-200 px-4 py-2.5 text-sm placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                />
              </label>
              {(paragraph.trim() || textbook.trim() || source.trim() || drafts.length > 0) && (
                <div className="text-right">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleResetForm}
                    className="text-[11px] font-medium text-slate-400 underline decoration-slate-300 underline-offset-2 hover:text-red-500 disabled:opacity-50"
                  >
                    입력 초기화
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* 인라인 메시지 */}
          {message && (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm font-semibold anim-fade-slide-top ${
                message.kind === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1">{message.text}</span>
                <button
                  type="button"
                  onClick={() => setMessage(null)}
                  className="shrink-0 text-slate-400 hover:text-slate-600"
                  aria-label="닫기"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* 모바일 결과 영역 (lg 미만) */}
          <div ref={mobileResultRef} className="lg:hidden">
            {busy ? (
              <GeneratingPanel
                stageIdx={stageIdx}
                progress={progress}
                selectedCount={selectedTypes.length}
              />
            ) : drafts.length > 0 ? (
              <ResultPanel
                drafts={drafts}
                activeIdx={activeDraftIdx}
                onActiveIdx={setActiveDraftIdx}
                editMode={editMode}
                onEditMode={setEditMode}
                busy={busy}
                onSave={() => void handleSave()}
                onRegenerate={() => void handleGenerate()}
                onUpdateDraft={(i, updated) =>
                  setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, question_data: updated } : x)))
                }
                failedResults={perTypeResults.filter((r) => !r.ok)}
              />
            ) : lastSavedIds.length > 0 ? (
              <SavedSuccessPanel
                savedCount={lastSavedIds.length}
                onJumpList={jumpToList}
                onMakeMore={handleMakeMore}
                onReset={handleResetForm}
              />
            ) : (
              <IdlePreviewPanel
                hasKey={byokKeyStored}
                hasParagraph={stepParagraph}
                hasType={stepType}
                selectedCount={selectedTypes.length}
                firstSelected={selectedTypes[0] ? ALL_TYPES.find((t) => t.key === selectedTypes[0]) : undefined}
              />
            )}
          </div>

          {/* 결과 앵커 (sticky 스크롤 기준점) */}
          <div ref={previewAnchorRef} className="h-0" />
        </div>

        {/* ===== 우측: 결과/미리보기 (lg+ sticky) ===== */}
        <aside className="hidden lg:col-span-5 lg:block">
          <div className="sticky top-32 space-y-4">
            {busy ? (
              <GeneratingPanel
                stageIdx={stageIdx}
                progress={progress}
                selectedCount={selectedTypes.length}
              />
            ) : drafts.length > 0 ? (
              <ResultPanel
                drafts={drafts}
                activeIdx={activeDraftIdx}
                onActiveIdx={setActiveDraftIdx}
                editMode={editMode}
                onEditMode={setEditMode}
                busy={busy}
                onSave={() => void handleSave()}
                onRegenerate={() => void handleGenerate()}
                onUpdateDraft={(i, updated) =>
                  setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, question_data: updated } : x)))
                }
                failedResults={perTypeResults.filter((r) => !r.ok)}
              />
            ) : lastSavedIds.length > 0 ? (
              <SavedSuccessPanel
                savedCount={lastSavedIds.length}
                onJumpList={jumpToList}
                onMakeMore={handleMakeMore}
                onReset={handleResetForm}
              />
            ) : (
              <IdlePreviewPanel
                hasKey={byokKeyStored}
                hasParagraph={stepParagraph}
                hasType={stepType}
                selectedCount={selectedTypes.length}
                firstSelected={selectedTypes[0] ? ALL_TYPES.find((t) => t.key === selectedTypes[0]) : undefined}
              />
            )}
          </div>
        </aside>
      </div>

      {/* ===== 내가 만든 문항 (슬림 미리보기) ===== */}
      <div ref={myListRef} id="my-member-variants" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-20">
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm ring-1 ring-slate-100">
          <div className="flex items-center justify-between gap-3 px-5 py-3.5">
            <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Icon name="list" className="h-4 w-4 text-violet-600" />
              내가 만든 문항
              {lastSavedIds.length > 0 && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 anim-fade-slide-top">
                  방금 저장 {lastSavedIds.length}건
                </span>
              )}
            </span>
            <Link
              href={
                lastSavedIds[0]
                  ? `/my/premium/member-variants?focus=${encodeURIComponent(lastSavedIds[0])}`
                  : '/my/premium/member-variants'
              }
              className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-800 transition hover:border-violet-400 hover:bg-violet-100"
            >
              자세히 보기
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
          <div className="border-t border-slate-100">
            <MemberVariantsMini
              refreshKey={listRefreshKey}
              highlightVariantId={lastSavedIds[0]}
            />
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-slate-400">
          <button
            type="button"
            className="underline decoration-slate-300 underline-offset-2 hover:text-slate-600"
            onClick={() => { resetVariantGenerateNoticeDismissals(); setNoticeVisible(true); }}
          >
            안내 다시 보기
          </button>
        </p>
      </div>

      {/* ===== 하단 고정 CTA ===== */}
      {!busy && drafts.length === 0 && lastSavedIds.length === 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md shadow-[0_-4px_24px_rgba(0,0,0,0.05)]">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <div className="hidden min-w-0 flex-1 sm:block">
              {canGenerate ? (
                <p className="truncate text-sm text-slate-600">
                  <strong className="text-violet-700">지문 {charCount.toLocaleString()}자</strong> ·{' '}
                  <strong className="text-violet-700">유형 {selectedTypes.length}개</strong> 준비 완료
                </p>
              ) : (
                <p className="truncate text-xs text-slate-500">{generateHintMsg}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                pageMode === 'essay' ? void handleEssayGenerate() : void handleGenerate()
              }
              disabled={!canGenerate}
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold transition-all sm:flex-none sm:min-w-[260px] sm:text-[15px] ${
                canGenerate
                  ? pageMode === 'essay'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg hover:shadow-xl hover:from-emerald-700 hover:to-teal-700 active:scale-[0.98]'
                    : 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg hover:shadow-xl hover:from-violet-700 hover:to-indigo-700 active:scale-[0.98]'
                  : 'cursor-not-allowed bg-slate-200 text-slate-400'
              }`}
            >
              <Icon name="sparkle" className="h-5 w-5" />
              {pageMode === 'essay'
                ? `「${selectedEssayType}」 초안 만들기`
                : selectedTypes.length > 1
                  ? `${selectedTypes.length}개 유형 초안 만들기`
                  : selectedTypes.length === 1
                    ? `「${selectedTypes[0]}」 초안 만들기`
                    : '초안 만들기'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==========================================================
   보조 컴포넌트
   ========================================================== */

type StepItem = { num: number; label: string; done: boolean; onClick?: () => void };

function StepIndicator({ steps, currentIdx }: { steps: StepItem[]; currentIdx: number }) {
  return (
    <ol className="flex items-center justify-between gap-1 text-xs">
      {steps.map((s, i) => {
        const isCurrent = i === currentIdx;
        const isDone = s.done;
        const interactive = !!s.onClick;
        const next = steps[i + 1];
        const lineActive = isDone && (next?.done || i + 1 === currentIdx);
        return (
          <li key={s.num} className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={s.onClick}
              disabled={!interactive}
              className={`group flex min-w-0 items-center gap-2 ${interactive ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
                {isCurrent && (
                  <>
                    <span className="absolute inset-0 rounded-full bg-violet-400 opacity-50 animate-ping" />
                    <span className="absolute inset-0 rounded-full ring-2 ring-violet-400" />
                  </>
                )}
                <span
                  className={`relative flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold transition-all duration-300 ${
                    isDone
                      ? 'bg-violet-600 text-white shadow-sm'
                      : isCurrent
                        ? 'scale-110 bg-white text-violet-700 ring-1 ring-violet-300'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {isDone ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                      <path d="M5 12.5l5 5 9-11" />
                    </svg>
                  ) : (
                    s.num
                  )}
                </span>
              </span>
              <span
                className={`hidden truncate font-semibold transition-colors duration-300 sm:inline ${
                  isDone ? 'text-slate-800' : isCurrent ? 'text-violet-700' : 'text-slate-400 group-hover:text-slate-500'
                }`}
              >
                {s.label}
              </span>
              {isCurrent && (
                <span className="anim-fade-slide-bottom hidden items-center gap-1 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white md:inline-flex">
                  지금
                </span>
              )}
            </button>
            {i < steps.length - 1 && (
              <span className="relative h-0.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                <span
                  className="absolute inset-y-0 left-0 bg-violet-500 transition-all duration-700 ease-out"
                  style={{ width: lineActive ? '100%' : isDone ? '60%' : '0%' }}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function SectionHeader({
  num,
  title,
  done,
  optional,
  right,
}: {
  num: number;
  title: string;
  done: boolean;
  optional?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
            done ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-500'
          }`}
        >
          {done ? '✓' : num}
        </span>
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
        {optional && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">선택</span>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

function TypeCard({
  meta,
  active,
  disabled,
  paid,
  onClick,
}: {
  meta: TypeMeta;
  active: boolean;
  disabled?: boolean;
  paid?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-type-chip
      data-type={meta.key}
      disabled={disabled}
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl border-2 p-3 text-left transition-all disabled:opacity-50 ${
        active
          ? paid
            ? 'scale-[1.02] border-amber-500 bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md'
            : 'scale-[1.02] border-violet-600 bg-violet-600 text-white shadow-md'
          : paid
            ? 'border-amber-200 bg-amber-50/40 text-amber-900 hover:border-amber-400 hover:bg-amber-50'
            : 'border-slate-200 bg-white text-slate-700 hover:border-violet-300 hover:bg-violet-50/50'
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <Icon
          name={meta.icon}
          className={`h-4 w-4 ${active ? 'text-white' : paid ? 'text-amber-600' : 'text-violet-500'}`}
        />
        <span className="text-sm font-bold">{meta.label}</span>
        {active && (
          <svg className="ml-auto h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <p
        className={`text-[11px] leading-snug ${
          active ? (paid ? 'text-amber-50' : 'text-violet-100') : paid ? 'text-amber-700' : 'text-slate-500'
        }`}
      >
        {meta.desc}
      </p>
    </button>
  );
}

function GeneratingPanel({
  stageIdx,
  progress,
  selectedCount,
}: {
  stageIdx: number;
  progress: GenerationProgress | null;
  selectedCount: number;
}) {
  const total = progress?.total ?? selectedCount ?? 1;
  const current = progress?.current ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-6 shadow-sm anim-fade-slide-bottom">
      <div className="flex flex-col items-center text-center">
        <div className="relative mb-4">
          <div className="h-14 w-14 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
          <Icon name="sparkle" className="absolute inset-0 m-auto h-6 w-6 text-violet-600" />
        </div>
        {total > 1 ? (
          <>
            <p className="text-xs font-bold uppercase tracking-wider text-violet-500">
              {current} / {total} 유형 처리 중
            </p>
            <p className="mt-1 text-base font-bold text-slate-800">
              「{progress?.currentLabel ?? '…'}」 작성 중
            </p>
            <div className="mt-3 h-2 w-full max-w-[260px] overflow-hidden rounded-full bg-violet-100">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        ) : (
          <>
            <p className="text-xs font-bold uppercase tracking-wider text-violet-500">
              {progress?.currentLabel ?? '변형문제'} 생성 중
            </p>
            <p className="mt-1 text-lg font-bold text-slate-800" key={stageIdx}>
              {PROGRESS_STAGES[stageIdx]}…
            </p>
          </>
        )}
        <div className="mt-4 flex gap-1.5">
          {PROGRESS_STAGES.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i <= stageIdx ? 'w-6 bg-violet-600' : 'w-3 bg-violet-200'
              }`}
            />
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-500">
          보통 10~30초 정도 걸립니다. 잠시만 기다려 주세요.
        </p>
      </div>
    </div>
  );
}

function ResultPanel({
  drafts,
  activeIdx,
  onActiveIdx,
  editMode,
  onEditMode,
  busy,
  onSave,
  onRegenerate,
  onUpdateDraft,
  failedResults,
}: {
  drafts: VariantDraftItem[];
  activeIdx: number;
  onActiveIdx: (i: number) => void;
  editMode: boolean;
  onEditMode: (v: boolean) => void;
  busy: boolean;
  onSave: () => void;
  onRegenerate: () => void;
  onUpdateDraft: (i: number, updated: Record<string, unknown>) => void;
  failedResults: PerTypeResult[];
}) {
  const i = Math.min(activeIdx, drafts.length - 1);
  const d = drafts[i];
  if (!d) return null;
  const multi = drafts.length > 1;

  return (
    <div className="space-y-3 anim-fade-slide-bottom">
      {/* 성공 헤더 */}
      <div className="rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
            <Icon name="check" className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-black sm:text-lg">
              {multi ? `${drafts.length}개 초안 준비 완료` : '초안이 준비되었어요!'}
            </h2>
            <p className="text-xs text-emerald-100">
              확인 후 저장하면 내 문항에 「대기」로 추가됩니다
            </p>
          </div>
        </div>
      </div>

      {/* 실패 요약 */}
      {failedResults.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs anim-fade-slide-top">
          <p className="font-bold text-red-800">
            {failedResults.length}개 유형은 실패했습니다
          </p>
          <ul className="mt-1.5 space-y-0.5 text-red-700">
            {failedResults.map((r) => (
              <li key={r.type}>
                <strong>{r.type}</strong>: {r.error ?? '실패'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 초안 탭 */}
      {multi && (
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5">
          {drafts.map((x, idx) => {
            const active = idx === i;
            return (
              <button
                key={`${x.type}-${idx}`}
                type="button"
                onClick={() => onActiveIdx(idx)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition ${
                  active ? 'bg-violet-600 text-white shadow-sm' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {idx + 1}. {x.type}
              </button>
            );
          })}
        </div>
      )}

      {/* 본문 */}
      <div className="rounded-3xl border-2 border-violet-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-3 py-1 text-[11px] font-bold text-violet-800">
            <Icon name="sparkle" className="h-3 w-3" />
            {d.type}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={onRegenerate}
              className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-violet-700 transition hover:bg-violet-50 disabled:opacity-50"
            >
              <Icon name="refresh" className="h-3 w-3" />
              다시 만들기
            </button>
            <button
              type="button"
              onClick={() => onEditMode(!editMode)}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${
                editMode
                  ? 'bg-violet-600 text-white hover:bg-violet-700'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {editMode ? '수정 완료' : '수정'}
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-3">
          {(MEMBER_ESSAY_QUESTION_TYPES as readonly string[]).includes(d.type) ? (
            <EssayQuestionPreview
              data={d.question_data}
              editable={editMode}
              onDataChange={(updated) => onUpdateDraft(i, updated)}
              questionType={d.type}
            />
          ) : (
            <QuestionFriendlyPreview
              data={d.question_data}
              editable={editMode}
              onDataChange={(updated) => onUpdateDraft(i, updated)}
            />
          )}
        </div>
      </div>

      {/* 저장 CTA */}
      <button
        type="button"
        disabled={busy}
        onClick={onSave}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 py-4 text-base font-bold text-white shadow-lg shadow-emerald-500/30 transition hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50"
      >
        <Icon name="save" className="h-5 w-5" />
        {multi ? `${drafts.length}개 전부 저장` : '저장하기'}
      </button>
      <p className="text-center text-[11px] text-slate-500">
        저장하면 내보내기(HWP·Excel)와 검수 기능을 바로 사용할 수 있어요.
      </p>
    </div>
  );
}

function SavedSuccessPanel({
  savedCount,
  onJumpList,
  onMakeMore,
  onReset,
}: {
  savedCount: number;
  onJumpList: () => void;
  onMakeMore: () => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-3 anim-fade-slide-bottom">
      <div className="rounded-3xl bg-gradient-to-br from-emerald-500 to-green-600 p-6 text-white shadow-lg">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <Icon name="save" className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black">
              {savedCount > 1 ? `${savedCount}개 문항 저장 완료` : '저장 완료!'}
            </h2>
            <p className="mt-1 text-sm text-emerald-100">
              상태는 <strong className="text-white">「대기」</strong>로 표시됩니다. 검수를 마치면 완료로 바꿔 주세요.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={onJumpList}
          className="inline-flex w-full items-center justify-between gap-3 rounded-2xl border-2 border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 px-4 py-3.5 text-left transition hover:border-violet-400 hover:bg-violet-100/50"
        >
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-bold text-violet-900">
              <Icon name="download" className="h-4 w-4" />
              자세히 보기 · Export · 검수
            </p>
            <p className="mt-0.5 text-[11px] text-violet-700">
              「내가 만든 문항」 페이지에서 HWP · Excel · Word · PDF 내보내기와 GPT/Claude 검수까지
            </p>
          </div>
          <Icon name="arrowRight" className="h-5 w-5 shrink-0 text-violet-600" />
        </button>

        <button
          type="button"
          onClick={onMakeMore}
          className="inline-flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:bg-slate-50"
        >
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <Icon name="plus" className="h-4 w-4 text-violet-600" />
              같은 지문으로 다른 유형 더 만들기
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              지문·교재·출처는 유지하고 유형만 새로 고르기
            </p>
          </div>
          <Icon name="arrowRight" className="h-5 w-5 shrink-0 text-slate-400" />
        </button>

        <button
          type="button"
          onClick={onReset}
          className="inline-flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:bg-slate-50"
        >
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <Icon name="refresh" className="h-4 w-4 text-slate-500" />
              처음부터 다시
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">입력 전부 초기화</p>
          </div>
          <Icon name="arrowRight" className="h-5 w-5 shrink-0 text-slate-400" />
        </button>
      </div>
    </div>
  );
}

function IdlePreviewPanel({
  hasKey,
  hasParagraph,
  hasType,
  selectedCount,
  firstSelected,
}: {
  hasKey: boolean;
  hasParagraph: boolean;
  hasType: boolean;
  selectedCount: number;
  firstSelected: TypeMeta | undefined;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-500">
          <Icon name={firstSelected?.icon ?? 'sparkle'} className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-bold text-slate-800">
          {selectedCount > 1
            ? `${selectedCount}개 유형의 변형문제가 여기에`
            : `「${firstSelected?.label ?? '주제'}」 변형문제가 여기에`}
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          {firstSelected?.desc ?? '지문과 유형을 고르면 바로 표시됩니다'}
        </p>

        <div className="mt-5 space-y-1.5 text-left">
          <ProgressLine done={hasKey} text="API 키 등록 (내 정보에서)" />
          <ProgressLine done={hasParagraph} text="영어 지문 10자 이상" />
          <ProgressLine done={hasType} text="문제 유형 선택" />
        </div>
      </div>

      <div className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-indigo-50 p-4">
        <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-violet-600">
          프리미엄 슈퍼파워
        </h4>
        <ul className="space-y-1.5 text-xs text-slate-700">
          {[
            { icon: 'bolt' as IconName, t: '여러 유형을 한 번에 선택해 한 지문으로 3~12문항 연속 생성' },
            { icon: 'book' as IconName, t: 'EBS·모의고사 지문을 소스 불러오기로 바로 채우기' },
            { icon: 'save' as IconName, t: '저장한 문항은 DB에 남고 「대기→완료」 검수 워크플로 연동' },
            { icon: 'download' as IconName, t: 'HWP · Excel · Word · PDF로 바로 내보내기' },
          ].map((it) => (
            <li key={it.t} className="flex items-start gap-2">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-600/10 text-violet-700">
                <Icon name={it.icon} className="h-2.5 w-2.5" />
              </span>
              <span className="leading-relaxed">{it.t}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ProgressLine({ done, text }: { done: boolean; text: string }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold ${
        done ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-400'
      }`}
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full ${
          done ? 'bg-emerald-500 text-white' : 'border border-slate-300'
        }`}
      >
        {done && (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-2.5 w-2.5"
          >
            <path d="M5 12.5l5 5 9-11" />
          </svg>
        )}
      </span>
      {text}
    </div>
  );
}

/* ───────────── 아이콘 ───────────── */

function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  const props = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };
  switch (name) {
    case 'target':
      return (<svg {...props}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></svg>);
    case 'heading':
      return (<svg {...props}><path d="M5 6h14" /><path d="M5 12h10" /><path d="M5 18h14" /></svg>);
    case 'quote':
      return (<svg {...props}><path d="M4 8.5C4 7.1 5.1 6 6.5 6h11C18.9 6 20 7.1 20 8.5v6c0 1.4-1.1 2.5-2.5 2.5H10l-4 4v-4H6.5C5.1 17 4 15.9 4 14.5z" /></svg>);
    case 'check':
      return (<svg {...props}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>);
    case 'x':
      return (<svg {...props}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>);
    case 'bulb':
      return (<svg {...props}><path d="M9 18h6" /><path d="M10 21h4" /><path d="M12 3a6 6 0 00-4 10.5c1 1 1.5 2 1.5 3v.5h5V16.5c0-1 .5-2 1.5-3A6 6 0 0012 3z" /></svg>);
    case 'puzzle':
      return (<svg {...props}><path d="M5 9V6a1 1 0 011-1h4a2 2 0 014 0h4a1 1 0 011 1v4a2 2 0 010 4v4a1 1 0 01-1 1h-4a2 2 0 01-4 0H6a1 1 0 01-1-1v-4a2 2 0 010-4z" /></svg>);
    case 'note':
      return (<svg {...props}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>);
    case 'search':
      return (<svg {...props}><circle cx="11" cy="11" r="6" /><path d="M16 16l4 4" /></svg>);
    case 'order':
      return (<svg {...props}><path d="M4 7h2M4 12h2M4 17h2" /><path d="M9 7h11M9 12h11M9 17h11" /></svg>);
    case 'insert':
      return (<svg {...props}><path d="M3 12h18" /><path d="M12 6v12" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>);
    case 'block':
      return (<svg {...props}><circle cx="12" cy="12" r="9" /><path d="M5.5 5.5l13 13" /></svg>);
    case 'key':
      return (<svg {...props}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9" /><path d="M16 7l3 3" /></svg>);
    case 'shield':
      return (<svg {...props}><path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></svg>);
    case 'sparkle':
      return (<svg {...props}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></svg>);
    case 'gem':
      return (<svg {...props}><path d="M6 4h12l3 6-9 11L3 10z" /><path d="M3 10h18M9 4l3 6 3-6M12 10v11" /></svg>);
    case 'book':
      return (<svg {...props}><path d="M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4z" /><path d="M20 4h-7a3 3 0 00-3 3v13a2 2 0 012-2h8z" /></svg>);
    case 'save':
      return (<svg {...props}><path d="M5 5a2 2 0 012-2h8l4 4v12a2 2 0 01-2 2H7a2 2 0 01-2-2z" /><path d="M8 3v5h7" /><circle cx="12" cy="14" r="2" /></svg>);
    case 'download':
      return (<svg {...props}><path d="M12 4v12" /><path d="M7 11l5 5 5-5" /><path d="M5 20h14" /></svg>);
    case 'bolt':
      return (<svg {...props}><path d="M13 3L5 14h6l-1 7 8-11h-6z" /></svg>);
    case 'arrowRight':
      return (<svg {...props}><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>);
    case 'plus':
      return (<svg {...props}><path d="M12 5v14M5 12h14" /></svg>);
    case 'lock':
      return (<svg {...props}><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>);
    case 'list':
      return (<svg {...props}><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" /></svg>);
    case 'refresh':
      return (<svg {...props}><path d="M4 4v6h6" /><path d="M20 20v-6h-6" /><path d="M5 14a8 8 0 0013.5 3.5L20 16" /><path d="M19 10A8 8 0 005.5 6.5L4 8" /></svg>);
    default:
      return null;
  }
}
