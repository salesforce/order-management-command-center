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
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { loginArguments, readPublic, startHost } from '../../../node/shared/host.mjs';
import { createCore as command } from '../../../public/operations-console/data/core.js';
import { startShare } from '../../../node/shared/share.mjs';

const connectionFactory = () => ({ current: () => null, sf: async () => ({ status: 1 }), requireConn: async () => { throw Object.assign(new Error('Sign in'), { code: 401 }); }, getConn: async () => null });
test('login command arguments permit only the declared environments and HTTPS Salesforce domains', () => {
  const fixed = ['org', 'login', 'web', '--alias', 'fixture', '--instance-url'];
  for (const [env, url] of [['production', 'https://login.salesforce.com'], ['sandbox', 'https://test.salesforce.com']]) {
    assert.deepEqual(loginArguments(env, 'ignored', 'fixture'), [...fixed, url]);
  }
  assert.deepEqual(loginArguments('custom', 'https://fixture.my.salesforce.com/', 'fixture'), [...fixed, 'https://fixture.my.salesforce.com']);
  for (const url of ['--help', 'http://fixture.my.salesforce.com', 'https://fixture.my.salesforce.com;echo bad', 'https://fixture.my.salesforce.com\necho bad',
    'https://fixture.my.salesforce.com/--help', 'https://fixture.my.salesforce.com?x=1', 'https://fixture.my.salesforce.com.evil.invalid', 'https://user@fixture.my.salesforce.com']) {
    assert.throws(() => loginArguments('custom', url, 'fixture'), { code: 400 }, url);
  }
  for (const env of ['constructor', '__proto__', '--help', 'unknown']) assert.throws(() => loginArguments(env, null, 'fixture'), { code: 400 }, env);
});
test('the public reader only accepts declared asset names, including their canonical aliases', async () => {
  const legacy = await readPublic('tokens.css'), canonical = await readPublic('shared/ui/tokens.css');
  assert.ok(Buffer.isBuffer(legacy)); assert.deepEqual(legacy, canonical);
  assert.equal(await readPublic('tokens.css', 'utf8'), canonical.toString());
  for (const name of ['source-layout.js', '../server.mjs', '/etc/passwd', 'service/../../server.mjs', 'shared/ui/../ui/tokens.css', '%2e%2e/server.mjs', 'constructor', '__proto__']) {
    await assert.rejects(readPublic(name), { code: 404, message: 'Not found' }, name);
  }
});
async function host(t, createCore, profile) {
  const server = startHost({ createCore, profile, port: 0, connectionFactory });
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return (url, options) => fetch(`http://127.0.0.1:${server.address().port}${url}`, options);
}
test('Command host serves canonical and legacy assets with stable document URLs and no Service access', async (t) => {
  const get = await host(t, command, 'operations-console');
  const page = await get('/?demo=1');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /operations-console\/transport\/browser.js/);
  const alias = await get('/console-kit.js?fresh=1', { redirect: 'manual' });
  assert.equal(alias.status, 200);
  assert.match(await alias.text(), /export \* from "\.\/operations-console\/console-kit\.js"/);
  const script = await get('/operations-console/console-kit.js');
  assert.equal(script.status, 200); assert.match(script.headers.get('content-type'), /javascript/);
  for (const asset of ['/tokens.css', '/shared/ui/tokens.css']) assert.equal((await get(asset)).status, 200, asset);
  for (const asset of ['/service/', '/service-center/app.js', '/om-actions.js', '/om-core.js', '/source-layout.js', '/node/shared/host.mjs', '/test/support/fake-org.mjs', '/.secrets/netrc', '/%2e%2e%2fserver.mjs']) assert.equal((await get(asset)).status, 404, asset);
  assert.equal((await get('/api/cs/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
  assert.equal((await get('/api/status', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  const refused = await new Promise((resolve, reject) => {
    http.get(new URL('/api/status', page.url), { headers: { host: 'attacker.invalid' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(refused, 403);
});
test('split host handlers preserve API guards, reads, action validation, logout and error status', async (t) => {
  const calls = [], server = startHost({ port: 0,
    createCore: () => ({ reset() {}, route: async (url) => {
      if (url === '/api/refused') throw Object.assign(new Error('Refused'), { code: 422 });
      if (url === '/api/agent/info') return { agent: null };
      return { url };
    } }),
    createActions: () => ({ run: async (body) => { calls.push(body); return { ok: true }; } }),
    connectionFactory: () => ({ current: () => null, getConn: async () => null, requireConn: async () => null,
      sf: async (args) => { calls.push(args); }, clear: () => calls.push('clear') }),
  });
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, get = (url, options) => fetch(base + url, options);
  assert.deepEqual(await (await get('/api/example?q=1')).json(), { url: '/api/example?q=1' });
  assert.equal((await get('/api/refused')).status, 422);
  assert.equal((await get('/api/agent/session', { method: 'POST' })).status, 404);
  assert.equal((await get('/api/meter')).status, 200);
  for (const query of ['env=constructor', 'env=custom&url=--help', 'env=custom&url=https%3A%2F%2Fevil.invalid']) {
    assert.equal((await get('/api/login?' + query, { method: 'POST' })).status, 400, query);
  }
  assert.equal((await get('/console-kit.js', { method: 'POST' })).status, 404);
  const action = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' };
  assert.equal((await get('/api/cs/action', { ...action, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await get('/api/cs/action', { ...action, headers: { ...action.headers, origin: 'http://attacker.invalid' } })).status, 403);
  assert.equal((await get('/api/cs/action', { ...action, headers: { ...action.headers, 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.deepEqual(calls, []);
  assert.equal((await get('/api/cs/action', { ...action, headers: { ...action.headers, origin: base } })).status, 200);
  assert.deepEqual(calls, [{}]);
  assert.equal((await get('/api/logout', { method: 'POST' })).status, 200);
  assert.deepEqual(calls.slice(1), [['org', 'logout', '--target-org', process.env.OM_ORG_ALIAS || 'om-console', '--no-prompt'], 'clear']);
});
test('the share host serves demo assets and never exposes an org API or source infrastructure', async (t) => {
  const server = startShare({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const get = (url, options) => fetch(`http://127.0.0.1:${server.address().port}${url}`, options);
  const redirect = await get('/', { redirect: 'manual' });
  assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), '/?demo=1');
  const page = await get('/?demo=1');
  assert.equal(page.status, 200); assert.match(await page.text(), /operations-console\/transport\/browser.js/);
  const alias = await get('/console-state.js');
  assert.equal(alias.status, 200); assert.match(await alias.text(), /export \* from/);
  for (const name of ['/operations-console/console-state.js', '/tokens.css']) assert.equal((await get(name)).status, 200, name);
  for (const name of ['/source-layout.js', '/node/shared/host.mjs', '/test/support/fake-org.mjs', '/%2e%2e%2fserver.mjs']) assert.equal((await get(name)).status, 404, name);
  const api = await get('/api/status');
  assert.equal(api.status, 404); assert.match(await api.text(), /not connected to an org/);
});
