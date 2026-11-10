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
/* Products: all seven components, complete rankings/rates, fixed open demand, sources, CSVs and period changes. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { panelTests, n, usd, rate, stats, bars, table, text } from "./dashboard-kit.mjs";
const pw = await loadPlaywright();
const ratePanel = (id, title, key, field) => [id, title, `OrderItemSummary.Quantity${field}`, async (p, d) => {
  const x = d.prodTop.data;
  await bars(p, `#${id}`, x[key].map((r) => ({ ...r, s: `${n(r.units)} / ${n(r.ordered)}` })), { fmt: (v) => rate(v, 1), share: false });
  assert.ok((await text(p, `#${id} .note`)).includes(`at least ${n(x.floor)} units ordered`));
}, (d) => [['product', field === 'Canceled' ? 'cancelled' : 'returned', 'ordered', 'rate'], ...d.prodTop.data[key].map((r) => [r.key, r.units, r.ordered, r.n])]];

panelTests(pw, 'products', [
  ['pProdSum', 'Product performance', 'OrderItemSummary · products', async (p, d) => {
    const x = d.prodTotals.data.cur;
    await stats(p, 'pProdSum', [['Products sold', n(x.n)], ['Units ordered', n(x.qo)], ['Product revenue', usd(x.amt)], ['Units per product', (x.qo / x.n).toFixed(1)], ['Cancel rate', rate(x.qc, x.qo)], ['Return rate', rate(x.qr, x.qo)]]);
    assert.match(await text(p, '#pProdSum .note'), /before adjustments/);
  }, (d) => [['metric', 'current', 'prior'], ...['n', 'qo', 'amt', 'qc', 'qr'].map((k) => [k, d.prodTotals.data.cur[k], d.prodTotals.data.prev?.[k]])]],
  ['pProdTop', 'Top products', 'OrderItemSummary.Product2 · units', async (p, d) => {
    const x = d.prodTop.data;
    await table(p, 'pProdTop', ['', 'Product', 'Units', 'Share', 'Revenue', 'Cancelled', 'Returned'], x.top.map((r, i) => [i + 1, r.key, n(r.qo), rate(r.qo, d.prodTotals.data.cur.qo), usd(r.amt), `${n(r.qc)} ${rate(r.qc, r.qo)}`, `${n(r.qr)} ${rate(r.qr, r.qo)}`]));
    assert.ok((await text(p, '#pProdTop .note')).startsWith(`Top 10 of ${n(x.products)} products by units ordered.`));
    assert.deepEqual(await p.locator('#pProdTop tr[data-prod]').evaluateAll((rs) => rs.map((r) => [r.dataset.prod, r.getAttribute('tabindex')])), x.top.map((r) => [r.id, '0']));
  }, (d) => [['product_id', 'product', 'units', 'revenue', 'cancelled', 'returned'], ...d.prodTop.data.top.map((r) => [r.id, r.key, r.qo, r.amt, r.qc, r.qr])]],
  ['pProdRev', 'Top products by revenue', 'OrderItemSummary.Product2 · line amount', (p, d) => bars(p, '#pProdRev', d.prodRevenue.data.map((r) => ({ key: r.key, n: r.amt, s: `${n(r.qo)} units` })), { fmt: usd, share: false }), (d) => [['product_id', 'product', 'revenue', 'units'], ...d.prodRevenue.data.map((r) => [r.id, r.key, r.amt, r.qo])]],
  ratePanel('pProdCancel', 'Highest cancel rate', 'cancelRate', 'Canceled'),
  ratePanel('pProdReturn', 'Highest return rate', 'returnRate', 'Returned'),
  ['pProdFamily', 'Product family mix', 'Product2.Family · units', (p, d) => bars(p, '#pProdFamily', d.prodFamily.data.map((r) => ({ key: r.key, n: r.qo, s: usd(r.amt) })), { share: false }), (d) => [['family', 'products', 'units', 'revenue'], ...d.prodFamily.data.map((r) => [r.key, r.products, r.qo, r.amt])]],
  ['pProdDemand', 'Open fulfillment demand', 'FulfillmentOrderLineItem · open now', async (p, d) => {
    const x = d.prodDemand.data;
    await stats(p, 'pProdDemand', [['Units open', n(x.units)], ['Products', n(x.products)], ['Fulfillment orders', n(x.fos)]]);
    await table(p, 'pProdDemand', ['', 'Product', 'Units open', 'Share', 'Fulfillment orders'], x.list.map((r, i) => [i + 1, r.key, n(r.n), rate(r.n, x.units), n(r.fos)]));
    assert.deepEqual(await p.locator('#pProdDemand tr[data-prod]').evaluateAll((rs) => rs.map((r) => [r.dataset.prod, r.getAttribute('tabindex')])), x.list.map((r) => [r.id, '0']));
    assert.match(await text(p, '#pProdDemand .note'), /independent of the period/);
  }, (d) => [['product_id', 'product', 'units_open', 'fulfillment_orders'], ...d.prodDemand.data.list.map((r) => [r.id, r.key, r.n, r.fos])]],
]);
