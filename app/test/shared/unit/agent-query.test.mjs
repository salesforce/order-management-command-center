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
// Agentforce's own actions, Run Query (SomAgentQuery) and Describe Object (SomAgentDescribe), read their source, so the agent's
// promise holds: every action in the planner bundle only reads, the Apex behind the two has no DML and queries only in
// user mode, the objects it opens are Order Management's, and the instructions name only those.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from "../../support/source-view.mjs";
import { isReadAction, READ_ACTIONS } from "../../../public/shared/agent/om-agent.js";

const ORG = new URL("../../../../org/agent/force-app/main/default/", import.meta.url);
const read = (p) => readFileSync(new URL(p, ORG), 'utf8');
const BUNDLE_DIR = 'genAiPlannerBundles/OM_Console_Assistant_Classic/';
const bundle = read(`${BUNDLE_DIR}OM_Console_Assistant_Classic.genAiPlannerBundle`);
// Comments out, then string literals emptied, so what's left is code.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/\/\/.*$/gm, '');
const QUERY = read('classes/SomAgentQuery.cls'), DESCRIBE = read('classes/SomAgentDescribe.cls');
const tag = (xml, t) => [...xml.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`, 'g'))].map((m) => m[1]);
const actions = [...bundle.matchAll(/<localActions>([\s\S]*?)<\/localActions>/g)].map((m) => ({
  name: tag(m[1], 'fullName')[0], local: tag(m[1], 'localDeveloperName')[0], type: tag(m[1], 'invocationTargetType')[0], target: tag(m[1], 'invocationTarget')[0],
}));
const OBJECTS = (QUERY.match(/OBJECTS = new Set<String>\{([\s\S]*?)\};/)?.[1].match(/'([^']+)'/g) || []).map((x) => x.slice(1, -1));

test('every action the agent has reads, and its own two run SomAgentQuery and SomAgentDescribe', () => {
  assert.ok(actions.length >= 15);
  for (const a of actions) {
    assert.ok(isReadAction(a.name) && isReadAction(a.local), `${a.name} is a read the panel's guard knows`);
    if (a.type === 'apex') assert.ok(['SomAgentQuery', 'SomAgentDescribe'].includes(a.target), `${a.name} runs ${a.target}`);
    else assert.equal(a.type, 'standardInvocableAction', a.name);
  }
  for (const topic of ['OMC_Order_Lookup', 'OMC_Analysis', 'OMC_Service_Desk']) {
    for (const k of ['RunQuery', 'DescribeObject']) {
      assert.ok(actions.some((a) => a.name === `${topic}_${k}`), `${topic} has ${k}`);
      assert.ok(bundle.includes(`<functionName>${topic}_${k}</functionName>`), `${topic} links ${k}`);
    }
  }
  assert.ok(READ_ACTIONS.includes('RunQuery') && READ_ACTIONS.includes('DescribeObject'));
});

test('each Apex action’s schema names exactly the class’s invocable variables', () => {
  const vars = (src, cls) => [...(src.match(new RegExp(`class ${cls} \\{([\\s\\S]*?)\\n    \\}`))?.[1] || '').matchAll(/public (?:String|Integer|Boolean) (\w+);/g)].map((m) => m[1]).sort();
  for (const a of actions.filter((x) => x.type === 'apex')) {
    const src = a.target === 'SomAgentQuery' ? QUERY : DESCRIBE, dir = `${BUNDLE_DIR}localActions/${a.name.replace(/_(RunQuery|DescribeObject)$/, '')}/${a.name}/`;
    for (const [side, cls] of [['input', 'Request'], ['output', 'Result']]) {
      assert.ok(existsSync(new URL(`${dir}${side}/schema.json`, ORG)), `${a.name} has an ${side} schema`);
      const props = Object.keys(JSON.parse(read(`${dir}${side}/schema.json`)).properties).sort();
      assert.deepEqual(props, vars(src, cls), `${a.name} ${side}`);
    }
  }
});

test('Run Query and Describe Object only read, in user mode, and the permission set grants just them', () => {
  for (const [name, src] of [['SomAgentQuery', QUERY], ['SomAgentDescribe', DESCRIBE]]) {
    const c = code(src);
    assert.doesNotMatch(c, /\b(insert|update|upsert|delete|undelete|merge)\s+[A-Za-z_(]/i, `${name} has no DML`);
    assert.doesNotMatch(c, /Database\.(insert|update|upsert|delete|undelete|merge|convertLead|emptyRecycleBin|executeBatch)\b|EventBus|new\s+Http\b|HttpRequest|System\.enqueueJob|Messaging\./, `${name} writes nothing and calls nothing`);
    for (const call of c.match(/Database\.(query|countQuery|queryWithBinds|getQueryLocator)\([^;]*\)/g) || []) assert.match(call, /AccessLevel\.USER_MODE/, `${name}: ${call}`);
    assert.doesNotMatch(c, /without sharing/);
  }
  assert.doesNotMatch(code(DESCRIBE), /Database\./, 'Describe Object reads metadata only');
  // The clauses that write as they read are refused.
  for (const w of ['FOR\\\\s+(UPDATE|VIEW|REFERENCE)', 'UPDATE\\\\s+(TRACKING|VIEWSTAT)', 'ALL\\\\s+ROWS']) assert.ok(QUERY.includes(w), w);
  const perm = read('permissionsets/SOM_Agent_Access.permissionset-meta.xml');
  assert.deepEqual(tag(perm, 'apexClass').sort(), ['SomAgentDescribe', 'SomAgentQuery']);
  assert.doesNotMatch(perm, /<objectPermissions>|<fieldPermissions>|<userPermissions>/, 'it grants no data access of its own');
});

test('Run Query opens Order Management’s objects only, and the instructions name only those', () => {
  assert.ok(OBJECTS.length > 20);
  for (const o of ['OrderSummary', 'OrderItemSummary', 'FulfillmentOrder', 'ReturnOrder', 'ProcessException', 'Shipment', 'WebStore', 'SalesChannel', 'Location']) assert.ok(OBJECTS.includes(o), o);
  // People's contact records, cards and conversations stay out.
  for (const o of ['Contact', 'User', 'Lead', 'ContactPointAddress', 'CardPaymentMethod', 'DigitalWallet', 'EmailMessage', 'LiveChatTranscript', 'MessagingSession', 'VoiceCall']) assert.ok(!OBJECTS.includes(o), o);
  const guide = bundle.match(/<description>Order Management's data, for Run Query[^<]*<\/description>/)?.[0] || '';
  assert.ok(guide, 'Analysis has the data guide');
  for (const o of ['OrderSummary', 'OrderItemSummary', 'FulfillmentOrder', 'ReturnOrder', 'ProcessException', 'Shipment', 'Case', 'Location', 'WebStore', 'SalesChannel']) {
    assert.ok(guide.includes(o) && OBJECTS.includes(o), `${o} is in the guide and in OBJECTS`);
  }
  // A personal field is never offered to the agent: the guide names none Run Query refuses.
  const personal = new RegExp(QUERY.match(/PERSONAL = Pattern\.compile\('\(\?i\)\.\*\(([^)]+)\)\.\*'\)/)[1], 'i');
  for (const f of guide.match(/\b[A-Z][A-Za-z0-9]+(?:\.[A-Z][A-Za-z0-9]+)*\b/g)) assert.ok(!personal.test(f), f);
});
