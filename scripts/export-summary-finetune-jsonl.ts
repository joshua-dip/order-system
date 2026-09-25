/**
 * 요약 파인튜닝용 JSONL export (Claude/Anthropic 호출 없음).
 *
 *   npm run cc:summary-export
 *   npm run cc:summary-export -- --per-passage 3 --out data/summary-finetune
 *
 * DB 문항의 Paragraph 는 「원문 전체 + 빈 줄 + → 요약문((A)·(B) 빈칸)」이다. 원문은 모델이 입력으로 이미 받으니,
 * 모델은 「요약문 + 선지 + 정답 + 해설」만 쓰게 가르친다 — 원문을 다시 쓰지 않게(노트 15과 ③, 빈칸과 같은 방식).
 * 지문과 요약문 합치기·Question·OptionType 은 파이프라인(ml/summary/windows/pipeline_summary.py)이 채운다.
 * 이 SYSTEM_PROMPT·사용자 메시지는 pipeline_summary.py 의 것과 한 글자까지 같아야 한다(노트 10과).
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
import { getDb } from '@/lib/mongodb';
import { getPassageTextForVariantCompare } from '@/lib/passage-variant-text';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
loadCliEnv(PROJECT_ROOT);

const CIRCLED = '①②③④⑤';

export const SYSTEM_PROMPT = `당신은 한국 수능 영어 변형문제 출제자입니다. 주어진 영어 지문으로 「요약문 완성」 객관식 1문항을 만듭니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Summary, Options, CorrectAnswer, Explanation

규칙:
1) Summary = 글 전체의 요지를 담은 영어 한 문장. 핵심 낱말 두 곳을 (A) ________ 와 (B) ________ 로 비운다((A)가 앞).
2) 빈칸 정답 낱말은 지문의 핵심 개념을 가리키되, 지문 표현을 그대로 옮기기보다 바꿔 쓴 말이 좋다.
3) Options = 선지 5개, 각 「① (A) 낱말 – (B) 낱말」 꼴, 사이는 오직 ###. 모두 영어, 각 빈칸에 문법적으로 들어가야 한다.
4) 오답은 (A)·(B) 중 하나만 맞거나 둘 다 틀린 쌍으로, 지문을 대충 읽으면 고를 만하게 만든다.
5) CorrectAnswer = ①~⑤ 중 하나.
6) Explanation = 한국어 해설, 450자 이하. (A)·(B)가 각각 지문의 어느 내용을 요약하는지 근거를 든다.
7) 지문 전체(Paragraph)는 출력하지 않는다.`;

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
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
// 빈칸 표기가 제각각이다 — (A)________ · ____(A)____ · (A) ________ · _____(A) → 모두 「(A) ________」
const BLANK = /_{2,}\s*\(([AB])\)\s*_{2,}|_{2,}\s*\(([AB])\)|\(([AB])\)\s*_{2,}/g;

/** Paragraph 에서 요약문(마지막 블록)을 떼어 빈칸 표기를 맞춘다. (A)·(B) 가 한 번씩, A 가 앞일 때만. */
function extractSummary(paragraph: string): string | null {
  // 원문과 요약문 사이는 빈 줄이 표준이지만 「\n###\n」으로 나눈 것도 많다
  const blocks = paragraph.split(/\n\s*\n|\n\s*###\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length < 2) return null;
  let s = norm(blocks[blocks.length - 1]).replace(/^(→|->|=>|⇒)\s*/, '');
  s = s.replace(BLANK, (_m, a, b, c) => `(${a || b || c}) ________`);
  // 밑줄 없이 「(A)」만 둔 것도 빈칸으로 본다
  s = s.replace(/\(([AB])\)(?! ________)/g, '($1) ________');
  const a = s.match(/\(A\) ________/g) || [];
  const b = s.match(/\(B\) ________/g) || [];
  if (a.length !== 1 || b.length !== 1 || s.indexOf('(A)') > s.indexOf('(B)')) return null;
  if (/\([A-Z]\)(?! ________)/.test(s.replace(/\([AB]\) ________/g, ''))) return null;
  const words = s.split(/\s+/).length;
  if (words < 10 || words > 50 || HANGUL.test(s) || /_{2,}(?<!\) ________)/.test(s.replace(/\([AB]\) ________/g, ''))) return null;
  return s;
}

