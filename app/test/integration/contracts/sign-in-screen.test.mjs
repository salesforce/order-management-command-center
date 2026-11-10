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
// Only an expired sign-in and a blocked org's refusal show the sign-in screen: isAuthFailure() in console-banner.js. A 409 on
// its own is not one. An org the deployment blocks (CONFIG.blocked in om-config.js) is refused on every sign-in path with
// blockedRefusal() (om-http.js), and that still shows the sign-in screen. These tests block their own made-up org, whatever
// the deployment's copy of om-config.js says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from "../../support/source-view.mjs";
import { installDom } from "../../support/fake-dom.mjs";
import { errorBody, errorFrom, blockedRefusal, BLOCKED_MESSAGE } from "../../../public/shared/transport/om-http.js";
import { createConn } from "../../../sf-conn.mjs";
import { connectorRequest, PROBE } from "../../../tools/artifact-connector.js";
import { CONFIG } from "../../../public/shared/transport/om-config.js";
import { createPlatform } from "../../../public/operations-console/transport/platform.js";

installDom();
CONFIG.blocked = [/@blocked\.example$/i, /\/\/blocked[.-]/i];
const store = new Map();
globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { isAuthFailure } = await import("../../../public/operations-console/console-banner.js");
const browser = await import("../../../public/operations-console/transport/browser.js");

const src = (f) => readFileSync(new URL(f, new URL("../../", import.meta.url)), 'utf8');

// What the page gets for an error, mode by mode. Locally, server.mjs answers the error's code (else 500) with errorBody(e),
// and the console's fetch reads it back. In the page (the console's browser and platform transports, the Cowork connector),
// the console's jFetch sets the status from the code.
const serverStatus = (e) => (e.code && e.code >= 400 && e.code < 600 ? e.code : 500);
const modes = (e) => ({
  local: errorFrom(errorBody(e), serverStatus(e)),
  'in the page': Object.assign(Object.assign(new Error(e.message), e), { status: e.status ?? e.code }),
});

test('a 409 alone is not a sign-in failure; an expired sign-in and a blocked org’s refusal are', () => {
  for (const e of [{ status: 401 }, { status: 409, orgBlocked: true }]) assert.equal(isAuthFailure(e), true, JSON.stringify(e));
  for (const e of [{ status: 409 }, { status: 422 }, { status: 403 }, { status: 409, orgBlocked: 'yes' }, null, undefined]) assert.equal(isAuthFailure(e), false, JSON.stringify(e));
  for (const [mode, got] of Object.entries(modes(blockedRefusal('blocked')))) assert.equal(isAuthFailure(got), true, mode);
  const conflict = Object.assign(new Error('already there'), { code: 409 });
  for (const [mode, got] of Object.entries(modes(conflict))) {
    assert.equal(got.message, 'already there', mode);
    assert.equal(isAuthFailure(got), false, `${mode}: no sign-in screen`);
  }
  assert.deepEqual([blockedRefusal('x').code, blockedRefusal('x').orgBlocked, blockedRefusal('x').message], [409, true, 'x'], 'still 409: the plugin’s CLI reads that code from sf-conn.mjs');
});

test('locally, an alias that points at a blocked org is refused with the mark, and the console shows the sign-in screen', async () => {
  const display = { status: 0, result: { instanceUrl: 'https://blocked.my.salesforce.com', username: 'someone@blocked.example', apiVersion: '62.0' } };
  const c = createConn({ alias: 'om-console', run: async (args) => (args[1] === 'display' ? display : { status: 1, message: `unexpected ${args.join(' ')}` }) });
  const e = await c.requireConn().then(() => assert.fail('refused'), (x) => x);
  assert.deepEqual([e.code, e.orgBlocked], [409, true]);
  assert.match(e.message, /an org this deployment refuses to run against/);
  // What server.mjs answers, read back by the console.
  const status = serverStatus(e), body = JSON.parse(JSON.stringify(errorBody(e)));
  assert.deepEqual(body, { error: e.message, orgBlocked: true });
  assert.equal(isAuthFailure(errorFrom(body, status)), true);
  assert.equal(isAuthFailure(Object.assign(new Error(body.error), { status, kind: body.kind, orgBlocked: body.orgBlocked === true })), true);
  // The console reads it the way this test does.
  assert.match(src('../server.mjs'), /send\(res, e\.code && e\.code >= 400 && e\.code < 600 \? e\.code : 500, errorBody\(e\)\)/);
  assert.match(src('../public/index.html'), /if \(!r\.ok\) throw Object\.assign\(new Error\(b\.error \|\| r\.statusText\), \{ status: r\.status, kind: b\.kind, orgBlocked: b\.orgBlocked === true \}\)/);
  for (const re of [/if \(PLATFORM\) \{ try \{ return await \(await platformMode\(\)\)\.route\(url, opts\); \} catch \(e\) \{ throw Object\.assign\(e, \{ status: e\.code \}\); \} \}/,
    /if \(BROWSER\) \{ try \{ return await \(await browserAuth\(\)\)\.route\(url, opts\); \} catch \(e\) \{ throw Object\.assign\(e, \{ status: e\.code \}\); \} \}/]) assert.match(src('../public/index.html'), re);
});

