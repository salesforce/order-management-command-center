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
// Shared OAuth/session transport. App profiles inject their read model and optional action adapter.
import { isBlocked, blockedRefusal, BLOCKED_MESSAGE, tooSlow, isTooSlow, readInit, readBody, writeInit, slowWrite, writeAnswer } from './om-http.js';
import { CONFIG } from './om-config.js';
import { createAgent, agentMessage } from '../agent/om-agent.js';
import { createMeter } from './om-meter.js';

export function createBrowser({ createCore, loadActions }) {
const DOMAIN_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(my\.)?salesforce\.com$/i;
// Tokens live in sessionStorage: this tab only, gone when it closes.
const AUTH_KEY = 'omc.auth', PENDING_KEY = 'omc.pkce', ERROR_KEY = 'omc.loginError';

let refused = false; // the kept session was dropped because its org is blocked now
let auth = JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null'); // { accessToken, refreshToken, instanceUrl, domain, clientId, username, apiVersion, scope }
const save = (a) => { auth = a; if (a) refused = false; a ? sessionStorage.setItem(AUTH_KEY, JSON.stringify(a)) : sessionStorage.removeItem(AUTH_KEY); };
const fail = (message, code = 401) => Object.assign(new Error(message), { code });

// Every call this page makes, for the Limits view. Tabs on one origin share it (om-meter.js), so the Limits tab sees the others' calls.
const meter = createMeter();
const note = (p, post, t0, status, body) => meter.record({ t: t0, path: p, method: post === undefined ? 'GET' : 'POST', ms: Date.now() - t0, status, rows: Array.isArray(body?.records) ? body.records.length : null });

// The callback must match the External Client App exactly: the console's URL without query, hash or index.html. OM Service Console
// (the service/ page) signs in through that same callback, so a new page needs no new callback URL: the console page finishes
// the sign-in and sends the tab back (completeLogin). sessionStorage is per tab and origin, so both pages share the token.
const SUB = 'service/';
const consolePath = (p) => p.replace(/index\.html$/, '').replace(/service\/$/, '');
const home = () => consolePath(location.pathname);
const redirectUri = () => location.origin + home();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
// Trailing slashes off in one pass: /\/+$/ on typed text backtracks over a long run of slashes (Sonar S5852).
const noSlash = (s) => {
  let i = s.length;
  while (s[i - 1] === '/') i--;
  return s.slice(0, i);
};

// An empty domain or consumer key is the deployment's own (CONFIG in om-config.js); with neither there, the screen asks.
async function login(domain, clientId) {
  domain = noSlash(String(domain || '').trim() || CONFIG.domain);
  if (!DOMAIN_RE.test(domain)) throw fail('Enter your org\'s My Domain URL, e.g. https://yourdomain.my.salesforce.com', 400);
  if (isBlocked(CONFIG.blocked, domain)) throw blockedRefusal(BLOCKED_MESSAGE);
  clientId = String(clientId || '').trim() || CONFIG.clientId;
  if (!clientId) throw fail('Enter the consumer key of your org\'s External Client App', 400);
  const verifier = random(48), state = random(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  // Keep ?auth=… and the #dashboard hash so the page comes back the way it was.
  const sub = location.pathname.endsWith('/' + SUB) || location.pathname.endsWith(`/${SUB}index.html`);
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, domain, clientId, back: (sub ? SUB : '') + location.search + location.hash }));
  location.assign(`${domain}/services/oauth2/authorize?${new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri(), scope: 'api refresh_token chatbot_api sfap_api',
    code_challenge: challenge, code_challenge_method: 'S256', state })}`);
}