function splitOptions(raw: string): string[] {
  const by = (sep: RegExp) => raw.split(sep).map((s) => s.trim()).filter(Boolean);
  if (raw.includes('###')) return by(/###/);
  if (raw.includes('\n')) return by(/\n+/);
  return by(/(?=[①②③④⑤])/);
}

/** 선지 → 「① (A) x – (B) y」 다섯으로 표기를 맞춘다. 한 빈칸에 1~4 낱말, 영어만. */
function cleanOptions(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null;
  const parts = splitOptions(raw);
  if (parts.length !== 5) return null;
  const out: string[] = [];
  const pairs = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const body = parts[i].replace(/^[①②③④⑤]\s*/, '').trim();
    // 구분자도 제각각이다 — – · - · --- · … · …… · ... · ······ · /, (A)(B) 표시가 없는 것도 많다(「① proposes - training」)
    const m =
      body.match(/^\(A\)\s*(.+?)\s*(?:[–—-]{1,3}|…+|\.{2,}|·{2,}|\/)\s*\(B\)\s*(.+)$/) ||
      body.match(/^(.+?)\s+(?:[–—-]{1,3}|…+|\.{2,}|·{2,}|\/)\s+(.+)$/);
    if (!m) return null;
    const [a, b] = [norm(m[1]), norm(m[2])];
    for (const w of [a, b]) {
      const n = w.split(/\s+/).length;
      if (!w || HANGUL.test(w) || n > 4) return null;
    }
    const key = `${a.toLowerCase()}|${b.toLowerCase()}`;
    if (pairs.has(key)) return null;
    pairs.add(key);
    out.push(`${CIRCLED[i]} (A) ${a} – (B) ${b}`);
  }
  return out;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const outDir = path.resolve(PROJECT_ROOT, flags.get('out') || 'data/summary-finetune');
  const perPassage = Math.max(1, Number(flags.get('per-passage') || '3'));
  const valRatio = Math.min(0.3, Math.max(0.05, Number(flags.get('val-ratio') || '0.1')));

  const db = await getDb('gomijoshua');
  const gq = db.collection('generated_questions');
  const passages = db.collection('passages');
  const cursor = gq.find(
    { type: '요약', status: '완료', option_type: 'English' },
    { projection: { passage_id: 1, question_data: 1 } }
  );

  const passageCache = new Map<string, string>();
  type Row = { passageId: string; paragraph: string; assistant: string; order: number; answer: string; summaryWords: number };
  const rows: Row[] = [];
  const skipped = { noPassage: 0, badOptions: 0, badAnswer: 0, noSummary: 0, badExplanation: 0 };

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
      paragraph = getPassageTextForVariantCompare(p?.content);
      passageCache.set(passageId, paragraph);
    }
    if (!paragraph.trim()) {
      skipped.noPassage++;
      continue;
    }
    const summary = extractSummary(String(qd.Paragraph ?? ''));
    if (!summary) {
      skipped.noSummary++;
      continue;
    }
    rows.push({
      passageId,
      paragraph,
      answer,
      summaryWords: summary.split(/\s+/).length,
      order: bucket(`${passageId}|${String(doc._id)}`),
      assistant: JSON.stringify({
        Summary: summary,
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
  const sumLen: Record<string, number> = {};
  for (const r of kept) {
    answerDist[r.answer] = (answerDist[r.answer] ?? 0) + 1;
    const b = r.summaryWords <= 20 ? '10-20' : r.summaryWords <= 30 ? '21-30' : '31+';
    sumLen[b] = (sumLen[b] ?? 0) + 1;
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
    summaryWords: sumLen,
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
