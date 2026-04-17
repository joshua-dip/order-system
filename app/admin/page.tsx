'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { membershipPricingOneLiner } from '@/lib/membership-pricing';
import Link from 'next/link';
import { ESSAY_CATEGORIES } from '../data/essay-categories';
import { DEFAULT_VARIANT_SOLBOOK_EXTRA_FEE_WON } from '@/lib/variant-solbook-settings';
import { isAnnualMemberActive } from '@/lib/annual-member';
import { isMonthlyMemberActive, isSignupPremiumTrialActive } from '@/lib/premium-member';
import { isEbsTextbook } from '@/lib/textbookSort';

interface EssayTypeItem {
  id: string;
  대분류: string;
  소분류: string;
  typeCode?: string;
  문제?: string;
  태그?: string[];
  조건?: string;
  price?: number;
  order?: number;
  enabled?: boolean;
  common?: boolean;
  exampleFile?: { originalName: string; savedPath?: string };
}

interface AdminUser {
  loginId: string;
  role: string;
}

interface ListUser {
  id: string;
  loginId: string;
  name: string;
  email: string;
  phone: string;
  dropboxFolderPath: string;
  dropboxSharedLink: string;
  canAccessAnalysis?: boolean;
  canAccessEssay?: boolean;
  myFormatApproved?: boolean;
  allowedTextbooks?: string[];
  allowedTextbooksAnalysis?: string[];
  allowedTextbooksEssay?: string[];
  /** 워크북 부교재만; 없으면 일반 allowedTextbooks 규칙 */
  allowedTextbooksWorkbook?: string[];
  /** 부교재 변형문제(/textbook) 전용; 없으면 기본 노출만 */
  allowedTextbooksVariant?: string[];
  allowedEssayTypeIds?: string[];
  points?: number;
  supplementaryNote?: string;
  annualMemberSince?: string | null;
  monthlyMemberSince?: string | null;
  monthlyMemberUntil?: string | null;
  /** 관리자 생성 시 부여되는 월·연 기능 무료 체험 만료 시각(ISO) */
  signupPremiumTrialUntil?: string | null;
  isVip?: boolean;
  vipSince?: string | null;
  createdAt: string;
}

interface AdminAnnualSharedItem {
  id: string;
  title: string;
  description: string;
  originalName: string;
  contentType: string;
  size: number;
  sortOrder: number;
  uploadedAt: string | null;
  uploadedByLoginId: string;
}

interface AdminOrder {
  id: string;
  orderText: string;
  createdAt: string;
  status: string;
  statusLabel: string;
  loginId: string | null;
  orderNumber: string | null;
  fileUrl: string | null;
  dropboxFolderCreated?: boolean;
  hasOrderMeta?: boolean;
  /** orderMeta.flow (예: unifiedVariant, textbook 등) */
  orderMetaFlow?: string | null;
  /** 상태「완료」 시 주문서에서 파싱·저장된 금액(원) */
  revenueWon?: number | null;
  /** 회원 주문 시 주문에 사용한 포인트(원). 0이면 미사용 */
  pointsUsed?: number;
  /** 포인트 사용 시 주문서 기준 총액(추정). API 전용 */
  orderGrossWon?: number | null;
  /** 포인트 사용 시 실입금액(추정). API 전용 */
  paymentDueWon?: number | null;
  /** 완료·쏠북 연계 BV: 매출(revenueWon)은 커스텀만, 합계는 orderGrossWon */
  solbookAccountingSplit?: boolean;
  completedAt?: string | null;
}

function buildOrderAnalytics(list: AdminOrder[]) {
  const byStatus: Record<string, number> = {};
  const byFlow: Record<string, number> = {};
  let completedRevenue = 0;
  let pointsUsedTotal = 0;
  for (const o of list) {
    const s = o.status || 'pending';
    byStatus[s] = (byStatus[s] || 0) + 1;
    const flow = (o.orderMetaFlow && String(o.orderMetaFlow).trim()) || '—';
    byFlow[flow] = (byFlow[flow] || 0) + 1;
    if (s === 'completed' && typeof o.revenueWon === 'number' && o.revenueWon >= 0) {
      completedRevenue += o.revenueWon;
    }
    const pu = o.pointsUsed ?? 0;
    if (pu > 0) pointsUsedTotal += pu;
  }
  const flowEntries = Object.entries(byFlow).sort((a, b) => b[1] - a[1]);
  return { byStatus, byFlow: flowEntries, completedRevenue, pointsUsedTotal, total: list.length };
}

const MESSAGE_PRESETS: { id: string; label: string; getMessage: (u: ListUser) => string }[] = [
  {
    id: 'login',
    label: '로그인 정보',
    getMessage: (u) => `[로그인 정보]
아이디: ${u.loginId || '—'}
비밀번호: 123456

분석지 제작, 서술형 주문, 워크북/모의고사 주문, 주문 내역 확인 등이 가능하며 추후 연회원들을 중심으로 서비스를 확장해 나갈 예정입니다^^
비밀번호 변경: 로그인 후 우측 상단 메뉴 → 내정보에서 변경할 수 있습니다 :)`,
  },
  {
    id: 'examUpload',
    label: '시험지 업로드 안내',
    getMessage: () => `선생님, 시험지(기출) 업로드 방법 안내드릴게요~

로그인하시고 우측 상단 메뉴에서 [내정보] 들어가주시면, [기출문제] 탭에 [기출문제 업로드] 메뉴가 있어요. 여기서 시험지 파일을 올려주시면 주문 제작할 때 반영해 드립니다 :)
궁금한 점 있으시면 편하게 연락 주세요!`,
  },
];

const STATUS_LABELS: Record<string, string> = {
  pending: '주문 접수',
  accepted: '제작 수락',
  payment_confirmed: '입금 확인',
  in_progress: '제작 중',
  completed: '완료',
  cancelled: '취소됨',
};

/** 전체 주문 목록 필터(요약 칩·상단 탭과 동일 상태) */
type AdminOrderListFilter =
  | 'all'
  | 'pending'
  | 'accepted'
  | 'payment_confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/** orderMeta.flow → 관리자 화면용 짧은 한글 */
const ORDER_FLOW_LABELS: Record<string, string> = {
  bookVariant: '부교재 변형',
  mockVariant: '모의고사 변형',
  unifiedVariant: '파이널 예비 모의',
  workbook: '워크북',
  bookBundle: '통합(번들)',
  numberBased: '번호별 교재',
  vocabulary: '단어장',
  '—': '미분류·구버전',
};

function orderFlowLabel(flow: string | null | undefined): string {
  const f = flow != null && String(flow).trim() !== '' ? String(flow).trim() : '—';
  return ORDER_FLOW_LABELS[f] ?? f;
}

const AVATAR_COLORS = [
  'from-[#00A9E0] to-[#0070b8]',
  'from-[#7c6ff7] to-[#5b52d4]',
  'from-[#22c55e] to-[#16a34a]',
  'from-[#f59e0b] to-[#d97706]',
  'from-[#ef4444] to-[#dc2626]',
];

function getDropboxFolderUrl(path: string): string {
  const pathEnc = path.trim().slice(1).split('/').filter(Boolean).map((s) => encodeURIComponent(s)).join('/');
  const workSpace = typeof process.env.NEXT_PUBLIC_DROPBOX_WORK_SPACE === 'string' && process.env.NEXT_PUBLIC_DROPBOX_WORK_SPACE.trim();
  return workSpace ? `https://www.dropbox.com/work/${encodeURIComponent(workSpace)}/앱/${pathEnc}` : `https://www.dropbox.com/work/Apps/${pathEnc}`;
}

function formatAdminFileSize(bytes: number): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 주문 목록(다크) — 원형 표시 */
const STATUS_DOT_CLASS: Record<string, string> = {
  pending: 'border border-slate-500/90 text-slate-400 bg-slate-800/90',
  accepted: 'border border-sky-500/60 text-sky-300 bg-sky-950/60',
  payment_confirmed:
    'border-2 border-emerald-400 text-emerald-200 bg-emerald-500/20 shadow-[0_0_12px_rgba(52,211,153,0.22)]',
  in_progress: 'border border-amber-500/70 text-amber-200 bg-amber-950/50',
  completed: 'border border-teal-400/80 text-teal-100 bg-teal-900/45',
  cancelled: 'border border-slate-600 text-slate-500 bg-slate-800/80',
};

/** 주문 목록(다크) — 상태 글자색 (입금 확인은 주문 접수와 확실히 구분) */
const STATUS_LABEL_TEXT_CLASS: Record<string, string> = {
  pending: 'text-slate-400',
  accepted: 'text-sky-300',
  payment_confirmed: 'text-emerald-300 font-semibold',
  in_progress: 'text-amber-200',
  completed: 'text-teal-200',
  cancelled: 'text-slate-500',
};

/** 모달·작은 뱃지용 pill (다크 배경 기준) */
const STATUS_BADGE_CLASS: Record<string, string> = {
  pending: 'bg-slate-700/90 text-slate-300 ring-1 ring-slate-500/50',
  accepted: 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40',
  payment_confirmed: 'bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/55 font-semibold',
  in_progress: 'bg-amber-500/20 text-amber-100 ring-1 ring-amber-500/45',
  completed: 'bg-teal-500/20 text-teal-50 ring-1 ring-teal-400/50',
  cancelled: 'bg-slate-700 text-slate-500 ring-1 ring-slate-600',
};

type SectionType = 'dashboard' | 'orders' | 'members' | 'exams' | 'passageUpload' | 'settings' | 'essayTypes';

type MemberSegmentFilter =
  | 'all'
  | 'annual_active'
  | 'monthly_active'
  | 'signup_trial'
  | 'vip'
  | 'dropbox_yes'
  | 'dropbox_no';

type MemberSortOrder = 'default' | 'orders_desc' | 'revenue_desc';

