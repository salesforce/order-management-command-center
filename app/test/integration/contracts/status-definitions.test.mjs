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
// "Open" is defined once, in om-reads.js: the console, the dashboard and the reads count the same fulfillment orders and exceptions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from "../../support/source-view.mjs";
import { fakeOrg, SCHEMA } from "../../support/fake-org.mjs";
import { READS, buildQuery, OPEN_PE, CLOSED_PE, PE_OPEN, OPEN_FO, FO_DONE, FO_ENDED, FO_FULFILLED, FO_SHIPPED, NOT_CANCELED } from "../../../public/shared/data/om-reads.js";

const LOC = { Location: [{ name: 'Id' }, { name: 'Name' }, { name: 'LocationType' }, { name: 'Latitude' }, { name: 'Longitude' }] };
const run = async (route, queries = [[/./, []]]) => {
  const o = fakeOrg({ schema: LOC, objects: [...Object.keys(SCHEMA), 'Location'], queries });
  const r = await o.core.route(route);
  return { r, soql: o.soql() };
};

test('the shared definitions keep their text', () => {
  assert.equal(OPEN_PE, "Status IN ('New', 'Triaged', 'Paused')");
  assert.equal(CLOSED_PE, "Status NOT IN ('New', 'Triaged', 'Paused')");
  assert.deepEqual(PE_OPEN, ['New', 'Triaged', 'Paused']);
  // OM Service Console's order and return filters.
  assert.equal(NOT_CANCELED, "Status NOT IN ('Canceled', 'Cancelled')");
  assert.deepEqual(FO_FULFILLED, ['Fulfilled', 'Picked Up']);
  assert.equal(FO_SHIPPED, "('Fulfilled', 'Picked Up')");
  // Rejected, closed and picked-up fulfillment orders are done.
  assert.deepEqual(FO_ENDED, ['Fulfilled', 'Picked Up', 'Cancelled', 'Rejected', 'Closed']);
  assert.equal(FO_DONE, "('Fulfilled', 'Picked Up', 'Cancelled', 'Rejected', 'Closed')");
  assert.equal(OPEN_FO, `Status NOT IN ${FO_DONE}`);
});

test('the stuck KPI counts only open statuses', async () => {
  const { soql } = await run('/api/console?range=30d');
  const stuck = soql.find((x) => /FROM FulfillmentOrder WHERE .*Status IN \('Allocated','Pickpack'\)/.test(x));
  assert.ok(stuck);
  for (const s of ['Allocated', 'Pickpack']) assert.ok(!FO_ENDED.includes(s), s);
});

test('the console map, open demand and open age all use the shared fulfillment definition', async () => {
  const con = await run('/api/console?range=30d');
  const map = con.soql.find((x) => /FROM FulfillmentOrder WHERE .*GROUP BY FulfilledFromLocationId$/.test(x));
  assert.ok(map.includes(`AND ${OPEN_FO} GROUP BY`), map);
  const dash = await run('/api/dashboard?period=month');
  const foStatus = [...con.soql, ...dash.soql].filter((x) => /FulfillmentOrder(Line| WHERE)|FROM FulfillmentOrder/.test(x) && /Status NOT IN/.test(x) && !/Status NOT IN \('Canceled'/.test(x));
  assert.ok(foStatus.length >= 2, foStatus.join('\n'));
  for (const x of foStatus) assert.ok(x.includes(FO_DONE), x);
  assert.ok(dash.soql.some((x) => /^SELECT COUNT\(Id\) c FROM FulfillmentOrder WHERE /.test(x) && x.includes(OPEN_FO)), 'open fulfillment order age');
  for (const x of [...con.soql, ...dash.soql]) assert.doesNotMatch(x, /NOT IN \('Fulfilled',\s*'Cancelled'\)|NOT IN \('Fulfilled','Cancelled','Rejected'/, x);
});

test('every open exception filter is the shared one', async () => {
  const con = await run('/api/console?range=30d');
  const dash = await run('/api/dashboard?period=month');
  const pe = [...con.soql, ...dash.soql].filter((x) => /FROM ProcessException/.test(x) && /'Paused'/.test(x));
  assert.ok(pe.length >= 3);
  for (const x of pe) assert.ok(x.includes(OPEN_PE), x);
  assert.ok(dash.soql.some((x) => /^SELECT COUNT\(Id\) c FROM ProcessException WHERE /.test(x) && x.includes(OPEN_PE)), 'open exception age');
});

test('the scorecard counts picked-up orders as fulfilled and keeps closed ones out of its columns', async () => {
  const rows = ['Fulfilled', 'Picked Up', 'Rejected', 'Cancelled', 'Closed', 'Allocated', 'Pickpack'].map((st) => ({ s: 'Reno', t: 'Warehouse', st, c: 1 }));
  const { r } = await run('/api/dashboard?period=month', [[/GROUP BY FulfilledFromLocation\.Name, FulfilledFromLocation\.LocationType, Status/, rows], [/./, []]]);
  const reno = r.locations.data.find((x) => x.name === 'Reno' || x.key === 'Reno') || r.locations.data[0];
  assert.deepEqual({ total: reno.total, fulfilled: reno.fulfilled, rejected: reno.rejected, cancelled: reno.cancelled, open: reno.open }, { total: 7, fulfilled: 2, rejected: 1, cancelled: 1, open: 2 });
});

test('no read spells out its own fulfillment order status list', () => {
  const known = [OPEN_FO, FO_DONE, `Status IN ${FO_SHIPPED}`, OPEN_PE, CLOSED_PE, NOT_CANCELED];
  for (const name of Object.keys(READS)) for (const q of READS[name].queries.filter((x) => !x.api)) {
    const { soql } = buildQuery({ ...q, _params: READS[name].params }, { params: {}, preview: true });
    for (const m of soql.matchAll(/Status (?:NOT )?IN \([^)]*\)/g)) {
      if (/Status IN \('(Allocated|Pickpack)'/.test(m[0])) continue;
      assert.ok(known.some((k) => k.includes(m[0])), `${name}.${q.as}: ${m[0]}`);
    }
  }
});

test('the read model (the console core, its read areas and the shared order and customer reads) holds no status list of its own for open', () => {
  const dir = new URL("../../../public/", import.meta.url), files = readdirSync(dir).filter((f) => /^om-(?:core|command-core|command-reads|queue-reads|order-reads|customer-reads|display-facts)(-[\w-]+)?\.js$/.test(f));
  for (const f of ['om-command-core.js', 'om-command-reads.js', 'om-queue-reads.js', 'om-order-reads.js', 'om-customer-reads.js', 'om-display-facts.js', 'om-core-dashboard.js', 'om-core-org.js', 'om-core-util.js']) assert.ok(files.includes(f), `${f} in ${files.join()}`);
  const src = files.map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  for (const lit of ["'Fulfilled','Cancelled'", "('Fulfilled','Cancelled','Rejected'", "Status IN ('New','Triaged','Paused')", "const NOT_CANCELED =", 'const FO_DONE ='])
    assert.ok(!src.includes(lit), lit);
});
