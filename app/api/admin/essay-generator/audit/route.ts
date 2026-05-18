import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { auditExam, applyFixes } from '@/lib/essay-exam-audit';
import { auditContent } from '@/lib/essay-exam-content-audit';
import { EssayExamDoc } from '@/lib/essay-exams-store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/essay-generator/audit
 * body:
 *   { passageId?: string, textbook?: string, examId?: string, folder?: string,
 *     fix?: boolean, dryRun?: boolean }
 *
 * 셋 중 하나는 필수: passageId | textbook | examId | folder.
 * fix=true 면 자동 수정 적용 (dryRun=true 면 적용은 안 하고 미리보기).
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: {
    passageId?: string;
    textbook?: string;
    examId?: string;
    folder?: string;
    fix?: boolean;
    dryRun?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  const { passageId, textbook, examId, folder, fix = false, dryRun = false } = body;
  if (!passageId && !textbook && !examId && !folder) {
    return NextResponse.json(
      { error: 'passageId | textbook | examId | folder 중 하나가 필요합니다.' },
      { status: 400 },
    );
  }

  try {
    const db = await getDb('gomijoshua');
    const query: Record<string, unknown> = { isPlaceholder: { $ne: true } };
    if (passageId) query.passageId = passageId;
    if (textbook) query.textbook = textbook;
    if (examId) {
      if (!ObjectId.isValid(examId)) {
        return NextResponse.json({ error: 'examId 가 유효한 ObjectId 가 아닙니다.' }, { status: 400 });
      }
      query._id = new ObjectId(examId);
    }
    if (folder) query.folder = folder;

    const docs = await db.collection('essay_exams').find(query).toArray();

    const passageLookup = async (pid: string) => {
      try {
        if (!ObjectId.isValid(pid)) return null;
        const p = await db.collection('passages').findOne(
          { _id: new ObjectId(pid) },
          { projection: { textbook: 1, source_key: 1 } },
        );
        if (!p) return null;
        return {
          textbook: (p as { textbook?: string }).textbook,
          source_key: (p as { source_key?: string }).source_key,
        };
      } catch {
        return null;
      }
    };

    const items = [];
    for (const raw of docs) {
      const { _id, ...rest } = raw as EssayExamDoc & { _id: ObjectId };
      const doc = { ...rest, _id: String(_id) } as EssayExamDoc & { _id: string };
      const result = await auditExam(doc, { passageLookup });
      /* 내용 점검을 함께 실행해 findings 에 병합 (정량 + 내용) */
      const contentResult = auditContent(doc);
      const mergedFindings = [...result.findings, ...contentResult.findings];
      const entry: Record<string, unknown> = {
        examId: result.examId,
        textbook: result.textbook,
        sourceKey: result.sourceKey,
        difficulty: result.difficulty,
        folder: result.folder,
        findings: mergedFindings,
        validatorPassed: result.validatorPassed,
        htmlStale: result.htmlStale,
        hasFixable: result.hasFixable,
      };

      if (fix && result.hasFixable) {
        const fixed = applyFixes(doc);
        if (dryRun) {
          entry.fix = { applied: fixed.applied, saved: false, dryRun: true };
        } else {
          await db.collection('essay_exams').updateOne(
            { _id: new ObjectId(result.examId) },
            { $set: { data: fixed.data, html: fixed.html, updatedAt: new Date() } },
          );
          entry.fix = { applied: fixed.applied, saved: true, dryRun: false };
        }
      }
      items.push(entry);
    }

    /* 코드별 빈도 (UI 가 "주요 누설 패턴" 표시할 수 있도록) */
    const codeFreq = new Map<string, number>();
    for (const o of items) {
      for (const f of o.findings as { code: string }[]) {
        codeFreq.set(f.code, (codeFreq.get(f.code) ?? 0) + 1);
      }
    }

    const summary = {
      total: items.length,
      clean: items.filter(o => (o.findings as unknown[]).length === 0).length,
      with_errors: items.filter(o => (o.findings as { level: string }[]).some(f => f.level === 'error')).length,
      with_warnings: items.filter(o => (o.findings as { level: string }[]).some(f => f.level === 'warning')).length,
      fixable: items.filter(o => o.hasFixable).length,
      fixed: fix ? items.filter(o => (o.fix as { saved?: boolean } | undefined)?.saved).length : 0,
      code_frequency: Object.fromEntries([...codeFreq.entries()].sort((a, b) => b[1] - a[1])),
    };

    return NextResponse.json({ ok: true, fixMode: fix, dryRun, summary, items });
  } catch (e) {
    console.error('[essay-generator audit]', e);
    return NextResponse.json({ error: '점검 실패' }, { status: 500 });
  }
}
