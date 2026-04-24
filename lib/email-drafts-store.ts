/** 이메일 초안 MongoDB 컬렉션명 */
export const DRAFTS_COLLECTION = 'email_drafts';

export type EmailDraftStatus = 'draft' | 'sent';

export type EmailDraftDoc = {
  orderId: import('mongodb').ObjectId | null;
  orderNumber: string;
  loginId: string | null;
  to: string;
  subject: string;
  message: string;
  status: EmailDraftStatus;
  createdAt: Date;
  updatedAt: Date;
  sentAt?: Date;
};
