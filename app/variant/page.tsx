'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppBar from '@/app/components/AppBar';
import {
  GUEST_BYOK_ID,
  readStoredByokAnthropicKey,
  writeStoredByokAnthropicKey,
} from '@/lib/member-byok-anthropic-key-storage';
import QuestionFriendlyPreview from '@/app/my/premium/variant-generate/QuestionFriendlyPreview';
import EssayQuestionPreview from '@/app/my/premium/variant-generate/EssayQuestionPreview';
import { MEMBER_ESSAY_QUESTION_TYPES } from '@/lib/member-essay-draft-claude';

const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

type IconName =
  | 'target' | 'heading' | 'quote' | 'check' | 'x' | 'bulb' | 'puzzle' | 'note'
  | 'search' | 'order' | 'insert' | 'block'
  | 'key' | 'shield' | 'sparkle' | 'gem' | 'book' | 'save' | 'download' | 'bolt'
  | 'arrowRight' | 'plus';

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

/** 서술형 — 요약문 본문 어휘 찾기 (첫 번째 유형만) */
const ESSAY_TYPE: TypeMeta = {
  key: '요약문본문어휘',
  label: '요약문 본문 어휘 찾기',
  desc: '본문에서 단어를 직접 찾아 요약문 빈칸 완성 (변형 가능)',
  icon: 'note',
};

type PageMode = 'multiple-choice' | 'essay';

const SAMPLE_PARAGRAPH = `Most people think that creativity is something you are born with — that you either have it or you don't. But research suggests otherwise. Studies have repeatedly shown that creativity is a skill, much like playing the piano or speaking a foreign language. The more you practice it, the better you become. What truly separates highly creative people from the rest is not raw talent, but their willingness to explore unfamiliar ideas, fail repeatedly, and try again. In short, creativity grows through deliberate effort, not through waiting for inspiration to strike.`;

const PROGRESS_STAGES = [
  '지문을 분석하는 중',
  '핵심 아이디어를 추출하는 중',
  '변형문제를 작성하는 중',
  '선택지·해설을 다듬는 중',
];

type DraftItem = {
  type: string;
  question_data: Record<string, unknown>;
};

type UserInfo = {
  loginId: string;
  isPremiumMember: boolean;
} | null;

