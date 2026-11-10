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
import { fakeOrg, SCHEMA } from '../../support/fake-org.mjs';
import { scopeOf, scopeCond, SCOPE_PATH, UNSCOPED, pre } from '../../../public/shared/data/om-core-util.js';
import { demoData, demoDash, demoFilters, scopeShare } from '../../../public/operations-console/console-demo.js';

// The Operations Console's and Dashboard's Store and Sales channel filters: ?store= and ?channel= reach every query tied to an
// order through that object's path to OrderSummary, and nothing else changes.
const f = (...names) => names.map((name) => ({ name }));
const ref = (name, relationshipName, ...referenceTo) => ({ name, relationshipName, referenceTo });
const STORE = '0ZE000000000001', CHANNEL = '0bI000000000001';
const MORE = {
  OrderSummary: [...SCHEMA.OrderSummary, ref('SalesStoreId', 'SalesStore', 'WebStore'), ref('SalesChannelId', 'SalesChannel', 'SalesChannel')],
  WebStore: f('Id', 'Name'), SalesChannel: f('Id', 'SalesChannelName'),
  ReturnOrderLineItem: [...f('Id', 'ReasonForReturn', 'QuantityReturned', 'TypeCode'), ref('ReturnOrderId', 'ReturnOrder', 'ReturnOrder'), ref('Product2Id', 'Product2', 'Product2')],
  Payment: [...f('Id', 'Amount', 'Status', 'CreatedDate'), ref('OrderPaymentSummaryId', 'OrderPaymentSummary', 'OrderPaymentSummary')],
  Invoice: f('Id', 'ReferenceEntityId', 'Balance', 'TotalAmountWithTax', 'CreatedDate'),
  CreditMemo: f('Id', 'ReferenceEntityId', 'Balance', 'TotalAmount', 'TotalAmountWithTax', 'CreatedDate'),
  Location: f('Id', 'Name', 'LocationType', 'Latitude', 'Longitude'),
  Agent_Proposal__c: f('Id', 'Status__c'),
};
const ALL = Object.keys({ ...SCHEMA, ...MORE });
const queries = [
  [/FROM WebStore/, [{ Id: STORE, Name: 'Northwind Outdoors' }]],
  [/FROM SalesChannel /, [{ Id: CHANNEL, SalesChannelName: 'Web' }]],
  [/./, []],
];
const org = (o = {}) => fakeOrg({ queries, schema: MORE, objects: ALL, ...o });
const COND = `SalesStoreId = '${STORE}' AND SalesChannelId = '${CHANNEL}'`;
// The objects a query reads, and the scope it should carry for each.
const want = (q) => {
  const from = q.match(/ FROM (\w+)/)[1];
  if (from === 'Invoice' || from === 'CreditMemo') return `IN (SELECT Id FROM OrderSummary WHERE`;
  const path = { ...SCOPE_PATH, Case: 'Order_Summary__r.' }[from];
  return typeof path === 'string' ? scopeCond({ store: STORE, channel: CHANNEL }, path) : null;
};

test('scopeOf: an Id each or nothing, anything else is a 400', () => {
  const q = (o) => (k) => o[k] ?? null;
  assert.deepEqual(scopeOf(q({})), { store: null, channel: null });
  assert.deepEqual(scopeOf(q({ store: STORE, channel: CHANNEL })), { store: STORE, channel: CHANNEL });
  for (const bad of ["x' OR Id != '", '0ZE00000000000', 'all']) assert.throws(() => scopeOf(q({ store: bad })), (e) => e.code === 400, bad);
  assert.throws(() => scopeOf(q({ channel: "') OR ('" })), (e) => e.code === 400);
  assert.equal(scopeCond({ store: STORE }, 'OrderSummary.'), `OrderSummary.SalesStoreId = '${STORE}'`);
  assert.equal(scopeCond({}), '');
});

