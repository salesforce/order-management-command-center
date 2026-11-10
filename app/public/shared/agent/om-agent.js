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
// Agent API client: the one place the console makes non-read calls. Runs in Node (server.mjs) and the browser
// (om-browser.js); the caller passes the token in. It only ever makes three calls (start, message, end session) to an
// agent whose actions are all reads, and refuses anything else before fetch. om-core.js must never import this file.
export const AGENT_API = 'https://api.salesforce.com/einstein/ai-agent/v1';
// The standard read actions, then the agent's own: Run Query and Describe Object (org/agent's SomAgentQuery and
// SomAgentDescribe, which only read, as the user, on Order Management objects).
export const READ_ACTIONS = ['IdentifyRecordByName', 'IdentifyObjectByName', 'GetRecordDetails', 'QueryRecords', 'QueryRecordsWithAggregate', 'GetActivitiesTimeline', 'RunQuery', 'DescribeObject'];
// The same actions by their invocation targets, in case a reply names those instead.
const READ_TARGETS = ['identifyRecordByName', 'identifyObject', 'getDataForGrounding', 'queryRecords', 'queryRecordsWithAggregate', 'getActivitiesTimeline', 'SomAgentQuery', 'SomAgentDescribe'];
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const READS = [...READ_ACTIONS, ...READ_TARGETS].map(norm);

// Planner bundles prefix action names (OMC_Order_Lookup_QueryRecords) and replies can add an output prefix
// (copilotActionOutput/…), so a name is a read if it is one, or ends in one right after a `_`.
export function isReadAction(name) {
  const last = String(name || '').replace(/^.*\//, ''), n = norm(last), low = last.toLowerCase();
  return !!n && READS.some((r) => n === r || (low.endsWith(r) && low[low.length - r.length - 1] === '_'));
}

// A question as the panel sends it to POST /api/agent/message, checked the same way on every path (server.mjs, om-browser.js,
// om-platform.js) before anything goes to the agent: a session handle and 1 to MESSAGE_MAX characters of text.
export const MESSAGE_MAX = 4000;
export function agentMessage(b) {
  const { sessionId, text } = b && typeof b === 'object' ? b : {};
  if (typeof sessionId !== 'string' || typeof text !== 'string' || !text.trim() || text.length > MESSAGE_MAX) throw Object.assign(new Error('Bad message'), { code: 400, httpStatus: 400 });
  return { sessionId, text };
}

const ID = '[A-Za-z0-9-]{1,64}';
const ALLOWED = [
  ['POST', new RegExp(`^/agents/[A-Za-z0-9]{15,18}/sessions$`)],
  ['POST', new RegExp(`^/sessions/${ID}/messages$`)],
  ['DELETE', new RegExp(`^/sessions/${ID}$`)],
];
const allowed = (method, path) => ALLOWED.some(([m, re]) => m === method && re.test(path));

const agentError = (message, kind, code) => Object.assign(new Error(message), { kind, code });
// Agentforce is billed (Flex Credits, or Einstein Requests in older orgs). An org that has run out, or has none, answers
// with an error whose text says so; the panel then points at the setup steps instead of offering Retry.
export const CREDITS_RE = /\bflex credits?\b|\bcredits? (?:are |have been )?(?:exhausted|used up|insufficient)|\binsufficient credits?\b|\beinstein requests?\b|\busage limit\b/i;
function mapError(status, phase, detail) {
  if (status === 401) return agentError('Your session has expired', 'auth', 401);
  if (CREDITS_RE.test(detail || '')) return agentError('Agentforce has no credits left in this org', 'credits', status);
  if (status === 403) return agentError("This app isn't connected to the agent", 'forbidden', 403);
  if (phase === 'start' && (status === 404 || status === 412)) return agentError("Agentforce isn't available right now", 'unavailable', status);
  if (phase === 'send' && status === 404) return agentError('The agent session ended', 'expired', 404);
  return agentError(`Agentforce didn't answer (${status})${detail ? ': ' + String(detail).slice(0, 200) : ''}`, 'retry', status);
}

// Replies carry text in messages[].message. Where action names live isn't documented, so look in the likely places.
export function parseReply(body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const text = msgs.map((m) => (typeof m?.message === 'string' ? m.message.trim() : '')).filter(Boolean).join('\n\n');
  const actions = [];
  const add = (v) => { if (typeof v === 'string' && v && !actions.includes(v)) actions.push(v); };
  for (const m of msgs) {
    for (const key of ['result', 'actions', 'invokedActions', 'steps']) {
      // `type` is often a message kind (Text, Inform); it counts only when it looks like an action name.
      for (const a of Array.isArray(m?.[key]) ? m[key] : []) { if (a && typeof a === 'object') add(a.actionName || a.name || (/[_/]/.test(a.type || '') ? a.type : '') || a.function?.name); }
    }
    add(m?.actionName); add(m?.functionName);
  }
  return { text, actions, guardHit: actions.some((a) => !isReadAction(a)) };
}

export function createAgent({ token, instanceUrl, agentId, fetch: f = globalThis.fetch, onUnauthorized, timeoutMs = 60000, newKey = () => crypto.randomUUID() }) {
  const seq = new Map();
  const tok = async () => (typeof token === 'function' ? token() : token);

  async function call(method, path, body, phase, { keepalive = false } = {}) {
    if (!allowed(method, path) || !/^https:\/\/[\w.-]+$/.test(instanceUrl || '')) throw agentError('Refused: not an Agent API call this app makes', 'refused', 400);
    for (let attempt = 0; ; attempt++) {
      const used = await tok();
      const headers = { Authorization: `Bearer ${used}`, Accept: 'application/json' };
      if (body) headers['Content-Type'] = 'application/json';
      if (method === 'DELETE') headers['x-session-end-reason'] = 'UserRequest';
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      let r;
      try { r = await f(AGENT_API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, ...(keepalive ? { keepalive } : {}) }); }
      catch { throw ctl.signal.aborted ? agentError('The agent took too long to reply', 'retry', 504) : agentError("Couldn't reach Agentforce", 'retry', 502); }
      finally { clearTimeout(timer); }
      if (r.status === 401 && attempt === 0 && onUnauthorized) { await onUnauthorized(used); continue; }
      if (r.ok) return r.status === 204 ? {} : r.json().catch(() => ({}));
      const detail = await r.text().catch(() => '');
      let msg = ''; try { const b = JSON.parse(detail); msg = b.message || b[0]?.message || ''; } catch {}
      throw mapError(r.status, phase, msg);
    }
  }

  return {
    async start() {
      const b = await call('POST', `/agents/${agentId}/sessions`, {
        externalSessionKey: newKey(), instanceConfig: { endpoint: instanceUrl },
        streamingCapabilities: { chunkTypes: ['Text'] }, bypassUser: false,
      }, 'start');
      if (!b?.sessionId) throw agentError("Agentforce isn't available right now", 'unavailable', 503);
      return b.sessionId;
    },
    async send(sessionId, text) {
      const sequenceId = (seq.get(sessionId) || 0) + 1;
      const path = `/sessions/${sessionId}/messages`;
      if (!allowed('POST', path)) throw agentError('Refused: not an Agent API call this app makes', 'refused', 400);
      seq.set(sessionId, sequenceId);
      return parseReply(await call('POST', path, { message: { sequenceId, type: 'Text', text } }, 'send'));
    },
    // keepalive lets the page's pagehide DELETE outlive the page.
    async end(sessionId, { keepalive = false } = {}) {
      seq.delete(sessionId);
      await call('DELETE', `/sessions/${sessionId}`, null, 'end', { keepalive });
    },
  };
}
