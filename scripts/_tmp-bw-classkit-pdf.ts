import { loadCliEnv } from './_cli-env';
loadCliEnv(process.cwd());
import fs from 'node:fs';
import path from 'node:path';
import { buildLectureMaterialHtml } from '@/lib/lecture-material-html';
import { buildLessonMaterialHtml } from '@/lib/lesson-material-html';
import { renderHtmlToPdf } from '@/lib/chromium-pdf';
import { loadKitPassagesBySourceKeys } from '@/lib/workbook-kit/load-passages';

const OUT = path.join(process.env.HOME || '.', 'Downloads', 'BW-20260921-001');
const TEXTBOOK = '리더스뱅크 Level 6(2019)';
const KEYS = [
  'Unit 07 19번',
  'Unit 07 20번',
  'Unit 07 21번',
  'Unit 08 22번',
  'Unit 08 23번',
  'Unit 08 24번',
];

async function main() {
  const passages = await loadKitPassagesBySourceKeys(TEXTBOOK, KEYS);
  const lectureParts: string[] = [];
  const lineParts: string[] = [];
  const writeEnParts: string[] = [];
  const writeKoParts: string[] = [];

  for (const p of passages) {
    const pairs = p.sentencesEn.map((en, i) => ({
      idx: i,
      en,
      ko: p.sentencesKo[i] ?? '',
    }));
    lectureParts.push(
      buildLectureMaterialHtml({
        title: TEXTBOOK,
        chapter: p.chapter,
        number: p.number.replace(/번$/, ''),
        sentences: p.sentencesEn.map((text, idx) => ({ idx, text })),
        kicker: '강의용자료',
      }),
    );
    lineParts.push(
      buildLessonMaterialHtml({
        title: TEXTBOOK,
        chapter: p.chapter,
        number: p.number.replace(/번$/, ''),
        mode: 'lineByLine',
        sentences: pairs,
        kicker: '한줄해석',
      }),
    );
    writeEnParts.push(
      buildLessonMaterialHtml({
        title: TEXTBOOK,
        chapter: p.chapter,
        number: p.number.replace(/번$/, ''),
        mode: 'writeEn',
        sentences: pairs,
        kicker: '영작하기',
      }),
    );
    writeKoParts.push(
      buildLessonMaterialHtml({
        title: TEXTBOOK,
        chapter: p.chapter,
        number: p.number.replace(/번$/, ''),
        mode: 'writeKo',
        sentences: pairs,
        kicker: '해석쓰기',
      }),
    );
  }

  console.log('sample lecture len', lectureParts[0]?.length);
  console.log('sample line len', lineParts[0]?.length);

  /* 지문별 PDF zip — 합본 래핑이 깨질 수 있어 개별 HTML→PDF */
  const { renderHtmlEntriesToZip } = await import('@/lib/chromium-pdf');
  const margin = { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' };

  const lectureZip = await renderHtmlEntriesToZip(
    lectureParts.map((html, i) => ({
      fileName: `강의용/${passages[i].sourceKey}.pdf`,
      html,
    })),
    { margin },
  );
  fs.writeFileSync(path.join(OUT, '강의용자료.zip'), lectureZip);
  console.log('강의용자료.zip', lectureZip.length);

  const packs: [string, string[]][] = [
    ['한줄해석.zip', lineParts],
    ['영작하기.zip', writeEnParts],
    ['해석쓰기.zip', writeKoParts],
  ];
  for (const [name, parts] of packs) {
    const zip = await renderHtmlEntriesToZip(
      parts.map((html, i) => ({
        fileName: `${name.replace('.zip', '')}/${passages[i].sourceKey}.pdf`,
        html,
      })),
      { margin },
    );
    fs.writeFileSync(path.join(OUT, name), zip);
    console.log(name, zip.length);
  }

  /* 합본 PDF도 하나씩 */
  const oneLecture = await renderHtmlToPdf(lectureParts[0], { margin });
  fs.writeFileSync(path.join(OUT, '강의용_샘플_Unit07_19.pdf'), oneLecture);
  console.log('sample pdf', oneLecture.length);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
