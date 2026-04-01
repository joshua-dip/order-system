'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PROBLEM_TYPE_KEYS, PROBLEM_TYPE_META, type ProblemTypeKey } from '@/lib/descriptive-blank-rearrange/meta';
import type { BlankRearrangementProblem } from '@/lib/descriptive-blank-rearrange/types';

const MOD_LEVELS = [
  { value: 'type01', label: 'Type 01 — 원문유지 (메타)' },
  { value: 'type02', label: 'Type 02 — 미세변형 (메타)' },
  { value: 'type03', label: 'Type 03 — 중간변형 (메타)' },
  { value: 'type04', label: 'Type 04 — 상당변형 (메타)' },
];

function DescriptiveBlankInner() {
  const sp = useSearchParams();
  const fileName = sp.get('fileName');
  const [sentences, setSentences] = useState<string[]>([]);
  const [problemTypeKey, setProblemTypeKey] = useState<ProblemTypeKey>('blank_rearrangement_subject');
  const [modLevel, setModLevel] = useState('type01');
  const [problems, setProblems] = useState<BlankRearrangementProblem[]>([]);
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const passageText = useMemo(() => sentences.join('\n'), [sentences]);

  useEffect(() => {
    if (!fileName) return;
    (async () => {
      try {
        const res = await fetch('/api/admin/passage-analyzer/load-analysis', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: decodeURIComponent(fileName) }),
        });
        const d = await res.json();
        if (!res.ok) return;
        const main = d.data?.passageStates?.main;
        if (main?.sentences) {
          setSentences(main.sentences);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [fileName]);

  async function generate() {
    if (!passageText.trim()) {
      setErr('지문이 없습니다. fileName 쿼리로 불러오거나 아래에 직접 입력하세요.');
      return;
    }
    setBusy(true);
    setErr(null);
    setApiMessage(null);
    try {
      const res = await fetch('/api/admin/descriptive-blank/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passageText, problemTypeKey }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '실패');
      setProblems(d.problems || []);
      setApiMessage(typeof d.message === 'string' ? d.message : null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '실패');
    } finally {
      setBusy(false);
    }
  }

  function copyJson() {
    if (!problems.length) return;
    void navigator.clipboard.writeText(JSON.stringify(problems, null, 2));
  }

  function downloadText() {
    if (!problems.length) return;
    const meta = MOD_LEVELS.find((m) => m.value === modLevel)?.label ?? modLevel;
    const header = `# ${PROBLEM_TYPE_META[problemTypeKey].name}\n# ${meta}\n\n`;
    const body = problems
      .map((p, i) => {
        const lines = [
          `--- 문제 ${i + 1} (${p.blank_label || '단일'}) [${p.points}점] ---`,
          p.passage_with_blank,
          '',
          `<보기> ${p.word_box}`,
          p.word_box_other ? `<보기 ${p.blank_label_other}> ${p.word_box_other}` : '',
          '',
          `[모범답안] ${p.answer_phrase}`,
          '',
          `[해설] ${p.explanation}`,
          '',
        ];
        return lines.filter(Boolean).join('\n');
      })
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `descriptive-blank-${problemTypeKey}-${modLevel}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <h1 className="text-xl font-bold">서술형 (빈칸재배열)</h1>
      <p className="text-slate-400 text-sm">
        분석 작업대 저장 파일로 불러오기:{' '}
        <code className="text-amber-200/90">?fileName=passage:xxx</code>
      </p>
      <p className="text-slate-500 text-xs">
        지문 변형도(Type 01~04)는 현재 출력 파일 메타용입니다. 생성에는 원문 그대로 사용합니다.
      </p>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {apiMessage && <p className="text-amber-200/90 text-sm">{apiMessage}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-slate-400">문제 유형</label>
          <select
            value={problemTypeKey}
            onChange={(e) => setProblemTypeKey(e.target.value as ProblemTypeKey)}
            className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
          >
            {PROBLEM_TYPE_KEYS.map((k) => (
              <option key={k} value={k}>
                {PROBLEM_TYPE_META[k].name}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500 mt-1">{PROBLEM_TYPE_META[problemTypeKey].description}</p>
        </div>
        <div>
          <label className="text-xs text-slate-400">지문 변형도 (메타)</label>
          <select
            value={modLevel}
            onChange={(e) => setModLevel(e.target.value)}
            className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
          >
            {MOD_LEVELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-slate-400">영문 지문 (문장은 줄바꿈으로 구분, 생성 시 하나의 텍스트로 이어집니다)</label>
        <textarea
          value={sentences.join('\n')}
          onChange={(e) => setSentences(e.target.value.split('\n').map((s) => s.trimEnd()))}
          rows={12}
          className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={generate}
          className="px-4 py-2 rounded-lg bg-violet-700 disabled:opacity-40"
        >
          {busy ? '생성 중…' : '문제 생성'}
        </button>
        <button
          type="button"
          disabled={!problems.length}
          onClick={copyJson}
          className="px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 disabled:opacity-40"
        >
          JSON 복사
        </button>
        <button
          type="button"
          disabled={!problems.length}
          onClick={downloadText}
          className="px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 disabled:opacity-40"
        >
          텍스트 다운로드
        </button>
      </div>

      <ul className="space-y-4">
        {problems.map((p, i) => (
          <li
            key={i}
            className="border border-slate-700 rounded-lg p-4 text-sm bg-slate-800/50 space-y-2"
          >
            <div className="text-xs text-slate-500">
              {p.blank_label ? `빈칸 ${p.blank_label}` : '단일 빈칸'} · {p.points}점
            </div>
            <p className="text-slate-200 whitespace-pre-wrap leading-relaxed">{p.passage_with_blank}</p>
            <div>
              <span className="text-xs text-slate-500">보기</span>
              <p className="text-amber-100/90 font-mono text-xs mt-0.5">{p.word_box}</p>
              {p.word_box_other && (
                <p className="text-slate-400 font-mono text-xs mt-1">
                  보기 {p.blank_label_other}: {p.word_box_other}
                </p>
              )}
            </div>
            <div>
              <span className="text-xs text-slate-500">모범답안</span>
              <p className="text-emerald-300/90 mt-0.5">{p.answer_phrase}</p>
            </div>
            {p.explanation && (
              <div>
                <span className="text-xs text-slate-500">해설</span>
                <p className="text-slate-300 mt-0.5 whitespace-pre-wrap">{p.explanation}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DescriptiveBlankPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">로딩…</div>}>
      <DescriptiveBlankInner />
    </Suspense>
  );
}