export default function AdminDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<SectionType>('dashboard');

  const [stats, setStats] = useState<{
    /** 완료(status=completed) 주문만 loginId별 건수 */
    orderCountByLoginId: Record<string, number>;
    /** 완료 주문만 loginId별 매출(원) */
    revenueByLoginId?: Record<string, number>;
    lastOrderDateByLoginId?: Record<string, string>;
    newMembersThisMonth: number;
    newOrdersThisWeek: number;
    dropboxConfigured?: boolean;
    revenueTotal?: number;
    revenueThisMonth?: number;
    siteVisitsTodayPageViews?: number;
    siteVisitsTodayUnique?: number;
    siteVisitsTodayKey?: string;
  } | null>(null);
  const [loginId, setLoginId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dropboxFolderPath, setDropboxFolderPath] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [users, setUsers] = useState<ListUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [editUser, setEditUser] = useState<ListUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editDropboxFolderPath, setEditDropboxFolderPath] = useState('');
  const [editDropboxSharedLink, setEditDropboxSharedLink] = useState('');
  const [editMyFormatApproved, setEditMyFormatApproved] = useState(false);
  const [editResetPassword, setEditResetPassword] = useState(false);
  const [editPointsAdd, setEditPointsAdd] = useState('');
  const [editSupplementaryNote, setEditSupplementaryNote] = useState('');
  const [editAnnualMemberSince, setEditAnnualMemberSince] = useState('');
  const [editMonthlyMemberSince, setEditMonthlyMemberSince] = useState('');
  const [editMonthlyMemberUntil, setEditMonthlyMemberUntil] = useState('');
  const [editIsVip, setEditIsVip] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editMessage, setEditMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resetPasswordLoadingId, setResetPasswordLoadingId] = useState<string | null>(null);
  const [messagePopoverUserId, setMessagePopoverUserId] = useState<string | null>(null);
  const [messageCopiedKey, setMessageCopiedKey] = useState<string | null>(null);
  const messagePopoverRef = useRef<HTMLDivElement>(null);
  const [createDropboxFolderId, setCreateDropboxFolderId] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  /** 회원 목록: 전체·등급·드롭박스 연결 여부 */
  const [memberSegmentFilter, setMemberSegmentFilter] = useState<MemberSegmentFilter>('all');
  const [memberSortOrder, setMemberSortOrder] = useState<MemberSortOrder>('default');
  const [editingPathId, setEditingPathId] = useState<string | null>(null);
  const [editingPathValue, setEditingPathValue] = useState('');
  const [pathSavingId, setPathSavingId] = useState<string | null>(null);
  const [menuSavingId, setMenuSavingId] = useState<string | null>(null);
  const [editingTextbooksUserId, setEditingTextbooksUserId] = useState<string | null>(null);
  const [editingTextbooksMode, setEditingTextbooksMode] = useState<'analysis' | 'essay' | 'workbook' | 'variant' | null>(null);
  const [textbookListForModal, setTextbookListForModal] = useState<string[]>([]);
  const [selectedTextbooksForModal, setSelectedTextbooksForModal] = useState<string[]>([]);
  const [textbooksModalLoading, setTextbooksModalLoading] = useState(false);
  const [textbooksSavingId, setTextbooksSavingId] = useState<string | null>(null);
  const [editingEssayTypesUserId, setEditingEssayTypesUserId] = useState<string | null>(null);
  const [selectedEssayTypeIdsForModal, setSelectedEssayTypeIdsForModal] = useState<string[]>([]);
  const [essayTypesSavingId, setEssayTypesSavingId] = useState<string | null>(null);
  const [ordersModalUser, setOrdersModalUser] = useState<ListUser | null>(null);
  const [userOrders, setUserOrders] = useState<AdminOrder[]>([]);
  const [userOrdersLoading, setUserOrdersLoading] = useState(false);

  interface PastExamUpload {
    id: string;
    loginId: string;
    school: string;
    grade: string;
    examYear: string;
    examType: string;
    examScope: string;
    files: { originalName: string; fileIndex: number }[];
    adminCategories?: string[];
    adminClassifiedAt?: string;
    createdAt: string;
  }
  const [examUploads, setExamUploads] = useState<PastExamUpload[]>([]);
  const [examUploadsLoading, setExamUploadsLoading] = useState(false);
  const [examPreview, setExamPreview] = useState<{ url: string; name: string; type: 'pdf' | 'image' } | null>(null);
  const [examUploadForClassify, setExamUploadForClassify] = useState<PastExamUpload | null>(null);
  const [selectedCategoriesForClassify, setSelectedCategoriesForClassify] = useState<string[]>([]);
  const [classifySavingId, setClassifySavingId] = useState<string | null>(null);
  const [examTypeFilter, setExamTypeFilter] = useState<string>('all');
  const [defaultTextbooks, setDefaultTextbooks] = useState<string[]>([]);
  const [defaultTextbooksModalOpen, setDefaultTextbooksModalOpen] = useState(false);
  const [defaultTextbooksList, setDefaultTextbooksList] = useState<string[]>([]);
  const [defaultTextbooksSelected, setDefaultTextbooksSelected] = useState<string[]>([]);
  const [defaultTextbooksSaving, setDefaultTextbooksSaving] = useState(false);

  /** 변형문제 쏠북 교재(부교재 주문 /textbook) */
  const [variantSolbookKeys, setVariantSolbookKeys] = useState<string[]>([]);
  const [variantSolbookPurchaseUrl, setVariantSolbookPurchaseUrl] = useState('');
  const [variantSolbookExtraFeeWon, setVariantSolbookExtraFeeWon] = useState(DEFAULT_VARIANT_SOLBOOK_EXTRA_FEE_WON);
  const [variantSolbookRetailGuideText, setVariantSolbookRetailGuideText] = useState('');
  const [variantSolbookSaving, setVariantSolbookSaving] = useState(false);

  const [annualSharedItems, setAnnualSharedItems] = useState<AdminAnnualSharedItem[]>([]);
  const [annualSharedLoading, setAnnualSharedLoading] = useState(false);
  const [annualSharedUploading, setAnnualSharedUploading] = useState(false);
  const [annualSharedTitle, setAnnualSharedTitle] = useState('');
  const [annualSharedDescription, setAnnualSharedDescription] = useState('');
  const [annualSharedFile, setAnnualSharedFile] = useState<File | null>(null);
  const [annualSharedDeletingId, setAnnualSharedDeletingId] = useState<string | null>(null);
  const [annualSharedMessage, setAnnualSharedMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [examUploadForAddFiles, setExamUploadForAddFiles] = useState<PastExamUpload | null>(null);
  const [addFilesList, setAddFilesList] = useState<FileList | null>(null);
  const [addFilesSavingId, setAddFilesSavingId] = useState<string | null>(null);
  const [adminCreateExamOpen, setAdminCreateExamOpen] = useState(false);
  const [adminCreateExamForm, setAdminCreateExamForm] = useState({ loginId: '', school: '', grade: '', examYear: '', examType: '', examScope: '' });
  const [adminCreateExamFiles, setAdminCreateExamFiles] = useState<FileList | null>(null);
  const [adminCreateExamSaving, setAdminCreateExamSaving] = useState(false);
  const [passageUploadFile, setPassageUploadFile] = useState<File | null>(null);
  const [passageUploadSaving, setPassageUploadSaving] = useState(false);
  const [passageUploadMessage, setPassageUploadMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [passageUploadDbTextbooks, setPassageUploadDbTextbooks] = useState<string[]>([]);
  const [passageUploadDbTextbook, setPassageUploadDbTextbook] = useState('');
  const [passageUploadFromDbSaving, setPassageUploadFromDbSaving] = useState(false);

  const [essayTypes, setEssayTypes] = useState<EssayTypeItem[]>([]);
  const [essayTypesLoading, setEssayTypesLoading] = useState(false);
  const [essayTypeModal, setEssayTypeModal] = useState<{ mode: 'add' } | { mode: 'edit'; item: EssayTypeItem } | null>(null);
  const [essayTypeForm, setEssayTypeForm] = useState({ 대분류: '', 소분류: '', typeCode: '', 문제: '', 태그: '', 조건: '' });
  const [essayTypeSaving, setEssayTypeSaving] = useState(false);
  const [essayTypeDeletingId, setEssayTypeDeletingId] = useState<string | null>(null);
  const [essayCategoryDeleting, setEssayCategoryDeleting] = useState<string | null>(null);
  const [essayCategoryEditModal, setEssayCategoryEditModal] = useState<string | null>(null);
  const [categoryNameDraft, setCategoryNameDraft] = useState('');
  const [categoryNameSaving, setCategoryNameSaving] = useState(false);
  const [essayExampleUploadingId, setEssayExampleUploadingId] = useState<string | null>(null);
  const [essayExampleDeletingId, setEssayExampleDeletingId] = useState<string | null>(null);
  const [modalExampleFile, setModalExampleFile] = useState<{ originalName: string } | null | undefined>(undefined);
  const [essayTypeTogglingId, setEssayTypeTogglingId] = useState<string | null>(null);
  const [categoryPriceDraft, setCategoryPriceDraft] = useState<Record<string, string>>({});
  const [categoryPriceSaving, setCategoryPriceSaving] = useState<string | null>(null);

  const [recentOrders, setRecentOrders] = useState<AdminOrder[]>([]);
  const [recentOrdersLoading, setRecentOrdersLoading] = useState(false);
  const [orderFilter, setOrderFilter] = useState<AdminOrderListFilter>('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderDetailModal, setOrderDetailModal] = useState<AdminOrder | null>(null);
  /** 주문 관리 모달: 표에서 드롭박스 열 vs 상태 열 진입 구분 */
  const [orderDetailTab, setOrderDetailTab] = useState<'dropbox' | 'status'>('status');
  /** 주문 요약 셀 클릭: 본문 있으면 전문 팝업, 없으면 주문 관리 */
  const [orderTextPreviewModal, setOrderTextPreviewModal] = useState<AdminOrder | null>(null);
  const [orderTextPreviewCopied, setOrderTextPreviewCopied] = useState(false);
  const [fileUrlInput, setFileUrlInput] = useState('');
  const [statusInput, setStatusInput] = useState('');
  const [fileUrlSavingId, setFileUrlSavingId] = useState<string | null>(null);
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);
  const [assignLoginId, setAssignLoginId] = useState('');
  const [assignSavingId, setAssignSavingId] = useState<string | null>(null);
  const [deleteSavingId, setDeleteSavingId] = useState<string | null>(null);
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null);
  /** 최근 주문 표: 현재 표시 목록에서 다중 선택 후 일괄 삭제 */
  const [orderBulkSelectedIds, setOrderBulkSelectedIds] = useState<Set<string>>(() => new Set());
  /** 쏠북 BV 금액: 박스 클릭으로 합계·비고 펼침/접기 */
  const [solbookAmountExpandedIds, setSolbookAmountExpandedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeletingOrders, setBulkDeletingOrders] = useState(false);

  const toggleSolbookAmountExpanded = (orderId: string) => {
    setSolbookAmountExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };
  const orderSelectAllRef = useRef<HTMLInputElement>(null);
  /** 사이드바에서 지문 업로드 등으로 올 때 메인 패널 스크롤을 맨 위로 */
  const mainContentScrollRef = useRef<HTMLElement | null>(null);
  const [createOrderFolderId, setCreateOrderFolderId] = useState<string | null>(null);
  const [copiedLinkOrderId, setCopiedLinkOrderId] = useState<string | null>(null);
  const [copiedOrderNumberId, setCopiedOrderNumberId] = useState<string | null>(null);

  const [dataError, setDataError] = useState<string | null>(null);

  const [monthlyRevenueOpen, setMonthlyRevenueOpen] = useState(false);
  const [monthlyRevenueLoading, setMonthlyRevenueLoading] = useState(false);
  const [monthlyRevenueRows, setMonthlyRevenueRows] = useState<
    Array<{ key: string; label: string; totalWon: number; orderCount: number }>
  >([]);
  const [monthlyRevenueNote, setMonthlyRevenueNote] = useState<string | null>(null);
  const [monthlyRevenueError, setMonthlyRevenueError] = useState<string | null>(null);

  const [siteVisitsHistoryOpen, setSiteVisitsHistoryOpen] = useState(false);
  const [siteVisitsHistoryLoading, setSiteVisitsHistoryLoading] = useState(false);
  const [siteVisitsHistoryRows, setSiteVisitsHistoryRows] = useState<
    Array<{ date: string; pageViews: number; uniqueVisitors: number }>
  >([]);
  const [siteVisitsHistoryNote, setSiteVisitsHistoryNote] = useState<string | null>(null);
  const [siteVisitsHistoryError, setSiteVisitsHistoryError] = useState<string | null>(null);

  const fetchUsers = useCallback(() => {
    setUsersLoading(true);
    setDataError(null);
    fetch('/api/admin/users', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) return res.json().then((d) => { setDataError(d?.error || '회원 목록을 불러올 수 없습니다.'); return null; });
        return res.json();
      })
      .then((data) => { if (data?.users) setUsers(data.users); })
      .catch(() => { setUsers([]); setDataError('네트워크 오류'); })
      .finally(() => setUsersLoading(false));
  }, []);

  const fetchOrders = useCallback(() => {
    setRecentOrdersLoading(true);
    fetch('/api/admin/orders?limit=100', { credentials: 'include' })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => { setDataError(d?.error || '주문 목록을 불러올 수 없습니다.'); return null; });
        return r.json();
      })
      .then((d) => { if (d?.orders) setRecentOrders(d.orders); })
      .finally(() => setRecentOrdersLoading(false));
  }, []);

  const fetchExamUploads = useCallback(() => {
    setExamUploadsLoading(true);
    fetch('/api/admin/past-exam-uploads', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setExamUploads(d.uploads || []))
      .catch(() => setExamUploads([]))
      .finally(() => setExamUploadsLoading(false));
  }, []);

  const fetchStats = useCallback(() => {
    fetch('/api/admin/stats', { credentials: 'include' })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => { setDataError(d?.error || '통계를 불러올 수 없습니다.'); return null; });
        return r.json();
      })
      .then((d) => {
        if (d && d.orderCountByLoginId != null)
          setStats({
            orderCountByLoginId: d.orderCountByLoginId || {},
            revenueByLoginId:
              d.revenueByLoginId != null && typeof d.revenueByLoginId === 'object' && !Array.isArray(d.revenueByLoginId)
                ? (d.revenueByLoginId as Record<string, number>)
                : {},
            lastOrderDateByLoginId: d.lastOrderDateByLoginId || {},
            newMembersThisMonth: d.newMembersThisMonth ?? 0,
            newOrdersThisWeek: d.newOrdersThisWeek ?? 0,
            dropboxConfigured: !!d.dropboxConfigured,
            revenueTotal: typeof d.revenueTotal === 'number' ? d.revenueTotal : 0,
            revenueThisMonth: typeof d.revenueThisMonth === 'number' ? d.revenueThisMonth : 0,
            siteVisitsTodayPageViews: typeof d.siteVisitsTodayPageViews === 'number' ? d.siteVisitsTodayPageViews : 0,
            siteVisitsTodayUnique: typeof d.siteVisitsTodayUnique === 'number' ? d.siteVisitsTodayUnique : 0,
            siteVisitsTodayKey: typeof d.siteVisitsTodayKey === 'string' ? d.siteVisitsTodayKey : undefined,
          });
      })
      .catch(() => setStats(null));
  }, []);

  const openSiteVisitsHistoryModal = useCallback(() => {
    setSiteVisitsHistoryOpen(true);
    setSiteVisitsHistoryError(null);
    setSiteVisitsHistoryLoading(true);
    setSiteVisitsHistoryRows([]);
    setSiteVisitsHistoryNote(null);
    fetch('/api/admin/stats/site-visits-history?days=120', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d?.days)) {
          setSiteVisitsHistoryError(typeof d?.error === 'string' ? d.error : '불러오기에 실패했습니다.');
          return;
        }
        setSiteVisitsHistoryRows(d.days);
        setSiteVisitsHistoryNote(typeof d.note === 'string' ? d.note : null);
      })
      .catch(() => setSiteVisitsHistoryError('네트워크 오류'))
      .finally(() => setSiteVisitsHistoryLoading(false));
  }, []);

  const openMonthlyRevenueModal = useCallback(() => {
    setMonthlyRevenueOpen(true);
    setMonthlyRevenueError(null);
    setMonthlyRevenueLoading(true);
    setMonthlyRevenueRows([]);
    setMonthlyRevenueNote(null);
    fetch('/api/admin/stats/revenue-by-month?months=48', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d?.months)) {
          setMonthlyRevenueError(typeof d?.error === 'string' ? d.error : '불러오기에 실패했습니다.');
          return;
        }
        setMonthlyRevenueRows(d.months);
        setMonthlyRevenueNote(typeof d.note === 'string' ? d.note : null);
      })
      .catch(() => setMonthlyRevenueError('네트워크 오류'))
      .finally(() => setMonthlyRevenueLoading(false));
  }, []);

  const fetchEssayTypes = useCallback(() => {
    setEssayTypesLoading(true);
    fetch('/api/admin/essay-types', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setEssayTypes(Array.isArray(d?.types) ? d.types : []))
      .catch(() => setEssayTypes([]))
      .finally(() => setEssayTypesLoading(false));
  }, []);

  const fetchAnnualSharedFiles = useCallback(() => {
    setAnnualSharedLoading(true);
    fetch('/api/admin/annual-shared-files', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setAnnualSharedItems(Array.isArray(d?.items) ? d.items : []))
      .catch(() => setAnnualSharedItems([]))
      .finally(() => setAnnualSharedLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        setUser(data.user);
        if (!data.user) {
          router.replace('/admin/login');
          return;
        }
        if (data.user.role !== 'admin') {
          router.replace('/admin/login');
          return;
        }
        fetchUsers();
        fetchOrders();
        fetchStats();
        fetchExamUploads();
        fetch('/api/admin/settings/default-textbooks', { credentials: 'include' })
          .then((r) => r.json())
          .then((d) => setDefaultTextbooks(Array.isArray(d?.textbookKeys) ? d.textbookKeys : []))
          .catch(() => setDefaultTextbooks([]));
        fetch('/api/admin/settings/variant-solbook', { credentials: 'include', cache: 'no-store' })
          .then((r) => r.json())
          .then((d) => {
            setVariantSolbookKeys(Array.isArray(d?.textbookKeys) ? d.textbookKeys : []);
            setVariantSolbookPurchaseUrl(typeof d?.purchaseUrl === 'string' ? d.purchaseUrl : '');
            const fee =
              typeof d?.extraFeeWon === 'number' && Number.isFinite(d.extraFeeWon) && d.extraFeeWon >= 0
                ? Math.round(d.extraFeeWon)
                : DEFAULT_VARIANT_SOLBOOK_EXTRA_FEE_WON;
            setVariantSolbookExtraFeeWon(fee);
            setVariantSolbookRetailGuideText(
              typeof d?.retailPriceGuideText === 'string' ? d.retailPriceGuideText : ''
            );
          })
          .catch(() => {});
      })
      .catch(() => router.replace('/admin/login'))
      .finally(() => setLoading(false));
  }, [router, fetchUsers, fetchOrders, fetchStats, fetchExamUploads]);

  useEffect(() => {
    if (section === 'essayTypes' || section === 'exams') fetchEssayTypes();
  }, [section, fetchEssayTypes]);

  useEffect(() => {
    if (section !== 'settings') return;
    fetchAnnualSharedFiles();
  }, [section, fetchAnnualSharedFiles]);

  useEffect(() => {
    const toolSections: SectionType[] = ['passageUpload', 'exams', 'settings', 'essayTypes', 'members'];
    if (!toolSections.includes(section)) return;
    mainContentScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [section]);

  useEffect(() => {
    if (section !== 'passageUpload') return;
    fetch('/api/admin/passages/textbooks', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d.textbooks) ? d.textbooks : [];
        setPassageUploadDbTextbooks([...list].sort((a: string, b: string) => a.localeCompare(b, 'ko')));
      })
      .catch(() => setPassageUploadDbTextbooks([]));
  }, [section]);

  const essayCategoriesForSelect = essayTypes.length > 0
    ? essayTypes.flatMap((t) => ({ value: `${t.대분류} > ${t.소분류}`, 대분류: t.대분류, 소분류: t.소분류 }))
    : ESSAY_CATEGORIES.flatMap((cat) => cat.소분류.map((sub) => ({ value: `${cat.대분류} > ${sub}`, 대분류: cat.대분류, 소분류: sub })));
  const essayCategoriesGrouped = essayTypes.length > 0
    ? Object.entries(essayTypes.reduce<Record<string, string[]>>((acc, t) => {
        const key = t.대분류 || '(미분류)';
        if (!acc[key]) acc[key] = [];
        acc[key].push(t.소분류);
        return acc;
      }, {}))
    : ESSAY_CATEGORIES.map((c) => [c.대분류, c.소분류] as [string, string[]]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/admin/login');
    router.refresh();
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSubmitLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId: loginId.trim(), name: name.trim(), email: email.trim(), phone: phone.trim(), dropboxFolderPath: dropboxFolderPath.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({
          type: 'success',
          text: `계정이 생성되었습니다. (아이디: ${data.loginId}, 초기 비밀번호: 123456) 월·연 회원 기능은 7일간 무료로 이용할 수 있습니다.`,
        });
        setLoginId('');
        setName('');
        setEmail('');
        setPhone('');
        setDropboxFolderPath('');
        fetchUsers();
        fetchStats();
      } else {
        setMessage({ type: 'error', text: data?.error || '계정 생성에 실패했습니다.' });
      }
    } catch {
      setMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setSubmitLoading(false);
    }
  };

  const openEdit = (u: ListUser) => {
    setEditUser(u);
    setEditName(u.name);
    setEditEmail(u.email);
    setEditPhone((u.phone ?? '').replace(/\D/g, ''));
    setEditDropboxFolderPath(u.dropboxFolderPath ?? '');
    setEditDropboxSharedLink(u.dropboxSharedLink ?? '');
    setEditMyFormatApproved(!!u.myFormatApproved);
    setEditResetPassword(false);
    setEditPointsAdd('');
    setEditSupplementaryNote(u.supplementaryNote ?? '');
    setEditAnnualMemberSince(u.annualMemberSince ?? '');
    setEditMonthlyMemberSince(u.monthlyMemberSince ?? '');
    setEditMonthlyMemberUntil(u.monthlyMemberUntil ?? '');
    setEditIsVip(!!u.isVip);
    setEditMessage(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setEditMessage(null);
    setEditSaving(true);
    try {
      const body: {
        name?: string;
        email?: string;
        phone?: string;
        dropboxFolderPath?: string;
        dropboxSharedLink?: string;
        myFormatApproved?: boolean;
        resetPassword?: boolean;
        addPoints?: number;
        supplementaryNote?: string;
        annualMemberSince?: string | null;
        monthlyMemberSince?: string | null;
        monthlyMemberUntil?: string | null;
      } = {};
      if (editName !== editUser.name) body.name = editName;
      if (editEmail !== editUser.email) body.email = editEmail;
      const storedPhoneDigits = (editUser.phone ?? '').replace(/\D/g, '');
      if (editPhone !== storedPhoneDigits) body.phone = editPhone;
      if (editDropboxFolderPath !== (editUser.dropboxFolderPath ?? '')) body.dropboxFolderPath = editDropboxFolderPath;
      if (editDropboxSharedLink !== (editUser.dropboxSharedLink ?? '')) body.dropboxSharedLink = editDropboxSharedLink;
      if (editMyFormatApproved !== !!editUser.myFormatApproved) body.myFormatApproved = editMyFormatApproved;
      if (editSupplementaryNote !== (editUser.supplementaryNote ?? '')) body.supplementaryNote = editSupplementaryNote;
      if (editAnnualMemberSince !== (editUser.annualMemberSince ?? '')) body.annualMemberSince = editAnnualMemberSince.trim() || null;
      if (editMonthlyMemberSince !== (editUser.monthlyMemberSince ?? '')) {
        body.monthlyMemberSince = editMonthlyMemberSince.trim() || null;
      }
      if (editMonthlyMemberUntil !== (editUser.monthlyMemberUntil ?? '')) {
        body.monthlyMemberUntil = editMonthlyMemberUntil.trim() || null;
      }
      if (editIsVip !== !!editUser.isVip) (body as Record<string, unknown>).isVip = editIsVip;
      if (editResetPassword) body.resetPassword = true;
      const addPointsNum = editPointsAdd.trim() !== '' ? parseInt(editPointsAdd.trim(), 10) : NaN;
      if (!Number.isNaN(addPointsNum) && addPointsNum > 0) body.addPoints = addPointsNum;
      if (Object.keys(body).length === 0) {
        setEditMessage({ type: 'error', text: '변경할 내용이 없습니다.' });
        setEditSaving(false);
        return;
      }
      const res = await fetch(`/api/admin/users/${editUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setEditUser(null);
        fetchUsers();
      } else {
        setEditMessage({ type: 'error', text: data?.error || '수정에 실패했습니다.' });
      }
    } catch {
      setEditMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 계정을 삭제하시겠습니까? 삭제된 계정은 복구할 수 없습니다.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== id));
        if (editUser?.id === id) setEditUser(null);
        fetchStats();
      } else {
        alert(data?.error || '삭제에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return d;
    }
  };

  const formatDateTime = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return d;
    }
  };

  /** 주문 표: 1행 연월일 · 2행 시각 */
  const formatOrderDateTwoLines = (d: string) => {
    try {
      const dt = new Date(d);
      const dateLine = dt.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
      const timeLine = dt.toLocaleTimeString('ko-KR', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      return { dateLine, timeLine };
    } catch {
      return { dateLine: d, timeLine: '' };
    }
  };

  const daysAgo = (d: string) => {
    const diff = Math.floor((Date.now() - new Date(d).getTime()) / (24 * 60 * 60 * 1000));
    if (diff === 0) return '오늘';
    if (diff === 1) return '1일 전';
    return `${diff}일 전`;
  };

  const formatAnnualMemberValidity = (since: string | null | undefined) => {
    if (!since || since.trim() === '') return null;
    const start = new Date(since);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
    const fmt = (d: Date) => d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace(/\.$/,'');
    return { label: `연회원 ~${fmt(end)}`, title: `유효기간: ${fmt(start)} ~ ${fmt(end)}` };
  };

  const listUserAnnualActive = (u: ListUser) => isAnnualMemberActive(u.annualMemberSince ?? null);
  const listUserMonthlyActive = (u: ListUser) => isMonthlyMemberActive(u.monthlyMemberUntil ?? null);
  const listUserSignupPremiumTrialActive = (u: ListUser) =>
    isSignupPremiumTrialActive(u.signupPremiumTrialUntil ?? null);

  const formatMonthlyMemberValidity = (until: string | null | undefined) => {
    if (!until || until.trim() === '') return null;
    const end = new Date(until);
    if (Number.isNaN(end.getTime())) return null;
    const fmt = (d: Date) => d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace(/\.$/, '');
    return { label: `월구독 ~${fmt(end)}`, title: `만료: ${fmt(end)}` };
  };

  const handleResetPassword = async (userId: string) => {
    if (!confirm('이 사용자의 비밀번호를 123456으로 초기화하시겠습니까?')) return;
    setResetPasswordLoadingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetPassword: true }),
      });
      const data = await res.json();
      if (res.ok && data.ok) alert('비밀번호가 123456으로 초기화되었습니다.');
      else alert(data?.error || '초기화에 실패했습니다.');
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setResetPasswordLoadingId(null);
    }
  };

  const handleCopyMessage = (u: ListUser, messageId: string) => {
    const preset = MESSAGE_PRESETS.find((p) => p.id === messageId);
    if (!preset) return;
    const text = preset.getMessage(u);
    navigator.clipboard.writeText(text).then(() => {
      setMessageCopiedKey(`${u.id}-${messageId}`);
      setTimeout(() => setMessageCopiedKey(null), 2000);
    }).catch(() => alert('클립보드 복사에 실패했습니다.'));
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (messagePopoverRef.current && !messagePopoverRef.current.contains(e.target as Node)) {
        setMessagePopoverUserId(null);
      }
    };
    if (messagePopoverUserId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [messagePopoverUserId]);

  const handleCreateDropboxFolder = async (u: ListUser) => {
    setCreateDropboxFolderId(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/create-dropbox-folder`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok && data.dropboxFolderPath) {
        setUsers((prev) => prev.map((user) => (user.id === u.id ? { ...user, dropboxFolderPath: data.dropboxFolderPath } : user)));
        if (editUser?.id === u.id) setEditUser((prev) => (prev ? { ...prev, dropboxFolderPath: data.dropboxFolderPath } : null));
        alert(`폴더를 만들었습니다: ${data.dropboxFolderPath}`);
      } else {
        alert(data?.error || '폴더 생성에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setCreateDropboxFolderId(null);
    }
  };

  const handlePathSave = async (userId: string, path: string) => {
    setPathSavingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropboxFolderPath: path.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, dropboxFolderPath: path.trim() } : u)));
        if (editUser?.id === userId) setEditUser((prev) => (prev ? { ...prev, dropboxFolderPath: path.trim() } : null));
        setEditingPathId(null);
      } else {
        alert(data?.error || '저장에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setPathSavingId(null);
    }
  };

  const handleResetPath = async (userId: string) => {
    if (!confirm('드롭박스 폴더 경로를 초기화할까요?')) return;
    setPathSavingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropboxFolderPath: '' }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, dropboxFolderPath: '' } : u)));
        if (editUser?.id === userId) setEditUser((prev) => (prev ? { ...prev, dropboxFolderPath: '' } : null));
        setEditingPathId(null);
      } else {
        alert(data?.error || '초기화에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setPathSavingId(null);
    }
  };

  const handleToggleMenuAccess = async (userId: string, field: 'canAccessAnalysis' | 'canAccessEssay', value: boolean) => {
    setMenuSavingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, [field]: value } : u)));
        if (editUser?.id === userId) setEditUser((prev) => (prev ? { ...prev, [field]: value } : null));
      } else {
        alert(data?.error || '저장에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setMenuSavingId(null);
    }
  };

  const openDefaultTextbooksModal = () => {
    setDefaultTextbooksModalOpen(true);
    setDefaultTextbooksSelected([...defaultTextbooks]);
    setDefaultTextbooksList([]);
    fetch('/api/textbooks')
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === 'object' && !data.error) {
          setDefaultTextbooksList(Object.keys(data));
        }
      })
      .catch(() => {});
  };

  const saveDefaultTextbooks = async () => {
    setDefaultTextbooksSaving(true);
    try {
      const res = await fetch('/api/admin/settings/default-textbooks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textbookKeys: defaultTextbooksSelected }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setDefaultTextbooks([...defaultTextbooksSelected]);
        setDefaultTextbooksModalOpen(false);
      } else {
        alert(data?.error || '저장에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setDefaultTextbooksSaving(false);
    }
  };

  const saveVariantSolbookSettings = async () => {
    setVariantSolbookSaving(true);
    try {
      const res = await fetch('/api/admin/settings/variant-solbook', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseUrl: variantSolbookPurchaseUrl.trim(),
          extraFeeWon: variantSolbookExtraFeeWon,
          retailPriceGuideText: variantSolbookRetailGuideText.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setVariantSolbookKeys(Array.isArray(data.textbookKeys) ? data.textbookKeys : variantSolbookKeys);
        setVariantSolbookPurchaseUrl(typeof data.purchaseUrl === 'string' ? data.purchaseUrl : variantSolbookPurchaseUrl);
        if (typeof data.extraFeeWon === 'number' && Number.isFinite(data.extraFeeWon)) {
          setVariantSolbookExtraFeeWon(Math.round(data.extraFeeWon));
        }
        if (typeof data.retailPriceGuideText === 'string') {
          setVariantSolbookRetailGuideText(data.retailPriceGuideText);
        }
        alert('변형문제 쏠북 설정을 저장했습니다.');
      } else {
        alert((data?.error as string) || '저장에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setVariantSolbookSaving(false);
    }
  };

  const handleAnnualSharedUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setAnnualSharedMessage(null);
    const title = annualSharedTitle.trim();
    if (!title) {
      setAnnualSharedMessage({ type: 'error', text: '자료 제목을 입력해 주세요.' });
      return;
    }
    if (!annualSharedFile) {
      setAnnualSharedMessage({ type: 'error', text: 'hwp·hwpx·pdf 파일을 선택해 주세요.' });
      return;
    }
    setAnnualSharedUploading(true);
    try {
      const fd = new FormData();
      fd.append('title', title);
      fd.append('description', annualSharedDescription.trim());
      fd.append('file', annualSharedFile);
      const res = await fetch('/api/admin/annual-shared-files', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setAnnualSharedTitle('');
        setAnnualSharedDescription('');
        setAnnualSharedFile(null);
        setAnnualSharedMessage({ type: 'success', text: '업로드되었습니다.' });
        fetchAnnualSharedFiles();
      } else {
        setAnnualSharedMessage({ type: 'error', text: data?.error || '업로드에 실패했습니다.' });
      }
    } catch {
      setAnnualSharedMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setAnnualSharedUploading(false);
    }
  };

  const handleAnnualSharedDelete = async (id: string) => {
    if (!confirm('이 자료를 삭제할까요? 연회원 화면에서도 사라집니다.')) return;
    setAnnualSharedDeletingId(id);
    setAnnualSharedMessage(null);
    try {
      const res = await fetch(`/api/admin/annual-shared-files/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setAnnualSharedMessage({ type: 'success', text: '삭제되었습니다.' });
        fetchAnnualSharedFiles();
      } else {
        setAnnualSharedMessage({ type: 'error', text: data?.error || '삭제에 실패했습니다.' });
      }
    } catch {
      setAnnualSharedMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setAnnualSharedDeletingId(null);
    }
  };

  const openTextbooksModal = (u: ListUser, mode: 'analysis' | 'essay' | 'workbook' | 'variant') => {
    setEditingTextbooksUserId(u.id);
    setEditingTextbooksMode(mode);
    const legacy = Array.isArray(u.allowedTextbooks) ? u.allowedTextbooks : [];
    if (mode === 'analysis' || mode === 'essay') {
      const list =
        mode === 'analysis'
          ? Array.isArray(u.allowedTextbooksAnalysis)
            ? u.allowedTextbooksAnalysis
            : legacy
          : Array.isArray(u.allowedTextbooksEssay)
            ? u.allowedTextbooksEssay
            : legacy;
      setSelectedTextbooksForModal([...list]);
    } else {
      setSelectedTextbooksForModal([]);
    }
    setTextbooksModalLoading(true);
    fetch('/api/textbooks')
      .then((r) => r.json())
      .then(async (data) => {
        if (data && typeof data === 'object' && !data.error) {
          let keys = Object.keys(data);
          if (mode === 'workbook' || mode === 'variant') {
            keys = keys.filter((k) => !/^고[123]_/.test(k));
            /** EBS·쏠북 교재는 전 회원 공개이므로 회원별 체크 목록에서 제외 */
            const solbookSet = new Set<string>();
            try {
              const sr = await fetch('/api/settings/variant-solbook', { cache: 'no-store' });
              const sj = (await sr.json()) as { textbookKeys?: unknown };
              if (Array.isArray(sj.textbookKeys)) {
                for (const k of sj.textbookKeys) {
                  if (typeof k === 'string' && k.trim()) solbookSet.add(k.trim());
                }
              }
            } catch {
              /* 목록만 제한; 실패 시 쏠북 집합 없이 EBS만 제외 */
            }
            keys = keys
              .filter((k) => !isEbsTextbook(k) && !solbookSet.has(k))
              .sort((a, b) => a.localeCompare(b, 'ko'));
            if (mode === 'workbook') {
              setTextbookListForModal(keys);
              if (Array.isArray(u.allowedTextbooksWorkbook)) {
                setSelectedTextbooksForModal(
                  u.allowedTextbooksWorkbook.filter((t) => keys.includes(t))
                );
              } else if (legacy.length > 0) {
                setSelectedTextbooksForModal(keys.filter((k) => legacy.includes(k)));
              } else {
                setSelectedTextbooksForModal([...keys]);
              }
            } else if (Array.isArray(u.allowedTextbooksVariant)) {
              const saved = u.allowedTextbooksVariant.filter((t): t is string => typeof t === 'string');
              const orphans = saved.filter(
                (t) =>
                  !keys.includes(t) &&
                  !/^고[123]_/.test(t) &&
                  !isEbsTextbook(t) &&
                  !solbookSet.has(t)
              );
              const list = [...keys, ...orphans].sort((a, b) => a.localeCompare(b, 'ko'));
              setTextbookListForModal(list);
              setSelectedTextbooksForModal(saved.filter((t) => list.includes(t)));
            } else if (legacy.length > 0) {
              setTextbookListForModal(keys);
              setSelectedTextbooksForModal(keys.filter((k) => legacy.includes(k)));
            } else {
              setTextbookListForModal(keys);
              setSelectedTextbooksForModal([...keys]);
            }
          } else {
            setTextbookListForModal(keys);
          }
        } else {
          setTextbookListForModal([]);
        }
      })
      .catch(() => setTextbookListForModal([]))
      .finally(() => setTextbooksModalLoading(false));
  };

  const clearWorkbookTextbooks = async (u: ListUser) => {
    if (
      !confirm(
        '워크북 부교재 전용 목록을 해제할까요? 이후에는 일반「교재 허용」목록(allowedTextbooks)과 동일한 규칙이 적용됩니다.'
      )
    )
      return;
    setTextbooksSavingId(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedTextbooksWorkbook: null }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setUsers((prev) =>
          prev.map((x) => {
            if (x.id !== u.id) return x;
            const { allowedTextbooksWorkbook: _w, ...rest } = x;
            return rest;
          })
        );
        if (editUser?.id === u.id) {
          setEditUser((prev) => {
            if (!prev) return null;
            const { allowedTextbooksWorkbook: _w, ...rest } = prev;
            return rest;
          });
        }
      } else {
        alert(data?.error || '해제에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setTextbooksSavingId(null);
    }
  };

  const clearVariantTextbooks = async (u: ListUser) => {
    if (
      !confirm(
        '변형문제 부교재 전용 목록을 해제할까요? 이후에는 사이트 기본 노출(관리자 기본 교재 설정)만 적용됩니다.'
      )
    )
      return;
    setTextbooksSavingId(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedTextbooksVariant: null }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setUsers((prev) =>
          prev.map((x) => {
            if (x.id !== u.id) return x;
            const { allowedTextbooksVariant: _v, ...rest } = x;
            return rest;
          })
        );
        if (editUser?.id === u.id) {
          setEditUser((prev) => {
            if (!prev) return null;
            const { allowedTextbooksVariant: _v, ...rest } = prev;
            return rest;
          });
        }
      } else {
        alert(data?.error || '해제에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setTextbooksSavingId(null);
    }
  };

  const openEssayTypesModal = (u: ListUser) => {
    setEditingEssayTypesUserId(u.id);
    setSelectedEssayTypeIdsForModal(Array.isArray(u.allowedEssayTypeIds) ? [...u.allowedEssayTypeIds] : []);
    if (essayTypes.length === 0) fetchEssayTypes();
  };

  const saveAllowedEssayTypes = async () => {
    if (!editingEssayTypesUserId) return;
    setEssayTypesSavingId(editingEssayTypesUserId);
    try {
      const res = await fetch(`/api/admin/users/${editingEssayTypesUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedEssayTypeIds: selectedEssayTypeIdsForModal }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const next = [...selectedEssayTypeIdsForModal];
        setUsers((prev) => prev.map((u) => (u.id === editingEssayTypesUserId ? { ...u, allowedEssayTypeIds: next } : u)));
        if (editUser?.id === editingEssayTypesUserId) setEditUser((prev) => (prev ? { ...prev, allowedEssayTypeIds: next } : null));
        setEditingEssayTypesUserId(null);
      } else {
        alert(data?.error || '저장에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setEssayTypesSavingId(null);
    }
  };

  const saveAllowedTextbooks = async () => {
    if (!editingTextbooksUserId || !editingTextbooksMode) return;
    setTextbooksSavingId(editingTextbooksUserId);
    try {
      const body =
        editingTextbooksMode === 'analysis'
          ? { allowedTextbooksAnalysis: selectedTextbooksForModal }
          : editingTextbooksMode === 'essay'
            ? { allowedTextbooksEssay: selectedTextbooksForModal }
            : editingTextbooksMode === 'workbook'
              ? { allowedTextbooksWorkbook: selectedTextbooksForModal }
              : { allowedTextbooksVariant: selectedTextbooksForModal };
      const res = await fetch(`/api/admin/users/${editingTextbooksUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const key =
          editingTextbooksMode === 'analysis'
            ? 'allowedTextbooksAnalysis'
            : editingTextbooksMode === 'essay'
              ? 'allowedTextbooksEssay'
              : editingTextbooksMode === 'workbook'
                ? 'allowedTextbooksWorkbook'
                : 'allowedTextbooksVariant';
        const next = [...selectedTextbooksForModal];
        setUsers((prev) => prev.map((u) => (u.id === editingTextbooksUserId ? { ...u, [key]: next } : u)));
        if (editUser?.id === editingTextbooksUserId)
          setEditUser((prev) => (prev ? { ...prev, [key]: next } : null));
        setEditingTextbooksUserId(null);
        setEditingTextbooksMode(null);
      } else {
        alert(data?.error || '저장에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setTextbooksSavingId(null);
    }
  };

  const openEssayTypeAdd = (대분류Preset?: string) => {
    setEssayTypeForm({
      대분류: 대분류Preset ?? '',
      소분류: '',
      typeCode: '',
      문제: '',
      태그: '',
      조건: '',
    });
    setEssayTypeModal({ mode: 'add' });
  };
  const openEssayTypeEdit = (item: EssayTypeItem) => {
    setEssayTypeForm({
      대분류: item.대분류,
      소분류: item.소분류,
      typeCode: item.typeCode ?? '',
      문제: item.문제 ?? '',
      태그: Array.isArray(item.태그) ? item.태그.join('\n') : '',
      조건: item.조건 ?? '',
    });
    setModalExampleFile(undefined);
    setEssayTypeModal({ mode: 'edit', item });
  };
  const saveEssayType = async () => {
    const { 대분류, 소분류, typeCode, 문제, 태그, 조건 } = essayTypeForm;
    if (!대분류.trim() || !소분류.trim()) {
      alert('대분류와 소분류를 입력해 주세요.');
      return;
    }
    setEssayTypeSaving(true);
    try {
      if (essayTypeModal?.mode === 'add') {
        const res = await fetch('/api/admin/essay-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            대분류: 대분류.trim(),
            소분류: 소분류.trim(),
            typeCode: typeCode.trim() || undefined,
            문제: 문제.trim() || undefined,
            태그: 태그.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean),
            조건: 조건.trim() || undefined,
          }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          setEssayTypeModal(null);
          fetchEssayTypes();
        } else {
          alert(data?.error || '추가에 실패했습니다.');
        }
      } else if (essayTypeModal?.mode === 'edit') {
        const res = await fetch(`/api/admin/essay-types/${essayTypeModal.item.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            대분류: 대분류.trim(),
            소분류: 소분류.trim(),
            typeCode: typeCode.trim() || null,
            문제: 문제.trim() || null,
            태그: 태그.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean),
            조건: 조건.trim() || null,
          }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          setEssayTypeModal(null);
          fetchEssayTypes();
        } else {
          alert(data?.error || '수정에 실패했습니다.');
        }
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setEssayTypeSaving(false);
    }
  };

  const uploadExampleFile = async (typeId: string, file: File) => {
    setEssayExampleUploadingId(typeId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/admin/essay-types/${typeId}/example-file`, { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok && data.ok) {
        setModalExampleFile({ originalName: data.originalName ?? file.name });
        setEssayTypes((prev) => prev.map((t) => (t.id === typeId ? { ...t, exampleFile: { originalName: data.originalName ?? file.name } } : t)));
      } else {
        alert(data?.error || '업로드에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setEssayExampleUploadingId(null);
    }
  };

  const deleteExampleFile = async (typeId: string) => {
    if (!confirm('예시 파일을 삭제할까요?')) return;
    setEssayExampleDeletingId(typeId);
    try {
      const res = await fetch(`/api/admin/essay-types/${typeId}/example-file`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setModalExampleFile(null);
        setEssayTypes((prev) => prev.map((t) => (t.id === typeId ? { ...t, exampleFile: undefined } : t)));
      } else {
        alert(data?.error || '삭제에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setEssayExampleDeletingId(null);
    }
  };

  const setEssayTypeEnabled = async (id: string, enabled: boolean) => {
    setEssayTypeTogglingId(id);
    try {
      const res = await fetch(`/api/admin/essay-types/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setEssayTypes((prev) => prev.map((t) => (t.id === id ? { ...t, enabled } : t)));
      } else {
        alert(data?.error || '노출 설정에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setEssayTypeTogglingId(null);
    }
  };

  const saveCategoryPrice = async (대분류: string, priceInput: string | number) => {
    const price = typeof priceInput === 'number' ? priceInput : parseInt(String(priceInput).replace(/\D/g, ''), 10);
    if (Number.isNaN(price) || price < 0) {
      alert('0 이상의 숫자를 입력해 주세요.');
      return;
    }
    setCategoryPriceSaving(대분류);
    try {
      const res = await fetch('/api/admin/essay-types/category-price', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 대분류, price }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setCategoryPriceDraft((prev) => {
          const next = { ...prev };
          delete next[대분류];
          return next;
        });
        fetchEssayTypes();
      } else {
        alert(data?.error || '가격 적용에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setCategoryPriceSaving(null);
    }
  };

  const setEssayTypeCommon = async (id: string, common: boolean) => {
    setEssayTypeTogglingId(id);
    try {
      const res = await fetch(`/api/admin/essay-types/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ common }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setEssayTypes((prev) => prev.map((t) => (t.id === id ? { ...t, common } : t)));
      } else {
        alert(data?.error || '공통유형 설정에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setEssayTypeTogglingId(null);
    }
  };

  const deleteEssayType = async (id: string) => {
    if (!confirm('이 유형을 삭제할까요? 기출 분류에 사용된 경우 표시에 영향을 줄 수 있습니다.')) return;
    setEssayTypeDeletingId(id);
    try {
      const res = await fetch(`/api/admin/essay-types/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.ok) {
        fetchEssayTypes();
        if (essayTypeModal?.mode === 'edit' && essayTypeModal.item.id === id) setEssayTypeModal(null);
      } else {
        alert(data?.error || '삭제에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setEssayTypeDeletingId(null);
    }
  };

  const deleteEssayCategory = async (대분류: string) => {
    if (!confirm(`"${대분류}" 대분류를 삭제할까요? 해당 대분류에 속한 모든 하위 유형이 함께 삭제되며 복구할 수 없습니다.`)) return;
    setEssayCategoryDeleting(대분류);
    try {
      const res = await fetch(`/api/admin/essay-types?대분류=${encodeURIComponent(대분류)}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.ok) {
        fetchEssayTypes();
        if (essayTypeModal?.mode === 'edit' && essayTypeModal.item.대분류 === 대분류) setEssayTypeModal(null);
        setCategoryPriceDraft((prev) => {
          const next = { ...prev };
          delete next[대분류];
          return next;
        });
      } else {
        alert(data?.error || '삭제에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setEssayCategoryDeleting(null);
    }
  };

  const openEssayCategoryEdit = (대분류: string) => {
    setEssayCategoryEditModal(대분류);
    setCategoryNameDraft(대분류);
  };
  const saveEssayCategoryRename = async () => {
    if (!essayCategoryEditModal) return;
    const newName = categoryNameDraft.trim();
    if (!newName) {
      alert('변경할 대분류 이름을 입력해 주세요.');
      return;
    }
    if (essayCategoryEditModal === newName) {
      setEssayCategoryEditModal(null);
      return;
    }
    setCategoryNameSaving(true);
    try {
      const res = await fetch('/api/admin/essay-types/category-price', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 대분류: essayCategoryEditModal, new대분류: newName }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setEssayCategoryEditModal(null);
        setCategoryPriceDraft((prev) => {
          const next = { ...prev };
          if (prev[essayCategoryEditModal] !== undefined) {
            next[newName] = prev[essayCategoryEditModal];
            delete next[essayCategoryEditModal];
          }
          return next;
        });
        if (essayTypeModal?.mode === 'edit' && essayTypeModal.item.대분류 === essayCategoryEditModal) {
          setEssayTypeForm((prev) => ({ ...prev, 대분류: newName }));
        }
        fetchEssayTypes();
      } else {
        alert(data?.error || '수정에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setCategoryNameSaving(false);
    }
  };

  const openOrderDetail = (o: AdminOrder, tab: 'dropbox' | 'status' = 'status') => {
    setOrderDetailModal(o);
    setOrderDetailTab(tab);
    setFileUrlInput(o.fileUrl ?? '');
    setStatusInput(o.status || 'pending');
    setAssignLoginId(users[0]?.loginId ?? '');
  };

  const handleSaveFileUrl = async () => {
    if (!orderDetailModal) return;
    setFileUrlSavingId(orderDetailModal.id);
    try {
      const res = await fetch(`/api/orders/${orderDetailModal.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setFileUrl', fileUrl: fileUrlInput }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const next = { ...orderDetailModal, fileUrl: fileUrlInput };
        setRecentOrders((prev) => prev.map((o) => (o.id === orderDetailModal.id ? next : o)));
        setUserOrders((prev) => prev.map((o) => (o.id === orderDetailModal.id ? next : o)));
        setOrderDetailModal(next);
      } else {
        alert(data?.error || '저장에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setFileUrlSavingId(null);
    }
  };

  const handleSaveStatus = async () => {
    if (!orderDetailModal) return;
    setStatusSavingId(orderDetailModal.id);
    try {
      const res = await fetch(`/api/orders/${orderDetailModal.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setStatus', status: statusInput }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const label = STATUS_LABELS[statusInput] || statusInput;
        const d = data as {
          revenueWon?: unknown;
          completedAt?: unknown;
          orderGrossWon?: unknown;
          solbookAccountingSplit?: unknown;
        };
        const next: AdminOrder = {
          ...orderDetailModal,
          status: statusInput,
          statusLabel: label,
          revenueWon:
            statusInput === 'completed'
              ? typeof d.revenueWon === 'number'
                ? d.revenueWon
                : null
              : null,
          orderGrossWon:
            statusInput === 'completed' && typeof d.orderGrossWon === 'number' ? d.orderGrossWon : null,
          solbookAccountingSplit:
            statusInput === 'completed' && d.solbookAccountingSplit === true ? true : false,
          completedAt:
            statusInput === 'completed' && typeof d.completedAt === 'string' ? d.completedAt : null,
        };
        setRecentOrders((prev) => prev.map((o) => (o.id === orderDetailModal.id ? next : o)));
        setUserOrders((prev) => prev.map((o) => (o.id === orderDetailModal.id ? next : o)));
        setOrderDetailModal(next);
        fetchStats();
      } else {
        alert(data?.error || '저장에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setStatusSavingId(null);
    }
  };

  const handleAssignMember = async () => {
    if (!orderDetailModal || !assignLoginId.trim()) return;
    setAssignSavingId(orderDetailModal.id);
    try {
      const res = await fetch(`/api/orders/${orderDetailModal.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assignMember', loginId: assignLoginId.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const user = users.find((u) => u.loginId === assignLoginId);
        const next = { ...orderDetailModal, loginId: assignLoginId.trim() };
        setRecentOrders((prev) => prev.map((o) => (o.id === orderDetailModal.id ? next : o)));
        setUserOrders((prev) => prev.map((o) => (o.id === orderDetailModal.id ? next : o)));
        setOrderDetailModal(next);
      } else {
        alert(data?.error || '연결에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setAssignSavingId(null);
    }
  };

  const handleCreateOrderFolder = async (orderId: string) => {
    setCreateOrderFolderId(orderId);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/create-dropbox-folder`, { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({ type: 'success', text: `폴더 생성 완료: ${data.folderPath}` });
        setRecentOrders((prev) => prev.map((ord) => (ord.id === orderId ? { ...ord, dropboxFolderCreated: true } : ord)));
        setUserOrders((prev) => prev.map((ord) => (ord.id === orderId ? { ...ord, dropboxFolderCreated: true } : ord)));
      } else {
        setMessage({ type: 'error', text: data?.error || '폴더 생성에 실패했습니다.' });
      }
    } catch {
      setMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setCreateOrderFolderId(null);
    }
  };

  const handleDeleteOrder = async () => {
    if (!orderDetailModal || !confirm('이 주문을 삭제할까요? 삭제 후에는 복구할 수 없습니다.')) return;
    setDeleteSavingId(orderDetailModal.id);
    try {
      const res = await fetch(`/api/orders/${orderDetailModal.id}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setRecentOrders((prev) => prev.filter((o) => o.id !== orderDetailModal.id));
        setUserOrders((prev) => prev.filter((o) => o.id !== orderDetailModal.id));
        setOrderDetailModal(null);
        setOrderDetailTab('status');
      } else {
        alert(data?.error || '삭제에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setDeleteSavingId(null);
    }
  };

  const handleDeleteOrderById = async (orderId: string, status: string = 'pending') => {
    const isCancelled = (status || 'pending') === 'cancelled';
    const confirmMsg = isCancelled
      ? '이 주문을 목록에서 삭제할까요? 삭제 후에는 복구할 수 없습니다.'
      : '이 주문은 취소 처리되지 않은 상태입니다.\n\n관리자 권한으로 DB에서 영구 삭제하면 복구할 수 없습니다. 삭제할까요?';
    if (!confirm(confirmMsg)) return;
    setDeleteOrderId(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setRecentOrders((prev) => prev.filter((o) => o.id !== orderId));
        setUserOrders((prev) => prev.filter((o) => o.id !== orderId));
        setOrderBulkSelectedIds((prev) => {
          if (!prev.has(orderId)) return prev;
          const next = new Set(prev);
          next.delete(orderId);
          return next;
        });
        if (orderDetailModal?.id === orderId) {
          setOrderDetailModal(null);
          setOrderDetailTab('status');
        }
      } else {
        alert(data?.error || '삭제에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setDeleteOrderId(null);
    }
  };

  const handleBulkDeleteOrders = async () => {
    const ids = Array.from(orderBulkSelectedIds);
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const rows = recentOrders.filter((o) => idSet.has(o.id));
    const nonCancelled = rows.filter((o) => (o.status || 'pending') !== 'cancelled').length;
    const tail =
      nonCancelled > 0
        ? `\n\n취소되지 않은 주문 ${nonCancelled}건이 포함되어 있습니다.`
        : '';
    if (!confirm(`선택한 ${ids.length}건을 DB에서 영구 삭제할까요? 복구할 수 없습니다.${tail}`)) return;

    setBulkDeletingOrders(true);
    const succeeded: string[] = [];
    const failed: string[] = [];
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/orders/${id}`, { method: 'DELETE', credentials: 'include' }).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'fail');
            return id;
          })
        )
      );
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') succeeded.push(ids[i]);
        else failed.push(ids[i]);
      });
      if (succeeded.length > 0) {
        const ok = new Set(succeeded);
        setRecentOrders((prev) => prev.filter((o) => !ok.has(o.id)));
        setUserOrders((prev) => prev.filter((o) => !ok.has(o.id)));
        setOrderBulkSelectedIds((prev) => {
          const next = new Set(prev);
          succeeded.forEach((id) => next.delete(id));
          return next;
        });
        if (orderDetailModal && ok.has(orderDetailModal.id)) {
          setOrderDetailModal(null);
          setOrderDetailTab('status');
        }
      }
      if (failed.length > 0) {
        alert(`삭제에 실패한 주문이 ${failed.length}건 있습니다. 나머지는 삭제되었을 수 있습니다.`);
      }
    } catch {
      alert('일괄 삭제 요청 중 오류가 발생했습니다.');
    } finally {
      setBulkDeletingOrders(false);
    }
  };

  const handleSaveExamClassify = async () => {
    if (!examUploadForClassify) return;
    setClassifySavingId(examUploadForClassify.id);
    try {
      const res = await fetch(`/api/admin/past-exam-uploads/${examUploadForClassify.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminCategories: selectedCategoriesForClassify }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setExamUploads((prev) =>
          prev.map((e) =>
            e.id === examUploadForClassify.id
              ? { ...e, adminCategories: selectedCategoriesForClassify, adminClassifiedAt: new Date().toISOString() }
              : e
          )
        );
        setExamUploadForClassify(null);
      } else {
        alert(data?.error || '저장에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setClassifySavingId(null);
    }
  };

  const handleAddFilesSubmit = async () => {
    if (!examUploadForAddFiles || !addFilesList?.length) return;
    setAddFilesSavingId(examUploadForAddFiles.id);
    try {
      const formData = new FormData();
      for (let i = 0; i < addFilesList.length; i++) {
        formData.append('files', addFilesList[i]);
      }
      const res = await fetch(`/api/admin/past-exam-uploads/${examUploadForAddFiles.id}/files`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setExamUploadForAddFiles(null);
        setAddFilesList(null);
        fetchExamUploads();
      } else {
        alert(data?.error || '파일 추가에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setAddFilesSavingId(null);
    }
  };

  const handleAdminCreateExamSubmit = async () => {
    const { loginId, school, grade, examYear, examType, examScope } = adminCreateExamForm;
    if (!loginId.trim()) { alert('회원을 선택해 주세요.'); return; }
    if (!school.trim()) { alert('학교를 입력해 주세요.'); return; }
    if (!grade.trim()) { alert('학년을 선택해 주세요.'); return; }
    if (!examYear.trim()) { alert('시험 연도를 선택해 주세요.'); return; }
    if (!examType) { alert('시험 종류를 선택해 주세요.'); return; }
    if (!adminCreateExamFiles?.length) { alert('파일을 1개 이상 선택해 주세요.'); return; }
    setAdminCreateExamSaving(true);
    try {
      const formData = new FormData();
      formData.append('loginId', loginId.trim());
      formData.append('school', school.trim());
      formData.append('grade', grade.trim());
      formData.append('examYear', examYear.trim());
      formData.append('examType', examType);
      formData.append('examScope', examScope.trim());
      for (let i = 0; i < adminCreateExamFiles.length; i++) {
        formData.append('files', adminCreateExamFiles[i]);
      }
      const res = await fetch('/api/admin/past-exam-uploads', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok && data.ok) {
        setAdminCreateExamOpen(false);
        setAdminCreateExamForm({ loginId: '', school: '', grade: '', examYear: '', examType: '', examScope: '' });
        setAdminCreateExamFiles(null);
        fetchExamUploads();
      } else {
        alert(data?.error || '등록에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setAdminCreateExamSaving(false);
    }
  };

  const handlePassageUpload = async () => {
    if (!passageUploadFile) {
      setPassageUploadMessage({ type: 'error', text: '엑셀 파일을 선택해 주세요.' });
      return;
    }
    setPassageUploadMessage(null);
    setPassageUploadSaving(true);
    try {
      const formData = new FormData();
      formData.append('file', passageUploadFile);
      const res = await fetch('/api/admin/passage-upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPassageUploadMessage({ type: 'success', text: `교재 "${data.textbookName}"가 지문 데이터(converted_data.json)에 반영되었습니다.` });
        setPassageUploadFile(null);
      } else {
        setPassageUploadMessage({ type: 'error', text: data?.error || data?.detail || '업로드에 실패했습니다.' });
      }
    } catch {
      setPassageUploadMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setPassageUploadSaving(false);
    }
  };

  const handlePassageUploadFromDb = async () => {
    if (!passageUploadDbTextbook.trim()) {
      setPassageUploadMessage({ type: 'error', text: '원문 DB에서 가져올 교재를 선택해 주세요.' });
      return;
    }
    setPassageUploadMessage(null);
    setPassageUploadFromDbSaving(true);
    try {
      const res = await fetch('/api/admin/passage-upload/from-passages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ textbook: passageUploadDbTextbook.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPassageUploadMessage({
          type: 'success',
          text: `교재 "${data.textbook}"를 MongoDB 원문(passages) 기준으로 converted_data.json에 반영했습니다. (강 ${data.lessonCount}개 · 원문 ${data.passageCount}건)`,
        });
      } else {
        setPassageUploadMessage({ type: 'error', text: data?.error || '불러오기에 실패했습니다.' });
      }
    } catch {
      setPassageUploadMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setPassageUploadFromDbSaving(false);
    }
  };

  const toggleClassifyCategory = (value: string) => {
    setSelectedCategoriesForClassify((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    );
  };

  const downloadMembersCsv = () => {
    const escape = (v: string) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    const headers = ['아이디', '이름', '이메일', '전화번호', 'Dropbox폴더', 'Dropbox공유링크', '분석지허용', '서술형허용', '분석지교재수', '서술형교재수', '변형부교재전용수', '가입일'];
    const rows = users.map((u) => [
      escape(u.loginId ?? ''),
      escape(u.name ?? ''),
      escape(u.email ?? ''),
      escape(u.phone ?? ''),
      escape(u.dropboxFolderPath ?? ''),
      escape(u.dropboxSharedLink ?? ''),
      u.canAccessAnalysis ? 'Y' : 'N',
      u.canAccessEssay ? 'Y' : 'N',
      String((u.allowedTextbooksAnalysis?.length ?? u.allowedTextbooks?.length) ?? 0),
      String((u.allowedTextbooksEssay?.length ?? u.allowedTextbooks?.length) ?? 0),
      u.allowedTextbooksVariant !== undefined ? String(u.allowedTextbooksVariant.length) : '',
      escape(formatDate(u.createdAt)),
    ]);
    const bom = '\uFEFF';
    const csv = bom + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `회원목록_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openOrdersModal = (u: ListUser) => {
    setOrdersModalUser(u);
    setUserOrders([]);
    setUserOrdersLoading(true);
    fetch(`/api/admin/orders?loginId=${encodeURIComponent(u.loginId)}`)
      .then((r) => r.json())
      .then((d) => setUserOrders(d.orders || []))
      .finally(() => setUserOrdersLoading(false));
  };

  const today = new Date().toDateString();
  const todayOrders = recentOrders.filter((o) => new Date(o.createdAt).toDateString() === today);
  /** 취소 아님 + 드롭박스 공유 링크(fileUrl) 없음 = 대시보드에서 말하는 「미처리」 */
  const pendingNoLinkOrders = recentOrders.filter(
    (o) => (o.status || 'pending') !== 'cancelled' && !o.fileUrl
  );
  const needLinkCount = pendingNoLinkOrders.length;
  /** 폴더는 만들어졌고 공유 링크만 없음 */
  const needShareLinkOrders = pendingNoLinkOrders.filter((o) => o.dropboxFolderCreated);
  const needShareLinkCount = needShareLinkOrders.length;
  /** 회원 주문·Dropbox 연동됨인데 아직 폴더 생성 전 */
  const needCreateFolderOrders = pendingNoLinkOrders.filter(
    (o) => !o.dropboxFolderCreated && !!o.loginId && !!stats?.dropboxConfigured
  );
  const needCreateFolderCount = needCreateFolderOrders.length;
  /** 비회원, 또는 Dropbox 미설정 등으로 자동 폴더 플로우 밖 */
  const needOtherPendingOrders = pendingNoLinkOrders.filter((o) => {
    if (o.dropboxFolderCreated) return false;
    if (o.loginId && stats?.dropboxConfigured) return false;
    return true;
  });
  const needOtherPendingCount = needOtherPendingOrders.length;

  const filteredOrders = recentOrders.filter((o) => {
    if (orderFilter !== 'all') {
      const s = o.status || 'pending';
      if (s !== orderFilter) return false;
    }
    const q = orderSearch.trim().toLowerCase();
    if (!q) return true;
    const num = (o.orderNumber ?? '').toLowerCase();
    const lid = (o.loginId ?? '').toLowerCase();
    const text = (o.orderText ?? '').toLowerCase().slice(0, 800);
    return num.includes(q) || lid.includes(q) || text.includes(q);
  });

  const displayOrders = section === 'dashboard' ? recentOrders.slice(0, 8) : filteredOrders;
  const displayOrderIdsKey = displayOrders.map((o) => o.id).join('|');

  useEffect(() => {
    const visible =
      displayOrderIdsKey === '' ? new Set<string>() : new Set(displayOrderIdsKey.split('|'));
    setOrderBulkSelectedIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
      }
      if (next.size === prev.size) {
        for (const id of prev) {
          if (!next.has(id)) return next;
        }
        return prev;
      }
      return next;
    });
  }, [displayOrderIdsKey]);

  const allVisibleOrdersSelected =
    displayOrders.length > 0 && displayOrders.every((o) => orderBulkSelectedIds.has(o.id));
  const someVisibleOrdersSelected = displayOrders.some((o) => orderBulkSelectedIds.has(o.id));

  useEffect(() => {
    const el = orderSelectAllRef.current;
    if (el) el.indeterminate = someVisibleOrdersSelected && !allVisibleOrdersSelected;
  }, [someVisibleOrdersSelected, allVisibleOrdersSelected]);

  const orderAnalytics = buildOrderAnalytics(displayOrders);
  const completedOrderCountFor = (loginIdKey: string) => stats?.orderCountByLoginId?.[loginIdKey] ?? 0;
  const completedOrderRevenueFor = (loginIdKey: string) => stats?.revenueByLoginId?.[loginIdKey] ?? 0;
  const lastOrderDateFor = (loginIdKey: string) => stats?.lastOrderDateByLoginId?.[loginIdKey] ?? null;

  const todayStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).replace(/\. /g, '.').replace('.', ' ');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin w-10 h-10 border-4 border-slate-600 border-t-white rounded-full" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      {/* Sidebar */}
      <aside className="w-60 bg-slate-800 shrink-0 flex flex-col border-r border-slate-700 h-svh sticky top-0">
        <div className="p-5 border-b border-slate-700 shrink-0">
          <h1 className="font-bold text-lg text-white">PAYPERIC ADMIN</h1>
        </div>
        <nav className="p-3 flex-1 text-sm overflow-y-auto min-h-0">
          <p className="px-3 py-2 text-slate-500 uppercase tracking-wider text-xs">OVERVIEW</p>
          <button
            type="button"
            onClick={() => setSection('dashboard')}
            className={`w-full text-left px-4 py-2.5 rounded-lg font-medium transition-colors ${section === 'dashboard' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/50'}`}
          >
            대시보드
          </button>
          <p className="px-3 py-2 text-slate-500 uppercase tracking-wider text-xs mt-4">ORDERS</p>
          <button
            type="button"
            onClick={() => setSection('orders')}
            className={`w-full text-left px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-between ${section === 'orders' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/50'}`}
          >
            <span>전체 주문</span>
            {needLinkCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold min-w-[1.25rem] h-5 px-1.5 rounded-full flex items-center justify-center">
                {needLinkCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => { setSection('orders'); setOrderFilter('pending'); }}
            className="w-full text-left px-4 py-2.5 rounded-lg font-medium text-slate-300 hover:bg-slate-700/50 transition-colors"
          >
            미처리 주문
          </button>
          <p className="px-3 py-2 text-slate-500 uppercase tracking-wider text-xs mt-4">UPLOADS</p>
          <button
            type="button"
            onClick={() => setSection('exams')}
            className={`w-full text-left px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-between ${section === 'exams' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/50'}`}
          >
            <span>기출문제</span>
            {examUploads.length > 0 && (
              <span className="bg-emerald-500 text-white text-xs font-bold min-w-[1.25rem] h-5 px-1.5 rounded-full flex items-center justify-center">
                {examUploads.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setSection('passageUpload')}
            className={`w-full text-left px-4 py-2.5 rounded-lg font-medium transition-colors ${section === 'passageUpload' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/50'}`}
          >
            지문 업로드
          </button>
          <Link
            href="/admin/passages"
            className="block w-full text-left px-4 py-2.5 rounded-lg font-medium text-slate-300 hover:bg-slate-700/50 transition-colors"
          >
            원문 관리 (DB)
          </Link>
          <Link
            href="/admin/generated-questions"
            className="block w-full text-left px-4 py-2.5 rounded-lg font-medium text-slate-300 hover:bg-slate-700/50 transition-colors"
          >
            변형문제 관리 (DB)
          </Link>
          <Link
            href="/admin/syntax-analyzer"
            className="block w-full text-left px-4 py-2.5 rounded-lg font-medium text-slate-300 hover:bg-slate-700/50 transition-colors"
          >
            구문 분석기
          </Link>
          <Link
            href="/admin/mcp"
            className="block w-full text-left px-4 py-2.5 rounded-lg font-medium text-slate-300 hover:bg-slate-700/50 transition-colors"
          >
            Claude MCP
          </Link>
          <Link
            href="/admin/generated-questions/review-logs"
            className="block w-full text-left px-4 py-2.5 rounded-lg font-medium text-emerald-200/90 hover:bg-emerald-950/40 transition-colors border border-emerald-800/40 mt-1"
          >
            Claude Code 검수 로그
          </Link>
          <p className="px-3 py-2 text-slate-500 uppercase tracking-wider text-xs mt-4">MEMBERS</p>
          <button
            type="button"
            onClick={() => setSection('members')}
            className={`w-full text-left px-4 py-2.5 rounded-lg font-medium transition-colors ${section === 'members' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/50'}`}
          >
            회원 관리
          </button>
          <button
            type="button"
            onClick={() => { setSection('members'); setTimeout(() => document.getElementById('quick-create')?.scrollIntoView({ behavior: 'smooth' }), 100); }}
            className="w-full text-left px-4 py-2.5 rounded-lg font-medium text-slate-300 hover:bg-slate-700/50 transition-colors"
          >
            + 계정 생성
          </button>
          <p className="px-3 py-2 text-slate-500 uppercase tracking-wider text-xs mt-4">SETTINGS</p>
          <button
            type="button"
            onClick={() => setSection('settings')}
            className={`w-full text-left px-4 py-2.5 rounded-lg font-medium transition-colors ${section === 'settings' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/50'}`}
          >
            교재 노출 설정
          </button>
          <button
            type="button"
            onClick={() => setSection('essayTypes')}
            className={`w-full text-left px-4 py-2.5 rounded-lg font-medium transition-colors ${section === 'essayTypes' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/50'}`}
          >
            서술형 유형 관리
          </button>
        </nav>
        <div className="p-4 border-t border-slate-700 flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-full bg-slate-600 flex items-center justify-center text-sm font-bold text-white">
            {(user.loginId || 'A').charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-white text-sm">{user.loginId}</p>
            <p className="text-slate-400 text-xs">관리자</p>
          </div>
        </div>
        <div className="p-4 border-t border-slate-700 shrink-0">
          <Link href="/" className="text-slate-400 hover:text-white text-sm">← 메인으로</Link>
          <button type="button" onClick={handleLogout} className="block mt-2 text-slate-400 hover:text-white text-sm">로그아웃</button>
        </div>
      </aside>

      <main ref={mainContentScrollRef} className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto">
          <p className="text-slate-400 text-sm mb-6">{todayStr}</p>

          {/* 데이터 조회 실패 안내 */}
          {dataError && (
            <div className="bg-amber-500/20 border border-amber-500/50 rounded-xl px-4 py-3 flex items-center justify-between mb-6">
              <span className="text-amber-200 font-medium">{dataError}</span>
              <button type="button" onClick={() => { setDataError(null); fetchUsers(); fetchOrders(); fetchStats(); }} className="text-amber-200 hover:text-white font-medium text-sm underline">
                다시 불러오기
              </button>
            </div>
          )}

          {/* Red alert: 미처리 주문 */}
          {needLinkCount > 0 && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-6">
              <div className="text-red-200 flex-1 min-w-0 text-sm leading-relaxed">
                <p className="font-medium text-red-100">미처리 주문 {needLinkCount}건 (공유 링크 미등록)</p>
                <p className="mt-1 text-red-200/95 text-xs sm:text-sm">
                  · 공유 링크만 필요 (폴더 생성됨){' '}
                  <span className="tabular-nums font-semibold text-red-100">{needShareLinkCount}</span>건
                  <span className="text-red-300/80 mx-1.5">|</span>· Dropbox 폴더 생성 전 (회원·연동){' '}
                  <span className="tabular-nums font-semibold text-red-100">{needCreateFolderCount}</span>건
                  {needOtherPendingCount > 0 && (
                    <>
                      <span className="text-red-300/80 mx-1.5">|</span>· 기타 (비회원·Dropbox 미설정 등){' '}
                      <span className="tabular-nums font-semibold text-red-100">{needOtherPendingCount}</span>건
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setSection('orders'); setOrderFilter('pending'); }}
                className="flex-shrink-0 py-2 px-4 rounded-lg bg-red-500/30 hover:bg-red-500/50 border border-red-500/50 text-red-100 hover:text-white font-medium text-sm cursor-pointer transition-colors"
              >
                바로가기 →
              </button>
            </div>
          )}

          {(section === 'dashboard' || section === 'orders') && (
            <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
            <button
              type="button"
              onClick={() => void openSiteVisitsHistoryModal()}
              className="bg-slate-800 rounded-xl border border-slate-700 p-5 text-left w-full transition-colors hover:border-slate-500 hover:bg-slate-700/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 cursor-pointer"
            >
              <p className="text-slate-400 text-sm flex items-center justify-between gap-2">
                오늘 사이트 방문(추정)
                <span className="text-[10px] font-medium text-cyan-400/90">일별 기록 →</span>
              </p>
              <p className="text-2xl font-bold text-cyan-300 mt-1 tabular-nums">
                {stats?.siteVisitsTodayUnique?.toLocaleString() ?? '—'}명
              </p>
              <p className="text-slate-500 text-xs mt-1 leading-relaxed">
                쿠키 기준 당일 첫 방문만 1명으로 집계
                <span className="block text-slate-600 mt-0.5">
                  페이지 조회 {stats?.siteVisitsTodayPageViews?.toLocaleString() ?? '—'}회 · 한국 날짜{' '}
                  {stats?.siteVisitsTodayKey ?? '—'}
                </span>
              </p>
            </button>
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
              <p className="text-slate-400 text-sm">오늘 주문</p>
              <p className="text-2xl font-bold text-white mt-1">{todayOrders.length}건</p>
              <p className="text-slate-500 text-xs mt-1">+{stats?.newOrdersThisWeek ?? 0}건 이번 주</p>
            </div>
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
              <p className="text-slate-400 text-sm">총 회원</p>
              <p className="text-2xl font-bold text-white mt-1">{users.length}명</p>
              <p className="text-slate-500 text-xs mt-1">+{stats?.newMembersThisMonth ?? 0}명 이번 달</p>
            </div>
            <button
              type="button"
              onClick={() => void openMonthlyRevenueModal()}
              className="bg-slate-800 rounded-xl border border-slate-700 p-5 text-left w-full transition-colors hover:border-slate-500 hover:bg-slate-700/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 cursor-pointer"
            >
              <p className="text-slate-400 text-sm flex items-center justify-between gap-2">
                이번달 매출
                <span className="text-[10px] font-medium text-cyan-400/90">월별 조회 →</span>
              </p>
              <p className="text-2xl font-bold text-white mt-1 tabular-nums">
                {typeof stats?.revenueThisMonth === 'number' ? `${stats.revenueThisMonth.toLocaleString()}원` : '—'}
              </p>
              <p className="text-slate-500 text-xs mt-1">
                누적(완료) <span className="text-slate-400 tabular-nums">{typeof stats?.revenueTotal === 'number' ? `${stats.revenueTotal.toLocaleString()}원` : '—'}</span>
                <span className="block text-slate-600 mt-0.5">
                  이번 달 구분: 주문번호 중간 날짜(YYYYMMDD) → 없으면 완료일(한국) · 금액은 주문서 파싱
                </span>
              </p>
            </button>
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
              <p className="text-slate-400 text-sm">미처리 주문</p>
              <p className="text-2xl font-bold text-amber-400 mt-1 flex items-center gap-2">
                {needLinkCount}건
                {needLinkCount > 0 && (
                  <span className="text-amber-400" title="드롭박스 공유 링크 미등록">⚠</span>
                )}
              </p>
              <div className="text-slate-500 text-[11px] mt-2 space-y-1 leading-snug">
                <p>
                  링크만 필요 <span className="text-amber-200/90 tabular-nums font-semibold">{needShareLinkCount}</span>
                  <span className="text-slate-600 mx-1">·</span>
                  폴더 생성 전 <span className="text-amber-200/90 tabular-nums font-semibold">{needCreateFolderCount}</span>
                </p>
                {needOtherPendingCount > 0 && (
                  <p>
                    기타 <span className="text-slate-300 tabular-nums font-semibold">{needOtherPendingCount}</span>
                    <span className="text-slate-600"> (비회원·연동 불가)</span>
                  </p>
                )}
                <p className="text-slate-600 pt-0.5">취소 제외 · fileUrl 없음 기준</p>
              </div>
            </div>
          </div>

          {/* 기출문제 새 업로드 알림 */}
          {examUploads.length > 0 && section === 'dashboard' && (() => {
            const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
            const recentExams = examUploads.filter((e) => new Date(e.createdAt).getTime() > oneDayAgo);
            if (recentExams.length === 0) return null;
            return (
              <div className="bg-emerald-500/20 border border-emerald-500/50 rounded-xl px-4 py-3 flex items-center justify-between mb-6">
                <span className="text-emerald-200 font-medium">
                  📤 최근 24시간 내 기출문제 {recentExams.length}건이 새로 업로드되었습니다
                </span>
                <button type="button" onClick={() => setSection('exams')} className="text-emerald-200 hover:text-white font-medium text-sm">
                  확인하기 →
                </button>
              </div>
            );
          })()}

          {/* Recent orders (dashboard) or full orders (orders section) */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden mb-8">
            <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-bold text-lg text-white">최근 주문 요청</h2>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {orderBulkSelectedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleBulkDeleteOrders()}
                    disabled={bulkDeletingOrders || !!deleteOrderId}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-800/70 bg-red-950/50 text-red-200 hover:bg-red-900/50 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    title="체크한 주문만 일괄 영구 삭제"
                  >
                    {bulkDeletingOrders ? '삭제 중…' : `선택 삭제 (${orderBulkSelectedIds.size})`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setDataError(null);
                    fetchOrders();
                  }}
                  disabled={recentOrdersLoading}
                  className="px-3 py-1.5 border border-slate-600 rounded-lg text-xs text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="주문 목록 다시 불러오기"
                >
                  {recentOrdersLoading ? '불러오는 중…' : '새로고침'}
                </button>
                {section === 'dashboard' && (
                  <button type="button" onClick={() => setSection('orders')} className="text-slate-400 hover:text-white text-sm font-medium">
                    전체 보기 →
                  </button>
                )}
              </div>
            </div>
            {/* 주문번호 접두어 안내 (전체 주문 화면에서만 표시) */}
            {section === 'orders' && (
              <div className="px-5 py-4 bg-slate-700/40 border-b border-slate-700">
                <p className="text-slate-300 text-sm font-medium mb-2">주문번호 접두어 (플로우별)</p>
                <p className="text-slate-400 text-xs mb-3">접두어 2글자 = 재료(1글자) + 제품(1글자). 미지정·구버전 주문은 GJ로 표시됩니다.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-slate-500 shrink-0">재료:</span>
                    <span className="text-slate-300">M=모의고사, B=부교재, E=EBS</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-slate-500 shrink-0">제품:</span>
                    <span className="text-slate-300">V=변형문제, D=서술형, W=워크북, A=분석지</span>
                  </div>
                </div>
                <ul className="mt-3 text-xs text-slate-400 space-y-0.5">
                  <li><span className="font-mono text-cyan-300">BV</span> 부교재 + 변형문제 (교재·강 선택 후 문제 유형)</li>
                  <li><span className="font-mono text-cyan-300">MV</span> 모의고사 + 변형문제 (모의고사 설정·주문, 번호별 교재 제작)</li>
                  <li><span className="font-mono text-cyan-300">MW</span> 모의고사 + 워크북 (워크북 플로우에서 모의고사 교재 선택 시)</li>
                  <li><span className="font-mono text-cyan-300">BW</span> 부교재 + 워크북 (워크북 플로우에서 부교재 선택 시)</li>
                  <li><span className="font-mono text-cyan-300">MA</span> 모의고사 + 분석지 (분석지 주문에서 모의고사 교재 선택 시)</li>
                  <li><span className="font-mono text-cyan-300">BA</span> 부교재 + 분석지 (분석지 주문에서 부교재 선택 시)</li>
                  <li><span className="font-mono text-cyan-300">MD</span> 모의고사 + 서술형 (서술형 주문에서 모의고사 교재 선택 시)</li>
                  <li><span className="font-mono text-cyan-300">BD</span> 부교재 + 서술형 (서술형 주문에서 부교재 선택 시)</li>
                  <li><span className="font-mono text-slate-500">GJ</span> 구버전 또는 접두어 미지정</li>
                </ul>
              </div>
            )}
            {section === 'orders' && recentOrders.length > 0 && (
              <div className="px-5 py-3 border-b border-slate-700 flex flex-wrap items-center gap-3 bg-slate-800/80">
                <div className="flex rounded-lg overflow-hidden bg-slate-700">
                  {(['all', 'pending', 'completed'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setOrderFilter(f)}
                      className={`px-4 py-2 text-sm font-medium ${orderFilter === f ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                      {f === 'all' ? '전체' : f === 'pending' ? '미처리' : '완료'}
                    </button>
                  ))}
                </div>
                {orderFilter !== 'all' && orderFilter !== 'pending' && orderFilter !== 'completed' ? (
                  <span className="text-[11px] text-slate-500">
                    상태 필터:{' '}
                    <strong className="text-cyan-300/90">{STATUS_LABELS[orderFilter] ?? orderFilter}</strong>
                    <button
                      type="button"
                      onClick={() => setOrderFilter('all')}
                      className="ml-2 text-slate-400 hover:text-white underline-offset-2 hover:underline"
                    >
                      해제
                    </button>
                  </span>
                ) : null}
                <input
                  type="text"
                  placeholder="주문번호·아이디·주문내용 검색"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 w-56 max-w-full focus:ring-2 focus:ring-slate-500"
                />
              </div>
            )}
            {!recentOrdersLoading && displayOrders.length > 0 && (
              <div className="px-5 py-3 border-b border-slate-700 bg-slate-900/50">
                <p className="text-xs font-semibold text-slate-400 mb-2">목록 기준 요약 (현재 표시 {orderAnalytics.total}건)</p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {(['pending', 'accepted', 'payment_confirmed', 'in_progress', 'completed', 'cancelled'] as const).map((st) => {
                    const n = orderAnalytics.byStatus[st] ?? 0;
                    if (n === 0) return null;
                    const lab = STATUS_LABELS[st] || st;
                    const active = orderFilter === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() => {
                          setSection('orders');
                          setOrderFilter((prev) => (prev === st ? 'all' : st));
                        }}
                        title={`${lab}만 보기 · 다시 누르면 전체`}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/35 ${
                          active
                            ? 'bg-cyan-950/50 text-cyan-100 border-cyan-500/60 ring-1 ring-cyan-500/30'
                            : 'bg-slate-800 text-slate-300 border-slate-600 hover:border-slate-500 hover:bg-slate-700/50'
                        }`}
                      >
                        <span className={active ? 'text-cyan-200/95' : 'text-slate-500'}>{lab}</span>
                        <span className={`font-mono ${active ? 'text-cyan-200' : 'text-cyan-300'}`}>{n}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                  <span>
                    완료 건 매출 합계:{' '}
                    <strong className="text-emerald-300 tabular-nums">{orderAnalytics.completedRevenue.toLocaleString()}원</strong>
                    <span className="text-slate-600"> (표시 목록 중 status=완료)</span>
                  </span>
                  {orderAnalytics.pointsUsedTotal > 0 ? (
                    <span>
                      표시 목록 포인트 사용 합:{' '}
                      <strong className="text-sky-300 tabular-nums">{orderAnalytics.pointsUsedTotal.toLocaleString()}P</strong>
                    </span>
                  ) : null}
                </div>
                {orderAnalytics.byFlow.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-700/80">
                    <p className="text-[11px] text-slate-400 font-medium">주문 플로우</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">표시 목록 기준 건수 · 원문 코드는 칩에 마우스를 올리면 표시</p>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {orderAnalytics.byFlow.map(([flow, cnt]) => (
                        <span
                          key={flow}
                          title={flow === '—' ? 'flow 미지정' : `orderMeta.flow = ${flow}`}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800/95 text-[11px] border border-slate-600/90"
                        >
                          <span className="text-slate-100 font-medium">{orderFlowLabel(flow === '—' ? null : flow)}</span>
                          <span className="text-fuchsia-300 tabular-nums font-semibold">{cnt}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {recentOrdersLoading ? (
              <div className="p-8 text-center text-slate-500">불러오는 중…</div>
            ) : displayOrders.length === 0 ? (
              <div className="p-8 text-center text-slate-500">주문이 없습니다.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[960px]">
                  <thead className="sticky top-0 z-[1] bg-slate-800 shadow-sm">
                    <tr className="border-b border-slate-700 text-slate-400 text-xs">
                      <th className="w-10 py-3 px-2 text-center align-middle">
                        <input
                          ref={orderSelectAllRef}
                          type="checkbox"
                          checked={allVisibleOrdersSelected}
                          onChange={() => {
                            setOrderBulkSelectedIds(() => {
                              if (displayOrders.length === 0) return new Set();
                              if (allVisibleOrdersSelected) return new Set();
                              return new Set(displayOrders.map((o) => o.id));
                            });
                          }}
                          disabled={!!deleteOrderId || bulkDeletingOrders}
                          className="h-3.5 w-3.5 rounded border-slate-500 text-cyan-600 focus:ring-cyan-500/40"
                          title="현재 표에 보이는 주문만 전체 선택/해제"
                          aria-label="현재 목록 주문 전체 선택"
                        />
                      </th>
                      <th className="text-left py-3 px-3 min-w-[7.25rem]">접수일시</th>
                      <th className="text-left py-3 px-2 min-w-[6.5rem]">
                        <span className="block">유형</span>
                        <span className="block text-[10px] font-normal text-slate-500 mt-0.5">플로우</span>
                      </th>
                      <th className="text-left py-3 px-3 min-w-[8.5rem]">주문번호</th>
                      <th className="text-left py-3 px-3 min-w-[6rem]">회원</th>
                      <th className="text-left py-3 px-3 min-w-[12rem] max-w-[28rem] w-[22%]">주문 요약</th>
                      <th className="text-right py-3 px-2 whitespace-nowrap w-[4rem]">포인트</th>
                      <th
                        className="text-left py-3 px-2 whitespace-nowrap w-[5.5rem]"
                        title="일반: 인식된 입금액. 쏠북 연계 BV: 위=쏠북 커스텀만 집계, 아래=주문 합계(변형 제작 포함)"
                      >
                        금액
                      </th>
                      <th className="text-left py-3 px-2 min-w-[5.5rem]">상태</th>
                      <th className="text-left py-3 px-2 min-w-[7.25rem]">완료일</th>
                      <th className="text-left py-3 px-2 min-w-[11rem]">드롭박스</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayOrders.map((o) => {
                      const member = o.loginId ? users.find((u) => u.loginId === o.loginId) : null;
                      const orderCompleted = (o.status || 'pending') === 'completed';
                      const pointsUsedOnOrder = o.pointsUsed ?? 0;
                      const payWonForPoints =
                        pointsUsedOnOrder > 0 ? (o.paymentDueWon ?? o.revenueWon) : o.revenueWon;
                      const amountTitle = (() => {
                        if (!orderCompleted) return undefined;
                        if (o.revenueWon == null || o.revenueWon < 0) {
                          return '주문서에 인식 가능한 금액 문구가 없습니다';
                        }
                        if (o.solbookAccountingSplit) {
                          const g = o.orderGrossWon;
                          return g != null && g > 0
                            ? `쏠북 커스텀: ${o.revenueWon.toLocaleString()}원 · 주문 합계(변형 제작 포함): ${g.toLocaleString()}원`
                            : `쏠북 커스텀: ${o.revenueWon.toLocaleString()}원`;
                        }
                        if (pointsUsedOnOrder <= 0) return undefined;
                        const chunks: string[] = [];
                        if (o.orderGrossWon != null && o.orderGrossWon > 0) {
                          chunks.push(`주문 총액 ${o.orderGrossWon.toLocaleString()}원`);
                        }
                        if (payWonForPoints != null && payWonForPoints >= 0) {
                          chunks.push(`실입금 ${payWonForPoints.toLocaleString()}원`);
                        }
                        chunks.push(`포인트 ${pointsUsedOnOrder.toLocaleString()}원`);
                        return chunks.join(' · ');
                      })();
                      return (
                      <tr key={o.id} className="border-b border-slate-700/50 hover:bg-slate-700/40 align-top text-xs group/row">
                        <td className="py-2.5 px-2 align-middle text-center w-10">
                          <input
                            type="checkbox"
                            checked={orderBulkSelectedIds.has(o.id)}
                            onChange={() => {
                              setOrderBulkSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(o.id)) next.delete(o.id);
                                else next.add(o.id);
                                return next;
                              });
                            }}
                            disabled={!!deleteOrderId || bulkDeletingOrders}
                            className="h-3.5 w-3.5 rounded border-slate-500 text-cyan-600 focus:ring-cyan-500/40"
                            aria-label={`주문 ${o.orderNumber ?? o.id} 일괄 삭제 대상에 포함`}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td
                          className="py-2.5 px-3 text-slate-400 align-top leading-snug"
                          title={formatDateTime(o.createdAt)}
                        >
                          {(() => {
                            const { dateLine, timeLine } = formatOrderDateTwoLines(o.createdAt);
                            return (
                              <>
                                <span className="block text-slate-300 text-[11px]">{dateLine}</span>
                                <span className="block text-slate-500 text-[10px] tabular-nums mt-0.5">{timeLine}</span>
                              </>
                            );
                          })()}
                        </td>
                        <td className="py-2.5 px-2 align-top" title={o.orderMetaFlow ? `flow: ${o.orderMetaFlow}` : undefined}>
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-[11px] text-slate-200 font-medium leading-snug">
                              {orderFlowLabel(o.orderMetaFlow)}
                            </span>
                            {o.orderMetaFlow && !ORDER_FLOW_LABELS[o.orderMetaFlow] ? (
                              <span className="text-[9px] text-amber-200/85 font-mono truncate" title="라벨 미등록 플로우">
                                {o.orderMetaFlow}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 align-top">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {o.orderNumber ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(o.orderNumber!);
                                    setCopiedOrderNumberId(o.id);
                                    setTimeout(() => setCopiedOrderNumberId(null), 1500);
                                  } catch {
                                    setMessage({ type: 'error', text: '클립보드 복사에 실패했습니다.' });
                                  }
                                }}
                                className="shrink-0 rounded p-1 text-slate-500 hover:text-cyan-300 hover:bg-slate-700/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                                title="주문번호 복사"
                                aria-label={`주문번호 ${o.orderNumber} 클립보드에 복사`}
                              >
                                {copiedOrderNumberId === o.id ? (
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2.5}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="w-3.5 h-3.5 text-emerald-400"
                                    aria-hidden
                                  >
                                    <path d="M20 6L9 17l-5-5" />
                                  </svg>
                                ) : (
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="w-3.5 h-3.5"
                                    aria-hidden
                                  >
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                  </svg>
                                )}
                              </button>
                            ) : null}
                            <a
                              href={`/order/done?id=${o.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-white hover:text-blue-300 hover:underline truncate min-w-0"
                            >
                              {o.orderNumber || '—'}
                            </a>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 align-top">
                          {o.loginId ? (
                            <>
                              {member ? (
                                <button
                                  type="button"
                                  onClick={() => openEdit(member)}
                                  className="text-left text-white font-medium hover:text-cyan-200 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 rounded"
                                  title="회원 카드(계정 수정) 열기"
                                >
                                  {member.name}
                                </button>
                              ) : (
                                <span className="text-white font-medium" title="회원 목록에 없는 아이디입니다">
                                  —
                                </span>
                              )}
                              <span className="text-slate-500 text-[11px] ml-1">({o.loginId})</span>
                            </>
                          ) : (
                            '비회원'
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 align-top min-w-0">
                          <button
                            type="button"
                            onClick={() => {
                              if (o.orderText?.trim()) setOrderTextPreviewModal(o);
                              else openOrderDetail(o);
                            }}
                            className="line-clamp-3 break-words text-[11px] leading-relaxed w-full min-w-0 text-left rounded-md -m-0.5 p-0.5 hover:bg-slate-700/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40"
                            title={
                              o.orderText?.trim()
                                ? '클릭하면 주문 전문 팝업'
                                : '주문 본문 없음 — 클릭하면 주문 관리'
                            }
                          >
                            {o.orderText?.replace(/\s+/g, ' ').trim().slice(0, 280) || '—'}
                            {o.orderText && o.orderText.length > 280 ? '…' : ''}
                          </button>
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-400 tabular-nums whitespace-nowrap align-top">
                          {(o.pointsUsed ?? 0) > 0 ? (
                            <span className="text-sky-300/90">{(o.pointsUsed ?? 0).toLocaleString()}</span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-slate-300 tabular-nums text-xs align-top" title={amountTitle}>
                          {orderCompleted ? (
                            o.revenueWon != null && o.revenueWon >= 0 ? (
                              pointsUsedOnOrder > 0 ? (
                                <div className="space-y-0.5">
                                  {o.orderGrossWon != null && o.orderGrossWon > 0 ? (
                                    <div className="text-[11px] text-slate-400 tabular-nums leading-tight">
                                      총 {o.orderGrossWon.toLocaleString()}원
                                    </div>
                                  ) : null}
                                  <div className="text-sky-300/95 tabular-nums leading-tight font-medium">
                                    입금{' '}
                                    {(payWonForPoints != null && payWonForPoints >= 0
                                      ? payWonForPoints
                                      : o.revenueWon
                                    ).toLocaleString()}
                                    원
                                  </div>
                                  <div className="text-[10px] text-sky-400/80 tabular-nums leading-tight">
                                    포인트 {pointsUsedOnOrder.toLocaleString()}원
                                  </div>
                                </div>
                              ) : o.solbookAccountingSplit ? (
                                o.orderGrossWon != null && o.orderGrossWon > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleSolbookAmountExpanded(o.id)}
                                    className="space-y-1 rounded-md border border-sky-500/25 bg-sky-950/35 px-2 py-1.5 w-full text-left cursor-pointer hover:border-sky-400/35 hover:bg-sky-950/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
                                    title={
                                      solbookAmountExpandedIds.has(o.id)
                                        ? '클릭하여 접기'
                                        : '클릭하여 합계·안내 보기'
                                    }
                                  >
                                    <div className="text-sky-200 tabular-nums leading-tight font-medium">
                                      {o.revenueWon.toLocaleString()}원
                                    </div>
                                    {solbookAmountExpandedIds.has(o.id) ? (
                                      <div className="text-[10px] text-sky-300/90 tabular-nums leading-tight pt-1 border-t border-sky-500/20">
                                        합계 {o.orderGrossWon.toLocaleString()}원
                                        <span className="block text-sky-400/80 mt-0.5">(변형 제작 포함·집계 제외)</span>
                                      </div>
                                    ) : null}
                                  </button>
                                ) : (
                                  <div className="space-y-1 rounded-md border border-sky-500/25 bg-sky-950/35 px-2 py-1.5">
                                    <div className="text-sky-200 tabular-nums leading-tight font-medium">
                                      {o.revenueWon.toLocaleString()}원
                                    </div>
                                  </div>
                                )
                              ) : (
                                <span className="text-emerald-300/95">
                                  {o.revenueWon.toLocaleString()}원
                                </span>
                              )
                            ) : (
                              <span className="text-amber-400/90">미인식</span>
                            )
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 align-top">
                          <div className="flex flex-col items-start gap-1.5">
                            {(o.status || 'pending') === 'cancelled' ? (
                              <div className="inline-flex items-center gap-1.5 text-slate-400 text-xs" title="취소된 주문">
                                <span
                                  className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${STATUS_DOT_CLASS.cancelled}`}
                                >
                                  ○
                                </span>
                                <span className="text-slate-400">취소됨</span>
                              </div>
                            ) : (
                              <>
                                <div className="inline-flex items-center">
                                  <span
                                    className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium shrink-0 ${STATUS_DOT_CLASS[o.status || 'pending'] || STATUS_DOT_CLASS.pending}`}
                                    title={o.statusLabel}
                                  >
                                    {o.statusLabel === '완료' ? '✓' : o.statusLabel === '제작 중' ? '◐' : '○'}
                                  </span>
                                  <span
                                    className={`ml-1.5 text-xs ${STATUS_LABEL_TEXT_CLASS[o.status || 'pending'] || 'text-slate-300'}`}
                                  >
                                    {o.statusLabel}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openOrderDetail(o, 'status')}
                                  className="inline-flex items-center justify-center px-2 py-1 rounded-md border border-slate-500/80 hover:bg-slate-600 text-slate-200 text-[10px] font-semibold"
                                  title="주문 상태 변경"
                                >
                                  상태
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                        <td
                          className="py-2.5 px-2 text-slate-500 align-top leading-snug"
                          title={o.completedAt ? formatDateTime(o.completedAt) : ''}
                        >
                          {o.completedAt ? (
                            (() => {
                              const { dateLine, timeLine } = formatOrderDateTwoLines(o.completedAt);
                              return (
                                <>
                                  <span className="block text-slate-400 text-[11px]">{dateLine}</span>
                                  <span className="block text-slate-500 text-[10px] tabular-nums mt-0.5">{timeLine}</span>
                                </>
                              );
                            })()
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 align-top">
                          <div className="inline-flex flex-row flex-wrap items-center gap-1">
                            {o.fileUrl ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!o.fileUrl) return;
                                  try {
                                    await navigator.clipboard.writeText(o.fileUrl);
                                    setCopiedLinkOrderId(o.id);
                                    setTimeout(() => setCopiedLinkOrderId(null), 1500);
                                  } catch {
                                    setMessage({ type: 'error', text: '클립보드 복사에 실패했습니다.' });
                                  }
                                }}
                                className="inline-flex items-center justify-center gap-0.5 px-2 py-1 rounded-md bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50 text-[10px] font-semibold cursor-pointer border border-emerald-800/50"
                                title="공유 링크 복사"
                              >
                                {copiedLinkOrderId === o.id ? '복사됨' : '링크'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openOrderDetail(o, 'dropbox')}
                                className="inline-flex items-center justify-center px-2 py-1 rounded-md bg-slate-600 hover:bg-slate-500 text-slate-100 text-[10px] font-semibold"
                                title="드롭박스 공유 링크 등록·수정"
                              >
                                링크
                              </button>
                            )}
                            {o.fileUrl ? (
                              <a
                                href={o.fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center px-2 py-1 rounded-md border border-cyan-600/50 bg-cyan-950/30 hover:bg-cyan-900/40 text-cyan-200 text-[10px] font-semibold"
                                title="드롭박스에서 폴더 열기"
                              >
                                폴더
                              </a>
                            ) : o.dropboxFolderCreated ? (
                              <span
                                className="inline-flex items-center justify-center px-2 py-1 text-slate-500 text-[10px] font-medium border border-slate-600/50 rounded-md"
                                title="폴더 생성됨 · 링크 등록 후 폴더 열기"
                              >
                                폴더✓
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleCreateOrderFolder(o.id)}
                                disabled={!!createOrderFolderId}
                                className="inline-flex items-center justify-center px-2 py-1 rounded-md border border-slate-500 hover:bg-slate-600 text-slate-200 text-[10px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Dropbox 폴더 생성"
                              >
                                {createOrderFolderId === o.id ? '…' : '생성'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            )}
          </div>
            </>
          )}

          {/* ━━ 기출문제 섹션 ━━ */}
          {section === 'exams' && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden mb-8">
              <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="font-bold text-lg text-white">기출문제 업로드 목록</h2>
                  <p className="text-slate-400 text-sm mt-0.5">회원들이 올린 기출문제를 확인할 수 있습니다. 카톡으로 받은 사진 등은 「사용자 대신 기출 등록」으로 올릴 수 있습니다.</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setAdminCreateExamOpen(true)} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium">
                    사용자 대신 기출 등록
                  </button>
                  <button type="button" onClick={fetchExamUploads} className="px-3 py-1.5 border border-slate-600 rounded-lg text-xs text-slate-400 hover:text-white hover:border-slate-500">
                    새로고침
                  </button>
                </div>
              </div>
              {examUploadsLoading ? (
                <div className="py-12 text-center text-slate-500">불러오는 중…</div>
              ) : examUploads.length === 0 ? (
                <div className="py-16 text-center text-slate-500">업로드된 기출문제가 없습니다.</div>
              ) : (
                <>
                  {/* 유형별 필터 */}
                  <div className="px-5 py-3 border-b border-slate-700 flex flex-wrap items-center gap-3">
                    <span className="text-slate-400 text-sm">유형 필터:</span>
                    <div className="flex rounded-lg overflow-hidden bg-slate-700">
                      <button
                        type="button"
                        onClick={() => setExamTypeFilter('all')}
                        className={`px-3 py-2 text-sm font-medium ${examTypeFilter === 'all' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}
                      >
                        전체
                      </button>
                      <button
                        type="button"
                        onClick={() => setExamTypeFilter('unclassified')}
                        className={`px-3 py-2 text-sm font-medium ${examTypeFilter === 'unclassified' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}
                      >
                        미분류
                      </button>
                    </div>
                    <select
                      value={examTypeFilter}
                      onChange={(e) => setExamTypeFilter(e.target.value)}
                      className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:ring-2 focus:ring-slate-500 min-w-[200px]"
                    >
                      <option value="all">전체</option>
                      <option value="unclassified">미분류만</option>
                      <optgroup label="—— 유형별 보기 ——">
                        {essayCategoriesForSelect.map(({ value }) => (
                          <option key={value} value={value}>{value.length > 35 ? value.slice(0, 35) + '…' : value}</option>
                        ))}
                      </optgroup>
                    </select>
                    <span className="text-slate-500 text-xs">
                      {examTypeFilter === 'all' && `${examUploads.length}건`}
                      {examTypeFilter === 'unclassified' && `${examUploads.filter((e) => !e.adminCategories?.length).length}건`}
                      {examTypeFilter !== 'all' && examTypeFilter !== 'unclassified' && `${examUploads.filter((e) => e.adminCategories?.includes(examTypeFilter)).length}건`}
                    </span>
                  </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700 text-slate-400">
                        <th className="text-left py-3 px-5">회원</th>
                        <th className="text-left py-3 px-5">학교 / 학년</th>
                        <th className="text-left py-3 px-5">시험</th>
                        <th className="text-left py-3 px-5">시험범위</th>
                        <th className="text-left py-3 px-5">파일</th>
                        <th className="text-left py-3 px-5">문제 유형</th>
                        <th className="text-left py-3 px-5">등록일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(examTypeFilter === 'all'
                        ? examUploads
                        : examTypeFilter === 'unclassified'
                          ? examUploads.filter((e) => !e.adminCategories?.length)
                          : examUploads.filter((e) => e.adminCategories?.includes(examTypeFilter))
                      ).map((ex) => (
                        <tr key={ex.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                          <td className="py-3 px-5 text-cyan-400 font-medium">{ex.loginId}</td>
                          <td className="py-3 px-5 text-slate-300">{ex.school} · {ex.grade}</td>
                          <td className="py-3 px-5 text-slate-300">{ex.examYear}년 {ex.examType}</td>
                          <td className="py-3 px-5 text-slate-400 max-w-[200px] truncate" title={ex.examScope}>{ex.examScope || '—'}</td>
                          <td className="py-3 px-5">
                            <div className="space-y-1">
                              {ex.files.length === 0 ? (
                                <span className="text-slate-500">—</span>
                              ) : (
                                ex.files.map((f, fi) => {
                                  const ext = f.originalName.toLowerCase().split('.').pop() || '';
                                  const previewable = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
                                  const previewType = ext === 'pdf' ? 'pdf' : 'image';
                                  return (
                                    <div key={fi} className="flex items-center gap-1.5 text-xs">
                                      <a
                                        href={`/api/my/past-exam-upload/download?id=${ex.id}&fileIndex=${f.fileIndex}`}
                                        download
                                        className="text-blue-400 hover:underline truncate max-w-[120px]"
                                        title={f.originalName}
                                      >
                                        {f.originalName}
                                      </a>
                                      {previewable && (
                                        <button
                                          type="button"
                                          onClick={() => setExamPreview({
                                            url: `/api/my/past-exam-upload/download?id=${ex.id}&fileIndex=${f.fileIndex}&inline=1`,
                                            name: f.originalName,
                                            type: previewType as 'pdf' | 'image',
                                          })}
                                          className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-600 text-slate-300 hover:bg-slate-500"
                                        >
                                          미리보기
                                        </button>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                              <button
                                type="button"
                                onClick={() => { setExamUploadForAddFiles(ex); setAddFilesList(null); }}
                                className="text-[10px] text-cyan-400 hover:underline"
                              >
                                + 파일 추가
                              </button>
                            </div>
                          </td>
                          <td className="py-3 px-5">
                            <div className="flex flex-col gap-1">
                              {ex.adminCategories && ex.adminCategories.length > 0 ? (
                                <span className="text-xs text-emerald-400" title={ex.adminCategories.join(', ')}>
                                  {ex.adminCategories.length}개 유형
                                </span>
                              ) : (
                                <span className="text-xs text-slate-500">미분류</span>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setExamUploadForClassify(ex);
                                  setSelectedCategoriesForClassify(ex.adminCategories || []);
                                }}
                                className="text-xs text-cyan-400 hover:underline text-left"
                              >
                                유형 분류
                              </button>
                            </div>
                          </td>
                          <td className="py-3 px-5 text-slate-500 text-xs whitespace-nowrap">{formatDateTime(ex.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </div>
          )}

          {/* ━━ 지문 업로드 ━━ */}
          {section === 'passageUpload' && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden mb-8">
              <div className="px-5 py-4 border-b border-slate-700">
                <h2 className="font-bold text-lg text-white">지문 업로드</h2>
                <p className="text-slate-400 text-sm mt-0.5">
                  교재 엑셀(.xlsx)을 올리거나, <strong className="text-slate-300">원문 관리(MongoDB passages)</strong>에 이미 저장된 교재를 불러와 지문 데이터(converted_data.json)에 반영할 수 있습니다. 부교재·분석지·서술형 등에서 선택 가능한 교재로 바로 사용할 수 있습니다.
                </p>
              </div>
              <div className="p-5 space-y-6">
                {passageUploadMessage && (
                  <div className={`p-3 rounded-lg text-sm ${passageUploadMessage.type === 'success' ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/50' : 'bg-red-500/20 text-red-200 border border-red-500/50'}`}>
                    {passageUploadMessage.text}
                  </div>
                )}
                <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-4 space-y-3">
                  <h3 className="font-semibold text-emerald-200 text-sm">원문 DB에서 불러오기</h3>
                  <p className="text-slate-400 text-xs leading-relaxed">
                    <strong className="text-slate-300">원문 관리</strong>에 등록된 교재·강(chapter)·번호(number)를 그대로 엑셀 변환과 동일한 JSON 구조(Sheet1 → 부교재)로 합칩니다. 해당 교재 키가 이미 있으면 <strong className="text-slate-300">덮어씁니다</strong>.
                    <span className="block mt-1.5 text-slate-500">배포(Vercel 등) 환경에서는 병합 결과가 MongoDB(<code className="text-slate-400">converted_textbook_json</code>)에 저장되며, <code className="text-slate-400">/api/textbooks</code>가 여기를 우선 사용합니다.</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      value={passageUploadDbTextbook}
                      onChange={(e) => setPassageUploadDbTextbook(e.target.value)}
                      className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white min-w-[240px]"
                    >
                      <option value="">교재 선택…</option>
                      {passageUploadDbTextbooks.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handlePassageUploadFromDb}
                      disabled={!passageUploadDbTextbook || passageUploadFromDbSaving}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {passageUploadFromDbSaving ? '반영 중…' : 'converted_data.json에 반영'}
                    </button>
                  </div>
                  <p className="text-slate-500 text-[11px]">교재 목록은 passages 컬렉션의 distinct textbook입니다. 비어 있으면 원문 관리에서 먼저 원문을 등록하세요.</p>
                </div>

                <div className="border-t border-slate-700 pt-4">
                  <h3 className="font-semibold text-slate-300 text-sm mb-2">엑셀 업로드</h3>
                  <p className="text-slate-400 text-xs mb-3">엑셀 형식: 교재명 · 강/회차 · 번호 열이 있어야 합니다. 파일명이 교재 키로 사용됩니다.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => setPassageUploadFile(e.target.files?.[0] ?? null)}
                    className="text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-slate-600 file:text-white file:text-sm file:font-medium"
                  />
                  <button
                    type="button"
                    onClick={handlePassageUpload}
                    disabled={!passageUploadFile || passageUploadSaving}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {passageUploadSaving ? '변환 중…' : '업로드 및 변환'}
                  </button>
                </div>
                {passageUploadFile && <p className="text-slate-500 text-xs">선택됨: {passageUploadFile.name}</p>}
              </div>
            </div>
          )}

          {/* ━━ 설정 (교재 노출) ━━ */}
          {section === 'settings' && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden mb-8">
              <div className="px-5 py-4 border-b border-slate-700">
                <h2 className="font-bold text-lg text-white">교재 노출 설정</h2>
                <p className="text-slate-400 text-sm mt-0.5">메뉴별로 누가 어떤 교재를 볼 수 있는지 설정합니다.</p>
              </div>
              <div className="p-5 space-y-6">
                <div className="border border-slate-600 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="font-semibold text-white">부교재 주문제작 · 기본 노출 교재</p>
                      <p className="text-slate-400 text-sm mt-1">비회원 포함 모든 이용자가 부교재 주문 시 선택할 수 있는 교재입니다. 미설정 시 전체 교재가 노출됩니다.</p>
                      <p className="text-slate-500 text-xs mt-1">현재 {defaultTextbooks.length}개 설정됨</p>
                    </div>
                    <button
                      type="button"
                      onClick={openDefaultTextbooksModal}
                      className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-semibold hover:bg-cyan-500"
                    >
                      교재 선택하기
                    </button>
                  </div>
                </div>

                <div className="border border-violet-700/50 rounded-xl p-4 bg-violet-950/20">
                  <div className="flex flex-col gap-4">
                    <div>
                      <p className="font-semibold text-white">변형문제 쏠북 교재</p>
                      <p className="text-slate-400 text-sm mt-1">
                        부교재 변형 주문(/textbook)에서 「쏠북」 섹션에만 노출됩니다. 변형 제작·쏠북 커스텀 요금만 고미조슈아 입금 대상이며, 교재 본체는 쏠북에서 별도 구매입니다. 아래「교재 본체 안내 문구」는 주문 화면·주문서에 표시됩니다.
                      </p>
                      <div className="mt-2 p-2.5 bg-slate-800/60 border border-slate-600 rounded-lg">
                        <p className="text-slate-400 text-xs mb-1.5 font-medium">
                          자동 집계 — 원문 관리에서 출판사(YBM·쎄듀·NE능률)가 설정된 교재
                        </p>
                        {variantSolbookKeys.length === 0 ? (
                          <p className="text-slate-500 text-xs italic">지정된 교재 없음 (원문 관리 → 출판사 설정)</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {variantSolbookKeys.map((k) => (
                              <span key={k} className="inline-block px-2 py-0.5 rounded-full bg-violet-900/60 text-violet-300 text-xs border border-violet-700/50">
                                {k}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="text-slate-500 text-[11px] mt-1.5">
                        교재 추가·제거는 <a href="/admin/passages" className="text-violet-400 underline">원문 관리</a>에서 각 지문의 출판사를 설정하면 자동 반영됩니다.
                      </p>
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs font-medium mb-1">쏠북 구매 안내 URL (선택)</label>
                      <input
                        type="url"
                        value={variantSolbookPurchaseUrl}
                        onChange={(e) => setVariantSolbookPurchaseUrl(e.target.value)}
                        placeholder="https://…"
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm outline-none focus:border-violet-500"
                      />
                      <p className="text-slate-500 text-[11px] mt-1">비우면 주문서에는 별도 안내 문구로 표시됩니다.</p>
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs font-medium mb-1">
                        교재 본체 예상 금액·판매 안내 (선택, 자유 입력)
                      </label>
                      <textarea
                        value={variantSolbookRetailGuideText}
                        onChange={(e) => setVariantSolbookRetailGuideText(e.target.value)}
                        placeholder="예: 인쇄본 기준 약 18,000~22,000원대 · 전자본은 쏠북 정책에 따름"
                        rows={3}
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm outline-none focus:border-violet-500 resize-y min-h-[4.5rem]"
                      />
                      <p className="text-slate-500 text-[11px] mt-1">
                        부교재 변형·파이널 예비 모의고사 화면에 표시됩니다. 입금 대상이 아님을 분명히 하기 위한 쏠북 측 가격 안내용입니다.
                      </p>
                    </div>
                    <div className="max-w-xs">
                      <label className="block text-slate-400 text-xs font-medium mb-1">쏠북 추가 요금 (원)</label>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={variantSolbookExtraFeeWon}
                        onChange={(e) => {
                          const n = Math.round(Number(e.target.value));
                          setVariantSolbookExtraFeeWon(
                            Number.isFinite(n) && n >= 0 ? n : DEFAULT_VARIANT_SOLBOOK_EXTRA_FEE_WON
                          );
                        }}
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm outline-none focus:border-violet-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={saveVariantSolbookSettings}
                      disabled={variantSolbookSaving}
                      className="self-start px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-500 disabled:opacity-50"
                    >
                      {variantSolbookSaving ? '저장 중…' : '설정 저장'}
                    </button>
                  </div>
                </div>

                <div className="border border-slate-600 rounded-xl p-4 bg-slate-700/30">
                  <p className="font-semibold text-slate-300">분석지 · 서술형</p>
                  <p className="text-slate-500 text-sm mt-1">회원별로 허용된 교재는 회원 관리에서 각 회원의 「교재 선택하기」로 설정합니다. 관리자가 허용한 메뉴와 교재만 해당 회원에게 노출됩니다.</p>
                </div>

                <div className="border border-slate-600 rounded-xl p-4">
                  <div className="mb-4">
                    <p className="font-semibold text-white">연회원 무료공유자료</p>
                    <p className="text-slate-400 text-sm mt-1">
                      .hwp, .hwpx, .pdf만 업로드 가능(최대 15MB). 유효 연회원은 내정보 → 무료공유자료에서 다운로드합니다.
                    </p>
                  </div>
                  <form onSubmit={handleAnnualSharedUpload} className="space-y-3 mb-6 pb-6 border-b border-slate-600">
                    <div>
                      <label className="block text-slate-400 text-xs font-medium mb-1">제목</label>
                      <input
                        type="text"
                        value={annualSharedTitle}
                        onChange={(e) => setAnnualSharedTitle(e.target.value)}
                        placeholder="자료 제목"
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs font-medium mb-1">설명(선택)</label>
                      <textarea
                        value={annualSharedDescription}
                        onChange={(e) => setAnnualSharedDescription(e.target.value)}
                        rows={2}
                        placeholder="회원에게 보이는 짧은 안내"
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm outline-none focus:border-cyan-500 resize-y min-h-[60px]"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs font-medium mb-1">파일</label>
                      <input
                        type="file"
                        accept=".hwp,.hwpx,.pdf,application/pdf,application/x-hwp"
                        onChange={(e) => setAnnualSharedFile(e.target.files?.[0] ?? null)}
                        className="block w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-slate-600 file:text-white"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={annualSharedUploading}
                      className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-semibold hover:bg-cyan-500 disabled:opacity-50"
                    >
                      {annualSharedUploading ? '업로드 중…' : '업로드'}
                    </button>
                  </form>
                  {annualSharedMessage && (
                    <p
                      className={`text-sm mb-4 ${annualSharedMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {annualSharedMessage.text}
                    </p>
                  )}
                  {annualSharedLoading ? (
                    <p className="text-slate-500 text-sm py-4">목록 불러오는 중…</p>
                  ) : annualSharedItems.length === 0 ? (
                    <p className="text-slate-500 text-sm py-2">등록된 자료가 없습니다.</p>
                  ) : (
                    <ul className="space-y-2">
                      {annualSharedItems.map((row) => (
                        <li
                          key={row.id}
                          className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 px-3 rounded-lg bg-slate-700/40 border border-slate-600/80"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-medium text-sm">{row.title}</p>
                            {row.description ? (
                              <p className="text-slate-400 text-xs mt-0.5 whitespace-pre-wrap">{row.description}</p>
                            ) : null}
                            <p className="text-slate-500 text-xs mt-1 truncate">
                              {row.originalName} · {formatAdminFileSize(row.size)}
                              {row.uploadedAt ? ` · ${new Date(row.uploadedAt).toLocaleString('ko-KR')}` : ''}
                              {row.uploadedByLoginId ? ` · ${row.uploadedByLoginId}` : ''}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAnnualSharedDelete(row.id)}
                            disabled={annualSharedDeletingId === row.id}
                            className="px-3 py-1.5 rounded-lg border border-red-500/50 text-red-400 text-xs font-medium hover:bg-red-500/10 disabled:opacity-50 shrink-0 self-start sm:self-center"
                          >
                            {annualSharedDeletingId === row.id ? '삭제 중…' : '삭제'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ━━ 서술형 유형 관리 ━━ */}
          {section === 'essayTypes' && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden mb-8">
              <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="font-bold text-lg text-white">서술형 유형 관리</h2>
                  <p className="text-slate-400 text-sm mt-0.5">유형별 문제 설명, 태그, 조건을 세분화하고 기출 분류·서술형 주문에 반영됩니다.</p>
                </div>
                <button
                  type="button"
                  onClick={() => openEssayTypeAdd()}
                  className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-semibold hover:bg-cyan-500"
                >
                  + 유형 추가
                </button>
              </div>
              <div className="p-5">
                {essayTypesLoading ? (
                  <div className="py-12 text-center text-slate-500">불러오는 중…</div>
                ) : essayTypes.length === 0 ? (
                  <div className="py-12 text-center text-slate-500">등록된 유형이 없습니다. 유형 추가 후 공개 API에서 자동 시드되거나 여기서 추가해 주세요.</div>
                ) : (
                  <div className="space-y-6">
                    {(() => {
                      const by대분류 = essayTypes.reduce<Record<string, EssayTypeItem[]>>((acc, t) => {
                        const key = t.대분류 || '(미분류)';
                        if (!acc[key]) acc[key] = [];
                        acc[key].push(t);
                        return acc;
                      }, {});
                      return Object.entries(by대분류).map(([대, items]) => {
                        const firstPrice = items[0]?.price ?? '';
                        const priceDisplay = categoryPriceDraft[대] !== undefined ? categoryPriceDraft[대] : String(firstPrice);
                        return (
                        <div key={대} className="border border-slate-600 rounded-xl overflow-hidden">
                          <div className="px-4 py-2 bg-slate-700/50 border-b border-slate-600 flex flex-wrap items-center gap-3">
                            <span className="font-semibold text-white">{대}</span>
                            <span className="text-slate-400 text-xs">지문당 가격</span>
                            <input
                              type="number"
                              min={0}
                              value={priceDisplay}
                              onChange={(e) => setCategoryPriceDraft((prev) => ({ ...prev, [대]: e.target.value }))}
                              className="w-24 px-2 py-1 bg-slate-600 border border-slate-500 rounded text-white text-sm"
                            />
                            <span className="text-slate-500 text-xs">원</span>
                            <button
                              type="button"
                              onClick={() => saveCategoryPrice(대, priceDisplay)}
                              disabled={categoryPriceSaving === 대}
                              className="px-2.5 py-1 bg-cyan-600 text-white rounded text-xs font-medium hover:bg-cyan-500 disabled:opacity-50"
                            >
                              {categoryPriceSaving === 대 ? '적용 중…' : '적용'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEssayCategoryEdit(대)}
                              title="대분류 이름 수정"
                              className="px-2.5 py-1 rounded text-xs font-medium border border-slate-500 text-slate-300 hover:bg-slate-600"
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              onClick={() => openEssayTypeAdd(대)}
                              title="이 대분류에 소분류 추가"
                              className="px-2.5 py-1 rounded text-xs font-medium border border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
                            >
                              + 소분류
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteEssayCategory(대)}
                              disabled={essayCategoryDeleting === 대}
                              title="대분류 전체 삭제"
                              className="ml-auto px-2.5 py-1 rounded text-xs font-medium border border-red-500/50 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                            >
                              {essayCategoryDeleting === 대 ? '삭제 중…' : '대분류 삭제'}
                            </button>
                          </div>
                          <div className="divide-y divide-slate-700">
                            {items.map((t) => (
                              <div key={t.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {t.typeCode && <span className="text-cyan-400 font-mono text-xs">{t.typeCode}</span>}
                                    <span className="text-slate-200 font-medium">{t.소분류}</span>
                                    {t.exampleFile ? (
                                      <span className="text-emerald-400 text-xs" title={`예시: ${t.exampleFile.originalName}`}>📎 예시 저장됨</span>
                                    ) : (
                                      <span className="text-slate-500 text-xs">예시 없음</span>
                                    )}
                                  </div>
                                  {t.문제 && <p className="text-slate-400 text-xs mt-1 line-clamp-2">{t.문제}</p>}
                                  {t.태그?.length ? (
                                    <p className="text-slate-500 text-xs mt-1 flex flex-wrap gap-1">
                                      {t.태그.map((tag) => (
                                        <span key={tag} className="bg-slate-700 px-1.5 py-0.5 rounded">#{tag}</span>
                                      ))}
                                    </p>
                                  ) : null}
                                  {t.조건 && <p className="text-slate-500 text-xs mt-1 line-clamp-1">&lt;조건&gt; {t.조건}</p>}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 shrink-0">
                                  <label className="flex items-center gap-1.5 cursor-pointer" title="모든 서술형 선생님에게 표시">
                                    <input
                                      type="checkbox"
                                      checked={t.common === true}
                                      onChange={() => setEssayTypeCommon(t.id, t.common !== true)}
                                      disabled={essayTypeTogglingId === t.id}
                                      className="rounded border-slate-500 bg-slate-700 text-amber-500 focus:ring-amber-500"
                                    />
                                    <span className="text-slate-400 text-xs whitespace-nowrap">공통유형</span>
                                  </label>
                                  <label className="flex items-center gap-1.5 cursor-pointer" title="선생님 주문서(서술형)에 이 유형 표시">
                                    <input
                                      type="checkbox"
                                      checked={t.enabled !== false}
                                      onChange={() => setEssayTypeEnabled(t.id, t.enabled === false)}
                                      disabled={essayTypeTogglingId === t.id}
                                      className="rounded border-slate-500 bg-slate-700 text-cyan-500 focus:ring-cyan-500"
                                    />
                                    <span className="text-slate-400 text-xs whitespace-nowrap">주문서 노출</span>
                                  </label>
                                  <button type="button" onClick={() => openEssayTypeEdit(t)} className="px-3 py-1.5 rounded-lg border border-slate-500 text-slate-300 text-xs font-medium hover:bg-slate-700">수정</button>
                                  <button type="button" onClick={() => deleteEssayType(t.id)} disabled={essayTypeDeletingId === t.id} className="px-3 py-1.5 rounded-lg border border-red-500/50 text-red-400 text-xs font-medium hover:bg-red-500/10 disabled:opacity-50">삭제</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );});
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Members section: reference MemberPanel style */}
          <div className="mb-8">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
              <h2 className="text-lg font-bold text-white tracking-tight">회원 관리</h2>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">🔍</span>
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="이름·아이디·이메일·전화번호"
                    className="pl-9 pr-3 py-2 w-48 bg-[#1a1d27] border border-[#2e3248] rounded-lg text-slate-200 text-sm outline-none focus:border-cyan-500"
                  />
                </div>
                <label className="flex items-center gap-2 text-slate-400 text-xs shrink-0">
                  <span className="hidden sm:inline">구분</span>
                  <select
                    value={memberSegmentFilter}
                    onChange={(e) => setMemberSegmentFilter(e.target.value as MemberSegmentFilter)}
                    className="py-2 px-3 bg-[#1a1d27] border border-[#2e3248] rounded-lg text-slate-200 text-sm outline-none focus:border-cyan-500 min-w-[10.5rem]"
                  >
                    <option value="all">전체 회원</option>
                    <option value="annual_active">유효 연회원</option>
                    <option value="monthly_active">유효 월구독</option>
                    <option value="signup_trial">7일 프리미엄 체험 중</option>
                    <option value="vip">VIP</option>
                    <option value="dropbox_yes">드롭박스 연결</option>
                    <option value="dropbox_no">드롭박스 미설정</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-slate-400 text-xs shrink-0">
                  <span className="hidden sm:inline">정렬</span>
                  <select
                    value={memberSortOrder}
                    onChange={(e) => setMemberSortOrder(e.target.value as MemberSortOrder)}
                    className="py-2 px-3 bg-[#1a1d27] border border-[#2e3248] rounded-lg text-slate-200 text-sm outline-none focus:border-cyan-500 min-w-[9rem]"
                  >
                    <option value="default">아이디순</option>
                    <option value="orders_desc">완료 주문 건수순</option>
                    <option value="revenue_desc">완료 주문 금액순</option>
                  </select>
                </label>
                <button type="button" onClick={() => document.getElementById('quick-create')?.scrollIntoView({ behavior: 'smooth' })} className="px-4 py-2 bg-[#00A9E0] text-white border-0 rounded-lg text-sm font-semibold hover:opacity-90">
                  ＋ 계정 추가
                </button>
                <button type="button" onClick={downloadMembersCsv} className="px-4 py-2 border border-slate-500 text-slate-300 rounded-lg text-sm font-semibold hover:bg-slate-700/50">
                  CSV 다운로드
                </button>
              </div>
            </div>

            <div id="quick-create" className="bg-slate-800 rounded-xl border border-slate-700 p-5 mb-5">
              <h2 className="font-bold text-lg text-white mb-4">빠른 계정 생성</h2>
              <p className="text-slate-400 text-sm mb-4">초기 비밀번호는 <strong className="text-slate-300">123456</strong>으로 통일됩니다.</p>
              <div className="mb-4 rounded-lg border border-teal-600/40 bg-teal-950/40 px-3 py-2.5 text-[13px] leading-relaxed text-teal-100/95">
                <strong className="text-teal-200">생성 직후 7일간</strong> 월구독·연회원과 동일한 프리미엄 기능(변형문제 만들기, 단어장, 무료공유자료 등)을 무료로 쓸 수 있습니다. 회원 카드에는{' '}
                <span className="rounded bg-teal-900/80 px-1.5 py-0.5 font-semibold text-teal-200">7일 무료 체험 중</span>으로 표시됩니다.
              </div>
              <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
                <div>
                  <label className="block text-slate-400 text-xs mb-1">아이디 *</label>
                  <input
                    type="text"
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value)}
                    placeholder="예: student01"
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm"
                    required
                    minLength={2}
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-xs mb-1">이름</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="이름"
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-xs mb-1">이메일</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="이메일"
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-xs mb-1">전화번호</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="01012345678 (폴더명에 사용)"
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-xs mb-1">드롭박스 폴더 경로</label>
                  <input
                    type="text"
                    value={dropboxFolderPath}
                    onChange={(e) => setDropboxFolderPath(e.target.value)}
                    placeholder="/gomijoshua/이름_전화번호"
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm font-mono"
                  />
                </div>
                <div>
                  {message && <p className={`text-sm mb-2 ${message.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</p>}
                  <button
                    type="submit"
                    disabled={submitLoading}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {submitLoading ? '생성 중…' : '계정 생성'}
                  </button>
                </div>
              </form>
            </div>

            {!usersLoading && stats && !stats.dropboxConfigured && (
              <div className="mb-4 p-3 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-200 text-sm">
                <strong>Dropbox 미설정.</strong> 회원별 폴더를 쓰려면 <code className="bg-slate-700 px-1 rounded">.env</code>에 DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN을 설정한 뒤 서버를 재시작하세요.
              </div>
            )}
            {!usersLoading && users.length > 0 && (
              <div className="space-y-2.5 mb-5">
                <div className="flex gap-2.5 flex-wrap items-center">
                  {[
                    { id: 'all' as const, short: '전체', count: users.length, color: 'bg-[#00A9E0]' },
                    { id: 'annual_active' as const, short: '연회원(유효)', count: users.filter((u) => listUserAnnualActive(u)).length, color: 'bg-violet-500' },
                    { id: 'monthly_active' as const, short: '월구독(유효)', count: users.filter((u) => listUserMonthlyActive(u)).length, color: 'bg-fuchsia-500' },
                    {
                      id: 'signup_trial' as const,
                      short: '7일 체험',
                      count: users.filter((u) => listUserSignupPremiumTrialActive(u)).length,
                      color: 'bg-teal-500',
                    },
                    { id: 'vip' as const, short: 'VIP', count: users.filter((u) => u.isVip).length, color: 'bg-amber-500' },
                    { id: 'dropbox_yes' as const, short: '드롭박스 연결', count: users.filter((u) => u.dropboxFolderPath?.trim()).length, color: 'bg-[#22c55e]' },
                    { id: 'dropbox_no' as const, short: '미설정', count: users.filter((u) => !u.dropboxFolderPath?.trim()).length, color: 'bg-[#f59e0b]' },
                  ].map(({ id, short, count, color }) => {
                    const active = memberSegmentFilter === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setMemberSegmentFilter(id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                          active
                            ? 'border-cyan-500/55 bg-cyan-500/12 text-slate-100 ring-1 ring-cyan-500/35'
                            : 'border-[#2e3248] bg-[#1a1d27] text-slate-400 hover:border-slate-600 hover:text-slate-300'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />
                        {short} {count}명
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2 flex-wrap items-center">
                  <span className="text-slate-500 text-[11px] font-medium shrink-0">정렬</span>
                  {(
                    [
                      { id: 'default' as const, label: '아이디순' },
                      { id: 'orders_desc' as const, label: '완료 건수순' },
                      { id: 'revenue_desc' as const, label: '완료 금액순' },
                    ] as const
                  ).map(({ id, label }) => {
                    const active = memberSortOrder === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setMemberSortOrder(id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                          active
                            ? 'border-amber-500/50 bg-amber-500/10 text-amber-100 ring-1 ring-amber-500/30'
                            : 'border-[#2e3248] bg-[#1a1d27] text-slate-400 hover:border-slate-600 hover:text-slate-300'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${id === 'default' ? 'bg-slate-400' : id === 'orders_desc' ? 'bg-cyan-400' : 'bg-emerald-400'}`}
                        />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {usersLoading ? (
              <div className="py-12 text-center text-slate-500">불러오는 중…</div>
            ) : (() => {
              const qRaw = memberSearch.trim().toLowerCase();
              const qDigits = qRaw.replace(/\D/g, '');
              const bySearch = qRaw
                ? users.filter((u) => {
                    const login = (u.loginId || '').toLowerCase();
                    const name = (u.name || '').toLowerCase();
                    const email = (u.email || '').toLowerCase();
                    const phoneDigits = (u.phone || '').replace(/\D/g, '');
                    return (
                      login.includes(qRaw) ||
                      name.includes(qRaw) ||
                      email.includes(qRaw) ||
                      (qDigits.length > 0 && phoneDigits.includes(qDigits))
                    );
                  })
                : users;
              let filtered = bySearch;
              switch (memberSegmentFilter) {
                case 'annual_active':
                  filtered = bySearch.filter((u) => listUserAnnualActive(u));
                  break;
                case 'monthly_active':
                  filtered = bySearch.filter((u) => listUserMonthlyActive(u));
                  break;
                case 'signup_trial':
                  filtered = bySearch.filter((u) => listUserSignupPremiumTrialActive(u));
                  break;
                case 'vip':
                  filtered = bySearch.filter((u) => !!u.isVip);
                  break;
                case 'dropbox_yes':
                  filtered = bySearch.filter((u) => !!u.dropboxFolderPath?.trim());
                  break;
                case 'dropbox_no':
                  filtered = bySearch.filter((u) => !u.dropboxFolderPath?.trim());
                  break;
                default:
                  break;
              }
              const lidKey = (u: ListUser) => u.loginId || '';
              const displayMembers = [...filtered].sort((a, b) => {
                const la = lidKey(a);
                const lb = lidKey(b);
                if (memberSortOrder === 'orders_desc') {
                  const d = completedOrderCountFor(lb) - completedOrderCountFor(la);
                  return d !== 0 ? d : la.localeCompare(lb, 'ko');
                }
                if (memberSortOrder === 'revenue_desc') {
                  const d = completedOrderRevenueFor(lb) - completedOrderRevenueFor(la);
                  return d !== 0 ? d : la.localeCompare(lb, 'ko');
                }
                return la.localeCompare(lb, 'ko');
              });
              if (displayMembers.length === 0) {
                const noMatch =
                  qRaw || memberSegmentFilter !== 'all'
                    ? '검색어 또는 필터 조건에 맞는 회원이 없습니다.'
                    : '등록된 회원이 없습니다.';
                return <div className="py-16 text-center text-slate-500">{noMatch}</div>;
              }
              return (
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
                  {displayMembers.map((u, i) => {
                    const isUnset = !u.dropboxFolderPath?.trim();
                    const isEditingPath = editingPathId === u.id;
                    const pathVal = isEditingPath ? editingPathValue : (u.dropboxFolderPath ?? '');
                    return (
                      <div key={u.id} className={`rounded-2xl overflow-hidden border transition-colors ${isUnset ? 'border-amber-500/30 bg-[#1a1d27]' : 'border-[#2e3248] bg-[#1a1d27]'}`}>
                        <div className="p-4 flex items-start gap-3">
                          <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-base font-extrabold text-white shrink-0 bg-gradient-to-br ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
                            {(u.name || u.loginId).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-white text-[15px] tracking-tight truncate">{u.name || u.loginId}</p>
                            <p className="text-slate-400 text-xs truncate mt-0.5">{u.email || '—'}</p>
                            <p className="text-slate-500 text-xs mt-0.5">
                              <span className="text-slate-500">아이디</span> <span className="text-slate-300 font-mono">{u.loginId || '—'}</span>
                              {(u.phone != null && u.phone !== '') && (
                                <> · <span className="text-slate-500">전화</span> <span className="text-slate-300">{u.phone}</span></>
                              )}
                            </p>
                            <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
                              {listUserAnnualActive(u) && formatAnnualMemberValidity(u.annualMemberSince) ? (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-500/15 text-violet-300 border border-violet-500/30" title={formatAnnualMemberValidity(u.annualMemberSince)!.title}>{formatAnnualMemberValidity(u.annualMemberSince)!.label}</span>
                              ) : u.annualMemberSince && !listUserAnnualActive(u) ? (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#22263a] text-slate-500 border border-slate-600" title="연회원 기간 만료">연회원(만료)</span>
                              ) : null}
                              {listUserMonthlyActive(u) && formatMonthlyMemberValidity(u.monthlyMemberUntil) ? (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30" title={formatMonthlyMemberValidity(u.monthlyMemberUntil)!.title}>{formatMonthlyMemberValidity(u.monthlyMemberUntil)!.label}</span>
                              ) : u.monthlyMemberUntil && !listUserMonthlyActive(u) ? (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#22263a] text-slate-500 border border-slate-600" title="월구독 만료">월구독(만료)</span>
                              ) : null}
                              {listUserSignupPremiumTrialActive(u) ? (
                                <span
                                  className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold bg-teal-500/15 text-teal-200 border border-teal-500/35"
                                  title={
                                    u.signupPremiumTrialUntil
                                      ? `월·연 기능 무료 체험 · ${new Date(u.signupPremiumTrialUntil).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}까지`
                                      : '월·연 기능 무료 체험'
                                  }
                                >
                                  7일 무료 체험 중
                                </span>
                              ) : null}
                              {!listUserAnnualActive(u) && !listUserMonthlyActive(u) && !listUserSignupPremiumTrialActive(u) && !u.annualMemberSince && !u.monthlyMemberUntil ? (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#22263a] text-slate-500">일반</span>
                              ) : null}
                              {u.isVip && (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">VIP</span>
                              )}
                              <span
                                className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                                title="상태가 완료된 주문만 집계"
                              >
                                완료 {completedOrderCountFor(u.loginId)}건
                              </span>
                              <span
                                className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                                title="완료 주문 매출 합계(원)"
                              >
                                매출 {completedOrderRevenueFor(u.loginId).toLocaleString('ko-KR')}원
                              </span>
                              {lastOrderDateFor(u.loginId) && (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#22263a] text-slate-400" title={formatDateTime(lastOrderDateFor(u.loginId)!)}>최근 주문 {daysAgo(lastOrderDateFor(u.loginId)!)}</span>
                              )}
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400">{(u.points ?? 0).toLocaleString()} P</span>
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#22263a] text-slate-400" title={formatDate(u.createdAt)}>{daysAgo(u.createdAt)} 가입</span>
                            </div>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button type="button" onClick={() => openEdit(u)} title="수정" className="w-8 h-8 rounded-lg border border-[#2e3248] bg-transparent text-slate-400 flex items-center justify-center text-sm hover:border-slate-500 hover:text-white">✏️</button>
                            <button type="button" onClick={() => handleDelete(u.id)} disabled={deletingId === u.id} title="삭제" className="w-8 h-8 rounded-lg border border-[#2e3248] bg-transparent text-slate-400 flex items-center justify-center text-sm hover:border-red-400/50 hover:text-red-400 disabled:opacity-50">🗑️</button>
                          </div>
                        </div>
                        {/* Dropbox 섹션 */}
                        <div className={`mx-3 mb-3 rounded-xl overflow-hidden border ${isUnset ? 'border-amber-500/20 bg-[#22263a]' : 'border-[#2e3248] bg-[#22263a]'}`}>
                          <div className={`px-3 py-2 flex items-center gap-2 border-b ${isUnset ? 'border-amber-500/15' : 'border-[#2e3248]'}`}>
                            <span className="text-sm">📦</span>
                            <span className="text-[11px] font-semibold text-slate-400 flex-1">Dropbox 폴더</span>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${isUnset ? 'bg-amber-500/10 text-amber-400 border border-amber-500/25' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${isUnset ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                              {isUnset ? '미설정' : '연결됨'}
                            </span>
                          </div>
                          <div className="p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-slate-500 text-xs shrink-0">📁</span>
                              {isEditingPath ? (
                                <>
                                  <input
                                    type="text"
                                    value={editingPathValue}
                                    onChange={(e) => setEditingPathValue(e.target.value)}
                                    placeholder="예: /gomijoshua/이름_전화번호"
                                    className="flex-1 px-2 py-1.5 bg-[#1a1d27] border border-[#2e3248] rounded-lg text-slate-200 text-xs font-mono outline-none focus:border-cyan-500"
                                  />
                                  <button type="button" onClick={() => handlePathSave(u.id, editingPathValue)} disabled={pathSavingId === u.id} className="px-2.5 py-1.5 bg-[#00A9E0] text-white rounded-lg text-[11px] font-semibold shrink-0 disabled:opacity-70">
                                    {pathSavingId === u.id ? '저장 중…' : '저장'}
                                  </button>
                                  <button type="button" onClick={() => { setEditingPathId(null); setEditingPathValue(''); }} className="text-slate-500 text-xs shrink-0">취소</button>
                                </>
                              ) : (
                                <>
                                  <input
                                    type="text"
                                    readOnly
                                    value={pathVal || '—'}
                                    className="flex-1 px-2 py-1.5 bg-[#1a1d27] border border-[#2e3248] rounded-lg text-slate-400 text-xs font-mono truncate"
                                  />
                                  <button type="button" onClick={() => { setEditingPathId(u.id); setEditingPathValue(u.dropboxFolderPath ?? ''); }} className="px-2.5 py-1.5 border border-[#2e3248] text-slate-400 rounded-lg text-[11px] font-semibold shrink-0 hover:bg-slate-700/50">편집</button>
                                </>
                              )}
                            </div>
                            <div className="flex gap-1.5 flex-wrap">
                              {u.dropboxFolderPath?.trim() ? (
                                <>
                                  <a href={getDropboxFolderUrl(u.dropboxFolderPath)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#2e3248] text-slate-400 rounded-lg text-[11px] font-semibold hover:bg-slate-700/50 hover:text-slate-300">🔗 폴더 열기</a>
                                  <button type="button" onClick={() => handleCreateDropboxFolder(u)} disabled={createDropboxFolderId === u.id || !stats?.dropboxConfigured} className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#2e3248] text-slate-400 rounded-lg text-[11px] font-semibold hover:text-cyan-400 disabled:opacity-50">☁️ {createDropboxFolderId === u.id ? '생성 중…' : '다시 만들기'}</button>
                                  <button type="button" onClick={() => handleResetPath(u.id)} disabled={pathSavingId === u.id} className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#2e3248] text-slate-500 rounded-lg text-[11px] font-semibold hover:text-slate-400 disabled:opacity-50">✕ 경로 초기화</button>
                                </>
                              ) : (
                                <button type="button" onClick={() => handleCreateDropboxFolder(u)} disabled={createDropboxFolderId === u.id || !stats?.dropboxConfigured} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-lg text-[11px] font-semibold hover:bg-blue-500/20 disabled:opacity-50">☁️ {createDropboxFolderId === u.id ? '생성 중…' : '폴더 자동 생성'}</button>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* 워크북 부교재 노출 (회원별) */}
                        <div className="mx-3 mb-3 rounded-xl overflow-hidden border border-[#2e3248] bg-[#22263a]">
                          <div className="px-3 py-2 border-b border-[#2e3248] flex items-center gap-2">
                            <span className="text-sm">📘</span>
                            <span className="text-[11px] font-semibold text-slate-400 flex-1">워크북 부교재 노출</span>
                            {u.allowedTextbooksWorkbook !== undefined ? (
                              <span className="text-[10px] font-semibold text-cyan-400/90">전용 목록 사용 중</span>
                            ) : (
                              <span className="text-[10px] font-semibold text-slate-500">일반 허용과 동일</span>
                            )}
                          </div>
                          <div className="p-3 space-y-2">
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                              전 회원 공통 부교재는 코드{' '}
                              <code className="text-slate-400">lib/workbook-textbooks.ts</code>의{' '}
                              <code className="text-slate-400">WORKBOOK_SUPPLEMENTARY_COMMON_KEYS</code>에 넣습니다.
                              여기서는 그 외 <strong className="text-slate-400">이 회원만</strong> 볼 추가 교재를 고릅니다.
                              EBS·쏠북 교재는 전 회원 공개라 선택 목록에 없습니다.
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() => openTextbooksModal(u, 'workbook')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#2e3248] text-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-700/50"
                              >
                                부교재 선택
                                {u.allowedTextbooksWorkbook !== undefined
                                  ? ` (${u.allowedTextbooksWorkbook.length}개)`
                                  : u.allowedTextbooks && u.allowedTextbooks.length > 0
                                    ? ' (일반과 동일·미저장)'
                                    : ''}
                              </button>
                              {u.allowedTextbooksWorkbook !== undefined && (
                                <button
                                  type="button"
                                  onClick={() => clearWorkbookTextbooks(u)}
                                  disabled={textbooksSavingId === u.id}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-amber-500/30 text-amber-400/90 rounded-lg text-[11px] font-semibold hover:bg-amber-500/10 disabled:opacity-50"
                                >
                                  전용 해제
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* 변형문제 부교재 노출 (회원별) */}
                        <div className="mx-3 mb-3 rounded-xl overflow-hidden border border-[#2e3248] bg-[#22263a]">
                          <div className="px-3 py-2 border-b border-[#2e3248] flex items-center gap-2">
                            <span className="text-sm">📗</span>
                            <span className="text-[11px] font-semibold text-slate-400 flex-1">변형문제 부교재 노출</span>
                            {u.allowedTextbooksVariant !== undefined ? (
                              <span className="text-[10px] font-semibold text-emerald-400/90">전용 목록 사용 중</span>
                            ) : (
                              <span className="text-[10px] font-semibold text-slate-500">기본 노출과 동일</span>
                            )}
                          </div>
                          <div className="p-3 space-y-2">
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                              전 회원 공통 부교재는 코드{' '}
                              <code className="text-slate-400">lib/variant-textbooks.ts</code>의{' '}
                              <code className="text-slate-400">VARIANT_SUPPLEMENTARY_COMMON_KEYS</code>에 넣습니다.
                              여기서는 <strong className="text-slate-400">이 회원만</strong> 부교재 변형문제 주문(/textbook) 화면에서 볼 추가 교재를 고릅니다.
                              EBS·쏠북 교재는 전 회원 공개라 선택 목록에 없습니다.
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() => openTextbooksModal(u, 'variant')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#2e3248] text-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-700/50"
                              >
                                부교재 선택
                                {u.allowedTextbooksVariant !== undefined
                                  ? ` (${u.allowedTextbooksVariant.length}개)`
                                  : u.allowedTextbooks && u.allowedTextbooks.length > 0
                                    ? ' (미저장·저장 시 전용 적용)'
                                    : ''}
                              </button>
                              {u.allowedTextbooksVariant !== undefined && (
                                <button
                                  type="button"
                                  onClick={() => clearVariantTextbooks(u)}
                                  disabled={textbooksSavingId === u.id}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-emerald-500/30 text-emerald-400/90 rounded-lg text-[11px] font-semibold hover:bg-emerald-500/10 disabled:opacity-50"
                                >
                                  전용 해제
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* 메뉴 허용: 분석지·서술형 */}
                        <div className="mx-3 mb-3 rounded-xl overflow-hidden border border-[#2e3248] bg-[#22263a]">
                          <div className="px-3 py-2 border-b border-[#2e3248]">
                            <span className="text-sm">📋</span>
                            <span className="text-[11px] font-semibold text-slate-400 ml-2">메뉴 허용</span>
                          </div>
                          <div className="p-3 flex gap-4 flex-wrap">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!u.canAccessAnalysis}
                                disabled={menuSavingId === u.id}
                                onChange={(e) => handleToggleMenuAccess(u.id, 'canAccessAnalysis', e.target.checked)}
                                className="rounded border-slate-500 bg-slate-700 text-cyan-500 focus:ring-cyan-500"
                              />
                              <span className="text-xs text-slate-300">분석지 제작</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!u.canAccessEssay}
                                disabled={menuSavingId === u.id}
                                onChange={(e) => handleToggleMenuAccess(u.id, 'canAccessEssay', e.target.checked)}
                                className="rounded border-slate-500 bg-slate-700 text-cyan-500 focus:ring-cyan-500"
                              />
                              <span className="text-xs text-slate-300">서술형 주문</span>
                            </label>
                          </div>
                          {(u.canAccessAnalysis || u.canAccessEssay) && (
                            <div className="px-3 pb-3 pt-2 border-t border-[#2e3248] mt-2">
                              <p className="text-[11px] text-slate-500 mb-1.5">교재 허용 목록 (선택한 교재만 해당 메뉴에서 노출)</p>
                              <div className="flex flex-wrap gap-1.5">
                                {u.canAccessAnalysis && (
                                  <button
                                    type="button"
                                    onClick={() => openTextbooksModal(u, 'analysis')}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#2e3248] text-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-700/50"
                                  >
                                    📗 분석지 교재 {((u.allowedTextbooksAnalysis?.length ?? u.allowedTextbooks?.length) ?? 0) > 0 ? `(${u.allowedTextbooksAnalysis?.length ?? u.allowedTextbooks?.length}개)` : ''}
                                  </button>
                                )}
                                {u.canAccessEssay && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openTextbooksModal(u, 'essay')}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#2e3248] text-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-700/50"
                                    >
                                      📘 서술형 교재 {((u.allowedTextbooksEssay?.length ?? u.allowedTextbooks?.length) ?? 0) > 0 ? `(${u.allowedTextbooksEssay?.length ?? u.allowedTextbooks?.length}개)` : ''}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openEssayTypesModal(u)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#2e3248] text-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-700/50"
                                    >
                                      📝 서술형 추가 유형 {(u.allowedEssayTypeIds?.length ?? 0) > 0 ? `(${u.allowedEssayTypeIds?.length}개)` : ''}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        {(u.supplementaryNote != null && u.supplementaryNote.trim() !== '') && (
                          <div className="px-4 pb-2">
                            <p className="text-[11px] text-slate-500 mb-0.5">부교재 사용</p>
                            <p className="text-xs text-slate-300 whitespace-pre-wrap break-words">{u.supplementaryNote.trim()}</p>
                          </div>
                        )}
                        <div className="px-4 pb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <button type="button" onClick={() => openOrdersModal(u)} className="text-xs text-cyan-400 hover:underline bg-transparent border-0 cursor-pointer p-0">📋 주문 내역 보기 →</button>
                          <span className="text-slate-600 text-xs">·</span>
                          <div className="relative inline-block" ref={messagePopoverUserId === u.id ? messagePopoverRef : null}>
                            <button type="button" onClick={() => setMessagePopoverUserId((prev) => (prev === u.id ? null : u.id))} className="text-xs text-slate-300 hover:underline bg-transparent border-0 cursor-pointer p-0">
                              💬 메세지 복사
                            </button>
                            {messagePopoverUserId === u.id && (
                              <div className="absolute left-0 bottom-full mb-1 z-10 min-w-[180px] rounded-lg border border-slate-600 bg-slate-800 shadow-xl py-1.5">
                                <p className="px-3 py-1 text-[11px] text-slate-500 border-b border-slate-700 mb-1">안내 멘트 선택</p>
                                {MESSAGE_PRESETS.map((preset) => (
                                  <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => handleCopyMessage(u, preset.id)}
                                    className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700/80 flex items-center justify-between gap-2"
                                  >
                                    <span>{preset.label}</span>
                                    {messageCopiedKey === `${u.id}-${preset.id}` && <span className="text-emerald-400 text-[10px]">✓ 복사됨</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <span className="text-slate-600 text-xs">·</span>
                          <button type="button" onClick={() => handleResetPassword(u.id)} disabled={resetPasswordLoadingId === u.id} className="text-xs text-amber-400 hover:underline bg-transparent border-0 cursor-pointer p-0 disabled:opacity-50">PW 초기화</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </main>

      {monthlyRevenueOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="monthly-revenue-title"
          onClick={() => setMonthlyRevenueOpen(false)}
        >
          <div
            className="bg-slate-800 rounded-xl shadow-xl max-w-lg w-full border border-slate-600 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between gap-3 shrink-0">
              <h3 id="monthly-revenue-title" className="font-bold text-white text-lg">
                월별 매출 (완료 주문)
              </h3>
              <button
                type="button"
                onClick={() => setMonthlyRevenueOpen(false)}
                className="text-slate-400 hover:text-white text-xl leading-none px-1"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 min-h-0">
              {monthlyRevenueLoading && (
                <p className="text-slate-400 text-sm py-8 text-center">불러오는 중…</p>
              )}
              {monthlyRevenueError && !monthlyRevenueLoading && (
                <p className="text-red-300 text-sm">{monthlyRevenueError}</p>
              )}
              {!monthlyRevenueLoading && !monthlyRevenueError && monthlyRevenueRows.length === 0 && (
                <p className="text-slate-500 text-sm py-6 text-center">집계할 데이터가 없습니다.</p>
              )}
              {!monthlyRevenueLoading && !monthlyRevenueError && monthlyRevenueRows.length > 0 && (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-600 text-slate-400 text-left">
                        <th className="py-2 pr-3 font-medium">월 (한국)</th>
                        <th className="py-2 pr-3 font-medium text-right">건수</th>
                        <th className="py-2 font-medium text-right">매출(원)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyRevenueRows.map((row) => (
                        <tr key={row.key} className="border-b border-slate-700/60 text-slate-200">
                          <td className="py-2 pr-3 tabular-nums">{row.label}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{row.orderCount}</td>
                          <td className="py-2 text-right tabular-nums font-medium text-white">
                            {row.totalWon.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {monthlyRevenueNote && (
                    <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">{monthlyRevenueNote}</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {siteVisitsHistoryOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="site-visits-history-title"
          onClick={() => setSiteVisitsHistoryOpen(false)}
        >
          <div
            className="bg-slate-800 rounded-xl shadow-xl max-w-lg w-full border border-slate-600 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between gap-3 shrink-0">
              <h3 id="site-visits-history-title" className="font-bold text-white text-lg">
                사이트 방문 일별 기록
              </h3>
              <button
                type="button"
                onClick={() => setSiteVisitsHistoryOpen(false)}
                className="text-slate-400 hover:text-white text-xl leading-none px-1"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 min-h-0">
              {siteVisitsHistoryLoading && (
                <p className="text-slate-400 text-sm py-8 text-center">불러오는 중…</p>
              )}
              {siteVisitsHistoryError && !siteVisitsHistoryLoading && (
                <p className="text-red-300 text-sm">{siteVisitsHistoryError}</p>
              )}
              {!siteVisitsHistoryLoading && !siteVisitsHistoryError && siteVisitsHistoryRows.length === 0 && (
                <p className="text-slate-500 text-sm py-6 text-center">저장된 일별 기록이 없습니다.</p>
              )}
              {!siteVisitsHistoryLoading && !siteVisitsHistoryError && siteVisitsHistoryRows.length > 0 && (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-600 text-slate-400 text-left">
                        <th className="py-2 pr-3 font-medium">한국 날짜</th>
                        <th className="py-2 pr-3 font-medium text-right">순방문(추정)</th>
                        <th className="py-2 font-medium text-right">페이지 조회</th>
                      </tr>
                    </thead>
                    <tbody>
                      {siteVisitsHistoryRows.map((row) => {
                        const isToday = row.date === stats?.siteVisitsTodayKey;
                        return (
                          <tr
                            key={row.date}
                            className={`border-b border-slate-700/60 text-slate-200 ${
                              isToday ? 'bg-cyan-950/35' : ''
                            }`}
                          >
                            <td className="py-2 pr-3 tabular-nums text-white">
                              {row.date}
                              {isToday ? (
                                <span className="ml-2 text-[10px] font-medium text-cyan-400/90">오늘</span>
                              ) : null}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums text-cyan-200/90">
                              {row.uniqueVisitors.toLocaleString()}명
                            </td>
                            <td className="py-2 text-right tabular-nums text-slate-300">
                              {row.pageViews.toLocaleString()}회
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {siteVisitsHistoryNote && (
                    <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">{siteVisitsHistoryNote}</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 주문 요약 셀에서 연 주문 본문 팝업 */}
      {orderTextPreviewModal && (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center bg-black/65 p-4"
          onClick={() => {
            setOrderTextPreviewModal(null);
            setOrderTextPreviewCopied(false);
          }}
        >
          <div
            className="bg-slate-800 rounded-xl shadow-xl max-w-3xl w-full max-h-[88vh] flex flex-col border border-slate-600 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-700 shrink-0 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-white text-lg">주문 전문</h3>
                <p className="text-slate-400 text-sm mt-1 font-mono break-all">
                  {orderTextPreviewModal.orderNumber || '—'} · {orderTextPreviewModal.loginId || '비회원'}
                </p>
                <p className="text-slate-500 text-xs mt-0.5">{orderFlowLabel(orderTextPreviewModal.orderMetaFlow)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const t = orderTextPreviewModal.orderText ?? '';
                    try {
                      await navigator.clipboard.writeText(t);
                      setOrderTextPreviewCopied(true);
                      setTimeout(() => setOrderTextPreviewCopied(false), 2000);
                    } catch {
                      setMessage({ type: 'error', text: '클립보드 복사에 실패했습니다.' });
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-xs font-medium border border-slate-500"
                >
                  {orderTextPreviewCopied ? '복사됨' : '전체 복사'}
                </button>
                <a
                  href={`/order/done?id=${orderTextPreviewModal.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg border border-cyan-600/50 bg-cyan-950/40 text-cyan-200 text-xs font-medium hover:bg-cyan-900/50"
                >
                  주문서 페이지
                </a>
                <button
                  type="button"
                  onClick={() => {
                    const o = orderTextPreviewModal;
                    setOrderTextPreviewModal(null);
                    setOrderTextPreviewCopied(false);
                    openOrderDetail(o);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
                >
                  주문 관리
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOrderTextPreviewModal(null);
                    setOrderTextPreviewCopied(false);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-200 text-xs font-medium hover:bg-slate-600"
                >
                  닫기
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-4">
              <pre className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-200 font-sans bg-slate-900/60 border border-slate-700 rounded-lg p-4">
                {orderTextPreviewModal.orderText?.trim() || '(주문 본문 없음)'}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Order detail modal */}
      {orderDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-800 rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-700">
            <h3 className="font-bold text-white mb-1">주문 관리</h3>
            <p className="text-slate-400 text-sm mb-3 font-mono break-all">{orderDetailModal.orderNumber} · {orderDetailModal.loginId || '비회원'}</p>

            <div className="flex rounded-lg overflow-hidden border border-slate-600 mb-4 p-0.5 bg-slate-900/40" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={orderDetailTab === 'dropbox'}
                onClick={() => setOrderDetailTab('dropbox')}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  orderDetailTab === 'dropbox' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                드롭박스
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={orderDetailTab === 'status'}
                onClick={() => setOrderDetailTab('status')}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  orderDetailTab === 'status' ? 'bg-slate-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                주문 상태
              </button>
            </div>

            {!orderDetailModal.loginId && users.length > 0 && (
              <div className="mb-4 p-4 rounded-lg bg-slate-700/50 border border-slate-600">
                <label className="block text-slate-300 text-sm font-medium mb-2">회원으로 연결 (가입 전 주문)</label>
                <p className="text-slate-500 text-xs mb-2">이 주문을 회원 계정에 연결하면, 해당 회원이 내정보에서 주문 이력을 볼 수 있습니다. 연결하지 않아도 아래에서 상태 변경·링크 저장이 가능합니다.</p>
                <select
                  value={assignLoginId}
                  onChange={(e) => setAssignLoginId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm mb-2"
                >
                  <option value="">회원 선택</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.loginId}>{u.loginId} ({u.name})</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAssignMember}
                  disabled={!assignLoginId.trim() || assignSavingId === orderDetailModal.id}
                  className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                >
                  {assignSavingId === orderDetailModal.id ? '연결 중…' : '이 주문을 회원으로 연결'}
                </button>
              </div>
            )}

            <div className="min-h-[8rem]">
              {orderDetailTab === 'status' ? (
                <div className="space-y-3">
                  <p className="text-slate-500 text-xs">접수·제작·완료·취소 등 주문 상태만 여기서 저장합니다.</p>
                  <div>
                    <label className="block text-slate-400 text-sm mb-1">상태</label>
                    <select value={statusInput} onChange={(e) => setStatusInput(e.target.value)} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm">
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <button type="button" onClick={handleSaveStatus} disabled={statusSavingId === orderDetailModal.id} className="mt-2 px-3 py-1.5 bg-slate-600 text-white text-sm rounded-lg hover:bg-slate-500 disabled:opacity-50">
                      {statusSavingId === orderDetailModal.id ? '저장 중…' : '상태 저장'}
                    </button>
                    {orderDetailModal.status === 'completed' && (
                      <div className="mt-2 text-[11px] text-slate-500 leading-relaxed space-y-1">
                        <p>
                          {orderDetailModal.solbookAccountingSplit ? (
                            <>
                              쏠북 커스텀:{' '}
                              {orderDetailModal.revenueWon != null && orderDetailModal.revenueWon >= 0 ? (
                                <span className="text-sky-200 tabular-nums font-medium">
                                  {orderDetailModal.revenueWon.toLocaleString()}원
                                </span>
                              ) : (
                                <span className="text-amber-400/90">—</span>
                              )}
                            </>
                          ) : (
                            <>
                              매출 반영액(실입금 기준):{' '}
                              {orderDetailModal.revenueWon != null && orderDetailModal.revenueWon >= 0 ? (
                                <span
                                  className={
                                    (orderDetailModal.pointsUsed ?? 0) > 0
                                      ? 'text-sky-400/90 tabular-nums font-medium'
                                      : 'text-emerald-400/90 tabular-nums'
                                  }
                                >
                                  {(orderDetailModal.pointsUsed ?? 0) > 0
                                    ? (
                                        orderDetailModal.paymentDueWon ??
                                        orderDetailModal.revenueWon
                                      ).toLocaleString()
                                    : orderDetailModal.revenueWon.toLocaleString()}
                                  원
                                </span>
                              ) : (
                                <span className="text-amber-400/90">주문서에서 금액을 찾지 못함</span>
                              )}
                            </>
                          )}
                        </p>
                        {orderDetailModal.solbookAccountingSplit &&
                        orderDetailModal.orderGrossWon != null &&
                        orderDetailModal.orderGrossWon > 0 ? (
                          <p className="text-sky-400/90">
                            주문 합계(변형 제작 포함·집계 제외):{' '}
                            <span className="text-sky-200 tabular-nums font-medium">
                              {orderDetailModal.orderGrossWon.toLocaleString()}원
                            </span>
                          </p>
                        ) : null}
                        {(orderDetailModal.pointsUsed ?? 0) > 0 && !orderDetailModal.solbookAccountingSplit ? (
                          <>
                            {orderDetailModal.orderGrossWon != null &&
                            orderDetailModal.orderGrossWon > 0 ? (
                              <p className="text-slate-400">
                                주문 총액:{' '}
                                <span className="text-slate-300 tabular-nums">
                                  {orderDetailModal.orderGrossWon.toLocaleString()}원
                                </span>
                              </p>
                            ) : null}
                            <p className="text-sky-400/80">
                              포인트 사용:{' '}
                              <span className="tabular-nums">
                                {(orderDetailModal.pointsUsed ?? 0).toLocaleString()}원
                              </span>
                            </p>
                          </>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-slate-500 text-xs">
                    완료된 작업물 Dropbox 공유 URL만 여기서 등록합니다. 폴더 생성은 목록의 <strong className="text-slate-400">생성</strong> 버튼을 사용하세요.
                  </p>
                  <div>
                    <label className="block text-slate-400 text-sm mb-1">공유 링크 (URL)</label>
                    <input type="url" value={fileUrlInput} onChange={(e) => setFileUrlInput(e.target.value)} placeholder="https://www.dropbox.com/..." className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500" />
                    <button type="button" onClick={handleSaveFileUrl} disabled={fileUrlSavingId === orderDetailModal.id} className="mt-2 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-500 disabled:opacity-50">
                      {fileUrlSavingId === orderDetailModal.id ? '저장 중…' : '링크 저장'}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href={`/order/done?id=${orderDetailModal.id}`} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[7rem] text-center px-4 py-2 border border-slate-600 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700">주문서 보기</a>
              <button type="button" onClick={handleDeleteOrder} disabled={deleteSavingId === orderDetailModal.id} className="px-4 py-2 bg-red-600/80 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50">{deleteSavingId === orderDetailModal.id ? '삭제 중…' : '삭제'}</button>
              <button
                type="button"
                onClick={() => {
                  setOrderDetailModal(null);
                  setOrderDetailTab('status');
                }}
                className="px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User orders modal */}
      {ordersModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col p-6 border border-slate-700">
            <h3 className="font-bold text-white mb-2">주문 이력 — {ordersModalUser.loginId} ({ordersModalUser.name})</h3>
            {userOrdersLoading ? (
              <p className="text-slate-500">불러오는 중…</p>
            ) : userOrders.length === 0 ? (
              <p className="text-slate-500">주문 이력이 없습니다.</p>
            ) : (
              <div className="overflow-y-auto flex-1 border border-slate-600 rounded-lg mt-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-700/50 text-slate-400">
                      <th className="text-left py-2 px-3">주문번호</th>
                      <th className="text-left py-2 px-3">일시</th>
                      <th className="text-left py-2 px-3">상태</th>
                      <th className="text-left py-2 px-3">관리</th>
                      <th className="text-right py-2 px-3 whitespace-nowrap">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userOrders.map((o) => (
                      <tr key={o.id} className="border-t border-slate-700">
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {o.orderNumber ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(o.orderNumber!);
                                    setCopiedOrderNumberId(o.id);
                                    setTimeout(() => setCopiedOrderNumberId(null), 1500);
                                  } catch {
                                    setMessage({ type: 'error', text: '클립보드 복사에 실패했습니다.' });
                                  }
                                }}
                                className="shrink-0 rounded p-1 text-slate-500 hover:text-cyan-300 hover:bg-slate-700/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                                title="주문번호 복사"
                                aria-label={`주문번호 ${o.orderNumber} 클립보드에 복사`}
                              >
                                {copiedOrderNumberId === o.id ? (
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2.5}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="w-3.5 h-3.5 text-emerald-400"
                                    aria-hidden
                                  >
                                    <path d="M20 6L9 17l-5-5" />
                                  </svg>
                                ) : (
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="w-3.5 h-3.5"
                                    aria-hidden
                                  >
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                  </svg>
                                )}
                              </button>
                            ) : null}
                            <a
                              href={`/order/done?id=${o.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-white hover:text-blue-300 hover:underline truncate min-w-0"
                            >
                              {o.orderNumber || '—'}
                            </a>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-slate-400">{formatDateTime(o.createdAt)}</td>
                        <td className="py-2 px-3">
                          {(o.status || 'pending') === 'cancelled' ? (
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium text-slate-400 bg-slate-700/80 border border-slate-600">
                              취소됨
                            </span>
                          ) : (
                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE_CLASS[o.status || 'pending'] || ''}`}>{o.statusLabel}</span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <button type="button" onClick={() => { setOrdersModalUser(null); openOrderDetail(o); }} className="text-blue-400 hover:underline text-xs">관리</button>
                          {o.fileUrl ? (
                            <a href={o.fileUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-cyan-400 hover:text-cyan-300 text-xs">폴더 보기</a>
                          ) : o.dropboxFolderCreated ? (
                            <span className="ml-2 text-slate-500 text-xs">폴더 생성됨</span>
                          ) : (
                            <button type="button" onClick={() => handleCreateOrderFolder(o.id)} disabled={!!createOrderFolderId} className="ml-2 text-slate-400 hover:text-white text-xs disabled:opacity-50">폴더 만들기</button>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right align-middle">
                          <button
                            type="button"
                            onClick={() => handleDeleteOrderById(o.id, o.status || 'pending')}
                            disabled={!!deleteOrderId}
                            className={`inline-flex items-center justify-center px-2 py-1 rounded text-xs font-semibold disabled:opacity-50 ${
                              (o.status || 'pending') === 'cancelled'
                                ? 'border border-red-900/50 bg-red-950/30 text-red-300 hover:bg-red-900/40'
                                : 'border border-slate-600 bg-slate-700/40 text-slate-300 hover:bg-slate-600 hover:text-white'
                            }`}
                            title={
                              (o.status || 'pending') === 'cancelled'
                                ? '취소된 주문 영구 삭제'
                                : '관리자 권한으로 영구 삭제 (확인 후 진행)'
                            }
                          >
                            {deleteOrderId === o.id ? '삭제 중…' : '삭제'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button type="button" onClick={() => setOrdersModalUser(null)} className="mt-4 px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500">닫기</button>
          </div>
        </div>
      )}

      {/* Edit user modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onKeyDown={(e) => { if (e.key === 'Escape') setEditUser(null); }}>
          <div className="bg-slate-800 rounded-xl shadow-xl max-w-md w-full max-h-[90vh] flex flex-col border border-slate-700">
            <h3 className="font-bold text-white p-6 pb-0 shrink-0">계정 수정 — {editUser.loginId}</h3>
            <form onSubmit={handleSaveEdit} className="flex flex-col flex-1 min-h-0 p-6">
              <div className="space-y-4 overflow-y-auto flex-1 pr-1">
              <div>
                <label className="block text-slate-400 text-sm mb-1">이름</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">이메일</label>
                <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">전화번호</label>
                <input type="text" value={editPhone} onChange={(e) => setEditPhone(e.target.value.replace(/\D/g, ''))} placeholder="01012345678 (폴더명에 사용)" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">부교재 사용 기록</label>
                <textarea value={editSupplementaryNote} onChange={(e) => setEditSupplementaryNote(e.target.value)} placeholder="예: 수능특강, 완자 (공통이 아닌 부교재 주문 시 참고)" rows={2} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 resize-none" />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">드롭박스 폴더 경로</label>
                <input type="text" value={editDropboxFolderPath} onChange={(e) => setEditDropboxFolderPath(e.target.value)} placeholder="/gomijoshua/이름_전화번호" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm font-mono" />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Dropbox 공유 링크 (회원이 폴더 열 때 사용)</label>
                <input type="url" value={editDropboxSharedLink} onChange={(e) => setEditDropboxSharedLink(e.target.value)} placeholder="https://www.dropbox.com/scl/fo/..." className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500" />
                <p className="text-xs text-slate-500 mt-1">폴더 공유 후 링크를 붙여넣으면 회원이 내 페이지에서 폴더 열기가 됩니다.</p>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">연회원</label>
                <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-sm mb-1.5">
                  <input type="checkbox" checked={!!editAnnualMemberSince} onChange={(e) => { if (!e.target.checked) setEditAnnualMemberSince(''); else if (!editAnnualMemberSince) setEditAnnualMemberSince(new Date().toISOString().slice(0, 10)); }} className="rounded border-slate-500 text-slate-600 bg-slate-700" />
                  연회원으로 설정 (등록일로부터 1년 유효)
                </label>
                {editAnnualMemberSince && (
                  <input type="date" value={editAnnualMemberSince} onChange={(e) => setEditAnnualMemberSince(e.target.value)} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
                )}
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">월구독</label>
                <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-sm mb-1.5">
                  <input
                    type="checkbox"
                    checked={!!editMonthlyMemberUntil}
                    onChange={(e) => {
                      if (!e.target.checked) {
                        setEditMonthlyMemberSince('');
                        setEditMonthlyMemberUntil('');
                      } else if (!editMonthlyMemberUntil) {
                        const end = new Date();
                        end.setDate(end.getDate() + 30);
                        setEditMonthlyMemberSince(new Date().toISOString().slice(0, 10));
                        setEditMonthlyMemberUntil(end.toISOString().slice(0, 10));
                      }
                    }}
                    className="rounded border-slate-500 text-slate-600 bg-slate-700"
                  />
                  월구독 설정 (만료일까지 유효, 연회원과 별도)
                </label>
                {editMonthlyMemberUntil && (
                  <div className="space-y-2">
                    <div>
                      <span className="text-xs text-slate-500">시작일</span>
                      <input type="date" value={editMonthlyMemberSince} onChange={(e) => setEditMonthlyMemberSince(e.target.value)} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
                    </div>
                    <div>
                      <span className="text-xs text-slate-500">만료일</span>
                      <input type="date" value={editMonthlyMemberUntil} onChange={(e) => setEditMonthlyMemberUntil(e.target.value)} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
                    </div>
                  </div>
                )}
                <p className="text-xs text-slate-500 mt-1">{membershipPricingOneLiner()}</p>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">VIP</label>
                <label className="flex items-center gap-2 cursor-pointer text-slate-300 text-sm">
                  <input type="checkbox" checked={editIsVip} onChange={(e) => setEditIsVip(e.target.checked)} className="rounded border-slate-500 text-amber-600 bg-slate-700" />
                  VIP 회원으로 설정
                </label>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">포인트</label>
                <p className="text-white text-sm mb-1">현재 보유: <strong>{(editUser.points ?? 0).toLocaleString()} P</strong></p>
                <input type="number" min="0" step="1" value={editPointsAdd} onChange={(e) => setEditPointsAdd(e.target.value)} placeholder="추가 지급할 포인트 (숫자만)" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-slate-400 text-sm">
                <input type="checkbox" checked={editMyFormatApproved} onChange={(e) => setEditMyFormatApproved(e.target.checked)} className="rounded border-slate-500 text-slate-600 bg-slate-700" />
                나의양식 업로드 승인 (내정보에서 hwp/hwpx 업로드 가능)
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-400 text-sm">
                <input type="checkbox" checked={editResetPassword} onChange={(e) => setEditResetPassword(e.target.checked)} className="rounded border-slate-500 text-slate-600 bg-slate-700" />
                비밀번호 123456으로 초기화
              </label>
              {editMessage && <p className={`text-sm ${editMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>{editMessage.text}</p>}
              </div>
              <div className="flex gap-2 pt-4 shrink-0">
                <button type="submit" disabled={editSaving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500 disabled:opacity-50">{editSaving ? '저장 중…' : '저장'}</button>
                <button type="button" onClick={() => setEditUser(null)} className="px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500">취소</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 기출문제 유형 분류 모달 */}
      {examUploadForClassify && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-slate-800 rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col border border-slate-700" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-700">
              <h3 className="font-bold text-white">문제 유형 분류</h3>
              <p className="text-slate-400 text-sm mt-1">
                {examUploadForClassify.school} · {examUploadForClassify.grade} · {examUploadForClassify.examYear}년 {examUploadForClassify.examType}
              </p>
              <p className="text-slate-500 text-xs mt-1">분류한 유형은 회원이 마이페이지에서 확인할 수 있으며, 서술형 맞춤 제작 시 참고됩니다.</p>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {essayCategoriesGrouped.map(([대, 소목록]) => (
                <div key={대} className="border border-slate-600 rounded-lg p-3">
                  <p className="text-slate-300 font-semibold text-sm mb-2">{대}</p>
                  <div className="space-y-1.5">
                    {소목록.map((sub) => {
                      const value = `${대} > ${sub}`;
                      const checked = selectedCategoriesForClassify.includes(value);
                      return (
                        <label key={value} className="flex items-start gap-2 cursor-pointer text-sm text-slate-300 hover:text-white">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleClassifyCategory(value)}
                            className="mt-1 rounded border-slate-500 bg-slate-700 text-cyan-500 focus:ring-cyan-500"
                          />
                          <span className="text-xs leading-relaxed">{sub}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-slate-700 flex justify-between items-center">
              <span className="text-slate-400 text-sm">{selectedCategoriesForClassify.length}개 유형 선택</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setExamUploadForClassify(null)} className="px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500">취소</button>
                <button type="button" onClick={handleSaveExamClassify} disabled={classifySavingId === examUploadForClassify.id} className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-500 disabled:opacity-50">{classifySavingId === examUploadForClassify.id ? '저장 중…' : '저장'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 부교재 기본 노출 교재 모달 */}

      {defaultTextbooksModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-800 rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col border border-slate-700">
            <div className="p-4 border-b border-slate-700">
              <h3 className="font-bold text-white">부교재 기본 노출 교재</h3>
              <p className="text-slate-400 text-xs mt-1">선택한 교재만 부교재 주문 페이지에 노출됩니다 (비회원 포함). 비어두면 전체 교재가 노출됩니다.</p>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {defaultTextbooksList.length === 0 ? (
                <div className="py-8 text-center text-slate-500">교재 목록 불러오는 중…</div>
              ) : (
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-slate-400 text-xs mb-2">
                    <input
                      type="checkbox"
                      checked={defaultTextbooksList.length > 0 && defaultTextbooksSelected.length === defaultTextbooksList.length}
                      onChange={(e) => {
                        if (e.target.checked) setDefaultTextbooksSelected([...defaultTextbooksList]);
                        else setDefaultTextbooksSelected([]);
                      }}
                      className="rounded border-slate-500 bg-slate-700 text-cyan-500"
                    />
                    전체 선택 / 해제
                  </label>
                  {defaultTextbooksList.map((tb) => (
                    <label key={tb} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-700/50 cursor-pointer text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={defaultTextbooksSelected.includes(tb)}
                        onChange={(e) => {
                          if (e.target.checked) setDefaultTextbooksSelected((prev) => [...prev, tb]);
                          else setDefaultTextbooksSelected((prev) => prev.filter((t) => t !== tb));
                        }}
                        className="rounded border-slate-500 bg-slate-700 text-cyan-500"
                      />
                      <span className="truncate">{tb}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-700 flex justify-between">
              <span className="text-slate-400 text-sm">{defaultTextbooksSelected.length}개 선택 (비어두면 전체 노출)</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setDefaultTextbooksModalOpen(false)} className="px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500">취소</button>
                <button type="button" onClick={saveDefaultTextbooks} disabled={defaultTextbooksSaving} className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-500 disabled:opacity-50">{defaultTextbooksSaving ? '저장 중…' : '저장'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 사용자 대신 기출 등록 모달 */}
      {adminCreateExamOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-slate-800 rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto border border-slate-700" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-700">
              <h3 className="font-bold text-white">사용자 대신 기출 등록</h3>
              <p className="text-slate-400 text-xs mt-1">카톡 등으로 받은 시험지 사진/파일을 해당 회원 이름으로 등록하면, 회원이 마이페이지에서 조회·다운로드할 수 있습니다.</p>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">회원 (아이디) *</label>
                <select
                  value={adminCreateExamForm.loginId}
                  onChange={(e) => setAdminCreateExamForm((f) => ({ ...f, loginId: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
                >
                  <option value="">회원 선택</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.loginId}>{u.loginId} ({u.name})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">학교 *</label>
                <input
                  type="text"
                  value={adminCreateExamForm.school}
                  onChange={(e) => setAdminCreateExamForm((f) => ({ ...f, school: e.target.value }))}
                  placeholder="예: 부산진여고등학교"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">학년 *</label>
                <select
                  value={adminCreateExamForm.grade}
                  onChange={(e) => setAdminCreateExamForm((f) => ({ ...f, grade: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
                >
                  <option value="">선택</option>
                  <option value="고1">고1</option>
                  <option value="고2">고2</option>
                  <option value="고3">고3</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">시험 연도 *</label>
                <select
                  value={adminCreateExamForm.examYear}
                  onChange={(e) => setAdminCreateExamForm((f) => ({ ...f, examYear: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
                >
                  <option value="">선택</option>
                  {[2026, 2025, 2024, 2023, 2022, 2021, 2020].map((y) => (
                    <option key={y} value={String(y)}>{y}년</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">시험 종류 *</label>
                <select
                  value={adminCreateExamForm.examType}
                  onChange={(e) => setAdminCreateExamForm((f) => ({ ...f, examType: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
                >
                  <option value="">선택</option>
                  <option value="1학기중간고사">1학기 중간고사</option>
                  <option value="1학기기말고사">1학기 기말고사</option>
                  <option value="2학기중간고사">2학기 중간고사</option>
                  <option value="2학기기말고사">2학기 기말고사</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">시험범위 (선택)</label>
                <input
                  type="text"
                  value={adminCreateExamForm.examScope}
                  onChange={(e) => setAdminCreateExamForm((f) => ({ ...f, examScope: e.target.value }))}
                  placeholder="예: 능률김 1,2과"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">파일 * (PDF, 이미지, HWP/HWPX, 최대 10개·각 15MB)</label>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.hwp,.hwpx"
                  onChange={(e) => setAdminCreateExamFiles(e.target.files?.length ? e.target.files : null)}
                  className="w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-slate-600 file:text-white file:text-sm file:font-medium"
                />
                {adminCreateExamFiles?.length ? <p className="text-slate-400 text-xs mt-1">{adminCreateExamFiles.length}개 파일 선택됨</p> : null}
              </div>
            </div>
            <div className="p-4 border-t border-slate-700 flex justify-end gap-2">
              <button type="button" onClick={() => { setAdminCreateExamOpen(false); setAdminCreateExamForm({ loginId: '', school: '', grade: '', examYear: '', examType: '', examScope: '' }); setAdminCreateExamFiles(null); }} className="px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500">취소</button>
              <button type="button" onClick={handleAdminCreateExamSubmit} disabled={adminCreateExamSaving} className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-500 disabled:opacity-50">{adminCreateExamSaving ? '등록 중…' : '등록'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 기출문제 파일 추가 모달 */}
      {examUploadForAddFiles && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-slate-800 rounded-xl shadow-xl max-w-md w-full border border-slate-700" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-700">
              <h3 className="font-bold text-white">파일 추가</h3>
              <p className="text-slate-400 text-sm mt-1">
                {examUploadForAddFiles.loginId} · {examUploadForAddFiles.school} · {examUploadForAddFiles.examYear}년 {examUploadForAddFiles.examType}
              </p>
              <p className="text-slate-500 text-xs mt-1">추가한 파일은 해당 회원이 마이페이지에서 다운로드·미리보기할 수 있습니다. (한 건당 최대 10개)</p>
            </div>
            <div className="p-4">
              <input
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.hwp,.hwpx"
                onChange={(e) => setAddFilesList(e.target.files?.length ? e.target.files : null)}
                className="w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-slate-600 file:text-white file:text-sm file:font-medium"
              />
              {addFilesList?.length ? (
                <p className="text-slate-400 text-xs mt-2">{addFilesList.length}개 파일 선택됨</p>
              ) : null}
            </div>
            <div className="p-4 border-t border-slate-700 flex justify-end gap-2">
              <button type="button" onClick={() => { setExamUploadForAddFiles(null); setAddFilesList(null); }} className="px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500">취소</button>
              <button type="button" onClick={handleAddFilesSubmit} disabled={!addFilesList?.length || addFilesSavingId === examUploadForAddFiles.id} className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-500 disabled:opacity-50">{addFilesSavingId === examUploadForAddFiles.id ? '추가 중…' : '파일 추가'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 기출문제 미리보기 모달 */}
      {examPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setExamPreview(null)}>
          <div className="relative w-[95vw] max-w-4xl h-[90vh] bg-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-700" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-700 shrink-0">
              <span className="text-sm font-bold text-white flex-1 truncate">{examPreview.name}</span>
              <a
                href={examPreview.url.replace('&inline=1', '')}
                download
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 no-underline border border-cyan-500/30"
              >
                다운로드
              </a>
              <button type="button" onClick={() => setExamPreview(null)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-700 hover:text-white text-lg">✕</button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-900 flex items-center justify-center">
              {examPreview.type === 'pdf' ? (
                <iframe src={examPreview.url} className="w-full h-full border-0" title={examPreview.name} />
              ) : (
                <img src={examPreview.url} alt={examPreview.name} className="max-w-full max-h-full object-contain p-4" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* 교재 허용 목록 선택 모달 */}
      {editingTextbooksUserId && editingTextbooksMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-800 rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col border border-slate-700">
            <div className="p-4 border-b border-slate-700">
              <h3 className="font-bold text-white">
                {editingTextbooksMode === 'analysis'
                  ? '분석지 허용 교재'
                  : editingTextbooksMode === 'essay'
                    ? '서술형 허용 교재'
                    : editingTextbooksMode === 'workbook'
                      ? '워크북 부교재 (회원 전용 추가)'
                      : '변형문제 부교재 (회원 전용 추가)'}
              </h3>
              <p className="text-slate-400 text-xs mt-1">
                {editingTextbooksMode === 'workbook' ? (
                  <>
                    모의고사(고1_/고2_/고3_)·EBS·쏠북(변형 쏠북 설정에 등록된 교재)은 제외된 목록입니다. EBS·쏠북은 전
                    회원에게 공개됩니다. 저장 시 이 회원에게는{' '}
                    <strong className="text-slate-300">공통 교재(WORKBOOK_SUPPLEMENTARY_COMMON_KEYS) ∪ 선택 교재</strong>만
                    워크북 부교재로 보입니다.
                  </>
                ) : editingTextbooksMode === 'variant' ? (
                  <>
                    모의고사(고1_/고2_/고3_)·EBS·쏠북(변형 쏠북 설정에 등록된 교재)은 제외된 목록입니다. EBS·쏠북은 전
                    회원에게 공개됩니다. 저장 시 이 회원에게는{' '}
                    <strong className="text-slate-300">공통 교재(VARIANT_SUPPLEMENTARY_COMMON_KEYS) ∪ 선택 교재</strong>만
                    부교재 변형문제 주문(/textbook) 화면의「회원 전용 추가」범위로 쓰입니다. 변환 JSON에만 있는 키 중
                    위에 해당하지 않는 교재만 체크할 수 있습니다.
                  </>
                ) : (
                  <>
                    선택한 교재만 해당 회원에게 노출됩니다.{' '}
                    {editingTextbooksMode === 'analysis' ? '분석지' : '서술형'} 주문 시 강과/교재 선택에 사용됩니다.
                  </>
                )}
              </p>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {textbooksModalLoading ? (
                <div className="py-8 text-center text-slate-500">교재 목록 불러오는 중…</div>
              ) : textbookListForModal.length === 0 ? (
                <p className="text-slate-500 text-sm">교재 데이터가 없습니다.</p>
              ) : (
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-slate-400 text-xs mb-2">
                    <input
                      type="checkbox"
                      checked={textbookListForModal.length > 0 && selectedTextbooksForModal.length === textbookListForModal.length}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedTextbooksForModal([...textbookListForModal]);
                        else setSelectedTextbooksForModal([]);
                      }}
                      className="rounded border-slate-500 bg-slate-700 text-cyan-500"
                    />
                    전체 선택 / 해제
                  </label>
                  {textbookListForModal.map((tb) => (
                    <label key={tb} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-700/50 cursor-pointer text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={selectedTextbooksForModal.includes(tb)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedTextbooksForModal((prev) => [...prev, tb]);
                          else setSelectedTextbooksForModal((prev) => prev.filter((t) => t !== tb));
                        }}
                        className="rounded border-slate-500 bg-slate-700 text-cyan-500"
                      />
                      <span className="truncate">{tb}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-700 flex justify-between">
              <span className="text-slate-400 text-sm">{selectedTextbooksForModal.length}개 선택</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setEditingTextbooksUserId(null); setEditingTextbooksMode(null); }} className="px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500">취소</button>
                <button type="button" onClick={saveAllowedTextbooks} disabled={textbooksSavingId === editingTextbooksUserId} className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-500 disabled:opacity-50">{textbooksSavingId === editingTextbooksUserId ? '저장 중…' : '저장'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 서술형 추가 배정 유형 모달 (공통유형이 아닌 유형만 선생님별 배정) */}
      {editingEssayTypesUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-800 rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col border border-slate-700">
            <div className="p-4 border-b border-slate-700">
              <h3 className="font-bold text-white">서술형 추가 배정 유형</h3>
              <p className="text-slate-400 text-xs mt-1">공통유형이 아닌 유형만 선택해 이 회원에게 추가로 노출됩니다. 공통유형은 서술형 권한 있는 모든 선생님에게 자동 표시됩니다.</p>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {(() => {
                const assignableTypes = essayTypes.filter((t) => t.enabled !== false && !t.common);
                if (assignableTypes.length === 0) {
                  return <p className="text-slate-500 text-sm">배정 가능한 추가 유형이 없습니다. 서술형 유형 관리에서 공통유형이 아닌 유형을 추가·노출해 두세요.</p>;
                }
                const by대분류 = assignableTypes.reduce<Record<string, EssayTypeItem[]>>((acc, t) => {
                  const key = t.대분류 || '(미분류)';
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(t);
                  return acc;
                }, {});
                return (
                  <div className="space-y-3">
                    {Object.entries(by대분류).map(([대, items]) => (
                      <div key={대}>
                        <p className="text-slate-400 text-xs font-semibold mb-1.5">{대}</p>
                        <div className="space-y-1">
                          {items.map((t) => (
                            <label key={t.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-700/50 cursor-pointer text-sm text-slate-200">
                              <input
                                type="checkbox"
                                checked={selectedEssayTypeIdsForModal.includes(t.id)}
                                onChange={(e) => {
                                  if (e.target.checked) setSelectedEssayTypeIdsForModal((prev) => [...prev, t.id]);
                                  else setSelectedEssayTypeIdsForModal((prev) => prev.filter((id) => id !== t.id));
                                }}
                                className="rounded border-slate-500 bg-slate-700 text-cyan-500"
                              />
                              <span className="truncate">{t.typeCode && `[${t.typeCode}] `}{t.소분류}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
            <div className="p-4 border-t border-slate-700 flex justify-between">
              <span className="text-slate-400 text-sm">{selectedEssayTypeIdsForModal.length}개 선택</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditingEssayTypesUserId(null)} className="px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500">취소</button>
                <button type="button" onClick={saveAllowedEssayTypes} disabled={essayTypesSavingId === editingEssayTypesUserId} className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-500 disabled:opacity-50">{essayTypesSavingId === editingEssayTypesUserId ? '저장 중…' : '저장'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 대분류 이름 수정 모달 */}
      {essayCategoryEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-800 rounded-xl shadow-xl max-w-md w-full border border-slate-700">
            <div className="p-4 border-b border-slate-700">
              <h3 className="font-bold text-white">대분류 이름 수정</h3>
              <p className="text-slate-400 text-xs mt-1">해당 대분류에 속한 모든 유형의 이름이 함께 변경됩니다.</p>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">현재 대분류</label>
                <p className="text-white font-medium">{essayCategoryEditModal}</p>
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">변경할 대분류 이름</label>
                <input
                  type="text"
                  value={categoryNameDraft}
                  onChange={(e) => setCategoryNameDraft(e.target.value)}
                  placeholder="예: 단어 배열 영작"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-700 flex justify-end gap-2">
              <button type="button" onClick={() => setEssayCategoryEditModal(null)} className="px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500">취소</button>
              <button type="button" onClick={saveEssayCategoryRename} disabled={categoryNameSaving} className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-500 disabled:opacity-50">{categoryNameSaving ? '저장 중…' : '저장'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 서술형 유형 추가/수정 모달 */}
      {essayTypeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col border border-slate-700">
            <div className="p-4 border-b border-slate-700">
              <h3 className="font-bold text-white">{essayTypeModal.mode === 'add' ? '서술형 유형 추가' : '서술형 유형 수정'}</h3>
              <p className="text-slate-400 text-xs mt-1">문제·태그·조건을 입력하면 서술형 주문 화면과 기출 분류에 반영됩니다.</p>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">대분류 *</label>
                <input
                  type="text"
                  value={essayTypeForm.대분류}
                  onChange={(e) => setEssayTypeForm((f) => ({ ...f, 대분류: e.target.value }))}
                  placeholder="예: 단어 배열 영작"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">소분류 *</label>
                <input
                  type="text"
                  value={essayTypeForm.소분류}
                  onChange={(e) => setEssayTypeForm((f) => ({ ...f, 소분류: e.target.value }))}
                  placeholder="예: 해석을 주고 단어 배열 (단어 형태 변화 X)"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">유형 코드 (선택)</label>
                <input
                  type="text"
                  value={essayTypeForm.typeCode}
                  onChange={(e) => setEssayTypeForm((f) => ({ ...f, typeCode: e.target.value }))}
                  placeholder="예: Type-01"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">문제 설명</label>
                <textarea
                  value={essayTypeForm.문제}
                  onChange={(e) => setEssayTypeForm((f) => ({ ...f, 문제: e.target.value }))}
                  placeholder="예: 다음 글을 한 문장으로 요약하고자 한다..."
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 resize-y"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">태그 (줄 또는 쉼표 구분)</label>
                <textarea
                  value={essayTypeForm.태그}
                  onChange={(e) => setEssayTypeForm((f) => ({ ...f, 태그: e.target.value }))}
                  placeholder="예: 지문요약, 단순배열, 해석제시, 어휘변형X"
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 resize-y"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">조건</label>
                <textarea
                  value={essayTypeForm.조건}
                  onChange={(e) => setEssayTypeForm((f) => ({ ...f, 조건: e.target.value }))}
                  placeholder="예: 형태변형·어휘 추가 불가, 순서만 바르게 나열할 것..."
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 resize-y"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1">예시 파일</label>
                {essayTypeModal.mode === 'add' ? (
                  <p className="text-slate-500 text-xs">저장 후 수정에서 예시 파일을 첨부할 수 있습니다.</p>
                ) : (
                  <>
                    {(() => {
                      const ef = modalExampleFile !== undefined ? modalExampleFile : essayTypeModal.item.exampleFile;
                      return ef ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={`/api/essay-types/example-file?typeId=${essayTypeModal.item.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 text-sm hover:underline"
                          >
                            📎 {ef.originalName}
                          </a>
                          <button
                            type="button"
                            onClick={() => deleteExampleFile(essayTypeModal.item.id)}
                            disabled={essayExampleDeletingId === essayTypeModal.item.id}
                            className="text-red-400 text-xs hover:underline disabled:opacity-50"
                          >
                            {essayExampleDeletingId === essayTypeModal.item.id ? '삭제 중…' : '삭제'}
                          </button>
                        </div>
                      ) : (
                        <p className="text-slate-500 text-xs mb-1">등록된 예시 파일 없음</p>
                      );
                    })()}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="file"
                        accept=".pdf,.hwp,.hwpx,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadExampleFile(essayTypeModal.item.id, f);
                          e.target.value = '';
                        }}
                        disabled={essayExampleUploadingId === essayTypeModal.item.id}
                        className="text-slate-400 text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-slate-600 file:text-slate-200 file:text-xs"
                      />
                      {essayExampleUploadingId === essayTypeModal.item.id && <span className="text-slate-500 text-xs">업로드 중…</span>}
                    </div>
                    <p className="text-slate-500 text-[10px] mt-1">PDF, HWP, 워드, 이미지 등 (최대 15MB). 새 파일 업로드 시 기존 파일은 교체됩니다.</p>
                  </>
                )}
              </div>
              <p className="text-slate-500 text-[10px]">가격은 상위 카테고리(대분류)에서 「지문당 가격」으로 설정합니다.</p>
            </div>
            <div className="p-4 border-t border-slate-700 flex justify-end gap-2">
              <button type="button" onClick={() => setEssayTypeModal(null)} className="px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500">취소</button>
              <button type="button" onClick={saveEssayType} disabled={essayTypeSaving} className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-500 disabled:opacity-50">{essayTypeSaving ? '저장 중…' : '저장'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
