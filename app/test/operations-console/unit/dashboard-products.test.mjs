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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeOrg, SCHEMA } from "../../support/fake-org.mjs";
import { productRates, PROD_FLOOR } from "../../../public/operations-console/data/om-core-dashboard.js";
import { FO_DONE } from "../../../public/shared/data/om-reads.js";

const ref = (name, relationshipName, ...referenceTo) => ({ name, relationshipName, referenceTo });
const id18 = (n) => '01t' + String(n).padStart(15, '0');
// An org with Product2.Family, a revenue field on lines and a product lookup on fulfillment order lines.
const FULL = {
  Product2: [{ name: 'Id' }, { name: 'Name' }, { name: 'Family' }],
  OrderItemSummary: [...SCHEMA.OrderItemSummary, { name: 'TotalLineAmount' }],
  FulfillmentOrderLineItem: [...SCHEMA.FulfillmentOrderLineItem, ref('Product2Id', 'Product2', 'Product2')],
};
const ALL = Object.keys({ ...SCHEMA, ...FULL });
const TOP = [
  { p: id18(1), s: 'Trail Runner', qo: 120, qc: 6, qr: 18, amt: 15480 },
  { p: id18(2), s: 'Camp Mug', qo: 40, qc: 1, qr: 0, amt: 720 },
  { p: id18(3), s: 'Rare Item', qo: 2, qc: 2, qr: 2, amt: 90 },
];
// Product-specific queries first; the catch-all answers every other dashboard panel with no rows.
const queries = [
  [/^SELECT COUNT_DISTINCT\(Product2Id\) n, SUM\(QuantityOrdered\) qo.* FROM OrderItemSummary/, [{ n: 3, qo: 162, qc: 9, qr: 20, amt: 16290 }]],
  [/^SELECT Product2\.Family s.* FROM OrderItemSummary/, [{ s: 'Footwear', n: 1, qo: 120, amt: 15480 }, { s: null, n: 2, qo: 42, amt: 810 }]],
  [/^SELECT Product2Id p, Product2\.Name s, .* FROM OrderItemSummary/, TOP],
  [/^SELECT Product2Id p, Product2\.Name s, SUM\(Quantity\) q.* FROM FulfillmentOrderLineItem/, [{ p: id18(1), s: 'Trail Runner', q: 14, f: 9 }]],
  [/^SELECT SUM\(Quantity\) q.* FROM FulfillmentOrderLineItem/, [{ q: 14, n: 1, f: 9 }]],
  [/./, []],
];
const dash = async (org = {}) => {
  const o = fakeOrg({ queries, ...org });
  return { ...o, r: await o.core.route('/api/dashboard?period=mtd') };
};
const prodSoql = (soql) => soql().filter((q) => /Product2/.test(q));

test('product queries filter to product lines in the period and group by product', async () => {
  const { r, soql } = await dash({ schema: FULL, objects: ALL });
  const ois = prodSoql(soql).filter((q) => /FROM OrderItemSummary/.test(q));
  assert.ok(ois.length >= 4);
  for (const q of ois) {
    assert.match(q, /TypeCode = 'Product'/);
    assert.match(q, /OrderSummary\.OrderedDate >= /);
  }
  assert.ok(ois.some((q) => /GROUP BY Product2Id, Product2\.Name ORDER BY SUM\(QuantityOrdered\) DESC/.test(q)));
  assert.ok(ois.some((q) => /ORDER BY SUM\(TotalLineAmount\) DESC LIMIT 10/.test(q)));
  assert.ok(ois.some((q) => /GROUP BY Product2\.Family/.test(q)));
  const foli = soql().filter((q) => /FROM FulfillmentOrderLineItem/.test(q));
  assert.equal(foli.length, 2);
  for (const q of foli) assert.ok(q.includes(`FulfillmentOrder.Status NOT IN ${FO_DONE} AND Quantity > 0 AND TypeCode = 'Product'`), q);
  // No customer fields in any product query.
  for (const q of prodSoql(soql)) assert.doesNotMatch(q, /Account|Email|Billing|DeliverTo|Phone/);

  assert.ok(r.prodTop.ok);
  assert.equal(r.prodTop.data.top[0].key, 'Trail Runner');
  assert.equal(r.prodTop.data.top[0].id, id18(1));
  assert.equal(r.prodTop.data.revenue, 'TotalLineAmount');
  assert.equal(r.prodTotals.data.cur.n, 3);
  assert.deepEqual(r.prodFamily.data.map((x) => x.key), ['Footwear', '(no family)']);
  assert.deepEqual(r.prodDemand.data, { units: 14, products: 1, fos: 9, list: [{ id: id18(1), key: 'Trail Runner', n: 14, fos: 9 }] });
  // The Data map lists the new queries.
  for (const n of ['Products · units and rates', 'Products · revenue', 'Product family mix', 'Open demand by product']) assert.ok(JSON.stringify(r.sources).includes(n), n);
});

