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
import { createPlatform, parseLimits, orgDomainUrl } from "../../../public/operations-console/transport/platform.js";

// A fake app domain: the CSRF resource, the Apex read endpoint and chatter/users/me; anything else is a 401 like the real one.
function appDomain({ rows = [{ Id: '1Os000000000001AAA', OrderNumber: '00000001' }], expireOnce = false, expireGraphqlOnce = false, gql = { data: { ok: 1 } }, limitOn = null, translate = () => null, limitsHeader = null, onRequest, graphqlReads = false, translateRows, describeDoc } = {}) {
  const calls = [];
  let expired = expireOnce, gqlExpired = expireGraphqlOnce;
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', token: opts.headers?.['X-CSRF-Token'], body: opts.body });
    const json = (status, body) => ({ status, ok: status < 300, json: async () => body,
      ...(limitsHeader && url.includes('/apexrest/somconsole') ? { headers: new Headers({ 'X-SomConsole-Limits': limitsHeader }) } : {}) });
    if (url.endsWith('/ui-api/session/csrf')) return json(200, { csrfToken: `t${calls.filter((c) => c.url.endsWith('/csrf')).length}` });
    if (!opts.headers?.['X-CSRF-Token']) return json(401, [{ errorCode: 'UNAUTHORIZED_EXCEPTION', message: 'Session expired or invalid token usage' }]);
    if (expired && url.includes('/apexrest/')) { expired = false; return json(401, [{ errorCode: 'INVALID_SESSION_ID', message: 'Session expired or invalid' }]); }
    if (url.endsWith('/services/data/v68.0/graphql')) {
      if (opts.method !== 'POST') return json(405, []);
      if (gqlExpired) { gqlExpired = false; return json(401, [{ errorCode: 'INVALID_SESSION_ID', message: 'Session expired or invalid' }]); }
      return json(200, typeof gql === 'function' ? gql(JSON.parse(opts.body)) : gql);
    }
    const limit = [{ errorCode: 'APEX_ERROR', message: 'System.LimitException: Too many query rows: 50001' }];
    if (limitOn && url.includes('/apexrest/somconsole/query?q=')) return json(500, limit);
    if (limitOn && url.endsWith('/apexrest/somconsole/batch')) return json(200, { results: JSON.parse(opts.body).items.map((it, i) => (i === 0 ? { status: 500, body: limit } : { status: 200, body: { totalSize: 0, done: true, records: [] } })) });
    if (url.endsWith('/apexrest/somconsole/agent') && opts.method === 'POST') {
      const { text, sessionId } = JSON.parse(opts.body);
      return json(200, { text: `echo: ${text}`, sessionId: sessionId || 'agent-session-1' });
    }
    if (url.endsWith('/apexrest/somconsole/batch') && opts.method === 'POST') {
      const { items } = JSON.parse(opts.body);
      return json(200, { results: items.map((it) => it.products || it.product ? { status: 200, body: { asked: it.products || it.product } }
        : it.inventory ? { status: 200, body: { success: true, locations: [{ locationIdentifier: it.inventory.locationIdentifiers?.[0], inventoryRecords: [] }], asked: it.inventory } }
        : it.estimate ? { status: 200, body: { deliveryEstimates: [], asked: it.estimate } }
        : it.duplicates ? (it.duplicates.apiName === 'Contact' ? { status: 400, body: [{ errorCode: 'BAD_REQUEST', message: 'NO_ACTIVE_DUPLICATE_RULE: No active duplicate rules are defined for the Contact object type.' }] }
          : { status: 200, body: { allowSave: true, duplicateError: false, duplicateRules: [], matches: [], asked: it.duplicates } })
        : it.describe ? (it.describe === 'OrderSummary' ? { status: 200, body: { name: 'OrderSummary', fields: [{ name: 'Id' }] } } : { status: 404, body: [{ errorCode: 'NOT_FOUND', message: 'The requested resource does not exist' }] })
        : { status: 200, body: { totalSize: rows.length, done: true, records: rows, q: it.q } }) });
    }
    if (url.endsWith('/apexrest/somconsole/limits')) return json(200, { DailyApiRequests: { Max: 100000, Remaining: 99876 }, DataStorageMB: { Max: 10640, Remaining: -15636 } });
    if (url.endsWith('/apexrest/somconsole/features')) return json(200, { connect: false });
    if (url.endsWith('/apexrest/somconsole/limits?only=api')) return json(200, { DailyApiRequests: { Max: 100000, Remaining: 99876 } });
    if (url.includes('/apexrest/somconsole/query?q=')) return json(200, { totalSize: rows.length, done: true, records: rows });
    if (url.includes('/apexrest/somconsole/describe/OrderSummary')) return json(200, { name: 'OrderSummary', fields: [{ name: 'Id' }, { name: 'OrderNumber' }, { name: 'AccountId', relationshipName: 'Account', referenceTo: ['Account'] }] });
    if (url.includes('/apexrest/somconsole/describe/')) return json(404, [{ errorCode: 'NOT_FOUND', message: 'The requested resource does not exist' }]);
    if (url.endsWith('/chatter/users/me')) return json(200, { username: 'admin@om.demo', name: 'Admin' });
    if (url.startsWith('/services/data/v68.0/connect/communities/')) return json(200, { id: url.split('/').pop(), siteUrl: 'https://acme.my.site.com/Alpine' });
    if (url.startsWith('/services/data/v68.0/commerce/order-management/webstores/')) return json(200, { success: true, errors: [], products: [] });
    return json(401, [{ errorCode: 'INVALID_SESSION_ID', message: 'Session expired or invalid' }]);
  };
  return { calls, platform: createPlatform({ fetchImpl, host: () => 'acme--c.my.salesforce.app', translate, onRequest, graphqlReads, ...(translateRows && { translateRows }), ...(describeDoc && { describeDoc }) }) };
}

test('queries and describes go to the Apex read endpoint with the CSRF token', async () => {
  const { calls, platform } = appDomain();
  const r = await platform.request(`/query?q=${encodeURIComponent('SELECT Id FROM OrderSummary')}`);
  assert.equal(r.records.length, 1);
  assert.equal((await platform.request('/sobjects/OrderSummary/describe')).name, 'OrderSummary');
  const apex = calls.filter((c) => c.url.includes('/apexrest/'));
  assert.deepEqual(apex.map((c) => c.url), ['/services/apexrest/somconsole/query?q=SELECT%20Id%20FROM%20OrderSummary', '/services/apexrest/somconsole/describe/OrderSummary']);
  assert.ok(apex.every((c) => c.token === 't1' && c.method === 'GET'));
});

