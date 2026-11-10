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
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createConn, envBlocked } from "../../../sf-conn.mjs";
import { CONFIG } from "../../../public/shared/transport/om-config.js";

// A block list of the tests' own, so they don't depend on what this deployment's om-config.js refuses.
CONFIG.blocked = [/@blocked\.example$/i, /\/\/blocked[.-]/i];

const display = (over = {}) => ({ status: 0, result: { instanceUrl: 'https://x.my.salesforce.com', username: 'me@om.demo', apiVersion: '62.0', ...over } });
const fakeRun = (map) => async (args) => map[args.slice(0, 3).join(' ')] ?? { status: 1, message: 'unexpected ' + args.join(' ') };

test('connects with the token from show-access-token and calls onConnect', async () => {
  let connected = 0;
  const c = createConn({ alias: 'a', onConnect: () => connected++, run: fakeRun({ 'org display --target-org': display(), 'org auth show-access-token': { status: 0, result: { accessToken: 'T1' } } }) });
  const conn = await c.requireConn();
  assert.equal(conn.accessToken, 'T1'); assert.equal(conn.apiVersion, '62.0'); assert.equal(connected, 1);
  assert.equal(c.current().instanceUrl, 'https://x.my.salesforce.com');
});

test('an unknown alias is "not connected", not an error', async () => {
  const c = createConn({ alias: 'a', run: fakeRun({ 'org display --target-org': { status: 1, name: 'NamedOrgNotFoundError' } }) });
  assert.equal(await c.getConn(), null);
  await assert.rejects(c.requireConn(), (e) => e.code === 401);
});

test('refuses a blocked org and a redacted token', async () => {
  const blocked = createConn({ alias: 'a', run: fakeRun({ 'org display --target-org': display({ username: 'x@blocked.example' }) }) });
  await assert.rejects(blocked.getConn(), (e) => e.code === 409 && e.orgBlocked === true);
  const red = createConn({ alias: 'a', run: fakeRun({ 'org display --target-org': display(), 'org auth show-access-token': { status: 0, result: { accessToken: '[REDACTED]' } } }) });
  await assert.rejects(red.getConn(), (e) => e.code === 401);
});

test('OM_BLOCKED adds orgs to refuse; with it unset and an empty config, nothing is refused', async () => {
  const saved = CONFIG.blocked, env = process.env.OM_BLOCKED;
  const run = fakeRun({ 'org display --target-org': display({ username: 'agent@refused.example', instanceUrl: 'https://refused.my.salesforce.com' }), 'org auth show-access-token': { status: 0, result: { accessToken: 'T' } } });
  try {
    CONFIG.blocked = [];
    delete process.env.OM_BLOCKED;
    assert.equal((await createConn({ alias: 'a', run }).getConn()).accessToken, 'T');
    process.env.OM_BLOCKED = String.raw`@refused\.example$, //refused[.-]`;
    await assert.rejects(createConn({ alias: 'a', run }).getConn(), (e) => e.code === 409 && e.orgBlocked === true);
    assert.deepEqual(envBlocked(' , ').length, 0);
  } finally { CONFIG.blocked = saved; if (env === undefined) delete process.env.OM_BLOCKED; else process.env.OM_BLOCKED = env; }
});

test('a malformed OM_BLOCKED pattern is an error, not an empty block list', () => {
  assert.throws(() => envBlocked('@refused\\.example$,refused[('), /OM_BLOCKED: "refused\[\(" is not a valid regular expression/);
  const env = process.env.OM_BLOCKED;
  process.env.OM_BLOCKED = '(';
  try { assert.throws(() => createConn({ alias: 'a' }), /OM_BLOCKED/, 'the server fails to start rather than refusing nothing'); }
  finally { if (env === undefined) delete process.env.OM_BLOCKED; else process.env.OM_BLOCKED = env; }
});

