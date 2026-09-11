import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { writeVariantBackup } from '@/lib/order-answer-sequence';

/**
 * 지문 원문 오탈자 교정 — 지문(passages.content 의 모든 문자열·문자열 배열 필드)과
 * 그 지문에서 파생된 변형문항(generated_questions 의 Paragraph·Options·Explanation·Question)을 함께 고친다.
 * 원문만 고치면 어법 「비정답 칸 = 원문」·순서 원문 복원 대조가 깨지므로 둘을 같이 바꾼다.
 * 교정할 문자열이 어법 <u> 밑줄 안에 걸리면 자동으로 바꾸지 않고 표시만 한다.
 *
 *   npx tsx scripts/fix-passage-typo.ts --fix "<passageId>|<틀린 문자열>|<고친 문자열>" [--fix …] [--apply]
 *
 * 짧은 문자열은 다른 곳까지 걸릴 수 있으니 dry-run 에서 문맥을 확인하고, 필요하면 앞뒤 단어를 붙여 좁힌다.
 */

type Doc = Record<string, unknown>;

function context(s: string, i: number, n: number): string {
  return s.slice(Math.max(0, i - 30), i + n + 30).replace(/\n/g, ' ⏎ ');
}

function insideUnderline(s: string, idx: number): boolean {
  return s.lastIndexOf('<u>', idx) > s.lastIndexOf('</u>', idx);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const fixes: { pid: string; from: string; to: string }[] = [];
  args.forEach((a, i) => {
    if (a !== '--fix') return;
    const [pid, from, to] = String(args[i + 1] ?? '').split('|');
    if (!/^[0-9a-f]{24}$/i.test(pid ?? '') || !from || to === undefined) throw new Error(`--fix 형식 오류: ${args[i + 1]}`);
    fixes.push({ pid, from, to });
  });
  if (!fixes.length) {
    console.log('사용법: npx tsx scripts/fix-passage-typo.ts --fix "<passageId>|<틀린 문자열>|<고친 문자열>" [--fix …] [--apply]');
    process.exit(1);
  }

  const db = await getDb('gomijoshua');
  const backup: Doc[] = [];
  let planned = 0;
  let applied = 0;
  for (const f of fixes) {
    const p = (await db.collection('passages').findOne({ _id: new ObjectId(f.pid) })) as Doc | null;
    if (!p) {
      console.log(`✗ 지문 없음 ${f.pid}`);
      continue;
    }
    console.log(`\n═══ ${String(p.source_key ?? f.pid)} : 「${f.from}」 → 「${f.to}」`);
    const content = (p.content ?? {}) as Doc;
    const passageSet: Doc = {};
    for (const [key, v] of Object.entries(content)) {
      if (typeof v === 'string' && v.includes(f.from)) {
        for (let i = v.indexOf(f.from); i >= 0; i = v.indexOf(f.from, i + 1)) {
          console.log(`  passage.content.${key}: …${context(v, i, f.from.length)}…`);
        }
        passageSet[`content.${key}`] = v.split(f.from).join(f.to);
      } else if (Array.isArray(v) && v.some((s) => typeof s === 'string' && s.includes(f.from))) {
        v.forEach((s, n) => {
          if (typeof s === 'string' && s.includes(f.from)) {
            console.log(`  passage.content.${key}[${n}]: …${context(s, s.indexOf(f.from), f.from.length)}…`);
          }
        });
        passageSet[`content.${key}`] = v.map((s) => (typeof s === 'string' ? s.split(f.from).join(f.to) : s));
      }
    }
    if (!Object.keys(passageSet).length) console.log('  (지문 본문에서 찾지 못함)');

    const questions = (await db.collection('generated_questions').find({ passage_id: new ObjectId(f.pid) }).toArray()) as Doc[];
    const questionSets: { id: unknown; set: Doc; label: string; before: unknown }[] = [];
    for (const q of questions) {
      const qd = (q.question_data ?? {}) as Doc;
      const set: Doc = {};
      const notes: string[] = [];
      for (const key of ['Paragraph', 'Options', 'Explanation', 'Question']) {
        const v = qd[key];
        if (typeof v !== 'string' || !v.includes(f.from)) continue;
        if (key === 'Paragraph' && /어법/.test(String(q.type)) && insideUnderline(v, v.indexOf(f.from))) {
          notes.push('⚑ 어법 밑줄 안 — 수동 확인');
          continue;
        }
        set[`question_data.${key}`] = v.split(f.from).join(f.to);
        notes.push(key);
      }
      if (Object.keys(set).length) {
        questionSets.push({ id: q._id, set, label: `${String(q.type)} ${String(q.serialNo ?? '')} [${notes.join(',')}]`, before: q.question_data });
      } else if (notes.length) {
        console.log(`  문항 ${String(q.type)} ${String(q.serialNo ?? '')} ${notes.join(' ')}`);
      }
    }
    for (const u of questionSets) console.log(`  문항 ${u.label}`);
    planned += (Object.keys(passageSet).length ? 1 : 0) + questionSets.length;

    if (apply) {
      backup.push({
        passage: { _id: f.pid, content: p.content },
        questions: questionSets.map((u) => ({ _id: String(u.id), question_data: u.before })),
      });
      if (Object.keys(passageSet).length) {
        applied += (await db.collection('passages').updateOne({ _id: p._id as ObjectId }, { $set: passageSet })).modifiedCount;
      }
      for (const u of questionSets) {
        applied += (await db.collection('generated_questions').updateOne({ _id: u.id as ObjectId }, { $set: u.set })).modifiedCount;
      }
    }
  }
  if (!apply) {
    console.log(`\n변경 예정 ${planned}건 [dry-run] 적용하려면 --apply`);
    process.exit(0);
  }
  console.log(`\n적용 ${applied}/${planned} · 백업 ${writeVariantBackup('passage-typo', backup)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
