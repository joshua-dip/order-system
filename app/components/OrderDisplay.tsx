'use client';

import { useState } from 'react';

interface OrderDisplayProps {
  orderText: string;
  onClear: () => void;
}

const OrderDisplay = ({ orderText, onClear }: OrderDisplayProps) => {
  const [copied, setCopied] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(orderText);
      setCopied(true);
      setShowModal(true);
    } catch (err) {
      console.error('클립보드 복사 실패:', err);
      // 폴백: 텍스트 선택
      const textArea = document.createElement('textarea');
      textArea.value = orderText;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setShowModal(true);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setTimeout(() => setCopied(false), 300);
  };

  const handleGoToKakao = () => {
    window.open('https://open.kakao.com/o/sHuV7wSh', '_blank');
    handleCloseModal();
  };

  if (!orderText) return null;

  return (
    <>
      <div className="bg-gray-50 p-6 rounded-lg shadow-md">
        <h3 className="text-xl font-bold mb-4 text-gray-800">생성된 주문서</h3>
        
        <div className="bg-white p-4 rounded border border-gray-200 mb-4">
          <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">
            {orderText}
          </pre>
        </div>

        <div className="flex space-x-3">
          <button
            onClick={copyToClipboard}
            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
              copied 
                ? 'bg-green-600 text-white' 
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {copied ? '✓ 복사됨!' : '📋 클립보드에 복사'}
          </button>
          
          <button
            onClick={onClear}
            className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium"
          >
            지우기
          </button>
        </div>
      </div>

      {/* 복사 완료 모달 */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scale-in">
            {/* 성공 아이콘 */}
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>

            {/* 메시지 */}
            <h3 className="text-2xl font-bold text-center mb-4 text-gray-800">
              클립보드에 복사되었습니다! 🎉
            </h3>
            
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-700 leading-relaxed mb-3">
                📱 <strong>카카오톡 오픈채팅방</strong>으로 이동해서<br/>
                채팅창에 <strong>붙여넣기(Ctrl+V 또는 ⌘+V)</strong>하여 보내주세요
              </p>
              
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mt-3">
                <p className="text-xs text-gray-600 leading-relaxed">
                  ⏱️ <strong>작업 소요 시간:</strong> 최대 1일<br/>
                  🤖 <strong>AI 기반 문제 제작:</strong> 오류 발생 시 알려주시면 수정하여 다시 보내드립니다
                </p>
              </div>
            </div>

            {/* 버튼들 */}
            <div className="flex flex-col gap-3">
              <button
                onClick={handleGoToKakao}
                className="w-full py-4 px-6 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-xl font-bold text-lg transition-all shadow-lg hover:shadow-xl flex items-center justify-center space-x-2"
              >
                <svg 
                  width="24" 
                  height="24" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path 
                    d="M12 3C6.48 3 2 6.58 2 11c0 2.4 1.17 4.55 3 6.06V21l3.94-2.06c.97.27 2 .42 3.06.42 5.52 0 10-3.58 10-8s-4.48-8-10-8z" 
                    fill="currentColor"
                  />
                </svg>
                <span>카카오톡 오픈채팅방으로 이동</span>
              </button>
              
              <button
                onClick={handleCloseModal}
                className="w-full py-3 px-6 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-medium transition-all"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes scale-in {
          from {
            opacity: 0;
            transform: scale(0.9);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .animate-scale-in {
          animation: scale-in 0.2s ease-out;
        }
      `}</style>
    </>
  );
};

export default OrderDisplay;
