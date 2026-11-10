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
import { fakeOrg } from "../../support/fake-org.mjs";
import { createMeter, kindOf, parseLimitsHeader, normalize } from "../../../public/shared/transport/om-meter.js";

const f = (...names) => names.map((name) => ({ name }));
const SCHEMA = {
  TenantUsageEntitlement: f('Id', 'MasterLabel', 'Setting', 'Frequency', 'CurrentAmountAllowed', 'AmountUsed', 'UsageDate'),
  UserLicense: f('Id', 'Name', 'Status', 'TotalLicenses', 'UsedLicenses'),
  PermissionSetLicense: f('Id', 'MasterLabel', 'TotalLicenses', 'UsedLicenses', 'ExpirationDate'),
  AsyncApexJob: f('Id', 'Status', 'JobType', 'CreatedDate'),
};
const LIMITS = { DailyApiRequests: { Max: 100000, Remaining: 99876 }, DataStorageMB: { Max: 10640, Remaining: -15636 } };
const ENTITLEMENT = { MasterLabel: 'Lightning Order Management Order Summary Entitlements', Setting: 'setting/force.com/orgValue.LOMOrderSummaryTotal', Frequency: 'Once', CurrentAmountAllowed: 20000, AmountUsed: null, UsageDate: null };
const QUERIES = [
  [/FROM TenantUsageEntitlement/, [ENTITLEMENT, { MasterLabel: 'API Request Limit per Month', Setting: 'setting/force.com/orgValue.Provisioned30DayApiRequests', Frequency: 'Monthly', CurrentAmountAllowed: 3000000, AmountUsed: 12 }]],
  [/COUNT\(Id\) c FROM OrderSummary/, [{ c: 1730822 }]],
  [/FROM UserLicense/, [{ Name: 'Salesforce', Status: 'Active', TotalLicenses: 10, UsedLicenses: 11 }]],
  [/FROM PermissionSetLicense/, [{ MasterLabel: 'Operations Console', TotalLicenses: 20, UsedLicenses: 0, ExpirationDate: null }]],
  [/FROM AsyncApexJob/, [{ s: 'Completed', t: 'Queueable', c: 7 }, { s: 'Failed', t: 'Queueable', c: 1 }]],
];
const org = (o = {}) => fakeOrg({ objects: ['OrderSummary', ...Object.keys(SCHEMA)], schema: SCHEMA, queries: QUERIES, limits: LIMITS, ...o });

// ---------- /api/limits ----------

