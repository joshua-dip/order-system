/**
 * MV 주문에 매칭된 변형문제들을 타입별로 점검하고
 * 다음 문제 카테고리에 해당하는 ID 목록을 출력한다:
 *
 *   1. 빈칸: Paragraph 길이가 passage 원문보다 50자 이상 짧음 → 잘림 의심
 *   2. 삽입·삽입-고난도: Paragraph에 \n\n 또는 ### 구분 없음
 *   3. 삽입·삽입-고난도: Explanation이 정형구 ("...앞뒤 문맥과 접속 관계가 가장 자연스러운 곳입니다.")
 *   4. 어법: Options에 <u> 없음 OR Paragraph 밑줄 중 4단어 이상 발견
 *   5. 요약: Paragraph에 (A) 또는 ____ 표시 없음 (요약문 누락)
 *   6. 함의: Explanation이 정형구 ("지문에 직접 쓰이지 않았으나 논리적으로 따라올 수 있는 함의에 해당합니다.")
 *   7. Options에 한국어가 포함됨 (어법·삽입·무관한문장 제외)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { passagesForMockVariantOrder } from '@/lib/mock-variant-order';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const HANGUL_RE = /[\uAC00-\uD7AF]/;
const STEREO_INSERT = '앞뒤 문맥과 접속 관계가 가장 자연스러운 곳';
const STEREO_IMPLY = '지문에 직접 쓰이지 않았으나 논리적으로 따라올 수 있는 함의';

type Issue = {
  id: string; type: string; source: string; status: string;
  category: string; detail: string;
};

async function main() {
  const orderNumber = process.argv[2] ?? 'MV-20260417-001';
  const db = await getDb('gomijoshua');
  const order = await db.collection('orders').findOne({ orderNumber });
  if (!order) { console.error('주문 없음'); process.exit(1); }

  const passagesCol = db.collection('passages');
  const examSel = (order.orderMeta as Record<string, unknown>)?.examSelections;
  const { passageDocs } = await passagesForMockVariantOrder(passagesCol, examSel);
  const passageIds = passageDocs.map((p) => p._id);
  const passageMap = new Map<string, { original: string; len: number }>();
  for (const p of passageDocs) {
    const full = await passagesCol.findOne({ _id: p._id });
    const orig = String(full?.content?.original ?? '');
    passageMap.set(String(p._id), { original: orig, len: orig.length });
  }

  const gqCol = db.collection('generated_questions');
  const docs = await gqCol.find({ passage_id: { $in: passageIds } }).toArray();

  const issues: Issue[] = [];
  for (const d of docs) {
    const id = String(d._id);
    const type = String(d.type ?? '').trim();
    const status = String(d.status ?? '');
    const source = String(d.source ?? '');
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const paragraph = String(qd.Paragraph ?? '');
    const options = String(qd.Options ?? '');
    const explanation = String(qd.Explanation ?? '');
    const passageInfo = passageMap.get(String(d.passage_id));

    // 빈칸 — Paragraph 길이 점검
    if (type === '빈칸' && passageInfo) {
      const ratio = paragraph.length / Math.max(passageInfo.len, 1);
      // Paragraph가 원문 길이의 70% 미만이면 잘렸다고 의심
      if (ratio < 0.7) {
        issues.push({ id, type, source, status, category: '빈칸_잘림',
          detail: `paragraphLen=${paragraph.length} originalLen=${passageInfo.len} ratio=${ratio.toFixed(2)}` });
      }
      // 빈칸 표시: <u>, underscore _{3,}, 한글 빈칸 박스(□) 등 모두 OK
      const hasUnderlineTag = /<u[^>]*>[\s_]*<\/u>/.test(paragraph);
      const hasUnderscoreBlank = /_{3,}/.test(paragraph);
      const hasBracketBlank = /\(\s*\)/.test(paragraph) || /\[\s*\]/.test(paragraph);
      if (!hasUnderlineTag && !hasUnderscoreBlank && !hasBracketBlank) {
        issues.push({ id, type, source, status, category: '빈칸_표시없음', detail: '빈칸 표시 패턴 없음' });
      }
    }

    // 삽입·삽입-고난도 — Paragraph 자체가 비어있는지, 또는 구분 없음
    if (type === '삽입' || type === '삽입-고난도') {
      if (paragraph.length === 0) {
        // PassageWithPositions/InsertSentence 별도 키로 저장된 비표준 케이스
        const hasAlt = qd.PassageWithPositions || qd.InsertSentence;
        issues.push({ id, type, source, status, category: '삽입_Paragraph없음',
          detail: hasAlt ? '비표준 키(PassageWithPositions/InsertSentence)에 저장' : '완전 누락' });
      } else {
        // 구분: \n\n, \n###(N개)\n, 또는 첫 줄 + 빈줄 + 본문
        const lines = paragraph.split('\n');
        const hasBlankLine = lines.some((l, i) => i > 0 && l.trim() === '');
        const hasHashSeparator = /\n#{2,}\n/.test(paragraph);
        if (!hasBlankLine && !hasHashSeparator) {
          issues.push({ id, type, source, status, category: '삽입_구분없음',
            detail: `paragraphLen=${paragraph.length}, head="${paragraph.slice(0, 80).replace(/\n/g, '\\n')}…"` });
        }
      }
      if (explanation.includes(STEREO_INSERT)) {
        issues.push({ id, type, source, status, category: '삽입_정형해설',
          detail: explanation.slice(0, 80) });
      }
    }

    // 어법 — Options/Paragraph 밑줄 점검
    if (type === '어법') {
      // Paragraph의 <u>...</u> 추출 후 단어 수 검사
      const matches = [...paragraph.matchAll(/<u>([\s\S]*?)<\/u>/g)];
      const wordCounts = matches.map((m) => m[1].trim().split(/\s+/).filter(Boolean).length);
      const tooLong = wordCounts.filter((n) => n > 3);
      if (tooLong.length > 0) {
        issues.push({ id, type, source, status, category: '어법_4단어이상',
          detail: `밑줄 단어수=${wordCounts.join(',')} (4단어 이상 ${tooLong.length}개)` });
      }
      if (matches.length !== 5) {
        issues.push({ id, type, source, status, category: '어법_밑줄개수',
          detail: `<u> 개수 ${matches.length}` });
      }
    }

    // 요약 — Paragraph에 (A) 또는 ____ 있는지
    if (type === '요약') {
      const hasABMark = /\(A\)/.test(paragraph) && /\(B\)/.test(paragraph);
      const hasBlank = /_{3,}/.test(paragraph);
      if (!hasABMark && !hasBlank) {
        issues.push({ id, type, source, status, category: '요약_요약문없음',
          detail: `paragraphLen=${paragraph.length}, options=${options.slice(0, 60)}` });
      }
    }

    // 함의 — 정형 해설
    if (type === '함의' && explanation.includes(STEREO_IMPLY)) {
      issues.push({ id, type, source, status, category: '함의_정형해설',
        detail: explanation.slice(0, 80) });
    }

    // Options 한국어 포함 (어법·삽입·삽입-고난도·무관한문장 제외)
    if (!['어법', '삽입', '삽입-고난도', '무관한문장'].includes(type)) {
      // ###로 분리한 보기 본문에 한글 포함되면 한글 선택지
      if (HANGUL_RE.test(options)) {
        issues.push({ id, type, source, status, category: '한국어_선택지',
          detail: options.slice(0, 100) });
      }
    }
  }

  // 카테고리별 집계
  const byCategory = new Map<string, number>();
  for (const i of issues) byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + 1);

  console.log('=== 카테고리 집계 ===');
  for (const [k, v] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${k}: ${v}`);
  }
  console.log(`\n총 이슈: ${issues.length} / 전체 문항: ${docs.length}\n`);

  console.log('=== 상세 (NDJSON) ===');
  for (const i of issues) console.log(JSON.stringify(i));
}
main().catch(e => { console.error(e); process.exit(1); });
