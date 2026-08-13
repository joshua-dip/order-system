'use client';

import { useEffect, useState } from 'react';

interface JsonBlockFormProps<T> {
  data: T;
  onChange: (next: T) => void;
  /** 안내: 문학 4종 / 미구현 폼에 표시. */
  note?: string;
}

export default function JsonBlockForm<T>({ data, onChange, note }: JsonBlockFormProps<T>) {
  const [text, setText] = useState(() => JSON.stringify(data, null, 2));
  const [err, setErr] = useState<string | null>(null);

  // 외부에서 data 가 바뀌면 (블록 추가 직후 등) 동기화
  useEffect(() => {
    setText(JSON.stringify(data, null, 2));
    setErr(null);
  }, [data]);

  function tryApply(v: string) {
    setText(v);
    try {
      const parsed = JSON.parse(v);
      onChange(parsed as T);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {note && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 leading-relaxed">
          ⚠ {note}
        </p>
      )}
      <textarea
        rows={10}
        className={`w-full px-3 py-2 border rounded-md text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-rose-400 ${err ? 'border-red-400' : 'border-gray-300'}`}
        value={text}
        onChange={e => tryApply(e.target.value)}
      />
      {err && <p className="text-xs text-red-700">JSON 파싱 오류: {err}</p>}
    </div>
  );
}
