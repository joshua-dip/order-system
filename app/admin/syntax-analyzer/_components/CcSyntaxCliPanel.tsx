'use client';

import { useState } from 'react';

interface Props {
  /** 'inline' = 페이지에 박스로 펼침/접힘. 'modal-button' = 버튼만 보이고 클릭 시 모달. */
  variant?: 'inline' | 'modal-button';
  /** 분석 작업대 등에서 현재 지문 ID 가 있으면 명령어에 prefill. */
  passageId?: string;
  defaultOpen?: boolean;
}

/** Claude Code Pro 채팅용 cc:syntax CLI 사용 가이드. 인라인 collapsible / 모달 버튼 두 모드. */
export default function CcSyntaxCliPanel({ variant = 'inline', passageId, defaultOpen = false }: Props) {
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
              className="bg-slate-900 border border-violet-700/50 rounded-xl shadow-2xl w-full max-w-2xl my-auto"
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
                <CcSyntaxCliContent passageId={passageId} />
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
          <CcSyntaxCliContent passageId={passageId} />
        </div>
      )}
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * 본문 — passageId 있으면 명령어 prefill, 각 명령어에 클립보드 복사 버튼.
 * ────────────────────────────────────────────────────────────────────────── */

function CcSyntaxCliContent({ passageId }: { passageId?: string }) {
  const pid = passageId?.trim() || '<passageId>';
  const draftPath = passageId ? `.syntax-drafts/${passageId}.json` : '.syntax-drafts/<pid>.json';

  return (
    <div className="space-y-3 text-xs text-violet-100/90">
      <p className="leading-relaxed">
        <strong className="text-violet-200">ANTHROPIC API 키 호출 없음</strong> — Pro 채팅에서 분석 JSON 을 작성하고 CLI 가 검증·저장만. 종합분석·주제문장·서술형대비·어법·문맥·끊어읽기·SVOC·구문·문법태그·문법포인트·단어장 등 모든 카테고리를 한 번에 채워 저장.
      </p>

      {passageId && (
        <div className="rounded-lg bg-emerald-950/30 border border-emerald-700/40 p-3 space-y-2">
          <div className="text-[11px] text-emerald-300 font-semibold uppercase tracking-wide">
            ⚡ 현재 지문에 바로 적용 (passageId: <span className="font-mono">{passageId}</span>)
          </div>
          <CmdBlock cmd={`npm run cc:syntax -- passage --id ${pid}`} desc="이 지문 원문·문장표 받기" />
          <CmdBlock cmd={`npm run cc:syntax -- save --json ${draftPath} --dry-run`} desc="검증" />
          <CmdBlock cmd={`npm run cc:syntax -- save --json ${draftPath}`} desc="실제 저장" />
          <CmdBlock cmd={`npm run cc:syntax -- export ${pid}`} desc="기존 분석 백업" />
        </div>
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
