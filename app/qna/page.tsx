'use client';

/**
 * /qna — Q&A 분석지 회차+지문 선택 페이지.
 *
 * 1) GET /api/qna/passages 로 모의고사 교재 목록(+회차별 지문 수) 받기.
 * 2) 학년 필터(고1/고2/고3/전체) → 회차 드롭다운 → 지문 카드 그리드.
 * 3) 카드 클릭 → /qna/[passageId].
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppBar from '../components/AppBar';

interface TextbookItem {
  key: string;
  grade: string | null; // '고1' | '고2' | '고3' | null
  count: number;
}

interface PassageItem {
  id: string;
  sourceKey: string | null;
  preview: string;
}

type GradeFilter = '전체' | '고1' | '고2' | '고3';

export default function QnaListPage() {
  const router = useRouter();

  const [textbooks, setTextbooks] = useState<TextbookItem[]>([]);
  const [textbooksLoading, setTextbooksLoading] = useState(true);
  const [textbooksError, setTextbooksError] = useState<string | null>(null);

  const [grade, setGrade] = useState<GradeFilter>('전체');
  const [selectedTextbook, setSelectedTextbook] = useState<string>('');

  const [passages, setPassages] = useState<PassageItem[]>([]);
  const [passagesLoading, setPassagesLoading] = useState(false);
  const [passagesError, setPassagesError] = useState<string | null>(null);

  // 1) 교재 목록
  useEffect(() => {
    setTextbooksLoading(true);
    fetch('/api/qna/passages', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setTextbooks(Array.isArray(j.textbooks) ? j.textbooks : []);
        setTextbooksError(null);
      })
      .catch((err) => setTextbooksError(String(err?.message || err)))
      .finally(() => setTextbooksLoading(false));
  }, []);

  // 학년별 필터된 교재
  const filteredTextbooks = useMemo(() => {
    const list = grade === '전체' ? textbooks : textbooks.filter((t) => t.grade === grade);
    // 최신순으로 정렬: textbook key 는 "YY년 M월 고N 영어모의고사" — 한국어 자연 정렬 역순.
    return [...list].sort((a, b) =>
      b.key.localeCompare(a.key, 'ko', { numeric: true, sensitivity: 'base' }),
    );
  }, [textbooks, grade]);

  // 학년이 바뀌면 회차 선택 초기화 (해당 학년의 첫 회차 자동 선택)
  useEffect(() => {
    if (filteredTextbooks.length === 0) {
      setSelectedTextbook('');
      return;
    }
    if (!filteredTextbooks.some((t) => t.key === selectedTextbook)) {
      setSelectedTextbook(filteredTextbooks[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTextbooks]);

  // 2) 선택된 회차의 지문 목록
  useEffect(() => {
    if (!selectedTextbook) {
      setPassages([]);
      return;
    }
    setPassagesLoading(true);
    fetch(`/api/qna/passages/by-textbook?textbook=${encodeURIComponent(selectedTextbook)}`, {
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setPassages(Array.isArray(j.items) ? j.items : []);
        setPassagesError(null);
      })
      .catch((err) => setPassagesError(String(err?.message || err)))
      .finally(() => setPassagesLoading(false));
  }, [selectedTextbook]);

  return (
    <>
      <AppBar title="모고 Q&A 분석지" showBackButton onBackClick={() => router.push('/')} />
      <main className="min-h-screen bg-slate-50 py-8">
        <div className="container mx-auto px-4 max-w-5xl">
          <header className="mb-6">
            <h1 className="text-2xl font-bold text-slate-900">모고 Q&A 분석지</h1>
            <p className="mt-1 text-sm text-slate-600">
              모의고사 회차·번호를 골라 지문 분석(문장별 해석·SVOC)을 보고, 문장별로 질문도 남겨보세요. 비로그인도 가능합니다.
            </p>
          </header>

          {/* 학년 칩 */}
          <div className="mb-4 flex flex-wrap gap-2">
            {(['전체', '고1', '고2', '고3'] as const).map((g) => {
              const active = grade === g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGrade(g)}
                  className={
                    'rounded-full px-4 py-1.5 text-sm font-medium transition ' +
                    (active
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100')
                  }
                >
                  {g}
                </button>
              );
            })}
          </div>

          {/* 회차 드롭다운 */}
          <div className="mb-6">
            {textbooksLoading ? (
              <div className="h-10 w-full max-w-md animate-pulse rounded-lg bg-slate-200" />
            ) : textbooksError ? (
              <p className="text-sm text-rose-600">교재 목록을 불러오지 못했습니다: {textbooksError}</p>
            ) : filteredTextbooks.length === 0 ? (
              <p className="text-sm text-slate-500">해당 학년 모의고사가 없습니다.</p>
            ) : (
              <label className="block">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  회차
                </span>
                <select
                  value={selectedTextbook}
                  onChange={(e) => setSelectedTextbook(e.target.value)}
                  className="mt-1 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {filteredTextbooks.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.key} ({t.count}개 지문)
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* 지문 카드 그리드 */}
          <section>
            {passagesLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200" />
                ))}
              </div>
            ) : passagesError ? (
              <p className="text-sm text-rose-600">지문 목록을 불러오지 못했습니다: {passagesError}</p>
            ) : passages.length === 0 ? (
              <p className="text-sm text-slate-500">해당 회차의 지문이 없습니다.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {passages.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => router.push(`/qna/${p.id}`)}
                    className="group flex h-full flex-col items-stretch rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md"
                  >
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold text-emerald-700">
                        {p.sourceKey || '(번호 없음)'}
                      </span>
                      <span className="text-xs text-slate-400 group-hover:text-emerald-500">
                        열기 →
                      </span>
                    </div>
                    <p className="line-clamp-3 text-xs leading-relaxed text-slate-600">
                      {p.preview || '(미리보기 없음)'}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
