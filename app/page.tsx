'use client';

import { useState } from 'react';
import TextbookSelection from './components/TextbookSelection';
import LessonSelection from './components/LessonSelection';
import QuestionSettings from './components/QuestionSettings';
import MockExamSettings from './components/MockExamSettings';
import OrderDisplay from './components/OrderDisplay';

type PageStep = 'selection' | 'textbook' | 'lessons' | 'questions' | 'mockexam' | 'order';
type OrderType = 'textbook' | 'mockexam';

export default function Home() {
  const [currentStep, setCurrentStep] = useState<PageStep>('selection');
  const [orderType, setOrderType] = useState<OrderType>('textbook');
  const [selectedTextbook, setSelectedTextbook] = useState<string>('');
  const [selectedLessons, setSelectedLessons] = useState<string[]>([]);
  const [generatedOrder, setGeneratedOrder] = useState<string>('');

  const handleTextbookSelect = (textbook: string) => {
    setSelectedTextbook(textbook);
    setOrderType('textbook');
    setCurrentStep('lessons');
  };

  const handleMockExamSelect = () => {
    setOrderType('mockexam');
    setCurrentStep('mockexam');
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
  };

  const handleBackToTextbook = () => {
    setCurrentStep('textbook');
    setSelectedTextbook('');
    setSelectedLessons([]);
  };

  const handleBackToLessons = () => {
    setCurrentStep('lessons');
  };

  const handleClearOrder = () => {
    setGeneratedOrder('');
    setCurrentStep('selection');
    setOrderType('textbook');
    setSelectedTextbook('');
    setSelectedLessons([]);
  };

  const handleNewOrder = () => {
    setGeneratedOrder('');
    setCurrentStep('selection');
    setOrderType('textbook');
    setSelectedTextbook('');
    setSelectedLessons([]);
  };

  // 현재 단계에 따라 컴포넌트 렌더링
  switch (currentStep) {
    case 'selection':
      return (
        <TextbookSelection 
          onTextbookSelect={handleTextbookSelect}
          onMockExamSelect={handleMockExamSelect}
        />
      );
    
    case 'mockexam':
      return (
        <MockExamSettings
          onOrderGenerate={handleOrderGenerate}
          onBack={handleBackToSelection}
        />
      );
    
    case 'lessons':
      return (
        <LessonSelection 
          selectedTextbook={selectedTextbook}
          onLessonsSelect={handleLessonsSelect}
          onBack={handleBackToSelection}
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
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8">
          <div className="container mx-auto px-4">
            {/* 헤더 */}
            <div className="text-center mb-8">
              <h1 className="text-4xl font-bold text-gray-800 mb-2">
                ✅ 주문서 완성
              </h1>
              <p className="text-gray-600 text-lg">
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
              
              {/* 새 주문서 작성 버튼 */}
              <div className="mt-6 text-center">
                <button
                  onClick={handleNewOrder}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  새 주문서 작성하기
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    
    default:
      return (
        <TextbookSelection 
          onTextbookSelect={handleTextbookSelect}
          onMockExamSelect={handleMockExamSelect}
        />
      );
  }
}