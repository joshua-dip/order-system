import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 기출 시험 문항별 학생 필기 사진.
 * 실제 이미지는 Dropbox(uploadVipExamPhoto), 여기엔 참조(dropboxPath)만 저장.
 * 조회 시 getDropboxTempLink 로 임시링크 갱신해서 내려줌.
 */
export const EXAM_PHOTOS_COLLECTION = 'vip_exam_question_photos';

export interface ExamQuestionPhotoDoc {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  examId: ObjectId; // vip_school_exams._id
  /** 슬롯 키 — slotType='question'이면 문항 번호, 'passage'이면 지문 키(`교재::sourceKey`). */
  questionNum: string;
  /** 그룹 기준. 미설정(레거시) = 'question'. */
  slotType?: 'question' | 'passage';
  dropboxPath: string;
  name: string;
  uploadedAt: Date;
}

let _indexed = false;
export async function ensureExamPhotoIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(EXAM_PHOTOS_COLLECTION).createIndex({ userId: 1, examId: 1, questionNum: 1 }),
    db.collection(EXAM_PHOTOS_COLLECTION).createIndex({ userId: 1, examId: 1, uploadedAt: 1 }),
  ]);
}