test('a missing object is a 404, so om-core treats it as absent', async () => {
  const { platform } = appDomain();
  await assert.rejects(platform.request('/sobjects/Shipment/describe'), (e) => e.httpStatus === 404);
});

test('nothing but reads: POSTs and other resources are refused before any request', async () => {
  const { calls, platform } = appDomain();
  await assert.rejects(platform.request('/composite', { compositeRequest: [] }), (e) => e.httpStatus === 404);
  await assert.rejects(platform.request('/commerce/oci/availability/availability-records/actions/other', {}), (e) => e.httpStatus === 404);
  await assert.rejects(platform.request('/limits', {}), (e) => e.httpStatus === 404);
  assert.equal(calls.length, 0);
});

test('the two feature settings are answered from Apex (is SomConsoleConnect deployed), in the Tooling API shape; no other tooling read passes', async () => {
  const { platform } = appDomain();
  const q = (f, o) => `/tooling/query?q=${encodeURIComponent(`SELECT ${f} FROM ${o} LIMIT 1`)}`;
  assert.deepEqual(await platform.request(q('DeliveryEstimationEnabled', 'OrderManagementSettings')), { records: [{ DeliveryEstimationEnabled: false }] });
  assert.deepEqual(await platform.request(q('IsOmniChannelInventoryEnabled', 'InventorySettings')), { records: [{ IsOmniChannelInventoryEnabled: false }] });
  await assert.rejects(platform.request(q('Password', 'User')), (e) => e.httpStatus === 404);
});

test('the org limits come from Apex OrgLimits in the REST /limits shape; ?only=api is the cheap poll', async () => {
  const { calls, platform } = appDomain();
  const all = await platform.request('/limits');
  assert.equal(all.DailyApiRequests.Max, 100000);
  assert.equal(all.DataStorageMB.Remaining, -15636);
  assert.deepEqual(Object.keys(await platform.request('/limits?only=api')), ['DailyApiRequests']);
  assert.deepEqual(calls.filter((c) => c.url.includes('/apexrest/')).map((c) => [c.method, c.url]),
    [['GET', '/services/apexrest/somconsole/limits'], ['GET', '/services/apexrest/somconsole/limits?only=api']]);
  await assert.rejects(platform.request('/limits?only=other'), (e) => e.httpStatus === 404);
});

test('onRequest hears every call with its kind, timing, rows and the governor header', async () => {
  const seen = [];
  const { platform } = appDomain({ limitsHeader: 'rows=12/50000;queries=3/100;cpu=40/10000;heap=900/6000000;api=124/100000', onRequest: (x) => seen.push(x) });
  await platform.request(`/query?q=${encodeURIComponent('SELECT Id FROM OrderSummary')}`);
  await platform.request('/limits?only=api');
  assert.deepEqual(seen.map((x) => x.kind), ['ui-api', 'apex', 'apex'], 'the CSRF fetch counts too');
  const q = seen[1];
  assert.equal(q.method, 'GET');
  assert.equal(q.status, 200);
  assert.equal(q.rows, 1);
  assert.ok(q.ms >= 0 && q.t > 0);
  assert.match(q.path, /somconsole\/query\?q=/);
  assert.deepEqual(q.apex, { rows: 12, rowsMax: 50000, queries: 3, queriesMax: 100, cpu: 40, cpuMax: 10000, heap: 900, heapMax: 6000000, api: 124, apiMax: 100000 });
  assert.equal(seen[0].apex, null, 'the CSRF fetch has no governor header');
});

test('onRequest tolerates fakes without headers, tells batches from GETs, and never breaks a request', async () => {
  const seen = [];
  const { platform } = appDomain({ onRequest: (x) => { seen.push(x); throw new Error('listener bug'); } });
  const [a, b] = await Promise.all([platform.request(`/query?q=${encodeURIComponent('SELECT Id FROM A')}`), platform.request(`/query?q=${encodeURIComponent('SELECT Id FROM B')}`)]);
  assert.equal(a.records.length, 1);
  assert.equal(b.records.length, 1);
  const batch = seen.find((x) => x.kind === 'batch');
  assert.equal(batch.method, 'POST');
  assert.equal(batch.rows, 2);
  assert.equal(batch.apex, null, 'no headers on the response → null, not a crash');
});

test('a failed call is reported too, with its status', async () => {
  const seen = [];
  const { platform } = appDomain({ limitOn: true, onRequest: (x) => seen.push(x) });
  await assert.rejects(platform.request(`/query?q=${encodeURIComponent('SELECT COUNT(Id) FROM OrderSummary')}`));
  assert.ok(seen.some((x) => x.kind === 'apex' && x.status === 500));
});

test('parseLimits reads the header and ignores junk', () => {
  assert.deepEqual(parseLimits('rows=1/50000;api=5/9'), { rows: 1, rowsMax: 50000, api: 5, apiMax: 9 });
  assert.equal(parseLimits(null), null);
  assert.equal(parseLimits(undefined), null);
  assert.equal(parseLimits('nonsense'), null);
  assert.deepEqual(parseLimits('foo=1/2;heap=3/4'), { heap: 3, heapMax: 4 });
});

test('stock and delivery estimates, the two lookups the REST API makes as POSTs, go to SomConsoleRead as batch items', async () => {
  const { calls, platform } = appDomain();
  const stock = await platform.request('/commerce/oci/availability/availability-records/actions/get-availability', { locationIdentifiers: ['0160'], stockKeepingUnits: ['A'] });
  assert.deepEqual(stock.asked, { locationIdentifiers: ['0160'], stockKeepingUnits: ['A'] });
  const est = await platform.request('/commerce/delivery/estimation-setup/alpine%20west/estimate/estimate-date', { products: [] });
  assert.deepEqual(est.asked, { setup: 'alpine west', input: { products: [] } }, 'the setup reference arrives decoded');
  const sent = calls.filter((c) => c.url.endsWith('/somconsole/batch')).map((c) => JSON.parse(c.body).items);
  assert.deepEqual(sent.map((x) => Object.keys(x[0])), [['inventory'], ['estimate']]);
  assert.ok(!calls.some((c) => c.url.includes('/commerce/')), 'nothing goes to the Connect REST API');
});

