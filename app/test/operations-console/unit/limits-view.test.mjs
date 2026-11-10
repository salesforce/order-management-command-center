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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from "../../support/source-view.mjs";
import { consoleText } from "../../support/console-source.mjs";

// The Limits view's arithmetic (console-limits.js), run here; how the page uses it is read from index.html as text.
const html = readFileSync(new URL("../../../public/operations-console/index.html", import.meta.url), 'utf8');
const src = readFileSync(new URL("../../../public/operations-console/console-limits.js", import.meta.url), 'utf8');
const L = await import("../../../public/operations-console/console-limits.js");
// The view itself (console-limits-view.js), read as text: what it does with the page's mode and Live (page.mode(), page.live()).
const view = readFileSync(new URL("../../../public/operations-console/console-limits-view.js", import.meta.url), 'utf8');

test('the arithmetic is its own module and stands alone', () => {
  assert.ok(src.length > 500);
  assert.doesNotMatch(src, /^import /m, 'console-limits.js stands alone');
  for (const n of ['limFrac', 'limLevel', 'limCross', 'limProject', 'odoDigits', 'limBar', 'limRows', 'limGauges', 'limPoint', 'limBins']) assert.ok(L[n], n);
});

test('fractions and levels: 80% warns, 100% is over', () => {
  assert.equal(L.limFrac(50, 100), 0.5);
  assert.equal(L.limFrac(5, 0), null);
  assert.equal(L.limFrac(null, 10), null);
  assert.deepEqual([0, 0.79, 0.8, 0.999, 1, 2.47].map(L.limLevel), ['ok', 'ok', 'warn', 'warn', 'over', 'over']);
  assert.equal(L.limLevel(null), 'none');
});

test('a crossing is a level that got worse while the page was watching', () => {
  const prev = { api: 'ok', disk: 'warn', files: 'over' };
  const next = { api: 'warn', disk: 'over', files: 'over', fresh: 'over' };
  assert.deepEqual(L.limCross(prev, next), [{ key: 'api', level: 'warn' }, { key: 'disk', level: 'over' }]); // 'fresh' was there from the start; 'files' didn't change
  assert.deepEqual(L.limCross({ a: 'over' }, { a: 'ok' }), []); // getting better is not an alert
});

test('run-rate projection: today so far plus the rate for the minutes left until local midnight', () => {
  const noon = new Date(2026, 9, 15, 12, 0, 0);
  const p = L.limProject(1000, 10, noon);
  assert.equal(p.minsLeft, 720);
  assert.equal(p.eod, 1000 + 10 * 720);
  assert.equal(L.limProject(1000, -5, noon).eod, 1000); // a falling counter never projects below today's
  assert.equal(L.limProject(1000, 10, new Date(2026, 9, 15, 23, 59, 59, 999)).minsLeft < 0.01, true);
});

test('time to full', () => {
  assert.equal(L.limFullIn(90, 100, 10), 1 / 60); // 10 left at 10 a minute: one minute
  assert.equal(L.limFullIn(90, 100, 0), null);
  assert.equal(L.limFullIn(100, 100, 5), 0);
});

test('odometer digits are grouped with commas', () => {
  assert.deepEqual(L.odoDigits(124), ['1', '2', '4']);
  assert.deepEqual(L.odoDigits(100000), ['1', '0', '0', ',', '0', '0', '0']);
  assert.deepEqual(L.odoDigits(-3.9), ['0']);
  assert.deepEqual(L.odoDigits(null), ['0']);
});

test('the Apex rows micro-bar is amber from 60% and red from 90% of 50,000', () => {
  assert.deepEqual([0, 29999, 30000, 44999, 45000, 80000].map((r) => L.limBar(r).cls), ['ok', 'ok', 'amber', 'amber', 'red', 'red']);
  assert.equal(L.limBar(80000).f, 1);
  assert.equal(L.limBar(25000).f, 0.5);
  assert.equal(L.limBar(100, 400).f, 0.25);
});

test('rest of org is the counter growth we did not cause', () => {
  assert.equal(L.limRest(100, 110, 4), 6);
  assert.equal(L.limRest(100, 103, 4), 0); // our calls may not all count, or the counter lags
  assert.equal(L.limRest(500, 20, 3), 0); // a reset at the day boundary
});

