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
import { createAgent, isReadAction, parseReply, READ_ACTIONS, AGENT_API } from "../../../public/shared/agent/om-agent.js";

const AGENT = '0XxWs000001NmPxKAK';
// A fake fetch that records calls and answers from a queue of [status, body] pairs.
function fake(...replies) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, ...init, body: init.body && JSON.parse(init.body) });
    const r = replies.shift();
    if (r instanceof Error) throw r;
    const [status, body] = r || [200, {}];
    return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { f, calls };
}
const agent = (f, more) => createAgent({ token: 'tok', instanceUrl: 'https://x.my.salesforce.com', agentId: AGENT, fetch: f, newKey: () => 'key-1', ...more });

test('start posts the session body and returns the session id', async () => {
  const { f, calls } = fake([200, { sessionId: 's-1' }]);
  assert.equal(await agent(f).start(), 's-1');
  assert.equal(calls[0].url, `${AGENT_API}/agents/${AGENT}/sessions`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  assert.deepEqual(calls[0].body, { externalSessionKey: 'key-1', instanceConfig: { endpoint: 'https://x.my.salesforce.com' }, streamingCapabilities: { chunkTypes: ['Text'] }, bypassUser: false });
});

test('send numbers messages per session and parses the reply', async () => {
  const { f, calls } = fake([200, { messages: [{ type: 'Inform', message: 'One' }] }], [200, { messages: [{ type: 'Inform', message: 'Two' }, { type: 'Inform', message: 'Three' }] }]);
  const a = agent(f);
  assert.deepEqual(await a.send('s-1', 'hi'), { text: 'One', actions: [], guardHit: false });
  assert.equal((await a.send('s-1', 'again')).text, 'Two\n\nThree');
  assert.equal(calls[0].url, `${AGENT_API}/sessions/s-1/messages`);
  assert.deepEqual(calls.map((c) => c.body.message), [{ sequenceId: 1, type: 'Text', text: 'hi' }, { sequenceId: 2, type: 'Text', text: 'again' }]);
});

test('end sends DELETE with the end reason', async () => {
  const { f, calls } = fake([204, {}]);
  await agent(f).end('s-1');
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].url, `${AGENT_API}/sessions/s-1`);
  assert.equal(calls[0].headers['x-session-end-reason'], 'UserRequest');
  assert.equal(calls[0].keepalive, undefined);
});

test('end passes keepalive through for pagehide', async () => {
  const { f, calls } = fake([204, {}]);
  await agent(f).end('s-1', { keepalive: true });
  assert.equal(calls[0].keepalive, true);
});

test('anything outside the three calls is refused before fetch', async () => {
  const { f, calls } = fake();
  await assert.rejects(agent(f, { agentId: '../../x' }).start(), /Refused/);
  await assert.rejects(agent(f).send('s-1/../../agents', 'x'), /Refused/);
  await assert.rejects(agent(f).end('a b'), /Refused/);
  await assert.rejects(agent(f, { instanceUrl: 'http://evil' }).start(), /Refused/);
  assert.equal(calls.length, 0);
});

test('read actions are recognised bare, prefixed and by invocation target', () => {
  for (const a of READ_ACTIONS) { assert.ok(isReadAction(a), a); assert.ok(isReadAction(`OMC_Order_Lookup_${a}`), a); }
  for (const a of ['queryRecords', 'getDataForGrounding', 'identifyObject', 'Query Records']) assert.ok(isReadAction(a), a);
  // The shape a live reply used: the topic-prefixed name behind an output prefix.
  assert.ok(isReadAction('copilotActionOutput/OMC_Analysis_QueryRecordsWithAggregate'));
  assert.ok(!isReadAction('copilotActionOutput/OMC_Order_Lookup_UpdateRecordFields'));
  for (const a of ['UpdateRecordFields', 'OMC_Order_Lookup_UpdateRecordFields', 'CreateRecord', '']) assert.ok(!isReadAction(a), a);
  // A read name glued onto another word is not a read.
  for (const a of ['DeleteAndQueryRecords', 'OMC_Order_Lookup_PurgeGetRecordDetails']) assert.ok(!isReadAction(a), a);
});

