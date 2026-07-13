/**
 * 문법 개념교재 시드 — 진도(소단원 학습주제) 1개 = 교재 스튜디오 문서 1개.
 * vip_grammar_concepts(진도별 개념: intro·표·points·tip)를 읽어 A4 스튜디오 요소(파스텔 개념 조판)로
 * 변환해 vip_material_studio_docs 에 insert. Pro 전용(ANTHROPIC API 미사용) — 변환·저장만 한다.
 *
 *   npx tsx scripts/seed-grammar-concept-books.ts --user-id <ObjectId> [--level 1] \
 *     [--folder "중등 영문법 LEVEL 1 개념교재"] [--topic "인칭대명사"] [--dry-run] [--force]
 *
 * · 같은 (userId, folder, title) 문서가 있으면 건너뜀(--force 면 페이지 교체) — 재실행 안전.
 * · 문서 순서: 목록이 updatedAt 내림차순이므로 커리큘럼 순서가 위로 오게 updatedAt 을 역산 배정.
 */
import path from 'node:path';
import { loadCliEnv } from './_cli-env';
loadCliEnv(path.resolve(__dirname, '..'));
import { ObjectId } from 'mongodb';
import { getDb } from '../lib/mongodb';
import { GRAMMAR_CURRICULA, grammarTopicKey } from '../lib/grammar-curriculum';
import { GRAMMAR_CONCEPTS_COLLECTION, normalizeConcept, type GrammarConcept } from '../lib/vip-grammar-concept';
import {
  STUDIO_MATERIALS_COLLECTION,
  sanitizeStudioPages,
  A4_W,
  type StudioElement,
  type StudioPage,
} from '../lib/vip-material-studio';

/* ── 워크시트 개념 박스와 동일한 파스텔 팔레트 [bg, ink] — "색=격" 매칭 유지 ── */
const PAL: [string, string][] = [
  ['#eaf1fb', '#4f74b3'],
  ['#eaf4ee', '#4f9070'],
  ['#f8f2e8', '#a8824f'],
  ['#f1ecfa', '#7d6bb0'],
  ['#f9ecf1', '#b06f8c'],
  ['#e9f4f4', '#4f9494'],
];

const MARGIN = 15;
const CONTENT_W = A4_W - MARGIN * 2; // 180
const PAGE_BOTTOM = 281; // 이보다 내려가면 다음 페이지

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

/* ── 텍스트 폭/줄수 추정 (한글 1em·ASCII 0.55em 가중) ── */
const PT_MM = 0.3528;
function textEm(s: string): number {
  let em = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x20) em += 0.5;
    else if (c >= 0x21 && c <= 0x7e) em += 0.55;
    else em += 1.0;
  }
  return em;
}
function widthMm(s: string, pt: number): number {
  return textEm(s) * pt * PT_MM;
}
/** 편집기 텍스트 박스는 상하좌우 1.2mm 패딩 + scrollHeight 실측 넘침 판정 — 랩 폭·높이에 반영 */
const TEXT_PAD = 1.2;
function wrapLines(s: string, pt: number, boxWmm: number): number {
  if (!s) return 0;
  const usable = boxWmm - TEXT_PAD * 2;
  let lines = 0;
  for (const seg of s.split('\n')) lines += Math.max(1, Math.ceil((widthMm(seg, pt) * 1.15) / usable));
  return lines;
}
/** 넘침 없는 텍스트 박스 높이 (줄수×줄높이 + 패딩 + 안전여유) */
function textH(s: string, pt: number, boxWmm: number, lh = 1.4): number {
  return wrapLines(s, pt, boxWmm) * pt * PT_MM * lh + TEXT_PAD * 2 + 0.5;
}
function stripU(s: string): string {
  return s.replace(/<\/?u>/g, '');
}

/* ── 요소 빌더 ── */
let seq = 0;
const eid = () => `cb${(++seq).toString(36)}`;
const txt = (p: Partial<StudioElement>): StudioElement => ({
  id: eid(), kind: 'text', x: MARGIN, y: 0, w: CONTENT_W, h: 8, z: 2,
  fontSize: 10, bold: false, align: 'left', color: '#111827', lineHeight: 1.4,
  ...p,
});
const rect = (p: Partial<StudioElement>): StudioElement => ({
  id: eid(), kind: 'rect', x: MARGIN, y: 0, w: CONTENT_W, h: 8, z: 1, fill: '#f5f5f5', borderWidth: 0, ...p,
});

