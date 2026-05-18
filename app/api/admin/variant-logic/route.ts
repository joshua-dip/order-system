import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

type SourceFileEntry = {
  key: string;
  label: string;
  description: string;
  path: string;
  language: string;
  content: string | null;
  lineCount: number;
  bytes: number;
  error: string | null;
};

type MemoryEntry = {
  name: string;
  content: string;
  bytes: number;
};

const SOURCE_FILES: Array<{
  key: string;
  label: string;
  description: string;
  path: string;
  language: string;
}> = [
  {
    key: 'mcp-server',
    label: 'MCP 서버 (stdio · 7개 도구)',
    description:
      'Claude Code(Pro)에서 stdio MCP로 등록되는 변형문제 도구 정의. variant_list_textbooks/list_passages/get_passage/get_shortage/save_generated_question/review_pending_list/review_pending_record 등.',
    path: 'scripts/mcp-next-order-variant.ts',
    language: 'typescript',
  },
  {
    key: 'cc-variant-cli',
    label: 'CLI (npm run cc:variant)',
    description:
      'MCP 없이 동일 작업을 터미널에서 수행하는 CLI. 단축어 `npm run claude -- claude:BV-…` 가 호출하는 본체.',
    path: 'scripts/cc-variant-cli.ts',
    language: 'typescript',
  },
  {
    key: 'save-question',
    label: '저장 로직 (DB insert)',
    description:
      'variant_save_generated_question / save 명령이 실제로 generated_questions 컬렉션에 insert 할 때 거치는 검증·정규화 로직.',
    path: 'lib/variant-save-generated-question.ts',
    language: 'typescript',
  },
  {
    key: 'shortage',
    label: '부족 집계 (variant_get_shortage)',
    description:
      '교재·주문번호(BV/MV) 기준으로 「검수 대기」와 「신규 제작 필요」 수를 계산. 관리자 「문제수 검증」 화면과 동일.',
    path: 'lib/question-count-validation.ts',
    language: 'typescript',
  },
  {
    key: 'review-cc',
    label: '검수 기록 (variant_review_pending_record)',
    description:
      'Claude Code가 푼 답을 DB와 비교해 자동으로 「완료」/「검수불일치」 로 갱신하는 로직. attemptNumber 1=완료, 2+=검수불일치.',
    path: 'lib/generated-question-review-cc.ts',
    language: 'typescript',
  },
  {
    key: 'draft-claude',
    label: 'Claude API 초안 (Pro 정책에선 미사용)',
    description:
      '관리자 화면 「Claude로 초안 생성」과 MCP의 variant_generate_draft 가 호출하는 Anthropic API 호출 로직. Pro 플랜만 쓸 때는 사용하지 말 것.',
    path: 'lib/admin-variant-draft-claude.ts',
    language: 'typescript',
  },
  {
    key: 'claude-md',
    label: 'CLAUDE.md (프로젝트 규칙)',
    description:
      'Claude Code 가 항상 읽는 프로젝트 지침. Pro 정책·MCP 도구 단축어·MV/BV 주문 처리 규칙·서술형 출제기 흐름까지 포함.',
    path: 'CLAUDE.md',
    language: 'markdown',
  },
];

const MCP_TOOLS: Array<{
  name: string;
  step: string;
  inputs: string[];
  description: string;
  apiKey: 'pro-only' | 'no-api' | 'api-key-required';
}> = [
  {
    name: 'variant_list_textbooks',
    step: '0. 교재 고르기',
    inputs: ['limit?'],
    description: 'passages 컬렉션에 등록된 교재명(textbook) 고유 목록을 가나다 정렬로 반환.',
    apiKey: 'no-api',
  },
  {
    name: 'variant_list_passages',
    step: '1. 지문 ID 찾기',
    inputs: ['textbook', 'limit?'],
    description: '교재명으로 passages 목록 조회 → passage_id(24자 hex), source_key, chapter, number 확보.',
    apiKey: 'no-api',
  },
  {
    name: 'variant_get_passage',
    step: '2. 지문 본문 읽기',
    inputs: ['passage_id'],
    description:
      'passage_id로 원문 전체 읽기. content.original·mixed·translation 등 9문장·번역·tokenized 정보 반환.',
    apiKey: 'no-api',
  },
  {
    name: 'variant_get_shortage',
    step: '+ 부족·워크로드 집계',
    inputs: ['textbook?', 'orderId?', 'orderNumber?', 'requiredPerType?', 'questionStatus?', 'maxRows?'],
    description:
      '교재 또는 주문(BV/MV) 기준 부족·미작성 (passage×유형) 집계. pendingReviewTotal=대기 검수, needCreateGrandTotal=신규 제작 필요.',
    apiKey: 'no-api',
  },
  {
    name: 'variant_save_generated_question',
    step: '3. 문항 저장',
    inputs: ['passage_id', 'textbook', 'source', 'type', 'question_data_json', 'status?', 'option_type?', 'difficulty?'],
    description:
      '채팅에서 작성한 question_data 를 generated_questions 에 insert. 기본 status=대기, option_type=English. Pro 정책에서 핵심 도구.',
    apiKey: 'no-api',
  },
  {
    name: 'variant_review_pending_list',
    step: '4. 대기 검수 풀기',
    inputs: ['limit?', 'textbook?'],
    description: 'status=대기 변형문제 목록만 조회 (정답 미포함). Claude Code가 풀고 record 로 기록.',
    apiKey: 'no-api',
  },
  {
    name: 'variant_review_pending_record',
    step: '4-1. 검수 결과 기록',
    inputs: ['generated_question_id', 'claude_answer?', 'claude_response?', 'attemptNumber?', 'error?'],
    description:
      '풀이 결과를 generated_question_claude_reviews 에 저장. 서버가 DB 정답과 비교해 첫 시도면 「완료」, 2회 이상이면 「검수불일치」 자동 갱신.',
    apiKey: 'no-api',
  },
  {
    name: 'variant_generate_draft',
    step: '⚠ 사용 금지 (Pro 정책)',
    inputs: ['passage_id', 'textbook', 'source', 'type', 'userHint?', 'typePrompt?'],
    description:
      'Anthropic API 호출 — Pro 플랜만 쓸 때는 호출 금지. 같은 일을 채팅 + variant_save_generated_question 으로 대체.',
    apiKey: 'api-key-required',
  },
  {
    name: 'variant_generate_and_save',
    step: '⚠ 사용 금지 (Pro 정책)',
    inputs: ['passage_id', 'textbook', 'source', 'type', 'userHint?', 'typePrompt?', 'status?'],
    description: 'generate_draft + save 일괄 — Anthropic API 호출. Pro 정책에선 사용 금지.',
    apiKey: 'api-key-required',
  },
];

