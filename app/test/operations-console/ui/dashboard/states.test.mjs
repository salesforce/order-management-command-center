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
/* Controlled edge payloads keep empty, unsupported, capped and failed reads distinguishable without waiting for a real org. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { dashTest, data, policies, patch, stats, bars, checkCsv, text, kv } from "./dashboard-kit.mjs";
const pw = await loadPlaywright(), ok = (data) => ({ ok: true, data });
const clean = async (page) => assert.doesNotMatch(await text(page, '#dash'), /NaN|Infinity|undefined/);

dashTest(pw, 'orders', 'empty bars zero denominators blank reasons and missing change object', async ({ page }) => {
  const d = await data(page), cur = { qo: 0, qc: 0, qr: 0, adj: 0, amt: 0, l: 0, o: 0 };
  await patch(page, 'orders', { channels: ok([]), lines: ok({ cur, prev: null }), cancelled: ok({ value: 0, products: [], capped: true }), cancelReasons: ok([{ key: '(blank)', n: 1 }]), cancelWhen: ok([]), objects: { ...d.objects, OrderItemSummaryChange: false } });
  assert.match(await text(page, '#pChannels'), /Nothing in this period/);
  await stats(page, 'pBasket', [['Items per order', '—'], ['Lines per order', '—'], ['Avg unit price', '—'], ['Discount rate', '—']]);
  await stats(page, 'pCancel', [['Cancel rate', '—'], ['Units cancelled', '0'], ['Cancelled value', '$0'], ['Before fulfillment', '—']]);
  assert.match(await text(page, '#pCancel'), /newest 2,000 lines/);
  assert.equal(await text(page, '#pCancel .lab'), '(no reason)');
  assert.match(await text(page, '#pChanges'), /OrderItemSummaryChange is not available in this org/);
  await checkCsv(page, 'pChannels', 'mtd', kv([]));
  await clean(page);
});

dashTest(pw, 'customers', 'no customers unavailable returns and capped account counts', async ({ page }) => {
  const d = await data(page), x = d.customers.data;
  await patch(page, 'customers', { customers: ok({ ...x, count: { cur: 0, prev: 0 }, spend: { cur: 0, prev: 0 }, orders: 0, fresh: null, repeat: 0, kind: [], bySpend: [], byOrders: [], returners: [] }) });
  await stats(page, 'pCust', [['Customers', '0'], ['New', '—'], ['Repeat', '0'], ['Spend per customer', '—'], ['Orders per customer', '—'], ['Top 10 share', '—']]);
  for (const id of ['pTopSpend', 'pTopOrders', 'pTopRet']) assert.match(await text(page, `#${id}`), /No orders with an account/);
  await patch(page, 'customers', { customers: ok({ ...x, capped: true, objects: { ...x.objects, ReturnOrder: false } }) });
  assert.match(await text(page, '#pCust'), /Counts stop at 2,000 accounts/);
  assert.match(await text(page, '#pTopRet'), /ReturnOrder.AccountId is not available/);
  await clean(page);
});

dashTest(pw, 'fulfillment', 'empty locations unmeasurable carriers and missing objects', async ({ page }) => {
  const d = await data(page), sp = d.speed.data;
  const locations = Array.from({ length: 13 }, (_, i) => ({ ...d.locations.data[0], name: `Warehouse ${i}` }));
  await patch(page, 'fulfillment', { locations: ok(locations) });
  assert.equal(await page.locator('#pLocations tbody tr').count(), 12);
  assert.match(await text(page, '#pLocations .note'), /Top 12 of 13 locations/);
  await checkCsv(page, 'pLocations', 'mtd', [['location', 'type', 'fos', 'fulfilled', 'rejected', 'cancelled', 'open', 'route_p50_hours'], ...locations.map((r) => [r.name, r.type, r.total, r.fulfilled, r.rejected, r.cancelled, r.open, null])]);
  await patch(page, 'fulfillment', { locations: ok([]), locGroups: ok([]), speed: ok({ ...sp, rows: 0, close: { ...sp.close, n: 0, p50: null, p90: null, hist: [] }, route: { ...sp.route, n: 0, p50: null, p90: null, hist: [] }, openAge: [] }), carriers: ok({ total: 4, withActual: 0, list: [{ key: '(not set)', n: 4, measured: 0, onTime: 0, transitP50: null, status: { Shipped: 4 } }] }) });
  assert.match(await text(page, '#pLocations'), /No fulfillment orders in this period/);
  assert.match(await text(page, '#pLocGroups'), /Nothing in this period/);
  await stats(page, 'pFoAge', [['Open now', '0'], ['Older than 30 d', '0']]);
  await stats(page, 'pCarrier', [['Shipments', '4'], ['On time', '—'], ['Delivered', '0']]);
  assert.match(await text(page, '#pCarrier .note'), /No shipment has an ActualDeliveryDate/);
  assert.match(await text(page, '#pCarrier .note'), /4 of 4 shipments have no carrier/);
  await patch(page, 'fulfillment', { objects: { ...d.objects, LocationGroupAssignment: false }, speed: ok(null), carriers: ok(null) });
  for (const [id, obj] of [['pLocGroups', 'LocationGroupAssignment'], ['pSpeed', 'FulfillmentOrder'], ['pFoAge', 'FulfillmentOrder'], ['pCarrier', 'Shipment']]) assert.ok((await text(page, `#${id}`)).includes(`${obj} is not available`));
  await clean(page);
});

dashTest(pw, 'payments', 'failed canceled declined and voided amounts never enter stages', async ({ page }) => {
  const failures = Object.fromEntries(['Failed', 'Canceled', 'Cancelled', 'Declined', 'Voided'].map((key) => [key, { c: 1, a: 1000 }]));
  await patch(page, 'payments', { money: ok({ auth: { Processed: { c: 1, a: 100 }, ...failures }, pay: { Processed: { c: 1, a: 75 }, ...failures }, ref: { Processed: { c: 1, a: 15 }, ...failures }, inv: { a: 80, b: 5, c: 1 }, objects: { PaymentAuthorization: true, Payment: true, Invoice: true, Refund: true } }) });
  await stats(page, 'pMoney', [['Capture rate', '75%'], ['Refund rate', '20%'], ['Open invoice balance', '$5'], ['Failed', '5']]);
  await bars(page, '#pMoney', [{ key: 'Authorized', n: 100, s: '' }, { key: 'Captured', n: 75, s: '75% of auth' }, { key: 'Invoiced', n: 80, s: '80% of auth' }, { key: 'Refunded', n: 15, s: '20% of capt.' }], { fmt: (v) => `$${v}`, share: false });
  await checkCsv(page, 'pMoney', 'mtd', [['stage', 'amount'], ['Authorized', 100], ['Captured', 75], ['Invoiced', 80], ['Refunded', 15]]);
});

dashTest(pw, 'payments', 'no outstanding balances zero rates and missing payment objects', async ({ page }) => {
  const empty = { orders: 0, docs: 0, amount: 0, top: [] };
  await patch(page, 'payments', { settlement: ok({ unpaid: empty, unrefunded: empty, noInvoice: 0 }), money: ok({ auth: {}, pay: {}, ref: {}, inv: { a: 0, b: 0, c: 0 }, objects: { Invoice: true } }) });
  await stats(page, 'pMoney', [['Capture rate', '—'], ['Refund rate', '—'], ['Open invoice balance', '$0'], ['Failed', '0']]);
  assert.match(await text(page, '#pMoney'), /not in org/);
  assert.match(await text(page, '#pUnpaid'), /Every invoice on a shipped order in this period is paid/);
  assert.match(await text(page, '#pUnrefunded'), /Every credit memo in this period has been refunded/);
  await checkCsv(page, 'pUnpaid', 'mtd', [['order_number', 'order_status', 'documents', 'document_total', 'open_balance', 'created', 'order_id']]);
  await patch(page, 'payments', { settlement: ok({ unpaid: null, unrefunded: null }), money: ok(null) });
  for (const [id, obj] of [['pMoney', 'Payment objects'], ['pUnpaid', 'Invoice'], ['pUnrefunded', 'CreditMemo']]) assert.ok((await text(page, `#${id}`)).includes(`${obj} is not available`));
  assert.equal(await page.locator('#dGrid [data-csv]').count(), 0, 'unavailable data has no misleading export');
  await clean(page);
});

dashTest(pw, 'service', 'no exceptions unresolved timing and unavailable Case', async ({ page }) => {
  const d = await data(page);
  await patch(page, 'service', { exCategory: ok([]), exStatus: ok([]), exAge: ok([]), exResolve: ok({ n: 0, p50: null, p90: null, byCategory: [] }), cases: ok(null) });
  assert.match(await text(page, '#pExCat'), /Nothing in this period/);
  await stats(page, 'pExAge', [['Open now', '0'], ['Time to resolve', '—']]);
  assert.match(await text(page, '#pExAge'), /none resolved in period/);
  assert.match(await text(page, '#pCases'), /Case is not available/);
  await patch(page, 'service', { objects: { ...d.objects, ProcessException: false } });
  assert.match(await text(page, '#pExAge'), /ProcessException is not available/);
  await clean(page);
});

dashTest(pw, 'returns', 'zero denominators blank channels outcomes and unavailable days', async ({ page }) => {
  const d = await data(page);
  await patch(page, 'returns', { retReasons: ok([]), retProducts: ok([]), retDays: ok(null), retByChannel: ok([{ key: 'Zero', returned: 0, ordered: 0 }, { key: '(blank)', returned: 2, ordered: 40 }]), retByProduct: ok([]), lines: ok({ cur: { qo: 0, qr: 0 } }), retOutcome: ok({ exchanges: null, refunds: null, repay: [{ key: '(blank)', n: 2 }], plan: [{ key: '(blank)', n: 2 }] }) });
  await bars(page, '#pRetRate > .hb', [{ key: '(no channel)', n: .05, s: '2 / 40' }], { fmt: () => '5.0%', share: false });
  assert.match(await text(page, '#pRetRate h3:first-child'), /— overall/);
  assert.match(await text(page, '#pRetDays'), /ReturnOrder is not available/);
  await stats(page, 'pRetOut', [['Exchange orders', '—'], ['Refunded', '—'], ['Units returned', '0']]);
  assert.match(await text(page, '#pRetOut'), /blank on every return line/);
  assert.equal(await page.locator('#pRetOut .hb').count(), 0);
  await patch(page, 'returns', { objects: { ...d.objects, OrderItemSummary: false } });
  assert.match(await text(page, '#pRetRate'), /OrderItemSummary is not available/);
  await clean(page);
});

dashTest(pw, 'products', 'no product lines open demand missing amounts and missing rate fields', async ({ page }) => {
  const d = await data(page), top = { ...d.prodTop.data, top: [], cancelRate: null, returnRate: null, revenue: false };
  await patch(page, 'products', { prodTotals: ok({ cur: { n: 0, qo: 0, amt: 0, qc: 0, qr: 0 }, prev: null }), prodTop: ok(top), prodRevenue: ok(null), prodFamily: ok([]), prodDemand: ok({ units: 0, products: 0, fos: 0, list: [] }) });
  assert.match(await text(page, '#pProdTop'), /No product lines in this period/);
  assert.match(await text(page, '#pProdDemand'), /No open fulfillment demand/);
  for (const [id, field] of [['pProdRev', 'TotalLineAmount'], ['pProdCancel', 'QuantityCanceled'], ['pProdReturn', 'QuantityReturned']]) assert.ok((await text(page, `#${id}`)).includes(`OrderItemSummary.${field} is not available`));
  assert.equal(await page.locator('[data-csv="pProdCancel"]').count(), 0);
  assert.equal(await text(page, '#pProdSum .mini > div:nth-child(4) b'), '—');
  assert.equal(await text(page, '#pProdSum .mini > div:last-child b'), '—');
  await patch(page, 'products', { prodFamily: ok([{ key: '(no family)', qo: 2, amt: 30 }]), prodTop: ok({ ...d.prodTop.data, capped: true }) });
  assert.match(await text(page, '#pProdFamily .note'), /without a Family/);
  assert.match(await text(page, '#pProdTop .note'), /products by units ordered/);
  assert.ok((await text(page, '#pProdTop .note')).includes(`${d.prodTop.data.products}+`));
  await clean(page);
});

dashTest(pw, 'policies', 'permission missing empty and ambiguous defaults remain explicit', async ({ page }) => {
  for (const [state, message] of [['hidden', 'This org has policies, but you can’t read them'], ['unknown', 'whether the org has them can’t be told'], ['none', 'Deploy org/policies']]) {
    await patch(page, 'policies', {}, ok({ available: false, state }));
    assert.ok((await text(page, '#pPolicy')).includes(message));
    assert.equal(await page.locator('#dGrid [data-csv]').count(), 0);
  }
  await patch(page, 'policies', {}, { ok: false, error: 'Policy read denied' });
  assert.equal(await text(page, '#pPolicy .perr'), 'Policy read denied');
  const b = await policies(page);
  await patch(page, 'policies', {}, ok({ ...b, return: [], cancel: null, assignments: [] }));
  assert.match(await text(page, '#pPolReturn'), /No active policy/);
  assert.match(await text(page, '#pPolCancel'), /Cancel policy is not available/);
  assert.match(await text(page, '#pPolAssign'), /every store takes the defaults/);
  await patch(page, 'policies', {}, ok({ ...b, return: b.return.map((p) => ({ ...p, isDefault: true })), cancel: b.cancel.map((p) => ({ ...p, isDefault: false })), assignments: [{ ...b.assignments[0], return: 'missingPolicyId' }] }));
  assert.match(await text(page, '#pPolReturn .note'), /More than one default/);
  assert.match(await text(page, '#pPolCancel .note'), /No default/);
  assert.match(await text(page, '#pPolAssign'), /inactive or deleted/);
  await patch(page, 'policies', {}, ok({ ...b, return: [{ ...b.return[0], days: null }, { ...b.return[1], days: 5, from: 'order' }], cancel: [{ ...b.cancel[0], hours: null }], adjust: [{ ...b.adjust[0], maxPercent: null, maxAmount: null }] }));
  assert.deepEqual(await page.locator('#pPolReturn tbody td:nth-child(2)').allTextContents(), ['Any time', 'Within 5 days of the order']);
  assert.equal(await text(page, '#pPolCancel tbody td:nth-child(2)'), 'Until items ship');
  assert.equal(await text(page, '#pPolAdjust tbody td:nth-child(2)'), 'Any size');
  await clean(page);
});

for (const [domain, key, panel, healthy] of [['orders', 'channels', 'pChannels', 'pBasket'], ['customers', 'customers', 'pCust', null], ['fulfillment', 'carriers', 'pCarrier', 'pLocations'], ['payments', 'money', 'pMoney', 'pUnpaid'], ['service', 'cases', 'pCases', 'pExAge'], ['returns', 'retReasons', 'pRetWhy', 'pRetTime'], ['products', 'prodFamily', 'pProdFamily', 'pProdTop']]) {
  dashTest(pw, domain, 'partial query failure stays local and capped reads are labeled', async ({ page }) => {
    const original = await data(page), before = healthy ? await text(page, `#${healthy}`) : null;
    await patch(page, domain, { [key]: { ok: false, error: `${key} query failed` } });
    assert.equal(await text(page, `#${panel} .perr`), `${key} query failed`);
    if (healthy) assert.equal(await text(page, `#${healthy}`), before, 'other components remain usable');
    assert.equal(await page.locator('#dTiles .kpi .l').count(), 6);
    await patch(page, domain, { [key]: { ...original[key], capped: true } });
    assert.match(await text(page, `#${panel} .pcap`), /first 2,000 rows/);
    await clean(page);
  });
}
