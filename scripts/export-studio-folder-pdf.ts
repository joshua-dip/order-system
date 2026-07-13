/**
 * 교재 스튜디오 — 폴더 안 모든 문서를 PDF 로 일괄 export.
 *
 * PDF 라우트(app/api/my/vip/materials/studio/[id]/pdf)와 **같은 렌더러**(lib/vip-material-studio-pdf)
 * 를 써서 서버/세션 없이 DB 직접 읽어 로컬 폴더에 저장. (Pro 정책·API 키 불필요.)
 *
 *   npm run export:studio-pdf -- "고등 교재"                 # ~/Downloads/고등 교재/ 에 저장
 *   npm run export:studio-pdf -- "고등 교재" --out ./out     # 출력 폴더 지정
 *   npm run export:studio-pdf -- "고등 교재" --list          # 목록만(렌더 X)
 *   npm run export:studio-pdf -- "고등 교재" --user a@b.com  # 소유자 이메일로 스코프
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { ObjectId } from 'mongodb';
import { loadCliEnv } from './_cli-env';
import { getDb } from '@/lib/mongodb';
import { STUDIO_MATERIALS_COLLECTION } from '@/lib/vip-material-studio';
import { renderStudioDocToPdf } from '@/lib/vip-material-studio-pdf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
loadCliEnv(PROJECT_ROOT);

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// --list / --user 뒤 값이 positional 로 새지 않게 제거
const listOnly = process.argv.includes('--list');
const userArg = flag('user');
const outArg = flag('out');
const folder = positional.find((a) => a !== userArg && a !== outArg);

/** 파일명 안전화 (슬래시·제어문자 제거, 길이 제한) */
function safeName(s: string): string {
  return (s || '교재').replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || '교재';
}

/** 이미지 요소 src → uploads 파일 Buffer (라우트와 동일 경로 규칙) */
function resolveImage(src: string): Buffer | null {
  const m = src.match(/\/file\/([a-f0-9]{24})\/([^/?]+)$/);
  if (!m) return null;
  const fp = path.join(PROJECT_ROOT, 'uploads/vip-material-studio', m[1], path.basename(m[2]));
  return fs.existsSync(fp) ? fs.readFileSync(fp) : null;
}

async function main() {
  if (!folder) {
    console.error('사용법: npm run export:studio-pdf -- "<폴더명>" [--out <dir>] [--list] [--user <email>]');
    process.exit(1);
  }
  const db = await getDb('gomijoshua');

  // 선택: 소유자 이메일 스코프
  let userId: ObjectId | undefined;
  if (userArg) {
    const u = await db.collection('users').findOne(
      { $or: [{ email: userArg }, { loginId: userArg }] },
      { projection: { _id: 1, name: 1, email: 1 } },
    );
    if (!u) { console.error(`사용자를 찾을 수 없습니다: ${userArg}`); process.exit(1); }
    userId = u._id as ObjectId;
    console.log(`소유자 스코프: ${u.name ?? ''} <${u.email ?? userArg}>`);
  }

  const query: Record<string, unknown> = { folder };
  if (userId) query.userId = userId;
  const docs = await db.collection(STUDIO_MATERIALS_COLLECTION)
    .find(query)
    .project({ title: 1, subtitle: 1, difficulty: 1, folder: 1, userId: 1, pageCount: 1, pages: 1, updatedAt: 1 })
    .sort({ updatedAt: 1 })
    .toArray();

  if (docs.length === 0) {
    console.error(`폴더 "${folder}" 에서 문서를 찾지 못했습니다.`);
    // 참고용: 존재하는 폴더 목록
    const folders = await db.collection(STUDIO_MATERIALS_COLLECTION).distinct('folder', userId ? { userId } : {});
    console.error('존재하는 폴더:', folders.filter(Boolean).map((f) => `"${f}"`).join(', ') || '(없음)');
    process.exit(1);
  }

  const owners = new Set(docs.map((d) => String(d.userId)));
  console.log(`폴더 "${folder}" — 문서 ${docs.length}개${owners.size > 1 ? ` (소유자 ${owners.size}명)` : ''}`);
  docs.forEach((d, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${d.title ?? '(제목없음)'}  [${d.difficulty ?? '-'}]  ${d.pageCount ?? (Array.isArray(d.pages) ? d.pages.length : '?')}p`);
  });
  if (listOnly) return;

  const outDir = outArg
    ? path.resolve(outArg)
    : path.join(os.homedir(), 'Downloads', safeName(folder));
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`\n출력 폴더: ${outDir}\n`);

  const usedNames = new Set<string>();
  let ok = 0;
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    let base = safeName(d.title ?? `교재-${i + 1}`);
    let name = `${base}.pdf`;
    let n = 2;
    while (usedNames.has(name.toLowerCase())) name = `${base} (${n++}).pdf`;
    usedNames.add(name.toLowerCase());
    try {
      const buf = await renderStudioDocToPdf(d as { title?: string; pages?: unknown }, { resolveImage });
      fs.writeFileSync(path.join(outDir, name), buf);
      console.log(`  ✓ ${name}  (${(buf.length / 1024).toFixed(0)} KB)`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${name}  실패:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`\n완료: ${ok}/${docs.length}개 PDF → ${outDir}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
