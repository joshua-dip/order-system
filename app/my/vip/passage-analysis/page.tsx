'use client';

import { useCallback, useEffect, useState } from 'react';

/* ── VIP 출제 포인트 — 교사가 문장별 해석·단어와 출제 포인트(단어/구/문장 마킹)를 작성·저장(AI 없음) ── */

interface AnalysisListItem {
  id: string;
  title: string;
  source: string;
  sentenceCount: number;
  vocabCount: number;
  updatedAt: string | null;
  createdAt: string;
}
type MarkScope = 'word' | 'phrase' | 'sentence';
interface Mark { scope: MarkScope; target: string; qType: string; note: string }
interface Sentence { en: string; ko: string; note: string; marks: Mark[] }
interface Vocab { word: string; meaning: string }

const QTYPES = ['빈칸', '어법', '어휘', '순서', '삽입', '요약', '무관', '함의', '주제', '제목', '주장', '영작', '기타'];
const SCOPE_LABEL: Record<MarkScope, string> = { word: '단어', phrase: '구', sentence: '문장' };
interface Form {
  id: string | null;
  title: string;
  source: string;
  passageId: string;
  sentences: Sentence[];
  vocab: Vocab[];
  grammarNote: string;
  summary: string;
}

const BLANK: Form = { id: null, title: '', source: '', passageId: '', sentences: [], vocab: [], grammarNote: '', summary: '' };

