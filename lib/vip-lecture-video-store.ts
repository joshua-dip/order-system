import { ObjectId, type Db } from 'mongodb';
import { parseVideoUrl, type VideoProvider } from './video-url';

/**
 * VIP 강의영상관리 — 선생님이 강의영상(YouTube·Vimeo·기타 URL)을 등록·강좌(폴더)·회차로 정리하는 라이브러리.
 * 영상 파일을 직접 저장하지 않고 링크만 관리(스토리지·스트리밍 비용 없음). YouTube/Vimeo 는 임베드 재생.
 */
export const VIP_LECTURE_VIDEOS_COLLECTION = 'vip_lecture_videos';

export { parseVideoUrl };
export type { VideoProvider, ParsedVideo } from './video-url';

export interface VipLectureVideo {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  title: string;
  url: string; // 원본 URL
  provider: VideoProvider;
  videoId: string;
  embedUrl: string;
  thumbnailUrl: string;
  description?: string;
  folder: string; // 강좌/카테고리 ('' = 미분류)
  order: number; // 회차 정렬용
  textbook?: string; // 연계 교재(선택)
  durationMin?: number; // 영상 길이(분, 선택)
  createdAt: Date;
  updatedAt?: Date;
}

let _indexed = false;
export async function ensureLectureVideoIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_LECTURE_VIDEOS_COLLECTION).createIndex({ userId: 1, folder: 1, order: 1, createdAt: -1 }),
    db.collection(VIP_LECTURE_VIDEOS_COLLECTION).createIndex({ userId: 1, createdAt: -1 }),
  ]);
}
