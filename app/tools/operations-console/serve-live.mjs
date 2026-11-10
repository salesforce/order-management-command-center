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
// The live pages on your machine: serves the console (/) and the briefing (/briefing) built with --local, and answers their
// connector calls the way Headless 360's dispatch_readonly would, with the sf CLI's sign-in for one alias (default
// "om-console"), as server.mjs does. Only GETs of what the pages send (a SOQL or Tooling API query, a describe, /limits, a
// GraphQL query document) reach the org, so nothing here can change data.
// Usage: node tools/serve-live.mjs   → http://localhost:5192   (PORT and OM_ORG_ALIAS as for server.mjs)
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConn } from "../../sf-conn.mjs";
import { buildLiveHtml, buildConsoleHtml } from "./build-live-artifact.mjs";
import { TOOL } from "./artifact-connector.js";

// What the page sends, each with only its own parameter. The API version in the page's URL gives way to the org's.
const PATHS = [[/^\/query$/, 'q'], [/^\/sobjects\/\w+\/describe$/, null], [/^\/graphql$/, 'queryInput'],
  [/^\/limits$/, null], [/^\/tooling\/query$/, 'q']]; // the last two: the Limits view's org limits and its Tooling API counts
const bad = (m) => { throw Object.assign(new Error(m), { code: 400 }); };

// tool, args → the path to GET under /services/data/vNN.N, or a 400 for anything the page doesn't send.
export function checkCall(tool, args) {
  if (tool !== TOOL) bad(`Only ${TOOL} is answered here`);
  if (args?.method !== 'GET') bad('Only GET is answered here');
  const m = typeof args.url === 'string' && args.url.match(/^\/services\/data\/v\d+\.\d+(\/[\w/]+)$/);
  const hit = m && PATHS.find(([re]) => re.test(m[1]));
  if (!hit) bad(`Not a read this page makes: ${args.url}`);
  const params = args.queryParams ?? {}, keys = Object.keys(params), want = hit[1] ? [hit[1]] : [];
  if (keys.length !== want.length || keys.some((k) => !want.includes(k) || typeof params[k] !== 'string')) bad(`Unexpected parameters for ${m[1]}`);
  if (want[0] === 'queryInput') { // GraphQL: a query document and nothing else (graphql-batch.js), never a mutation
    let input = null;
    try { input = JSON.parse(params.queryInput); } catch { /* refused below */ }
    const keysIn = input && typeof input === 'object' ? Object.keys(input) : [];
    if (keysIn.length !== 1 || typeof input.query !== 'string' || !/^\s*query\b/.test(input.query) || /\bmutation\b/i.test(input.query)) bad('Only a GraphQL query document is answered here');
  }
  return want.length ? `${m[1]}?${new URLSearchParams(params)}` : m[1];
}

// send(method, path) → { status, body }, sf-conn's call that reports an HTTP error instead of throwing, as the connector does.
// Each call is answered the way the connector answers: an MCP tool result whose text is { status_code, body, url }.
export function createRelay({ send, instanceUrl = () => null }) {
  return async (tool, args) => {
    const { status, body } = await send('GET', checkCall(tool, args)), org = instanceUrl();
    return { content: [{ type: 'text', text: JSON.stringify({ status_code: status, body, ...(org ? { url: `${org}${args.url}` } : {}) }) }] };
  };
}

export async function main() {

  const PORT = Number(process.env.PORT || 5192), ALIAS = process.env.OM_ORG_ALIAS || 'om-console';
  const HOSTS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
  const conn = createConn({ alias: ALIAS });
  const relay = createRelay({ send: conn.send, instanceUrl: () => conn.current()?.instanceUrl });
  const reply = (res, code, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    // A page on another site can point its own hostname at 127.0.0.1 (DNS rebinding): only our own names, same origin.
    if (!HOSTS.includes(req.headers.host)) return reply(res, 403, 'Unknown host refused');
    if (req.method !== 'GET') return reply(res, 405, 'Only GET is answered here');
    try {
      if (u.pathname === '/' || u.pathname === '/index.html') return reply(res, 200, buildConsoleHtml({ local: true }), 'text/html; charset=utf-8');
      if (u.pathname === '/briefing') return reply(res, 200, buildLiveHtml({ local: true }), 'text/html; charset=utf-8');
      if (u.pathname !== '/connector') return reply(res, 404, 'Not found');
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return reply(res, 403, 'Cross-origin request refused');
      let args;
      try { args = JSON.parse(u.searchParams.get('args') || ''); } catch { return reply(res, 400, 'Bad args'); }
      return reply(res, 200, await relay(u.searchParams.get('tool'), args), 'application/json');
    } catch (e) {
      const text = e.code === 401 ? `Not signed in to Salesforce: run "sf org login web --alias ${ALIAS}", then reload.` : e.message;
      return reply(res, e.code === 400 ? 400 : 502, text);
    }
  }).listen(PORT, '127.0.0.1', () => console.log(`Salesforce Order Management Operations Console live (local) → http://localhost:${PORT}, briefing at /briefing  (org alias: ${ALIAS})`));

}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