test('hosted, a blocked domain and a blocked login are refused with the mark', async () => {
  const e = await browser.login('https://blocked.my.salesforce.com').then(() => assert.fail('refused'), (x) => x);
  assert.deepEqual([e.code, e.orgBlocked, e.message], [409, true, BLOCKED_MESSAGE]);
  // A blocked login on a domain that doesn't look like one: Salesforce redirects back, the page reads who signed in, revokes the
  // token and refuses.
  const was = { location: globalThis.location, history: globalThis.history, fetch: globalThis.fetch };
  const seen = [];
  try {
    globalThis.location = { search: '?code=c1&state=s1', pathname: '/', origin: 'http://localhost:5178', hash: '', replace() {}, assign() {} };
    globalThis.history = { replaceState() {} };
    store.set('omc.pkce', JSON.stringify({ verifier: 'v', state: 's1', domain: 'https://acme.my.salesforce.com', clientId: 'c', back: '' }));
    const json = (b) => ({ ok: true, status: 200, json: async () => b });
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      if (/oauth2\/token$/.test(url)) return json({ access_token: 'T', refresh_token: 'R', instance_url: 'https://acme.my.salesforce.com', id: 'https://login.salesforce.com/id/00D000000000001/005000000000001AAA' });
      if (/\/services\/data\/$/.test(url)) return json([{ version: '62.0' }]);
      if (/\/query\?q=/.test(url)) return json({ records: [{ Username: 'someone@blocked.example' }] });
      if (/oauth2\/revoke$/.test(url)) return json({});
      throw new Error(`unexpected ${url}`);
    };
    const g = await browser.completeLogin().then(() => assert.fail('refused'), (x) => x);
    assert.deepEqual([g.code, g.orgBlocked, g.message], [409, true, 'someone@blocked.example is in an org this deployment refuses to run against.']);
    assert.ok(seen.some((u) => /oauth2\/revoke$/.test(u)), 'the blocked org’s token is revoked');
    assert.equal(store.get('omc.auth'), undefined, 'nothing is kept');
    assert.equal(browser.status().connected, false);
  } finally { Object.assign(globalThis, was); store.clear(); }
  // The console shows these on the sign-in screen at once (showGate), not through j().
  for (const f of ['../public/index.html']) assert.match(src(f), /try \{ await b\.completeLogin\(\); \} catch \(e\) \{ return showGate\(\{ error: e\.message \}\); \}/, f);
});

test('in Cowork, a blocked org is refused with the mark, and the console shows the sign-in screen', async () => {
  const answer = (status_code, body, url) => ({ content: [{ type: 'text', text: JSON.stringify({ status_code, body, url }) }] });
  const blocked = connectorRequest(async (t, a) => answer(200, { records: [] }, `https://blocked.my.salesforce.com${a.url}`), { blocked: CONFIG.blocked });
  const e = await blocked(PROBE).then(() => assert.fail('refused'), (x) => x);
  assert.deepEqual([e.code, e.orgBlocked], [409, true]);
  assert.equal(isAuthFailure(modes(e)['in the page']), true);
});

test('inside Salesforce, a blocked app domain signs nothing in', async () => {
  const p = createPlatform({ host: () => 'blocked--c.my.salesforce.app', fetchImpl: async (url) => assert.fail(`nothing is asked: ${url}`) });
  assert.deepEqual(await p.status(), { connected: false, error: BLOCKED_MESSAGE });
});