test('the duplicate check of a new customer goes to SomConsoleRead as a batch item; the rules configuration isn’t available in-org', async () => {
  const { calls, platform } = appDomain();
  const fields = { RecordTypeId: '012000000000001AAA', LastName: 'New', PersonEmail: 'j@example.com' };
  const r = await platform.request('/ui-api/predupe', { apiName: 'Account', fields });
  assert.deepEqual(r.asked, { apiName: 'Account', fields });
  await assert.rejects(platform.request('/ui-api/predupe', { apiName: 'Contact', fields: { LastName: 'New' } }), /NO_ACTIVE_DUPLICATE_RULE/);
  const sent = calls.filter((c) => c.url.endsWith('/somconsole/batch')).map((c) => JSON.parse(c.body).items);
  assert.deepEqual(sent.map((x) => Object.keys(x[0])), [['duplicates'], ['duplicates']]);
  const before = calls.length;
  await assert.rejects(platform.request('/ui-api/duplicates/Account?recordTypeId=012000000000001AAA'), (e) => e.httpStatus === 404);
  assert.equal(calls.length, before, 'no call for what the app domain can’t answer');
});

test('Order Management’s product search and details go to SomConsoleRead as batch lookups; nothing calls Connect REST', async () => {
  const { calls, platform } = appDomain();
  const WS = '0ZEB0000000H6ZjOAK', ACC = '001Ws00003vvKfbIAE';
  const [search, details] = await Promise.all([platform.request(`/commerce/order-management/webstores/${WS}/products?searchTerm=chai&effectiveAccountId=${ACC}&page=0&pageSize=12`),
    platform.request(`/commerce/order-management/webstores/${WS}/products/6010000-6?effectiveAccountId=${ACC}&excludeMedia=true`)]);
  assert.deepEqual(search.asked, { store: WS, account: ACC, searchTerm: 'chai', page: 0, pageSize: 12 });
  assert.deepEqual(details.asked, { store: WS, account: ACC, sku: '6010000-6', excludeMedia: true, excludePrices: false });
  const batches = calls.filter((c) => c.url.endsWith('/somconsole/batch'));
  assert.equal(batches.length, 1, 'asked together, they go as one batch');
  assert.ok(!calls.some((c) => c.url.includes('/commerce/')), 'nothing goes to the Connect REST API');
  await assert.rejects(platform.request(`/commerce/webstores/${WS}/products/6010000-6?effectiveAccountId=${ACC}`), (e) => e.httpStatus === 404);
  await assert.rejects(platform.request(`/commerce/order-management/webstores/${WS}/products/a/b?x=1`), (e) => e.httpStatus === 404);
  await assert.rejects(platform.request(`/commerce/order-management/webstores/${WS}/products?searchTerm=x`, {}), (e) => e.httpStatus === 404);
});

test('a store’s site address (Connect’s communities) comes from the app domain, which answers it; nothing else under Connect does', async () => {
  const { calls, platform } = appDomain();
  const NET = '0DBB0000000CtXHOA0';
  assert.equal((await platform.request(`/connect/communities/${NET}`)).siteUrl, 'https://acme.my.site.com/Alpine');
  assert.deepEqual(calls.filter((c) => c.url.includes('/connect/')).map((c) => [c.url, c.method]), [[`/services/data/v68.0/connect/communities/${NET}`, 'GET']]);
  const before = calls.length;
  await assert.rejects(platform.request('/connect/communities'), (e) => e.httpStatus === 404);
  await assert.rejects(platform.request(`/connect/communities/${NET}/members`), (e) => e.httpStatus === 404);
  await assert.rejects(platform.request(`/connect/communities/${NET}`, {}), (e) => e.httpStatus === 404);
  assert.equal(calls.length, before);
});

test('an expired token is fetched again once', async () => {
  const { calls, platform } = appDomain({ expireOnce: true });
  const r = await platform.request(`/query?q=${encodeURIComponent('SELECT Id FROM OrderSummary')}`);
  assert.equal(r.totalSize, 1);
  assert.equal(calls.filter((c) => c.url.endsWith('/csrf')).length, 2);
});

test('console routes run through om-core, record links use the org domain, and status reads the signed-in user', async () => {
  const { platform } = appDomain();
  const order = await platform.route('/api/order-number/1');
  assert.equal(order.OrderNumber, '00000001');
  assert.equal(platform.instanceUrl(), 'https://acme.my.salesforce.com');
  assert.deepEqual(await platform.status(), { connected: true, username: 'admin@om.demo', instanceUrl: 'https://acme.my.salesforce.com', platform: true });
});

test('reads made at the same moment go out as one batch call, five at most, each answered on its own', async () => {
  const { calls, platform } = appDomain();
  const q = (n) => platform.request(`/query?q=${encodeURIComponent(`SELECT Id FROM OrderSummary LIMIT ${n}`)}`);
  const [a, b, missing] = await Promise.allSettled([q(1), q(2), platform.request('/sobjects/Nope__c/describe')]);
  assert.equal(a.value.q, 'SELECT Id FROM OrderSummary LIMIT 1');
  assert.equal(b.value.q, 'SELECT Id FROM OrderSummary LIMIT 2');
  assert.equal(missing.status, 'rejected'); assert.equal(missing.reason.httpStatus, 404);
  const posts = calls.filter((c) => c.url.endsWith('/batch'));
  assert.equal(posts.length, 1); assert.ok(posts.every((c) => c.token));
  calls.length = 0;
  await Promise.all(Array.from({ length: 12 }, (_, i) => q(i)));
  assert.deepEqual(calls.filter((c) => c.url.endsWith('/batch')).map((c) => JSON.parse(c.body).items.length), [5, 5, 2]);
});

