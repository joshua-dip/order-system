'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

export interface MyStudent {
  id: string;
  school: string;
  grade: string;
  name: string;
  createdAt: string;
}

type Props = {
  /** 목록 건수 변경 시 상단 탭 배지용 */
  onCountChange?: (count: number) => void;
};

export default function StudentManagement({ onCountChange }: Props) {
  const [students, setStudents] = useState<MyStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [school, setSchool] = useState('');
  const [grade, setGrade] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchStudents = useCallback(() => {
    setLoading(true);
    fetch('/api/my/students', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data.students) ? data.students : [];
        setStudents(list);
        onCountChange?.(list.length);
      })
      .catch(() => {
        setStudents([]);
        onCountChange?.(0);
      })
      .finally(() => setLoading(false));
  }, [onCountChange]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/my/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ school, grade, name }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setSchool('');
        setGrade('');
        setName('');
        setMessage({ type: 'success', text: '학생이 추가되었습니다.' });
        fetchStudents();
      } else {
        setMessage({ type: 'error', text: data?.error || '추가에 실패했습니다.' });
      }
    } catch {
      setMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 학생을 삭제할까요?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/my/students/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({ type: 'success', text: '삭제되었습니다.' });
        fetchStudents();
      } else {
        setMessage({ type: 'error', text: data?.error || '삭제에 실패했습니다.' });
      }
    } catch {
      setMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#f1f5f9]">
          <p className="text-sm font-bold text-[#0f172a]">학생 추가</p>
          <p className="text-[12px] text-[#94a3b8] mt-0.5">
            학교·학년·이름을 입력해 학생을 등록한 뒤, 아래 메뉴에서 성적·변형문제 채점을 관리할 수 있습니다.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="stu-school" className="block text-xs font-semibold text-[#475569] mb-1.5">
                학교
              </label>
              <input
                id="stu-school"
                type="text"
                value={school}
                onChange={(e) => setSchool(e.target.value)}
                placeholder="예: OO고등학교"
                className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)]"
                required
              />
            </div>
            <div>
              <label htmlFor="stu-grade" className="block text-xs font-semibold text-[#475569] mb-1.5">
                학년
              </label>
              <select
                id="stu-grade"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)] bg-white"
                required
              >
                <option value="">선택</option>
                <option value="고1">고1</option>
                <option value="고2">고2</option>
                <option value="고3">고3</option>
                <option value="N수">N수</option>
                <option value="기타">기타</option>
              </select>
            </div>
            <div>
              <label htmlFor="stu-name" className="block text-xs font-semibold text-[#475569] mb-1.5">
                이름
              </label>
              <input
                id="stu-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="학생 이름"
                className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)]"
                required
              />
            </div>
          </div>
          {message && (
            <p
              className={`text-[13px] font-medium ${
                message.type === 'success' ? 'text-[#16a34a]' : 'text-red-600'
              }`}
            >
              {message.text}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full sm:w-auto px-6 py-3 rounded-xl text-[13px] font-bold bg-[#2563eb] text-white hover:bg-[#1d4ed8] disabled:opacity-50 transition-colors"
          >
            {submitting ? '추가 중…' : '학생 추가'}
          </button>
        </form>
      </div>

      <div>
        <h3 className="text-sm font-bold text-[#0f172a] mb-3">등록된 학생</h3>
        {loading ? (
          <p className="text-[13px] text-[#94a3b8] py-8 text-center">불러오는 중…</p>
        ) : students.length === 0 ? (
          <div className="py-14 text-center rounded-2xl border border-dashed border-[#e2e8f0] bg-white">
            <div className="text-4xl mb-2 opacity-40">👤</div>
            <p className="text-sm text-[#94a3b8]">아직 등록된 학생이 없습니다</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {students.map((s) => (
              <li
                key={s.id}
                className="bg-white rounded-2xl border border-[#e2e8f0] p-4 hover:shadow-sm transition-shadow"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-[#0f172a]">{s.name}</div>
                    <div className="text-[12px] text-[#64748b] mt-0.5">
                      {s.school} · {s.grade}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row flex-wrap gap-2 shrink-0">
                    <Link
                      href={`/my/students/${s.id}/school-grades`}
                      className="text-center py-2.5 px-3 rounded-xl text-[12px] font-semibold border border-[#e2e8f0] text-[#475569] hover:border-[#2563eb] hover:text-[#2563eb] no-underline transition-colors"
                    >
                      학교 성적 관리
                    </Link>
                    <Link
                      href={`/my/students/${s.id}/variant-grading`}
                      className="text-center py-2.5 px-3 rounded-xl text-[12px] font-bold bg-[#f0f9ff] border border-[#bae6fd] text-[#0369a1] hover:bg-[#e0f2fe] no-underline transition-colors"
                    >
                      변형문제 채점·성적
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id}
                      className="py-2.5 px-3 rounded-xl text-[12px] text-red-600 border border-red-100 hover:bg-red-50 disabled:opacity-50"
                    >
                      {deletingId === s.id ? '삭제 중…' : '삭제'}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
