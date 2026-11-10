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
/* Activity and Timeline: values, products, selection, related records, zoom and returning from drill-down. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { panelTest, orders, sample, open, view, text, usd } from "./side-panel-kit.mjs";
const pw = await loadPlaywright();
async function history(page, tab) {
  const id = (await orders(page))[0].Id, data = await sample(page, 'demoHistory', id);
  await open(page, 'OrderSummary', id); await view(page, tab);
  await page.locator(tab === 'Activity' ? '.hx-act' : '.hx-tl').waitFor();
  return { id, data };
}

panelTest(pw, 'Activity dates statuses amounts and products match every event', async ({ page, step }) => {
  const { data } = await history(page, 'Activity');
  assert.equal(await page.locator('.hx-act [data-ev]').count(), data.events.length);
  assert.ok((await text(page, '.hx-span')).startsWith(`${data.events.length} records`));
  assert.deepEqual(await page.locator('.hx-act time').evaluateAll((es) => es.map((e) => e.dateTime)), data.events.map((e) => e.start));
  for (const e of data.events) {
    const row = page.locator(`.hx-act [data-ev="${e.id}"]`), content = await row.innerText();
    assert.ok(content.includes(e.title));
    assert.equal(await row.locator('.pill').textContent(), e.status);
    assert.equal(await row.locator('.hx-amt').textContent(), e.amount == null ? '' : e.amount < 0 ? `−${usd(-e.amount)}` : usd(e.amount));
    for (const p of e.products) assert.ok(content.includes(data.products.find((x) => x.key === p.key).name));
  }
  await step(() => page.locator('.hx-act [data-ev="dCO1"]').click());
  assert.equal(await page.getByRole('tab', { selected: true }).textContent(), 'Timeline');
  assert.ok((await text(page, '.hx-det')).includes('Items cancelled'));
  assert.equal(await page.locator('.hx-det [data-open]').count(), 0, 'a change without its own drawer has no misleading open action');
});

panelTest(pw, 'Activity product filtering and All products restore exact events', async ({ page, step }) => {
  const { data } = await history(page, 'Activity');
  await step(() => page.locator('.hx-pf [data-p="p2"]').click());
  const expected = data.events.filter((e) => e.lane === 'order' || e.products.some((p) => p.key === 'p2')).map((e) => e.id);
  assert.deepEqual(await page.locator('.hx-act [data-ev]').evaluateAll((es) => es.map((e) => e.dataset.ev)), expected);
  assert.equal(await page.locator('.hx-pf [aria-pressed="true"]').getAttribute('data-p'), 'p2');
  assert.ok(await page.locator('.hx-pf [data-p="p2"]').evaluate((e) => e === document.activeElement));
  await step(() => page.getByRole('button', { name: 'All products', exact: true }).click());
  assert.equal(await page.locator('.hx-act [data-ev]').count(), data.events.length);
});

panelTest(pw, 'Timeline lanes selection related records and clear selection', async ({ page, step }) => {
  const { data } = await history(page, 'Timeline');
  for (const [key, label] of [['order', 'Order'], ['change', 'Changes'], ['fo', 'Fulfillment'], ['exc', 'Exceptions'], ['ship', 'Shipments'], ['money', 'Money'], ['case', 'Cases'], ['ret', 'Returns']]) {
    const lane = page.locator('.hx-lane').filter({ has: page.locator('.hx-ln', { hasText: new RegExp(`^${label}`) }) });
    assert.equal(await lane.locator('[data-ev]').count(), data.events.filter((e) => e.lane === key).length, label);
  }
  const e = data.events.find((e) => e.id === 'dFO2');
  await step(() => page.locator('.hx-box[data-ev="dFO2"]').click());
  assert.ok((await text(page, '.hx-det')).includes(e.title));
  assert.deepEqual(await page.locator('.hx-box.rel').evaluateAll((es) => es.map((e) => e.dataset.ev)), e.rel);
  await step(() => page.locator('.hx-rel [data-sel="dPE1"]').click());
  assert.ok((await text(page, '.hx-det')).includes('Inventory short'));
  await page.getByRole('button', { name: 'Clear selection' }).click();
  assert.equal(await page.locator('.hx-det').count(), 0);
  assert.equal(await page.locator('.hx-box.rel').count(), 0);
});

panelTest(pw, 'Timeline product and day zoom restore Whole order', async ({ page, step }) => {
  const { data } = await history(page, 'Timeline');
  await step(() => page.locator('.hx-pf [data-p="p3"]').click());
  const expected = data.events.filter((e) => e.lane === 'order' || e.products.some((p) => p.key === 'p3')).map((e) => e.id).sort();
  assert.deepEqual((await page.locator('.hx-box[data-ev]:not(.dim)').evaluateAll((es) => es.map((e) => e.dataset.ev))).sort(), expected);
  assert.equal(await page.locator('.hx-box.dim').count(), data.events.length - expected.length, 'unrelated events remain as muted context');
  await page.getByRole('button', { name: 'All products', exact: true }).click();
  const day = page.locator('.hx-tools [data-z]:not([data-z="all"])').first();
  await step(() => day.click());
  const zoomed = await page.locator('.hx-box[data-ev]').count();
  assert.ok(zoomed > 0 && zoomed < data.events.length, 'a day excludes other days');
  await step(() => page.getByRole('button', { name: 'Whole order', exact: true }).click());
  assert.equal(await page.locator('.hx-box[data-ev]').count(), data.events.length);
});

panelTest(pw, 'history drill and Back retain tab product and selected record', async ({ page, step }) => {
  const { id } = await history(page, 'Activity');
  for (const name of ['Activity', 'Timeline']) {
    await view(page, name);
    await page.locator('.hx-pf [data-p="p2"]').click();
    const row = page.locator(`${name === 'Activity' ? '.hx-act' : '.hx-tl'} [data-ev="dPE1"]`);
    await row.focus(); await step(() => page.keyboard.press('Enter'));
    if (name === 'Timeline') await page.locator('.hx-det [data-open]').click();
    assert.equal(await text(page, '#drawer .hd .muted'), 'Process Exception');
    await step(() => page.locator('#dBack').click());
    assert.equal(await page.getByRole('tab', { selected: true }).textContent(), name);
    assert.equal(await page.locator('.hx-pf [aria-pressed="true"]').getAttribute('data-p'), 'p2');
    assert.ok(await page.locator('#drawer').evaluate((e) => e.contains(document.activeElement)));
    if (name === 'Timeline') assert.ok((await text(page, '.hx-det')).includes('Inventory short'));
    await page.getByRole('button', { name: 'All products', exact: true }).click();
  }
  assert.equal(await page.evaluate((key) => window.__drawerUI.reads.filter((r) => r === key).length, `history:${id}`), 1, 'switching tabs and Back reuse the same history read');
});
