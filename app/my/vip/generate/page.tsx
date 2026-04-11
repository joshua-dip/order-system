'use client';

import { useCallback, useEffect, useState } from 'react';

interface Student { id: string; name: string; grade: number; examScope: string[]; schoolName: string }
interface Question {
  id: string; textbook: string; passageId: string; type: string;
  difficulty: string; paragraph: string; options: string;
  answer: string; explanation: string; pric: string | null;
}

const TYPES = ['빈칸', '순서', '삽입'];
const DIFFICULTIES = ['중', '상'];

export default function VipGeneratePage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<string>('');
  const [filterType, setFilterType] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [filterTextbook, setFilterTextbook] = useState('');
  const [count, setCount] = useState(20);
  const [randomOrder, setRandomOrder] = useState(true);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    fetch('/api/my/vip/students?limit=200&status=active', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (d.ok) setStudents(d.items); });
  }, []);

  const selectedStudentObj = students.find((s) => s.id === selectedStudent);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setGenerated(false);
    const params = new URLSearchParams({ limit: String(count), random: String(randomOrder) });
    if (selectedStudent) params.set('studentId', selectedStudent);
    if (filterType) params.set('type', filterType);
    if (filterDifficulty) params.set('difficulty', filterDifficulty);
    if (filterTextbook) params.set('textbook', filterTextbook);

    const res = await fetch(`/api/my/vip/generate?${params}`, { credentials: 'include' });
    const d = await res.json();
    if (d.ok) {
      setQuestions(d.questions);
      setSelected(new Set(d.questions.map((q: Question) => q.id)));
      setGenerated(true);
    }
    setLoading(false);
  }, [selectedStudent, filterType, filterDifficulty, filterTextbook, count, randomOrder]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === questions.length) setSelected(new Set());
    else setSelected(new Set(questions.map((q) => q.id)));
  };

  const handleDownload = async (format: 'pdf' | 'docx') => {
    const selectedIds = questions.filter((q) => selected.has(q.id)).map((q) => q.id);
    if (selectedIds.length === 0) { alert('다운로드할 문제를 선택해주세요.'); return; }

    setDownloading(true);
    try {
      const params = new URLSearchParams({ format, ids: selectedIds.join(',') });
      const res = await fetch(`/api/my/vip/generate/download?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('다운로드 실패');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `변형문제_${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('다운로드에 실패했습니다.');
    }
    setDownloading(false);
  };

  const parseOptions = (opts: string): string[] => {
    if (!opts) return [];
    return opts.split(/\n|<br\s*\/?>/).map((l) => l.trim()).filter(Boolean);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">변형문제 생성</h1>
        <p className="text-sm text-zinc-500 mt-0.5">학생의 시험 범위에 맞는 문제를 자동으로 구성합니다</p>
      </div>

      {/* Filters */}
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">학생 선택</label>
            <select value={selectedStudent} onChange={(e) => { setSelectedStudent(e.target.value); setFilterTextbook(''); }} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 [&>option]:bg-zinc-900 [&>option]:text-zinc-100">
              <option value="">전체 (범위 미지정)</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.schoolName} {s.grade}학년)</option>)}
            </select>
            {selectedStudentObj && selectedStudentObj.examScope.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {selectedStudentObj.examScope.map((s) => (
                  <span key={s} className="px-1.5 py-0.5 bg-zinc-700/40 text-zinc-300 text-[10px] rounded">{s.length > 15 ? s.slice(0, 15) + '…' : s}</span>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">유형</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 [&>option]:bg-zinc-900 [&>option]:text-zinc-100">
              <option value="">전체</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">난이도</label>
            <select value={filterDifficulty} onChange={(e) => setFilterDifficulty(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 [&>option]:bg-zinc-900 [&>option]:text-zinc-100">
              <option value="">전체</option>
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">문제 수</label>
            <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600" />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
            <input type="checkbox" checked={randomOrder} onChange={(e) => setRandomOrder(e.target.checked)} className="rounded" />
            문제 순서 랜덤
          </label>
          <button onClick={handleGenerate} disabled={loading} className="px-6 py-2.5 bg-zinc-100 text-zinc-900 text-sm rounded-xl hover:bg-zinc-200 transition-all font-medium disabled:opacity-50">
            {loading ? '검색 중...' : '문제 검색'}
          </button>
        </div>
      </div>

      {/* Results */}
      {generated && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={toggleAll} className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors">
                {selected.size === questions.length ? '전체 해제' : '전체 선택'}
              </button>
              <span className="text-xs text-zinc-500">{selected.size}개 선택 / 총 {questions.length}개</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleDownload('pdf')} disabled={downloading || selected.size === 0} className="px-4 py-2 bg-rose-600/80 text-zinc-100 text-sm rounded-xl hover:bg-rose-500 transition-colors disabled:opacity-40">
                PDF
              </button>
              <button onClick={() => handleDownload('docx')} disabled={downloading || selected.size === 0} className="px-4 py-2 bg-blue-600/80 text-zinc-100 text-sm rounded-xl hover:bg-blue-500 transition-colors disabled:opacity-40">
                DOCX
              </button>
            </div>
          </div>

          {questions.length === 0 ? (
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">
              조건에 맞는 문제가 없습니다. 필터를 조정해보세요.
            </div>
          ) : (
            <div className="space-y-3">
              {questions.map((q, idx) => (
                <div
                  key={q.id}
                  className={`rounded-2xl border overflow-hidden transition-colors ${
                    selected.has(q.id) ? 'bg-zinc-800/40 border-zinc-600' : 'bg-zinc-900/40 border-zinc-800/80'
                  }`}
                >
                  <div className="flex items-start gap-3 p-4">
                    <input
                      type="checkbox"
                      checked={selected.has(q.id)}
                      onChange={() => toggleSelect(q.id)}
                      className="mt-1 rounded flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-xs font-mono text-zinc-600">#{idx + 1}</span>
                        <span className="px-1.5 py-0.5 bg-violet-500/20 text-violet-300 text-[10px] rounded">{q.type}</span>
                        <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 text-[10px] rounded">{q.difficulty}</span>
                        <span className="text-[10px] text-zinc-600 truncate">{q.textbook}</span>
                        {q.pric && <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] rounded">{q.pric}</span>}
                      </div>
                      <p className="text-sm text-zinc-400 leading-relaxed line-clamp-3" dangerouslySetInnerHTML={{ __html: q.paragraph }} />
                      {q.options && (
                        <div className="mt-2 space-y-0.5">
                          {parseOptions(q.options).map((opt, oi) => (
                            <div key={oi} className="text-xs text-zinc-500">{opt}</div>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 text-xs text-emerald-400/80">정답: {q.answer}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
