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
import vm from 'node:vm';
import { readFileSync, mkdtempSync, rmSync, existsSync } from "../../support/source-view.mjs";
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fakeOrg, SCHEMA } from "../../support/fake-org.mjs";
import { createCore } from "../../../public/operations-console/data/core.js";
import { CONNECTOR, TOOL, API_VERSION, PROBE, connectorRequest, readAnswer, unwrap, probe } from "../../../tools/artifact-connector.js";
import { readTools, createBucket, retryRateLimited, RETRY_MS, PACE_PER_MINUTE } from "../../../tools/artifact-call.js";
import { buildLiveHtml, buildConsoleHtml, buildSkill, ENTRY, SKILL, PAGES, STATIC_PAGES, PLACEHOLDER } from "../../../tools/build-live-artifact.mjs";
import { MAX_BYTES } from "../../../tools/build-artifact.mjs";
import { checkCall, createRelay } from "../../../tools/serve-live.mjs";

const BASE = `/services/data/${API_VERSION}`, ORG = 'https://acme.my.salesforce.com', NAME = 'mcp__c0ffee__dispatch_readonly';
// A block list of the test's own, so the tests don't depend on what this deployment's om-config.js refuses.
const BLOCKED = [/@blocked\.example$/i, /\/\/blocked[.-]/i];
const src = (f) => readFileSync(new URL(`../../../tools/${f}`, import.meta.url), 'utf8');
// The connector's answer, as Cowork hands it back (b2b-operations-console's orgClient tests use the same shape).
const answer = (status_code, body, url) => ({ content: [{ type: 'text', text: JSON.stringify({ status_code, body, ...(url ? { url } : {}) }) }] });
const failed = (message) => ({ content: [{ type: 'text', text: message }], isError: true });
const OBJECTS = ['OrderSummary', 'FulfillmentOrder', 'ReturnOrder', 'ProcessException', 'Case'];

// dispatch_readonly in front of a fake org: an HTTP error comes back as its status_code, the way the connector answers.
function connector(org, { log = [], url = ORG } = {}) {
  return async (tool, args) => {
    log.push({ tool, args });
    assert.equal(args.method, 'GET');
    assert.ok(args.url.startsWith(BASE), args.url);
    const qs = new URLSearchParams(args.queryParams).toString(), at = url && `${url}${args.url}`;
    try {
      return answer(200, await org.request(`${args.url.slice(BASE.length)}${qs ? `?${qs.replace(/\+/g, '%20')}` : ''}`), at);
    } catch (e) {
      return answer(e.httpStatus || 400, [{ errorCode: 'ERROR', message: e.message }], at);
    }
  };
}

// ---------- the adapter ----------

test('each GET createCore asks for becomes one dispatch_readonly call; nothing else reaches the connector', async () => {
  const log = [];
  const request = connectorRequest(async (tool, args) => { log.push({ tool, args }); return answer(200, { records: [], done: true }); });
  await request(`/query?q=${encodeURIComponent("SELECT Id FROM Case WHERE Status = 'New'")}`);
  await request('/sobjects/Case/describe');
  assert.deepEqual(log, [
    { tool: TOOL, args: { method: 'GET', url: `${BASE}/query`, queryParams: { q: "SELECT Id FROM Case WHERE Status = 'New'" } } },
    { tool: TOOL, args: { method: 'GET', url: `${BASE}/sobjects/Case/describe`, queryParams: {} } },
  ]);
  await assert.rejects(request('/composite', { compositeRequest: [] }), /Refusing to POST to \/composite: the live view only reads/);
  assert.equal(log.length, 2);
});

