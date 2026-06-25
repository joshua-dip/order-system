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
 *     "requireSentences": ["it seemed to me that ..."], // 선택. 가드: 이 문장(들)만 정확히 제작됐는지 검사
 *     "data":       { "meta": {...}, "question_set": {...}, "passage": "...", "questions": [...] }
 *   }
 *
 * requireSentences 가 있으면 (또는 CLI --require-sentence) save/dry-run 이:
 *   1) 선택 문장이 어떤 문항 answer.text 에 그대로 포함됐는지 (누락 금지)
 *   2) 선택하지 않은 다른 문장이 문항으로 제작되지 않았는지 (외래 문장 금지)
 * 둘 다 통과해야 저장. 어긋나면 거부 (--force 우회). 문서에는 저장되지 않는 가드 전용 필드.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  ExamData,
  buildExamHtmlWithOverrides,
  readExamCss,
} from '@/lib/essay-exam-html';
import { validateExamData, ValidationResult } from '@/lib/essay-exam-validator';
import { saveEssayExam, updateEssayExam, EssayExamDoc, examTypeMatch } from '@/lib/essay-exams-store';
import { auditExam, applyFixes } from '@/lib/essay-exam-audit';
import { ESSAY_MEANING_EXAM_TYPE } from '@/app/data/essay-categories';
import { auditContent, buildAuditReportMarkdown, ReportEntry } from '@/lib/essay-exam-content-audit';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
loadCliEnv(PROJECT_ROOT);

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

// ── folder helpers ────────────────────────────────────────────────────────────

/**
 * 폴더 이름이 `essay_exams` 에 한 번도 등장한 적이 없으면 placeholder 문서를 1개 삽입.
 * `/admin/essay-generator` 의 「📁 새 폴더」 버튼(`handleAddEmptyFolder`)과 동일한 형태로 만들어,
 * 폴더 목록(`distinct('folder')`)에서 즉시 보이고 실제 listing 에서는 `isPlaceholder: true` 로 필터되어 노출되지 않는다.
 *
 * 반환값:
 *   - 'created'  : 폴더가 없어 placeholder 를 새로 만듦
 *   - 'existed'  : 이미 같은 폴더의 문서가 1건 이상 있어 아무것도 하지 않음
 *   - 'skipped'  : folder 이름이 비어있거나 '기본' (생성 불필요)
 */
async function ensureFolderPlaceholder(folder: string): Promise<'created' | 'existed' | 'skipped'> {
  const name = folder.trim();
  /* '기본' 폴더는 listFolders 에서 항상 추가되므로 placeholder 불필요 */
  if (!name || name === '기본') return 'skipped';

  const db = await getDb('gomijoshua');
  const existing = await db.collection('essay_exams').findOne({ folder: name }, { projection: { _id: 1 } });
  if (existing) return 'existed';

  const now = new Date();
  await db.collection('essay_exams').insertOne({
    title: `[${name}] 폴더`,
    textbook: '',
    sourceKey: '',
    difficulty: '',
    folder: name,
    order: 0,
    isPlaceholder: true,
    data: { meta: { title: '', subtitle: '', info: [] }, question_set: { tag: '', instruction: '' }, passage: '', questions: [] },
    html: '',
    createdAt: now,
    updatedAt: now,
  });
  return 'created';
}

