'use client';

import { ReactNode } from 'react';

/** *_html 필드에 쓸 안내 (편집 텍스트 영역 아래에 작게 표시). */
export const HTML_HINT =
  '허용 인라인: <span class="hl-key">노란펜</span> · <span class="hl-term">파란박스</span> · <span class="hl-cause">빨강</span> · <span class="hl-effect">초록</span> · <strong> · <em> · <u> · <br>';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-700 mb-1 block">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-gray-500 mt-1 block leading-relaxed">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      className={`w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400 ${className}`}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 2,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <textarea
      rows={rows}
      className={`w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-400 font-mono ${className}`}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  );
}

export function SmallBtn({ children, onClick, variant = 'default', title }: {
  children: ReactNode;
  onClick: () => void;
  variant?: 'default' | 'danger' | 'primary';
  title?: string;
}) {
  const cls =
    variant === 'danger'
      ? 'bg-white border-red-300 text-red-700 hover:bg-red-50'
      : variant === 'primary'
        ? 'bg-rose-600 border-rose-700 text-white hover:bg-rose-700'
        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2 py-1 rounded border text-xs font-medium transition-colors ${cls}`}
    >
      {children}
    </button>
  );
}

export function ListSection({ title, onAdd, children }: { title: string; onAdd?: () => void; children: ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-md p-2 bg-gray-50/50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-gray-700">{title}</span>
        {onAdd && <SmallBtn onClick={onAdd}>+ 추가</SmallBtn>}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
