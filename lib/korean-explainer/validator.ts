/**
 * 국어 해설지 입력 검증 — save / CLI dry-run 공용.
 *
 * 가벼운 런타임 검증. TS 타입과 중복되는 부분도 외부 입력(JSON) 대비 한 번 더 본다.
 * 반환: { ok: true } | { ok: false; errors: string[] }
 */

import {
  ALL_BLOCK_TYPES,
  Block,
  BlockType,
  KoreanExplanation,
} from './types';

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export function validateKoreanExplanation(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(input)) {
    return { ok: false, errors: ['해설지 객체가 아닙니다.'] };
  }
  const doc = input as Record<string, unknown>;

  for (const key of ['exam_title', 'set_range', 'genre', 'work_title'] as const) {
    if (typeof doc[key] !== 'string' || !(doc[key] as string).trim()) {
      errors.push(`${key} 가 비어 있습니다.`);
    }
  }
  if (doc.show_subtitle !== undefined && typeof doc.show_subtitle !== 'boolean') {
    errors.push('show_subtitle 은 boolean 이어야 합니다.');
  }

  if (!Array.isArray(doc.blocks)) {
    errors.push('blocks 배열이 필요합니다.');
    return { ok: false, errors };
  }

  doc.blocks.forEach((b, i) => {
    const prefix = `blocks[${i}]`;
    if (!isObject(b)) {
      errors.push(`${prefix}: 객체가 아닙니다.`);
      return;
    }
    const type = (b as { type?: unknown }).type;
    if (typeof type !== 'string' || !ALL_BLOCK_TYPES.includes(type as BlockType)) {
      errors.push(`${prefix}.type 미지원: ${String(type)}`);
      return;
    }
    const data = (b as { data?: unknown }).data;
    if (!isObject(data)) {
      errors.push(`${prefix}.data 가 객체가 아닙니다.`);
      return;
    }
    validateBlock(type as BlockType, data as Record<string, unknown>, prefix, errors);
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateBlock(type: BlockType, data: Record<string, unknown>, prefix: string, errors: string[]): void {
  switch (type) {
    case 'cover':
      reqStr(data, ['exam_title', 'set_range', 'genre', 'work_title'], prefix, errors);
      break;
    case 'section_header':
      reqStr(data, ['tag', 'title'], prefix, errors);
      break;
    case 'info_box':
      reqStr(data, ['heading'], prefix, errors);
      reqArr(data, 'rows', prefix, errors, (row, i) => {
        if (!isObject(row)) return [`${prefix}.rows[${i}] 객체 아님`];
        const out: string[] = [];
        if (typeof (row as Record<string, unknown>).label !== 'string') out.push(`${prefix}.rows[${i}].label 누락`);
        if (typeof (row as Record<string, unknown>).value_html !== 'string') out.push(`${prefix}.rows[${i}].value_html 누락`);
        return out;
      });
      break;
    case 'paragraph_table': {
      const cols = data.columns;
      const rows = data.rows;
      if (!Array.isArray(cols) || cols.some(c => typeof c !== 'string')) {
        errors.push(`${prefix}.columns 가 문자열 배열이 아닙니다.`);
        return;
      }
      if (!Array.isArray(rows)) {
        errors.push(`${prefix}.rows 가 배열이 아닙니다.`);
        return;
      }
      rows.forEach((r, i) => {
        if (!isObject(r) || !Array.isArray((r as Record<string, unknown>).cells)) {
          errors.push(`${prefix}.rows[${i}] 구조 오류`);
          return;
        }
        const cells = (r as { cells: unknown[] }).cells;
        if (cells.length !== cols.length) errors.push(`${prefix}.rows[${i}].cells (${cells.length}) ≠ columns (${cols.length})`);
        if (cells.some(c => typeof c !== 'string')) errors.push(`${prefix}.rows[${i}].cells 는 문자열 배열`);
      });
      break;
    }
    case 'timeline':
      reqArr(data, 'items', prefix, errors, (it, i) => {
        const out: string[] = [];
        if (!isObject(it)) return [`${prefix}.items[${i}] 객체 아님`];
        if (typeof (it as Record<string, unknown>).time !== 'string') out.push(`${prefix}.items[${i}].time 누락`);
        if (typeof (it as Record<string, unknown>).content_html !== 'string') out.push(`${prefix}.items[${i}].content_html 누락`);
        return out;
      });
      break;
    case 'character_grid':
      if (data.columns !== 2 && data.columns !== 3) errors.push(`${prefix}.columns 는 2 또는 3`);
      reqArr(data, 'cards', prefix, errors, (c, i) => {
        const out: string[] = [];
        if (!isObject(c)) return [`${prefix}.cards[${i}] 객체 아님`];
        const card = c as Record<string, unknown>;
        if (typeof card.name !== 'string') out.push(`${prefix}.cards[${i}].name`);
        if (typeof card.role !== 'string') out.push(`${prefix}.cards[${i}].role`);
        if (typeof card.desc_html !== 'string') out.push(`${prefix}.cards[${i}].desc_html`);
        return out;
      });
      break;
    case 'compare_2col': {
      const left = data.left;
      const right = data.right;
      if (!isObject(left) || !isObject(right)) {
        errors.push(`${prefix}.left/right 객체 필요`);
        return;
      }
      const li = (left as { items_html?: unknown[] }).items_html;
      const ri = (right as { items_html?: unknown[] }).items_html;
      if (!Array.isArray(li) || !Array.isArray(ri)) errors.push(`${prefix}.left.items_html / right.items_html 배열 필요`);
      if (data.left_color !== 'navy' && data.left_color !== 'green') errors.push(`${prefix}.left_color: navy|green`);
      if (data.right_color !== 'red' && data.right_color !== 'navy') errors.push(`${prefix}.right_color: red|navy`);
      break;
    }
    case 'concept_grid':
      if (data.columns !== 2 && data.columns !== 3) errors.push(`${prefix}.columns 는 2 또는 3`);
      reqArr(data, 'cards', prefix, errors, (c, i) => {
        const out: string[] = [];
        if (!isObject(c)) return [`${prefix}.cards[${i}] 객체 아님`];
        const card = c as Record<string, unknown>;
        if (typeof card.name !== 'string') out.push(`${prefix}.cards[${i}].name`);
        if (typeof card.desc_html !== 'string') out.push(`${prefix}.cards[${i}].desc_html`);
        return out;
      });
      break;
    case 'process_diagram':
      reqArr(data, 'nodes', prefix, errors, (n, i) => {
        const out: string[] = [];
        if (!isObject(n)) return [`${prefix}.nodes[${i}] 객체 아님`];
        const node = n as Record<string, unknown>;
        if (typeof node.label !== 'string') out.push(`${prefix}.nodes[${i}].label`);
        if (typeof node.body_html !== 'string') out.push(`${prefix}.nodes[${i}].body_html`);
        if (node.variant !== undefined && node.variant !== '' && node.variant !== 'light' && node.variant !== 'dark') out.push(`${prefix}.nodes[${i}].variant`);
        return out;
      });
      break;
    case 'emotion_flow': {
      const stages = data.stages;
      const labels = data.arrow_labels;
      if (!Array.isArray(stages)) { errors.push(`${prefix}.stages 배열 필요`); return; }
      if (!Array.isArray(labels)) { errors.push(`${prefix}.arrow_labels 배열 필요`); return; }
      if (labels.length !== Math.max(0, stages.length - 1)) {
        errors.push(`${prefix}.arrow_labels (${labels.length}) ≠ stages.length-1 (${stages.length - 1})`);
      }
      stages.forEach((s, i) => {
        if (!isObject(s)) { errors.push(`${prefix}.stages[${i}] 객체 아님`); return; }
        const stage = s as Record<string, unknown>;
        if (typeof stage.label !== 'string') errors.push(`${prefix}.stages[${i}].label`);
        if (typeof stage.body_html !== 'string') errors.push(`${prefix}.stages[${i}].body_html`);
        if (stage.mood !== 'negative' && stage.mood !== 'trigger' && stage.mood !== 'positive') errors.push(`${prefix}.stages[${i}].mood`);
      });
      break;
    }
    case 'sijo_box':
      reqArr(data, 'entries', prefix, errors, (e, i) => {
        const out: string[] = [];
        if (!isObject(e)) return [`${prefix}.entries[${i}] 객체 아님`];
        const ent = e as Record<string, unknown>;
        if (ent.num === undefined) out.push(`${prefix}.entries[${i}].num`);
        if (typeof ent.original !== 'string') out.push(`${prefix}.entries[${i}].original`);
        if (typeof ent.modern_html !== 'string') out.push(`${prefix}.entries[${i}].modern_html`);
        return out;
      });
      break;
    case 'gist_box':
      reqStr(data, ['label'], prefix, errors);
      if (typeof data.body_html !== 'string') errors.push(`${prefix}.body_html`);
      break;
    case 'question': {
      const num = data.num;
      if (typeof num !== 'number' || !Number.isFinite(num)) errors.push(`${prefix}.num 숫자 아님`);
      if (typeof data.answer !== 'string' || !/^[①②③④⑤]$/.test(data.answer as string)) {
        errors.push(`${prefix}.answer ①~⑤ 중 1자`);
      }
      if (typeof data.points !== 'number') errors.push(`${prefix}.points 숫자 필요`);
      if (typeof data.intent !== 'string') errors.push(`${prefix}.intent 누락`);
      if (typeof data.prompt_html !== 'string') errors.push(`${prefix}.prompt_html 누락`);
      const choices = data.choices;
      if (!Array.isArray(choices)) { errors.push(`${prefix}.choices 배열 필요`); break; }
      const ns = new Set<string>();
      choices.forEach((c, i) => {
        if (!isObject(c)) { errors.push(`${prefix}.choices[${i}] 객체 아님`); return; }
        const ch = c as Record<string, unknown>;
        if (typeof ch.n !== 'string') errors.push(`${prefix}.choices[${i}].n`);
        else ns.add(ch.n as string);
        if (ch.judge !== 'O' && ch.judge !== 'X') errors.push(`${prefix}.choices[${i}].judge: O|X`);
        if (typeof ch.text_html !== 'string') errors.push(`${prefix}.choices[${i}].text_html`);
      });
      const correctN = data.correct_n;
      if (typeof correctN !== 'string' || !ns.has(correctN)) {
        errors.push(`${prefix}.correct_n (${String(correctN)}) 가 choices[*].n 에 없음`);
      }
      // answer 와 correct_n 일치 권장 (경고가 아니라 강제)
      if (typeof data.answer === 'string' && typeof correctN === 'string' && data.answer !== correctN) {
        errors.push(`${prefix}.answer (${data.answer}) ≠ correct_n (${correctN})`);
      }
      if (data.evidences !== undefined && !Array.isArray(data.evidences)) errors.push(`${prefix}.evidences 배열`);
      break;
    }
  }
}

function reqStr(data: Record<string, unknown>, keys: string[], prefix: string, errors: string[]): void {
  for (const k of keys) {
    if (typeof data[k] !== 'string' || !(data[k] as string).trim()) {
      errors.push(`${prefix}.${k} 가 비어 있습니다.`);
    }
  }
}

function reqArr(
  data: Record<string, unknown>,
  key: string,
  prefix: string,
  errors: string[],
  itemValidator: (item: unknown, i: number) => string[],
): void {
  const arr = data[key];
  if (!Array.isArray(arr)) {
    errors.push(`${prefix}.${key} 배열 필요`);
    return;
  }
  arr.forEach((item, i) => {
    errors.push(...itemValidator(item, i));
  });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 외부 입력(JSON 파싱 후)을 KoreanExplanation 으로 좁힌다. */
export function asValidatedExplanation(input: unknown): { doc: KoreanExplanation; errors: null } | { doc: null; errors: string[] } {
  const r = validateKoreanExplanation(input);
  if (!r.ok) return { doc: null, errors: r.errors };
  return { doc: input as KoreanExplanation, errors: null };
}
