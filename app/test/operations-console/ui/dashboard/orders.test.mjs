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
/* Orders: each panel's full values, chart/bar proportions, source and CSV; then all panels on YTD and back to MTD. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { panelTests, n, usd, pct, rate, stats, bars, chart, calendar, kv, sum, text } from "./dashboard-kit.mjs";
const pw = await loadPlaywright();

panelTests(pw, 'orders', [
  ['pOrders', 'Orders per day', 'OrderSummary.OrderedDate', async (p, d) => {
    await chart(p, '#pOrders', calendar(d, 'ordersSeries'), 'Orders');
    assert.equal(sum(d.ordersSeries.data), d.tiles.data.orders.cur, 'chart matches Orders KPI');
  }, (d) => [['bucket', 'orders'], ...calendar(d, 'ordersSeries').map((r) => [r.key, r.n])]],
  ['pChannels', 'Sales channel mix', 'OrderSummary.SalesChannel', async (p, d) => {
    await bars(p, '#pChannels', d.channels.data);
    assert.equal(sum(d.channels.data), d.tiles.data.orders.cur, 'channel counts match Orders KPI');
  }, (d) => kv(d.channels.data)],
  ['pBasket', 'Average basket', 'OrderItemSummary · products', async (p, d) => {
    const x = d.lines.data.cur;
    await stats(p, 'pBasket', [['Items per order', (x.qo / x.o).toFixed(2)], ['Lines per order', (x.l / x.o).toFixed(2)], ['Avg unit price', usd(x.amt / x.qo)], ['Discount rate', rate(-x.adj, x.amt)]]);
    await bars(p, '#pBasket', [{ key: 'Ordered', n: x.qo }, { key: 'Cancelled', n: x.qc, s: rate(x.qc, x.qo) }, { key: 'Returned', n: x.qr, s: rate(x.qr, x.qo) }], { share: false });
    assert.ok((await text(p, '#pBasket .note')).startsWith(`${n(x.o)} orders, ${n(x.l)} product lines.`));
  }, (d) => [['metric', 'current', 'prior'], ...['qo', 'qc', 'qr', 'adj', 'amt', 'l', 'o'].map((k) => [k, d.lines.data.cur[k], d.lines.data.prev?.[k]])]],
  ['pCancel', 'Cancellations', 'OrderItemSummary · OrderItemSummaryChange', async (p, d) => {
    const x = d.lines.data.cur, when = d.cancelWhen.data;
    await stats(p, 'pCancel', [['Cancel rate', rate(x.qc, x.qo)], ['Units cancelled', n(x.qc)], ['Cancelled value', usd(d.cancelled.data.value)], ['Before fulfillment', pct((when.find((r) => String(r.key) === 'true')?.n || 0) / sum(when))]]);
    await bars(p, '#pCancel .two > div:first-child', d.cancelReasons.data.map((r) => ({ ...r, key: r.key === '(blank)' ? '(no reason)' : r.key })));
    await bars(p, '#pCancel .two > div:last-child', d.cancelled.data.products.map((r) => ({ ...r, s: usd(r.v) })), { share: false });
  }, (d) => [['kind', 'name', 'value'], ...d.cancelReasons.data.map((r) => ['reason', r.key, r.n]), ...d.cancelled.data.products.map((r) => ['product units', r.key, r.n]), ...d.cancelWhen.data.map((r) => ['pre-fulfillment', r.key, r.n])]],
  ['pChanges', 'Order changes', 'OrderItemSummaryChange.ChangeType', async (p, d) => {
    await bars(p, '#pChanges', d.changes.data);
    assert.match(await text(p, '#pChanges .note'), /cancels, returns, adds and price changes/);
  }, (d) => kv(d.changes.data)],
]);
