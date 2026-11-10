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
/* One component case per supported record, then routing, drill/back and external-link behavior. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { panelTest, payload, orders, sample, open, facts, rows, usd, n, text, fixture } from "./side-panel-kit.mjs";
const pw = await loadPlaywright();
const TYPES = [
  ['FulfillmentOrder', 'foStream', 'Fulfillment Order', 'FulfillmentOrderNumber'],
  ['Shipment', 'shStream', 'Shipment', 'ShipmentNumber'],
  ['ReturnOrder', 'roStream', 'Return Order', 'ReturnOrderNumber'],
  ['Case', 'caseStream', 'Case', 'CaseNumber'],
  ['ProcessException', 'exceptions', 'Process Exception', 'ProcessExceptionNumber'],
];

for (const [obj, key, label, number] of TYPES) panelTest(pw, `${label} fields and related rows`, async ({ page, step }) => {
  const id = (await payload(page))[key].data[0].Id, d = await sample(page, 'demoRecord', obj, id), r = d.record;
  await step(() => open(page, obj, id));
  assert.equal(await text(page, '#drawer .hd .muted'), label);
  assert.equal(await text(page, '#drawer .hd b'), r[number] || '—');
  assert.equal(await text(page, '#drawer .hd .pill'), r.Status);
  const f = await facts(page), content = await text(page);
  const expected = {
    FulfillmentOrder: [['From', r.FulfilledFromLocation?.Name], ['Delivery', r.DeliveryMethod?.Name], ['Total', r.GrandTotalAmount != null ? usd(r.GrandTotalAmount) : null]],
    Shipment: [['Carrier', r.Provider], ['Tracking', r.TrackingNumber]],
    ReturnOrder: [['Value', r.GrandTotalAmount != null ? usd(r.GrandTotalAmount) : null]],
    Case: [['Priority', r.Priority], ['Type', r.Type], ['Origin', r.Origin]],
    ProcessException: [['Category', r.Category], ['Severity', r.Severity], ['Priority', r.Priority]],
  }[obj];
  for (const [k, v] of expected) if (v) assert.equal(f[k], v, k);
  for (const v of [r.Subject, r.Description, r.Message].filter(Boolean)) assert.ok(content.includes(v.replace(/\s+/g, ' ')), v);
  if (r.OrderSummaryId) assert.ok(await page.locator(`#drawer [data-rec="OrderSummary:${r.OrderSummaryId}"]`).count());
  if (obj === 'FulfillmentOrder') assert.deepEqual((await rows(page, 'Line items')).map((r) => r.slice(1)), d.related.lines.map((i) => [n(i.Quantity), n(i.OriginalQuantity), usd(i.TotalPrice)]));
  if (obj === 'Shipment') assert.deepEqual((await rows(page, 'Items')).map((r) => r[1]), d.related.items.map((i) => n(i.Quantity)));
  if (obj === 'ReturnOrder') assert.deepEqual((await rows(page, 'Return lines')).map((r) => r.slice(1)), d.related.lines.map((i) => [n(i.QuantityReturned), i.ReasonForReturn]));
  assert.doesNotMatch(content, /undefined|NaN|Invalid Date/);
});

panelTest(pw, 'fulfillment routing values and focus on map', async ({ page, step }) => {
  const data = await payload(page), id = data.foStream.data[0].Id, d = await sample(page, 'demoRecord', 'FulfillmentOrder', id), x = d.related.routing;
  const location = data.network.data.find((l) => l.name === 'Dallas DC');
  d.record.FulfilledFromLocationId = location.id;
  d.record.FulfilledFromLocation = { Name: location.name };
  await fixture(page, 'FulfillmentOrder', id, { value: d });
  await open(page, 'FulfillmentOrder', id);
  const f = await facts(page);
  for (const [k, v] of [['Location', x.location], ['Reason', x.whyTip], ['Score', n(x.score)], ['Units filled', x.filled]]) assert.equal(f[k], v);
  assert.deepEqual((await rows(page, 'Why this location')).map((r) => [r[0], r[1]]), x.rules.map((r) => [r.label, n(r.score)]));
  const expected = await page.evaluate(async (id) => { const { S } = await import(new URL('console-state.js', document.baseURI).href); return S.geo.clusters.find((c) => c.items.some((l) => l.id === id))?.key; }, d.record.FulfilledFromLocationId);
  assert.ok(expected, 'the fixture location is on the map');
  await step(() => page.getByRole('button', { name: /Focus .* on map/ }).click());
  assert.ok(await page.locator('#drawer').isHidden());
  assert.equal(await page.evaluate(async () => (await import(new URL('console-state.js', document.baseURI).href)).S.focusKey), expected);
  assert.ok(await page.locator('#focus').isVisible());
});

panelTest(pw, 'linked records and Back preserve the drill trail', async ({ page, step }) => {
  const o = (await orders(page))[0];
  await open(page, 'OrderSummary', o.Id);
  const row = page.locator('#drawer [data-rec^="FulfillmentOrder:"]').first(), ref = await row.getAttribute('data-rec');
  await step(() => row.click());
  assert.equal(await text(page, '#drawer .hd .muted'), 'Fulfillment Order');
  assert.ok(await page.locator('#dBack').isVisible());
  const linkedId = (await sample(page, 'demoRecord', ...ref.split(':'))).record.OrderSummaryId;
  await step(() => page.locator(`#drawer [data-rec="OrderSummary:${linkedId}"]`).click());
  assert.equal(await text(page, '#drawer .hd .muted'), 'Order Summary');
  await page.locator('#dBack').click();
  assert.equal(await text(page, '#drawer .hd .muted'), 'Fulfillment Order');
  await page.locator('#dBack').click();
  assert.equal(await text(page, '#drawer .hd b'), o.OrderNumber);
  assert.equal(await page.locator('#dBack').count(), 0);
});

panelTest(pw, 'Salesforce and tracking links have correct safe targets', async ({ page }) => {
  const id = (await payload(page)).shStream.data[0].Id, d = await sample(page, 'demoRecord', 'Shipment', id);
  const tracking = 'https://tracking.example.test/parcel/123', recordUrl = 'https://org.example.test/lightning/r/Shipment/123/view';
  await fixture(page, 'Shipment', id, { value: { ...d, recordUrl, record: { ...d.record, TrackingNumber: 'TRACK-123', TrackingUrl: tracking } } });
  await open(page, 'Shipment', id);
  for (const [name, href] of [[/TRACK-123/, tracking], [/Open in Salesforce/, recordUrl]]) {
    const a = page.getByRole('link', { name });
    assert.equal(await a.getAttribute('href'), href);
    assert.equal(await a.getAttribute('target'), '_blank');
    assert.ok((await a.getAttribute('rel')).split(' ').includes('noopener'));
  }
  await fixture(page, 'Shipment', id, { value: { ...d, record: { ...d.record, TrackingNumber: 'TRACK-123', TrackingUrl: 'javascript:alert(1)' } } });
  await open(page, 'Shipment', id);
  assert.equal(await page.getByRole('link', { name: /TRACK-123/ }).count(), 0);
  assert.ok((await text(page)).includes('TRACK-123'));
});
