'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppBar from '../components/AppBar';
import PointChargeModal from '../components/PointChargeModal';
import StudentManagement from '../components/StudentManagement';
import SchoolScopeManagement from '../components/SchoolScopeManagement';
import { useTextbooksData } from '@/lib/useTextbooksData';
import { membershipPricingOneLiner } from '@/lib/membership-pricing';
import { hasStoredByokAnthropicKey, writeStoredByokAnthropicKey } from '@/lib/member-byok-anthropic-key-storage';
import { isMockExamPassageTextbookStored } from '@/lib/member-variant-passage-sources';

const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

interface AuthUser {
  loginId: string;
  role: string;
  name: string;
  email: string;
  /** DB 비밀번호가 관리자 초기값과 동일한 일반 회원 — 내 정보에서 변경 유도 */
  mustChangePassword?: boolean;
  dropboxFolderPath?: string;
  dropboxSharedLink?: string;
  points?: number;
  myFormatApproved?: boolean;
  annualMemberSince?: string | null;
  isAnnualMemberActive?: boolean;
  monthlyMemberSince?: string | null;
  monthlyMemberUntil?: string | null;
  isMonthlyMemberActive?: boolean;
  isPremiumMember?: boolean;
  /** 관리자 생성 계정 등: 월·연 프리미엄 기능 7일 체험 */
  signupPremiumTrialUntil?: string | null;
  signupPremiumTrialActive?: boolean;
  phone?: string;
  isVip?: boolean;
  vipSince?: string | null;
}

interface MyOrder {
  id: string;
  orderText: string;
  createdAt: string;
  status: string;
  orderNumber: string | null;
  fileUrl: string | null;
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: '주문 접수',
  accepted: '제작 수락',
  payment_confirmed: '입금 확인',
  in_progress: '제작 중',
  completed: '완료',
  cancelled: '취소됨',
};

function getDropboxFolderUrl(path: string): string {
  if (!path?.trim()) return '#';
  const trimmed = path.trim().replace(/^\/+/, '');
  const pathEnc = trimmed.split('/').filter(Boolean).map((s) => encodeURIComponent(s)).join('/');
  const workSpace = typeof process.env.NEXT_PUBLIC_DROPBOX_WORK_SPACE === 'string' && process.env.NEXT_PUBLIC_DROPBOX_WORK_SPACE.trim();
  return workSpace
    ? `https://www.dropbox.com/work/${encodeURIComponent(workSpace)}/앱/${pathEnc}`
    : `https://www.dropbox.com/work/Apps/${pathEnc}`;
}

function orderTitle(orderText: string): string {
  const first = orderText.split(/\r?\n/)[0]?.trim() || orderText.slice(0, 60);
  return first.length > 80 ? first.slice(0, 80) + '…' : first;
}

function statusVariant(status: string): 'new' | 'making' | 'done' | 'cancel' {
  if (status === 'completed') return 'done';
  if (status === 'cancelled') return 'cancel';
  if (['accepted', 'payment_confirmed', 'in_progress'].includes(status)) return 'making';
  return 'new';
}

interface PointHistoryEntry {
  id: string;
  createdAt: string;
  delta: number;
  balanceAfter: number;
  kind: string;
  meta: Record<string, unknown>;
}

function pointHistoryKindLabel(kind: string): string {
  switch (kind) {
    case 'order_spend':
      return '주문 사용';
    case 'admin_grant':
      return '포인트 지급';
    case 'admin_adjust':
      return '포인트 조정';
    case 'point_charge':
      return '포인트 충전';
    case 'member_variant_hard':
      return '변형문제(삽입-고난도)';
    case 'member_variant_refund':
      return '변형문제(포인트 환급)';
    case 'order_cancel_refund':
      return '주문 취소 환급';
    default:
      return kind;
  }
}

function tossCustomerKeyFromLoginId(loginId: string): string {
  const raw = (loginId || 'member').replace(/[^a-zA-Z0-9._@-]/g, '_').slice(0, 44);
  return `u_${raw}`;
}

