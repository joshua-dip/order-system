import type { NextRequest } from 'next/server';
import { verifyToken, COOKIE_NAME, type SessionPayload } from '@/lib/auth';
import { isMockExamTextbookKey } from '@/lib/mock-exam-key';
import {
  EN_FONT_OPTIONS,
  KO_FONT_OPTIONS,
  normalizeEnFont,
  normalizeKoFont,
  type EnFontKey,
  type KoFontKey,
} from '@/lib/lesson-material-html';

/** 비회원 클래스키트 — 26년 6월 고1·고2·고3 모의고사만 무료 체험 */
export const GUEST_CLASS_KIT_TEXTBOOKS = [
  '26년 6월 고1 영어모의고사',
  '26년 6월 고2 영어모의고사',
  '26년 6월 고3 영어모의고사',
] as const;

export type ClassKitAccessLevel = 'admin' | 'member' | 'guest';

export function isGuestClassKitTextbook(textbook: string): boolean {
  const t = textbook.trim();
  return (GUEST_CLASS_KIT_TEXTBOOKS as readonly string[]).includes(t);
}

export async function resolveClassKitAccess(request: NextRequest): Promise<{
  level: ClassKitAccessLevel;
  payload: SessionPayload | null;
}> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (payload?.role === 'admin') return { level: 'admin', payload };
  if (payload) return { level: 'member', payload };
  return { level: 'guest', payload: null };
}

/** 사용자용 클래스키트 — 회원·비회원 모두 모의고사만(비회원은 6월 3종 제한). 관리자는 전체. */
export function isClassKitTextbookAllowed(textbook: string, level: ClassKitAccessLevel): boolean {
  const tb = textbook.trim();
  if (!tb) return false;
  if (level === 'admin') return true;
  if (level === 'guest') return isGuestClassKitTextbook(tb);
  return isMockExamTextbookKey(tb);
}

export function classKitTextbookDeniedMessage(level: ClassKitAccessLevel): string {
  if (level === 'guest') {
    return '비회원은 26년 6월 고1·고2·고3 모의고사만 이용할 수 있습니다. 더 많은 지문은 회원가입 후 이용해 주세요.';
  }
  return '클래스키트는 모의고사 지문만 이용할 수 있습니다.';
}

export function filterClassKitTextbooks(textbooks: string[], level: ClassKitAccessLevel): string[] {
  return textbooks.filter((t) => isClassKitTextbookAllowed(t, level));
}

export const CLASS_KIT_GUEST_NOTICE =
  '비회원은 26년 6월 고1·고2·고3 모의고사만 이용할 수 있습니다. 회원가입하면 모든 모의고사 지문을 불러올 수 있습니다.';

export const CLASS_KIT_MEMBER_NOTICE =
  '클래스키트는 모의고사 지문만 이용할 수 있습니다. (부교재·시중 교재는 이용 불가)';

/** 비회원 무료 영어 글씨체 — 고딕·명조 */
export const GUEST_CLASS_KIT_EN_FONTS: readonly EnFontKey[] = ['sans', 'serif'];

/** 비회원 무료 한글 글씨체 — 손글씨·고딕·둥근돋움 */
export const GUEST_CLASS_KIT_KO_FONTS: readonly KoFontKey[] = ['pen', 'sans', 'gowun-dodum'];

export const CLASS_KIT_GUEST_FONT_NOTICE =
  '비회원은 무료 글씨체만 선택할 수 있습니다. (영어 2종 · 한글 3종) 회원가입 시 전체 글씨체를 이용할 수 있습니다.';

export function enFontOptionsForAccess(level: ClassKitAccessLevel) {
  if (level === 'guest') {
    return EN_FONT_OPTIONS.filter((o) => (GUEST_CLASS_KIT_EN_FONTS as readonly string[]).includes(o.key));
  }
  return EN_FONT_OPTIONS;
}

export function koFontOptionsForAccess(level: ClassKitAccessLevel) {
  if (level === 'guest') {
    return KO_FONT_OPTIONS.filter((o) => (GUEST_CLASS_KIT_KO_FONTS as readonly string[]).includes(o.key));
  }
  return KO_FONT_OPTIONS;
}

export function normalizeEnFontForAccess(v: unknown, level: ClassKitAccessLevel): EnFontKey {
  const font = normalizeEnFont(v);
  if (level === 'guest' && !(GUEST_CLASS_KIT_EN_FONTS as readonly string[]).includes(font)) {
    return GUEST_CLASS_KIT_EN_FONTS[0];
  }
  return font;
}

export function normalizeKoFontForAccess(v: unknown, level: ClassKitAccessLevel): KoFontKey {
  const font = normalizeKoFont(v);
  if (level === 'guest' && !(GUEST_CLASS_KIT_KO_FONTS as readonly string[]).includes(font)) {
    return GUEST_CLASS_KIT_KO_FONTS[0];
  }
  return font;
}