test('answers are read as { status_code, body, url }, and errors keep their HTTP status', () => {
  assert.deepEqual(readAnswer(answer(200, { done: true }, `${ORG}${BASE}/query`)), { status: 200, body: { done: true }, url: `${ORG}${BASE}/query` });
  assert.deepEqual(unwrap(answer(200, '{"a":1}')), { a: 1 });
  assert.equal(unwrap(answer(204, '')), '');
  assert.throws(() => unwrap(answer(404, [{ errorCode: 'NOT_FOUND', message: 'The requested resource does not exist' }])),
    (e) => e.httpStatus === 404 && e.message === 'The requested resource does not exist');
  assert.throws(() => unwrap(answer(400, [{ errorCode: 'INVALID_TYPE' }])), (e) => e.httpStatus === 400 && e.message === 'INVALID_TYPE');
  assert.throws(() => unwrap(answer(401, [{ message: 'Session expired or invalid' }])), (e) => e.code === 401 && e.httpStatus === 401);
  // A failure of the call itself is a message, not an HTTP answer.
  assert.throws(() => unwrap(failed("mcp__x__dispatch is not in this artifact's mcp_tools allowlist")), (e) => /allowlist/.test(e.message) && !e.httpStatus);
  assert.throws(() => unwrap({ content: [] }), (e) => e.message === `The ${CONNECTOR} connector call failed`);
  // An HTTP answer marked isError is still read as one.
  assert.throws(() => unwrap({ ...answer(400, [{ message: 'bad' }]), isError: true }), (e) => e.httpStatus === 400);
});

test('the org address comes from the answers, and a blocked org is refused like on every other path', async () => {
  const request = connectorRequest(async (t, a) => answer(200, { records: [], done: true }, `${ORG}${a.url}`), { blocked: BLOCKED });
  assert.equal(request.instanceUrl(), null);
  await request(PROBE);
  assert.equal(request.instanceUrl(), ORG);
  const blocked = connectorRequest(async (t, a) => answer(200, { records: [] }, `https://blocked.my.salesforce.com${a.url}`), { blocked: BLOCKED });
  await assert.rejects(blocked(PROBE), (e) => e.code === 409 && e.orgBlocked === true && /refuses to run against https:\/\/blocked\.my\.salesforce\.com/.test(e.message));
  assert.equal((await probe(blocked)).ok, false);
});

test('the probe is the Organization query; any HTTP answer means connected, a failed call or an expired sign-in does not', async () => {
  const seen = [];
  const at = (r) => connectorRequest(async (tool, args) => { seen.push(args); if (r instanceof Error) throw r; return r; });
  assert.deepEqual(await probe(at(answer(200, { records: [] }))), { ok: true });
  assert.deepEqual(seen[0], { method: 'GET', url: `${BASE}/query`, queryParams: { q: 'SELECT Id FROM Organization LIMIT 1' } });
  assert.deepEqual(await probe(at(answer(400, [{ message: 'bad query' }]))), { ok: true });
  const notWired = Object.assign(new Error('not set up'), { notWired: true });
  assert.equal((await probe(at(notWired))).error, notWired);
  assert.equal((await probe(at(failed('Artifact MCP rate limit exceeded')))).ok, false);
  assert.equal((await probe(at(answer(401, [])))).ok, false);
});

test('the briefing read runs through the connector exactly as it does through REST, one GET at a time', async () => {
  const setup = () => fakeOrg({ objects: OBJECTS, queries: [
    [/FROM OrderSummary .*GROUP BY/, [{ d: '2026-10-14', c: 3, v: 120 }]],
    [/SELECT COUNT\(Id\) c FROM FulfillmentOrder/, [{ c: 2 }]],
    [/^SELECT Id, FulfillmentOrderNumber, .* FROM FulfillmentOrder /, [{ Id: '0a3000000000001AAA', FulfillmentOrderNumber: 'FO-1', Status: 'Allocated', FulfilledFromLocation: { Name: 'Reno' } }]],
    [/./, []],
  ] });
  const org = setup(), log = [];
  const request = connectorRequest(connector(org, { log }), { blocked: BLOCKED });
  const out = await createCore({ request, instanceUrl: request.instanceUrl, apiVersion: () => null }).route('/api/read/briefing');
  const direct = await setup().core.route('/api/read/briefing');
  assert.deepEqual({ ...out, instanceUrl: 'x' }, { ...direct, instanceUrl: 'x' });
  assert.equal(out.instanceUrl, ORG); // learned from the answers
  assert.deepEqual(out.results.orders.rows, [{ d: '2026-10-14', c: 3, v: 120 }]);
  assert.equal(out.results.stuck.rows[0].FulfillmentOrderNumber, 'FO-1');
  assert.match(out.results.shipments.skipped, /Shipment/); // the org has no Shipment: its describe is a 404, so the query is skipped
  assert.ok(log.every((c) => c.tool === TOOL && c.args.method === 'GET'));
  assert.ok(!log.some((c) => c.args.url.includes('/composite')));
  assert.ok(!org.calls.some((c) => c.startsWith('POST')));
});

