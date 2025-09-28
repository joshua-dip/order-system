'use client';

import { useState } from 'react';
import TextbookSelection from './components/TextbookSelection';
import LessonSelection from './components/LessonSelection';
import QuestionSettings from './components/QuestionSettings';
import MockExamSettings from './components/MockExamSettings';
import WorkbookTextbookSelection from './components/WorkbookTextbookSelection';
import WorkbookLessonSelection from './components/WorkbookLessonSelection';
import WorkbookTypeSelection from './components/WorkbookTypeSelection';
import OrderDisplay from './components/OrderDisplay';
import AppBar from './components/AppBar';

type PageStep = 'selection' | 'textbook' | 'lessons' | 'questions' | 'mockexam' | 'workbook_textbook' | 'workbook_lessons' | 'workbook_types' | 'order';
type OrderType = 'textbook' | 'mockexam' | 'workbook';

export default function Home() {
  const [currentStep, setCurrentStep] = useState<PageStep>('selection');
  const [orderType, setOrderType] = useState<OrderType>('textbook');
  const [selectedTextbook, setSelectedTextbook] = useState<string>('');
  const [selectedLessons, setSelectedLessons] = useState<string[]>([]);
  const [selectedWorkbookTypes, setSelectedWorkbookTypes] = useState<string[]>([]);
  const [generatedOrder, setGeneratedOrder] = useState<string>('');

  const handleTextbookSelect = (textbook: string) => {
    setSelectedTextbook(textbook);
    setOrderType('textbook');
    if (currentStep === 'selection') {
      setCurrentStep('lessons');
    }
    // 이미 lessons 페이지에 있다면 상태만 업데이트
  };

  const handleMockExamSelect = () => {
    setOrderType('mockexam');
    setCurrentStep('mockexam');
  };

  const handleWorkbookSelect = () => {
    setOrderType('workbook');
    setCurrentStep('workbook_textbook');
  };

  const handleWorkbookTextbookSelect = (textbook: string) => {
    setSelectedTextbook(textbook);
    if (textbook === '워크북_목록') {
      // 워크북 교재 목록 표시 로직 (나중에 구현)
      setCurrentStep('workbook_textbook');
    } else {
      setCurrentStep('workbook_lessons');
    }
  };

  const handleWorkbookLessonsSelect = (lessons: string[]) => {
    setSelectedLessons(lessons);
    setCurrentStep('workbook_types');
  };

  const handleWorkbookTypesSelect = (types: string[]) => {
    setSelectedWorkbookTypes(types);
    // 주문서 생성은 WorkbookTypeSettings에서 처리
  };


  const handleLessonsSelect = (lessons: string[]) => {
    setSelectedLessons(lessons);
    setCurrentStep('questions');
  };

  const handleOrderGenerate = (orderText: string) => {
    setGeneratedOrder(orderText);
    setCurrentStep('order');
  };

  const handleBackToSelection = () => {
    setCurrentStep('selection');
    setOrderType('textbook');
    setSelectedTextbook('');
    setSelectedLessons([]);
    setSelectedWorkbookTypes([]);
  };

  const handleBackToTextbook = () => {
    setCurrentStep('textbook');
    setSelectedTextbook('');
    setSelectedLessons([]);
  };

  const handleBackToLessons = () => {
    if (orderType === 'workbook') {
      setCurrentStep('workbook_lessons');
    } else {
      setCurrentStep('lessons');
    }
  };

  const handleBackToWorkbookTextbook = () => {
    setCurrentStep('workbook_textbook');
    setOrderType('workbook');
    setSelectedLessons([]);
    setSelectedWorkbookTypes([]);
  };

  const handleBackToWorkbookLessons = () => {
    setCurrentStep('workbook_lessons');
    setOrderType('workbook');
    setSelectedWorkbookTypes([]);
  };

  const handleClearOrder = () => {
    setGeneratedOrder('');
    setCurrentStep('selection');
    setOrderType('textbook');
    setSelectedTextbook('');
    setSelectedLessons([]);
    setSelectedWorkbookTypes([]);
  };

  const handleNewOrder = () => {
    setGeneratedOrder('');
    setCurrentStep('selection');
    setOrderType('textbook');
    setSelectedTextbook('');
    setSelectedLessons([]);
    setSelectedWorkbookTypes([]);
  };

  // 현재 단계에 따라 컴포넌트 렌더링
  switch (currentStep) {
    case 'selection':
      return (
        <TextbookSelection 
          onTextbookSelect={handleTextbookSelect}
          onMockExamSelect={handleMockExamSelect}
          onWorkbookSelect={handleWorkbookSelect}
        />
      );
    
    case 'mockexam':
      return (
        <MockExamSettings
          onOrderGenerate={handleOrderGenerate}
          onBack={handleBackToSelection}
        />
      );
    
    case 'workbook_textbook':
      return (
        <WorkbookTextbookSelection
          onTextbookSelect={handleWorkbookTextbookSelect}
          onBack={handleBackToSelection}
        />
      );

    case 'workbook_lessons':
      return (
        <WorkbookLessonSelection
          selectedTextbook={selectedTextbook}
          onLessonsSelect={handleWorkbookLessonsSelect}
          onBack={handleBackToSelection}
          onBackToTextbook={handleBackToWorkbookTextbook}
        />
      );

    case 'workbook_types':
      return (
        <WorkbookTypeSelection
          selectedTextbook={selectedTextbook}
          selectedLessons={selectedLessons}
          onOrderGenerate={handleOrderGenerate}
          onBack={handleBackToSelection}
          onBackToTextbook={handleBackToWorkbookTextbook}
          onBackToLessons={handleBackToWorkbookLessons}
        />
      );
    
    
    case 'lessons':
      return (
        <LessonSelection 
          selectedTextbook={selectedTextbook}
          onLessonsSelect={handleLessonsSelect}
          onBack={handleBackToSelection}
          onTextbookSelect={handleTextbookSelect}
        />
      );
    
    case 'questions':
      return (
        <QuestionSettings
          selectedTextbook={selectedTextbook}
          selectedLessons={selectedLessons}
          onOrderGenerate={handleOrderGenerate}
          onBack={handleBackToLessons}
          onBackToTextbook={handleBackToSelection}
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
                    onClick={handleBackToSelection}
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
                    onClick={handleBackToLessons}
                    title="강과 번호 선택으로 돌아가기"
                  >
                    <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold group-hover:bg-green-700 transition-colors">
                      ✓
                    </div>
                    <span className="text-xs mt-1 text-green-600 font-medium group-hover:text-green-700">강과 번호</span>
                  </div>
                  <div className="flex-1 h-1 bg-green-600 mx-4"></div>
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                      ✓
                    </div>
                    <span className="text-xs mt-1 text-green-600 font-medium">문제 설정</span>
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
        <TextbookSelection 
          onTextbookSelect={handleTextbookSelect}
          onMockExamSelect={handleMockExamSelect}
          onWorkbookSelect={handleWorkbookSelect}
        />
      );
  }
}