/**
 * VIP 학원 데이터 조회용 MCP 서버 (stdio) — 선생님이 본인 Claude(Pro/Max)에 연결해
 * 학생·일정·상담·수강료·수행평가·입시·메모를 "읽기"로 물어볼 수 있게 한다.
 * AI 호출은 선생님 Claude 구독에서 일어나므로 플랫폼 ANTHROPIC API 과금이 없다.
 *
 * 실행:  npx tsx scripts/mcp-next-order-vip.ts
 * Claude Code 등록:
 *   claude mcp add next-order-vip --scope user \
 *     --env VIP_LOGIN_ID=<선생님 로그인ID> --env MONGODB_URI=<...> \
 *     -- npx tsx /절대경로/scripts/mcp-next-order-vip.ts
 *
 * 필요 env: MONGODB_URI, 그리고 VIP_LOGIN_ID(또는 VIP_USER_ID) — 어느 선생님 데이터인지 지정.
 * 모든 도구는 그 선생님(userId) 데이터만 조회한다(읽기 전용 — 쓰기/삭제 없음).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';
import { ObjectId, type Db } from 'mongodb';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import { getDb } from '@/lib/mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
loadCliEnv(PROJECT_ROOT);

/** 컬렉션명 (lib/*-store.ts 와 동일). */
const COL = {
  users: 'users',
  students: 'vip_students',
  scores: 'vip_student_scores',
  tuition: 'vip_tuition_invoices',
  schedules: 'vip_schedules',
  counselings: 'vip_counselings',
  assessments: 'vip_assessments',
  admissions: 'vip_admissions',
  memos: 'vip_memos',
  savedQuestions: 'vip_saved_questions',
} as const;