test('pre() and the scoper\'s clause(): an optional clause, and a query\'s only condition', async () => {
  assert.equal(pre(' AND ', "Status = 'Open'"), " AND Status = 'Open'");
  assert.equal(pre(' WHERE ', ''), '');
  assert.equal(pre(' GROUP BY ', null), '');
  // The newest-record reads take the scope as their only condition.
  const o = org();
  await o.core.route(`/api/console?range=7d&store=${STORE}`);
  assert.ok(o.soql().some((q) => q.startsWith(`SELECT OrderedDate FROM OrderSummary WHERE SalesStoreId = '${STORE}' ORDER BY`)));
  const u = org();
  await u.core.route('/api/console?range=7d');
  assert.ok(u.soql().some((q) => q.startsWith('SELECT OrderedDate FROM OrderSummary ORDER BY')), 'no filter, no WHERE');
});

test('/api/filters lists the org\'s stores and sales channels, and null for one its orders can\'t be filtered by', async () => {
  assert.deepEqual(await org().core.route('/api/filters'), { stores: [{ id: STORE, name: 'Northwind Outdoors' }], channels: [{ id: CHANNEL, name: 'Web' }] });
  const bare = org({ schema: { ...MORE, OrderSummary: SCHEMA.OrderSummary } });
  assert.deepEqual(await bare.core.route('/api/filters'), { stores: null, channels: null });
  assert.ok(!bare.soql().some((q) => /FROM (WebStore|SalesChannel)/.test(q)), 'no list is read for a filter the orders lack');
});

test('/api/filters: a failed read fails the route, so the page can tell it from an org with no stores', async () => {
  const o = org({ queries: [[/FROM WebStore/, () => { throw new Error('UNKNOWN_EXCEPTION'); }], ...queries] });
  await assert.rejects(o.core.route('/api/filters'), /UNKNOWN_EXCEPTION/);
});

test('without filters the console and Dashboard ask exactly what they did', async () => {
  const o = org();
  const c = await o.core.route('/api/console?range=7d'), d = await o.core.route('/api/dashboard?period=mtd');
  assert.deepEqual(c.scope, { store: null, channel: null });
  assert.deepEqual(d.scope, { store: null, channel: null });
  assert.ok(!o.soql().some((q) => /SalesStoreId|SalesChannelId/.test(q)));
});

test('the console: every query on an order-tied object carries the store and channel through its own path', async () => {
  const o = org(), r = await o.core.route(`/api/console?range=7d&store=${STORE}&channel=${CHANNEL}`);
  assert.deepEqual(r.scope, { store: STORE, channel: CHANNEL });
  const qs = o.soql().filter((q) => / FROM \w+/.test(q) && !/FROM (Location|Address|Agent_Proposal__c) /.test(q) && !/ WHERE Id = /.test(q));
  assert.ok(qs.length > 15, `${qs.length} queries`);
  for (const q of qs) { const w = want(q); assert.ok(w && q.includes(w), `${q}\n  should carry ${w}`); }
  // Locations are the network, not orders; their open fulfillment orders are filtered.
  assert.ok(o.soql().some((q) => /FROM Location WHERE LocationType != 'Virtual' LIMIT/.test(q) && !/SalesStoreId/.test(q)));
  assert.ok(o.soql().some((q) => q.includes(`FROM FulfillmentOrder WHERE CreatedDate = LAST_N_DAYS:365 AND`) && q.includes(`OrderSummary.${COND.replace(' AND SalesChannelId', ' AND OrderSummary.SalesChannelId')}`)));
  // Agent proposals aren't tied to an order: the count isn't asked, so the card shows a dash rather than every store's.
  assert.ok(!o.soql().some((q) => /Agent_Proposal__c/.test(q)));
  assert.equal(r.kpis.data.waiting, null);
});

