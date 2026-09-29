/**
 * 콘텐츠 오류 신고 — 클래스키트 수업 화면에서 선생님·학생이 「여기 틀렸어요」를 남긴다.
 * Q&A(qna_threads)는 공개 게시판이라 섞지 않는다. 신고는 관리자만 본다.
 */
import { ObjectId, type Db } from 'mongodb';

export const CONTENT_ERROR_REPORTS_COLLECTION = 'content_error_reports';

export const ERROR_REPORT_KINDS = ['문장·원문', '해석', '분석', '문항', '기타'] as const;
export type ErrorReportKind = (typeof ERROR_REPORT_KINDS)[number];
export type ErrorReportStatus = 'open' | 'fixed' | 'dismissed';

export type ErrorReportDoc = {
  _id?: ObjectId;
  passageId: ObjectId;
  textbook: string;
  sourceKey: string;
  /** 0-based, -1 = 지문 전체 */
  sentenceIndex: number;
  questionId?: ObjectId;
  kind: ErrorReportKind;
  message: string;
  reporter: { loginId?: string; role?: string; ip?: string };
  status: ErrorReportStatus;
  createdAt: Date;
  updatedAt: Date;
};

export const ERROR_REPORT_MESSAGE_MAX = 500;

export function normalizeErrorReportInput(body: Record<string, unknown>):
  | { ok: true; value: { passageId: string; sentenceIndex: number; questionId?: string; kind: ErrorReportKind; message: string } }
  | { ok: false; error: string } {
  const passageId = String(body.passageId ?? '').trim();
  if (!ObjectId.isValid(passageId)) return { ok: false, error: '지문 정보가 올바르지 않습니다.' };
  const si = Number(body.sentenceIndex ?? -1);
  if (!Number.isInteger(si) || si < -1) return { ok: false, error: '문장 번호가 올바르지 않습니다.' };
  const kind = (ERROR_REPORT_KINDS as readonly string[]).includes(String(body.kind)) ? (String(body.kind) as ErrorReportKind) : '기타';
  const message = String(body.message ?? '').trim();
  if (message.length < 2 || message.length > ERROR_REPORT_MESSAGE_MAX) {
    return { ok: false, error: `내용은 2~${ERROR_REPORT_MESSAGE_MAX}자로 적어 주세요.` };
  }
  const qid = String(body.questionId ?? '').trim();
  return { ok: true, value: { passageId, sentenceIndex: si, kind, message, ...(ObjectId.isValid(qid) ? { questionId: qid } : {}) } };
}

export async function countRecentReportsByIp(db: Db, ip: string, sinceMs = 3600_000): Promise<number> {
  return db.collection(CONTENT_ERROR_REPORTS_COLLECTION).countDocuments({ 'reporter.ip': ip, createdAt: { $gte: new Date(Date.now() - sinceMs) } });
}
