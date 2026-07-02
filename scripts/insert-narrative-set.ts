/**
 * 새 서술형(주제완성형) narrative_questions 를 작성·삽입. Pro 직접 작성(API 키 없음).
 * draft JSON: [{ passageId, 주제틀, 주어진표현, 모범답안, 최소단어수, 해설, 점수?, subjSet }]
 * 본문·교재·강·번호는 passages 에서 자동 보강, 완전한문제·답안단어수 자동 계산.
 *
 *   npx tsx scripts/insert-narrative-set.ts <draft.json> [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

loadCliEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const out = (o: unknown) => console.log(JSON.stringify(o, null, 2));
const die = (m: string): never => { console.error(m); process.exit(1); };
const wc = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const COND = '① 빈칸에 다음의 표현들을 반드시 이용하시오.(변형불가)\n② 위 표현들을 포함하여 6단어 이상으로 답안을 작성하시오.\n③ 완성된 주제가 명사구의 형태가 되도록 답안을 작성하시오.';

async function main() {
  const file = process.argv[2]; if (!file) die('draft.json 필요');
  const dryRun = process.argv.includes('--dry-run');
  let raw = fs.readFileSync(path.resolve(file), 'utf8').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const items = JSON.parse(raw) as Record<string, unknown>[];
  if (!Array.isArray(items) || items.length === 0) die('배열 필요');

  const db = await getDb('gomijoshua');
  const docs: Record<string, unknown>[] = [];
  const errors: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const o = items[i];
    const pid = String(o.passageId ?? '');
    if (!ObjectId.isValid(pid)) { errors.push(`#${i + 1}: passageId 오류`); continue; }
    const p = await db.collection('passages').findOne({ _id: new ObjectId(pid) }, { projection: { textbook: 1, source_key: 1, chapter: 1, number: 1, 'content.original': 1 } });
    if (!p) { errors.push(`#${i + 1}: 지문 없음 ${pid}`); continue; }
    const 본문 = String((p.content as { original?: unknown } | undefined)?.original ?? '').replace(/\s+/g, ' ').trim();
    const 주제틀 = String(o['주제틀'] ?? '').trim();
    const 모범답안 = String(o['모범답안'] ?? '').trim();
    const 주어진표현 = String(o['주어진표현'] ?? '').trim();
    const 해설 = String(o['해설'] ?? '').trim();
    if (!본문 || !주제틀 || !모범답안 || !주어진표현) { errors.push(`#${i + 1}: 필수 필드 누락`); continue; }
    // 모범답안이 주어진표현(슬래시 구분)을 모두 포함하는지 검사
    const exprs = 주어진표현.split('/').map((s) => s.trim()).filter(Boolean);
    const lowAns = 모범답안.toLowerCase();
    const missing = exprs.filter((e) => !lowAns.includes(e.toLowerCase()));
    if (missing.length) errors.push(`#${i + 1}: 모범답안에 표현 누락 [${missing.join(', ')}]`);
    const sk = String(p.source_key ?? '');
    const 강 = String(p.chapter ?? '').trim() || (sk.match(/^(Lesson \d+|UNIT \d+)/)?.[1] ?? '');
    const 번호 = String(p.number ?? '').trim() || (sk.match(/(\d+)번\s*$/)?.[0] ?? sk);
    docs.push({
      textbook: String(p.textbook ?? ''), passage_id: new ObjectId(pid),
      chapter: 강, number: 번호, narrative_subtype: '주제완성형',
      question_data: {
        번호: 번호, 강: 강, 문제유형: '주제완성형', 점수: Number(o['점수']) || 5,
        문제: '주어진 글 속의 어구를 활용하여, 다음 글의 주제를 완성하시오. [5점]',
        본문, 원문: 본문, 주제틀, 주어진표현, 최소단어수: Number(o['최소단어수']) || 6,
        모범답안, 완전한문제: `${주제틀} ${모범답안}`.replace(/\s+/g, ' ').trim(), 답안단어수: wc(모범답안),
        조건: COND, 해설, 처리상태: '성공',
      },
      source_file: 'claude-code', source_key_matched: sk, excel_row_status: 'claude-authored',
      authored_by: 'claude-code', status: '완료', subj_set: String(o.subjSet ?? ''),
    });
  }
  if (errors.length) die('검증 실패:\n  ' + errors.join('\n  '));
  if (dryRun) { out({ dryRun: true, count: docs.length, sample: docs.map((d) => ({ src: d.source_key_matched, 완전한문제: (d.question_data as Record<string, unknown>)['완전한문제'], 답안단어수: (d.question_data as Record<string, unknown>)['답안단어수'], subj_set: d.subj_set })) }); process.exit(0); }
  const now = new Date();
  const r = await db.collection('narrative_questions').insertMany(docs.map((d) => ({ ...d, created_at: now })));
  out({ ok: true, inserted: r.insertedCount, subjSet: docs[0]?.subj_set });
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
