/**
 * hwpx (OWPML 1.0 / 2011 스펙) 파일 생성 — kordoc/cfb 미사용.
 * jszip으로 직접 구현해 Amplify Lambda에서 cfb 누락 문제를 완전히 우회.
 *
 * 참조: kordoc가 생성한 실제 hwpx 파일 구조 역공학
 *   - namespace: http://www.hancom.co.kr/hwpml/2011/{section|paragraph|head}
 *   - header.xml 필수 (폰트·charPr·paraPr·스타일 정의)
 *   - section0.xml → paraPrIDRef / charPrIDRef 로 header.xml 참조
 *   - 모든 파일 STORE (압축 없음)
 */

import type { MemberVariantExportDoc, ExportMode } from '@/lib/member-variant-export-build';
import {
  exportPlainText,
  flattenMemberQuestionData,
  flattenEssayQuestionData,
  isEssayQuestionType,
} from '@/lib/member-variant-export-build';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── CharPr IDs (header.xml 에 정의) ────────────────────────────────────────
const CHAR_NORMAL   = 0; // height=1000, 일반
const CHAR_BOLD_H1  = 1; // height=1800, 굵게 (제목)
const CHAR_BOLD_H2  = 2; // height=1400, 굵게 (소제목)
const CHAR_BODY     = 3; // height=1100, 본문
const CHAR_ANSWER   = 4; // height=1100, 정답 (파란색)
const CHAR_NOTE     = 5; // height=1000, 해설 (회색)
const CHAR_SEP      = 6; // height=1000, 구분선

// ─── ParaPr IDs ─────────────────────────────────────────────────────────────
const PARA_NORMAL = 0; // 기본 단락
const PARA_H1     = 1; // 제목 단락 (prev=800, next=200)

function para(
  text: string,
  charPrID: number = CHAR_NORMAL,
  paraPrID: number = PARA_NORMAL,
  isFirst = false,
): string {
  const secPr = isFirst
    ? `<hp:secPr textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" outlineShapeIDRef="0" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0"><hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/><hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/><hp:pagePr landscape="WIDELY" width="59528" height="84188" gutterType="LEFT_ONLY"><hp:margin header="2835" footer="2835" gutter="0" left="5670" right="4252" top="8504" bottom="4252"/></hp:pagePr><hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr><hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr></hp:secPr>`
    : '';
  return `<hp:p paraPrIDRef="${paraPrID}" styleIDRef="0"><hp:run charPrIDRef="${charPrID}">${secPr}<hp:t>${esc(text)}</hp:t></hp:run></hp:p>`;
}

function emptyPara(isFirst = false): string {
  return para('', CHAR_NORMAL, PARA_NORMAL, isFirst);
}

function buildSection0Xml(docs: MemberVariantExportDoc[], mode: ExportMode, titleSuffix: string): string {
  const lines: string[] = [];
  // 첫 번째 단락에 secPr 필수
  lines.push(para(`회원 변형 문항${titleSuffix}`, CHAR_BOLD_H1, PARA_H1, true));

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const qd = d.question_data ?? {};
    const docType = str(d.type);
    const isEssay = isEssayQuestionType(docType);

    lines.push(emptyPara());
    lines.push(
      para(
        `${i + 1}. [${exportPlainText(docType)}] (${exportPlainText(str(d.difficulty))}) · ${exportPlainText(str(d.textbook))}`,
        CHAR_BOLD_H2,
        PARA_NORMAL,
      ),
    );

    if (isEssay) {
      for (const { label, text } of flattenEssayQuestionData(qd, mode)) {
        const isAnswer = label === '모범 답안';
        const isNote = label === '해설' || label === '정답 어휘';
        const charPr = isAnswer ? CHAR_ANSWER : isNote ? CHAR_NOTE : CHAR_BODY;
        lines.push(para(`[${label}]`, charPr, PARA_NORMAL));
        for (const line of exportPlainText(text).split(/\n/).filter(Boolean)) {
          lines.push(para(line, charPr, PARA_NORMAL));
        }
      }
    } else {
      const f = flattenMemberQuestionData(qd);
      if (f.question)
        lines.push(para(`발문: ${exportPlainText(f.question)}`, CHAR_BODY, PARA_NORMAL));
      if (f.paragraph)
        lines.push(para(exportPlainText(f.paragraph), CHAR_BODY, PARA_NORMAL));
      if (f.optionsDisplay) {
        for (const line of exportPlainText(f.optionsDisplay).split(/\n/).filter(Boolean)) {
          lines.push(para(line, CHAR_BODY, PARA_NORMAL));
        }
      }
      if (mode === 'teacher') {
        lines.push(para(`정답: ${exportPlainText(f.answer)}`, CHAR_ANSWER, PARA_NORMAL));
        if (f.explanation) {
          lines.push(para(`해설: ${exportPlainText(f.explanation)}`, CHAR_NOTE, PARA_NORMAL));
        }
      }
    }

    if (i < docs.length - 1) {
      lines.push(para('─────────────────────────────────────────', CHAR_SEP, PARA_NORMAL));
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n` +
    `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">\n  ` +
    lines.join('\n  ') +
    '\n</hs:sec>'
  );
}

function buildContainerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf">
  <ocf:rootfiles>
    <ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>
  </ocf:rootfiles>
</ocf:container>`;
}

function buildContentHpf(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <opf:manifest>
    <opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>
    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="header" linear="no"/>
    <opf:itemref idref="section0" linear="yes"/>
  </opf:spine>
</opf:package>`;
}