async function cmdEnsureFolder(flags: Map<string, string>) {
  const folder = (flags.get('folder') ?? '').trim();
  if (!folder) die('ensure-folder: --folder "이름" 이 필요합니다.');
  const status = await ensureFolderPlaceholder(folder);
  out({ ok: true, folder, status });
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

// ── next-empty (스케줄러용 — 회분 수 N 미만 지문 1개 반환) ───────────────────────────

/** 4 난이도 라벨 (기본·중·고·최고) */
const ESSAY_DIFFICULTY_LABELS = ['기본난도', '중난도', '고난도', '최고난도'] as const;
type EssayDifficultyLabel = (typeof ESSAY_DIFFICULTY_LABELS)[number];

/**
 * `npm run cc:essay -- next-empty --textbook "이름" [--target-per-difficulty 1]`
 *
 * `--target-per-difficulty N` (기본 1):
 *   각 난이도별 essay_exams 카운트가 N 미만인 지문을 채움 대상으로 본다.
 *   - N=1 (기본): 한 지문이라도 essay_exams 가 있으면 "채움" — 옛 동작과 동일
 *   - N=4: 각 난이도 4 건씩 (총 16 건) 만들고 싶을 때
 *
 * 응답의 `next.shortByDifficulty` 에 부족한 난이도와 부족분 수를 담아주므로
 * loop prompt 가 정확히 어떤 난이도를 추가로 만들지 알 수 있다.
 *
 * 모두 채워졌으면 `{done: true}` — /loop 스케줄러가 이 응답을 보고 자동 종료.
 */
async function cmdNextEmpty(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('next-empty: --textbook "교재명" 이 필요합니다.');
  const targetPerDifficulty = Math.max(1, Math.floor(flagNum(flags, 'target-per-difficulty', 1)));
  // examType: 지정 시 해당 유형 essay_exams 만 카운트. 글의의미서술형은 기본난도만 존재 → 난이도 universe 를 기본난도로 한정.
  const examType = (flags.get('examType') ?? '').trim() || undefined;
  const isMeaning = examType === ESSAY_MEANING_EXAM_TYPE;
  const diffUniverse: readonly EssayDifficultyLabel[] = isMeaning ? ['기본난도'] : ESSAY_DIFFICULTY_LABELS;

  const db = await getDb('gomijoshua');
  const passages = await db
    .collection('passages')
    .find({ textbook })
    .project({ _id: 1, source_key: 1, chapter: 1, number: 1, essayPriority: 1 })
    .toArray();

  if (passages.length === 0) {
    out({
      ok: true,
      done: true,
      textbook,
      target_per_difficulty: targetPerDifficulty,
      total_passages: 0,
      under_target_passages: 0,
      message: `「${textbook}」 에 등록된 지문이 없습니다. 작업할 것이 없으므로 종료.`,
    });
    return;
  }

  const exams = await db
    .collection('essay_exams')
    .find({ textbook, isPlaceholder: { $ne: true }, ...examTypeMatch(examType) })
    .project({ passageId: 1, sourceKey: 1, difficulty: 1 })
    .toArray();

  /** 지문 식별자(pid 또는 sk) → 난이도별 카운트 */
  type DiffCount = Record<EssayDifficultyLabel, number>;
  const zero = (): DiffCount => ({ 기본난도: 0, 중난도: 0, 고난도: 0, 최고난도: 0 });
  const countByPid = new Map<string, DiffCount>();
  const countBySk = new Map<string, DiffCount>();
  for (const e of exams) {
    const pid = (e as { passageId?: string }).passageId;
    const sk = (e as { sourceKey?: string }).sourceKey;
    const diffRaw = String((e as { difficulty?: string }).difficulty ?? '').trim();
    const diff = (ESSAY_DIFFICULTY_LABELS as readonly string[]).includes(diffRaw)
      ? (diffRaw as EssayDifficultyLabel)
      : null;
    if (!diff) continue; /* 알 수 없는 난이도는 카운트 안 함 (수동 데이터 보호) */
    if (pid) {
      const m = countByPid.get(String(pid)) ?? zero();
      m[diff] += 1;
      countByPid.set(String(pid), m);
    } else if (sk) {
      const m = countBySk.get(String(sk)) ?? zero();
      m[diff] += 1;
      countBySk.set(String(sk), m);
    }
  }

  /** 한 지문의 난이도별 카운트 (pid + sk 합산) */
  const getCounts = (p: { _id: unknown; source_key?: unknown }): DiffCount => {
    const a = countByPid.get(String(p._id)) ?? zero();
    const b = countBySk.get(String(p.source_key ?? '')) ?? zero();
    return {
      기본난도: a.기본난도 + b.기본난도,
      중난도: a.중난도 + b.중난도,
      고난도: a.고난도 + b.고난도,
      최고난도: a.최고난도 + b.최고난도,
    };
  };

  /* 회분 수 미만인 난이도가 한 개라도 있는 지문만 추리고 priority desc → chapter → source_key 순 정렬 */
  const under = passages
    .map(p => ({ p, counts: getCounts(p as { _id: unknown; source_key?: unknown }) }))
    .filter(({ counts }) => diffUniverse.some(d => counts[d] < targetPerDifficulty))
    .sort((a, b) => {
      const pa = Number((a.p as { essayPriority?: number }).essayPriority ?? 0);
      const pb = Number((b.p as { essayPriority?: number }).essayPriority ?? 0);
      if (pb !== pa) return pb - pa;
      const ca = String(a.p.chapter ?? '');
      const cb = String(b.p.chapter ?? '');
      if (ca !== cb) return ca.localeCompare(cb, 'ko');
      const sa = String(a.p.source_key ?? '');
      const sb = String(b.p.source_key ?? '');
      return sa.localeCompare(sb, 'ko');
    });

  if (under.length === 0) {
    out({
      ok: true,
      done: true,
      textbook,
      target_per_difficulty: targetPerDifficulty,
      total_passages: passages.length,
      under_target_passages: 0,
      message:
        targetPerDifficulty === 1
          ? `「${textbook}」 의 모든 지문이 최소 1 건 이상의 essay_exam 을 가지고 있습니다. 자동 채움 종료.`
          : `「${textbook}」 의 모든 지문이 각 난이도별 ${targetPerDifficulty} 건 이상을 만족합니다. 자동 채움 종료.`,
    });
    return;
  }

  const nextEntry = under[0];
  const counts = nextEntry.counts;
  const shortByDifficulty: Record<EssayDifficultyLabel, number> = {
    기본난도: Math.max(0, targetPerDifficulty - counts.기본난도),
    중난도: Math.max(0, targetPerDifficulty - counts.중난도),
    고난도: Math.max(0, targetPerDifficulty - counts.고난도),
    최고난도: Math.max(0, targetPerDifficulty - counts.최고난도),
  };
  const shortLabels = diffUniverse.filter(d => shortByDifficulty[d] > 0);
  const totalToMake = shortLabels.reduce((sum, d) => sum + shortByDifficulty[d], 0);

  out({
    ok: true,
    done: false,
    textbook,
    examType: examType ?? null,
    difficulties: diffUniverse,
    target_per_difficulty: targetPerDifficulty,
    total_passages: passages.length,
    under_target_passages: under.length,
    remaining_after_this: under.length - 1,
    next: {
      passage_id: String(nextEntry.p._id),
      source_key: String(nextEntry.p.source_key ?? ''),
      chapter: String(nextEntry.p.chapter ?? ''),
      number: nextEntry.p.number != null ? String(nextEntry.p.number) : '',
      priority: Number((nextEntry.p as { essayPriority?: number }).essayPriority ?? 0),
      currentByDifficulty: counts,
      shortByDifficulty,
      shortLabels,
      totalToMake,
    },
    hint:
      isMeaning
        ? `다음 지문 「${String(nextEntry.p.source_key ?? '')}」 (passageId: ${String(nextEntry.p._id)}) — 글의의미서술형은 기본난도 1 건만 만들어 save 로 저장 후 종료. 다음 tick (10 분 후) 에 다음 지문이 자동으로 큐에 올라옴.`
        : targetPerDifficulty === 1
        ? `다음 지문 「${String(nextEntry.p.source_key ?? '')}」 (passageId: ${String(nextEntry.p._id)}) — 이 1 건의 4 난도를 만들어 save-all 로 저장 후 종료. 다음 tick (10 분 후) 에 다음 지문이 자동으로 큐에 올라옴.`
        : `다음 지문 「${String(nextEntry.p.source_key ?? '')}」 — 부족한 ${totalToMake} 건만 만들기: ${shortLabels
            .map(d => `${d} ×${shortByDifficulty[d]}`)
            .join(', ')} (target_per_difficulty=${targetPerDifficulty}). 같은 sourceKey 에 같은 난이도가 이미 N 건 있으면 추가 회분은 셔플 시드·문장 페어가 달라야 함.`,
  });
}

// ── shortage ──────────────────────────────────────────────────────────────────

async function cmdShortage(flags: Map<string, string>) {
  const textbook = (flags.get('textbook') ?? '').trim();
  if (!textbook) die('shortage: --textbook "교재명" 이 필요합니다.');
  const required = Math.max(1, Math.floor(flagNum(flags, 'required', 1)));
  const difficultyRaw = (flags.get('difficulty') ?? 'all').trim();
  const folderRaw = (flags.get('folder') ?? 'all').trim();
  // examType: 지정 시 해당 유형 essay_exams 만 카운트 (글의의미 vs 배열형 분리).
  const examType = (flags.get('examType') ?? '').trim() || undefined;

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
  const examFilter: Record<string, unknown> = { textbook, ...examTypeMatch(examType) };
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
    examType: examType ?? null,
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
  /**
   * 사용자가 "이 문장을 중심으로" 선택한 원문 문장(들). 지정하면 저장 가드가:
   *  1) 선택 문장이 어떤 문항의 정답(answer.text)에 그대로 들어갔는지 (누락 금지)
   *  2) 선택하지 않은 다른 문장이 문항으로 제작되지 않았는지 (외래 문장 금지)
   * 둘 다 통과해야 저장. (어긋나면 --force 없이는 거부) HTML/문서에는 저장되지 않는 가드 전용 필드.
   */
  requireSentences?: string[];
  data?: ExamData;
}

interface PerformSaveOpts { dryRun: boolean; force: boolean; requireSentences?: string[] }
interface PerformSaveResult {
  ok: boolean;
  reason?: string;
  hint?: string;
  validation: ValidationResult;
  dryRun?: boolean;
  id?: string;
  textbook?: string;
  sourceKey?: string;
  passageId?: string | null;
  difficulty?: string;
  folder?: string;
  title?: string;
  generated_html_bytes?: number;
  questions_count?: number;
  required_sentences_checked?: number;
  missing_sentences?: string[];
  foreign_sentences?: Array<{ id: string; text: string }>;
  error?: string;
}

/* ── 선택 문장 가드 ───────────────────────────────────────────────────────────
   "선택한 문장만 정확히 제작" 을 저장 시점에 강제. requireSentences 가 있을 때만 동작.
   비교는 가드 전용 정규화(태그·구두점·대소문자 무시, 공백 단일화)로 오탐을 줄인다. */
function normForRequire(s: string): string {
  return String(s ?? '')
    .replace(/<[^>]*>/g, ' ')                 // HTML 태그 제거
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/gi, ' ')        // 구두점·따옴표 제거 (글자/숫자/한글만)
    .replace(/\s+/g, ' ')
    .trim();
}

