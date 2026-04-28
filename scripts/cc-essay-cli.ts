/**
 * Claude Code 전용: MCP 없이 MongoDB만 쓰는 서술형(essay) 출제 CLI.
 * Pro 구독으로 채팅에서 ExamData JSON 을 작성하고, 이 스크립트로
 * 조회·검증·저장(+HTML 생성) 만 담당하므로 Anthropic API 비용 없음.
 *
 * 프로젝트 루트에서 (MONGODB_URI는 .env / .env.local):
 *
 *   npx tsx scripts/cc-essay-cli.ts textbooks [--limit 200]
 *   npx tsx scripts/cc-essay-cli.ts passages --textbook "교재명" [--limit 40]
 *   npx tsx scripts/cc-essay-cli.ts passage --id <passageId>
 *   npx tsx scripts/cc-essay-cli.ts shortage --textbook "교재명" [--required 1]
 *                                            [--difficulty 최고난도|고난도|중난도|기본난도|all]
 *                                            [--folder "..."|all]
 *   npx tsx scripts/cc-essay-cli.ts save --json path/to/exam.json [--dry-run] [--force]
 *   cat exam.json | npx tsx scripts/cc-essay-cli.ts save --json -
 *
 *   단축: 교재명만 → shortage --textbook "교재명"
 *   npx tsx scripts/cc-essay-cli.ts "26년 3월 고1 영어모의고사"
 *
 * save 용 JSON 스키마 (예시):
 *   {
 *     "passageId": "65fa…",          // 선택. 있으면 textbook/sourceKey 자동 보강.
 *     "textbook":  "26년 3월 고1 영어모의고사",
 *     "sourceKey": "26년 3월 고1 영어모의고사 21번",
 *     "difficulty": "중난도",
 *     "folder":    "기본",
 *     "examTitle": "직전보강 서술형 파이널",   // data.meta.title 덮어쓰기
 *     "schoolName": "○○고등학교",            // data.meta.info 앞에 삽입
 *     "grade":      "2학년",
 *     "examSubtitle": "26년 3월 고1 영어모의고사",  // data.meta.subtitle 덮어쓰기
 *     "data":       { "meta": {...}, "question_set": {...}, "passage": "...", "questions": [...] }
 *   }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  ExamData,
  buildExamHtmlWithOverrides,
  readExamCss,
} from '@/lib/essay-exam-html';
import { validateExamData, ValidationResult } from '@/lib/essay-exam-validator';
import { saveEssayExam } from '@/lib/essay-exams-store';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

// ── 공용 유틸 ─────────────────────────────────────────────────────────────────

function parseFlags(argv: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '');
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, 'true');
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function out(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function flagNum(flags: Map<string, string>, key: string, fallback: number): number {
  const v = flags.get(key);
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) die(`--${key} 는 숫자여야 합니다.`);
  return n;
}

function flagBool(flags: Map<string, string>, key: string): boolean {
  const v = flags.get(key);
  return v === 'true' || v === '1';
}

function parseJsonInput(raw: string): unknown {
  let text = raw.trim();
  /* 코드 펜스 제거: ``` 또는 ```json */
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    text = text.trim();
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    die(`JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── textbooks ─────────────────────────────────────────────────────────────────

async function cmdTextbooks(flags: Map<string, string>) {
  const lim = Math.min(500, Math.max(1, Math.floor(flagNum(flags, 'limit', 200))));
  const db = await getDb('gomijoshua');
  const names = await db.collection('passages').distinct('textbook');
  const sorted = (names as unknown[])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(t => t.trim())
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const list = sorted.slice(0, lim);
  out({ ok: true, count: list.length, total_distinct: sorted.length, textbooks: list });
}

// ── passages ──────────────────────────────────────────────────────────────────

async function cmdPassages(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('passages: --textbook "교재명" 이 필요합니다.');
  const lim = Math.min(200, Math.max(1, Math.floor(flagNum(flags, 'limit', 40))));
  const db = await getDb('gomijoshua');

  const items = await db
    .collection('passages')
    .find({ textbook })
    .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1 })
    .limit(lim)
    .toArray();

  /* essay_exams 카운트 — passageId 우선, 없으면 sourceKey fallback */
  const passageIds = items.map(p => String(p._id));
  const sourceKeys = items
    .map(p => (typeof p.source_key === 'string' ? p.source_key : ''))
    .filter(Boolean);

  const examRows = await db
    .collection('essay_exams')
    .aggregate([
      {
        $match: {
          $or: [
            { passageId: { $in: passageIds } },
            { sourceKey: { $in: sourceKeys }, textbook },
          ],
        },
      },
      {
        $group: {
          _id: { passageId: '$passageId', sourceKey: '$sourceKey' },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const countByPassageId = new Map<string, number>();
  const countBySourceKey = new Map<string, number>();
  for (const row of examRows) {
    const k = row._id as { passageId?: string; sourceKey?: string };
    if (k.passageId) countByPassageId.set(String(k.passageId), Number(row.count));
    if (k.sourceKey && !k.passageId) {
      countBySourceKey.set(String(k.sourceKey), Number(row.count));
    }
  }

  out({
    ok: true,
    textbook,
    count: items.length,
    passages: items.map(p => {
      const pid = String(p._id);
      const sk = typeof p.source_key === 'string' ? p.source_key : '';
      const examCount = (countByPassageId.get(pid) ?? 0) + (countBySourceKey.get(sk) ?? 0);
      return {
        passage_id: pid,
        textbook: p.textbook ?? '',
        chapter: p.chapter ?? '',
        number: p.number ?? '',
        source_key: sk,
        essay_exam_count: examCount,
      };
    }),
  });
}

// ── passage ───────────────────────────────────────────────────────────────────

interface SentenceRow {
  idx: number;
  text: string;
  isEssay: boolean;
}

/** 영어 본문 → 문장 배열 (page.tsx 의 parseSentences 와 동일 규칙) */
function parseSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
}

async function cmdPassage(flags: Map<string, string>) {
  const id = (flags.get('id') ?? '').trim();
  if (!id || !ObjectId.isValid(id)) die('passage: --id <유효한 ObjectId> 가 필요합니다.');

  const db = await getDb('gomijoshua');
  const p = await db.collection('passages').findOne({ _id: new ObjectId(id) });
  if (!p) die('passage 를 찾을 수 없습니다.');

  const content =
    p.content && typeof p.content === 'object' && !Array.isArray(p.content)
      ? (p.content as Record<string, unknown>)
      : {};
  const original = String(content.original ?? '');
  const translation = String(content.translation ?? '');

  const sentences = parseSentences(original);

  /* essayHighlightedSentences 인덱스 가져오기 */
  let essayIndices: number[] = [];
  try {
    const fileName = passageAnalysisFileNameForPassageId(id);
    const adoc = await db.collection('passage_analyses').findOne({ fileName });
    const states = (adoc as Record<string, unknown> | null)?.passageStates as
      | Record<string, unknown>
      | undefined;
    const main = states?.main as Record<string, unknown> | undefined;
    const idxs = main?.essayHighlightedSentences as number[] | undefined;
    if (Array.isArray(idxs)) essayIndices = idxs.filter(n => Number.isInteger(n));
  } catch {
    /* 분석 데이터가 없을 수 있음 — 무시 */
  }

  const essaySet = new Set(essayIndices);
  const rows: SentenceRow[] = sentences.map((text, idx) => ({
    idx,
    text,
    isEssay: essaySet.has(idx),
  }));

  /* essay_exam 카운트도 같이 보고 (워크플로우 판단용) */
  const sk = String(p.source_key ?? '');
  const existingCount = await db.collection('essay_exams').countDocuments({
    $or: [
      { passageId: id },
      ...(sk ? [{ sourceKey: sk, textbook: String(p.textbook ?? '') }] : []),
    ],
  });

  /* 채팅 친화 표 */
  const tableLines = rows.map(r => {
    const mark = r.isEssay ? '⭐' : ' ·';
    return `[${String(r.idx).padStart(2, ' ')}] ${mark}  ${r.text}`;
  });
  const printable = [
    `## 지문 정보`,
    `- passage_id : ${id}`,
    `- textbook   : ${String(p.textbook ?? '')}`,
    `- source_key : ${sk}`,
    `- chapter    : ${String(p.chapter ?? '')}`,
    `- number     : ${String(p.number ?? '')}`,
    `- essay_exams: ${existingCount}건`,
    ``,
    `## 문장 (⭐ = 서술형대비 추천 / · = 일반)`,
    ...tableLines,
    ``,
    `## 추천 인덱스 (essayHighlightedSentences)`,
    `[${essayIndices.join(', ')}]`,
  ].join('\n');

  /* stderr 로 사람이 읽는 표, stdout 으로 JSON 블록 (파이프/파싱 양쪽 지원) */
  console.error(printable);

  out({
    ok: true,
    passage_id: id,
    textbook: String(p.textbook ?? ''),
    sourceKey: sk,
    chapter: p.chapter ?? '',
    number: p.number ?? '',
    essay_exam_count: existingCount,
    original,
    translation,
    sentences: rows,
    essayHighlightedSentences: essayIndices,
  });
}

