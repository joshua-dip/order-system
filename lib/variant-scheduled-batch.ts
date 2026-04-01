import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { generateVariantDraftQuestionDataWithClaude } from '@/lib/admin-variant-draft-claude';
import {
  runQuestionCountValidation,
  type QuestionCountValidationPayload,
} from '@/lib/question-count-validation';
import { saveGeneratedQuestionToDb } from '@/lib/variant-save-generated-question';

export type VariantAutoFillTask = {
  passageId: string;
  textbook: string;
  source: string;
  type: string;
};

/** 부족·미작성 행 → 이번 실행에서 처리할 생성 작업 목록 (상한 maxTasks) */
export function buildVariantAutoFillQueue(
  data: QuestionCountValidationPayload,
  maxTasks: number
): VariantAutoFillTask[] {
  if (maxTasks <= 0) return [];
  const tasks: VariantAutoFillTask[] = [];
  const textbook = data.textbook;
  const typesChecked = data.typesChecked;

  for (const u of data.underfilled) {
    const take = Math.min(u.shortBy, maxTasks - tasks.length);
    for (let k = 0; k < take; k++) {
      tasks.push({
        passageId: u.passageId,
        textbook,
        source: u.label,
        type: u.type,
      });
    }
    if (tasks.length >= maxTasks) return tasks;
  }

  for (const row of data.noQuestions) {
    for (const typ of typesChecked) {
      for (let k = 0; k < data.requiredPerType; k++) {
        if (tasks.length >= maxTasks) return tasks;
        tasks.push({
          passageId: row.passageId,
          textbook,
          source: row.label,
          type: typ,
        });
      }
    }
  }

  return tasks;
}

export type VariantAutoFillOneResult =
  | { ok: true; passage_id: string; type: string; inserted_id: string }
  | { ok: false; passage_id: string; type: string; error: string };

async function runOneAutoFillTask(task: VariantAutoFillTask): Promise<VariantAutoFillOneResult> {
  const { passageId, textbook, source, type } = task;
  if (!ObjectId.isValid(passageId)) {
    return { ok: false, passage_id: passageId, type, error: '유효하지 않은 passage_id' };
  }

  const db = await getDb('gomijoshua');
  const passagesCol = db.collection('passages');
  const gqCol = db.collection('generated_questions');

  const passage = await passagesCol.findOne({ _id: new ObjectId(passageId) });
  if (!passage) {
    return { ok: false, passage_id: passageId, type, error: 'passage 없음' };
  }
  const pTextbook = String(passage.textbook ?? '').trim();
  if (pTextbook !== textbook.trim()) {
    return { ok: false, passage_id: passageId, type, error: `교재명 불일치: DB "${pTextbook}"` };
  }

  const content =
    passage.content && typeof passage.content === 'object' && !Array.isArray(passage.content)
      ? (passage.content as Record<string, unknown>)
      : {};
  const paragraph =
    (typeof content.original === 'string' && content.original.trim()) ||
    (typeof content.mixed === 'string' && content.mixed.trim()) ||
    (typeof content.translation === 'string' && content.translation.trim()) ||
    '';

  if (!paragraph.trim()) {
    return { ok: false, passage_id: passageId, type, error: '지문(content) 없음' };
  }

  const passageOid = new ObjectId(passageId);
  const maxAgg = await gqCol
    .aggregate<{ m: number | null }>([
      {
        $match: {
          textbook,
          passage_id: passageOid,
          source,
          type,
        },
      },
      { $group: { _id: null, m: { $max: '$question_data.NumQuestion' } } },
    ])
    .toArray();
  const prevMax = typeof maxAgg[0]?.m === 'number' && Number.isFinite(maxAgg[0].m) ? maxAgg[0].m : 0;
  const nextNum = prevMax + 1;

  const ai = await generateVariantDraftQuestionDataWithClaude({
    paragraph,
    type,
    nextNum,
    userHint: '',
    typePrompt: '',
  });

  if (!ai.ok) {
    return { ok: false, passage_id: passageId, type, error: ai.error };
  }

  const saved = await saveGeneratedQuestionToDb({
    passage_id: passageId,
    textbook,
    source,
    type,
    question_data: ai.question_data,
    status: '대기',
    option_type: 'English',
  });

  if (!saved.ok) {
    return { ok: false, passage_id: passageId, type, error: saved.error };
  }

  return { ok: true, passage_id: passageId, type, inserted_id: saved.inserted_id };
}

