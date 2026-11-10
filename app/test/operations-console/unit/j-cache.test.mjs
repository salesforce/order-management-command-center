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
import { readFileSync } from "../../support/source-view.mjs";
import { consoleCode } from "../../support/console-source.mjs";
import { fakeOrg } from "../../support/fake-org.mjs";

// The drawer cache (console-jcache.js), run here with an injected clock; how the page wires it is read from index.html as text.
const html = readFileSync(new URL("../../../public/operations-console/index.html", import.meta.url), 'utf8');
const src = readFileSync(new URL("../../../public/operations-console/console-jcache.js", import.meta.url), 'utf8');
const C = await import("../../../public/operations-console/console-jcache.js");

const OS = '1Os000000000001AAA', OS2 = '1Os000000000002AAA', ACC = '001000000000001AAA', CASE = '500000000000001AAA';
const ORDER = (id = OS) => ({ order: { Id: id }, items: [] });
// A fake fetcher that counts calls per URL and answers with `answer(url)`.
function rig(answer = (u) => ORDER(u), opts = {}) {
  let t = 0; const calls = [];
  const fetcher = async (u, o) => { calls.push([u, o]); return answer(u); };
  const get = C.makeJCache(fetcher, { now: () => t, ...opts });
  return { get, calls, at: (ms) => { t = ms; } };
}
const defer = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };

test('the block is found and exports the cache', () => {
  assert.ok(src.length > 500);
  assert.doesNotMatch(src, /^import /m, 'console-jcache.js stands alone');
  for (const n of ['makeJCache', 'jCheck', 'J_TTL', 'J_MAX']) assert.ok(C[n], n);
  assert.equal(C.J_TTL, 30e3);
  assert.equal(C.J_MAX, 40);
});

test('only the four drawer reads are cacheable', () => {
  for (const u of [`/api/order/${OS}`, `/api/order/${OS}/history`, `/api/account/${ACC}`, `/api/record/Case/${CASE}`, `/api/record/Agent_Proposal__c/${CASE}`]) assert.ok(C.jCheck(u), u);
  for (const u of [`/api/order/${OS}?x=1`, '/api/order-number/123', '/api/console?range=7d', '/api/dashboard?period=7d', `/api/service/customer/${ACC}`, `/api/service/chat/${CASE}`,
    '/api/limits', '/api/meter?since=0', '/api/status', `/api/inventory?id=${OS}`, `/api/read/order?id=${OS}`, '/api/agent/info', '/api/agent/session', '/api/login', `/api/order/${OS}/other`]) assert.equal(C.jCheck(u), null, u);
});

test('a repeat inside the TTL is served from memory, and expires at the TTL', async () => {
  const { get, calls, at } = rig();
  const a = await get(`/api/order/${OS}`);
  assert.equal(await get(`/api/order/${OS}`), a);
  at(C.J_TTL - 1);
  assert.equal(await get(`/api/order/${OS}`), a);
  assert.equal(calls.length, 1);
  at(C.J_TTL);
  await get(`/api/order/${OS}`);
  assert.equal(calls.length, 2);
});

test('different URLs are separate entries', async () => {
  const { get, calls } = rig((u) => (u.endsWith('/history') ? { events: [] } : ORDER(u)));
  await get(`/api/order/${OS}`); await get(`/api/order/${OS2}`); await get(`/api/order/${OS}/history`);
  await get(`/api/order/${OS}`); await get(`/api/order/${OS2}`); await get(`/api/order/${OS}/history`);
  assert.equal(calls.length, 3);
});

test('errors are not kept, and keep their status and kind', async () => {
  let n = 0;
  const { get, calls } = rig(() => { if (!n++) throw Object.assign(new Error('boom'), { status: 503, kind: 'limit' }); return ORDER(); });
  await assert.rejects(get(`/api/order/${OS}`), (e) => e.message === 'boom' && e.status === 503 && e.kind === 'limit');
  assert.ok((await get(`/api/order/${OS}`)).order);
  assert.equal(calls.length, 2);
});

test('empty or partial answers are not kept', async () => {
  const bad = [[`/api/order/${OS}`, {}], [`/api/order/${OS}/history`, { events: null }], [`/api/account/${ACC}`, { account: { Id: ACC }, loyalty: { error: 'x' } }], [`/api/record/Case/${CASE}`, { obj: 'Case' }]];
  for (const [u, v] of bad) {
    const { get, calls } = rig(() => v);
    await get(u); await get(u);
    assert.equal(calls.length, 2, u);
  }
  const good = rig(() => ({ account: { Id: ACC } }));
  await good.get(`/api/account/${ACC}`); await good.get(`/api/account/${ACC}`);
  assert.equal(good.calls.length, 1);
});

test('a call with options goes straight through and is never kept', async () => {
  const { get, calls } = rig();
  const signal = new AbortController().signal;
  for (const o of [{ method: 'POST' }, { method: 'DELETE' }, { signal }, {}]) await get(`/api/order/${OS}`, o);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((c) => c[1]), [{ method: 'POST' }, { method: 'DELETE' }, { signal }, {}]);
  await get(`/api/order/${OS}`); await get(`/api/order/${OS}`);
  assert.equal(calls.length, 5);
  // a route outside the list is not kept either
  await get('/api/console?range=7d'); await get('/api/console?range=7d');
  assert.equal(calls.length, 7);
});