test("Agentforce's chat goes through the Apex agent bridge and keeps the agent's session", async () => {
  const { calls, platform } = appDomain();
  const post = (url, body) => platform.route(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const { sessionId } = await post('/api/agent/session', {});
  const r1 = await post('/api/agent/message', { sessionId, text: 'What needs attention?' });
  assert.deepEqual(r1, { text: 'echo: What needs attention?', actions: [], guardHit: false });
  await post('/api/agent/message', { sessionId, text: 'And returns?' });
  const sent = calls.filter((c) => c.url.endsWith('/agent')).map((c) => JSON.parse(c.body));
  assert.deepEqual(sent, [{ text: 'What needs attention?', sessionId: null }, { text: 'And returns?', sessionId: 'agent-session-1' }]);
  assert.deepEqual(await platform.route(`/api/agent/session/${sessionId}`, { method: 'DELETE' }), { ok: true });
  await assert.rejects(post('/api/agent/message', { sessionId: 'nope', text: '' }), (e) => e.code === 400);
  await assert.rejects(platform.route('/api/anything', { method: 'POST' }), (e) => e.code === 404);
});

test("the agent's reply is shown as text even when it arrives wrapped as {type, value} JSON", async () => {
  const { unwrapReply } = await import("../../../public/operations-console/transport/platform.js");
  assert.equal(unwrapReply('{"type":"Text","value":"There are 322 orders."}'), 'There are 322 orders.');
  assert.equal(unwrapReply('[{"type":"Text","value":"A"},{"type":"Text","value":"B"}]'), 'A\n\nB');
  assert.equal(unwrapReply('Plain answer'), 'Plain answer');
  assert.equal(unwrapReply('{"not":"a reply"}'), '{"not":"a reply"}');
  assert.equal(unwrapReply(null), '');
});

// GraphQL route for aggregate SOQL.
const AGG = 'SELECT COUNT(Id) c FROM OrderSummary';
const aggQ = (n = 0) => `/query?q=${encodeURIComponent(`${AGG} WHERE X = ${n}`)}`;
const stub = (query = 'query { uiapi { aggregate { OrderSummary { edges { node { aggregate { Id { count { value } } } } } } } } }') => (soql) => (/COUNT\(/.test(soql)
  ? { query, map: (b) => ({ records: [{ c: b.data.c }], totalSize: 1, done: true }) } : null);
const isApex = (c) => c.url.includes('/apexrest/');
const isGql = (c) => c.url.endsWith('/graphql');

test('an aggregate goes to GraphQL once, with the CSRF token, and none to Apex', async () => {
  const { calls, platform } = appDomain({ gql: { data: { c: 42 } }, translate: stub() });
  const r = await platform.request(aggQ());
  assert.deepEqual(r, { records: [{ c: 42 }], totalSize: 1, done: true });
  const g = calls.filter(isGql);
  assert.equal(g.length, 1); assert.equal(g[0].method, 'POST'); assert.equal(g[0].token, 't1');
  assert.match(JSON.parse(g[0].body).query, /^\s*query\b/);
  assert.equal(calls.filter(isApex).length, 0);
});

test('a plain row query still goes to Apex', async () => {
  const { calls, platform } = appDomain({ translate: stub() });
  const r = await platform.request(`/query?q=${encodeURIComponent('SELECT Id FROM OrderSummary')}`);
  assert.equal(r.records.length, 1);
  assert.equal(calls.filter(isGql).length, 0); assert.equal(calls.filter(isApex).length, 1);
});

test('aggregates in the same tick are separate GraphQL calls, never batched', async () => {
  const { calls, platform } = appDomain({ gql: { data: { c: 1 } }, translate: stub() });
  await Promise.all([platform.request(aggQ(1)), platform.request(aggQ(2))]);
  assert.equal(calls.filter(isGql).length, 2); assert.equal(calls.filter(isApex).length, 0);
});

test('a GraphQL error is thrown and not retried through Apex', async () => {
  const { calls, platform } = appDomain({ gql: { data: null, errors: [{ message: 'Field X is not valid' }] }, translate: stub() });
  await assert.rejects(platform.request(aggQ()), (e) => /Field X is not valid/.test(e.message));
  assert.equal(calls.filter(isApex).length, 0);
});

test('a GraphQL schema or shape error falls back to Apex, with the text unescaped when it is thrown', async () => {
  for (const message of ["Validation error (FieldUndefined@[uiapi/aggregate/Refund]) : Field &#39;Refund&#39; in type &#39;RecordQueryAggregate&#39; is undefined", 'ui.services.exceptions.SObjectException: We couldn&#39;t find the record']) {
    const { calls, platform } = appDomain({ gql: { data: null, errors: [{ message }] }, translate: stub() });
    assert.ok((await platform.request(aggQ())).records);
    assert.equal(calls.filter(isGql).length, 1); assert.equal(calls.filter(isApex).length, 1);
  }
  const { platform } = appDomain({ gql: { data: null, errors: [{ message: 'Field &#39;X&#39; is not valid' }] }, translate: stub() });
  await assert.rejects(platform.request(aggQ()), (e) => e.message === "Field 'X' is not valid");
});

test('the guard refuses a document that is not a query or mentions mutation', async () => {
  for (const query of ['mutation { x }', 'query { a } mutation { b }', 'query { Mutation }', '{ uiapi { x } }']) {
    const { calls, platform } = appDomain({ translate: stub(query) });
    await assert.rejects(platform.request(aggQ()), (e) => e.httpStatus === 404);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  }
});

test('a 401 on GraphQL fetches a fresh CSRF token and retries once', async () => {
  const { calls, platform } = appDomain({ expireGraphqlOnce: true, gql: { data: { c: 7 } }, translate: stub() });
  const r = await platform.request(aggQ());
  assert.equal(r.records[0].c, 7);
  assert.equal(calls.filter((c) => c.url.endsWith('/csrf')).length, 2);
  assert.deepEqual(calls.filter(isGql).map((c) => c.token), ['t1', 't2']);
});

test('Apex row-limit errors, from /query or from a /batch item, become a friendly error with the raw text in detail', async () => {
  const msg = 'This range has too many records for the in-org console. Pick a shorter range, or open the console locally.';
  const friendly = (e) => e.message === msg && e.code === 400 && /LimitException: Too many query rows: 50001/.test(e.detail)
    && e.cause instanceof Error && e.cause.message === e.detail;
  const { platform } = appDomain({ limitOn: true });
  await assert.rejects(platform.request(`/query?q=${encodeURIComponent('SELECT Id FROM OrderSummary')}`), friendly);
  const q = (n) => platform.request(`/query?q=${encodeURIComponent(`SELECT Id FROM OrderSummary LIMIT ${n}`)}`);
  const [a, b] = await Promise.allSettled([q(1), q(2)]);
  assert.equal(a.status, 'rejected'); assert.ok(friendly(a.reason));
  assert.equal(b.status, 'fulfilled');
});

test('every request is a GET, an Apex read POST, or a GraphQL query POST', async () => {
  const { calls, platform } = appDomain({ gql: { data: { c: 1 } }, translate: stub() });
  const row = (n) => platform.request(`/query?q=${encodeURIComponent(`SELECT Id FROM OrderSummary LIMIT ${n}`)}`);
  await Promise.all([platform.request(aggQ()), row(1), row(2), platform.request('/sobjects/OrderSummary/describe')]);
  await platform.status();
  for (const c of calls.filter((x) => x.method === 'POST')) {
    if (isGql(c)) { const d = JSON.parse(c.body).query; assert.ok(/^\s*query\b/.test(d) && !/mutation/i.test(d)); }
    else assert.ok(c.url.endsWith('/apexrest/somconsole/batch'), c.url);
  }
  assert.ok(calls.some(isGql));
});

test('an aggregate left on Apex goes alone, so a row-limit failure cannot take its batch neighbours down', async () => {
  const { calls, platform } = appDomain();
  const row = (n) => platform.request(`/query?q=${encodeURIComponent(`SELECT Id FROM OrderSummary LIMIT ${n}`)}`);
  const agg = platform.request(`/query?q=${encodeURIComponent('SELECT CALENDAR_MONTH(CreatedDate), COUNT(Id) FROM OrderSummary GROUP BY CALENDAR_MONTH(CreatedDate)')}`);
  await Promise.all([row(1), agg, row(2)]);
  const batches = calls.filter((c) => c.url.endsWith('/batch')).map((c) => JSON.parse(c.body).items);
  assert.equal(batches.length, 1); assert.equal(batches[0].length, 2);
  assert.ok(batches[0].every((i) => !/COUNT/.test(i.q)));
  assert.equal(calls.filter((c) => c.url.includes('/somconsole/query?q=') && /COUNT/.test(decodeURIComponent(c.url))).length, 1);
});

test('a GraphQL result that cannot be complete falls back to Apex for that query only', async () => {
  const translate = () => ({ query: 'query{x}', map: () => { throw Object.assign(new Error('full'), { incomplete: true }); } });
  const { calls, platform } = appDomain({ translate });
  const r = await platform.request(`/query?q=${encodeURIComponent('SELECT COUNT(Id) c FROM OrderSummary')}`);
  assert.ok(r.records);
  assert.equal(calls.filter(isGql).length, 1); assert.equal(calls.filter(isApex).length, 1);
});

test('a multi-document translation posts every document in parallel and merges them in map()', async () => {
  const { calls, platform } = appDomain({ gql: { data: { c: 2 } }, translate: () => ({ queries: ['query{a}', 'query{b}', 'query{c}'], map: (bs) => ({ records: [{ c: bs.reduce((n, b) => n + b.data.c, 0) }], totalSize: 1, done: true }) }) });
  assert.equal((await platform.request(aggQ())).records[0].c, 6);
  assert.deepEqual(calls.filter(isGql).map((c) => JSON.parse(c.body).query), ['query{a}', 'query{b}', 'query{c}']);
  assert.equal(calls.filter(isApex).length, 0);
});

test('every document of a multi-document translation passes the query-only guard', async () => {
  const { calls, platform } = appDomain({ translate: () => ({ queries: ['query{a}', 'mutation{b}'], map: () => ({}) }) });
  await assert.rejects(platform.request(aggQ()), (e) => e.httpStatus === 404);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

test('a time series is translated with the user time zone, read once from the User record', async () => {
  const seen = [];
  const translate = (soql, ctx) => { seen.push(ctx); return { query: 'query{x}', map: () => ({ records: [], totalSize: 0, done: true }) }; };
  const { calls, platform } = appDomain({ gql: { data: { uiapi: { query: { User: { edges: [{ node: { TimeZoneSidKey: { value: 'America/Los_Angeles' } } }] } } } } }, translate });
  const series = `/query?q=${encodeURIComponent('SELECT DAY_ONLY(convertTimezone(OrderedDate)), COUNT(Id) c FROM OrderSummary GROUP BY DAY_ONLY(convertTimezone(OrderedDate))')}`;
  await platform.request(series); await platform.request(series);
  assert.deepEqual(seen, [{ timeZone: 'America/Los_Angeles' }, { timeZone: 'America/Los_Angeles' }]);
  assert.equal(calls.filter((c) => c.url.endsWith('/chatter/users/me')).length, 1);
  await platform.request(aggQ()); // not a series: no zone lookup, no ctx
  assert.equal(seen[2], undefined);
});

test('when the time zone cannot be read the series is translated without one (so it stays on Apex)', async () => {
  const seen = [];
  const { platform } = appDomain({ gql: { data: {} }, translate: (s, ctx) => { seen.push(ctx); return null; } });
  await platform.request(`/query?q=${encodeURIComponent('SELECT HOUR_IN_DAY(convertTimezone(OrderedDate)), COUNT(Id) c FROM OrderSummary GROUP BY HOUR_IN_DAY(convertTimezone(OrderedDate))')}`);
  assert.deepEqual(seen, [{ timeZone: null }]);
});

// The console has no actions: it is built without om-actions, so nothing turns the relay on and its routes and relay reads are
// refused before any request leaves the page.
test('the console has no actions: enableActions, /api/cs/action, API access and relay reads are refused before any request', async () => {
  const calls = [];
  const json = (status, body) => ({ status, ok: status < 300, json: async () => body });
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (url.endsWith('/ui-api/session/csrf')) return json(200, { csrfToken: 't1' });
    if (url.endsWith('/apexrest/somservice/call')) return json(200, { status: 200, body: { success: true } });
    return json(404, [{ errorCode: 'NOT_FOUND', message: 'nope' }]);
  };
  const platform = createPlatform({ fetchImpl, host: () => 'acme--c.my.salesforce.app' });
  assert.throws(() => platform.enableActions(), (e) => e.code === 404 || e.httpStatus === 404);
  await assert.rejects(platform.route('/api/cs/action', { method: 'POST', body: JSON.stringify({ op: 'cancel.preview' }) }), (e) => (e.code ?? e.httpStatus) === 404);
  await assert.rejects(platform.route('/api/cs/api-access'), (e) => (e.code ?? e.httpStatus) === 404);
  const FO = '0a3Ws000000AbCdIAK';
  await assert.rejects(platform.request(`/commerce/fulfillment/fulfillment-orders/${FO}/routing-explanation`), (e) => e.httpStatus === 404);
  await assert.rejects(platform.request('/commerce/delivery/estimation-setup/alpine/estimate/bopis', { products: [] }), (e) => e.httpStatus === 404);
  assert.equal(calls.filter((c) => c.url.endsWith('/somservice/call')).length, 0, 'the console never calls the relay');
  assert.ok(!calls.some((c) => c.url.includes('/commerce/')), 'nothing goes to the Connect REST API from the app domain');
});

test('orgDomainUrl maps the app domain to the org\'s own domain, keeping a scratch or sandbox label', () => {
  assert.equal(orgDomainUrl('acme--c.my.salesforce.app'), 'https://acme.my.salesforce.com');
  assert.equal(orgDomainUrl('platform-ability-5146--c.scratch.my.salesforce.app'), 'https://platform-ability-5146.scratch.my.salesforce.com');
  // A sandbox's My Domain contains `--` itself: only the last one before the first dot is the namespace.
  assert.equal(orgDomainUrl('acme--sbx1--c.sandbox.my.salesforce.app'), 'https://acme--sbx1.sandbox.my.salesforce.com');
  assert.equal(createPlatform({ host: () => 'platform-ability-5146--c.scratch.my.salesforce.app' }).instanceUrl(), 'https://platform-ability-5146.scratch.my.salesforce.com');
});

// ---- row reads and describes through GraphQL (graphqlReads) ----
const ROWS = `/query?q=${encodeURIComponent('SELECT Id, OrderNumber FROM OrderSummary')}`;
const rowsAnswer = (object, nodes) => ({ data: { uiapi: { query: { [object]: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: false } } } } } });
const gqlCalls = (calls) => calls.filter((c) => c.url.endsWith('/graphql'));
const apexCalls = (calls) => calls.filter((c) => c.url.includes('/apexrest/'));
const validation = (path) => ({ errors: [{ message: `Validation error (FieldUndefined@[${path}]) : Field is undefined` }] });

test('with graphqlReads, a row query goes to GraphQL and none to Apex', async () => {
  const { calls, platform } = appDomain({ graphqlReads: true, gql: rowsAnswer('OrderSummary', [{ Id: '1Os000000000001AAA', OrderNumber: { value: '00000001' } }]) });
  const r = await platform.request(ROWS);
  assert.equal(gqlCalls(calls).length, 1);
  assert.equal(gqlCalls(calls)[0].token, 't1');
  assert.equal(apexCalls(calls).length, 0);
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].OrderNumber, '00000001');
  assert.equal(r.totalSize, 1);
});

