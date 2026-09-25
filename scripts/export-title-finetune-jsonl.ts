/**
 * 제목 유형 파인튜닝용 JSONL export (Claude/Anthropic 호출 없음).
 *
 *   npm run cc:title-export
 *   npm run cc:title-export -- --status 완료 --out data/title-finetune
 *
 * 출력: <out>/train.jsonl, <out>/valid.jsonl
 * 형식: mlx-lm chat JSONL ({ messages: [system, user, assistant] })
 * 분할: passage_id 기준 90/10 (같은 지문이 train·valid에 동시에 안 들어가게)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { loadCliEnv } from './_cli-env';
import { createEvalSetFilter } from './_eval-set-filter';
import { getDb } from '@/lib/mongodb';
import { getPassageTextForVariantCompare } from '@/lib/passage-variant-text';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
loadCliEnv(PROJECT_ROOT);

const TITLE_TYPES = ['제목', '제목-고난도'] as const;

const SYSTEM_PROMPT = `당신은 한국 수능 영어 변형문제 출제자입니다. 주어진 영어 지문으로 「제목」 객관식 1문항을 만듭니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Question, Paragraph, Options, CorrectAnswer, Explanation, OptionType

규칙:
1) Paragraph = 입력 지문 원문 그대로. <u> 태그 금지.
2) Question 예: "이 글의 제목으로 가장 적절한 것은?"
3) Options = 영어 5개, 각 7~12단어, 뉴스 헤드라인 스타일(각 선택지는 대문자로 시작), 사이는 오직 ###.
   예: ① Why Practice ... ### ② The Hidden Cost ... ### ③ ... ### ④ ... ### ⑤ ...
4) OptionType = "English"
5) CorrectAnswer = ①~⑤ 중 하나. 고유명사·인명·책제목·우화·비유의 이름 자체를 제목으로 쓰지 말 것 —
   글의 MAIN MESSAGE(핵심 메시지)에 집중.
6) Explanation = 한국어 해설, 450자 이하, CorrectAnswer와 하나의 결론만.`;

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

/** passage_id → 0..1 안정 해시 (분할용) */
function passageBucket(passageId: string): number {
  const h = createHash('sha256').update(passageId).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

function assistantPayload(qd: Record<string, unknown>, paragraph: string): string {
  const body = {
    Question: typeof qd.Question === 'string' ? qd.Question : '이 글의 제목으로 가장 적절한 것은?',
    Paragraph: typeof qd.Paragraph === 'string' && qd.Paragraph.trim() ? qd.Paragraph.trim() : paragraph,
    Options: typeof qd.Options === 'string' ? qd.Options : '',
    CorrectAnswer: typeof qd.CorrectAnswer === 'string' ? qd.CorrectAnswer : '',
    Explanation: typeof qd.Explanation === 'string' ? qd.Explanation : '',
    OptionType: 'English',
  };
  return JSON.stringify(body);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const outDir = path.resolve(PROJECT_ROOT, flags.get('out') || 'data/title-finetune');
  const statusFilter = (flags.get('status') || '완료').trim();
  const includeHard = flags.get('include-hard') === 'true';
  const types = includeHard ? [...TITLE_TYPES] : (['제목'] as string[]);
  const valRatio = Math.min(0.3, Math.max(0.05, Number(flags.get('val-ratio') || '0.1')));

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
      textbook: 1,
      source: 1,
    },
  });

  const passageCache = new Map<string, string>();
  const evalSet = createEvalSetFilter(PROJECT_ROOT);
  type Row = {
    passageId: string;
    paragraph: string;
    assistant: string;
    type: string;
  };
  const rows: Row[] = [];
  let skippedNoPassage = 0;
  let skippedEmptyQd = 0;

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
      // 고정 평가 세트(ml/eval/sets)의 교재는 학습에서 뺀다 — 시험 지문을 외워 푸는 걸 막는다(노트 21과)
      paragraph = evalSet.exclude(passageId, p?.textbook) ? '' : getPassageTextForVariantCompare(p?.content);
      passageCache.set(passageId, paragraph);
    }
    if (evalSet.skip(passageId)) continue;
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

    rows.push({
      passageId,
      paragraph,
      assistant: assistantPayload(qd, paragraph),
      type: String(doc.type ?? '제목'),
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
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `[지문 Paragraph]\n${row.paragraph}` },
        { role: 'assistant', content: row.assistant },
      ],
    });
    if (split === 'valid') validLines.push(line);
    else trainLines.push(line);
  }

  evalSet.report();

  fs.mkdirSync(outDir, { recursive: true });
  const trainPath = path.join(outDir, 'train.jsonl');
  const validPath = path.join(outDir, 'valid.jsonl');
  fs.writeFileSync(trainPath, trainLines.join('\n') + (trainLines.length ? '\n' : ''), 'utf8');
  fs.writeFileSync(validPath, validLines.join('\n') + (validLines.length ? '\n' : ''), 'utf8');

  // mlx-lm --test 용 (valid 복사)
  const testPath = path.join(outDir, 'test.jsonl');
  fs.writeFileSync(testPath, validLines.join('\n') + (validLines.length ? '\n' : ''), 'utf8');

  const meta = {
    exportedAt: new Date().toISOString(),
    types,
    statusFilter,
    valRatio,
    counts: {
      rows: rows.length,
      train: trainLines.length,
      valid: validLines.length,
      passages: passageSplit.size,
      skippedNoPassage,
      skippedEmptyQd,
    },
    outDir,
  };
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify(meta, null, 2));
  if (trainLines.length < 20) {
    console.error(
      `\n경고: train ${trainLines.length}건 — LoRA에 부족할 수 있습니다. --status all 또는 --include-hard 를 검토하세요.`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('실패:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
