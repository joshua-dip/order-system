'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppBar from '../components/AppBar';

const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com';

export default function EssayPage() {
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        setAuthorized(!!data?.user);
      })
      .catch(() => setAuthorized(false))
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <>
        <AppBar title="커스터마이징 서비스" />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar title="커스터마이징 서비스" />
      <div className="min-h-screen py-8 px-4" style={{ backgroundColor: '#F5F5F5' }}>
        <div className="max-w-2xl mx-auto text-center">
          <p className="mb-4">
            <Link href="/" className="text-sm font-medium text-blue-600 hover:underline">
              ← 메인 화면으로
            </Link>
          </p>

          {authorized ? (
            <>
              <h1 className="text-2xl font-bold text-gray-800 mb-2">서술형문제 주문제작</h1>
              <p className="text-gray-600 mb-6">서비스 준비가 완료되면 이용하실 수 있습니다.</p>
              <Link
                href="/"
                className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                메인으로
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-gray-800 mb-2">서술형문제 주문제작</h1>
              <p className="text-gray-600 mb-4">서술형문제 주문제작은 회원 전용 서비스입니다.</p>
              <p className="text-gray-600 mb-6">회원가입 문의는 카카오톡으로 해 주세요.</p>
              <a
                href={KAKAO_INQUIRY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#FEE500] text-gray-800 rounded-lg hover:bg-[#FDD835] transition-colors font-medium border border-gray-300"
              >
                회원가입 문의하러 가기
              </a>
              <p className="mt-6">
                <Link href="/" className="text-sm text-gray-500 hover:underline">
                  메인으로 돌아가기
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
