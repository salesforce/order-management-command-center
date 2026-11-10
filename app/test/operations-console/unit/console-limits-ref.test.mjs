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
import { limTopHtml, limAccessHtml, limEntRow, limAllHtml } from "../../../public/operations-console/console-limits-ref.js";

// The Limits view's reference section as markup (console-limits-ref.js): rows in, HTML text out.
const row = (name, f, extra = {}) => ({ group: 'Core', name, f, level: f >= 1 ? 'over' : f >= 0.8 ? 'warn' : 'ok', used: f == null ? null : f * 100, max: 100, unit: '', ...extra });

test('the top list is the ten fullest limits, fullest first, and says so when there are none', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`L${i}`, i / 12));
  const html = limTopHtml([...rows, row('Unknown', null)]);
  assert.equal(html.match(/class="ltr /g).length, 10);
  assert.ok(html.indexOf('L11') < html.indexOf('L10'));
  assert.doesNotMatch(html, /Unknown|>L0</);
  assert.match(limTopHtml([row('x', null)]), /No limits reported/);
});

test('a bar never passes full and a name is escaped', () => {
  const html = limTopHtml([row('<b>', 2.5)]);
  assert.match(html, /width:100\.0%/);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /250%/);
});

test('access checks: ok and empty read plainly, anything else shows the check’s note, and the read-only line follows', () => {
  const html = limAccessHtml([{ name: 'Orders', state: 'ok', note: '' }, { name: 'Cases', state: 'empty', note: '' }, { name: 'Entitlements', state: 'denied', note: 'no access' }]);
  assert.match(html, /✓<\/span> Orders<span class="muted"> readable</);
  assert.match(html, /–<\/span> Cases<span class="muted"> readable, no rows</);
  assert.match(html, /✕<\/span> Entitlements<span class="muted"> no access</);
  assert.match(html, /Read-only checks: nothing here changes data\./);
  assert.equal(limAccessHtml([]), '');
});

test('the Entitlements row explains why it is missing only when it is', () => {
  assert.equal(limEntRow([{ name: 'Entitlements', state: 'ok' }]), '');
  assert.equal(limEntRow([]), '');
  assert.match(limEntRow([{ name: 'Entitlements', state: 'empty' }]), /this org has none/);
  assert.match(limEntRow([{ name: 'Entitlements', state: 'denied', note: 'blocked' }]), /blocked/);
  assert.match(limEntRow([{ name: 'Entitlements', state: 'denied', note: '' }]), /not readable by your user/);
});

test('the table narrows by search on name or group and says when nothing matches', () => {
  const rows = [row('DailyApi', 0.5), row('Storage', 0.9, { group: 'Data' })];
  assert.equal(limAllHtml(rows, [], '').match(/<tr style/g).length, 2);
  const one = limAllHtml(rows, [], 'data');
  assert.equal(one.match(/<tr style/g).length, 1);
  assert.match(one, /Storage/);
  assert.match(limAllHtml(rows, [], 'zzz'), /Nothing matches\./);
  assert.match(limAllHtml([row('NoUse', null, { used: null })], [], ''), /—/);
});
