import fs from 'node:fs';
import path from 'node:path';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { problemView, answerLabel, questionHtml, CIRCLED_NUMS, type BankProblem, type BankFormat } from '@/app/my/vip/grammar-problems/shared';
import { deriveProblemCategory, isProblemCategory } from '@/lib/vip-problem-category';
import { EMBEDDED_KOREAN_FONT_FAMILY } from '@/lib/pdf-korean-font';

// 개념 박스용 둥근 한글 폰트(Jua) base64 임베드 — chromium PDF 에서 로컬 파일 참조가 안 되므로 인라인.
let _juaCss: string | null = null;
function juaFontFaceCss(): string {
  if (_juaCss !== null) return _juaCss;
  try {
    const b64 = fs.readFileSync(path.join(process.cwd(), 'lib', 'fonts', 'Jua-Regular.ttf')).toString('base64');
    _juaCss = `@font-face{font-family:'Jua';font-style:normal;font-weight:400;src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
  } catch { _juaCss = ''; }
  return _juaCss;
}

// 개념 파스텔 팔레트 [배경, 잉크] — 표 격(열) 색 = 설명 태그 색.
const CONCEPT_PAL: [string, string][] = [
  ['#eaf1fb', '#4f74b3'],
  ['#eaf4ee', '#4f9070'],
  ['#f8f2e8', '#a8824f'],
  ['#f1ecfa', '#7d6bb0'],
  ['#f9ecf1', '#b06f8c'],
  ['#e9f4f4', '#4f9494'],
];


/**
 * 문제지 워크시트 → 인쇄용 A4 HTML (문법·라이팅 공용). chromium 렌더(renderHtmlToPdf)로 PDF 다운로드에 사용.
 * 화면 인쇄 오버레이(PrintWorksheet)와 동일한 레이아웃을 서버에서 문자열로 재구성한다.
 * - 여러 범위(keys)를 한 장으로 합침. break-inside:avoid 로 문항이 페이지 경계에서 잘리지 않게 함.
 */

interface WsProblem extends BankProblem {}

export interface TopicBlock { key: string; title: string; subtitle: string; problems: WsProblem[]; }

/** 범위별 문항을 인쇄 순서(범위→섹션→번호)대로 평탄화하며 전체 연번(num) 부여. 스냅샷·채점 번호 일치용. */
export function flattenWorksheetItems(blocks: TopicBlock[]): { num: number; topicKey: string; problem: WsProblem }[] {
  const out: { num: number; topicKey: string; problem: WsProblem }[] = [];
  let num = 0;
  for (const b of blocks) {
    const map = new Map<string, WsProblem[]>();
    for (const p of b.problems) { if (!map.has(p.section)) map.set(p.section, []); map.get(p.section)!.push(p); }
    for (const items of map.values()) for (const p of items) { num += 1; out.push({ num, topicKey: b.key, problem: p }); }
  }
  return out;
}

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** DB 문서 → BankProblem (bank 라우트와 동일 매핑). */
function mapDoc(d: Record<string, unknown>, formatSerial: (n: unknown) => string): WsProblem {
  const subj = d.subjective && typeof d.subjective === 'object' ? (d.subjective as Record<string, unknown>) : undefined;
  return {
    id: String(d._id),
    serial: formatSerial(d.serialNo),
    section: (d.section as string) ?? '',
    no: (d.no as number) ?? 0,
    type: (d.type as string) ?? '',
    category: isProblemCategory(d.category) ? d.category : deriveProblemCategory(d),
    instruction: (d.instruction as string) ?? '',
    choices: Array.isArray(d.choices) ? (d.choices as string[]) : undefined,
    options: Array.isArray(d.options) ? (d.options as string[]) : undefined,
    question: (d.question as string) ?? '',
    answer: (d.answer as string) ?? '',
    explanation: (d.explanation as string) ?? '',
    source: (d.source as string) ?? '',
    subjective: subj
      ? {
          type: String(subj.type ?? ''),
          instruction: String(subj.instruction ?? ''),
          answer: String(subj.answer ?? ''),
          choices: Array.isArray(subj.choices) ? (subj.choices as string[]) : undefined,
        }
      : undefined,
  };
}

/** 선택 범위(keys)의 문제를 범위별로 로드. */
export async function fetchWorksheetBlocks(opts: {
  db: Db;
  collection: string;
  userId: string;
  keys: string[];
  source?: string;
  category?: string;
  formatSerial: (n: unknown) => string;
}): Promise<TopicBlock[]> {
  const { db, collection, userId, keys, source, category, formatSerial } = opts;
  const col = db.collection(collection);
  const uid = new ObjectId(userId);
  const blocks: TopicBlock[] = [];
  for (const key of keys) {
    const match: Record<string, unknown> = { userId: uid, topicKey: key };
    if (source) match.source = source;
    if (category) match.category = category;
    const docs = await col.find(match).sort({ unit: 1, section: 1, no: 1, serialNo: 1 }).limit(500).toArray();
    const segs = key.split(' > ');
    blocks.push({
      key,
      title: segs[segs.length - 1] ?? '',
      subtitle: segs.slice(0, -1).join(' · '),
      problems: docs.map((d) => mapDoc(d as Record<string, unknown>, formatSerial)),
    });
  }
  return blocks;
}

export interface WsConcept { title?: string; intro?: string; table?: { title?: string; headers: string[]; rows: string[][] }; points?: { term?: string; detail?: string; example?: string }[]; tip?: string }

/** 워크시트 인쇄 HTML(A4). concepts: topicKey→개념. qr: 자가채점 QR(dataUrl + 안내). */
export function buildWorksheetHtml(
  blocks: TopicBlock[],
  opts: { fmt: BankFormat; withAnswers: boolean; concepts?: Record<string, WsConcept>; qr?: { dataUrl: string; caption?: string } },
): string {
  const { fmt, withAnswers, concepts, qr } = opts;
  const multi = blocks.length > 1;
  const headerTitle = multi ? '선택 범위 문제지' : (blocks[0]?.title ?? '');
  const headerSub = multi ? `${blocks.length}개 범위 · ${blocks[0]?.subtitle ?? ''}` : (blocks[0]?.subtitle ?? '');

  // 범위별 섹션 그룹
  const topicGroups = blocks.map((b) => {
    const map = new Map<string, { instruction: string; choices?: string[]; items: WsProblem[] }>();
    for (const p of b.problems) {
      const v = problemView(p, fmt);
      if (!map.has(p.section)) map.set(p.section, { instruction: v.instruction, choices: v.choices, items: [] });
      map.get(p.section)!.items.push(p);
    }
    return { ...b, sections: [...map.entries()].map(([label, g]) => ({ label, ...g })) };
  });
  const totalCount = blocks.reduce((s, b) => s + b.problems.length, 0);

  const conceptHtml = (key: string, fallbackTitle: string): string => {
    const c = concepts?.[key];
    if (!c || (!c.intro && !(c.points && c.points.length))) return '';
    const pts = (c.points ?? []).filter((p) => p && (p.term || p.detail)).map((p, i) => {
      const [bg, ink] = CONCEPT_PAL[i % CONCEPT_PAL.length];
      return `<div class="cpt">${p.term ? `<span class="cterm" style="background:${bg};color:${ink}">${esc(p.term)}</span>` : ''}${p.detail ? `<p class="cdet">${esc(p.detail)}</p>` : ''}${p.example ? `<p class="cex">${esc(p.example)}</p>` : ''}</div>`;
    }).join('');
    const tbl = (c.table && c.table.headers?.length && c.table.rows?.length)
      ? `<table class="ctbl"><thead><tr>${c.table.headers.map((h, i) => {
          if (i === 0) return `<th class="cth0">${esc(h)}</th>`;
          const [bg, ink] = CONCEPT_PAL[(i - 1) % CONCEPT_PAL.length];
          return `<th style="background:${bg};color:${ink}">${esc(h)}</th>`;
        }).join('')}</tr></thead><tbody>${c.table.rows.map((r) => `<tr>${r.map((cell, ci) => `<td class="${ci === 0 ? 'ctd0' : ''}">${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : '';
    return `<div class="concept"><div class="chd"><span class="cbadge">문법 개념</span><span class="ctitle">${esc(c.title || fallbackTitle)}</span></div><div class="cbody">${c.intro ? `<p class="ci">${esc(c.intro)}</p>` : ''}${tbl}${pts ? `<div class="cpts">${pts}</div>` : ''}${c.tip ? `<p class="ct">TIP. ${esc(c.tip)}</p>` : ''}</div></div>`;
  };

  let seq = 0;
  const bodyBlocks = topicGroups.map((tb) => {
    const topicHead = multi
      ? `<h2 class="th">${esc(tb.title)}${tb.subtitle ? `<span class="ths">${esc(tb.subtitle)}</span>` : ''}</h2>`
      : '';
    const concept = conceptHtml(tb.key, tb.title);
    if (tb.problems.length === 0) {
      return `<div class="topic">${topicHead}${concept}<p class="empty">이 범위의 문제가 없습니다.</p></div>`;
    }
    const secs = tb.sections.map((g) => {
      const bogi = g.choices && g.choices.length > 0
        ? `<p class="bogi"><span class="bl">|보기|</span> ${esc(g.choices.join('   ·   '))}</p>`
        : '';
      const items = g.items.map((p) => {
        seq += 1;
        const v = problemView(p, fmt);
        const isMc = !!v.options && v.options.length > 0;
        const answerLines = isMc ? 0 : v.type.includes('조건') ? 2 : 1;
        const opts2 = isMc
          ? `<div class="opts">${v.options!.map((o, i) => `<span>${CIRCLED_NUMS[i]} ${esc(o)}</span>`).join('')}</div>`
          : '';
        const lines = answerLines > 0
          ? `<div class="alines">${Array.from({ length: answerLines }).map(() => '<div class="aline"></div>').join('')}</div>`
          : '';
        // questionHtml 은 이미 이스케이프 + <u> 허용
        return `<li><div class="q"><b>${seq}.</b> <span class="qt">${questionHtml(p.question)}</span></div>${opts2}${lines}</li>`;
      }).join('');
      return `<section class="sec"><p class="si"><span class="lab">${esc(g.label)}</span> ${esc(g.instruction)}</p>${bogi}<ol>${items}</ol></section>`;
    }).join('');
    return `<div class="topic">${topicHead}${concept}${secs}</div>`;
  }).join('');

  // 정답지(별지)
  let ansHtml = '';
  if (withAnswers && totalCount > 0) {
    let n = 0;
    const groups = topicGroups.map((tb) => {
      if (tb.problems.length === 0) return '';
      const items = tb.sections.flatMap((g) => g.items.map((p) => {
        n += 1;
        const ans = fmt === 'subjective' && p.subjective ? p.subjective.answer : answerLabel(p);
        return `<li><b>${n}.</b> <span class="av">${esc(ans)}</span>${p.explanation ? `<span class="ax"> — ${esc(p.explanation)}</span>` : ''}<span class="asr">${esc(p.serial)}</span></li>`;
      })).join('');
      return `<div class="ag">${multi ? `<p class="agh">▎${esc(tb.title)}</p>` : ''}<ol class="al">${items}</ol></div>`;
    }).join('');
    ansHtml = `<div class="answers"><h2 class="anh">정답 및 해설 — ${esc(headerTitle)}</h2>${groups}</div>`;
  }

  const css = `
    ${juaFontFaceCss()}
    * { box-sizing: border-box; }
    body { margin:0; color:#18181b; font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif; font-size:13.5px; line-height:1.55; }
    .hd { border-bottom:2px solid #18181b; padding-bottom:6px; }
    .hd .sub { margin:0; font-size:11px; letter-spacing:.02em; color:#71717a; }
    .hrow { display:flex; align-items:flex-end; justify-content:space-between; }
    .hd h1 { margin:2px 0 0; font-size:20px; font-weight:800; }
    .hd .name { font-size:11px; color:#71717a; }
    .topic { margin-top:${multi ? '20px' : '0'}; }
    .concept { margin-top:12px; border:1px solid #e4e4e7; border-radius:16px; background:#fff; overflow:hidden; break-inside:avoid; break-after:page; font-family:'Jua','${EMBEDDED_KOREAN_FONT_FAMILY}',sans-serif; }
    .concept .chd { display:flex; align-items:center; gap:8px; border-bottom:1px solid #f4f4f5; padding:12px 24px; }
    .concept .cbadge { background:#f4f4f5; color:#71717a; border-radius:6px; padding:2px 8px; font-size:11.5px; }
    .concept .ctitle { font-size:16.5px; color:#3f3f46; }
    .concept .cbody { padding:16px 24px; }
    .concept .ci { margin:0; font-size:14px; line-height:1.7; color:#71717a; }
    .concept .cpts { margin-top:14px; }
    .concept .cpt { margin-top:12px; }
    .concept .cpt:first-child { margin-top:0; }
    .concept .cterm { display:inline-block; border-radius:6px; padding:2px 10px; font-size:13.5px; }
    .concept .cdet { margin:6px 0 0; font-size:13.5px; line-height:1.7; color:#71717a; }
    .concept .cex { margin:4px 0 0; font-size:13px; line-height:1.55; color:#a1a1aa; }
    .concept .ct { margin:16px 0 0; background:#fafafa; border-radius:10px; padding:10px 16px; font-size:12.5px; line-height:1.55; color:#a1a1aa; }
    .concept .ctbl { width:100%; border-collapse:collapse; margin-top:14px; font-size:13px; border:1px solid #f0f0f0; border-radius:10px; overflow:hidden; }
    .concept .ctbl th { padding:7px 10px; text-align:center; font-size:12.5px; }
    .concept .ctbl th.cth0 { background:#f8f8f9; color:#71717a; }
    .concept .ctbl td { border-top:1px solid #f4f4f5; padding:6px 10px; text-align:center; color:#3f3f46; }
    .concept .ctbl td.ctd0 { color:#a1a1aa; font-size:12px; }
    h2.th { margin:4px 0 0; border-left:4px solid #18181b; padding-left:8px; font-size:15px; font-weight:800; break-after:avoid; }
    h2.th .ths { margin-left:8px; font-size:11px; font-weight:500; color:#71717a; }
    .empty { margin-top:8px; font-size:12px; color:#a1a1aa; }
    section.sec { margin-top:16px; break-inside:avoid; }
    .si { margin:0; font-size:13px; font-weight:700; break-after:avoid; }
    .si .lab { display:inline-block; margin-right:6px; border-radius:3px; background:#18181b; color:#fff; padding:1px 6px; font-size:11px; font-weight:800; }
    .bogi { margin-top:8px; border:1px solid #a1a1aa; border-radius:4px; padding:6px 12px; font-size:13px; }
    .bogi .bl { margin-right:8px; font-size:11px; color:#71717a; }
    ol { margin:8px 0 0; padding-left:0; list-style:none; }
    ol li { margin-top:14px; break-inside:avoid; }
    .q { display:flex; gap:8px; }
    .q b { font-weight:700; }
    .qt u { text-decoration:underline; text-decoration-style:dotted; }
    .opts { margin:4px 0 0 24px; display:flex; flex-wrap:wrap; gap:2px 20px; font-size:13px; }
    .alines { margin:6px 0 0 24px; }
    .aline { border-bottom:1px solid #a1a1aa; height:1.7rem; }
    .answers { margin-top:24px; break-before:page; border-top:2px dashed #a1a1aa; padding-top:16px; }
    .anh { margin:0; font-size:16px; font-weight:800; }
    .ag { margin-top:8px; }
    .agh { margin:0; font-size:12px; font-weight:700; color:#3f3f46; }
    ol.al { margin-top:4px; }
    ol.al li { margin-top:4px; font-size:12px; }
    .av { color:#047857; font-weight:600; }
    .ax { color:#71717a; }
    .asr { margin-left:4px; font-family:ui-monospace,monospace; font-size:10px; color:#a1a1aa; }
    .hd { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; }
    .hd .htext { flex:1; }
    .qrbox { text-align:center; flex-shrink:0; }
    .qrbox img { width:72px; height:72px; display:block; }
    .qrbox .qcap { margin:2px 0 0; font-size:9px; color:#71717a; line-height:1.2; }
  `;

  const qrHtml = qr
    ? `<div class="qrbox"><img src="${qr.dataUrl}" alt="QR"/><p class="qcap">📱 스캔하면<br/>자가채점${qr.caption ? `<br/>${esc(qr.caption)}` : ''}</p></div>`
    : '';

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${css}</style></head><body>
    <div class="hd"><div class="htext"><p class="sub">${esc(headerSub)}</p><div class="hrow"><h1>${esc(headerTitle)}</h1></div><p class="name" style="margin-top:4px">이름 ______________ &nbsp; 날짜 ____월 ____일</p></div>${qrHtml}</div>
    ${bodyBlocks}
    ${ansHtml}
  </body></html>`;
}
