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
/* Shared controls: chart keyboard/tooltips, Data map deduplication/escaping/focus, Ask context and refresh. No chat is sent. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { dashTest, chooseDomain, choosePeriod, patch, data, n, text } from "./dashboard-kit.mjs";
import { demoDash, demoFilters } from "../../../../public/operations-console/console-demo.js";
const pw = await loadPlaywright();

dashTest(pw, 'orders', 'chart tooltips and keyboard read every bucket including zero gaps', async ({ page, step }) => {
  const d = await data(page);
  await patch(page, 'orders', { ordersSeries: { ok: true, data: [d.ordersSeries.data[0], d.ordersSeries.data.at(-1)] } });
  const svg = page.locator('#pOrders svg'), hits = svg.locator('.hit'), count = await hits.count();
  await step(() => hits.first().hover());
  assert.ok(await page.locator('#dtip').isVisible());
  assert.ok((await text(page, '#dtip')).includes(n(d.ordersSeries.data[0].n)));
  await svg.focus();
  for (const [key, index] of [['Home', 0], ['ArrowRight', 1], ['ArrowLeft', 0], ['ArrowLeft', 0], ['End', count - 1], ['ArrowRight', count - 1]]) {
    await step(() => page.keyboard.press(key));
    const selected = svg.locator('.hit.at');
    assert.equal(await selected.count(), 1);
    assert.equal(await svg.getAttribute('data-at'), String(index));
    assert.equal(await text(page, '#dlive'), await hits.nth(index).getAttribute('data-say'));
    assert.ok(await page.locator('#dtip').isVisible());
  }
  await page.keyboard.press('Tab');
  assert.ok(await page.locator('#dtip').isHidden());
  await chooseDomain(page, 'products');
  const bar = page.locator('#pProdFamily .hb .row').first();
  await step(() => bar.focus());
  assert.ok(await page.locator('#dtip').isVisible());
  assert.match(await text(page, '#dtip'), /Products/);
  await chooseDomain(page, 'returns');
  assert.ok(await page.locator('#dtip').isHidden(), 'switching tabs clears a tooltip');
});

dashTest(pw, 'orders', 'Data map lists unique sources safely and returns focus', async ({ page, step }) => {
  const trigger = page.locator('#dataMapBtn');
  await step(() => trigger.click());
  assert.match(await text(page, '#modal'), /No queries recorded \(sample data\)/);
  await page.keyboard.press('Escape');
  const query = "SELECT Id FROM OrderSummary WHERE Name = '<img src=x>'";
  await patch(page, 'orders', { sources: [{ panel: 'Orders <img>', object: 'OrderSummary', soql: query }, { panel: 'Same query', object: 'OrderSummary', soql: query }] });
  for (const close of ['button', 'Escape', 'scrim']) {
    await step(() => trigger.click());
    assert.equal(await page.locator('#modal tbody tr').count(), 1);
    assert.equal(await text(page, '#modal code'), query);
    assert.equal(await page.locator('#modal img').count(), 0, 'source strings are text');
    await page.keyboard.press('Tab');
    assert.ok(await page.locator('#modal').evaluate((e) => e.contains(document.activeElement)), 'focus stays in the modal');
    if (close === 'button') await page.locator('#closeModal').click();
    else if (close === 'Escape') await page.keyboard.press('Escape');
    else await page.locator('#scrim').click({ position: { x: 5, y: 5 } });
    assert.ok(await page.locator('#modal').isHidden());
    assert.ok(await trigger.evaluate((e) => e === document.activeElement));
  }
});

dashTest(pw, 'orders', 'Ask names the selected public or private panel without sending', async ({ page, step }) => {
  for (const [domain, id, title, source, share] of [['orders', 'pBasket', 'Average basket', 'OrderItemSummary · products', true], ['customers', 'pTopSpend', 'Top accounts by spend', 'SUM(OrderSummary.GrandTotalAmount)', false], ['products', 'pProdDemand', 'Open fulfillment demand', 'FulfillmentOrderLineItem · open now', true]]) {
    await chooseDomain(page, domain);
    await step(() => page.locator(`[data-ask="${id}"]`).click());
    assert.ok(await page.locator('#agentPanel').isVisible());
    assert.ok((await text(page, '#agentPanel .agent-ctx')).includes(title));
    const asked = await page.evaluate(async () => (await import(new URL('console-state.js', document.baseURI).href)).S.agentAsk);
    assert.deepEqual(asked, { tab: domain, id, panel: title, object: source, agent: share });
    assert.equal(await page.locator('#agentPanel .agent-m.me').count(), 0);
    await page.locator('#agentPanel [data-a="close"]').click();
  }
});

dashTest(pw, 'products', 'Refresh restores data and Live controls keep selected tab and period', async ({ page, step }) => {
  await choosePeriod(page, 'ytd');
  const d = await data(page, 'ytd');
  await patch(page, 'products', { prodTotals: { ok: true, data: { ...d.prodTotals.data, cur: { ...d.prodTotals.data.cur, n: 999 } } } });
  assert.equal(await text(page, '#pProdSum .mini > div:first-child b'), '999');
  await step(() => page.locator('#refresh').click());
  assert.equal(await text(page, '#pProdSum .mini > div:first-child b'), n(d.prodTotals.data.cur.n));
  assert.equal(await page.locator('#every').inputValue(), 'off');
  await step(() => page.locator('#every').selectOption('300'));
  assert.equal(await text(page, '#live'), 'Live');
  await step(() => page.locator('#live').click());
  assert.equal(await text(page, '#live'), 'Paused');
  assert.equal(await page.locator('#every').inputValue(), 'off');
  assert.equal(await text(page, '#dTitle'), 'Year to date');
  assert.equal(await page.locator('#dTabs [aria-selected="true"]').getAttribute('data-t'), 'products');
});

dashTest(pw, 'orders', 'Store and Sales channel pickers narrow the tiles and the channel mix', async ({ page, step }) => {
  const opt = demoFilters(), web = opt.channels.find((x) => x.name === 'Web').id, store = opt.stores[0].id;
  const orders = () => page.locator('#dTiles .kpi').first().locator('.v').innerText();
  for (const [sel, value, scope] of [['#fChannel', web, { channel: web }], ['#fStore', store, { store, channel: web }], ['#fChannel', '', { store }], ['#fStore', '', {}]]) {
    await step(() => page.locator(sel).selectOption(value));
    const want = n(demoDash('mtd', scope).tiles.data.orders.cur);
    for (const end = Date.now() + 5000; Date.now() < end && (await orders()).trim() !== want;) await page.waitForTimeout(50);
    assert.equal((await orders()).trim(), want, `Orders tile for ${JSON.stringify(scope)}`);
    if (scope.channel) assert.equal(await page.locator('#pChannels .hb .row').count(), 1, 'one channel in the mix');
  }
  assert.equal(n((await data(page)).tiles.data.orders.cur), (await orders()).trim(), 'back to the whole org');
});
