'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppBar from './AppBar';

const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

interface TextbookSelectionProps {
  onTextbookSelect: (textbook: string) => void;
  onMockExamSelect: () => void;
  onWorkbookSelect: () => void;
}

const TextbookSelection = ({ onTextbookSelect, onMockExamSelect, onWorkbookSelect }: TextbookSelectionProps) => {
  const router = useRouter();
  const [user, setUser] = useState<{ canAccessAnalysis: boolean; canAccessEssay: boolean } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data?.user) {
          setUser({
            canAccessAnalysis: !!data.user.canAccessAnalysis,
            canAccessEssay: !!data.user.canAccessEssay,
          });
        } else {
          setUser(null);
        }
      })
      .catch(() => setUser(null));
  }, []);

  const handleMockExamClick = () => {
    router.push('/mockexam');
  };

  const handleTextbookClick = () => {
    router.push('/textbook');
  };

  const handleWorkbookClick = () => {
    router.push('/workbook');
  };

  const handleAnalysisClick = () => {
    router.push('/analysis');
  };

  const handleEssayClick = () => {
    router.push('/essay');
  };

  return (
    <>
      <AppBar />
      <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="container mx-auto px-4">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
            주문 유형 선택
          </h1>
          <p className="text-lg mb-4" style={{ color: '#888B8D' }}>
            원하시는 자료 유형을 선택해주세요
          </p>
        </div>


        {/* 주문 유형 선택 */}
        <div className="max-w-6xl mx-auto mb-12">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* 모의고사 변형문제 주문 */}
            <div
              onClick={handleMockExamClick}
              className="group relative bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-500 cursor-pointer border border-gray-200 hover:border-gray-300 overflow-hidden"
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ backgroundColor: '#13294B' }}></div>
              <div className="relative z-10 p-8">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 transition-all duration-500 group-hover:bg-white group-hover:bg-opacity-20" style={{ backgroundColor: '#13294B' }}>
                    <span className="text-2xl font-bold text-white">📝</span>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-800 group-hover:text-white transition-colors duration-500 mb-3">모의고사 변형문제 주문</h3>
                  <p className="text-gray-600 group-hover:text-white group-hover:opacity-90 transition-all duration-500 text-sm mb-6 leading-relaxed">
                    18~40번, 41~42번, 43~45번<br/>
                    정해진 문항 구성
                  </p>
                  <div className="inline-block px-4 py-2 rounded-lg text-sm font-medium transition-all duration-500 border-2 text-gray-700 border-gray-300 group-hover:border-white group-hover:text-white">
                    선택하기
                  </div>
                </div>
              </div>
            </div>

            {/* 부교재 변형문제 주문 */}
            <div
              onClick={handleTextbookClick}
              className="group relative bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-500 cursor-pointer border border-gray-200 hover:border-gray-300 overflow-hidden"
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ backgroundColor: '#13294B' }}></div>
              <div className="relative z-10 p-8">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 transition-all duration-500 group-hover:bg-white group-hover:bg-opacity-20" style={{ backgroundColor: '#13294B' }}>
                    <span className="text-2xl font-bold text-white">📚</span>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-800 group-hover:text-white transition-colors duration-500 mb-3">부교재 변형문제 주문</h3>
                  <p className="text-gray-600 group-hover:text-white group-hover:opacity-90 transition-all duration-500 text-sm mb-6 leading-relaxed">
                    교재별 맞춤 문항 선택<br/>
                    다양한 교재 지원
                  </p>
                  <div className="inline-block px-4 py-2 rounded-lg text-sm font-medium transition-all duration-500 border-2 text-gray-700 border-gray-300 group-hover:border-white group-hover:text-white">
                    선택하기
                  </div>
                </div>
              </div>
            </div>

            {/* 워크북 주문 */}
            <div
              onClick={handleWorkbookClick}
              className="group relative bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-500 cursor-pointer border border-gray-200 hover:border-gray-300 overflow-hidden"
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ backgroundColor: '#00A9E0' }}></div>
              <div className="relative z-10 p-8">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 transition-all duration-500 group-hover:bg-white group-hover:bg-opacity-20" style={{ backgroundColor: '#00A9E0' }}>
                    <span className="text-2xl font-bold text-white">📖</span>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-800 group-hover:text-white transition-colors duration-500 mb-3">워크북 주문</h3>
                  <p className="text-gray-600 group-hover:text-white group-hover:opacity-90 transition-all duration-500 text-sm mb-6 leading-relaxed">
                    빈칸쓰기,  낱말배열 등<br/>
                    카테고리별 문제 구성
                  </p>
                  <div className="inline-block px-4 py-2 rounded-lg text-sm font-medium transition-all duration-500 border-2 text-gray-700 border-gray-300 group-hover:border-white group-hover:text-white">
                    선택하기
                  </div>
                </div>
              </div>
            </div>

            {/* 번호별 교재 제작하기 */}
            <div
              onClick={() => router.push('/order-num')}
              className="group relative bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-500 cursor-pointer border border-gray-200 hover:border-gray-300 overflow-hidden"
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ backgroundColor: '#F5C6CB' }}></div>
              <div className="relative z-10 p-8">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 transition-all duration-500 group-hover:bg-white group-hover:bg-opacity-20" style={{ backgroundColor: '#F5C6CB' }}>
                    <span className="text-2xl font-bold text-white">🎯</span>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-800 group-hover:text-white transition-colors duration-500 mb-3">번호별 교재 제작하기</h3>
                  <p className="text-gray-600 group-hover:text-white group-hover:opacity-90 transition-all duration-500 text-sm mb-6 leading-relaxed">
                    모의고사 번호별<br/>
                    맞춤 교재 구성
                  </p>
                  <div className="inline-block px-4 py-2 rounded-lg text-sm font-medium transition-all duration-500 border-2 text-gray-700 border-gray-300 group-hover:border-white group-hover:text-white">
                    선택하기
                  </div>
                </div>
              </div>
            </div>

            {/* 분석지 주문제작 - 카드 항상 표시, 권한 없으면 클릭 불가 + 카톡 문의 안내 */}
            <div
              onClick={user !== null && user.canAccessAnalysis ? handleAnalysisClick : undefined}
              className={`group relative bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden transition-all duration-500 ${user !== null && user.canAccessAnalysis ? 'hover:shadow-2xl cursor-pointer hover:border-gray-300' : 'cursor-default'}`}
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ backgroundColor: '#2D5016' }}></div>
              <div className="relative z-10 p-8">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 transition-all duration-500 group-hover:bg-white group-hover:bg-opacity-20" style={{ backgroundColor: '#2D5016' }}>
                    <span className="text-2xl font-bold text-white">📊</span>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-800 group-hover:text-white transition-colors duration-500 mb-3">분석지 주문제작</h3>
                  <p className="text-gray-600 group-hover:text-white group-hover:opacity-90 transition-all duration-500 text-sm mb-6 leading-relaxed">
                    {user !== null && user.canAccessAnalysis ? (
                      <>맞춤 분석지<br/>주문·제작 신청</>
                    ) : (
                      <>해당 메뉴를 이용하려면<br/>회원 가입 문의(카톡 문의)를 통해 이용할 수 있습니다.</>
                    )}
                  </p>
                  {user !== null && user.canAccessAnalysis ? (
                    <div className="inline-block px-4 py-2 rounded-lg text-sm font-medium transition-all duration-500 border-2 text-gray-700 border-gray-300 group-hover:border-white group-hover:text-white">
                      선택하기
                    </div>
                  ) : (
                    <a
                      href={KAKAO_INQUIRY_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border-2 bg-[#FEE500] border-[#FEE500] text-gray-800 hover:bg-[#FDD835] hover:border-[#FDD835] transition-colors"
                    >
                      카톡 문의하기
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* 서술형문제 주문제작 - 누구나 진입 가능 (EBS·모의고사 주문 가능, 부교재는 회원만) */}
            <div
              onClick={handleEssayClick}
              className="group relative bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden transition-all duration-500 hover:shadow-2xl cursor-pointer hover:border-gray-300"
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ backgroundColor: '#5C4033' }}></div>
              <div className="relative z-10 p-8">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 transition-all duration-500 group-hover:bg-white group-hover:bg-opacity-20" style={{ backgroundColor: '#5C4033' }}>
                    <span className="text-2xl font-bold text-white">✍️</span>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-800 group-hover:text-white transition-colors duration-500 mb-3">서술형문제 주문제작</h3>
                  <p className="text-gray-600 group-hover:text-white group-hover:opacity-90 transition-all duration-500 text-sm mb-6 leading-relaxed">
                    <>EBS·모의고사 누구나 주문 가능<br/>부교재는 회원만 이용</>
                  </p>
                  <div className="inline-block px-4 py-2 rounded-lg text-sm font-medium transition-all duration-500 border-2 text-gray-700 border-gray-300 group-hover:border-white group-hover:text-white">
                    선택하기
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>


      </div>
    </div>
    </>
  );
};

export default TextbookSelection;