test('parseReply collects action names and flags anything that is not a read', () => {
  const r = parseReply({ messages: [{ type: 'Inform', message: 'Done.', result: [{ type: 'OMC_Order_Lookup_QueryRecords' }], actions: [{ name: 'UpdateRecordFields' }] }] });
  assert.equal(r.text, 'Done.');
  assert.deepEqual(r.actions, ['OMC_Order_Lookup_QueryRecords', 'UpdateRecordFields']);
  assert.equal(r.guardHit, true);
  assert.equal(parseReply({ messages: [{ type: 'Inform', message: 'x', result: [{ type: 'QueryRecords' }] }] }).guardHit, false);
  // A message-kind `type` is not an action and must not raise the banner.
  assert.deepEqual(parseReply({ messages: [{ type: 'Inform', message: 'x', result: [{ type: 'Text', value: 'y' }] }] }), { text: 'x', actions: [], guardHit: false });
  assert.deepEqual(parseReply({}), { text: '', actions: [], guardHit: false });
});

const kindOf = async (p) => { try { await p; } catch (e) { return [e.kind, e.code]; } return 'resolved'; };
test('HTTP errors map to the kinds the panel shows', async () => {
  for (const [status, phase, kind] of [[403, 'start', 'forbidden'], [404, 'start', 'unavailable'], [412, 'start', 'unavailable'], [404, 'send', 'expired'], [429, 'send', 'retry'], [500, 'send', 'retry'], [503, 'start', 'retry']]) {
    const { f } = fake([status, { message: 'no' }]);
    const a = agent(f);
    assert.deepEqual(await kindOf(phase === 'start' ? a.start() : a.send('s-1', 'x')), [kind, status], `${status} ${phase}`);
  }
  const { f } = fake([401, {}]);
  assert.deepEqual(await kindOf(agent(f).start()), ['auth', 401]);
});

test('network errors and timeouts are retryable', async () => {
  const net = fake(new TypeError('fetch failed'));
  assert.deepEqual(await kindOf(agent(net.f).send('s-1', 'x')), ['retry', 502]);
  const slow = (url, init) => new Promise((_, no) => init.signal.addEventListener('abort', () => no(new Error('aborted'))));
  assert.deepEqual(await kindOf(agent(slow, { timeoutMs: 20 }).send('s-1', 'x')), ['retry', 504]);
});

test('a 401 refreshes once with the used token, then retries', async () => {
  let tok = 'old'; const used = [];
  const { f, calls } = fake([401, {}], [200, { sessionId: 's-2' }]);
  const a = agent(f, { token: () => tok, onUnauthorized: async (t) => { used.push(t); tok = 'new'; } });
  assert.equal(await a.start(), 's-2');
  assert.deepEqual(used, ['old']);
  assert.deepEqual(calls.map((c) => c.headers.Authorization), ['Bearer old', 'Bearer new']);
  const twice = fake([401, {}], [401, {}]);
  assert.deepEqual(await kindOf(agent(twice.f, { onUnauthorized: async () => {} }).start()), ['auth', 401]);
  assert.equal(twice.calls.length, 2);
});

test('a start reply without a session id is treated as unavailable', async () => {
  const { f } = fake([200, {}]);
  assert.deepEqual(await kindOf(agent(f).start()), ['unavailable', 503]);
});

test('an out-of-credits answer maps to credits, at start or on a message', async () => {
  for (const [status, phase, message] of [[403, 'start', 'Your org has insufficient Flex Credits.'], [429, 'send', 'Einstein Requests usage limit reached'], [500, 'start', 'Credits have been exhausted for this period']]) {
    const { f } = fake([status, { message }]);
    const a = agent(f);
    assert.deepEqual(await kindOf(phase === 'start' ? a.start() : a.send('s-1', 'x')), ['credits', status], message);
  }
  // A 401 is still the session, and an unrelated message about a credit memo is not about billing.
  assert.deepEqual(await kindOf(agent(fake([401, { message: 'Flex Credits' }]).f).start()), ['auth', 401]);
  assert.deepEqual(await kindOf(agent(fake([500, { message: 'Credit memo 0Ra1 failed' }]).f).send('s-1', 'x')), ['retry', 500]);
});