function formatPointHistoryWhen(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

function mongoObjectIdFromMeta(meta: Record<string, unknown>): string | null {
  const raw = meta.orderId;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return /^[a-f\d]{24}$/i.test(t) ? t : null;
}

function resolvePointHistoryOrderDetailId(
  meta: Record<string, unknown>,
  orderNumber: string,
  orderIdByNumber: Map<string, string>
): string | null {
  return mongoObjectIdFromMeta(meta) ?? orderIdByNumber.get(orderNumber) ?? null;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface AnnualSharedFileItem {
  id: string;
  title: string;
  description: string;
  originalName: string;
  contentType: string;
  size: number;
  uploadedAt: string | null;
}

type TabKey = 'orders' | 'schools' | 'students' | 'exam' | 'myFormat' | 'annualShared' | 'vocabulary' | 'vip' | 'settings';
type ExamSubTabKey = 'upload' | 'list';
type MyFormatType = '강의용자료' | '수업용자료' | '변형문제';

export default function MyPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMessage, setEmailMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneMessage, setPhoneMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const passwordSectionRef = useRef<HTMLDivElement>(null);
  const byokApiKeySectionRef = useRef<HTMLDivElement>(null);
  const passwordNudgeUiDone = useRef(false);
  const [byokKeyDraft, setByokKeyDraft] = useState('');
  const [byokKeyMessage, setByokKeyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [pastExamSchool, setPastExamSchool] = useState('');
  const [pastExamGrade, setPastExamGrade] = useState('');
  const [pastExamYear, setPastExamYear] = useState('');
  const [pastExamType, setPastExamType] = useState('');
  const [pastExamScope, setPastExamScope] = useState('');
  const [pastExamSubmitting, setPastExamSubmitting] = useState(false);
  const [pastExamMessage, setPastExamMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pastExamFiles, setPastExamFiles] = useState<FileList | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  interface PastExamUpload {
    id: string;
    school: string;
    grade: string;
    examYear: string;
    examType: string;
    examScope: string;
    files: { originalName: string; fileIndex: number }[];
    adminCategories?: string[];
    createdAt: string;
  }
  const [pastExamUploads, setPastExamUploads] = useState<PastExamUpload[]>([]);
  const [pastExamLoading, setPastExamLoading] = useState(false);
  const [deletingUploadId, setDeletingUploadId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string; type: 'pdf' | 'image' } | null>(null);
  const [examListExpanded, setExamListExpanded] = useState(false);
  const [examSubTab, setExamSubTab] = useState<ExamSubTabKey>('upload');

  interface MyFormatUploadItem {
    id: string;
    files: { originalName: string; fileIndex: number }[];
    createdAt: string;
  }
  const [myFormatByType, setMyFormatByType] = useState<Record<MyFormatType, MyFormatUploadItem[]>>({
    강의용자료: [],
    수업용자료: [],
    변형문제: [],
  });
  const [myFormatLoading, setMyFormatLoading] = useState(false);
  const [myFormatSubmitting, setMyFormatSubmitting] = useState<MyFormatType | null>(null);
  const [myFormatMessage, setMyFormatMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deletingMyFormatId, setDeletingMyFormatId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>('orders');
  const [studentsCount, setStudentsCount] = useState(0);
  const [pointHistory, setPointHistory] = useState<PointHistoryEntry[]>([]);
  const [pointHistoryLoading, setPointHistoryLoading] = useState(false);
  const [pointChargeOpen, setPointChargeOpen] = useState(false);

  const orderIdByOrderNumber = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) {
      if (o.orderNumber && !m.has(o.orderNumber)) m.set(o.orderNumber, o.id);
    }
    return m;
  }, [orders]);

  /** 단어장·무료공유자료: 유효 연회원 또는 가입 프리미엄 체험 */
  const annualMenuUnlocked = useMemo(
    () => !!(user?.isAnnualMemberActive || user?.signupPremiumTrialActive),
    [user?.isAnnualMemberActive, user?.signupPremiumTrialActive],
  );

  const [annualSharedItems, setAnnualSharedItems] = useState<AnnualSharedFileItem[]>([]);
  const [annualSharedLoading, setAnnualSharedLoading] = useState(false);

  /* ── 단어장 탭 상태 ── */
  const { data: vocabTextbooksData } = useTextbooksData();
  const [vocabDbTextbooks, setVocabDbTextbooks] = useState<string[]>([]);
  const [vocabDbLessonMap, setVocabDbLessonMap] = useState<Record<string, Record<string, string[]>>>({});
  const [vocabSelectedTextbook, setVocabSelectedTextbook] = useState('');
  const [vocabLessonGroups, setVocabLessonGroups] = useState<Record<string, string[]>>({});
  const [vocabSelectedLessons, setVocabSelectedLessons] = useState<string[]>([]);
  const [vocabExpandedLessons, setVocabExpandedLessons] = useState<string[]>([]);
  const [vocabDownloading, setVocabDownloading] = useState(false);
  const [vocabCefrLevels, setVocabCefrLevels] = useState(['A1','A2','B1','B2','C1','C2']);
  const [vocabColumns, setVocabColumns] = useState({ wordType: true, pos: true, cefr: true, meaning: true, synonym: true, antonym: true, opposite: false });
  const [vocabFormat, setVocabFormat] = useState<'xlsx' | 'pdf' | 'test-xlsx' | 'test-pdf'>('xlsx');
  const [vocabTestDirection, setVocabTestDirection] = useState<'word-to-meaning' | 'meaning-to-word'>('word-to-meaning');
  const [vocabTestColumns, setVocabTestColumns] = useState<1 | 2>(1);
  const [vocabTestShuffle, setVocabTestShuffle] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (!data.user) {
          router.replace('/login?from=/my');
          return;
        }
        setUser(data.user);
        setEditEmail(data.user.email ?? '');
        setEditPhone(data.user.phone ?? '');
      })
      .catch(() => router.replace('/login?from=/my'))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!user?.mustChangePassword) {
      passwordNudgeUiDone.current = false;
      return;
    }
    setActiveTab('settings');
    if (passwordNudgeUiDone.current) return;
    passwordNudgeUiDone.current = true;
    const t = window.setTimeout(() => {
      passwordSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
    return () => window.clearTimeout(t);
  }, [user?.mustChangePassword]);

  useEffect(() => {
    if (!user?.loginId) return;
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#byok-api-key') return;
    setActiveTab('settings');
    const id = window.requestAnimationFrame(() => {
      byokApiKeySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [user?.loginId]);

  useEffect(() => {
    if (!user) return;
    fetch('/api/my/orders')
      .then((res) => res.json())
      .then((data) => setOrders(data.orders || []))
      .catch(() => setOrders([]));
  }, [user]);

  const fetchPastExamUploads = () => {
    setPastExamLoading(true);
    fetch('/api/my/past-exam-upload')
      .then((res) => res.json())
      .then((data) => setPastExamUploads(data.uploads || []))
      .catch(() => setPastExamUploads([]))
      .finally(() => setPastExamLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    fetchPastExamUploads();
  }, [user]);

  const fetchMyFormatUploads = () => {
    setMyFormatLoading(true);
    fetch('/api/my/my-format-upload', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) =>
        setMyFormatByType(
          data.byType || { 강의용자료: [], 수업용자료: [], 변형문제: [] }
        )
      )
      .catch(() => setMyFormatByType({ 강의용자료: [], 수업용자료: [], 변형문제: [] }))
      .finally(() => setMyFormatLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    fetchMyFormatUploads();
  }, [user]);

  useEffect(() => {
    if (!user || activeTab !== 'settings') return;
    setPointHistoryLoading(true);
    fetch('/api/my/point-history', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setPointHistory(Array.isArray(data.entries) ? data.entries : []))
      .catch(() => setPointHistory([]))
      .finally(() => setPointHistoryLoading(false));
  }, [user, activeTab]);

  useEffect(() => {
    if (!annualMenuUnlocked || activeTab !== 'annualShared') return;
    setAnnualSharedLoading(true);
    fetch('/api/my/annual-shared-files', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setAnnualSharedItems(Array.isArray(data.items) ? data.items : []))
      .catch(() => setAnnualSharedItems([]))
      .finally(() => setAnnualSharedLoading(false));
  }, [annualMenuUnlocked, activeTab]);

  useEffect(() => {
    if (user && !annualMenuUnlocked && (activeTab === 'annualShared' || activeTab === 'vocabulary')) {
      setActiveTab('orders');
    }
    if (user && !user.isVip && activeTab === 'vip') {
      setActiveTab('orders');
    }
  }, [user, activeTab, annualMenuUnlocked]);

  useEffect(() => {
    if (!annualMenuUnlocked || activeTab !== 'vocabulary') return;
    fetch('/api/my/vocabulary-textbooks', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.textbooks)) setVocabDbTextbooks(d.textbooks);
        if (d.lessonMap) setVocabDbLessonMap(d.lessonMap);
      })
      .catch(() => {});
  }, [annualMenuUnlocked, activeTab]);

  /* ── 단어장: 교재 목록 ── */
  interface VocabTextbookContent { [lessonKey: string]: { 번호: string }[] }
  interface VocabTextbookStructure {
    Sheet1?: { 부교재?: Record<string, VocabTextbookContent> };
    '지문 데이터'?: { 부교재?: Record<string, VocabTextbookContent> };
    부교재?: Record<string, VocabTextbookContent>;
  }
  const vocabPickContent = (key: string, data: VocabTextbookStructure): VocabTextbookContent | null => {
    const sub = data.Sheet1?.부교재 ?? data['지문 데이터']?.부교재 ?? data.부교재;
    if (!sub) return null;
    return sub[key] ?? (Object.keys(sub).length > 0 ? sub[Object.keys(sub)[0]] : null);
  };

  const vocabTextbookList = useMemo(() => {
    const set = new Set<string>();
    if (vocabTextbooksData) {
      for (const k of Object.keys(vocabTextbooksData)) {
        if (isMockExamPassageTextbookStored(k)) set.add(k);
      }
    }
    for (const tb of vocabDbTextbooks) {
      if (isMockExamPassageTextbookStored(tb)) set.add(tb);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [vocabTextbooksData, vocabDbTextbooks]);

  useEffect(() => {
    if (vocabSelectedTextbook && !vocabTextbookList.includes(vocabSelectedTextbook)) {
      setVocabSelectedTextbook('');
      setVocabLessonGroups({});
      setVocabSelectedLessons([]);
      setVocabExpandedLessons([]);
    }
  }, [vocabTextbookList, vocabSelectedTextbook]);

  useEffect(() => {
    if (!vocabSelectedTextbook) {
      setVocabLessonGroups({}); setVocabSelectedLessons([]); setVocabExpandedLessons([]);
      return;
    }
    if (vocabDbLessonMap[vocabSelectedTextbook]) {
      const groups = vocabDbLessonMap[vocabSelectedTextbook];
      const keys = Object.keys(groups);
      setVocabLessonGroups(groups);
      setVocabSelectedLessons([]);
      setVocabExpandedLessons(keys.length <= 2 ? keys : []);
      return;
    }
    if (!vocabTextbooksData || !vocabTextbooksData[vocabSelectedTextbook]) {
      setVocabLessonGroups({}); setVocabSelectedLessons([]); setVocabExpandedLessons([]);
      return;
    }
    const td = vocabTextbooksData[vocabSelectedTextbook] as VocabTextbookStructure;
    const content = vocabPickContent(vocabSelectedTextbook, td);
    if (!content) { setVocabLessonGroups({}); return; }
    const groups: Record<string, string[]> = {};
    Object.keys(content).forEach((lk) => {
      const arr = content[lk];
      if (Array.isArray(arr)) groups[lk] = arr.map((it) => `${lk} ${it.번호}`);
    });
    setVocabLessonGroups(groups);
    setVocabSelectedLessons([]);
    setVocabExpandedLessons([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vocabSelectedTextbook, vocabTextbooksData, vocabDbLessonMap]);

  const vocabAllFlat = useMemo(() => Object.values(vocabLessonGroups).flat(), [vocabLessonGroups]);

  const handleVocabLessonChange = (l: string) =>
    setVocabSelectedLessons((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]));
  const handleVocabGroupToggle = (lk: string) => {
    const group = vocabLessonGroups[lk] || [];
    const allSel = group.every((l) => vocabSelectedLessons.includes(l));
    if (allSel) setVocabSelectedLessons((p) => p.filter((l) => !group.includes(l)));
    else setVocabSelectedLessons((p) => { const s = new Set(p); group.forEach((l) => s.add(l)); return [...s]; });
  };
  const handleVocabExpandToggle = (lk: string) =>
    setVocabExpandedLessons((p) => (p.includes(lk) ? p.filter((k) => k !== lk) : [...p, lk]));
  const handleVocabAllToggle = () => {
    if (vocabSelectedLessons.length === vocabAllFlat.length) setVocabSelectedLessons([]);
    else setVocabSelectedLessons([...vocabAllFlat]);
  };

  const handleVocabDownload = async (formatOverride?: 'xlsx' | 'pdf' | 'test-xlsx' | 'test-pdf') => {
    const fmt = formatOverride || vocabFormat;
    if (!vocabSelectedTextbook) { alert('교재를 선택해주세요.'); return; }
    if (vocabSelectedLessons.length === 0) { alert('강과 번호를 1개 이상 선택해주세요.'); return; }
    setVocabDownloading(true);
    try {
      const res = await fetch('/api/my/vocabulary-download', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          textbook: vocabSelectedTextbook,
          selectedLessons: vocabSelectedLessons,
          cefrLevels: vocabCefrLevels,
          columns: vocabColumns,
          format: fmt,
          testDirection: vocabTestDirection,
          testColumns: vocabTestColumns,
          testShuffle: vocabTestShuffle,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert((err as { error?: string }).error || '다운로드에 실패했습니다.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = (fmt === 'pdf' || fmt === 'test-pdf') ? 'pdf' : 'xlsx';
      const prefix = (fmt === 'test-xlsx' || fmt === 'test-pdf') ? '단어시험지' : '단어장';
      a.download = `${prefix}_${vocabSelectedTextbook}_${vocabSelectedLessons.length}지문.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert('다운로드에 실패했습니다.');
    } finally {
      setVocabDownloading(false);
    }
  };

  const tabs = useMemo(() => {
    const base: { key: TabKey; label: string; icon: string; count?: number }[] = [
      { key: 'orders', label: '주문 내역', icon: '📋', count: orders.length },
      { key: 'schools', label: '학교 관리', icon: '🏫' },
      { key: 'students', label: '학생 관리', icon: '👤', count: studentsCount },
      { key: 'exam', label: '기출문제', icon: '📤' },
      { key: 'myFormat', label: '나의양식', icon: '📄' },
    ];
    if (annualMenuUnlocked) {
      base.push({ key: 'annualShared', label: '무료공유자료', icon: '📥' });
      base.push({ key: 'vocabulary', label: '단어장', icon: '📖' });
    }
    if (user?.isVip) {
      base.push({ key: 'vip', label: 'VIP', icon: '👑' });
    }
    base.push({ key: 'settings', label: '내 정보', icon: '⚙️' });
    return base;
  }, [annualMenuUnlocked, user?.isVip, orders.length, studentsCount]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/');
    router.refresh();
  };

  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailMessage(null);
    setEmailSaving(true);
    try {
      const res = await fetch('/api/my/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: editEmail }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setUser((u) => (u ? { ...u, email: editEmail } : null));
        setEmailMessage({ type: 'success', text: '이메일 주소가 저장되었습니다.' });
      } else {
        setEmailMessage({ type: 'error', text: data?.error || '저장에 실패했습니다.' });
      }
    } catch {
      setEmailMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setEmailSaving(false);
    }
  };

  const handleSavePhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhoneMessage(null);
    setPhoneSaving(true);
    try {
      const res = await fetch('/api/my/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: editPhone }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setUser((u) => (u ? { ...u, phone: editPhone } : null));
        setPhoneMessage({ type: 'success', text: '전화번호가 저장되었습니다.' });
      } else {
        setPhoneMessage({ type: 'error', text: data?.error || '저장에 실패했습니다.' });
      }
    } catch {
      setPhoneMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setPhoneSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);
    if (newPassword !== newPasswordConfirm) {
      setPasswordMessage({ type: 'error', text: '새 비밀번호가 일치하지 않습니다.' });
      return;
    }
    if (newPassword.length < 4) {
      setPasswordMessage({ type: 'error', text: '비밀번호는 4자 이상으로 입력해주세요.' });
      return;
    }
    setPasswordSaving(true);
    try {
      const res = await fetch('/api/my/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setNewPassword('');
        setNewPasswordConfirm('');
        setPasswordMessage({ type: 'success', text: '비밀번호가 변경되었습니다.' });
        try {
          const me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json());
          if (me?.user) setUser(me.user);
        } catch {
          setUser((u) => (u ? { ...u, mustChangePassword: false } : null));
        }
      } else {
        setPasswordMessage({ type: 'error', text: data?.error || '변경에 실패했습니다.' });
      }
    } catch {
      setPasswordMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleSaveByokAnthropicKey = () => {
    setByokKeyMessage(null);
    if (!user?.loginId) return;
    const trimmed = byokKeyDraft.trim();
    if (!trimmed) {
      setByokKeyMessage({ type: 'error', text: '키를 입력한 뒤 저장해 주세요.' });
      return;
    }
    writeStoredByokAnthropicKey(user.loginId, trimmed);
    setByokKeyDraft('');
    setByokKeyMessage({
      type: 'success',
      text: '이 브라우저에만 저장했습니다. 변형문제 만들기 화면에서 자동으로 사용됩니다.',
    });
  };

  const handleClearByokAnthropicKey = () => {
    setByokKeyMessage(null);
    if (!user?.loginId) return;
    writeStoredByokAnthropicKey(user.loginId, '');
    setByokKeyDraft('');
    setByokKeyMessage({ type: 'success', text: '이 기기에 저장된 키를 지웠습니다.' });
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!confirm('이 주문을 취소하시겠습니까?')) return;
    setCancellingId(orderId);
    try {
      const res = await fetch('/api/orders/' + orderId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, status: 'cancelled' } : o))
        );
      } else {
        alert(data.error || '취소에 실패했습니다.');
      }
    } catch {
      alert('취소 요청 중 오류가 발생했습니다.');
    } finally {
      setCancellingId(null);
    }
  };

  const handleDeleteUpload = async (id: string) => {
    if (!confirm('이 기출문제 업로드를 삭제하시겠습니까? 첨부 파일도 함께 삭제됩니다.')) return;
    setDeletingUploadId(id);
    try {
      const res = await fetch('/api/my/past-exam-upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPastExamUploads((prev) => prev.filter((u) => u.id !== id));
      } else {
        alert(data.error || '삭제에 실패했습니다.');
      }
    } catch {
      alert('삭제 요청 중 오류가 발생했습니다.');
    } finally {
      setDeletingUploadId(null);
    }
  };

  const handlePastExamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPastExamMessage(null);
    setPastExamSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('school', pastExamSchool);
      formData.append('grade', pastExamGrade);
      formData.append('examYear', pastExamYear);
      formData.append('examType', pastExamType);
      formData.append('examScope', pastExamScope);
      if (pastExamFiles?.length) {
        for (let i = 0; i < pastExamFiles.length; i++) {
          formData.append('files', pastExamFiles[i]);
        }
      }
      const res = await fetch('/api/my/past-exam-upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPastExamMessage({ type: 'success', text: '기출문제 업로드 정보 및 파일이 접수되었습니다.' });
        setPastExamSchool('');
        setPastExamGrade('');
        setPastExamYear('');
        setPastExamType('');
        setPastExamScope('');
        setPastExamFiles(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        fetchPastExamUploads();
      } else {
        setPastExamMessage({ type: 'error', text: data?.error || '저장에 실패했습니다.' });
      }
    } catch {
      setPastExamMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setPastExamSubmitting(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) {
      setPastExamFiles(e.dataTransfer.files);
      if (fileInputRef.current) {
        const dt = new DataTransfer();
        Array.from(e.dataTransfer.files).forEach((f) => dt.items.add(f));
        fileInputRef.current.files = dt.files;
      }
    }
  };

  if (loading) {
    return (
      <>
        <AppBar title="마이페이지" />
        <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
          <div className="animate-spin w-10 h-10 border-4 border-[#2563eb] border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  if (!user) return null;

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      return d;
    }
  };

  const hasDropbox = !!user.dropboxFolderPath?.trim();

  const getPreviewType = (name: string): 'pdf' | 'image' | null => {
    const ext = name.toLowerCase().split('.').pop() || '';
    if (ext === 'pdf') return 'pdf';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
    return null;
  };

  const openPreview = (uploadId: string, fileIndex: number, fileName: string) => {
    const type = getPreviewType(fileName);
    if (!type) return;
    const url = `/api/my/past-exam-upload/download?id=${uploadId}&fileIndex=${fileIndex}&inline=1`;
    setPreviewFile({ url, name: fileName, type });
  };

  const handleMyFormatSubmit = async (e: React.FormEvent<HTMLFormElement>, type: MyFormatType) => {
    e.preventDefault();
    setMyFormatMessage(null);
    const form = e.currentTarget;
    const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
    const files = fileInput?.files;
    if (!files || files.length === 0) {
      setMyFormatMessage({ type: 'error', text: 'hwp 또는 hwpx 파일을 선택해주세요.' });
      return;
    }
    const allowed = ['.hwp', '.hwpx'];
    for (let i = 0; i < files.length; i++) {
      const ext = files[i].name.toLowerCase().slice(files[i].name.lastIndexOf('.'));
      if (!allowed.includes(ext)) {
        setMyFormatMessage({ type: 'error', text: 'hwp, hwpx 파일만 업로드 가능합니다.' });
        return;
      }
    }
    setMyFormatSubmitting(type);
    try {
      const formData = new FormData();
      formData.set('type', type);
      for (let i = 0; i < files.length; i++) formData.append('files', files[i]);
      const res = await fetch('/api/my/my-format-upload', { method: 'POST', credentials: 'include', body: formData });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMyFormatMessage({ type: 'success', text: '업로드되었습니다.' });
        fileInput.value = '';
        fetchMyFormatUploads();
      } else {
        setMyFormatMessage({ type: 'error', text: data?.error || '업로드에 실패했습니다.' });
      }
    } catch {
      setMyFormatMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setMyFormatSubmitting(null);
    }
  };

  const handleDeleteMyFormat = async (id: string) => {
    if (!confirm('이 업로드를 삭제하시겠습니까?')) return;
    setDeletingMyFormatId(id);
    try {
      const res = await fetch('/api/my/my-format-upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (res.ok && data.ok) fetchMyFormatUploads();
      else setMyFormatMessage({ type: 'error', text: data?.error || '삭제에 실패했습니다.' });
    } catch {
      setMyFormatMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setDeletingMyFormatId(null);
    }
  };

  return (
    <>
      <AppBar title="마이페이지" />
      <div className="min-h-screen bg-[#f8fafc] text-[#0f172a] font-['Noto_Sans_KR',sans-serif]">
        {/* 상단 헤더 */}
        <div className="bg-white border-b border-[#e2e8f0]">
          <div className="max-w-3xl mx-auto px-5 pt-5 pb-0">
            <Link href="/" className="inline-flex items-center gap-1 text-[#2563eb] text-[13px] font-medium hover:underline mb-4">
              ← 메인 화면으로
            </Link>
            <div className="flex items-center gap-4 mb-5">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#14213d] to-[#2563eb] flex items-center justify-center text-2xl font-black text-white shrink-0">
                {(user.name || user.loginId).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg font-extrabold tracking-tight">{user.name || user.loginId}</span>
                  {user.isAnnualMemberActive && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-600 border border-blue-200">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                      정회원
                    </span>
                  )}
                  {user.signupPremiumTrialActive && (
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-50 text-teal-800 border border-teal-200"
                      title={
                        user.signupPremiumTrialUntil
                          ? `월·연 회원 기능 무료 체험 · ${new Date(user.signupPremiumTrialUntil).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}까지`
                          : '월·연 회원 기능 무료 체험'
                      }
                    >
                      7일 무료 체험 중
                    </span>
                  )}
                  {user.isVip && (
                    <button
                      onClick={() => router.push('/my/vip')}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gradient-to-r from-amber-50 to-yellow-50 text-amber-700 border border-amber-300 hover:from-amber-100 hover:to-yellow-100 transition-all cursor-pointer animate-[vipGlow_2s_ease-in-out_infinite]"
                    >
                      <span className="animate-[vipSpin_3s_ease-in-out_infinite]">👑</span>
                      VIP
                    </button>
                  )}
                </div>
                <div className="text-sm text-[#64748b]">{user.loginId}</div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="px-4 py-2 text-[13px] text-[#64748b] border border-[#e2e8f0] rounded-xl hover:bg-gray-50 shrink-0"
              >
                로그아웃
              </button>
            </div>

            {/* Dropbox 상태 바 */}
            {hasDropbox ? (
              <div className="flex items-center gap-3 p-3 mb-5 rounded-xl bg-[#f0f9ff] border border-[#bae6fd]">
                <span className="text-base">📁</span>
                <span className="flex-1 text-[13px] text-[#0369a1] font-medium truncate">{user.dropboxFolderPath?.replace(/^\/+/, '')}</span>
                <a
                  href={user.dropboxSharedLink?.trim() || getDropboxFolderUrl(user.dropboxFolderPath!)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#0061ff] text-white rounded-lg text-[12px] font-bold hover:bg-[#0052d9] no-underline shrink-0"
                >
                  폴더 열기
                </a>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3 mb-5 rounded-xl bg-[#fffbeb] border border-[#fde68a]">
                <span className="text-base">📂</span>
                <span className="flex-1 text-[13px] text-[#92400e]">Dropbox 폴더가 아직 연결되지 않았어요. 관리자에게 문의해 주세요.</span>
              </div>
            )}

            {user.mustChangePassword && (
              <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-[#92400e] text-[13px] leading-relaxed">
                <p className="font-bold text-[#78350f] mb-1">비밀번호를 변경해 주세요</p>
                <p>
                  아직 관리자가 안내한 <strong className="text-[#92400e]">초기 비밀번호</strong>를 사용 중입니다. 보안을 위해{' '}
                  <strong className="text-[#92400e]">내 정보</strong> 탭의 비밀번호 변경란에서 새 비밀번호로 바꿔 주세요.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('settings');
                    window.setTimeout(() => {
                      passwordSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 50);
                  }}
                  className="mt-3 w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#b45309] text-white text-[12px] font-bold hover:bg-[#92400e] transition-colors"
                >
                  내 정보로 이동 → 비밀번호 변경
                </button>
              </div>
            )}

            {/* 탭 네비게이션 */}
            <div className="flex gap-0 -mb-px">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-[13px] font-semibold border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? 'border-[#2563eb] text-[#2563eb]'
                      : 'border-transparent text-[#94a3b8] hover:text-[#64748b]'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      activeTab === tab.key ? 'bg-[#2563eb] text-white' : 'bg-[#e2e8f0] text-[#64748b]'
                    }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 탭 컨텐츠 */}
        <div className="max-w-3xl mx-auto px-5 py-6">

          {/* ━━ 주문 내역 탭 ━━ */}
          {activeTab === 'orders' && (
            <div>
              {orders.length === 0 ? (
                <div className="py-20 text-center">
                  <div className="text-5xl mb-3 opacity-40">📋</div>
                  <p className="text-sm text-[#94a3b8] mb-1">아직 제출한 주문이 없습니다</p>
                  <Link href="/" className="text-[13px] text-[#2563eb] font-medium hover:underline">
                    메인에서 주문하러 가기 →
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {orders.map((order) => {
                    const variant = statusVariant(order.status);
                    const statusLabel = ORDER_STATUS_LABELS[order.status] || order.status;
                    const canDownload = !!order.fileUrl;
                    return (
                      <div key={order.id} className="bg-white rounded-2xl border border-[#e2e8f0] p-4 hover:shadow-sm transition-shadow">
                        <div className="flex items-start gap-3">
                          <div className="px-2.5 py-1 bg-[#14213d] text-white rounded-lg text-[11px] font-bold font-mono shrink-0 mt-0.5">
                            {order.orderNumber || order.id.slice(-8)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-[#0f172a] truncate mb-1.5">{orderTitle(order.orderText)}</div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-[#94a3b8]">{formatDate(order.createdAt)}</span>
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                                  variant === 'done' ? 'bg-[#dcfce7] text-[#16a34a]' :
                                  variant === 'making' ? 'bg-[#fef3c7] text-[#d97706]' :
                                  variant === 'cancel' ? 'bg-gray-100 text-gray-400' :
                                  'bg-[#dbeafe] text-[#2563eb]'
                                }`}
                              >
                                {variant === 'done' && '✓ '}
                                {variant === 'making' && '⏳ '}
                                {statusLabel}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#f1f5f9]">
                          <Link
                            href={`/order/done?id=${order.id}`}
                            className="flex-1 text-center py-2.5 border border-[#e2e8f0] rounded-xl text-xs font-semibold text-[#64748b] hover:border-[#3b82f6] hover:text-[#2563eb] no-underline transition-colors"
                          >
                            주문서 보기
                          </Link>
                          {canDownload ? (
                            <a
                              href={order.fileUrl!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 text-center py-2.5 rounded-xl text-xs font-bold bg-[#2563eb] text-white hover:bg-[#1d4ed8] no-underline transition-colors"
                            >
                              📦 자료 받기
                            </a>
                          ) : (
                            <span className="flex-1 text-center py-2.5 rounded-xl text-xs font-semibold border border-[#e2e8f0] text-[#c5cdd8] cursor-not-allowed">
                              자료 준비 중
                            </span>
                          )}
                          {order.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => handleCancelOrder(order.id)}
                              disabled={cancellingId === order.id}
                              className="py-2.5 px-3 rounded-xl text-xs text-red-500 border border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors"
                            >
                              {cancellingId === order.id ? '취소 중…' : '취소'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ━━ 학교 관리 탭 ━━ */}
          {activeTab === 'schools' && <SchoolScopeManagement />}

          {/* ━━ 학생 관리 탭 ━━ */}
          {activeTab === 'students' && (
            <StudentManagement
              onCountChange={setStudentsCount}
              onOpenSchoolTab={() => setActiveTab('schools')}
            />
          )}

          {/* ━━ 기출문제 탭 (하위: 업로드 / 조회) ━━ */}
          {activeTab === 'exam' && (
            <div className="space-y-5">
            {/* 기출 하위 메뉴 */}
            <div className="flex gap-0 border-b border-[#e2e8f0] bg-white rounded-t-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setExamSubTab('upload')}
                className={`flex-1 py-3 text-[13px] font-semibold transition-colors ${examSubTab === 'upload' ? 'text-[#2563eb] border-b-2 border-[#2563eb] bg-[#f8fafc]' : 'text-[#94a3b8] hover:text-[#64748b] bg-white'}`}
              >
                기출문제 업로드
              </button>
              <button
                type="button"
                onClick={() => setExamSubTab('list')}
                className={`flex-1 py-3 text-[13px] font-semibold transition-colors ${examSubTab === 'list' ? 'text-[#2563eb] border-b-2 border-[#2563eb] bg-[#f8fafc]' : 'text-[#94a3b8] hover:text-[#64748b] bg-white'}`}
              >
                업로드한 기출문제 조회
              </button>
            </div>

            {examSubTab === 'upload' && (
            <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#f1f5f9]">
                <p className="text-sm font-bold text-[#0f172a]">기출문제 업로드</p>
                <p className="text-[12px] text-[#94a3b8] mt-0.5">서술형 맞춤 제작에 사용할 기출문제를 등록해 주세요</p>
              </div>
              <form onSubmit={handlePastExamSubmit} className="p-5 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="past-exam-school" className="block text-xs font-semibold text-[#475569] mb-1.5">학교</label>
                    <input
                      id="past-exam-school"
                      type="text"
                      value={pastExamSchool}
                      onChange={(e) => setPastExamSchool(e.target.value)}
                      placeholder="예: OO고등학교"
                      className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)]"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="past-exam-grade" className="block text-xs font-semibold text-[#475569] mb-1.5">학년</label>
                    <select
                      id="past-exam-grade"
                      value={pastExamGrade}
                      onChange={(e) => setPastExamGrade(e.target.value)}
                      className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)] bg-white"
                      required
                    >
                      <option value="">선택하세요</option>
                      <option value="고1">고1</option>
                      <option value="고2">고2</option>
                      <option value="고3">고3</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="past-exam-year" className="block text-xs font-semibold text-[#475569] mb-1.5">시험연도</label>
                    <select
                      id="past-exam-year"
                      value={pastExamYear}
                      onChange={(e) => setPastExamYear(e.target.value)}
                      className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)] bg-white"
                      required
                    >
                      <option value="">선택하세요</option>
                      {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                        <option key={y} value={String(y)}>{y}년</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="past-exam-type" className="block text-xs font-semibold text-[#475569] mb-1.5">시험 종류</label>
                    <select
                      id="past-exam-type"
                      value={pastExamType}
                      onChange={(e) => setPastExamType(e.target.value)}
                      className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)] bg-white"
                      required
                    >
                      <option value="">선택하세요</option>
                      <option value="1학기중간고사">1학기 중간고사</option>
                      <option value="1학기기말고사">1학기 기말고사</option>
                      <option value="2학기중간고사">2학기 중간고사</option>
                      <option value="2학기기말고사">2학기 기말고사</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="past-exam-scope" className="block text-xs font-semibold text-[#475569] mb-1.5">시험범위</label>
                  <textarea
                    id="past-exam-scope"
                    value={pastExamScope}
                    onChange={(e) => setPastExamScope(e.target.value)}
                    placeholder="시험범위를 자유롭게 입력해 주세요"
                    rows={3}
                    className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)] resize-y"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">기출문제 파일 첨부 (선택)</label>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative flex flex-col items-center justify-center py-8 px-4 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
                      dragActive
                        ? 'border-[#2563eb] bg-[#eff6ff]'
                        : 'border-[#d1d5db] bg-[#fafafa] hover:border-[#93c5fd] hover:bg-[#f0f9ff]'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.hwp,.hwpx"
                      onChange={(e) => setPastExamFiles(e.target.files?.length ? e.target.files : null)}
                      className="hidden"
                    />
                    <div className="text-3xl mb-2 opacity-50">📎</div>
                    <p className="text-sm font-medium text-[#475569] mb-1">파일을 끌어다 놓거나 클릭하세요</p>
                    <p className="text-[11px] text-[#94a3b8]">PDF, HWP, HWPX 또는 이미지 · 최대 5개 · 각 15MB 이하</p>
                  </div>
                  {pastExamFiles?.length ? (
                    <div className="mt-3 space-y-1.5">
                      {Array.from(pastExamFiles).map((f, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-2 bg-[#f1f5f9] rounded-lg text-[12px]">
                          <span className="text-[#64748b]">📄</span>
                          <span className="flex-1 truncate text-[#334155] font-medium">{f.name}</span>
                          <span className="text-[#94a3b8] shrink-0">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                {pastExamMessage && (
                  <div className={`flex items-center gap-2 p-3 rounded-xl text-sm font-medium ${
                    pastExamMessage.type === 'success' ? 'bg-[#dcfce7] text-[#16a34a]' : 'bg-[#fef2f2] text-[#dc2626]'
                  }`}>
                    <span>{pastExamMessage.type === 'success' ? '✓' : '!'}</span>
                    {pastExamMessage.text}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={pastExamSubmitting}
                  className="w-full py-3.5 bg-[#16a34a] text-white rounded-xl text-sm font-bold hover:bg-[#15803d] disabled:opacity-70 transition-colors"
                >
                  {pastExamSubmitting ? '접수 중…' : '기출문제 업로드'}
                </button>
              </form>
            </div>
            )}

            {examSubTab === 'list' && (
            <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#f1f5f9] flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-[#0f172a]">기출문제 조회</p>
                  <p className="text-[12px] text-[#94a3b8] mt-0.5">내가 올린 기출문제 {pastExamUploads.length}건</p>
                </div>
              </div>
              {pastExamLoading ? (
                <div className="py-10 text-center">
                  <div className="animate-spin w-6 h-6 border-3 border-[#2563eb] border-t-transparent rounded-full mx-auto" />
                </div>
              ) : pastExamUploads.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="text-4xl mb-2 opacity-30">📋</div>
                  <p className="text-sm text-[#94a3b8]">아직 올린 기출문제가 없습니다</p>
                </div>
              ) : (
                <>
                <div className="divide-y divide-[#f1f5f9]">
                  {(examListExpanded ? pastExamUploads : pastExamUploads.slice(0, 3)).map((upload) => (
                    <div key={upload.id} className="px-5 py-4 hover:bg-[#fafafa] transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[#0f172a] mb-1">
                            {upload.school} · {upload.grade} · {upload.examYear}년 {upload.examType}
                          </div>
                          {upload.examScope && (
                            <p className="text-xs text-[#64748b] mb-1.5 line-clamp-2">시험범위: {upload.examScope}</p>
                          )}
                          {upload.adminCategories && upload.adminCategories.length > 0 ? (
                            <div className="mb-1.5 flex flex-wrap items-center gap-1">
                              <span className="text-[11px] text-[#16a34a] font-semibold">관리자 분류:</span>
                              <span className="text-[11px] text-[#475569]">{upload.adminCategories.join(', ')}</span>
                            </div>
                          ) : (
                            <p className="text-[11px] text-amber-600 font-medium mb-1.5">서술형 기출문제를 분석 중입니다.</p>
                          )}
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="text-[11px] text-[#94a3b8]">{formatDate(upload.createdAt)}</span>
                            {upload.files.length > 0 && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-[#64748b] bg-[#f1f5f9] px-2 py-0.5 rounded-full">
                                📎 파일 {upload.files.length}개
                              </span>
                            )}
                          </div>
                          {upload.files.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                              {upload.files.map((f, i) => {
                                const previewable = !!getPreviewType(f.originalName);
                                return (
                                  <div key={i} className="flex items-center gap-1.5 text-[11px]">
                                    <span className="text-[#94a3b8]">📄</span>
                                    <a
                                      href={`/api/my/past-exam-upload/download?id=${upload.id}&fileIndex=${f.fileIndex}`}
                                      className="text-[#2563eb] hover:underline truncate no-underline flex-1 min-w-0"
                                      download
                                    >
                                      {f.originalName}
                                    </a>
                                    {previewable && (
                                      <button
                                        type="button"
                                        onClick={() => openPreview(upload.id, f.fileIndex, f.originalName)}
                                        className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold text-[#475569] bg-[#f1f5f9] hover:bg-[#e2e8f0] transition-colors"
                                      >
                                        미리보기
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteUpload(upload.id)}
                          disabled={deletingUploadId === upload.id}
                          className="shrink-0 px-3 py-2 rounded-xl text-xs text-red-500 border border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors"
                        >
                          {deletingUploadId === upload.id ? '삭제 중…' : '삭제'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {pastExamUploads.length > 3 && !examListExpanded && (
                  <div className="px-5 py-4 border-t border-[#f1f5f9]">
                    <button
                      type="button"
                      onClick={() => setExamListExpanded(true)}
                      className="w-full py-2.5 rounded-xl border border-[#e2e8f0] text-[13px] font-semibold text-[#64748b] hover:bg-[#f8fafc] hover:border-[#cbd5e1] transition-colors"
                    >
                      더보기 ({pastExamUploads.length - 3}건 더)
                    </button>
                  </div>
                )}
                {examListExpanded && pastExamUploads.length > 3 && (
                  <div className="px-5 py-3 border-t border-[#f1f5f9]">
                    <button
                      type="button"
                      onClick={() => setExamListExpanded(false)}
                      className="text-[12px] text-[#94a3b8] hover:text-[#64748b]"
                    >
                      접기
                    </button>
                  </div>
                )}
                </>
              )}
            </div>
            )}
            </div>
          )}

          {/* ━━ 나의양식 탭 ━━ */}
          {activeTab === 'myFormat' && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                <p className="text-sm font-bold text-[#0f172a] mb-2">맞춤형 자료 제작</p>
                <p className="text-[13px] text-[#475569] mb-2">업로드하신 양식(hwp, hwpx)을 바탕으로 맞춤형 자료를 제작해 드립니다.</p>
                <div className="text-[13px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-3 mb-3 leading-relaxed space-y-2">
                  <p>
                    맞춤형 자료 제작은 <strong>연회원</strong> 전용입니다. 연회비·이용 절차·결제 방법 등은 <strong>카카오톡</strong>으로 문의해 주시면 안내해 드립니다.
                  </p>
                  <p className="text-[12px] text-amber-950/90 font-medium">
                    참고 요금: {membershipPricingOneLiner()}
                  </p>
                </div>
                <ul className="text-[13px] text-[#475569] space-y-1.5 list-disc list-inside">
                  <li><strong className="text-[#0f172a]">강의용자료</strong>: 영어 지문만 포함된 자료입니다.</li>
                  <li><strong className="text-[#0f172a]">수업용자료</strong>: 영어 지문 + 한글 해석이 포함된 자료입니다.</li>
                  <li><strong className="text-[#0f172a]">변형문제</strong>: 워크북(빈칸·낱말배열·한줄해석 등) 맞춤 제작 시 사용할 양식입니다.</li>
                </ul>
              </div>

              {!user?.myFormatApproved ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                  <p className="text-sm font-bold text-amber-800 mb-2">맞춤 HWP로 제작하시려면</p>
                  <p className="text-[13px] text-amber-900 mb-2 leading-relaxed">
                    보내주신 hwp/hwpx 양식 그대로 반영해 맞춤 제작이 가능합니다. 연회원 관련 문의(절차·비용 등)는 <strong>카카오톡</strong>으로 연락 주시면 안내해 드립니다. ({membershipPricingOneLiner()})
                  </p>
                  <p className="text-[13px] text-amber-900 mb-3 leading-relaxed">
                    승인 후 이 화면에서 유형별로 올리시면 주문 시 맞춤 양식을 선택하실 수 있어요.
                  </p>
                  <a href={KAKAO_INQUIRY_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#FEE500] text-[#191919] rounded-xl text-[13px] font-bold hover:opacity-90 no-underline">
                    카카오톡 문의하기
                  </a>
                </div>
              ) : (
                <>
                  <p className="text-[12px] text-[#64748b]">hwp, hwpx 파일만 업로드 가능합니다. 유형별로 업로드해 주세요.</p>
                  {myFormatMessage && (
                    <p className={`text-sm ${myFormatMessage.type === 'success' ? 'text-[#16a34a]' : 'text-red-600'}`}>{myFormatMessage.text}</p>
                  )}

              {(['강의용자료', '수업용자료', '변형문제'] as const).map((type) => (
                <div key={type} className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden">
                  <div className="px-5 py-4 border-b border-[#f1f5f9] bg-[#f8fafc]">
                    <h3 className="text-sm font-bold text-[#0f172a]">{type}</h3>
                  </div>
                  <div className="p-5 space-y-4">
                    <form onSubmit={(e) => handleMyFormatSubmit(e, type)} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="type" value={type} />
                      <label className="flex-1 min-w-[180px]">
                        <span className="block text-xs font-semibold text-[#475569] mb-1.5">파일 선택 (hwp, hwpx)</span>
                        <input
                          type="file"
                          accept=".hwp,.hwpx"
                          multiple
                          className="w-full px-3 py-2.5 border border-[#e2e8f0] rounded-xl text-[13px] file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#2563eb] file:text-white hover:file:bg-[#1d4ed8]"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={myFormatSubmitting === type}
                        className="px-5 py-2.5 bg-[#2563eb] text-white rounded-xl text-[13px] font-bold hover:bg-[#1d4ed8] disabled:opacity-70 shrink-0"
                      >
                        {myFormatSubmitting === type ? '업로드 중…' : '업로드'}
                      </button>
                    </form>

                    {myFormatLoading ? (
                      <p className="text-sm text-[#94a3b8]">불러오는 중…</p>
                    ) : myFormatByType[type].length === 0 ? (
                      <p className="text-sm text-[#94a3b8]">업로드한 파일이 없습니다.</p>
                    ) : (
                      <ul className="space-y-2">
                        {myFormatByType[type].map((upload) => (
                          <li key={upload.id} className="flex items-center justify-between gap-2 py-2 border-t border-[#f1f5f9] first:border-t-0 first:pt-0">
                            <div className="min-w-0 flex-1">
                              <span className="text-[11px] text-[#94a3b8]">{formatDate(upload.createdAt)}</span>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {upload.files.map((f, i) => (
                                  <a
                                    key={i}
                                    href={`/api/my/my-format-upload/download?id=${upload.id}&fileIndex=${f.fileIndex}`}
                                    className="text-[13px] font-medium text-[#2563eb] hover:underline truncate max-w-[200px]"
                                  >
                                    📎 {f.originalName}
                                  </a>
                                ))}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteMyFormat(upload.id)}
                              disabled={deletingMyFormatId === upload.id}
                              className="text-[12px] text-red-500 hover:text-red-600 disabled:opacity-50 shrink-0"
                            >
                              {deletingMyFormatId === upload.id ? '삭제 중…' : '삭제'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
                </>
              )}
            </div>
          )}

          {/* ━━ 연회원 무료공유자료 ━━ */}
          {activeTab === 'annualShared' && annualMenuUnlocked && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                <p className="text-sm font-bold text-[#0f172a] mb-1">무료 공유 자료</p>
                <p className="text-[12px] text-[#94a3b8] leading-relaxed">
                  연회원 기간 동안 관리자가 올린 HWP·PDF 자료를 언제든지 내려받을 수 있어요.
                </p>
              </div>
              {annualSharedLoading ? (
                <div className="py-16 text-center text-[13px] text-[#94a3b8]">불러오는 중…</div>
              ) : annualSharedItems.length === 0 ? (
                <div className="py-16 text-center rounded-2xl border border-[#e2e8f0] bg-white">
                  <div className="text-4xl mb-2 opacity-40">📥</div>
                  <p className="text-sm text-[#94a3b8]">등록된 자료가 아직 없습니다.</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {annualSharedItems.map((item) => (
                    <li
                      key={item.id}
                      className="bg-white rounded-2xl border border-[#e2e8f0] p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#0f172a]">{item.title || item.originalName}</p>
                        {item.description ? (
                          <p className="text-[12px] text-[#64748b] mt-1 whitespace-pre-wrap">{item.description}</p>
                        ) : null}
                        <p className="text-[11px] text-[#94a3b8] mt-2">
                          {item.originalName}
                          <span className="mx-1.5">·</span>
                          {formatFileSize(item.size)}
                          {item.uploadedAt ? (
                            <>
                              <span className="mx-1.5">·</span>
                              {formatDate(item.uploadedAt)}
                            </>
                          ) : null}
                        </p>
                      </div>
                      <a
                        href={`/api/my/annual-shared-files/${item.id}/download`}
                        className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl text-[13px] font-bold bg-[#2563eb] text-white hover:bg-[#1d4ed8] no-underline shrink-0"
                      >
                        다운로드
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ━━ 단어장 탭 ━━ */}
          {activeTab === 'vocabulary' && annualMenuUnlocked && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                <p className="text-sm font-bold text-[#0f172a] mb-1">단어장 다운로드</p>
                <p className="text-[12px] text-[#94a3b8] leading-relaxed">
                  <strong className="text-[#64748b]">공식 모의고사</strong> 교재만 선택할 수 있어요. 지문·CEFR·포함 항목을 설정한 뒤 엑셀·PDF·시험지로 내려받습니다.
                </p>
              </div>

              {/* 교재 선택 */}
              <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                <label className="block text-sm font-bold text-[#0f172a] mb-2">교재 선택</label>
                <p className="text-[11px] text-[#94a3b8] mb-2">부교재(EBS 등)는 목록에 포함되지 않습니다.</p>
                <select
                  value={vocabSelectedTextbook}
                  onChange={(e) => setVocabSelectedTextbook(e.target.value)}
                  className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] bg-white outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)]"
                >
                  <option value="">교재를 선택하세요</option>
                  {vocabTextbookList.map((tb) => (
                    <option key={tb} value={tb}>{tb}</option>
                  ))}
                </select>
              </div>

              {/* 강·번호 선택 */}
              {vocabSelectedTextbook && Object.keys(vocabLessonGroups).length > 0 && (
                <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-[#0f172a]">강·번호 선택</span>
                    <button type="button" onClick={handleVocabAllToggle} className="text-[11px] text-[#2563eb] hover:underline">
                      {vocabSelectedLessons.length === vocabAllFlat.length ? '전체 해제' : '전체 선택'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {Object.keys(vocabLessonGroups).map((lk) => {
                      const group = vocabLessonGroups[lk];
                      const allSel = group.every((l) => vocabSelectedLessons.includes(l));
                      const someSel = group.some((l) => vocabSelectedLessons.includes(l));
                      const expanded = vocabExpandedLessons.includes(lk);
                      return (
                        <div key={lk} className="border border-[#f1f5f9] rounded-xl overflow-hidden">
                          <div className="flex items-center gap-2 px-3 py-2.5 bg-[#f8fafc]">
                            <input type="checkbox" checked={allSel} ref={(el) => { if (el) el.indeterminate = someSel && !allSel; }} onChange={() => handleVocabGroupToggle(lk)} className="accent-[#2563eb] w-3.5 h-3.5" />
                            <span className="text-[13px] font-medium text-[#334155] flex-1">{lk}</span>
                            <button type="button" onClick={() => handleVocabExpandToggle(lk)} className="text-[11px] text-[#94a3b8] hover:text-[#64748b] px-1">{expanded ? '−' : '+'}</button>
                          </div>
                          {expanded && (
                            <div className="flex flex-wrap gap-1.5 px-3 py-2 bg-white">
                              {group.map((l) => {
                                const num = l.includes(' ') ? l.split(' ').slice(1).join(' ') : l;
                                const sel = vocabSelectedLessons.includes(l);
                                return (
                                  <button type="button" key={l} onClick={() => handleVocabLessonChange(l)}
                                    className={`px-2.5 py-1 rounded-lg text-[12px] border transition-colors ${sel ? 'bg-[#2563eb] text-white border-[#2563eb]' : 'bg-white text-[#64748b] border-[#e2e8f0] hover:border-[#94a3b8]'}`}
                                  >{num}</button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 옵션 패널 — 지문 선택 후 표시 */}
              {vocabSelectedTextbook && vocabSelectedLessons.length > 0 && (
                <>
                  {/* CEFR 난이도 필터 */}
                  <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-sm font-bold text-[#0f172a]">CEFR 난이도</span>
                      <button type="button" onClick={() => setVocabCefrLevels((p) => p.length === 6 ? [] : ['A1','A2','B1','B2','C1','C2'])} className="text-[11px] text-[#2563eb] hover:underline">
                        {vocabCefrLevels.length === 6 ? '전체 해제' : '전체 선택'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {['A1','A2','B1','B2','C1','C2'].map((lv) => {
                        const sel = vocabCefrLevels.includes(lv);
                        const colors: Record<string, string> = { A1: '#22c55e', A2: '#16a34a', B1: '#eab308', B2: '#f59e0b', C1: '#ef4444', C2: '#dc2626' };
                        return (
                          <button type="button" key={lv} onClick={() => setVocabCefrLevels((p) => sel ? p.filter((x) => x !== lv) : [...p, lv])}
                            className={`px-3.5 py-1.5 rounded-lg text-[12px] font-bold border transition-all ${sel ? 'text-white border-transparent' : 'bg-white text-[#94a3b8] border-[#e2e8f0]'}`}
                            style={sel ? { backgroundColor: colors[lv] } : undefined}
                          >{lv}</button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-[#94a3b8] mt-2">CEFR 미지정 단어는 항상 포함됩니다</p>
                  </div>

                  {/* 포함 항목 */}
                  <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                    <span className="text-sm font-bold text-[#0f172a] block mb-2.5">포함 항목</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {([
                        ['pos', '품사'],
                        ['cefr', 'CEFR'],
                        ['meaning', '뜻'],
                        ['wordType', '유형(단어/숙어)'],
                        ['synonym', '동의어'],
                        ['antonym', '반의어'],
                        ['opposite', '유의어(기타)'],
                      ] as [keyof typeof vocabColumns, string][]).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-1.5 text-[12px] text-[#334155] cursor-pointer">
                          <input type="checkbox" checked={vocabColumns[key]} onChange={() => setVocabColumns((p) => ({ ...p, [key]: !p[key] }))} className="accent-[#2563eb] w-3.5 h-3.5" />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* 다운로드 버튼들 */}
                  <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5 space-y-3">
                    <div className="text-center mb-1">
                      <span className="text-[13px] text-[#64748b]">
                        선택된 지문: <span className="font-bold text-[#0f172a]">{vocabSelectedLessons.length}개</span>
                        {vocabCefrLevels.length < 6 && <span className="ml-2 text-[11px]">({vocabCefrLevels.join(', ')})</span>}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button type="button" onClick={() => handleVocabDownload('xlsx')} disabled={vocabDownloading}
                        className="py-3 bg-[#2563eb] text-white rounded-xl text-[13px] font-bold hover:bg-[#1d4ed8] disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        단어장 (Excel)
                      </button>
                      <button type="button" onClick={() => handleVocabDownload('pdf')} disabled={vocabDownloading}
                        className="py-3 bg-[#14213d] text-white rounded-xl text-[13px] font-bold hover:opacity-90 disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        단어장 (PDF)
                      </button>
                    </div>

                    <div className="border-t border-[#f1f5f9] pt-3">
                      <p className="text-[11px] text-[#94a3b8] mb-2">단어 시험지 — 학생용 빈칸 시험지 + 정답지</p>
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1 text-[12px] text-[#334155] cursor-pointer">
                            <input type="radio" name="vocabTestDir" checked={vocabTestDirection === 'word-to-meaning'} onChange={() => setVocabTestDirection('word-to-meaning')} className="accent-[#2563eb]" />
                            영어 → 뜻
                          </label>
                          <label className="flex items-center gap-1 text-[12px] text-[#334155] cursor-pointer">
                            <input type="radio" name="vocabTestDir" checked={vocabTestDirection === 'meaning-to-word'} onChange={() => setVocabTestDirection('meaning-to-word')} className="accent-[#2563eb]" />
                            뜻 → 영어
                          </label>
                        </div>
                        <span className="text-[#e2e8f0]">|</span>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1 text-[12px] text-[#334155] cursor-pointer">
                            <input type="radio" name="vocabTestCols" checked={vocabTestColumns === 1} onChange={() => setVocabTestColumns(1)} className="accent-[#2563eb]" />
                            1단
                          </label>
                          <label className="flex items-center gap-1 text-[12px] text-[#334155] cursor-pointer">
                            <input type="radio" name="vocabTestCols" checked={vocabTestColumns === 2} onChange={() => setVocabTestColumns(2)} className="accent-[#2563eb]" />
                            2단
                          </label>
                        </div>
                        <span className="text-[#e2e8f0]">|</span>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1 text-[12px] text-[#334155] cursor-pointer">
                            <input type="radio" name="vocabTestOrder" checked={!vocabTestShuffle} onChange={() => setVocabTestShuffle(false)} className="accent-[#2563eb]" />
                            순서대로
                          </label>
                          <label className="flex items-center gap-1 text-[12px] text-[#334155] cursor-pointer">
                            <input type="radio" name="vocabTestOrder" checked={vocabTestShuffle} onChange={() => setVocabTestShuffle(true)} className="accent-[#2563eb]" />
                            랜덤
                          </label>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => handleVocabDownload('test-xlsx')} disabled={vocabDownloading}
                          className="py-2.5 bg-[#2563eb] text-white rounded-xl text-[13px] font-bold hover:bg-[#1d4ed8] disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5">
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          시험지 (Excel)
                        </button>
                        <button type="button" onClick={() => handleVocabDownload('test-pdf')} disabled={vocabDownloading}
                          className="py-2.5 bg-[#14213d] text-white rounded-xl text-[13px] font-bold hover:opacity-90 disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5">
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          시험지 (PDF)
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ━━ VIP 탭 ━━ */}
          {activeTab === 'vip' && user.isVip && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-[#1e1b4b] to-[#312e81] rounded-2xl p-6 text-white">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl animate-[vipSpin_3s_ease-in-out_infinite]">👑</span>
                  <h3 className="text-lg font-bold">맞춤 학습 관리</h3>
                </div>
                <p className="text-sm text-indigo-200 mb-4">학생 관리, 시험 분석, 변형문제 생성 등 VIP 전용 고급 기능을 이용하세요.</p>
                <button
                  onClick={() => router.push('/my/vip')}
                  className="px-5 py-2.5 bg-white text-[#312e81] rounded-xl font-semibold text-sm hover:bg-indigo-50 transition-colors"
                >
                  관리 센터 이동 →
                </button>
              </div>
            </div>
          )}

          {/* ━━ 내 정보 탭 ━━ */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              {user.isPremiumMember && (
                <div
                  ref={byokApiKeySectionRef}
                  id="byok-api-key"
                  className="bg-white rounded-2xl border border-[#c7d2fe] p-5 shadow-sm shadow-indigo-50"
                >
                  <div className="text-sm font-bold text-[#1e1b4b] mb-1">Anthropic API 키 (변형문제)</div>
                  <p className="text-[12px] text-[#475569] leading-relaxed mb-3">
                    <strong className="text-[#334155]">변형문제 만들기</strong> 화면에는 키 입력란이 없습니다.{' '}
                    <strong className="text-[#334155]">여기(내 정보 탭)에서만</strong> 등록·변경할 수 있어요. 키는{' '}
                    <strong className="text-[#334155]">이 브라우저(기기)의 로컬 저장소</strong>에만 보관되며, 서버 DB에는
                    저장되지 않습니다. 생성 요청 시에만 Anthropic으로 전달됩니다.
                  </p>
                  <ol className="list-decimal list-inside text-[12px] text-[#475569] space-y-1.5 mb-4">
                    <li>
                      <a
                        href="https://platform.claude.com/settings/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#2563eb] font-semibold underline underline-offset-2 hover:text-[#1d4ed8]"
                      >
                        Claude Platform
                      </a>
                      에서 API 키를 발급합니다.
                    </li>
                    <li>아래 입력란에 키를 붙여넣고 「이 브라우저에 저장」을 누릅니다.</li>
                    <li>메인의 「변형문제 만들기」로 이동해 지문을 넣고 생성합니다.</li>
                  </ol>
                  <div className="rounded-xl bg-[#f8fafc] border border-[#e2e8f0] px-3 py-2.5 mb-3 text-[12px] text-[#64748b]">
                    {user.loginId && hasStoredByokAnthropicKey(user.loginId) ? (
                      <span className="text-[#0f766e] font-semibold">이 브라우저에 키가 저장되어 있습니다.</span>
                    ) : (
                      <span>아직 이 브라우저에 저장된 키가 없습니다.</span>
                    )}
                  </div>
                  <label className="block">
                    <span className="text-[12px] font-bold text-[#334155]">새 키 입력 (저장 시에만 덮어씀)</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={byokKeyDraft}
                      onChange={(e) => setByokKeyDraft(e.target.value)}
                      className="mt-1 w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] font-mono outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[rgba(99,102,241,0.15)]"
                      placeholder="sk-ant-api03-..."
                    />
                  </label>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      type="button"
                      onClick={handleSaveByokAnthropicKey}
                      className="px-4 py-2.5 rounded-xl bg-[#4f46e5] text-white text-[13px] font-bold hover:bg-[#4338ca] transition-colors"
                    >
                      이 브라우저에 저장
                    </button>
                    <button
                      type="button"
                      onClick={handleClearByokAnthropicKey}
                      className="px-4 py-2.5 rounded-xl border border-[#cbd5e1] text-[#475569] text-[13px] font-semibold hover:bg-[#f1f5f9] transition-colors"
                    >
                      저장된 키 지우기
                    </button>
                    <Link
                      href="/my/premium/variant-generate"
                      className="inline-flex items-center px-4 py-2.5 rounded-xl border-2 border-[#4f46e5] text-[#4338ca] text-[13px] font-bold hover:bg-[#eef2ff] transition-colors"
                    >
                      변형문제 만들기 →
                    </Link>
                  </div>
                  {byokKeyMessage && (
                    <p
                      className={`text-sm mt-3 ${byokKeyMessage.type === 'success' ? 'text-[#16a34a]' : 'text-red-600'}`}
                    >
                      {byokKeyMessage.text}
                    </p>
                  )}
                </div>
              )}

              {/* 이메일 */}
              <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                <div className="text-sm font-bold text-[#0f172a] mb-3">이메일 주소</div>
                <form onSubmit={handleSaveEmail} className="flex gap-2 items-center">
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="flex-1 px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)]"
                  />
                  <button type="submit" disabled={emailSaving} className="px-5 py-3 bg-[#2563eb] text-white rounded-xl text-[13px] font-bold shrink-0 hover:bg-[#1d4ed8] disabled:opacity-70 transition-colors">
                    {emailSaving ? '저장 중…' : '저장'}
                  </button>
                </form>
                {emailMessage && (
                  <p className={`text-sm mt-2 ${emailMessage.type === 'success' ? 'text-[#16a34a]' : 'text-red-600'}`}>{emailMessage.text}</p>
                )}
              </div>

              {/* 전화번호 */}
              <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                <div className="text-sm font-bold text-[#0f172a] mb-1">전화번호</div>
                <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
                  변형문제 저장 시 식별을 위해 사용됩니다. 숫자만 입력해도 됩니다.
                </p>
                <form onSubmit={handleSavePhone} className="flex gap-2 items-center">
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="예: 010-1234-5678"
                    className="flex-1 px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)]"
                  />
                  <button type="submit" disabled={phoneSaving} className="px-5 py-3 bg-[#2563eb] text-white rounded-xl text-[13px] font-bold shrink-0 hover:bg-[#1d4ed8] disabled:opacity-70 transition-colors">
                    {phoneSaving ? '저장 중…' : '저장'}
                  </button>
                </form>
                {phoneMessage && (
                  <p className={`text-sm mt-2 ${phoneMessage.type === 'success' ? 'text-[#16a34a]' : 'text-red-600'}`}>{phoneMessage.text}</p>
                )}
              </div>

              {/* 비밀번호 변경 */}
              <div
                ref={passwordSectionRef}
                className={`bg-white rounded-2xl border p-5 ${
                  user.mustChangePassword ? 'border-amber-300 ring-2 ring-amber-200/80 shadow-sm shadow-amber-100' : 'border-[#e2e8f0]'
                }`}
              >
                <div className="text-sm font-bold text-[#0f172a] mb-1">비밀번호 변경</div>
                {user.mustChangePassword && (
                  <p className="text-[12px] text-amber-800 mb-3 leading-relaxed">
                    다른 사람이 쉽게 알 수 있는 비밀번호는 계정을 위험에 노출시킬 수 있어요. 안전한 이용을 위해 본인만 아는 새 비밀번호로 바꿔 주세요.
                  </p>
                )}
                <form onSubmit={handleChangePassword} className="space-y-3">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="새 비밀번호"
                    className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)]"
                    minLength={4}
                    autoComplete="new-password"
                  />
                  <input
                    type="password"
                    value={newPasswordConfirm}
                    onChange={(e) => setNewPasswordConfirm(e.target.value)}
                    placeholder="새 비밀번호 확인"
                    className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)]"
                    minLength={4}
                    autoComplete="new-password"
                  />
                  <button
                    type="submit"
                    disabled={passwordSaving}
                    className="w-full py-3 bg-[#14213d] text-white rounded-xl text-[13px] font-bold hover:opacity-90 disabled:opacity-70 transition-colors"
                  >
                    {passwordSaving ? '변경 중…' : '비밀번호 변경'}
                  </button>
                </form>
                {passwordMessage && (
                  <p className={`text-sm mt-2 ${passwordMessage.type === 'success' ? 'text-[#16a34a]' : 'text-red-600'}`}>{passwordMessage.text}</p>
                )}
              </div>

              {/* Dropbox 정보 */}
              <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                <div className="text-sm font-bold text-[#0f172a] mb-3">Dropbox 폴더</div>
                {hasDropbox ? (
                  <div className="flex items-center gap-3 p-3 bg-[#f0f9ff] border border-[#bae6fd] rounded-xl">
                    <span className="text-lg">📁</span>
                    <span className="flex-1 text-[13px] text-[#0369a1] font-mono font-medium break-all">{user.dropboxFolderPath?.replace(/^\/+/, '')}</span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold bg-[#dcfce7] text-[#16a34a]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />연결됨
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 bg-[#fffbeb] border border-[#fde68a] rounded-xl">
                    <span className="text-lg">📂</span>
                    <span className="flex-1 text-[13px] text-[#92400e]">아직 연결되지 않았어요. 관리자에게 문의해 주세요.</span>
                  </div>
                )}
              </div>

              {/* 포인트 */}
              <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                <div className="text-sm font-bold text-[#0f172a] mb-3">내 포인트</div>
                <div className="flex flex-wrap items-center gap-3 mb-5">
                  <span className="text-2xl font-black tracking-tight">
                    {(user.points ?? 0).toLocaleString()}{' '}
                    <sub className="text-xs font-medium text-[#94a3b8]">P</sub>
                  </span>
                  <span className="px-3 py-1.5 bg-[#f0fdf4] border border-[#bbf7d0] rounded-full text-[11px] text-[#166534]">
                    주문 시 포인트 사용 가능
                  </span>
                  <button
                    type="button"
                    onClick={() => setPointChargeOpen(true)}
                    className="px-4 py-2 rounded-xl bg-[#0064ff] text-white text-[13px] font-bold hover:opacity-95 shadow-sm border border-[#0052cc]"
                  >
                    미리 충전하기
                  </button>
                </div>

                <div className="border-t border-[#f1f5f9] pt-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-xs font-bold text-[#475569]">포인트 사용·적립 내역</span>
                    {pointHistoryLoading && (
                      <span className="text-[11px] text-[#94a3b8]">불러오는 중…</span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#94a3b8] mb-3 leading-relaxed">
                    시스템에 기록된 거래만 표시됩니다. 이 기능 도입 이전 주문·지급은 목록에 없을 수 있어요.
                  </p>
                  {pointHistoryLoading && pointHistory.length === 0 ? (
                    <div className="rounded-xl bg-[#f8fafc] border border-[#e2e8f0] py-8 text-center text-[13px] text-[#94a3b8]">
                      내역을 불러오는 중입니다…
                    </div>
                  ) : !pointHistoryLoading && pointHistory.length === 0 ? (
                    <div className="rounded-xl bg-[#f8fafc] border border-[#e2e8f0] py-8 text-center text-[13px] text-[#94a3b8]">
                      아직 표시할 내역이 없습니다.
                    </div>
                  ) : (
                    <div className="rounded-xl border border-[#e2e8f0] overflow-hidden overflow-x-auto">
                      <table className="w-full text-left text-[12px] min-w-[320px]">
                        <thead>
                          <tr className="bg-[#f8fafc] text-[#64748b] font-semibold border-b border-[#e2e8f0]">
                            <th className="px-3 py-2.5 whitespace-nowrap">일시</th>
                            <th className="px-3 py-2.5 whitespace-nowrap">구분</th>
                            <th className="px-3 py-2.5 whitespace-nowrap text-right">변동</th>
                            <th className="px-3 py-2.5 whitespace-nowrap text-right">잔액</th>
                            <th className="px-3 py-2.5 min-w-[100px]">비고</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pointHistory.map((row) => {
                            const orderNumber =
                              typeof row.meta?.orderNumber === 'string' ? row.meta.orderNumber : '';
                            const chargePts = typeof row.meta?.points === 'number' ? row.meta.points : null;
                            const note =
                              row.kind === 'point_charge' && chargePts != null
                                ? `토스 결제 · ${chargePts.toLocaleString()}P`
                                : row.kind === 'order_spend' && orderNumber
                                  ? `주문 ${orderNumber}`
                                  : row.kind === 'order_cancel_refund'
                                    ? orderNumber
                                      ? `취소 환급 · ${orderNumber}`
                                      : '주문 취소 환급'
                                    : row.kind === 'member_variant_hard'
                                      ? '삽입-고난도 초안 생성'
                                      : '';
                            const deltaStr =
                              row.delta > 0
                                ? `+${row.delta.toLocaleString()}`
                                : row.delta.toLocaleString();
                            return (
                              <tr
                                key={row.id}
                                className="border-b border-[#f1f5f9] last:border-0 hover:bg-[#fafafa]"
                              >
                                <td className="px-3 py-2.5 text-[#475569] whitespace-nowrap align-top">
                                  {formatPointHistoryWhen(row.createdAt)}
                                </td>
                                <td className="px-3 py-2.5 text-[#0f172a] whitespace-nowrap align-top">
                                  {pointHistoryKindLabel(row.kind)}
                                </td>
                                <td
                                  className={`px-3 py-2.5 text-right font-bold whitespace-nowrap align-top ${
                                    row.delta >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]'
                                  }`}
                                >
                                  {deltaStr} P
                                </td>
                                <td className="px-3 py-2.5 text-right text-[#0f172a] font-medium whitespace-nowrap align-top">
                                  {row.balanceAfter.toLocaleString()} P
                                </td>
                                <td className="px-3 py-2.5 text-[#64748b] align-top break-words max-w-[200px]">
                                  {(row.kind === 'order_spend' || row.kind === 'order_cancel_refund') &&
                                  orderNumber ? (
                                    <>
                                      {row.kind === 'order_cancel_refund' ? '취소 환급 · ' : '주문 '}
                                      {(() => {
                                        const detailId = resolvePointHistoryOrderDetailId(
                                          row.meta,
                                          orderNumber,
                                          orderIdByOrderNumber
                                        );
                                        return detailId ? (
                                          <Link
                                            href={`/order/done?id=${encodeURIComponent(detailId)}`}
                                            className="text-[#2563eb] font-semibold hover:underline font-mono"
                                          >
                                            {orderNumber}
                                          </Link>
                                        ) : (
                                          <span className="font-mono text-[#64748b]">{orderNumber}</span>
                                        );
                                      })()}
                                    </>
                                  ) : (
                                    note
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 미리보기 모달 */}
      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="relative w-[95vw] max-w-4xl h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 py-3 border-b border-[#e2e8f0] shrink-0">
              <span className="text-sm font-bold text-[#0f172a] flex-1 truncate">{previewFile.name}</span>
              <a
                href={previewFile.url.replace('&inline=1', '')}
                download
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[#2563eb] bg-[#eff6ff] hover:bg-[#dbeafe] no-underline transition-colors"
              >
                다운로드
              </a>
              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a] text-lg transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-[#f1f5f9] flex items-center justify-center">
              {previewFile.type === 'pdf' ? (
                <iframe
                  src={previewFile.url}
                  className="w-full h-full border-0"
                  title={previewFile.name}
                />
              ) : (
                <img
                  src={previewFile.url}
                  alt={previewFile.name}
                  className="max-w-full max-h-full object-contain p-4"
                />
              )}
            </div>
          </div>
        </div>
      )}

      <PointChargeModal
        open={pointChargeOpen}
        onClose={() => setPointChargeOpen(false)}
        customerKey={tossCustomerKeyFromLoginId(user.loginId)}
        customerName={user.name || user.loginId}
        customerEmail={user.email || ''}
      />
    </>
  );
}