test('limits route: org limits, entitlements, licences, jobs and the order count', async () => {
  const r = await org().core.route('/api/limits');
  assert.match(r.at, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(r.org, { ok: true, data: LIMITS });
  assert.equal(r.entitlements.data.length, 2);
  assert.deepEqual(r.licenses.data.user, [{ Name: 'Salesforce', Status: 'Active', TotalLicenses: 10, UsedLicenses: 11 }]);
  assert.equal(r.licenses.data.permissionSet[0].MasterLabel, 'Operations Console');
  assert.deepEqual(r.jobs.data, [{ status: 'Completed', type: 'Queueable', n: 7 }, { status: 'Failed', type: 'Queueable', n: 1 }]);
  assert.deepEqual(r.orderSummary, { ok: true, data: { count: 1730822 } });
});

test('limits route: the order summary entitlement shows the OrderSummary count as used; others keep their own', async () => {
  const { entitlements } = await org().core.route('/api/limits');
  const lom = entitlements.data.find((e) => /LOMOrderSummaryTotal$/.test(e.Setting)), other = entitlements.data.find((e) => e.AmountUsed === 12);
  assert.equal(lom.AmountUsed, 1730822);
  assert.equal(lom.usedFrom, 'OrderSummary count');
  assert.equal(lom.CurrentAmountAllowed, 20000);
  assert.ok(other && !other.usedFrom);
});

test('limits route: an entitlement that reports its own usage is not overwritten by the count', async () => {
  const o = org({ queries: [[/FROM TenantUsageEntitlement/, [{ ...ENTITLEMENT, AmountUsed: 5 }]], ...QUERIES] });
  assert.equal((await o.core.route('/api/limits')).entitlements.data[0].AmountUsed, 5);
});

test('limits route: only=api is one call and returns just DailyApiRequests', async () => {
  const o = org();
  const r = await o.core.route('/api/limits?only=api');
  assert.deepEqual(r.org, { ok: true, data: { DailyApiRequests: LIMITS.DailyApiRequests } });
  assert.deepEqual(Object.keys(r).sort(), ['at', 'org']);
  assert.deepEqual(o.calls, ['/limits']);
});

test('limits route: one part failing leaves the others', async () => {
  const noLimits = await org({ limits: null }).core.route('/api/limits');
  assert.equal(noLimits.org.ok, false);
  assert.equal(noLimits.entitlements.ok, true);
  assert.equal(noLimits.licenses.ok, true);
  const noJobs = await org({ queries: QUERIES.map(([re, rows]) => [re, /AsyncApexJob/.test(re) ? () => { throw new Error('QUERY_TIMEOUT'); } : rows]) }).core.route('/api/limits');
  assert.deepEqual(noJobs.jobs, { ok: false, error: 'QUERY_TIMEOUT' });
  assert.equal(noJobs.org.ok, true);
  assert.equal(noJobs.orderSummary.ok, true);
});

test('limits route: objects the org lacks give null and are never queried', async () => {
  const o = org({ objects: ['OrderSummary'] });
  const r = await o.core.route('/api/limits');
  for (const k of ['entitlements', 'jobs']) assert.deepEqual(r[k], { ok: true, data: null }, k);
  assert.deepEqual(r.licenses, { ok: true, data: { user: null, permissionSet: null } });
  assert.equal(r.orderSummary.data.count, 1730822);
  assert.equal(o.soql().filter((q) => /TenantUsageEntitlement|UserLicense|PermissionSetLicense|AsyncApexJob/.test(q)).length, 0);
  const noOrders = await org({ objects: ['TenantUsageEntitlement'] }).core.route('/api/limits');
  assert.deepEqual(noOrders.orderSummary, { ok: true, data: null });
  assert.equal(noOrders.entitlements.data[0].AmountUsed, null, 'no count to show, so usage stays unknown');
});

test('limits route: selects only the fields the org has, and licence queries skip unlicensed rows', async () => {
  const o = org({ schema: { ...SCHEMA, UserLicense: f('Id', 'Name', 'TotalLicenses', 'UsedLicenses') } });
  await o.core.route('/api/limits');
  const q = o.soql().find((x) => /FROM UserLicense/.test(x));
  assert.match(q, /^SELECT Name, TotalLicenses, UsedLicenses FROM UserLicense WHERE TotalLicenses > 0 ORDER BY Name/);
});

test('limits route stays read-only: no POST, only /limits and queries', async () => {
  const o = org();
  await o.core.route('/api/limits');
  assert.ok(o.calls.every((c) => c === '/limits' || c.startsWith('/query') || c.startsWith('/sobjects/')), o.calls.join('\n'));
});

// ---------- meter ----------

// Two meters on one channel name hear each other, as two tabs do.
function hub() {
  const peers = new Set();
  return class FakeChannel {
    constructor(name) { this.name = name; peers.add(this); }
    postMessage(data) { for (const p of peers) if (p !== this && p.name === this.name) p.onmessage?.({ data: structuredClone(data) }); }
    close() { peers.delete(this); }
  };
}
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const clock = (t = 1_800_000_000_000) => { const c = { t, now: () => c.t }; return c; };
const meterWith = (o = {}) => { const c = clock(); return { c, m: createMeter({ now: c.now, storage: memory(), bc: null, ...o }) }; };

test('kindOf classifies paths', () => {
  const k = {
    '/services/apexrest/somconsole/batch': 'batch', '/services/apexrest/somconsole/query?q=x': 'apex', '/services/apexrest/somservice/call': 'action',
    '/services/data/v68.0/graphql': 'graphql', '/commerce/oci/availability': 'connect', '/ui-api/session/csrf': 'ui-api', '/query?q=SELECT+Id': 'ui-api', '/composite': 'ui-api', '': 'ui-api',
  };
  for (const [p, kind] of Object.entries(k)) assert.equal(kindOf(p), kind, p);
});

test('parseLimitsHeader reads used/max pairs and bare values', () => {
  assert.deepEqual(parseLimitsHeader('rows=120/50000;queries=4/100;cpu=35;heap=2048/6000000;api=124/100000'),
    { rows: 120, rowsMax: 50000, queries: 4, queriesMax: 100, cpu: 35, heap: 2048, heapMax: 6000000, api: 124, apiMax: 100000 });
  assert.equal(parseLimitsHeader(''), null);
  assert.equal(parseLimitsHeader('nonsense'), null);
  const o = { rows: 1 };
  assert.equal(parseLimitsHeader(o), o);
});

test('normalize never keeps query text: the path is cut at ?, only the SOQL object survives', () => {
  const e = normalize({ t: 1, path: `/query?q=${encodeURIComponent("SELECT Id FROM Account WHERE Email = 'jane@example.com'")}`, ms: 12.4, status: 200 });
  assert.equal(e.path, '/query');
  assert.equal(e.object, 'Account');
  assert.equal(e.ms, 12);
  assert.ok(!JSON.stringify(e).includes('jane'));
  assert.equal(normalize({ path: '/x', kind: 'bogus' }, () => 5).t, 5);
});

test('record fills the snapshot: recent entries newest first, buckets, kinds, percentiles, heaviest, slowest', () => {
  const { c, m } = meterWith();
  const ms = [10, 20, 30, 40, 100];
  ms.forEach((x, i) => { c.t += 1000; m.record({ t: c.t, path: '/services/apexrest/somconsole/batch', ms: x, status: i === 4 ? 500 : 200, rows: i, apex: `rows=${i * 1000}/50000`, source: i % 2 ? 'dashboard' : 'console' }); });
  c.t += 1000; m.record({ t: c.t, path: '/services/data/v68.0/graphql', ms: 5, status: 200 });
  const s = m.snapshot();
  assert.equal(s.entries.length, 6);
  assert.equal(s.entries[0].kind, 'graphql', 'newest first');
  assert.deepEqual(s.byKind.batch, { n: 5, errors: 1, ms: 200 });
  assert.equal(s.byKind.graphql.n, 1);
  assert.deepEqual(s.bySource, { console: 3, dashboard: 2 });
  assert.equal(s.totals.n, 6);
  assert.equal(s.totals.errors, 1);
  assert.equal(s.totals.p50, 20, 'nearest rank of 5,10,20,30,40,100');
  assert.equal(s.totals.p95, 100);
  assert.equal(s.totals.peakRows, 4000);
  assert.equal(s.heaviest.apex.rows, 4000);
  assert.equal(s.slowest.ms, 100);
  assert.equal(s.perSecond.length, 900);
  assert.equal(s.perMinute.length, 60);
  assert.equal(s.perSecond.reduce((a, b) => a + b.n, 0), 6);
  assert.equal(s.perMinute.reduce((a, b) => a + b.n, 0), 6);
  assert.equal(s.perSecond.at(-1).t, Math.floor(c.t / 1000) * 1000, 'last bucket is the current second');
  assert.equal(s.perSecond.at(-1).n, 1);
});

test('snapshot keeps only the newest 50 entries', () => {
  const { c, m } = meterWith();
  for (let i = 0; i < 120; i++) { c.t += 10; m.record({ t: c.t, path: `/p${i}`, ms: 1, status: 200 }); }
  const s = m.snapshot();
  assert.equal(s.entries.length, 50);
  assert.equal(s.entries[0].path, '/p119');
  assert.equal(s.totals.n, 120);
});

test('the ring drops entries older than 60 minutes and caps at 2000', () => {
  const { c, m } = meterWith();
  m.record({ t: c.t, path: '/old', ms: 1, status: 200 });
  c.t += 61 * 60 * 1000;
  m.record({ t: c.t, path: '/new', ms: 1, status: 200 });
  assert.deepEqual(m.snapshot().entries.map((e) => e.path), ['/new']);
  for (let i = 0; i < 2100; i++) m.record({ t: c.t + i, path: `/c${i}`, ms: 1, status: 200 });
  assert.equal(m.snapshot().totals.n, 2000);
  assert.equal(m.entries(0).at(-1).path, '/c2099');
});

test('entries(since) is chronological and only newer than since', () => {
  const { c, m } = meterWith();
  for (const p of ['/a', '/b', '/c']) { c.t += 1000; m.record({ t: c.t, path: p, ms: 1, status: 200 }); }
  assert.deepEqual(m.entries(c.t - 1500).map((e) => e.path), ['/b', '/c']);
  assert.deepEqual(m.entries(c.t), []);
});

test('subscribe hears every record until unsubscribed; a throwing subscriber does not stop the rest', () => {
  const { m } = meterWith();
  const a = [], b = [];
  const off = m.subscribe((e) => a.push(e.path));
  m.subscribe(() => { throw new Error('bad subscriber'); });
  m.subscribe((e) => b.push(e.path));
  m.record({ path: '/1', ms: 1, status: 200 });
  off();
  m.record({ path: '/2', ms: 1, status: 200 });
  assert.deepEqual(a, ['/1']);
  assert.deepEqual(b, ['/1', '/2']);
});

test('the same call recorded twice counts once', () => {
  const { m } = meterWith();
  const e = { t: 1_800_000_000_000, path: '/x', ms: 3, status: 200, source: 'console' };
  m.record(e); m.record(e);
  assert.equal(m.snapshot().totals.n, 1);
  m.record({ ...e, source: 'dashboard' });
  assert.equal(m.snapshot().totals.n, 2, 'another source is another call');
});

test('two meters on one channel share calls both ways, without echo or double counting', () => {
  const Channel = hub(), c = clock();
  const tab1 = createMeter({ now: c.now, storage: memory(), bc: Channel }), tab2 = createMeter({ now: c.now, storage: memory(), bc: Channel });
  const heard = [];
  tab2.subscribe((e) => heard.push(e));
  tab1.record({ t: c.t, path: '/services/apexrest/somconsole/batch', ms: 40, status: 200, source: 'dashboard' });
  assert.equal(heard.length, 1);
  assert.equal(heard[0].remote, true);
  assert.equal(tab2.snapshot().totals.n, 1);
  assert.equal(tab1.snapshot().totals.n, 1, 'no echo back to the sender');
  c.t += 5; tab2.record({ t: c.t, path: '/graphql', ms: 9, status: 200 });
  assert.equal(tab1.snapshot().totals.n, 2);
  assert.equal(tab1.snapshot().entries[0].kind, 'graphql');
});

test('a message from another tab is cleaned like any entry', () => {
  const Channel = hub(), c = clock();
  const tab = createMeter({ now: c.now, storage: memory(), bc: Channel });
  const rogue = new Channel('som-meter');
  rogue.postMessage({ t: c.t, path: "/query?q=SELECT Id FROM Account WHERE Name='Jane'", ms: 1, status: 200 });
  rogue.postMessage('not an object');
  rogue.postMessage(null);
  const s = tab.snapshot();
  assert.equal(s.totals.n, 1);
  assert.equal(s.entries[0].path, '/query');
  assert.ok(!JSON.stringify(s).includes('Jane'));
});

test('calls are kept in storage and a new page picks them up; reset clears both', () => {
  const store = memory(), c = clock();
  const first = createMeter({ now: c.now, storage: store, bc: null });
  first.record({ t: c.t, path: '/a', ms: 1, status: 200 });
  const second = createMeter({ now: c.now, storage: store, bc: null });
  assert.equal(second.snapshot().totals.n, 1);
  second.reset();
  assert.equal(second.snapshot().totals.n, 0);
  assert.equal(store.getItem('som-meter'), null);
});

test('stored data that is not JSON is ignored, and a failing store or channel never throws', () => {
  const c = clock();
  const broken = { getItem: () => '{nope', setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('blocked'); } };
  const Bad = class { constructor() { throw new Error('no channel'); } };
  const m = createMeter({ now: c.now, storage: broken, bc: Bad });
  assert.doesNotThrow(() => m.record({ t: c.t, path: '/a', ms: 1, status: 200 }));
  assert.doesNotThrow(() => m.reset());
  assert.doesNotThrow(() => createMeter({ now: c.now, storage: null, bc: null }).record({ path: '/b' }));
  const Throws = class { constructor() { this.onmessage = null; } postMessage() { throw new Error('closed'); } close() {} };
  assert.doesNotThrow(() => createMeter({ now: c.now, storage: null, bc: Throws }).record({ path: '/c' }));
});