async function token(domain, params) {
  const res = await fetch(`${domain}/services/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw fail(body.error_description || body.error || `Token request failed (HTTP ${res.status})`);
  return body;
}

// Called on every load: finishes a sign-in if Salesforce just redirected back here with ?code=…
async function completeLogin() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return false;
  const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
  sessionStorage.removeItem(PENDING_KEY);
  // A sign-in that started on the service page goes back there, with any error for that page to show.
  const toSub = !!pending?.back?.startsWith(SUB);
  const back = (err) => { if (err) sessionStorage.setItem(ERROR_KEY, err.message); location.replace(home() + pending.back); return new Promise(() => {}); };
  if (!toSub) history.replaceState(null, '', location.pathname + (pending?.back || ''));
  if (q.has('error')) { const e = fail(q.get('error_description') || q.get('error')); if (toSub) return back(e); throw e; }
  if (!pending || q.get('state') !== pending.state) { const e = fail('Sign-in could not be verified (state mismatch). Try again.'); if (toSub) return back(e); throw e; }
  if (toSub) { try { await finish(q, pending); } catch (e) { return back(e); } return back(); }
  await finish(q, pending);
  return true;
}

// A sign-in error the console page carried over to the service page; read once.
function takeLoginError() {
  const m = sessionStorage.getItem(ERROR_KEY);
  sessionStorage.removeItem(ERROR_KEY);
  return m;
}

async function finish(q, pending) {
  const t = await token(pending.domain, { grant_type: 'authorization_code', code: q.get('code'), client_id: pending.clientId, redirect_uri: redirectUri(), code_verifier: pending.verifier });
  const base = { accessToken: t.access_token, refreshToken: t.refresh_token || null, instanceUrl: t.instance_url, domain: pending.domain, clientId: pending.clientId, scope: t.scope || '' };
  const headers = { Authorization: `Bearer ${base.accessToken}` };
  // Newest API version the org speaks, then who signed in (the id URL ends in the user Id).
  const versions = await (await fetch(`${base.instanceUrl}/services/data/`, { headers })).json();
  const apiVersion = versions.map((v) => v.version).sort((a, b) => Number(a) - Number(b)).pop() || '62.0';
  const userId = String(t.id || '').split('/').pop();
  const who = await (await fetch(`${base.instanceUrl}/services/data/v${apiVersion}/query?q=${encodeURIComponent(`SELECT Username FROM User WHERE Id = '${userId.replace(/[^a-zA-Z0-9]/g, '')}'`)}`, { headers })).json();
  const username = who.records?.[0]?.Username || userId;
  if (isBlocked(CONFIG.blocked, username, base.instanceUrl)) { await revoke(base); throw blockedRefusal(`${username} is in an org this deployment refuses to run against.`); }
  save({ ...base, apiVersion, username });
  core.reset();
}

// Many panels query at once, so concurrent 401s share one refresh. Salesforce rotates the refresh token, so keep the new one.
let refreshing = null;
function refresh(staleToken) {
  if (auth && auth.accessToken !== staleToken) return Promise.resolve(); // another request already refreshed it
  if (!auth?.refreshToken) return Promise.reject(fail('Your session expired. Sign in again.'));
  return (refreshing ||= token(auth.domain, { grant_type: 'refresh_token', refresh_token: auth.refreshToken, client_id: auth.clientId })
    .then((t) => save({ ...auth, accessToken: t.access_token, refreshToken: t.refresh_token || auth.refreshToken, instanceUrl: t.instance_url || auth.instanceUrl, scope: t.scope || auth.scope }))
    .finally(() => { refreshing = null; }));
}

async function request(p, post, retry = true) {
  if (!live()) throw notConnected();
  const used = auth.accessToken, opts = readInit(p, post, { Authorization: `Bearer ${used}` }); // a slow query can't hang the page
  const t0 = Date.now();
  let res;
  for (let i = 1; ; i++) { // network blips surface as TypeError; retry those only, never a timeout
    try { res = await fetch(`${auth.instanceUrl}/services/data/v${auth.apiVersion}${p}`, opts); break; }
    catch (e) { if (isTooSlow(e) || opts.signal.aborted) { note(p, post, t0, 0); throw tooSlow(); } if (i >= 3) { note(p, post, t0, 0); throw e; } await new Promise((r) => setTimeout(r, 250 * i)); }
  }
  if (res.status === 401 && retry) {
    note(p, post, t0, 401);
    try { await refresh(used); } catch (e) { save(null); throw e; }
    return request(p, post, false);
  }
  const body = await res.json().catch(() => ({}));
  note(p, post, t0, res.status, body);
  return readBody(res, body);
}

const core = createCore({ request, instanceUrl: () => auth?.instanceUrl, apiVersion: () => auth?.apiVersion });

// A session kept from an earlier load is held to the block list as it is now: an org blocked since it signed in is dropped
// before anything reports it connected or sends a request with it.
function live() {
  if (auth && isBlocked(CONFIG.blocked, auth.username, auth.instanceUrl)) { revoke(auth); save(null); core.reset(); refused = true; }
  return auth;
}
const notConnected = () => (refused ? blockedRefusal(BLOCKED_MESSAGE) : fail('Not connected'));

function status() {
  if (live()) return { connected: true, username: auth.username, instanceUrl: auth.instanceUrl };
  return refused ? { connected: false, error: BLOCKED_MESSAGE } : { connected: false };
}

// Agent calls: the one exception to read-only, limited to the three Agent API calls om-agent.js allows.
// The Agent API takes the browser token directly, but only if it was issued with chatbot_api; sessions from before
// that scope was requested get a "sign in again" error, and the other panels keep working.
const agentError = (message, kind, code) => Object.assign(new Error(message), { kind, code });
let agentClient = null; // { key, client }
async function agent() {
  if (!String(auth.scope || '').split(/\s+/).includes('chatbot_api')) throw agentError('Sign in again to turn on Agentforce', 'scope', 403);
  const { agent: info } = await core.route('/api/agent/info');
  if (!info) throw agentError("Agentforce isn't set up in this org", 'missing', 404);
  const key = `${auth.instanceUrl} ${info.id}`;
  if (agentClient?.key !== key) {
    agentClient = { key, client: createAgent({
      token: () => { if (!auth) throw agentError('Your session expired. Sign in again.', 'auth', 401); return auth.accessToken; },
      instanceUrl: auth.instanceUrl, agentId: info.id,
      onUnauthorized: async (used) => { try { await refresh(used); } catch (e) { save(null); throw Object.assign(e, { kind: 'auth' }); } },
    }) };
  }
  return agentClient.client;
}

async function agentRoute(method, url, body, opts = {}) {
  if (method === 'POST' && url === '/api/agent/session') return { sessionId: await (await agent()).start() };
  if (method === 'POST' && url === '/api/agent/message') {
    let b = {}; try { b = JSON.parse(body || '{}') || {}; } catch {}
    const { sessionId, text } = agentMessage(b);
    return (await agent()).send(sessionId, text);
  }
  const em = method === 'DELETE' && url.match(/^\/api\/agent\/session\/([^/?]+)$/);
  if (em) { await (await agent()).end(em[1], { keepalive: !!opts.keepalive }); return { ok: true }; }
  throw fail('Not found', 404);
}

// OM Service Console's writes. Off unless the service page turns them on, so the read-only console, which shares this module, can't
// reach them. om-actions.js loads only then, and checks every call against its allowlist.
let actions = null;
function enableActions() { if (!loadActions) throw fail('Not found', 404); actions ||= loadActions().then((m) => m.createActions({ send: (method, p, body) => send(method, p, body), version: () => auth?.apiVersion, payments: (id) => core.paymentFacts(id), policy: (id, o) => core.policyFacts(id, o), bundles: (id, of) => core.bundleFacts(id, of),
  products: (store, account, sku) => core.productFacts(store, account, sku), pictures: (id, store, account) => core.pictureFacts(id, store, account),
  paylinks: { facts: (store, account, cart) => core.paylinkFacts(store, account, cart), get: (id) => core.paylinkRead(id) } })); }
async function send(method, p, body, retry = true) {
  if (!live()) throw notConnected();
  const used = auth.accessToken, opts = writeInit(method, body, { Authorization: `Bearer ${used}`, Accept: 'application/json' });
  let res; // a write is sent once: after a network error it may still have gone through
  try { res = await fetch(`${auth.instanceUrl}/services/data/v${auth.apiVersion}${p}`, opts); }
  catch (e) { throw isTooSlow(e) || opts.signal.aborted ? slowWrite() : e; }
  if (res.status === 401 && retry) {
    try { await refresh(used); } catch (e) { save(null); throw e; }
    return send(method, p, body, false);
  }
  return writeAnswer(res);
}
async function actionRoute(body) {
  if (!actions) throw fail('Not found', 404);
  let b; try { b = JSON.parse(body || '{}') || {}; } catch { throw fail('Bad JSON', 400); }
  return (await actions).run(b);
}

// Same routes as server.mjs. Panels swallow their own errors, so a session that died mid-load is reported afterwards.
async function route(url, opts = {}) {
  if (!live()) throw notConnected();
  const method = String(opts.method || 'GET').toUpperCase();
  const out = method === 'GET' ? await core.route(url) : method === 'POST' && url === '/api/cs/action' ? await actionRoute(opts.body) : await agentRoute(method, url, opts.body, opts);
  if (!auth) throw fail('Your session expired. Sign in again.');
  return out;
}

async function revoke(a) {
  await fetch(`${a.domain}/services/oauth2/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: a.refreshToken || a.accessToken }) }).catch(() => {});
}

async function logout() {
  if (auth) await revoke(auth);
  save(null);
  core.reset();
}

return { meter, consolePath, login, completeLogin, takeLoginError, status, enableActions, route, logout };
}
