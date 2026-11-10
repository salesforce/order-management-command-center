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
// Salesforce Order Management Operations Console — local app. Zero dependencies; auth comes from the sf CLI.
// Uses its own org alias (default "om-console") and never sets or reads the global default org,
// so it cannot collide with any other org you have authorized.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { sourcePath, deploymentName, canonicalDocument, PUBLIC_SOURCES, APP_URL, legacyModule } from '../../public/source-layout.js';
import { createConn } from './sf-conn.mjs';
import { createAgent, agentMessage } from '../../public/shared/agent/om-agent.js';
import { errorBody } from '../../public/shared/transport/om-http.js';
import { createMeter } from '../../public/shared/transport/om-meter.js';

const LOGIN_URLS = { production: 'https://login.salesforce.com', sandbox: 'https://test.salesforce.com' };
export function loginArguments(env, customUrl, alias) {
  let url = Object.hasOwn(LOGIN_URLS, env) ? LOGIN_URLS[env] : null;
  if (env === 'custom') {
    if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(my\.)?salesforce\.com\/?$/i.test(customUrl || '')) throw Object.assign(new Error('Custom URL must be an https://….my.salesforce.com domain'), { code: 400 });
    url = customUrl.replace(/\/$/, '');
  }
  if (!url) throw Object.assign(new Error('Unknown login environment'), { code: 400 });
  return ['org', 'login', 'web', '--alias', alias, '--instance-url', url];
}

// Resolve declared assets before any request arrives. A request can select an entry, never construct a file path.
const PUBLIC_FILES = new Map();
for (const [legacy, source] of Object.entries(PUBLIC_SOURCES)) {
  const entry = { source, file: fileURLToPath(new URL('public/' + source, APP_URL)) };
  PUBLIC_FILES.set(legacy, entry);
  PUBLIC_FILES.set(source, entry);
}
export async function readPublic(name, encoding) {
  const entry = PUBLIC_FILES.get(name);
  if (!entry) throw Object.assign(new Error('Not found'), { code: 404 });
  const body = await readFile(entry.file, encoding);
  if (!entry.source.endsWith('.html')) return body;
  const text = canonicalDocument(String(body), deploymentName(entry.source), name);
  return encoding ? text : Buffer.from(text);
}

export function startHost({ createCore, createActions, profile = 'combined', port = Number(process.env.PORT || 5178), connectionFactory = createConn }) {
const PORT = port;
const ALIAS = process.env.OM_ORG_ALIAS || 'om-console';
const HOSTS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
// ---------- sf CLI auth ----------
let loginProc = null;
const sfc = connectionFactory({ alias: ALIAS, onConnect: () => core.reset() });
const { sf, getConn, requireConn, api, send: sendRest, fetchRetry } = sfc;

// Every REST call the console makes is counted here for the Limits view (/api/meter), tagged with the page that asked for it.
// The meter lives in this process, so it can't broadcast to tabs or persist: the page polls /api/meter instead.
const meter = createMeter({ storage: null, bc: null });
const callers = new AsyncLocalStorage();
const SOURCES = [[/^\/api\/dashboard/, 'dashboard'], [/^\/api\/console/, 'console'], [/^\/api\/service/, 'service']];
/**
 * A read through the connection, counted for the Limits view.
 * @param {string} p The request path.
 * @param {*} [post] A read-only POST body.
 * @returns {Promise<*>} What `api` answers.
 */
async function meteredApi(p, post) {
  const t0 = Date.now(), source = callers.getStore();
  const note = (status, body) => meter.record({ t: t0, path: p, method: post === undefined ? 'GET' : 'POST', ms: Date.now() - t0, status, source, rows: Array.isArray(body?.records) ? body.records.length : null });
  try { const body = await api(p, post); note(200, body); return body; }
  catch (e) { note(e.httpStatus || 0); throw e; }
}

// Every read query lives in om-core.js and om-reads.js so the browser-only build runs exactly the same ones.
const core = createCore({ request: meteredApi, instanceUrl: () => sfc.current()?.instanceUrl, apiVersion: () => sfc.current()?.apiVersion });

// The customer service app's writes (app/public/service): only the operations om-actions.js allows, each checked there.
const actions = createActions?.({ send: (method, path, body) => sendRest(method, path, body), version: () => sfc.current()?.apiVersion, policy: (id, o) => core.policyFacts(id, o), bundles: (id, of) => core.bundleFacts(id, of),
  payments: (id) => core.paymentFacts(id), products: (store, account, sku) => core.productFacts(store, account, sku), pictures: (id, store, account) => core.pictureFacts(id, store, account),
  paylinks: { facts: (store, account, cart) => core.paylinkFacts(store, account, cart), get: (id) => core.paylinkRead(id) } });

// ---------- Agentforce ----------
// The Agent API takes an agent token, not the sf session; the bootstrap endpoint swaps one for the other
// (as @salesforce/agents does). The token is cached until it expires and never sent to the page.
let agentTok = null; // { token, exp, from }
/**
 * The Agent API token, swapped from the sf session and cached until it expires.
 * @returns {Promise<string>} Never sent to the page; throws a 401, 503 or 404 error with a `kind`.
 */
async function agentToken() {
  const c = await requireConn();
  if (agentTok && agentTok.from === c.accessToken && Date.now() < agentTok.exp) return agentTok.token;
  const r = await fetchRetry(`${c.instanceUrl}/agentforce/bootstrap/nameduser`, { headers: { Cookie: `sid=${c.accessToken}`, Accept: 'application/json' } });
  const b = await r.json().catch(() => ({}));
  const token = b.access_token || b.accessToken || b.token;
  if (r.status === 401) throw Object.assign(new Error('Your session has expired'), { code: 401, kind: 'auth' });
  if (!r.ok || typeof token !== 'string') throw Object.assign(new Error(`Agentforce isn't available right now (token HTTP ${r.status})`), { code: 503, kind: 'unavailable' });
  let exp = Date.now() + 10 * 60 * 1000;
  try { const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); if (claims.exp) exp = claims.exp * 1000 - 60 * 1000; } catch {}
  agentTok = { token, exp, from: c.accessToken };
  return token;
}

