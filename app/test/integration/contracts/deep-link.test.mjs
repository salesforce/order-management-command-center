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
const html = readFileSync(new URL("../../../public/operations-console/index.html", import.meta.url), 'utf8');

test('the page opens an order from ?order= and picks the tab from ?view=', () => {
  const fn = html.match(/function openFromUrl\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn, 'openFromUrl() exists');
  assert.match(fn, /get\('order'\)/); assert.match(fn, /SF_ID\.test\(id\)/); assert.match(fn, /'activity', 'timeline'/);
  // Not over the sign-in screen: load() can end on the gate when the session has died.
  assert.match(fn, /#gate'\)\.classList\.contains\('hide'\)/);
  // Every connected path in boot() opens the linked order after loading.
  const boot = html.match(/async function boot\(\) \{[\s\S]*?\n\}/)[0];
  assert.equal((boot.match(/openFromUrl/g) || []).length, 4); // demo, in-org, hosted, local
});
