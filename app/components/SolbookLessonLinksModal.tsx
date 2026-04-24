'use client';

import { useEffect } from 'react';
import type { SolbookLessonLink } from '@/lib/solbook-lesson-links-store';

interface Props {
  open: boolean;
  onClose: () => void;
  textbookKey: string;
  groupTitle?: string;
  groupUrl?: string;
  groupLabel?: string;
  lessons: SolbookLessonLink[];
  /** 사용자가 이번 주문에서 선택한 강 키 목록 (강조 표시용) */
  selectedLessonKeys?: string[];
}

export default function SolbookLessonLinksModal({
  open,
  onClose,
  textbookKey,
  groupTitle,
  groupUrl,
  groupLabel,
  lessons,
  selectedLessonKeys = [],
}: Props) {
  // ESC 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // 스크롤 잠금
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  const selectedSet = new Set(selectedLessonKeys);

  // 사용자 선택 강을 상단으로 정렬 (order 기준 유지하되 선택 항목 우선)
  const sortedLessons = [...lessons].sort((a, b) => {
    const aSelected = selectedSet.has(a.lessonKey) ? 0 : 1;
    const bSelected = selectedSet.has(b.lessonKey) ? 0 : 1;
    if (aSelected !== bSelected) return aSelected - bSelected;
    return (a.order ?? 999) - (b.order ?? 999);
  });

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
          <div className="pr-4">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-bold uppercase tracking-wider text-violet-600">쏠북 구매</span>
            </div>
            <h2 className="text-base font-bold text-slate-900 leading-snug">
              {groupTitle || textbookKey}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              아래에서 강별로 쏠북 상품 페이지로 이동하세요
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 transition-colors"
            aria-label="닫기"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 선택 강 안내 */}
        {selectedSet.size > 0 && (
          <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-100 shrink-0">
            <p className="text-xs text-amber-800 font-medium">
              ★ 이번 주문에서 선택하신 강이 강조 표시됩니다
            </p>
          </div>
        )}

        {/* 강별 카드 목록 */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-2">
          {sortedLessons.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">등록된 링크가 없습니다.</p>
          ) : (
            sortedLessons.map((lesson) => {
              const isSelected = selectedSet.has(lesson.lessonKey);
              return (
                <a
                  key={lesson.lessonKey}
                  href={lesson.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center justify-between rounded-xl px-4 py-3 transition-all no-underline group ${
                    isSelected
                      ? 'bg-amber-50 border-2 border-amber-300 hover:border-amber-400 hover:bg-amber-100'
                      : 'bg-slate-50 border border-slate-200 hover:border-violet-300 hover:bg-violet-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {isSelected && (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-400 text-white text-[10px] font-bold shrink-0">
                        ★
                      </span>
                    )}
                    <div>
                      <p className={`text-sm font-bold ${isSelected ? 'text-amber-900' : 'text-slate-800'}`}>
                        {lesson.lessonKey}
                      </p>
                      {(lesson.label || lesson.itemCount) && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {lesson.label || `[${lesson.itemCount}문항]`}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs font-bold flex items-center gap-1 shrink-0 ${
                    isSelected ? 'text-amber-700 group-hover:text-amber-800' : 'text-violet-700 group-hover:text-violet-900'
                  }`}>
                    쏠북에서 보기
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                    </svg>
                  </span>
                </a>
              );
            })
          )}
        </div>

        {/* 하단 — 모음 페이지 링크 */}
        {groupUrl && (
          <div className="px-6 py-4 border-t border-slate-100 shrink-0">
            <a
              href={groupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 text-sm font-semibold hover:bg-violet-100 transition no-underline"
            >
              {groupLabel || '전체 강 모음 페이지 보기'}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </a>
          </div>
        )}

        {/* 안내 문구 */}
        <div className="px-6 pb-4 shrink-0">
          <p className="text-[11px] text-slate-400 text-center leading-snug">
            변형 제작비와 교재 본체 대금은 쏠북에서 결제합니다.
            <br />이 사이트 입금 금액에 포함되지 않습니다.
          </p>
        </div>
      </div>
    </div>
  );
}
