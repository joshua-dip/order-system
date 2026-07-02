/**
 * 교재 스튜디오 — 인디자인식 자유 배치 교재 편집기 (서버·클라이언트 공용 타입/시드).
 * 좌표계: A4 기준 mm (210×297). 요소는 페이지 안에 절대 배치.
 * 기존 교재 만들기(블록 플로우, lib/material-types.ts)와 별개 모델·별개 컬렉션.
 */

export const STUDIO_MATERIALS_COLLECTION = 'vip_material_studio_docs';

export const A4_W = 210;
export const A4_H = 297;

export const STUDIO_ELEMENT_KINDS = ['text', 'image', 'qr', 'question', 'rect', 'line'] as const;
export type StudioElementKind = (typeof STUDIO_ELEMENT_KINDS)[number];

/** 문제 요소 스냅샷 (generated_questions 에서 불러와 고정 — 이후 원본 변경과 무관) */
export interface StudioQuestionSnapshot {
  qid?: string;
  serial?: string;
  type?: string;
  num?: number;
  question?: string;
  paragraph?: string;
  options?: string[];
  answer?: string;
  explanation?: string;
  showAnswer?: boolean;
}

export interface StudioElement {
  id: string;
  kind: StudioElementKind;
  /** 위치·크기 (mm) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 쌓임 순서 (클수록 위) */
  z: number;
  /* ── text ── */
  text?: string;
  /** pt */
  fontSize?: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  color?: string;
  bg?: string;
  /** 줄간격 배수 (기본 1.35) */
  lineHeight?: number;
  /* ── image ── (업로드 파일 서빙 URL) */
  src?: string;
  /* ── qr ── */
  qrUrl?: string;
  qrLabel?: string;
  /* ── question ── */
  q?: StudioQuestionSnapshot;
  /* ── rect/line 스타일 (text 박스 테두리에도 사용) ── */
  fill?: string;
  borderColor?: string;
  borderWidth?: number; // mm
  radius?: number; // mm
}

export interface StudioPage {
  id: string;
  elements: StudioElement[];
}

export const STUDIO_DIFFICULTIES = ['기초', '심화', '고난도'] as const;
export type StudioDifficulty = (typeof STUDIO_DIFFICULTIES)[number];

export interface StudioDocPayload {
  title: string;
  subtitle?: string;
  difficulty?: string;
  pages: StudioPage[];
}

/* ───────────────────────── sanitize ───────────────────────── */

const MAX_PAGES = 80;
const MAX_ELEMENTS = 250;
const MAX_TEXT = 8000;

function n(v: unknown, def: number, min: number, max: number): number {
  const x = typeof v === 'number' && Number.isFinite(v) ? v : def;
  return Math.min(max, Math.max(min, Math.round(x * 100) / 100));
}
function s(v: unknown, max = 300): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function color(v: unknown, def = ''): string {
  const c = s(v, 30).trim();
  return /^#[0-9a-fA-F]{3,8}$|^rgba?\([\d\s.,%]+\)$|^transparent$/.test(c) ? c : def;
}