export default function VariantTryPage() {
  const router = useRouter();
  const [paragraph, setParagraph] = useState('');
  const [selectedType, setSelectedType] = useState('주제');
  const [pageMode, setPageMode] = useState<PageMode>('multiple-choice');
  const [busy, setBusy] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [draft, setDraft] = useState<DraftItem | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo>(null);
  const [userChecked, setUserChecked] = useState(false);

  /** BYOK */
  const [apiKey, setApiKey] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyInputBuf, setKeyInputBuf] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const typeSectionRef = useRef<HTMLDivElement>(null);
  const apiSectionRef = useRef<HTMLDivElement>(null);
  const msgTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const charCount = paragraph.length;
  const wordCount = useMemo(
    () => paragraph.trim().split(/\s+/).filter(Boolean).length,
    [paragraph],
  );

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(140, Math.min(el.scrollHeight, 480))}px`;
  }, []);

  useEffect(() => { autoGrow(); }, [paragraph, autoGrow]);

  /** 프리미엄 회원은 전체 기능 페이지로 리다이렉트 */
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.user) {
          if (d.user.isPremiumMember === true) {
            router.replace('/my/premium/variant-generate');
            return;
          }
          setUserInfo({
            loginId: typeof d.user.loginId === 'string' ? d.user.loginId : '',
            isPremiumMember: false,
          });
        }
      })
      .catch(() => {})
      .finally(() => setUserChecked(true));
  }, [router]);

  /** BYOK 키 로드 */
  useEffect(() => {
    if (!userChecked) return;
    const id = userInfo?.loginId || GUEST_BYOK_ID;
    const stored = readStoredByokAnthropicKey(id);
    if (stored) {
      setApiKey(stored);
      setApiKeySaved(true);
    }
  }, [userChecked, userInfo]);

  /** 생성 진행 단계 애니메이션 */
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

  const showMessage = useCallback((msg: { kind: 'ok' | 'err'; text: string }, autoHide = false) => {
    if (msgTimeoutRef.current) clearTimeout(msgTimeoutRef.current);
    setMessage(msg);
    if (autoHide) {
      msgTimeoutRef.current = setTimeout(() => setMessage(null), 6000);
    }
  }, []);

  const handleSaveKey = () => {
    const trimmed = keyInputBuf.trim();
    if (!trimmed.startsWith('sk-ant-')) {
      showMessage({ kind: 'err', text: 'Anthropic API 키는 sk-ant- 로 시작해야 합니다.' }, true);
      return;
    }
    const id = userInfo?.loginId || GUEST_BYOK_ID;
    writeStoredByokAnthropicKey(id, trimmed);
    setApiKey(trimmed);
    setApiKeySaved(true);
    setShowKeyInput(false);
    setKeyInputBuf('');
    showMessage({ kind: 'ok', text: 'API 키가 이 브라우저에 저장되었습니다.' }, true);
  };

  const handleRemoveKey = () => {
    const id = userInfo?.loginId || GUEST_BYOK_ID;
    writeStoredByokAnthropicKey(id, '');
    setApiKey('');
    setApiKeySaved(false);
    setKeyInputBuf('');
  };

  const handleUseSample = () => {
    setParagraph(SAMPLE_PARAGRAPH);
    setTimeout(() => typeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  };

  const handleGenerate = async () => {
    setMessage(null);
    if (charCount < 10) {
      showMessage({ kind: 'err', text: '영어 지문을 10자 이상 입력해 주세요.' });
      textareaRef.current?.focus();
      return;
    }
    if (!apiKey) {
      showMessage({ kind: 'err', text: 'Anthropic API 키를 먼저 등록해 주세요.' });
      setShowKeyInput(true);
      apiSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setBusy(true);
    setDraft(null);
    try {
      const res = await fetch('/api/variant/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-anthropic-api-key': apiKey },
        body: JSON.stringify({
          paragraph: paragraph.trim(),
          type: selectedType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = typeof data?.error === 'string' ? data.error : '생성에 실패했습니다.';
        showMessage({ kind: 'err', text: errMsg });
        return;
      }
      const qd =
        data.question_data && typeof data.question_data === 'object' && !Array.isArray(data.question_data)
          ? (data.question_data as Record<string, unknown>)
          : null;
      if (!qd) {
        showMessage({ kind: 'err', text: '응답 형식 오류입니다.' });
        return;
      }
      setDraft({ type: typeof data.type === 'string' ? data.type : selectedType, question_data: qd });
      setTimeout(() => {
        previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    } catch {
      showMessage({ kind: 'err', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  const handleEssayGenerate = async () => {
    setMessage(null);
    if (charCount < 10) {
      showMessage({ kind: 'err', text: '영어 지문을 10자 이상 입력해 주세요.' });
      textareaRef.current?.focus();
      return;
    }
    if (!apiKey) {
      showMessage({ kind: 'err', text: 'Anthropic API 키를 먼저 등록해 주세요.' });
      setShowKeyInput(true);
      apiSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setBusy(true);
    setDraft(null);
    try {
      const res = await fetch('/api/variant/essay-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-anthropic-api-key': apiKey },
        body: JSON.stringify({ paragraph: paragraph.trim(), type: ESSAY_TYPE.key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMessage({ kind: 'err', text: typeof data?.error === 'string' ? data.error : '생성에 실패했습니다.' });
        return;
      }
      const qd =
        data.question_data && typeof data.question_data === 'object' && !Array.isArray(data.question_data)
          ? (data.question_data as Record<string, unknown>)
          : null;
      if (!qd) {
        showMessage({ kind: 'err', text: '응답 형식 오류입니다.' });
        return;
      }
      setDraft({ type: ESSAY_TYPE.key, question_data: qd });
      setTimeout(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
    } catch {
      showMessage({ kind: 'err', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  const stepDone = {
    key: apiKeySaved,
    paragraph: charCount >= 10,
    type: !!selectedType,
  };
  const stepFlags = [stepDone.key, stepDone.paragraph, stepDone.type, !!draft];
  const firstIncompleteIdx = stepFlags.findIndex((d) => !d);
  const currentStepIdx = firstIncompleteIdx === -1 ? -1 : firstIncompleteIdx;
  const canGenerate = stepDone.key && stepDone.paragraph && !busy &&
    (pageMode === 'essay' || stepDone.type);
  const selectedTypeMeta = pageMode === 'essay' ? ESSAY_TYPE : ALL_TYPES.find((t) => t.key === selectedType);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      <AppBar title="변형문제 만들기" />

      {/* STEP INDICATOR (sticky) */}
      <div className="sticky top-16 z-30 border-b border-slate-100 bg-white/90 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <StepIndicator
            steps={[
              { num: 1, label: 'API 키', done: stepDone.key, onClick: () => apiSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
              { num: 2, label: '지문 입력', done: stepDone.paragraph, onClick: () => textareaRef.current?.focus() },
              { num: 3, label: '유형 선택', done: stepDone.type, onClick: () => typeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
              { num: 4, label: '생성', done: !!draft },
            ]}
            currentIdx={currentStepIdx}
          />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 pb-32 lg:grid lg:grid-cols-12 lg:gap-8">

        {/* 좌측: 입력 영역 */}
        <div className="lg:col-span-7 space-y-8">

        {/* 1. API 키 */}
        <section ref={apiSectionRef} className="scroll-mt-32">
          <SectionHeader num={1} title="Anthropic API 키" done={apiKeySaved} />
          <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {apiKeySaved ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                    <Icon name="key" className="h-4 w-4 text-emerald-600" />
                    <span className="text-sm font-mono text-slate-600 truncate">
                      {apiKey.slice(0, 14)}••••••••••••
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setKeyInputBuf(''); setShowKeyInput(true); }}
                    className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    변경
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveKey}
                    className="rounded-xl border border-red-100 px-3 py-2.5 text-xs font-semibold text-red-500 hover:bg-red-50"
                  >
                    삭제
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">이 브라우저에만 저장되어 있습니다. 페이지 닫아도 유지됩니다.</p>
              </>
            ) : showKeyInput ? (
              <div className="space-y-3">
                <input
                  type="password"
                  value={keyInputBuf}
                  onChange={(e) => setKeyInputBuf(e.target.value)}
                  placeholder="sk-ant-api..."
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-mono focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey(); }}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSaveKey}
                    className="flex-1 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700"
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowKeyInput(false)}
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    취소
                  </button>
                </div>
                <SafetyNote />
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setShowKeyInput(true)}
                  className="group w-full rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50/40 py-6 text-center transition-all hover:border-violet-500 hover:bg-violet-50"
                >
                  <Icon name="key" className="mx-auto mb-2 h-6 w-6 text-violet-600" />
                  <div className="text-sm font-bold text-violet-700">API 키 등록하기</div>
                  <div className="text-[11px] text-violet-500 mt-0.5">클릭해서 입력</div>
                </button>
                <SafetyNote />
              </>
            )}
          </div>
        </section>

        {/* 2. 지문 입력 */}
        <section className="scroll-mt-32">
          <SectionHeader num={2} title="영어 지문 입력" done={stepDone.paragraph} />
          <div className="mt-3 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-3 text-xs">
                <span className={charCount >= 10 ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
                  {charCount}자
                </span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-500">{wordCount}단어</span>
              </div>
              <button
                type="button"
                onClick={handleUseSample}
                className="text-[11px] font-bold text-violet-600 hover:text-violet-800 hover:underline"
              >
                샘플 채우기
              </button>
            </div>
            <textarea
              ref={textareaRef}
              value={paragraph}
              onChange={(e) => setParagraph(e.target.value)}
              placeholder="이곳에 영어 지문을 붙여 넣으세요. EBS 수능특강·모의고사·학교 시험 지문 등 무엇이든 좋습니다."
              className="w-full resize-none px-5 py-4 text-[15px] leading-relaxed text-slate-800 placeholder-slate-400 focus:outline-none"
              style={{ minHeight: 140 }}
            />
          </div>
        </section>

        {/* 3. 유형 선택 */}
        <section ref={typeSectionRef} className="scroll-mt-32">
          <SectionHeader
            num={3}
            title="문제 유형 선택"
            done={pageMode === 'essay' ? true : stepDone.type}
          />

          {/* 객관식 / 서술형 탭 */}
          <div className="mt-3 mb-4 flex rounded-xl overflow-hidden border border-slate-200 bg-slate-100 p-1 gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => { setPageMode('multiple-choice'); setDraft(null); }}
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
              disabled={busy}
              onClick={() => { setPageMode('essay'); setDraft(null); }}
              className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
                pageMode === 'essay'
                  ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              서술형 (요약문)
            </button>
          </div>

          {/* 객관식 유형 카드 */}
          {pageMode === 'multiple-choice' && (
            <div className="space-y-4">
              {TYPE_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-xs font-bold text-slate-500 mb-2 px-1 uppercase tracking-wider">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {group.items.map((t) => {
                      const active = selectedType === t.key;
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setSelectedType(t.key)}
                          className={`group relative overflow-hidden rounded-2xl border-2 p-3 text-left transition-all ${
                            active
                              ? 'border-violet-600 bg-violet-600 text-white shadow-md scale-[1.02]'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-violet-300 hover:bg-violet-50/50'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Icon name={t.icon} className={`h-4 w-4 ${active ? 'text-white' : 'text-violet-500'}`} />
                            <span className="text-sm font-bold">{t.label}</span>
                          </div>
                          <p className={`text-[11px] leading-snug ${active ? 'text-violet-100' : 'text-slate-500'}`}>
                            {t.desc}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 서술형 유형 카드 */}
          {pageMode === 'essay' && (
            <div>
              <p className="text-[11px] text-slate-500 mb-3 px-1 leading-relaxed">
                지문을 읽고 본문에서 단어를 찾아 요약문의 빈칸을 완성하는 서술형 문항입니다.
              </p>
              <button
                type="button"
                className="w-full rounded-2xl border-2 border-emerald-600 bg-emerald-600 text-white p-4 text-left shadow-md scale-[1.01] cursor-default"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon name="note" className="h-4 w-4 text-white" />
                  <span className="text-sm font-bold">{ESSAY_TYPE.label}</span>
                  <svg className="ml-auto h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-[11px] leading-snug text-emerald-100">{ESSAY_TYPE.desc}</p>
              </button>
            </div>
          )}
        </section>

        {/* 메시지 */}
        {message && (
          <div
            className={`rounded-2xl px-4 py-3 text-sm font-semibold anim-fade-slide-top ${
              message.kind === 'ok'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* 모바일 결과 (lg 미만) */}
        <div className="lg:hidden">
          {(busy || draft) && (
            <div ref={previewRef} className="scroll-mt-32">
              {busy && <GeneratingPanel stageIdx={stageIdx} typeLabel={selectedTypeMeta?.label || selectedType} />}
              {draft && !busy && (
                <ResultPanel
                  draft={draft}
                  onClose={() => setDraft(null)}
                  onTryAnother={() => {
                    setDraft(null);
                    typeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  pageMode={pageMode}
                />
              )}
            </div>
          )}
        </div>

        </div>

        {/* 우측: 결과·미리보기 (lg+ sticky) */}
        <aside className="hidden lg:block lg:col-span-5">
          <div className="sticky top-32 space-y-4">
            {busy ? (
              <div ref={previewRef}>
                <GeneratingPanel stageIdx={stageIdx} typeLabel={selectedTypeMeta?.label || selectedType} />
              </div>
            ) : draft ? (
              <div ref={previewRef}>
                <ResultPanel
                  draft={draft}
                  onClose={() => setDraft(null)}
                  onTryAnother={() => {
                    setDraft(null);
                    typeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  pageMode={pageMode}
                />
              </div>
            ) : (
              <IdlePreviewPanel
                hasParagraph={charCount >= 10}
                hasKey={apiKeySaved}
                typeMeta={selectedTypeMeta}
              />
            )}
          </div>
        </aside>
      </div>

      {/* STICKY 액션 바 */}
      {!busy && !draft && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md shadow-[0_-4px_24px_rgba(0,0,0,0.05)]">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
            <div className="hidden sm:block flex-1">
              {canGenerate ? (
                <p className="text-sm text-slate-600">
                  <strong className="text-violet-700">「{selectedTypeMeta?.label}」</strong> 변형문제를 만들 준비가 되었습니다
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  {!stepDone.key && '① API 키를 등록해 주세요'}
                  {stepDone.key && !stepDone.paragraph && '② 영어 지문을 입력해 주세요 (10자 이상)'}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void (pageMode === 'essay' ? handleEssayGenerate() : handleGenerate())}
              disabled={!canGenerate}
              className={`flex-1 sm:flex-none sm:min-w-[260px] inline-flex items-center justify-center gap-2 rounded-2xl py-3.5 text-base font-bold transition-all ${
                canGenerate
                  ? pageMode === 'essay'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg hover:shadow-xl hover:from-emerald-700 hover:to-teal-700 active:scale-[0.98]'
                    : 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg hover:shadow-xl hover:from-violet-700 hover:to-indigo-700 active:scale-[0.98]'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              {selectedTypeMeta && <Icon name={selectedTypeMeta.icon} className="h-5 w-5" />}
              「{selectedTypeMeta?.label}」 {pageMode === 'essay' ? '서술형 만들기' : '변형문제 만들기'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────── 보조 컴포넌트 ───────────── */

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
          <li key={s.num} className="flex items-center gap-2 flex-1 min-w-0">
            <button
              type="button"
              onClick={s.onClick}
              disabled={!interactive}
              className={`group flex items-center gap-2 min-w-0 ${interactive ? 'cursor-pointer' : 'cursor-default'}`}
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
                        ? 'bg-white text-violet-700 ring-1 ring-violet-300 scale-110'
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
                className={`hidden sm:inline truncate font-semibold transition-colors duration-300 ${
                  isDone
                    ? 'text-slate-800'
                    : isCurrent
                      ? 'text-violet-700'
                      : 'text-slate-400 group-hover:text-slate-500'
                }`}
              >
                {s.label}
              </span>
              {isCurrent && (
                <span className="hidden md:inline-flex items-center gap-1 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white anim-fade-slide-bottom">
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

function SectionHeader({ num, title, done }: { num: number; title: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
          done ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-500'
        }`}
      >
        {done ? '✓' : num}
      </span>
      <h2 className="text-sm font-bold text-slate-800">{title}</h2>
    </div>
  );
}

function SafetyNote() {
  return (
    <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 p-3">
      <div className="flex items-start gap-2">
        <Icon name="shield" className="h-4 w-4 shrink-0 text-slate-500 mt-0.5" />
        <div className="text-[11px] text-slate-600 leading-relaxed">
          <strong className="text-slate-800">키는 이 브라우저에만 저장됩니다.</strong>
          {' '}서버로 전송되거나 DB에 저장되지 않으며, 변형문제 생성 시에만 Anthropic으로 그대로 전달됩니다. 과금은 본인 Claude 계정에서 발생합니다.{' '}
          <a
            href="https://platform.claude.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-violet-600 underline"
          >
            키 발급 →
          </a>
        </div>
      </div>
    </div>
  );
}

function GeneratingPanel({ stageIdx, typeLabel }: { stageIdx: number; typeLabel: string }) {
  return (
    <div className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-8 shadow-sm">
      <div className="flex flex-col items-center text-center">
        <div className="relative mb-5">
          <div className="h-16 w-16 rounded-full border-4 border-violet-200 border-t-violet-600 animate-spin" />
          <Icon name="sparkle" className="absolute inset-0 m-auto h-6 w-6 text-violet-600" />
        </div>
        <p className="text-xs font-bold uppercase tracking-wider text-violet-500 mb-1">
          {typeLabel} 변형문제 생성 중
        </p>
        <p className="text-lg font-bold text-slate-800 mb-4 transition-all duration-500" key={stageIdx}>
          {PROGRESS_STAGES[stageIdx]}…
        </p>
        <div className="flex gap-1.5">
          {PROGRESS_STAGES.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i <= stageIdx ? 'w-8 bg-violet-600' : 'w-4 bg-violet-200'
              }`}
            />
          ))}
        </div>
        <p className="mt-5 text-xs text-slate-500">
          보통 10~30초 정도 걸립니다. 잠시만 기다려 주세요.
        </p>
      </div>
    </div>
  );
}

function ResultPanel({
  draft,
  onClose,
  onTryAnother,
  pageMode,
}: {
  draft: DraftItem;
  onClose: () => void;
  onTryAnother: () => void;
  pageMode: PageMode;
}) {
  const isEssay = (MEMBER_ESSAY_QUESTION_TYPES as readonly string[]).includes(draft.type);
  return (
    <div className="space-y-4 anim-fade-slide-bottom">
      {/* 성공 헤더 */}
      <div className={`rounded-3xl p-6 text-white shadow-lg text-center bg-gradient-to-br ${isEssay ? 'from-emerald-500 to-teal-600' : 'from-emerald-500 to-teal-600'}`}>
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
          <Icon name="check" className="h-7 w-7 text-white" />
        </div>
        <h2 className="text-xl font-black">{isEssay ? '서술형 문제가 완성됐어요!' : '변형문제가 완성됐어요!'}</h2>
        <p className="text-sm text-emerald-100 mt-1">「{draft.type}」 유형</p>
      </div>

      {/* 결과 본문 */}
      <div className={`rounded-3xl border-2 bg-white p-5 shadow-sm ${isEssay ? 'border-emerald-200' : 'border-violet-200'}`}>
        {isEssay ? (
          <EssayQuestionPreview
            data={draft.question_data}
            editable={false}
            questionType={draft.type}
          />
        ) : (
          <QuestionFriendlyPreview data={draft.question_data} editable={false} />
        )}

        <div className="mt-6 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={onTryAnother}
            className={`flex-1 rounded-2xl py-3 text-sm font-bold text-white transition-colors ${isEssay ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-violet-600 hover:bg-violet-700'}`}
          >
            ← {isEssay ? '다시 만들어보기' : '다른 유형도 만들어보기'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            닫기
          </button>
        </div>
      </div>

      {/* 회원 유도 — 결과 본 직후가 가장 좋은 타이밍 */}
      <UpgradeBanner />
    </div>
  );
}

function UpgradeBanner() {
  const features: { icon: IconName; text: string }[] = [
    { icon: 'book', text: 'EBS 수능특강·모의고사 지문 자동 불러오기' },
    { icon: 'save', text: '만든 변형문제 DB 저장 및 관리' },
    { icon: 'download', text: 'HWP · Excel 파일로 내보내기' },
    { icon: 'bolt', text: '여러 유형 동시 생성 (한 지문 → 12문항)' },
    { icon: 'target', text: '시험 범위 지정 · 학교별 맞춤 주문' },
  ];
  return (
    <div className="rounded-3xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 p-6 shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
          <Icon name="gem" className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-amber-900">월구독 회원 전용 기능</h3>
          <p className="text-xs text-amber-700 mt-0.5">
            이 결과를 저장하고 활용할 수 있어요
          </p>
        </div>
      </div>

      <ul className="space-y-1.5 text-sm text-amber-900 mb-5">
        {features.map((item) => (
          <li key={item.text} className="flex items-start gap-2.5">
            <Icon name={item.icon} className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>

      <a
        href={KAKAO_INQUIRY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full text-center rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 py-3.5 text-sm font-bold text-white shadow-md hover:from-amber-600 hover:to-orange-600 transition-all active:scale-[0.98]"
      >
        카카오톡으로 가입 문의 →
      </a>
    </div>
  );
}

function IdlePreviewPanel({
  hasParagraph,
  hasKey,
  typeMeta,
}: {
  hasParagraph: boolean;
  hasKey: boolean;
  typeMeta: TypeMeta | undefined;
}) {
  return (
    <div className="space-y-4">
      {/* 미리보기 자리 */}
      <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-violet-500">
          <Icon name={typeMeta?.icon ?? 'sparkle'} className="h-7 w-7" />
        </div>
        <h3 className="text-base font-bold text-slate-700">
          「{typeMeta?.label ?? '주제'}」 변형문제가 여기에 표시됩니다
        </h3>
        <p className="mt-1 text-xs text-slate-500 leading-relaxed">
          {typeMeta?.desc}
        </p>

        <div className="mt-6 space-y-2 text-left">
          <ProgressLine done={hasKey} text="API 키 등록" />
          <ProgressLine done={hasParagraph} text="영어 지문 입력 (10자 이상)" />
          <ProgressLine done={!!typeMeta} text="유형 선택" />
        </div>
      </div>

      {/* 사용 흐름 안내 */}
      <div className="rounded-3xl bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-100 p-5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-violet-600 mb-3">
          이렇게 동작해요
        </h4>
        <ol className="space-y-2.5 text-sm text-slate-700">
          {[
            { n: '1', t: '본인 Claude API 키를 한 번 등록 (브라우저 저장)' },
            { n: '2', t: '영어 지문 한 단락을 붙여 넣기' },
            { n: '3', t: '12가지 유형 중 하나 선택' },
            { n: '4', t: '약 10~30초 후 변형문제 완성' },
          ].map((s) => (
            <li key={s.n} className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
                {s.n}
              </span>
              <span className="leading-relaxed">{s.t}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* 회원 혜택 — 결과 없어도 노출 */}
      <UpgradeBanner />
    </div>
  );
}

function ProgressLine({ done, text }: { done: boolean; text: string }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${
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
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'heading':
      return (
        <svg {...props}>
          <path d="M5 6h14" />
          <path d="M5 12h10" />
          <path d="M5 18h14" />
        </svg>
      );
    case 'quote':
      return (
        <svg {...props}>
          <path d="M4 8.5C4 7.1 5.1 6 6.5 6h11C18.9 6 20 7.1 20 8.5v6c0 1.4-1.1 2.5-2.5 2.5H10l-4 4v-4H6.5C5.1 17 4 15.9 4 14.5z" />
        </svg>
      );
    case 'check':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l3 3 5-6" />
        </svg>
      );
    case 'x':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </svg>
      );
    case 'bulb':
      return (
        <svg {...props}>
          <path d="M9 18h6" />
          <path d="M10 21h4" />
          <path d="M12 3a6 6 0 00-4 10.5c1 1 1.5 2 1.5 3v.5h5V16.5c0-1 .5-2 1.5-3A6 6 0 0012 3z" />
        </svg>
      );
    case 'puzzle':
      return (
        <svg {...props}>
          <path d="M5 9V6a1 1 0 011-1h4a2 2 0 014 0h4a1 1 0 011 1v4a2 2 0 010 4v4a1 1 0 01-1 1h-4a2 2 0 01-4 0H6a1 1 0 01-1-1v-4a2 2 0 010-4z" />
        </svg>
      );
    case 'note':
      return (
        <svg {...props}>
          <rect x="5" y="4" width="14" height="17" rx="2" />
          <path d="M8 9h8M8 13h8M8 17h5" />
        </svg>
      );
    case 'search':
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="6" />
          <path d="M16 16l4 4" />
        </svg>
      );
    case 'order':
      return (
        <svg {...props}>
          <path d="M4 7h2M4 12h2M4 17h2" />
          <path d="M9 7h11M9 12h11M9 17h11" />
        </svg>
      );
    case 'insert':
      return (
        <svg {...props}>
          <path d="M3 12h18" />
          <path d="M12 6v12" />
          <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'block':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M5.5 5.5l13 13" />
        </svg>
      );
    case 'key':
      return (
        <svg {...props}>
          <circle cx="8" cy="15" r="4" />
          <path d="M11 12l9-9" />
          <path d="M16 7l3 3" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...props}>
          <path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg {...props}>
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
          <path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
        </svg>
      );
    case 'gem':
      return (
        <svg {...props}>
          <path d="M6 4h12l3 6-9 11L3 10z" />
          <path d="M3 10h18M9 4l3 6 3-6M12 10v11" />
        </svg>
      );
    case 'book':
      return (
        <svg {...props}>
          <path d="M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4z" />
          <path d="M20 4h-7a3 3 0 00-3 3v13a2 2 0 012-2h8z" />
        </svg>
      );
    case 'save':
      return (
        <svg {...props}>
          <path d="M5 5a2 2 0 012-2h8l4 4v12a2 2 0 01-2 2H7a2 2 0 01-2-2z" />
          <path d="M8 3v5h7" />
          <circle cx="12" cy="14" r="2" />
        </svg>
      );
    case 'download':
      return (
        <svg {...props}>
          <path d="M12 4v12" />
          <path d="M7 11l5 5 5-5" />
          <path d="M5 20h14" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...props}>
          <path d="M13 3L5 14h6l-1 7 8-11h-6z" />
        </svg>
      );
    case 'arrowRight':
      return (
        <svg {...props}>
          <path d="M5 12h14" />
          <path d="M13 6l6 6-6 6" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...props}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    default:
      return null;
  }
}