test('the Dashboard: every query carries the scope, payments through their order payment summary, invoices by semi-join', async () => {
  const o = org(), r = await o.core.route(`/api/dashboard?period=qtd&store=${STORE}&channel=${CHANNEL}`);
  assert.deepEqual(r.scope, { store: STORE, channel: CHANNEL });
  const qs = o.soql().filter((q) => / FROM \w+ WHERE/.test(q) && !/FROM LocationGroupAssignment/.test(q) && !/WHERE Id IN \(/.test(q));
  assert.ok(qs.length > 40, `${qs.length} queries`);
  for (const q of qs) { const w = want(q); assert.ok(w && q.includes(w), `${q}\n  should carry ${w}`); }
  assert.ok(o.soql().some((q) => q.includes(`FROM Payment WHERE`) && q.includes(`OrderPaymentSummary.OrderSummary.SalesStoreId = '${STORE}'`)));
  // Settlement keeps one semi-join: the shipped statuses and the scope in the same subquery.
  const inv = o.soql().filter((q) => /FROM Invoice WHERE .*Balance > 0/.test(q));
  assert.equal(inv.length, 2);
  for (const q of inv) assert.ok(q.includes(`ReferenceEntityId IN (SELECT Id FROM OrderSummary WHERE Status IN ('Fulfilled','Partially Fulfilled') AND ${COND})`), q);
  for (const q of o.soql().filter((x) => /FROM CreditMemo WHERE .*Balance/.test(x))) assert.ok(q.includes(`ReferenceEntityId IN (SELECT Id FROM OrderSummary WHERE ${COND})`), q);
  // The Data map shows the filtered queries.
  assert.ok(r.sources.every((s) => !/ FROM OrderSummary WHERE/.test(s.soql) || s.soql.includes(COND) || /WHERE Id IN/.test(s.soql)));
});

test('a panel whose object can\'t reach its order says so instead of counting every store', async () => {
  const noCase = { ...MORE, Case: SCHEMA.Case.filter((x) => x.name !== 'Order_Summary__c') };
  const o = org({ schema: noCase }), r = await o.core.route(`/api/dashboard?period=mtd&store=${STORE}`);
  assert.deepEqual(r.cases, { ok: false, error: UNSCOPED });
  assert.ok(r.tiles.ok);
  const c = await o.core.route(`/api/console?range=7d&store=${STORE}`);
  assert.deepEqual(c.caseStream, { ok: false, error: UNSCOPED });
  assert.ok(c.kpis.ok && c.stream.ok);
  // An org whose orders have no store: nothing can be filtered by it.
  const bare = org({ schema: { ...MORE, OrderSummary: SCHEMA.OrderSummary } }), b = await bare.core.route(`/api/console?range=7d&store=${STORE}`);
  assert.deepEqual(b.kpis, { ok: false, error: UNSCOPED });
  assert.ok(!bare.soql().some((q) => /SalesStoreId/.test(q)));
});

test('the map\'s product: stock is the same for every store; its Orders fallback is filtered', async () => {
  const P = '01t000000000001';
  const o = org({ queries: [[/FROM Product2 WHERE Id/, [{ Id: P, Name: 'Mug' }]], ...queries], schema: { ...MORE, FulfillmentOrderLineItem: [...SCHEMA.FulfillmentOrderLineItem, ref('Product2Id', 'Product2', 'Product2')] } });
  await o.core.route(`/api/inventory?id=${P}&range=7d&store=${STORE}`);
  const fo = o.soql().find((q) => /FROM FulfillmentOrderLineItem WHERE Product2Id/.test(q));
  assert.ok(fo.includes(`FulfillmentOrder.OrderSummary.SalesStoreId = '${STORE}'`), fo);
});

test('sample data: the filters offer stores and channels, and a pick narrows the console and the Dashboard', () => {
  const opt = demoFilters();
  assert.ok(opt.stores.length >= 2 && opt.channels.length >= 2);
  const store = opt.stores[1].id, web = opt.channels.find((x) => x.name === 'Web').id;
  assert.equal(scopeShare({}), 1);
  const all = demoData('90d'), one = demoData('90d', { store, channel: web });
  assert.deepEqual(all.scope, { store: null, channel: null });
  assert.deepEqual(one.scope, { store, channel: web });
  assert.ok(one.kpis.data.orders < all.kpis.data.orders);
  assert.ok(one.stream.data.length && one.stream.data.every((o) => o.SalesChannel.SalesChannelName === 'Web'));
  assert.deepEqual(demoData('90d', { store: 'bogus' }).kpis, all.kpis, 'an unknown pick is no filter');
  const d = demoDash('mtd'), dw = demoDash('mtd', { channel: web });
  assert.ok(dw.tiles.data.orders.cur < d.tiles.data.orders.cur);
  assert.deepEqual(dw.channels.data, [{ key: 'Web', n: dw.tiles.data.orders.cur }]);
  assert.deepEqual(dw.scope, { store: null, channel: web });
});
