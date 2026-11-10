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
// The live view's way to the org: the viewer's Salesforce (Headless 360) connector, called by the artifact page. createCore()
// asks for REST GETs ('/query?q=…', '/sobjects/X/describe'), and each one goes out as a single dispatch_readonly call. Run
// it with apiVersion() null, so createCore sends every GET on its own and never batches into /composite (a POST). The page
// is published with only dispatch_readonly allowed, and this refuses any POST before it reaches the connector.
export const CONNECTOR = 'Salesforce';
export const TOOL = 'dispatch_readonly';
export const API_VERSION = 'v66.0';
// The first call: the query a Cowork skill confirms the org with. Any HTTP answer, even an error, means the connector works.
export const PROBE = `/query?q=${encodeURIComponent('SELECT Id FROM Organization LIMIT 1')}`;

const sfMessage = (b) => (Array.isArray(b) ? b.map((e) => e?.message || e?.errorCode).filter(Boolean).join('; ') : typeof b?.message === 'string' ? b.message : '');

// The connector's answer, an MCP tool result: its text is the HTTP answer, { status_code, body, url } (url is the full
// address, the org's domain included). A failure of the call itself (a tool that isn't allowed, the rate limit, no
// connection) is isError with a message, and is thrown. Returns { status, body, url }.
export function readAnswer(r) {
  const text = (Array.isArray(r?.content) ? r.content : []).filter((c) => c?.type === 'text').map((c) => c.text).join('');
  let a = null;
  try { a = JSON.parse(text); } catch { /* not an HTTP answer */ }
  if (typeof a?.status_code !== 'number') throw new Error(text || `The ${CONNECTOR} connector call failed`);
  let body = a.body ?? null;
  if (typeof body === 'string' && body) { try { body = JSON.parse(body); } catch { /* plain text */ } }
  return { status: a.status_code, body, url: typeof a.url === 'string' ? a.url : null };
}

// The body of a successful answer; an HTTP error is thrown with httpStatus like om-core's, and code 401 for a dead session.
export function unwrap(r) {
  const { status, body } = readAnswer(r);
  if (status < 300) return body;
  const e = Object.assign(new Error(sfMessage(body) || (typeof body === 'string' && body) || `HTTP ${status}`), { httpStatus: status });
  if (status === 401) e.code = 401;
  throw e;
}

// call(tool, args) → the tool's result. Returns createCore's request(path, post), with request.instanceUrl(): the org's
// address, from the answers. `blocked` is the deployment's CONFIG.blocked (om-config.js): the page refuses an org it matches,
// as both sign-in paths do, with blockedRefusal()'s error (om-http.js): 409, marked `orgBlocked`.
export function connectorRequest(call, { blocked = [] } = {}) {
  let instance = null;
  const request = async (p, post) => {
    if (post !== undefined) throw new Error(`Refusing to POST to ${p}: the live view only reads`);
    const at = p.indexOf('?'), path = at < 0 ? p : p.slice(0, at);
    const queryParams = Object.fromEntries(new URLSearchParams(at < 0 ? '' : p.slice(at + 1)));
    const r = await call(TOOL, { method: 'GET', url: `/services/data/${API_VERSION}${path}`, queryParams });
    const { url } = readAnswer(r);
    let origin = null;
    try { origin = url && new URL(url).origin; } catch { /* a relative url: nothing to learn */ }
    if (origin && blocked.some((re) => re.test(origin))) throw Object.assign(new Error(`This page refuses to run against ${origin}: connect your Order Management org instead.`), { code: 409, orgBlocked: true });
    if (origin) instance = origin;
    return unwrap(r);
  };
  request.instanceUrl = () => instance;
  return request;
}

// Whether the connector reaches the org: { ok: true }, or { ok: false, error } when the call itself failed (not connected,
// the viewer declined, the page isn't set up, a blocked org) or the sign-in expired. An HTTP error from Salesforce still counts.
export async function probe(request) {
  try { await request(PROBE); return { ok: true }; }
  catch (e) { return e.httpStatus && e.httpStatus !== 401 ? { ok: true } : { ok: false, error: e }; }
}
