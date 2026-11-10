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
/* Held/rejected reads exercise the real asynchronous UI path without timers or external API requests. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { panelTest, payload, orders, sample, open, view, fixture, release, text } from "./side-panel-kit.mjs";
const pw = await loadPlaywright();

panelTest(pw, 'loading can be closed and the delayed reply does not reopen the drawer', async ({ page, step }) => {
  const id = (await orders(page))[0].Id;
  await fixture(page, 'order', id, { hold: true });
  await open(page, 'OrderSummary', id, { wait: false });
  await page.getByText('Loading…', { exact: true }).waitFor();
  assert.equal(await page.locator('#drawer .hd').count(), 0);
  assert.ok(await page.locator('#drawer').evaluate((e) => e.contains(document.activeElement)));
  await step(() => page.keyboard.press('Escape'));
  await release(page, 'order', id);
  assert.ok(await page.locator('#drawer').isHidden());
  assert.ok(await page.locator('#scrim').isHidden());
  await fixture(page, 'order', id, {}); await open(page, 'OrderSummary', id);
  assert.ok(await page.locator('#drawer .hd').isVisible());
});

panelTest(pw, 'order customer and record failures stay contained and recover', async ({ page }) => {
  const orderId = (await orders(page))[0].Id, fo = (await payload(page)).foStream.data[0].Id;
  for (const [kind, obj, id] of [['order', 'OrderSummary', orderId], ['account', 'Account', 'DACC00000000000'], ['FulfillmentOrder', 'FulfillmentOrder', fo]]) {
    await fixture(page, kind, id, { error: `${kind} read unavailable <sample>` });
    await open(page, obj, id);
    assert.equal(await text(page, '#drawer .perr'), `${kind} read unavailable <sample>`);
    assert.equal(await page.locator('#drawer .hd').count(), 0, 'no prior record remains');
    assert.deepEqual(await page.evaluate(() => window.__drawerUI.drawerFacts()), []);
    await page.locator('#closeDrawer').click();
    assert.ok(await page.locator('#drawer').isHidden());
    await fixture(page, kind, id, {}); await open(page, obj, id);
    assert.equal(await page.locator('#drawer .perr').count(), 0);
    assert.ok(await page.locator('#drawer .hd').isVisible());
  }
});

panelTest(pw, 'a previous history failure cannot overwrite the same order reopened on Activity', async ({ page }) => {
  const id = (await orders(page))[0].Id;
  await fixture(page, 'history', id, { hold: true, error: 'Previous history read failed' });
  await open(page, 'OrderSummary', id); await view(page, 'Activity');
  await page.getByText('Putting the order history together…', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#drawer').isHidden());
  await fixture(page, 'history', id, {});
  await open(page, 'OrderSummary', id); await view(page, 'Activity');
  await page.locator('.hx-act').waitFor();
  const current = await text(page, '#oBody');
  await release(page, 'history', id);
  assert.equal(await text(page, '#oBody'), current);
  assert.equal(await page.locator('#oBody .perr').count(), 0);
  assert.ok(await page.locator('.hx-act').isVisible());
});

panelTest(pw, 'history error keeps Details usable and a later attempt recovers', async ({ page }) => {
  const id = (await orders(page))[0].Id;
  await fixture(page, 'history', id, { error: 'History read unavailable' });
  await open(page, 'OrderSummary', id); await view(page, 'Activity');
  assert.equal(await text(page, '#oBody .perr'), 'History read unavailable');
  await view(page, 'Details');
  assert.ok(await page.getByRole('heading', { name: 'Line items', exact: true }).isVisible());
  await fixture(page, 'history', id, {}); await view(page, 'Timeline');
  assert.ok(await page.locator('.hx-tl').isVisible());
  assert.equal(await page.locator('#drawer .perr').count(), 0);
});

panelTest(pw, 'empty history is explained in both views', async ({ page }) => {
  const id = (await orders(page))[0].Id, d = await sample(page, 'demoHistory', id);
  await fixture(page, 'history', id, { value: { ...d, events: [], products: [] } });
  await open(page, 'OrderSummary', id);
  for (const name of ['Activity', 'Timeline']) {
    await view(page, name);
    assert.equal(await text(page, '#oBody'), 'No records on this order yet.');
    assert.equal(await page.locator('#oBody [data-ev]').count(), 0);
  }
});

panelTest(pw, 'late history failure cannot replace Details after switching tabs', async ({ page }) => {
  const id = (await orders(page))[0].Id;
  await fixture(page, 'history', id, { hold: true, error: 'Earlier history failed' });
  await open(page, 'OrderSummary', id); await view(page, 'Activity');
  await page.getByText('Putting the order history together…', { exact: true }).waitFor();
  await view(page, 'Details'); await release(page, 'history', id);
  assert.ok(await page.getByRole('heading', { name: 'Line items', exact: true }).isVisible());
  assert.equal(await page.locator('#drawer .perr').count(), 0);
});

panelTest(pw, 'empty related lists and record text are rendered safely', async ({ page }) => {
  const id = (await payload(page)).caseStream.data[0].Id, d = await sample(page, 'demoRecord', 'Case', id);
  const subject = 'Case <img src=x onerror="window.__unexpected=true">';
  await fixture(page, 'Case', id, { value: { ...d, record: { ...d.record, Subject: subject, Description: 'Line one\nLine two', Priority: null, Origin: null }, related: { exceptions: [] } } });
  await open(page, 'Case', id);
  assert.ok((await text(page)).includes(subject));
  assert.equal(await page.locator('#drawer img').count(), 0);
  assert.equal(await page.evaluate(() => window.__unexpected), undefined);
  assert.equal(await page.locator('#drawer .item').count(), 0);
  assert.ok((await text(page)).includes('None'));
  assert.doesNotMatch(await text(page), /undefined|NaN|Invalid Date/);
});

for (const [kind, obj, key, number] of [['order', 'OrderSummary', 'orderPool', 'OrderNumber'], ['account', 'Account', null, 'Name'], ['FulfillmentOrder', 'FulfillmentOrder', 'foStream', 'FulfillmentOrderNumber']]) panelTest(pw, `late ${kind} response cannot replace the newer record`, async ({ page }) => {
  const data = await payload(page);
  const ids = kind === 'account' ? ['DACC00000000000', 'DACC00000000001'] : (key === 'orderPool' ? await orders(page) : data[key].data).slice(0, 2).map((r) => r.Id);
  const d = await sample(page, kind === 'order' ? 'demoOrder' : kind === 'account' ? 'demoAccount' : 'demoRecord', ...(kind === 'FulfillmentOrder' ? [kind, ids[1]] : [ids[1]]));
  const expected = (d.order || d.account || d.record)[number];
  for (const error of [null, 'Earlier read failed']) {
    await fixture(page, kind, ids[0], { hold: true, error });
    await open(page, obj, ids[0], { wait: false });
    await page.getByText(kind === 'account' ? 'Working out customer value…' : 'Loading…', { exact: true }).waitFor();
    await open(page, obj, ids[1]);
    assert.equal(await text(page, '#drawer .hd b'), expected);
    await release(page, kind, ids[0]);
    assert.equal(await text(page, '#drawer .hd b'), expected, 'the newer record stays visible');
    assert.equal(await page.locator('#drawer .perr').count(), 0, 'an older error cannot replace the newer record either');
  }
});