test('requests for the same URL in flight share one fetch, and a failure reaches every waiter', async () => {
  const d = defer(), calls = [];
  const get = C.makeJCache((u) => { calls.push(u); return d.p; });
  const [a, b] = [get(`/api/order/${OS}`), get(`/api/order/${OS}`)];
  assert.equal(calls.length, 1);
  d.resolve(ORDER());
  assert.equal(await a, await b);

  const e = defer(), calls2 = [];
  const get2 = C.makeJCache((u) => { calls2.push(u); return calls2.length === 1 ? e.p : Promise.resolve(ORDER()); });
  const [x, y] = [get2(`/api/order/${OS}`), get2(`/api/order/${OS}`)];
  e.reject(new Error('down'));
  await assert.rejects(x, /down/); await assert.rejects(y, /down/);
  assert.ok((await get2(`/api/order/${OS}`)).order);
  assert.equal(calls2.length, 2);
});

test('clear() empties the cache and an earlier fetch cannot put its answer back', async () => {
  const { get, calls } = rig();
  await get(`/api/order/${OS}`);
  assert.equal(get.size(), 1);
  get.clear();
  assert.equal(get.size(), 0);
  await get(`/api/order/${OS}`);
  assert.equal(calls.length, 2);

  const d = defer(); let n = 0;
  const g = C.makeJCache(() => (n++ ? Promise.resolve(ORDER()) : d.p));
  const old = g(`/api/order/${OS}`);
  g.clear();
  const fresh = g(`/api/order/${OS}`); // not merged with the pre-clear request
  assert.equal(n, 2);
  await fresh;
  d.resolve(ORDER('old'));
  await old;
  assert.equal(g.size(), 1);
  assert.equal((await g(`/api/order/${OS}`)).order.Id, OS); // the post-clear answer survives; the old one never replaced it
  assert.equal(n, 2);
});

test('at most 40 are kept; the longest unused goes first', async () => {
  const { get, calls } = rig((u) => ORDER(u), { max: 3 });
  const id = (i) => `/api/order/1Os00000000000${i}`;
  await get(id(1)); await get(id(2)); await get(id(3));
  await get(id(1)); // touched: now the newest
  await get(id(4)); // evicts 2
  assert.equal(get.size(), 3);
  const n = calls.length;
  await get(id(1)); await get(id(3)); await get(id(4));
  assert.equal(calls.length, n);
  await get(id(2));
  assert.equal(calls.length, n + 1);
});

test('an expired entry is dropped when read', async () => {
  const { get, at } = rig();
  await get(`/api/order/${OS}`);
  assert.equal(get.size(), 1);
  at(C.J_TTL + 1);
  const d = get(`/api/order/${OS}`);
  assert.equal(get.size(), 0);
  await d;
  assert.equal(get.size(), 1);
});

test('with the real core behind it, a repeat makes no org queries until clear()', async () => {
  const org = fakeOrg({ queries: [[/FROM OrderSummary WHERE Id/, [{ Id: OS, OrderNumber: '1', Status: 'Fulfilled' }]], [/./, []]] });
  const get = C.makeJCache((u) => org.core.route(u));
  const r = await get(`/api/order/${OS}`);
  assert.equal(r.order.OrderNumber, '1');
  const n = org.soql().length;
  assert.ok(n > 0);
  await get(`/api/order/${OS}`);
  assert.equal(org.soql().length, n);
  get.clear();
  await get(`/api/order/${OS}`);
  assert.ok(org.soql().length > n);
  // an order that isn't there throws, and that isn't kept
  const none = fakeOrg({ queries: [[/./, []]] });
  const g2 = C.makeJCache((u) => none.core.route(u));
  await assert.rejects(g2(`/api/order/${OS2}`));
  const m = none.soql().length;
  await assert.rejects(g2(`/api/order/${OS2}`));
  assert.ok(none.soql().length > m);
});

test('the page wires it around every sign-in mode, and demo never reaches it', () => {
  assert.match(html, /const jc = makeJCache\(jFetch\);\nfunction j\(url, opts\) \{ return jc\(url, opts\); \}/);
  const fetchFn = html.slice(html.indexOf('async function jFetch('), html.indexOf('const jc = makeJCache'));
  for (const s of ['if (PLATFORM)', 'if (BROWSER)', 'await fetch(url, opts)']) assert.ok(fetchFn.includes(s), s);
  assert.match(html, /async function load\(\) \{\n {2}jc\.clear\(\);/);
  assert.match(html, /function showGate\(s\) \{\n {2}jc\.clear\(\);/);
  for (const re of [/DEMO \? demoOrder\(id\) : await j\(/, /DEMO \? demoHistory\(id\) : await j\(/, /DEMO \? demoRecord\(obj, id\) : await j\(/, /DEMO \? demoAccount\(id\) : await j\(/]) assert.match(consoleCode, re);
  // nothing that writes goes through a cacheable route
  for (const m of consoleCode.matchAll(/\bj\(([^)]*?),\s*\{[^}]*method:\s*'(?:POST|DELETE)'/g)) assert.equal(C.jCheck(m[1].replace(/`/g, '').replace(/\$\{[^}]*\}/g, 'X')), null, m[0]);
});
