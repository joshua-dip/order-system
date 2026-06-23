/**
 * 영상 URL 파싱 (서버·클라이언트 공용 — DB 의존 없음).
 * YouTube/Vimeo 식별 + 임베드/썸네일 URL 도출.
 */
export type VideoProvider = 'youtube' | 'vimeo' | 'other';

export interface ParsedVideo {
  provider: VideoProvider;
  videoId: string;
  embedUrl: string;     // 임베드 가능 시 iframe src, 아니면 ''
  thumbnailUrl: string; // 썸네일 URL, 없으면 ''
}

export function parseVideoUrl(rawUrl: string): ParsedVideo {
  const url = (rawUrl || '').trim();
  // YouTube: watch?v= / youtu.be/ / embed/ / shorts/ / live/
  const yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) {
    const id = yt[1];
    return { provider: 'youtube', videoId: id, embedUrl: `https://www.youtube.com/embed/${id}`, thumbnailUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg` };
  }
  // Vimeo: vimeo.com/123 또는 vimeo.com/video/123
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) {
    const id = vm[1];
    return { provider: 'vimeo', videoId: id, embedUrl: `https://player.vimeo.com/video/${id}`, thumbnailUrl: '' };
  }
  return { provider: 'other', videoId: '', embedUrl: '', thumbnailUrl: '' };
}

export const PROVIDER_LABEL: Record<VideoProvider, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  other: '링크',
};