const FLOW_STEPS = [
  {
    n: 1,
    title: '교재·지문 정하기',
    detail: 'variant_list_textbooks → variant_list_passages 한 번. 이후 passage_id 로 본문은 직접 캐싱.',
  },
  {
    n: 2,
    title: '부족 분 확인',
    detail:
      'variant_get_shortage(textbook 또는 orderNumber) — pendingReviewTotal(대기) / needCreateGrandTotal(신규) 분리. 부족이 있으면 되묻지 말고 곧장 다음 단계.',
  },
  {
    n: 3,
    title: '본문 받아 채팅에서 작성',
    detail:
      'variant_get_passage 로 9문장·번역 받기 → 채팅에서 유형별(주제/제목/일치/불일치/빈칸/요약/어법/순서/삽입/무관한문장/삽입-고난도) 옵션·정답·해설 작성.',
  },
  {
    n: 4,
    title: '일괄 저장',
    detail: 'variant_save_generated_question 한 턴에 6~10개 병렬 호출. 기본 status=대기.',
  },
  {
    n: 5,
    title: '대기 검수 일괄 처리',
    detail:
      'variant_review_pending_list → 풀이 → variant_review_pending_record (한 턴에 10개씩). 정답 일치·1회차 = 자동 「완료」, 2회차+ = 「검수불일치」.',
  },
];

async function readSourceFile(rootDir: string, relPath: string): Promise<{
  content: string | null;
  bytes: number;
  lineCount: number;
  error: string | null;
}> {
  try {
    const abs = path.join(rootDir, relPath);
    const buf = await fs.readFile(abs);
    const text = buf.toString('utf8');
    return {
      content: text,
      bytes: buf.byteLength,
      lineCount: text === '' ? 0 : text.split('\n').length,
      error: null,
    };
  } catch (e) {
    return {
      content: null,
      bytes: 0,
      lineCount: 0,
      error: e instanceof Error ? e.message : '파일을 읽지 못했습니다.',
    };
  }
}

async function readMemoryDir(): Promise<{
  available: boolean;
  dir: string;
  entries: MemoryEntry[];
  error: string | null;
}> {
  const dir = path.join(
    os.homedir(),
    '.claude',
    'projects',
    '-Users-goshua-next-order',
    'memory'
  );
  try {
    const names = await fs.readdir(dir);
    const mdNames = names.filter((n) => n.toLowerCase().endsWith('.md')).sort();
    const entries: MemoryEntry[] = [];
    for (const name of mdNames) {
      try {
        const buf = await fs.readFile(path.join(dir, name));
        entries.push({ name, content: buf.toString('utf8'), bytes: buf.byteLength });
      } catch {
        // skip
      }
    }
    return { available: true, dir, entries, error: null };
  } catch (e) {
    return {
      available: false,
      dir,
      entries: [],
      error: e instanceof Error ? e.message : '메모리 디렉터리에 접근할 수 없습니다.',
    };
  }
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const root = process.cwd();
  const sourceFiles: SourceFileEntry[] = await Promise.all(
    SOURCE_FILES.map(async (f) => {
      const r = await readSourceFile(root, f.path);
      return {
        key: f.key,
        label: f.label,
        description: f.description,
        path: f.path,
        language: f.language,
        content: r.content,
        lineCount: r.lineCount,
        bytes: r.bytes,
        error: r.error,
      };
    })
  );

  const memory = await readMemoryDir();

  return NextResponse.json({
    flow: FLOW_STEPS,
    mcpTools: MCP_TOOLS,
    sourceFiles,
    memory,
    rootDir: root,
  });
}