export function sanitizeStudioPages(raw: unknown): StudioPage[] {
  if (!Array.isArray(raw)) return [];
  const pages: StudioPage[] = [];
  for (const p of raw.slice(0, MAX_PAGES)) {
    if (!p || typeof p !== 'object') continue;
    const pr = p as Record<string, unknown>;
    const els: StudioElement[] = [];
    const rawEls = Array.isArray(pr.elements) ? pr.elements : [];
    for (const e of rawEls.slice(0, MAX_ELEMENTS)) {
      if (!e || typeof e !== 'object') continue;
      const er = e as Record<string, unknown>;
      const kind = s(er.kind, 20) as StudioElementKind;
      if (!STUDIO_ELEMENT_KINDS.includes(kind)) continue;
      const el: StudioElement = {
        id: s(er.id, 40) || Math.random().toString(36).slice(2, 10),
        kind,
        x: n(er.x, 10, -A4_W, A4_W * 2),
        y: n(er.y, 10, -A4_H, A4_H * 2),
        w: n(er.w, 50, 2, A4_W * 1.5),
        h: n(er.h, 12, 1, A4_H * 1.5),
        z: Math.round(n(er.z, 1, 0, 9999)),
      };
      if (kind === 'text') {
        el.text = s(er.text, MAX_TEXT);
        el.fontSize = n(er.fontSize, 11, 5, 96);
        el.bold = er.bold === true;
        const al = s(er.align, 10);
        el.align = al === 'center' || al === 'right' ? al : 'left';
        el.color = color(er.color, '#111111');
        el.bg = color(er.bg, '');
        el.lineHeight = n(er.lineHeight, 1.35, 0.9, 3);
      }
      if (kind === 'image') el.src = s(er.src, 500);
      if (kind === 'qr') {
        el.qrUrl = s(er.qrUrl, 800);
        el.qrLabel = s(er.qrLabel, 120);
      }
      if (kind === 'question' && er.q && typeof er.q === 'object') {
        const q = er.q as Record<string, unknown>;
        el.q = {
          qid: s(q.qid, 40),
          serial: s(q.serial, 20),
          type: s(q.type, 30),
          num: Math.round(n(q.num, 0, 0, 999)),
          question: s(q.question, 600),
          paragraph: s(q.paragraph, MAX_TEXT),
          options: Array.isArray(q.options) ? q.options.slice(0, 5).map((o) => s(o, 400)) : [],
          answer: s(q.answer, 20),
          explanation: s(q.explanation, 2000),
          showAnswer: q.showAnswer === true,
        };
        el.fontSize = n(er.fontSize, 10, 5, 40);
      }
      if (kind === 'rect' || kind === 'line' || kind === 'text') {
        el.fill = color(er.fill, kind === 'rect' ? '#f5f5f5' : '');
        el.borderColor = color(er.borderColor, kind === 'text' ? '' : '#333333');
        el.borderWidth = n(er.borderWidth, kind === 'line' ? 0.6 : 0.3, 0, 5);
        el.radius = n(er.radius, 0, 0, 20);
      }
      els.push(el);
    }
    pages.push({ id: s(pr.id, 40) || Math.random().toString(36).slice(2, 10), elements: els });
  }
  return pages;
}

/* ───────────────────────── 시드: 여름방학 문법특강 8회차 ───────────────────────── */

