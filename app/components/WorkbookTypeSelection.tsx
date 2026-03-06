'use client';

import { useState, useEffect } from 'react';
import AppBar from './AppBar';
import convertedData from '../data/converted_data.json';

interface WorkbookTypeSelectionProps {
  selectedTextbook: string;
  selectedLessons: string[];
  onOrderGenerate: (orderText: string) => void;
  onBack: () => void;
  onBackToTextbook: () => void;
  onBackToLessons: () => void;
}

const WorkbookTypeSelection = ({ 
  selectedTextbook, 
  selectedLessons, 
  onOrderGenerate, 
  onBack, 
  onBackToTextbook, 
  onBackToLessons 
}: WorkbookTypeSelectionProps) => {
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [email, setEmail] = useState<string>('');
  const [totalTextCount, setTotalTextCount] = useState<number>(0);
  
  // 모의고사 여부 확인
  const isMockExam = selectedTextbook.startsWith('고1_') || selectedTextbook.startsWith('고2_') || selectedTextbook.startsWith('고3_');

  // 워크북 패키지들
  const workbookPackages = [
    {
      id: 'blank_package',
      name: '워크북 빈칸쓰기 패키지',
      description: '형용사, 키워드, 명사형, 전치사, 동사형 빈칸연습',
      price: 300,
      subTypes: [
        '형용사빈칸연습',
        '키워드빈칸연습', 
        '명사형빈칸연습',
        '전치사빈칸연습',
        '동사형빈칸연습'
      ]
    },
    {
      id: 'keyword_blank',
      name: '워크북 빈칸쓰기 키워드',
      description: '키워드 중심의 빈칸쓰기 연습',
      price: 100,
      subTypes: ['키워드빈칸연습']
    },
    {
      id: 'word_arrangement',
      name: '워크북 낱말배열',
      description: '낱말 순서 배열 연습',
      price: 100,
      subTypes: ['낱말배열연습']
    },
    {
      id: 'lecture_material',
      name: '강의용자료/수업용자료',
      description: '원문과 해석 자료',
      price: isMockExam ? 0 : 200,
      subTypes: ['원문과 해석 자료'],
      isFree: isMockExam
    },
    {
      id: 'one_line_interpretation',
      name: '한줄해석/해석쓰기/영작하기',
      description: '한줄해석/해석쓰기/영작하기 자료',
      price: isMockExam ? 0 : 300,
      subTypes: ['한줄해석/해석쓰기/영작하기 자료'],
      isFree: isMockExam
    }
  ];

  // 선택된 강들에서 실제 지문 개수 계산
  useEffect(() => {
    const calculateTextCount = async () => {
      try {
        if (isMockExam) {
          // 모의고사는 선택된 번호 개수가 지문 개수
          setTotalTextCount(selectedLessons.length);
        } else {
          // 부교재 지문 개수 계산
          const textbookData = (convertedData as Record<string, unknown>)[selectedTextbook];
          
          if (textbookData && typeof textbookData === 'object') {
            const sheet1 = (textbookData as Record<string, unknown>).Sheet1;
            if (sheet1 && typeof sheet1 === 'object') {
              const 부교재 = (sheet1 as Record<string, unknown>).부교재 as Record<string, unknown> | undefined;
              if (부교재 && typeof 부교재 === 'object') {
                let textbookInfo = 부교재[selectedTextbook];
                if (!textbookInfo && Object.keys(부교재).length > 0) {
                  textbookInfo = 부교재[Object.keys(부교재)[0]];
                }
                if (textbookInfo && typeof textbookInfo === 'object') {
                  const textbookInfoRecord = textbookInfo as Record<string, unknown>;
                  let totalCount = 0;
                  selectedLessons.forEach(lessonName => {
                    const lessonData = textbookInfoRecord[lessonName];
                    if (Array.isArray(lessonData)) {
                      totalCount += lessonData.length;
                    }
                  });
                  setTotalTextCount(totalCount);
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('지문 개수 계산 실패:', error);
        setTotalTextCount(0);
      }
    };

    if (selectedTextbook) {
      if (isMockExam || selectedLessons.length > 0) {
        calculateTextCount();
      }
    }
  }, [selectedTextbook, selectedLessons, isMockExam]);

  const handlePackageChange = (packageId: string) => {
    setSelectedPackages(prev => {
      if (prev.includes(packageId)) {
        // 선택 해제
        return prev.filter(p => p !== packageId);
      } else {
        // 새로 선택
        let newSelection = [...prev, packageId];
        
        // 빈칸쓰기 패키지와 키워드 빈칸쓰기는 상호 배타적
        if (packageId === 'blank_package') {
          // 빈칸쓰기 패키지 선택 시 키워드 빈칸쓰기 제거
          newSelection = newSelection.filter(p => p !== 'keyword_blank');
        } else if (packageId === 'keyword_blank') {
          // 키워드 빈칸쓰기 선택 시 빈칸쓰기 패키지 제거
          newSelection = newSelection.filter(p => p !== 'blank_package');
        }
        
        return newSelection;
      }
    });
  };

  const handleAllPackagesToggle = () => {
    if (selectedPackages.length > 0) {
      setSelectedPackages([]);
    } else {
      // 빈칸쓰기 패키지와 낱말배열만 선택 (키워드 빈칸쓰기는 패키지에 포함되므로 제외)
      setSelectedPackages(['blank_package', 'word_arrangement']);
    }
  };

  const generateOrder = () => {
    if (selectedPackages.length === 0) {
      alert('워크북 패키지를 선택해주세요.');
      return;
    }
    
    // 선택된 패키지들의 정보 수집
    const selectedPackageDetails = selectedPackages.map(packageId => 
      workbookPackages.find(pkg => pkg.id === packageId)
    ).filter(Boolean);

    // 무료 자료만 선택된 경우 체크 (모의고사일 때만)
    if (isMockExam) {
      const hasOnlyFreeItems = selectedPackageDetails.every(pkg => pkg!.price === 0);
      if (hasOnlyFreeItems) {
        alert('무료 자료만으로는 주문서를 작성할 수 없습니다.\n유료 자료를 함께 선택해주세요.');
        return;
      }
    }
    
    if (!email.trim()) {
      alert('이메일 주소를 입력해주세요.');
      return;
    }

    // 이메일 형식 검증
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      alert('올바른 이메일 주소를 입력해주세요.');
      return;
    }

    
    // 가격 계산 (지문당 가격 × 실제 지문 수)
    const totalPrice = selectedPackageDetails.reduce((sum, pkg) => {
      return sum + (pkg!.price * totalTextCount);
    }, 0);

    // 할인 계산
    let discountRate = 0;
    let discountAmount = 0;
    
    if (totalTextCount >= 100) {
      discountRate = 20;
    } else if (totalTextCount >= 50) {
      discountRate = 10;
    }
    
    if (discountRate > 0) {
      discountAmount = Math.floor(totalPrice * discountRate / 100);
    }
    
    const finalPrice = totalPrice - discountAmount;
    
    const orderText = `워크북 주문서

자료 받으실 이메일 주소: ${email.trim()}

교재: ${selectedTextbook}
${isMockExam ? `
1. 선택된 번호 (${selectedLessons.length}개)
: ${selectedLessons.join('번, ')}번

` : `
1. 선택된 강 (${selectedLessons.length}개)
: ${selectedLessons.join(', ')}

`}2. 선택된 워크북 패키지
: ${selectedPackageDetails.map(pkg => pkg!.name).join(', ')}

3. 총 지문 수
: ${totalTextCount}지문

4. 패키지별 세부 내용
${selectedPackageDetails.map(pkg => 
`   • ${pkg!.name} (지문당 ${pkg!.price}원)
     - ${pkg!.description}
     - 포함 유형: ${pkg!.subTypes.join(', ')}`
).join('\n')}

5. 가격 계산
${selectedPackageDetails.map(pkg => 
`   • ${pkg!.name}: ${pkg!.price}원 × ${totalTextCount}지문 = ${(pkg!.price * totalTextCount).toLocaleString()}원`
).join('\n')}
   
   기본 금액: ${totalPrice.toLocaleString()}원${discountRate > 0 ? `
   할인 적용: ${discountRate}% 할인 (-${discountAmount.toLocaleString()}원)
   최종 금액: ${finalPrice.toLocaleString()}원` : `
   최종 금액: ${finalPrice.toLocaleString()}원`}

`;

    onOrderGenerate(orderText);
  };

  // 가격 계산 (미리보기용)
  const selectedPackageDetailsPreview = selectedPackages.map(packageId => 
    workbookPackages.find(pkg => pkg.id === packageId)
  ).filter(Boolean);
  
  const basePricePreview = selectedPackageDetailsPreview.reduce((sum, pkg) => {
    return sum + (pkg!.price * totalTextCount);
  }, 0);
  
  // 할인 계산 (미리보기용)
  let discountRatePreview = 0;
  let discountAmountPreview = 0;
  
  if (totalTextCount >= 100) {
    discountRatePreview = 20;
  } else if (totalTextCount >= 50) {
    discountRatePreview = 10;
  }
  
  if (discountRatePreview > 0) {
    discountAmountPreview = Math.floor(basePricePreview * discountRatePreview / 100);
  }
  
  const totalPricePreview = basePricePreview - discountAmountPreview;

  return (
    <>
      <AppBar 
        showBackButton={true} 
        onBackClick={onBack}
        title="워크북 유형 선택"
      />
      <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
        <div className="container mx-auto px-4">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
            워크북 유형 선택
          </h1>
          <p className="text-lg" style={{ color: '#888B8D' }}>
            원하시는 워크북 패키지를 선택해주세요
          </p>
        </div>

        {/* 진행 단계 표시 */}
        <div className="max-w-2xl mx-auto mb-6">
          <div className="flex items-center justify-between">
            <div 
              className="flex flex-col items-center cursor-pointer group"
              onClick={onBack}
              title="주문 유형 선택으로 돌아가기"
            >
              <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold group-hover:bg-green-700 transition-colors">
                ✓
              </div>
              <span className="text-xs mt-1 text-green-600 font-medium group-hover:text-green-700">유형 선택</span>
            </div>
            <div className="flex-1 h-1 bg-green-600 mx-4"></div>
            <div 
              className="flex flex-col items-center cursor-pointer group"
              onClick={onBackToTextbook}
              title="교재 선택으로 돌아가기"
            >
              <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold group-hover:bg-green-700 transition-colors">
                ✓
              </div>
              <span className="text-xs mt-1 text-green-600 font-medium group-hover:text-green-700">교재 선택</span>
            </div>
            {!isMockExam && (
              <>
                <div className="flex-1 h-1 bg-green-600 mx-4"></div>
                <div 
                  className="flex flex-col items-center cursor-pointer group"
                  onClick={onBackToLessons}
                  title="강 선택으로 돌아가기"
                >
                  <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold group-hover:bg-green-700 transition-colors">
                    ✓
                  </div>
                  <span className="text-xs mt-1 text-green-600 font-medium group-hover:text-green-700">강 선택</span>
                </div>
              </>
            )}
            <div className="flex-1 h-1 mx-4" style={{ backgroundColor: '#00A9E0' }}></div>
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 text-white rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: '#00A9E0' }}>
                {isMockExam ? '3' : '4'}
              </div>
              <span className="text-xs mt-1 font-medium" style={{ color: '#00A9E0' }}>워크북 유형</span>
            </div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* 왼쪽: 설정 */}
            <div className="bg-white rounded-xl shadow-md p-6">
              {/* 패키지 안내 및 할인 정보 */}
              <div className="mb-6 space-y-4">
                {/* 패키지 안내 */}
                <div className="p-4 rounded-lg border-2" style={{ backgroundColor: '#FF6B35', borderColor: '#FF6B35' }}>
                  <div className="flex items-center mb-2">
                    <span className="text-white font-semibold">⚠️ 패키지 선택 안내</span>
                  </div>
                  <div className="text-sm text-white">
                    • <strong>빈칸쓰기 패키지</strong>에는 <strong>키워드 빈칸쓰기</strong>가 포함되어 있습니다<br/>
                    • 두 옵션 중 <strong>하나만</strong> 선택 가능합니다<br/>
                    • 패키지 선택 시 더 많은 유형을 포함하여 효율적입니다
                  </div>
                </div>
                
                {/* 가격 정보 */}
                <div className="p-4 rounded-lg border-2" style={{ backgroundColor: '#00A9E0', borderColor: '#00A9E0' }}>
                  <div className="flex items-center mb-2">
                    <span className="text-white font-semibold">워크북 가격 안내</span>
                  </div>
                  <div className="text-sm text-white">
                    • 빈칸쓰기 패키지: 지문당 300원<br/>
                    • 빈칸쓰기 키워드: 지문당 100원<br/>
                    • 낱말배열: 지문당 100원
                  </div>
                </div>
                
                {/* 할인 정보 */}
                <div className="p-4 rounded-lg border-2" style={{ backgroundColor: '#28a745', borderColor: '#28a745' }}>
                  <div className="flex items-center mb-2">
                    <span className="text-white font-semibold">🎉 할인 혜택</span>
                  </div>
                  <div className="text-sm text-white">
                    • 50지문 이상: <strong>10% 할인</strong><br/>
                    • 100지문 이상: <strong>20% 할인</strong><br/>
                    {totalTextCount > 0 && (
                      <div className="mt-2 pt-2 border-t border-white border-opacity-30">
                        현재 선택: <strong>{totalTextCount}지문</strong>
                        {totalTextCount >= 100 ? (
                          <span className="block text-yellow-200 font-bold">✨ 20% 할인 적용!</span>
                        ) : totalTextCount >= 50 ? (
                          <span className="block text-yellow-200 font-bold">✨ 10% 할인 적용!</span>
                        ) : (
                          <span className="block text-white opacity-75">
                            {50 - totalTextCount}지문 더 선택하면 10% 할인!
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 워크북 패키지 선택 */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-lg font-medium text-black">워크북 패키지</h4>
                  <button
                    onClick={handleAllPackagesToggle}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border-2 text-white hover:opacity-90`}
                    style={{ 
                      backgroundColor: selectedPackages.length > 0 ? '#888B8D' : '#00A9E0',
                      borderColor: selectedPackages.length > 0 ? '#888B8D' : '#00A9E0'
                    }}
                  >
                    {selectedPackages.length > 0 ? '전체 해제' : '추천 선택'}
                  </button>
                </div>
                <div className="space-y-4">
                  {workbookPackages.map((pkg) => {
                    // 상호 배타적 규칙 확인
                    const isDisabled = 
                      (pkg.id === 'blank_package' && selectedPackages.includes('keyword_blank')) ||
                      (pkg.id === 'keyword_blank' && selectedPackages.includes('blank_package'));
                    
                    const isSelected = selectedPackages.includes(pkg.id);
                    
                    return (
                    <label 
                      key={pkg.id} 
                      className={`block p-4 border-2 rounded-lg transition-all ${
                        isDisabled
                          ? 'cursor-not-allowed opacity-50 bg-gray-100 border-gray-200'
                          : isSelected
                            ? 'cursor-pointer hover:shadow-md text-white'
                            : 'cursor-pointer hover:shadow-md border-gray-300 hover:border-gray-400 text-black'
                      }`}
                      style={isSelected && !isDisabled ? { backgroundColor: '#00A9E0', borderColor: '#00A9E0' } : {}}
                    >
                      <div className="flex items-start space-x-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => !isDisabled && handlePackageChange(pkg.id)}
                          disabled={isDisabled}
                          className="form-checkbox h-5 w-5 rounded focus:ring-blue-500 mt-1"
                          style={{ color: isDisabled ? '#D1D5DB' : '#00A9E0' }}
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className={`font-bold text-lg ${isDisabled ? 'text-gray-400' : isSelected ? 'text-white' : 'text-black'}`}>
                              {pkg.name}
                              {isDisabled && pkg.id === 'keyword_blank' && (
                                <span className="text-xs font-normal ml-2 text-gray-500">
                                  (패키지에 포함됨)
                                </span>
                              )}
                              {isDisabled && pkg.id === 'blank_package' && (
                                <span className="text-xs font-normal ml-2 text-gray-500">
                                  (키워드 선택됨)
                                </span>
                              )}
                              {pkg.price === 0 && (
                                <span className="text-xs font-normal ml-2 px-2 py-1 bg-green-100 text-green-700 rounded">
                                  무료
                                </span>
                              )}
                            </span>
                            <span className={`font-bold text-lg ${isDisabled ? 'text-gray-400' : isSelected ? 'text-white' : pkg.price === 0 ? 'text-blue-600' : 'text-green-600'}`}>
                              {pkg.price === 0 ? '무료' : `지문당 ${pkg.price}원`}
                            </span>
                          </div>
                          <p className={`text-sm mb-2 ${isDisabled ? 'text-gray-400' : isSelected ? 'text-white opacity-90' : 'text-gray-600'}`}>
                            {pkg.description}
                          </p>
                          <div className={`text-xs ${isDisabled ? 'text-gray-400' : isSelected ? 'text-white opacity-80' : 'text-gray-500'}`}>
                            포함 유형: {pkg.subTypes.join(', ')}
                          </div>
                        </div>
                      </div>
                    </label>
                    );
                  })}
                </div>
              </div>


              {/* 이메일 주소 입력 */}
              <div className="mb-6">
                <h4 className="text-lg font-medium mb-3 text-black">
                  자료 받으실 이메일 주소 <span className="text-red-500">*</span>
                </h4>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-black focus:outline-none focus:ring-4 focus:ring-blue-200 focus:border-blue-500"
                  required
                />
                <p className="text-xs text-gray-600 mt-2">
                  완성된 워크북 자료를 받으실 이메일 주소를 입력해주세요
                </p>
              </div>

            </div>

            {/* 오른쪽: 가격 미리보기 */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <h3 className="text-xl font-bold text-black mb-4">주문 미리보기</h3>
              
              {selectedPackages.length > 0 ? (
                <div className="space-y-4">
                  {/* 이메일 정보 */}
                  {email && (
                    <div className="p-3 rounded-lg border-2" style={{ backgroundColor: '#00A9E0', borderColor: '#00A9E0' }}>
                      <div className="text-white text-sm">
                        <div className="font-medium">자료 받으실 이메일</div>
                        <div className="text-xs opacity-90">{email}</div>
                      </div>
                    </div>
                  )}
                  
                  <div className="p-4 rounded-lg border border-gray-200" style={{ backgroundColor: '#F5F5F5' }}>
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-black">교재:</span>
                        <span className="font-medium text-black text-xs">{selectedTextbook}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">선택된 강:</span>
                        <span className="font-medium text-black">{selectedLessons.length}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">총 지문 수:</span>
                        <span className="font-medium text-green-600">{totalTextCount}지문</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">선택된 패키지:</span>
                        <span className="font-medium text-black">{selectedPackages.length}개</span>
                      </div>
                      
                      {/* 패키지별 세부 정보 */}
                      <div className="space-y-2">
                        <span className="text-black font-medium">패키지 세부:</span>
                        {selectedPackageDetailsPreview.map(pkg => (
                          <div key={pkg!.id} className="pl-2 border-l-2 border-blue-200">
                            <div className="flex justify-between items-center">
                              <span className="text-black text-xs">
                                {pkg!.name}
                                {pkg!.price === 0 && (
                                  <span className="ml-1 text-xs text-green-600">(무료)</span>
                                )}
                              </span>
                              <span className={`text-xs font-medium ${pkg!.price === 0 ? 'text-blue-600' : 'text-green-600'}`}>
                                {pkg!.price === 0 ? '무료' : `${pkg!.price}원 × ${totalTextCount}지문 = ${(pkg!.price * totalTextCount).toLocaleString()}원`}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      
                      <hr className="my-3 border-gray-300" />
                      
                      <div className="flex flex-col space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-black">총 지문 수:</span>
                          <span className="font-bold text-lg text-black">
                            {totalTextCount}지문
                          </span>
                        </div>
                        <div className="text-xs text-gray-600 text-right">
                          {selectedPackages.length}개 패키지 × {totalTextCount}지문
                        </div>
                      </div>
                      
                      {/* 할인 정보 표시 */}
                      {discountRatePreview > 0 && (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-black">기본 금액:</span>
                            <span className="text-gray-600 line-through">
                              {basePricePreview.toLocaleString()}원
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-green-600 font-medium">
                              🎉 {discountRatePreview}% 할인:
                            </span>
                            <span className="text-green-600 font-medium">
                              -{discountAmountPreview.toLocaleString()}원
                            </span>
                          </div>
                        </>
                      )}
                      
                      <div className="flex justify-between items-center">
                        <span className="text-black font-medium">
                          {discountRatePreview > 0 ? '할인 적용 가격:' : '총 가격:'}
                        </span>
                        <div className="text-right">
                          <div className={`font-bold text-2xl ${discountRatePreview > 0 ? 'text-green-600' : 'text-black'}`}>
                            {totalPricePreview.toLocaleString()}원
                          </div>
                          {discountRatePreview > 0 && (
                            <div className="text-xs text-green-600 font-medium">
                              {discountRatePreview}% 할인 적용됨
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 주문서 생성 버튼 */}
                  <button
                    onClick={generateOrder}
                    disabled={!email.trim()}
                    className={`w-full text-white py-4 px-6 rounded-xl font-bold text-lg shadow-lg transition-all ${
                      email.trim() 
                        ? 'hover:shadow-xl hover:opacity-90' 
                        : 'opacity-50 cursor-not-allowed'
                    }`}
                    style={{ backgroundColor: email.trim() ? '#00A9E0' : '#888B8D' }}
                  >
                    워크북 주문서 생성하기
                    {!email.trim() && (
                      <div className="text-xs mt-1 opacity-75">이메일을 입력해주세요</div>
                    )}
                  </button>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl text-gray-400">📖</span>
                  </div>
                  <p>워크북 패키지를 선택해주세요</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
};

export default WorkbookTypeSelection;