// ── shortage ──────────────────────────────────────────────────────────────────

async function cmdShortage(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('shortage: --textbook "교재명" 이 필요합니다.');
  const required = Math.max(1, Math.floor(flagNum(flags, 'required', 1)));
  const difficultyRaw = (flags.get('difficulty') ?? 'all').trim();
  const folderRaw = (flags.get('folder') ?? 'all').trim();

  const db = await getDb('gomijoshua');

  /* 1) 해당 교재의 모든 지문 */
  const passages = await db
    .collection('passages')
    .find({ textbook })
    .project({ _id: 1, source_key: 1, chapter: 1, number: 1 })
    .toArray();

  if (passages.length === 0) {
    out({ ok: true, textbook, required, difficulty: difficultyRaw, folder: folderRaw, total: 0, shortage: [] });
    return;
  }

  /* 2) 해당 교재의 essay_exams 를 difficulty/folder 필터로 가져와 passageId/sourceKey 별 카운트 */
  const examFilter: Record<string, unknown> = { textbook };
  if (difficultyRaw && difficultyRaw !== 'all') examFilter.difficulty = difficultyRaw;
  if (folderRaw && folderRaw !== 'all') examFilter.folder = folderRaw;

  const exams = await db
    .collection('essay_exams')
    .find(examFilter)
    .project({ passageId: 1, sourceKey: 1 })
    .toArray();

  const countByPid = new Map<string, number>();
  const countBySk = new Map<string, number>();
  for (const e of exams) {
    const pid = (e as { passageId?: string }).passageId;
    const sk = (e as { sourceKey?: string }).sourceKey;
    if (pid) countByPid.set(String(pid), (countByPid.get(String(pid)) ?? 0) + 1);
    else if (sk) countBySk.set(String(sk), (countBySk.get(String(sk)) ?? 0) + 1);
  }

  /* 3) 부족 지문 추출 */
  const shortage: Array<{
    passage_id: string;
    source_key: string;
    chapter: string;
    number: string;
    have: number;
    need: number;
  }> = [];
  let totalNeed = 0;
  for (const p of passages) {
    const pid = String(p._id);
    const sk = String(p.source_key ?? '');
    const have = (countByPid.get(pid) ?? 0) + (countBySk.get(sk) ?? 0);
    if (have < required) {
      const need = required - have;
      totalNeed += need;
      shortage.push({
        passage_id: pid,
        source_key: sk,
        chapter: String(p.chapter ?? ''),
        number: String(p.number ?? ''),
        have,
        need,
      });
    }
  }

  out({
    ok: true,
    textbook,
    required,
    difficulty: difficultyRaw,
    folder: folderRaw,
    passages_total: passages.length,
    shortage_count: shortage.length,
    need_create_total: totalNeed,
    shortage,
  });
}

