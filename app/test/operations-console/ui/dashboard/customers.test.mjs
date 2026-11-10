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
/* Customers: summary, every ranked account/cell, shares and returns, private CSVs, and period changes. Drawer wiring is in page.test. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { panelTests, n, usd, pct, rate, stats, bars, table, sum, text } from "./dashboard-kit.mjs";
const pw = await loadPlaywright();
const csv = (rows) => [['rank', 'account_id', 'account', 'orders', 'spend', 'returns', 'returned'], ...rows.map((r, i) => [i + 1, r.id, r.name, r.orders, r.spend, r.returns, r.returned])];
const returnRate = (r) => r.spend ? rate(r.returned, r.spend) : r.returned ? '—' : '0%';
const ranking = (id, key, returns = false) => [id, { bySpend: 'Top accounts by spend', byOrders: 'Most frequent shoppers', returners: 'Top returners' }[key], { bySpend: 'SUM(OrderSummary.GrandTotalAmount)', byOrders: 'COUNT(OrderSummary) by AccountId', returners: 'COUNT(ReturnOrder) by AccountId' }[key], async (p, d) => {
  const x = d.customers.data;
  await table(p, id, returns ? ['', 'Account', 'Returns', 'Returned', 'Orders', 'Spend', 'Return rate'] : ['', 'Account', 'Orders', 'Spend', 'Share', 'Returns', 'Return rate'], x[key].map((r, i) => [i + 1, r.name, ...(returns ? [n(r.returns), usd(r.returned), n(r.orders), usd(r.spend)] : [n(r.orders), usd(r.spend), rate(r.spend, x.spend.cur), r.returns ? `${n(r.returns)} · ${usd(r.returned)}` : 'none']), returnRate(r)]));
  assert.deepEqual(await p.locator(`#${id} tr[data-acct]`).evaluateAll((rs) => rs.map((r) => [r.dataset.acct, r.getAttribute('tabindex')])), x[key].map((r) => [r.id, '0']));
  if (returns) assert.match(await text(p, `#${id} .note`), /order placed before it/);
}, (d) => csv(d.customers.data[key])];

panelTests(pw, 'customers', [
  ['pCust', 'Customer base', 'OrderSummary.AccountId · not canceled', async (p, d) => {
    const x = d.customers.data;
    await stats(p, 'pCust', [['Customers', n(x.count.cur)], ['New', n(x.fresh)], ['Repeat', n(x.repeat)], ['Spend per customer', usd(x.spend.cur / x.count.cur)], ['Orders per customer', (x.orders / x.count.cur).toFixed(1)], ['Top 10 share', pct(sum(x.bySpend, 'spend') / x.spend.cur)]]);
    await bars(p, '#pCust .two > div:first-child', x.kind);
    await bars(p, '#pCust .two > div:last-child', x.kind.map((r) => ({ ...r, n: r.v })), { fmt: usd });
    assert.match(await text(p, '#pCust .note'), /wasn't canceled/);
  }, (d) => { const x = d.customers.data; return [['metric', 'value'], ['customers', x.count.cur], ['new', x.fresh], ['repeat', x.repeat], ['spend', x.spend.cur], ['orders', x.orders], ...x.kind.map((r) => [r.key, r.n])]; }],
  ranking('pTopSpend', 'bySpend'), ranking('pTopOrders', 'byOrders'), ranking('pTopRet', 'returners', true),
]);