test('calls per minute and the trend arrow', () => {
  const now = 1_000_000, es = [{ t: now - 5 }, { t: now - 59_999 }, { t: now - 60_000 }, { t: now + 1 }];
  assert.equal(L.limCalls(es, now), 2);
  assert.deepEqual([[30, 20], [10, 20], [20, 20], [0, 0]].map(([a, b]) => L.limTrend(a, b)), ['▲', '▼', '■', '■']);
});

test('amounts: storage over a gigabyte reads in GB', () => {
  assert.equal(L.limAmt(15636, 'MB'), '15.3 GB');
  assert.equal(L.limAmt(500, 'MB'), '500 MB');
  assert.equal(L.limAmt(1730822), '1,730,822');
});

const D = {
  org: { ok: true, data: { DailyApiRequests: { Max: 100000, Remaining: 99876 }, DataStorageMB: { Max: 10640, Remaining: -15636 }, FileStorageMB: { Max: 2000, Remaining: 1995 }, Idle: { Max: 0, Remaining: 0 } } },
  entitlements: { ok: true, data: [{ MasterLabel: 'Lightning Order Management Order Summary Entitlements', Setting: 'setting/force.com/orgValue.LOMOrderSummaryTotal', CurrentAmountAllowed: 20000, AmountUsed: null },
    { MasterLabel: 'API Request Limit per Month', CurrentAmountAllowed: 3000000, AmountUsed: 12 }] },
  licenses: { ok: true, data: { user: [{ Name: 'Salesforce', TotalLicenses: 10, UsedLicenses: 11 }], permissionSet: [{ MasterLabel: 'Operations Console', TotalLicenses: 20, UsedLicenses: 0 }] } },
  orderSummary: { ok: true, data: { count: 1730822 } },
};

test('rows: org limits, entitlements and licences with levels; the order entitlement is counted from OrderSummary', () => {
  const rows = L.limRows(D), by = (k) => rows.find((r) => r.key === k);
  assert.equal(by('DailyApiRequests').used, 124);
  assert.equal(by('DataStorageMB').level, 'over');
  assert.equal(Math.round(by('DataStorageMB').f * 100), 247);
  assert.equal(by('Idle'), undefined); // a zero ceiling has nothing to measure
  const lom = rows.find((r) => /Order Summary/.test(r.name));
  assert.equal(lom.used, 1730822); assert.equal(lom.level, 'over');
  assert.equal(rows.find((r) => r.name === 'API Request Limit per Month').used, 12);
  assert.equal(rows.find((r) => r.key === 'ul:Salesforce').level, 'over');
  assert.equal(L.limRows(null).length, 0);
});

test('gauges: the five that matter, in order, skipping any the org does not report', () => {
  assert.deepEqual(L.limGauges(D).map((g) => g.name), ['Daily API requests', 'Data storage', 'File storage', 'Lightning Order Management Order Summary Entitlements']);
});

test('a request travels from its source, through its gateway, into the org', () => {
  const [x0, y0] = L.limPoint(1, 0, 1, 0), [x1, y1] = L.limPoint(1, 0, 1, 1);
  assert.deepEqual([x0, y0], [150, L.limRows ? 110 : 0]);
  assert.deepEqual([x1, y1], [570, 190]);
  const [gx, gy] = L.limPoint(2, 1, 0, 0.5);
  assert.deepEqual([gx, gy], [360, 140]); // mid-gateway
  assert.deepEqual([[0, 'apex'], [1, 'graphql'], [2, 'ui-api'], [2, 'connect'], [0, 'batch'], [0, 'action']].map(([, k]) => L.limGate(k)), [0, 1, 2, 2, 0, 0]);
});

test('chart bins: 90 bins of 10 s ending at the next 10 s mark, own and rest stacked separately', () => {
  const now = 1_000_005_000, { start, end, bins } = L.limBins(
    [{ t: now - 1000, n: 2 }, { t: now - 2000, n: 1 }, { t: now - 20 * 60000, n: 9 }], [{ t: now - 500, n: 4 }, { t: now + 60000, n: 7 }], now);
  assert.equal(bins.length, 90);
  assert.equal(end - start, 900000);
  assert.equal(end % 10000, 0);
  assert.equal(bins.reduce((s, b) => s + b.own, 0), 3); // the 20-minute-old second is off the chart
  assert.equal(bins.reduce((s, b) => s + b.rest, 0), 4); // so is the future one
  assert.equal(bins[89].rest, 4);
});

