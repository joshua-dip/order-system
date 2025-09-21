'use client';

import { useState, useEffect } from 'react';

interface MockExamSettingsProps {
  onOrderGenerate: (orderText: string) => void;
  onBack: () => void;
}

const MockExamSettings = ({ onOrderGenerate, onBack }: MockExamSettingsProps) => {
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [selectedExams, setSelectedExams] = useState<string[]>([]);
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [questionsPerType, setQuestionsPerType] = useState<number>(2);
  const [email, setEmail] = useState<string>('');
  const [mockExamsData, setMockExamsData] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadMockExamsData = async () => {
      try {
        const mockExamData = await import('../data/mock-exams.json');
        setMockExamsData(mockExamData.default);
      } catch (error) {
        console.error('모의고사 데이터 로드 실패:', error);
        setMockExamsData({});
      } finally {
        setLoading(false);
      }
    };

    loadMockExamsData();
  }, []);

  const questionTypes = ['주제', '제목', '주장', '일치', '불일치', '빈칸', '함의'];

  // 모의고사 번호별 구성
  const examNumbers = [
    // 18번부터 40번까지 개별 번호
    ...Array.from({ length: 23 }, (_, i) => ({
      id: `${18 + i}`,
      name: `${18 + i}번`,
      questionCount: 1
    })),
    // 41~42번 (하나의 지문)
    { id: '41-42', name: '41~42번', questionCount: 1 },
    // 43~45번 (하나의 지문)  
    { id: '43-45', name: '43~45번', questionCount: 1 }
  ];

  const grades = Object.keys(mockExamsData);

  const handleExamChange = (exam: string) => {
    setSelectedExams(prev => 
      prev.includes(exam) 
        ? prev.filter(e => e !== exam)
        : [...prev, exam]
    );
  };

  const handleAllExamsToggle = () => {
    if (selectedGrade && mockExamsData[selectedGrade]) {
      const gradeExams = mockExamsData[selectedGrade];
      if (selectedExams.length === gradeExams.length) {
        setSelectedExams([]);
      } else {
        setSelectedExams([...gradeExams]);
      }
    }
  };

  const handleNumberChange = (numberId: string) => {
    setSelectedSections(prev => 
      prev.includes(numberId) 
        ? prev.filter(s => s !== numberId)
        : [...prev, numberId]
    );
  };

  const handleAllNumbersToggle = () => {
    if (selectedSections.length === examNumbers.length) {
      setSelectedSections([]);
    } else {
      setSelectedSections(examNumbers.map(number => number.id));
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
    if (!selectedGrade) {
      alert('학년을 선택해주세요.');
      return;
    }
    if (selectedExams.length === 0) {
      alert('모의고사를 선택해주세요.');
      return;
    }
    if (selectedSections.length === 0) {
      alert('문항 번호를 선택해주세요.');
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

    // 이메일 형식 검증
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      alert('올바른 이메일 주소를 입력해주세요.');
      return;
    }

    // 선택된 번호의 총 문항 수 계산 (번호 수 × 모의고사 수 × 문제 유형 수 × 유형별 문항 수)
    const totalQuestions = selectedSections.length * selectedExams.length * selectedTypes.length * questionsPerType;
    
    // 가격 계산 (퍼센트 할인 적용)
    const basePrice = totalQuestions * 80;
    let discountRate = 0;
    if (totalQuestions >= 200) {
      discountRate = 0.2; // 20% 할인
    } else if (totalQuestions >= 100) {
      discountRate = 0.1; // 10% 할인
    }
    const discountAmount = basePrice * discountRate;
    const totalPrice = basePrice - discountAmount;
    const isDiscounted = totalQuestions >= 100;

    const selectedNumberNames = selectedSections.map(numberId => 
      examNumbers.find(number => number.id === numberId)?.name
    ).join(', ');
    
    const orderText = `모의고사 주문서

자료 받으실 이메일 주소: ${email.trim()}

1. 학년/유형
: ${selectedGrade}
2. 선택된 모의고사
: ${selectedExams.join(', ')}
3. 선택된 문항 번호
: ${selectedNumberNames}
4. 문제 유형
: ${selectedTypes.join(', ')}
5. 번호별 문항 수
: ${questionsPerType}문항씩
6. 총 문항 수
: ${totalQuestions}문항
7. 가격
: ${totalPrice.toLocaleString()}원${isDiscounted ? ` (${(discountRate * 100)}% 할인 적용: -${discountAmount.toLocaleString()}원)` : ''}`;

    onOrderGenerate(orderText);
  };

  // 가격 계산 (번호 수 × 모의고사 수 × 문제 유형 수 × 유형별 문항 수)
  const totalQuestions = selectedSections.length * selectedExams.length * selectedTypes.length * questionsPerType;
  const basePrice = totalQuestions * 80;
  let discountRate = 0;
  if (totalQuestions >= 200) {
    discountRate = 0.2; // 20% 할인
  } else if (totalQuestions >= 100) {
    discountRate = 0.1; // 10% 할인
  }
  const discountAmount = basePrice * discountRate;
  const totalPrice = basePrice - discountAmount;
  const isDiscounted = totalQuestions >= 100;

  return (
    <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="container mx-auto px-4">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
            모의고사 설정
          </h1>
          <p className="text-lg" style={{ color: '#888B8D' }}>
            모의고사 구간과 문항 수를 선택해주세요
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
            <div className="flex-1 h-1 bg-blue-600 mx-4"></div>
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                2
              </div>
              <span className="text-xs mt-1 text-blue-600 font-medium">모의고사 설정</span>
            </div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto">
          {loading ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-gray-600">모의고사 데이터를 불러오는 중...</p>
            </div>
          ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* 왼쪽: 설정 */}
            <div className="bg-white rounded-xl shadow-md p-6">
              {/* 학년 선택 */}
              <div className="mb-6">
                <h4 className="text-lg font-medium text-black mb-3">학년/유형 선택</h4>
                <select
                  value={selectedGrade}
                  onChange={(e) => {
                    setSelectedGrade(e.target.value);
                    setSelectedExams([]); // 학년 변경 시 선택된 모의고사 초기화
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
              {selectedGrade && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-lg font-medium text-black">모의고사 선택</h4>
                    <button
                      onClick={handleAllExamsToggle}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        selectedExams.length === (mockExamsData[selectedGrade]?.length || 0)
                          ? 'bg-red-100 text-black hover:bg-red-200'
                          : 'bg-blue-100 text-black hover:bg-blue-200'
                      }`}
                    >
                      {selectedExams.length === (mockExamsData[selectedGrade]?.length || 0) ? '전체 해제' : '전체 선택'}
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-3">
                    <div className="space-y-2">
                      {(mockExamsData[selectedGrade] || []).map((exam) => (
                        <label 
                          key={exam} 
                          className={`flex items-center space-x-3 p-2 rounded cursor-pointer transition-all hover:bg-gray-50 ${
                            selectedExams.includes(exam) ? 'bg-blue-50' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedExams.includes(exam)}
                            onChange={() => handleExamChange(exam)}
                            className="form-checkbox h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                          />
                          <span className="text-sm text-black">{exam}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    {selectedExams.length}개 모의고사 선택됨
                  </p>
                </div>
              )}

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

              {/* 문항 번호 선택 */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-lg font-medium text-black">문항 번호 선택</h4>
                  <button
                    onClick={handleAllNumbersToggle}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      selectedSections.length === examNumbers.length
                        ? 'bg-red-100 text-black hover:bg-red-200'
                        : 'bg-blue-100 text-black hover:bg-blue-200'
                    }`}
                  >
                    {selectedSections.length === examNumbers.length ? '전체 해제' : '전체 선택'}
                  </button>
                </div>
                
                {/* 모든 문항 번호 선택 */}
                <div>
                  <h5 className="text-md font-medium text-gray-700 mb-2">문항 번호 선택</h5>
                  <div className="border border-gray-200 rounded-lg p-3 max-h-60 overflow-y-auto">
                    <div className="grid grid-cols-5 gap-2">
                      {examNumbers.map((number) => (
                        <label 
                          key={number.id} 
                          className={`flex items-center justify-center p-2 border rounded cursor-pointer transition-all hover:shadow-sm ${
                            selectedSections.includes(number.id)
                              ? 'border-blue-500 bg-blue-50 text-blue-800'
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedSections.includes(number.id)}
                            onChange={() => handleNumberChange(number.id)}
                            className="form-checkbox h-3 w-3 text-blue-600 rounded focus:ring-blue-500 mr-1"
                          />
                          <span className="text-xs text-black font-medium">{number.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
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
                    <label 
                      key={type} 
                      className={`flex items-center space-x-3 p-3 border-2 rounded-lg cursor-pointer transition-all hover:shadow-md ${
                        selectedTypes.includes(type)
                          ? 'border-blue-500 bg-blue-50 text-black'
                          : 'border-gray-300 hover:border-gray-400 text-black'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTypes.includes(type)}
                        onChange={() => handleTypeChange(type)}
                        className="form-checkbox h-5 w-5 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span className="font-medium text-black">{type}</span>
                    </label>
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

            {/* 오른쪽: 가격 미리보기 */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <h3 className="text-xl font-bold text-black mb-4">주문 미리보기</h3>
              
              {selectedGrade && selectedExams.length > 0 && selectedSections.length > 0 && selectedTypes.length > 0 ? (
                <div className="space-y-4">
                  <div className="p-4 bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-black">학년/유형:</span>
                        <span className="font-medium text-black">{selectedGrade}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">선택된 모의고사:</span>
                        <span className="font-medium text-black">{selectedExams.length}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">선택된 번호/지문:</span>
                        <span className="font-medium text-black">{selectedSections.length}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">문제 유형:</span>
                        <span className="font-medium text-black">{selectedTypes.join(', ')}</span>
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
                          {selectedSections.length}개 번호/지문 × {selectedExams.length}개 모의고사 × {selectedTypes.length}개 유형 × {questionsPerType}개 문항
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-black">기본 가격:</span>
                        <span className="font-medium text-black">
                          {totalQuestions} × 80원 = {basePrice.toLocaleString()}원
                        </span>
                      </div>
                      {isDiscounted && (
                        <div className="flex justify-between items-center">
                          <span className="text-black">할인율:</span>
                          <span className="font-medium text-green-600">
                            {(discountRate * 100)}% 할인
                          </span>
                        </div>
                      )}
                      {isDiscounted && (
                        <div className="flex justify-between items-center">
                          <span className="text-black">할인 금액:</span>
                          <span className="font-medium text-green-600">
                            -{discountAmount.toLocaleString()}원
                          </span>
                        </div>
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
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 px-6 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all"
                  >
                    모의고사 주문서 생성하기
                  </button>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl text-gray-400">📝</span>
                  </div>
                  <p>모의고사 구간을 선택해주세요</p>
                </div>
              )}
            </div>
          </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default MockExamSettings;
