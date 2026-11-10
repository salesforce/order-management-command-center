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
/* Order cards, stages, item outcomes, fulfillment/staleness, shipment links, closed cases and returns. */
import assert from 'node:assert/strict';
import { loadPlaywright, T0 } from "../../../../tools/browser-kit.mjs";
import { serviceTest, sample, customer, fixture, text, usd, AVERY } from "./service-kit.mjs";
const pw = await loadPlaywright();

serviceTest(pw, 'every order card shows matching number status total destination and items', async ({ page, step }) => {
  const d = await sample(page, 'demoCustomer', AVERY); await customer(page);
  assert.equal(await page.locator('#c360 .ocard').count(), d.orders.length);
  for (const [i, o] of d.orders.entries()) {
    const card = page.locator('#c360 .ocard').nth(i), content = await card.innerText();
    for (const value of [o.OrderNumber, o.Status, usd(o.GrandTotalAmount), o.SalesChannel?.SalesChannelName, o.shipTo.method, `${o.shipTo.city}, ${o.shipTo.state}`].filter(Boolean)) assert.ok(content.includes(value), value);
    assert.deepEqual(await card.locator('table.lines tbody tr').evaluateAll((es) => es.map((e) => [...e.cells].slice(1).map((c) => c.textContent))), o.items.slice(0, 6).map((l) => [`×${l.ordered}`, usd(l.total)]));
    const units = o.items.reduce((n, l) => n + l.ordered, 0);
    assert.equal(await card.getByRole('heading', { name: /^Items/ }).textContent(), `Items · ${units} ${units === 1 ? 'unit' : 'units'}`);
    for (const l of o.items.slice(0, 6)) assert.ok(content.includes(l.name));
  }
  await step(() => page.locator('#c360 .ocard [data-order]').first().click());
  assert.equal(await text(page, '#drawer .hd b'), d.orders[0].OrderNumber);
});

serviceTest(pw, 'item cancellation return fulfillment and six-line cap stay distinct', async ({ page }) => {
  const d = await sample(page, 'demoCustomer', AVERY), o = d.orders[0], base = o.items[0];
  const items = [
    { ...base, name: 'Canceled item', ordered: 2, canceled: 1, returned: 0, fulfilled: 0 },
    { ...base, name: 'Returned item', ordered: 2, canceled: 0, returned: 1, fulfilled: 2 },
    { ...base, name: 'Partial item', ordered: 3, canceled: 0, returned: 0, fulfilled: 1 },
    ...Array.from({ length: 5 }, (_, i) => ({ ...base, name: `Extra item ${i}`, canceled: 0, returned: 0, fulfilled: 0 })),
  ];
  await fixture(page, 'customer', AVERY, { value: { ...d, orders: [{ ...o, items }] } }); await customer(page);
  assert.equal(await page.locator('#c360 table.lines tr').count(), 6);
  for (const value of ['1 cancelled', '1 returned', 'fulfilled', '1 of 3 fulfilled', '+2 more — open the order for all lines']) assert.ok((await text(page)).includes(value));
  assert.ok(!(await text(page)).includes('Extra item 4'));
});

serviceTest(pw, 'fulfillment stages stuck badges quantities and shipment dates match records', async ({ page, step }) => {
  const d = await sample(page, 'demoCustomer', AVERY); await customer(page);
  for (const [i, o] of d.orders.entries()) {
    const card = page.locator('.ocard').nth(i), f = o.fulfillmentOrders[0], box = card.locator('.fob');
    for (const value of [f.FulfillmentOrderNumber, f.Status, f.FulfilledFromLocation.Name, f.DeliveryMethod.Name]) assert.ok((await box.innerText()).includes(value));
    for (const item of f.items) assert.ok((await box.locator('.fitems').innerText()).includes(`${item.name} ×${item.quantity}`));
    const idle = Math.floor((T0 - Date.parse(f.LastModifiedDate)) / 864e5), stuck = !/fulfill|cancel/i.test(f.Status) && idle >= 2;
    assert.equal(await box.locator('.badge.warn').count(), stuck ? 1 : 0);
    if (stuck) assert.equal(await box.locator('.badge.warn').textContent(), `No update in ${idle}d`);
    assert.equal(await box.locator('.shp').count(), f.shipments.length || (/fulfilled/i.test(f.Status) ? 0 : 1));
    for (const ship of f.shipments) for (const value of [ship.Provider, ship.TrackingNumber, ship.ActualDeliveryDate ? 'delivered' : 'due']) assert.ok((await box.innerText()).includes(value));
  }
  const first = page.locator('#c360 .fob').first(); await first.focus(); await step(() => page.keyboard.press('Enter'));
  assert.equal(await text(page, '#drawer .hd .muted'), 'Fulfillment Order');
});

serviceTest(pw, 'unreleased canceled and missing fulfillment orders explain their state', async ({ page }) => {
  const d = await sample(page, 'demoCustomer', AVERY), o = d.orders[0];
  await fixture(page, 'customer', AVERY, { value: { ...d, orders: ['Created', 'Canceled', 'Fulfilling'].map((Status, i) => ({ ...o, Id: `${o.Id}-${i}`, Status, fulfillmentOrders: [], items: [] })) } });
  await customer(page);
  const cards = page.locator('.ocard');
  for (const [i, value] of ['Not released to fulfillment yet.', 'Cancelled before fulfillment.', 'No fulfillment orders.'].entries()) assert.ok((await cards.nth(i).innerText()).includes(value));
  assert.equal(await page.locator('.ocard .steps.cancel .cur').textContent(), 'Cancelled');
  assert.equal(await page.getByText('No product lines.', { exact: true }).count(), 3);
});

serviceTest(pw, 'returns refunds closed cases and tracking links use matching records', async ({ page, step }) => {
  const d = await sample(page, 'demoCustomer', AVERY), ship = d.orders.flatMap((o) => o.fulfillmentOrders.flatMap((f) => f.shipments))[0];
  ship.TrackingUrl = 'https://tracking.example.test/parcel/123';
  await fixture(page, 'customer', AVERY, { value: d }); await customer(page);
  for (const value of [`Refunded ${usd(d.returns.refunded)}`, `Credit memos ${usd(d.returns.credited)}`, ...d.returns.list.map((r) => r.ReturnOrderNumber), ...d.cases.filter((c) => c.IsClosed).map((c) => c.Subject)]) assert.ok((await text(page)).includes(value));
  const link = page.locator('.shp a[href^="https://tracking.example.test"]');
  assert.equal(await link.getAttribute('target'), '_blank'); assert.equal(await link.getAttribute('rel'), 'noopener');
  await step(() => page.locator('#c360 [data-rec^="ReturnOrder:"]').first().click());
  assert.equal(await text(page, '#drawer .hd .muted'), 'Return Order');
});
