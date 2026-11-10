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
// Real Limits view, real meter and shared browser sessions. Freeze time before navigation; advance it explicitly in live
// cases. The test-only module wrapper captures the view's existing public factory result, so no application test hooks or
// org access are needed. Expectations use raw payloads and known input calls, never the rendered DOM or aggregate snapshot.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from "../../../support/source-promises.mjs";
import { UI, T0, WIDE, openSession, until } from "../../../../tools/browser-kit.mjs";
import { limRows } from "../../../../public/operations-console/console-limits.js";
import { csvText } from "../../../../public/operations-console/console-csv.js";

export const NOW = T0 + 1000;
export const n = (v) => Number(v).toLocaleString('en-US');
export const text = async (page, selector) => (await page.locator(selector).textContent()).replace(/\s+/g, ' ').trim();
export const amount = (v, unit = '') => unit === 'licences' ? `${n(Math.round(v))} ${Math.round(v) === 1 ? 'licence' : 'licences'}` : unit === 'MB' && Math.abs(v) >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${n(Math.round(v))}${unit ? ' ' + unit : ''}`;
export const rows = limRows; // the payload adapter is covered independently in limits-view.test.mjs
export const calls = (now = NOW) => [
  { t: now - 100000, kind: 'apex', source: 'console', path: '/services/apexrest/somconsole/query', ms: 100, status: 200, apex: { rows: 10000, rowsMax: 50000 } },
  { t: now - 65000, kind: 'graphql', source: 'dashboard', path: '/services/data/v68.0/graphql', object: 'OrderSummary', rows: 30, ms: 5000, status: 200 },
  { t: now - 50000, kind: 'batch', source: 'dashboard', path: '/services/apexrest/somconsole/batch', ms: 200, status: 200, apex: { rows: 30000, rowsMax: 50000 } },
  { t: now - 40000, kind: 'ui-api', source: 'service', path: '/services/data/v68.0/ui-api/records', rows: 2, ms: 60, status: 200 },
  { t: now - 30000, kind: 'connect', source: 'console', path: '/services/data/v68.0/commerce/webstores', rows: 4, ms: 150, status: 404 },
  { t: now - 20000, kind: 'action', source: 'service', path: '/services/apexrest/somservice/action', ms: 1500, status: 500, apex: { rows: 46000, rowsMax: 50000 } },
  { t: now - 10000, kind: 'graphql', source: 'dashboard', path: '/services/data/v68.0/graphql', rows: 18, ms: 300, status: 200 },
  { t: now - 1000, kind: 'apex', source: 'limits', path: '/services/apexrest/somconsole/query?q=SELECT+Id+FROM+Account+WHERE+Name%3D%27PrivateName%27', object: 'Account', ms: 90, status: 200, apex: { rows: 100, rowsMax: 50000 } },
];
export const rawData = (page) => page.evaluate(() => structuredClone(globalThis.__limitsUI.lim.d));
export async function apply(page, { data, entries = calls(), rest = [{ t: NOW - 15000, n: 3 }, { t: NOW - 120000, n: 2 }], samples = [{ t: NOW - 120000, used: 100 }, { t: NOW, used: 124 }], resetLevels = true } = {}) {
  const payload = data ?? await rawData(page);
  await page.evaluate(async ({ payload, entries, rest, samples, resetLevels }) => {
    const v = globalThis.__limitsUI, m = await v.meterInit();
    m.reset(); v.lim.recent = []; v.lim.samples = []; v.lim.rest = []; v.lim.api = null;
    v.lim.snap = null; v.lim.seenRows.clear(); v.lim.demoNext = Number.MAX_SAFE_INTEGER;
    if (resetLevels) { v.lim.levels = {}; v.lim.fresh.clear(); }
    entries.forEach((e) => v.meterRecord(e));
    v.lim.samples = samples; v.lim.rest = rest;
    v.limApply(payload);
  }, { payload, entries, rest, samples, resetLevels });
  return payload;
}

export function limitsTest(pw, name, run, { fixture = true, path = '/?demo=1#limits', viewport = WIDE, motion = 'reduce', meter = true, ...options } = {}) {
  test(`Limits: ${name}`, { skip: UI.skip(pw), timeout: 25000 }, async () => {
    const s = await openSession(pw, `limits-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`, { path, viewport, ...options, setup: async (page) => {
      await page.clock.install({ time: T0 });
      await page.clock.pauseAt(NOW);
      await page.emulateMedia({ reducedMotion: motion });
      if (!meter) await page.route(/\/om-meter\.js(?:\?.*)?$/, (route) => route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("Meter fixture unavailable");' }));
      await page.route(/\/console-limits-view\.js(?:\?.*)?$/, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()) + `
const originalLimitsView = createLimitsView;
createLimitsView = (page) => {
  const v = originalLimitsView(page), load = v.limLoad;
  globalThis.__limitsUI = v; globalThis.__limitsLoads = 0;
  v.limLoad = async () => { globalThis.__limitsLoads++; if (globalThis.__failLimits) throw new Error('Limits fixture unavailable'); return load(); };
  return v;
};` });
      });
    } });
    try {
      s.page.setDefaultTimeout(5000);
      assert.ok(await until(s.page, '#limits:not(.hide) #lAll table', 15000), 'Limits loaded');
      const d = fixture ? await apply(s.page) : await rawData(s.page);
      await run({ ...s, data: d });
      assert.deepEqual(s.problems, [], 'no page errors, API calls or writes');
    } finally { await s.close(); }
  });
}

export async function reference(page) {
  const summary = page.locator('#lRef > summary');
  if (await page.locator('#lRef').getAttribute('open') === null) await summary.click();
}
export async function csv(page, expected) {
  await reference(page);
  const pending = page.waitForEvent('download');
  await page.locator('#lCsv').click();
  const download = await pending;
  try {
    assert.equal(download.suggestedFilename(), 'om-limits.csv');
    assert.equal(await readFile(await download.path(), 'utf8'), csvText([['type', 'name', 'used', 'limit', 'percent'], ...expected.map((r) => [r.group, r.name, r.used, r.max, r.f == null ? '' : Math.round(r.f * 100)])]));
  } finally { await download.delete(); }
}
export async function table(page, expected) {
  assert.deepEqual(await page.locator('#lAll th').allTextContents(), ['Type', 'Name', 'Used', 'Limit', '%']);
  const got = await page.locator('#lAll tbody tr:not(:has([colspan]))').evaluateAll((rs) => rs.map((r) => [...r.cells].map((c) => c.textContent.trim())));
  assert.deepEqual(got, expected.map((r) => [r.group, r.name, r.used == null ? '—' : amount(r.used, r.unit), amount(r.max, r.unit), r.f == null ? '—' : `${Math.round(r.f * 100)}%`]));
}
