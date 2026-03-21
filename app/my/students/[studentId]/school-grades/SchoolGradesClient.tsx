'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { SchoolGradeRecordDTO } from '@/lib/school-grade-record';
import { semesterLabel } from '@/lib/school-grade-record';

type Student = { id: string; school: string; grade: string; name: string };

type Props = {
  studentId: string;
  student: Student;
};

function formatShortDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

async function exportGradeReportPdf(el: HTMLElement, fileName: string) {
  const html2canvas = (await import('html2canvas')).default;
  const { jsPDF } = await import('jspdf');

  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
  });

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(fileName);
}

export default function SchoolGradesClient({ studentId, student }: Props) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [records, setRecords] = useState<SchoolGradeRecordDTO[]>([]);
  const [gradesLoading, setGradesLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [formMsg, setFormMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => {
    const ys: number[] = [];
    for (let y = currentYear + 1; y >= currentYear - 8; y--) ys.push(y);
    return ys;
  }, [currentYear]);

  const [schoolYear, setSchoolYear] = useState(currentYear);
  const [semester, setSemester] = useState<1 | 2>(1);
  const [examPeriod, setExamPeriod] = useState<'중간고사' | '기말고사'>('중간고사');
  const [scoreMc, setScoreMc] = useState('');
  const [scoreEssay, setScoreEssay] = useState('');

  const fetchRecords = useCallback(() => {
    setGradesLoading(true);
    fetch(`/api/my/students/${studentId}/school-grades`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setRecords(Array.isArray(data.records) ? data.records : []))
      .catch(() => setRecords([]))
      .finally(() => setGradesLoading(false));
  }, [studentId]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const stats = useMemo(() => {
    if (records.length === 0) {
      return {
        n: 0,
        avgMc: 0,
        avgEssay: 0,
        avgTotal: 0,
      };
    }
    let sumMc = 0;
    let sumEssay = 0;
    let sumTotal = 0;
    for (const r of records) {
      sumMc += r.scoreMultipleChoice;
      sumEssay += r.scoreEssay;
      sumTotal += r.scoreMultipleChoice + r.scoreEssay;
    }
    const n = records.length;
    return {
      n,
      avgMc: Math.round((sumMc / n) * 100) / 100,
      avgEssay: Math.round((sumEssay / n) * 100) / 100,
      avgTotal: Math.round((sumTotal / n) * 100) / 100,
    };
  }, [records]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormMsg(null);
    const mc = parseFloat(scoreMc);
    const es = parseFloat(scoreEssay);
    if (!Number.isFinite(mc) || !Number.isFinite(es)) {
      setFormMsg({ type: 'err', text: '객관식·서술형 점수를 숫자로 입력해 주세요.' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/my/students/${studentId}/school-grades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          schoolYear,
          semester,
          examPeriod,
          scoreMultipleChoice: mc,
          scoreEssay: es,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormMsg({ type: 'err', text: data?.error || '저장에 실패했습니다.' });
        return;
      }
      setFormMsg({ type: 'ok', text: '저장되었습니다. (같은 연도·학기·시험이면 덮어씁니다)' });
      setScoreMc('');
      setScoreEssay('');
      fetchRecords();
    } catch {
      setFormMsg({ type: 'err', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (recordId: string) => {
    if (!confirm('이 성적 기록을 삭제할까요?')) return;
    setDeletingId(recordId);
    try {
      const res = await fetch(`/api/my/students/${studentId}/school-grades/${recordId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok && data.ok) fetchRecords();
      else alert(data?.error || '삭제에 실패했습니다.');
    } catch {
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  const handlePdf = async () => {
    if (!reportRef.current || records.length === 0) {
      alert('리포트에 표시할 성적이 없습니다.');
      return;
    }
    setPdfLoading(true);
    try {
      const safeName = student.name.replace(/[/\\?%*:|"<>]/g, '_');
      await exportGradeReportPdf(
        reportRef.current,
        `학교성적리포트_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`
      );
    } catch (err) {
      console.error(err);
      alert('PDF 생성에 실패했습니다. 브라우저를 최신으로 유지해 주세요.');
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        href="/my"
        className="inline-flex items-center gap-1 text-[#2563eb] text-[13px] font-medium hover:underline"
      >
        ← 마이페이지
      </Link>

      <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
        <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide">학생</p>
        <h1 className="text-lg font-extrabold mt-1">{student.name}</h1>
        <p className="text-sm text-[#64748b] mt-0.5">
          {student.school} · {student.grade}
        </p>
      </div>

      {/* 입력 폼 */}
      <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#f1f5f9]">
          <h2 className="text-sm font-bold text-[#0f172a]">성적 입력</h2>
          <p className="text-[12px] text-[#94a3b8] mt-0.5">
            연도·학기·중간/기말을 선택하고 객관식·서술형 점수를 입력하세요. 같은 조합은 다시 저장 시 수정됩니다.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#475569] mb-1.5">연도</label>
              <select
                value={schoolYear}
                onChange={(e) => setSchoolYear(Number(e.target.value))}
                className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] bg-white"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#475569] mb-1.5">학기</label>
              <select
                value={semester}
                onChange={(e) => setSemester(Number(e.target.value) as 1 | 2)}
                className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] bg-white"
              >
                <option value={1}>1학기</option>
                <option value={2}>2학기</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#475569] mb-1.5">시험</label>
              <select
                value={examPeriod}
                onChange={(e) => setExamPeriod(e.target.value as '중간고사' | '기말고사')}
                className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] bg-white"
              >
                <option value="중간고사">중간고사</option>
                <option value="기말고사">기말고사</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#475569] mb-1.5">객관식 점수</label>
              <input
                type="number"
                step="0.01"
                min={0}
                max={1000}
                value={scoreMc}
                onChange={(e) => setScoreMc(e.target.value)}
                placeholder="예: 82.5"
                className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#475569] mb-1.5">서술형 점수</label>
              <input
                type="number"
                step="0.01"
                min={0}
                max={1000}
                value={scoreEssay}
                onChange={(e) => setScoreEssay(e.target.value)}
                placeholder="예: 76"
                className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px]"
                required
              />
            </div>
          </div>
          {formMsg && (
            <p className={`text-[13px] font-medium ${formMsg.type === 'ok' ? 'text-[#16a34a]' : 'text-red-600'}`}>
              {formMsg.text}
            </p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 rounded-xl text-[13px] font-bold bg-[#2563eb] text-white hover:bg-[#1d4ed8] disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </form>
      </div>

      {/* 목록 */}
      <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#f1f5f9] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-[#0f172a]">입력된 성적</h2>
            <p className="text-[12px] text-[#94a3b8] mt-0.5">최신 연도·학기 순으로 정렬됩니다.</p>
          </div>
        </div>
        <div className="p-5 overflow-x-auto">
          {gradesLoading ? (
            <p className="text-sm text-[#94a3b8]">불러오는 중…</p>
          ) : records.length === 0 ? (
            <p className="text-sm text-[#94a3b8]">아직 저장된 성적이 없습니다.</p>
          ) : (
            <table className="w-full text-[13px] text-left border-collapse min-w-[520px]">
              <thead>
                <tr className="border-b border-[#e2e8f0] text-[#64748b]">
                  <th className="py-2 pr-3 font-semibold">연도</th>
                  <th className="py-2 pr-3 font-semibold">학기</th>
                  <th className="py-2 pr-3 font-semibold">시험</th>
                  <th className="py-2 pr-3 font-semibold text-right">객관식</th>
                  <th className="py-2 pr-3 font-semibold text-right">서술형</th>
                  <th className="py-2 pr-3 font-semibold text-right">합계</th>
                  <th className="py-2 font-semibold">수정일</th>
                  <th className="py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const sum = r.scoreMultipleChoice + r.scoreEssay;
                  return (
                    <tr key={r.id} className="border-b border-[#f1f5f9] hover:bg-[#fafafa]">
                      <td className="py-2.5 pr-3">{r.schoolYear}년</td>
                      <td className="py-2.5 pr-3">{semesterLabel(r.semester)}</td>
                      <td className="py-2.5 pr-3">{r.examPeriod}</td>
                      <td className="py-2.5 pr-3 text-right font-medium">{r.scoreMultipleChoice}</td>
                      <td className="py-2.5 pr-3 text-right font-medium">{r.scoreEssay}</td>
                      <td className="py-2.5 pr-3 text-right font-bold text-[#0f172a]">{sum}</td>
                      <td className="py-2.5 pr-3 text-[#64748b] text-[12px] whitespace-nowrap">
                        {formatShortDate(r.updatedAt)}
                      </td>
                      <td className="py-2.5">
                        <button
                          type="button"
                          onClick={() => handleDelete(r.id)}
                          disabled={deletingId === r.id}
                          className="text-[12px] text-red-600 hover:underline disabled:opacity-50"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 리포트 (PDF 캡처 대상) */}
      <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#f1f5f9] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[#0f172a]">성적 리포트</h2>
            <p className="text-[12px] text-[#94a3b8] mt-0.5">요약과 전체 표를 PDF로 저장할 수 있습니다.</p>
          </div>
          <button
            type="button"
            onClick={handlePdf}
            disabled={pdfLoading || records.length === 0}
            className="px-4 py-2.5 rounded-xl text-[13px] font-bold bg-[#0f172a] text-white hover:bg-[#1e293b] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {pdfLoading ? 'PDF 생성 중…' : 'PDF 다운로드'}
          </button>
        </div>
        <div className="p-5 bg-[#f8fafc]">
          <div
            ref={reportRef}
            className="mx-auto max-w-[800px] bg-white text-[#0f172a] p-8 rounded-lg border border-[#e2e8f0] shadow-sm"
            style={{ fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif" }}
          >
            <header className="border-b border-[#e2e8f0] pb-4 mb-6">
              <p className="text-[11px] font-bold text-[#64748b] tracking-wider">SCHOOL GRADE REPORT</p>
              <h3 className="text-xl font-black mt-1">학교 성적 리포트</h3>
              <p className="text-[14px] mt-3">
                <span className="font-bold">{student.name}</span>
                <span className="text-[#64748b]"> · {student.school} · {student.grade}</span>
              </p>
              <p className="text-[12px] text-[#94a3b8] mt-1">
                출력일 {new Date().toLocaleDateString('ko-KR', { dateStyle: 'long' })}
              </p>
            </header>

            {records.length === 0 ? (
              <p className="text-sm text-[#94a3b8]">성적 데이터가 없습니다.</p>
            ) : (
              <>
                <section className="mb-8">
                  <h4 className="text-[13px] font-bold text-[#475569] mb-3">요약</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl bg-[#f8fafc] border border-[#e2e8f0] p-3">
                      <p className="text-[11px] text-[#64748b] font-semibold">기록 수</p>
                      <p className="text-lg font-black mt-0.5">{stats.n}회</p>
                    </div>
                    <div className="rounded-xl bg-[#f8fafc] border border-[#e2e8f0] p-3">
                      <p className="text-[11px] text-[#64748b] font-semibold">평균 객관식</p>
                      <p className="text-lg font-black mt-0.5">{stats.avgMc}</p>
                    </div>
                    <div className="rounded-xl bg-[#f8fafc] border border-[#e2e8f0] p-3">
                      <p className="text-[11px] text-[#64748b] font-semibold">평균 서술형</p>
                      <p className="text-lg font-black mt-0.5">{stats.avgEssay}</p>
                    </div>
                    <div className="rounded-xl bg-[#eff6ff] border border-[#bfdbfe] p-3">
                      <p className="text-[11px] text-[#2563eb] font-semibold">평균 합계(회당)</p>
                      <p className="text-lg font-black mt-0.5 text-[#1d4ed8]">{stats.avgTotal}</p>
                    </div>
                  </div>
                </section>

                <section>
                  <h4 className="text-[13px] font-bold text-[#475569] mb-3">시험별 성적</h4>
                  <table className="w-full text-[12px] border-collapse">
                    <thead>
                      <tr className="bg-[#f1f5f9]">
                        <th className="border border-[#e2e8f0] px-2 py-2 text-left font-bold">연도</th>
                        <th className="border border-[#e2e8f0] px-2 py-2 text-left font-bold">학기</th>
                        <th className="border border-[#e2e8f0] px-2 py-2 text-left font-bold">시험</th>
                        <th className="border border-[#e2e8f0] px-2 py-2 text-right font-bold">객관식</th>
                        <th className="border border-[#e2e8f0] px-2 py-2 text-right font-bold">서술형</th>
                        <th className="border border-[#e2e8f0] px-2 py-2 text-right font-bold">합계</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => {
                        const sum = r.scoreMultipleChoice + r.scoreEssay;
                        return (
                          <tr key={`pdf-${r.id}`}>
                            <td className="border border-[#e2e8f0] px-2 py-2">{r.schoolYear}년</td>
                            <td className="border border-[#e2e8f0] px-2 py-2">{semesterLabel(r.semester)}</td>
                            <td className="border border-[#e2e8f0] px-2 py-2">{r.examPeriod}</td>
                            <td className="border border-[#e2e8f0] px-2 py-2 text-right">{r.scoreMultipleChoice}</td>
                            <td className="border border-[#e2e8f0] px-2 py-2 text-right">{r.scoreEssay}</td>
                            <td className="border border-[#e2e8f0] px-2 py-2 text-right font-bold">{sum}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>

                <footer className="mt-8 pt-4 border-t border-[#f1f5f9] text-[10px] text-[#94a3b8] leading-relaxed">
                  본 리포트는 페이퍼릭 마이페이지에서 입력한 성적을 바탕으로 생성되었습니다. 학교 공식 성적표가
                  아닙니다.
                </footer>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
