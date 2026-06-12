/**
 * 26년 6월 고1 영어모의고사 — Options 저장 형식 표준화 (2026-06-12).
 *
 * 대상 (둘 다 회원 내보내기·관리자 표·정답 매칭 유틸을 깨뜨리는 형식):
 *   A. 배열 저장: question_data.Options 가 string[] — str() 가드에 걸려 내보내기에서
 *      선택지가 통째로 사라지고 관리자 표에서 — 로 표시됨
 *   B. 번호 없는 보기: ### 구분 문자열인데 ①~⑤ 접두사가 전혀 없음
 *
 * 수정: 다섯 보기를 위치 순서대로 `① 보기 ### ② 보기 ### …` 표준 문자열로 교체.
 *   - 보기 순서는 그대로 유지하므로 CorrectAnswer(①~⑤)와의 대응이 보존된다.
 *   - 가드: 보기 5개 · 전부 비어있지 않음 · 기존에 동그라미 접두사 없음 ·
 *     CorrectAnswer 가 단일 동그라미 번호 · 순서 유형 배열은 고정 5세트와 정확 일치.
 *
 * 사용: npx tsx scripts/patch-26-06-go1-options-numbering-20260612.ts [--apply]
 *       (기본 dry-run)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';
import { splitQuestionOptionSegments } from '@/lib/question-options-segments';
import { ORDER_FIXED_OPTIONS } from '@/lib/order-variant-validation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const TEXTBOOK = '26년 6월 고1 영어모의고사';
const APPLY = process.argv.includes('--apply');
const CIRCLED = ['①', '②', '③', '④', '⑤'];
const CIRCLED_RE = /^[①②③④⑤]/;

/**
 * 27번 일치 — 생성 시 보기가 6개 저장된 문항. 해설 스스로
 * "⑥은 답지 5개 한도 초과 — 무시. 실제 정답지는 5개이다"라고 명시하며
 * ①~⑤ 해설이 앞 5개 요소와 대응하므로 6번째를 버리고, 해당 군더더기 문장도 제거.
 */
const SIX_OPTION_FIX = {
  id: '6a249c16d0c597982468bcdb',
  keep: 5,
  explanationStrip: ' ⑥은 답지 5개 한도 초과 — 무시. 실제 정답지는 5개이다.',
};

type Row = { id: string; type: string; source: string; kind: string; detail: string };
const planned: Row[] = [];
const skipped: Row[] = [];

function buildStandardOptions(els: string[]): string {
  return els.map((e, i) => `${CIRCLED[i]} ${e}`).join(' ### ');
}

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const now = new Date();

  const docs = await col
    .find({ textbook: TEXTBOOK, deleted_at: null })
    .project({
      type: 1,
      source: 1,
      'question_data.Options': 1,
      'question_data.CorrectAnswer': 1,
    })
    .toArray();

  for (const d of docs) {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const raw = qd.Options;
    const type = String(d.type ?? '');
    const base = { id: String(d._id), type, source: String(d.source ?? '') };
    const ca = String(qd.CorrectAnswer ?? '').trim();
    const caOk = /^[①②③④⑤]$/.test(ca);

    let els: string[] | null = null;
    let kind = '';
    let explanationStrip: string | null = null;

    if (Array.isArray(raw)) {
      kind = '배열→문자열';
      els = raw.map((v) => String(v ?? '').trim());
      if (base.id === SIX_OPTION_FIX.id && els.length === 6) {
        kind = '배열 6개→5개';
        els = els.slice(0, SIX_OPTION_FIX.keep);
        explanationStrip = SIX_OPTION_FIX.explanationStrip;
      }
    } else if (typeof raw === 'string' && raw.trim()) {
      const segs = splitQuestionOptionSegments(raw);
      if (segs.length === 5 && segs.every((s) => !CIRCLED_RE.test(s))) {
        kind = '번호 부여';
        els = segs;
      } else {
        continue; // 정상(번호 있음) 또는 다른 형태 — 이 패치 대상 아님
      }
    } else {
      continue;
    }

    if (els.length !== 5 || els.some((e) => !e)) {
      skipped.push({ ...base, kind, detail: `보기 ${els.length}개/빈 요소 — 수동 확인 필요` });
      continue;
    }
    if (els.some((e) => CIRCLED_RE.test(e))) {
      skipped.push({ ...base, kind, detail: '일부 보기에 이미 번호 존재 — 수동 확인 필요' });
      continue;
    }
    if (!caOk) {
      skipped.push({ ...base, kind, detail: `CorrectAnswer "${ca}" 가 단일 동그라미가 아님 — 수동 확인 필요` });
      continue;
    }
    if (type === '순서') {
      const normalized = els.map((e) => e.replace(/\s*-\s*/g, '-'));
      const isFixed = normalized.every((v, i) => v === ORDER_FIXED_OPTIONS[i]);
      if (!isFixed) {
        skipped.push({ ...base, kind, detail: `순서 배열이 고정 5세트와 불일치: ${normalized.join(' / ')}` });
        continue;
      }
    }

    const newOptions = buildStandardOptions(els);
    planned.push({ ...base, kind, detail: `${newOptions.slice(0, 80)}…` });
    if (APPLY) {
      const set: Record<string, unknown> = {
        'question_data.Options': newOptions,
        updated_at: now,
      };
      if (explanationStrip) {
        const full = await col.findOne({ _id: d._id }, { projection: { 'question_data.Explanation': 1 } });
        const expl = String((full?.question_data as Record<string, unknown> | undefined)?.Explanation ?? '');
        if (expl.includes(explanationStrip.trim())) {
          set['question_data.Explanation'] = expl
            .replace(explanationStrip, '')
            .replace(explanationStrip.trim(), '')
            .trim();
        }
      }
      await col.updateOne({ _id: d._id }, { $set: set });
    }
  }

  const byKindType: Record<string, number> = {};
  for (const p of planned) {
    const k = `${p.kind}|${p.type}`;
    byKindType[k] = (byKindType[k] ?? 0) + 1;
  }

  console.log(JSON.stringify({
    ok: true,
    apply: APPLY,
    textbook: TEXTBOOK,
    plannedCount: planned.length,
    byKindType,
    plannedSamples: planned.slice(0, 10),
    skippedCount: skipped.length,
    skipped,
  }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
