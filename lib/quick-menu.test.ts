import test from 'node:test';
import assert from 'node:assert/strict';
import { QUICK_MENU_ITEMS, QUICK_MENU_MAX, QUICK_MENU_SUGGESTED, quickMenuItem, sanitizeQuickMenu } from './quick-menu';

test('자주 쓰는 메뉴: id 는 겹치지 않고 추천은 모두 실재', () => {
  assert.equal(new Set(QUICK_MENU_ITEMS.map((i) => i.id)).size, QUICK_MENU_ITEMS.length);
  for (const id of QUICK_MENU_SUGGESTED) assert.ok(quickMenuItem(id), id);
});

test('sanitizeQuickMenu: 모르는 id·중복 제거, 최대 개수', () => {
  assert.deepEqual(sanitizeQuickMenu(['guide', 'nope', 'guide', 'study-plan']), ['guide', 'study-plan']);
  assert.equal(sanitizeQuickMenu(QUICK_MENU_ITEMS.map((i) => i.id)).length, QUICK_MENU_MAX);
  assert.deepEqual(sanitizeQuickMenu('x'), []);
});
