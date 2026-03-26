'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AppBar from './AppBar';
import { useTextbooksData } from '@/lib/useTextbooksData';
import type { OrderGenerateExtras } from './MockExamSettings';

interface WorkbookTypeSelectionProps {
  selectedTextbook: string;
  selectedLessons: string[];
  onOrderGenerate: (orderText: string, orderPrefix?: string, extras?: OrderGenerateExtras) => void;
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
  const { data: convertedData, loading: dataLoading, error: dataError } = useTextbooksData();
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [email, setEmail] = useState<string>('');
  const [totalTextCount, setTotalTextCount] = useState<number>(0);
  const [useCustomHwp, setUseCustomHwp] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [myFormatApproved, setMyFormatApproved] = useState(false);
  const [formatCounts, setFormatCounts] = useState({ 강의용자료: 0, 수업용자료: 0, 변형문제: 0 });
  const [loadingLatestOptions, setLoadingLatestOptions] = useState(false);

  const isMockExam = selectedTextbook.startsWith('고1_') || selectedTextbook.startsWith('고2_') || selectedTextbook.startsWith('고3_');

  const refreshMyFormats = useCallback(() => {
    fetch('/api/my/my-format-upload', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const bt = d.byType || {};
        setFormatCounts({
          강의용자료: Array.isArray(bt.강의용자료) ? bt.강의용자료.length : 0,
          수업용자료: Array.isArray(bt.수업용자료) ? bt.수업용자료.length : 0,
          변형문제: Array.isArray(bt.변형문제) ? bt.변형문제.length : 0,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const u = d?.user;
        setIsMember(!!u && u.role !== 'admin');
        setMyFormatApproved(!!u?.myFormatApproved);
        if (u?.myFormatApproved) refreshMyFormats();
      })
      .catch(() => setIsMember(false));
  }, [refreshMyFormats]);

  const needsLectureHwp = selectedPackages.includes('lecture_material');
  const needsVariantHwp = selectedPackages.some((p) =>
    [
      'blank_package',
      'keyword_blank',
      'word_arrangement',
      'workbook_grammar_either_or',
      'one_line_interpretation',
    ].includes(p)
  );

  const loadLatestOrderOptions = async () => {
    setLoadingLatestOptions(true);
    try {
      const res = await fetch('/api/my/latest-order-options?flow=workbook', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '불러오기에 실패했습니다.');
        return;
      }
      const m = data.orderMeta as Record<string, unknown> | null;
      if (!m || m.flow !== 'workbook') {
        alert('저장된 최근 워크북 주문 옵션이 없습니다.');
        return;
      }
      if (typeof m.isMockExam === 'boolean' && m.isMockExam !== isMockExam) {
        if (!confirm('저장된 주문은 다른 교재 유형(모의고사/부교재)입니다. 패키지·이메일만 적용할까요?')) return;
      }
      if (Array.isArray(m.selectedPackages) && m.selectedPackages.length > 0) {
        setSelectedPackages(m.selectedPackages.filter((x): x is string => typeof x === 'string'));
      }
      if (typeof m.email === 'string' && m.email.trim()) setEmail(m.email.trim());
      if (typeof m.useCustomHwp === 'boolean') setUseCustomHwp(m.useCustomHwp);
      alert('최근 워크북 주문 옵션을 불러왔습니다.');
    } finally {
      setLoadingLatestOptions(false);
    }
  };

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
      id: 'workbook_grammar_either_or',
      name: '워크북_어법_양자택일',
      description: '어법 양자택일(두 보기 중 선택) 연습',
      price: 100,
      subTypes: ['어법양자택일']
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

