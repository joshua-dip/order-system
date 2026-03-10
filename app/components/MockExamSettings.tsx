'use client';

import { useState, useEffect } from 'react';
import AppBar from './AppBar';

interface MockExamSettingsProps {
  onOrderGenerate: (orderText: string, orderPrefix?: string) => void;
  onBack: () => void;
}

// 개별 모의고사 선택 항목
interface ExamSelection {
  id: string;
  grade: string;
  exam: string;
  numbers: string[];
}

const MockExamSettings = ({ onOrderGenerate, onBack }: MockExamSettingsProps) => {
  const [examSelections, setExamSelections] = useState<ExamSelection[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [questionsPerType, setQuestionsPerType] = useState<number>(2);
  const [email, setEmail] = useState<string>('');
  const [mockExamsData, setMockExamsData] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [questionSamples, setQuestionSamples] = useState<Record<string, {blogUrl: string, description: string, sampleTitle: string}>>({});

  // 새 모의고사 추가를 위한 임시 상태
  const [tempGrade, setTempGrade] = useState<string>('');
  const [tempExam, setTempExam] = useState<string>('');
  const [tempNumbers, setTempNumbers] = useState<string[]>([]);

  useEffect(() => {
    const loadMockExamsData = async () => {
      try {
        const mockExamData = await import('../data/mock-exams.json');
        setMockExamsData(mockExamData.default);
        
        const samplesData = await import('../data/question-samples.json');
        setQuestionSamples(samplesData.default);
      } catch (error) {
        console.error('데이터 로드 실패:', error);
        setMockExamsData({});
        setQuestionSamples({});
      } finally {
        setLoading(false);
      }
    };

    loadMockExamsData();
  }, []);

  const questionTypes = ['주제', '제목', '주장', '일치', '불일치', '빈칸', '함의', '어법', '순서', '삽입', '요약'];

  // 모의고사 번호별 구성
  const examNumbers = [
    ...Array.from({ length: 23 }, (_, i) => ({
      id: `${18 + i}`,
      name: `${18 + i}번`,
      questionCount: 1
    })),
    { id: '41-42', name: '41~42번', questionCount: 1 },
    { id: '43-45', name: '43~45번', questionCount: 1 }
  ];

  const grades = Object.keys(mockExamsData);

  // 모의고사 추가
  const handleAddExam = () => {
    if (!tempGrade) {
      alert('학년을 선택해주세요.');
      return;
    }
    if (!tempExam) {
      alert('모의고사를 선택해주세요.');
      return;
    }
    if (tempNumbers.length === 0) {
      alert('문항 번호를 선택해주세요.');
      return;
    }

    const newExam: ExamSelection = {
      id: `${Date.now()}`,
      grade: tempGrade,
      exam: tempExam,
      numbers: [...tempNumbers]
    };

    setExamSelections([...examSelections, newExam]);
    
    // 임시 상태 초기화
    setTempGrade('');
    setTempExam('');
    setTempNumbers([]);
  };

  // 모의고사 삭제
  const handleRemoveExam = (id: string) => {
    setExamSelections(examSelections.filter(exam => exam.id !== id));
  };

  const handleTempNumberChange = (numberId: string) => {
    setTempNumbers(prev => 
      prev.includes(numberId) 
        ? prev.filter(n => n !== numberId)
        : [...prev, numberId]
    );
  };

  const handleAllTempNumbersToggle = () => {
    if (tempNumbers.length === examNumbers.length) {
      setTempNumbers([]);
    } else {
      setTempNumbers(examNumbers.map(number => number.id));
    }
  };

  const handleTypeChange = (type: string) => {
    setSelectedTypes(prev => 
      prev.includes(type) 
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  const handleAllTypesToggle = () => {
    if (selectedTypes.length === questionTypes.length) {
      setSelectedTypes([]);
    } else {
      setSelectedTypes([...questionTypes]);
    }
  };

  const generateOrder = () => {
    if (examSelections.length === 0) {
      alert('모의고사를 추가해주세요.');
      return;
    }
    if (selectedTypes.length === 0) {
      alert('문제 유형을 선택해주세요.');
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

    // 총 문항 수 계산
    const totalNumberCount = examSelections.reduce((sum, exam) => sum + exam.numbers.length, 0);
    const totalQuestions = totalNumberCount * selectedTypes.length * questionsPerType;
    
    // 가격 계산
    const basePrice = totalQuestions * 80;
    let discountRate = 0;
    if (totalQuestions >= 200) {
      discountRate = 0.2;
    } else if (totalQuestions >= 100) {
      discountRate = 0.1;
    }
    const discountAmount = basePrice * discountRate;
    const totalPrice = basePrice - discountAmount;
    const isDiscounted = totalQuestions >= 100;

    // 모의고사별 상세 정보
    const examDetails = examSelections.map((exam, index) => {
      const selectedNumberNames = exam.numbers.map(numberId => 
        examNumbers.find(number => number.id === numberId)?.name
      ).join(', ');
      
      return `${index + 1}. ${exam.exam}
   - 선택된 문항: ${selectedNumberNames}`;
    }).join('\n');
    
    const orderText = `모의고사 주문서

자료 받으실 이메일 주소: ${email.trim()}

1. 선택된 모의고사 (${examSelections.length}개)
${examDetails}

2. 문제 유형
: ${selectedTypes.join(', ')}

3. 번호별 문항 수
: ${questionsPerType}문항씩

4. 총 문항 수
: ${totalQuestions}문항 (총 ${totalNumberCount}개 번호 × ${selectedTypes.length}개 유형 × ${questionsPerType}문항)

5. 가격
: ${totalPrice.toLocaleString()}원${isDiscounted ? ` (${(discountRate * 100)}% 할인 적용: -${discountAmount.toLocaleString()}원)` : ''}`;

    onOrderGenerate(orderText, 'MV');
  };

  // 가격 계산 (미리보기용)
  const totalNumberCount = examSelections.reduce((sum, exam) => sum + exam.numbers.length, 0);
  const totalQuestions = totalNumberCount * selectedTypes.length * questionsPerType;
  const basePrice = totalQuestions * 80;
  let discountRate = 0;
  if (totalQuestions >= 200) {
    discountRate = 0.2;
  } else if (totalQuestions >= 100) {
    discountRate = 0.1;
  }
  const discountAmount = basePrice * discountRate;
  const totalPrice = basePrice - discountAmount;
  const isDiscounted = totalQuestions >= 100;

  return (
    <>
      <AppBar 
        showBackButton={true} 
        onBackClick={onBack}
        title="모의고사 변형문제 설정"
      />
      <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="container mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
            모의고사 설정
          </h1>
          <p className="text-lg" style={{ color: '#888B8D' }}>
            여러 모의고사를 조합해서 주문할 수 있습니다
          </p>
        </div>

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
            <div className="flex-1 h-1 bg-blue-600 mx-4"></div>
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                2
              </div>
              <span className="text-xs mt-1 text-blue-600 font-medium">모의고사 설정</span>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto">
          {loading ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-gray-600">모의고사 데이터를 불러오는 중...</p>
            </div>
          ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* 왼쪽: 모의고사 추가 */}
            <div className="lg:col-span-2 space-y-6">
              {/* 추가된 모의고사 목록 */}
              {examSelections.length > 0 && (
                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-black">선택된 모의고사 ({examSelections.length}개)</h3>
                    <button
                      onClick={() => setExamSelections([])}
                      className="px-3 py-1 bg-red-100 text-red-600 rounded-lg text-sm hover:bg-red-200 transition-colors"
                    >
                      전체 삭제
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    {examSelections.map((exam) => (
                      <div key={exam.id} className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="font-bold text-blue-900 mb-2">{exam.exam}</div>
                            <div className="text-sm text-blue-700">
                              선택 번호: {exam.numbers.map(numberId => 
                                examNumbers.find(n => n.id === numberId)?.name
                              ).join(', ')}
                              <span className="ml-2 font-medium">({exam.numbers.length}개)</span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveExam(exam.id)}
                            className="ml-4 px-3 py-1 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 transition-colors"
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 새 모의고사 추가 */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h3 className="text-xl font-bold text-black mb-4">모의고사 추가하기</h3>
                
                {/* 학년 선택 */}
                <div className="mb-4">
                  <h4 className="text-lg font-medium text-black mb-3">학년/유형 선택</h4>
                  <select
                    value={tempGrade}
                    onChange={(e) => {
                      setTempGrade(e.target.value);
                      setTempExam('');
                    }}
                    className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-lg text-black focus:outline-none focus:ring-4 focus:ring-blue-200 focus:border-blue-500"
                  >
                    <option value="">학년을 선택해주세요</option>
                    {grades.map((grade) => (
                      <option key={grade} value={grade}>
                        {grade}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 모의고사 선택 */}
                {tempGrade && (
                  <div className="mb-4">
                    <h4 className="text-lg font-medium text-black mb-3">모의고사 선택</h4>
                    <select
                      value={tempExam}
                      onChange={(e) => setTempExam(e.target.value)}
                      className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-lg text-black focus:outline-none focus:ring-4 focus:ring-blue-200 focus:border-blue-500"
                    >
                      <option value="">모의고사를 선택해주세요</option>
                      {(mockExamsData[tempGrade] || []).map((exam) => (
                        <option key={exam} value={exam}>
                          {exam}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 문항 번호 선택 */}
                {tempExam && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-lg font-medium text-black">문항 번호 선택</h4>
                      <button
                        onClick={handleAllTempNumbersToggle}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          tempNumbers.length === examNumbers.length
                            ? 'bg-red-100 text-black hover:bg-red-200'
                            : 'bg-blue-100 text-black hover:bg-blue-200'
                        }`}
                      >
                        {tempNumbers.length === examNumbers.length ? '전체 해제' : '전체 선택'}
                      </button>
                    </div>
                    
                    <div className="border border-gray-200 rounded-lg p-3 max-h-60 overflow-y-auto">
                      <div className="grid grid-cols-5 gap-2">
                        {examNumbers.map((number) => (
                          <label 
                            key={number.id} 
                            className={`flex items-center justify-center p-2 border rounded cursor-pointer transition-all hover:shadow-sm ${
                              tempNumbers.includes(number.id)
                                ? 'border-blue-500 bg-blue-50 text-blue-800'
                                : 'border-gray-300 hover:border-gray-400'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={tempNumbers.includes(number.id)}
                              onChange={() => handleTempNumberChange(number.id)}
                              className="form-checkbox h-3 w-3 text-blue-600 rounded focus:ring-blue-500 mr-1"
                            />
                            <span className="text-xs text-black font-medium">{number.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 추가 버튼 */}
                <button
                  onClick={handleAddExam}
                  disabled={!tempGrade || !tempExam || tempNumbers.length === 0}
                  className={`w-full py-3 rounded-lg font-bold text-lg transition-all ${
                    tempGrade && tempExam && tempNumbers.length > 0
                      ? 'bg-green-600 hover:bg-green-700 text-white shadow-lg hover:shadow-xl'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  모의고사 추가하기 {tempNumbers.length > 0 && `(${tempNumbers.length}개 번호)`}
                </button>
              </div>

              {/* 문제 유형 및 개수 선택 */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h3 className="text-xl font-bold text-black mb-4">문제 유형 및 개수</h3>
                
                {/* 할인 정보 */}
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center mb-2">
                    <span className="text-blue-600 font-semibold">💰 할인 안내</span>
                  </div>
                  <div className="text-sm text-blue-700">
                    • 기본: 문항당 80원<br/>
                    • 100문항 이상: <span className="font-medium text-green-600">10% 할인</span><br/>
                    • 200문항 이상: <span className="font-medium text-green-600">20% 할인</span>
                  </div>
                </div>

                {/* 문제 유형 선택 */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-lg font-medium text-black">문제 유형 선택</h4>
                    <button
                      onClick={handleAllTypesToggle}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        selectedTypes.length === questionTypes.length
                          ? 'bg-red-100 text-black hover:bg-red-200'
                          : 'bg-blue-100 text-black hover:bg-blue-200'
                      }`}
                    >
                      {selectedTypes.length === questionTypes.length ? '전체 해제' : '전체 선택'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {questionTypes.map((type) => (
                      <div 
                        key={type} 
                        className={`p-3 border-2 rounded-lg transition-all hover:shadow-md ${
                          selectedTypes.includes(type)
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <label className="flex items-center space-x-3 cursor-pointer flex-1">
                            <input
                              type="checkbox"
                              checked={selectedTypes.includes(type)}
                              onChange={() => handleTypeChange(type)}
                              className="form-checkbox h-5 w-5 text-blue-600 rounded focus:ring-blue-500"
                            />
                            <span className="font-medium text-black">{type}</span>
                          </label>
                          
                          {questionSamples[type] && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(questionSamples[type].blogUrl, '_blank');
                              }}
                              className="ml-2 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-600 hover:text-gray-800 transition-all duration-200"
                              title={`${questionSamples[type].sampleTitle} - 블로그에서 샘플 확인`}
                            >
                              📝
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 문제 개수 설정 */}
                <div className="mb-6">
                  <h4 className="text-lg font-medium mb-3 text-black">번호별 문제 개수</h4>
                  <div className="flex items-center space-x-4">
                    <select
                      value={questionsPerType}
                      onChange={(e) => setQuestionsPerType(Number(e.target.value))}
                      className="border-2 border-gray-300 rounded-lg px-4 py-3 text-lg text-black focus:outline-none focus:ring-4 focus:ring-blue-200 focus:border-blue-500"
                    >
                      <option value={1}>1개</option>
                      <option value={2}>2개</option>
                      <option value={3}>3개</option>
                    </select>
                    <span className="text-black text-lg">문항씩</span>
                  </div>
                  <p className="text-sm text-black mt-2">
                    각 번호/지문별로 <strong>{questionsPerType}개</strong>의 문항이 출제됩니다
                  </p>
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
                    완성된 모의고사 자료를 받으실 이메일 주소를 입력해주세요
                  </p>
                </div>
              </div>
            </div>

            {/* 오른쪽: 가격 미리보기 */}
            <div className="bg-white rounded-xl shadow-md p-6 h-fit sticky top-4">
              <h3 className="text-xl font-bold text-black mb-4">주문 미리보기</h3>
              
              {examSelections.length > 0 && selectedTypes.length > 0 ? (
                <div className="space-y-4">
                  <div className="p-4 bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-black">선택된 모의고사:</span>
                        <span className="font-medium text-black">{examSelections.length}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">총 번호/지문:</span>
                        <span className="font-medium text-black">{totalNumberCount}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">문제 유형:</span>
                        <span className="font-medium text-black">{selectedTypes.length}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">번호별 문항 수:</span>
                        <span className="font-medium text-black">{questionsPerType}개</span>
                      </div>
                      <hr className="my-3 border-gray-300" />
                      <div className="flex flex-col space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-black">총 문항 수:</span>
                          <span className="font-bold text-lg text-black">
                            {totalQuestions}개
                          </span>
                        </div>
                        <div className="text-xs text-gray-600 text-right">
                          {totalNumberCount}개 번호 × {selectedTypes.length}개 유형 × {questionsPerType}개 문항
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-black">기본 가격:</span>
                        <span className="font-medium text-black">
                          {totalQuestions} × 80원 = {basePrice.toLocaleString()}원
                        </span>
                      </div>
                      {isDiscounted && (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-black">할인율:</span>
                            <span className="font-medium text-green-600">
                              {(discountRate * 100)}% 할인
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-black">할인 금액:</span>
                            <span className="font-medium text-green-600">
                              -{discountAmount.toLocaleString()}원
                            </span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="text-black">총 가격:</span>
                        <div className="text-right">
                          {isDiscounted ? (
                            <>
                              <div className="line-through text-gray-400 text-sm">
                                {basePrice.toLocaleString()}원
                              </div>
                              <div className="font-bold text-2xl text-red-600">
                                {totalPrice.toLocaleString()}원 
                                <span className="text-green-600 text-sm ml-2">
                                  ({(discountRate * 100)}% 할인)
                                </span>
                              </div>
                            </>
                          ) : (
                            <div className="font-bold text-2xl text-black">
                              {totalPrice.toLocaleString()}원
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
                    className={`w-full py-4 px-6 rounded-xl font-bold text-lg shadow-lg transition-all ${
                      email.trim()
                        ? 'bg-blue-600 hover:bg-blue-700 text-white hover:shadow-xl'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    모의고사 주문서 생성하기
                    {!email.trim() && (
                      <div className="text-xs mt-1 font-normal opacity-75">이메일을 입력해주세요</div>
                    )}
                  </button>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl text-gray-400">📝</span>
                  </div>
                  <p className="text-sm">
                    {examSelections.length === 0 
                      ? '모의고사를 추가해주세요' 
                      : '문제 유형을 선택해주세요'}
                  </p>
                </div>
              )}
            </div>
          </div>
          )}
        </div>

      </div>
    </div>
    </>
  );
};

export default MockExamSettings;
