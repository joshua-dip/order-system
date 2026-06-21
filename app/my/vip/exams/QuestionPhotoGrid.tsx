'use client';

import { useCallback, useEffect, useState } from 'react';

interface ExamQuestion { questionType?: string; score?: number; textbook?: string; source?: string; isSubjective?: boolean }
interface Photo { id: string; questionNum: string; name: string; url: string }

const sortNums = (q: Record<string, ExamQuestion>) => Object.keys(q).sort((a, b) => (Number(a) || 0) - (Number(b) || 0));

/** 한 시험의 문항별 학생 필기 사진 업로드/조회/삭제 그리드. 시험 준비·기출 분석·예측 양쪽에서 재사용. */
export default function QuestionPhotoGrid({ examId, questions, maxHeight }: { examId: string; questions: Record<string, ExamQuestion>; maxHeight?: string }) {
  const [photos, setPhotos] = useState<Record<string, Photo[]>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    const d = await fetch(`/api/my/vip/school-exams/${examId}/question-photos`, { credentials: 'include' }).then((r) => r.json());
    setPhotos(d.ok ? d.byNum : {});
    setLoading(false);
  }, [examId]);
  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  const upload = async (num: string, file: File) => {
    setUploading(num);
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('questionNum', num);
      const res = await fetch(`/api/my/vip/school-exams/${examId}/question-photos`, { method: 'POST', body: fd, credentials: 'include' });
      const d = await res.json();
      if (res.ok && d.ok) setPhotos((prev) => ({ ...prev, [num]: [...(prev[num] ?? []), d.photo] }));
      else alert(d.error || '업로드 실패');
    } catch { alert('업로드 중 오류가 발생했습니다.'); }
    setUploading(null);
  };

  const removePhoto = async (num: string, photoId: string) => {
    if (!confirm('사진을 삭제할까요?')) return;
    await fetch(`/api/my/vip/school-exams/${examId}/question-photos?photoId=${photoId}`, { method: 'DELETE', credentials: 'include' });
    setPhotos((prev) => ({ ...prev, [num]: (prev[num] ?? []).filter((p) => p.id !== photoId) }));
  };

  const nums = sortNums(questions);
  const total = Object.values(photos).reduce((s, arr) => s + arr.length, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>문항별 학생 필기 사진</span>
        <span>{loading ? '불러오는 중…' : `사진 ${total}장`}</span>
      </div>
      <div className={`rounded-xl bg-zinc-900/50 border border-zinc-800/80 divide-y divide-zinc-800/70 overflow-y-auto ${maxHeight ?? ''}`}>
        {nums.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-600">문항 정보가 없습니다. 「시험 준비」에서 문항(유형·배점)을 먼저 입력하세요.</div>
        ) : nums.map((num) => {
          const q = questions[num];
          const ps = photos[num] ?? [];
          return (
            <div key={num} className="p-4 flex items-start gap-3">
              <div className="w-12 flex-shrink-0 text-center pt-0.5">
                <div className={`font-bold text-zinc-200 ${num.length > 2 ? 'text-[11px] leading-tight break-keep' : 'text-lg'}`}>{num}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className={`px-1.5 py-0.5 rounded text-[11px] ${q?.isSubjective ? 'bg-amber-500/15 text-amber-300' : 'bg-violet-500/15 text-violet-300'}`}>{q?.isSubjective ? '서술형' : (q?.questionType || '미지정')}</span>
                  {typeof q?.score === 'number' && <span className="text-[11px] text-zinc-500">{q.score}점</span>}
                  {q?.source && <span className="text-[11px] text-zinc-600 truncate max-w-[260px]">{q.textbook ? `${q.textbook} · ` : ''}{q.source}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {ps.map((p) => (
                    <div key={p.id} className="relative group">
                      {p.url
                        ? <a href={p.url} target="_blank" rel="noopener noreferrer"><img src={p.url} alt={p.name} className="w-20 h-20 object-cover rounded-lg border border-zinc-700" /></a>
                        : <div className="w-20 h-20 rounded-lg border border-zinc-700 bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-500">미리보기<br />불가</div>}
                      <button onClick={() => removePhoto(num, p.id)} title="삭제" className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-zinc-900 border border-zinc-600 text-zinc-300 text-xs leading-none opacity-0 group-hover:opacity-100 hover:bg-rose-600 hover:text-white transition-opacity">×</button>
                    </div>
                  ))}
                  <label className={`w-20 h-20 rounded-lg border border-dashed border-zinc-700 flex flex-col items-center justify-center cursor-pointer text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 transition-colors ${uploading === num ? 'opacity-50 pointer-events-none' : ''}`}>
                    <span className="text-lg leading-none">{uploading === num ? '…' : '＋'}</span>
                    <span className="text-[10px] mt-0.5">{uploading === num ? '업로드' : '사진'}</span>
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(num, f); e.target.value = ''; }} />
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