function textResult(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] };
}
function textError(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: message }) }], isError: true as const };
}
function ymd(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function ym(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function escRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let _uid: ObjectId | null | undefined;
let _teacher: { name: string; loginId: string } | null = null;

/** VIP_LOGIN_ID / VIP_USER_ID env 로 선생님(userId) 결정 (캐시). */
async function resolveUserId(db: Db): Promise<ObjectId> {
  if (_uid instanceof ObjectId) return _uid;
  if (_uid === null) throw new Error('VIP 선생님 계정을 찾을 수 없습니다. VIP_LOGIN_ID 환경변수를 확인하세요.');
  const rawId = (process.env.VIP_USER_ID || '').trim();
  const loginId = (process.env.VIP_LOGIN_ID || '').trim();
  type TeacherDoc = { _id: ObjectId; name?: string; loginId?: string };
  let user: TeacherDoc | null = null;
  if (rawId && ObjectId.isValid(rawId)) {
    user = (await db.collection(COL.users).findOne({ _id: new ObjectId(rawId), isVip: true }, { projection: { name: 1, loginId: 1 } })) as TeacherDoc | null;
  } else if (loginId) {
    user = (await db.collection(COL.users).findOne({ loginId, isVip: true }, { projection: { name: 1, loginId: 1 } })) as TeacherDoc | null;
  } else {
    _uid = null;
    throw new Error('VIP_LOGIN_ID(또는 VIP_USER_ID) 환경변수로 어느 선생님인지 지정해야 합니다.');
  }
  if (!user) { _uid = null; throw new Error('해당 VIP 선생님 계정을 찾을 수 없거나 VIP 권한이 아닙니다.'); }
  _uid = user._id;
  _teacher = { name: String(user.name ?? ''), loginId: String(user.loginId ?? '') };
  return user._id;
}

async function main() {
  const server = new McpServer({ name: 'next-order-vip', version: '1.0.0' });

  // 0) 연결 확인 — 어느 선생님인지
  server.registerTool(
    'vip_whoami',
    { description: '현재 MCP가 연결된 VIP 선생님(이름·로그인ID)을 확인. 가장 먼저 호출해 스코프를 확인.', inputSchema: {} },
    async () => {
      try {
        const db = await getDb('gomijoshua');
        const uid = await resolveUserId(db);
        return textResult({ ok: true, userId: String(uid), name: _teacher?.name, loginId: _teacher?.loginId });
      } catch (e) { return textError(e instanceof Error ? e.message : '확인 실패'); }
    }
  );

  // 1) 대시보드 개요
  server.registerTool(
    'vip_overview',
    { description: '학원 현황 한눈에: 재원 학생 수, 예정 상담 수, 이번 달 미납 수강료 합계·건수, 다가오는 일정 수, 미완료 수행평가 수.', inputSchema: {} },
    async () => {
      try {
        const db = await getDb('gomijoshua');
        const uid = await resolveUserId(db);
        const today = ymd();
        const month = ym();
        const [activeStudents, upcomingCounsel, unpaid, upcomingSchedule, openAssess] = await Promise.all([
          db.collection(COL.students).countDocuments({ userId: uid, status: { $ne: 'inactive' } }),
          db.collection(COL.counselings).countDocuments({ userId: uid, status: '예정' }),
          db.collection(COL.tuition).find({ userId: uid, status: 'unpaid' }).project({ amount: 1, month: 1 }).limit(2000).toArray(),
          db.collection(COL.schedules).countDocuments({ userId: uid, date: { $gte: today } }),
          db.collection(COL.assessments).countDocuments({ userId: uid, status: { $ne: '완료' } }),
        ]);
        const unpaidTotal = unpaid.reduce((s, i) => s + (typeof i.amount === 'number' ? i.amount : 0), 0);
        const unpaidThisMonth = unpaid.filter((i) => i.month === month);
        return textResult({
          ok: true,
          teacher: _teacher?.name,
          activeStudents,
          upcomingCounselings: upcomingCounsel,
          unpaidTuition: { count: unpaid.length, totalWon: unpaidTotal, thisMonthCount: unpaidThisMonth.length },
          upcomingSchedules: upcomingSchedule,
          openAssessments: openAssess,
          asOf: today,
        });
      } catch (e) { return textError(e instanceof Error ? e.message : '개요 조회 실패'); }
    }
  );

  // 2) 학생 목록
  server.registerTool(
    'vip_list_students',
    {
      description: '재원 학생 목록(이름·학교·학년·연락처). q로 이름 검색.',
      inputSchema: {
        q: z.string().optional().describe('이름/학교 검색어'),
        includeInactive: z.boolean().optional().describe('퇴원생 포함 (기본 false)'),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ q, includeInactive, limit }) => {
      try {
        const db = await getDb('gomijoshua');
        const uid = await resolveUserId(db);
        const filter: Record<string, unknown> = { userId: uid };
        if (!includeInactive) filter.status = { $ne: 'inactive' };
        if (q && q.trim()) { const r = { $regex: escRegex(q.trim()), $options: 'i' }; filter.$or = [{ name: r }, { schoolName: r }]; }
        const rows = await db.collection(COL.students).find(filter).project({ name: 1, grade: 1, schoolName: 1, phone: 1, parentPhone: 1, status: 1 }).sort({ name: 1 }).limit(limit ?? 200).toArray();
        return textResult({ ok: true, count: rows.length, students: rows.map((s) => ({ id: String(s._id), name: s.name, grade: s.grade ?? null, school: s.schoolName ?? '', phone: s.phone ?? '', parentPhone: s.parentPhone ?? '', status: s.status ?? 'active' })) });
      } catch (e) { return textError(e instanceof Error ? e.message : '학생 조회 실패'); }
    }
  );

  // 3) 학생 1명 상세 (성적 포함)
  server.registerTool(
    'vip_get_student',
    {
      description: '학생 1명 상세 + 최근 성적. studentId 또는 name으로 조회.',
      inputSchema: { studentId: z.string().optional(), name: z.string().optional() },
    },
    async ({ studentId, name }) => {
      try {
        const db = await getDb('gomijoshua');
        const uid = await resolveUserId(db);
        let student: Record<string, unknown> | null = null;
        if (studentId && ObjectId.isValid(studentId)) student = await db.collection(COL.students).findOne({ _id: new ObjectId(studentId), userId: uid });
        else if (name && name.trim()) student = await db.collection(COL.students).findOne({ userId: uid, name: name.trim() });
        if (!student) return textError('학생을 찾을 수 없습니다. studentId 또는 정확한 name이 필요합니다.');
        const sid = student._id as ObjectId;
        const scores = await db.collection(COL.scores).find({ userId: uid, studentId: sid }).sort({ date: -1, createdAt: -1 }).limit(20).toArray();
        return textResult({
          ok: true,
          student: { id: String(sid), name: student.name, grade: student.grade ?? null, school: student.schoolName ?? '', phone: student.phone ?? '', parentPhone: student.parentPhone ?? '', status: student.status ?? 'active' },
          recentScores: scores.map((s) => ({ exam: s.examName ?? s.title ?? '', subject: s.subject ?? '', score: s.score ?? s.value ?? null, date: s.date ?? '' })),
        });
      } catch (e) { return textError(e instanceof Error ? e.message : '학생 상세 조회 실패'); }
    }
  );

  // 4) 일정 (다가오는/월별)
  server.registerTool(
    'vip_schedule',
    {
      description: '학원 일정. 기본은 오늘 이후 다가오는 일정. month(YYYY-MM)·category로 좁힐 수 있음.',
      inputSchema: {
        month: z.string().optional().describe('YYYY-MM'),
        category: z.string().optional().describe('수업/시험/상담/행사/휴원/기타'),
        upcomingOnly: z.boolean().optional().describe('오늘 이후만 (기본 true)'),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ month, category, upcomingOnly, limit }) => {
      try {
        const db = await getDb('gomijoshua');
        const uid = await resolveUserId(db);
        const filter: Record<string, unknown> = { userId: uid };
        if (month && /^\d{4}-\d{2}$/.test(month)) filter.date = { $regex: '^' + month };
        else if (upcomingOnly !== false) filter.date = { $gte: ymd() };
        if (category) filter.category = category;
        const rows = await db.collection(COL.schedules).find(filter).sort({ date: 1, time: 1 }).limit(limit ?? 100).toArray();
        return textResult({ ok: true, count: rows.length, schedules: rows.map((s) => ({ date: s.date, time: s.time ?? '', category: s.category, title: s.title, description: s.description ?? '' })) });
      } catch (e) { return textError(e instanceof Error ? e.message : '일정 조회 실패'); }
    }
  );

  // 5) 상담 (예정/완료)
  server.registerTool(
    'vip_counseling',
    {
      description: '상담 목록. status=예정(다가오는 상담)/완료(기록). studentName으로 학생 좁히기.',
      inputSchema: { status: z.enum(['예정', '완료']).optional(), studentName: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
    },
    async ({ status, studentName, limit }) => {
      try {
        const db = await getDb('gomijoshua');
        const uid = await resolveUserId(db);
        const filter: Record<string, unknown> = { userId: uid };
        if (status === '예정') filter.status = '예정';
        else if (status === '완료') filter.status = { $ne: '예정' };
        if (studentName && studentName.trim()) filter.studentName = { $regex: escRegex(studentName.trim()), $options: 'i' };
        const sort: Record<string, 1 | -1> = status === '예정' ? { date: 1, time: 1 } : { date: -1 };
        const rows = await db.collection(COL.counselings).find(filter).sort(sort).limit(limit ?? 50).toArray();
        return textResult({ ok: true, count: rows.length, counselings: rows.map((c) => ({ student: c.studentName, date: c.date, time: c.time ?? '', status: c.status === '예정' ? '예정' : '완료', type: c.type, content: c.content ?? '', nextPlan: c.nextPlan ?? '' })) });
      } catch (e) { return textError(e instanceof Error ? e.message : '상담 조회 실패'); }
    }
  );

  // 6) 수강료 (미납 등)
  server.registerTool(
    'vip_tuition',
    {
      description: '수강료 청구 현황. 기본은 미납(unpaid). month(YYYY-MM)로 좁히고, 학생 이름까지 합쳐 합계도 반환.',
      inputSchema: { status: z.enum(['unpaid', 'paid', 'all']).optional(), month: z.string().optional(), limit: z.number().int().min(1).max(500).optional() },
    },
    async ({ status, month, limit }) => {
      try {
        const db = await getDb('gomijoshua');
        const uid = await resolveUserId(db);
        const filter: Record<string, unknown> = { userId: uid };
        if (!status || status === 'unpaid') filter.status = 'unpaid';
        else if (status === 'paid') filter.status = 'paid';
        if (month && /^\d{4}-\d{2}$/.test(month)) filter.month = month;
        const rows = await db.collection(COL.tuition).find(filter).sort({ month: -1 }).limit(limit ?? 300).toArray();
        // 학생 이름 조인
        const sids = [...new Set(rows.map((r) => String(r.studentId)).filter(Boolean))].map((s) => new ObjectId(s));
        const students = sids.length ? await db.collection(COL.students).find({ _id: { $in: sids } }).project({ name: 1 }).toArray() : [];
        const nameById = new Map(students.map((s) => [String(s._id), String(s.name ?? '')]));
        const total = rows.reduce((s, r) => s + (typeof r.amount === 'number' ? r.amount : 0), 0);
        return textResult({ ok: true, count: rows.length, totalWon: total, invoices: rows.map((r) => ({ student: nameById.get(String(r.studentId)) ?? '(알수없음)', month: r.month, amount: r.amount, status: r.status })) });
      } catch (e) { return textError(e instanceof Error ? e.message : '수강료 조회 실패'); }
    }
  );

  // 7) 수행평가
  server.registerTool(
    'vip_assessments',
    {
      description: '학교 수행평가 일정. status=예정/진행/완료. 기본은 미완료(예정+진행).',
      inputSchema: { status: z.enum(['예정', '진행', '완료', 'open']).optional(), limit: z.number().int().min(1).max(200).optional() },
    },
    async ({ status, limit }) => {
      try {
        const db = await getDb('gomijoshua');
        const uid = await resolveUserId(db);
        const filter: Record<string, unknown> = { userId: uid };
        if (status === '예정' || status === '진행' || status === '완료') filter.status = status;
        else filter.status = { $ne: '완료' };
        const rows = await db.collection(COL.assessments).find(filter).sort({ dueDate: 1, createdAt: -1 }).limit(limit ?? 100).toArray();
        return textResult({ ok: true, count: rows.length, assessments: rows.map((a) => ({ title: a.title, subject: a.subject ?? '', school: a.school ?? '', grade: a.grade ?? '', type: a.type, dueDate: a.dueDate ?? '', status: a.status, description: a.description ?? '' })) });
      } catch (e) { return textError(e instanceof Error ? e.message : '수행평가 조회 실패'); }
    }
  );

  // 8) 입시 현황
  server.registerTool(
    'vip_admissions',
    {
      description: '학생별 입시 현황(대학·학과·전형·지원/합불). status로 좁히기.',
      inputSchema: { status: z.string().optional().describe('준비/지원/1차합격/최종합격/불합격/등록'), studentName: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
    },
    async ({ status, studentName, limit }) => {
      try {
        const db = await getDb('gomijoshua');
        const uid = await resolveUserId(db);
        const filter: Record<string, unknown> = { userId: uid };
        if (status) filter.status = status;
        if (studentName && studentName.trim()) filter.studentName = { $regex: escRegex(studentName.trim()), $options: 'i' };
        const rows = await db.collection(COL.admissions).find(filter).sort({ targetDate: 1, createdAt: -1 }).limit(limit ?? 100).toArray();
        return textResult({ ok: true, count: rows.length, admissions: rows.map((a) => ({ student: a.studentName, university: a.university, department: a.department, track: a.track, status: a.status, targetDate: a.targetDate ?? '', memo: a.memo ?? '' })) });
      } catch (e) { return textError(e instanceof Error ? e.message : '입시 조회 실패'); }
    }
  );

  // 9) 메모 검색
  server.registerTool(
    'vip_memo_search',
    {
      description: '메모장 검색(제목·내용). q 없으면 최근 메모.',
      inputSchema: { q: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
    },
    async ({ q, limit }) => {
      try {
        const db = await getDb('gomijoshua');
        const uid = await resolveUserId(db);
        const filter: Record<string, unknown> = { userId: uid };
        if (q && q.trim()) { const r = { $regex: escRegex(q.trim()), $options: 'i' }; filter.$or = [{ title: r }, { content: r }]; }
        const rows = await db.collection(COL.memos).find(filter).sort({ pinned: -1, updatedAt: -1 }).limit(limit ?? 50).toArray();
        return textResult({ ok: true, count: rows.length, memos: rows.map((m) => ({ title: m.title ?? '', content: m.content ?? '', pinned: !!m.pinned, color: m.color ?? 'default' })) });
      } catch (e) { return textError(e instanceof Error ? e.message : '메모 조회 실패'); }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr 로만 로그 (stdout은 JSON-RPC 전용)
  process.stderr.write('[next-order-vip] MCP server ready (read-only VIP data)\n');
}

main().catch((e) => {
  process.stderr.write(`[next-order-vip] fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