interface RequireCheck {
  ok: boolean;
  missing: string[];                              // 선택했지만 정답에 없는 문장
  foreign: Array<{ id: string; text: string }>;   // 선택 안 했는데 문항이 된 정답
}

function checkRequiredSentences(data: ExamData, required: string[]): RequireCheck {
  const reqNorm = required
    .map(r => ({ raw: r, norm: normForRequire(r) }))
    .filter(r => r.norm.length > 0);
  const questions = Array.isArray(data.questions) ? data.questions : [];
  const answers = questions.map(q => ({
    id: String(q.id ?? ''),
    raw: String(q.answer?.text ?? ''),
    norm: normForRequire(String(q.answer?.text ?? '')),
  }));
  const joined = answers.map(a => a.norm).join(' ');

  /* 1) 커버리지: 선택 문장이 정답(들)에 그대로 등장해야 함 */
  const missing = reqNorm.filter(r => !joined.includes(r.norm)).map(r => r.raw);

  /* 2) 외래 문장: 어떤 선택 문장과도 겹치지 않는 정답 = 끼어든 다른 문장 */
  const foreign = answers
    .filter(a => a.norm.length > 0 && !reqNorm.some(r => a.norm.includes(r.norm) || r.norm.includes(a.norm)))
    .map(a => ({ id: a.id, text: a.raw }));

  return { ok: missing.length === 0 && foreign.length === 0, missing, foreign };
}

