/**
 * 주장 해설 전용 파인튜닝 JSONL export (Claude/Anthropic 없음).
 *
 * 입력: 지문 + Options + CorrectAnswer
 * 출력: Explanation 만 (한국어)
 *
 *   npm run cc:claim-explain-export
 *   npm run cc:claim-explain-export -- --status 완료 --out data/claim-explain-finetune
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { loadCliEnv } from './_cli-env';
import { getDb } from '@/lib/mongodb';
import { getPassageTextForVariantCompare } from '@/lib/passage-variant-text';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
loadCliEnv(PROJECT_ROOT);

const CLAIM_TYPES = ['주장', '주장-고난도'] as const;

const EXPLAIN_SYSTEM = `당신은 한국 수능 영어 「주장」 문항의 한국어 해설만 작성합니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Explanation

규칙:
1) Explanation = 한국어만, 450자 이하.
2) 정답(CorrectAnswer)이 왜 필자의 주장인지 한 결론으로 밝힌다.
3) 오답 1~2개를 짧게 왜 아닌지 말할 수 있다.
4) 지문에 없는 내용을 지어내지 않는다.
5) 영어 문장으로만 된 해설 금지.`;

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.replace(/^--/, '');
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, 'true');
    }
  }
  return flags;
}

function passageBucket(passageId: string): number {
  const h = createHash('sha256').update(passageId).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

function hasHangul(s: string): boolean {
  return /[가-힣]/.test(s);
}

function buildUser(paragraph: string, qd: Record<string, unknown>): string {
  const question =
    typeof qd.Question === 'string' && qd.Question.trim()
      ? qd.Question.trim()
      : '이 글에서 글쓴이가 주장하는 바로 가장 적절한 것은?';
  const options = typeof qd.Options === 'string' ? qd.Options : '';
  const answer = typeof qd.CorrectAnswer === 'string' ? qd.CorrectAnswer.trim() : '';
  return [
    '[지문 Paragraph]',
    paragraph,
    '',
    '[Question]',
    question,
    '',
    '[Options]',
    options,
    '',
    '[CorrectAnswer]',
    answer,
    '',
    '위 정답에 대한 한국어 Explanation JSON만 출력하세요.',
  ].join('\n');
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const outDir = path.resolve(PROJECT_ROOT, flags.get('out') || 'data/claim-explain-finetune');
  const statusFilter = (flags.get('status') || '완료').trim();
  const includeHard = flags.get('include-hard') === 'true';
  const types = includeHard ? [...CLAIM_TYPES] : (['주장'] as string[]);
  const valRatio = Math.min(0.3, Math.max(0.05, Number(flags.get('val-ratio') || '0.1')));
  const minExpl = Math.max(20, Number(flags.get('min-expl') || '40'));

  const db = await getDb('gomijoshua');
  const gq = db.collection('generated_questions');
  const passages = db.collection('passages');

  const filter: Record<string, unknown> = { type: { $in: types } };
  if (statusFilter && statusFilter !== 'all') {
    filter.status = statusFilter;
  }

  const cursor = gq.find(filter, {
    projection: {
      passage_id: 1,
      type: 1,
      status: 1,
      question_data: 1,
    },
  });

  const passageCache = new Map<string, string>();
  type Row = { passageId: string; user: string; assistant: string };
  const rows: Row[] = [];
  let skippedNoPassage = 0;
  let skippedEmptyQd = 0;
  let skippedBadExpl = 0;

  for await (const doc of cursor) {
    const pidRaw = doc.passage_id;
    const passageId =
      pidRaw instanceof ObjectId
        ? pidRaw.toString()
        : typeof pidRaw === 'string' && ObjectId.isValid(pidRaw)
          ? new ObjectId(pidRaw).toString()
          : '';
    if (!passageId) {
      skippedNoPassage++;
      continue;
    }

    let paragraph = passageCache.get(passageId);
    if (paragraph === undefined) {
      const p = await passages.findOne({ _id: new ObjectId(passageId) });
      paragraph = getPassageTextForVariantCompare(p?.content);
      passageCache.set(passageId, paragraph);
    }
    if (!paragraph.trim()) {
      skippedNoPassage++;
      continue;
    }

    const qd =
      doc.question_data && typeof doc.question_data === 'object' && !Array.isArray(doc.question_data)
        ? (doc.question_data as Record<string, unknown>)
        : null;
    if (!qd || typeof qd.Options !== 'string' || !String(qd.Options).includes('###')) {
      skippedEmptyQd++;
      continue;
    }
    if (typeof qd.CorrectAnswer !== 'string' || !qd.CorrectAnswer.trim()) {
      skippedEmptyQd++;
      continue;
    }
    const expl = typeof qd.Explanation === 'string' ? qd.Explanation.trim() : '';
    if (!expl || expl.length < minExpl || !hasHangul(expl)) {
      skippedBadExpl++;
      continue;
    }
    const explCut = expl.length > 450 ? expl.slice(0, 450).replace(/\s+\S*$/, '') : expl;

    rows.push({
      passageId,
      user: buildUser(paragraph, qd),
      assistant: JSON.stringify({ Explanation: explCut }),
    });
  }

  const trainLines: string[] = [];
  const validLines: string[] = [];
  const passageSplit = new Map<string, 'train' | 'valid'>();

  for (const row of rows) {
    let split = passageSplit.get(row.passageId);
    if (!split) {
      split = passageBucket(row.passageId) < valRatio ? 'valid' : 'train';
      passageSplit.set(row.passageId, split);
    }
    const line = JSON.stringify({
      messages: [
        { role: 'system', content: EXPLAIN_SYSTEM },
        { role: 'user', content: row.user },
        { role: 'assistant', content: row.assistant },
      ],
    });
    if (split === 'valid') validLines.push(line);
    else trainLines.push(line);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'train.jsonl'),
    trainLines.join('\n') + (trainLines.length ? '\n' : ''),
    'utf8'
  );
  fs.writeFileSync(
    path.join(outDir, 'valid.jsonl'),
    validLines.join('\n') + (validLines.length ? '\n' : ''),
    'utf8'
  );
  fs.writeFileSync(
    path.join(outDir, 'test.jsonl'),
    validLines.join('\n') + (validLines.length ? '\n' : ''),
    'utf8'
  );

  const meta = {
    kind: 'claim-explain-only',
    exportedAt: new Date().toISOString(),
    types,
    statusFilter,
    valRatio,
    minExpl,
    counts: {
      rows: rows.length,
      train: trainLines.length,
      valid: validLines.length,
      passages: passageSplit.size,
      skippedNoPassage,
      skippedEmptyQd,
      skippedBadExpl,
    },
    outDir,
  };
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(meta, null, 2));
  if (trainLines.length < 20) {
    console.error(
      `\n경고: train ${trainLines.length}건 — --status all 또는 --include-hard 를 검토하세요.`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('실패:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
