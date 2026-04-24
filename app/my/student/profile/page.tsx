'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { STUDENT_GRADE_OPTIONS } from '@/lib/student-grade';

export default function StudentProfilePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [loginId, setLoginId] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');

  useEffect(() => {
    fetch('/api/my/student/profile')
      .then(r => r.json())
      .then(d => {
        setLoginId(d.loginId ?? '');
        setName(d.name ?? '');
        setGrade(d.studentMeta?.grade ?? '');
      })
      .catch(() => {});
  }, []);

  const handleProfileSave = async () => {
    setProfileSaving(true);
    setProfileMsg('');
    const res = await fetch('/api/my/student/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, grade }),
    });
    const data = await res.json();
    setProfileMsg(data.ok ? '저장됐습니다.' : (data.error ?? '저장 실패'));
    setProfileSaving(false);
  };

  const handlePwChange = async () => {
    if (newPassword !== pwConfirm) { setPwMsg('새 비밀번호가 일치하지 않습니다.'); return; }
    if (newPassword.length < 8) { setPwMsg('새 비밀번호는 8자 이상이어야 합니다.'); return; }
    setPwSaving(true);
    setPwMsg('');
    const res = await fetch('/api/my/student/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (data.ok) {
      setPwMsg('비밀번호가 변경됐습니다.');
      setCurrentPassword(''); setNewPassword(''); setPwConfirm('');
    } else {
      setPwMsg(data.error ?? '변경 실패');
    }
    setPwSaving(false);
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-6">
      <div className="bg-gradient-to-br from-indigo-600 to-violet-600 px-5 pt-6 pb-5">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/my/student" className="text-white/70 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-white font-bold text-lg">내 정보</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 mt-5 space-y-4">
        {/* 기본 정보 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <h2 className="font-bold text-slate-800 mb-4">기본 정보</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">로그인 아이디</label>
              <p className="text-slate-700 font-medium">{loginId}</p>
            </div>
            <div>
              <label htmlFor="name" className="block text-xs font-medium text-slate-500 mb-1">이름</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none transition-all text-slate-800 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-2">학년</label>
              <div className="grid grid-cols-3 gap-2">
                {STUDENT_GRADE_OPTIONS.map(g => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setGrade(g.value)}
                    className={`py-2 rounded-xl border text-sm font-medium transition-all ${
                      grade === g.value
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'border-slate-200 text-slate-700 hover:border-indigo-300'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            {profileMsg && (
              <p className={`text-sm ${profileMsg.includes('됐') ? 'text-emerald-600' : 'text-red-500'}`}>{profileMsg}</p>
            )}
            <button
              type="button"
              onClick={handleProfileSave}
              disabled={profileSaving}
              className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {profileSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>

        {/* 비밀번호 변경 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <h2 className="font-bold text-slate-800 mb-4">비밀번호 변경</h2>
          <div className="space-y-3">
            <div>
              <label htmlFor="currentPw" className="block text-xs font-medium text-slate-500 mb-1">현재 비밀번호</label>
              <input id="currentPw" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none transition-all text-slate-800 text-sm" />
            </div>
            <div>
              <label htmlFor="newPw" className="block text-xs font-medium text-slate-500 mb-1">새 비밀번호 (8자 이상)</label>
              <input id="newPw" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none transition-all text-slate-800 text-sm" />
            </div>
            <div>
              <label htmlFor="pwConfirm" className="block text-xs font-medium text-slate-500 mb-1">새 비밀번호 확인</label>
              <input id="pwConfirm" type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none transition-all text-slate-800 text-sm" />
            </div>
            {pwMsg && (
              <p className={`text-sm ${pwMsg.includes('됐') ? 'text-emerald-600' : 'text-red-500'}`}>{pwMsg}</p>
            )}
            <button
              type="button"
              onClick={handlePwChange}
              disabled={pwSaving}
              className="w-full py-2.5 rounded-xl bg-slate-700 text-white font-semibold text-sm hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {pwSaving ? '변경 중...' : '비밀번호 변경'}
            </button>
          </div>
        </div>

        {/* 로그아웃 */}
        <button
          type="button"
          onClick={handleLogout}
          className="w-full py-3 rounded-xl border border-slate-200 text-slate-500 font-medium text-sm hover:bg-slate-50 transition-colors"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
