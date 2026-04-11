'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface NeisSchool {
  code: string;
  name: string;
  type: string;
  region: string;
  address: string;
  officeCode: string;
}

interface VipSchoolSearchInputProps {
  value: string;
  onChange: (schoolName: string, meta?: { region?: string; neisCode?: string }) => void;
  placeholder?: string;
}

export default function VipSchoolSearchInput({
  value,
  onChange,
  placeholder = '학교명 검색 (2글자 이상)',
}: VipSchoolSearchInputProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<NeisSchool[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(!!value);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(value);
    setSelected(!!value);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchSchools = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/my/vip/neis-school-search?query=${encodeURIComponent(searchQuery)}`,
        { credentials: 'include' }
      );
      const data = await res.json();
      setResults(data.schools || []);
      setIsOpen(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setSelected(false);
    onChange('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchSchools(val), 300);
  };

  const handleSelect = (school: NeisSchool) => {
    setQuery(school.name);
    setSelected(true);
    onChange(school.name, { region: school.region, neisCode: school.code });
    setIsOpen(false);
    setResults([]);
  };

  const handleClear = () => {
    setQuery('');
    setSelected(false);
    onChange('');
    setResults([]);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => { if (results.length > 0 && !selected) setIsOpen(true); }}
          placeholder={placeholder}
          className={`w-full px-3 py-2 rounded-lg text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none pr-8 ${
            selected
              ? 'bg-emerald-950/40 border border-emerald-700/50 focus:border-emerald-600'
              : 'bg-zinc-900/60 border border-zinc-800/80 focus:border-zinc-600'
          }`}
        />
        {loading && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <div className="w-3.5 h-3.5 border-2 border-zinc-500 border-t-zinc-300 rounded-full animate-spin" />
          </div>
        )}
        {selected && !loading && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl max-h-60 overflow-y-auto">
          {results.map((school) => (
            <button
              key={`${school.code}-${school.name}`}
              type="button"
              onClick={() => handleSelect(school)}
              className="w-full px-3 py-2.5 text-left hover:bg-zinc-800/60 transition-colors border-b border-zinc-800/60 last:border-b-0 first:rounded-t-xl last:rounded-b-xl"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-100 text-sm font-medium truncate">{school.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 bg-zinc-700/60 text-zinc-400 rounded shrink-0">
                  {school.type}
                </span>
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                {school.region} · {school.address}
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && results.length === 0 && !loading && query.length >= 2 && (
        <div className="absolute z-50 w-full mt-1 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-xl p-3">
          <p className="text-xs text-zinc-500 text-center">검색 결과가 없습니다</p>
        </div>
      )}
    </div>
  );
}
