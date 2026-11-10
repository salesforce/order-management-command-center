/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// Bundles (om-bundles.js): an order's lines grouped into bundles, and the arithmetic every action shares: how many whole
// bundles an action can take, a bundle's lines for k of it, a discount spread over its priced lines, and the gate's check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundlesOf, bundleIndex, expandBundle, spreadOver, latestDelivery, bundleCheck, BUNDLE_OPS, groupFoLines } from "../../../public/shared/data/om-bundles.js";

const K = 'K00000000000001', T = 'T00000000000001', S = 'S00000000000001', F = 'F00000000000001', G = 'G00000000000001', C = 'C00000000000001', X = 'X00000000000001';
const line = (id, name, partOf, ordered, extra = {}) => ({ id, name, partOf, ordered, qty: ordered, cancelable: ordered, returnable: 0, toFulfill: ordered, toReship: 0, status: 'ORDERED', editable: true,
  lineAmount: 0, adjusted: 0, ...extra });
// The Summit camp kit, 2 of them: $249 each, a tent, a stove and 2 fuel canisters per kit (in the kit's price), one trail guide
// whatever the number of kits, and an add-on camp chair priced on its own.
function kit(over = {}) {
  const lines = [
    line(K, 'Summit camp kit', null, 2, { lineAmount: 498, adjusted: 498 }),
    line(T, 'Trailhead 2 tent', K, 2), line(S, 'Ember stove', K, 2), line(F, 'Fuel canister', K, 4), line(G, 'Trail guide', K, 1),
    line(C, 'Camp chair', K, 2, { lineAmount: 70, adjusted: 70 }),
    line(X, 'Merino tee', null, 1, { lineAmount: 48, adjusted: 48 }),
  ].map((l) => ({ ...l, ...over[l.id] }));
  const rel = (part, extra = {}) => ({ main: K, part, mainRole: 'Bundle', partRole: 'BundleComponent', pricing: 'IncludedInBundlePrice', scale: 'Proportional', ...extra });
  const rels = [rel(T), rel(S), rel(F), rel(G, { scale: 'Constant' }), rel(C, { mainRole: 'AddOn', partRole: 'AddOnComponent', pricing: 'NotIncludedInBundlePrice' })];
  return { lines, rels, byId: new Map(lines.map((l) => [l.id, l])) };
}

test('groups a kit with its parts, main line first', () => {
  const { lines, rels } = kit(), [b, ...rest] = bundlesOf(lines, rels);
  assert.equal(rest.length, 0);
  assert.deepEqual(b.lines, [K, T, S, F, G, C]);
  assert.deepEqual(b.parts.map((p) => p.per), [1, 1, 2, null, 1]);
  assert.deepEqual(b.parts.map((p) => p.included), [true, true, true, true, false]);
  assert.deepEqual(b.priced, [K, C]);
  assert.equal(b.name, 'Summit camp kit');
  assert.equal(bundleIndex([b]).get(F), K);
  assert.equal(bundleIndex([b]).get(X), undefined);
});

test('per comes from ordered quantities', () => {
  const { lines, rels } = kit({ [K]: { qty: 1 }, [T]: { qty: 1 } }); // one kit already cancelled
  assert.equal(bundlesOf(lines, rels)[0].parts.find((p) => p.id === T).per, 1);
});

test('counts whole bundles', () => {
  let { lines, rels } = kit();
  let [b] = bundlesOf(lines, rels);
  assert.equal(b.cancelable, 2);
  assert.equal(b.why.cancelable, null);
  ({ lines, rels } = kit({ [F]: { cancelable: 3 } }));
  [b] = bundlesOf(lines, rels);
  assert.equal(b.cancelable, 1);
  assert.match(b.why.cancelable, /Fuel canister/);
  ({ lines, rels } = kit({ [T]: { cancelable: 0 }, [S]: { cancelable: 2 } }));
  [b] = bundlesOf(lines, rels);
  assert.equal(b.cancelable, 0);
  assert.equal(b.why.cancelable, 'Its Trailhead 2 tent has shipped and its Ember stove hasn’t.');
});

