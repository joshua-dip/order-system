/** 파이널 시험범위·학교 시험범위 등에 공통으로 쓰는 dbEntries 검증 */

export function validateExamScopeDbEntries(entries: unknown): string | null {
  if (!Array.isArray(entries) || entries.length === 0) {
    return '시험범위(교재·모의고사 목록)이 비어 있습니다.';
  }
  for (const e of entries) {
    if (!e || typeof e !== 'object') return '항목 형식이 올바르지 않습니다.';
    const o = e as Record<string, unknown>;
    if (o.type !== 'textbook' && o.type !== 'mockexam') return '항목 type이 올바르지 않습니다.';
    if (typeof o.textbookKey !== 'string' || !o.textbookKey.trim()) return '교재(시험) 키가 필요합니다.';
    if (typeof o.displayName !== 'string' || !o.displayName.trim()) return '표시명이 필요합니다.';
    if (!Array.isArray(o.selectedSources)) return '선택 지문(selectedSources)이 필요합니다.';
  }
  return null;
}
