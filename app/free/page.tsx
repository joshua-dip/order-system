'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppBar from '@/app/components/AppBar';

/**
 * 공개 무료 변형문제 — 로그인 없이 회차·지문을 골라 바로 PDF 로 받는다.
 *
 * 여기서 나가는 문항은 `public_free_questions`(무료 배포 전용) 뿐이다.
 * 판매 재고는 이 화면에 노출되지 않는다.
 */

type FreeExam = { textbook: string; grade: string; questionCount: number; passageCount: number };
type FreePassage = { source: string; number: string; types: string[]; questionCount: number };

const GRADE_LABEL: Record<string, string> = { '1': '고1', '2': '고2', '3': '고3' };

export default function FreeVariantPage() {
  const [exams, setExams] = useState<FreeExam[]>([]);
  const [freeTypes, setFreeTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [textbook, setTextbook] = useState('');
  const [passages, setPassages] = useState<FreePassage[]>([]);
  const [passagesLoading, setPassagesLoading] = useState(false);

  const [pickedSources, setPickedSources] = useState<string[]>([]);
  const [pickedTypes, setPickedTypes] = useState<string[]>([]);
  const [includeAnswers, setIncludeAnswers] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/free/exams')
      .then((r) => r.json())
      .then((d) => {
        setExams(Array.isArray(d?.exams) ? d.exams : []);
        setFreeTypes(Array.isArray(d?.freeTypes) ? d.freeTypes : []);
      })
      .catch(() => setExams([]))
      .finally(() => setLoading(false));
  }, []);

  const loadPassages = useCallback((tb: string) => {
    setTextbook(tb);
    setPickedSources([]);
    setMsg('');
    setPassagesLoading(true);
    fetch(`/api/free/passages?textbook=${encodeURIComponent(tb)}`)
      .then((r) => r.json())
      .then((d) => setPassages(Array.isArray(d?.passages) ? d.passages : []))
      .catch(() => setPassages([]))
      .finally(() => setPassagesLoading(false));
  }, []);

  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    for (const p of passages) for (const t of p.types) set.add(t);
    return freeTypes.filter((t) => set.has(t));
  }, [passages, freeTypes]);

  /** 고른 범위의 문항 수 — 아무것도 안 고르면 전체로 본다 */
  const selectedCount = useMemo(() => {
    const rows = pickedSources.length > 0 ? passages.filter((p) => pickedSources.includes(p.source)) : passages;
    if (pickedTypes.length === 0) return rows.reduce((a, p) => a + p.questionCount, 0);
    return rows.reduce((a, p) => a + p.types.filter((t) => pickedTypes.includes(t)).length, 0);
  }, [passages, pickedSources, pickedTypes]);

  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const download = async () => {
    setDownloading(true);
    setMsg('');
    try {
      const qs = new URLSearchParams({ textbook });
      if (pickedSources.length > 0) qs.set('sources', pickedSources.join(','));
      if (pickedTypes.length > 0) qs.set('types', pickedTypes.join(','));
      if (!includeAnswers) qs.set('answers', '0');

      const r = await fetch(`/api/free/pdf?${qs.toString()}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setMsg(j?.error ?? 'PDF 를 만들지 못했습니다.');
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${textbook} 무료 변형문제.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const left = r.headers.get('X-Free-Remaining');
      setMsg(left ? `내려받았습니다. 오늘 ${left}회 더 받을 수 있습니다.` : '내려받았습니다.');
    } catch (e) {
      setMsg((e as Error)?.message ?? '오류가 발생했습니다.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <AppBar title="무료 변형문제" />

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">무료 변형문제 내려받기</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            모의고사 지문으로 만든 변형문제를 <strong className="text-slate-900">가입 없이 바로</strong> PDF 로 받아
            쓰실 수 있습니다. 회차와 지문을 고르고 내려받기만 누르면 됩니다.
          </p>
          {freeTypes.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              무료 제공 유형 — {freeTypes.join(' · ')}
            </p>
          )}
        </div>

        {/* 1. 회차 */}
        <section className="mb-6">
          <h2 className="text-sm font-bold text-slate-900 mb-3">1. 회차 고르기</h2>
          {loading ? (
            <p className="text-sm text-slate-500">불러오는 중…</p>
          ) : exams.length === 0 ? (
            <p className="text-sm text-slate-500">아직 공개된 무료 자료가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {exams.map((e) => {
                const on = textbook === e.textbook;
                return (
                  <button
                    key={e.textbook}
                    type="button"
                    onClick={() => loadPassages(e.textbook)}
                    className={`text-left px-4 py-3 rounded-lg border transition ${
                      on
                        ? 'border-sky-600 bg-sky-50 ring-1 ring-sky-600'
                        : 'border-slate-200 bg-white hover:border-slate-400'
                    }`}
                  >
                    <div className="font-semibold text-slate-900 text-sm">{e.textbook}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {GRADE_LABEL[e.grade] ? `${GRADE_LABEL[e.grade]} · ` : ''}
                      지문 {e.passageCount}개 · {e.questionCount}문항
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {textbook && (
          <>
            {/* 2. 지문 */}
            <section className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-slate-900">2. 지문 고르기</h2>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setPickedSources(passages.map((p) => p.source))}
                    className="text-sky-700 hover:text-sky-900"
                  >
                    전체
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickedSources([])}
                    className="text-slate-500 hover:text-slate-800"
                  >
                    해제
                  </button>
                </div>
              </div>
              {passagesLoading ? (
                <p className="text-sm text-slate-500">불러오는 중…</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {passages.map((p) => {
                    const on = pickedSources.includes(p.source);
                    return (
                      <button
                        key={p.source}
                        type="button"
                        onClick={() => setPickedSources((prev) => toggle(prev, p.source))}
                        title={`${p.types.join(' · ')}`}
                        className={`px-3 py-1.5 rounded-lg border text-sm transition ${
                          on
                            ? 'border-sky-600 bg-sky-600 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                        }`}
                      >
                        {p.number ? `${p.number}번` : p.source}
                        <span className={`ml-1.5 text-[11px] ${on ? 'text-sky-100' : 'text-slate-400'}`}>
                          ({p.questionCount})
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="mt-2 text-xs text-slate-500">아무것도 고르지 않으면 회차 전체에서 담습니다.</p>
            </section>

            {/* 3. 유형 */}
            <section className="mb-6">
              <h2 className="text-sm font-bold text-slate-900 mb-3">3. 유형 고르기 (선택)</h2>
              <div className="flex flex-wrap gap-2">
                {availableTypes.map((t) => {
                  const on = pickedTypes.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setPickedTypes((prev) => toggle(prev, t))}
                      className={`px-3 py-1.5 rounded-lg border text-sm transition ${
                        on
                          ? 'border-sky-600 bg-sky-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 4. 내려받기 */}
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={includeAnswers}
                    onChange={(e) => setIncludeAnswers(e.target.checked)}
                    className="w-4 h-4 accent-sky-600"
                  />
                  정답·해설 포함
                </label>
                <div className="text-sm text-slate-600">
                  담길 문항{' '}
                  <strong className="text-slate-900">{Math.min(selectedCount, 60)}</strong>개
                  {selectedCount > 60 && (
                    <span className="ml-1 text-amber-700">
                      — 고른 {selectedCount}개 중 앞에서부터 60개만 담깁니다. 지문이나 유형을 좁혀 주세요.
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={download}
                  disabled={downloading || selectedCount === 0}
                  className="ml-auto px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-50 transition"
                >
                  {downloading ? 'PDF 만드는 중…' : 'PDF 내려받기'}
                </button>
              </div>
              {msg && <p className="mt-3 text-sm text-slate-700">{msg}</p>}
              <p className="mt-3 text-xs text-slate-500">
                한 번에 60문항까지, 하루 5회까지 받을 수 있습니다. 더 많은 유형(빈칸·어법·어휘·요약·함의·무관한문장과
                고난도)은 회원 주문으로 제작해 드립니다.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
