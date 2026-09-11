import type { Db } from 'mongodb';
import { invalidatePassageSourceCache } from './passage-source-detect';
import {
  EXTERNAL_MIN_ENGLISH_RATIO,
  EXTERNAL_PASSAGE_LIMITS,
  englishLetterRatio,
  externalTextbookKey,
} from './external-variant';

/**
 * 서버 전용 — 외부지문 등록·수정 로직.
 *
 * 주문 화면 API(/api/my/external-passages)와 관리자가 선생님 대신 등록할 때(스크립트)가 같이 쓴다.
 * 한쪽에만 규칙을 두면 대리 등록한 지문이 화면에서 올린 것과 모양이 달라진다.
 * (lib/external-variant.ts 는 화면에서도 불러 쓰므로 DB·캐시 코드를 거기 두지 않는다.)
 */

/** 붙여넣은 글을 지문으로 저장할 모양으로 — 줄 끝 공백·보이지 않는 문자·3줄 이상 빈 줄을 정리 */
export function normalizePassageText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[​-‍﻿]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 지문 한 개의 길이·언어 검사. 문제가 없으면 null */
export function externalPassageProblem(text: string, label: string): string | null {
  const { minChars, maxChars } = EXTERNAL_PASSAGE_LIMITS;
  if (text.length < minChars) return `${label}이 너무 짧습니다 (${minChars}자 이상).`;
  if (text.length > maxChars) return `${label}이 너무 깁니다 (${maxChars}자 이하).`;
  if (englishLetterRatio(text) < EXTERNAL_MIN_ENGLISH_RATIO) return `${label}: 영어 지문만 받을 수 있습니다.`;
  return null;
}

/** KST 기준 YYMMDD */
function kstYymmdd(d = new Date()): string {
  const k = new Date(d.getTime() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(k.getUTCFullYear()).slice(2)}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}`;
}

/**
 * 붙여넣은 지문을 그 회원 **전용 교재**(`외부지문_<loginId>`)로 등록한다.
 *
 * 강(chapter) = 자료 이름(없으면 「YYMMDD 외부지문」, 같은 이름이 있으면 (2)·(3)) · 번호 01번~.
 * source_key = `${chapter} ${number}` — 부교재 변형 주문의 selectedLessons 와 같은 모양이라
 * 이어지는 주문서·제작 job·cc:variant pipeline 이 손대지 않고 그대로 동작한다.
 */
export async function registerExternalPassages(
  db: Db,
  input: {
    loginId: string;
    batchTitle?: string;
    passages: { title?: string; text: string }[];
    /** 선생님이 아니라 관리자가 대신 올린 경우의 표시 */
    registeredBy?: string;
  },
): Promise<
  | { ok: true; textbook: string; chapter: string; lessons: string[]; ids: string[] }
  | { ok: false; error: string }
> {
  const items = input.passages
    .map((p) => ({
      title: typeof p.title === 'string' ? p.title.trim().slice(0, 60) : '',
      text: normalizePassageText(typeof p.text === 'string' ? p.text : ''),
    }))
    .filter((p) => p.text !== '');

  if (items.length === 0) return { ok: false, error: '지문을 하나 이상 붙여넣어 주세요.' };
  if (items.length > EXTERNAL_PASSAGE_LIMITS.maxPassages) {
    return { ok: false, error: `한 번에 ${EXTERNAL_PASSAGE_LIMITS.maxPassages}개 지문까지 올릴 수 있습니다.` };
  }
  for (let i = 0; i < items.length; i++) {
    const problem = externalPassageProblem(items[i].text, `지문 ${i + 1}`);
    if (problem) return { ok: false, error: problem };
  }

  const col = db.collection('passages');
  const textbook = externalTextbookKey(input.loginId);
  const titleIn = (input.batchTitle ?? '').trim().slice(0, 40);
  const baseChapter = titleIn || `${kstYymmdd()} 외부지문`;
  let chapter = baseChapter;
  for (let n = 2; await col.findOne({ textbook, chapter }, { projection: { _id: 1 } }); n++) {
    chapter = `${baseChapter} (${n})`;
  }

  const now = new Date();
  const docs = items.map((p, i) => {
    const number = `${String(i + 1).padStart(2, '0')}번`;
    return {
      textbook,
      chapter,
      number,
      source_key: `${chapter} ${number}`,
      order: i + 1,
      content: {
        original: p.text,
        translation: '',
        sentences_en: [],
        sentences_ko: [],
        tokenized_en: '',
        tokenized_ko: '',
        mixed: '',
      },
      created_at: now,
      updated_at: now,
      created_from: 'member_external',
      owner_login_id: input.loginId,
      ...(p.title ? { external_title: p.title } : {}),
      ...(input.registeredBy ? { registered_by: input.registeredBy } : {}),
    };
  });
  const res = await col.insertMany(docs);
  invalidatePassageSourceCache();
  return {
    ok: true,
    textbook,
    chapter,
    lessons: docs.map((d) => d.source_key),
    ids: Object.values(res.insertedIds).map((x) => String(x)),
  };
}