async function performSave(input: SaveInput, opts: PerformSaveOpts): Promise<PerformSaveResult> {
  if (!input.data || typeof input.data !== 'object') {
    return { ok: false, error: 'input.data (ExamData) 가 필요합니다.', validation: { valid: false, errors: ['input.data 없음'], warnings: [] } };
  }

  /* 0) 난이도 확정 — 입력 최상위 > ExamData.meta > 기본값 */
  const difficulty = (input.difficulty ?? '').trim() || (input.data.meta?.difficulty ?? '중난도');

  /* 1) 검증 */
  const validation: ValidationResult = validateExamData(input.data, { difficulty });
  if (!validation.valid && !opts.force) {
    return {
      ok: false,
      reason: 'validation_failed',
      hint: '오류를 고치거나 --force 로 우회하세요.',
      validation,
    };
  }

  /* 1.5) 선택 문장 가드 — "선택한 문장만 정확히 제작" 강제 (requireSentences 있을 때만) */
  const requireSentences = [
    ...(Array.isArray(input.requireSentences) ? input.requireSentences : []),
    ...(opts.requireSentences ?? []),
  ].map(s => String(s)).filter(s => s.trim().length > 0);
  if (requireSentences.length > 0) {
    const chk = checkRequiredSentences(input.data, requireSentences);
    if (!chk.ok && !opts.force) {
      const parts: string[] = [];
      if (chk.missing.length > 0) {
        parts.push(`선택 문장이 정답에 그대로 없음(${chk.missing.length}): ${chk.missing.map(s => `"${s}"`).join(' / ')}`);
      }
      if (chk.foreign.length > 0) {
        parts.push(`선택하지 않은 문장이 문항으로 제작됨(${chk.foreign.length}): ${chk.foreign.map(f => `[${f.id}] "${f.text}"`).join(' / ')}`);
      }
      return {
        ok: false,
        reason: 'required_sentence_guard',
        hint: '선택한 문장만 정확히 제작되도록 초안을 고치세요 (의도적이면 --force 로 우회).',
        validation,
        required_sentences_checked: requireSentences.length,
        missing_sentences: chk.missing,
        foreign_sentences: chk.foreign,
        error: parts.join(' | '),
      };
    }
  }

  /* 2) passageId 로 textbook/sourceKey 자동 보강 (입력값 우선). */
  let textbook = (input.textbook ?? '').trim();
  let sourceKey = (input.sourceKey ?? '').trim();
  const passageId = (input.passageId ?? '').trim();

  if (passageId) {
    if (!ObjectId.isValid(passageId)) {
      return { ok: false, error: `passageId 가 유효한 ObjectId 가 아닙니다: ${passageId}`, validation };
    }
    const db = await getDb('gomijoshua');
    const p = await db.collection('passages').findOne({ _id: new ObjectId(passageId) });
    if (!p) return { ok: false, error: `passages 에서 passageId(${passageId}) 를 찾을 수 없습니다.`, validation };
    if (!textbook) textbook = String(p.textbook ?? '');
    if (!sourceKey) sourceKey = String(p.source_key ?? `${p.chapter ?? ''} ${p.number ?? ''}`.trim());
  }

  if (!textbook) return { ok: false, error: 'textbook 이 필요합니다 (passageId 없으면 명시 필수).', validation };
  if (!sourceKey) return { ok: false, error: 'sourceKey 가 필요합니다 (passageId 없으면 명시 필수).', validation };

  const folder = (input.folder ?? '').trim() || '기본';

  /* 3) HTML 생성. examSubtitle 미지정 시 sourceKey 사용. */
  const finalExamSubtitle = (input.examSubtitle ?? '').trim() || sourceKey;
  const { data: finalData, html } = buildExamHtmlWithOverrides(
    input.data,
    {
      examTitle: input.examTitle,
      schoolName: input.schoolName,
      grade: input.grade,
      examSubtitle: finalExamSubtitle,
    },
    readExamCss(),
  );

  if (opts.dryRun) {
    return {
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
      required_sentences_checked: requireSentences.length,
    };
  }

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

  return {
    ok: true,
    id,
    folder,
    sourceKey,
    passageId: passageId || null,
    difficulty,
    title: finalData.meta.title,
    validation,
    required_sentences_checked: requireSentences.length,
  };
}