test('an expired sign-in: the probe catches it first, and the read alone reports errors, not missing objects', async () => {
  const request = connectorRequest(async () => answer(401, [{ message: 'Session expired or invalid' }]));
  assert.equal((await probe(request)).error.code, 401); // the page stops here and asks to reconnect
  const { results } = await createCore({ request, instanceUrl: () => null, apiVersion: () => null }).route('/api/read/briefing');
  assert.ok(Object.values(results).every((r) => /Couldn't read \w+'s fields/.test(r.error)), JSON.stringify(results));
});

// ---------- the Cowork call ----------

test('the connector block: the placeholder means not set up; a configured one names the full dispatch_readonly tool', () => {
  assert.match(readTools(PLACEHOLDER).reason, /isn't set up for live data/);
  assert.match(readTools('').reason, /missing/);
  assert.match(readTools('{').reason, /not valid JSON/);
  assert.match(readTools('{"dispatch_readonly":"dispatch_readonly"}').reason, /full dispatch_readonly tool name/);
  assert.match(readTools('{"dispatch_readonly":"mcp__c1__dispatch"}').reason, /full dispatch_readonly tool name/);
  assert.deepEqual(readTools(JSON.stringify({ dispatch_readonly: NAME })), { ok: true, tools: { dispatch_readonly: NAME } });
});

test('calls are paced under Cowork\'s 30 a minute, and a rate-limited one is retried after 2, 4 and 8 seconds', async () => {
  let t = 0;
  const waits = [], take = createBucket(PACE_PER_MINUTE, 60000, { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
  for (let i = 0; i < PACE_PER_MINUTE; i++) await take();
  assert.deepEqual(waits, []); // a full bucket: a page load (about 20 calls) goes at once
  await take();
  assert.equal(Math.round(waits[0]), 60000 / PACE_PER_MINUTE);
  assert.ok(PACE_PER_MINUTE < 30);

  const slept = [];
  let n = 0;
  const ok = await retryRateLimited(async () => { if (n++ < 2) throw new Error('Artifact MCP rate limit exceeded'); return 'ok'; }, async (ms) => slept.push(ms));
  assert.equal(ok, 'ok');
  assert.deepEqual(slept, RETRY_MS.slice(0, 2));
  await assert.rejects(retryRateLimited(async () => { throw new Error('other'); }, async (ms) => slept.push(ms)), /other/);
  assert.equal(slept.length, 2); // other errors aren't retried
});

// ---------- the built page ----------

test('the live page builds into one self-contained page with the connector block left to configure', () => {
  const html = buildLiveHtml();
  assert.ok(Buffer.byteLength(html) < MAX_BYTES);
  assert.match(html, /^<!doctype html>\n(?:<!--[^]*?SPDX-License-Identifier: Apache-2\.0[^]*?-->\n)?<html lang="en">\n<head>\n<meta charset="utf-8">/);
  for (const m of [ENTRY, 'om-command-core.js', 'om-reads.js', 'artifact-connector.js', 'artifact-call.js']) assert.match(html, new RegExp(`__omcDef\\('${m.replace('.', '\\.')}'`));
  assert.doesNotMatch(html, /__omcDef\('om-(actions|agent|browser|platform)\.js'/); // only the read path is in the page
  assert.equal(html.split(PLACEHOLDER).length, 2); // once, for configure.py to fill
  assert.match(html, /globalThis\.cowork/);
  assert.match(html, new RegExp(`your own <b>${CONNECTOR}</b> connector in Claude`));
  assert.doesNotMatch(html, /\bfetch\(/); // the page reaches the org only through the connector
  assert.doesNotMatch(html, /sf org login/); // the local copy's call isn't in it
});

test('--local swaps only the call module: the same page reads through tools/serve-live.mjs', () => {
  const html = buildLiveHtml({ local: true }), mods = (h) => [...h.matchAll(/__omcDef\('([\w.-]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(mods(html), mods(buildLiveHtml()));
  assert.match(html, /fetch\(`connector\?\$\{new URLSearchParams\(\{ tool, args: JSON\.stringify\(args\) \}\)\}`\)/);
  assert.match(html, /sf org login web --alias om-console/);
  assert.doesNotMatch(html, /callMcpTool/);
});

test('the page script gets its connector call from artifact-call.js, which each build defines once', () => {
  assert.doesNotMatch(src('artifact-live.js'), /function callConnector/);
  assert.match(src('artifact-live.js'), /import \{ callConnector, connectHelp \} from '\.\/artifact-call\.js';/);
  for (const f of ['artifact-call.js', 'artifact-call-local.js']) {
    assert.equal(src(f).match(/export async function callConnector\(tool, args\)/g)?.length, 1, f);
    assert.match(src(f), /export const connectHelp = /, f);
  }
});

// Runs a built page's scripts with just enough DOM. `globals` adds cowork or fetch; `tools` is the #omc-tools block's text.
async function runPage(html, { globals = {}, tools = PLACEHOLDER, until }) {
  const els = {};
  const el = (id) => (els[id] ||= { id, hidden: id === 'live' || id === 'needs', textContent: id === 'omc-tools' ? tools : '', innerHTML: '', dataset: {}, disabled: false, addEventListener() {} });
  const document = { querySelector: (s) => el(s.replace(/^#/, '').replace(/ \./, '-')), getElementById: (id) => el(id) };
  const ctx = vm.createContext({ document, console, URL, URLSearchParams, setTimeout, clearTimeout, Date, Intl, ...globals });
  ctx.window = ctx;
  for (const [, code] of html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)) vm.runInContext(code, ctx);
  for (let i = 0; i < 200 && !until.includes(el('state').textContent); i++) await new Promise((r) => setTimeout(r, 5));
  return el;
}

const briefingOrg = () => fakeOrg({ objects: OBJECTS, queries: [[/FROM OrderSummary .*GROUP BY/, [{ d: new Date().toLocaleDateString('en-CA'), c: 3, v: 120 }]], [/./, []]] });

test('in Cowork, a configured page reaches Live through window.cowork.callMcpTool, by the full tool name', async () => {
  const calls = [], call = connector(briefingOrg());
  const cowork = { callMcpTool(name, args) { calls.push({ name, self: this === cowork }); return call(TOOL, args); } };
  const el = await runPage(buildLiveHtml(), { globals: { cowork }, tools: JSON.stringify({ dispatch_readonly: NAME }), until: ['Live', 'Not connected'] });
  assert.equal(el('state').textContent, 'Live', el('needs-why').textContent);
  assert.match(el('today').innerHTML, /Orders<\/div><div class="v">3 · 120</);
  assert.ok(calls.length > 10 && calls.length < PACE_PER_MINUTE, `${calls.length} calls`);
  assert.ok(calls.every((c) => c.name === NAME && c.self));
});

test('outside Cowork, or published without a connector, the page says so instead of failing', async () => {
  const outside = await runPage(buildLiveHtml(), { until: ['Not connected'] });
  assert.equal(outside('state').textContent, 'Not connected');
  assert.equal(outside('needs').hidden, false);
  assert.match(outside('needs-why').textContent, /Open this page in Cowork/);
  const cowork = { callMcpTool() { throw new Error('should not be called'); } };
  const unset = await runPage(buildLiveHtml(), { globals: { cowork }, until: ['Not connected'] });
  assert.match(unset('needs-why').textContent, /isn't set up for live data/);
});

// ---------- the Cowork skill ----------

test('configure.py writes the one tool name in, and refuses a bad name or a configured page', { skip: spawnSync('python3', ['--version']).status !== 0 && 'no python3' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'omc-skill-'));
  try {
    const { out } = buildSkill({ dir, zip: false }), page = path.join(out, PAGES.briefing), done = path.join(dir, 'configured.html');
    const run = (...a) => spawnSync('python3', [path.join(out, 'configure.py'), ...a], { encoding: 'utf8' });
    for (const f of Object.values(PAGES)) {
      assert.equal(run(path.join(out, f), NAME, done).status, 0, f);
      const block = readFileSync(done, 'utf8').match(/<script id="omc-tools" type="application\/json">(.*)<\/script>/)[1];
      assert.deepEqual(readTools(block), { ok: true, tools: { dispatch_readonly: NAME } }, f); // what the page reads back
    }
    assert.match(run(done, NAME, path.join(dir, 'again.html')).stderr, /found 0/);
    assert.match(run(page, 'mcp__c1__dispatch', done).stderr, /not a full connector tool name/);
    assert.equal(run(page).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the skill folder holds both pages, SKILL.md and configure.py, and never allows dispatch', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'omc-skill-'));
  try {
    const { out } = buildSkill({ dir, zip: false });
    for (const f of [...Object.values(PAGES), ...Object.values(STATIC_PAGES), 'SKILL.md', 'configure.py']) assert.ok(existsSync(path.join(out, f)), f);
    const skill = readFileSync(path.join(out, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`^---\\nname: ${SKILL}\\n`));
    assert.match(skill, /set its `mcp_tools` to exactly the one full tool name/);
    for (const f of [...Object.values(PAGES), ...Object.values(STATIC_PAGES)]) assert.ok(skill.includes(f), `SKILL.md names ${f}`);
    assert.match(skill, /give it no `mcp_tools` at all/); // the design tokens page calls no tool
    assert.doesNotMatch(readFileSync(path.join(out, STATIC_PAGES.tokens), 'utf8'), /callMcpTool|OMC_TOOLS/);
    assert.match(skill, /Never add `dispatch`/);
    assert.ok(src('cowork-skill/configure.py').includes(`PLACEHOLDER = '${PLACEHOLDER}'`)); // the same placeholder as the build
    assert.ok(src('cowork-skill/configure.py').includes(String.raw`TOOL_NAME = re.compile(r"^mcp__[A-Za-z0-9_-]+__dispatch_readonly$")`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- the local stand-in ----------

test('the relay answers only the reads the page makes, each as a GET under the org\'s own API version', () => {
  const url = (p) => `${BASE}${p}`, call = (args) => checkCall(TOOL, { method: 'GET', queryParams: {}, ...args });
  assert.equal(call({ url: url('/query'), queryParams: { q: 'SELECT Id FROM Case' } }), '/query?q=SELECT+Id+FROM+Case');
  assert.equal(call({ url: url('/sobjects/FulfillmentOrder/describe') }), '/sobjects/FulfillmentOrder/describe');
  assert.equal(call({ url: url('/limits') }), '/limits'); // the Limits view's reads
  assert.equal(call({ url: url('/tooling/query'), queryParams: { q: 'SELECT Id FROM ApexClass LIMIT 1' } }), '/tooling/query?q=SELECT+Id+FROM+ApexClass+LIMIT+1');
  const doc = JSON.stringify({ query: 'query{uiapi{aggregate{Case{edges{node{aggregate{Id{count{value}}}}}}}}}' });
  assert.equal(call({ url: url('/graphql'), queryParams: { queryInput: doc } }), `/graphql?${new URLSearchParams({ queryInput: doc })}`);
  const refused = [
    ['dispatch', { method: 'GET', url: url('/query'), queryParams: { q: 'x' } }],
    [TOOL, { method: 'POST', url: url('/composite'), queryParams: {} }],
    [TOOL, { method: 'GET', url: url('/composite'), queryParams: {} }],
    [TOOL, { method: 'GET', url: url('/graphql'), queryParams: { queryInput: '{}' } }],
    [TOOL, { method: 'GET', url: url('/graphql'), queryParams: { queryInput: '{' } }],
    [TOOL, { method: 'GET', url: url('/graphql'), queryParams: { queryInput: JSON.stringify({ query: 'mutation { uiapi { CaseDelete(input: {}) { Id } } }' }) } }],
    [TOOL, { method: 'GET', url: url('/graphql'), queryParams: { queryInput: JSON.stringify({ query: 'query { x } mutation { y }' }) } }],
    [TOOL, { method: 'GET', url: url('/graphql'), queryParams: { queryInput: JSON.stringify({ query: 'query{x}', variables: {} }) } }],
    [TOOL, { method: 'GET', url: url('/graphql'), queryParams: { query: 'query{x}' } }],
    [TOOL, { method: 'GET', url: url('/sobjects/Account/001000000000001AAA'), queryParams: {} }],
    [TOOL, { method: 'GET', url: url('/tooling/sobjects/ApexClass'), queryParams: {} }],
    [TOOL, { method: 'GET', url: url('/limits'), queryParams: { x: '1' } }],
    [TOOL, { method: 'GET', url: url('/query/../sobjects'), queryParams: { q: 'x' } }],
    [TOOL, { method: 'GET', url: 'https://evil.example/services/data/v66.0/query', queryParams: { q: 'x' } }],
    [TOOL, { method: 'GET', url: url('/query'), queryParams: {} }],
    [TOOL, { method: 'GET', url: url('/query'), queryParams: { q: 'x', explain: 'y' } }],
    [TOOL, { method: 'GET', url: url('/query'), queryParams: { q: ['x'] } }],
    [TOOL, { method: 'GET', url: url('/sobjects/Case/describe'), queryParams: { q: 'x' } }],
  ];
  for (const [tool, args] of refused) assert.throws(() => checkCall(tool, args), (e) => e.code === 400, JSON.stringify([tool, args]));
});

test('the local copy reaches Live through the relay, which answers in the connector\'s shape', async () => {
  const org = briefingOrg(), sent = [];
  const send = async (method, p) => {
    sent.push(`${method} ${p}`);
    try { return { status: 200, body: await org.request(p.replace(/\+/g, '%20')) }; } catch (e) { return { status: e.httpStatus || 400, body: [{ message: e.message }] }; }
  };
  const relay = createRelay({ send, instanceUrl: () => ORG });
  assert.equal(readAnswer(await relay(TOOL, { method: 'GET', url: `${BASE}/sobjects/Case/describe`, queryParams: {} })).url, `${ORG}${BASE}/sobjects/Case/describe`);
  const fetch = async (u) => {
    const q = new URL(u, 'http://localhost:5192/').searchParams, out = await relay(q.get('tool'), JSON.parse(q.get('args')));
    return { ok: true, json: async () => out };
  };
  const el = await runPage(buildLiveHtml({ local: true }), { globals: { fetch }, until: ['Live', 'Not connected'] });
  assert.equal(el('state').textContent, 'Live', el('needs-why').textContent);
  assert.match(el('today').innerHTML, /Not in this org \(Shipment\)/);
  assert.ok(sent.every((s) => s.startsWith('GET ')) && !sent.some((s) => s.includes('/composite')));
});

test('the local copy says how to sign in with the sf CLI when the relay has no sign-in', async () => {
  const fetch = async () => ({ ok: false, status: 502, text: async () => 'Not signed in to Salesforce: run "sf org login web --alias om-console", then reload.' });
  const el = await runPage(buildLiveHtml({ local: true }), { globals: { fetch }, until: ['Not connected'] });
  assert.equal(el('state').textContent, 'Not connected');
  assert.match(el('needs-how').textContent, /sf CLI sign-in/);
  assert.match(el('needs-why').textContent, /Not signed in to Salesforce/);
});

// ---------- the full console ----------

test('the console builds with its in-org mode on and om-cowork.js in om-platform.js\'s place; nothing else changes', () => {
  const html = buildConsoleHtml(), page = readFileSync(new URL("../../../public/operations-console/index.html", import.meta.url), 'utf8');
  const defs = [...html.matchAll(/__omcDef\('([\w.-]+)'/g)].map((m) => m[1]);
  for (const m of ['om-cowork.js', 'om-command-core.js', 'om-reads.js', 'om-graphql.js', 'graphql-batch.js', 'artifact-connector.js', 'artifact-call.js', 'agent-panel.js']) assert.ok(defs.includes(m), m);
  for (const m of ['om-platform.js', 'om-browser.js', 'om-actions.js']) assert.ok(!defs.includes(m), `${m} isn't in the page`);
  // agent-panel.js takes isReadAction from om-agent.js; createAgent, which makes the Agent API calls, is only defined, never called.
  assert.equal(html.match(/\bcreateAgent\(/g)?.length, 1);
  assert.match(html, /const FORCE = 'platform';/); // om-mode.js: inside Salesforce's path, reading through the connector
  assert.match(html, /__omcImport\('om-cowork\.js'\)\)\.createPlatform\(\{ onRequest: meterRecord, graphqlReads: [^}]*\}\)/); // as om-platform.js is started (om-cowork.js ignores graphqlReads)
  assert.equal(html.split(PLACEHOLDER).length, 2);
  assert.match(html, /<style>\.agent-btn\{display:none\}<\/style>/);
  assert.ok(Buffer.byteLength(html) < MAX_BYTES);
  // Only the two switches differ: the mode (om-mode.js) and the platform module the page starts.
  assert.ok(!html.includes('const FORCE = null;'));
  assert.equal(page.split("import('./om-command-platform.js')").length, 2);
  assert.ok(!html.includes("__omcImport('om-platform.js')"));
  assert.match(buildConsoleHtml({ local: true }), /fetch\(`connector\?/);
});

// Loads a built page's module bundle (the loader and its __omcDef scripts, not the page's own script) into a sandbox.
function bundle(html) {
  const ctx = vm.createContext({ console, URL, URLSearchParams, setTimeout, clearTimeout, Date, Intl, AbortSignal });
  ctx.window = ctx;
  for (const [, code] of html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)) {
    if (code.startsWith('(function () {\n  var defs') || code.startsWith('__omcDef(')) vm.runInContext(code, ctx);
  }
  return (name) => vm.runInContext(`__omcImport(${JSON.stringify(name)})`, ctx);
}

test('the built console reads through the connector: the same answers as REST, with describes and aggregates batched', async () => {
  const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (['at', 'prevTo', 'now', 'instanceUrl'].includes(k) ? undefined : x)));
  const org = fakeOrg({ queries: [[/./, []]] }), rest = connector(org), sent = [];
  // dispatch_readonly in front of the fake org, with GraphQL too: objectInfos from its schema, and every aggregate empty.
  const call = async (tool, args) => {
    sent.push(args.url.replace(BASE, ''));
    if (!args.url.endsWith('/graphql')) return rest(tool, args);
    const query = JSON.parse(args.queryParams.queryInput).query;
    const names = query.match(/objectInfos\(apiNames:(\[[^\]]*\])/);
    if (names) {
      const list = JSON.parse(names[1]);
      return answer(200, { data: { uiapi: { objectInfos: list.map((n) => (SCHEMA[n] ? { ApiName: n, fields: SCHEMA[n].map((f) => ({ ApiName: f.name, relationshipName: f.relationshipName ?? null, referenceToInfos: (f.referenceTo || []).map((r) => ({ ApiName: r })) })) } : null)) } },
        errors: list.flatMap((n, i) => (SCHEMA[n] ? [] : [{ message: `No ObjectInfo for apiName: ${n}`, paths: ['uiapi', 'objectInfos', i] }])) }, `${ORG}${args.url}`);
    }
    return answer(200, { data: { uiapi: { aggregate: Object.fromEntries([...query.matchAll(/(d\d+_\d+):/g)].map((m) => [m[1], { edges: [] }])) } } }, `${ORG}${args.url}`);
  };
  const { createPlatform } = await bundle(buildConsoleHtml())('om-cowork.js'), metered = [];
  const cowork = createPlatform({ call, onRequest: (e) => metered.push(e) });
  const plain = async (v) => JSON.parse(JSON.stringify(await v)); // objects from the sandbox's own realm
  assert.deepEqual(await plain(cowork.status()), { connected: true, username: 'acme.my.salesforce.com', instanceUrl: ORG, platform: true });
  const live = await cowork.route('/api/console?range=7d');
  const directOrg = fakeOrg({ queries: [[/./, []]] }), direct = await directOrg.core.route('/api/console?range=7d');
  assert.deepEqual(strip(live), strip(direct));
  const graphql = sent.filter((u) => u === '/graphql').length, describes = sent.filter((u) => u.endsWith('/describe'));
  assert.ok(graphql >= 2, `${graphql} GraphQL`);
  // Only objects objectInfos had no info for ask REST's describe: here, the ones the fake org lacks.
  assert.ok(describes.length && describes.every((u) => !SCHEMA[u.split('/')[2]]), describes.join(', '));
  assert.ok(sent.length < directOrg.calls.length, `${sent.length} connector calls against ${directOrg.calls.length} REST calls`);
  // The Limits view's meter hears about every connector call, as om-platform.js reports its own.
  assert.equal(metered.length, sent.length);
  assert.ok(metered.every((e) => ['graphql', 'ui-api'].includes(e.kind) && e.method === 'GET' && typeof e.ms === 'number' && e.status >= 200)); // 404s: the describes for objects the fake org lacks
  // Agentforce and anything but a GET are off; the agent check costs no query.
  assert.deepEqual(await plain(cowork.route('/api/agent/info')), { agent: null });
  await assert.rejects(cowork.route('/api/agent/session', { method: 'POST' }), (e) => e.code === 404 && /only reads/.test(e.message));
});