test('api retries once on 401 with a fresh token', async () => {
  let n = 0; const seen = [];
  const run = async (args) => args[0] === 'org' && args[1] === 'display' ? display() : { status: 0, result: { accessToken: 'T' + ++n } };
  const fetchImpl = async (url, opts) => { seen.push(opts.headers.Authorization); return seen.length === 1 ? { status: 401, ok: false, json: async () => ({}) } : { status: 200, ok: true, json: async () => ({ ok: 1 }) }; };
  const c = createConn({ alias: 'a', run, fetchImpl });
  assert.deepEqual(await c.api('/limits'), { ok: 1 });
  assert.deepEqual(seen, ['Bearer T1', 'Bearer T2']);
});

test('a socket failure is retried, then reported with its cause', async () => {
  const run = async (args) => args[1] === 'display' ? display() : { status: 0, result: { accessToken: 'T' } };
  let n = 0;
  const fail = (cause) => async () => { n++; throw new TypeError('fetch failed', cause && { cause }); };
  await assert.rejects(createConn({ alias: 'a', run, fetchImpl: fail({ code: 'ECONNRESET' }) }).api('/limits'), (e) => e.message === 'fetch failed (ECONNRESET)');
  assert.equal(n, 3);
  await assert.rejects(createConn({ alias: 'a', run, fetchImpl: fail() }).api('/limits'), (e) => e.message === 'fetch failed');
});

test('a missing sf CLI says so instead of looking like a sign-in problem', async () => {
  const c = createConn({ alias: 'a', run: async () => ({ status: 1, name: 'SfNotFound', message: 'sf CLI not found' }) });
  await assert.rejects(c.getConn(), (e) => e.code === 503 && /sf CLI/.test(e.message));
});

test('sfCli reports a missing executable as SfNotFound', async () => {
  const { sfCli } = await import("../../../sf-conn.mjs");
  const old = process.env.PATH; process.env.PATH = '/nonexistent';
  try { const r = await sfCli(['--version']); assert.equal(r.name, 'SfNotFound'); } finally { process.env.PATH = old; }
});

test('sfCli parses ANSI-colored JSON and preserves malformed-output errors', async (t) => {
  const { sfCli } = await import('../../../sf-conn.mjs');
  const escape = String.fromCharCode(27);
  let stdout = `${escape}[1;32m{"status":0,"result":{"name":"café 😀","value":1}}${escape}[0m`;
  t.mock.method(childProcess, 'execFile', (command, args, options, done) => {
    assert.equal(command, 'sf');
    assert.deepEqual(args, ['org', 'display', '--json']);
    assert.equal(options.env.FORCE_COLOR, '0');
    done(null, stdout, '');
  });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(await sfCli(['org', 'display']), { status: 0, result: { name: 'café 😀', value: 1 } });
    stdout = '{"status":0,"result":{"name":"plain"}}';
    assert.equal((await sfCli(['org', 'display'])).result.name, 'plain');
    for (const malformed of [`${escape}[31x{"status":0}`, `${escape}${escape}[31m{"status":0}`, '{bad json']) {
      stdout = malformed;
      assert.deepEqual(await sfCli(['org', 'display']), { status: 1, message: malformed });
    }
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('a request that takes too long is cut off with a clear message', async () => {
  const run = async (args) => args[1] === 'display' ? display() : { status: 0, result: { accessToken: 'T' } };
  // AbortSignal.timeout doesn't hold the event loop open (a server does), so this test holds it while it waits.
  const fetchImpl = (url, opts) => new Promise((_, fail) => { const hold = setTimeout(() => {}, 5000);
    opts.signal.addEventListener('abort', () => { clearTimeout(hold); fail(Object.assign(new Error('aborted'), { name: 'TimeoutError' })); }); });
  const c = createConn({ alias: 'a', run, fetchImpl, timeoutMs: 30 });
  await assert.rejects(c.api('/query?q=x'), (e) => e.code === 504 && /took too long/.test(e.message));
});

test('Salesforce QUERY_TIMEOUT gets the same clear message', async () => {
  const run = async (args) => args[1] === 'display' ? display() : { status: 0, result: { accessToken: 'T' } };
  const fetchImpl = async () => ({ status: 400, ok: false, json: async () => [{ errorCode: 'QUERY_TIMEOUT', message: 'Your query request was running for too long.' }] });
  const c = createConn({ alias: 'a', run, fetchImpl });
  await assert.rejects(c.api('/query?q=x'), (e) => e.code === 504 && /try a shorter range/.test(e.message));
});
