/**
 * 빈칸 추론 파인튜닝용 JSONL export (Claude/Anthropic 호출 없음).
 *
 *   npm run cc:blank-export
 *   npm run cc:blank-export -- --per-passage 3 --out data/blank-finetune
 *
 * DB 문항의 Paragraph 는 지문의 한 구절을 <u>_____</u> 로 가린 것이다. 원문과 맞대어 가린 구절(Blank)을 되찾아,
 * 모델이 「가릴 구절 + 선지 + 정답 + 해설」만 쓰게 가르친다 — 빈칸 뚫린 지문 전체를 다시 쓰지 않게(노트 15과 ③).
 * 빈칸 뚫기와 Question·OptionType 은 파이프라인(ml/blank/windows/pipeline_blank.py)이 채운다.
 * 이 SYSTEM_PROMPT·사용자 메시지는 pipeline_blank.py 의 것과 한 글자까지 같아야 한다(노트 10과).
 *
 * 출력: <out>/train.jsonl, valid.jsonl, test.jsonl, meta.json — mlx-lm chat JSONL
 * 분할: passage_id 기준 90/10
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

const CIRCLED = '①②③④⑤';

export const SYSTEM_PROMPT = `당신은 한국 수능 영어 변형문제 출제자입니다. 주어진 영어 지문으로 「빈칸 추론」 객관식 1문항을 만듭니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Blank, Options, CorrectAnswer, Explanation

규칙:
1) Blank = 빈칸으로 가릴 지문의 구절. 지문에 있는 그대로 한 글자도 바꾸지 않고 옮긴다. 글의 핵심(요지)을 담은 구절을 고른다.
2) Options = 빈칸에 넣을 영어 구절 5개, 각 앞에 ①~⑤, 사이는 오직 ###. 다섯 모두 빈칸 자리에 문법적으로 들어가야 한다.
3) 정답 선지는 Blank 와 뜻이 같다(그대로 또는 풀어 쓴 말). 오답 4개는 지문의 말을 쓰되 글의 흐름과 어긋난다(반대, 한 사례만, 다른 주장).
4) CorrectAnswer = ①~⑤ 중 하나.
5) Explanation = 한국어 해설, 450자 이하. 빈칸 앞뒤 문맥을 근거로 정답을 설명한다.
6) 지문 전체(Paragraph)는 출력하지 않는다.`;

export function userMessage(paragraph: string): string {
  return `[지문 Paragraph]\n${paragraph}`;
}

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

function bucket(key: string): number {
  const h = createHash('sha256').update(key).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

const HANGUL = /[가-힣]/;
const BLANK_MARK = /<u>\s*_{2,}\s*<\/u>|_{4,}/g;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 빈칸 지문과 원문을 맞대어 가린 구절을 찾는다. 빈칸이 정확히 하나이고 앞뒤가 원문과 이어질 때만. */
function findBlankSpan(blanked: string, original: string): string | null {
  const b = norm(blanked);
  const marks = b.match(BLANK_MARK);
  if (!marks || marks.length !== 1) return null;
  const [before, after] = b.split(BLANK_MARK).map((x) => norm(x.replace(/<\/?u>/g, '')));
  const o = norm(original);
  const head = before.slice(-60);
  const tail = after.slice(0, 60);
  const i = head ? o.indexOf(head) : 0;
  if (i < 0) return null;
  const start = head ? i + head.length : 0;
  const j = tail ? o.indexOf(tail, start) : o.length;
  if (j < 0) return null;
  const span = o.slice(start, j).trim();
  return span || null;
}