test('nice axis maximums', () => {
  assert.deepEqual([0, 3, 7, 12, 41, 130].map(L.limNice), [1, 5, 10, 20, 50, 200]);
});

test('wiring: four modes, #limits and ?mode=limits open the view, V cycles through it, Live stays off until chosen', () => {
  const html = consoleText; // the page and the console's views
  assert.match(html, /const MODES = \['console', 'dashboard', 'service', 'limits'\]/);
  assert.match(html, /<button data-m="limits">Limits<\/button>/);
  assert.match(html, /id="limits"/);
  assert.match(html, /get\('mode'\) === 'limits'/);
  assert.match(html, /h === '#limits'/);
  assert.match(html, /m === 'limits' \? '#limits'/);
  assert.match(html, /MODES\[\(MODES\.indexOf\(S\.mode\) \+ 1\) % MODES\.length\]/);
  assert.match(html, /if \(S\.mode === 'limits'\) limEnter\(\); else limLeave\(\)/);
  assert.match(html, /if \(m === 'limits'\) return limLoad\(\);/);
  assert.match(html, /S\.mode === 'limits' \? limitsContext\(\)/);
});

test('live behaviour: opt-in, auto-refresh Off/5m/15m/30m/1h (default 5m once on), idle views ask half as often, nothing while hidden, reduced motion honoured', () => {
  assert.match(view, /const EVERY = \[300, 900, 1800, 3600\]/);
  assert.match(view, /EVERY_DEFAULT = \{ limits: 300 \}/);
  assert.match(view, /limEvery\(\) \* \(Date\.now\(\) - lim\.lastActive > 600000 \? 2 : 1\)/);
  assert.match(html, /if \(S\.live && seq === loadSeq\) pollTimer = setTimeout\(poll, pollMs\(\)\)/);
  assert.match(view, /const pollMs = \(\) => page\.mode\(\) === 'limits' \? limInterval\(\) : everyMs\(\)/);
  assert.match(view, /page\.live\(\) && !document\.hidden && !DEMO && !lim\.beating/);
  assert.doesNotMatch(html + view, /lim\.auto = true/); // entering the view never turns Live on
  assert.match(view, /prefers-reduced-motion: reduce\)'\)\.matches/);
  assert.match(view, /const limActive = \(\) => page\.mode\(\) === 'limits' && page\.live\(\) && !document\.hidden && !lim\.reduced/);
});

test('the view reads no record data and writes no markup unescaped', () => {
  assert.ok(view.length > 5000);
  assert.doesNotMatch(view, /\bon(click|input|change)=/); // no inline handlers
  assert.doesNotMatch(view, /[>"]\$\{(?:r|e|x|u|p)\.\w+\}/); // no raw field lands in markup: every one goes through esc() or num()
  assert.doesNotMatch(view, /'Id'|OrderSummary\s+WHERE|SELECT /); // no queries of its own
});

test('limPaintRef declares acc before it hands it to the reference markup (console-limits-ref.js)', () => {
  const body = view.slice(view.indexOf('function limPaintRef()'), view.indexOf('function limCsv()'));
  assert.ok(body.indexOf('acc =') > -1 && body.indexOf('acc =') < body.indexOf('limAccessHtml(acc)'), 'acc used after its declaration');
  assert.ok(body.indexOf('acc =') < body.indexOf('limAllHtml(rows, acc'), 'acc used after its declaration');
});

test('one auto-refresh picker in the top bar drives the view on screen, remembered per view', () => {
  assert.equal((html.match(/<select id="every"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="lEvery"/); // the Limits panel no longer has a picker of its own
  assert.match(html, /id="every"[^>]*>(<option value="(off|300|900|1800|3600)">[^<]+<\/option>){5}<\/select>/);
  assert.match(view, /localStorage\.getItem\(EVERY_KEY\[m\] \|\| `omc\.every\.\$\{m\}`\)/);
  assert.match(view, /EVERY_KEY = \{ limits: 'omc\.limitsEvery' \}/); // the Limits choice saved before this change still counts
  assert.match(html, /syncMode\(\); syncEvery\(\);/); // switching views shows that view's interval
  assert.match(html, /if \(e\.target\.value === 'off'\) return setLive\(false\)/);
});