function readSaveInputFromPath(jsonPath: string): SaveInput {
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
    die(`save: JSON 객체가 필요합니다 (${jsonPath}).`);
  }
  return parsed as SaveInput;
}

async function cmdSave(flags: Map<string, string>) {
  const jsonPath = flags.get('json') ?? '';
  if (!jsonPath) die('save: --json <파일경로> 또는 --json - (stdin) 이 필요합니다.');
  const dryRun = flagBool(flags, 'dry-run');
  const force = flagBool(flags, 'force');
  const reqFlag = flags.get('require-sentence');
  const requireSentences = reqFlag && reqFlag !== 'true' ? [reqFlag] : [];

  const input = readSaveInputFromPath(jsonPath);

  /* 저장 폴더가 없으면 placeholder 로 먼저 만들어두기 (--dry-run 도 동일하게 처리해도 안전) */
  let folderEnsured: { folder: string; status: 'created' | 'existed' | 'skipped' } | undefined;
  if (!dryRun) {
    const folderName = (input.folder ?? '').trim();
    if (folderName) {
      const status = await ensureFolderPlaceholder(folderName);
      folderEnsured = { folder: folderName, status };
    }
  }

  const result = await performSave(input, { dryRun, force, requireSentences });
  out({ ...result, folder_ensured: folderEnsured });
  if (!result.ok) process.exit(2);
}

