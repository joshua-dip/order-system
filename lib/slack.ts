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

export async function notifySlackOrder(orderText: string, orderId: string): Promise<boolean> {
  const preview = orderText.slice(0, 1500).replace(/`/g, "'");
  const message = `📋 *새 주문서* (gomijoshua)\nID: \`${orderId}\`\n\n${preview}${orderText.length > 1500 ? '\n…' : ''}`;
  return notifySlack(message);
}
