/**
 * cc:* CLI / MCP 공용 env 로더.
 *
 * 평소: projectRoot 의 `.env` + `.env.local` 로드.
 * ⭐ git worktree(`<main>/.claude/worktrees/<x>`) 안에서 실행되면,
 *    워크트리의 env 가 없거나(stale·미존재) 다르면 save 가 엉뚱한 DB 로 가는 사고가 생김.
 *    → 메인 repo 의 `.env`/`.env.local` 을 **권위값으로 override** 해서 항상 같은 DB(MONGODB_URI)에 연결.
 *    (메인 repo 에서 실행하면 worktree 마커가 없어 동작 변화 없음.)
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { config } from 'dotenv';

export function loadCliEnv(projectRoot: string): void {
  process.env.DOTENV_CONFIG_QUIET = 'true';
  config({ path: path.join(projectRoot, '.env') });
  config({ path: path.join(projectRoot, '.env.local') });

  const marker = `${path.sep}.claude${path.sep}worktrees${path.sep}`;
  const idx = projectRoot.indexOf(marker);
  if (idx >= 0) {
    const mainRoot = projectRoot.slice(0, idx);
    for (const f of ['.env', '.env.local']) {
      const p = path.join(mainRoot, f);
      if (existsSync(p)) config({ path: p, override: true });
    }
  }
}