test('expands k bundles; a Constant part goes with the last', () => {
  const { lines, rels, byId } = kit(), [b] = bundlesOf(lines, rels);
  assert.deepEqual(expandBundle(b, byId, 1, 'cancelable'), [{ id: K, quantity: 1 }, { id: T, quantity: 1 }, { id: S, quantity: 1 }, { id: F, quantity: 2 }, { id: C, quantity: 1 }]);
  assert.deepEqual(expandBundle(b, byId, 2, 'cancelable'), [{ id: K, quantity: 2 }, { id: T, quantity: 2 }, { id: S, quantity: 2 }, { id: F, quantity: 4 }, { id: G, quantity: 1 }, { id: C, quantity: 2 }]);
});

test('a non-whole per breaks the bundle', () => {
  const { lines, rels } = kit({ [F]: { ordered: 3, qty: 3, cancelable: 3 } }), [b] = bundlesOf(lines, rels);
  assert.match(b.broken, /whole numbers/);
  assert.deepEqual([b.cancelable, b.returnable, b.toFulfill, b.toReship], [0, 0, 0, 0]);
});

test('nested parts scale from the top-level main', () => {
  const { lines, rels } = kit(), N = 'N00000000000001';
  const more = [...lines, line(N, 'Stove burner', S, 4)];
  const [b] = bundlesOf(more, [...rels, { main: S, part: N, mainRole: 'Bundle', partRole: 'BundleComponent', pricing: 'IncludedInBundlePrice', scale: 'Proportional' }]);
  const n = b.parts.find((p) => p.id === N);
  assert.deepEqual([n.per, n.depth], [2, 2]);
  assert.deepEqual(b.lines, [K, T, S, N, F, G, C]);
});

test('spreads an amount by stored amounts, cents on the largest', () => {
  const { lines, rels, byId } = kit(), [b] = bundlesOf(lines, rels);
  assert.deepEqual(spreadOver(b, byId, 10, 'amount'), [{ id: K, value: 8.77 }, { id: C, value: 1.23 }]);
  assert.deepEqual(spreadOver(b, byId, 10, 'percent'), [{ id: K, value: 10 }, { id: C, value: 10 }]);
});

test('the latest delivery is the bundle’s', () => {
  const d = (at) => ({ deliveredAt: at });
  let { lines, rels, byId } = kit({ [K]: d('2026-10-01T00:00:00Z'), [T]: d('2026-10-03T00:00:00Z'), [S]: d('2026-10-01T00:00:00Z'), [F]: d('2026-10-02T00:00:00Z'), [G]: d('2026-10-01T00:00:00Z'), [C]: d('2026-10-01T00:00:00Z') });
  let m = latestDelivery(bundlesOf(lines, rels), byId);
  assert.deepEqual([K, T, S, F, G, C].map((id) => m.get(id)), Array(6).fill('2026-10-03T00:00:00Z'));
  assert.equal(m.has(X), false);
  ({ lines, rels, byId } = kit({ [K]: d('2026-10-01T00:00:00Z'), [T]: d(null) }));
  m = latestDelivery(bundlesOf(lines, rels), byId);
  assert.equal(m.get(K), null);
});

test('4,000 lines group in under 1 s', () => {
  const lines = [], rels = [];
  for (let i = 0; i < 1000; i++) {
    const m = `M${String(i).padStart(14, '0')}`;
    lines.push(line(m, `Kit ${i}`, null, 2, { lineAmount: 10, adjusted: 10 }));
    for (const p of ['a', 'b', 'c']) { const id = `${p}${String(i).padStart(14, '0')}`; lines.push(line(id, `Part ${p}`, m, 2)); rels.push({ main: m, part: id }); }
  }
  const t0 = performance.now(), bs = bundlesOf(lines, rels);
  assert.ok(performance.now() - t0 < 1000, `took ${Math.round(performance.now() - t0)} ms`);
  assert.equal(bs.length, 1000);
});

test('a line whose main isn’t on the order stays a line', () => {
  const lines = [line(T, 'Trailhead 2 tent', 'Q00000000000001', 1), line(X, 'Merino tee', null, 1)];
  assert.deepEqual(bundlesOf(lines, []), []);
});

test('a part with no relationship row is Proportional and included', () => {
  const { lines } = kit(), [b] = bundlesOf(lines, []);
  assert.deepEqual(b.parts.map((p) => [p.scale, p.included, p.role]).at(0), ['Proportional', true, 'BundleComponent']);
  assert.equal(b.role, 'Bundle');
});

