'use client';

import { useState } from 'react';

export interface SubItem {
  id?: string;
  name: string;
  typeCode?: string;
  hard?: boolean;
  exampleFile?: { originalName: string };
}

export interface CategoryItem {
  id: string;
  icon?: string;
  name: string;
  subs: SubItem[];
}

interface CategorySelectorProps {
  categories: CategoryItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  /** 예시 링크 base URL, typeId 쿼리로 붙임 */
  exampleFileBaseUrl?: string;
}

function ExternalLinkIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function SubRow({
  sub,
  index,
  exampleFileBaseUrl,
}: {
  sub: SubItem;
  index: number;
  exampleFileBaseUrl?: string;
}) {
  const exampleUrl =
    sub.id && exampleFileBaseUrl && sub.exampleFile
      ? `${exampleFileBaseUrl}?typeId=${sub.id}`
      : null;
  return (
    <div
      className="flex items-center justify-between px-5 py-[13px] border-b border-r border-gray-200 group transition-colors duration-[140ms]"
      style={{
        animation: `fadeSlide 220ms ease ${index * 30}ms both`,
      }}
    >
      <span className="text-[13px] font-medium text-gray-800 group-hover:text-[#1B3F7A] transition-colors duration-[140ms]">
        {sub.typeCode && (
          <span className="font-mono text-[11px] text-gray-500 mr-2">{sub.typeCode}</span>
        )}
        {sub.name}
        {sub.hard && (
          <span className="inline-block text-[10px] font-bold bg-[#FEE9E9] text-[#C0392B] px-[6px] py-[1px] rounded-[4px] ml-2 align-middle tracking-[0.02em]">
            Hard
          </span>
        )}
      </span>
      {exampleUrl && (
        <a
          href={exampleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11.5px] font-medium text-[#4A72C0] bg-[#EAF0FB] px-[10px] py-1 rounded-[6px] hover:bg-[#D0DEFA] hover:text-[#1B3F7A] transition-colors duration-[140ms] shrink-0 no-underline"
        >
          <ExternalLinkIcon />
          예시
        </a>
      )}
    </div>
  );
}

export default function CategorySelector({
  categories,
  selectedIds,
  onToggle,
  exampleFileBaseUrl,
}: CategorySelectorProps) {
  const [animKey, setAnimKey] = useState(0);
  const selectedCats = categories.filter((c) => selectedIds.includes(c.id));

  function handleCatClick(id: string) {
    onToggle(id);
    setAnimKey((k) => k + 1);
  }

  if (categories.length === 0) return null;

  return (
    <div className="font-sans">
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[#1B3F7A] text-white text-[11px] font-semibold shrink-0">
          1
        </span>
        <span className="text-sm font-semibold text-gray-900">
          대분류 선택{' '}
          <span className="font-normal text-gray-500 text-[13px]">
            (선택한 대분류의 소분류가 모두 포함됩니다)
          </span>
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {categories.map((cat) => {
          const isSelected = selectedIds.includes(cat.id);
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => handleCatClick(cat.id)}
              className={[
                'flex items-center gap-2 px-[18px] py-[10px] rounded-[10px] border-[1.5px]',
                'text-[13.5px] font-medium whitespace-nowrap transition-all duration-[180ms]',
                'cursor-pointer',
                isSelected
                  ? 'border-[#1B3F7A] bg-[#1B3F7A] text-white shadow-[0_4px_14px_rgba(27,63,122,0.25)]'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-[#1B3F7A] hover:text-[#1B3F7A] hover:bg-[#f0f4ff]',
              ].join(' ')}
            >
              {cat.icon && <span className="text-[15px]">{cat.icon}</span>}
              {cat.name}
              <span
                className={[
                  'inline-flex items-center justify-center min-w-[20px] h-5 px-[5px]',
                  'rounded-[10px] text-[11px] font-semibold transition-all duration-[180ms]',
                  isSelected ? 'bg-white/25 text-white' : 'bg-[#E8EDF7] text-[#1B3F7A]',
                ].join(' ')}
              >
                {cat.subs.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="border border-gray-200 rounded-[14px] overflow-hidden bg-gray-50">
        <div className="flex items-center gap-2 px-5 py-[14px] border-b border-gray-200">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.04em]">
            소분류
          </span>
          {selectedCats.length === 0 ? (
            <span className="text-[13px] text-gray-500">왼쪽에서 대분류를 선택하세요.</span>
          ) : (
            selectedCats.map((c) => (
              <span
                key={c.id}
                className="text-[13px] font-semibold text-[#1B3F7A] bg-[#E8EDF7] px-[10px] py-[2px] rounded-full"
              >
                {c.name}
              </span>
            ))
          )}
        </div>

        {selectedCats.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 text-sm">
            대분류를 선택하면 해당 유형의 소분류 목록이 여기에 표시됩니다.
          </div>
        ) : (
          <div key={animKey} className="grid grid-cols-1 sm:grid-cols-2">
            {selectedCats.flatMap((cat) =>
              cat.subs.map((sub, i) => (
                <SubRow
                  key={sub.id ?? `${cat.id}-${sub.name}-${i}`}
                  sub={sub}
                  index={i}
                  exampleFileBaseUrl={exampleFileBaseUrl}
                />
              ))
            )}
          </div>
        )}
      </div>

    </div>
  );
}
