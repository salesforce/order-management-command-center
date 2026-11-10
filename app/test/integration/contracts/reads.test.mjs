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
import { READS, OPEN_FO, readParams, previewRead, buildQuery, createReader } from "../../../public/shared/data/om-reads.js";

const OS = '1Os000000000001AAA', ACC = '001000000000001AAA', FO = '0a3000000000001AAA';
const all = [[/./, []]];
const read = (core, name, params = {}) => core.route(`/api/read/${name}?${new URLSearchParams(params)}`);
const ref = (name, relationshipName, ...referenceTo) => ({ name, relationshipName, referenceTo });

test('every read previews as plain SELECTs with no unexpanded tokens', () => {
  for (const name of Object.keys(READS)) {
    for (const q of previewRead(name)) {
      if (q.api) { assert.match(q.api, /^\/commerce\/[\w/<>-]+(\?[\w=&<>-]+)?$/, `${name}.${q.as}`); continue; }
      assert.match(q.soql, /^SELECT /, `${name}.${q.as}`);
      assert.doesNotMatch(q.soql, /\{|\}|\$ref|undefined|= null'|'null'/, `${name}.${q.as}: ${q.soql}`);
      assert.doesNotMatch(q.soql, /\b(INSERT|UPDATE|DELETE|UPSERT|MERGE)\b/i, `${name}.${q.as}`);
    }
  }
});

test('every reference token in a read names one of its own parameters', () => {
  const known = new Set(['range', 'cur', 'prior', 'q', 'order', 'case', 'fo', 'location', 'product', 'user', 'account', 'store', 'sku']);
  for (const [name, def] of Object.entries(READS)) {
    const text = JSON.stringify(def.queries);
    for (const [, k] of text.matchAll(/\{(\w+)[:@}]/g)) {
      assert.ok(known.has(k), `${name}: unknown token ${k}`);
      const param = k === 'cur' || k === 'prior' ? 'period' : k;
      assert.ok(Object.hasOwn(def.params, param), `${name} uses {${k}} but has no ${param} parameter`);
    }
  }
});

test('parameters are checked before they reach a query', () => {
  assert.throws(() => readParams('exceptions', { range: '2w' }), { code: 400 });
  assert.throws(() => readParams('order', {}), { code: 400, message: /Missing order/ });
  assert.throws(() => readParams('order', { order: "1'; DROP" }), { code: 400 });
  assert.throws(() => readParams('customer', { account: 'Jane' }), { code: 400 });
  assert.throws(() => readParams('customer-search', { q: 'x' }), { code: 400 });
  assert.throws(() => readParams('customer-search', { q: 'x'.repeat(81) }), { code: 400 });
  assert.throws(() => readParams('whoami', { user: 'not a username' }), { code: 400 });
  assert.equal(readParams('exceptions', {}).range.lit, 'LAST_N_DAYS:30');
  assert.deepEqual(readParams('order', { order: '35807' }).order.key, ['35807', '00035807']);
  assert.equal(readParams('order', { order: OS }).order.id, OS);
  assert.deepEqual(readParams('performance', { period: 'month' }).period, { type: 'period', cur: 'THIS_MONTH', prior: 'LAST_MONTH', v: 'month' });
});

test('search text is escaped, so quotes and wildcards stay literal', async () => {
  const { core, soql } = fakeOrg({ queries: all });
  await read(core, 'customer-search', { q: "O'Neil 50%_" });
  const acc = soql().find((s) => s.includes('FROM Account'));
  assert.match(acc, /Name LIKE '%O\\'Neil 50\\%\\_%'/);
  assert.match(acc, /\(Name LIKE .* OR PersonEmail LIKE .* OR Phone LIKE .* OR PersonMobilePhone LIKE .*\)/);
});

test('an order number matches padded and unpadded, through each kind of path', async () => {
  const { core, soql } = fakeOrg({ schema: { Invoice: [{ name: 'Id' }, { name: 'DocumentNumber' }, { name: 'Status' }, { name: 'ReferenceEntityId' }] }, objects: [...Object.keys(SCHEMA), 'Invoice'], queries: all });
  await read(core, 'order', { order: '35807' });
  const q = soql(), on = (o) => q.find((s) => s.includes(`FROM ${o} `));
  assert.match(on('OrderSummary'), /WHERE OrderNumber IN \('35807', '00035807'\)/);
  assert.match(on('FulfillmentOrder'), /WHERE OrderSummary\.OrderNumber IN \('35807', '00035807'\)/);
  assert.match(on('FulfillmentOrderLineItem'), /WHERE FulfillmentOrder\.OrderSummary\.OrderNumber IN/);
  assert.match(on('Invoice'), /WHERE ReferenceEntityId IN \(SELECT Id FROM OrderSummary WHERE OrderNumber IN \('35807', '00035807'\)\)/);
});

test('an order Id filters on the lookup field itself, as the console always has', async () => {
  const { core, soql } = fakeOrg({ queries: all });
  await read(core, 'order', { order: OS });
  const q = soql();
  assert.ok(q.includes(`SELECT Id, FulfillmentOrderNumber, Status, FulfilledFromLocation.Name, CreatedDate FROM FulfillmentOrder WHERE OrderSummaryId = '${OS}' ORDER BY CreatedDate LIMIT 200`), q.join('\n'));
  assert.ok(q.some((s) => s.includes(`FROM FulfillmentOrderLineItem WHERE FulfillmentOrder.OrderSummaryId = '${OS}'`)));
});

test('fields the org lacks are dropped; a missing key, object or lookup skips just that query', async () => {
  const { core, soql } = fakeOrg({ objects: Object.keys(SCHEMA).filter((o) => o !== 'Shipment'), queries: all });
  const r = await read(core, 'order', { order: OS });
  assert.equal(r.results.shipments.skipped, 'Shipment');
  assert.equal(r.results.authorizations.skipped, 'PaymentAuthorization');
  assert.ok(soql().some((s) => s.startsWith('SELECT Id, FulfillmentOrderNumber, Status, FulfilledFromLocation.Name, CreatedDate FROM')), 'GrandTotalAmount and LastModifiedDate dropped');
  // The fake Case has a custom lookup to OrderSummary, found by what it points at.
  assert.ok(soql().some((s) => s.includes(`FROM Case WHERE Order_Summary__c = '${OS}'`)));
  const noLookup = fakeOrg({ schema: { Case: SCHEMA.Case.filter((f) => f.name !== 'Order_Summary__c') }, queries: all });
  assert.match((await read(noLookup.core, 'order', { order: OS })).results.cases.skipped, /no lookup to OrderSummary/);
  const noKey = fakeOrg({ schema: { ReturnOrder: SCHEMA.ReturnOrder.filter((f) => f.name !== 'Id') }, queries: all });
  assert.match((await read(noKey.core, 'order', { order: OS })).results.returns.skipped, /no Id/);
});

test('the order read says which bundle each line is part of, where the org has bundles', async () => {
  const schema = { OrderItemSummary: [...SCHEMA.OrderItemSummary, { name: 'MainOrderItemSummaryId', relationshipName: 'MainOrderItemSummary', referenceTo: ['OrderItemSummary'] }] };
  const withB = fakeOrg({ schema, queries: all });
  await read(withB.core, 'order', { order: OS });
  assert.ok(withB.soql().some((s) => /, TypeCode, MainOrderItemSummaryId FROM OrderItemSummary WHERE/.test(s)));
  const without = fakeOrg({ queries: all });
  await read(without.core, 'order', { order: OS });
  assert.ok(!without.soql().some((s) => /MainOrderItemSummaryId/.test(s)));
});

test('`if` picks the where clause by what describe has', async () => {
  const withOS = fakeOrg({ queries: all });
  await read(withOS.core, 'order', { order: OS });
  assert.ok(withOS.soql().some((s) => s.includes(`FROM Shipment WHERE OrderSummaryId = '${OS}'`)));
  const without = fakeOrg({ schema: { Shipment: SCHEMA.Shipment.filter((f) => f.name !== 'OrderSummaryId') }, queries: all });
  await read(without.core, 'order', { order: OS });
  assert.ok(without.soql().some((s) => s.includes(`FROM Shipment WHERE FulfillmentOrder.OrderSummaryId = '${OS}'`)));
});

test('an optional parameter adds its filter only when given', async () => {
  const a = fakeOrg({ queries: all });
  await read(a.core, 'fulfillment-backlog', {});
  assert.ok(a.soql().every((s) => !s.includes('FulfilledFromLocation.Name =')));
  const b = fakeOrg({ queries: all });
  await read(b.core, 'fulfillment-backlog', { location: "Reno's DC", range: '7d' });
  const backlog = b.soql().find((s) => s.includes('GROUP BY FulfilledFromLocationId, FulfilledFromLocation.Name, Status'));
  assert.match(backlog, /CreatedDate = LAST_N_DAYS:7 AND FulfilledFromLocation\.Name = 'Reno\\'s DC'/);
  assert.ok(backlog.includes(OPEN_FO), backlog);
});

test('aggregates alias their groups, drop what the org lacks, and flag capped results', async () => {
  const big = Array.from({ length: 2000 }, (_, i) => ({ attributes: { type: 'AggregateResult' }, s: `S${i}`, c: 1 }));
  const { core, soql } = fakeOrg({ queries: [[/GROUP BY FulfilledFromLocationId, FulfilledFromLocation\.Name, Status/, big], ...all] });
  const r = await read(core, 'fulfillment-backlog', {});
  assert.equal(r.results.byLocation.capped, true);
  assert.equal(r.results.byLocation.rows[0].attributes, undefined, 'attributes are stripped');
  assert.ok(soql().some((s) => s.startsWith('SELECT FulfilledFromLocationId l, FulfilledFromLocation.Name loc, Status s, COUNT(Id) c FROM FulfillmentOrder')));
  const perf = fakeOrg({ queries: all });
  await read(perf.core, 'performance', { period: 'month' });
  const units = perf.soql().filter((s) => s.includes('FROM OrderItemSummary') && s.includes('SUM(QuantityOrdered) ordered'));
  assert.deepEqual(units.map((s) => s.match(/OrderedDate = (\w+)/)[1]), ['THIS_MONTH', 'LAST_MONTH']);
  assert.match(units[0], /AND TypeCode = 'Product'/);
});

test('capabilities says what the org has, and an org without an object reads as skipped', async () => {
  const f = (...names) => names.map((name) => ({ name }));
  const schema = { Organization: f('Id', 'IsSandbox', 'OrganizationType', 'InstanceName'), OrderSummary: f('Id', 'CreatedDate'), Location: f('Id', 'ExternalReference'), DeliveryEstimationSetup: f('Id'), WebStore: f('Id'),
    Entitlement: f('Id'), BotDefinition: f('Id'), SOM_Return_Policy__c: f('Id'), User: f('Id', 'IsActive', 'LastLoginDate') };
  const { core, soql } = fakeOrg({ schema: { ...schema, User: [...schema.User, ref('ProfileId', 'Profile', 'Profile')], Profile: f('Id', 'PermissionsModifyAllData') }, objects: [...Object.keys(SCHEMA), ...Object.keys(schema), 'Profile'].filter((o) => o !== 'DeliveryEstimationSetup'),
    queries: [[/FROM OmniDeliveryEstimationSetup|FROM DeliveryEstimationSetup/, () => { throw Object.assign(new Error("sObject type is not supported"), { errorCode: 'INVALID_TYPE' }); }], ...all] });
  const r = await read(core, 'capabilities', {});
  assert.match(soql().find((s) => s.includes('FROM Organization')), /SELECT IsSandbox, OrganizationType, InstanceName FROM Organization LIMIT 1/);
  assert.match(soql().find((s) => s.includes('FROM User')), /COUNT\(Id\) c FROM User WHERE IsActive = true AND Profile\.PermissionsModifyAllData = true AND LastLoginDate = LAST_N_DAYS:30/);
  assert.ok(r.results.deliverySetups.skipped || r.results.deliverySetups.error);
  for (const k of ['org', 'orders', 'ociLocations', 'stores', 'entitlements', 'agents', 'policies', 'admins']) assert.ok(k in r.results, k);
  for (const s of soql()) assert.doesNotMatch(s, /Email|Phone|Name =|Username/, s);
});

test('service-performance compares a period with the one before, reads no customer details, and skips milestones an org lacks', async () => {
  const { core, soql } = fakeOrg({ queries: [[/FROM CaseMilestone/, () => { throw Object.assign(new Error("sObject type 'CaseMilestone' is not supported"), { errorCode: 'INVALID_TYPE' }); }], ...all] });
  const r = await read(core, 'service-performance', { period: 'lastweek' });
  const cases = soql().filter((s) => s.includes('FROM Case '));
  assert.deepEqual(cases.filter((s) => /^SELECT COUNT\(Id\) c FROM Case WHERE (IsClosed = true AND )?(Created|Closed)Date = /.test(s)).map((s) => s.match(/Date = (\w+(?::\d+)?)/)[1]),
    ['LAST_WEEK', 'N_WEEKS_AGO:2', 'LAST_WEEK', 'N_WEEKS_AGO:2']);
  for (const s of soql()) assert.doesNotMatch(s, /Email|Phone|Account\.Name|Contact|Subject|Description|Billing/, s);
  assert.ok(r.results.closedCases.rows && r.results.refunds.rows);
  assert.ok(r.results.milestones.skipped || r.results.milestones.error, 'an org without entitlements still gets the rest');
});

test('a Connect read needs an Id, and runs as a GET', async () => {
  const { core, calls } = fakeOrg({ queries: [[/routing-explanation$/, { success: true, location: 'Reno' }], ...all] });
  const byNum = await read(core, 'routing', { fo: 'FO-2095' });
  assert.match(byNum.results.explanation.skipped, /needs the fulfillment order Id/);
  const byId = await read(core, 'routing', { fo: FO });
  assert.ok(calls.includes(`/commerce/fulfillment/fulfillment-orders/${FO}/routing-explanation`));
  assert.ok('data' in byId.results.explanation);
});

test('a failing query reports its error; a dead session is thrown, not swallowed', async () => {
  const { core } = fakeOrg({ queries: [[/FROM ReturnOrder/, () => { throw new Error('QUERY_TIMEOUT'); }], ...all] });
  const r = await read(core, 'customer', { account: ACC });
  assert.equal(r.results.returns.error, 'QUERY_TIMEOUT');
  assert.ok(r.results.orders.rows);
  const reader = createReader({ soql: async () => { throw Object.assign(new Error('Session expired'), { httpStatus: 401 }); },
    describe: async () => ({ fields: new Set(['Id', 'Status', 'CreatedDate']), rels: new Set(), to: {} }), api: async () => ({}) });
  await assert.rejects(reader('exceptions', {}), /Session expired/);
  await assert.rejects(reader('nope', {}), { code: 404 });
});

test('the preview carries placeholders, optional filters, fallbacks and the lookup to find', () => {
  const order = previewRead('order'), on = (as) => order.find((q) => q.as === as);
  assert.match(on('fulfillmentOrders').soql, /WHERE OrderSummary\.OrderNumber IN \(<ORDER_NUMBERS>\)/);
  assert.match(on('invoices').soql, /ReferenceEntityId IN \(SELECT Id FROM OrderSummary WHERE OrderNumber IN \(<ORDER_NUMBERS>\)\)/);
  assert.match(on('cases').soql, /WHERE <ORDER_LOOKUP>\.OrderNumber IN \(<ORDER_NUMBERS>\)/);
  assert.deepEqual({ ...on('cases').ground, soql: undefined }, { object: 'Case', to: 'OrderSummary', soql: undefined });
  assert.match(on('cases').ground.soql, /^SELECT QualifiedApiName, RelationshipName, ReferenceTo FROM FieldDefinition WHERE EntityDefinition\.QualifiedApiName = 'Case'/);
  assert.deepEqual(on('shipments').alts, [{ field: 'OrderSummaryId', then: 'OrderSummary.OrderNumber IN (<ORDER_NUMBERS>)', else: 'FulfillmentOrder.OrderSummary.OrderNumber IN (<ORDER_NUMBERS>)' }]);
  assert.deepEqual(on('authorizations').requires, ['OrderPaymentSummary']);
  assert.ok(on('fulfillmentOrders').optional.includes('GrandTotalAmount') && on('fulfillmentOrders').keys.includes('Id'));
  const fb = previewRead('fulfillment-backlog').find((q) => q.as === 'byLocation');
  assert.match(fb.soql, /CreatedDate = <RANGE> \[AND FulfilledFromLocationId = '<LOCATION_ID>'\] GROUP BY/);
  assert.match(previewRead('inventory').find((q) => q.as === 'onHand').soql, /WHERE Product2Id = '<PRODUCT_ID>'/);
  // An optional GROUP BY field is droppable, not a key: an org without it still gets the rest of the query.
  assert.deepEqual(previewRead('service-queue').find((q) => q.as === 'exceptionGroups').keys, ['OrderSummaryId', 'OrderSummary.OrderNumber', 'Category']);
  assert.match(previewRead('customer').find((q) => q.as === 'orders').soql, /WHERE AccountId = '<ACCOUNT_ID>'/);
  assert.match(previewRead('routing').find((q) => q.as === 'explanation').api, /<FO_ID>/);
  assert.match(previewRead('performance').find((q) => q.as === 'ordersPrior').soql, /OrderedDate = <PRIOR>/);
});

test('buildQuery never selects a field twice or leaves a dangling WHERE', () => {
  for (const name of Object.keys(READS)) for (const q of READS[name].queries.filter((x) => !x.api)) {
    const b = buildQuery({ ...q, _params: READS[name].params }, { params: {}, preview: true });
    const sel = b.soql.match(/^SELECT (.*?) FROM /)[1].split(', ');
    assert.equal(new Set(sel).size, sel.length, `${name}.${q.as}`);
    assert.doesNotMatch(b.soql, /WHERE\s*(GROUP|ORDER|LIMIT|$)|AND\s*(AND|GROUP|ORDER|LIMIT|$)/, `${name}.${q.as}`);
  }
});

test('the history route still reads no personal data', async () => {
  const { core, soql } = fakeOrg({ queries: [[/FROM OrderSummary WHERE Id/, [{ Id: OS, OrderNumber: '00000001', Status: 'Created', CreatedDate: '2026-01-01T00:00:00Z' }]], ...all] });
  await core.route(`/api/order/${OS}/history`);
  for (const s of soql()) assert.doesNotMatch(s, /Email|Phone|Billing|Account\.Name|DeliverTo|Tracking|Message|ShipTo/, s);
});

test('a value is an Id only with the right key prefix, so a 15- or 18-character name or SKU stays a name or SKU', () => {
  assert.deepEqual(readParams('location', { location: 'DallasWarehouse' }).location.key, ['DallasWarehouse']);
  assert.equal(readParams('location', { location: '131000000000001AAA' }).location.id, '131000000000001AAA');
  assert.deepEqual(readParams('inventory', { product: 'SKU000000000001' }).product.key, ['SKU000000000001']);
  assert.deepEqual(readParams('order', { order: '123456789012345' }).order.key[0], '123456789012345');
  assert.throws(() => readParams('order', { order: '001000000000001AAA' }), { code: 400 }, 'an Account Id is not an order');
});

test('`only` runs just the named queries and refuses a name the read lacks', async () => {
  const reader = createReader({ soql: async () => [], describe: async () => ({ fields: new Set(['Id', 'OrderNumber', 'Status']), rels: new Set(), to: {} }), api: async () => ({}) });
  const r = await reader('order', { order: OS }, { only: ['order'] });
  assert.deepEqual(Object.keys(r.results), ['order']);
  await assert.rejects(reader('order', { order: OS }, { only: ['trackingNumbers'] }), /has no trackingNumbers/);
});

test('a describe that failed for a reason other than 404 is an error, not "this org lacks it"', async () => {
  const { createCore } = await import("../../../public/operations-console/data/core.js");
  const core = createCore({ instanceUrl: () => 'https://test', request: async (p) => {
    if (p === '/sobjects/Invoice/describe') throw Object.assign(new Error('REQUEST_LIMIT_EXCEEDED'), { httpStatus: 503 });
    if (p.startsWith('/sobjects/')) throw Object.assign(new Error('NOT_FOUND'), { httpStatus: 404 });
    return { records: [], done: true };
  } });
  const r = await core.route(`/api/read/order?order=${OS}`);
  assert.match(r.results.invoices.error, /Couldn't read Invoice's fields/);
  assert.equal(r.results.creditMemos.skipped, 'CreditMemo');
});

test('a dead session surfaces as code 401 whichever field carried it', async () => {
  const reader = createReader({ soql: async () => { throw Object.assign(new Error('Session expired'), { httpStatus: 401 }); },
    describe: async () => ({ fields: new Set(['Id', 'Status', 'CreatedDate', 'Category', 'Severity']), rels: new Set(), to: {} }), api: async () => ({}) });
  await assert.rejects(reader('exceptions', {}), { code: 401 });
});

// ---------- Connect-GET reads with several parameters (OM Service Console's action skills) ----------
const STORE = '0ZE000000000001AAA';
const withRead = async (def, fn) => { READS.__t = def; try { return await fn(); } finally { delete READS.__t; } };
const SEARCH = { params: { store: { type: 'store', required: true }, q: { type: 'text' }, account: { type: 'id', required: true } },
  queries: [{ as: 'search', api: '/commerce/order-management/webstores/{store}/products?searchTerm={q}&effectiveAccountId={account}' }] };

test('a Connect read fills every token, and search text is URL-encoded so it cannot add parameters', () => withRead(SEARCH, async () => {
  const paths = [], read = createReader({ soql: async () => [], describe: async () => null, api: async (p) => { paths.push(p); return { ok: 1 } } });
  const r = await read('__t', { store: STORE, q: 'rain & snow #2', account: ACC });
  assert.deepEqual(paths, [`/commerce/order-management/webstores/${STORE}/products?searchTerm=rain%20%26%20snow%20%232&effectiveAccountId=${ACC}`]);
  assert.deepEqual(r.results.search, { data: { ok: 1 } });
}));

test('store and SKU parameters are checked before they reach a path', () => withRead({ params: { store: { type: 'store', required: true }, sku: { type: 'sku' } }, queries: [] }, () => {
  assert.throws(() => readParams('__t', { store: ACC }), { code: 400 });
  assert.throws(() => readParams('__t', { store: STORE, sku: 'a b' }), { code: 400 });
  assert.throws(() => readParams('__t', { store: STORE, sku: '../x' }), { code: 400 });
  assert.throws(() => readParams('__t', { store: STORE, sku: '..' }), { code: 400 });
  assert.equal(readParams('__t', { store: STORE, sku: 'NW-4471.B' }).sku.text, 'NW-4471.B');
}));

test('a Connect read previews with a placeholder for each token', () => withRead(SEARCH, () => {
  assert.equal(previewRead('__t')[0].api, '/commerce/order-management/webstores/<STORE_ID>/products?searchTerm=<TEXT_URL>&effectiveAccountId=<ACCOUNT_ID>');
}));

test('a Connect read missing an optional parameter is skipped, and says which', () => withRead(SEARCH, async () => {
  const read = createReader({ soql: async () => [], describe: async () => null, api: async () => { throw new Error('should not be called'); } });
  assert.deepEqual((await read('__t', { store: STORE, account: ACC })).results.search, { skipped: 'needs the search text' });
}));
