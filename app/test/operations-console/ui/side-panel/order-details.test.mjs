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
/* Order contents: expectations come from the sample payload, including bundle parts, cancellations and empty sections. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { panelTest, orders, sample, open, facts, rows, usd, n, text, fixture } from "./side-panel-kit.mjs";
const pw = await loadPlaywright();

panelTest(pw, 'order facts and every line item match the payload', async ({ page, step }) => {
  const o = (await orders(page))[0], d = await sample(page, 'demoOrder', o.Id);
  await step(() => open(page, 'OrderSummary', o.Id));
  assert.equal(await text(page, '#drawer .hd b'), o.OrderNumber);
  assert.equal(await text(page, '#drawer .hd .pill'), o.Status);
  const f = await facts(page);
  for (const [key, value] of [['Total', usd(o.GrandTotalAmount)], ['Channel', o.SalesChannel?.SalesChannelName || '—'], ['Email', d.order.BillingEmailAddress], ['Bill to', 'Austin, TX']]) assert.equal(f[key], value, key);
  assert.equal(await page.locator('#drawer [data-acct]').textContent(), `${o.Account.Name} →`);
  const got = await rows(page, 'Line items');
  assert.equal(got.length, d.items.length);
  for (const [i, item] of d.items.entries()) {
    assert.ok(got[i][0].startsWith(item.Name), item.Name);
    assert.deepEqual(got[i].slice(1), [n(item.Quantity), n(item.QuantityCanceled), usd(item.TotalPrice)]);
  }
  assert.equal(await page.locator('#drawer tr.bpart').count(), 2);
  assert.equal(await page.locator('#drawer tr').filter({ hasText: 'Summit camp kit' }).locator('.pill').textContent(), 'Bundle');
  assert.ok(got.find((r) => r[0].startsWith('Trail cap'))[2] === '1', 'canceled units are retained');
  assert.equal(await page.getByRole('tab', { selected: true }).textContent(), 'Details');
});

panelTest(pw, 'order progress distinguishes approved partial fulfilled and canceled', async ({ page }) => {
  const id = (await orders(page))[0].Id, d = await sample(page, 'demoOrder', id);
  for (const [status, current, done] of [['Approved', 'Approved', 1], ['Partially Fulfilled', 'Fulfilling', 2], ['Fulfilled', 'Fulfilled', 3], ['Canceled', 'Cancelled', 0]]) {
    await fixture(page, 'order', id, { value: { ...d, order: { ...d.order, Status: status } } });
    await open(page, 'OrderSummary', id);
    assert.equal(await text(page, '#drawer .steps .cur'), current);
    assert.equal(await page.locator('#drawer .steps .done').count(), done);
    assert.equal(await page.locator('#drawer .steps').evaluate((e) => e.classList.contains('cancel')), status === 'Canceled');
  }
});

panelTest(pw, 'empty order sections and absent optional fields show useful fallbacks', async ({ page }) => {
  const id = (await orders(page))[0].Id, d = await sample(page, 'demoOrder', id);
  await fixture(page, 'order', id, { value: { ...d, order: { ...d.order, BillingEmailAddress: null, BillingCity: null, BillingState: null, SalesChannel: null }, items: [], fulfillmentOrders: [], exceptions: [], cases: [], returns: [], recordUrl: null } });
  await open(page, 'OrderSummary', id);
  const f = await facts(page), content = await text(page);
  for (const key of ['Email', 'Bill to', 'Channel']) assert.equal(f[key], '—');
  for (const message of ['Not routed yet', 'No cases on this order.', 'No returns on this order.']) assert.ok(content.includes(message));
  assert.equal(await page.locator('#drawer table').count(), 0);
  assert.doesNotMatch(content, /undefined|NaN|Invalid Date/);
  assert.equal(await page.getByRole('link', { name: /Open in Salesforce/ }).count(), 0);
});
