/**
 * 수업 화면 듣기 — 브라우저 내장 음성(Web Speech API). 서버·API 비용 없음.
 * 영어 음성은 기기마다 다르므로 미국/영국 영어 중 가장 자연스러운 것을 고른다.
 */

export const TTS_RATES = { slow: 0.7, normal: 0.95 } as const;
export type TtsRate = keyof typeof TTS_RATES;

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

let cachedVoice: SpeechSynthesisVoice | null | undefined;

function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null; // 아직 로드 전 — 다음 호출에서 다시 고른다
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
  const prefer = [/Google US English/i, /Samantha/i, /Microsoft (Aria|Jenny|Guy).*Online/i, /en-US/i, /Google UK English Female/i];
  cachedVoice = prefer.map((re) => en.find((v) => re.test(v.name) || re.test(v.lang))).find(Boolean) ?? en[0] ?? null;
  return cachedVoice;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.addEventListener?.('voiceschanged', () => {
    cachedVoice = undefined;
  });
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

/** 문장 여러 개를 이어 읽는다. onIndex(i) 로 지금 읽는 문장을 알려 주고, 끝나면 onEnd. */
export function speak(
  texts: string | string[],
  rate: TtsRate,
  handlers: { onIndex?: (i: number) => void; onEnd?: () => void } = {},
): void {
  if (!ttsSupported()) return;
  const list = (Array.isArray(texts) ? texts : [texts]).map((t) => t.trim()).filter(Boolean);
  window.speechSynthesis.cancel();
  if (list.length === 0) return handlers.onEnd?.();
  const voice = pickVoice();
  list.forEach((text, i) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang ?? 'en-US';
    if (voice) u.voice = voice;
    u.rate = TTS_RATES[rate];
    u.onstart = () => handlers.onIndex?.(i);
    if (i === list.length - 1) {
      u.onend = () => handlers.onEnd?.();
      u.onerror = () => handlers.onEnd?.();
    }
    window.speechSynthesis.speak(u);
  });
}
