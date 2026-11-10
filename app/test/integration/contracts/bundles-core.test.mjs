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
// Bundles read with an order in the console's read model: the order drawer (/api/order/:id) gets each line's bundle link
// (MainOrderItemSummaryId) so it can list a bundle's parts under it (console-kit.js drawerItems), and the Service Console view's
// customer (/api/service/customer/:id) names a bundle once, by its main line. An org without the field reads as it always has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeOrg, SCHEMA as BASE } from "../../support/fake-org.mjs";

const f = (...names) => names.map((name) => ({ name }));
const id18 = (p, n) => p + String(n).padStart(18 - p.length, '0');
const ACC = id18('001', 1), OS = id18('1Os', 1), K = id18('10u', 1), T = id18('10u', 2), S = id18('10u', 3), F = id18('10u', 4), X = id18('10u', 5);
const BUNDLED = { OrderItemSummary: [...BASE.OrderItemSummary, ...f('Quantity'), { name: 'MainOrderItemSummaryId', relationshipName: 'MainOrderItemSummary', referenceTo: ['OrderItemSummary'] }] };
const PLAIN = { OrderItemSummary: [...BASE.OrderItemSummary, ...f('Quantity')] };
const row = (Id, Name, q, extra = {}) => ({ Id, Name, OrderSummaryId: OS, TypeCode: 'Product', Status: 'ORDERED', Quantity: q, QuantityOrdered: q, QuantityFulfilled: 0, QuantityCanceled: 0, QuantityReturned: 0, TotalPrice: 0, ...extra });
// Two Summit camp kits ($249 each, a tent, a stove and two fuel canisters per kit) and a tee on its own.
const LINES = [row(K, 'Summit camp kit', 2, { TotalPrice: 498 }), row(T, 'Trailhead 2 tent', 2, { MainOrderItemSummaryId: K }), row(S, 'Ember stove', 2, { MainOrderItemSummaryId: K }),
  row(F, 'Fuel canister', 4, { MainOrderItemSummaryId: K }), row(X, 'Merino tee', 1, { TotalPrice: 48 })];
const PLAIN_LINES = LINES.map(({ MainOrderItemSummaryId, ...l }) => l);
const queries = (lines) => [
  [/FROM Account WHERE Id/, [{ Id: ACC, Name: 'Avery Chen' }]],
  [/FROM OrderSummary WHERE (?:Id|AccountId)/, [{ Id: OS, OrderNumber: '00035800', Status: 'Approved', GrandTotalAmount: 546, AccountId: ACC }]],
  [/FROM OrderItemSummary WHERE OrderSummaryId/, lines],
  [/./, []],
];
const oisRead = (soql) => soql.find((q) => /FROM OrderItemSummary WHERE OrderSummaryId/.test(q));

test('the order drawer gets each line’s bundle link where the org has bundles', async () => {
  const org = fakeOrg({ schema: BUNDLED, queries: queries(LINES) });
  const r = await org.core.route(`/api/order/${OS}`);
  assert.match(oisRead(org.soql()), /\bMainOrderItemSummaryId\b/);
  assert.deepEqual(r.items.map((l) => [l.Id, l.MainOrderItemSummaryId ?? null]), [[K, null], [T, K], [S, K], [F, K], [X, null]]);
});

test('the Service Console view names a bundle once, by its main line', async () => {
  const org = fakeOrg({ schema: BUNDLED, queries: queries(LINES) });
  const r = await org.core.route(`/api/service/customer/${ACC}`);
  assert.match(oisRead(org.soql()), /\bMainOrderItemSummaryId\b/);
  assert.deepEqual(r.orders[0].items.map((l) => [l.id, l.name, l.ordered, l.total]), [[K, 'Summit camp kit', 2, 498], [X, 'Merino tee', 1, 48]]);
});

test('no bundle fields: nothing changes', async () => {
  for (const route of [`/api/order/${OS}`, `/api/service/customer/${ACC}`]) {
    const org = fakeOrg({ schema: PLAIN, queries: queries(PLAIN_LINES) });
    const r = await org.core.route(route);
    assert.doesNotMatch(oisRead(org.soql()), /MainOrderItemSummary/, route);
    assert.ok(!org.soql().some((q) => /OrderItemSummaryRelationship/.test(q)), `${route}: no relationship read`);
    const items = r.items ?? r.orders[0].items;
    assert.equal(items.length, 5, route);
  }
});