// ---------- the write gate's check ----------
// The facts the gate reads for an order (bundleFacts in om-core-facts.js): its bundles, each line's quantity and amount, and which
// order line each fulfillment order line and return order line is for. Record Ids are mapped through these, never the body's.
function facts() {
  const { lines, rels } = kit(), ids = [K, T, S, F, G, C];
  return { bundles: bundlesOf(lines, rels), lines: Object.fromEntries(lines.map((l) => [l.id, { qty: l.qty, amount: l.adjusted }])),
    foLines: Object.fromEntries(ids.map((id, i) => [`FOL${i}`, id])), returnLines: Object.fromEntries(ids.map((id, i) => [`ROL${i}`, id])) };
}
const ls = (o) => Object.entries(o).map(([id, quantity]) => ({ id, quantity }));
const ONE_KIT = { [K]: 1, [T]: 1, [S]: 1, [F]: 2, [C]: 1 };

test('the gate passes a whole bundle and refuses a split one', () => {
  const fx = facts();
  assert.equal(bundleCheck('cancel', fx, { lines: ls(ONE_KIT) }), null);
  assert.equal(bundleCheck('cancel', fx, { lines: ls({ ...ONE_KIT, [X]: 1 }) }), null);
  assert.match(bundleCheck('cancel', fx, { lines: ls({ [K]: 1, [T]: 1 }) }), /stove goes in 1/i);
  assert.match(bundleCheck('cancel', fx, { lines: ls({ [T]: 1 }) }), /Summit camp kit.*main line/i);
  for (const op of ['return', 'rma', 'exchange', 'focreate', 'reship']) assert.match(bundleCheck(op, fx, { lines: ls({ [K]: 1 }) }) || '', /goes in/, op);
  assert.equal(bundleCheck('cancel', fx, { lines: ls({ [X]: 1 }) }), null);
  assert.equal(bundleCheck('rounding', fx, { lines: ls({ [T]: 1 }) }), null);
  assert.ok(BUNDLE_OPS.has('roexpected') && !BUNDLE_OPS.has('rounding'));
});

test('Fulfil and Move send a bundle to one location; free lines may each go their own way', () => {
  const fx = facts(), at = (o, where = {}) => ls(o).map((l) => (where[l.id] ? { ...l, locationId: where[l.id] } : l));
  const fo = (o, where = {}) => at(o, where).map((l) => ({ ...l, id: `FOL${[K, T, S, F, G, C].indexOf(l.id)}`, orderItemSummaryId: l.id }));
  assert.equal(bundleCheck('focreate', fx, { locationId: 'LOC1', lines: at(ONE_KIT) }), null);
  assert.equal(bundleCheck('focreate', fx, { locationId: 'LOC1', lines: at({ ...ONE_KIT, [X]: 1 }, { [X]: 'LOC2' }) }), null, 'a line outside the bundle goes elsewhere');
  assert.equal(bundleCheck('focreate', fx, { locationId: 'LOC1', lines: at(ONE_KIT, Object.fromEntries(Object.keys(ONE_KIT).map((id) => [id, 'LOC2']))) }), null, 'the whole bundle elsewhere');
  assert.match(bundleCheck('focreate', fx, { locationId: 'LOC1', lines: at(ONE_KIT, { [T]: 'LOC2' }) }), /Summit camp kit: all of it ships from one location/);
  assert.match(bundleCheck('focreate', fx, { lines: at(ONE_KIT, { [K]: 'LOC1' }) }), /one location/, 'a part with no location isn’t with its main line’s');
  assert.equal(bundleCheck('fomove', fx, { locationId: 'LOC1', lines: fo(ONE_KIT) }), null);
  assert.match(bundleCheck('fomove', fx, { locationId: 'LOC1', lines: fo(ONE_KIT, { [S]: 'LOC2' }) }), /one location/);
});

test('a Constant part may go with the bundle, never more than it has', () => {
  const fx = facts();
  assert.equal(bundleCheck('cancel', fx, { lines: ls({ [K]: 2, [T]: 2, [S]: 2, [F]: 4, [G]: 1, [C]: 2 }) }), null);
  assert.match(bundleCheck('cancel', fx, { lines: ls({ ...ONE_KIT, [G]: 2 }) }), /guide/i);
});