test('an empty meter snapshots cleanly', () => {
  const s = meterWith().m.snapshot();
  assert.deepEqual(s.entries, []);
  assert.deepEqual(s.totals, { n: 0, errors: 0, p50: 0, p95: 0, peakRows: 0 });
  assert.equal(s.heaviest, null);
  assert.equal(s.slowest, null);
});

test('status 0 (network failure or timeout) counts as an error', () => {
  const { m } = meterWith();
  m.record({ path: '/x', ms: 30000, status: 0 });
  assert.equal(m.snapshot().totals.errors, 1);
});

// ---------- feature gating (Omnichannel Inventory, Delivery Estimation) ----------

// Stock: with Omnichannel Inventory off the availability call is never sent; unknown still tries it.
const stockOrg = (tooling) => {
  const f2 = (...n) => n.map((name) => ({ name }));
  return fakeOrg({ objects: ['Product2', 'Location'], tooling,
    schema: { Product2: f2('Id', 'Name', 'ProductCode', 'StockKeepingUnit'), Location: f2('Id', 'Name', 'ExternalReference', 'ShouldSyncWithOci') },
    queries: [[/FROM Product2/, [{ Id: '01t000000000001AAA', Name: 'Boot', StockKeepingUnit: 'BOOT' }]], [/FROM Location/, [{ Id: '131000000000001AAA', Name: 'DC', ExternalReference: 'dc' }]]],
    posts: [[/get-availability$/, () => ({ locations: [{ locationIdentifier: 'dc', inventoryRecords: [{ stockKeepingUnit: 'BOOT', exists: true, availableToFulfill: 4 }] }] })]] });
};
test('feature gating: stock lookup is skipped when Omnichannel Inventory is off, and sent when on or unknown', async () => {
  const url = '/api/inventory?id=01t000000000001AAA';
  const off = stockOrg({ IsOmniChannelInventoryEnabled: false });
  const r = await off.core.route(url);
  assert.ok(!off.calls.some((c) => /get-availability/.test(c)));
  assert.ok(r.tried.some((t) => t.source === 'Omnichannel Inventory' && t.note === 'turned off in this org'));
  for (const t of [{ IsOmniChannelInventoryEnabled: true }, undefined]) {
    const o = stockOrg(t);
    assert.equal((await o.core.route(url)).source, 'Omnichannel Inventory');
  }
});

test('feature gating: the settings are read once for several stock lookups', async () => {
  const o = stockOrg({ IsOmniChannelInventoryEnabled: false });
  const url = '/api/inventory?id=01t000000000001AAA';
  await o.core.route(url); await o.core.route(url);
  assert.equal(o.calls.filter((c) => c.startsWith('/tooling')).length, 2, 'two settings, each read once');
  assert.ok(!o.calls.some((c) => /get-availability/.test(c)));
});

test('limits route: access says what this user can read, part by part', async () => {
  const all = await org().core.route('/api/limits');
  assert.deepEqual(all.access.map((x) => x.state), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
  const hidden = await org({ objects: ['OrderSummary'] }).core.route('/api/limits');
  const by = (r, n) => r.access.find((x) => x.name === n);
  assert.equal(by(hidden, 'Entitlements').state, 'blocked');
  assert.match(by(hidden, 'Entitlements').note, /Not visible/);
  assert.equal(by(hidden, 'Order summary count').state, 'ok');
  const noLimits = await org({ limits: null }).core.route('/api/limits');
  assert.equal(by(noLimits, 'Org limits').state, 'blocked');
  assert.equal((await org().core.route('/api/limits?only=api')).access, undefined);
});
