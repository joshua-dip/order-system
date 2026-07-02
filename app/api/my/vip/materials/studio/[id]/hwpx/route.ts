import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import JSZip from 'jszip';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { STUDIO_MATERIALS_COLLECTION, type StudioElement, type StudioPage } from '@/lib/vip-material-studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * HWPX(OWPML, ZIP+XML) 최소 스켈레톤 내보내기 — v1 은 텍스트 플로우.
 * 요소를 페이지 순 → (y, x) 순으로 문단화. 이미지는 [이미지], QR 은 URL 텍스트로 표기.
 * (자유 배치 레이아웃 그대로는 PDF 다운로드가 정확하며, HWPX 는 한글에서 이어서 편집하는 용도)
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const CIRCLED = ['①', '②', '③', '④', '⑤'];
const stripTags = (s: string) => (s || '').replace(/<\/?u>/g, '');

/** 요소 → 문단 텍스트 배열 (bold 여부 포함) */
function elementParagraphs(el: StudioElement): { text: string; bold?: boolean }[] {
  if (el.kind === 'text') {
    const t = stripTags(el.text ?? '').trim();
    if (!t) return [];
    return t.split(/\n/).map((line) => ({ text: line, bold: el.bold === true }));
  }
  if (el.kind === 'qr') {
    if (!el.qrUrl) return [];
    return [{ text: `▣ QR: ${el.qrLabel ? `${el.qrLabel} — ` : ''}${el.qrUrl}` }];
  }
  if (el.kind === 'image') return [{ text: '[이미지 — PDF 다운로드에는 실제 이미지가 들어갑니다]' }];
  if (el.kind === 'question' && el.q) {
    const q = el.q;
    const out: { text: string; bold?: boolean }[] = [];
    out.push({ text: `${q.num ? `${q.num}. ` : ''}${stripTags(q.question ?? '')}`, bold: true });
    if (q.paragraph) stripTags(q.paragraph).split(/\n/).forEach((l) => out.push({ text: l }));
    (q.options ?? []).filter((o) => o.trim()).forEach((o, i) => out.push({ text: `${CIRCLED[i] ?? `${i + 1})`} ${o}` }));
    if (q.showAnswer && q.answer) out.push({ text: `정답 ${q.answer}${q.explanation ? ` — ${stripTags(q.explanation)}` : ''}` });
    return out;
  }
  return []; // rect/line 은 레이아웃 요소 — 텍스트 플로우에서 제외
}

function para(text: string, bold = false, styleIDRef = '0'): string {
  return `<hp:p id="0" paraPrIDRef="0" styleIDRef="${styleIDRef}" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${bold ? '1' : '0'}"><hp:t>${esc(text)}</hp:t></hp:run></hp:p>`;
}

function buildSectionXml(title: string, pages: StudioPage[]): string {
  const paras: string[] = [];
  // 첫 문단에 secPr(용지 A4) 포함
  paras.push(
    `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="1"><hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0"><hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0" strikeContinue="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/><hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/><hp:pagePr landscape="WIDELY" width="59528" height="84188" gutterType="LEFT_ONLY"><hp:margin header="4252" footer="4252" gutter="0" left="8504" right="8504" top="5668" bottom="4252"/></hp:pagePr></hp:secPr><hp:t>${esc(title)}</hp:t></hp:run></hp:p>`,
  );
  pages.forEach((p, i) => {
    paras.push(para(`─── ${i + 1} 페이지 ───`, true));
    const els = [...(p.elements ?? [])].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    for (const el of els) for (const pp of elementParagraphs(el as StudioElement)) paras.push(para(pp.text, pp.bold));
    paras.push(para(''));
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${paras.join('')}</hs:sec>`;
}

const HEADER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" version="1.4" secCnt="1"><hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList><hh:fontfaces itemCnt="1"><hh:fontface lang="HANGUL" fontCnt="1"><hh:font id="0" face="함초롬바탕" type="TTF" isEmbedded="0"/></hh:fontface></hh:fontfaces><hh:charProperties itemCnt="2"><hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="0"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/></hh:charPr><hh:charPr id="1" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="0"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/></hh:charPr></hh:charProperties><hh:paraProperties itemCnt="1"><hh:paraPr id="0" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:align horizontal="JUSTIFY" vertical="BASELINE"/><hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/></hh:paraPr></hh:paraProperties><hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles></hh:refList></hh:head>`;

const VERSION_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" xmlVersion="1.4" application="Hancom Office Hangul" appVersion="11, 0, 0, 0 WIN32LEWindows_Unknown_Version"/>`;

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>`;

const MANIFEST_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><odf:file-entry odf:full-path="/" odf:media-type="application/hwp+zip"/><odf:file-entry odf:full-path="Contents/header.xml" odf:media-type="application/xml"/><odf:file-entry odf:full-path="Contents/section0.xml" odf:media-type="application/xml"/></odf:manifest>`;

function contentHpf(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/" version="" unique-identifier="" id=""><opf:metadata><opf:title>${esc(title)}</opf:title><opf:language>ko</opf:language></opf:metadata><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`;
}

const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>`;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '유효하지 않은 ID' }, { status: 400 });
  const db = await getDb('gomijoshua');
  const doc = await db.collection(STUDIO_MATERIALS_COLLECTION).findOne({ _id: new ObjectId(id), userId: new ObjectId(auth.userId) });
  if (!doc) return NextResponse.json({ error: '교재를 찾을 수 없습니다.' }, { status: 404 });

  const title = String(doc.title || '교재');
  const pages = (Array.isArray(doc.pages) ? doc.pages : []) as StudioPage[];

  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
  zip.file('version.xml', VERSION_XML);
  zip.file('META-INF/container.xml', CONTAINER_XML);
  zip.file('META-INF/manifest.xml', MANIFEST_XML);
  zip.file('Contents/content.hpf', contentHpf(title));
  zip.file('Contents/header.xml', HEADER_XML);
  zip.file('Contents/section0.xml', buildSectionXml(title, pages));
  zip.file('settings.xml', SETTINGS_XML);

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const fname = encodeURIComponent(`${title}.hwpx`);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/haansofthwpx',
      'Content-Disposition': `attachment; filename*=UTF-8''${fname}`,
    },
  });
}