test('without Product2.Family or a product lookup on FulfillmentOrderLineItem, those panels are empty, not errors', async () => {
  const { r, soql } = await dash(); // stock schema: no Product2 describe, no Product2 on FOLI, no TotalLineAmount
  assert.deepEqual(r.prodFamily, { ok: true, data: null });
  assert.deepEqual(r.prodDemand, { ok: true, data: null });
  assert.equal(r.prodTop.data.revenue, 'TotalPrice');
  assert.ok(!soql().some((q) => /Product2\.Family|FROM FulfillmentOrderLineItem/.test(q)));
});

test('without FulfillmentOrderLineItem at all, open demand is empty and the rest still renders', async () => {
  const { r } = await dash({ schema: FULL, objects: ALL.filter((o) => o !== 'FulfillmentOrderLineItem') });
  assert.deepEqual(r.prodDemand, { ok: true, data: null });
  assert.ok(r.prodTop.ok && r.prodTop.data.top.length === 3);
  assert.ok(r.prodFamily.ok && r.prodFamily.data.length === 2);
});

test('without product lines on OrderItemSummary, every product panel is empty', async () => {
  const { r } = await dash({ objects: Object.keys(SCHEMA).filter((o) => o !== 'OrderItemSummary') });
  for (const k of ['prodTotals', 'prodTop', 'prodRevenue', 'prodFamily']) assert.deepEqual(r[k], { ok: true, data: null }, k);
});

test('cancel and return rates skip products below the volume floor', async () => {
  const rows = TOP.map((x) => ({ id: x.p, key: x.s, qo: x.qo, qc: x.qc, qr: x.qr }));
  const r = productRates(rows);
  assert.equal(r.floor, PROD_FLOOR); // 1% of 162 units is under the minimum floor
  assert.deepEqual(r.cancelRate.map((x) => x.key), ['Trail Runner', 'Camp Mug']); // Rare Item: 100% but only 2 units
  assert.equal(r.cancelRate[0].n, 6 / 120);
  assert.deepEqual(r.returnRate.map((x) => x.key), ['Trail Runner']); // zero-return products are left out
  // A big catalogue raises the floor to 1% of units.
  const big = productRates([{ id: 'a', key: 'A', qo: 2000, qc: 10, qr: 0 }, { id: 'b', key: 'B', qo: 15, qc: 5, qr: 0 }, { id: 'c', key: 'C', qo: 25, qc: 5, qr: 0 }]);
  assert.equal(big.floor, Math.ceil(2040 * 0.01));
  assert.deepEqual(big.cancelRate.map((x) => x.key), ['C', 'A']);
  // Orgs without QuantityReturned give null, so the panel can say so.
  assert.equal(productRates([{ id: 'a', key: 'A', qo: 10, qc: 1, qr: null }]).returnRate, null);
  // An empty period is an empty list, not a missing field.
  assert.deepEqual(productRates([]).cancelRate, []);
});

test('cancelled products with equal counts keep one order whatever the row order', async () => {
  const rows = [
    { QuantityCanceled: 2, UnitPrice: 10, Product2: { Name: 'Zed' } },
    { QuantityCanceled: 2, UnitPrice: 30, Product2: { Name: 'Mid' } },
    { QuantityCanceled: 2, UnitPrice: 10, Product2: { Name: 'Alpha' } },
    { QuantityCanceled: 5, UnitPrice: 1, Product2: { Name: 'Top' } },
  ];
  const keys = async (list) => (await dash({ queries: [[/^SELECT .*QuantityCanceled.* FROM OrderItemSummary/, list], ...queries] })).r.cancelled.data.products.map((p) => p.key);
  const a = await keys(rows), b = await keys([...rows].reverse());
  assert.deepEqual(a, ['Top', 'Mid', 'Alpha', 'Zed']);
  assert.deepEqual(b, a);
});

test('cancelled products with equal value order the same whichever way the rows arrive', async () => {
  // Zed's lines add to 0.6000000000000001 one way and 0.6 the other; Amp is 0.6. Equal money, equal units: the name decides.
  const list = [['Zed', 1, 0.1], ['Zed', 1, 0.2], ['Zed', 1, 0.3], ['Amp', 1, 0.6], ['Amp', 2, 0]];
  const run = async (order) => {
    const rows = order.map(([n, q, p]) => ({ QuantityCanceled: q, UnitPrice: p, Product2: { Name: n } }));
    const { core } = fakeOrg({ schema: FULL, objects: ALL, queries: [[/^SELECT QuantityCanceled.* FROM OrderItemSummary/, rows], ...queries] });
    return (await core.route('/api/dashboard?period=mtd')).cancelled.data.products.map((p) => p.key);
  };
  assert.deepEqual(await run(list), ['Amp', 'Zed']);
  assert.deepEqual(await run([...list].reverse()), ['Amp', 'Zed']);
});