// ── save ─────────────────────────────────────────────────────────────────────

interface SaveInput {
  passageId?: string;
  textbook?: string;
  sourceKey?: string;
  difficulty?: string;
  folder?: string;
  examTitle?: string;
  schoolName?: string;
  grade?: string;
  examSubtitle?: string;
  data?: ExamData;
}

async function cmdSave(flags: Map<string, string>) {
  const jsonPath = flags.get('json') ?? '';
  if (!jsonPath) die('save: --json <파일경로> 또는 --json - (stdin) 이 필요합니다.');
  const dryRun = flagBool(flags, 'dry-run');
  const force = flagBool(flags, 'force');

  let raw: string;
  if (jsonPath === '-') {
    raw = fs.readFileSync(0, 'utf8');
  } else {
    const abs = path.isAbsolute(jsonPath) ? jsonPath : path.join(process.cwd(), jsonPath);
    if (!fs.existsSync(abs)) die(`파일 없음: ${abs}`);
    raw = fs.readFileSync(abs, 'utf8');
  }

  const parsed = parseJsonInput(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    die('save: JSON 객체가 필요합니다.');
  }
  const input = parsed as SaveInput;
  if (!input.data || typeof input.data !== 'object') {
    die('save: input.data (ExamData) 가 필요합니다.');
  }

  /* 0) 난이도 확정 (검증기에 전달) — 입력 최상위 > ExamData.meta > 기본값 */
  const difficulty = (input.difficulty ?? '').trim() || (input.data.meta?.difficulty ?? '중난도');

  /* 1) 검증 */
  const validation: ValidationResult = validateExamData(input.data, { difficulty });
  if (!validation.valid && !force) {
    out({
      ok: false,
      reason: 'validation_failed',
      hint: '오류를 고치거나 --force 로 우회하세요.',
      validation,
    });
    process.exit(2);
  }

  /* 2) passageId 로 textbook/sourceKey 자동 보강 (입력값 우선).
     dry-run 이고 passageId 가 없으면 Mongo 연결 자체를 열지 않음. */
  let textbook = (input.textbook ?? '').trim();
  let sourceKey = (input.sourceKey ?? '').trim();
  const passageId = (input.passageId ?? '').trim();

  if (passageId) {
    if (!ObjectId.isValid(passageId)) die(`save: passageId 가 유효한 ObjectId 가 아닙니다: ${passageId}`);
    const db = await getDb('gomijoshua');
    const p = await db.collection('passages').findOne({ _id: new ObjectId(passageId) });
    if (!p) die(`save: passages 에서 passageId(${passageId}) 를 찾을 수 없습니다.`);
    if (!textbook) textbook = String(p.textbook ?? '');
    if (!sourceKey) sourceKey = String(p.source_key ?? `${p.chapter ?? ''} ${p.number ?? ''}`.trim());
  }

  if (!textbook) die('save: textbook 이 필요합니다 (passageId 없으면 명시 필수).');
  if (!sourceKey) die('save: sourceKey 가 필요합니다 (passageId 없으면 명시 필수).');

  const folder = (input.folder ?? '').trim() || '기본';

  /* 3) HTML 생성 (단일 진입점) */
  const { data: finalData, html } = buildExamHtmlWithOverrides(
    input.data,
    {
      examTitle: input.examTitle,
      schoolName: input.schoolName,
      grade: input.grade,
      examSubtitle: input.examSubtitle,
    },
    readExamCss(),
  );

  /* 4) dry-run 이면 여기서 끝 */
  if (dryRun) {
    out({
      ok: true,
      dryRun: true,
      validation,
      textbook,
      sourceKey,
      passageId: passageId || null,
      difficulty,
      folder,
      title: finalData.meta.title,
      generated_html_bytes: Buffer.byteLength(html, 'utf8'),
      questions_count: Array.isArray(finalData.questions) ? finalData.questions.length : 0,
    });
    return;
  }

  /* 5) 실제 저장 */
  const id = await saveEssayExam({
    title: finalData.meta.title,
    textbook,
    sourceKey,
    passageId: passageId || undefined,
    difficulty,
    folder,
    data: finalData as unknown as object,
    html,
  });

  out({
    ok: true,
    id,
    folder,
    sourceKey,
    passageId: passageId || null,
    difficulty,
    title: finalData.meta.title,
    validation,
  });
}

