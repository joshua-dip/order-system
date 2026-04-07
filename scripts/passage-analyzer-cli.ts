/**
 * Claude Code / 터미널용 지문분석기 CLI (MongoDB + 선택적 로컬 Next API).
 *
 * - export / import: MongoDB `gomijoshua.passage_analyses` 의 `passageStates.main` 만 다룹니다.
 * - run-ai: 웹의 「AI 전체 자동 실행」과 같은 API 순서로 호출한 뒤 결과를 Mongo에 저장합니다.
 *
 * 환경 (.env.local):
 *   MONGODB_URI — 필수
 *   run-ai 시 추가:
 *   PASSAGE_ANALYZER_BASE_URL=http://localhost:3000  (선택, 기본값 동일)
 *   ADMIN_SESSION_COOKIE=<쿠키 admin_session 의 값만> — 필수
 *     (Chrome: 개발자도구 → Application → Cookies → admin_session)
 *
 * Next.js `npm run dev` 가 떠 있어야 run-ai 가 동작합니다 (API + ANTHROPIC 키는 서버가 사용).
 *
 * 사용:
 *   npx tsx scripts/passage-analyzer-cli.ts export 69bd3c542b6e290bba272d07
 *   npx tsx scripts/passage-analyzer-cli.ts import 69bd3c542b6e290bba272d07 --file ./main.json
 *   npx tsx scripts/passage-analyzer-cli.ts run-ai 69bd3c542b6e290bba272d07
 *   npm run passage-analyzer:cli -- export 69bd3c542b6e290bba272d07
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';
import { runPassageAnalyzerAiBatch } from '@/lib/passage-analyzer-run-ai-batch';
import { passageAnalysisFileNameForPassageId, type PassageStateStored } from '@/lib/passage-analyzer-types';
import { deriveSentencesFromPassageContent, mergeSavedOntoPassagesBase } from '@/lib/passage-analyzer-passages';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const COL = 'passage_analyses';

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function loadMain(passageId: string): Promise<{ fileName: string; main: PassageStateStored } | null> {
  const fileName = passageAnalysisFileNameForPassageId(passageId.trim());
  const db = await getDb('gomijoshua');
  const doc = await db.collection(COL).findOne<{
    passageStates?: { main?: PassageStateStored };
  }>({ fileName });
  const main = doc?.passageStates?.main;
  if (!main || typeof main !== 'object' || !Array.isArray(main.sentences)) {
    return null;
  }
  return { fileName, main };
}

async function saveMainToMongo(
  fileName: string,
  main: PassageStateStored,
  opts?: { editorNote?: string }
) {
  const db = await getDb('gomijoshua');
  const col = db.collection(COL);
  const now = new Date();
  const currentDoc = await col.findOne({ fileName });
  const newVersion = Math.floor(Number((currentDoc as { version?: number })?.version) || 0) + 1;
  const editorNote = opts?.editorNote ?? 'cli';

  await col.updateOne(
    { fileName },
    {
      $set: {
        fileName,
        teacherId: null,
        collaborationHostId: null,
        passageStates: { main },
        version: newVersion,
        lastEditorId: 'cli',
        lastEditorName: editorNote,
        lastSaved: now.toISOString(),
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  console.error('Mongo 저장:', fileName, 'version', newVersion);
}

async function cmdExport(passageId: string) {
  const loaded = await loadMain(passageId);
  if (!loaded) die(`passageStates.main 이 없거나 sentences 가 없습니다: passage:${passageId}\n→ 웹 지문분석기에서 해당 지문을 한 번 연 뒤 저장하거나, import 로 초기 JSON 을 넣으세요.`);
  const { fileName, main } = loaded;
  console.log(JSON.stringify({ fileName, main }, null, 2));
}

async function cmdImport(passageId: string, filePath: string) {
  const fileName = passageAnalysisFileNameForPassageId(passageId.trim());
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  let main: PassageStateStored;
  if (parsed && typeof parsed === 'object' && parsed !== null && 'main' in parsed) {
    main = (parsed as { main: PassageStateStored }).main;
  } else {
    main = parsed as PassageStateStored;
  }
  if (!main?.sentences || !Array.isArray(main.sentences)) {
    die('JSON 은 { "main": { "sentences": [...], ... } } 또는 main 본문만 있어야 합니다.');
  }
  await saveMainToMongo(fileName, main, { editorNote: 'cli-import' });
}

async function initMainFromApi(
  passageId: string,
  base: string,
  token: string
): Promise<{ fileName: string; main: PassageStateStored }> {
  const fileName = passageAnalysisFileNameForPassageId(passageId.trim());
  const pr = await fetch(`${base}/api/admin/passages/${passageId}`, {
    headers: { Cookie: `admin_session=${token}` },
  });
  if (!pr.ok) die(`지문 API 호출 실패 (${pr.status}): ${passageId}`);
  const pd = await pr.json() as { item?: { content?: Record<string, unknown> } };
  if (!pd.item) die(`지문을 찾을 수 없습니다: ${passageId}`);
  const c = pd.item.content || {};
  const { sentences, koreanSentences } = deriveSentencesFromPassageContent(c);
  const initial: PassageStateStored = mergeSavedOntoPassagesBase(
    { sentences, koreanSentences, vocabularyList: [] },
    undefined
  );
  await saveMainToMongo(fileName, initial, { editorNote: 'cli-init' });
  return { fileName, main: initial };
}

async function cmdRunAi(passageId: string) {
  const base = (process.env.PASSAGE_ANALYZER_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const token = (process.env.ADMIN_SESSION_COOKIE || '').trim();
  if (!token) {
    die(
      'ADMIN_SESSION_COOKIE 가 필요합니다.\n' +
        '관리자로 로그인한 브라우저에서 admin_session 쿠키 값만 복사해 .env.local 에 넣으세요.'
    );
  }

  const existing = await loadMain(passageId);
  const loaded = existing ?? (console.error('문서 없음 → 지문 API로 초기화 중...'), await initMainFromApi(passageId, base, token));
  const { fileName, main } = loaded;
  console.error('API:', base, '| fileName:', fileName);

  const { state, warnings } = await runPassageAnalyzerAiBatch({
    initial: main,
    post: (p, body) =>
      fetch(`${base}${p}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `admin_session=${token}`,
        },
        body: JSON.stringify(body),
      }),
    sourcePassageLabel: fileName,
    onProgress: (m) => console.error(m),
  });

  await saveMainToMongo(fileName, state, { editorNote: 'cli-run-ai' });
  for (const w of warnings) console.error('!', w);
}

async function main() {
  const argv = process.argv.slice(2);
  const [cmd, id, ...rest] = argv;
  if (!cmd || !id) {
    die(`명령과 passageId 가 필요합니다.
  npx tsx scripts/passage-analyzer-cli.ts export <passageId>
  npx tsx scripts/passage-analyzer-cli.ts import <passageId> --file <path>
  npx tsx scripts/passage-analyzer-cli.ts run-ai <passageId>`);
  }

  if (cmd === 'export') await cmdExport(id);
  else if (cmd === 'import') {
    const fi = rest.indexOf('--file');
    if (fi < 0 || !rest[fi + 1]) die('import 는 --file <경로> 가 필요합니다.');
    await cmdImport(id, rest[fi + 1]);
  } else if (cmd === 'run-ai') await cmdRunAi(id);
  else die(`알 수 없는 명령: ${cmd}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