interface BuildResult { pages: StudioPage[] }

/** 개념 1건 → 스튜디오 페이지들 (넘치면 자동 페이지 분할) */
function buildConceptPages(opts: { concept: GrammarConcept; 과정: string; 대단원: string; title: string }): BuildResult {
  const { concept, 과정, 대단원, title } = opts;
  const pages: StudioPage[] = [];
  let els: StudioElement[] = [];
  let y = 13;

  const footer = () => {
    els.push(rect({ x: MARGIN, y: 287.5, w: CONTENT_W, h: 0.35, fill: '#e5e7eb', z: 1 }));
    els.push(txt({ y: 288.6, h: 6.5, text: `${과정} 문법 개념 · ${대단원}`, fontSize: 8, color: '#9ca3af', align: 'right' }));
  };
  const flush = () => {
    footer();
    pages.push({ id: eid(), elements: els });
    els = [];
  };
  const newContinuedPage = () => {
    flush();
    y = 13;
    els.push(txt({ y, h: 9.5, text: `${title} (이어서)`, fontSize: 12, bold: true, color: '#111827' }));
    y += 10.5;
    els.push(rect({ x: MARGIN, y, w: CONTENT_W, h: 0.5, fill: '#111827' }));
    y += 6;
  };
  const ensure = (blockH: number) => {
    if (y + blockH > PAGE_BOTTOM) newContinuedPage();
  };

  /* 헤더 — 연회색 「문법 개념」 칩 + 과정 라벨 + 제목 + 차콜 헤어라인 + 대단원 */
  els.push(rect({ x: MARGIN, y, w: 26, h: 7.6, fill: '#f3f4f6', radius: 1.4 }));
  els.push(txt({ x: MARGIN, y: y + 0.4, w: 26, h: 7, text: '문법 개념', fontSize: 9, bold: true, align: 'center', color: '#4b5563', letterSpacing: 0.5 }));
  els.push(txt({ x: 108, y: y + 0.8, w: 87, h: 6.8, text: 과정, fontSize: 8.5, color: '#9ca3af', align: 'right' }));
  y += 11;
  const titleH = textH(title, 17, CONTENT_W, 1.25);
  els.push(txt({ y, h: titleH, text: title, fontSize: 17, bold: true, color: '#111827', lineHeight: 1.25 }));
  y += titleH + 0.8;
  els.push(rect({ x: MARGIN, y, w: CONTENT_W, h: 0.55, fill: '#111827' }));
  y += 2.2;
  els.push(txt({ y, h: 7.2, text: 대단원, fontSize: 9.5, color: '#6b7280' }));
  y += 8.6;

  /* 인트로 */
  if (concept.intro) {
    const h = textH(concept.intro, 10.5, CONTENT_W, 1.5);
    ensure(h);
    els.push(txt({ y, h, text: concept.intro, fontSize: 10.5, color: '#374151', lineHeight: 1.5 }));
    y += h + 4.5;
  }

  /* 표 — 데이터 열 j(≥1) 색 = points[j-1] 태그 색 ("색=격") */
  const table = concept.table;
  if (table && table.headers.length && table.rows.length) {
    const cols = table.headers.length;
    const colW = CONTENT_W / cols;
    const cellTxtH = (s: string) => textH(s, 9.5, colW - 1, 1.3); // 패딩·안전여유 포함 박스높이
    const headerH = Math.max(7.8, ...table.headers.map((h) => cellTxtH(h) + 0.2));
    const rowHs = table.rows.map((r) => Math.max(7.4, ...r.map((c) => cellTxtH(String(c)) + 0.2)));
    const titleH2 = table.title ? 8 : 0;
    const totalH = titleH2 + headerH + rowHs.reduce((a, b) => a + b, 0);
    ensure(Math.min(totalH, 200)); // 표가 통째로 한 페이지에 들어가게 (200mm 초과 표는 없음)
    if (table.title) {
      els.push(txt({ y, h: 7.4, text: table.title, fontSize: 10, bold: true, color: '#111827' }));
      y += 8;
    }
    table.headers.forEach((hd, j) => {
      const [bg, ink] = j === 0 ? ['#f3f4f6', '#374151'] : PAL[(j - 1) % PAL.length];
      const th = cellTxtH(hd);
      els.push(rect({ x: MARGIN + j * colW, y, w: colW, h: headerH, fill: bg, borderColor: '#e2e8f0', borderWidth: 0.25 }));
      els.push(txt({ x: MARGIN + j * colW + 0.5, y: y + Math.max(0.2, (headerH - th) / 2), w: colW - 1, h: th, text: hd, fontSize: 9.5, bold: true, align: 'center', color: ink, lineHeight: 1.3 }));
    });
    y += headerH;
    table.rows.forEach((row, ri) => {
      const rh = rowHs[ri];
      for (let j = 0; j < cols; j++) {
        const cell = String(row[j] ?? '');
        els.push(rect({ x: MARGIN + j * colW, y, w: colW, h: rh, fill: j === 0 ? '#f9fafb' : '#ffffff', borderColor: '#e2e8f0', borderWidth: 0.25 }));
        const th = cellTxtH(cell);
        els.push(txt({ x: MARGIN + j * colW + 0.5, y: y + Math.max(0.2, (rh - th) / 2), w: colW - 1, h: th, text: cell, fontSize: 9.5, bold: j === 0, align: 'center', color: j === 0 ? '#374151' : '#4b5563', lineHeight: 1.3 }));
      }
      y += rh;
    });
    y += 6;
  }

  /* 포인트 — 파스텔 용어 칩 + 설명(칩 우측) + 예문(컬러 바 인용) */
  concept.points.forEach((p, i) => {
    const [bg, ink] = PAL[i % PAL.length];
    const term = p.term || `포인트 ${i + 1}`;
    const chipW = Math.min(80, Math.max(22, widthMm(term, 9.5) + 9));
    const chipH = 7.6;
    const detailW = CONTENT_W - chipW - 4;
    const detailH = p.detail ? textH(p.detail, 10, detailW, 1.45) : 0;
    const blockH = Math.max(chipH + 1, detailH + 0.4);
    const example = p.example ? stripU(p.example) : '';
    const exH = example ? textH(example, 9.5, CONTENT_W - 8, 1.4) : 0;
    ensure(blockH + (example ? exH + 1.6 : 0) + 3.2);

    els.push(rect({ x: MARGIN, y, w: chipW, h: chipH, fill: bg, radius: 1.4 }));
    els.push(txt({ x: MARGIN, y: y + 0.4, w: chipW, h: chipH - 0.6, text: term, fontSize: 9.5, bold: true, align: 'center', color: ink }));
    if (p.detail) {
      els.push(txt({ x: MARGIN + chipW + 4, y: y + 0.4, w: detailW, h: detailH, text: p.detail, fontSize: 10, color: '#374151', lineHeight: 1.45 }));
    }
    y += blockH;
    if (example) {
      els.push(rect({ x: MARGIN + 1.8, y: y + 1.4, w: 1, h: Math.max(3, exH - 2.6), fill: ink, radius: 0.5 }));
      els.push(txt({ x: MARGIN + 6, y, w: CONTENT_W - 8, h: exH, text: example, fontSize: 9.5, color: '#64748b', lineHeight: 1.4 }));
      y += exH + 1.2;
    }
    y += 2.8;
  });

  /* 팁 */
  if (concept.tip) {
    const tipH = textH(concept.tip, 10, CONTENT_W - 22, 1.45);
    const boxH = Math.max(12.5, tipH + 5);
    ensure(boxH + 2);
    els.push(rect({ x: MARGIN, y, w: CONTENT_W, h: boxH, fill: '#f8fafc', borderColor: '#e2e8f0', borderWidth: 0.3, radius: 1.8 }));
    els.push(rect({ x: MARGIN + 4, y: y + 2.6, w: 12, h: 7.2, fill: '#111827', radius: 1.2 }));
    els.push(txt({ x: MARGIN + 4, y: y + 2.9, w: 12, h: 6.8, text: 'TIP', fontSize: 8.5, bold: true, align: 'center', color: '#ffffff' }));
    els.push(txt({ x: MARGIN + 19, y: y + 2.5, w: CONTENT_W - 23, h: tipH, text: concept.tip, fontSize: 10, color: '#4b5563', lineHeight: 1.45 }));
    y += boxH + 2;
  }

  flush();
  return { pages };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const userIdArg = arg('--user-id');
  const level = arg('--level', '1');
  const topicFilter = arg('--topic');
  if (!userIdArg) { console.error('필수: --user-id <ObjectId>'); process.exit(1); }
  const userId = new ObjectId(userIdArg);
  const 과정 = `중등 영문법 LEVEL ${level}`;
  const cur = GRAMMAR_CURRICULA.find((c) => c.과정 === 과정);
  if (!cur) { console.error(`커리큘럼 없음: ${과정}`); process.exit(1); }
  const folder = (arg('--folder') ?? `${과정} 개념교재`).slice(0, 40);

  const db = await getDb('gomijoshua');
  const conceptsCol = db.collection(GRAMMAR_CONCEPTS_COLLECTION);
  const docsCol = db.collection(STUDIO_MATERIALS_COLLECTION);

  // 대단원 바로 아래 학습주제(얕은 목차) 평탄화 — LEVEL 1~3 공통 형태
  const topics: { 대단원: string; topic: string; topicKey: string }[] = [];
  for (const big of cur.대단원) {
    for (const t of big.학습주제 ?? []) {
      topics.push({ 대단원: big.대단원명, topic: t, topicKey: grammarTopicKey(과정, big.대단원명, t) });
    }
  }
  const targets = topicFilter ? topics.filter((t) => t.topic.includes(topicFilter)) : topics;

  let created = 0, updated = 0, skippedExisting = 0;
  const noConcept: string[] = [];
  const base = Date.now();

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const raw = await conceptsCol.findOne({ userId, topicKey: t.topicKey });
    const concept = normalizeConcept(raw);
    if (!concept) { noConcept.push(t.topicKey); continue; }

    const title = `${String(i + 1).padStart(2, '0')}. ${t.topic}`;
    const { pages } = buildConceptPages({ concept, 과정, 대단원: t.대단원, title: concept.title || t.topic });
    const clean = sanitizeStudioPages(pages);
    // 목록(updatedAt desc)에서 커리큘럼 순서 유지 — 앞 주제일수록 최신으로
    const when = new Date(base + (targets.length - i) * 1500);
    const existing = await docsCol.findOne({ userId, folder, title }, { projection: { _id: 1 } });

    const tableMark = concept.table ? '·표' : '';
    console.log(`${existing ? (force ? '갱신' : '건너뜀') : '생성'}  ${title}  (p${clean.length}${tableMark}, 포인트 ${concept.points.length})`);
    if (existing && !force) { skippedExisting++; continue; }
    if (dryRun) { existing ? updated++ : created++; continue; }

    if (existing) {
      await docsCol.updateOne({ _id: existing._id }, { $set: { subtitle: `${과정} · ${t.대단원}`, pages: clean, pageCount: clean.length, updatedAt: when } });
      updated++;
    } else {
      await docsCol.insertOne({
        userId, title, subtitle: `${과정} · ${t.대단원}`, difficulty: '', folder,
        pages: clean, pageCount: clean.length, createdAt: when, updatedAt: when,
      });
      created++;
    }
  }

  if (!dryRun && (created || updated)) {
    await db.collection('vip_material_studio_folders').updateOne(
      { userId }, { $addToSet: { names: folder }, $set: { updatedAt: new Date() } }, { upsert: true });
  }
  console.log(`\n${dryRun ? '[dry-run] ' : ''}폴더 「${folder}」 — 생성 ${created} · 갱신 ${updated} · 건너뜀 ${skippedExisting} / 대상 ${targets.length}`);
  if (noConcept.length) console.log(`개념 없음 ${noConcept.length}:\n  ` + noConcept.join('\n  '));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
