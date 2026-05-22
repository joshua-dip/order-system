'use client';

import { useState } from 'react';

/** Claude Code Pro 채팅용 cc:syntax CLI 사용 가이드 패널 (접힘/펼침). */
export default function CcSyntaxCliPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
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
        <div className="mt-3 space-y-3 text-xs text-violet-100/90">
          <p className="leading-relaxed">
            <strong className="text-violet-200">ANTHROPIC API 키 호출 없음</strong> — Pro 채팅에서 분석 JSON 을 작성하고 CLI 가 검증·저장만. 종합분석·주제문장·서술형대비·어법·문맥·끊어읽기·SVOC·구문·문법태그·문법포인트·단어장 등 모든 카테고리를 한 번에 채워 저장.
          </p>

          <div className="rounded-lg bg-slate-950/60 border border-violet-700/30 p-3 space-y-2">
            <div className="text-[11px] text-violet-300 font-semibold uppercase tracking-wide">기본 명령</div>
            <CmdBlock cmd="npm run cc:syntax -- textbooks" desc="교재 목록" />
            <CmdBlock cmd='npm run cc:syntax -- passages --textbook "..."' desc="교재의 지문 목록 + 진척률" />
            <CmdBlock cmd="npm run cc:syntax -- passage --id <passageId>" desc="지문 원문·문장표·현재 진척률" />
            <CmdBlock cmd='npm run cc:syntax -- shortage --textbook "..." [--required 100]' desc="진척률 100% 미만 지문 목록" />
            <CmdBlock cmd='npm run cc:syntax -- next-empty --textbook "..."' desc="자동 루프용 — 다음 빈 지문 1 건" />
          </div>

          <div className="rounded-lg bg-slate-950/60 border border-violet-700/30 p-3 space-y-2">
            <div className="text-[11px] text-violet-300 font-semibold uppercase tracking-wide">저장</div>
            <CmdBlock cmd="npm run cc:syntax -- save --json draft.json --dry-run" desc="검증만 (DB 변경 X)" />
            <CmdBlock cmd="npm run cc:syntax -- save --json draft.json" desc="검증 통과 시 passage_analyses 갱신" />
            <CmdBlock cmd="npm run cc:syntax -- save-all draft1.json draft2.json" desc="여러 파일 일괄" />
            <CmdBlock cmd="npm run cc:syntax -- export <passageId>" desc="기존 분석 main JSON 덤프 (백업용)" />
          </div>

          <div className="rounded-lg bg-slate-950/60 border border-violet-700/30 p-3 space-y-1">
            <div className="text-[11px] text-violet-300 font-semibold uppercase tracking-wide">작성 흐름 (Pro 채팅)</div>
            <ol className="list-decimal list-inside text-[11px] space-y-0.5 text-violet-100/85">
              <li><code className="text-emerald-300">passage --id …</code> 로 지문·문장표 받기</li>
              <li><code className="text-emerald-300">scripts/cc-syntax-prompt.md</code> 규칙대로 JSON 작성 (<code>.syntax-drafts/&lt;pid&gt;.json</code>)</li>
              <li><code className="text-emerald-300">save --dry-run</code> 으로 검증</li>
              <li>통과 시 <code className="text-emerald-300">save</code> 로 실제 저장</li>
            </ol>
            <p className="text-[10px] text-violet-300/70 mt-2">
              자동 채움 루프 (10 분마다 1 지문) — 채팅에 첨부:
              <code className="text-violet-200"> @scripts/cc-syntax-loop-prompt.md 워크플로우대로 교재 "&lt;textbook&gt;" 1 cycle 돌려줘.</code>
            </p>
          </div>

          <div className="rounded-lg bg-rose-950/30 border border-rose-700/30 p-3">
            <div className="text-[11px] text-rose-300 font-semibold uppercase tracking-wide mb-1">금지</div>
            <ul className="text-[11px] text-rose-200/85 list-disc list-inside space-y-0.5">
              <li><code>passage-analyzer-cli.ts run-ai</code> (ANTHROPIC API) 호출</li>
              <li><code>/api/admin/passage-analyzer/comprehensive-analysis</code> 등 AI 라우트 직접 호출</li>
              <li>검증 실패 시 <code>--force</code> 같은 우회 (옵션 없음, 추가 요청 시에도 거부)</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function CmdBlock({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className="flex-1 text-[11px] text-emerald-300 bg-slate-900/60 px-2 py-1 rounded font-mono break-all">{cmd}</code>
      <span className="text-[10px] text-violet-300/70 shrink-0 mt-1">{desc}</span>
    </div>
  );
}
