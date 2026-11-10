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
// How the live page calls the viewer's Salesforce connector in Cowork: window.cowork.callMcpTool, by the tool's full name
// (mcp__<connector-id>__dispatch_readonly). That name differs between connector installs, so the publishing skill writes it
// into the page (cowork-skill/configure.py fills the #omc-tools block) and puts the same name on the artifact's mcp_tools
// allowlist. `build-live-artifact.mjs --local` builds the page with artifact-call-local.js in this module's place instead.
import { CONNECTOR } from './artifact-connector.js';

// What the "connect" panel tells a viewer; null keeps the page's own words.
export const connectHelp = null;

// The #omc-tools block holds a placeholder as built (build-live-artifact.mjs PLACEHOLDER; it must appear in the page just
// once, so it isn't spelled out here), and configure.py replaces it with { "dispatch_readonly": "<full tool name>" }.
export const TOOL_NAME = /^mcp__[A-Za-z0-9_-]+__dispatch_readonly$/;

// Cowork lets an artifact make 30 calls a minute (a bucket that starts full) and rejects the rest with "Artifact MCP rate
// limit exceeded". Calls are paced a little below that, and a rejected one is retried after a growing wait.
export const PACE_PER_MINUTE = 24;
export const RETRY_MS = [2000, 4000, 8000];
const CALL_MS = 60000;

const setUp = (reason) => Object.assign(new Error(reason), { notWired: true });

// The block's text → { ok: true, tools } or { ok: false, reason }.
export function readTools(text) {
  if (!text) return { ok: false, reason: 'The connector block is missing from this page.' };
  let t;
  try { t = JSON.parse(text); } catch { return { ok: false, reason: 'The connector block in this page is not valid JSON.' }; }
  if (t?.__placeholder) return { ok: false, reason: `This copy isn't set up for live data: no ${CONNECTOR} connector was configured when it was published.` };
  if (typeof t?.dispatch_readonly !== 'string' || !TOOL_NAME.test(t.dispatch_readonly)) return { ok: false, reason: 'The connector block needs the full dispatch_readonly tool name.' };
  return { ok: true, tools: t };
}

// Resolves once a call may start: `capacity` at once, then one every windowMs / capacity.
export function createBucket(capacity, windowMs, { now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let tokens = capacity, last = now();
  return async function take() {
    for (;;) {
      const t = now();
      tokens = Math.min(capacity, tokens + ((t - last) * capacity) / windowMs);
      last = t;
      if (tokens >= 1) { tokens -= 1; return; }
      await sleep(((1 - tokens) * windowMs) / capacity);
    }
  };
}

export const isRateLimited = (e) => /rate limit exceeded/i.test(e?.message || '');

// Runs call(), and again after each wait while Cowork turns it away for the rate limit.
export async function retryRateLimited(call, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  for (const ms of RETRY_MS) {
    try { return await call(); } catch (e) { if (!isRateLimited(e)) throw e; await sleep(ms); }
  }
  return call();
}

const take = createBucket(PACE_PER_MINUTE, 60000);
const textOf = (r) => (Array.isArray(r?.content) ? r.content : []).filter((c) => c?.type === 'text').map((c) => c.text).join('');
let tools = null;

export async function callConnector(tool, args) {
  const bridge = globalThis.cowork;
  if (typeof bridge?.callMcpTool !== 'function') throw setUp(`Open this page in Cowork for live data: outside it there's no ${CONNECTOR} connector to call.`);
  tools ||= readTools(globalThis.document?.getElementById('omc-tools')?.textContent);
  if (!tools.ok) throw setUp(tools.reason);
  const name = tools.tools[tool];
  if (!name) throw new Error(`${tool} isn't one of this page's tools`);
  return retryRateLimited(async () => {
    await take();
    let timer;
    const r = await Promise.race([bridge.callMcpTool.call(bridge, name, args),
      new Promise((_, no) => { timer = setTimeout(() => no(new Error(`${CONNECTOR} took more than ${CALL_MS / 1000}s to answer`)), CALL_MS); })]);
    clearTimeout(timer);
    if (r?.isError && isRateLimited({ message: textOf(r) })) throw new Error(textOf(r)); // retried
    return r;
  });
}
