/**
 * 어법 유형 변형문제 중 해설(Explanation)에
 *   "모두 어법상 맞다 / 모든 어법이 옳다 / 어법상 모두 옳다 / 오류 없다 / 어법상 잘못된 것이 없다"
 * 등 '정답 없음'을 시사하는 문장이 들어간 문항을 조회한다.
 *
 * Pro-only · Anthropic API 호출 없음. 읽기 전용.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

import { getDb } from '../lib/mongodb';

// 실제 버그: 5개 밑줄 모두 정답 처리 → 정답 없는 어법 문항.
// "나머지 …는 모두 옳다" 류 정상 해설은 제외.
const PATTERNS: { label: string; re: RegExp }[] = [
  { label: '모든 밑줄/보기 맞다', re: /모든\s*(밑줄|선택지|보기)[^。\.\n]{0,15}(맞|옳)/ },
  { label: '다섯 밑줄/보기 다 맞다', re: /다섯\s*(개|곳)?\s*(밑줄|선택지|보기)?[^。\.\n]{0,15}(다|모두)[^。\.\n]{0,10}(맞|옳)/ },
  { label: '①~⑤ 모두 옳다', re: /[①1]\s*[~∼\-]\s*[⑤5]\s*(은|는|이|가)?\s*모두/ },
  { label: '오류/틀린 곳 없다', re: /(오류|틀린\s*(곳|것|부분))\s*(는|이|가)?\s*없/ },
  { label: '정답이 없다', re: /정답\s*(이|은)?\s*없/ },
  { label: '5개 다 옳다', re: /(5|다섯)[^。\.\n]{0,10}(다|모두)\s*(옳|맞)/ },
];

// "나머지 N개 … 모두 옳다"처럼 4개만 맞다는 정상 해설을 거름 위한 컨텍스트 단어
const NORMAL_REMAINDER_RE = /(나머지|그\s*외|이외|이 외|기타|다른)[^。\.\n]{0,15}(은|는|이|가|모두)/;

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const args = process.argv.slice(2);
  const textbookArg = args.find((a) => a.startsWith('--textbook='))?.slice('--textbook='.length);
  const limitArg = Number(
    args.find((a) => a.startsWith('--limit='))?.slice('--limit='.length) || 5000,
  );

  const match: Record<string, unknown> = { type: '어법' };
  if (textbookArg) match.textbook = textbookArg;

  const total = await col.countDocuments(match);
  console.log(
    `[scan] type=어법${textbookArg ? ` textbook=${textbookArg}` : ''}  totalInDb=${total}  limit=${limitArg}`,
  );

  const docs = await col
    .find(match)
    .project({
      _id: 1,
      textbook: 1,
      source: 1,
      passage_id: 1,
      created_at: 1,
      question_data: 1,
      questionStatus: 1,
    })
    .sort({ _id: -1 })
    .limit(limitArg)
    .toArray();

  type Hit = {
    id: string;
    textbook: string;
    source: string;
    passage_id: string;
    status: string;
    correctAnswer: string;
    matchedPatterns: string[];
    explanationSnippet: string;
  };
  const hits: Hit[] = [];
  const counter = new Map<string, number>();

  for (const d of docs) {
    const qd = (d.question_data as Record<string, unknown>) || {};
    const explanation =
      typeof qd.Explanation === 'string' ? (qd.Explanation as string) : '';
    if (!explanation) continue;

    const matched: string[] = [];
    for (const p of PATTERNS) {
      if (!p.re.test(explanation)) continue;
      // "나머지 …는 모두 옳다" 패턴이 같이 있으면 정상 해설로 보고 제외
      // 단, "5개 다 옳다 / 오류 없다 / 정답이 없다" 류는 강한 시그널이라 무조건 hit.
      const strong =
        p.label === '오류/틀린 곳 없다' ||
        p.label === '정답이 없다' ||
        p.label === '5개 다 옳다' ||
        p.label === '①~⑤ 모두 옳다' ||
        p.label === '다섯 밑줄/보기 다 맞다';
      if (!strong && NORMAL_REMAINDER_RE.test(explanation)) continue;
      matched.push(p.label);
      counter.set(p.label, (counter.get(p.label) ?? 0) + 1);
    }
    if (matched.length === 0) continue;

    hits.push({
      id: String(d._id),
      textbook: String(d.textbook ?? ''),
      source: String(d.source ?? ''),
      passage_id: String(d.passage_id ?? ''),
      status: String(d.questionStatus ?? ''),
      correctAnswer:
        typeof qd.CorrectAnswer === 'string' ? (qd.CorrectAnswer as string) : '',
      matchedPatterns: matched,
      explanationSnippet:
        explanation.length > 200 ? explanation.slice(0, 200) + '…' : explanation,
    });
  }

  console.log(`\n[scan] scanned=${docs.length}  hits=${hits.length}`);
  console.log('[scan] pattern counts:');
  for (const [k, v] of [...counter.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${k}: ${v}`);
  }

  console.log('\n[hits]');
  for (const h of hits.slice(0, 50)) {
    console.log(
      `\n• id=${h.id}  status=${h.status}  CorrectAnswer=${h.correctAnswer}`,
    );
    console.log(`  textbook=${h.textbook}`);
    console.log(`  source=${h.source}  passage=${h.passage_id}`);
    console.log(`  matched: ${h.matchedPatterns.join(', ')}`);
    console.log(`  expl: ${h.explanationSnippet}`);
  }
  if (hits.length > 50) console.log(`\n…and ${hits.length - 50} more`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
