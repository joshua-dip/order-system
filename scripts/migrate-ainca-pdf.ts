/**
 * 아잉카 분석지 PDF → passage_analyses 마이그레이션 CLI
 *
 * 환경 (.env.local):
 *   MONGODB_URI — migrate 명령에 필요
 *
 * 사용:
 *   # PDF 원문 텍스트 확인 (포맷 파악용)
 *   npx tsx scripts/migrate-ainca-pdf.ts inspect \
 *     --pdf "assets/고1 영어모의고사 분석지/모의고사_1학년_2025년_03월_상세분석_18_30_아잉카.pdf"
 *
 *   # 파서 결과 미리보기
 *   npx tsx scripts/migrate-ainca-pdf.ts preview \
 *     --pdf "assets/고1 영어모의고사 분석지/모의고사_1학년_2025년_03월_상세분석_18_30_아잉카.pdf"
 *
 *   # 특정 문항을 passageId에 마이그레이션
 *   npx tsx scripts/migrate-ainca-pdf.ts migrate \
 *     --pdf "assets/고1 영어모의고사 분석지/모의고사_1학년_2025년_03월_상세분석_18_30_아잉카.pdf" \
 *     --passage-id 69c4ffc446f58f933b6dce91 \
 *     --question 18
 *
 *   # npm script
 *   npm run ainca:migrate -- preview --pdf "assets/..."
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import { PDFParse } from 'pdf-parse';
import { getDb } from '@/lib/mongodb';
import {
  passageAnalysisFileNameForPassageId,
  type PassageStateStored,
} from '@/lib/passage-analyzer-types';
import { parseAincaPages, type AincaQuestion } from '@/lib/ainca-pdf-parser';

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

function parseArgs(args: string[]) {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--')) {
      result[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return result;
}

type PdfPageText = { text: string };

async function loadPdfPages(pdfPath: string): Promise<PdfPageText[]> {
  const absPath = path.isAbsolute(pdfPath) ? pdfPath : path.resolve(PROJECT_ROOT, pdfPath);
  if (!fs.existsSync(absPath)) die(`PDF 파일을 찾을 수 없습니다: ${absPath}`);
  const fileUrl = pathToFileURL(absPath).href;
  // pdf-parse v2 uses class-based API: new PDFParse({ url }) then .load() then .getText()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parser = new (PDFParse as any)({ verbosity: 0, url: fileUrl });
  await parser.load();
  const result = await parser.getText() as { pages: PdfPageText[] };
  return result.pages;
}

async function cmdInspect(args: Record<string, string>) {
  const pdfPath = args['pdf'];
  if (!pdfPath) die('--pdf <경로> 가 필요합니다.');

  console.error(`[inspect] PDF 텍스트 추출 중: ${pdfPath}`);
  const pages = await loadPdfPages(pdfPath);
  console.log(`총 페이지 수: ${pages.length}\n`);

  for (let p = 0; p < pages.length; p++) {
    const lines = pages[p].text.split('\n');
    console.log(`${'='.repeat(60)}`);
    console.log(`[페이지 ${p + 1}]`);
    console.log(`${'='.repeat(60)}`);
    lines.forEach((l, i) => console.log(`${String(i).padStart(3)}: ${JSON.stringify(l.slice(0, 120))}`));
  }
}

async function cmdPreview(args: Record<string, string>) {
  const pdfPath = args['pdf'];
  if (!pdfPath) die('--pdf <경로> 가 필요합니다.');

  console.error(`[preview] 아잉카 파서 적용 중: ${pdfPath}`);
  const pages = await loadPdfPages(pdfPath);
  const questions = parseAincaPages(pages);

  console.log(`발견된 문항 수: ${questions.length}`);
  for (const q of questions) {
    console.log('\n' + '-'.repeat(60));
    console.log(`[문항 ${q.questionNumber}]`);
    console.log(`문장 수: ${q.sentences.length}`);
    q.sentences.forEach((s, i) => {
      console.log(`  영어[${i}] ${s}`);
    });
    if (q.koreanSentences.length) {
      console.log(`한국어 번역 수: ${q.koreanSentences.length}`);
      q.koreanSentences.forEach((s, i) => {
        console.log(`  한국[${i}] ${s}`);
      });
    }
    if (q.vocabularyList.length) {
      console.log(`어휘 (${q.vocabularyList.length}개):`);
      q.vocabularyList.slice(0, 5).forEach((v) => {
        console.log(`  ${v.word} — ${v.meaning}`);
      });
      if (q.vocabularyList.length > 5) console.log(`  ... 외 ${q.vocabularyList.length - 5}개`);
    }
  }
}

async function cmdMigrate(args: Record<string, string>) {
  const pdfPath = args['pdf'];
  const passageId = args['passage-id'];
  const questionNum = args['question'] ? parseInt(args['question'], 10) : undefined;

  if (!pdfPath) die('--pdf <경로> 가 필요합니다.');
  if (!passageId) die('--passage-id <ObjectId> 가 필요합니다.');

  console.error(`[migrate] PDF: ${pdfPath}`);
  console.error(`[migrate] passageId: ${passageId}${questionNum != null ? ` | 문항: ${questionNum}` : ''}`);

  const pages = await loadPdfPages(pdfPath);
  const questions = parseAincaPages(pages);

  let target: AincaQuestion | undefined;
  if (questionNum != null) {
    target = questions.find((q) => q.questionNumber === questionNum);
    if (!target) {
      const available = questions.map((q) => q.questionNumber).join(', ');
      die(`문항 ${questionNum}을 찾을 수 없습니다. 발견된 문항: ${available || '없음'}`);
    }
  } else if (questions.length === 1) {
    target = questions[0];
  } else {
    const available = questions.map((q) => q.questionNumber).join(', ');
    die(`PDF에 여러 문항이 있습니다. --question <번호> 로 지정하세요. 발견된 문항: ${available}`);
  }

  const fileName = passageAnalysisFileNameForPassageId(passageId.trim());
  const db = await getDb('gomijoshua');
  const col = db.collection(COL);
  const now = new Date();

  // 기존 문서 불러오기 (있으면 병합)
  const existing = await col.findOne<{ passageStates?: { main?: PassageStateStored }; version?: number }>({
    fileName,
  });
  const existingMain = existing?.passageStates?.main;
  const newVersion = Math.floor(Number(existing?.version) || 0) + 1;

  const main: PassageStateStored = {
    ...(existingMain ?? {}),
    sentences: target.sentences,
    koreanSentences: target.koreanSentences,
    vocabularyList: target.vocabularyList.length
      ? target.vocabularyList
      : (existingMain?.vocabularyList ?? []),
  };

  if (target.syntaxPhrases && Object.keys(target.syntaxPhrases).length > 0) {
    main.syntaxPhrases = { ...(existingMain?.syntaxPhrases ?? {}), ...target.syntaxPhrases };
  }
  if (target.svocData && Object.keys(target.svocData).length > 0) {
    main.svocData = { ...(existingMain?.svocData ?? {}), ...target.svocData };
  }

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
        lastEditorName: 'ainca-migrate',
        lastSaved: now.toISOString(),
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  console.log(`\n저장 완료: ${fileName} (version ${newVersion})`);
  console.log(`문장 수: ${main.sentences.length}`);
  console.log(`한국어 번역 수: ${main.koreanSentences.length}`);
  console.log(`어휘 수: ${main.vocabularyList.length}`);
  if (main.syntaxPhrases)
    console.log(`구문 분석 문장 수: ${Object.keys(main.syntaxPhrases).length}`);
  if (main.svocData) console.log(`SVOC 분석 문장 수: ${Object.keys(main.svocData).length}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);

  if (!cmd) {
    die(`명령이 필요합니다.
  inspect  --pdf <경로>                                     PDF 페이지별 원문 텍스트 출력
  preview  --pdf <경로>                                     파서 결과 미리보기 (문장·번역)
  migrate  --pdf <경로> --passage-id <id> [--question <n>] passage_analyses MongoDB에 저장`);
  }

  if (cmd === 'inspect') await cmdInspect(args);
  else if (cmd === 'preview') await cmdPreview(args);
  else if (cmd === 'migrate') await cmdMigrate(args);
  else die(`알 수 없는 명령: ${cmd}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