test('with graphqlReads, a describe is one objectInfos read in the REST describe shape', async () => {
  const { calls, platform } = appDomain({ graphqlReads: true, gql: { data: { uiapi: { objectInfos: [{ ApiName: 'OrderSummary', createable: false, fields: [{ ApiName: 'Id', relationshipName: null, referenceToInfos: [] }] }] } } } });
  const r = await platform.request('/sobjects/OrderSummary/describe');
  assert.equal(gqlCalls(calls).length, 1);
  assert.ok(JSON.parse(gqlCalls(calls)[0].body).query.startsWith('query{uiapi{objectInfos('));
  assert.equal(r.fields[0].name, 'Id');
  assert.equal(apexCalls(calls).length, 0);
});

test('an object GraphQL does not know goes to Apex, and stays there for the page', async () => {
  const { calls, platform } = appDomain({ graphqlReads: true, gql: validation('uiapi/query/Refund') });
  const q = `/query?q=${encodeURIComponent('SELECT Id FROM Refund')}`;
  await platform.request(q);
  assert.equal(gqlCalls(calls).length, 1);
  assert.equal(apexCalls(calls).length, 1);
  await platform.request(q);
  assert.equal(gqlCalls(calls).length, 1);
  assert.equal(apexCalls(calls).length, 2);
});

