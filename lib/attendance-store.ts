import { randomBytes } from 'node:crypto';
import { ObjectId, type Db } from 'mongodb';
import { getDb } from './mongodb';

/**
 * VIP 출결관리 — 반(class) · 출결 기록 · QR 자가 체크인 세션.
 * 대상 학생 명단은 기존 vip_students(학교 vip_schools별)를 재사용한다.
 * 모든 문서는 userId(선생님) 로 스코프된다.
 */

export const VIP_CLASSES_COLLECTION = 'vip_classes';
export const VIP_ATTENDANCES_COLLECTION = 'vip_attendances';
export const VIP_CHECKIN_SESSIONS_COLLECTION = 'vip_checkin_sessions';
const VIP_STUDENTS_COLLECTION = 'vip_students';

/* ── 출결 상태 · 사유 ── */
export type AttendanceStatus = 'present' | 'late' | 'earlyLeave' | 'absent';
export const ATTENDANCE_STATUSES: AttendanceStatus[] = ['present', 'late', 'earlyLeave', 'absent'];
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: '출석',
  late: '지각',
  earlyLeave: '조퇴',
  absent: '결석',
};
export function isAttendanceStatus(v: unknown): v is AttendanceStatus {
  return typeof v === 'string' && (ATTENDANCE_STATUSES as string[]).includes(v);
}

export type AbsenceReason = '무단' | '공결' | '병결' | '인정' | '기타';
export const ABSENCE_REASONS: AbsenceReason[] = ['무단', '공결', '병결', '인정', '기타'];

/* ── 타입 ── */
export interface VipClass {
  _id?: ObjectId;
  userId: ObjectId;
  name: string;
  schoolId?: ObjectId | null;
  schoolName?: string;
  studentIds: ObjectId[];
  color?: string;
  scheduleNote?: string;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt?: Date;
}

export interface VipAttendance {
  _id?: ObjectId;
  userId: ObjectId;
  classId: ObjectId;
  /** YYYY-MM-DD */
  date: string;
  /** 같은 날 같은 반의 여러 세션 구분 라벨(예: '1교시'). 기본 '' */
  sessionLabel: string;
  studentId: ObjectId;
  studentName: string;
  status: AttendanceStatus;
  reason?: AbsenceReason | null;
  memo?: string;
  source: 'teacher' | 'qr';
  checkedInAt?: Date | null;
  updatedAt: Date;
}

export interface VipCheckinSession {
  _id?: ObjectId;
  token: string;
  userId: ObjectId;
  classId: ObjectId;
  date: string;
  sessionLabel: string;
  open: boolean;
  createdAt: Date;
  closedAt?: Date | null;
}

export interface RosterStudent {
  id: string;
  name: string;
  grade?: number;
}

/* ── 유틸 ── */
export async function getAttendanceDb(): Promise<Db> {
  return getDb('gomijoshua');
}

export function generateCheckinToken(): string {
  return randomBytes(12).toString('hex');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 'YYYY-MM-DD' 검증·정규화. 유효하지 않으면 null. */
export function normalizeDate(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return DATE_RE.test(s) ? s : null;
}

let _indexed = false;
export async function ensureAttendanceIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_CLASSES_COLLECTION).createIndex({ userId: 1, status: 1 }),
    db.collection(VIP_ATTENDANCES_COLLECTION).createIndex(
      { userId: 1, classId: 1, date: 1, sessionLabel: 1, studentId: 1 },
      { unique: true },
    ),
    db.collection(VIP_ATTENDANCES_COLLECTION).createIndex({ userId: 1, classId: 1, date: 1 }),
    db.collection(VIP_CHECKIN_SESSIONS_COLLECTION).createIndex({ token: 1 }, { unique: true }),
  ]);
}

/* ── 공유 헬퍼 ── */

/** 반 + 배정 학생 명단(class.studentIds 순서 유지). */
export async function loadClassRoster(
  db: Db,
  userId: ObjectId,
  classId: ObjectId,
): Promise<{ cls: VipClass | null; students: RosterStudent[] }> {
  const cls = await db
    .collection<VipClass>(VIP_CLASSES_COLLECTION)
    .findOne({ _id: classId, userId });
  if (!cls) return { cls: null, students: [] };

  const ids = (cls.studentIds ?? []).map((x) => new ObjectId(x));
  const docs = ids.length
    ? await db
        .collection(VIP_STUDENTS_COLLECTION)
        .find({ _id: { $in: ids }, userId })
        .project({ name: 1, grade: 1 })
        .toArray()
    : [];
  const byId = new Map(docs.map((d) => [String(d._id), d as { name?: string; grade?: number }]));
  const students: RosterStudent[] = [];
  for (const sid of cls.studentIds ?? []) {
    const d = byId.get(String(sid));
    if (!d) continue;
    const s: RosterStudent = { id: String(sid), name: String(d.name ?? '') };
    if (typeof d.grade === 'number') s.grade = d.grade;
    students.push(s);
  }
  return { cls, students };
}

/** 한 학생의 한 세션 출결을 upsert. 선생님 직접 저장·QR 체크인 공용. */
export async function upsertAttendance(
  db: Db,
  rec: {
    userId: ObjectId;
    classId: ObjectId;
    date: string;
    sessionLabel: string;
    studentId: ObjectId;
    studentName: string;
    status: AttendanceStatus;
    reason?: AbsenceReason | null;
    memo?: string;
    source: 'teacher' | 'qr';
    checkedInAt?: Date | null;
  },
): Promise<void> {
  await db.collection<VipAttendance>(VIP_ATTENDANCES_COLLECTION).updateOne(
    {
      userId: rec.userId,
      classId: rec.classId,
      date: rec.date,
      sessionLabel: rec.sessionLabel,
      studentId: rec.studentId,
    },
    {
      $set: {
        studentName: rec.studentName,
        status: rec.status,
        reason: rec.reason ?? null,
        memo: rec.memo ?? '',
        source: rec.source,
        checkedInAt: rec.checkedInAt ?? null,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        userId: rec.userId,
        classId: rec.classId,
        date: rec.date,
        sessionLabel: rec.sessionLabel,
        studentId: rec.studentId,
      },
    },
    { upsert: true },
  );
}

/** token 으로 열린 체크인 세션 조회(닫혔으면 open=false 그대로 반환, 라우트에서 판단). */
export async function getCheckinSessionByToken(
  db: Db,
  token: string,
): Promise<VipCheckinSession | null> {
  const t = (token ?? '').trim();
  if (!t) return null;
  return db.collection<VipCheckinSession>(VIP_CHECKIN_SESSIONS_COLLECTION).findOne({ token: t });
}
