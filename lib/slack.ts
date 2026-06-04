/**
 * Slack Incoming Webhook으로 메시지 전송
 * SLACK_WEBHOOK_URL이 설정된 경우에만 동작합니다.
 */
const SLACK_MAX_TEXT = 3000;

export async function notifySlack(message: string): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url || url.trim() === '') return false;

  const text =
    message.length > SLACK_MAX_TEXT
      ? message.slice(0, SLACK_MAX_TEXT) + '\n… (일부 생략)'
      : message;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** orderMeta.flow → 슬랙 알림용 한글 라벨 (관리자 화면과 동일 기준) */
const ORDER_FLOW_LABELS: Record<string, string> = {
  bookVariant: '부교재 변형문제',
  mockVariant: '모의고사 변형문제',
  unifiedVariant: '파이널 예비 모의',
  numberBased: '번호별 교재 변형문제',
  workbook: '워크북',
  bookBundle: '통합(번들)',
  vocabulary: '단어장',
};

function orderFlowLabel(flow: string | null | undefined): string {
  const f = flow != null && String(flow).trim() !== '' ? String(flow).trim() : '';
  if (!f) return '주문';
  return ORDER_FLOW_LABELS[f] ?? f;
}

export async function notifySlackOrder(input: {
  orderText: string;
  orderId: string;
  orderNumber?: string;
  flow?: string | null;
  loginId?: string | null;
  userName?: string | null;
  pointsUsed?: number;
}): Promise<boolean> {
  const preview = input.orderText.slice(0, 1500).replace(/`/g, "'");
  const label = orderFlowLabel(input.flow);
  const who = input.loginId
    ? `${input.userName?.trim() || input.loginId} (회원)`
    : '비회원';

  const header = [`🛒 *새 주문 · ${label}* (gomijoshua)`];
  if (input.orderNumber) header.push(`주문번호: \`${input.orderNumber}\``);
  header.push(`주문자: ${who}`);
  if (input.pointsUsed && input.pointsUsed > 0) {
    header.push(`포인트 사용: ${input.pointsUsed.toLocaleString()}P`);
  }
  header.push(`ID: \`${input.orderId}\``);

  const message = `${header.join('\n')}\n\n${preview}${input.orderText.length > 1500 ? '\n…' : ''}`;
  return notifySlack(message);
}

export async function notifySlackMembershipApplication(input: {
  applicantTypeLabel: string;
  name: string;
  phone: string;
  appliedAt: Date;
  adminUrl?: string;
}): Promise<boolean> {
  const appliedAt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(input.appliedAt);
  const adminLink = input.adminUrl?.trim();
  const lines = [
    '🆕 *새 가입 신청* (gomijoshua)',
    `유형: ${input.applicantTypeLabel}`,
    `이름: ${input.name}`,
    `전화: ${input.phone}`,
    `신청: ${appliedAt} (KST)`,
  ];
  if (adminLink) lines.push(`<${adminLink}|관리자에서 보기>`);
  return notifySlack(lines.join('\n'));
}

/**
 * Q&A 분석 페이지에 새 질문이 작성됐을 때 Slack 알림.
 *
 * - `question` 은 120자로 truncate (긴 질문이 채널을 잡아먹지 않도록).
 * - `deepUrl` 은 `${origin}/qna/[passageId]#thread-<id>` 형태 — 한 클릭에 답변 위치.
 * - `sentenceIndex` 가 -1 이면 「지문 전체」, 그 외엔 「N번 문장」 (1-based).
 * - `SLACK_WEBHOOK_URL` 미설정 시 silent skip.
 */
export async function notifySlackQnaQuestion(input: {
  threadId: string;
  textbook: string;
  sourceKey?: string;
  /** 0-based 인덱스. -1 = 지문 전체. 화면 표기는 1-based 로 변환. */
  sentenceIndex: number;
  nickname: string;
  question: string;
  deepUrl?: string;
}): Promise<boolean> {
  const QUESTION_LIMIT = 120;
  const truncated =
    input.question.length > QUESTION_LIMIT
      ? input.question.slice(0, QUESTION_LIMIT) + '…'
      : input.question;
  // 슬랙 코드 백틱 충돌 회피
  const safeQuestion = truncated.replace(/`/g, "'");

  const where =
    input.sentenceIndex < 0 ? '지문 전체' : `${input.sentenceIndex + 1}번 문장`;
  const sourceLabel = input.sourceKey ? ` · ${input.sourceKey}` : '';
  const lines = [
    '❓ *새 Q&A 질문* (gomijoshua)',
    `${input.textbook}${sourceLabel} · ${where}`,
    `작성: ${input.nickname}`,
    `> ${safeQuestion}`,
  ];
  const link = input.deepUrl?.trim();
  if (link) lines.push(`<${link}|답변하러 가기>`);
  return notifySlack(lines.join('\n'));
}
