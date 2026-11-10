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
/* Service: exception categories/statuses, fixed backlog and resolution, case types/origins/statuses, CSVs and periods. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { panelTests, n, pct, hours, stats, bars, stack, kv, sum, text } from "./dashboard-kit.mjs";
const pw = await loadPlaywright();

panelTests(pw, 'service', [
  ['pExCat', 'Exceptions by category', 'ProcessException.Category', async (p, d) => {
    await bars(p, '#pExCat', d.exCategory.data);
    await stack(p, '#pExCat', d.exStatus.data);
    assert.equal(sum(d.exCategory.data), d.tiles.data.exceptions.cur);
    assert.equal(sum(d.exStatus.data), d.tiles.data.exceptions.cur);
  }, (d) => kv(d.exCategory.data)],
  ['pExAge', 'Exception age & resolution', 'ProcessException', async (p, d) => {
    const x = d.exResolve.data;
    await stats(p, 'pExAge', [['Open now', n(sum(d.exAge.data))], ['Time to resolve', hours(x.p50)]]);
    await bars(p, '#pExAge > .hb >> nth=0', d.exAge.data);
    await bars(p, '#pExAge > .hb >> nth=1', x.byCategory.map((r) => ({ ...r, s: 'done' })), { fmt: hours, share: false });
    assert.equal(await text(p, '#pExAge h3'), `Time to resolve by category ${n(x.n)} resolved`);
    assert.match(await text(p, '#pExAge .note'), /snapshot of today/);
  }, (d) => [['kind', 'name', 'value'], ...d.exAge.data.map((r) => ['open age', r.key, r.n]), ...d.exResolve.data.byCategory.map((r) => ['resolve p50 hours', r.key, r.n.toFixed(2)])]],
  ['pCases', 'Customer service', 'Case', async (p, d) => {
    const x = d.cases.data;
    await stats(p, 'pCases', [['Cases created', n(x.count.cur)], ['Time to close', hours(x.close.p50)]]);
    await stack(p, '#pCases .sb > div:first-child', x.origin);
    await stack(p, '#pCases .sb > div:last-child', x.status);
    await bars(p, '#pCases', x.type.map((r) => ({ ...r, key: r.key === '(blank)' ? '(no type)' : r.key })));
    const blank = x.type.find((r) => r.key === '(blank)')?.n || 0;
    assert.ok((await text(p, '#pCases .note')).startsWith(`${pct(blank / x.count.cur)} of cases have no Type`));
  }, (d) => [['kind', 'name', 'cases'], ...['type', 'status', 'origin'].flatMap((k) => d.cases.data[k].map((r) => [k, r.key, r.n]))]],
]);