test('fulfillment and return lines are checked by the order’s own records, never the body’s', () => {
  const fx = facts(), fo = (o) => Object.entries(o).map(([id, quantity]) => ({ id: `FOL${[K, T, S, F, G, C].indexOf(id)}`, orderItemSummaryId: id, quantity }));
  assert.equal(bundleCheck('focancel', fx, { lines: fo(ONE_KIT) }), null);
  assert.match(bundleCheck('fomove', fx, { lines: fo({ [K]: 1, [T]: 1 }) }), /stove goes in 1/i);
  assert.match(bundleCheck('focancel', fx, { lines: [{ id: 'FOL9', orderItemSummaryId: K, quantity: 1 }] }), /isn.t this order.s/);
  // A line given with another order line than its own: the handlers act on the order line, so it's refused (the tee's
  // fulfillment line sent with the tent's order line would cancel the tent alone).
  const crafted = { ...fx, foLines: { ...fx.foLines, FOLX: X }, returnLines: { ...fx.returnLines, ROLX: X } };
  assert.match(bundleCheck('focancel', crafted, { lines: [{ id: 'FOLX', orderItemSummaryId: T, quantity: 1 }] }), /isn.t for that order line/);
  assert.match(bundleCheck('fomove', crafted, { lines: [{ id: 'FOLX', orderItemSummaryId: T, quantity: 1 }] }), /isn.t for that order line/);
  assert.match(bundleCheck('receive', crafted, { lines: [{ id: 'ROLX', orderItemSummaryId: T, received: 1 }] }), /isn.t for that order line/);
  const ro = (o, rej = {}) => Object.entries(o).map(([id, received]) => ({ id: `ROL${[K, T, S, F, G, C].indexOf(id)}`, orderItemSummaryId: id, received, rejected: rej[id] || 0 }));
  assert.equal(bundleCheck('receive', fx, { lines: ro(ONE_KIT) }), null);
  assert.equal(bundleCheck('receive', fx, { lines: ro(ONE_KIT, ONE_KIT) }), null);
  assert.match(bundleCheck('receive', fx, { lines: ro(ONE_KIT, { [S]: 1 }) }), /goes in/);
  const exp = (o) => Object.entries(o).map(([id, down]) => ({ id: `ROL${[K, T, S, F, G, C].indexOf(id)}`, from: 4, quantity: 4 - down }));
  assert.equal(bundleCheck('roexpected', fx, { lines: exp(ONE_KIT) }), null);
  assert.match(bundleCheck('roexpected', fx, { lines: exp({ [T]: 1 }) }), /main line/);
  // What a line expects is the return order's, not the body's: the tent really expects 6, so taking it to 3 lowers it by 3.
  assert.match(bundleCheck('roexpected', { ...fx, returnExpected: { ROL1: 6 } }, { lines: exp(ONE_KIT) }), /tent goes in 1/i);
});

test('a discount or a credit on a bundle covers every priced line', () => {
  const fx = facts(), v = (o) => Object.entries(o).map(([id, value]) => ({ id, value }));
  assert.match(bundleCheck('adjust', fx, { kind: 'amount', lines: v({ [K]: 10 }) }), /chair/);
  assert.match(bundleCheck('adjust', fx, { kind: 'percent', lines: v({ [K]: 10, [C]: 5 }) }), /same percent/);
  assert.equal(bundleCheck('adjust', fx, { kind: 'percent', lines: v({ [K]: 10, [C]: 10 }) }), null);
  assert.equal(bundleCheck('adjust', fx, { kind: 'amount', lines: v({ [K]: 8.77, [C]: 1.23 }) }), null);
  assert.match(bundleCheck('adjust', fx, { kind: 'amount', lines: v({ [K]: 1, [C]: 9 }) }), /amounts/);
  assert.match(bundleCheck('adjust', fx, { kind: 'amount', lines: v({ [K]: 8.77, [C]: 1.23, [T]: 1 }) }), /no price/);
  assert.equal(bundleCheck('credit', fx, { lines: [{ id: K, room: 498 }, { id: C, room: 70 }] }), null);
  assert.match(bundleCheck('credit', fx, { lines: [{ id: K, room: 498 }] }), /chair/);
});

