'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import WorkbookTextbookSelection from '../components/WorkbookTextbookSelection';
import WorkbookLessonSelection from '../components/WorkbookLessonSelection';
import WorkbookMockExamNumberSelection from '../components/WorkbookMockExamNumberSelection';
import WorkbookTypeSelection from '../components/WorkbookTypeSelection';
import OrderDisplay from '../components/OrderDisplay';
import AppBar from '../components/AppBar';
import { saveOrderToDb } from '@/lib/orders';

type PageStep = 'textbook' | 'lessons' | 'mockexam_numbers' | 'types' | 'order';

export default function WorkbookPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<PageStep>('textbook');
  const [selectedTextbook, setSelectedTextbook] = useState<string>('');
  const [selectedLessons, setSelectedLessons] = useState<string[]>([]);
  const [generatedOrder, setGeneratedOrder] = useState<string>('');

  const handleTextbookSelect = (textbook: string) => {
    setSelectedTextbook(textbook);
    
    // 모의고사인지 부교재인지 구분
    if (textbook.startsWith('고1_') || textbook.startsWith('고2_') || textbook.startsWith('고3_')) {
      // 모의고사는 번호 선택 단계로
      setCurrentStep('mockexam_numbers');
    } else {
      // 부교재는 강 선택 단계로
      setCurrentStep('lessons');
    }
  };

  const handleLessonsSelect = (lessons: string[]) => {
    setSelectedLessons(lessons);
    setCurrentStep('types');
  };

  const handleMockExamNumbersSelect = (numbers: string[]) => {
    setSelectedLessons(numbers);
    setCurrentStep('types');
  };

  const handleOrderGenerate = (orderText: string) => {
    setGeneratedOrder(orderText);
    setCurrentStep('order');
    saveOrderToDb(orderText).catch((err) => console.error('주문 DB 저장 실패:', err));
  };

  const handleBackToHome = () => {
    router.push('/');
  };

  const handleBackToTextbook = () => {
    setCurrentStep('textbook');
    setSelectedTextbook('');
    setSelectedLessons([]);
  };

  const handleBackToLessons = () => {
    // 모의고사인지 확인
    if (selectedTextbook.startsWith('고1_') || selectedTextbook.startsWith('고2_') || selectedTextbook.startsWith('고3_')) {
      setCurrentStep('mockexam_numbers');
    } else {
      setCurrentStep('lessons');
    }
  };

  const handleClearOrder = () => {
    setGeneratedOrder('');
    setCurrentStep('textbook');
    setSelectedTextbook('');
    setSelectedLessons([]);
  };

  const handleNewOrder = () => {
    setGeneratedOrder('');
    setCurrentStep('textbook');
    setSelectedTextbook('');
    setSelectedLessons([]);
  };

  // 현재 단계에 따라 컴포넌트 렌더링
  switch (currentStep) {
    case 'textbook':
      return (
        <WorkbookTextbookSelection
          onTextbookSelect={handleTextbookSelect}
          onBack={handleBackToHome}
        />
      );
    
    case 'lessons':
      return (
        <WorkbookLessonSelection
          selectedTextbook={selectedTextbook}
          onLessonsSelect={handleLessonsSelect}
          onBack={handleBackToHome}
          onBackToTextbook={handleBackToTextbook}
        />
      );
    
    case 'mockexam_numbers':
      return (
        <WorkbookMockExamNumberSelection
          selectedExam={selectedTextbook}
          onNumbersSelect={handleMockExamNumbersSelect}
          onBack={handleBackToHome}
          onBackToTextbook={handleBackToTextbook}
        />
      );
    
    case 'types':
      return (
        <WorkbookTypeSelection
          selectedTextbook={selectedTextbook}
          selectedLessons={selectedLessons}
          onOrderGenerate={handleOrderGenerate}
          onBack={handleBackToHome}
          onBackToTextbook={handleBackToTextbook}
          onBackToLessons={handleBackToLessons}
        />
      );
    
    case 'order':
      return (
        <>
          <AppBar 
            showBackButton={true} 
            onBackClick={handleNewOrder}
            title="주문서 완성"
          />
          <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
            <div className="container mx-auto px-4">
              {/* 헤더 */}
              <div className="text-center mb-8">
                <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
                  주문서 완성
                </h1>
                <p className="text-lg" style={{ color: '#888B8D' }}>
                  주문서가 성공적으로 생성되었습니다
                </p>
              </div>

              {/* 진행 단계 표시 */}
              <div className="max-w-2xl mx-auto mb-8">
                <div className="flex items-center justify-between">
                  <div 
                    className="flex flex-col items-center cursor-pointer group"
                    onClick={handleBackToHome}
                    title="유형 선택으로 돌아가기"
                  >
                    <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold group-hover:bg-green-700 transition-colors">
                      ✓
                    </div>
                    <span className="text-xs mt-1 text-green-600 font-medium group-hover:text-green-700">유형 선택</span>
                  </div>
                  <div className="flex-1 h-1 bg-green-600 mx-4"></div>
                  <div 
                    className="flex flex-col items-center cursor-pointer group"
                    onClick={handleBackToTextbook}
                    title="교재 선택으로 돌아가기"
                  >
                    <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold group-hover:bg-green-700 transition-colors">
                      ✓
                    </div>
                    <span className="text-xs mt-1 text-green-600 font-medium group-hover:text-green-700">교재 선택</span>
                  </div>
                  <div className="flex-1 h-1 bg-green-600 mx-4"></div>
                  <div 
                    className="flex flex-col items-center cursor-pointer group"
                    onClick={handleBackToLessons}
                    title="강/번호 선택으로 돌아가기"
                  >
                    <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold group-hover:bg-green-700 transition-colors">
                      ✓
                    </div>
                    <span className="text-xs mt-1 text-green-600 font-medium group-hover:text-green-700">강/번호</span>
                  </div>
                  <div className="flex-1 h-1 bg-green-600 mx-4"></div>
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                      ✓
                    </div>
                    <span className="text-xs mt-1 text-green-600 font-medium">워크북 유형</span>
                  </div>
                </div>
              </div>

              {/* 주문서 표시 */}
              <div className="max-w-2xl mx-auto">
                <OrderDisplay 
                  orderText={generatedOrder} 
                  onClear={handleClearOrder}
                />
                
                {/* 액션 버튼들 */}
                <div className="mt-6 flex flex-col sm:flex-row gap-4 justify-center">
                  <button
                    onClick={handleNewOrder}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    새 주문서 작성하기
                  </button>
                  <a
                    href="https://open.kakao.com/o/sHuV7wSh"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-6 py-3 rounded-lg hover:opacity-90 transition-all font-medium text-center flex items-center justify-center space-x-2 border-2"
                    style={{ backgroundColor: '#13294B', color: 'white', borderColor: '#13294B' }}
                  >
                    <svg 
                      width="16" 
                      height="16" 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-4 h-4"
                    >
                      <path 
                        d="M12 3C6.48 3 2 6.58 2 11c0 2.4 1.17 4.55 3 6.06V21l3.94-2.06c.97.27 2 .42 3.06.42 5.52 0 10-3.58 10-8s-4.48-8-10-8z" 
                        fill="currentColor"
                      />
                    </svg>
                    <span>주문서 내보내기</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </>
      );
    
    default:
      return (
        <WorkbookTextbookSelection
          onTextbookSelect={handleTextbookSelect}
          onBack={handleBackToHome}
        />
      );
  }
}

