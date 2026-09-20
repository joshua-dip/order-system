/**
 * 로컬 주제 LoRA 추론 → prevalidate → (옵션) save.
 * Anthropic/Claude API 호출 없음.
 *
 *   Mac MLX:     npm run cc:topic-local -- --passage-id <ObjectId>
 *   Windows CUDA: npm run cc:topic-local -- --backend cuda --passage-id <ObjectId>
 *                 set TOPIC_BACKEND=cuda
 *
 *   npm run cc:topic-local -- --passage-id <ObjectId> --save
 *   npm run cc:topic-local -- --passage-file p.txt --textbook "..." --source "..."
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectId } from 'mongodb';
import { loadCliEnv } from './_cli-env';
import { getDb } from '@/lib/mongodb';
import { getPassageTextForVariantCompare } from '@/lib/passage-variant-text';
import { saveGeneratedQuestionToDb } from '@/lib/variant-save-generated-question';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
loadCliEnv(PROJECT_ROOT);

const DRAFTS_DIR = path.join(PROJECT_ROOT, '.variant-drafts');
const INFER_MLX = path.join(PROJECT_ROOT, 'ml/topic/infer.py');
const INFER_CUDA = path.join(PROJECT_ROOT, 'ml/topic/windows/infer.py');
const ADAPTER_MLX = path.join(PROJECT_ROOT, 'ml/topic/adapters/topic-lora');
const ADAPTER_CUDA = path.join(PROJECT_ROOT, 'ml/topic/adapters/topic-lora-cuda');

type Backend = 'mlx' | 'cuda';

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

function resolveBackend(flags: Map<string, string>): Backend {
  const raw = (flags.get('backend') || process.env.TOPIC_BACKEND || '').trim().toLowerCase();
  if (raw === 'cuda' || raw === 'windows' || raw === 'hf') return 'cuda';
  if (raw === 'mlx' || raw === 'mac') return 'mlx';
  // 자동: Windows 이거나 CUDA 어댑터가 있으면 cuda
  if (process.platform === 'win32') return 'cuda';
  if (fs.existsSync(path.join(ADAPTER_CUDA, 'adapter_config.json'))) return 'cuda';
  return 'mlx';
}

function pythonBin(backend: Backend): string {
  if (backend === 'cuda') {
    const envPy = (process.env.TOPIC_CUDA_VENV || '').trim();
    const candidates = [
      envPy ? path.join(envPy, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') : '',
      path.join(PROJECT_ROOT, 'ml/topic/windows/.venv/Scripts/python.exe'),
      path.join(PROJECT_ROOT, 'ml/topic/windows/.venv/bin/python'),
    ].filter(Boolean);
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  const envPy = (process.env.TOPIC_MLX_VENV || '').trim();
  const candidates = [
    envPy ? path.join(envPy, 'bin/python') : '',
    path.join(PROJECT_ROOT, 'ml/topic/.venv/bin/python'),
    '/tmp/topic-mlx-venv/bin/python',
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'python3';
}

function runPrevalidate(draftPath: string): { ok: boolean; output: string } {
  const r = spawnSync(
    'npx',
    ['tsx', path.join(PROJECT_ROOT, 'scripts/prevalidate-variants.ts'), draftPath],
    {
      encoding: 'utf8',
      cwd: PROJECT_ROOT,
      env: process.env,
      shell: process.platform === 'win32',
    }
  );
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  return { ok: r.status === 0, output };
}

function runInfer(
  passage: string,
  backend: Backend,
  model?: string,
  adapter?: string
): Record<string, unknown> {
  const inferPy = backend === 'cuda' ? INFER_CUDA : INFER_MLX;
  const defaultAdapter = backend === 'cuda' ? ADAPTER_CUDA : ADAPTER_MLX;
  if (!fs.existsSync(inferPy)) {
    throw new Error(`infer.py 없음: ${inferPy}`);
  }
  const tmp = path.join(DRAFTS_DIR, `_topic-passage-${Date.now()}.txt`);
  fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  fs.writeFileSync(tmp, passage, 'utf8');
  try {
    const args = [inferPy, '--passage-file', tmp];
    const adapterPath = adapter || defaultAdapter;
    if (fs.existsSync(adapterPath)) {
      args.push('--adapter', adapterPath);
    }
    if (model) args.push('--model', model);

    const r = spawnSync(pythonBin(backend), args, {
      encoding: 'utf8',
      cwd: PROJECT_ROOT,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
    });
    const out = (r.stdout || '').trim();
    const err = (r.stderr || '').trim();
    if (r.status !== 0 && !out) {
      throw new Error(`infer 실패 (exit ${r.status}): ${err || 'no output'}`);
    }
    let parsed: Record<string, unknown> | null = null;
    for (const line of out.split(/\r?\n/)) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      try {
        const obj = JSON.parse(t) as Record<string, unknown>;
        if (obj && typeof obj === 'object') {
          parsed = obj;
          break;
        }
      } catch {
        /* next line */
      }
    }
    if (!parsed) {
      throw new Error(`infer JSON 파싱 실패: ${out.slice(0, 400)}\nstderr: ${err.slice(0, 400)}`);
    }
    if (!parsed.ok) {
      throw new Error(
        String(parsed.error || 'infer ok=false') +
          (parsed.raw ? `\nraw: ${String(parsed.raw).slice(0, 500)}` : '')
      );
    }
    const qd = parsed.question_data;
    if (!qd || typeof qd !== 'object' || Array.isArray(qd)) {
      throw new Error('infer 결과에 question_data 없음');
    }
    return qd as Record<string, unknown>;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  const { flags } = parseFlags(process.argv.slice(2));
  const passageId = (flags.get('passage-id') || '').trim();
  const passageFile = (flags.get('passage-file') || '').trim();
  const doSave = flags.get('save') === 'true';
  const model = flags.get('model');
  const adapter = flags.get('adapter');
  const backend = resolveBackend(flags);

  let paragraph = '';
  let textbook = (flags.get('textbook') || '').trim();
  let source = (flags.get('source') || '').trim();
  let pid = passageId;

  if (passageFile) {
    paragraph = fs.readFileSync(passageFile, 'utf8').trim();
  } else if (passageId) {
    if (!ObjectId.isValid(passageId)) {
      console.error('유효한 --passage-id (ObjectId) 가 필요합니다.');
      process.exit(1);
    }
    const db = await getDb('gomijoshua');
    const passage = await db.collection('passages').findOne({ _id: new ObjectId(passageId) });
    if (!passage) {
      console.error('passage 없음:', passageId);
      process.exit(1);
    }
    paragraph = getPassageTextForVariantCompare(passage.content);
    if (!textbook) textbook = String(passage.textbook ?? '').trim();
    if (!source) {
      const c =
        passage.content && typeof passage.content === 'object' && !Array.isArray(passage.content)
          ? (passage.content as Record<string, unknown>)
          : {};
      source =
        String(passage.source ?? c.source ?? passage.label ?? '').trim() ||
        `${textbook || 'passage'} ${passageId.slice(-6)}`;
    }
  } else {
    console.error(`사용법:
  npm run cc:topic-local -- --passage-id <ObjectId> [--save]
  npm run cc:topic-local -- --backend cuda --passage-id <ObjectId> [--save]
  npm run cc:topic-local -- --passage-file p.txt --textbook "교재" --source "출처" [--save]

사전:
  npm run cc:topic-export
  Mac:    ml/topic/train.sh
  Windows: ml/topic/windows/setup.bat && train.bat
Claude/Anthropic 는 사용하지 않습니다. (backend=${backend}, platform=${process.platform})`);
    process.exit(1);
  }

  if (!paragraph) {
    console.error('지문 본문이 비어 있습니다.');
    process.exit(1);
  }

  const defaultAdapter = backend === 'cuda' ? ADAPTER_CUDA : ADAPTER_MLX;
  if (!fs.existsSync(adapter || defaultAdapter)) {
    console.error(
      `경고: adapter 디렉터리 없음 (${adapter || defaultAdapter}). 베이스 모델만으로 추론합니다.\n` +
        (backend === 'cuda'
          ? `학습: cd ml\\topic\\windows && train.bat`
          : `학습: cd ml/topic && ./train.sh`)
    );
  }

  console.error(`infer 중… backend=${backend} host=${os.hostname()}`);
  const question_data = runInfer(paragraph, backend, model, adapter);
  question_data.Paragraph = paragraph;
  question_data.OptionType = 'English';
  if (typeof question_data.Category !== 'string') question_data.Category = '주제';

  const draftItem = {
    passage_id: pid || '000000000000000000000000',
    textbook: textbook || 'local',
    source: source || 'local-topic',
    type: '주제',
    option_type: 'English',
    status: '대기',
    ai_source: 'local-topic-lora',
    question_data,
  };

  fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const draftPath = path.join(
    DRAFTS_DIR,
    `topic-local-${pid || 'file'}-${stamp}.json`
  );
  fs.writeFileSync(draftPath, JSON.stringify([draftItem], null, 2) + '\n', 'utf8');
  console.error('draft:', draftPath);

  if (pid && ObjectId.isValid(pid)) {
    console.error('prevalidate…');
    const pv = runPrevalidate(draftPath);
    console.error(pv.output.trim());
    if (!pv.ok) {
      console.error('prevalidate 실패 — 저장하지 않습니다. draft만 남겼습니다.');
      process.exit(2);
    }
  } else {
    console.error('passage-id 없음 — prevalidate(DB 지문 대조) 생략');
  }

  if (doSave) {
    if (!pid || !ObjectId.isValid(pid) || !textbook || !source) {
      console.error('--save 에는 --passage-id 와 textbook/source 가 필요합니다.');
      process.exit(1);
    }
    const saved = await saveGeneratedQuestionToDb({
      passage_id: pid,
      textbook,
      source,
      type: '주제',
      question_data,
      status: '대기',
      option_type: 'English',
      ai_source: 'local-topic-lora',
    });
    console.log(JSON.stringify({ draft: draftPath, backend, save: saved }, null, 2));
    process.exit(saved.ok ? 0 : 1);
  }

  console.log(JSON.stringify({ ok: true, backend, draft: draftPath, question_data }, null, 2));
}

main().catch((e) => {
  console.error('실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
