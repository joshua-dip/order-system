/** 학생 선택 드롭다운 공용 라벨 — 동명이인 구분용 전화번호 뒷자리 포함. */

/** 전화번호에서 숫자만 추려 마지막 4자리. 없으면 빈 문자열. */
export function phoneTail(phone?: string | null): string {
  const d = String(phone ?? '').replace(/\D/g, '');
  return d ? d.slice(-4) : '';
}

/**
 * 학생 옵션 라벨 — `이름 (학교 · N학년 · …1234)`.
 * 동명이인이 흔해 전화번호 뒷자리를 함께 표기한다. school=false면 학교명 생략.
 */
export function studentOptionLabel(
  s: { name: string; grade?: number | null; schoolName?: string | null; phone?: string | null },
  opts?: { school?: boolean },
): string {
  const tail = phoneTail(s.phone);
  const parts = [
    opts?.school && s.schoolName ? s.schoolName : '',
    s.grade ? `${s.grade}학년` : '',
    tail ? `…${tail}` : '',
  ].filter(Boolean);
  return parts.length ? `${s.name} (${parts.join(' · ')})` : s.name;
}
