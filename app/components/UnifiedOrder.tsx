'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTextbooksData } from '@/lib/useTextbooksData';
import { isEbsTextbook } from '@/lib/textbookSort';
import { BOOK_VARIANT_QUESTION_TYPES } from '@/lib/book-variant-types';
import { saveOrderToDb, MEMBER_DEPOSIT_ACCOUNT } from '@/lib/orders';
import { membershipPricingOneLiner } from '@/lib/membership-pricing';
import AppBar from './AppBar';

/* ────────────────────────────────────────────────────────── */
/*  상수 / 유틸                                               */
/* ────────────────────────────────────────────────────────── */

const MOCK_EXAM_NUMBERS = [
  '18번', '19번', '20번', '21번', '22번', '23번', '24번', '25번',
  '26번', '27번', '28번', '29번', '30번', '31번', '32번', '33번',
  '34번', '35번', '36번', '37번', '38번', '39번', '40번',
  '41~42번', '43~45번',
];

const LS_KEY = 'exam_scope_presets';
const MAX_LS_PRESETS = 5;

/** "고1_2026_03월(서울시)" → "26년 3월 고1 영어모의고사" */
function mockExamDisplayName(key: string): string {
  const m = key.match(/^고(\d)_(\d{4})_(\d{2})월/);
  if (!m) return key;
  const [, grade, year, month] = m;
  return `${Number(year) - 2000}년 ${Number(month)}월 고${grade} 영어모의고사`;
}

function pricePerQuestion(type: string): number {
  if (type === '순서' || type === '삽입' || type === '삽입-고난도') return 80;
  return 50;
}

/* ────────────────────────────────────────────────────────── */
/*  타입                                                       */
/* ────────────────────────────────────────────────────────── */

interface DbEntry {
  id: string;
  type: 'textbook' | 'mockexam';
  textbookCategory?: 'ebs' | 'solbook-textbook' | 'solbook-suppl';
  textbookKey: string;
  displayName: string;
  lessonGroups: Record<string, string[]>;
  selectedSources: string[];
}

interface ExamScopePreset {
  id: string;
  name: string;
  dbEntries: Omit<DbEntry, 'id' | 'lessonGroups'>[];
  savedAt: string;
}

/** 마이페이지 「학교 관리」에서 학년도·학기별로 저장한 범위 */
interface SchoolExamSlot {
  id: string;
  schoolId: string;
  schoolName: string;
  schoolYear: string;
  semester: string;
  dbEntries: ExamScopePreset['dbEntries'];
  updatedAt: string;
}

interface TextbookContent {
  [lessonKey: string]: { 번호: string }[];
}

interface TextbookStructure {
  Sheet1?: { 부교재?: Record<string, TextbookContent> };
  '지문 데이터'?: { 부교재?: Record<string, TextbookContent> };
  부교재?: Record<string, TextbookContent>;
  [key: string]: unknown;
}

type Phase = 1 | 2 | 3;

/* ────────────────────────────────────────────────────────── */
/*  헬퍼: 교재 데이터 → lessonGroups                          */
/* ────────────────────────────────────────────────────────── */

function extractLessonGroups(
  textbooksData: Record<string, unknown>,
  textbookKey: string,
): Record<string, string[]> {
  const raw = textbooksData[textbookKey] as TextbookStructure | undefined;
  if (!raw) return {};

  const pickFirst = (sub?: Record<string, TextbookContent>) => {
    if (!sub) return null;
    if (sub[textbookKey]) return sub[textbookKey];
    const keys = Object.keys(sub);
    return keys.length > 0 ? sub[keys[0]] : null;
  };

  let actualData: TextbookContent | null =
    pickFirst(raw.Sheet1?.부교재) ??
    pickFirst(raw['지문 데이터']?.부교재) ??
    pickFirst(raw.부교재);

  if (!actualData) {
    const rawRecord = raw as Record<string, Record<string, Record<string, TextbookContent>>>;
    for (const outerKey of Object.keys(rawRecord)) {
      const outerVal = rawRecord[outerKey];
      if (outerVal && typeof outerVal === 'object' && outerVal['부교재']) {
        actualData = pickFirst(outerVal['부교재']);
        if (actualData) break;
      }
    }
  }

  if (!actualData) return {};

  const groups: Record<string, string[]> = {};
  for (const lessonKey of Object.keys(actualData)) {
    const items = actualData[lessonKey];
    if (!Array.isArray(items)) continue;
    groups[lessonKey] = items.map((item) => `${lessonKey} ${item.번호}`);
  }
  return groups;
}

/* ────────────────────────────────────────────────────────── */
/*  모의고사 lessonGroups 빌더                                 */
/* ────────────────────────────────────────────────────────── */

function buildMockLessonGroups(displayName: string): Record<string, string[]> {
  return {
    [displayName]: MOCK_EXAM_NUMBERS.map((n) => `${displayName} ${n}`),
  };
}

function flattenLessonGroups(groups: Record<string, string[]>): string[] {
  return Object.values(groups).flat();
}

/**
 * 예전/외부 저장본에서 `selectedSources`가 `${textbookKey} 18번` 형태인 경우가 있어,
 * 현재 lessonGroups의 `${displayName} 18번`과 맞지 않아 체크가 안 보이는 문제를 보정한다.
 */
function remapOrphanMockSource(
  orphan: string,
  textbookKey: string,
  displayName: string,
  validSources: string[]
): string | null {
  const t = orphan.trim();
  if (validSources.includes(t)) return t;
  const prefix = `${textbookKey.trim()} `;
  if (t.startsWith(prefix)) {
    const suffix = t.slice(prefix.length).trimStart();
    const c = `${displayName} ${suffix}`;
    if (validSources.includes(c)) return c;
  }
  const last = t.split(/\s+/).pop() ?? '';
  if (last && MOCK_EXAM_NUMBERS.includes(last)) {
    const c = `${displayName} ${last}`;
    if (validSources.includes(c)) return c;
  }
  return null;
}

function sanitizeMockExamEntry(entry: DbEntry): DbEntry {
  if (entry.type !== 'mockexam') return entry;
  const valid = flattenLessonGroups(entry.lessonGroups);
  if (valid.length === 0) return entry;
  const next: string[] = [];
  const seen = new Set<string>();
  for (const s of entry.selectedSources) {
    if (valid.includes(s)) {
      if (!seen.has(s)) {
        seen.add(s);
        next.push(s);
      }
      continue;
    }
    const m = remapOrphanMockSource(s, entry.textbookKey, entry.displayName, valid);
    if (m && !seen.has(m)) {
      seen.add(m);
      next.push(m);
    }
  }
  return { ...entry, selectedSources: next };
}

/* ────────────────────────────────────────────────────────── */
/*  localStorage 시험범위 헬퍼                                 */
/* ────────────────────────────────────────────────────────── */

function lsLoadPresets(): ExamScopePreset[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ExamScopePreset[];
  } catch {
    return [];
  }
}

function lsSavePreset(preset: ExamScopePreset) {
  try {
    const existing = lsLoadPresets().filter((p) => p.id !== preset.id);
    const updated = [preset, ...existing].slice(0, MAX_LS_PRESETS);
    localStorage.setItem(LS_KEY, JSON.stringify(updated));
  } catch {}
}