function splitOptions(raw: string): string[] {
  const by = (sep: RegExp) => raw.split(sep).map((s) => s.trim()).filter(Boolean);
  if (raw.includes('###')) return by(/###/);
  if (raw.includes('\n')) return by(/\n+/);
  return by(/(?=[①②③④⑤])/);
}

function cleanOptions(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null;
  const parts = splitOptions(raw);
  if (parts.length !== 5) return null;
  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    const body = parts[i].replace(/^[①②③④⑤]\s*/, '').trim();
    const words = body.split(/\s+/).length;
    if (!body || HANGUL.test(body) || words < 1 || words > 30) return null;
    out.push(`${CIRCLED[i]} ${body}`);
  }
  return out;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const outDir = path.resolve(PROJECT_ROOT, flags.get('out') || 'data/blank-finetune');
  const perPassage = Math.max(1, Number(flags.get('per-passage') || '3'));
  const valRatio = Math.min(0.3, Math.max(0.05, Number(flags.get('val-ratio') || '0.1')));

  const db = await getDb('gomijoshua');
  const gq = db.collection('generated_questions');
  const passages = db.collection('passages');
  const cursor = gq.find(
    { type: '빈칸', status: '완료', option_type: 'English' },
    { projection: { passage_id: 1, question_data: 1 } }
  );

  const passageCache = new Map<string, string>();
  const evalSet = createEvalSetFilter(PROJECT_ROOT);
  type Row = { passageId: string; paragraph: string; assistant: string; order: number; answer: string; spanWords: number };
  const rows: Row[] = [];
  const skipped = { noPassage: 0, badOptions: 0, badAnswer: 0, noSpan: 0, badSpan: 0, badExplanation: 0 };

  for await (const doc of cursor) {
    const pidRaw = doc.passage_id;
    const passageId =
      pidRaw instanceof ObjectId
        ? pidRaw.toString()
        : typeof pidRaw === 'string' && ObjectId.isValid(pidRaw)
          ? new ObjectId(pidRaw).toString()
          : '';
    if (!passageId) {
      skipped.noPassage++;
      continue;
    }
    const qd =
      doc.question_data && typeof doc.question_data === 'object' && !Array.isArray(doc.question_data)
        ? (doc.question_data as Record<string, unknown>)
        : {};
    const options = cleanOptions(qd.Options);
    if (!options) {
      skipped.badOptions++;
      continue;
    }
    const answer = String(qd.CorrectAnswer ?? '').trim();
    if (answer.length !== 1 || !CIRCLED.includes(answer)) {
      skipped.badAnswer++;
      continue;
    }
    const explanation = String(qd.Explanation ?? '').trim();
    if (!HANGUL.test(explanation) || explanation.length < 30 || explanation.length > 450) {
      skipped.badExplanation++;
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
      skipped.noPassage++;
      continue;
    }
    const span = findBlankSpan(String(qd.Paragraph ?? ''), paragraph);
    if (!span) {
      skipped.noSpan++;
      continue;
    }
    const spanWords = span.split(/\s+/).length;
    // 너무 짧은(한 단어 — 어휘 문제에 가깝다)·너무 긴(두 문장 넘게) 빈칸은 뺀다
    if (spanWords < 2 || spanWords > 35 || HANGUL.test(span) || !norm(paragraph).includes(span)) {
      skipped.badSpan++;
      continue;
    }
    rows.push({
      passageId,
      paragraph,
      answer,
      spanWords,
      order: bucket(`${passageId}|${String(doc._id)}`),
      assistant: JSON.stringify({
        Blank: span,
        Options: options.join(' ### '),
        CorrectAnswer: answer,
        Explanation: explanation,
      }),
    });
  }

  rows.sort((a, b) => a.order - b.order);
  const taken = new Map<string, number>();
  const kept = rows.filter((r) => {
    const n = taken.get(r.passageId) ?? 0;
    if (n >= perPassage) return false;
    taken.set(r.passageId, n + 1);
    return true;
  });

  const trainLines: string[] = [];
  const validLines: string[] = [];
  const answerDist: Record<string, number> = {};
  const spanLen: Record<string, number> = {};
  for (const r of kept) {
    answerDist[r.answer] = (answerDist[r.answer] ?? 0) + 1;
    const b = r.spanWords <= 5 ? '2-5' : r.spanWords <= 10 ? '6-10' : r.spanWords <= 20 ? '11-20' : '21+';
    spanLen[b] = (spanLen[b] ?? 0) + 1;
    const line = JSON.stringify({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage(r.paragraph) },
        { role: 'assistant', content: r.assistant },
      ],
    });
    if (bucket(r.passageId) < valRatio) validLines.push(line);
    else trainLines.push(line);
  }
  const shuffle = (xs: string[]) =>
    xs.map((x) => [bucket(x), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

  evalSet.report();

  fs.mkdirSync(outDir, { recursive: true });
  const write = (name: string, lines: string[]) =>
    fs.writeFileSync(path.join(outDir, name), lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  write('train.jsonl', shuffle(trainLines));
  write('valid.jsonl', shuffle(validLines));
  write('test.jsonl', shuffle(validLines));

  const meta = {
    exportedAt: new Date().toISOString(),
    perPassage,
    valRatio,
    counts: {
      candidates: rows.length,
      kept: kept.length,
      train: trainLines.length,
      valid: validLines.length,
      passages: new Set(kept.map((r) => r.passageId)).size,
      skipped,
    },
    answerDist,
    spanWords: spanLen,
    outDir,
  };
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(meta, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('실패:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