// One client per org and agent, so message sequence numbers carry across requests.
let agentClient = null; // { key, client }
/**
 * The Agentforce client for this org and agent.
 * @returns {Promise<{start: Function, send: Function, end: Function}>} One client per org and agent, so sequence numbers carry across requests.
 */
async function agent() {
  const c = await requireConn();
  const { agent: info } = await core.route('/api/agent/info');
  if (!info) throw Object.assign(new Error("Agentforce isn't set up in this org"), { code: 404, kind: 'missing' });
  const key = `${c.instanceUrl} ${info.id}`;
  if (agentClient?.key !== key) {
    agentClient = { key, client: createAgent({
      token: agentToken, instanceUrl: c.instanceUrl, agentId: info.id,
      onUnauthorized: async (used) => { if (used === agentTok?.token) { agentTok = null; await getConn(true); } },
    }) };
  }
  return agentClient.client;
}

/**
 * Read a request's JSON body.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [max] Largest body in bytes.
 * @returns {Promise<object>} `{}` for no body; rejects with 413 when too large and 400 for bad JSON.
 */
function readJson(req, max = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (d) => { size += d.length; if (size > max) { reject(Object.assign(new Error('Request too large'), { code: 413 })); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { reject(Object.assign(new Error('Bad JSON'), { code: 400 })); } });
    req.on('error', reject);
  });
}

// ---------- HTTP ----------
/**
 * Answer a request.
 * @param {import('node:http').ServerResponse} res
 * @param {number} code HTTP status.
 * @param {*} body An object (sent as JSON) or text.
 * @param {string} [type] Content type; never cached.
 */
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
  return true;
}

/**
 * Handler of `GET /api/status`.
 * @returns {Promise<{alias: string, connected: boolean, username?: string, instanceUrl?: string, loginInProgress: boolean, error: string|null}>}
 */
async function status() {
  let c = null, error = null;
  try { c = await getConn(true); } catch (e) { error = e.message; }
  return { alias: ALIAS, connected: !!c, username: c?.username, instanceUrl: c?.instanceUrl, loginInProgress: !!loginProc, error };
}

/**
 * Handler of `POST /api/login`: start `sf org login web`.
 * @param {string} env 'production', 'sandbox' or 'custom'.
 * @param {string|null} customUrl The My Domain address when `env` is 'custom'.
 * @returns {void} Does nothing while a login is running; throws a 400 error for an unknown environment.
 */
