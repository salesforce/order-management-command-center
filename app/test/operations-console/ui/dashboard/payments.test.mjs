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
/* Payments: valid payment stages exclude failures; every outstanding order/cell, balances, CSVs and period changes. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { panelTests, n, usd, pct, rate, stats, bars, table, text } from "./dashboard-kit.mjs";
const pw = await loadPlaywright();
const bad = new Set(['Failed', 'Canceled', 'Cancelled', 'Declined', 'Voided']);
const amount = (rows) => Object.entries(rows).reduce((sum, [status, r]) => sum + (bad.has(status) ? 0 : r.a), 0);
const failed = (rows) => Object.entries(rows).reduce((sum, [status, r]) => sum + (bad.has(status) ? r.c : 0), 0);
const flow = (d) => { const x = d.money.data; return [['Authorized', amount(x.auth)], ['Captured', amount(x.pay)], ['Invoiced', x.inv.a], ['Refunded', amount(x.ref)]]; };
const openCsv = (x) => [['order_number', 'order_status', 'documents', 'document_total', 'open_balance', 'created', 'order_id'], ...x.top.map((r) => [r.number, r.status, r.docs, r.total, r.balance, r.at, r.id])];
const outstanding = (id, title, source, key, doc) => [id, title, source, async (p, d) => {
  const x = d.settlement.data[key];
  await stats(p, id, key === 'unpaid' ? [['Not paid', usd(x.amount)], ['Orders', n(x.orders)], ['Shipped, no invoice', n(d.settlement.data.noInvoice)]] : [['Refund owed', usd(x.amount)], ['Orders', n(x.orders)]]);
  await table(p, id, ['', 'Order', 'Status', `${doc}s`, `${doc} total`, 'Open balance', 'Created'], x.top.map((r, i) => [i + 1, r.number, r.status, n(r.docs), usd(r.total), usd(r.balance), new Date(r.at).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })]));
  assert.deepEqual(await p.locator(`#${id} [data-order]`).evaluateAll((rs) => rs.map((r) => [r.dataset.order, r.getAttribute('tabindex')])), x.top.map((r) => [r.id, '0']));
  assert.match(await text(p, `#${id} .note >> nth=0`), new RegExp(`Top ${x.top.length} of ${n(x.orders)} orders by open balance`));
}, (d) => openCsv(d.settlement.data[key])];

panelTests(pw, 'payments', [
  ['pMoney', 'Money flow', 'Authorized → captured → invoiced → refunded', async (p, d) => {
    const x = d.money.data, f = flow(d), auth = f[0][1], cap = f[1][1], ref = f[3][1];
    await stats(p, 'pMoney', [['Capture rate', pct(cap / auth)], ['Refund rate', rate(ref, cap)], ['Open invoice balance', usd(x.inv.b)], ['Failed', n(failed(x.pay))]]);
    assert.equal(await text(p, '#pMoney .mini > div:last-child small'), `payments · ${n(failed(x.ref))} refunds · ${n(failed(x.auth))} auths`);
    await bars(p, '#pMoney', f.map(([key, n], i) => ({ key, n, s: ['', `${pct(cap / auth)} of auth`, `${pct(x.inv.a / auth)} of auth`, `${rate(ref, cap)} of capt.`][i] })), { fmt: usd, share: false });
    assert.ok((await text(p, '#pMoney .note')).includes(`Credit memos issued: ${usd(d.tiles.data.refunds.cur)} across ${n(d.tiles.data.refundCount.cur)}.`));
  }, (d) => [['stage', 'amount'], ...flow(d)]],
  outstanding('pUnpaid', 'Shipped, not paid', 'Invoice.Balance on fulfilled orders', 'unpaid', 'Invoice'),
  outstanding('pUnrefunded', 'Refund owed, not created', 'CreditMemo.Balance', 'unrefunded', 'Credit memo'),
]);