test('a user-hidden field falls back to Apex for that read', async () => {
  let bad = true;
  const { calls, platform } = appDomain({ graphqlReads: true, gql: () => (bad ? validation('uiapi/query/OrderSummary/edges/node/Secret__c') : rowsAnswer('OrderSummary', [{ Id: 'x', OrderNumber: { value: '1' } }])) });
  await platform.request(`/query?q=${encodeURIComponent('SELECT Id, Secret__c FROM OrderSummary')}`);
  assert.equal(gqlCalls(calls).length, 1);
  assert.equal(apexCalls(calls).length, 1);
  bad = false;
  await platform.request(ROWS);
  assert.equal(gqlCalls(calls).length, 2);
  assert.equal(apexCalls(calls).length, 1);
});

test('objectInfos without info for an object asks Apex, whose 404 says the org lacks it', async () => {
  const gql = { data: { uiapi: { objectInfos: [null] } }, errors: [{ message: 'No ObjectInfo found for Missing__c', path: ['uiapi', 'objectInfos', 0] }] };
  const { calls, platform } = appDomain({ graphqlReads: true, gql });
  await assert.rejects(platform.request('/sobjects/Missing__c/describe'), (e) => e.httpStatus === 404);
  assert.equal(gqlCalls(calls).length, 1);
  assert.equal(apexCalls(calls).length, 1);
});

test('a GraphQL server error on a row read is thrown, not retried through Apex', async () => {
  const { calls, platform } = appDomain({ graphqlReads: true, gql: { errors: [{ message: 'boom' }] } });
  await assert.rejects(platform.request(ROWS), /boom/);
  assert.equal(apexCalls(calls).length, 0);
});

test('without the switch, rows and describes still go to Apex', async () => {
  const { calls, platform } = appDomain();
  await platform.request(ROWS);
  await platform.request('/sobjects/OrderSummary/describe');
  assert.equal(gqlCalls(calls).length, 0);
  assert.equal(apexCalls(calls).length, 2);
});

test('a row document that would trip the query-only guard goes to Apex, nothing is posted to GraphQL', async () => {
  const { calls, platform } = appDomain({ graphqlReads: true, translateRows: () => ({ query: 'mutation{x}', object: 'OrderSummary', map: () => ({}) }) });
  const r = await platform.request(ROWS);
  assert.equal(r.records[0].Id, '1Os000000000001AAA');
  assert.equal(gqlCalls(calls).length, 0);
  assert.equal(apexCalls(calls).length, 1);
});

test('a search for "mutation" is answered by Apex with the switch on', async () => {
  const { calls, platform } = appDomain({ graphqlReads: true });
  const r = await platform.request(`/query?q=${encodeURIComponent("SELECT Id, Name FROM Product2 WHERE Name LIKE '%mutation%'")}`);
  assert.equal(r.records[0].Id, '1Os000000000001AAA');
  assert.equal(gqlCalls(calls).length, 0);
  assert.equal(apexCalls(calls).length, 1);
});

// ---- reads in the same tick share GraphQL requests ----
const rowsOf = (n) => `/query?q=${encodeURIComponent(`SELECT Id, OrderNumber FROM OrderSummary WHERE OrderNumber = '${n}'`)}`;
const aliasesOf = (call) => [...JSON.parse(call.body).query.matchAll(/\br(\d+):/g)].map((m) => `r${m[1]}`);
const conn = (n, tag) => ({ edges: Array.from({ length: n }, (_, i) => ({ node: { Id: `${tag}${i}`, OrderNumber: { value: tag } } })), pageInfo: { hasNextPage: false } });

