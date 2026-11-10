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
/*
 * Store and Sales channel filters on the Operations Console
 *
 * Purpose
 *   The top bar's Store and Sales channel pickers narrow every panel to one store and one channel. In demo mode the sample
 *   org's stores and channels are offered, and a pick redraws the panels from demoData(range, scope).
 *
 * Steps
 *   1. Open /?demo=1 and wait for the KPI cards. The pickers show, each starting on "All".
 *   2. Pick the second store, then the Web channel; then go back to All stores and All channels.
 *   3. Switch to the Service Console (the pickers hide) and to the Dashboard (they show again, with the same pick).
 *
 * Assertions
 *   - Each picker is a labelled <select> listing "All" and demoFilters()'s names, in order.
 *   - After each pick, the Orders card and the Activity stream's row count match demoData('90d', scope); every stream row is the
 *     picked channel's. Back on All, they match demoData('90d') again.
 *   - The pickers hide on the Service Console and show on the Dashboard.
 *   - The page never throws, calls /api/ or sends a non-GET.
 *   node --test app/test/operations-console/ui/operation-console/filters.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoData, demoFilters } from '../../../../public/operations-console/console-demo.js';
import { UI, WIDE, loadPlaywright, openSession, until } from '../../../../tools/browser-kit.mjs';

const pw = await loadPlaywright();
const n = (v) => Number(v).toLocaleString('en-US');
const read = (page) => page.evaluate(() => ({
  orders: document.querySelector('#kpis > .kpi .v')?.textContent.trim(),
  rows: document.querySelectorAll('#stream tbody tr').length,
}));

test('Console: Store and Sales channel pickers narrow the panels', { skip: UI.skip(pw) }, async () => {
  const s = await openSession(pw, 'console-filters', { viewport: WIDE });
  const { page, step } = s;
  try {
    assert.ok(await until(page, '#app:not(.hide) #kpis > .kpi', 15000), 'the Console drew');
    const opt = demoFilters();
    assert.ok(await page.locator('#scope').isVisible());
    assert.deepEqual(await page.locator('#fStore option').allTextContents(), ['All stores', ...opt.stores.map((x) => x.name)]);
    assert.deepEqual(await page.locator('#fChannel option').allTextContents(), ['All channels', ...opt.channels.map((x) => x.name)]);
    // Each picker is named by its own label (a map location named "… store hub" also mentions "store", so match the name's start).
    assert.equal(await page.getByRole('combobox', { name: /^Store\b/ }).count(), 1);
    assert.equal(await page.getByRole('combobox', { name: /^Sales channel\b/ }).count(), 1);
    assert.equal(await page.locator('#fStore').inputValue(), '');
    assert.equal(await page.locator('#fChannel').inputValue(), '');
    const store = opt.stores[1].id, web = opt.channels.find((x) => x.name === 'Web').id;
    for (const [sel, value, scope] of [['#fStore', store, { store }], ['#fChannel', web, { store, channel: web }], ['#fStore', '', { channel: web }], ['#fChannel', '', {}]]) {
      await step(() => page.locator(sel).selectOption(value));
      const d = demoData('90d', scope), want = { orders: n(d.kpis.data.orders), rows: Math.min(50, d.stream.data.length) };
      for (const end = Date.now() + 5000; Date.now() < end && JSON.stringify(await read(page)) !== JSON.stringify(want);) await page.waitForTimeout(50);
      assert.deepEqual(await read(page), want, `panels for ${JSON.stringify(scope)}`);
      if (scope.channel) assert.ok((await page.locator('#stream tbody').innerText()).includes('Web'));
    }
    await step(() => page.locator('#mode button[data-m="service"]').click());
    assert.ok(await page.locator('#scope').isHidden(), 'no filters on the Service Console');
    await step(() => page.locator('#mode button[data-m="dashboard"]').click());
    assert.ok(await page.locator('#scope').isVisible(), 'the Dashboard has them too');
    assert.deepEqual(s.problems, [], 'no page errors, API calls or writes');
  } finally { await s.close(); }
});
