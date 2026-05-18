/**
 * 저장된 essay_exams 문서의 html 을 현재 렌더러 로직으로 다시 빌드해서 업데이트.
 *
 * 사용:
 *   npx tsx scripts/rerender-essay-exam.ts <_id> [<_id> ...]
 *
 * - data.meta 를 그대로 두고 applyExamMetaOverrides + buildExamHtml 만 재실행.
 * - examSubtitle 은 doc.sourceKey 로 override (교재명 + 번호 모두 노출).
 * - schoolName / grade 는 override 없이 — 기존 doc 값 우선, 없으면 빈 입력란.
 * - 문항 데이터 (questions·answers) 는 건드리지 않음.
 */
import { ObjectId } from 'mongodb';
import { readFileSync } from 'fs';
import path from 'path';
import { config } from 'dotenv';

const PROJECT_ROOT = path.resolve(__dirname, '..');
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

import { getDb } from '@/lib/mongodb';
import { applyExamMetaOverrides, buildExamHtml } from '@/lib/essay-exam-html';
import type { ExamData } from '@/lib/essay-exam-html';

async function main() {
  const ids = process.argv.slice(2).filter(Boolean);
  if (ids.length === 0) {
    console.error('사용: npx tsx scripts/rerender-essay-exam.ts <_id> [<_id> ...]');
    process.exit(1);
  }

  const cssPath = path.join(process.cwd(), 'assets/exam_kit/styles.css');
  const css = readFileSync(cssPath, 'utf-8');

  const db = await getDb('gomijoshua');
  const col = db.collection('essay_exams');

  for (const id of ids) {
    if (!ObjectId.isValid(id)) {
      console.error(`[skip] invalid _id: ${id}`);
      continue;
    }
    const oid = new ObjectId(id);
    const doc = await col.findOne({ _id: oid });
    if (!doc) {
      console.error(`[skip] not found: ${id}`);
      continue;
    }

    const data = doc.data as ExamData | undefined;
    if (!data) {
      console.error(`[skip] no data field: ${id}`);
      continue;
    }
    const sourceKey = String((doc as { sourceKey?: string }).sourceKey ?? '').trim();

    /* tag 정규화: "서·논술형 1" → "서·논술형" (뒤 숫자 제거) */
    if (data.question_set?.tag) {
      data.question_set.tag = data.question_set.tag.replace(/\s*\d+\s*$/, '').trim() || '서·논술형';
    }
    /* question id 정규화: "서·논술형 1-N" → "서·논술형-N" */
    if (Array.isArray(data.questions)) {
      for (const q of data.questions) {
        if (typeof q.id === 'string') {
          q.id = q.id.replace(/^(서·논술형)\s+\d+(-\d+)$/, '$1$2');
        }
      }
    }

    const finalData = applyExamMetaOverrides(data, {
      examSubtitle: sourceKey || undefined,
    });
    const html = buildExamHtml(finalData, css);

    await col.updateOne(
      { _id: oid },
      { $set: { data: finalData, html, updatedAt: new Date() } },
    );
    console.log(`[ok] ${id} re-rendered — ${html.length.toLocaleString()} bytes, subtitle="${finalData.meta.subtitle}"`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
