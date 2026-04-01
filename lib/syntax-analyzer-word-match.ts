/** 구문/SVOC 분석에서 AI가 준 텍스트를 문장 내 단어 인덱스로 맞춤 */

export function findWordIndices(
  sentence: string,
  targetText: string
): { startWordIndex: number; endWordIndex: number } {
  const words = sentence.split(/\s+/);
  const targetWords = targetText.trim().split(/\s+/).filter(Boolean);
  if (targetWords.length === 0) return { startWordIndex: -1, endWordIndex: -1 };

  const normalize = (w: string) => w.replace(/[.,;:!?()\[\]{}"''""—–\-…·/\\]/g, '').toLowerCase();

  for (let i = 0; i < words.length; i++) {
    if (normalize(words[i]) !== normalize(targetWords[0])) continue;
    let match = true;
    for (let j = 0; j < targetWords.length; j++) {
      if (i + j >= words.length || normalize(words[i + j]) !== normalize(targetWords[j])) {
        match = false;
        break;
      }
    }
    if (match) return { startWordIndex: i, endWordIndex: i + targetWords.length - 1 };
  }

  if (targetWords.length >= 2) {
    const normFirst = normalize(targetWords[0]);
    const normLast = normalize(targetWords[targetWords.length - 1]);
    for (let i = 0; i < words.length; i++) {
      if (normalize(words[i]) !== normFirst) continue;
      const expectedEnd = i + targetWords.length - 1;
      if (expectedEnd < words.length && normalize(words[expectedEnd]) === normLast) {
        return { startWordIndex: i, endWordIndex: expectedEnd };
      }
    }
  }

  const normFirst = normalize(targetWords[0]);
  for (let i = 0; i < words.length; i++) {
    if (normalize(words[i]) === normFirst) {
      return { startWordIndex: i, endWordIndex: Math.min(i + targetWords.length - 1, words.length - 1) };
    }
  }

  return { startWordIndex: -1, endWordIndex: -1 };
}

export const SYNTAX_LABEL_COLORS: Record<string, string> = {
  부사절: '#e65100',
  명사절: '#1565c0',
  관계사절: '#00695c',
  형용사절: '#00695c',
  분사구문: '#c62828',
  명사구: '#1565c0',
  전치사구: '#6a1b9a',
  형용사구: '#2e7d32',
  부사구: '#e65100',
  'to부정사(명)': '#4527a0',
  'to부정사(형)': '#4527a0',
  'to부정사(부)': '#4527a0',
  동명사구: '#00838f',
  '분사구(현재)': '#c62828',
  '분사구(과거)': '#c62828',
  동격절: '#1565c0',
  삽입절: '#795548',
  등위절: '#37474f',
  수식: '#ff6f00',
  동격: '#1565c0',
  등위어: '#37474f',
  'it~that 강조': '#ad1457',
  조건절: '#e65100',
  양보절: '#e65100',
  시간절: '#e65100',
  원인절: '#e65100',
  목적절: '#e65100',
  결과절: '#e65100',
};

export function getSyntaxColorForLabel(label: string): string {
  if (SYNTAX_LABEL_COLORS[label]) return SYNTAX_LABEL_COLORS[label];
  for (const [key, color] of Object.entries(SYNTAX_LABEL_COLORS)) {
    if (label.includes(key.replace(/[()]/g, ''))) return color;
  }
  if (label.includes('절')) return '#e65100';
  if (label.includes('구')) return '#6a1b9a';
  return '#455a64';
}