test('row reads in the same tick share one GraphQL document, ten at most', async () => {
  let n = 0;
  const { calls, platform } = appDomain({ graphqlReads: true, gql: (b) => {
    const k = n++;
    return { data: { uiapi: { query: Object.fromEntries([...b.query.matchAll(/\br(\d+):/g)].map((m) => [`r${m[1]}`, conn(1, `${k}-r${m[1]}`)])) } } };
  } });
  const out = await Promise.all(Array.from({ length: 12 }, (_, i) => platform.request(rowsOf(i))));
  assert.equal(gqlCalls(calls).length, 2);
  assert.equal(apexCalls(calls).length, 0);
  assert.deepEqual(aliasesOf(gqlCalls(calls)[0]), Array.from({ length: 10 }, (_, i) => `r${i}`));
  assert.deepEqual(aliasesOf(gqlCalls(calls)[1]), ['r0', 'r1']);
  out.forEach((r, i) => assert.equal(r.records[0].OrderNumber, i < 10 ? `0-r${i}` : `1-r${i - 10}`));
});

test('describes in the same tick share one objectInfos, twenty at most', async () => {
  const { calls, platform } = appDomain({ graphqlReads: true, gql: (b) => ({ data: { uiapi: { objectInfos: JSON.parse(b.query.match(/apiNames:(\[.*?\])/)[1]).map((ApiName) => ({ ApiName, createable: false, fields: [{ ApiName: 'Id', relationshipName: null, referenceToInfos: [] }] })) } } }) });
  const names = Array.from({ length: 21 }, (_, i) => `Obj${i}__c`);
  const out = await Promise.all(names.map((nm) => platform.request(`/sobjects/${nm}/describe`)));
  assert.equal(gqlCalls(calls).length, 2);
  assert.equal(apexCalls(calls).length, 0);
  out.forEach((r, i) => assert.equal(r.name, names[i]));
});