/** 영어 본문 → 문장 분리 (클라이언트, 단순 규칙). */
function splitSentences(text: string): string[] {
  return text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=["'A-Z])/).map((s) => s.trim()).filter(Boolean);
}

export default function VipPassageAnalysisPage() {
  const [list, setList] = useState<AnalysisListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form | null>(null); // null = 목록 화면
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch('/api/my/vip/passage-analysis', { credentials: 'include' }).then((r) => r.json());
      if (d.ok && Array.isArray(d.analyses)) setList(d.analyses);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadList(); }, [loadList]);

  const openNew = () => { setForm({ ...BLANK }); setPasteOpen(true); setPasteText(''); };
  const openEdit = async (id: string) => {
    setBusyId(id);
    try {
      const d = await fetch(`/api/my/vip/passage-analysis?id=${id}`, { credentials: 'include' }).then((r) => r.json());
      if (d.ok && d.analysis) {
        const a = d.analysis;
        setForm({ id: a.id, title: a.title, source: a.source, passageId: a.passageId || '', sentences: a.sentences || [], vocab: a.vocab || [], grammarNote: a.grammarNote || '', summary: a.summary || '' });
        setPasteOpen(false);
      } else alert(d.error || '불러오기 실패');
    } catch { alert('불러오기 실패'); } finally { setBusyId(null); }
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const method = form.id ? 'PATCH' : 'POST';
      const url = form.id ? `/api/my/vip/passage-analysis?id=${form.id}` : '/api/my/vip/passage-analysis';
      const body = { title: form.title, source: form.source, passageId: form.passageId, sentences: form.sentences, vocab: form.vocab, grammarNote: form.grammarNote, summary: form.summary };
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장에 실패했습니다.'); return; }
      setForm(null);
      await loadList();
    } catch { alert('저장에 실패했습니다.'); } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('이 분석을 삭제할까요?')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/my/vip/passage-analysis?id=${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) setList((prev) => prev.filter((x) => x.id !== id));
      else alert('삭제에 실패했습니다.');
    } catch { alert('삭제에 실패했습니다.'); } finally { setBusyId(null); }
  };

  /* ── 폼 헬퍼 ── */
  const upd = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const updSentence = (i: number, patch: Partial<Sentence>) => setForm((f) => f ? { ...f, sentences: f.sentences.map((s, idx) => idx === i ? { ...s, ...patch } : s) } : f);
  const updVocab = (i: number, patch: Partial<Vocab>) => setForm((f) => f ? { ...f, vocab: f.vocab.map((v, idx) => idx === i ? { ...v, ...patch } : v) } : f);
  const applyPaste = () => {
    const ens = splitSentences(pasteText);
    upd({ sentences: ens.map((en) => ({ en, ko: '', note: '', marks: [] })) });
    setPasteOpen(false);
  };
  const updMarks = (i: number, marks: Mark[]) => updSentence(i, { marks });
  const setMark = (si: number, mi: number, patch: Partial<Mark>) =>
    setForm((f) => f ? { ...f, sentences: f.sentences.map((s, idx) => idx === si ? { ...s, marks: s.marks.map((m, j) => j === mi ? { ...m, ...patch } : m) } : s) } : f);

  /* ───────────────── 목록 화면 ───────────────── */
  if (!form) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-zinc-100">출제 포인트</h1>
            <p className="text-sm text-zinc-500 mt-0.5">문장별로 해석·단어와 함께 <span className="text-amber-300/80">📌 출제 포인트</span>(단어·구·문장 + 예상 유형)를 짚어 저장 → 추후 AI 문제 생성으로 확장</p>
          </div>
          <button onClick={openNew} className="shrink-0 rounded-lg bg-[#c9a44e] px-4 py-2 text-sm font-bold text-zinc-900 hover:bg-[#d8b65f]">+ 새 분석</button>
        </div>

        {loading ? (
          <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
        ) : list.length === 0 ? (
          <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">
            아직 저장한 분석이 없습니다. <span className="text-zinc-400">+ 새 분석</span> 으로 시작하세요.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {list.map((a) => (
              <div key={a.id} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 hover:border-white/20 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <button onClick={() => void openEdit(a.id)} disabled={busyId === a.id} className="min-w-0 text-left">
                    <div className="text-sm font-semibold text-zinc-100 truncate">{a.title || '제목 없음'}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5 truncate">{a.source || '출처 없음'}</div>
                  </button>
                  <button onClick={() => void remove(a.id)} disabled={busyId === a.id} title="삭제" className="shrink-0 p-1 rounded text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10">🗑</button>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
                  <span className="rounded bg-zinc-800/70 px-1.5 py-0.5">문장 {a.sentenceCount}</span>
                  <span className="rounded bg-zinc-800/70 px-1.5 py-0.5">단어 {a.vocabCount}</span>
                  <span className="ml-auto">{a.updatedAt ? new Date(a.updatedAt).toLocaleDateString('ko-KR', { dateStyle: 'short' }) : ''}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ───────────────── 편집 화면 ───────────────── */
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => setForm(null)} className="text-sm text-zinc-400 hover:text-zinc-300">← 목록으로</button>
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving} className="rounded-lg bg-[#c9a44e] px-4 py-2 text-sm font-bold text-zinc-900 hover:bg-[#d8b65f] disabled:opacity-50">{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>

      {/* 제목·출처 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input value={form.title} onChange={(e) => upd({ title: e.target.value })} placeholder="제목 (예: 26년 6월 고1 31번)" className="rounded-lg bg-zinc-900/60 border border-zinc-800/80 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
        <input value={form.source} onChange={(e) => upd({ source: e.target.value })} placeholder="출처/교재 (선택)" className="rounded-lg bg-zinc-900/60 border border-zinc-800/80 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
      </div>

      <PassageLoader onLoad={(loaded) => { setForm((f) => f ? { ...f, ...loaded } : f); setPasteOpen(false); }} />

      {/* 본문 붙여넣기 → 문장 분리 */}
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
        <button onClick={() => setPasteOpen((o) => !o)} className="text-xs font-bold text-zinc-400 hover:text-zinc-200">✍️ 영어 본문 붙여넣어 문장 분리 {pasteOpen ? '▲' : '▼'}</button>
        {pasteOpen && (
          <div className="mt-2 space-y-2">
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={4} placeholder="영어 지문을 붙여넣고 「문장 분리」를 누르세요. (기존 문장은 대체됩니다)" className="w-full rounded-lg bg-zinc-900/60 border border-zinc-800/80 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <button onClick={applyPaste} disabled={!pasteText.trim()} className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-bold text-zinc-100 hover:bg-zinc-600 disabled:opacity-50">문장 분리</button>
          </div>
        )}
      </div>

      {/* 문장별 분석 */}
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-300">문장별 분석 ({form.sentences.length})</h3>
          <button onClick={() => upd({ sentences: [...form.sentences, { en: '', ko: '', note: '', marks: [] }] })} className="text-xs font-bold text-[#c9a44e] hover:text-[#d8b65f]">+ 문장 추가</button>
        </div>
        {form.sentences.length === 0 ? (
          <p className="text-xs text-zinc-600">위에서 지문을 불러오거나 본문을 붙여넣어 문장을 만드세요.</p>
        ) : (
          <div className="space-y-3">
            {form.sentences.map((s, i) => (
              <div key={i} className="rounded-lg bg-zinc-900/60 border border-zinc-800/60 p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-1 text-[11px] font-bold text-zinc-500 w-5 text-right">{i + 1}</span>
                  <div className="flex-1 space-y-1.5">
                    <textarea value={s.en} onChange={(e) => updSentence(i, { en: e.target.value })} rows={2} placeholder="영어 문장" className="w-full rounded bg-zinc-950/50 border border-zinc-800/60 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/40" />
                    <input value={s.ko} onChange={(e) => updSentence(i, { ko: e.target.value })} placeholder="해석" className="w-full rounded bg-zinc-950/50 border border-zinc-800/60 px-2 py-1.5 text-sm text-sky-200 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/40" />
                    <input value={s.note} onChange={(e) => updSentence(i, { note: e.target.value })} placeholder="구문/어법 메모 (선택)" className="w-full rounded bg-zinc-950/50 border border-zinc-800/60 px-2 py-1.5 text-xs text-amber-200/90 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/40" />

                    {/* 출제 포인트(필기란) — 단어/구/문장 + 예상유형 + 메모 (추후 AI 문제 생성 입력) */}
                    <div className="rounded bg-zinc-950/40 border border-amber-900/30 p-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-amber-300/80">📌 출제 포인트 ({s.marks.length})</span>
                        <button onClick={() => updMarks(i, [...s.marks, { scope: 'word', target: '', qType: '', note: '' }])} className="text-[10px] font-bold text-[#c9a44e] hover:text-[#d8b65f]">+ 추가</button>
                      </div>
                      {s.marks.length === 0 ? (
                        <p className="text-[10px] text-zinc-600">문제로 낼 만한 단어·구·문장을 짚어 메모하세요.</p>
                      ) : (
                        <div className="space-y-1">
                          {s.marks.map((m, mi) => (
                            <div key={mi} className="flex flex-wrap items-center gap-1">
                              <select value={m.scope} onChange={(e) => setMark(i, mi, { scope: e.target.value as MarkScope })} className="rounded bg-zinc-900 border border-zinc-800/60 px-1 py-1 text-[11px] text-zinc-200 [&>option]:bg-zinc-900 focus:outline-none">
                                {(['word', 'phrase', 'sentence'] as MarkScope[]).map((sc) => <option key={sc} value={sc}>{SCOPE_LABEL[sc]}</option>)}
                              </select>
                              <input value={m.target} onChange={(e) => setMark(i, mi, { target: e.target.value })} placeholder="대상(단어·구)" className="w-28 rounded bg-zinc-900/70 border border-zinc-800/60 px-2 py-1 text-[11px] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/40" />
                              <select value={m.qType} onChange={(e) => setMark(i, mi, { qType: e.target.value })} className="rounded bg-zinc-900 border border-zinc-800/60 px-1 py-1 text-[11px] text-amber-200/90 [&>option]:bg-zinc-900 focus:outline-none">
                                <option value="">유형</option>
                                {QTYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                              <input value={m.note} onChange={(e) => setMark(i, mi, { note: e.target.value })} placeholder="출제 메모(함정·근거 등)" className="flex-1 min-w-[100px] rounded bg-zinc-900/70 border border-zinc-800/60 px-2 py-1 text-[11px] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/40" />
                              <button onClick={() => updMarks(i, s.marks.filter((_, j) => j !== mi))} title="삭제" className="px-1 text-zinc-600 hover:text-rose-400">✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <button onClick={() => upd({ sentences: form.sentences.filter((_, idx) => idx !== i) })} title="문장 삭제" className="mt-1 p-1 rounded text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 단어장 */}
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-300">단어장 ({form.vocab.length})</h3>
          <button onClick={() => upd({ vocab: [...form.vocab, { word: '', meaning: '' }] })} className="text-xs font-bold text-[#c9a44e] hover:text-[#d8b65f]">+ 단어 추가</button>
        </div>
        {form.vocab.length === 0 ? (
          <p className="text-xs text-zinc-600">+ 단어 추가 로 단어·뜻을 입력하세요.</p>
        ) : (
          <div className="space-y-1.5">
            {form.vocab.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={v.word} onChange={(e) => updVocab(i, { word: e.target.value })} placeholder="word" className="w-1/3 rounded bg-zinc-950/50 border border-zinc-800/60 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/40" />
                <input value={v.meaning} onChange={(e) => updVocab(i, { meaning: e.target.value })} placeholder="뜻" className="flex-1 rounded bg-zinc-950/50 border border-zinc-800/60 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/40" />
                <button onClick={() => upd({ vocab: form.vocab.filter((_, idx) => idx !== i) })} title="삭제" className="p-1 rounded text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 종합 메모 + 요약 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-2">어법·구문 종합 메모</h3>
          <textarea value={form.grammarNote} onChange={(e) => upd({ grammarNote: e.target.value })} rows={4} placeholder="지문 전체의 어법 포인트·구문 정리" className="w-full rounded-lg bg-zinc-900/60 border border-zinc-800/80 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
        </div>
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-2">주제·요약</h3>
          <textarea value={form.summary} onChange={(e) => upd({ summary: e.target.value })} rows={4} placeholder="지문의 주제·요약" className="w-full rounded-lg bg-zinc-900/60 border border-zinc-800/80 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
        </div>
      </div>

      <div className="flex justify-end pb-6">
        <button onClick={save} disabled={saving} className="rounded-lg bg-[#c9a44e] px-5 py-2.5 text-sm font-bold text-zinc-900 hover:bg-[#d8b65f] disabled:opacity-50">{saving ? '저장 중…' : '저장'}</button>
      </div>
    </div>
  );
}

/* ── 모의고사 지문 불러오기 (회원 = 모의고사만) ── */
function PassageLoader({ onLoad }: { onLoad: (v: { title?: string; source: string; passageId: string; sentences: Sentence[] }) => void }) {
  const [open, setOpen] = useState(false);
  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [tb, setTb] = useState('');
  const [items, setItems] = useState<{ _id: string; source_key?: string }[]>([]);
  const [loadingTb, setLoadingTb] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || textbooks.length) return;
    setLoadingTb(true);
    fetch('/api/class-kit/passages/textbooks', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.textbooks)) setTextbooks(d.textbooks); })
      .catch(() => {})
      .finally(() => setLoadingTb(false));
  }, [open, textbooks.length]);

  useEffect(() => {
    if (!tb) { setItems([]); return; }
    setLoadingItems(true);
    fetch(`/api/class-kit/passages?textbook=${encodeURIComponent(tb)}&limit=500`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.items)) setItems(d.items); else setItems([]); })
      .catch(() => setItems([]))
      .finally(() => setLoadingItems(false));
  }, [tb]);

  const load = async (id: string, sourceKey: string) => {
    setBusy(true);
    try {
      const d = await fetch(`/api/class-kit/passages/${id}`, { credentials: 'include' }).then((r) => r.json());
      const c = (d.item?.content ?? {}) as { sentences_en?: unknown; sentences_ko?: unknown; original?: string };
      const ens = Array.isArray(c.sentences_en) ? c.sentences_en.map((x) => String(x ?? '').trim()) : [];
      const kos = Array.isArray(c.sentences_ko) ? c.sentences_ko.map((x) => String(x ?? '').trim()) : [];
      let sentences: Sentence[] = ens.map((en, i) => ({ en, ko: kos[i] ?? '', note: '', marks: [] })).filter((s) => s.en);
      if (sentences.length === 0 && typeof c.original === 'string' && c.original.trim()) {
        sentences = splitSentences(c.original).map((en) => ({ en, ko: '', note: '', marks: [] }));
      }
      if (sentences.length === 0) { alert('이 지문에는 분리된 문장이 없습니다.'); return; }
      onLoad({ title: sourceKey || tb, source: tb, passageId: id, sentences });
      setOpen(false);
    } catch { alert('지문 불러오기에 실패했습니다.'); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
      <button onClick={() => setOpen((o) => !o)} className="text-xs font-bold text-zinc-400 hover:text-zinc-200">📥 모의고사 지문 불러오기 {open ? '▲' : '▼'}</button>
      {open && (
        <div className="mt-3 space-y-3">
          <select value={tb} onChange={(e) => setTb(e.target.value)} className="w-full rounded-lg bg-zinc-900/60 border border-zinc-800/80 px-3 py-2 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
            <option value="">{loadingTb ? '교재 불러오는 중…' : '교재 선택'}</option>
            {textbooks.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {tb && (
            loadingItems ? <p className="text-xs text-zinc-600">지문 불러오는 중…</p> :
            items.length === 0 ? <p className="text-xs text-zinc-600">지문이 없습니다.</p> :
            <div className="max-h-56 overflow-auto rounded-lg border border-zinc-800/60 divide-y divide-zinc-800/50">
              {items.map((it) => (
                <button key={it._id} disabled={busy} onClick={() => void load(it._id, it.source_key || '')} className="block w-full text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800/40 disabled:opacity-50">
                  {it.source_key || it._id}
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-zinc-600">회원은 모의고사 지문만 불러올 수 있습니다. 불러오면 영어·해석이 문장별로 채워집니다(해석은 수정 가능).</p>
        </div>
      )}
    </div>
  );
}
