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
// Large-org behaviour: capped results are flagged, slow queries read the same everywhere, and whole-history queries are bounded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from "../../support/source-view.mjs";
import { createCore } from "../../../public/operations-console/data/core.js";
import { fakeOrg, SCHEMA } from "../../support/fake-org.mjs";

const rows = (n) => Array.from({ length: n }, (_, i) => ({ s: `k${i}`, c: 1 }));

test('a panel whose query hit the 2,000-row cap says so', async () => {
  const { core } = fakeOrg({ queries: [[/FROM OrderSummary WHERE OrderedDate = .* GROUP BY Status/, rows(2000)], [/./, []]] });
  const r = await core.route('/api/console?range=30d');
  assert.equal(r.statusBoard.capped, true);
  const small = await fakeOrg({ queries: [[/./, []]] }).core.route('/api/console?range=30d');
  assert.equal(small.statusBoard.capped, undefined);
});

test('a query Salesforce timed out inside /composite reads as "try a shorter range"', async () => {
  const request = async (p, post) => {
    if (p !== '/composite') return { records: [], done: true };
    return { compositeResponse: post.compositeRequest.map((r, i) => i === 0
      ? { referenceId: r.referenceId, httpStatusCode: 400, body: [{ errorCode: 'QUERY_TIMEOUT', message: 'Your query request was running for too long.' }] }
      : { referenceId: r.referenceId, httpStatusCode: 200, body: r.url.includes('/describe') ? { fields: [{ name: 'Id' }, { name: 'Status' }, { name: 'CreatedDate' }] } : { records: [], done: true } }) };
  };
  const core = createCore({ request, instanceUrl: () => 'https://x', apiVersion: () => '62.0' });
  const r = await core.route('/api/console?range=30d');
  const errors = JSON.stringify(r).match(/"error":"[^"]*"/g) || [];
  assert.ok(errors.some((e) => /try a shorter range/.test(e)), errors.join('\n'));
});

test('whole-history queries are bounded to 12 months and filters and sorts use indexed fields', async () => {
  const loc = { Location: [{ name: 'Id' }, { name: 'Name' }, { name: 'LocationType' }, { name: 'Latitude' }, { name: 'Longitude' }] };
  const o = fakeOrg({ schema: loc, objects: [...Object.keys(SCHEMA), 'Location'], queries: [[/./, []]] });
  await o.core.route('/api/console?range=30d');
  const q = o.soql();
  const openFO = q.find((x) => /FROM FulfillmentOrder WHERE .*GROUP BY FulfilledFromLocationId$/.test(x));
  assert.match(openFO, /CreatedDate = LAST_N_DAYS:365/);
  assert.ok(!q.some((x) => /ORDER BY OrderedDate DESC NULLS LAST LIMIT 1/.test(x)), 'latest order sorts by CreatedDate');
  assert.ok(q.some((x) => /FROM OrderSummary .*ORDER BY CreatedDate DESC LIMIT 1/.test(x)));
  // LastModifiedDate isn't indexed; SystemModstamp is, and moves with it.
  assert.ok(!q.some((x) => /WHERE[^]*LastModifiedDate (=|<|>)|ORDER BY LastModifiedDate/.test(x)), q.filter((x) => /LastModifiedDate (=|<|>)|ORDER BY LastModifiedDate/.test(x)).join('\n'));
  assert.ok(q.some((x) => /FROM FulfillmentOrder WHERE CreatedDate = LAST_N_DAYS:365 AND Status IN \('Allocated','Pickpack'\) AND SystemModstamp < /.test(x)));
});

test('open process exceptions are New, Triaged or Paused', async () => {
  const o = fakeOrg({ queries: [[/./, []]] });
  await o.core.route('/api/console?range=30d');
  const pe = o.soql().filter((x) => /FROM ProcessException/.test(x));
  assert.ok(pe.length > 0);
  for (const x of pe) { assert.doesNotMatch(x, /Status != 'Resolved'/); }
  assert.ok(pe.some((x) => /Status IN \('New', 'Triaged', 'Paused'\)/.test(x)));
});

test('the page shows a note on capped panels', () => {
  const html = readFileSync(new URL("../../../public/operations-console/console-map-view.js", import.meta.url), 'utf8');
  assert.match(html, /const perr = \(p\) => [^\n]*p\??\.capped/);
});