export type RunVariantAutoFillBatchInput = {
  textbookParam: string;
  orderIdRaw: string;
  orderNumberRaw?: string | null;
  requiredPerTypeRaw?: string | null;
  questionStatusRaw?: string | null;
  maxGenerations: number;
};

export type RunVariantAutoFillBatchResult =
  | {
      ok: true;
      textbook: string;
      scope: 'textbook' | 'order';
      planned: number;
      succeeded: Extract<VariantAutoFillOneResult, { ok: true }>[];
      failed: Extract<VariantAutoFillOneResult, { ok: false }>[];
      validation: Pick<
        QuestionCountValidationPayload,
        | 'noQuestionsTotal'
        | 'underfilledTotal'
        | 'requiredPerType'
        | 'questionStatusScope'
      >;
    }
  | { ok: false; error: string; status?: number };

/**
 * 문제수 검증과 동일 기준으로 부족 분을 짠 뒤, Claude API로 초안 생성 → generated_questions 저장.
 * 한 건씩 순차 실행 (API·레이트 제한 완화).
 */
export async function runVariantAutoFillBatch(
  input: RunVariantAutoFillBatchInput
): Promise<RunVariantAutoFillBatchResult> {
  const textbookParam = input.textbookParam.trim();
  const orderIdRaw = input.orderIdRaw.trim();
  const orderNumberRaw = (input.orderNumberRaw ?? '').trim();
  if (orderIdRaw && orderNumberRaw) {
    return { ok: false, error: 'orderId와 orderNumber는 동시에 쓸 수 없습니다.' };
  }
  if (!textbookParam && !orderIdRaw && !orderNumberRaw) {
    return { ok: false, error: 'textbook 또는 orderId 또는 orderNumber 중 하나는 필요합니다.' };
  }
  if (textbookParam && (orderIdRaw || orderNumberRaw)) {
    return { ok: false, error: 'textbook과 주문(orderId/orderNumber)은 동시에 쓸 수 없습니다.' };
  }

  const maxGen = Math.min(50, Math.max(1, Math.floor(input.maxGenerations)));

  const validation = await runQuestionCountValidation({
    textbookParam,
    orderIdRaw,
    orderNumberRaw: orderNumberRaw || null,
    requiredPerTypeRaw: input.requiredPerTypeRaw ?? null,
    questionStatusRaw: input.questionStatusRaw ?? 'all',
  });

  if (!validation.ok) {
    const err =
      typeof validation.body.error === 'string' ? validation.body.error : JSON.stringify(validation.body);
    return { ok: false, error: err, status: validation.status };
  }

  const capped = {
    ...validation,
    noQuestions: validation.noQuestions.slice(0, 5000),
    underfilled: validation.underfilled.slice(0, 5000),
  };

  const tasks = buildVariantAutoFillQueue(capped, maxGen);
  const delayMs = Math.max(
    0,
    Math.min(60_000, parseInt(process.env.VARIANT_AUTO_FILL_DELAY_MS || '0', 10) || 0)
  );

  const succeeded: Extract<VariantAutoFillOneResult, { ok: true }>[] = [];
  const failed: Extract<VariantAutoFillOneResult, { ok: false }>[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const r = await runOneAutoFillTask(tasks[i]);
    if (r.ok) {
      succeeded.push(r);
    } else {
      failed.push(r);
    }
    if (delayMs > 0 && i + 1 < tasks.length) {
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }

  return {
    ok: true,
    textbook: validation.textbook,
    scope: validation.scope,
    planned: tasks.length,
    succeeded,
    failed,
    validation: {
      noQuestionsTotal: validation.noQuestionsTotal,
      underfilledTotal: validation.underfilledTotal,
      requiredPerType: validation.requiredPerType,
      questionStatusScope: validation.questionStatusScope,
    },
  };
}
