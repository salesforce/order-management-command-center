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
/* Streaming chart: all three windows, own/rest stacked bins and axes; daily projection, full-time estimate and quiet data. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { limitsTest, text, apply, calls, NOW } from "./limits-kit.mjs";
const pw = await loadPlaywright();

limitsTest(pw, 'all chart windows show the correct buckets axes and stacked heights', async ({ page, step, data }) => {
  const entries = [...calls(), ...[6, 20, 61].map((m) => ({ t: NOW - m * 60000, kind: 'graphql', source: 'dashboard', path: '/services/data/v68.0/graphql', ms: m, status: 200 }))];
  const rest = [{ t: NOW - 15000, n: 3 }, { t: NOW - 6 * 60000, n: 2 }];
  await apply(page, { data, entries, rest });
  for (const [value, label, sub, count, ms, ticks] of [
    ['300', '5 minutes', 'calls per 5 s', 60, 5000, ['−5m', '−4m', '−3m', '−2m', '−1m', 'now']],
    ['900', '15 minutes', 'calls per 10 s', 90, 10000, ['−15m', '−10m', '−5m', 'now']],
    ['3600', 'hour', 'calls per minute', 60, 60000, ['−60m', '−45m', '−30m', '−15m', 'now']],
  ]) {
    await step(() => page.locator('#lWin').selectOption(value));
    assert.equal(await text(page, '#lChartWin'), label); assert.equal(await text(page, '#lChartSub'), sub);
    assert.equal(await page.evaluate(() => localStorage.getItem('omc.limitsWindow')), value);
    const end = Math.floor(NOW / ms) * ms + ms, start = end - count * ms;
    const buckets = Array.from({ length: count }, () => ({ own: 0, rest: 0 }));
    for (const e of entries) { const i = Math.floor((e.t - start) / ms); if (i >= 0 && i < count) buckets[i].own++; }
    for (const e of rest) { const i = Math.floor((e.t - start) / ms); if (i >= 0 && i < count) buckets[i].rest += e.n; }
    const axis = (await page.locator('#lChart .ct').allTextContents());
    const max = Number(axis[2]);
    assert.deepEqual(axis.slice(3), ticks);
    assert.ok(max >= Math.max(3, ...buckets.map((b) => b.own + b.rest)));
    const got = await page.locator('#lcPlot .cb').evaluateAll((es) => es.map((e) => ({ kind: e.classList.contains('own') ? 'own' : 'rest', x: +e.getAttribute('x'), y: +e.getAttribute('y'), h: +e.getAttribute('height') })));
    const expected = buckets.flatMap((b, i) => ['own', 'rest'].filter((k) => b[k]).map((kind) => ({ kind, x: +(40 + i * 548 / count).toFixed(1), y: +(150 - 138 * (kind === 'own' ? b.own : b.own + b.rest) / max).toFixed(1), h: +(138 * b[kind] / max).toFixed(1) })));
    assert.deepEqual(got, expected, `${label}: every visible bucket and stacked bar`);
  }
  await page.reload();
  await page.locator('#lAll table').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#lWin').inputValue(), '3600', 'chart window survives reload');
});

limitsTest(pw, 'daily strip and API gauge show midnight projection and time to full', async ({ page, step, data }) => {
  await step(() => page.locator('#lDay').scrollIntoViewIfNeeded());
  assert.equal(await text(page, '#lDaySub'), 'Today 124 · at this rate 8,764 (9%) by midnight');
  assert.equal(await page.locator('#lDay .dused').getAttribute('width'), '2.0', 'tiny usage remains visible');
  assert.ok(Math.abs(Number(await page.locator('#lDay .dproj').getAttribute('width')) - 50.8) < .1);
  assert.equal(await page.locator('#lDay .dmax').getAttribute('x1'), '594.0');
  const d = structuredClone(data); d.org.data.DailyApiRequests = { Max: 200, Remaining: 76 };
  await apply(page, { data: d });
  assert.equal(await text(page, '[data-k="DailyApiRequests"] .lgr'), 'At the current rate: full in 6 min');
  assert.match(await text(page, '#lDaySub'), /8,764 \(4382%\) by midnight/);
  const marker = Number(await page.locator('#lDay .dmax').getAttribute('x1'));
  assert.ok(marker >= 6 && marker < 594, 'limit marker fits even when projection exceeds capacity');
});

limitsTest(pw, 'quiet chart has no bars and no invented usage projection', async ({ page }) => {
  await apply(page, { entries: [], samples: [], rest: [] });
  assert.equal(await page.locator('#lcPlot .cb').count(), 0);
  assert.equal(await text(page, '[data-k="DailyApiRequests"] .lgr'), 'Quiet right now');
  assert.equal(await text(page, '#lDaySub'), 'Today 124 · at this rate 124 (0%) by midnight');
  assert.equal(await page.locator('#lDay .dproj').getAttribute('width'), '0.0');
  for (const id of ['lChart', 'lDay']) {
    assert.equal(await page.locator(`#${id}`).getAttribute('role'), 'img');
    assert.ok(await page.locator(`#${id}`).getAttribute('aria-label'));
  }
});
