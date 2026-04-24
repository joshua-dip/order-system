/**
 * 워크북 어법 — 양자택일 방식 [ A / B ] 인라인 이지선다형
 * Python 프로젝트15/워크북_어법.py 의 로직을 Next.js TypeScript로 이식
 */

export type WorkbookGrammarPoint = {
  /** 원문에 실제 등장하는 문자열 (치환 대상) */
  targetWord: string;
  /** 문맥상 올바른 형태 */
  correctForm: string;
  /** 오답 형태 */
  wrongForm: string;
  /** 어법 유형: 수동태/분사/부정사/관계사/시제/수일치/접속사/전치사 등 */
  grammarType: string;
  /**
   * 정답이 괄호 안에서 앞(왼쪽)에 위치하는지 뒤(오른쪽)인지.
   * '앞' → [ correctForm / wrongForm ], '뒤' → [ wrongForm / correctForm ]
   */
  answerPosition: '앞' | '뒤';
};

/** variant DB의 question_data 필드에 저장되는 워크북 어법 문항 스키마 */
export type WorkbookGrammarData = {
  Category: '워크북어법';
  /**
   * [ A / B ] 마커가 인라인으로 삽입된 지문 전체.
   * ex: "The data [ were / was ] collected carefully."
   */
  Paragraph: string;
  /** 추출된 어법 포인트 목록 (지문 등장 순서로 정렬) */
  GrammarPoints: WorkbookGrammarPoint[];
  /**
   * 학생/선생님용 정답 텍스트.
   * ex: "1) were (수일치)\n2) having studied (완료분사)"
   */
  AnswerText: string;
  /** 해설 (각 포인트별 한국어 해설) */
  Explanation: string;
};

/** Claude API 응답에서 파싱되는 단일 어법 포인트 */
export type ClaudeGrammarPoint = {
  target_word: string;
  correct_form: string;
  wrong_candidates: string[];
  grammar_type: string;
  confidence_score?: number;
};