test('one unknown object in a merged document costs only its own read', async () => {
  const { calls, platform } = appDomain({ graphqlReads: true, gql: (b) => {
    if (/\br0:/.test(b.query)) return validation('uiapi/query/r1');
    if (b.query.includes('Refund(')) return validation('uiapi/query/Refund');
    const object = b.query.match(/query\{uiapi\{query\{(\w+)\(/)[1];
    return rowsAnswer(object, [{ Id: 'x', OrderNumber: { value: '1' } }]);
  } });
  const q = (o) => `/query?q=${encodeURIComponent(`SELECT Id FROM ${o}`)}`;
  const out = await Promise.all([platform.request(q('OrderSummary')), platform.request(q('Refund')), platform.request(q('Account'))]);
  assert.equal(gqlCalls(calls).length, 4);
  assert.equal(apexCalls(calls).length, 1);
  assert.equal(out[0].records[0].Id, 'x');
  assert.equal(out[2].records[0].Id, 'x');
  assert.equal(out[1].records.length, 1); // Apex's answer
  await platform.request(q('Refund')); // remembered: straight to Apex
  assert.equal(gqlCalls(calls).length, 4);
});

test('an error on one alias fails only that read', async () => {
  const gql = { data: { uiapi: { query: { r0: conn(1, 'a'), r1: null, r2: conn(1, 'c') } } },
    errors: [{ message: 'Validation error (FieldUndefined@[uiapi/query/r1/edges/node/Secret__c]) : Field is undefined', path: ['uiapi', 'query', 'r1'] }] };
  const { calls, platform } = appDomain({ graphqlReads: true, gql });
  const out = await Promise.all([0, 1, 2].map((i) => platform.request(rowsOf(i))));
  assert.equal(gqlCalls(calls).length, 1);
  assert.equal(apexCalls(calls).length, 1);
  assert.equal(out[0].records[0].OrderNumber, 'a');
  assert.equal(out[2].records[0].OrderNumber, 'c');
  assert.equal(out[1].records[0].Id, '1Os000000000001AAA'); // Apex's answer
});

test('the meter counts rows over every alias', async () => {
  const seen = [];
  const { platform } = appDomain({ graphqlReads: true, onRequest: (e) => seen.push(e), gql: { data: { uiapi: { query: { r0: conn(2, 'a'), r1: conn(3, 'b') } } } } });
  await Promise.all([platform.request(rowsOf(0)), platform.request(rowsOf(1))]);
  assert.equal(seen.find((e) => e.kind === 'graphql').rows, 5);
});

test('the meter counts a multi-alias aggregate by its first value, and a merged row read by every alias', async () => {
  const edges = (n) => ({ edges: Array.from({ length: n }, () => ({ node: {} })) });
  const aggSeen = [];
  const a = appDomain({ onRequest: (e) => aggSeen.push(e), translate: stub(), gql: { data: { uiapi: { aggregate: { b0: edges(2), b1: edges(3) } } } } });
  await a.platform.request(aggQ());
  assert.equal(aggSeen.find((e) => e.kind === 'graphql').rows, 2);
  const rowSeen = [];
  const r = appDomain({ graphqlReads: true, onRequest: (e) => rowSeen.push(e), gql: { data: { uiapi: { query: { r0: conn(2, 'a'), r1: conn(3, 'b') } } } } });
  await Promise.all([r.platform.request(rowsOf(0)), r.platform.request(rowsOf(1))]);
  assert.equal(rowSeen.find((e) => e.kind === 'graphql').rows, 5);
});

test('the console turns GraphQL reads on with ?reads=graphql', async () => {
  const { readFile } = await import("../../support/source-promises.mjs");
  const page = await readFile(new URL("../../../public/operations-console/index.html", import.meta.url), 'utf8');
  assert.ok(page.includes('graphqlReads:'));
  assert.ok(page.includes("get('reads') === 'graphql'"));
  assert.ok(page.includes("import('./om-command-platform.js')"));
});

// ---- errors in a merged document are attributed by object and field ----
const ATTACHED = 'Validation error (FieldUndefined@[uiapi/query/ProcessException/edges/node/AttachedTo/Name]) : Field &#39;Name&#39; in type &#39;ProcessException_AttachedTo&#39; is undefined @[]';
const NO_REFUND = 'Validation error (FieldUndefined@[uiapi/query/Refund]) : Field &#39;Refund&#39; in type &#39;RecordQuery&#39; is undefined @[]';
const pathless = (message) => ({ data: null, errors: [{ message, path: [] }] });
const qOf = (soql) => `/query?q=${encodeURIComponent(soql)}`;
const objectsOf = (call) => [...JSON.parse(call.body).query.matchAll(/\br\d+:(\w+)\(/g)].map((m) => m[1]);
const three = (platform) => Promise.all([
  platform.request(qOf('SELECT Id, AttachedTo.Name FROM ProcessException')),
  platform.request(qOf('SELECT Id FROM Case')),
  platform.request(qOf('SELECT Id FROM OrderSummary'))]);
// Answers a merged document with data for every alias unless it holds the refused read.
const attachedGql = (b) => {
  if (b.query.includes('AttachedTo')) return pathless(ATTACHED);
  const aliases = [...b.query.matchAll(/\br(\d+):/g)];
  if (!aliases.length) return rowsAnswer(b.query.match(/query\{uiapi\{query\{(\w+)\(/)[1], [{ Id: 'ok' }]); // a lone read
  return { data: { uiapi: { query: Object.fromEntries(aliases.map((m) => [`r${m[1]}`, conn(1, 'ok')])) } } };
};

test('a field GraphQL refuses in a merged document sends only its read to Apex, and the rest go again together once', async () => {
  const { calls, platform } = appDomain({ graphqlReads: true, gql: attachedGql });
  const out = await three(platform);
  assert.equal(gqlCalls(calls).length, 2);
  assert.deepEqual(gqlCalls(calls).map((c) => objectsOf(c)), [['ProcessException', 'Case', 'OrderSummary'], ['Case', 'OrderSummary']]);
  assert.equal(apexCalls(calls).length, 1);
  assert.equal(out[0].records[0].Id, '1Os000000000001AAA'); // Apex's answer
  assert.equal(out[1].records[0].Id, 'ok0');
  assert.equal(out[2].records[0].Id, 'ok0');
});

test('the refused field is remembered: the next load skips GraphQL for that read', async () => {
  const { calls, platform } = appDomain({ graphqlReads: true, gql: attachedGql });
  await three(platform);
  const before = { g: gqlCalls(calls).length, a: apexCalls(calls).length };
  await three(platform);
  assert.equal(gqlCalls(calls).length - before.g, 1);
  assert.deepEqual(aliasesOf(gqlCalls(calls).at(-1)), ['r0', 'r1']);
  assert.equal(apexCalls(calls).length - before.a, 1);
});

test('an unknown object in a merged document is attributed the same way', async () => {
  const { calls, platform } = appDomain({ graphqlReads: true, gql: (b) => (b.query.includes('Refund(') ? pathless(NO_REFUND) : attachedGql(b)) });
  const out = await Promise.all([platform.request(qOf('SELECT Id FROM Refund')), platform.request(qOf('SELECT Id FROM Case'))]);
  assert.equal(gqlCalls(calls).length, 2);
  assert.equal(apexCalls(calls).length, 1);
  assert.equal(out[1].records[0].Id, 'ok');
  await platform.request(qOf('SELECT Id FROM Refund'));
  await platform.request('/sobjects/Refund/describe').catch(() => {});
  assert.equal(gqlCalls(calls).length, 2); // neither the rows nor the describe tried GraphQL again
});

test('an error that names nothing in the document keeps each read alone', async () => {
  const { calls, platform } = appDomain({ graphqlReads: true, gql: (b) => (/\br0:/.test(b.query) ? pathless('Validation error (FieldUndefined@[uiapi/query/Account]) : Field is undefined @[]')
    : rowsAnswer(b.query.match(/query\{uiapi\{query\{(\w+)\(/)[1], [{ Id: 'x', OrderNumber: { value: '1' } }])) });
  await Promise.all([platform.request(qOf('SELECT Id FROM Case')), platform.request(qOf('SELECT Id FROM OrderSummary'))]);
  assert.equal(gqlCalls(calls).length, 3); // the merged one, then one each
  assert.equal(apexCalls(calls).length, 0);
});

test('a single read refused for a field remembers the field', async () => {
  const { calls, platform } = appDomain({ graphqlReads: true, gql: pathless(ATTACHED) });
  const q = qOf('SELECT Id, AttachedTo.Name FROM ProcessException');
  await platform.request(q);
  assert.equal(gqlCalls(calls).length, 1);
  assert.equal(apexCalls(calls).length, 1);
  await platform.request(q);
  assert.equal(gqlCalls(calls).length, 1);
  assert.equal(apexCalls(calls).length, 2);
});

test('a read whose document would trip the guard stays out of a shared document', async () => {
  const { calls, platform } = appDomain({ graphqlReads: true, gql: (b) => ({ data: { uiapi: { query: Object.fromEntries([...b.query.matchAll(/\br(\d+):/g)].map((m) => [`r${m[1]}`, conn(1, 'ok')])) } } }) });
  const out = await Promise.all([
    platform.request(qOf('SELECT Id FROM Case')),
    platform.request(qOf("SELECT Id FROM Product2 WHERE Name LIKE '%mutation%'")),
    platform.request(qOf('SELECT Id FROM OrderSummary'))]);
  assert.equal(gqlCalls(calls).length, 1);
  assert.deepEqual(objectsOf(gqlCalls(calls)[0]), ['Case', 'OrderSummary']);
  assert.equal(apexCalls(calls).length, 1);
  assert.equal(out[1].records[0].Id, '1Os000000000001AAA');
  assert.equal(out[0].records[0].Id, 'ok0');
});

test('a refused relationship itself is learned: the next load skips GraphQL for the read', async () => {
  const NO_REL = 'Validation error (FieldUndefined@[uiapi/query/Case/edges/node/Provider]) : Field &#39;Provider&#39; in type &#39;Case&#39; is undefined @[]';
  const { calls, platform } = appDomain({ graphqlReads: true, gql: (b) => (b.query.includes('Provider') ? pathless(NO_REL)
    : { data: { uiapi: { query: Object.fromEntries([...b.query.matchAll(/\br(\d+):/g)].map((m) => [`r${m[1]}`, conn(1, 'ok')])) } } }) });
  const load = () => Promise.all([platform.request(qOf('SELECT Id, Provider.Name FROM Case')), platform.request(qOf('SELECT Id FROM OrderSummary')), platform.request(qOf('SELECT Id FROM Account'))]);
  await load();
  assert.equal(gqlCalls(calls).length, 2);
  assert.equal(apexCalls(calls).length, 1);
  await load();
  assert.equal(gqlCalls(calls).length, 3);
  assert.equal(apexCalls(calls).length, 2);
});