async function cmdSaveAll(flags: Map<string, string>, positional: string[]) {
  const dryRun = flagBool(flags, 'dry-run');
  const force = flagBool(flags, 'force');
  const reqFlag = flags.get('require-sentence');
  const requireSentences = reqFlag && reqFlag !== 'true' ? [reqFlag] : [];

  /* JSON 파일 경로는 positional 인자 또는 --json (단수) */
  const files: string[] = positional.length > 0
    ? positional
    : (flags.get('json') ? [flags.get('json')!] : []);
  if (files.length === 0) {
    die('save-all: 1 개 이상의 JSON 파일 경로가 필요합니다.\n예: npm run cc:essay -- save-all draft_basic.json draft_mid.json draft_hard.json draft_max.json');
  }

  /* 1) 모든 입력 파일을 먼저 읽어서 사용된 folder 목록 추출 → 없는 폴더는 placeholder 로 사전 생성 */
  const parsedInputs: Array<{ file: string; input?: SaveInput; readError?: string }> = files.map(file => {
    try {
      return { file, input: readSaveInputFromPath(file) };
    } catch (e) {
      return { file, readError: e instanceof Error ? e.message : String(e) };
    }
  });

  const folderEnsuredList: Array<{ folder: string; status: 'created' | 'existed' | 'skipped' }> = [];
  if (!dryRun) {
    const folderSet = new Set<string>();
    for (const p of parsedInputs) {
      const f = (p.input?.folder ?? '').trim();
      if (f) folderSet.add(f);
    }
    for (const folder of folderSet) {
      const status = await ensureFolderPlaceholder(folder);
      folderEnsuredList.push({ folder, status });
    }
  }

  /* 2) 실제 저장 */
  const results: Array<{ file: string } & PerformSaveResult> = [];
  for (const p of parsedInputs) {
    if (p.readError || !p.input) {
      results.push({
        file: p.file,
        ok: false,
        error: p.readError ?? '입력 누락',
        validation: { valid: false, errors: ['예외'], warnings: [] },
      });
      continue;
    }
    try {
      const r = await performSave(p.input, { dryRun, force, requireSentences });
      results.push({ file: p.file, ...r });
    } catch (e) {
      results.push({
        file: p.file,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        validation: { valid: false, errors: ['예외'], warnings: [] },
      });
    }
  }

  out({
    ok: results.every(r => r.ok),
    total: results.length,
    succeeded: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    folders_ensured: folderEnsuredList,
    results,
  });
  if (!results.every(r => r.ok)) process.exit(2);
}

// ── audit ─────────────────────────────────────────────────────────────────────