  useEffect(() => {
    if (!convertedData) return;
    const calculateTextCount = async () => {
      try {
        if (isMockExam) {
          setTotalTextCount(selectedLessons.length);
        } else {
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
  }, [selectedTextbook, selectedLessons, isMockExam, convertedData]);

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

    if (useCustomHwp) {
      if (!myFormatApproved) {
        alert(
          '직접 쓰시는 HWP 양식으로도 제작 가능합니다.\n내정보 → 나의양식에서 해당 유형을 올리고 승인되면, 주문에서 맞춤 양식을 선택하실 수 있어요.'
        );
        return;
      }
      if (needsLectureHwp && (formatCounts.강의용자료 < 1 || formatCounts.수업용자료 < 1)) {
        alert(
          '강의용자료/수업용자료 패키지를 선택하셨습니다.\n내정보 → 나의양식에서 강의용·수업용 hwp를 각각 업로드한 뒤 다시 주문해 주세요.'
        );
        return;
      }
      if (needsVariantHwp && formatCounts.변형문제 < 1) {
        alert(
          '선택하신 워크북 유형은 변형문제 양식이 필요합니다.\n내정보 → 나의양식에서 「변형문제」 hwp를 업로드한 뒤 다시 주문해 주세요.'
        );
        return;
      }
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

${useCustomHwp ? `
6. 커스텀 HWP 양식 사용
   회원 나의양식에 등록한 양식 적용 요청
   - 강의용자료 업로드: ${formatCounts.강의용자료}건
   - 수업용자료 업로드: ${formatCounts.수업용자료}건
   - 변형문제 양식 업로드: ${formatCounts.변형문제}건
` : ''}
`;

    const orderMeta = {
      flow: 'workbook',
      version: 1,
      selectedTextbook,
      selectedLessons,
      selectedPackages,
      email: email.trim(),
      useCustomHwp,
      isMockExam,
    };
    onOrderGenerate(orderText, isMockExam ? 'MW' : 'BW', { orderMeta });
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

  if (dataLoading) {
    return (
      <>
        <AppBar showBackButton={true} onBackClick={onBack} title="워크북 유형 선택" />
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F5F5' }}>
          <p className="text-gray-600">교재 데이터를 불러오는 중...</p>
        </div>
      </>
    );
  }
  if (dataError || !convertedData) {
    return (
      <>
        <AppBar showBackButton={true} onBackClick={onBack} title="워크북 유형 선택" />
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F5F5' }}>
          <p className="text-red-600">데이터를 불러올 수 없습니다.</p>
        </div>
      </>
    );
  }

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
              {isMember && myFormatApproved && (
                <div className="mb-6 p-4 rounded-xl border-2 border-[#0ea5e9] bg-sky-50">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                    <span className="font-bold text-[#0c4a6e]">커스텀 HWP 양식 사용</span>
                    <div className="flex rounded-lg border border-amber-400 bg-white overflow-hidden text-xs font-bold">
                      <button
                        type="button"
                        onClick={() => setUseCustomHwp(false)}
                        className={`px-3 py-2 ${!useCustomHwp ? 'bg-slate-600 text-white' : 'text-gray-600 hover:bg-slate-100'}`}
                      >
                        사용 안 함
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setUseCustomHwp(true);
                          refreshMyFormats();
                        }}
                        className={`px-3 py-2 border-l border-amber-400 ${useCustomHwp ? 'bg-[#0284c7] text-white' : 'text-gray-600 hover:bg-sky-100'}`}
                      >
                        사용
                      </button>
                    </div>
                  </div>
                  {useCustomHwp && (
                    <div className="text-sm text-[#0f172a] space-y-2">
                      <p className="text-[13px] text-[#334155]">
                        내정보 → <strong>나의양식</strong>에 올린 hwp/hwpx로 맞춤 제작 요청합니다.
                      </p>
                      <ul className="text-[12px] text-[#475569] list-disc list-inside">
                        <li>강의용·수업용 패키지 선택 시 → 강의용·수업용 각각 업로드 필요</li>
                        <li>빈칸·낱말배열·한줄해석 등 선택 시 → <strong>변형문제</strong> 양식 업로드 필요</li>
                      </ul>
                      <div className="flex flex-wrap gap-3 text-[12px]">
                        <span>강의용 {formatCounts.강의용자료}건</span>
                        <span>수업용 {formatCounts.수업용자료}건</span>
                        <span>변형문제 {formatCounts.변형문제}건</span>
                        <Link href="/my" className="text-[#2563eb] font-semibold underline">
                          나의양식에서 업로드 →
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {isMember && !myFormatApproved && (
                <div className="mb-6 p-4 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50/80 border border-amber-200/90 text-[13px] text-amber-950 leading-relaxed shadow-sm">
                  <p className="font-bold text-amber-900 mb-2 flex items-center gap-1.5">
                    <span aria-hidden>✨</span> 직접 쓰시는 HWP 양식으로도 워크북을 맞춤 제작해 드려요
                  </p>
                  <p className="text-amber-900/95 mb-2">
                    강의용·수업용·변형문제 등, 평소 쓰시는 양식이 있으시면 그 레이아웃에 맞춰 드릴 수 있어서 활용도가 높습니다.
                  </p>
                  <p className="text-amber-900/90 text-[12px]">
                    <Link href="/my" className="font-bold text-[#b45309] underline underline-offset-2 hover:text-amber-950">
                      내정보 → 나의양식
                    </Link>
                    에서 패키지에 맞는 유형별 hwp/hwpx를 올려 주시면, 확인 후 주문 시 <strong>「사용」</strong>으로 선택하실 수 있어요. 준비 중이시면 표준 양식으로도 편하게 이용하실 수 있습니다.
                  </p>
                </div>
              )}
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
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h4 className="text-lg font-medium text-black">워크북 패키지</h4>
                  <div className="flex flex-wrap items-center gap-2">
                    {isMember && (
                      <button
                        type="button"
                        onClick={loadLatestOrderOptions}
                        disabled={loadingLatestOptions}
                        className="px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-[#e0f2fe] text-[#0369a1] border border-[#7dd3fc] hover:bg-[#bae6fd] disabled:opacity-60"
                      >
                        {loadingLatestOptions ? '불러오는 중…' : '📥 최신 주문 옵션'}
                      </button>
                    )}
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
                </div>
                {isMember && (
                  <p className="text-[11px] text-gray-500 mb-3">회원 · 직전 워크북 주문의 패키지·이메일·커스텀 HWP 여부를 불러옵니다</p>
                )}
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
              <h3 className="text-xl font-bold text-black mb-3">주문 미리보기</h3>

              {/* 나의양식(HWP) 사용 여부 — 미리보기에서도 바로 확인 */}
              {isMember ? (
                <div
                  className={`mb-4 p-3 rounded-xl border-2 ${
                    myFormatApproved
                      ? useCustomHwp
                        ? 'border-sky-400 bg-sky-50'
                        : 'border-slate-200 bg-slate-50'
                      : 'border-amber-200 bg-amber-50'
                  }`}
                >
                  <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                    나의양식 (HWP)
                  </div>
                  {myFormatApproved ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={`text-sm font-bold ${
                          useCustomHwp ? 'text-sky-800' : 'text-slate-700'
                        }`}
                      >
                        {useCustomHwp
                          ? '✓ 커스텀 양식 사용 (업로드 hwp/hwpx로 제작)'
                          : '○ 기본 양식 (표준 레이아웃)'}
                      </span>
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded-lg shrink-0 ${
                          useCustomHwp ? 'bg-sky-600 text-white' : 'bg-slate-500 text-white'
                        }`}
                      >
                        {useCustomHwp ? 'HWP 사용' : 'HWP 미사용'}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-amber-900 leading-snug">
                      <span className="font-semibold">맞춤 HWP</span>는 나의양식에 올려 주시면 이후부터 선택 가능해요.
                      <span className="block mt-1 text-[12px] text-amber-800/95">지금 주문은 표준 양식으로 진행됩니다.</span>
                    </p>
                  )}
                </div>
              ) : (
                <div className="mb-4 p-3 rounded-xl border border-gray-200 bg-gray-50">
                  <div className="text-[11px] font-bold text-gray-500 mb-1">나의양식 (HWP)</div>
                  <p className="text-sm text-gray-700">비회원 주문 · 기본 양식으로 제작됩니다</p>
                </div>
              )}
              
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
                      <div className="flex justify-between items-center gap-2 pt-1 border-t border-dashed border-gray-300">
                        <span className="text-black">나의양식(HWP):</span>
                        <span className="font-semibold text-right text-sm">
                          {!isMember ? (
                            <span className="text-gray-600">기본 양식</span>
                          ) : !myFormatApproved ? (
                            <span className="text-amber-800">표준 (맞춤은 업로드 후)</span>
                          ) : useCustomHwp ? (
                            <span className="text-sky-700">커스텀 사용</span>
                          ) : (
                            <span className="text-slate-600">기본 양식</span>
                          )}
                        </span>
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
