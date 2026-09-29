/**
 * 학습 플랜 — 시험범위를 정한 회원이 「지문마다 어떤 순서로 공부시킬지」를 정하고 진도를 체크한다.
 *
 * 플랜 = 단계(구조화 → 문장분석 → …)의 순서, 단계 = 활동 몇 개.
 * 활동은 우리 도구(클래스키트 수업 화면·수업용자료·영작하기… / 유형별 실전 문항)로 바로 열린다.
 * 회원이 플랜을 안 만들었으면 관리자 기본 설계(DEFAULT_STUDY_PLAN)를 쓴다.
 */
import type { Db, ObjectId } from 'mongodb';
import { mockExamOrderKeyToPassageTextbookCandidates } from '@/lib/mock-variant-order';

export const STUDY_PLANS_COLLECTION = 'member_study_plans';
export const STUDY_PROGRESS_COLLECTION = 'member_study_progress';

/** 활동이 여는 화면 — 클래스키트 경로(routeBase 뒤) + 쿼리 */
export type StudyActivity = { key: string; label: string; path: string; qtype?: string };

export const STUDY_ACTIVITIES: readonly StudyActivity[] = [
  { key: 'live-overview', label: '주제·요지·흐름', path: '/live' },
  { key: 'live-sentence', label: '문장 분석·끊어읽기', path: '/live' },
  { key: 'live-listen', label: '지문 듣기', path: '/live' },
  { key: 'lecture', label: '강의용자료(판서)', path: '/lecture' },
  { key: 'lesson-parallel', label: '영한 대조', path: '/lesson' },
  { key: 'lesson-line', label: '한줄해석', path: '/lesson/line' },
  { key: 'lesson-write-ko', label: '해석쓰기', path: '/lesson/write-ko' },
  { key: 'lesson-write-en', label: '영작하기', path: '/lesson/write-en' },
  ...(['어휘', '어법', '주제', '제목', '주장', '일치', '불일치', '함의', '빈칸', '요약', '순서', '삽입', '무관한문장'] as const).map(
    (t): StudyActivity => ({ key: `q-${t}`, label: `${t} 문항`, path: '/live', qtype: t }),
  ),
  ...(['어휘-고난도', '어법-고난도', '빈칸-고난도', '순서-고난도', '삽입-고난도'] as const).map(
    (t): StudyActivity => ({ key: `q-${t}`, label: `${t.replace('-고난도', '')} 고난도`, path: '/live', qtype: t }),
  ),
];

const ACTIVITY_BY_KEY = new Map(STUDY_ACTIVITIES.map((a) => [a.key, a]));
export const studyActivity = (key: string) => ACTIVITY_BY_KEY.get(key);

export type StudyStep = { id: string; title: string; items: string[] };
export type StudyPlan = { name: string; steps: StudyStep[] };

/** 관리자 기본 설계 — 7단계 */
export const DEFAULT_STUDY_PLAN: StudyPlan = {
  name: '관리자 기본 설계 · 7단계',
  steps: [
    { id: 's1', title: '구조화', items: ['live-overview', 'live-listen'] },
    { id: 's2', title: '문장분석', items: ['live-sentence', 'lesson-line', 'lesson-parallel'] },
    { id: 's3', title: '어휘', items: ['q-어휘', 'q-어휘-고난도'] },
    { id: 's4', title: '어법', items: ['q-어법', 'q-어법-고난도'] },
    { id: 's5', title: '영작', items: ['lesson-write-ko', 'lesson-write-en'] },
    { id: 's6', title: '실전유형 1', items: ['q-주제', 'q-제목', 'q-주장', 'q-일치', 'q-불일치'] },
    { id: 's7', title: '실전유형 2', items: ['q-빈칸', 'q-요약', 'q-순서', 'q-삽입', 'q-무관한문장', 'q-함의'] },
  ],
};

const MAX_STEPS = 12;
const MAX_ITEMS = 12;

/** 저장 전 정리 — 모르는 활동·빈 단계·중복은 버린다 */
export function sanitizeStudyPlan(raw: unknown): StudyPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { name?: unknown; steps?: unknown };
  if (!Array.isArray(r.steps)) return null;
  const steps: StudyStep[] = [];
  const seenIds = new Set<string>();
  for (const s of r.steps.slice(0, MAX_STEPS)) {
    if (!s || typeof s !== 'object') continue;
    const st = s as { id?: unknown; title?: unknown; items?: unknown };
    const title = String(st.title ?? '').trim().slice(0, 20);
    const items = [...new Set((Array.isArray(st.items) ? st.items : []).map(String))].filter((k) => ACTIVITY_BY_KEY.has(k)).slice(0, MAX_ITEMS);
    if (!title || items.length === 0) continue;
    let id = String(st.id ?? '').trim().slice(0, 12) || `s${steps.length + 1}`;
    while (seenIds.has(id)) id = `${id}x`;
    seenIds.add(id);
    steps.push({ id, title, items });
  }
  if (steps.length === 0) return null;
  const name = String(r.name ?? '').trim().slice(0, 30) || '내 기본 플랜';
  return { name, steps };
}

export type ScopeEntry = { type?: string; textbookKey?: string; displayName?: string; selectedSources?: string[] };
export type ScopePassage = { id: string; textbook: string; sourceKey: string; label: string; isMock: boolean };

/** 시험범위(dbEntries) → 지문 목록. 고른 순서를 지킨다. */
export async function resolveScopePassages(db: Db, entries: readonly ScopeEntry[]): Promise<ScopePassage[]> {
  const out: ScopePassage[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const srcs = (e.selectedSources ?? []).map((s) => String(s).trim()).filter(Boolean);
    const key = String(e.textbookKey ?? '').trim();
    if (!key || srcs.length === 0) continue;
    const isMock = e.type === 'mockexam';
    const textbooks = isMock ? mockExamOrderKeyToPassageTextbookCandidates(key) : [key];
    const docs = await db
      .collection<{ _id: ObjectId; textbook?: string; source_key?: string; number?: string }>('passages')
      .find({ textbook: { $in: textbooks }, source_key: { $in: srcs } })
      .project<{ _id: ObjectId; textbook?: string; source_key?: string }>({ _id: 1, textbook: 1, source_key: 1 })
      .toArray();
    const bySrc = new Map(docs.map((d) => [String(d.source_key ?? ''), d]));
    for (const s of srcs) {
      const d = bySrc.get(s);
      if (!d || seen.has(String(d._id))) continue;
      seen.add(String(d._id));
      out.push({
        id: String(d._id),
        textbook: String(d.textbook ?? key),
        sourceKey: s,
        label: isMock ? s.replace(/^.*영어모의고사\s*/, '') || s : s,
        isMock,
      });
    }
  }
  return out;
}

/** 진도 문서 키 — 시험범위 하나(프리셋·학교 슬롯) 안의 지문 하나 */
export type StudyScopeRef = { kind: 'preset' | 'school'; id: string };
export function parseScopeRef(raw: string | null | undefined): StudyScopeRef | null {
  const m = /^(preset|school):([a-f0-9]{24})$/i.exec(String(raw ?? '').trim());
  return m ? { kind: m[1].toLowerCase() as StudyScopeRef['kind'], id: m[2].toLowerCase() } : null;
}
