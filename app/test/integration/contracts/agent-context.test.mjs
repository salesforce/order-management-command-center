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
import { readFileSync } from "../../support/source-view.mjs";
import vm from 'node:vm';

// Which dashboard panels may send their rows to the agent. The panel helpers (console-panels.js) run here for real; every
// panel() call in the console's code (the page and its modules, console-source.mjs) is found by a small scanner.
import { consoleCode as html } from "../../support/console-source.mjs";
const src = readFileSync(new URL("../../../public/operations-console/console-panels.js", import.meta.url), 'utf8');
// Each test gets a fresh copy of the module (its stores start empty): a new URL is a new module instance.
let copy = 0;
const make = () => import(`../../../public/operations-console/console-panels.js?copy=${++copy}`);

// Every panel('pXxx', ...) call: its id, text and top-level arguments (quotes, template literals with ${} and brackets are skipped).
function parseCalls(text) {
  const out = [], re = /panel\('(p[A-Za-z]+)'/g;
  let m;
  while ((m = re.exec(text))) {
    let i = m.index + 'panel'.length, depth = 0, argStart = i + 1;
    const args = [];
    const skip = (q) => {
      i++;
      while (text[i] !== q) {
        if (text[i] === '\\') i++;
        else if (q === '`' && text[i] === '$' && text[i + 1] === '{') {
          i += 2;
          for (let d = 1; d; i++) { const c = text[i]; if (c === "'" || c === '"' || c === '`') skip(c); else if (c === '{') d++; else if (c === '}') d--; if (!d) break; }
        }
        i++;
      }
    };
    for (; ; i++) {
      const c = text[i];
      if (c === "'" || c === '"' || c === '`') skip(c);
      else if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { depth--; if (!depth) { args.push(text.slice(argStart, i).trim()); break; } }
      else if (c === ',' && depth === 1) { args.push(text.slice(argStart, i).trim()); argStart = i + 1; }
    }
    out.push({ id: m[1], args, text: text.slice(m.index, i + 1) });
  }
  return out;
}
const calls = parseCalls(html);

// Reviewed 2026-10: each flagged panel's csv holds only counts, amounts and product, location, carrier or category names, or order numbers.
const EXPECTED_AGENT = ['pOrders', 'pChannels', 'pBasket', 'pCancel', 'pChanges', 'pSpeed', 'pFoAge', 'pLocations', 'pFulfill', 'pLocGroups', 'pCarrier',
  'pMoney', 'pUnpaid', 'pUnrefunded', 'pExCat', 'pExAge', 'pCases', 'pRetTime', 'pRetWhy', 'pRetSku', 'pRetDays', 'pRetRate', 'pRetOut',
  'pProdSum', 'pProdTop', 'pProdRev', 'pProdCancel', 'pProdReturn', 'pProdFamily', 'pProdDemand',
  // Policies: policy names, rules and store names (no customer data).
  'pPolReturn', 'pPolCancel', 'pPolAdjust', 'pPolAssign'];
const PRIVATE_CUSTOMER = ['pCust', 'pTopSpend', 'pTopOrders', 'pTopRet'];
const flagged = (c) => c.args[6] === 'AGENT';

test('the block and the panel list are found', () => {
  assert.ok(src.length > 500);
  assert.equal(calls.length, (html.match(/panel\('p/g) || []).length);
  assert.ok(calls.length >= 30);
  for (const c of calls) {
    assert.ok(c.args.length >= 5 && c.args.length <= 7, `${c.id} has ${c.args.length} arguments`);
    assert.doesNotThrow(() => new vm.Script(`(${c.text})`), c.id);
  }
});

test('a new panel is private by default', async () => {
  const { panel, askStore, agentRows, agentPanelFacts } = await make();
  panel('pNew', 'New thing', 'X.Y', '<p>', { cols: ['name', 'n'], rows: [['Sentinel Person', 7]] });
  assert.equal(askStore.pNew.agent, false);
  assert.equal(agentRows('pNew'), null);
  assert.deepEqual(agentPanelFacts(['pNew'], null), []);
  assert.deepEqual(agentPanelFacts(['pNew'], 'pNew'), []);
});

test('a flagged panel is shared in the same format as before', async () => {
  const { AGENT, panel, agentPanelFacts } = await make();
  panel('pTwo', 'New thing', 'X.Y', '<p>', { cols: ['name', 'n'], rows: [['Sentinel', 7]] }, '', AGENT);
  assert.deepEqual(agentPanelFacts(['pTwo'], null), ['New thing: Sentinel 7']);
  const rows = Array.from({ length: 10 }, (_, i) => ['p' + i, 'n' + i, i, i === 0 ? 0.123456 : i]);
  panel('pThree', 'Wide', 'X.Y', '<p>', { cols: ['product_id', 'product', 'units', 'rate'], rows }, '', AGENT);
  const all = agentPanelFacts(['pThree'], null);
  assert.deepEqual(all, ['Wide (product units rate): n0 0 0.123 | n1 1 1 | n2 2 2 | n3 3 3 | n4 4 4 | n5 5 5']);
  const asked = agentPanelFacts([], 'pThree');
  assert.equal(asked.length, 8);
  assert.equal(asked[0], 'Wide: product_id p0, product n0, units 0, rate 0.123456');
  panel('pNull', 'Gap', 'X.Y', '<p>', { cols: ['a', 'b'], rows: [['x', null]] }, '', AGENT);
  assert.deepEqual(agentPanelFacts([], 'pNull'), ['Gap: a x, b —']);
});

test('the flag must be exactly AGENT', async () => {
  const { panel, askStore } = await make();
  const csv = { cols: ['a', 'b'], rows: [['x', 1]] };
  for (const v of ['yes', 1, 'span2', undefined, null, false]) { panel('pFlag', 'T', 'X', '', csv, '', v); assert.equal(askStore.pFlag.agent, false, String(v)); }
});

test('the flag is per render, not sticky', async () => {
  const { AGENT, panel, agentRows } = await make();
  panel('pTog', 'T', 'X', '', { cols: ['a', 'b'], rows: [['x', 1]] }, '', AGENT);
  assert.ok(agentRows('pTog'));
  panel('pTog', 'T', 'X', '', { cols: ['a', 'b'], rows: [['y', 2]] });
  assert.equal(agentRows('pTog'), null);
});

test('a re-render without data drops the old rows', async () => {
  const { AGENT, panel, csvStore, agentRows, agentPanelFacts } = await make();
  panel('pOld', 'T', 'X', '', { cols: ['a', 'b'], rows: [['x', 1]] }, '', AGENT);
  panel('pOld', 'T', 'X', '', null, '', AGENT);
  assert.ok(!('pOld' in csvStore));
  assert.equal(agentRows('pOld'), null);
  assert.deepEqual(agentPanelFacts(['pOld'], null), []);
});

test('asking about a private panel sends no rows', async () => {
  const { panel, agentPanelFacts } = await make();
  panel('pTopSpend', 'Top accounts by spend', 'X', '', { cols: ['account', 'spend'], rows: [['Sentinel Person', 5]] });
  assert.deepEqual(agentPanelFacts(['pTopSpend'], 'pTopSpend'), []);
  assert.deepEqual(agentPanelFacts(['pTopSpend'], null), []);
});

test('csvStore keeps the raw rows of a private panel, for the CSV download', async () => {
  const { panel, csvStore } = await make();
  panel('pTopSpend', 'Top accounts by spend', 'X', '', { cols: ['account', 'spend'], rows: [['Sentinel Person', 5]] });
  assert.equal(csvStore.pTopSpend.rows[0][0], 'Sentinel Person');
});

test('the reviewed list of panels shared with the agent', () => {
  const got = new Set(calls.filter(flagged).map((c) => c.id));
  for (const id of got) assert.ok(EXPECTED_AGENT.includes(id), `panel ${id} is shared with the agent: review its csv columns, then add it here`);
  for (const id of EXPECTED_AGENT) assert.ok(got.has(id), `panel ${id} is no longer flagged`);
  assert.equal(got.size, EXPECTED_AGENT.length);
  for (const c of calls) if (!EXPECTED_AGENT.includes(c.id)) assert.ok(c.args.length < 7, `${c.id} has a 7th argument but is not in the reviewed list`);
  for (const id of PRIVATE_CUSTOMER) {
    const cs = calls.filter((c) => c.id === id);
    assert.ok(cs.length, id);
    for (const c of cs) assert.ok(c.args.length < 7, `${id} must stay private`);
  }
});

test('end to end: only the flagged calls reach the agent', async () => {
  const { AGENT, panel, agentPanelFacts } = await make();
  for (const c of calls) panel(c.id, c.id, 'X', '', { cols: ['name', 'n'], rows: [['SENTINEL_' + c.id, 1]] }, '', flagged(c) ? AGENT : undefined);
  const ids = [...new Set(calls.map((c) => c.id))];
  const text = agentPanelFacts(ids, null).join('\n');
  for (const id of ids) assert.equal(text.includes('SENTINEL_' + id + ' '), EXPECTED_AGENT.includes(id), id);
  for (const id of ids) assert.equal(agentPanelFacts(ids, id).length > 0, EXPECTED_AGENT.includes(id), id);
});

test('flagged panels name no personal source', () => {
  const personal = /Account|Contact|Email|Phone|Street|Address|Owner|Person|Buyer|Customer/i;
  for (const c of calls.filter(flagged)) {
    assert.ok(!personal.test(c.args[2].replace(/OrderSummary\.AccountId/, '')), `${c.id} source ${c.args[2]}`);
    assert.ok(!personal.test(c.args[4]), `${c.id} csv ${c.args[4]}`);
  }
});

test('dashboardContext builds its facts from the allowlist', () => {
  const at = html.indexOf('function dashboardContext()');
  const fn = html.slice(at, html.indexOf('\nfunction consoleContext', at));
  assert.ok(fn.includes('agentPanelFacts('));
  assert.ok(!fn.includes('csvStore'));
  assert.ok(!html.includes('PERSONAL_PANELS'));
});

test('the default is private', () => {
  assert.match(src, /function panel\(id, title, src, body, csv, cls = '', agent = false\)/);
  assert.match(src, /const AGENT = true/);
});

// The console's Agentforce has no read for routing: an open fulfillment order's drawer sends its routing explanation, never its ship-to.
test('a fulfillment order’s drawer tells Agentforce why it went where it did, and nothing about where it’s going', async () => {
  const { routingFacts } = await import("../../../public/operations-console/console-drawers.js");
  const r = { Id: '0a3000000000001AAA', FulfillmentOrderNumber: 'FO-0042', Status: 'Allocated', FulfilledFromLocation: { Name: 'Reno DC' }, FulfilledToName: 'Avery Chen', FulfilledToCity: 'Austin', FulfilledToState: 'TX' };
  const x = { location: 'Reno DC', why: 'Highest Single Location Score', whyTip: 'The highest scoring single location.', score: 178.1, filled: '3 of 3',
    rules: [{ label: 'Fulfillment Cost', score: 96 }, { label: 'Nearest Location', score: 52.1, isOverride: true }], lines: [{ sku: 'NW-4471', filled: 1, requested: 1 }] };
  const facts = routingFacts(r, x);
  assert.deepEqual(facts, ['Open in the drawer: fulfillment order FO-0042 (Id 0a3000000000001AAA), Allocated, at Reno DC',
    'Its routing: Reno DC won (The highest scoring single location), score 178.1, filled 3 of 3', 'Its routing rules: Fulfillment Cost 96, Nearest Location 52.1 (override)', 'Its routing by item: NW-4471 1 of 1']);
  assert.ok(!facts.join(' ').match(/Avery|Austin|TX/), 'no ship-to');
  assert.deepEqual(routingFacts(r, null).slice(1), ['Its routing: Order Management gave no routing explanation for it']);
});
