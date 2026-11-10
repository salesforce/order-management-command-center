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
/* Six independent KPI tests; all seven periods update the entire KPI row and calendar chart; edge comparisons and retry. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { PERIOD_LABEL, PRIOR_LABEL } from "../../../../public/operations-console/console-labels.js";
import { dashTest, data, patch, n, usd, text, choosePeriod, chart, calendar, checkCsv } from "./dashboard-kit.mjs";
const pw = await loadPlaywright();
const labels = ['Orders', 'Order value', 'Avg order value', 'Returns', 'Refunds issued', 'Process exceptions'];
function cards(d) {
  const x = d.tiles.data, aov = x.orders && x.value ? { cur: x.orders.cur ? x.value.cur / x.orders.cur : 0, prev: x.orders.prev == null ? null : x.orders.prev ? x.value.prev / x.orders.prev : 0 } : null;
  const fields = [x.orders, x.value, aov, x.returns, x.refunds, x.exceptions];
  const sub = ['OrderSummary', 'OrderSummary', 'OrderSummary', x.returns && x.orders?.cur ? `${usd(x.returnValue?.cur)} · ${(x.returns.cur / x.orders.cur * 100).toFixed(1)} per 100 orders` : 'ReturnOrder', x.refundCount ? `${n(x.refundCount.cur)} credit memos` : 'CreditMemo', 'ProcessException'];
  return fields.map((r, i) => {
    const fmt = [1, 2, 4].includes(i) ? usd : n;
    let delta;
    if (!r) delta = 'not in this org';
    else if (r.prev == null) delta = 'all records';
    else if (!r.prev) delta = !r.cur ? 'none either period' : `new · 0 ${PRIOR_LABEL[d.period].replace(/^vs /, 'in ')}`;
    else { const change = (r.cur - r.prev) / r.prev; delta = `${change > .005 ? '▲' : change < -.005 ? '▼' : '■'} ${Math.abs(Math.round(change * 100))}% ${PRIOR_LABEL[d.period]} (${fmt(r.prev)})`; }
    return [labels[i], fmt(r?.cur), delta, sub[i]];
  });
}
const readCards = (p) => p.locator('#dTiles > .kpi').evaluateAll((es) => es.filter((e) => e.querySelector('.l')).map((e) => ['.l', '.v', '.d', '.s'].map((sel) => e.querySelector(sel).textContent.replace(/\s+/g, ' ').trim())));
for (const [i, label] of labels.entries()) dashTest(pw, 'orders', `${label} KPI`, async ({ page }) => {
  assert.deepEqual((await readCards(page))[i], cards(await data(page))[i], 'label, value, comparison and source/detail');
});

dashTest(pw, 'returns', 'every period updates cards dates grain and export', async ({ page, step }) => {
  for (const period of ['mtd', '1y', 'today', '6m', 'qtd', 'ytd', 'all']) {
    await step(() => choosePeriod(page, period));
    const d = await data(page, period);
    assert.equal(await text(page, '#dTitle'), PERIOD_LABEL[period]);
    const fmt = (x) => new Date(x).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
    const end = d.prevTo && new Date(d.prevTo).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    assert.equal(await text(page, '#dSub'), d.from ? `${fmt(d.from)} – now · compared with ${fmt(d.prevFrom)} – ${end}, the same elapsed time` : 'Every record in the org');
    assert.deepEqual(await readCards(page), cards(d), `${period}: all six KPIs`);
    assert.equal(await page.locator('#pRetTime').locator('..').locator('h2').evaluate((e) => e.firstChild.textContent.trim()), `Returns per ${d.grain}`);
    const rows = calendar(d, 'returnsSeries');
    await chart(page, '#pRetTime', rows, 'Returns');
    await checkCsv(page, 'pRetTime', period, [['bucket', 'returns'], ...rows.map((r) => [r.key, r.n])]);
  }
});

dashTest(pw, 'orders', 'zero new flat missing and all-time comparisons', async ({ page }) => {
  const d = await data(page), x = d.tiles.data;
  x.orders = { cur: 0, prev: 0 }; x.value = { cur: 0, prev: 30 }; x.returns = { cur: 3, prev: 0 }; x.refunds = { cur: 100, prev: 100 }; delete x.exceptions;
  await patch(page, 'orders', { tiles: { ok: true, data: x } });
  assert.deepEqual(await readCards(page), cards(d));
  assert.ok(await page.locator('#dNotice').isVisible());
  assert.match(await text(page, '#dNotice'), /No orders month to date/);
  await page.locator('#dNotice button').click();
  assert.equal(await text(page, '#dTitle'), 'Quarter to date', 'empty notice widens the period');
  assert.ok(await page.locator('#dNotice').isHidden());
  await choosePeriod(page, 'all');
  assert.deepEqual(await readCards(page), cards(await data(page, 'all')));
  assert.deepEqual(await page.locator('#dTiles .d').allTextContents(), Array(6).fill('all records'));
});

dashTest(pw, 'orders', 'failed period keeps last good data and Retry recovers', async ({ page }) => {
  // Fail the demo loader, not the renderer: exercises the real load/error/retry flow without an org or network delay.
  await page.route('**/operations-console/console-demo.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + '\nconst originalDash = demoDash; demoDash = (p) => { if (globalThis.failDashboard) throw new Error("Dashboard fixture unavailable"); return originalDash(p); };' });
  });
  await page.reload();
  await page.locator('#pOrders svg').waitFor();
  const before = await readCards(page), d = await data(page), chartBefore = await page.locator('#pOrders .hit').evaluateAll((es) => es.map((e) => e.dataset.say));
  await page.evaluate(() => globalThis.failDashboard = true);
  await choosePeriod(page, 'ytd');
  assert.equal(await text(page, '#dTitle'), 'Month to date');
  assert.deepEqual(await readCards(page), before);
  assert.deepEqual(await page.locator('#pOrders .hit').evaluateAll((es) => es.map((e) => e.dataset.say)), chartBefore);
  assert.match(await text(page, '#banner'), /Couldn't load year to date\. Showing month to date\./);
  assert.equal(await page.locator('#banner').getAttribute('role'), 'status', 'stale data is announced without interrupting the user');
  await checkCsv(page, 'pOrders', 'mtd', [['bucket', 'orders'], ...calendar(d, 'ordersSeries').map((r) => [r.key, r.n])]);
  await page.evaluate(() => globalThis.failDashboard = false);
  await page.locator('#banner [data-retry]').click();
  await page.waitForFunction(() => document.querySelector('#dTitle').textContent === 'Year to date');
  assert.deepEqual(await readCards(page), cards(await data(page, 'ytd')));
  assert.ok(await page.locator('#banner').isHidden());
});