function startLogin(env, customUrl) {
  if (loginProc) return;
  const args = loginArguments(env, customUrl, ALIAS);
  // Deliberately no --set-default / --set-default-dev-hub: other projects' default orgs stay untouched.
  loginProc = spawn('sf', args, { stdio: 'ignore', shell: false });
  loginProc.on('exit', () => { loginProc = null; sfc.clear(); });
}

function serveProfile(res, u, asset) {
  if (profile === 'service-center' && (u.pathname === '/' || u.pathname === '/index.html')) {
    res.writeHead(302, { Location: '/service/' + u.search }); return res.end();
  }
  const canonical = sourcePath(asset);
  if (profile === 'operations-console' && (canonical.startsWith('service-center/') || canonical.startsWith('composition/') || u.pathname.startsWith('/service'))) return send(res, 404, { error: 'Not found' });
  if (profile === 'service-center' && canonical.startsWith('operations-console/')) {
    return send(res, 404, { error: 'Not found' });
  }
}
async function serveCanonical(res, u, asset) {
  if (Object.values(PUBLIC_SOURCES).includes(asset)) {
    if (asset.endsWith('.html')) { res.writeHead(307, { Location: '/' + deploymentName(asset) + u.search }); return res.end(); }
    const type = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', html: 'text/html; charset=utf-8' }[asset.split('.').at(-1)];
    if (type) {
      const body = await readPublic(asset);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': ['geo.js', 'cities.js'].includes(asset.split('/').at(-1)) ? 'max-age=86400' : 'no-store' });
      return res.end(body);
    }
  }
}
async function serveServiceAssets(res, u) {
  // Service Console, the customer service app, is its own page under /service/ and shares the modules above it.
  if (u.pathname === '/service') { res.writeHead(301, { Location: '/service/' + u.search }); return res.end(); }
  if (u.pathname === '/service/' || u.pathname === '/service/index.html') {
    return send(res, 200, await readPublic('service/index.html', 'utf8'), 'text/html; charset=utf-8');
  }
  // The design study (service/designs/) is a set of static prototypes with sample data only.
  if (u.pathname === '/service/designs') { res.writeHead(301, { Location: '/service/designs/' }); return res.end(); }
  const sv = u.pathname.match(/^\/service\/((?:designs\/)?(?:[\w-]+\.(js|css|html))?)$/);
  if (sv && sv[1] && (sv[1].startsWith('designs/') || sv[2] !== 'html')) {
    const name = sv[1].endsWith('/') ? `${sv[1]}index.html` : sv[1], type = { js: 'text/javascript', css: 'text/css', html: 'text/html' }[sv[2] || 'html'];
    try { const body = await readPublic('service/' + name); res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); return res.end(body); }
    catch { return send(res, 404, { error: 'Not found' }); }
  }
}
async function serveOtherAssets(res, u, asset) {
  // Only browser scripts: legacy flat URLs and scoped source trees. Node, tests and tooling are never served.
  const js = Object.hasOwn(PUBLIC_SOURCES, asset) && u.pathname.match(/^\/((?:(?:operations-console|service-center|shared)\/(?:[\w-]+\/)*)?[\w-]+\.js)$/);
  if (js) {
    let body;
    try { body = await readPublic(js[1]); } catch { return send(res, 404, { error: 'Not found' }); }
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': ['geo.js', 'cities.js'].includes(js[1]) ? 'max-age=86400' : 'no-store' });
    return res.end(body);
  }
  // The design tokens both apps link, and the page that shows them (design/).
  if (u.pathname === '/tokens.css') {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(await readPublic('tokens.css'));
  }
  if (u.pathname === '/design') { res.writeHead(301, { Location: '/design/' }); return res.end(); }
  if (u.pathname === '/design/' || u.pathname === '/design/index.html') {
    return send(res, 200, await readPublic('design/index.html', 'utf8'), 'text/html; charset=utf-8');
  }
}
async function servePublic(req, res, u) {
  const asset = u.pathname.slice(1);
  if (serveProfile(res, u, asset)) return true;
  if (req.method !== 'GET') return false;
  const facade = Object.hasOwn(PUBLIC_SOURCES, asset) && asset.endsWith('.js') && legacyModule(asset);
  if (facade) return send(res, 200, facade, 'text/javascript; charset=utf-8');
  if (await serveCanonical(res, u, asset)) return true;
  if (u.pathname === '/' || u.pathname === '/index.html') return send(res, 200, await readPublic('index.html', 'utf8'), 'text/html; charset=utf-8');
  if (await serveServiceAssets(res, u)) return true;
  return serveOtherAssets(res, u, asset);
}
function apiGuard(req, res, u) {
  // A page on another site can point its own hostname at 127.0.0.1 (DNS rebinding); only our own names may call the API.
  if (u.pathname.startsWith('/api/') && !HOSTS.includes(req.headers.host)) return send(res, 403, { error: 'Unknown host refused' });
  if (u.pathname.startsWith('/api/') && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
    return send(res, 403, { error: 'Cross-origin request refused' });
  }
}
async function serveAuth(req, res, u) {
  if (req.method === 'GET' && u.pathname === '/api/status') return send(res, 200, await status());
  if (req.method === 'POST' && u.pathname === '/api/login') {
    startLogin(u.searchParams.get('env') || 'production', u.searchParams.get('url'));
    return send(res, 202, { started: true });
  }
  if (req.method === 'POST' && u.pathname === '/api/logout') {
    await sf(['org', 'logout', '--target-org', ALIAS, '--no-prompt']);
    sfc.clear();
    return send(res, 200, { ok: true });
  }
}
async function serveAgent(req, res, u) {
  // Agent calls: the one exception to read-only, limited to the three Agent API calls om-agent.js allows.
  if (req.method === 'POST' && u.pathname === '/api/agent/session') return send(res, 200, { sessionId: await (await agent()).start() });
  if (req.method === 'POST' && u.pathname === '/api/agent/message') {
    const { sessionId, text } = agentMessage(await readJson(req));
    return send(res, 200, await (await agent()).send(sessionId, text));
  }
  const em = req.method === 'DELETE' && u.pathname.match(/^\/api\/agent\/session\/([^/]+)$/);
  if (em) { await (await agent()).end(em[1]); return send(res, 200, { ok: true }); }
}
async function serveAction(req, res, u) {
  // Customer service actions: the app's only writes. The body is never logged (it can carry card details for the gateway).
  if (req.method === 'POST' && u.pathname === '/api/cs/action') {
    if (!actions) return send(res, 404, { error: 'Not found' });
    // JSON only: a cross-site form or no-cors fetch can't send it without a CORS preflight, which this server never answers.
    // That holds even in browsers that don't send Sec-Fetch-Site. An Origin, when sent, must be this server.
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Send the action as JSON' });
    if (req.headers.origin && !HOSTS.some((h) => req.headers.origin === `http://${h}`)) return send(res, 403, { error: 'Cross-origin request refused' });
    await requireConn();
    return send(res, 200, await actions.run(await readJson(req, 512 * 1024))); // a 2,000-line cancel is about 100 KB
  }
}
async function serveReads(req, res, u) {
  // The server's own call log for the Limits view: reads memory only, makes no call to the org.
  if (req.method === 'GET' && u.pathname === '/api/meter') {
    const since = Number(u.searchParams.get('since'));
    return send(res, 200, { now: Date.now(), entries: meter.entries(Number.isFinite(since) ? since : 0) });
  }
  if (req.method === 'GET' && u.pathname.startsWith('/api/')) {
    await requireConn();
    const source = SOURCES.find(([re]) => re.test(u.pathname))?.[1];
    return send(res, 200, await callers.run(source, () => core.route(u.pathname + u.search)));
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (await servePublic(req, res, u)) return;
    if (apiGuard(req, res, u)) return;
    if (await serveAuth(req, res, u)) return;
    if (await serveAgent(req, res, u)) return;
    if (await serveAction(req, res, u)) return;
    if (await serveReads(req, res, u)) return;
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    // A save the org's duplicate rules refused also names the records it matched (a new customer in Service Console); a payment
    // says whether the card was declined, the hold released, or its outcome unknown (errorBody in om-http.js).
    send(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, errorBody(e));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  if (PORT === 0) HOSTS.push(`localhost:${server.address().port}`, `127.0.0.1:${server.address().port}`);
  console.log(`Salesforce Order Management Operations Console → http://localhost:${server.address().port}  (org alias: ${ALIAS})`);
});
return server;
}
