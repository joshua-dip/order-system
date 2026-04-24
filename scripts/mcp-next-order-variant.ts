/**
 * 변형문제 생성·저장용 MCP 서버 (stdio).
 * 프로젝트 루트에서: npx tsx scripts/mcp-next-order-variant.ts
 * Claude Code: claude mcp add next-order-variant --scope project -- npx tsx scripts/mcp-next-order-variant.ts
 *
 * 필요: MONGODB_URI. 검수(list/record)는 DB만 사용.
 * 초안·저장 일괄(variant_generate_draft / variant_generate_and_save)은 ANTHROPIC_API_KEY 필요 (웹 API와 동일).
 * Claude Code(Pro)에서 직접 문제를 쓰고 variant_save_generated_question 만 쓰면 API 키 없이 저장 가능.
 *
 * 도구 요약:
 * - variant_list_textbooks / variant_list_passages / variant_get_passage — 조회
 * - variant_get_shortage — 교재 또는 bookVariant(BV)·mockVariant(MV) 주문별 부족 집계 (orderNumber는 MongoDB orders 직접 조회, HTTP 불필요). 호출 후 진행 여부를 묻지 말고 부족이 있으면 곧바로 get_passage → 작성·save·검수로 이어질 것(도구 설명 참고).
 * - variant_generate_draft, variant_save_generated_question, variant_generate_and_save — 초안·저장
 * - variant_review_pending_list, variant_review_pending_record — 대기 검수 로그
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import { getDb } from '@/lib/mongodb';
import { generateVariantDraftQuestionDataWithClaude } from '@/lib/admin-variant-draft-claude';
import {
  listPendingReviewItems,
  recordReviewLogFromClaudeCode,
} from '@/lib/generated-question-review-cc';
import {
  runQuestionCountValidation,
  sliceQuestionCountPayloadForApi,
} from '@/lib/question-count-validation';
import { saveGeneratedQuestionToDb } from '@/lib/variant-save-generated-question';
import { saveGeneratedWorkbook } from '@/lib/generated-workbooks-store';
import type { WorkbookGrammarPoint } from '@/lib/workbook-grammar-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

function textResult(obj: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }],
  };
}

function textError(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: message }) }],
    isError: true as const,
  };
}

async function runGenerateDraft(args: {
  passage_id: string;
  textbook: string;
  source: string;
  type: string;
  userHint?: string;
  typePrompt?: string;
}) {
  const passageIdStr = args.passage_id.trim();
  const textbook = args.textbook.trim();
  const source = args.source.trim();
  const type = args.type.trim();
  const userHint = (args.userHint ?? '').trim().slice(0, 2000);
  const typePrompt = (args.typePrompt ?? '').trim().slice(0, 12000);

  if (!passageIdStr || !ObjectId.isValid(passageIdStr)) {
    return textError('유효한 passage_id(ObjectId 24hex)가 필요합니다.');
  }
  if (!textbook || !source || !type) {
    return textError('textbook, source, type은 필수입니다.');
  }

  const db = await getDb('gomijoshua');
  const passagesCol = db.collection('passages');
  const gqCol = db.collection('generated_questions');

  const passage = await passagesCol.findOne({ _id: new ObjectId(passageIdStr) });
  if (!passage) {
    return textError('원문 passage를 찾을 수 없습니다.');
  }

  const pTextbook = String(passage.textbook ?? '').trim();
  if (pTextbook !== textbook) {
    return textError(`원문 교재명("${pTextbook || '—'}")과 입력 textbook이 일치하지 않습니다.`);
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
    return textError('원문에 영어 지문(content.original 등)이 없어 초안을 만들 수 없습니다.');
  }

  const passageOid = new ObjectId(passageIdStr);
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
    userHint,
    typePrompt,
  });

  if (!ai.ok) {
    return textError(ai.error);
  }

  return textResult({
    ok: true,
    nextNum,
    passage_id: passageIdStr,
    textbook,
    source,
    type,
    question_data: ai.question_data,
    hint: 'DB에 넣으려면 variant_save_generated_question 도구를 호출하세요.',
  });
}

async function runSave(args: {
  passage_id: string;
  textbook: string;
  source: string;
  type: string;
  question_data_json: string;
  status?: string;
  option_type?: string;
  difficulty?: string;
}) {
  const passageIdStr = args.passage_id.trim();
  const textbook = args.textbook.trim();
  const source = args.source.trim();
  const type = args.type.trim();
  const option_type = (args.option_type ?? 'English').trim() || 'English';
  const docStatus = (args.status ?? '대기').trim() || '대기';
  const difficulty = (args.difficulty ?? '').trim() || undefined;

  if (!textbook || !passageIdStr || !ObjectId.isValid(passageIdStr)) {
    return textError('교재명과 유효한 passage_id가 필요합니다.');
  }
  if (!source || !type) {
    return textError('source와 type은 필수입니다.');
  }

  let question_data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(args.question_data_json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return textError('question_data_json은 객체 JSON이어야 합니다.');
    }
    question_data = parsed as Record<string, unknown>;
  } catch {
    return textError('question_data_json JSON 파싱 실패');
  }

  if (type === '워크북어법') {
    const qd = question_data;
    const wbSaved = await saveGeneratedWorkbook({
      passage_id: passageIdStr,
      textbook,
      passage_source_label: source,
      category: '워크북어법',
      paragraph: String(qd.Paragraph ?? ''),
      grammar_points: (qd.GrammarPoints ?? []) as WorkbookGrammarPoint[],
      answer_text: String(qd.AnswerText ?? ''),
      explanation: String(qd.Explanation ?? ''),
      created_by: 'mcp',
      status: docStatus === '완료' || docStatus === '검수완료' ? 'reviewed' : 'draft',
    });
    if (!wbSaved.ok) return textError(wbSaved.error);
    return textResult({
      ok: true,
      inserted_id: wbSaved.inserted_id,
      collection: 'generated_workbooks',
      textbook,
      passage_id: passageIdStr,
      source,
      type,
    });
  }

  const saved = await saveGeneratedQuestionToDb({
    passage_id: passageIdStr,
    textbook,
    source,
    type,
    question_data,
    status: docStatus,
    option_type,
    difficulty,
  });
  if (!saved.ok) {
    return textError(saved.error);
  }
  return textResult({
    ok: true,
    inserted_id: saved.inserted_id,
    textbook: saved.textbook,
    passage_id: saved.passage_id,
    source: saved.source,
    type: saved.type,
    status: saved.status,
  });
}

async function main() {
  const server = new McpServer({
    name: 'next-order-variant',
    version: '1.0.0',
  });

  server.registerTool(
    'variant_list_textbooks',
    {
      description:
        'MongoDB passages에 등록된 교재명(textbook) 고유 목록. Claude Code에서 교재를 고를 때 먼저 호출.',
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional().describe('최대 개수 (기본 200)'),
      },
    },
    async ({ limit }) => {
      try {
        const lim = limit ?? 200;
        const db = await getDb('gomijoshua');
        const names = await db.collection('passages').distinct('textbook');
        const sorted = names
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim())
          .sort((a, b) => a.localeCompare(b, 'ko'));
        const list = sorted.slice(0, lim);
        return textResult({ ok: true, count: list.length, total_distinct: sorted.length, textbooks: list });
      } catch (e) {
        return textError(e instanceof Error ? e.message : '교재 목록 조회 실패');
      }
    }
  );

  server.registerTool(
    'variant_get_passage',
    {
      description:
        'passage_id로 원문 전체 조회(content.original·mixed·translation 등). 지문을 읽고 변형문제를 만들 때 사용.',
      inputSchema: {
        passage_id: z.string().describe('passages._id 24자 hex'),
      },
    },
    async ({ passage_id }) => {
      try {
        const id = passage_id.trim();
        if (!ObjectId.isValid(id)) {
          return textError('유효한 passage_id(ObjectId 24hex)가 필요합니다.');
        }
        const db = await getDb('gomijoshua');
        const p = await db.collection('passages').findOne({ _id: new ObjectId(id) });
        if (!p) {
          return textError('passage를 찾을 수 없습니다.');
        }
        const content =
          p.content && typeof p.content === 'object' && !Array.isArray(p.content)
            ? (p.content as Record<string, unknown>)
            : {};
        return textResult({
          ok: true,
          passage_id: String(p._id),
          textbook: String(p.textbook ?? ''),
          source_key: String(p.source_key ?? ''),
          passage_source: String(p.passage_source ?? ''),
          chapter: p.chapter ?? '',
          number: p.number ?? '',
          content,
        });
      } catch (e) {
        return textError(e instanceof Error ? e.message : '원문 조회 실패');
      }
    }
  );

  server.registerTool(
    'variant_get_shortage',
    {
      description:
        '교재 전체 또는 bookVariant 주문 기준 부족·미작성 (passage×유형) 집계. 관리자「문제수 검증」과 동일. ' +
        '반드시 이 도구만 사용: 주문번호(BV·MV 등)는 인자 orderNumber에 그대로 넣으면 된다. ' +
        'bookVariant는 selectedLessons·selectedTextbook, mockVariant는 examSelections(모의고사 키·번호)로 지문을 매칭한다. ' +
        '이 MCP는 MongoDB `gomijoshua.orders`에서 findOne({ orderNumber })로 주문을 찾은 뒤 검증한다. ' +
        '관리자 HTTP API·curl·로그인·별도 orderId 조회 스크립트·bookVariantOrders 컬렉션을 쓰지 말 것. ' +
        '응답 요약: pendingReviewTotal=검수·풀이 대상 대기 문항 수, needCreateGrandTotal=아직 없어서 새로 만들어야 하는 문항 수(부분부족 shortBy 합 + 변형0건 지문 슬롯). needCreateShortBySum / needCreateFromEmptyPassagesTotal 로 분해. questionStatus=all이면 underfilled[].statusBreakdown(완료/대기/검수불일치/기타). ' +
        '**필수 동작:** 이 도구로 집계만 보여 주고 끝내지 말 것. 「만들까요」「진행할까요」 등 **사용자에게 되묻지 말 것.** needCreateGrandTotal>0이면 underfilled(및 필요 시 noQuestions) 행마다 passage_id·textbook·type·shortBy를 쓰고, **즉시** variant_get_passage로 원문을 읽은 뒤 shortBy만큼 문항을 만들어 variant_save_generated_question으로 저장한다(주문의 source/출처 라벨은 주문 메타·기존 변형문과 동일 규칙으로 맞출 것). API 초안 금지 정책이면 채팅에서 question_data를 작성한 뒤 save만 호출. pendingReviewTotal>0이면 variant_review_pending_list로 검수를 이어간다.',
      inputSchema: {
        textbook: z.string().optional().describe('교재명 (주문 미지정 시 필수)'),
        orderId: z
          .string()
          .optional()
          .describe(
            '주문 MongoDB _id(24자 hex) 또는 주문번호(BV·MV·…). 주문번호 형태는 서버가 orders.orderNumber 조회로 처리'
          ),
        orderNumber: z
          .string()
          .optional()
          .describe(
            '주문번호 문자열 orders.orderNumber (예: BV-20260331-002). 이 값만으로 MongoDB에서 주문 조회 후 집계. orderId와 동시 지정 불가'
          ),
        requiredPerType: z.number().int().min(1).max(20).optional().describe('유형당 목표 문항 수 (기본 3)'),
        questionStatus: z
          .enum(['all', '대기', '완료', '검수불일치'])
          .optional()
          .describe('집계에 포함할 변형문 status (기본 all)'),
        maxRows: z
          .number()
          .int()
          .min(20)
          .max(2000)
          .optional()
          .describe('noQuestions·underfilled 각 최대 행 수 (기본 200, 응답 크기 제한)'),
      },
    },
    async ({ textbook, orderId, orderNumber, requiredPerType, questionStatus, maxRows }) => {
      try {
        const textbookParam = (textbook ?? '').trim();
        const orderIdRaw = (orderId ?? '').trim();
        const orderNumberRaw = (orderNumber ?? '').trim();
        if (!textbookParam && !orderIdRaw && !orderNumberRaw) {
          return textError('textbook 또는 orderId 또는 orderNumber 중 하나는 필요합니다.');
        }
        const result = await runQuestionCountValidation({
          textbookParam,
          orderIdRaw,
          orderNumberRaw: orderNumberRaw || null,
          requiredPerTypeRaw: requiredPerType != null ? String(requiredPerType) : null,
          questionStatusRaw: questionStatus ?? null,
        });
        if (!result.ok) {
          return textError(
            typeof result.body.error === 'string' ? result.body.error : JSON.stringify(result.body)
          );
        }
        const cap = maxRows ?? 200;
        const sliced = sliceQuestionCountPayloadForApi(result, cap);
        return textResult(sliced);
      } catch (e) {
        return textError(e instanceof Error ? e.message : '부족 문항 집계 실패');
      }
    }
  );

  server.registerTool(
    'variant_list_passages',
    {
      description:
        '교재명(textbook)으로 passages 컬렉션에서 지문 목록을 조회합니다. passage_id를 얻을 때 사용하세요.',
      inputSchema: {
        textbook: z.string().describe('MongoDB passages.textbook 과 동일한 교재명'),
        limit: z.number().int().min(1).max(100).optional().describe('최대 개수 (기본 40)'),
      },
    },
    async ({ textbook, limit }) => {
      try {
        const lim = limit ?? 40;
        const db = await getDb('gomijoshua');
        const items = await db
          .collection('passages')
          .find({ textbook: textbook.trim() })
          .project({
            _id: 1,
            textbook: 1,
            chapter: 1,
            number: 1,
            source_key: 1,
          })
          .limit(lim)
          .toArray();
        return textResult({
          ok: true,
          count: items.length,
          passages: items.map((p) => ({
            passage_id: String(p._id),
            textbook: p.textbook ?? '',
            chapter: p.chapter ?? '',
            number: p.number ?? '',
            source_key: p.source_key ?? '',
          })),
        });
      } catch (e) {
        return textError(e instanceof Error ? e.message : '목록 조회 실패');
      }
    }
  );

  server.registerTool(
    'variant_generate_draft',
    {
      description:
        '지문(passage)과 유형으로 Claude가 변형문제 question_data 초안을 생성합니다. DB에는 저장하지 않습니다. 관리자 화면의「Claude로 초안 생성」과 동일한 로직입니다.',
      inputSchema: {
        passage_id: z.string().describe('passages._id 24자 hex'),
        textbook: z.string().describe('원문과 동일한 교재명'),
        source: z.string().describe('출처 라벨 (예: 모의고사 회차·지문 구분)'),
        type: z
          .string()
          .describe(
            '유형: 주제, 제목, 주장, 일치, 불일치, 함의(함축의미), 어법, 순서(글의순서), 삽입(문장삽입), 빈칸(요약), 등'
          ),
        userHint: z.string().optional().describe('이번 문항만의 추가 지시 (선택)'),
        typePrompt: z.string().optional().describe('유형별 커스텀 출제 지침 (선택)'),
      },
    },
    async (args) => runGenerateDraft(args)
  );

  server.registerTool(
    'variant_save_generated_question',
    {
      description:
        'variant_generate_draft로 받은 question_data를 generated_questions에 저장합니다. 기본 status는 대기(검수 전).',
      inputSchema: {
        passage_id: z.string(),
        textbook: z.string(),
        source: z.string(),
        type: z.string(),
        question_data_json: z
          .string()
          .describe('question_data 객체 전체를 JSON 문자열로 (generate_draft 결과의 question_data)'),
        status: z.string().optional().describe('기본: 대기'),
        option_type: z.string().optional().describe('기본: English'),
        difficulty: z.string().optional().describe("난이도: '하', '중', '상' (기본: question_data.DifficultyLevel 또는 '중')"),
      },
    },
    async (args) => runSave(args)
  );

  server.registerTool(
    'variant_generate_and_save',
    {
      description: '초안 생성 후 곧바로 DB에 저장합니다 (한 번에 끝내기).',
      inputSchema: {
        passage_id: z.string(),
        textbook: z.string(),
        source: z.string(),
        type: z.string(),
        userHint: z.string().optional(),
        typePrompt: z.string().optional(),
        status: z.string().optional().describe('기본: 대기'),
      },
    },
    async (args) => {
      const draft = await runGenerateDraft(args);
      const text = draft.content[0]?.type === 'text' ? draft.content[0].text : '';
      let parsed: { ok?: boolean; error?: string; question_data?: Record<string, unknown> };
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        return textError('초안 응답 파싱 실패');
      }
      if (!parsed.ok || !parsed.question_data) {
        return textError(parsed.error || '초안에 question_data가 없습니다.');
      }
      return runSave({
        passage_id: args.passage_id,
        textbook: args.textbook,
        source: args.source,
        type: args.type,
        question_data_json: JSON.stringify(parsed.question_data),
        status: args.status,
      });
    }
  );

  server.registerTool(
    'variant_review_pending_list',
    {
      description:
        'status「대기」변형문제 목록만 조회합니다. 정답은 포함하지 않습니다. Anthropic API를 호출하지 않습니다. Claude Code가 각 문항을 푼 뒤 variant_review_pending_record로 기록하세요.',
      inputSchema: {
        limit: z.number().int().min(1).max(30).optional().describe('최대 건수 (기본 10)'),
        textbook: z.string().optional().describe('해당 교재의 대기만'),
      },
    },
    async ({ limit, textbook }) => {
      try {
        const { items } = await listPendingReviewItems({
          limit: limit ?? 10,
          textbook: textbook?.trim() ?? '',
        });
        return textResult({ ok: true, count: items.length, items });
      } catch (e) {
        return textError(e instanceof Error ? e.message : '대기 목록 조회 실패');
      }
    }
  );

  server.registerTool(
    'variant_review_pending_record',
    {
      description:
        'Claude Code가 푼 결과를 generated_question_claude_reviews에 저장합니다. 서버가 DB 정답과 비교해 is_correct를 계산합니다. ' +
        '문항이 status「대기」이고 is_correct가 true이면 기본은「완료」로 갱신합니다. attemptNumber가 2 이상이면 재시도 검수로 보아「검수불일치」로 갱신합니다. Anthropic API 없음.',
      inputSchema: {
        generated_question_id: z.string().describe('24자리 ObjectId'),
        claude_answer: z.string().optional().describe('추출한 정답(번호·기호 등). error 있으면 비워도 됨'),
        claude_response: z.string().optional().describe('풀이 전문 또는 요약'),
        model: z.string().optional().describe('예: claude-code (기본 claude-code)'),
        error: z.string().optional().describe('풀이 불가 시 사유(있으면 오류 로그 행으로 저장)'),
        attemptNumber: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('몇 번째 풀이 시도인지(미지정·1이면 정답 시 완료, 2 이상이면 정답 시 검수불일치)'),
      },
    },
    async ({ generated_question_id, claude_answer, claude_response, model, error, attemptNumber }) => {
      try {
        const out = await recordReviewLogFromClaudeCode({
          generated_question_id,
          claude_answer: claude_answer ?? '',
          claude_response: claude_response ?? '',
          model,
          error: error ?? null,
          admin_login_id: 'claude-code-mcp',
          attemptNumber: attemptNumber ?? null,
        });
        if (!out.ok) {
          return textError(out.error || '기록 실패');
        }
        return textResult(out);
      } catch (e) {
        return textError(e instanceof Error ? e.message : '검수 기록 실패');
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
