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
/* Fulfillment: two speed charts, fixed backlog, all scorecard cells, statuses, groups, carriers, CSVs and period changes. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { panelTests, n, pct, rate, hours, stats, bars, table, chart, stack, kv, sum, text } from "./dashboard-kit.mjs";
const pw = await loadPlaywright();

panelTests(pw, 'fulfillment', [
  ['pSpeed', 'Fulfillment speed', 'FulfillmentOrder.CreatedDate · ClosedDate', async (p, d) => {
    const x = d.speed.data;
    await stats(p, 'pSpeed', [['Order → routed', hours(x.route.p50)], ['Routed → closed', hours(x.close.p50)], ['FOs measured', n(x.rows)], ['With a close date', n(x.close.n)]]);
    assert.deepEqual(await p.locator('#pSpeed .mini small').allTextContents(), [`typical · p90 ${hours(x.route.p90)}`, `typical · p90 ${hours(x.close.p90)}`, x.capped ? 'newest 2,000 in period' : 'created in period', `${pct(x.close.n / x.rows)} of FOs`]);
    await chart(p, '#cSpR', x.route.hist, 'Fulfillment orders');
    await chart(p, '#cSpC', x.close.hist, 'Fulfillment orders');
  }, (d) => [['measure', 'bucket', 'fos'], ...d.speed.data.route.hist.map((r) => ['order→routed', r.key, r.n]), ...d.speed.data.close.hist.map((r) => ['routed→closed', r.key, r.n])]],
  ['pFoAge', 'Open fulfillment backlog', 'FulfillmentOrder · age now', async (p, d) => {
    const rows = d.speed.data.openAge;
    await stats(p, 'pFoAge', [['Open now', n(sum(rows))], ['Older than 30 d', n(sum(rows.slice(4)))]]);
    await bars(p, '#pFoAge', rows);
    assert.match(await text(p, '#pFoAge .note'), /independent of the period/);
  }, (d) => kv(d.speed.data.openAge)],
  ['pLocations', 'Location scorecard', 'FulfillmentOrder by FulfilledFromLocation', async (p, d) => {
    await table(p, 'pLocations', ['Location', 'Type', 'FOs', 'Fulfilled', 'Rejected', 'Cancelled', 'Open', 'Order → routed'], d.locations.data.slice(0, 12).map((r) => [r.name, r.type || '—', n(r.total), ...['fulfilled', 'rejected', 'cancelled', 'open'].map((k) => `${n(r[k])} ${rate(r[k], r.total)}`), hours(d.speed.data.routeByLoc[r.name])]));
    const widths = await p.locator('#pLocations .rt i').evaluateAll((es) => es.map((e) => parseFloat(e.style.width)));
    const expected = d.locations.data.slice(0, 12).flatMap((r) => ['fulfilled', 'rejected', 'cancelled', 'open'].map((k) => Math.max(r[k] ? 3 : 0, r[k] / r.total * 100)));
    widths.forEach((w, i) => assert.ok(Math.abs(w - expected[i]) < .001));
  }, (d) => [['location', 'type', 'fos', 'fulfilled', 'rejected', 'cancelled', 'open', 'route_p50_hours'], ...d.locations.data.map((r) => [r.name, r.type, r.total, r.fulfilled, r.rejected, r.cancelled, r.open, d.speed.data.routeByLoc[r.name]?.toFixed(2)])]],
  ['pFulfill', 'Fulfillment', 'FulfillmentOrder', async (p, d) => {
    await stack(p, '#pFulfill', d.foStatus.data);
    await bars(p, '#pFulfill', d.foMix.data);
    assert.equal(sum(d.foStatus.data), d.tiles.data.fos.cur);
    assert.equal(sum(d.foMix.data), d.tiles.data.fos.cur);
  }, (d) => kv([...d.foStatus.data.map((r) => ({ ...r, key: 'status: ' + r.key })), ...d.foMix.data.map((r) => ({ ...r, key: 'from: ' + r.key }))])],
  ['pLocGroups', 'Location groups', 'LocationGroupAssignment', async (p, d) => {
    await bars(p, '#pLocGroups', d.locGroups.data.map((r) => ({ ...r, s: `${r.locations} loc` })), { share: false });
    assert.match(await text(p, '#pLocGroups .note'), /more than one group/);
  }, (d) => [['group', 'locations', 'fos'], ...d.locGroups.data.map((r) => [r.key, r.locations, r.n])]],
  ['pCarrier', 'Carrier performance', 'Shipment.Provider', async (p, d) => {
    const x = d.carriers.data;
    await stats(p, 'pCarrier', [['Shipments', n(x.total)], ['On time', pct(sum(x.list, 'onTime') / sum(x.list, 'measured'))], ['Delivered', n(x.withActual)]]);
    await bars(p, '#pCarrier', x.list.map((r) => ({ ...r, s: r.measured ? `${pct(r.onTime / r.measured)} on time` : '' })), { share: false });
    const statuses = {};
    x.list.forEach((r) => Object.entries(r.status).forEach(([k, v]) => statuses[k] = (statuses[k] || 0) + v));
    await stack(p, '#pCarrier', Object.entries(statuses).map(([key, n]) => ({ key, n })));
  }, (d) => [['carrier', 'shipments', 'delivered', 'measured', 'on_time', 'transit_p50_days'], ...d.carriers.data.list.map((r) => [r.key, r.n, r.delivered, r.measured, r.onTime, r.transitP50])]],
]);
