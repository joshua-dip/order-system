/**
 * 내용 일치·불일치(fact) 파인튜닝용 JSONL export (Claude/Anthropic 호출 없음).
 *
 *   npm run cc:fact-export
 *   npm run cc:fact-export -- --per-passage 3 --out data/fact-finetune
 *
 * 두 유형을 LoRA 하나로 배운다 — 사용자 메시지의 [유형] 줄(일치/불일치)로 구분한다.
 * 어댑터를 유형마다 두면 맥 워커가 모델 한 벌(약 4.3GB)씩 더 올려야 해서다.
 *
 * 다른 유형과 다른 점: 모델 출력(assistant)에 Paragraph 를 넣지 않는다. 지문 200단어를 매번 그대로
 * 다시 쓰느라 생성 시간을 쓰던 것 — 지문은 파이프라인(ml/fact/windows/pipeline_fact.py)이 채운다.
 * 이 SYSTEM_PROMPT·사용자 메시지 모양은 pipeline_fact.py 의 것과 한 글자까지 같아야 한다(노트 10과).
 *
 * 출력: <out>/train.jsonl, valid.jsonl, test.jsonl, meta.json — mlx-lm chat JSONL
 * 분할: passage_id 기준 90/10 (같은 지문이 train·valid 에 동시에 안 들어가게)
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

const FACT_TYPES = ['일치', '불일치'] as const;
type FactType = (typeof FACT_TYPES)[number];
const CIRCLED = '①②③④⑤';

export const SYSTEM_PROMPT = `당신은 한국 수능 영어 변형문제 출제자입니다. 주어진 영어 지문으로 「내용 일치」 또는 「내용 불일치」 객관식 1문항을 만듭니다.
반드시 아래 키만 갖는 JSON 한 개만 출력하세요. 마크다운·설명 금지.

키: Question, Options, CorrectAnswer, Explanation, OptionType

규칙:
1) [유형]이 일치면 Question = "다음 글의 내용과 일치하는 것은?", 정답 1개만 지문과 맞고 나머지 4개는 지문과 어긋난다.
   [유형]이 불일치면 Question = "다음 글의 내용과 일치하지 않는 것은?", 정답 1개만 지문과 어긋나고 나머지 4개는 지문과 맞는다.
2) Options = 영어 완전한 문장 5개, 각 앞에 ①~⑤, 사이는 오직 ###. 지문에 나오는 차례대로 배열한다.
3) 어긋나는 선지는 지문의 한 부분을 바꿔(반대로, 다른 대상으로, 과장해서) 만든다. 지문에 없는 내용을 지어내지 않는다.
4) OptionType = "English"
5) CorrectAnswer = ①~⑤ 중 하나.
6) Explanation = 한국어 해설, 450자 이하. 정답 선지가 지문의 어느 부분과 맞는지/어긋나는지 근거를 든다.
7) Paragraph 는 출력하지 않는다.`;

export function userMessage(type: FactType, paragraph: string): string {
  return `[유형] ${type}\n\n[지문 Paragraph]\n${paragraph}`;
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

/** passage_id → 0..1 안정 해시 (분할·표본용) */
function bucket(key: string): number {
  const h = createHash('sha256').update(key).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

const HANGUL = /[가-힣]/;

/** 선지 5개로 나눈다 — ###(신규)·줄바꿈(레거시, 완료 문항의 약 3/4)·번호만 있는 것 모두 받는다. */
function splitOptions(raw: string): string[] {
  const by = (sep: RegExp) => raw.split(sep).map((s) => s.trim()).filter(Boolean);
  if (raw.includes('###')) return by(/###/);
  if (raw.includes('\n')) return by(/\n+/);
  return by(/(?=[①②③④⑤])/);
}

/** 학습에 넣을 만한 문항인지 — 엑셀 임포트분 결함(보기 과다·한글 보기·정답 번호 없음)을 거른다.
 *  학습 데이터에는 모두 ### 로 맞춰 넣는다(파이프라인·렌더러 표준). */
function cleanOptions(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null;
  const parts = splitOptions(raw);
  if (parts.length !== 5) return null;
  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    const body = parts[i].replace(/^[①②③④⑤]\s*/, '').trim();
    const words = body.split(/\s+/).length;
    if (!body || HANGUL.test(body) || words < 5 || words > 30) return null;
    out.push(`${CIRCLED[i]} ${body}`);
  }
  return out;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const outDir = path.resolve(PROJECT_ROOT, flags.get('out') || 'data/fact-finetune');
  // 같은 지문·같은 유형에서 비슷한 문항이 수십 개씩 있다 — 지문당 몇 개만 써서 지문 다양성을 살린다
  const perPassage = Math.max(1, Number(flags.get('per-passage') || '3'));
  const valRatio = Math.min(0.3, Math.max(0.05, Number(flags.get('val-ratio') || '0.1')));

  const db = await getDb('gomijoshua');
  const gq = db.collection('generated_questions');
  const passages = db.collection('passages');

  const cursor = gq.find(
    { type: { $in: [...FACT_TYPES] }, status: '완료', option_type: 'English' },
    { projection: { passage_id: 1, type: 1, question_data: 1 } }
  );

  const passageCache = new Map<string, string>();
  const evalSet = createEvalSetFilter(PROJECT_ROOT);
  type Row = { passageId: string; type: FactType; paragraph: string; assistant: string; order: number; answer: string };
  const rows: Row[] = [];
  const skipped = { noPassage: 0, badOptions: 0, badAnswer: 0, badQuestion: 0, badExplanation: 0 };

  for await (const doc of cursor) {
    const type = String(doc.type) as FactType;
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
    const question = String(qd.Question ?? '');
    const negative = /않/.test(question);
    if (!question.includes('일치') || negative !== (type === '불일치')) {
      skipped.badQuestion++;
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

    rows.push({
      passageId,
      type,
      paragraph,
      answer,
      order: bucket(`${passageId}|${String(doc._id)}`),
      assistant: JSON.stringify({
        Question: type === '일치' ? '다음 글의 내용과 일치하는 것은?' : '다음 글의 내용과 일치하지 않는 것은?',
        Options: options.join(' ### '),
        CorrectAnswer: answer,
        Explanation: explanation,
        OptionType: 'English',
      }),
    });
  }

  // 지문·유형마다 perPassage 개만 (해시 순서로 골라 매번 같은 표본)
  rows.sort((a, b) => a.order - b.order);
  const taken = new Map<string, number>();
  const kept = rows.filter((r) => {
    const key = `${r.passageId}|${r.type}`;
    const n = taken.get(key) ?? 0;
    if (n >= perPassage) return false;
    taken.set(key, n + 1);
    return true;
  });

  const trainLines: string[] = [];
  const validLines: string[] = [];
  const answerDist: Record<string, Record<string, number>> = { 일치: {}, 불일치: {} };
  for (const r of kept) {
    answerDist[r.type][r.answer] = (answerDist[r.type][r.answer] ?? 0) + 1;
    const line = JSON.stringify({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage(r.type, r.paragraph) },
        { role: 'assistant', content: r.assistant },
      ],
    });
    if (bucket(r.passageId) < valRatio) validLines.push(line);
    else trainLines.push(line);
  }
  // mlx-lm 은 파일 순서대로 섞어 읽는다 — 같은 지문이 몰리지 않게 한 번 섞는다(해시 기준, 재현 가능)
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
    types: FACT_TYPES,
    perPassage,
    valRatio,
    counts: {
      candidates: rows.length,
      kept: kept.length,
      train: trainLines.length,
      valid: validLines.length,
      passages: new Set(kept.map((r) => r.passageId)).size,
      byType: {
        일치: kept.filter((r) => r.type === '일치').length,
        불일치: kept.filter((r) => r.type === '불일치').length,
      },
      skipped,
    },
    answerDist,
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
