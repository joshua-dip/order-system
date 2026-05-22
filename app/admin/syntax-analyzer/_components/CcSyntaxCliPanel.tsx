'use client';

import { useState } from 'react';

interface Props {
  /** 'inline' = 페이지에 박스로 펼침/접힘. 'modal-button' = 버튼만 보이고 클릭 시 모달. */
  variant?: 'inline' | 'modal-button';
  /** 분석 작업대 등에서 현재 지문 ID 가 있으면 명령어에 prefill. */
  passageId?: string;
  /** 홈에서 교재가 선택되었으면 교재 전체 자동 분석 한 줄 명령에 prefill. */
  textbook?: string;
  defaultOpen?: boolean;
}

/** Claude Code Pro 채팅용 cc:syntax CLI 사용 가이드. 인라인 collapsible / 모달 버튼 두 모드. */
export default function CcSyntaxCliPanel({ variant = 'inline', passageId, textbook, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  if (variant === 'modal-button') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full py-2 rounded-lg bg-violet-700/80 text-sm font-bold text-white hover:bg-violet-600 transition-colors"
        >
          🤖 cc:syntax 명령
        </button>
        {open && (
          <div
            className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70 px-4 py-8 overflow-y-auto"
            onClick={() => setOpen(false)}
          >
            <div
              className="bg-slate-900 border border-violet-700/50 rounded-xl shadow-2xl w-full max-w-3xl my-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
                <h2 className="text-sm font-bold text-violet-200">
                  🤖 Claude Code 자동화 (cc:syntax) — Pro 전용
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-slate-400 hover:text-white text-xl leading-none"
                >×</button>
              </header>
              <div className="p-5">
                <CcSyntaxCliContent passageId={passageId} textbook={textbook} />
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  /* inline collapsible */
  return (
    <section className="bg-violet-950/30 border border-violet-700/40 rounded-xl p-4">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full text-left flex items-center justify-between gap-2"
        aria-expanded={open}
      >
        <span className="text-sm font-bold text-violet-200">
          🤖 Claude Code 자동화 (<code className="text-violet-100">cc:syntax</code>) — 한 지문 전 항목 분석 (Pro 전용)
        </span>
        <span className="text-violet-300 text-xs">{open ? '▼ 접기' : '▶ 펼치기'}</span>
      </button>
      {open && (
        <div className="mt-3">
          <CcSyntaxCliContent passageId={passageId} textbook={textbook} />
        </div>
      )}
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * 본문 — passageId 있으면 명령어 prefill, 각 명령어에 클립보드 복사 버튼.
 * ────────────────────────────────────────────────────────────────────────── */

function CcSyntaxCliContent({ passageId, textbook }: { passageId?: string; textbook?: string }) {
  const pid = passageId?.trim() || '<passageId>';
  const draftPath = passageId ? `.syntax-drafts/${passageId}.json` : '.syntax-drafts/<pid>.json';
  const tb = textbook?.trim() ?? '';

  /* 우선순위: passageId(특정 지문) > textbook(교재 전체 루프) > 일반 안내. */
  const oneShotPassage = passageId
    ? `@scripts/cc-syntax-prompt.md 워크플로우대로 passageId ${pid} 한 건의 모든 분석 항목(종합분석·주제문장·서술형대비·어법·문맥·끊어읽기·SVOC·구문·문법태그·문법포인트·단어장) 작성 → dry-run 통과 시 save 까지 자동 진행해줘. 실패 시 errors 보고하고 멈춰.`
    : null;
  const oneShotTextbook = tb
    ? `@scripts/cc-syntax-loop-prompt.md 워크플로우대로 교재 "${tb}" 1 cycle 돌려줘.`
    : null;
  const oneShotPlaceholder = `@scripts/cc-syntax-prompt.md 워크플로우대로 passageId <여기에 ID 붙여넣기> 한 건의 모든 분석 항목 작성 → dry-run 통과 시 save 까지 자동 진행해줘.`;

  return (
    <div className="space-y-3 text-xs text-violet-100/90">
      <p className="leading-relaxed">
        <strong className="text-violet-200">ANTHROPIC API 키 호출 없음</strong> — Pro 채팅에서 분석 JSON 을 작성하고 CLI 가 검증·저장만. 종합분석·주제문장·서술형대비·어법·문맥·끊어읽기·SVOC·구문·문법태그·문법포인트·단어장 등 모든 카테고리를 한 번에 채워 저장.
      </p>

      {/* 교재 prefill 우선 — 교재 1 cycle (loop 워크플로우) */}
      {oneShotTextbook && (
        <div className="rounded-lg bg-emerald-950/30 border-2 border-emerald-500/60 p-3 space-y-2 shadow-[0_0_15px_-5px_rgba(16,185,129,0.5)]">
          <div className="text-[11px] text-emerald-300 font-bold uppercase tracking-wide flex items-center gap-1.5">
            📚 교재 전체 자동 분석 — 「{tb}」
          </div>
          <p className="text-[10px] text-emerald-200/70 leading-relaxed">
            이 문장을 Claude Code 에 paste 하면 클로드가 자동으로 (1) next-empty 로 빈 지문 찾기 → (2) 12 항목 JSON 작성 → (3) 검증 → (4) save → (5) ScheduleWakeup 10 분 뒤 다음 지문. <strong>지문 1 건이 완료된 뒤에도 교재 전체가 끝날 때까지 자동 반복</strong>됩니다.
          </p>
          <BigCopyBlock text={oneShotTextbook} buttonLabel="🚀 교재 자동 분석 시작" tone="emerald" />
        </div>
      )}

      {/* passageId prefill — 단일 지문 1 회 */}
      <div className="rounded-lg bg-amber-950/30 border-2 border-amber-500/60 p-3 space-y-2 shadow-[0_0_15px_-5px_rgba(245,158,11,0.5)]">
        <div className="text-[11px] text-amber-300 font-bold uppercase tracking-wide flex items-center gap-1.5">
          ⚡ 한 지문 한 번에 — Claude Code 채팅에 paste 한 번이면 끝
        </div>
        <p className="text-[10px] text-amber-200/70 leading-relaxed">
          현재 페이지의 지문 1 건만 자동 진행: (1) 지문 받기 → (2) JSON 작성 → (3) dry-run 검증 → (4) save. 실패 시 멈추고 보고.
        </p>
        <BigCopyBlock text={oneShotPassage ?? oneShotPlaceholder} buttonLabel="🚀 명령 복사" tone="amber" />
      </div>

      {passageId && (
        <details className="rounded-lg bg-slate-950/60 border border-violet-700/30 p-3">
          <summary className="text-[11px] text-violet-300 font-semibold uppercase tracking-wide cursor-pointer">
            세분 명령 (단계별 직접 실행 — 디버깅용)
          </summary>
          <div className="mt-2 space-y-2">
            <CmdBlock cmd={`npm run cc:syntax -- passage --id ${pid}`} desc="① 지문 원문·문장표" />
            <CmdBlock cmd={`npm run cc:syntax -- save --json ${draftPath} --dry-run`} desc="② 검증" />
            <CmdBlock cmd={`npm run cc:syntax -- save --json ${draftPath}`} desc="③ 실제 저장" />
            <CmdBlock cmd={`npm run cc:syntax -- export ${pid}`} desc="(백업) 기존 분석 덤프" />
          </div>
        </details>
      )}

      <div className="rounded-lg bg-slate-950/60 border border-violet-700/30 p-3 space-y-2">
        <div className="text-[11px] text-violet-300 font-semibold uppercase tracking-wide">기본 명령</div>
        <CmdBlock cmd="npm run cc:syntax -- textbooks" desc="교재 목록" />
        <CmdBlock cmd={'npm run cc:syntax -- passages --textbook "..."'} desc="지문 목록 + 진척률" />
        {!passageId && <CmdBlock cmd="npm run cc:syntax -- passage --id <passageId>" desc="지문 원문·문장표" />}
        <CmdBlock cmd={'npm run cc:syntax -- shortage --textbook "..." [--required 100]'} desc="진척률 미만 지문" />
        <CmdBlock cmd={'npm run cc:syntax -- next-empty --textbook "..."'} desc="자동 루프용 다음 지문" />
      </div>

      <div className="rounded-lg bg-slate-950/60 border border-violet-700/30 p-3 space-y-1">
        <div className="text-[11px] text-violet-300 font-semibold uppercase tracking-wide">작성 흐름 (Pro 채팅)</div>
        <ol className="list-decimal list-inside text-[11px] space-y-0.5 text-violet-100/85">
          <li><code className="text-emerald-300">passage --id …</code> 로 지문·문장표 받기</li>
          <li><code className="text-emerald-300">scripts/cc-syntax-prompt.md</code> 규칙대로 JSON 작성 ({draftPath})</li>
          <li><code className="text-emerald-300">save --dry-run</code> 으로 검증</li>
          <li>통과 시 <code className="text-emerald-300">save</code> 로 실제 저장</li>
        </ol>
        <p className="text-[10px] text-violet-300/70 mt-2">
          자동 채움 루프 (10 분마다 1 지문) — 채팅에 첨부:
          <code className="text-violet-200"> @scripts/cc-syntax-loop-prompt.md 워크플로우대로 교재 &ldquo;&lt;textbook&gt;&rdquo; 1 cycle 돌려줘.</code>
        </p>
      </div>

      <div className="rounded-lg bg-rose-950/30 border border-rose-700/30 p-3">
        <div className="text-[11px] text-rose-300 font-semibold uppercase tracking-wide mb-1">금지</div>
        <ul className="text-[11px] text-rose-200/85 list-disc list-inside space-y-0.5">
          <li><code>passage-analyzer-cli.ts run-ai</code> (ANTHROPIC API) 호출</li>
          <li><code>/api/admin/passage-analyzer/comprehensive-analysis</code> 등 AI 라우트 직접 호출</li>
          <li>검증 실패 시 <code>--force</code> 같은 우회 (옵션 없음)</li>
        </ul>
      </div>
    </div>
  );
}

/** 한 줄 명령 큰 박스 + 도드라진 복사 버튼. 멀티라인 텍스트 가독성 위해 별도 컴포넌트. */
function BigCopyBlock({ text, buttonLabel, tone = 'amber' }: { text: string; buttonLabel: string; tone?: 'amber' | 'emerald' }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
  };
  const pre = tone === 'emerald'
    ? 'text-emerald-100 border-emerald-700/30'
    : 'text-amber-100 border-amber-700/30';
  const btn = copied
    ? 'bg-emerald-600 text-white'
    : tone === 'emerald'
      ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-900'
      : 'bg-amber-500 hover:bg-amber-400 text-slate-900';
  return (
    <div className="flex flex-col gap-2">
      <pre className={`text-[11px] bg-slate-950/80 px-3 py-2.5 rounded font-mono whitespace-pre-wrap break-words leading-relaxed border ${pre}`}>{text}</pre>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className={`self-end px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${btn}`}
      >
        {copied ? '✓ 복사됨' : buttonLabel}
      </button>
    </div>
  );
}

function CmdBlock({ cmd, desc }: { cmd: string; desc: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* fallback — 일부 브라우저에서 clipboard API 거부될 수 있음 */
      const ta = document.createElement('textarea');
      ta.value = cmd;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
  };
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 min-w-0 text-[11px] text-emerald-300 bg-slate-900/60 px-2 py-1.5 rounded font-mono break-all leading-snug">
        {cmd}
      </code>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => void handleCopy()}
          title="복사"
          className={`text-[10px] px-2 py-1 rounded font-semibold transition-colors ${
            copied
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
          }`}
        >
          {copied ? '✓ 복사됨' : '📋 복사'}
        </button>
        <span className="text-[10px] text-violet-300/70 hidden sm:inline">{desc}</span>
      </div>
    </div>
  );
}
