/**
 * 통합 로컬 변형문제 생성 진입점 — 주제/제목/주장 로컬 LoRA(Windows CUDA / Mac MLX) 공용.
 * Anthropic/Claude API 호출 없음. 실제 추론은 유형별 cc-<type>-local.ts 를 그대로 불러 쓴다
 * (로직 중복 없이, 유형마다 이미 검증된 스크립트를 한 곳에서 고르기만 한다).
 *
 *   npm run cc:local-variant -- --type 주제 --passage-id <ObjectId>
 *   npm run cc:local-variant -- --type 제목 --backend cuda --pipeline --passage-id <ObjectId>
 *   npm run cc:local-variant -- --type 주장 --backend cuda --pipeline --passage-id <ObjectId> --save
 *
 * --type 은 한글(주제/제목/주장) 또는 영문(topic/title/claim) 모두 받는다.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const TYPE_ALIASES: Record<string, '주제' | '제목' | '주장'> = {
  주제: '주제',
  topic: '주제',
  제목: '제목',
  title: '제목',
  주장: '주장',
  claim: '주장',
};

const TYPE_TO_SCRIPT: Record<'주제' | '제목' | '주장', string> = {
  주제: 'cc-topic-local.ts',
  제목: 'cc-title-local.ts',
  주장: 'cc-claim-local.ts',
};

const TYPE_TO_BACKEND_ENV: Record<'주제' | '제목' | '주장', string> = {
  주제: 'TOPIC_BACKEND',
  제목: 'TITLE_BACKEND',
  주장: 'CLAIM_BACKEND',
};

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

function usage(): never {
  console.error(`사용법:
  npm run cc:local-variant -- --type <주제|제목|주장|topic|title|claim> --passage-id <ObjectId> [--save]
  npm run cc:local-variant -- --type 제목 --backend cuda --pipeline --passage-id <ObjectId>
  npm run cc:local-variant -- --type 주장 --passage-file p.txt --textbook "..." --source "..."

--type 을 뺀 나머지 플래그는 해당 유형의 cc-<type>-local.ts 로 그대로 전달됩니다.
Claude/Anthropic 은 사용하지 않습니다.`);
  process.exit(1);
}

const rawArgs = process.argv.slice(2);
const flags = parseFlags(rawArgs);
const typeRaw = (flags.get('type') || '').trim();
if (!typeRaw) {
  console.error('--type 이 필요합니다 (주제|제목|주장 또는 topic|title|claim).');
  usage();
}
const type = TYPE_ALIASES[typeRaw] ?? TYPE_ALIASES[typeRaw.toLowerCase()];
if (!type) {
  console.error(`알 수 없는 --type: ${typeRaw} (주제|제목|주장 또는 topic|title|claim 만 지원)`);
  usage();
}

const script = path.join(PROJECT_ROOT, 'scripts', TYPE_TO_SCRIPT[type]);
// --type 만 빼고 나머지 인자는 그대로 하위 스크립트에 넘긴다
const passthrough: string[] = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--type') {
    i++; // 값도 함께 건너뜀
    continue;
  }
  if (rawArgs[i].startsWith('--type=')) continue;
  passthrough.push(rawArgs[i]);
}

console.error(`[cc:local-variant] type=${type} -> ${TYPE_TO_SCRIPT[type]}`);
const backendEnvName = TYPE_TO_BACKEND_ENV[type];
const env = { ...process.env };
// 사용자가 --backend 를 직접 안 줬고 유형별 *_BACKEND 도 없으면, 세 유형 공용 BACKEND 값을 물려준다
if (!flags.get('backend') && !env[backendEnvName] && env.BACKEND) {
  env[backendEnvName] = env.BACKEND;
}

const r = spawnSync('npx', ['tsx', script, ...passthrough], {
  stdio: 'inherit',
  cwd: PROJECT_ROOT,
  env,
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
