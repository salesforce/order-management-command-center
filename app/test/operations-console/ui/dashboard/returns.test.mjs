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
/* Returns: timeline/statuses, reasons/products, days histogram, denominator-based rates, outcomes, CSVs and periods. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { panelTests, n, usd, rate, stats, bars, chart, calendar, stack, kv, sum, text } from "./dashboard-kit.mjs";
const pw = await loadPlaywright();
const rates = (rows) => rows.filter((r) => r.ordered > 0).map((r) => ({ key: r.key === '(blank)' ? '(no channel)' : r.key, n: r.returned / r.ordered, s: `${n(r.returned)} / ${n(r.ordered)}` }));

panelTests(pw, 'returns', [
  ['pRetTime', 'Returns per day', 'ReturnOrder.CreatedDate', async (p, d) => {
    await chart(p, '#pRetTime', calendar(d, 'returnsSeries'), 'Returns');
    await stack(p, '#pRetTime', d.retStatus.data);
    assert.equal(sum(d.returnsSeries.data), d.tiles.data.returns.cur);
    assert.equal(sum(d.retStatus.data), d.tiles.data.returns.cur);
  }, (d) => [['bucket', 'returns'], ...calendar(d, 'returnsSeries').map((r) => [r.key, r.n])]],
  ['pRetWhy', 'Return drivers', 'ReturnOrderLineItem.ReasonForReturn · units', (p, d) => bars(p, '#pRetWhy', d.retReasons.data), (d) => kv(d.retReasons.data)],
  ['pRetSku', 'Most-returned products', 'ReturnOrderLineItem.Product2 · units', (p, d) => bars(p, '#pRetSku', d.retProducts.data), (d) => kv(d.retProducts.data)],
  ['pRetDays', 'Days to return', 'OrderedDate → ReturnOrder.CreatedDate', async (p, d) => {
    const x = d.retDays.data;
    await stats(p, 'pRetDays', [['Typical', `${x.p50.toFixed(1)} d`], ['p90', `${x.p90.toFixed(0)} d`]]);
    assert.equal(await text(p, '#pRetDays .mini > div:last-child small'), `${n(x.n)} returns`);
    await chart(p, '#cRetD', x.hist, 'Returns');
  }, (d) => kv(d.retDays.data.hist)],
  ['pRetRate', 'Return rate', 'OrderItemSummary · units', async (p, d) => {
    await bars(p, '#pRetRate > .hb >> nth=0', rates(d.retByChannel.data), { fmt: (v) => rate(v, 1), share: false });
    await bars(p, '#pRetRate > .hb >> nth=1', rates(d.retByProduct.data).sort((a, b) => b.n - a.n).slice(0, 6), { fmt: (v) => rate(v, 1), share: false });
    assert.equal(await text(p, '#pRetRate h3:first-child'), `By sales channel ${rate(d.lines.data.cur.qr, d.lines.data.cur.qo)} overall`);
    assert.match(await text(p, '#pRetRate .note'), /orders placed in the period/);
  }, (d) => [['kind', 'name', 'returned', 'ordered'], ...['Channel', 'Product'].flatMap((k) => d[`retBy${k}`].data.map((r) => [k.toLowerCase(), r.key, r.returned, r.ordered]))]],
  ['pRetOut', 'Return outcome', 'ReturnOrderLineItem · Refund · exchanges', async (p, d) => {
    const x = d.retOutcome.data;
    await stats(p, 'pRetOut', [['Exchange orders', n(x.exchanges)], ['Refunded', usd(x.refunds.a)], ['Units returned', n(d.lines.data.cur.qr)]]);
    await bars(p, '#pRetOut > .hb >> nth=0', x.repay.filter((r) => r.key !== '(blank)'));
    await bars(p, '#pRetOut > .hb >> nth=1', x.plan.filter((r) => r.key !== '(blank)'));
  }, (d) => { const x = d.retOutcome.data; return [['kind', 'name', 'units'], ...x.repay.map((r) => ['repayment', r.key, r.n]), ...x.plan.map((r) => ['plan', r.key, r.n]), ['exchange orders', '', x.exchanges], ['refunds processed', x.refunds.c, x.refunds.a]]; }],
]);
