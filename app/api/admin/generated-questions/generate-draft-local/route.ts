import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { requireAdmin } from '@/lib/admin-auth';

/** GPU 추론은 오래 걸릴 수 있음(파이프라인 + 7B 기준 분 단위). */
export const maxDuration = 300;

const PROJECT_ROOT = path.resolve(process.cwd());

const TYPE_ALIASES: Record<string, '주제' | '제목' | '주장'> = {
  주제: '주제',
  topic: '주제',
  제목: '제목',
  title: '제목',
  주장: '주장',
  claim: '주장',
};

/**
 * 로컬 LoRA(Windows CUDA, 같은 머신 GPU) 로 question_data 초안 생성 — Anthropic/Claude 호출 없음.
 * scripts/cc-<type>-local.ts 를 그 자리에서 spawn 한다("A) 같은 PC spawn" 설계, MVP).
 * 배포 서버 등 GPU가 없는 환경에서는 spawn 실패/stderr 를 그대로 에러로 돌려준다.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const passageIdStr = typeof body.passage_id === 'string' ? body.passage_id.trim() : '';
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    const typeRaw = typeof body.type === 'string' ? body.type.trim() : '';
    const usePipeline = body.pipeline !== false; // 기본 true — 작은 모델은 파이프라인이 안정적
    const doSave = body.save === true;
    const backend = typeof body.backend === 'string' && body.backend.trim() ? body.backend.trim() : 'cuda';

    const type = TYPE_ALIASES[typeRaw] ?? TYPE_ALIASES[typeRaw.toLowerCase()];
    if (!type) {
      return NextResponse.json(
        { error: `로컬 LoRA는 주제·제목·주장만 지원합니다 (받은 값: "${typeRaw}").` },
        { status: 400 }
      );
    }
    if (!passageIdStr) {
      return NextResponse.json({ error: 'passage_id가 필요합니다.' }, { status: 400 });
    }

    const args = [
      'tsx',
      'scripts/cc-local-variant.ts',
      '--type',
      type,
      '--backend',
      backend,
      '--passage-id',
      passageIdStr,
    ];
    if (usePipeline) args.push('--pipeline');
    if (textbook) args.push('--textbook', textbook);
    if (source) args.push('--source', source);
    if (doSave) args.push('--save');

    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn('npx', args, {
          cwd: PROJECT_ROOT,
          env: process.env,
          shell: process.platform === 'win32',
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d.toString()));
        child.stderr.on('data', (d) => (stderr += d.toString()));
        child.on('close', (code) => resolve({ code, stdout, stderr }));
        child.on('error', (e) => resolve({ code: -1, stdout, stderr: stderr + String(e) }));
      }
    );

    if (result.code !== 0) {
      // 로컬 GPU/venv/adapter 가 없는 환경(배포 서버 등)에서는 이 stderr 에 원인이 그대로 담긴다
      // (예: ".venv 없음. 먼저 setup.bat 을 실행하세요.", "CUDA GPU not available").
      const hint = result.stderr.trim() || result.stdout.trim() || `spawn exit ${result.code}`;
      return NextResponse.json(
        {
          error:
            `로컬 CUDA 워커 실행 실패 — 이 서버에 GPU/설정이 없으면 Windows GPU PC에서만 가능합니다.\n${hint}`.slice(
              0,
              4000
            ),
        },
        { status: 422 }
      );
    }

    // cc-local-variant.ts(→cc-<type>-local.ts)는 stdout 마지막 줄에 JSON 결과를 찍는다
    let parsed: Record<string, unknown> | null = null;
    for (const line of result.stdout.split(/\r?\n/).reverse()) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      try {
        parsed = JSON.parse(t) as Record<string, unknown>;
        break;
      } catch {
        continue;
      }
    }
    if (!parsed) {
      return NextResponse.json(
        { error: `로컬 CUDA 결과 JSON 파싱 실패.\n${result.stdout.slice(-2000)}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, type, backend, pipeline: usePipeline, ...parsed });
  } catch (e) {
    console.error('generate-draft-local:', e);
    return NextResponse.json({ error: '로컬 초안 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
