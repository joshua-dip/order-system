/**
 * 로컬 LoRA 변형문제 CLI 공용 구현 — cc-local-variant.ts(--type 으로 고름)와
 * cc-topic/title/claim-local.ts(유형 고정)가 모두 이 함수를 부른다. Anthropic 호출 없음.
 *
 * 이 PC 에서 파이썬을 직접 띄운다(워커 큐를 거치지 않음). 워커가 모델을 올려 둔 상태면
 * 4GB GPU 에 두 벌이 올라가니 워커가 모델을 내려놓았을 때 쓴다(docs/ml/local-variant-worker.md).
 * 하위 프로세스는 셸 없이 인자 배열 그대로 띄운다 — Windows 에서 공백 든 교재명이 쪼개지지 않게.
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
import { checkContentIntegrity } from '@/lib/content-integrity-validation';
import { runPerQuestionValidations } from '@/lib/variant-review-validators';
import { splitQuestionOptionSegments } from '@/lib/question-options-segments';
import { LOCAL_VARIANT_TYPES, resolveLocalVariantType, type LocalVariantType } from '@/lib/local-variant-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
loadCliEnv(PROJECT_ROOT);

const DRAFTS_DIR = path.join(PROJECT_ROOT, '.variant-drafts');

type Backend = 'mlx' | 'cuda';

type TypePaths = {
  en: string;
  envPrefix: string;
  inferMlx: string;
  inferCuda: string;
  pipelineCuda: string;
  adapterMlx: string;
  adapterCuda: string;
};

function typePaths(type: LocalVariantType): TypePaths {
  const en = LOCAL_VARIANT_TYPES[type].en;
  return {
    en,
    envPrefix: en.toUpperCase(),
    inferMlx: path.join(PROJECT_ROOT, `ml/${en}/infer.py`),
    inferCuda: path.join(PROJECT_ROOT, `ml/${en}/windows/infer.py`),
    pipelineCuda: path.join(PROJECT_ROOT, `ml/${en}/windows/pipeline_${en}.py`),
    adapterMlx: path.join(PROJECT_ROOT, `ml/${en}/adapters/${en}-lora`),
    adapterCuda: path.join(PROJECT_ROOT, `ml/${en}/adapters/${en}-lora-cuda`),
  };
}

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.replace(/^--/, '');
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, 'true');
    }
  }
  return flags;
}

function resolveBackend(flags: Map<string, string>, p: TypePaths): Backend {
  const raw = (flags.get('backend') || process.env[`${p.envPrefix}_BACKEND`] || process.env.BACKEND || '')
    .trim()
    .toLowerCase();
  if (raw === 'cuda' || raw === 'windows' || raw === 'hf') return 'cuda';
  if (raw === 'mlx' || raw === 'mac') return 'mlx';
  if (process.platform === 'win32') return 'cuda';
  if (fs.existsSync(path.join(p.adapterCuda, 'adapter_config.json'))) return 'cuda';
  return 'mlx';
}

function pythonBin(backend: Backend, p: TypePaths): string {
  const exe = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
  const candidates =
    backend === 'cuda'
      ? [
          (process.env[`${p.envPrefix}_CUDA_VENV`] || '').trim(),
          path.join(PROJECT_ROOT, `ml/${p.en}/windows/.venv`),
          // 세 유형이 같이 쓰는 venv(주제 폴더에 한 벌)
          path.join(PROJECT_ROOT, 'ml/topic/windows/.venv'),
        ]
      : [
          (process.env[`${p.envPrefix}_MLX_VENV`] || '').trim(),
          path.join(PROJECT_ROOT, `ml/${p.en}/.venv`),
          `/tmp/${p.en}-mlx-venv`,
        ];
  for (const venv of candidates) {
    if (!venv) continue;
    const py = path.join(venv, exe);
    if (fs.existsSync(py)) return py;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function runInfer(
  passage: string,
  p: TypePaths,
  backend: Backend,
  model: string | undefined,
  adapter: string | undefined,
  usePipeline: boolean
): Record<string, unknown> {
  if (usePipeline && backend !== 'cuda') {
    throw new Error('--pipeline 은 Windows CUDA 백엔드에서만 지원합니다 (--backend cuda)');
  }
  const inferPy = usePipeline ? p.pipelineCuda : backend === 'cuda' ? p.inferCuda : p.inferMlx;
  if (!fs.existsSync(inferPy)) {
    throw new Error(`infer script 없음: ${inferPy}`);
  }
  const tmp = path.join(DRAFTS_DIR, `_${p.en}-passage-${Date.now()}.txt`);
  fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  fs.writeFileSync(tmp, passage, 'utf8');
  try {
    const args = [inferPy, '--passage-file', tmp, '--json-only'];
    const adapterPath = adapter || (backend === 'cuda' ? p.adapterCuda : p.adapterMlx);
    if (fs.existsSync(adapterPath)) args.push('--adapter', adapterPath);
    if (model) args.push('--model', model);

    const r = spawnSync(pythonBin(backend, p), args, {
      encoding: 'utf8',
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
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
        parsed = JSON.parse(t) as Record<string, unknown>;
        break;
      } catch {
        /* 다음 줄 */
      }
    }
    if (!parsed) {
      throw new Error(`infer JSON 파싱 실패: ${out.slice(0, 400)}\nstderr: ${err.slice(0, 400)}`);
    }
    if (!parsed.ok) {
      throw new Error(String(parsed.error || 'infer ok=false'));
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

/** 저장 전 검증 — 관리자 화면(local-jobs)과 같은 in-process 검증 + 5지선다 형태. */
async function validateDraft(item: Record<string, unknown>): Promise<{ errors: string[]; warnings: string[] }> {
  const qd = (item.question_data ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];
  const opts = splitQuestionOptionSegments(String(qd.Options ?? ''));
  if (opts.length !== 5) errors.push(`보기는 5개여야 합니다(${opts.length}개).`);
  if (!/^[①②③④⑤]$/.test(String(qd.CorrectAnswer ?? '').trim())) {
    errors.push('CorrectAnswer 는 ①~⑤ 중 하나여야 합니다.');
  }
  const db = await getDb('gomijoshua');
  for (const issue of [...checkContentIntegrity(item), ...(await runPerQuestionValidations(db, item))]) {
    (issue.severity === 'error' ? errors : warnings).push(issue.message);
  }
  return { errors, warnings };
}

function usage(fixedType: LocalVariantType | null): never {
  const cmd = fixedType ? `cc:${LOCAL_VARIANT_TYPES[fixedType].en}-local --` : 'cc:local-variant -- --type <주제|제목|주장>';
  console.error(`사용법:
  npm run ${cmd} --passage-id <ObjectId> [--save]
  npm run ${cmd} --backend cuda --pipeline --passage-id <ObjectId> [--save]
  npm run ${cmd} --passage-file p.txt --textbook "교재" --source "출처" [--save]

관리자 화면·배포 사이트에서는 GPU PC 워커를 쓴다: docs/ml/local-variant-worker.md
Claude/Anthropic 은 사용하지 않습니다.`);
  process.exit(1);
}

/** fixedType 이 있으면 그 유형, 없으면 --type 플래그로 고른다. */
export async function runLocalVariantCli(fixedType: LocalVariantType | null): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const type = fixedType ?? resolveLocalVariantType(flags.get('type') || '');
  if (!type) {
    console.error('--type 이 필요합니다 (주제|제목|주장 또는 topic|title|claim).');
    usage(null);
  }
  const p = typePaths(type);
  const aiSource = LOCAL_VARIANT_TYPES[type].aiSource;
  const passageId = (flags.get('passage-id') || '').trim();
  const passageFile = (flags.get('passage-file') || '').trim();
  const doSave = flags.get('save') === 'true';
  const usePipeline = flags.get('pipeline') === 'true';
  const backend = resolveBackend(flags, p);

  let paragraph = '';
  let textbook = (flags.get('textbook') || '').trim();
  let source = (flags.get('source') || '').trim();

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
    usage(fixedType);
  }

  if (!paragraph) {
    console.error('지문 본문이 비어 있습니다.');
    process.exit(1);
  }

  const adapter = flags.get('adapter');
  const defaultAdapter = backend === 'cuda' ? p.adapterCuda : p.adapterMlx;
  if (!fs.existsSync(adapter || defaultAdapter)) {
    console.error(
      `경고: adapter 디렉터리 없음 (${adapter || defaultAdapter}). 베이스 모델만으로 추론합니다.\n` +
        (backend === 'cuda' ? `학습: cd ml\\${p.en}\\windows && train.bat` : `학습: cd ml/${p.en} && ./train.sh`)
    );
  }

  console.error(`infer 중… type=${type} backend=${backend} pipeline=${usePipeline} host=${os.hostname()}`);
  const question_data = runInfer(paragraph, p, backend, flags.get('model'), adapter, usePipeline);
  question_data.Paragraph = paragraph;
  question_data.OptionType = 'English';
  if (typeof question_data.Category !== 'string') question_data.Category = type;

  const draftItem = {
    passage_id: passageId || '000000000000000000000000',
    textbook: textbook || 'local',
    source: source || `local-${p.en}`,
    type,
    option_type: 'English',
    status: '대기',
    ai_source: aiSource,
    question_data,
  };

  fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const draftPath = path.join(DRAFTS_DIR, `${p.en}-local-${passageId || 'file'}-${stamp}.json`);
  fs.writeFileSync(draftPath, JSON.stringify([draftItem], null, 2) + '\n', 'utf8');
  console.error('draft:', draftPath);

  const { errors, warnings } = await validateDraft(draftItem);
  for (const w of warnings) console.error('경고:', w);
  if (errors.length) {
    for (const e of errors) console.error('오류:', e);
    console.error('검증 실패 — 저장하지 않습니다. draft만 남겼습니다.');
    process.exit(2);
  }

  if (doSave) {
    if (!passageId || !ObjectId.isValid(passageId) || !textbook || !source) {
      console.error('--save 에는 --passage-id 와 textbook/source 가 필요합니다.');
      process.exit(1);
    }
    const saved = await saveGeneratedQuestionToDb({
      passage_id: passageId,
      textbook,
      source,
      type,
      question_data,
      status: '대기',
      option_type: 'English',
      ai_source: aiSource,
    });
    console.log(JSON.stringify({ draft: draftPath, backend, pipeline: usePipeline, save: saved }, null, 2));
    process.exit(saved.ok ? 0 : 1);
  }

  console.log(JSON.stringify({ ok: true, backend, pipeline: usePipeline, draft: draftPath, question_data }, null, 2));
}

export function runLocalVariantCliMain(fixedType: LocalVariantType | null): void {
  runLocalVariantCli(fixedType)
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('실패:', e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
