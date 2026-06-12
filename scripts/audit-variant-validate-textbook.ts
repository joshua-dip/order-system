/**
 * 교재 단위 전체 검수 CLI (read-only, DB 변경 없음).
 * /admin/generated-questions 상단 「선택지 검증」+「해설·어법」 버튼 전체와 동일 규칙.
 * (예외: 「선택지 데이터 검증」(options-overlap)은 오류 검출이 아니라 내보내기 추천용
 *  순위 도구라 제외)
 *
 * 실행: npm run cc:audit -- --textbook "26년 6월 고1 영어모의고사"
 *
 * 검증 항목:
 *   per-question  — lib/variant-review-validators.runPerQuestionValidations
 *     (Explanation 누락·nan·API / Options API / 문항 내 보기 중복 /
 *      CorrectAnswer 형식 / 빈칸 표식 / 어법 변형 구조·해설 모순)
 *   cross-question —
 *     · Options 중복 검증: 같은 type 안에서 Options(trim) 동일 그룹
 *       (번호 고정형 유형은 제외: 순서·삽입·삽입-고난도·무관한문장·어법·어법-고난도·워크북어법)
 *     · 요약 검증: Paragraph (A)/(B) 누락 · 요약문이 본문 위(전반 30%)
 *     · 순서 통합: 고정 5세트 형식 / CorrectAnswer ①~⑤ / 원문 대조(자기 보기 배열 기준) /
 *       정답 분포 편중(60%) — 로직은 lib/order-variant-validation 공용
 *     · Options 저장 형식: 누락 / 배열 저장(내보내기에서 사라짐) / ①~⑤ 접두사 없음 /
 *       보기 수 ≠ 5 — lib/options-format-validation 공용 (관리자 「Options 형식 검증」과 동일)
 *     · 콘텐츠 정합: 해설 선언 정답↔CorrectAnswer · 영어 유형 한글 선택지 · 함의 밑줄 ·
 *       삽입/무관 마커 · 어법-고난도 구조 · Paragraph/Question 누락·API · source 접두사 ·
 *       정답 분포 편중 — lib/content-integrity-validation 공용 (관리자 「정합 검증」과 동일)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import {
  ORDER_CIRCLED,
  computeReadingOrderKey,
  correctAnswerFromOwnOptions,
  findPositionInOriginal,
  isStandardOrderOptions,
  parseOrderOptions,
  parseOrderParagraph,
  readingKeyToPerm,
} from '@/lib/order-variant-validation';
import {
  checkContentIntegrity,
  summarizeAnswerDistribution,
} from '@/lib/content-integrity-validation';
import {
  OPTIONS_FORMAT_ISSUE_LABEL,
  checkOptionsFormat,
  isOptionsFormatCheckTarget,
  type OptionsFormatIssueKind,
} from '@/lib/options-format-validation';
import {
  runPerQuestionValidations,
  type ReviewValidationIssue,
} from '@/lib/variant-review-validators';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const DUP_EXCLUDE_TYPES = [
  '순서',
  '삽입',
  '삽입-고난도',
  '무관한문장',
  '어법',
  '어법-고난도',
  '워크북어법',
];

const SKEW_THRESHOLD = 0.6;

function getFlag(name: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : '';
}

async function main() {
  const textbook = getFlag('textbook').trim();
  if (!textbook) {
    console.error('사용법: npm run cc:audit -- --textbook "교재명"');
    process.exit(1);
  }

  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');

  const docs = await col
    .find({ textbook, deleted_at: null })
    .sort({ type: 1, source: 1 })
    .toArray();

  // ── 1) per-question 검증 (해설·어법 + 선택지 per-question 규칙 전부)
  const errorItems: {
    id: string; type: string; source: string; status: string; rule: string; message: string;
  }[] = [];
  const warningCounts: Record<string, number> = {};
  const warningSamples: Record<string, { id: string; type: string; source: string; message: string }[]> = {};
  const errorRuleCounts: Record<string, number> = {};

  for (const d of docs) {
    const issues: ReviewValidationIssue[] = await runPerQuestionValidations(db, d);
    for (const issue of issues) {
      if (issue.severity === 'error') {
        errorRuleCounts[issue.rule] = (errorRuleCounts[issue.rule] ?? 0) + 1;
        errorItems.push({
          id: String(d._id),
          type: String(d.type ?? ''),
          source: String(d.source ?? ''),
          status: String(d.status ?? ''),
          rule: issue.rule,
          message: issue.message,
        });
      } else {
        warningCounts[issue.rule] = (warningCounts[issue.rule] ?? 0) + 1;
        const samples = (warningSamples[issue.rule] ??= []);
        if (samples.length < 10) {
          samples.push({
            id: String(d._id),
            type: String(d.type ?? ''),
            source: String(d.source ?? ''),
            message: issue.message,
          });
        }
      }
    }
  }

  // ── 1.5) Options 저장 형식 검증 — lib/options-format-validation 공용 로직
  type OptFormatItem = { id: string; type: string; source: string; status: string; detail: string };
  const optionsFormat = {
    missing: [] as OptFormatItem[],
    storedAsArray: [] as OptFormatItem[],
    noCircledPrefix: [] as OptFormatItem[],
    partialCircledPrefix: [] as OptFormatItem[],
    badSegmentCount: [] as OptFormatItem[],
  };
  const OPT_FORMAT_BUCKET: Record<OptionsFormatIssueKind, OptFormatItem[]> = {
    missing: optionsFormat.missing,
    stored_as_array: optionsFormat.storedAsArray,
    no_circled_prefix: optionsFormat.noCircledPrefix,
    partial_circled_prefix: optionsFormat.partialCircledPrefix,
    bad_segment_count: optionsFormat.badSegmentCount,
  };
  for (const d of docs) {
    const type = String(d.type ?? '');
    if (!isOptionsFormatCheckTarget(type)) continue; // 워크북 계열은 Options 미사용
    const raw = ((d.question_data ?? {}) as Record<string, unknown>).Options;
    const result = checkOptionsFormat(raw);
    for (const kind of result.issues) {
      OPT_FORMAT_BUCKET[kind].push({
        id: String(d._id),
        type,
        source: String(d.source ?? ''),
        status: String(d.status ?? ''),
        detail: `${OPTIONS_FORMAT_ISSUE_LABEL[kind]}${result.segmentCount ? ` (보기 ${result.segmentCount}개)` : ''}`,
      });
    }
  }

  // ── 1.7) 콘텐츠 정합 검증 — lib/content-integrity-validation 공용
  //   (해설 선언 정답↔CA · 영어 유형 한글 선택지 · 함의 밑줄 · 삽입/무관 마커 ·
  //    어법-고난도 구조 · Paragraph/Question 누락·API · source 접두사)
  const integrityItems: {
    id: string; type: string; source: string; status: string;
    severity: string; rule: string; message: string;
  }[] = [];
  const integrityRuleCounts: Record<string, number> = {};
  for (const d of docs) {
    for (const issue of checkContentIntegrity(d)) {
      integrityRuleCounts[issue.rule] = (integrityRuleCounts[issue.rule] ?? 0) + 1;
      if (integrityItems.length < 300) {
        integrityItems.push({
          id: String(d._id),
          type: String(d.type ?? ''),
          source: String(d.source ?? ''),
          status: String(d.status ?? ''),
          severity: issue.severity,
          rule: issue.rule,
          message: issue.message,
        });
      }
    }
  }
  const answerDistribution = summarizeAnswerDistribution(docs);
  const skewedAnswerTypes = answerDistribution.filter((r) => r.skewedAnswer !== null);

  // ── 2) Options 중복 검증 (cross-question · 같은 type 내 동일 Options)
  const dupMap = new Map<string, { type: string; ids: { id: string; source: string }[] }>();
  for (const d of docs) {
    const type = String(d.type ?? '');
    if (DUP_EXCLUDE_TYPES.includes(type)) continue;
    const opt = (d.question_data as Record<string, unknown> | undefined)?.Options;
    const norm = typeof opt === 'string' ? opt.trim() : '';
    if (!norm) continue;
    const key = `${type} ${norm}`;
    const entry = dupMap.get(key) ?? { type, ids: [] };
    entry.ids.push({ id: String(d._id), source: String(d.source ?? '') });
    dupMap.set(key, entry);
  }
  const duplicateGroups = [...dupMap.values()]
    .filter((g) => g.ids.length > 1)
    .map((g) => ({ type: g.type, count: g.ids.length, items: g.ids }));

  // ── 3) 요약 검증 (Paragraph (A)/(B) 구조)
  const summaryIssues: { id: string; source: string; status: string; reason: string }[] = [];
  for (const d of docs) {
    if (String(d.type ?? '') !== '요약') continue;
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const para = typeof qd.Paragraph === 'string' ? qd.Paragraph : '';
    const question = typeof qd.Question === 'string' ? qd.Question : '';
    const base = { id: String(d._id), source: String(d.source ?? ''), status: String(d.status ?? '') };
    if (!para.trim()) {
      summaryIssues.push({ ...base, reason: 'Paragraph 없음' });
      continue;
    }
    const idxA = para.indexOf('(A)');
    const idxB = para.indexOf('(B)');
    if (idxA < 0 && idxB < 0) {
      const inQ = question.includes('(A)') || question.includes('(B)');
      summaryIssues.push({ ...base, reason: inQ ? '요약문 누락 [Question에 위치]' : '요약문 누락' });
    } else {
      const first = Math.min(
        idxA >= 0 ? idxA : Number.POSITIVE_INFINITY,
        idxB >= 0 ? idxB : Number.POSITIVE_INFINITY,
      );
      if (first / para.length < 0.3) summaryIssues.push({ ...base, reason: '요약문이 본문 위' });
    }
  }

  // ── 4) 순서 통합 검증 (lib/order-variant-validation 공용 로직)
  const orderDocs = docs.filter((d) => String(d.type ?? '') === '순서');
  const orderBadOptions: { id: string; source: string; optionCount: number; layout: string[] }[] = [];
  const orderBadAnswer: { id: string; source: string; currentAnswer: string }[] = [];
  const distribution: Record<string, number> = Object.fromEntries(ORDER_CIRCLED.map((c) => [c, 0]));
  for (const d of orderDocs) {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    if (!isStandardOrderOptions(qd.Options)) {
      orderBadOptions.push({
        id: String(d._id),
        source: String(d.source ?? ''),
        optionCount: parseOrderOptions(qd.Options).length,
        layout: parseOrderOptions(qd.Options),
      });
    }
    const ca = typeof qd.CorrectAnswer === 'string' ? qd.CorrectAnswer.trim() : '';
    if ((ORDER_CIRCLED as readonly string[]).includes(ca)) distribution[ca] += 1;
    else orderBadAnswer.push({ id: String(d._id), source: String(d.source ?? ''), currentAnswer: ca || '(없음)' });
  }

  // 원문 대조 — 읽기 순서 순열을 문항 자신의 Options 에서 찾아 정답 결정
  const passageIds = [...new Set(orderDocs.map((d) => String(d.passage_id)).filter((s) => ObjectId.isValid(s)))];
  const passageMap = new Map<string, string>();
  if (passageIds.length > 0) {
    const passages = await db
      .collection('passages')
      .find({ _id: { $in: passageIds.map((id) => new ObjectId(id)) } })
      .project({ 'content.original': 1 })
      .toArray();
    for (const p of passages) {
      const orig = (p.content as Record<string, unknown> | undefined)?.original;
      if (typeof orig === 'string') passageMap.set(String(p._id), orig);
    }
  }
  const orderVerify: {
    id: string; source: string; currentAnswer: string; correctAnswer: string;
    readingOrder: string; status: 'mismatch' | 'unshuffled' | 'unverifiable';
  }[] = [];
  let orderVerified = 0;
  for (const d of orderDocs) {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const paragraph = String(qd.Paragraph ?? '');
    const currentAnswer = String(qd.CorrectAnswer ?? '').trim();
    const parsed = parseOrderParagraph(paragraph);
    const original = passageMap.get(String(d.passage_id));
    const base = { id: String(d._id), source: String(d.source ?? ''), currentAnswer };
    if (!parsed || !original) {
      orderVerify.push({ ...base, correctAnswer: '?', readingOrder: '?', status: 'unverifiable' });
      continue;
    }
    const positions = {
      A: findPositionInOriginal(original, parsed.A),
      B: findPositionInOriginal(original, parsed.B),
      C: findPositionInOriginal(original, parsed.C),
    };
    const sortedKey = computeReadingOrderKey(positions);
    if (!sortedKey || sortedKey === 'ABC') {
      orderVerify.push({
        ...base,
        correctAnswer: '?',
        readingOrder: sortedKey === 'ABC' ? '(A)-(B)-(C)' : '?',
        status: sortedKey === 'ABC' ? 'unshuffled' : 'unverifiable',
      });
      continue;
    }
    const readingOrder = readingKeyToPerm(sortedKey);
    const correctAnswer = correctAnswerFromOwnOptions(qd.Options, readingOrder);
    if (!correctAnswer) {
      orderVerify.push({ ...base, correctAnswer: '?', readingOrder, status: 'unverifiable' });
      continue;
    }
    orderVerified += 1;
    if (correctAnswer !== currentAnswer) {
      orderVerify.push({ ...base, correctAnswer, readingOrder, status: 'mismatch' });
    }
  }
  const orderTotal = orderDocs.length;
  let skewedAnswer: string | null = null;
  let skewedPct = 0;
  if (orderTotal > 0) {
    for (const c of ORDER_CIRCLED) {
      const pct = distribution[c] / orderTotal;
      if (pct >= SKEW_THRESHOLD) {
        skewedAnswer = c;
        skewedPct = Math.round(pct * 1000) / 10;
        break;
      }
    }
  }

  const out = {
    ok: true,
    textbook,
    totalQuestions: docs.length,
    perQuestion: {
      errorTotal: errorItems.length,
      errorRuleCounts,
      errorItems: errorItems.slice(0, 200),
      errorItemsTruncated: errorItems.length > 200,
      warningCounts,
      warningSamples,
    },
    contentIntegrity: {
      issueTotal: integrityItems.length,
      ruleCounts: integrityRuleCounts,
      items: integrityItems,
      answerDistributionSkewed: skewedAnswerTypes,
    },
    optionsFormat: {
      missingCount: optionsFormat.missing.length,
      storedAsArrayCount: optionsFormat.storedAsArray.length,
      noCircledPrefixCount: optionsFormat.noCircledPrefix.length,
      partialCircledPrefixCount: optionsFormat.partialCircledPrefix.length,
      badSegmentCountCount: optionsFormat.badSegmentCount.length,
      missing: optionsFormat.missing.slice(0, 50),
      storedAsArray: optionsFormat.storedAsArray.slice(0, 50),
      noCircledPrefix: optionsFormat.noCircledPrefix.slice(0, 50),
      partialCircledPrefix: optionsFormat.partialCircledPrefix.slice(0, 50),
      badSegmentCount: optionsFormat.badSegmentCount.slice(0, 50),
    },
    duplicateOptions: {
      excludedTypes: DUP_EXCLUDE_TYPES,
      duplicateGroupCount: duplicateGroups.length,
      groups: duplicateGroups,
    },
    summaryStructure: {
      scanned: docs.filter((d) => String(d.type ?? '') === '요약').length,
      matched: summaryIssues.length,
      items: summaryIssues,
    },
    orderUnified: {
      scanned: orderTotal,
      nonStandardOptions: orderBadOptions,
      badCorrectAnswer: orderBadAnswer,
      answerVerify: {
        verified: orderVerified,
        mismatch: orderVerify.filter((x) => x.status === 'mismatch'),
        unshuffled: orderVerify.filter((x) => x.status === 'unshuffled'),
        unverifiable: orderVerify.filter((x) => x.status === 'unverifiable').length,
      },
      distribution,
      skewed: skewedAnswer !== null,
      skewedAnswer,
      skewedPct,
    },
  };

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
