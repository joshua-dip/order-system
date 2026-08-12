/**
 * 「해커스 능수능란 영어독해 12회 기본」 지문 전체 교체 (300지문).
 *
 *   npx tsx scripts/import-nsnr-passages.ts --file <xlsx> --dry-run
 *   npx tsx scripts/import-nsnr-passages.ts --file <xlsx> --apply
 *   npx tsx scripts/import-nsnr-passages.ts --revert            # 백업으로 원복
 *
 * 배경: DB 에 219지문만 있었다. 원본 엑셀의 영·한 문장 수가 어긋난 69행이 임포트에서
 * 걸러졌기 때문이다(한국어 번역이 영어 문장 여러 개를 한 줄로 합쳐놓은 구조적 문제).
 * 문장 수를 맞춰 다시 만든 파일(300행 전부 Match)로 전량 교체한다.
 *
 * 기존 219개 중 123개는 원문에 ①~⑤ 마커가 섞여 있었다(어법·어휘 문항용 표시가
 * 지문 원본에 들어간 것). 새 파일은 깨끗한 원문이라 이것도 함께 바로잡힌다.
 *
 * ⚠️ 이 교재의 변형문제 265건 중 183건이 바뀌는 지문에 딸려 있다. 변형문제는 자체
 * Paragraph 를 들고 있어 문항 자체는 깨지지 않지만, 「지문 원본 ↔ 문항」 대조 검증은
 * 다시 돌려야 한다.
 *
 * 열: 교재명 · 강 · 번호 · 유형 · 원문 · 해석 ·
 *     Tokenized Sentences (English/Korean) · Mixed Sentences · Sentence Match
 * Tokenized/Mixed 셀은 줄 끝에 %%% 표시가 붙어 있다. sentences_en·sentences_ko 는 그걸
 * 떼고 배열로, tokenized_en·tokenized_ko·mixed 는 한 덩이 문자열로 저장한다 —
 * content.mixed 는 변형문제 생성이 지문 원본으로 쓰기 때문에 %%% 가 남으면
 * 그대로 문항에 새어 들어간다.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';

loadCliEnv(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

import { getDb } from '@/lib/mongodb';
import XLSX from 'xlsx';

const TB = '해커스 능수능란 영어독해 12회 기본';
const BACKUP = 'passages_backup_nsnr';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const revert = argv.includes('--revert');
const fileIdx = argv.indexOf('--file');
const file = fileIdx >= 0 ? argv[fileIdx + 1] : '';

/** 줄 단위로 자르고 %%% 표시를 뗀다 */
function lines(cell: unknown): string[] {
  return String(cell ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((s) => s.replace(/%%%/g, '').trim())
    .filter(Boolean);
}

/** 한 덩이 문자열 (줄바꿈 유지, %%% 제거) */
function flat(cell: unknown): string {
  return lines(cell).join(' ');
}

async function main() {
  const db = await getDb('gomijoshua');
  const P = db.collection('passages');
  const B = db.collection(BACKUP);

  if (revert) {
    const saved = await B.find({ textbook: TB }).toArray();
    if (!saved.length) { console.log('백업이 없습니다.'); return; }
    console.log(`백업 ${saved.length}건으로 원복${apply ? '' : ' (미리보기)'}`);
    if (!apply) { console.log('--apply 를 붙이세요.'); return; }
    await P.deleteMany({ textbook: TB });
    await P.insertMany(saved.map(({ _id, ...rest }) => ({ _id, ...rest })));
    console.log(`✅ ${saved.length}건 원복 완료`);
    return;
  }

  if (!file) { console.log('--file <xlsx> 가 필요합니다.'); return; }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    XLSX.readFile(file).Sheets[XLSX.readFile(file).SheetNames[0]], { defval: '' },
  );

  // 검증 — 하나라도 어긋나면 전량 중단한다. 한줄해석은 영·한을 한 줄씩 짝지어 쓴다.
  const bad: string[] = [];
  for (const r of rows) {
    const en = lines(r['Tokenized Sentences (English)']);
    const ko = lines(r['Tokenized Sentences (Korean)']);
    const key = `${String(r['강']).trim()} ${String(r['번호']).trim()}`;
    if (!String(r['원문']).trim() || !String(r['해석']).trim()) bad.push(`${key} 원문/해석 비어있음`);
    else if (en.length === 0 || en.length !== ko.length) bad.push(`${key} 문장수 영${en.length}/한${ko.length}`);
  }
  console.log(`파일 ${rows.length}행 · 검증 실패 ${bad.length}건`);
  if (bad.length) { console.log(bad.slice(0, 10).map((s) => '  ' + s).join('\n')); console.log('중단합니다.'); return; }

  const before = await P.countDocuments({ textbook: TB });
  console.log(`DB 현재 ${before}지문 → 교체 후 ${rows.length}지문`);
  if (!apply) { console.log('\n미리보기입니다. --apply 를 붙이세요.'); return; }

  // 백업 (이미 있으면 덮지 않는다 — 최초 상태를 지킨다)
  if ((await B.countDocuments({ textbook: TB })) === 0) {
    const cur = await P.find({ textbook: TB }).toArray();
    if (cur.length) { await B.insertMany(cur); console.log(`백업 ${cur.length}건 저장 (${BACKUP})`); }
  } else {
    console.log('백업이 이미 있어 그대로 둡니다.');
  }

  const now = new Date();
  const docs = rows.map((r) => {
    const 강 = String(r['강']).trim();
    const 번호 = String(r['번호']).trim();
    return {
      page: '',
      chapter: 강,
      number: 번호,
      textbook: TB,
      source_key: `${강} ${번호}`,
      passage_source: '',
      content: {
        original: String(r['원문']).trim(),
        translation: String(r['해석']).trim(),
        sentences_en: lines(r['Tokenized Sentences (English)']),
        sentences_ko: lines(r['Tokenized Sentences (Korean)']),
        tokenized_en: flat(r['Tokenized Sentences (English)']),
        tokenized_ko: flat(r['Tokenized Sentences (Korean)']),
        mixed: flat(r['Mixed Sentences']),
      },
      created_at: now,
      updated_at: now,
    };
  });

  await P.deleteMany({ textbook: TB });
  const res = await P.insertMany(docs);
  console.log(`✅ ${res.insertedCount}지문 교체 완료`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('실패:', e instanceof Error ? e.message : e); process.exit(1); });
