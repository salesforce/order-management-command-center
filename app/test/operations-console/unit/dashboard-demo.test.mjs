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
// Dashboard fixtures must tell the same story in cards, charts and every date range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoDash, demoOrder, demoHistory } from "../../../public/operations-console/console-demo.js";
import { fakeOrg } from "../../support/fake-org.mjs";

const PERIODS = ['today', 'mtd', 'qtd', 'ytd', '6m', '1y', 'all'];
const sum = (rows) => rows.reduce((s, r) => s + r.n, 0);

for (const at of [new Date(2026, 0, 1, 0, 1), new Date(2026, 9, 27, 12)]) {
  test(`Dashboard chart and category totals match their KPIs at ${at.toISOString()}`, (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: +at });
    for (const p of PERIODS) {
      const d = demoDash(p), tiles = d.tiles.data;
      for (const [key, total] of [['ordersSeries', tiles.orders.cur], ['channels', tiles.orders.cur], ['returnsSeries', tiles.returns.cur], ['retStatus', tiles.returns.cur], ['exCategory', tiles.exceptions.cur], ['exStatus', tiles.exceptions.cur], ['foStatus', tiles.fos.cur], ['foMix', tiles.fos.cur]]) {
        assert.equal(sum(d[key].data), total, `${p}: ${key}`);
        assert.ok(d[key].data.every((r) => Number.isInteger(r.n) && r.n >= 0), `${p}: ${key} contains counts`);
      }
      assert.equal(sum(d.speed.data.route.hist), d.speed.data.rows);
      assert.equal(sum(d.speed.data.close.hist), d.speed.data.close.n);
      assert.equal(sum(d.retDays.data.hist), tiles.returns.cur);
    }
  });
}

test('Dashboard calendar and prior-period boundaries match the real read model', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: +new Date(2026, 9, 27, 12) });
  const { core } = fakeOrg({ queries: [[/./, []]] });
  for (const p of PERIODS) {
    const expected = await core.route(`/api/dashboard?period=${p}`), sample = demoDash(p);
    for (const field of ['period', 'grain', 'from', 'to', 'prevFrom', 'prevTo']) assert.equal(sample[field], expected[field], `${p}: ${field}`);
    if (p === 'all') assert.equal(sample.tiles.data.orders.prev, null);
  }
});

test('Dashboard current backlog and open product demand are independent of the period', () => {
  const baseline = demoDash('mtd');
  for (const p of PERIODS) {
    const d = demoDash(p);
    assert.deepEqual(d.speed.data.openAge, baseline.speed.data.openAge, p);
    assert.deepEqual(d.exAge.data, baseline.exAge.data, p);
    assert.deepEqual(d.prodDemand, baseline.prodDemand, p);
    assert.equal(d.prodDemand.data.units, sum(d.prodDemand.data.list));
  }
  assert.ok(demoDash('today').tiles.data.orders.cur < demoDash('ytd').tiles.data.orders.cur);
});

test('an unknown Dashboard period falls back to MTD', () => {
  assert.equal(demoDash('unknown').period, 'mtd');
  assert.equal(demoDash().period, 'mtd');
});

test('Dashboard settlement links open the same sample order and history', () => {
  for (const p of PERIODS) {
    const settlement = demoDash(p).settlement.data;
    const rows = [...settlement.unpaid.top, ...settlement.unrefunded.top];
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
    for (const r of rows) {
      const order = demoOrder(r.id).order, history = demoHistory(r.id).order;
      assert.equal(order.Id, r.id);
      assert.equal(order.OrderNumber, r.number);
      assert.equal(order.Status, r.status);
      assert.equal(history.Id, r.id);
      assert.equal(history.OrderNumber, r.number);
    }
  }
});
