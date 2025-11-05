'use client';

import { useState } from 'react';
import NumberBasedProduction from '../components/NumberBasedProduction';
import OrderDisplay from '../components/OrderDisplay';
import AppBar from '../components/AppBar';

export default function OrderNumPage() {
  const [generatedOrder, setGeneratedOrder] = useState<string>('');
  const [showOrder, setShowOrder] = useState(false);

  const handleOrderGenerate = (orderText: string) => {
    setGeneratedOrder(orderText);
    setShowOrder(true);
  };

  const handleBackToOrder = () => {
    setShowOrder(false);
    setGeneratedOrder('');
  };

  const handleNewOrder = () => {
    setShowOrder(false);
    setGeneratedOrder('');
    // 페이지 새로고침
    window.location.href = '/order-num';
  };

  if (showOrder) {
    return (
      <>
        <AppBar 
          showBackButton={true} 
          onBackClick={handleBackToOrder}
          title="주문서 완성"
        />
        <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
          <div className="container mx-auto px-4">
            <div className="text-center mb-8">
              <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
                주문서 완성
              </h1>
              <p className="text-lg" style={{ color: '#888B8D' }}>
                주문서가 성공적으로 생성되었습니다
              </p>
            </div>

            <div className="max-w-2xl mx-auto">
              <OrderDisplay 
                orderText={generatedOrder} 
                onClear={handleNewOrder}
              />
              
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
  }

  return <NumberBasedProduction onBack={() => window.location.href = '/'} onOrderGenerate={handleOrderGenerate} />;
}

