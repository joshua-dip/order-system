#!/usr/bin/env tsx
/**
 * 국어 해설지 시각 회귀 — sample_set_22-25.json → 단독 HTML 파일.
 *
 * 사용: npx tsx scripts/cc-korean-explain-render-sample.ts [input.json] [output.html]
 *   기본 입력: /Users/goshua/Downloads/files 4/sample_set_22-25.json
 *   기본 출력: public/__korean-sample.html (dev 서버에서 /__korean-sample.html 로 열림)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Block, KoreanExplanation } from '../lib/korean-explainer/types';
import { renderStandaloneDocument } from '../lib/korean-explainer/render';
import { getKoreanExplainerCss } from '../lib/korean-explainer/css';

const DEFAULT_INPUT = '/Users/goshua/Downloads/files 4/sample_set_22-25.json';
const DEFAULT_OUTPUT = resolve(process.cwd(), 'public/__korean-sample.html');

function main() {
  const inputPath = process.argv[2] ?? DEFAULT_INPUT;
  const outputPath = process.argv[3] ?? DEFAULT_OUTPUT;

  const raw = readFileSync(inputPath, 'utf8');
  const sample = JSON.parse(raw) as {
    exam_title: string;
    set_range: string;
    genre: string;
    work_title: string;
    show_subtitle?: boolean;
    blocks: Block[];
  };

  const doc: KoreanExplanation = {
    exam_title: sample.exam_title,
    set_range: sample.set_range,
    genre: sample.genre,
    work_title: sample.work_title,
    show_subtitle: sample.show_subtitle,
    blocks: sample.blocks,
  };

  const { stylesCss, printFixCss } = getKoreanExplainerCss();
  const html = renderStandaloneDocument(doc, { stylesCss, printFixCss });

  writeFileSync(outputPath, html, 'utf8');
  console.log(`✓ rendered ${doc.blocks.length} blocks → ${outputPath}`);
  console.log(`  open: http://localhost:3000/${outputPath.split('/public/')[1] ?? '__korean-sample.html'}`);
}

main();