function lsDeletePreset(id: string) {
  try {
    const updated = lsLoadPresets().filter((p) => p.id !== id);
    localStorage.setItem(LS_KEY, JSON.stringify(updated));
  } catch {}
}

/* ────────────────────────────────────────────────────────── */
/*  작은 UI 컴포넌트                                           */
/* ────────────────────────────────────────────────────────── */

function StepBadge({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${
        done
          ? 'bg-green-500 text-white'
          : active
          ? 'bg-purple-700 text-white'
          : 'bg-gray-200 text-gray-500'
      }`}
    >
      {done ? '✓' : n}
    </div>
  );
}

function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-gray-900 px-5 py-3 text-sm font-medium text-white shadow-xl">
      {msg}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  메인 컴포넌트                                              */
/* ────────────────────────────────────────────────────────── */

export default function UnifiedOrder() {
  const router = useRouter();
  const { data: textbooksData, loading: tbLoading } = useTextbooksData();

  /* ── 단계 ── */
  const [phase, setPhase] = useState<Phase>(1);

  /* ── DB 목록 ── */
  const [dbEntries, setDbEntries] = useState<DbEntry[]>([]);

  /* ── Phase1: 교재/모의고사 추가 UI ── */
  const [mockExamsData, setMockExamsData] = useState<Record<string, string[]>>({});
  const [showAddEbs, setShowAddEbs] = useState(false);
  const [showAddMock, setShowAddMock] = useState(false);
  const [showExternalNotice, setShowExternalNotice] = useState(false);
  const [tbSearch, setTbSearch] = useState('');

  /* ── 시험범위 프리셋 / 프리미엄 ── */
  const [authChecked, setAuthChecked] = useState(false);
  const [premiumOk, setPremiumOk] = useState(false);
  const [hasUser, setHasUser] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [presets, setPresets] = useState<ExamScopePreset[]>([]);
  /** 저장된 시험범위가 있을 때는 처음부터 펼침(닫기로 접을 수 있음) */
  const [showPresets, setShowPresets] = useState(true);
  const [savingScope, setSavingScope] = useState(false);
  const [scopeName, setScopeName] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [schoolSlots, setSchoolSlots] = useState<SchoolExamSlot[]>([]);

  /* ── Phase2: 펼침 상태 ── */
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  /* ── Phase3: 문제 설정 ── */
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [questionsPerTypeMap, setQuestionsPerTypeMap] = useState<Record<string, number>>({});
  const [bulkCount, setBulkCount] = useState(3);
  const [orderInsertExplanation, setOrderInsertExplanation] = useState<{
    순서: boolean;
    삽입: boolean;
  }>({ 순서: true, 삽입: true });
  const [email, setEmail] = useState('');
  const [userPoints, setUserPoints] = useState(0);
  const [pointsToUse, setPointsToUse] = useState(0);
  const [showPointModal, setShowPointModal] = useState(false);
  const [solbookRetailGuideText, setSolbookRetailGuideText] = useState('');

  const hasSolbookInOrder = useMemo(
    () =>
      dbEntries.some(
        (e) =>
          e.type === 'textbook' &&
          (e.textbookCategory === 'solbook-textbook' || e.textbookCategory === 'solbook-suppl')
      ),
    [dbEntries]
  );

  /* ── 토스트 ── */
  const [toast, setToast] = useState('');

  /* ── 초기 로드 ── */
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const u = d?.user;
        setHasUser(!!u);
        setPremiumOk(!!u && u.isPremiumMember === true);
        setIsMember(!!u && u.role !== 'admin');
        setUserPoints(typeof u?.points === 'number' && u.points >= 0 ? u.points : 0);
        if (u?.email) setEmail(u.email);
      })
      .catch(() => {
        setHasUser(false);
        setPremiumOk(false);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!premiumOk) return;
    fetch('/api/settings/variant-solbook', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setSolbookRetailGuideText(
          typeof d?.retailPriceGuideText === 'string' ? d.retailPriceGuideText.trim() : ''
        );
      })
      .catch(() => {});
  }, [premiumOk]);

  useEffect(() => {
    if (!hasSolbookInOrder) return;
    setPointsToUse(0);
  }, [hasSolbookInOrder]);

  useEffect(() => {
    import('@/app/data/mock-exams.json').then((mod) => {
      setMockExamsData(mod.default as Record<string, string[]>);
    });
  }, []);

  /* ── 시험범위 불러오기 ── */
  const loadPresets = useCallback(async () => {
    if (isMember) {
      try {
        const res = await fetch('/api/my/exam-scope', { credentials: 'include' });
        const data = await res.json();
        if (res.ok && Array.isArray(data.presets)) {
          setPresets(data.presets);
          return;
        }
      } catch {}
    }
    setPresets(lsLoadPresets());
  }, [isMember]);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  const loadSchoolSlots = useCallback(async () => {
    try {
      const res = await fetch('/api/my/school-exam-scopes', { credentials: 'include' });
      const data = await res.json();
      if (res.ok && Array.isArray(data.slots)) {
        setSchoolSlots(
          data.slots.map((s: Record<string, unknown>) => ({
            id: String(s.id ?? ''),
            schoolId: String(s.schoolId ?? ''),
            schoolName: String(s.schoolName ?? ''),
            schoolYear: String(s.schoolYear ?? ''),
            semester: String(s.semester ?? ''),
            dbEntries: (Array.isArray(s.dbEntries) ? s.dbEntries : []) as ExamScopePreset['dbEntries'],
            updatedAt: String(s.updatedAt ?? ''),
          }))
        );
      } else {
        setSchoolSlots([]);
      }
    } catch {
      setSchoolSlots([]);
    }
  }, []);

  useEffect(() => {
    if (phase === 1) void loadSchoolSlots();
  }, [phase, loadSchoolSlots]);

  /* ── DB 추가 핸들러 ── */
  const handleAddTextbook = (key: string, category: 'ebs' | 'solbook-textbook' | 'solbook-suppl') => {
    if (!textbooksData) return;
    if (dbEntries.some((e) => e.textbookKey === key && e.type === 'textbook')) {
      setToast('이미 추가된 교재입니다.');
      return;
    }
    const groups = extractLessonGroups(textbooksData, key);
    const entry: DbEntry = {
      id: `tb-${Date.now()}-${Math.random()}`,
      type: 'textbook',
      textbookCategory: category,
      textbookKey: key,
      displayName: key,
      lessonGroups: groups,
      selectedSources: [],
    };
    setDbEntries((prev) => [...prev, entry]);
    setShowAddEbs(false);
    setTbSearch('');
  };

  const handleAddMockExam = (key: string) => {
    if (dbEntries.some((e) => e.textbookKey === key && e.type === 'mockexam')) {
      setToast('이미 추가된 모의고사입니다.');
      return;
    }
    const displayName = mockExamDisplayName(key);
    const entry: DbEntry = {
      id: `mock-${Date.now()}-${Math.random()}`,
      type: 'mockexam',
      textbookKey: key,
      displayName,
      lessonGroups: buildMockLessonGroups(displayName),
      selectedSources: [],
    };
    setDbEntries((prev) => [...prev, entry]);
    setShowAddMock(false);
  };

  const handleRemoveDb = (id: string) => {
    setDbEntries((prev) => prev.filter((e) => e.id !== id));
  };

  /* ── Source 선택 ── */
  /**
   * 같은 강(group) 안에서: 일반 클릭은 그 강에서는 해당 지문만 선택(단일),
   * ⌘(Mac)·Ctrl(Windows) 누른 채 클릭이면 토글로 여러 지문을 겹쳐 선택.
   */
  const pickSourceWithModifier = (dbId: string, groupKey: string, source: string, multi: boolean) => {
    setDbEntries((prev) =>
      prev.map((e) => {
        if (e.id !== dbId) return e;
        const groupSources = e.lessonGroups[groupKey] ?? [];
        /* 모의고사는 그룹이 시험 전체 1개라, 부교재처럼 "강당 1개만" 로직을 쓰면 번호별 선택이 불가능함 → 항상 토글 */
        if (e.type === 'mockexam' || multi) {
          const has = e.selectedSources.includes(source);
          return {
            ...e,
            selectedSources: has
              ? e.selectedSources.filter((s) => s !== source)
              : [...e.selectedSources, source],
          };
        }
        const selectedInGroup = groupSources.filter((s) => e.selectedSources.includes(s));
        const onlyThisSelected = selectedInGroup.length === 1 && selectedInGroup[0] === source;
        if (onlyThisSelected) {
          return {
            ...e,
            selectedSources: e.selectedSources.filter((s) => s !== source),
          };
        }
        const outsideGroup = e.selectedSources.filter((s) => !groupSources.includes(s));
        return {
          ...e,
          selectedSources: [...outsideGroup, source],
        };
      })
    );
  };

  const toggleGroup = (dbId: string, groupKey: string) => {
    setDbEntries((prev) =>
      prev.map((e) => {
        if (e.id !== dbId) return e;
        const groupSources = e.lessonGroups[groupKey] ?? [];
        const allSel = groupSources.every((s) => e.selectedSources.includes(s));
        return {
          ...e,
          selectedSources: allSel
            ? e.selectedSources.filter((s) => !groupSources.includes(s))
            : [...new Set([...e.selectedSources, ...groupSources])],
        };
      })
    );
  };

  /* ── 시험범위 저장 ── */
  const handleSaveScope = async () => {
    if (!scopeName.trim()) return;
    setSavingScope(true);
    const data: Omit<ExamScopePreset, 'id'> = {
      name: scopeName.trim(),
      dbEntries: dbEntries.map(({ type, textbookKey, displayName, selectedSources, textbookCategory }) => ({
        type,
        textbookKey,
        displayName,
        selectedSources,
        ...(textbookCategory ? { textbookCategory } : {}),
      })),
      savedAt: new Date().toISOString(),
    };

    if (isMember) {
      try {
        const res = await fetch('/api/my/exam-scope', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(data),
        });
        const json = await res.json();
        if (res.ok) {
          setToast(`"${scopeName}" 저장 완료`);
          await loadPresets();
        } else {
          setToast(json.error ?? '저장 실패');
        }
      } catch {
        setToast('저장에 실패했습니다.');
      }
    } else {
      const preset: ExamScopePreset = {
        id: `ls-${Date.now()}`,
        ...data,
      };
      lsSavePreset(preset);
      setPresets(lsLoadPresets());
      setToast(`"${scopeName}" 저장 완료 (로컬)`);
    }

    setSavingScope(false);
    setShowSaveModal(false);
    setScopeName('');
  };

  /* ── 시험범위 불러오기 적용 ── */
  const applyPreset = (preset: ExamScopePreset) => {
    if (!textbooksData) return;
    const withoutSolbook = preset.dbEntries.filter((e) => {
      if (e.type !== 'textbook') return true;
      const c = e.textbookCategory;
      return c !== 'solbook-textbook' && c !== 'solbook-suppl';
    });
    if (withoutSolbook.length === 0) {
      setToast('불러올 항목이 없습니다. 파이널 예비 모의고사에서는 쏠북 교재를 제외합니다.');
      return;
    }
    if (withoutSolbook.length < preset.dbEntries.length) {
      setToast(`"${preset.name}" 불러오기: 쏠북 교재 항목은 제외했습니다.`);
    } else {
      setToast(`"${preset.name}" 불러오기 완료`);
    }
    const restored: DbEntry[] = withoutSolbook.map((e) => {
      const base: DbEntry = {
        id: `${e.type}-${Date.now()}-${Math.random()}`,
        type: e.type,
        textbookKey: e.textbookKey,
        displayName: e.displayName,
        textbookCategory: e.type === 'textbook' ? e.textbookCategory : undefined,
        lessonGroups:
          e.type === 'textbook'
            ? extractLessonGroups(textbooksData, e.textbookKey)
            : buildMockLessonGroups(e.displayName),
        selectedSources: e.selectedSources,
      };
      return e.type === 'mockexam' ? sanitizeMockExamEntry(base) : base;
    });
    setDbEntries(restored);
    setShowPresets(false);
    setPhase(2);
  };

  /* ── 시험범위 삭제 ── */
  const deletePreset = async (id: string) => {
    if (isMember) {
      try {
        await fetch(`/api/my/exam-scope?id=${id}`, { method: 'DELETE', credentials: 'include' });
      } catch {}
    } else {
      lsDeletePreset(id);
    }
    setPresets((prev) => prev.filter((p) => p.id !== id));
  };

  /* ── Phase3: 유형 선택 ── */
  const toggleType = (t: string) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
    setQuestionsPerTypeMap((prev) =>
      prev[t] !== undefined ? prev : { ...prev, [t]: 3 }
    );
  };

  const setTypeCount = (t: string, v: number) => {
    setQuestionsPerTypeMap((prev) => ({ ...prev, [t]: Math.min(10, Math.max(1, v)) }));
  };

  const applyBulk = () => {
    const map: Record<string, number> = {};
    selectedTypes.forEach((t) => { map[t] = bulkCount; });
    setQuestionsPerTypeMap(map);
  };

  /* ── 가격 계산 ── */
  const totalSources = dbEntries.reduce((sum, e) => sum + e.selectedSources.length, 0);

  const totalPrice = selectedTypes.reduce((sum, t) => {
    const cnt = questionsPerTypeMap[t] ?? 3;
    return sum + pricePerQuestion(t) * cnt * totalSources;
  }, 0);

  const effectivePointsDeduction = hasSolbookInOrder ? 0 : pointsToUse;
  const finalPrice = Math.max(0, totalPrice - effectivePointsDeduction);

  /* ── 주문 제출 ── */
  const handleSubmit = async () => {
    if (selectedTypes.length === 0) { alert('유형을 선택해주세요.'); return; }
    if (!email.trim()) { alert('이메일을 입력해주세요.'); return; }
    if (totalSources === 0) { alert('지문을 선택해주세요.'); return; }

    const dbSummary = dbEntries
      .filter((e) => e.selectedSources.length > 0)
      .map((e) => `[${e.displayName}] ${e.selectedSources.join(', ')}`)
      .join('\n');

    const typesSummary = selectedTypes
      .map((t) => `${t} ${questionsPerTypeMap[t] ?? 3}문항`)
      .join(', ');

    const orderText = [
      '=== 파이널 예비 모의고사 주문 (UV) ===',
      '',
      '[ 시험 범위 ]',
      dbSummary,
      '',
      '[ 유형 및 문항수 ]',
      typesSummary,
      '',
      `순서·삽입 해설: 순서 ${orderInsertExplanation.순서 ? '포함' : '미포함'}, 삽입 ${orderInsertExplanation.삽입 ? '포함' : '미포함'}`,
      `이메일: ${email.trim()}`,
      `총 지문 수: ${totalSources}개`,
      `예상 금액(변형 제작료): ${finalPrice.toLocaleString()}원`,
      ...(hasSolbookInOrder
        ? [
            '',
            '[ 쏠북 교재 포함 시 안내 ]',
            '· 위 금액은 변형 문제 제작·연동에 대한 금액이며, 쏠북에서 판매하는 교재 본체(인쇄본·전자본 등) 구매 대금은 포함되지 않습니다.',
            '· 쏠북 교재가 시험 범위에 포함된 경우 포인트 사용은 적용되지 않습니다.',
            solbookRetailGuideText.trim()
              ? `· 쏠북 교재 본체 예상 금액(참고): ${solbookRetailGuideText.trim()}`
              : '· 교재 본체 가격은 쏠북 정책에 따르므로, 쏠북 또는 안내 링크에서 확인해 주세요.',
          ]
        : []),
    ].join('\n');

    const orderMeta = {
      flow: 'unifiedVariant',
      version: 1,
      dbEntries: dbEntries.map(({ type, textbookKey, displayName, selectedSources, textbookCategory }) => ({
        type,
        textbookKey,
        displayName,
        selectedSources,
        ...(textbookCategory ? { textbookCategory } : {}),
      })),
      selectedTypes,
      questionsPerTypeMap,
      orderInsertExplanation,
      email: email.trim(),
      ...(hasSolbookInOrder
        ? {
            solbookOrderNotes: {
              pointsDisabled: true,
              depositScopeNote: '변형 제작료만 입금 대상(쏠북 교재 본체 별도)',
              retailPriceGuideText: solbookRetailGuideText || undefined,
            },
          }
        : {}),
    };

    const res = await saveOrderToDb(
      orderText,
      'UV',
      hasSolbookInOrder ? undefined : pointsToUse || undefined,
      orderMeta
    );
    if (res.ok && res.id) {
      router.push('/order/done?id=' + res.id);
    } else {
      alert('주문 저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  /* ──────────────────────────────────────────────────────── */
  /*  렌더: 공통 헤더                                          */
  /* ──────────────────────────────────────────────────────── */

  if (!authChecked) {
    return (
      <>
        <AppBar title="파이널 예비 모의고사" showBackButton />
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-3">
          <div className="animate-spin w-10 h-10 border-4 border-purple-200 border-t-purple-600 rounded-full" />
          <p className="text-sm text-gray-500">회원 정보 확인 중…</p>
        </div>
      </>
    );
  }

  if (!premiumOk) {
    return (
      <>
        <AppBar title="파이널 예비 모의고사" showBackButton />
        <div
          className="min-h-screen flex items-center justify-center px-4"
          style={{
            background: 'linear-gradient(160deg, #1a1a6e 0%, #4b0082 45%, #312e81 100%)',
          }}
        >
          <div className="max-w-md w-full rounded-2xl bg-white/95 shadow-xl p-8 text-center space-y-4">
            <h1 className="text-xl font-extrabold text-gray-900">파이널 예비 모의고사</h1>
            {!hasUser ? (
              <p className="text-sm text-gray-600">
                이 기능은 <strong>로그인</strong> 후, <strong>연회원 또는 월구독</strong> 회원만 이용할 수 있습니다.
              </p>
            ) : (
              <p className="text-sm text-gray-600">
                이 기능은 <strong>연회원</strong> 또는 <strong>월구독</strong> 회원만 이용할 수 있습니다.
                <br />
                가입·이용 문의는 카카오톡으로 연락 주시면 안내해 드립니다.
                <br />
                <span className="text-xs text-gray-500 mt-2 inline-block">{membershipPricingOneLiner()}</span>
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
              {!hasUser ? (
                <Link
                  href="/login?from=/unified"
                  className="inline-flex justify-center rounded-xl bg-purple-700 px-5 py-3 text-sm font-bold text-white hover:bg-purple-800"
                >
                  로그인
                </Link>
              ) : null}
              <Link
                href="/my"
                className="inline-flex justify-center rounded-xl border border-purple-300 px-5 py-3 text-sm font-semibold text-purple-800 hover:bg-purple-50"
              >
                내 정보
              </Link>
              <Link
                href="/"
                className="inline-flex justify-center rounded-xl border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                홈으로
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  const header = (
    <div
      className="relative overflow-hidden px-6 py-8 text-white"
      style={{
        background: 'linear-gradient(120deg, #1a1a6e 0%, #4b0082 55%, #7c3aed 100%)',
      }}
    >
      <div className="relative z-10 mx-auto max-w-5xl">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-purple-300 hover:text-white text-sm transition-colors">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
            </svg>
            홈으로
          </Link>
        </div>
        <div className="mt-3 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="rounded-full bg-yellow-400 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-gray-900">
                NEW
              </span>
              <h1 className="text-2xl font-extrabold tracking-tight">파이널 예비 모의고사</h1>
            </div>
            <p className="text-sm text-purple-200">
              부교재 + 모의고사를 한 번에 조합하여 시험 범위 맞춤 예비 시험지를 제작합니다
            </p>
          </div>
        </div>

        {/* 단계 인디케이터 */}
        <div className="mt-6 flex items-center gap-3">
          {(['시험 범위 구성', '지문 선택', '문제 설정'] as const).map((label, i) => {
            const n = (i + 1) as Phase;
            const active = phase === n;
            const done = phase > n;
            return (
              <div key={n} className="flex items-center gap-2">
                {i > 0 && <div className={`h-px w-8 ${done ? 'bg-green-400' : 'bg-purple-400/50'}`} />}
                <button
                  onClick={() => { if (done || active) setPhase(n); }}
                  className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                    active
                      ? 'bg-white text-purple-800 shadow'
                      : done
                      ? 'bg-green-500/30 text-green-200 hover:bg-green-500/50 cursor-pointer'
                      : 'bg-white/10 text-purple-300 cursor-default'
                  }`}
                >
                  <StepBadge n={n} active={active} done={done} />
                  {label}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  /* ──────────────────────────────────────────────────────── */
  /*  Phase 1: 시험 범위 구성                                  */
  /* ──────────────────────────────────────────────────────── */

  const tbKeys = textbooksData ? Object.keys(textbooksData) : [];
  const ebsKeys = tbKeys.filter((k) => isEbsTextbook(k));
  const filteredEbsKeys = tbSearch
    ? ebsKeys.filter((k) => k.toLowerCase().includes(tbSearch.toLowerCase()))
    : ebsKeys;

  if (phase === 1) {
    return (
      <>
        <AppBar title="파이널 예비 모의고사" showBackButton />
        {header}
        <div className="min-h-screen bg-gray-50">
          <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">

            {/* 설명 카드 */}
            <div className="rounded-2xl border border-purple-100 bg-gradient-to-br from-purple-50 to-indigo-50 p-5">
              <h2 className="text-base font-bold text-purple-900 mb-1">어떻게 사용하나요?</h2>
              <ol className="text-sm text-purple-700 space-y-1 list-decimal list-inside">
                <li>부교재 또는 모의고사를 추가해 시험 범위를 구성합니다 (마이페이지 「학교 관리」에 저장해 두면 아래에서 바로 불러올 수 있습니다)</li>
                <li>다음 단계에서 강·번호별로 출제할 지문을 선택합니다</li>
                <li>원하는 유형과 유형별 문항 수를 설정하고 주문합니다</li>
              </ol>
            </div>

            {/* 시험범위 불러오기 */}
            {presets.length > 0 && (
              <div className="rounded-2xl border bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold text-gray-800">저장된 시험범위</h2>
                  <button
                    onClick={() => setShowPresets((v) => !v)}
                    className="text-sm text-purple-600 hover:text-purple-800"
                  >
                    {showPresets ? '닫기' : `${presets.length}개 보기`}
                  </button>
                </div>
                {showPresets && (
                  <div className="space-y-2">
                    {presets.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-xl border border-purple-100 bg-purple-50 px-4 py-3"
                      >
                        <div>
                          <p className="font-medium text-gray-800">{p.name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            교재 {p.dbEntries.length}개 ·{' '}
                            {new Date(p.savedAt).toLocaleDateString('ko-KR')}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => applyPreset(p)}
                            disabled={tbLoading}
                            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-700 disabled:opacity-50"
                          >
                            불러오기
                          </button>
                          <button
                            onClick={() => deletePreset(p.id)}
                            className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-500 hover:bg-red-100"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 학교·학기별 저장 범위 (마이페이지 학교 관리) */}
            {schoolSlots.length > 0 && (
              <div className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
                <h2 className="font-bold text-gray-800 mb-1">학교·학기 저장 범위</h2>
                <p className="text-xs text-gray-500 mb-3">
                  마이페이지 「학교 관리」에서 학년도·학기마다 연결한 시험 범위를 바로 불러옵니다.
                </p>
                <div className="space-y-2">
                  {schoolSlots.map((slot) => (
                    <div
                      key={slot.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-indigo-50/90 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800">{slot.schoolName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {slot.schoolYear}년 · {slot.semester} · 교재·모의 {slot.dbEntries.length}줄
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          applyPreset({
                            id: slot.id,
                            name: `${slot.schoolName} · ${slot.schoolYear} · ${slot.semester}`,
                            dbEntries: slot.dbEntries,
                            savedAt: slot.updatedAt || new Date().toISOString(),
                          })
                        }
                        disabled={tbLoading}
                        className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        불러오기
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 추가된 DB 카드 목록 */}
            {dbEntries.length > 0 && (
              <div className="rounded-2xl border bg-white p-5 shadow-sm">
                <h2 className="font-bold text-gray-800 mb-3">구성된 시험 범위</h2>
                <div className="space-y-2">
                  {dbEntries.map((e) => {
                    const entryBg =
                      e.type === 'mockexam'
                        ? 'border-blue-100 bg-blue-50'
                        : e.textbookCategory === 'solbook-textbook'
                        ? 'border-amber-100 bg-amber-50'
                        : e.textbookCategory === 'solbook-suppl'
                        ? 'border-orange-100 bg-orange-50'
                        : 'border-emerald-100 bg-emerald-50';
                    const badgeBg =
                      e.type === 'mockexam'
                        ? 'bg-blue-500'
                        : e.textbookCategory === 'solbook-textbook'
                        ? 'bg-amber-500'
                        : e.textbookCategory === 'solbook-suppl'
                        ? 'bg-orange-600'
                        : 'bg-emerald-600';
                    const badgeLabel =
                      e.type === 'mockexam'
                        ? '모의고사'
                        : e.textbookCategory === 'solbook-textbook'
                        ? '쏠북 교과서'
                        : e.textbookCategory === 'solbook-suppl'
                        ? '쏠북 부교재'
                        : 'EBS';
                    return (
                    <div
                      key={e.id}
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 ${entryBg}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${badgeBg}`}>
                          {badgeLabel}
                        </span>
                        <span className="text-sm font-medium text-gray-800">{e.displayName}</span>
                      </div>
                      <button
                        onClick={() => handleRemoveDb(e.id)}
                        className="text-gray-400 hover:text-red-500 transition-colors text-lg leading-none"
                      >
                        ✕
                      </button>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* DB 추가 버튼 */}
            <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white p-5">
              <h2 className="font-bold text-gray-800 mb-4">교재 / 모의고사 추가</h2>
              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={() => {
                    setShowAddEbs((v) => !v);
                    setShowAddMock(false);
                    setShowExternalNotice(false);
                    setTbSearch('');
                  }}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-colors ${
                    showAddEbs ? 'bg-emerald-700' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  <span className="text-base">+</span> EBS 교재
                </button>
                <button
                  onClick={() => {
                    setShowAddMock((v) => !v);
                    setShowAddEbs(false);
                    setShowExternalNotice(false);
                  }}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-colors ${
                    showAddMock ? 'bg-blue-700' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  <span className="text-base">+</span> 모의고사 추가
                </button>
                <button
                  onClick={() => {
                    setShowExternalNotice((v) => !v);
                    setShowAddEbs(false);
                    setShowAddMock(false);
                  }}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${
                    showExternalNotice
                      ? 'bg-violet-100 text-violet-800 border border-violet-300'
                      : 'bg-gray-100 text-gray-600 hover:bg-violet-50 hover:text-violet-700 border border-gray-200'
                  }`}
                >
                  <span className="text-base">📄</span> 외부지문
                </button>
              </div>

              {/* EBS 교재 드롭다운 */}
              {showAddEbs && (
                <div className="mt-4">
                  <input
                    type="text"
                    placeholder="교재명 검색..."
                    value={tbSearch}
                    onChange={(e) => setTbSearch(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none mb-2"
                  />
                  {tbLoading ? (
                    <p className="text-sm text-gray-500 py-2">교재 목록 로딩 중...</p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto space-y-1 rounded-xl border border-emerald-100 bg-emerald-50 p-2">
                      {filteredEbsKeys.length === 0 && (
                        <p className="text-sm text-gray-400 px-2 py-3 text-center">검색 결과 없음</p>
                      )}
                      {filteredEbsKeys.map((key) => (
                        <button
                          key={key}
                          onClick={() => handleAddTextbook(key, 'ebs')}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-emerald-100 hover:text-emerald-800 transition-colors"
                        >
                          {key}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 모의고사 드롭다운 */}
              {showAddMock && (
                <div className="mt-4 space-y-3">
                  {Object.entries(mockExamsData).map(([grade, exams]) => (
                    <div key={grade}>
                      <p className="text-xs font-bold text-gray-500 uppercase mb-1">{grade}</p>
                      <div className="max-h-48 overflow-y-auto space-y-1 rounded-xl border border-gray-100 bg-gray-50 p-2">
                        {exams.map((key) => (
                          <button
                            key={key}
                            onClick={() => handleAddMockExam(key)}
                            className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-800 transition-colors"
                          >
                            {mockExamDisplayName(key)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 외부지문 안내 */}
              {showExternalNotice && (
                <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl mt-0.5">📋</span>
                    <div>
                      <p className="font-bold text-violet-900 mb-1">외부지문 입력 안내</p>
                      <p className="text-sm text-violet-700 leading-relaxed">
                        EBS·모의고사 이외의 외부지문(자체 지문, 타 출판사·쏠북 교재 등)을 시험 범위에 포함하려면
                        관리자에게 문의해 주세요.
                      </p>
                      <p className="mt-2 text-sm text-violet-600">
                        지문 원문을 준비한 후 카카오톡 오픈채팅으로 문의하시면 빠르게 안내해 드립니다.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 다음 단계 */}
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setDbEntries((prev) => prev.map(sanitizeMockExamEntry));
                  setPhase(2);
                }}
                disabled={dbEntries.length === 0}
                className="rounded-xl bg-purple-700 px-8 py-3 font-bold text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
              >
                다음: 지문 선택 →
              </button>
            </div>
          </div>
        </div>
        {toast && <Toast msg={toast} onDone={() => setToast('')} />}
      </>
    );
  }

  /* ──────────────────────────────────────────────────────── */
  /*  Phase 2: 지문 선택 (교재별 컬럼)                         */
  /* ──────────────────────────────────────────────────────── */

  if (phase === 2) {
    return (
      <>
        <AppBar title="지문 선택" showBackButton onBackClick={() => setPhase(1)} />
        {header}
        <div className="min-h-screen bg-gray-50">
          {/* 상단 안내 + 저장 바 */}
          <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/90 backdrop-blur-sm shadow-sm">
            <div className="mx-auto max-w-7xl flex items-start justify-between px-4 py-3 gap-4">
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-gray-700">
                  총{' '}
                  <span className="text-lg font-extrabold text-purple-700">
                    {totalSources}
                  </span>
                  개 지문 선택됨
                </span>
                <p className="mt-0.5 text-[11px] text-gray-500 leading-snug">
                  <span className="text-gray-600">모의고사 번호는 클릭할 때마다 선택·해제됩니다.</span>{' '}
                  부교재는 같은 강 안에서 여러 번호를 고르려면{' '}
                  <kbd className="rounded border border-gray-300 bg-gray-100 px-1 font-mono text-[10px]">⌘</kbd> 또는{' '}
                  <kbd className="rounded border border-gray-300 bg-gray-100 px-1 font-mono text-[10px]">Ctrl</kbd> 을 누른 채 클릭하세요.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 pt-0.5">
                <button
                  onClick={() => setShowSaveModal(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-bold text-purple-700 hover:bg-purple-100 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  시험범위로 저장
                </button>
                <button
                  onClick={() => {
                    setDbEntries((prev) => prev.map(sanitizeMockExamEntry));
                    setPhase(3);
                  }}
                  disabled={totalSources === 0}
                  className="rounded-lg bg-purple-700 px-4 py-1.5 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-40 transition-colors"
                >
                  다음 단계 →
                </button>
              </div>
            </div>
          </div>

          {/* 컬럼 레이아웃 */}
          <div className="mx-auto max-w-7xl px-4 py-6">
            <div className="flex gap-4 overflow-x-auto pb-4">
              {dbEntries.map((entry) => {
                const totalInEntry = Object.values(entry.lessonGroups).flat().length;
                const selectedInEntry = entry.selectedSources.length;

                return (
                  <div
                    key={entry.id}
                    className="flex-shrink-0 w-72 rounded-2xl border bg-white shadow-sm flex flex-col"
                  >
                    {/* 컬럼 헤더 */}
                    <div
                      className={`rounded-t-2xl px-4 py-3 ${
                        entry.type === 'mockexam'
                          ? 'bg-gradient-to-r from-blue-600 to-blue-700'
                          : entry.textbookCategory === 'solbook-textbook'
                          ? 'bg-gradient-to-r from-amber-500 to-amber-600'
                          : entry.textbookCategory === 'solbook-suppl'
                          ? 'bg-gradient-to-r from-orange-600 to-orange-700'
                          : 'bg-gradient-to-r from-emerald-600 to-emerald-700'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className={`text-[10px] font-bold uppercase tracking-wide ${
                            entry.type === 'mockexam'
                              ? 'text-blue-200'
                              : entry.textbookCategory === 'solbook-textbook'
                              ? 'text-amber-100'
                              : entry.textbookCategory === 'solbook-suppl'
                              ? 'text-orange-100'
                              : 'text-emerald-200'
                          }`}>
                            {entry.type === 'mockexam'
                              ? '모의고사'
                              : entry.textbookCategory === 'solbook-textbook'
                              ? '쏠북 교과서'
                              : entry.textbookCategory === 'solbook-suppl'
                              ? '쏠북 부교재'
                              : 'EBS 교재'}
                          </span>
                          <p className="text-sm font-bold text-white leading-tight mt-0.5">
                            {entry.displayName}
                          </p>
                        </div>
                        <span className="ml-2 shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold text-white">
                          {selectedInEntry}/{totalInEntry}
                        </span>
                      </div>
                      {/* 전체 선택/해제 */}
                      <button
                        onClick={() => {
                          const allSources = Object.values(entry.lessonGroups).flat();
                          const allSel = allSources.every((s) => entry.selectedSources.includes(s));
                          setDbEntries((prev) =>
                            prev.map((e) =>
                              e.id !== entry.id
                                ? e
                                : { ...e, selectedSources: allSel ? [] : allSources }
                            )
                          );
                        }}
                        className="mt-2 w-full rounded-lg bg-white/15 py-1 text-xs font-medium text-white hover:bg-white/25 transition-colors"
                      >
                        {Object.values(entry.lessonGroups).flat().every((s) =>
                          entry.selectedSources.includes(s)
                        )
                          ? '전체 해제'
                          : '전체 선택'}
                      </button>
                    </div>

                    {/* 강 목록 */}
                    <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[60vh]">
                      {Object.entries(entry.lessonGroups).map(([groupKey, sources]) => {
                        const allSel = sources.every((s) => entry.selectedSources.includes(s));
                        const someSel = sources.some((s) => entry.selectedSources.includes(s));
                        const selCount = sources.filter((s) => entry.selectedSources.includes(s)).length;
                        const expandKey = `${entry.id}-${groupKey}`;
                        const isExpanded = expandedGroups[expandKey];

                        return (
                          <div key={groupKey} className="rounded-xl border border-gray-100 overflow-hidden">
                            <div className="flex items-center">
                              <button
                                onClick={() => toggleGroup(entry.id, groupKey)}
                                className={`flex-1 flex items-center justify-between px-3 py-2.5 text-sm font-medium transition-colors ${
                                  allSel
                                    ? entry.type === 'mockexam'
                                      ? 'bg-blue-600 text-white'
                                      : entry.textbookCategory === 'solbook-textbook'
                                      ? 'bg-amber-500 text-white'
                                      : entry.textbookCategory === 'solbook-suppl'
                                      ? 'bg-orange-600 text-white'
                                      : 'bg-emerald-600 text-white'
                                    : someSel
                                    ? entry.type === 'mockexam'
                                      ? 'bg-blue-100 text-blue-800'
                                      : entry.textbookCategory === 'solbook-textbook'
                                      ? 'bg-amber-100 text-amber-800'
                                      : entry.textbookCategory === 'solbook-suppl'
                                      ? 'bg-orange-100 text-orange-800'
                                      : 'bg-emerald-100 text-emerald-800'
                                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                                }`}
                              >
                                <span className="flex items-center gap-1.5">
                                  <span>{allSel ? '●' : someSel ? '◐' : '○'}</span>
                                  <span className="truncate max-w-[130px]" title={groupKey}>{groupKey}</span>
                                </span>
                                <span className={`text-xs font-bold rounded-full px-1.5 py-0.5 ${
                                  allSel ? 'bg-white/30 text-white' : 'bg-gray-200 text-gray-600'
                                }`}>
                                  {selCount}/{sources.length}
                                </span>
                              </button>
                              <button
                                onClick={() =>
                                  setExpandedGroups((prev) => ({
                                    ...prev,
                                    [expandKey]: !prev[expandKey],
                                  }))
                                }
                                className={`px-2 py-2.5 border-l text-sm font-bold transition-colors ${
                                  isExpanded ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                                }`}
                              >
                                {isExpanded ? '−' : '+'}
                              </button>
                            </div>
                            {isExpanded && (
                              <div className="px-3 py-2 bg-gray-50 border-t border-gray-100">
                                <div className="grid grid-cols-3 gap-1">
                                  {sources.map((src, srcIdx) => {
                                    const checked = entry.selectedSources.includes(src);
                                    const label = src.replace(/^.*?(\d+[~]?\d*번)$/, '$1').replace(entry.displayName + ' ', '').replace(/^.*? /, '');
                                    const passCbId = `uo-pass-${expandKey}-${srcIdx}`;
                                    return (
                                      <label
                                        key={src}
                                        htmlFor={passCbId}
                                        className="flex items-center gap-1 cursor-pointer group select-none"
                                        title={
                                          entry.type === 'mockexam'
                                            ? '클릭할 때마다 선택·해제'
                                            : '일반 클릭: 이 강에서는 이 지문만 선택 · ⌘ 또는 Ctrl+클릭: 여러 지문 추가·해제'
                                        }
                                      >
                                        {/*
                                          네이티브 checkbox + readOnly + preventDefault 조합은
                                          일부 브라우저에서 DOM checked와 페인트가 어긋나 다른 곳 클릭 후에야 반영되는 현상이 있어
                                          커스텀 토글 버튼(role=checkbox)으로 대체함.
                                        */}
                                        <button
                                          id={passCbId}
                                          type="button"
                                          role="checkbox"
                                          aria-checked={checked}
                                          aria-label={`${label} ${checked ? '선택됨' : '선택 안 됨'}`}
                                          onClick={(e) => {
                                            pickSourceWithModifier(entry.id, groupKey, src, e.metaKey || e.ctrlKey);
                                          }}
                                          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[8px] font-bold leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-0 ${
                                            checked
                                              ? 'border-purple-600 bg-purple-600 text-white'
                                              : 'border-gray-400 bg-white text-transparent hover:border-purple-400'
                                          }`}
                                        >
                                          ✓
                                        </button>
                                        <span className="text-xs text-gray-600 group-hover:text-purple-700 truncate">
                                          {label}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* 교재 추가 + 버튼 */}
              <button
                onClick={() => setPhase(1)}
                className="flex-shrink-0 w-48 rounded-2xl border-2 border-dashed border-gray-300 bg-white flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-purple-400 hover:text-purple-600 transition-colors min-h-[200px]"
              >
                <span className="text-3xl font-light">+</span>
                <span className="text-sm font-medium">교재 추가</span>
              </button>
            </div>
          </div>
        </div>

        {/* 시험범위 저장 모달 */}
        {showSaveModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
              <h3 className="font-bold text-gray-800 mb-1">시험범위로 저장</h3>
              <p className="text-xs text-gray-500 mb-4">
                현재 선택된 교재·번호를 저장해 다음에 바로 불러올 수 있습니다
              </p>
              <input
                type="text"
                placeholder="저장 이름 (예: 2학기 중간 범위)"
                value={scopeName}
                onChange={(e) => setScopeName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveScope(); }}
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-purple-500 focus:outline-none mb-4"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowSaveModal(false); setScopeName(''); }}
                  className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  onClick={handleSaveScope}
                  disabled={savingScope || !scopeName.trim()}
                  className="flex-1 rounded-xl bg-purple-700 py-2.5 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-50"
                >
                  {savingScope ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        )}

        {toast && <Toast msg={toast} onDone={() => setToast('')} />}
      </>
    );
  }

  /* ──────────────────────────────────────────────────────── */
  /*  Phase 3: 문제 설정                                       */
  /* ──────────────────────────────────────────────────────── */

  const pointsMax = hasSolbookInOrder
    ? 0
    : Math.min(userPoints, Math.floor(totalPrice / 10) * 10);

  return (
    <>
      <AppBar title="문제 설정" showBackButton onBackClick={() => setPhase(2)} />
      {header}
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">

          {/* 선택 요약 */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-bold text-gray-800 mb-3">선택된 시험 범위 요약</h2>
            <div className="space-y-2">
              {dbEntries.filter((e) => e.selectedSources.length > 0).map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-sm">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${
                    e.type === 'mockexam'
                      ? 'bg-blue-500'
                      : e.textbookCategory === 'solbook-textbook'
                      ? 'bg-amber-500'
                      : e.textbookCategory === 'solbook-suppl'
                      ? 'bg-orange-600'
                      : 'bg-emerald-600'
                  }`}>
                    {e.type === 'mockexam'
                      ? '모의'
                      : e.textbookCategory === 'solbook-textbook'
                      ? '쏠북교과'
                      : e.textbookCategory === 'solbook-suppl'
                      ? '쏠북부교'
                      : 'EBS'}
                  </span>
                  <span className="text-gray-700 font-medium">{e.displayName}</span>
                  <span className="text-gray-400 text-xs">{e.selectedSources.length}개 지문</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm font-medium text-purple-700">총 {totalSources}개 지문</p>
          </div>

          {/* 유형 선택 */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-bold text-gray-800 mb-3">문제 유형 선택</h2>
            <div className="grid grid-cols-3 gap-2">
              {BOOK_VARIANT_QUESTION_TYPES.map((t) => {
                const sel = selectedTypes.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggleType(t)}
                    className={`rounded-xl border-2 px-3 py-2 text-sm font-medium transition-all ${
                      sel
                        ? 'border-purple-600 bg-purple-600 text-white shadow-md'
                        : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-purple-300 hover:bg-purple-50'
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 유형별 문항수 */}
          {selectedTypes.length > 0 && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-gray-800">유형별 문항수 설정</h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">일괄:</span>
                  <button
                    onClick={() => setBulkCount((v) => Math.max(1, v - 1))}
                    className="h-7 w-7 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 font-bold"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-bold">{bulkCount}</span>
                  <button
                    onClick={() => setBulkCount((v) => Math.min(10, v + 1))}
                    className="h-7 w-7 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 font-bold"
                  >
                    +
                  </button>
                  <button
                    onClick={applyBulk}
                    className="rounded-lg bg-gray-800 px-3 py-1 text-xs font-bold text-white hover:bg-gray-900"
                  >
                    일괄 적용
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {selectedTypes.map((t) => {
                  const cnt = questionsPerTypeMap[t] ?? 3;
                  const unitPrice = pricePerQuestion(t);
                  return (
                    <div
                      key={t}
                      className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5"
                    >
                      <div>
                        <span className="font-medium text-gray-800 text-sm">{t}</span>
                        <span className="ml-2 text-xs text-gray-400">
                          {unitPrice}원/문항
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setTypeCount(t, cnt - 1)}
                          className="h-7 w-7 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 font-bold text-sm"
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm font-bold text-purple-700">{cnt}</span>
                        <button
                          onClick={() => setTypeCount(t, cnt + 1)}
                          className="h-7 w-7 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 font-bold text-sm"
                        >
                          +
                        </button>
                        <span className="w-20 text-right text-xs text-gray-500">
                          = {(unitPrice * cnt * totalSources).toLocaleString()}원
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 flex justify-end">
                <span className="text-sm text-gray-500">
                  소계:{' '}
                  <span className="font-bold text-gray-800">{totalPrice.toLocaleString()}원</span>
                </span>
              </div>
            </div>
          )}

          {/* 순서·삽입 해설 옵션 — 삽입-고난도만 선택 시에는 해당 유형이 없어 빈 박스가 되므로 순서/삽입이 있을 때만 표시 */}
          {(selectedTypes.includes('순서') || selectedTypes.includes('삽입')) && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="font-bold text-gray-800 mb-1">순서·삽입 해설 포함 여부</h2>
              <p className="text-xs text-gray-500 mb-4">
                순서·삽입 유형을 고르신 경우에만 적용됩니다. 체크하면 해설 포함(80원/문항), 해제하면 문제·답만(50원/문항)으로 주문서에 반영됩니다.
              </p>
              <div className="space-y-4">
                {(['순서', '삽입'] as const).map((t) =>
                  selectedTypes.includes(t) ? (
                    <label
                      key={t}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3 transition-colors hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        checked={orderInsertExplanation[t]}
                        onChange={(e) =>
                          setOrderInsertExplanation((prev) => ({ ...prev, [t]: e.target.checked }))
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-semibold text-gray-800">{t}</span>
                        <span className="text-sm text-gray-700"> 유형 — 해설 포함</span>
                        <span className="mt-1 block text-xs text-gray-500">
                          {orderInsertExplanation[t]
                            ? '해설 포함으로 제작 · 문항당 80원'
                            : '문제·답만(해설 제외) · 문항당 50원'}
                        </span>
                      </span>
                    </label>
                  ) : null
                )}
              </div>
            </div>
          )}

          {/* 포인트 — 쏠북 교재가 시험 범위에 있으면 쏠북 가격 정책과 충돌을 피하기 위해 비활성 */}
          {isMember && userPoints > 0 && !hasSolbookInOrder && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-gray-800">포인트 사용</h2>
                  <p className="text-xs text-gray-500 mt-0.5">보유: {userPoints.toLocaleString()}P</p>
                </div>
                <button
                  onClick={() => setShowPointModal(true)}
                  className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-bold text-purple-700 hover:bg-purple-100"
                >
                  {pointsToUse > 0 ? `${pointsToUse.toLocaleString()}P 사용 중` : '사용하기'}
                </button>
              </div>
            </div>
          )}
          {hasSolbookInOrder && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-5 shadow-sm text-sm text-amber-950 leading-relaxed">
              <p className="font-bold text-amber-900 mb-1">쏠북 교재가 포함된 주문</p>
              <p>
                쏠북에서 판매하는 교재 본체 금액은 이 화면의 금액에 포함되지 않으며,{' '}
                <strong>포인트 사용도 적용되지 않습니다.</strong> 아래 금액은 변형 문제 제작료만 해당합니다.
              </p>
              {solbookRetailGuideText.trim() ? (
                <p className="mt-2 text-amber-900/95">
                  <span className="font-semibold">교재 본체 예상 금액(참고):</span> {solbookRetailGuideText.trim()}
                </p>
              ) : (
                <p className="mt-2 text-xs text-amber-900/85">
                  교재 본체 소비자가는 교재·옵션에 따라 달라지므로 쏠북 또는 구매 안내 링크에서 확인해 주세요.
                </p>
              )}
            </div>
          )}

          {/* 이메일 */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-bold text-gray-800 mb-2">결과물 수령 이메일</h2>
            <input
              type="email"
              placeholder="example@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-purple-500 focus:outline-none"
            />
          </div>

          {/* 가격 및 결제 안내 */}
          <div className="rounded-2xl border-2 border-purple-200 bg-purple-50 p-5">
            <h2 className="font-bold text-purple-900 mb-3">주문 금액</h2>
            <div className="space-y-1 text-sm text-purple-800">
              <div className="flex justify-between">
                <span>소계 (변형 제작)</span>
                <span>{totalPrice.toLocaleString()}원</span>
              </div>
              {effectivePointsDeduction > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>포인트 할인</span>
                  <span>− {effectivePointsDeduction.toLocaleString()}원</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base text-purple-900 border-t border-purple-200 pt-2 mt-2">
                <span>{hasSolbookInOrder ? '입금 대상(제작료)' : '최종 금액'}</span>
                <span>{finalPrice.toLocaleString()}원</span>
              </div>
            </div>
            {hasSolbookInOrder && (
              <p className="mt-2 text-[11px] leading-relaxed text-purple-900/90">
                위 입금은 <strong>변형 문제 제작·연동</strong>에 해당하는 금액입니다. 쏠북 교재 본체는 쏠북에서 별도로
                구매하시면 됩니다.
              </p>
            )}
            {finalPrice > 0 && (
              <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs text-purple-700">
                <p className="font-bold mb-0.5">입금 계좌 (제작료)</p>
                <p className="font-mono">{MEMBER_DEPOSIT_ACCOUNT}</p>
              </div>
            )}
          </div>

          {/* 주문 버튼 */}
          <button
            onClick={handleSubmit}
            disabled={selectedTypes.length === 0 || totalSources === 0 || !email.trim()}
            className="w-full rounded-2xl bg-gradient-to-r from-purple-700 to-indigo-700 py-4 text-base font-extrabold text-white shadow-lg hover:from-purple-800 hover:to-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            파이널 예비 모의고사 주문하기
          </button>
          <p className="text-center text-xs text-gray-400">
            주문 완료 후 카카오톡 오픈채팅으로 입금 확인을 알려주세요
          </p>
        </div>
      </div>

      {/* 포인트 모달 */}
      {showPointModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="font-bold text-gray-800 mb-1">포인트 사용</h3>
            <p className="text-xs text-gray-500 mb-4">보유 포인트: {userPoints.toLocaleString()}P</p>
            <input
              type="number"
              min={0}
              max={pointsMax}
              step={10}
              value={pointsToUse}
              onChange={(e) => setPointsToUse(Math.min(pointsMax, Math.max(0, Number(e.target.value))))}
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-purple-500 focus:outline-none mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setPointsToUse(0)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                사용 안 함
              </button>
              <button
                onClick={() => setPointsToUse(pointsMax)}
                className="flex-1 rounded-xl bg-purple-100 py-2.5 text-sm font-bold text-purple-700 hover:bg-purple-200"
              >
                최대 사용
              </button>
              <button
                onClick={() => setShowPointModal(false)}
                className="flex-1 rounded-xl bg-purple-700 py-2.5 text-sm font-bold text-white hover:bg-purple-800"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast} onDone={() => setToast('')} />}
    </>
  );
}
