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
/* One independent test per gauge; percentages, amounts, remaining/over values, accessible names and arc proportions. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { limitsTest, text, rows, amount, apply } from "./limits-kit.mjs";
const pw = await loadPlaywright();
const keys = ['DailyApiRequests', 'DataStorageMB', 'FileStorageMB', 'ent:Lightning Order Management Order Summary Entitlements', 'DailyAsyncApexExecutions'];
for (const key of keys) limitsTest(pw, `${key} gauge`, async ({ page, step, data }) => {
  const r = rows(data).find((r) => r.key === key), gauge = page.locator('#lGauges .lg').filter({ has: page.locator('.lgl', { hasText: r.name }) });
  await step(() => gauge.scrollIntoViewIfNeeded());
  assert.equal(await gauge.locator('.lgl').textContent(), r.name);
  assert.equal(await gauge.locator('.lgp').textContent(), `${Math.round(r.f * 100)}%`);
  assert.equal(await gauge.locator('.lgv').textContent(), `${amount(r.used, r.unit)} of ${amount(r.max, r.unit)}`);
  assert.equal(await gauge.getAttribute('aria-label'), `${r.name}: ${Math.round(r.f * 100)}%, ${amount(r.used, r.unit)} of ${amount(r.max, r.unit)}`);
  assert.ok(await gauge.evaluate((e, level) => e.classList.contains(`lv-${level}`), r.level));
  const fraction = await gauge.locator('.lga').evaluate((e) => e.getAttribute('d') ? e.getTotalLength() / (2 * Math.PI * 46) : 0);
  assert.ok(Math.abs(fraction - (r.f <= .002 ? 0 : Math.min(.999, r.f))) < .002, 'arc follows usage and caps at a full ring');
  assert.equal(await gauge.getAttribute('role'), 'img');
  assert.equal(await gauge.locator('svg').getAttribute('aria-hidden'), 'true');
  assert.equal(await gauge.locator('.lgr').textContent(), key === 'DailyApiRequests' ? 'At the current rate: 9% by midnight' : r.f >= 1 ? `${amount(r.used - r.max, r.unit)} over the limit` : `${amount(r.max - r.used, r.unit)} left`);
});

limitsTest(pw, 'gauges transition from normal to warning full and over without hiding real percentages', async ({ page, data }) => {
  const d = structuredClone(data), key = 'FileStorageMB';
  for (const [used, level] of [[790, 'ok'], [800, 'warn'], [1000, 'over'], [1250, 'over'], [0, 'ok']]) {
    d.org.data[key] = { Max: 1000, Remaining: 1000 - used };
    await apply(page, { data: d });
    const g = page.locator(`[data-k="${key}"]`);
    assert.ok(await g.evaluate((e, l) => e.classList.contains(`lv-${l}`), level));
    assert.equal(await g.locator('.lgp').textContent(), `${used / 10}%`);
    assert.equal(await g.locator('.lgr').textContent(), used >= 1000 ? `${amount(used - 1000, 'MB')} over the limit` : `${amount(1000 - used, 'MB')} left`);
  }
});

limitsTest(pw, 'gauges omit missing zero-capacity and unknown-usage readings', async ({ page, data }) => {
  const d = structuredClone(data);
  delete d.org.data.DataStorageMB;
  d.org.data.FileStorageMB = { Max: 0, Remaining: 0 };
  d.orderSummary = { ok: false, error: 'Not readable' };
  await apply(page, { data: d });
  assert.deepEqual(await page.locator('#lGauges .lg').evaluateAll((es) => es.map((e) => e.dataset.k)), ['DailyApiRequests', 'DailyAsyncApexExecutions']);
  assert.doesNotMatch(await text(page, '#lGauges'), /NaN|Infinity|undefined/);
});
