'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Student { id: string; name: string; grade: number; schoolName: string; status: string }
interface ExamRow { schoolExamId: string; examName: string; subject: string; grade: number | null; total: number; objective: number; subjective: number; max: number | null; classAvg: number | null; rank: number | null; classSize: number }
interface Attendance { present: number; late: number; earlyLeave: number; absent: number; total: number; rate: number | null }
interface Report { student: { id: string; name: string; schoolName: string; grade: number | null }; exams: ExamRow[]; attendance: Attendance; avgPct: number | null }

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

/** 리포트를 깔끔한 새 창으로 인쇄(브라우저에서 PDF 저장). */
function printReport(r: Report) {
  const rows = r.exams.map((e) => `<tr>
    <td>${esc(e.examName)}</td>
    <td class="r">${e.total}${e.max ? ` / ${e.max}` : ''}</td>
    <td class="r">${e.classAvg ?? '—'}</td>
    <td class="r">${e.rank ? `${e.rank} / ${e.classSize}` : '—'}</td>
  </tr>`).join('');
  const a = r.attendance;
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(r.student.name)} 학습 리포트</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; color: #1e293b; margin: 32px; }
    h1 { font-size: 20px; margin: 0 0 2px; }
    .sub { color: #64748b; font-size: 13px; margin-bottom: 20px; }
    .grid { display: flex; gap: 12px; margin-bottom: 20px; }
    .card { flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; }
    .card .k { font-size: 12px; color: #64748b; }
    .card .v { font-size: 22px; font-weight: 800; margin-top: 4px; }
    h2 { font-size: 14px; margin: 18px 0 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #eef2f7; padding: 8px 6px; text-align: left; }
    th { color: #64748b; font-weight: 600; font-size: 12px; }
    td.r, th.r { text-align: right; }
    .att { font-size: 13px; color: #334155; }
    .att b { font-size: 15px; }
    .foot { margin-top: 28px; color: #94a3b8; font-size: 11px; }
    @media print { body { margin: 0; padding: 24px; } @page { margin: 14mm; } }
  </style></head><body>
    <h1>${esc(r.student.name)} 학습 리포트</h1>
    <div class="sub">${esc(r.student.schoolName || '')}${r.student.grade ? ` · ${r.student.grade}학년` : ''}</div>
    <div class="grid">
      <div class="card"><div class="k">평균 득점률</div><div class="v">${r.avgPct != null ? `${r.avgPct}%` : '—'}</div></div>
      <div class="card"><div class="k">응시 시험</div><div class="v">${r.exams.length}회</div></div>
      <div class="card"><div class="k">출석률</div><div class="v">${a.rate != null ? `${a.rate}%` : '—'}</div></div>
    </div>
    <h2>시험 성적</h2>
    ${r.exams.length ? `<table><thead><tr><th>시험</th><th class="r">내 점수</th><th class="r">반 평균</th><th class="r">석차</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="att">등록된 성적이 없습니다.</div>'}
    <h2>출결</h2>
    <div class="att">출석 <b>${a.present}</b> · 지각 <b>${a.late}</b> · 조퇴 <b>${a.earlyLeave}</b> · 결석 <b>${a.absent}</b> (총 ${a.total}회${a.rate != null ? `, 출석률 ${a.rate}%` : ''})</div>
    <div class="foot">생성일: 화면에서 인쇄 시점 기준 · 본 리포트는 시스템에 기록된 성적·출결만 반영합니다.</div>
    <script>window.onload=function(){window.print();}</script>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('팝업이 차단되었습니다. 팝업을 허용해 주세요.'); return; }
  w.document.write(html);
  w.document.close();
}

export default function ReportPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sid, setSid] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [rLoading, setRLoading] = useState(false);

  const load = useCallback(async () => {
    const d = await fetch('/api/my/vip/students?status=active', { credentials: 'include' }).then((r) => r.json());
    if (d.ok && Array.isArray(d.items)) setStudents(d.items);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => students.filter((s) => !q || s.name.includes(q) || (s.schoolName || '').includes(q)), [students, q]);

  const pick = async (id: string) => {
    setSid(id); setReport(null); setRLoading(true);
    const d = await fetch(`/api/my/vip/report?studentId=${id}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) setReport(d); else alert(d.error || '불러오기 실패');
    setRLoading(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">성적표 · 학습 리포트</h1>
        <p className="text-sm text-zinc-500 mt-0.5">학생별 <b className="text-zinc-300">성적 추이·반평균·석차·출석률</b>을 한 장으로. 인쇄해서 PDF로 저장하거나 학부모께 전달하세요.</p>
      </div>

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : students.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">등록된 학생이 없습니다. 「학생 관리」에서 먼저 학생을 등록하세요.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          {/* 학생 목록 */}
          <div className="space-y-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 검색…"
              className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 divide-y divide-zinc-800/60 max-h-[60vh] overflow-y-auto">
              {filtered.map((s) => (
                <button key={s.id} onClick={() => pick(s.id)}
                  className={`w-full text-left px-3.5 py-2.5 transition-colors ${sid === s.id ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/30'}`}>
                  <div className="text-[13px] text-zinc-200">{s.name}</div>
                  <div className="text-[11px] text-zinc-500">{s.schoolName || '—'}{s.grade ? ` · ${s.grade}학년` : ''}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 리포트 */}
          <div>
            {rLoading ? (
              <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
            ) : !report ? (
              <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">학생을 선택하면 학습 리포트를 보여줍니다.</div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-base font-semibold text-zinc-100">{report.student.name}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">{report.student.schoolName || '—'}{report.student.grade ? ` · ${report.student.grade}학년` : ''}</div>
                  </div>
                  <button onClick={() => printReport(report)}
                    className="px-3.5 py-2 rounded-lg bg-[#c9a44e]/20 text-[#e8d48b] text-sm font-medium hover:bg-[#c9a44e]/30 transition-colors">
                    🖨 인쇄 / PDF 저장
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[['평균 득점률', report.avgPct != null ? `${report.avgPct}%` : '—'], ['응시 시험', `${report.exams.length}회`], ['출석률', report.attendance.rate != null ? `${report.attendance.rate}%` : '—']].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
                      <div className="text-[11px] text-zinc-500">{k}</div>
                      <div className="text-xl font-bold text-zinc-100 mt-1">{v}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-hidden">
                  <div className="px-4 py-2.5 text-xs text-zinc-500 border-b border-zinc-800/70">시험 성적</div>
                  {report.exams.length === 0 ? (
                    <div className="p-8 text-center text-sm text-zinc-600">등록된 성적이 없습니다. 「성적 관리」에서 입력하세요.</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead><tr className="text-zinc-500 text-[12px] border-b border-zinc-800/70">
                        <th className="text-left px-4 py-2">시험</th><th className="text-right px-3 py-2">내 점수</th><th className="text-right px-3 py-2">반 평균</th><th className="text-right px-4 py-2">석차</th>
                      </tr></thead>
                      <tbody>
                        {report.exams.map((e) => (
                          <tr key={e.schoolExamId} className="border-b border-zinc-800/50 last:border-b-0">
                            <td className="px-4 py-2 text-zinc-200">{e.examName}</td>
                            <td className="px-3 py-2 text-right text-zinc-200">{e.total}{e.max ? <span className="text-zinc-600"> / {e.max}</span> : ''}</td>
                            <td className="px-3 py-2 text-right text-zinc-400">{e.classAvg ?? '—'}</td>
                            <td className="px-4 py-2 text-right text-zinc-400">{e.rank ? `${e.rank} / ${e.classSize}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 text-sm text-zinc-300">
                  <span className="text-zinc-500 text-xs">출결 </span>
                  출석 <b>{report.attendance.present}</b> · 지각 <b>{report.attendance.late}</b> · 조퇴 <b>{report.attendance.earlyLeave}</b> · 결석 <b>{report.attendance.absent}</b>
                  <span className="text-zinc-500"> (총 {report.attendance.total}회{report.attendance.rate != null ? `, 출석률 ${report.attendance.rate}%` : ''})</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