async function cmdAudit(flags: Map<string, string>) {
  const textbookFilter = flags.get('textbook');
  const passageIdFilter = flags.get('passage-id');
  const examIdFilter = flags.get('id');
  const folderFilter = flags.get('folder');
  const all = flagBool(flags, 'all');
  const doFix = flagBool(flags, 'fix');
  const dryRun = flagBool(flags, 'dry-run');

  if (!textbookFilter && !passageIdFilter && !examIdFilter && !folderFilter && !all) {
    die('audit: --textbook "..." | --passage-id <id> | --id <examId> | --folder "..." | --all 중 하나가 필요합니다.');
  }

  const db = await getDb('gomijoshua');
  const query: Record<string, unknown> = { isPlaceholder: { $ne: true } };
  if (textbookFilter) query.textbook = textbookFilter;
  if (passageIdFilter) query.passageId = passageIdFilter;
  if (examIdFilter) query._id = new ObjectId(examIdFilter);
  if (folderFilter) query.folder = folderFilter;

  const docs = await db.collection('essay_exams').find(query).toArray();

  const passageLookup = async (passageId: string) => {
    try {
      const p = await db.collection('passages').findOne(
        { _id: new ObjectId(passageId) },
        { projection: { textbook: 1, source_key: 1 } },
      );
      if (!p) return null;
      return {
        textbook: (p as { textbook?: string }).textbook,
        source_key: (p as { source_key?: string }).source_key,
      };
    } catch {
      return null;
    }
  };

  type Outcome = {
    examId: string;
    textbook: string;
    sourceKey: string;
    difficulty: string;
    folder: string;
    findings: Array<{ level: string; code: string; message: string; fixable?: boolean }>;
    validatorPassed: boolean;
    htmlStale: boolean;
    hasFixable: boolean;
    fix?: { applied: string[]; saved: boolean; dryRun: boolean };
  };

  const outcomes: Outcome[] = [];
  for (const raw of docs) {
    const { _id, ...rest } = raw as EssayExamDoc & { _id: ObjectId };
    const doc = { ...rest, _id: String(_id) } as EssayExamDoc & { _id: string };
    const result = await auditExam(doc, { passageLookup });
    const outcome: Outcome = {
      examId: result.examId,
      textbook: result.textbook,
      sourceKey: result.sourceKey,
      difficulty: result.difficulty,
      folder: result.folder,
      findings: result.findings,
      validatorPassed: result.validatorPassed,
      htmlStale: result.htmlStale,
      hasFixable: result.hasFixable,
    };

    if (doFix && result.hasFixable) {
      const fixed = applyFixes(doc);
      if (dryRun) {
        outcome.fix = { applied: fixed.applied, saved: false, dryRun: true };
      } else {
        await updateEssayExam(result.examId, { data: fixed.data as object, html: fixed.html });
        outcome.fix = { applied: fixed.applied, saved: true, dryRun: false };
      }
    }
    outcomes.push(outcome);
  }

  const summary = {
    total: outcomes.length,
    clean: outcomes.filter(o => o.findings.length === 0).length,
    with_errors: outcomes.filter(o => o.findings.some(f => f.level === 'error')).length,
    with_warnings: outcomes.filter(o => o.findings.some(f => f.level === 'warning')).length,
    fixable: outcomes.filter(o => o.hasFixable).length,
    fixed: doFix ? outcomes.filter(o => o.fix && o.fix.saved).length : 0,
    fix_preview: doFix && dryRun ? outcomes.filter(o => o.fix && o.fix.applied.length > 0).length : 0,
  };

  out({ ok: true, fixMode: doFix, dryRun, summary, items: outcomes });
}

// ── audit-content ─────────────────────────────────────────────────────────────

