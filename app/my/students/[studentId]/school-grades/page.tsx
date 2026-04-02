'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppBar from '@/app/components/AppBar';
import SchoolGradesClient from './SchoolGradesClient';

type Student = { id: string; school: string; grade: string; name: string };

export default function SchoolGradesPage() {
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
        <AppBar title="마이페이지" />
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
        <AppBar title="마이페이지" />
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
      <AppBar title="마이페이지" />
      <div className="min-h-screen w-full bg-[#f8fafc] text-[#0f172a] font-['Noto_Sans_KR',sans-serif]">
        <div className="max-w-3xl mx-auto px-5 py-6">
          <SchoolGradesClient studentId={studentId} student={student} />
        </div>
      </div>
    </>
  );
}
