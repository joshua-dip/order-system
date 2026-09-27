/**
 * 홈 서비스 카탈로그 — `npm run test:unit`
 * 홈을 목적별로 재배치하면서 기존 메뉴가 빠지지 않았는지, 가격 문구가 가격 상수와 어긋나지 않는지 본다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES, SOLBOOK_SHORTCUT, SERVICE_GROUPS, serviceById } from './service-catalog';
import { VARIANT_PRICE } from './variant-pricing';
import { externalizeListPrice } from './external-variant';
import { ESSAY_WORKBOOK_PRICE_PER_SOURCE } from './essay-workbook-pricing';

/** 개편 전 홈(TextbookSelection)에 있던 모든 입구 */
const FORMER_HOME_HREFS = [
  '/vocabulary-order', '/class-kit/lecture', '/unified',
  '/mockexam', '/textbook', '/gyogwaseo', '/external', '/free',
  '/workbook/mockexam', '/workbook/textbook', '/workbook/gyogwaseo',
  '/order-num', '/analysis', '/essay', '/essay-workbook', '/bundle', '/solbook',
  '/practice', '/qna', '/variant',
];

test('기존 홈 메뉴가 새 카탈로그에 모두 있다', () => {
  const hrefs = new Set<string>([SOLBOOK_SHORTCUT.href]);
  for (const s of SERVICES) {
    hrefs.add(s.href);
    for (const l of s.links ?? []) hrefs.add(l.href);
  }
  for (const h of FORMER_HOME_HREFS) assert.ok(hrefs.has(h), `빠진 메뉴: ${h}`);
});

test('서비스 id 중복 없음 · 모든 서비스가 네 목적 중 하나에 속한다', () => {
  const ids = SERVICES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  const groups = new Set(SERVICE_GROUPS.map((g) => g.id));
  for (const s of SERVICES) assert.ok(groups.has(s.group), s.id);
});

test('모든 카드에 가격·받는 시점·이용 조건이 있다', () => {
  for (const s of SERVICES) {
    assert.ok(s.facts.price.trim(), `${s.id} price`);
    assert.ok(s.facts.delivery.trim(), `${s.id} delivery`);
    assert.ok(s.facts.condition.trim(), `${s.id} condition`);
  }
});

test('가격 문구는 가격 상수에서 온다', () => {
  assert.match(serviceById('mock')!.facts.price, new RegExp(`문항당 ${VARIANT_PRICE.base}원`));
  assert.match(serviceById('mock')!.facts.price, new RegExp(`고난도 ${VARIANT_PRICE.advanced}원`));
  assert.match(serviceById('external')!.facts.price, new RegExp(`문항당 ${externalizeListPrice(VARIANT_PRICE.base)}원`));
  assert.match(serviceById('essay-workbook')!.facts.price, new RegExp(`${ESSAY_WORKBOOK_PRICE_PER_SOURCE}원`));
});

test('서술형 워크북은 즉시 다운로드로 안내하지 않는다 (접수 후 확인하여 PDF 발송)', () => {
  const s = serviceById('essay-workbook')!;
  assert.equal(s.cta, '주문하기');
  assert.ok(!s.badges.includes('instant'));
  assert.match(s.facts.delivery, /확인하여 PDF 발송/);
});

test('무료 PDF 는 주문 제작 구역과 분리돼 있다', () => {
  const free = serviceById('free-variant')!;
  assert.equal(free.group, 'free');
  assert.ok(!free.badges.includes('made-to-order'));
});