/** 폰트·charPr·paraPr·스타일 정의 (section0.xml의 IDRef 참조 대상) */
function buildHeaderXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" version="1.4" secCnt="1">
  <hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>
  <hh:refList>
    <hh:fontfaces itemCnt="7">
      <hh:fontface lang="HANGUL" fontCnt="2">
        <hh:font id="0" face="함초롬바탕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>
        <hh:font id="1" face="함초롬돋움" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>
      </hh:fontface>
      <hh:fontface lang="LATIN" fontCnt="2">
        <hh:font id="0" face="Times New Roman" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_OLDSTYLE" weight="5" proportion="4" contrast="2" strokeVariation="0" armStyle="0" letterform="0" midline="0" xHeight="4"/></hh:font>
        <hh:font id="1" face="Consolas" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_MODERN" weight="5" proportion="0" contrast="0" strokeVariation="0" armStyle="0" letterform="0" midline="0" xHeight="0"/></hh:font>
      </hh:fontface>
      <hh:fontface lang="HANJA" fontCnt="1">
        <hh:font id="0" face="함초롬바탕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>
      </hh:fontface>
      <hh:fontface lang="JAPANESE" fontCnt="1">
        <hh:font id="0" face="굴림" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>
      </hh:fontface>
      <hh:fontface lang="OTHER" fontCnt="1">
        <hh:font id="0" face="굴림" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>
      </hh:fontface>
      <hh:fontface lang="SYMBOL" fontCnt="1">
        <hh:font id="0" face="Symbol" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>
      </hh:fontface>
      <hh:fontface lang="USER" fontCnt="1">
        <hh:font id="0" face="굴림" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="0" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/></hh:font>
      </hh:fontface>
    </hh:fontfaces>
    <hh:borderFills itemCnt="1">
      <hh:borderFill id="0" threeD="0" shadow="0" centerLine="0" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/>
        <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1mm" color="#000000"/>
        <hh:rightBorder type="NONE" width="0.1mm" color="#000000"/>
        <hh:topBorder type="NONE" width="0.1mm" color="#000000"/>
        <hh:bottomBorder type="NONE" width="0.1mm" color="#000000"/>
        <hh:diagonal type="NONE" width="0.1mm" color="#000000"/>
        <hh:fillInfo/>
      </hh:borderFill>
    </hh:borderFills>
    <hh:charProperties itemCnt="7">
      <hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="0">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>
      <hh:charPr id="1" height="1800" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="0" bold="1">
        <hh:fontRef hangul="1" latin="1" hanja="1" japanese="1" other="1" symbol="1" user="1"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>
      <hh:charPr id="2" height="1400" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="0" bold="1">
        <hh:fontRef hangul="1" latin="1" hanja="1" japanese="1" other="1" symbol="1" user="1"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>
      <hh:charPr id="3" height="1100" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="0">
        <hh:fontRef hangul="1" latin="1" hanja="1" japanese="1" other="1" symbol="1" user="1"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>
      <hh:charPr id="4" height="1100" textColor="#2563EB" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="0" bold="1">
        <hh:fontRef hangul="1" latin="1" hanja="1" japanese="1" other="1" symbol="1" user="1"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>
      <hh:charPr id="5" height="1000" textColor="#6B7280" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="0">
        <hh:fontRef hangul="1" latin="1" hanja="1" japanese="1" other="1" symbol="1" user="1"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>
      <hh:charPr id="6" height="1000" textColor="#9CA3AF" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="0">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>
    </hh:charProperties>
    <hh:tabProperties itemCnt="0"/>
    <hh:numberings itemCnt="0"/>
    <hh:bullets itemCnt="0"/>
    <hh:paraProperties itemCnt="2">
      <hh:paraPr id="0" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0" textDir="AUTO">
        <hh:align horizontal="JUSTIFY" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:autoSpacing eAsianEng="0" eAsianNum="0"/>
        <hh:margin indent="0" left="0" right="0" prev="0" next="0"/>
        <hh:lineSpacing type="PERCENT" value="160"/>
        <hh:border borderFillIDRef="0" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>
      <hh:paraPr id="1" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0" textDir="AUTO">
        <hh:align horizontal="LEFT" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:autoSpacing eAsianEng="0" eAsianNum="0"/>
        <hh:margin indent="0" left="0" right="0" prev="800" next="200"/>
        <hh:lineSpacing type="PERCENT" value="180"/>
        <hh:border borderFillIDRef="0" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>
    </hh:paraProperties>
    <hh:styles itemCnt="1">
      <hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langIDRef="1042" lockForm="0"/>
    </hh:styles>
  </hh:refList>
  <hh:compatibleDocument targetProgram="HWP2018"/>
</hh:head>`;
}

export async function buildMemberVariantHwpxBuffer(
  docs: MemberVariantExportDoc[],
  mode: ExportMode = 'teacher',
): Promise<Buffer> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  const titleSuffix = mode === 'student' ? ' (학생용)' : ' (교사용)';

  // 모든 파일 STORE (압축 없음) — kordoc 동일
  const opt = { compression: 'STORE' as const };
  zip.file('mimetype', 'application/hwp+zip', opt);
  zip.file('META-INF/container.xml', buildContainerXml(), opt);
  zip.file('Contents/content.hpf', buildContentHpf(), opt);
  zip.file('Contents/header.xml', buildHeaderXml(), opt);
  zip.file('Contents/section0.xml', buildSection0Xml(docs, mode, titleSuffix), opt);

  const ab = await zip.generateAsync({ type: 'arraybuffer' });
  return Buffer.from(ab);
}