test('hosted, a kept session is held to the block list as it is now, at load and later', async () => {
  const was = globalThis.fetch, seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return { ok: true, status: 200, json: async () => ({}) }; };
  const kept = (username) => store.set('omc.auth', JSON.stringify({ accessToken: 'T', refreshToken: 'R', instanceUrl: 'https://acme.my.salesforce.com', domain: 'https://acme.my.salesforce.com', clientId: 'c', username, apiVersion: '62.0' }));
  const refusedNow = async (b) => {
    assert.deepEqual(b.status(), { connected: false, error: BLOCKED_MESSAGE });
    const e = await b.route('/api/limits').then(() => assert.fail('refused'), (x) => x);
    assert.deepEqual([e.code, e.orgBlocked, e.message], [409, true, BLOCKED_MESSAGE]);
    assert.equal(store.get('omc.auth'), undefined, 'the kept session is dropped');
    assert.ok(seen.length && seen.every((u) => /oauth2\/revoke$/.test(u)), 'its token is revoked, and nothing else is sent');
  };
  try {
    // Signed in before the org was blocked, then the page is reloaded: the session sessionStorage kept is refused.
    kept('someone@blocked.example');
    await refusedNow(await import("../../../public/operations-console/transport/browser.js?kept-blocked"));
    // Signed in to an org the list allows, which the deployment blocks while the page is open.
    seen.length = 0; kept('someone@acme.example');
    const b = await import("../../../public/operations-console/transport/browser.js?kept-allowed");
    assert.equal(b.status().connected, true);
    await withConfig({ blocked: [/@acme\.example$/i] }, () => refusedNow(b));
  } finally { globalThis.fetch = was; store.clear(); }
});

// A deployment's own om-config.js: the hosted sign-in falls back to its domain and consumer key, asks for what it leaves
// empty, and an empty block list refuses nobody on any sign-in path.
async function signIn(domain, clientId) {
  const was = { location: globalThis.location };
  let went = null;
  try {
    globalThis.location = { search: '', pathname: '/', origin: 'http://localhost:5178', hash: '', assign: (u) => { went = new URL(u); } };
    await browser.login(domain, clientId);
    return { domain: went.origin, clientId: went.searchParams.get('client_id') };
  } finally { Object.assign(globalThis, was); store.clear(); }
}
const withConfig = async (c, fn) => { const was = { ...CONFIG }; Object.assign(CONFIG, c); try { return await fn(); } finally { Object.assign(CONFIG, was); } };

test('hosted, an empty My Domain and consumer key are the deployment’s own', () => withConfig({ domain: 'https://acme.my.salesforce.com', clientId: 'acme-key' }, async () => {
  assert.deepEqual(await signIn('', ''), { domain: 'https://acme.my.salesforce.com', clientId: 'acme-key' });
  assert.deepEqual(await signIn(' https://other.my.salesforce.com/ ', ' other-key '), { domain: 'https://other.my.salesforce.com', clientId: 'other-key' });
  assert.deepEqual(await signIn('https://other.my.salesforce.com///', 'k'), { domain: 'https://other.my.salesforce.com', clientId: 'k' });
  const slashes = await signIn('https://other.my.salesforce.com' + '/'.repeat(1e5) + 'x', 'k').then(() => assert.fail('refused'), (e) => e);
  assert.equal(slashes.code, 400);
}));

test('hosted, a deployment with no domain or consumer key asks for them', () => withConfig({ domain: '', clientId: '' }, async () => {
  const noDomain = await signIn('', 'k').then(() => assert.fail('asked'), (e) => e);
  assert.deepEqual([noDomain.code, noDomain.message], [400, 'Enter your org\'s My Domain URL, e.g. https://yourdomain.my.salesforce.com']);
  const noKey = await signIn('https://acme.my.salesforce.com', '').then(() => assert.fail('asked'), (e) => e);
  assert.deepEqual([noKey.code, noKey.message], [400, 'Enter the consumer key of your org\'s External Client App']);
  assert.deepEqual(await signIn('https://acme.my.salesforce.com', 'k'), { domain: 'https://acme.my.salesforce.com', clientId: 'k' });
}));

test('an empty block list refuses nobody, on every sign-in path', () => withConfig({ blocked: [] }, async () => {
  assert.deepEqual(await signIn('https://blocked.my.salesforce.com', 'k'), { domain: 'https://blocked.my.salesforce.com', clientId: 'k' });
  const display = { status: 0, result: { instanceUrl: 'https://blocked.my.salesforce.com', username: 'someone@blocked.example', apiVersion: '62.0' } };
  const c = createConn({ alias: 'om-console', run: async (args) => (args[1] === 'display' ? display : { status: 0, result: { accessToken: 'T' } }) });
  assert.equal((await c.getConn()).username, 'someone@blocked.example');
  const answer = (status_code, body, url) => ({ content: [{ type: 'text', text: JSON.stringify({ status_code, body, url }) }] });
  await connectorRequest(async (t, a) => answer(200, { records: [] }, `https://blocked.my.salesforce.com${a.url}`), { blocked: CONFIG.blocked })(PROBE);
  const p = createPlatform({ host: () => 'blocked--c.my.salesforce.app', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ username: 'someone@blocked.example' }) }) });
  assert.equal((await p.status()).connected, true);
}));
