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

const f = (...names) => names.map((name) => ({ name }));
const os = (n) => '1Os' + String(n).padStart(15, '0');
// Invoice and CreditMemo with the fields the settlement panels read.
const MONEY = {
  Invoice: f('Id', 'ReferenceEntityId', 'Balance', 'TotalAmountWithTax', 'CreatedDate'),
  CreditMemo: f('Id', 'ReferenceEntityId', 'Balance', 'TotalAmount', 'TotalAmountWithTax', 'CreatedDate'),
};
const ALL = Object.keys({ ...SCHEMA, ...MONEY });
const queries = [
  [/^SELECT COUNT_DISTINCT\(ReferenceEntityId\) n.* FROM Invoice/, [{ n: 2, c: 3, b: 900 }]],
  [/^SELECT ReferenceEntityId o.* FROM Invoice/, [{ o: os(1), c: 2, t: 800, b: 700, d: '2026-09-30T10:00:00.000+0000' }, { o: os(2), c: 1, t: 200, b: 200, d: '2026-09-29T10:00:00.000+0000' }]],
  [/^SELECT COUNT_DISTINCT\(ReferenceEntityId\) n.* FROM CreditMemo/, [{ n: 1, c: 1, b: 45.5 }]],
  [/^SELECT ReferenceEntityId o.* FROM CreditMemo/, [{ o: os(3), c: 1, t: 45.5, b: 45.5, d: '2026-09-28T10:00:00.000+0000' }]],
  [/^SELECT COUNT\(Id\) c FROM OrderSummary WHERE .* NOT IN \(SELECT ReferenceEntityId FROM Invoice\)/, [{ c: 4 }]],
  [/^SELECT Id, OrderNumber, Status FROM OrderSummary WHERE Id IN/, [{ Id: os(1), OrderNumber: '00001001', Status: 'Fulfilled' }, { Id: os(2), OrderNumber: '00001002', Status: 'Partially Fulfilled' }, { Id: os(3), OrderNumber: '00001003', Status: 'Returned' }]],
  [/./, []],
];
const dash = async (org = {}) => {
  const o = fakeOrg({ queries, schema: MONEY, objects: ALL, ...org });
  return { ...o, r: await o.core.route('/api/dashboard?period=mtd') };
};

test('unpaid invoices on shipped orders and unrefunded credit memos, with order number and status', async () => {
  const { r, soql } = await dash();
  assert.ok(r.settlement.ok);
  const s = r.settlement.data;
  assert.deepEqual({ orders: s.unpaid.orders, docs: s.unpaid.docs, amount: s.unpaid.amount }, { orders: 2, docs: 3, amount: 900 });
  assert.deepEqual(s.unpaid.top[0], { id: os(1), number: '00001001', status: 'Fulfilled', docs: 2, total: 800, balance: 700, at: '2026-09-30T10:00:00.000+0000' });
  assert.equal(s.unpaid.top[1].status, 'Partially Fulfilled');
  assert.equal(s.unrefunded.amount, 45.5);
  assert.equal(s.unrefunded.top[0].number, '00001003');
  assert.equal(s.noInvoice, 4);

  const inv = soql().filter((q) => /FROM Invoice WHERE .*Balance > 0/.test(q));
  assert.equal(inv.length, 2);
  for (const q of inv) assert.match(q, /CreatedDate >= .* AND Balance > 0\.01 AND ReferenceEntityId IN \(SELECT Id FROM OrderSummary WHERE Status IN \('Fulfilled','Partially Fulfilled'\)\)/);
  // Credit memos count on any order status: a cancel or a return can both owe a refund.
  for (const q of soql().filter((x) => /FROM CreditMemo WHERE .*Balance/.test(x))) assert.match(q, /ReferenceEntityId IN \(SELECT Id FROM OrderSummary\)/);
  // One lookup for all listed orders, and nothing about the customer.
  assert.equal(soql().filter((q) => /^SELECT Id, OrderNumber, Status FROM OrderSummary/.test(q)).length, 1);
  for (const q of soql().filter((x) => /Balance|OrderNumber, Status|NOT IN \(SELECT ReferenceEntityId/.test(x))) assert.doesNotMatch(q, /Account|Email|Billing|Phone/);
  for (const n of ['Shipped, not paid', 'Refund owed, not created', 'Shipped, not invoiced']) assert.ok(r.sources.some((x) => x.panel === n), n);
});

test('without Invoice the unpaid side is empty and credit memos still show', async () => {
  const { r, soql } = await dash({ objects: ALL.filter((o) => o !== 'Invoice') });
  assert.equal(r.settlement.data.unpaid, null);
  assert.equal(r.settlement.data.noInvoice, null);
  assert.equal(r.settlement.data.unrefunded.orders, 1);
  assert.ok(!soql().some((q) => /FROM Invoice/.test(q)));
});

test('a credit memo without Balance or ReferenceEntityId is skipped, not an error', async () => {
  const { r } = await dash({ schema: { ...MONEY, CreditMemo: f('Id', 'TotalAmount', 'TotalAmountWithTax') } });
  assert.ok(r.settlement.ok);
  assert.equal(r.settlement.data.unrefunded, null);
  assert.equal(r.settlement.data.unpaid.orders, 2);
});

test('with neither object there is nothing to show', async () => {
  const { r } = await dash({ objects: ALL.filter((o) => o !== 'Invoice' && o !== 'CreditMemo') });
  assert.deepEqual(r.settlement, { ok: true, data: null });
});
