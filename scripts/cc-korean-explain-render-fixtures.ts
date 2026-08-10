#!/usr/bin/env tsx
/**
 * 국어 해설지 시각 회귀 — fixtures/ 안의 모든 JSON 을 standalone HTML 로 변환.
 *
 * 사용: npx tsx scripts/cc-korean-explain-render-fixtures.ts
 *   입력: scripts/fixtures/korean-explain/*.json (save 페이로드 포맷)
 *   출력: public/__korean-regression/<basename>.html
 *
 * dev 서버에서 /__korean-regression/<basename>.html 로 열어 시각 비교.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';
import type { Block, KoreanExplanation } from '../lib/korean-explainer/types';
import { renderStandaloneDocument } from '../lib/korean-explainer/render';
import { getKoreanExplainerCss } from '../lib/korean-explainer/css';
import { validateKoreanExplanation } from '../lib/korean-explainer/validator';

const FIXTURES_DIR = resolve(process.cwd(), 'scripts/fixtures/korean-explain');
const OUT_DIR = resolve(process.cwd(), 'public/__korean-regression');

interface SavePayload {
  textbook: string;
  sourceKey: string;
  setRange: string;
  genre: string;
  workTitle: string;
  examTitle: string;
  showSubtitle?: boolean;
  blocks: Block[];
}

function toDoc(p: SavePayload): KoreanExplanation {
  return {
    exam_title: p.examTitle,
    set_range: p.setRange,
    genre: p.genre,
    work_title: p.workTitle,
    show_subtitle: p.showSubtitle,
    blocks: p.blocks,
  };
}

function main() {
  if (!existsSync(FIXTURES_DIR)) {
    console.error(`fixtures dir not found: ${FIXTURES_DIR}`);
    process.exit(1);
  }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const { stylesCss, printFixCss } = getKoreanExplainerCss();
  const files = readdirSync(FIXTURES_DIR).filter(f => extname(f) === '.json').sort();

  const summary: Array<{ name: string; ok: boolean; blocks?: number; errors?: string[]; outPath?: string }> = [];

  for (const f of files) {
    const inPath = join(FIXTURES_DIR, f);
    const raw = JSON.parse(readFileSync(inPath, 'utf8')) as SavePayload;
    const doc = toDoc(raw);
    const v = validateKoreanExplanation(doc);
    if (!v.ok) {
      summary.push({ name: f, ok: false, errors: v.errors });
      continue;
    }
    const html = renderStandaloneDocument(doc, { stylesCss, printFixCss });
    const outName = basename(f, '.json') + '.html';
    const outPath = join(OUT_DIR, outName);
    writeFileSync(outPath, html, 'utf8');
    summary.push({ name: f, ok: true, blocks: doc.blocks.length, outPath: `/__korean-regression/${outName}` });
  }

  console.log('━━━ 국어 해설지 회귀 렌더 ━━━');
  for (const s of summary) {
    if (s.ok) {
      console.log(`  ✓ ${s.name} — ${s.blocks} blocks → http://localhost:3000${s.outPath}`);
    } else {
      console.log(`  ✗ ${s.name}`);
      for (const e of s.errors ?? []) console.log(`      · ${e}`);
    }
  }
  const passed = summary.filter(s => s.ok).length;
  console.log(`\n총 ${summary.length}건 · 통과 ${passed} · 실패 ${summary.length - passed}`);
  process.exit(passed === summary.length ? 0 : 2);
}

main();
