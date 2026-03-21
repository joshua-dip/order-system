'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppBar from '@/app/components/AppBar';

type Student = { id: string; school: string; grade: string; name: string };

export default function VariantGradingPage() {
  const params = useParams();
  const studentId = typeof params.studentId === 'string' ? params.studentId : '';
  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) {
      setError('잘못된 경로입니다.');
      setLoading(false);
      return;
    }
    fetch(`/api/my/students/${studentId}`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (!data.student) {
          setError(data.error || '학생을 찾을 수 없습니다.');
          setStudent(null);
        } else {
          setStudent(data.student);
        }
      })
      .catch(() => setError('불러오기에 실패했습니다.'))
      .finally(() => setLoading(false));
  }, [studentId]);

  if (loading) {
    return (
      <>
        <AppBar title="페이퍼릭" />
        <div className="min-h-screen w-full bg-[#f8fafc]">
          <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center text-[#94a3b8] text-sm px-5">
            불러오는 중…
          </div>
        </div>
      </>
    );
  }

  if (error || !student) {
    return (
      <>
        <AppBar title="페이퍼릭" />
        <div className="min-h-screen w-full bg-[#f8fafc]">
          <div className="px-5 py-10 max-w-lg mx-auto">
            <p className="text-red-600 text-sm mb-4">{error}</p>
            <Link href="/my" className="text-[#2563eb] text-sm font-semibold underline">
              ← 마이페이지로
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar title="페이퍼릭" />
      <div className="min-h-screen w-full bg-[#f8fafc] text-[#0f172a] font-['Noto_Sans_KR',sans-serif]">
        <div className="max-w-3xl mx-auto px-5 py-6">
        <Link
          href="/my"
          className="inline-flex items-center gap-1 text-[#2563eb] text-[13px] font-medium hover:underline mb-4"
        >
          ← 마이페이지
        </Link>

        <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5 mb-6">
          <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide">학생</p>
          <h1 className="text-lg font-extrabold mt-1">{student.name}</h1>
          <p className="text-sm text-[#64748b] mt-0.5">
            {student.school} · {student.grade}
          </p>
        </div>

        <div className="bg-[#f0f9ff] border border-[#bae6fd] rounded-2xl p-4 mb-6 text-[13px] text-[#0369a1] leading-relaxed">
          <p className="font-bold mb-1">변형문제 채점 흐름 (예정)</p>
          <ol className="list-decimal list-inside space-y-1 text-[#0c4a6e]">
            <li>로컬 생성기에서 문제지용 QR을 만듭니다.</li>
            <li>학생이 QR로 열리는 웹 페이지에서 답을 입력하면 자동 채점됩니다.</li>
            <li>채점 결과는 이 화면에서 언제든지 확인할 수 있게 할 예정입니다.</li>
          </ol>
          <p className="mt-2 text-[12px] text-[#64748b]">
            고미조슈아닷컴과의 QR 연동은 별도 작업으로 진행합니다.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-[#f1f5f9]">
            <h2 className="text-sm font-bold text-[#0f172a]">채점 결과</h2>
            <p className="text-[12px] text-[#94a3b8] mt-0.5">
              저장 데이터 구조·목록 API는 추후 구현합니다.
            </p>
          </div>
          <div className="p-10 text-center">
            <div className="text-4xl mb-3 opacity-30">✏️</div>
            <p className="text-sm text-[#94a3b8]">아직 기록된 채점 결과가 없습니다.</p>
            <p className="text-[12px] text-[#cbd5e1] mt-2">QR 연동 후 이곳에 시도별 점수·문항 결과가 표시됩니다.</p>
          </div>
        </div>

        <div className="rounded-xl bg-white border border-[#e2e8f0] p-4 text-[12px] text-[#64748b]">
          <p className="font-semibold text-[#475569] mb-1">교사용 참고</p>
          <p>
            학생별로 이 URL을 북마크해 두면, QR 없이도 같은 학생의 채점 기록 화면으로 바로 올 수 있습니다.
            (학생 전용 답안 입력 URL은 QR·토큰으로 분리할 예정입니다.)
          </p>
        </div>
        </div>
      </div>
    </>
  );
}
