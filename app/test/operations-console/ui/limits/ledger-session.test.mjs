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
/* Ledger/session: every request, pinned heaviest/slowest, errors, row-cap bars, percentiles, kind shares, empty data and updates. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { limitsTest, text, apply, calls, n, NOW } from "./limits-kit.mjs";
const pw = await loadPlaywright();
const short = (e) => e.path.split('?')[0].replace(/^\/services\/(?:apexrest|data\/v[\d.]+)/, '') + (e.object ? ` · ${e.object}` : '');

limitsTest(pw, 'ledger shows ordered requests pinned extremes failures and cap bars', async ({ page, step }) => {
  await step(() => page.locator('#lLedger').scrollIntoViewIfNeeded());
  const es = calls(), expected = [[es[5], 'Heaviest'], [es[1], 'Slowest'], ...[...es].reverse().map((e) => [e, ''])];
  const got = await page.locator('#lLedger .lr').evaluateAll((rs) => rs.map((r) => ({ cells: ['.kp', '.ls', '.lpth', '.lms', '.lrw'].map((s) => r.querySelector(s).textContent.trim()), bad: r.classList.contains('bad'), width: r.querySelector('.mbar i')?.style.width || '', tone: r.querySelector('.mbar i')?.className ?? null })));
  assert.deepEqual(got, expected.map(([e, tag]) => {
    const rows = e.apex?.rows, f = Math.min(1, (rows || 0) / 50000);
    return { cells: [e.kind, e.source, `${tag ? tag + ' ' : ''}${short(e)}`, `${n(e.ms)} ms`, rows != null ? n(rows) : e.rows != null ? n(e.rows) : ''], bad: e.status >= 400 || e.status === 0, width: rows != null ? `${Math.max(2, f * 100).toFixed(0)}%` : '', tone: rows == null ? null : f >= .9 ? 'red' : f >= .6 ? 'amber' : 'ok' };
  }));
  assert.equal(await page.locator('#lLedger [tabindex], #lLedger button, #lLedger a').count(), 0, 'request metadata does not open records');
  assert.doesNotMatch(await text(page, '#lLedger'), /PrivateName|SELECT|WHERE|\?q=/, 'query strings and record data never appear');
});

limitsTest(pw, 'session cards show counts latency errors peak rows and GraphQL Apex shares', async ({ page, step }) => {
  await step(() => page.locator('#lStats').scrollIntoViewIfNeeded());
  const got = await page.locator('#lStats .lst').evaluateAll((es) => es.map((e) => ['.l', '.v', '.s'].map((s) => e.querySelector(s).textContent)));
  assert.deepEqual(got, [['Console calls', '8', 'last hour, all tabs'], ['Latency', '150 / 5,000 ms', 'p50 / p95'], ['Errors', '2', '25% of calls'], ['Peak Apex rows', '46,000', 'of 50,000 per transaction']]);
  assert.ok(await page.locator('#lStats .lst').nth(2).evaluate((e) => e.classList.contains('bad')));
  assert.ok(await page.locator('#lStats .lst').nth(3).evaluate((e) => e.classList.contains('red')));
  assert.deepEqual(await page.locator('#lStats .mixbar i').evaluateAll((es) => es.map((e) => e.style.width)), ['25%', '50%']);
  assert.match(await text(page, '#lStats .lmix'), /GraphQL 2 Apex 4 other 2/);
});

limitsTest(pw, 'new failed call updates ledger and session and large ledgers cap at thirty recent calls', async ({ page, step }) => {
  await step(async () => {
    await page.evaluate(() => globalThis.__limitsUI.meterRecord({ t: Date.now(), kind: 'apex', source: 'dashboard', path: '/services/apexrest/somconsole/query', ms: 6000, status: 0, apex: { rows: 70000, rowsMax: 50000 } }));
    await page.clock.runFor(300);
  });
  assert.equal(await page.locator('#lLedger .lr em').count(), 1, 'same slowest and heaviest request is pinned once');
  assert.match(await text(page, '#lLedger .lr >> nth=0'), /Heaviest.*6,000 ms70,000/);
  assert.equal(await page.locator('#lLedger .lr').first().locator('.mbar i').getAttribute('style'), 'width:100%');
  assert.equal(await text(page, '#lStats .lst >> nth=0 >> .v'), '9');
  assert.equal(await text(page, '#lStats .lst >> nth=2 >> .v'), '3');
  const entries = Array.from({ length: 45 }, (_, i) => ({ t: NOW - (i + 1) * 100, kind: 'graphql', source: 'dashboard', path: '/services/data/v68.0/graphql', ms: i + 1, status: 200 }));
  await apply(page, { entries });
  assert.equal(await page.locator('#lLedger .lr:not(:has(em))').count(), 30);
  assert.equal(await text(page, '#lStats .lst >> nth=0 >> .v'), '45', 'session totals are not limited to visible rows');
});

limitsTest(pw, 'empty meter has useful ledger and zero session states', async ({ page }) => {
  await apply(page, { entries: [], samples: [], rest: [] });
  assert.match(await text(page, '#lLedger'), /No calls yet.*Open the Dashboard/);
  assert.deepEqual(await page.locator('#lStats .lst .v').allTextContents(), ['0', '0 / 0 ms', '0', '0']);
  assert.equal(await text(page, '#lStats .lst >> nth=2 >> .s'), 'none yet');
  assert.deepEqual(await page.locator('#lStats .mixbar i').evaluateAll((es) => es.map((e) => e.style.width)), ['0%', '0%']);
  assert.doesNotMatch(await text(page, '#lStats'), /NaN|Infinity/);
});
