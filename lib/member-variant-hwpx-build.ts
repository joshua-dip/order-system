/**
 * hwpx (OWPML 1.0) 파일 생성 — kordoc/cfb 미사용.
 * jszip만으로 직접 구현해 Amplify Lambda에서 cfb 누락 문제를 완전히 우회.
 *
 * hwpx = zip 컨테이너 (docx/xlsx와 동일 구조)
 *   mimetype          — "application/hwp+zip" (압축 없음, STORE)
 *   META-INF/container.xml
 *   META-INF/manifest.xml
 *   version.xml
 *   Contents/content.hpf
 *   Contents/header.xml
 *   Contents/section0.xml  ← 본문
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

/** OWPML 단락 1개 — 들여쓰기·폰트 크기 단위는 hwpUnit(1/7200 인치) */
function para(text: string, opts: { bold?: boolean; fontSize?: number; color?: string } = {}): string {
  const charPr = [
    opts.bold ? '<hp:bold/>' : '',
    opts.fontSize ? `<hp:fontSize hp:size="${opts.fontSize}"/>` : '',
    opts.color ? `<hp:fontColor hp:val="${opts.color}"/>` : '',
  ].join('');
  const charPrBlock = charPr ? `<hp:charPr><hp:direct>${charPr}</hp:direct></hp:charPr>` : '';
  return `<hp:p><hp:pPr/><hp:run>${charPrBlock}<hp:t>${esc(text)}</hp:t></hp:run></hp:p>`;
}

function separator(): string {
  return `<hp:p><hp:pPr/><hp:run><hp:t>────────────────────────────────────────</hp:t></hp:run></hp:p>`;
}

function buildSection0Xml(docs: MemberVariantExportDoc[], mode: ExportMode, titleSuffix: string): string {
  const lines: string[] = [];
  lines.push(para(`회원 변형 문항${titleSuffix}`, { bold: true, fontSize: 26 }));

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const qd = d.question_data ?? {};
    const docType = str(d.type);
    const isEssay = isEssayQuestionType(docType);

    lines.push(para(''));
    lines.push(
      para(
        `${i + 1}. [${exportPlainText(docType)}] (${exportPlainText(str(d.difficulty))}) · ${exportPlainText(str(d.textbook))}`,
        { bold: true, fontSize: 20 },
      ),
    );

    if (isEssay) {
      for (const { label, text } of flattenEssayQuestionData(qd, mode)) {
        const isAnswer = label === '모범 답안';
        const isNote = label === '해설' || label === '정답 어휘';
        lines.push(para(`[${label}]`, { bold: true, fontSize: isNote ? 16 : 18 }));
        for (const line of exportPlainText(text).split(/\n/).filter(Boolean)) {
          lines.push(para(line, { fontSize: isNote ? 16 : 18, color: isAnswer ? 'FF16A34A' : isNote ? 'FF6B7280' : 'FF000000' }));
        }
      }
    } else {
      const f = flattenMemberQuestionData(qd);
      if (f.question) lines.push(para(`발문: ${exportPlainText(f.question)}`, { fontSize: 18 }));
      if (f.paragraph) lines.push(para(exportPlainText(f.paragraph), { fontSize: 18 }));
      if (f.optionsDisplay) {
        for (const line of exportPlainText(f.optionsDisplay).split(/\n/).filter(Boolean)) {
          lines.push(para(line, { fontSize: 18 }));
        }
      }
      if (mode === 'teacher') {
        lines.push(para(`정답: ${exportPlainText(f.answer)}`, { bold: true, fontSize: 18, color: 'FF2563EB' }));
        if (f.explanation) {
          lines.push(para(`해설: ${exportPlainText(f.explanation)}`, { fontSize: 16, color: 'FF6B7280' }));
        }
      }
    }

    if (i < docs.length - 1) lines.push(separator());
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2012/section"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2012/paragraph">
  <hp:subList>
    ${lines.join('\n    ')}
  </hp:subList>
</hs:sec>`;
}

function buildContainerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="Contents/content.hpf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function buildManifestXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<manifest xmlns="http://www.idpf.org/2007/opf">
  <item id="section0" href="../Contents/section0.xml" media-type="application/xml"/>
  <item id="header" href="../Contents/header.xml" media-type="application/xml"/>
</manifest>`;
}

function buildVersionXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ver:version xmlns:ver="http://www.hancom.co.kr/hwpml/2012/version">
  <ver:app major="1" minor="0" micro="0" buildNumber="0"/>
  <ver:doc major="1" minor="0" micro="0"/>
</ver:version>`;
}

function buildContentHpf(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="2.0">
  <opf:metadata>
    <dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">${esc(title)}</dc:title>
  </opf:metadata>
  <opf:manifest>
    <opf:item id="section0" href="section0.xml" media-type="application/xml"/>
    <opf:item id="header" href="header.xml" media-type="application/xml"/>
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="section0"/>
  </opf:spine>
</opf:package>`;
}

function buildHeaderXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2012/head">
  <hh:refList/>
  <hh:compatibleDocument targetProgram="hwpOffice"/>
</hh:head>`;
}

export async function buildMemberVariantHwpxBuffer(
  docs: MemberVariantExportDoc[],
  mode: ExportMode = 'teacher',
): Promise<Buffer> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  const titleSuffix = mode === 'student' ? ' (학생용)' : ' (교사용)';
  const title = `회원 변형 문항${titleSuffix}`;

  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', buildContainerXml());
  zip.file('META-INF/manifest.xml', buildManifestXml());
  zip.file('version.xml', buildVersionXml());
  zip.file('Contents/content.hpf', buildContentHpf(title));
  zip.file('Contents/header.xml', buildHeaderXml());
  zip.file('Contents/section0.xml', buildSection0Xml(docs, mode, titleSuffix));

  const ab = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  return Buffer.from(ab);
}
