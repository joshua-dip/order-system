'use client';

import { useState } from 'react';

interface OrderDisplayProps {
  orderText: string;
  onClear: () => void;
}

const OrderDisplay = ({ orderText, onClear }: OrderDisplayProps) => {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(orderText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!orderText) return null;

  return (
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
  );
};

export default OrderDisplay;