test('an edit changes a bundle’s quantity whole; a price alone is fine', () => {
  const fx = facts(), q = (o) => Object.entries(o).map(([id, quantity]) => ({ id, quantity, unitPrice: 0 }));
  assert.match(bundleCheck('change', fx, { lines: q({ [K]: 1 }) }), /goes in/);
  assert.equal(bundleCheck('change', fx, { lines: q({ [K]: 1, [T]: 1, [S]: 1, [F]: 2, [C]: 1 }) }), null);
  assert.equal(bundleCheck('change', fx, { lines: [{ id: K, quantity: 2, unitPrice: 239 }] }), null);
  assert.match(bundleCheck('change', fx, { lines: q({ [K]: 0, [T]: 0, [S]: 0, [F]: 0, [C]: 0 }) }), /guide/i);
  assert.equal(bundleCheck('change', fx, { lines: q({ [K]: 0, [T]: 0, [S]: 0, [F]: 0, [G]: 0, [C]: 0 }) }), null);
  assert.equal(bundleCheck('swap', fx, { lines: ls(ONE_KIT) }), null);
  assert.match(bundleCheck('swap', fx, { line: { id: T, quantity: 1, from: 2 } }), /main line/);
});

test('a fulfillment order’s lines group into whole bundles; a split one is told', () => {
  const { lines, rels } = kit(), bs = bundlesOf(lines, rels), qty = { [K]: 2, [T]: 2, [S]: 2, [F]: 4, [G]: 1, [C]: 2, [X]: 1 };
  const fl = (ids) => ids.map((id, i) => ({ id: `FOL${i}`, orderItemSummaryId: id, qty: qty[id] }));
  let g = groupFoLines(fl([K, T, S, F, G, C, X]), bs);
  assert.deepEqual(g.units, [{ bundleId: K, lines: ['FOL0', 'FOL1', 'FOL2', 'FOL3', 'FOL4', 'FOL5'], units: 2, split: false, why: null }]);
  assert.deepEqual(g.free, ['FOL6']);
  g = groupFoLines(fl([T, S, F]), bs);
  assert.deepEqual([g.units[0].split, g.units[0].units, g.units[0].why], [true, 0, 'This bundle is split across fulfillment orders: change it from the order.']);
});

// Four or more priced lines (a set whose parts carry the price): the page's own spread puts the leftover cents on the largest
// line, which can be more than a cent from that line's pro-rata share. The gate checks against the same spread.
test('the gate takes the page’s own amount spread, however many priced lines', () => {
  const amounts = [108.13, 14.88, 63.68, 239.60], ids = [K, T, S, F];
  const lines = ids.map((id, i) => line(id, `Line ${i}`, i ? K : null, 1, { lineAmount: amounts[i], adjusted: amounts[i] }));
  const rels = ids.slice(1).map((part) => ({ main: K, part, mainRole: 'Set', partRole: 'SetComponent', pricing: 'NotIncludedInBundlePrice', scale: 'Proportional' }));
  const [b] = bundlesOf(lines, rels), byId = new Map(lines.map((l) => [l.id, l]));
  const fx = { bundles: [b], lines: Object.fromEntries(lines.map((l) => [l.id, { qty: 1, amount: l.adjusted }])), foLines: {}, returnLines: {} };
  for (let cents = 1; cents <= 12000; cents += 37) {
    const spread = spreadOver(b, byId, cents / 100, 'amount');
    assert.equal(bundleCheck('adjust', fx, { kind: 'amount', lines: spread }), null, `$${cents / 100}: ${JSON.stringify(spread)}`);
  }
  assert.match(bundleCheck('adjust', fx, { kind: 'amount', lines: [{ id: K, value: 20 }, { id: T, value: 9.1 }, { id: S, value: 10 }, { id: F, value: 10 }] }), /amounts/);
});

// Edit's new discounts and tax lines: never on a bundle's unpriced line, and a bundle with several priced lines takes its
// discount through Adjust price, which shares it over them.
test('an edit adds no discount or tax to part of a bundle', () => {
  const fx = facts(), add = (key, lineId) => ({ lines: [], [key]: [{ lineId, name: 'Goodwill', amount: 5 }] });
  assert.match(bundleCheck('change', fx, add('newAdjustments', T)), /tent has no price to discount/i);
  assert.match(bundleCheck('change', fx, add('newAdjustments', K)), /Adjust price/);
  assert.equal(bundleCheck('change', fx, add('newAdjustments', X)), null);
  assert.match(bundleCheck('change', fx, add('newTaxes', T)), /tent has no price to tax/i);
  assert.equal(bundleCheck('change', fx, add('newTaxes', C)), null);
});
