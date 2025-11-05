'use client';

import { useState, useEffect } from 'react';
import AppBar from './AppBar';
import mockExamsData from '../data/mock-exams.json';

interface NumberBasedProductionProps {
  onBack: () => void;
  onOrderGenerate?: (orderText: string) => void;
}

interface MaterialItem {
  id: string;
  name: string;
  price: number;
  description: string;
}

const NumberBasedProduction = ({ onBack, onOrderGenerate }: NumberBasedProductionProps) => {
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [selectedNumbers, setSelectedNumbers] = useState<string[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [materialOrder, setMaterialOrder] = useState<string[]>([]);
  const [variantRound, setVariantRound] = useState<number>(1);
  const [email, setEmail] = useState<string>('');
  const [step, setStep] = useState<'select-exam' | 'select-numbers' | 'select-materials'>('select-exam');

  // 교재 구성 옵션
  const materials: MaterialItem[] = [
    { id: 'lecture_material', name: '강의용자료', price: 200, description: '원문과 해석 자료' },
    { id: 'class_material', name: '수업용자료', price: 200, description: '원문과 해석 자료' },
    { id: 'one_line', name: '한줄해석', price: 100, description: '한줄 해석 자료' },
    { id: 'translation_writing', name: '해석쓰기', price: 100, description: '해석 쓰기 자료' },
    { id: 'english_writing', name: '영작하기', price: 100, description: '영작 자료' },
    { id: 'workbook_blank', name: '워크북_빈칸쓰기', price: 100, description: '빈칸 쓰기 연습' },
    { id: 'workbook_word_arrangement', name: '워크북_낱말배열', price: 100, description: '낱말 배열 연습' },
    { id: 'variant_subject', name: '변형문제_주제', price: 100, description: '주제 변형 문제' },
    { id: 'variant_title', name: '변형문제_제목', price: 100, description: '제목 변형 문제' },
    { id: 'variant_claim', name: '변형문제_주장', price: 100, description: '주장 변형 문제' },
    { id: 'variant_match', name: '변형문제_일치', price: 100, description: '일치 변형 문제' },
    { id: 'variant_mismatch', name: '변형문제_불일치', price: 100, description: '불일치 변형 문제' },
    { id: 'variant_blank', name: '변형문제_빈칸', price: 100, description: '빈칸 변형 문제' },
    { id: 'variant_implication', name: '변형문제_함의', price: 100, description: '함의 변형 문제' },
    { id: 'variant_grammar', name: '변형문제_어법', price: 100, description: '어법 변형 문제' },
    { id: 'variant_order', name: '변형문제_순서', price: 100, description: '순서 변형 문제' },
    { id: 'variant_insertion', name: '변형문제_삽입', price: 100, description: '삽입 변형 문제' },
    { id: 'variant_summary', name: '변형문제_요약', price: 100, description: '요약 변형 문제' }
  ];

  // 모의고사 번호 (18번~45번)
  const examNumbers = [
    ...Array.from({ length: 23 }, (_, i) => ({
      id: `${18 + i}`,
      name: `${18 + i}번`
    })),
    { id: '41-42', name: '41~42번' },
    { id: '43-45', name: '43~45번' }
  ];

  const handleNumberChange = (numberId: string) => {
    setSelectedNumbers(prev =>
      prev.includes(numberId)
        ? prev.filter(n => n !== numberId)
        : [...prev, numberId]
    );
  };

  const handleAllNumbersToggle = () => {
    if (selectedNumbers.length === examNumbers.length) {
      setSelectedNumbers([]);
    } else {
      setSelectedNumbers(examNumbers.map(n => n.id));
    }
  };

  const handleMaterialChange = (materialId: string) => {
    setSelectedMaterials(prev => {
      if (prev.includes(materialId)) {
        // 선택 해제 시 materialOrder에서도 제거
        setMaterialOrder(currentOrder => currentOrder.filter(id => id !== materialId));
        return prev.filter(m => m !== materialId);
      } else {
        const newSelection = [...prev, materialId];
        // 선택된 교재 목록에 추가
        if (!materialOrder.includes(materialId)) {
          setMaterialOrder([...materialOrder, materialId]);
        }
        return newSelection;
      }
    });
  };

  // 변형문제 여부 확인
  const isVariantProblem = (materialId: string) => materialId.startsWith('variant_');
  
  // 선택된 교재 중 변형문제가 있는지 확인
  const hasVariantProblem = selectedMaterials.some(id => isVariantProblem(id));

  const handleAllMaterialsToggle = () => {
    if (selectedMaterials.length === materials.length) {
      setSelectedMaterials([]);
      setMaterialOrder([]);
    } else {
      setSelectedMaterials(materials.map(m => m.id));
      setMaterialOrder(materials.map(m => m.id));
    }
  };

  // 교재 순서 이동
  const moveMaterial = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...materialOrder];
    if (direction === 'up' && index > 0) {
      [newOrder[index], newOrder[index - 1]] = [newOrder[index - 1], newOrder[index]];
      setMaterialOrder(newOrder);
    } else if (direction === 'down' && index < newOrder.length - 1) {
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      setMaterialOrder(newOrder);
    }
  };

  // 드래그 앤 드롭 핸들러
  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
    
    if (dragIndex === dropIndex) return;
    
    const newOrder = [...materialOrder];
    const [draggedItem] = newOrder.splice(dragIndex, 1);
    newOrder.splice(dropIndex, 0, draggedItem);
    
    setMaterialOrder(newOrder);
  };

  // 학년 선택 시 연도 목록 업데이트
  useEffect(() => {
    if (selectedGrade) {
      const gradeKey = `${selectedGrade}모의고사` as keyof typeof mockExamsData;
      const exams = mockExamsData[gradeKey] || [];
      
      const years = Array.from(new Set(
        exams.map(exam => {
          const match = exam.match(/_(\d{4})_/);
          return match ? match[1] : '';
        }).filter(year => year !== '')
      )).sort((a, b) => Number(b) - Number(a));
      
      setAvailableYears(years);
      setSelectedYear('');
      setSelectedMonth('');
      setAvailableMonths([]);
    }
  }, [selectedGrade]);

  // 연도 선택 시 월 목록 업데이트
  useEffect(() => {
    if (selectedGrade && selectedYear) {
      const gradeKey = `${selectedGrade}모의고사` as keyof typeof mockExamsData;
      const exams = mockExamsData[gradeKey] || [];
      
      const months = exams
        .filter(exam => exam.includes(`_${selectedYear}_`))
        .map(exam => {
          const match = exam.match(/_(\d{2}월[^_]*)/);
          return match ? match[1] : '';
        })
        .filter(month => month !== '');
      
      setAvailableMonths(months);
      setSelectedMonth('');
    }
  }, [selectedGrade, selectedYear]);

  // 모의고사 선택 완료
  const handleExamComplete = () => {
    if (selectedGrade && selectedYear && selectedMonth) {
      setStep('select-numbers');
    }
  };

  // 번호 선택 완료
  const handleNumbersComplete = () => {
    if (selectedNumbers.length === 0) {
      alert('번호를 선택해주세요.');
      return;
    }
    setStep('select-materials');
  };

  // 주문서 생성
  const handleGenerate = () => {
    if (selectedMaterials.length === 0) {
      alert('교재 구성을 선택해주세요.');
      return;
    }
    if (!email.trim()) {
      alert('이메일 주소를 입력해주세요.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      alert('올바른 이메일 주소를 입력해주세요.');
      return;
    }

    const totalPrice = selectedMaterials.reduce((sum, matId) => {
      const material = materials.find(m => m.id === matId);
      return sum + (material ? material.price * selectedNumbers.length : 0);
    }, 0);

    const examName = selectedGrade && selectedYear && selectedMonth 
      ? `${selectedGrade}_${selectedYear}_${selectedMonth}`
      : '';

    const orderText = `번호별 교재 제작 주문서

자료 받으실 이메일 주소: ${email.trim()}

모의고사: ${examName}

1. 선택된 번호 (${selectedNumbers.length}개)
: ${selectedNumbers.map(n => n.includes('-') ? n : `${n}번`).join(', ')}

2. 교재 구성 (${selectedMaterials.length}개)
${materialOrder.map((matId, index) => {
  const material = materials.find(m => m.id === matId);
  if (!material) return '';
  const roundInfo = isVariantProblem(matId) ? ` (${variantRound}회차)` : '';
  return `   ${index + 1}. ${material.name}${roundInfo}
      - ${material.description}
      - 가격: ${material.price}원 × ${selectedNumbers.length}개 = ${(material.price * selectedNumbers.length).toLocaleString()}원`;
}).filter(Boolean).join('\n')}

3. 가격 계산
   기본 금액: ${totalPrice.toLocaleString()}원
   총 교재 수: ${selectedNumbers.length}개 × ${selectedMaterials.length}종류 = ${(selectedNumbers.length * selectedMaterials.length)}세트

4. 최종 금액: ${totalPrice.toLocaleString()}원

`;

    if (onOrderGenerate) {
      onOrderGenerate(orderText);
    }
  };

  return (
    <>
      <AppBar showBackButton={true} onBackClick={onBack} title="번호별 교재 제작하기" />
      <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
        <div className="container mx-auto px-4">
          {/* 헤더 */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
              번호별 교재 제작하기
            </h1>
            <p className="text-lg" style={{ color: '#888B8D' }}>
              모의고사 번호별로 맞춤 교재를 제작해드립니다
            </p>
          </div>

          <div className="max-w-6xl mx-auto space-y-8">
            {/* 모의고사 선택 */}
            {step === 'select-exam' && (
              <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-2xl font-bold mb-4" style={{ color: '#101820' }}>
                  1단계: 모의고사 선택
                </h2>
                
                {/* 학년 선택 */}
                <div className="mb-4">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    학년 선택
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {['고1', '고2', '고3'].map((grade) => (
                      <button
                        key={grade}
                        onClick={() => setSelectedGrade(grade)}
                        className={`py-3 px-4 rounded-lg font-semibold transition-all duration-200 ${
                          selectedGrade === grade
                            ? 'bg-blue-600 text-white shadow-md scale-105'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {grade}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 연도 선택 */}
                {availableYears.length > 0 && (
                  <div className="mb-4">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      연도 선택
                    </label>
                    <select
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(e.target.value)}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition-colors text-gray-900"
                    >
                      <option value="" className="text-gray-900">연도를 선택하세요</option>
                      {availableYears.map(year => (
                        <option key={year} value={year}>{year}년</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 월 선택 */}
                {availableMonths.length > 0 && (
                  <div className="mb-4">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      시험 선택
                    </label>
                    <select
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(e.target.value)}
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition-colors text-gray-900"
                    >
                      <option value="" className="text-gray-900">시험을 선택하세요</option>
                      {availableMonths.map(month => (
                        <option key={month} value={month}>{month}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 선택 완료 버튼 */}
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={handleExamComplete}
                    disabled={!selectedGrade || !selectedYear || !selectedMonth}
                    className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 ${
                      selectedGrade && selectedYear && selectedMonth
                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    선택 완료
                  </button>
                </div>
              </div>
            )}

            {/* 선택된 모의고사 표시 */}
            {step !== 'select-exam' && selectedGrade && selectedYear && selectedMonth && (
              <div className="bg-blue-50 rounded-xl shadow-md p-6 border-2 border-blue-200">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl font-bold" style={{ color: '#101820' }}>
                    선택된 모의고사
                  </h3>
                  <button
                    onClick={() => setStep('select-exam')}
                    className="px-4 py-2 bg-white text-blue-600 border-2 border-blue-600 rounded-lg font-medium text-sm hover:bg-blue-600 hover:text-white transition-colors"
                  >
                    다시 선택
                  </button>
                </div>
                <p className="text-lg font-semibold text-blue-600">
                  {selectedGrade}_{selectedYear}_{selectedMonth}
                </p>
              </div>
            )}

            {/* 번호 선택 */}
            {step !== 'select-exam' && (
              <div className="bg-white rounded-xl shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold" style={{ color: '#101820' }}>
                  2단계: 번호 선택 ({selectedNumbers.length}개)
                </h2>
                <button
                  onClick={handleAllNumbersToggle}
                  className="px-4 py-2 rounded-lg font-medium transition-colors text-sm"
                  style={{ 
                    backgroundColor: selectedNumbers.length === examNumbers.length ? '#E8F5E9' : '#E3F2FD',
                    color: selectedNumbers.length === examNumbers.length ? '#2E7D32' : '#1976D2'
                  }}
                >
                  {selectedNumbers.length === examNumbers.length ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                각 번호별로 교재 구성에 따라 교재가 제작됩니다
              </p>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                {examNumbers.map((number) => (
                  <button
                    key={number.id}
                    onClick={() => handleNumberChange(number.id)}
                    className={`py-2 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                      selectedNumbers.includes(number.id)
                        ? 'bg-blue-600 text-white shadow-md scale-105'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {number.name}
                  </button>
                ))}
              </div>
              
              {/* 선택 완료 버튼 */}
              {step === 'select-numbers' && (
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={handleNumbersComplete}
                    disabled={selectedNumbers.length === 0}
                    className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 ${
                      selectedNumbers.length > 0
                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    선택 완료 ({selectedNumbers.length}개 번호)
                  </button>
                </div>
              )}
              </div>
            )}

            {/* 선택된 번호 표시 */}
            {step !== 'select-numbers' && selectedNumbers.length > 0 && (
              <div className="bg-blue-50 rounded-xl shadow-md p-6 border-2 border-blue-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xl font-bold" style={{ color: '#101820' }}>
                    선택된 번호
                  </h3>
                  <button
                    onClick={() => setStep('select-numbers')}
                    className="px-4 py-2 bg-white text-blue-600 border-2 border-blue-600 rounded-lg font-medium text-sm hover:bg-blue-600 hover:text-white transition-colors"
                  >
                    다시 선택
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedNumbers.map((number) => (
                    <span
                      key={number}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm"
                    >
                      {number.includes('-') ? number : `${number}번`}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 교재 구성 선택 - step에 따라 표시 */}
            {step !== 'select-numbers' && (
              <>
                <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold" style={{ color: '#101820' }}>
                    3단계: 교재 구성 선택 ({selectedMaterials.length}개)
                  </h2>
                    <button
                      onClick={handleAllMaterialsToggle}
                      className="px-4 py-2 rounded-lg font-medium transition-colors text-sm"
                      style={{ 
                        backgroundColor: selectedMaterials.length === materials.length ? '#E8F5E9' : '#E3F2FD',
                        color: selectedMaterials.length === materials.length ? '#2E7D32' : '#1976D2'
                      }}
                    >
                      {selectedMaterials.length === materials.length ? '전체 해제' : '전체 선택'}
                    </button>
                  </div>
                  <p className="text-sm text-gray-600 mb-4">
                    교재 구성을 선택하세요. 순서를 조정할 수 있습니다.
                  </p>
                  <div className="space-y-3">
                    {materials.map((material) => (
                      <div
                        key={material.id}
                        className={`flex items-center justify-between p-4 rounded-lg border-2 transition-all ${
                          selectedMaterials.includes(material.id)
                            ? 'bg-blue-50 border-blue-300'
                            : 'bg-gray-50 border-gray-200'
                        }`}
                      >
                        <div className="flex items-center space-x-3 flex-1">
                          <input
                            type="checkbox"
                            checked={selectedMaterials.includes(material.id)}
                            onChange={() => handleMaterialChange(material.id)}
                            className="w-5 h-5 text-blue-600 rounded"
                          />
                          <div className="flex-1">
                            <div className="font-medium" style={{ color: '#101820' }}>
                              {material.name}
                            </div>
                            <div className="text-sm text-gray-600">{material.description}</div>
                          </div>
                        </div>
                        
                        <div className="text-right">
                          <div className="font-semibold text-blue-600">{material.price}원</div>
                          {selectedNumbers.length > 0 && (
                            <div className="text-xs text-gray-500">
                              총 {(material.price * selectedNumbers.length).toLocaleString()}원
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* 변형문제 회차 선택 */}
                  {hasVariantProblem && (
                    <div className="mt-6 p-4 bg-blue-50 border-2 border-blue-200 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-bold mb-1" style={{ color: '#101820' }}>
                            변형문제 회차 선택
                          </h3>
                          <p className="text-sm text-gray-600">
                            모든 변형문제에 동일한 회차가 적용됩니다
                          </p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-semibold text-gray-700">회차:</span>
                          <div className="flex space-x-2">
                            {[1, 2, 3].map((round) => (
                              <button
                                key={round}
                                onClick={() => setVariantRound(round)}
                                className={`w-12 h-12 rounded-lg font-bold text-lg transition-all ${
                                  variantRound === round
                                    ? 'bg-blue-600 text-white shadow-lg scale-110'
                                    : 'bg-white text-gray-700 hover:bg-gray-100 border-2 border-gray-300'
                                }`}
                              >
                                {round}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 교재 순서 조정 */}
                {materialOrder.length > 0 && (
                  <div className="bg-white rounded-xl shadow-md p-6">
                    <h2 className="text-2xl font-bold mb-4" style={{ color: '#101820' }}>
                      교재 구성 순서
                    </h2>
                    <p className="text-sm text-gray-600 mb-4">
                      드래그하여 순서를 변경하거나 화살표 버튼을 사용하세요
                    </p>
                    <div className="space-y-2">
                      {materialOrder.map((matId, index) => {
                        const material = materials.find(m => m.id === matId);
                        if (!material) return null;
                        return (
                          <div
                            key={material.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, index)}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, index)}
                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 cursor-move hover:bg-gray-100 hover:border-blue-300 transition-all"
                          >
                            <div className="flex items-center space-x-3 flex-1">
                              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                              </svg>
                              <span className="w-8 h-8 flex items-center justify-center bg-blue-600 text-white rounded-full font-semibold text-sm">
                                {index + 1}
                              </span>
                              <span className="font-medium" style={{ color: '#101820' }}>
                                {material.name}
                              </span>
                              {isVariantProblem(material.id) && (
                                <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold">
                                  {variantRound}회차
                                </span>
                              )}
                            </div>
                            <div className="flex space-x-1">
                              <button
                                onClick={() => moveMaterial(index, 'up')}
                                disabled={index === 0}
                                className={`p-2 rounded ${
                                  index === 0
                                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                    : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                                }`}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                </svg>
                              </button>
                              <button
                                onClick={() => moveMaterial(index, 'down')}
                                disabled={index === materialOrder.length - 1}
                                className={`p-2 rounded ${
                                  index === materialOrder.length - 1
                                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                    : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                                }`}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 이메일 입력 */}
                <div className="bg-white rounded-xl shadow-md p-6">
                  <h2 className="text-2xl font-bold mb-4" style={{ color: '#101820' }}>
                    이메일 주소
                  </h2>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="자료를 받으실 이메일 주소를 입력해주세요"
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition-colors"
                  />
                </div>

                {/* 주문 버튼 */}
                <div className="flex justify-center gap-4 pb-8">
                  <button
                    onClick={onBack}
                    className="px-8 py-4 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors font-semibold"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleGenerate}
                    className="px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-md hover:shadow-lg"
                  >
                    주문서 생성
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default NumberBasedProduction;
