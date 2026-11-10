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
/*
 * Console sample data follows the range
 *
 * Purpose
 *   The Console's sample data (?demo=1) has to react to the range buttons, as the page does against an org: otherwise a demo can't
 *   show that picking 7 days changes anything. This is the data's own rulebook; the UI test (operations-console/ui/operation-console/kpis-range.test.mjs)
 *   checks the page shows it. The 90-day figures are the ones the sample data was written for.
 *
 * Steps
 *   Each test calls demoData(range) for today, 7d, 30d, 90d, 6m and 1y (and an unknown range) and inspects the payload.
 *
 * Assertions
 *   - 90d KPIs are exactly { orders 312, value 58210, openExceptions 26, waiting 9, stuck 4, paymentHolds 3, returns 19, returnValue 1748 }.
 *   - Orders and value grow with every longer range; open exceptions and returns never shrink.
 *   - Waiting (9) and Stuck (4) are the same in every range.
 *   - Every part adds up in every range: the order board = Orders, exceptions by state = Open exceptions, holds <= exceptions,
 *     and no demand or exception state has a count of 0.
 *   - An unknown range is read as 90 days.
 *   - The lists follow the range: one exception per open exception, the stream = min(50, orders), return orders = min(50,
 *     returns), no stream tab above 50, and every exception points at an order the page can open.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoData } from "../../../public/operations-console/console-demo.js";

const RANGES = ['today', '7d', '30d', '90d', '6m', '1y'];
const sum = (rows) => rows.reduce((a, x) => a + x.n, 0);
const at = (r) => demoData(r);

test('the 90-day sample data is the one the page was written for', () => {
  assert.deepEqual(at('90d').kpis.data, { orders: 312, value: 58210, openExceptions: 26, waiting: 9, stuck: 4, paymentHolds: 3, returns: 19, returnValue: 1748 });
});

test('orders and money grow with the range', () => {
  const k = RANGES.map((r) => at(r).kpis.data);
  for (let i = 1; i < k.length; i++) {
    assert.ok(k[i].orders > k[i - 1].orders, `${RANGES[i]} has more orders than ${RANGES[i - 1]}`);
    assert.ok(k[i].value > k[i - 1].value, `${RANGES[i]} has more value than ${RANGES[i - 1]}`);
    assert.ok(k[i].openExceptions >= k[i - 1].openExceptions, `${RANGES[i]} has no fewer open exceptions`);
    assert.ok(k[i].returns >= k[i - 1].returns, `${RANGES[i]} has no fewer returns`);
  }
});

test('what is open now does not depend on the range', () => {
  for (const r of RANGES) assert.deepEqual([at(r).kpis.data.waiting, at(r).kpis.data.stuck], [9, 4], r);
});

test('every part adds up to the figure it belongs to, in every range', () => {
  for (const r of RANGES) {
    const d = at(r), kpi = d.kpis.data;
    assert.equal(sum(d.statusBoard.data.orders), kpi.orders, `${r}: order board`);
    assert.equal(sum(d.exByState.data), kpi.openExceptions, `${r}: exceptions by state`);
    assert.ok(kpi.paymentHolds <= kpi.openExceptions, `${r}: holds are exceptions`);
    assert.ok(d.demand.data.every((x) => x.n > 0), `${r}: no empty demand state`);
    assert.ok(d.exByState.data.every((x) => x.n > 0), `${r}: no empty exception state`);
  }
});

test('an unknown range is read as 90 days', () => {
  assert.deepEqual(at('nope').kpis.data, at('90d').kpis.data);
});

test('the lists follow the range too: exceptions, the stream and its tabs', () => {
  for (const r of RANGES) {
    const d = at(r), k = d.kpis.data;
    assert.equal(d.exceptions.data.length, k.openExceptions, `${r}: one exception per open exception`);
    assert.equal(d.stream.data.length, Math.min(50, k.orders), `${r}: the stream lists the range's orders, 50 at most`);
    assert.equal(d.roStream.data.length, Math.min(50, k.returns), `${r}: one return order per return`);
    for (const list of [d.stream, d.foStream, d.shStream, d.caseStream, d.roStream]) assert.ok(list.data.length <= 50, `${r}: a tab holds 50 at most`);
    // Every exception names an order the page can open.
    const ids = new Set(d.orderPool.map((o) => o.Id));
    assert.ok(d.exceptions.data.every((e) => ids.has(e.OrderSummaryId)), `${r}: exceptions point at known orders`);
  }
});