async function cmdAuditContent(flags: Map<string, string>) {
  const textbookFilter = flags.get('textbook');
  const passageIdFilter = flags.get('passage-id');
  const examIdFilter = flags.get('id');
  const folderFilter = flags.get('folder');
  const difficultyFilter = flags.get('difficulty');  /* 고난도|최고난도|중난도|기본난도|all */
  const all = flagBool(flags, 'all');
  const reportMd = flagBool(flags, 'report-md');

  if (!textbookFilter && !passageIdFilter && !examIdFilter && !folderFilter && !all) {
    die('audit-content: --textbook "..." | --passage-id <id> | --id <examId> | --folder "..." | --all 중 하나가 필요합니다.');
  }

  const db = await getDb('gomijoshua');
  const query: Record<string, unknown> = { isPlaceholder: { $ne: true } };
  if (textbookFilter) query.textbook = textbookFilter;
  if (passageIdFilter) query.passageId = passageIdFilter;
  if (examIdFilter) query._id = new ObjectId(examIdFilter);
  if (folderFilter) query.folder = folderFilter;
  if (difficultyFilter && difficultyFilter !== 'all') query.difficulty = difficultyFilter;

  const docs = await db.collection('essay_exams').find(query).toArray();

  const entries: ReportEntry[] = [];
  for (const raw of docs) {
    const { _id, ...rest } = raw as EssayExamDoc & { _id: ObjectId };
    const doc = { ...rest, _id: String(_id) } as EssayExamDoc & { _id: string };
    const result = auditContent(doc);
    entries.push({
      examId: result.examId,
      textbook: result.textbook,
      sourceKey: result.sourceKey,
      difficulty: result.difficulty,
      findings: result.findings,
    });
  }

  /* 코드별 빈도 */
  const codeFreq = new Map<string, number>();
  for (const e of entries) {
    for (const f of e.findings) {
      codeFreq.set(f.code, (codeFreq.get(f.code) ?? 0) + 1);
    }
  }
  const summary = {
    total: entries.length,
    clean: entries.filter(e => e.findings.length === 0).length,
    with_errors: entries.filter(e => e.findings.some(f => f.level === 'error')).length,
    with_warnings: entries.filter(e => e.findings.some(f => f.level === 'warning')).length,
    code_frequency: Object.fromEntries([...codeFreq.entries()].sort((a, b) => b[1] - a[1])),
  };

  let reportPath: string | null = null;
  if (reportMd) {
    const tb = textbookFilter ?? folderFilter ?? 'all';
    const safeName = tb.replace(/[^\w가-힣]/g, '_').slice(0, 60);
    const date = new Date().toISOString().slice(0, 10);
    const md = buildAuditReportMarkdown(tb, entries);
    const dir = path.join(PROJECT_ROOT, '.essay-audit-reports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    reportPath = path.join(dir, `${safeName}_${date}.md`);
    fs.writeFileSync(reportPath, md, 'utf8');
  }

  out({ ok: true, summary, items: entries, reportPath });
}

// ── 단축 명령 해석 ────────────────────────────────────────────────────────────

function resolveShorthandCommand(
  cmd: string,
  tail: string[],
): { cmd: string; tail: string[] } {
  /* 첫 인자가 플래그가 아니고 알려진 서브커맨드도 아니면 → shortage --textbook <인자> */
  const known = new Set(['textbooks', 'passages', 'passage', 'shortage', 'save', 'save-all', 'next-empty', 'audit', 'audit-content', 'ensure-folder']);
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
  shortage --textbook "이름" [--required N] [--difficulty 최고난도|고난도|중난도|기본난도|all] [--folder "..."|all] [--examType "글의의미서술형"]
  next-empty --textbook "이름" [--target-per-difficulty 1] [--examType "글의의미서술형"]
           — 각 난이도 카운트 < N 인 지문 1 개 반환 (priority desc 순). 다 채워지면 {done: true}.
             기본 N=1 (옛 동작과 동일). N=4 면 한 지문에 각 난이도 4 건씩 채울 때까지 반환.
             --examType "글의의미서술형" 지정 시 그 유형만 카운트 + 기본난도 1 종만 대상(글의의미는 기본난도 전용).
             응답의 next.shortByDifficulty 가 부족 난이도와 부족분을 알려줌.
             /loop 스케줄러용 — Claude Code 채팅에서 10 분 간격 자동 채움.
  ensure-folder --folder "이름"
           — essay_exams 에 같은 folder 가 1 건도 없으면 placeholder 문서를 1 개 삽입.
             /admin/essay-generator 의 「📁 새 폴더」 와 동일 동작. 이미 있으면 no-op.
  save     --json <파일|->  [--dry-run] [--force] [--require-sentence "원문 문장"]
           — 저장 전에 입력 JSON 의 folder 필드를 자동으로 ensure (placeholder 생성)
             --require-sentence (또는 JSON 의 requireSentences: ["..."]) 지정 시
             선택 문장이 정답에 그대로 들어갔고 + 다른 문장이 끼어들지 않았는지 가드.
             어긋나면 저장 거부 (--force 로만 우회). --dry-run 에서도 동일 검사.
  save-all <file1> <file2> [<file3> ...]  [--dry-run] [--force]
           — 여러 draft JSON 을 순차 저장. 사용된 folder 들을 사전에 한 번씩 ensure
             (예: 한 지문의 4 난이도 동시 저장)
  audit    --textbook "..." | --passage-id <id> | --id <examId> | --folder "..." | --all
           [--fix] [--dry-run]
           — 저장된 essay_exams 정량 점검. --fix 적용 시 word_count·conditions·info 슬롯·id·html 자동 보정.
  audit-content --textbook "..." | --passage-id <id> | --id <examId> | --folder "..." | --all
                [--difficulty 고난도|최고난도|중난도|기본난도|all] [--report-md]
                — 조건·intent 내용 품질 검사 (영어 누설·2-gram·하이픈·과세분화·intent 부실).
                  --report-md 시 .essay-audit-reports/ 에 마크다운 리포트 저장.

단축:
  "교재명"  →  shortage --textbook "교재명"

원칙: API 키 호출 없음. 채팅에서 ExamData JSON 작성 → save 가 검증·HTML 생성·저장.`);
    process.exit(cmd ? 0 : 1);
  }

  const resolved = resolveShorthandCommand(cmd, tail);
  cmd = resolved.cmd;
  const { flags, positional } = parseFlags(resolved.tail);

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
    case 'next-empty':
      await cmdNextEmpty(flags);
      break;
    case 'save':
      await cmdSave(flags);
      break;
    case 'save-all':
      await cmdSaveAll(flags, positional);
      break;
    case 'audit':
      await cmdAudit(flags);
      break;
    case 'audit-content':
      await cmdAuditContent(flags);
      break;
    case 'ensure-folder':
      await cmdEnsureFolder(flags);
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