// ── 단축 명령 해석 ────────────────────────────────────────────────────────────

function resolveShorthandCommand(
  cmd: string,
  tail: string[],
): { cmd: string; tail: string[] } {
  /* 첫 인자가 플래그가 아니고 알려진 서브커맨드도 아니면 → shortage --textbook <인자> */
  const known = new Set(['textbooks', 'passages', 'passage', 'shortage', 'save']);
  if (!known.has(cmd) && !cmd.startsWith('--')) {
    return { cmd: 'shortage', tail: ['--textbook', cmd, ...tail] };
  }
  return { cmd, tail };
}

// ── 진입점 ───────────────────────────────────────────────────────────────────

function argvAfterScript(): string[] {
  const raw = process.argv.slice(2);
  const first = raw[0] ?? '';
  if (
    first.endsWith('cc-essay-cli.ts') ||
    first.endsWith('cc-essay-cli.js') ||
    path.basename(first) === 'cc-essay-cli.ts' ||
    path.basename(first) === 'cc-essay-cli.js'
  ) {
    return raw.slice(1);
  }
  return raw;
}

async function main() {
  let [cmd, ...tail] = argvAfterScript();
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.error(`사용법: npx tsx scripts/cc-essay-cli.ts <명령> [옵션]

명령:
  textbooks [--limit N]
  passages --textbook "이름" [--limit N]
  passage  --id <ObjectId>
  shortage --textbook "이름" [--required N] [--difficulty 최고난도|고난도|중난도|기본난도|all] [--folder "..."|all]
  save     --json <파일|->  [--dry-run] [--force]

단축:
  "교재명"  →  shortage --textbook "교재명"

원칙: API 키 호출 없음. 채팅에서 ExamData JSON 작성 → save 가 검증·HTML 생성·저장.`);
    process.exit(cmd ? 0 : 1);
  }

  const resolved = resolveShorthandCommand(cmd, tail);
  cmd = resolved.cmd;
  const { flags } = parseFlags(resolved.tail);

  switch (cmd) {
    case 'textbooks':
      await cmdTextbooks(flags);
      break;
    case 'passages':
      await cmdPassages(flags);
      break;
    case 'passage':
      await cmdPassage(flags);
      break;
    case 'shortage':
      await cmdShortage(flags);
      break;
    case 'save':
      await cmdSave(flags);
      break;
    default:
      die(`알 수 없는 명령: ${cmd} (--help 참고)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