let seedSeq = 0;
const uid = () => `sd${(++seedSeq).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** 브랜드 색 (난이도별) */
const LEVEL_COLOR: Record<StudioDifficulty, string> = { 기초: '#2563eb', 심화: '#7c3aed', 고난도: '#b91c1c' };

interface UnitContent { points: string[]; examples: string[] }
type UnitByLevel = Record<StudioDifficulty, UnitContent>;
interface Unit { no: number; title: string; en: string; c: UnitByLevel }

/** 폴더 커리큘럼 기반 8회차 (공통 1–4 + 개별 5–8), 샘플 PDF(수동태) 개요 스타일 반영 */
const UNITS: Unit[] = [
  { no: 1, title: '문장의 구조', en: 'Sentence Structure', c: {
    기초: { points: ['문장의 기본 요소: 주어(S) + 동사(V)', '1형식 S+V / 2형식 S+V+보어(C)', '3형식 S+V+목적어(O)', '보어 자리에는 명사·형용사 (부사 X)', '목적어 자리에는 명사·대명사·to부정사·동명사'], examples: ['Birds sing. (1형식)', 'She is a teacher. (2형식)', 'I like music. (3형식)'] },
    심화: { points: ['4형식 S+V+간접목적어(IO)+직접목적어(DO)', '4형식 → 3형식 전환: 전치사 to/for/of 선택', 'give·send·show → to / make·buy·cook → for / ask → of', '5형식 S+V+O+목적격보어(OC)', '목적격보어: 명사·형용사·to부정사·원형부정사·분사'], examples: ['He gave me a book. → He gave a book to me.', 'She made me a cake. → She made a cake for me.', 'I found the movie boring. (5형식)'] },
    고난도: { points: ['지각동사(see·hear·feel)+O+원형부정사/현재분사', '사역동사(make·have·let)+O+원형부정사', 'get은 준사역: get+O+to부정사', '가목적어 it: think/find/make + it + 형용사 + to V', '동사에 따라 형식이 달라지는 동사 구별 (find, make, leave 등)'], examples: ['I saw him cross[crossing] the street.', 'She had her son clean the room.', 'I found it difficult to solve the problem.'] },
  } },
  { no: 2, title: '수동태', en: 'Passive Voice', c: {
    기초: { points: ['수동태 형태: be동사 + 과거분사(p.p.)', '능동태 목적어 → 수동태 주어', '행위자: by + 목적격 (일반인·불분명하면 생략)', '부정문: be동사 + not + p.p.', '의문문: Be동사 + 주어 + p.p. ~?'], examples: ['The window was broken by Tom.', 'English is spoken in many countries.', 'Was this cake made by your mom?'] },
    심화: { points: ['조동사가 있는 수동태: 조동사 + be + p.p.', '진행형 수동태: be동사 + being + p.p.', '완료형 수동태: have/has/had + been + p.p.', '4형식의 수동태: 간접·직접목적어 각각 주어 가능', '직접목적어가 주어면 간접목적어 앞 전치사(to/for) 사용'], examples: ['The work must be finished by noon.', 'The bridge is being built now.', 'A book was given to me by my uncle.'] },
    고난도: { points: ['5형식의 수동태: be + p.p. + 목적격보어', '지각·사역동사의 수동태 → 원형부정사가 to부정사로', '동사구의 수동태: 하나의 동사로 취급, 전치사 생략 X (be looked after 등)', '목적어가 that절인 수동태: It is said that ~ / He is said to ~', 'by 이외의 전치사: be interested in, be covered with, be known for/to/as'], examples: ['He was made to clean the room.', 'The baby is looked after by her grandma.', 'It is believed that he is honest. = He is believed to be honest.'] },
  } },
  { no: 3, title: '관계사', en: 'Relatives', c: {
    기초: { points: ['관계대명사 = 접속사 + 대명사, 앞의 명사(선행사) 수식', '사람: who(주격)·whose(소유격)·whom(목적격)', '사물·동물: which / 공통: that', '주격 관계대명사 + 동사 / 목적격 관계대명사는 생략 가능', '선행사가 문장 전체·최상급·all 등이면 that 선호'], examples: ['I know a boy who plays soccer well.', 'This is the book (which) I bought yesterday.', 'She is the girl whose father is a doctor.'] },
    심화: { points: ['관계대명사 what = the thing(s) which (선행사 포함)', '전치사 + 관계대명사: in which, for whom …', '관계부사: when(시간)·where(장소)·why(이유)·how(방법)', '관계부사 = 전치사 + which', 'the way how 는 함께 쓰지 않음 (the way 또는 how만)'], examples: ['What I want is your honesty.', 'This is the house in which he lives. = where he lives', 'Tell me the reason why you were late.'] },
    고난도: { points: ['계속적 용법: 콤마(,) + who/which — that·what 불가', '계속적 용법의 which는 앞 문장 전체를 받을 수 있음', '복합관계대명사: whoever·whatever·whichever (명사절/양보절)', '복합관계부사: whenever·wherever·however', '관계대명사 생략 + 분사로 축약 (who is → 생략)'], examples: ['He passed the exam, which surprised everyone.', 'Whoever comes first will get the prize.', 'However hard it may be, finish it.'] },
  } },
  { no: 4, title: '접속사', en: 'Conjunctions', c: {
    기초: { points: ['등위접속사: and, but, or, so', '명사절 that: ~라는 것 (주어·목적어·보어)', '시간 접속사: when, while, before, after, until', '이유 접속사: because, since, as', '조건 접속사: if, unless(만약 ~않으면)'], examples: ['I think that he is kind.', 'When I got home, it was raining.', 'Unless you hurry, you will miss the bus.'] },
    심화: { points: ['시간·조건 부사절에서는 현재가 미래를 대신', 'so ~ that … : 너무 ~해서 …하다', 'so that + 주어 + can: ~하기 위하여 (목적)', '양보 접속사: though, although, even though', 'both A and B / either A or B / neither A nor B 수일치'], examples: ['If it rains tomorrow, we will stay home.', 'He was so tired that he fell asleep.', 'Study hard so that you can pass the test.'] },
    고난도: { points: ['whether/if: ~인지 아닌지 (if는 목적어절만)', 'not A but B / not only A but also B = B as well as A', '접속사 vs 전치사 구별: while/during, because/because of, though/despite', 'as의 다양한 뜻: ~할 때, ~때문에, ~처럼, ~함에 따라', '상관접속사 수일치: not only A but also B → B에 일치'], examples: ['I wonder whether she will come (or not).', 'Not only you but also he is wrong.', 'Despite the rain, the game went on. (cf. Although it rained, ~)'] },
  } },
  { no: 5, title: 'to부정사', en: 'To-infinitive', c: {
    기초: { points: ['형태: to + 동사원형', '명사적 용법: 주어·보어·목적어 (~하는 것)', '형용사적 용법: 명사 뒤에서 수식 (~할)', '부사적 용법: 목적(~하기 위해)·감정의 원인·결과', 'want, hope, decide, plan + to부정사'], examples: ['To learn English is fun. = It is fun to learn English.', 'I have a lot of homework to do.', 'He went to the library to study.'] },
    심화: { points: ['의미상의 주어: for + 목적격 / 사람 성질 형용사는 of + 목적격', '가주어 It ~ to V 구문', '의문사 + to부정사 = 의문사 + 주어 + should + V', 'too ~ to V: 너무 ~해서 …할 수 없다 (= so ~ that … can\'t)', 'enough to V: …할 만큼 충분히 ~ (= so ~ that … can)'], examples: ['It is important for you to exercise.', 'It was kind of you to help me.', 'This box is too heavy for me to carry.'] },
    고난도: { points: ['to부정사의 시제: 단순(to V) vs 완료(to have p.p.)', 'seem to V: It seems that ~ 전환', 'be to 용법: 예정·의무·가능·운명·의도', '독립부정사: to be honest, to make matters worse …', '대부정사: 동사 반복을 피해 to만 남김 (want to 등)'], examples: ['He seems to have been rich. = It seems that he was rich.', 'The president is to visit Korea next week.', 'You may go home if you want to.'] },
  } },
  { no: 6, title: '동명사', en: 'Gerund', c: {
    기초: { points: ['형태: 동사원형 + -ing (~하는 것, 명사 역할)', '주어·보어·목적어·전치사의 목적어로 사용', 'enjoy, finish, mind, give up, avoid + 동명사', '동명사 주어는 단수 취급', 'go -ing: ~하러 가다 (go shopping, go fishing)'], examples: ['Reading books is my hobby.', 'He finished doing his homework.', 'How about going shopping this weekend?'] },
    심화: { points: ['동명사 vs to부정사 목적어: remember/forget/try + -ing(과거) vs to V(미래)', 'stop -ing(멈추다) vs stop to V(~하려고 멈추다)', '동명사의 의미상 주어: 소유격(또는 목적격)', '동명사 관용표현: be busy -ing, spend 시간 -ing, look forward to -ing', 'cannot help -ing = cannot but + V: ~하지 않을 수 없다'], examples: ['Remember to lock the door. / I remember locking the door.', 'I\'m looking forward to seeing you.', 'She was busy preparing for the exam.'] },
    고난도: { points: ['완료 동명사: having p.p. (본동사보다 앞선 때)', '수동 동명사: being p.p. / having been p.p.', 'need -ing = need to be p.p. (수동의 의미)', 'There is no -ing: ~할 수 없다 / It is no use -ing: ~해도 소용없다', '전치사 to + 동명사 구별: object to, be used to, contribute to'], examples: ['He denied having broken the window.', 'This wall needs painting. = needs to be painted.', 'It is no use crying over spilt milk.'] },
  } },
  { no: 7, title: '분사·분사구문', en: 'Participles', c: {
    기초: { points: ['현재분사(-ing): 능동·진행 / 과거분사(p.p.): 수동·완료', '명사 수식: 단독이면 앞, 구를 이루면 뒤에서 수식', '감정동사의 분사: 감정을 주면 -ing, 느끼면 p.p.', 'boring(지루하게 하는) vs bored(지루함을 느끼는)', '보어로 쓰이는 분사 (2형식·5형식)'], examples: ['Look at the sleeping baby.', 'The book written in English is difficult.', 'The movie was boring, so I was bored.'] },
    심화: { points: ['분사구문 만들기: 접속사 생략 → 주어 생략(같을 때) → 동사를 -ing로', '의미: 시간·이유·조건·양보·동시동작·연속동작', '부정: not/never + 분사', 'Being/Having been은 생략 가능', '접속사를 남긴 분사구문 (의미를 분명히 할 때)'], examples: ['Walking down the street, I met an old friend.', 'Not knowing what to do, she asked for help.', 'While watching TV, he fell asleep.'] },
    고난도: { points: ['완료 분사구문: Having p.p. (주절보다 앞선 때)', '독립분사구문: 주어가 다르면 주어를 남김', '비인칭 독립분사구문: generally speaking, judging from …', 'with + 목적어 + 분사: ~한 채로 (부대상황)', '수동 분사구문: (Being) p.p. ~'], examples: ['Having finished the work, he went home.', 'It being fine, we went on a picnic.', 'He listened with his eyes closed.'] },
  } },
  { no: 8, title: '가정법', en: 'Subjunctive', c: {
    기초: { points: ['가정법 과거: If + 주어 + 동사 과거형, 주어 + would/could + V', '현재 사실의 반대를 가정 (~라면 …할 텐데)', 'be동사는 인칭에 관계없이 were', '단순 조건문(직설법)과 구별: If it rains, ~', 'I wish + 가정법 과거: ~라면 좋을 텐데'], examples: ['If I were you, I would apologize.', 'If I had money, I could buy the shoes.', 'I wish I were taller.'] },
    심화: { points: ['가정법 과거완료: If + had p.p., 주어 + would/could + have p.p.', '과거 사실의 반대를 가정 (~했더라면 …했을 텐데)', 'I wish + 가정법 과거완료: ~했더라면 좋을 텐데', 'as if + 가정법: 마치 ~인 것처럼', 'Without[But for] ~ = If it were not for ~'], examples: ['If I had studied harder, I would have passed.', 'He talks as if he knew everything.', 'Without water, nothing could live.'] },
    고난도: { points: ['혼합가정법: If + had p.p.(과거), 주어 + would + V(현재)', 'if 생략 도치: Were I ~ / Had I p.p. ~ / Should you ~', '주어 속의 가정: A wise man would not do so.', 'It\'s (high) time + 가정법 과거: 이미 했어야 할 때', 'if it were not for(현재) / if it had not been for(과거) 구별'], examples: ['If I had taken the medicine then, I would be fine now.', 'Had I known it, I would have told you.', 'It\'s time you went to bed.'] },
  } },
];

const T = (partial: Partial<StudioElement>): StudioElement => ({
  id: uid(), kind: 'text', x: 15, y: 15, w: 180, h: 12, z: 1,
  fontSize: 11, bold: false, align: 'left', color: '#111111', lineHeight: 1.35,
  ...partial,
});

/** 표지 페이지 (요소들 전부 자유 편집 가능) */
export function buildCoverPage(opts: { title: string; subtitle: string; level: StudioDifficulty; academy?: string }): StudioPage {
  const c = LEVEL_COLOR[opts.level];
  return {
    id: uid(),
    elements: [
      { id: uid(), kind: 'rect', x: 0, y: 0, w: A4_W, h: A4_H, z: 0, fill: '#ffffff', borderWidth: 0 },
      { id: uid(), kind: 'rect', x: 0, y: 0, w: A4_W, h: 74, z: 1, fill: c, borderWidth: 0 },
      { id: uid(), kind: 'rect', x: 0, y: 74, w: A4_W, h: 3.5, z: 1, fill: '#111827', borderWidth: 0 },
      T({ x: 20, y: 24, w: 170, h: 12, z: 2, text: '2026 여름방학 특강', fontSize: 15, bold: true, color: '#ffffff' }),
      T({ x: 20, y: 38, w: 170, h: 22, z: 2, text: opts.title, fontSize: 34, bold: true, color: '#ffffff' }),
      { id: uid(), kind: 'rect', x: 20, y: 96, w: 42, h: 12, z: 2, fill: c, radius: 6, borderWidth: 0 },
      T({ x: 20, y: 99, w: 42, h: 8, z: 3, text: opts.level, fontSize: 13, bold: true, align: 'center', color: '#ffffff' }),
      T({ x: 20, y: 118, w: 170, h: 10, z: 2, text: opts.subtitle, fontSize: 14, color: '#374151' }),
      T({ x: 20, y: 132, w: 170, h: 44, z: 2, fontSize: 11.5, color: '#4b5563', lineHeight: 1.7, text: '1회차  문장의 구조\n2회차  수동태\n3회차  관계사\n4회차  접속사\n5회차  to부정사\n6회차  동명사\n7회차  분사·분사구문\n8회차  가정법' }),
      T({ x: 20, y: 255, w: 100, h: 8, z: 2, text: '이름 : ______________________', fontSize: 12, color: '#111827' }),
      T({ x: 20, y: 270, w: 170, h: 8, z: 2, text: opts.academy ?? '', fontSize: 12, bold: true, color: '#111827' }),
      { id: uid(), kind: 'rect', x: 0, y: 288, w: A4_W, h: 9, z: 1, fill: '#111827', borderWidth: 0 },
    ],
  };
}

/** 회차(단원) 페이지 — 샘플 PDF의 개요식 개념정리 레이아웃 */
function buildUnitPage(u: Unit, level: StudioDifficulty): StudioPage {
  const c = LEVEL_COLOR[level];
  const pointsText = u.c[level].points.map((p) => `✔  ${p}`).join('\n');
  const exText = u.c[level].examples.map((e, i) => `${i + 1}. ${e}`).join('\n');
  return {
    id: uid(),
    elements: [
      // 헤더
      { id: uid(), kind: 'rect', x: 0, y: 0, w: A4_W, h: 20, z: 0, fill: '#ffffff', borderWidth: 0 },
      T({ x: 15, y: 8, w: 130, h: 12, z: 2, text: `${u.no}회차  ${u.title}`, fontSize: 20, bold: true, color: '#111827' }),
      T({ x: 150, y: 12, w: 45, h: 8, z: 2, text: `${u.en} · ${level}`, fontSize: 9, align: 'right', color: c }),
      { id: uid(), kind: 'line', x: 15, y: 22, w: 180, h: 1.2, z: 1, fill: c, borderWidth: 0 },
      // 개념 정리
      { id: uid(), kind: 'rect', x: 15, y: 28, w: 25, h: 8, z: 1, fill: c, radius: 2, borderWidth: 0 },
      T({ x: 15, y: 30, w: 25, h: 6, z: 2, text: '개념 정리', fontSize: 10, bold: true, align: 'center', color: '#ffffff' }),
      T({ x: 15, y: 40, w: 180, h: 62, z: 1, text: pointsText, fontSize: 11, lineHeight: 1.75, color: '#111827' }),
      // 대표 예문
      { id: uid(), kind: 'rect', x: 15, y: 108, w: 25, h: 8, z: 1, fill: '#111827', radius: 2, borderWidth: 0 },
      T({ x: 15, y: 110, w: 25, h: 6, z: 2, text: '대표 예문', fontSize: 10, bold: true, align: 'center', color: '#ffffff' }),
      { id: uid(), kind: 'rect', x: 15, y: 120, w: 180, h: 34, z: 0, fill: '#f8fafc', borderColor: '#e2e8f0', borderWidth: 0.3, radius: 2 },
      T({ x: 19, y: 124, w: 172, h: 26, z: 1, text: exText, fontSize: 10.5, lineHeight: 1.7, color: '#1f2937' }),
      // 필기 공간
      T({ x: 15, y: 160, w: 60, h: 6, z: 1, text: '📝 판서 · 필기', fontSize: 10, bold: true, color: '#6b7280' }),
      { id: uid(), kind: 'rect', x: 15, y: 168, w: 180, h: 62, z: 0, fill: '#ffffff', borderColor: '#d1d5db', borderWidth: 0.3, radius: 2 },
      // 연습 문제 안내
      { id: uid(), kind: 'rect', x: 15, y: 236, w: 25, h: 8, z: 1, fill: c, radius: 2, borderWidth: 0 },
      T({ x: 15, y: 238, w: 25, h: 6, z: 2, text: '연습 문제', fontSize: 10, bold: true, align: 'center', color: '#ffffff' }),
      T({ x: 15, y: 248, w: 180, h: 12, z: 1, text: '「문제 불러오기」로 내 문제은행의 문제를 이 자리에 배치하세요.', fontSize: 9.5, color: '#9ca3af' }),
      // 푸터
      { id: uid(), kind: 'line', x: 15, y: 286, w: 180, h: 1, z: 1, fill: '#9f1239', borderWidth: 0 },
      T({ x: 15, y: 289, w: 180, h: 6, z: 1, text: `${u.no}`, fontSize: 10, align: 'right', color: '#6b7280' }),
    ],
  };
}

/** 여름방학 문법특강 시드 문서 (표지 + 8회차) */
export function buildGrammarSeedDoc(level: StudioDifficulty): StudioDocPayload {
  return {
    title: `2026 여름방학 문법특강 (${level})`,
    subtitle: '중등 내신 문법 8회차 완성',
    difficulty: level,
    pages: [
      buildCoverPage({ title: '중등 문법 특강', subtitle: '한 달 8회차 · 내신 문법 완성', level }),
      ...UNITS.map((u) => buildUnitPage(u, level)),
    ],
  };
}
