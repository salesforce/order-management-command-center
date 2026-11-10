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
/* Reference: ranked usage, access/jobs, every typed value, search, complete CSV, escaping, and partial/unavailable reads. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { limitsTest, text, rows, reference, table, csv, apply } from "./limits-kit.mjs";
const pw = await loadPlaywright();

limitsTest(pw, 'closest-to-limit ranking keeps all ten labels values groups and bar proportions', async ({ page, step, data }) => {
  await step(() => reference(page));
  const expected = rows(data).filter((r) => r.f != null).sort((a, b) => b.f - a.f).slice(0, 10);
  const got = await page.locator('#lTop .ltr').evaluateAll((es) => es.map((e) => ({ name: e.querySelector('.n').textContent, group: e.querySelector('.n').title, percent: e.querySelector('.val').textContent, width: parseFloat(e.querySelector('.bar i').style.width), level: [...e.classList].find((s) => s.startsWith('lv-')) })));
  assert.deepEqual(got, expected.map((r) => ({ name: r.name, group: r.group, percent: `${Math.round(r.f * 100)}%`, width: +Math.min(100, r.f * 100).toFixed(1), level: `lv-${r.level}` })));
});

limitsTest(pw, 'access checks and async jobs show all readable categories', async ({ page, step, data }) => {
  await step(() => reference(page));
  assert.deepEqual(await page.locator('#lAccess .lacc').allTextContents(), data.access.map((r) => `✓ ${r.name} readable`));
  assert.match(await text(page, '#lAccess'), /Read-only checks: nothing here changes data/);
  assert.equal(await text(page, '#lJobs'), 'Async Apex today: 7 completed Queueable, 1 failed Queueable');
});

limitsTest(pw, 'reference table formats every row and search matches names and types', async ({ page, step, data }) => {
  await step(() => reference(page));
  const expected = rows(data);
  await table(page, expected);
  const search = page.locator('#lSearch');
  for (const query of ['sToRaGe', 'User licence', 'zz-no-match']) {
    await step(() => search.fill(query));
    const filtered = expected.filter((r) => `${r.name} ${r.group}`.toLowerCase().includes(query.toLowerCase()));
    await table(page, filtered);
    if (!filtered.length) assert.match(await text(page, '#lAll'), /Nothing matches/);
  }
  await search.fill('');
  await table(page, expected);
});

limitsTest(pw, 'CSV exports every limit even when search hides most rows', async ({ page, step, data }) => {
  await step(() => reference(page));
  await page.locator('#lSearch').fill('File storage');
  assert.equal(await page.locator('#lAll tbody tr').count(), 1);
  await csv(page, rows(data));
});

limitsTest(pw, 'CSV safely preserves quoted names unknown usage and formula-like values', async ({ page, data }) => {
  const d = structuredClone(data);
  d.entitlements.data.push({ MasterLabel: '=SUM(1,2)', CurrentAmountAllowed: 100, AmountUsed: null });
  d.licenses.data.user.push({ Name: 'A "quoted", licence\nname', TotalLicenses: 1, UsedLicenses: 1 });
  await apply(page, { data: d });
  await reference(page); await table(page, rows(d));
  await csv(page, rows(d));
});

limitsTest(pw, 'blocked empty and unknown readings stay explicit while other reference rows work', async ({ page, data }) => {
  const d = structuredClone(data);
  d.entitlements = { ok: false, error: 'Not permitted' }; d.jobs = { ok: false, error: 'No access' };
  d.access = [{ name: 'Org limits', state: 'ok', note: '' }, { name: 'Entitlements', state: 'blocked', note: 'Denied <img src=x>' }, { name: 'User licences', state: 'empty', note: '' }];
  await apply(page, { data: d }); await reference(page);
  assert.match(await text(page, '#lAll'), /Entitlement rows are missing: Denied <img src=x>/);
  assert.match(await text(page, '#lAccess'), /readable, no rows/);
  assert.equal(await page.locator('#lAccess img, #lAll img').count(), 0);
  await table(page, rows(d));
  assert.equal(await text(page, '#lJobs'), '');
  d.org = { ok: false, error: 'Org request denied <script>' }; d.licenses = { ok: true, data: {} }; d.access = [{ name: 'Entitlements', state: 'empty', note: '' }];
  await apply(page, { data: d });
  assert.equal(await text(page, '#lAlerts .perr'), 'Org limits unavailable: Org request denied <script>');
  assert.match(await text(page, '#lAll'), /this org has none/);
  assert.equal(await page.locator('#lGauges .lg').count(), 0);
  assert.equal(await text(page, '#lTop'), 'No limits reported.');
  assert.doesNotMatch(await text(page, '#limits'), /NaN|Infinity|undefined/);
  await csv(page, []);
});
