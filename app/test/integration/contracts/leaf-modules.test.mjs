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
// The rules two places enforce live in modules that import nothing (docs/adr/0003-pure-rule-modules.md): the page, the read
// model and the tests all load the same copy, and none of them drags in the network or the DOM with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nativeFs from 'node:fs';
import { readFileSync } from "../../support/source-view.mjs";

const LEAVES = ['om-rules.js', 'shared/transport/om-http.js', 'om-config.js', 'om-mode.js', 'om-bundles.js', 'console-state.js'];
const read = (f) => readFileSync(new URL(`../../../public/${f}`, import.meta.url), 'utf8');
// The code without its comments (a comment may well mention the page or a fetch).
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

test('each leaf module imports nothing', () => {
  for (const f of LEAVES) {
    const s = code(read(f));
    assert.doesNotMatch(s, /^\s*import\b/m, `${f} imports something`);
    assert.doesNotMatch(s, /\bimport\(/, `${f} imports something later`);
    // om-mode.js reads the page's address and sign-in state, once, to say which mode it's in; nothing else may.
    if (f !== 'om-mode.js') assert.doesNotMatch(s, /\b(?:document|window|location|localStorage|sessionStorage)\.|\bfetch\(|XMLHttpRequest/, `${f} reaches the page or the network`);
  }
});

test('what uses a rule takes the leaf’s copy, not its own', async () => {
  const rules = await import("../../../public/shared/data/om-rules.js"), http = await import("../../../public/shared/transport/om-http.js");
  const owned = { 'shared/data/om-rules.js': ['CUSTOMER_FIELDS', 'customerRecords', 'policyCheck', 'policyRule', 'creditRoom', 'moneyState', 'MONEY_SETTLE_MS', 'CHARGE_SETTLE_MS', 'POLICY_KINDS'],
    'shared/transport/om-http.js': ['READ_ONLY_POSTS', 'errorText', 'readOnlyPost'] };
  for (const k of owned['shared/data/om-rules.js']) assert.ok(k in rules, `om-rules.js exports ${k}`);
  for (const k of owned['shared/transport/om-http.js']) assert.ok(k in http, `om-http.js exports ${k}`);
  // The console's read model and the shared reads, transports and agent: none declares its own copy of a leaf's rule.
  const root = new URL("../../../public/", import.meta.url), files = [];
  const walk = (dir) => { for (const e of nativeFs.readdirSync(new URL(dir, root), { withFileTypes: true })) { if (e.isDirectory()) walk(`${dir}${e.name}/`); else if (e.name.endsWith('.js')) files.push(dir + e.name); } };
  walk('shared/'); walk('operations-console/');
  assert.ok(files.includes('operations-console/data/core.js') && files.includes('shared/data/display-facts.js'), files.join());
  for (const f of files) {
    const s = code(nativeFs.readFileSync(new URL(f, root), 'utf8'));
    for (const [leaf, names] of Object.entries(owned)) {
      if (f === leaf) continue;
      for (const n of names) assert.doesNotMatch(s, new RegExp(String.raw`^\s*(?:export\s+)?(?:const|let|var|(?:async\s+)?function\*?|class)\s+${n}\b`, 'm'), `${f} declares its own ${n} (${leaf} holds it)`);
    }
  }
});
