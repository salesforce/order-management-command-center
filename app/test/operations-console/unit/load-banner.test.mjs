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
import { html, rig, tick } from "../../support/load-harness.mjs";
import { consoleCode } from "../../support/console-source.mjs";
import { fakeOrg } from "../../support/fake-org.mjs";

// The banner's helpers (console-banner.js), run here; load() runs against stubs (load-harness.mjs).
const src = readFileSync(new URL("../../../public/operations-console/console-banner.js", import.meta.url), 'utf8');
const B = await import("../../../public/operations-console/console-banner.js");
// A function's text: the page's own are at the start of a line, a view's are indented two spaces inside its factory.
const body = (re) => consoleCode.match(re)?.[0] || assert.fail(String(re));

test('the banner helpers are their own module and stand alone', () => {
  assert.ok(src.length > 300);
  assert.doesNotMatch(src, /^import /m, 'console-banner.js stands alone');
});

test('the title carries the open-exceptions count only while Live is on in the console', () => {
  assert.equal(B.tabTitle(true, 'console', 26), '(26) Salesforce Order Management Operations Console');
  for (const [live, mode, n] of [[false, 'console', 26], [true, 'dashboard', 26], [true, 'service', 26], [true, 'limits', 26], [true, 'console', 0], [true, 'console', null], [true, 'console', undefined], [true, 'console', NaN]]) assert.equal(B.tabTitle(live, mode, n), 'Salesforce Order Management Operations Console', `${live} ${mode} ${n}`);
});

test('only an expired sign-in (401) and a blocked-org refusal are sign-in failures, never a 409 alone', () => {
  for (const e of [{ status: 401 }, { status: 409, orgBlocked: true }]) assert.equal(B.isAuthFailure(e), true);
  for (const e of [{ status: 400 }, { status: 409 }, { status: 500 }, { status: 503 }, { status: 504 }, new TypeError('Failed to fetch'), null, undefined]) assert.equal(B.isAuthFailure(e), false);
});

test('a banner is amber while a payload is on screen, red when the view has nothing', () => {
  const stale = B.loadProblem('the console', "Couldn't load last 7 days. Showing last 90 days.", 'boom', true, '10:02 AM');
  assert.equal(stale.kind, 'stale'); assert.equal(stale.head, "Couldn't load last 7 days. Showing last 90 days."); assert.match(stale.text, /Data from 10:02 AM\. boom/);
  assert.equal(B.loadProblem('the console', 'n', 'boom', true, null).text, 'boom');
  const err = B.loadProblem('the dashboard', "Couldn't load month to date.", 'Dash down', false, null);
  assert.equal(err.kind, 'err'); assert.equal(err.head, "Couldn't load the dashboard."); assert.equal(err.text, 'Dash down');
});

test('load(): a first failure is red, a later one amber, a success clears, a sign-in failure only opens the gate', async () => {
  const { s, log, load, ok, fail } = rig();
  const a = load(); await tick(); fail(0, new Error('Failed to fetch')); await a;
  assert.equal(log.banners.at(-1).kind, 'err'); assert.equal(log.banners.at(-1).head, "Couldn't load the console.");
  assert.equal(log.updated.at(-1), 'Refresh failed');
  const clears = log.clears;
  const b = load(); await tick(); ok(1, { range: '90d', at: '2026-10-23T10:00:00Z' }); await b;
  assert.equal(log.clears, clears + 1);
  const c = load(); await tick(); fail(2, new Error('Failed to fetch')); await c;
  assert.equal(log.banners.at(-1).kind, 'stale'); assert.equal(log.banners.at(-1).head, "Couldn't refresh last 90 days. Showing the last good load.");
  const n = log.banners.length;
  for (const [i, e] of [{ status: 401 }, { status: 409, orgBlocked: true }].entries()) {
    const d = load(); await tick(); fail(3 + i, Object.assign(new Error('Sign in'), e)); await d;
  }
  assert.equal(log.banners.length, n);
  assert.deepEqual(log.gates, [{ error: 'Sign in' }, { error: 'Sign in' }]);
  // A 409 that isn't a blocked org is a failed load like any other.
  const f = load(); await tick(); fail(5, Object.assign(new Error('Conflict'), { status: 409 })); await f;
  assert.equal(log.banners.length, n + 1);
  assert.equal(log.gates.length, 2);
  assert.equal(s.data.range, '90d');
});

test('wiring: the banner has its own element, so renderNotice cannot hide it', () => {
  assert.match(html, /<div class="banner hide" id="banner"><\/div>/);
  assert.doesNotMatch(body(/function showBanner[\s\S]*?\n\}/), /#notice/);
  assert.doesNotMatch(body(/function clearBanner[\s\S]*?\n\}/), /#notice/);
  assert.doesNotMatch(body(/function renderNotice[\s\S]*?\n {2}\}/), /banner/);
  // Dashboard, Service and Limits give the view the 1fr row; with a banner there is one more row above it.
  assert.match(html, /\.app\.bnshown\.dashmode,\.app\.bnshown\.servicemode,\.app\.bnshown\.limitsmode\{grid-template-rows:auto auto 1fr\}/);
});

test('wiring: the banner text takes its labels from the payload helpers, never the pick', () => {
  const fn = body(/function loadFailed[\s\S]*?\n\}/);
  assert.match(fn, /failNote\(/);
  assert.doesNotMatch(fn + body(/function showBanner[\s\S]*?\n\}/), /RANGE_LABEL\[|PERIOD_LABEL\[|PRIOR_LABEL\[/);
});

test('wiring: load() clears on success, sends sign-in failures to the gate alone, and keeps its polling lines', () => {
  const fn = body(/async function load\(\) \{[\s\S]*?\n\}/);
  const seq = fn.indexOf('if (seq !== loadSeq) return;'), clear = fn.indexOf('clearBanner();'), assign = fn.indexOf("if (m === 'console') { S.data = next;");
  assert.ok(seq > 0 && clear > seq && assign > clear);
  const c = fn.slice(fn.indexOf('} catch (e) {'));
  assert.ok(c.indexOf('if (seq !== loadSeq) return;') < c.indexOf('isAuthFailure(e)'));
  assert.ok(c.indexOf('isAuthFailure(e)') < c.indexOf('loadFailed('));
  assert.match(c, /isAuthFailure\(e\)\) return showGate\(/);
  assert.match(fn, /if \(S\.live && seq === loadSeq\) pollTimer = setTimeout\(poll, pollMs\(\)\)/);
});

test('wiring: the gate, a view change, Live and every paint keep the title and banner in step', () => {
  assert.match(body(/function showGate\(s\) \{[\s\S]*?\n\}/), /clearBanner\(\);[^\n]*document\.title = BASE_TITLE/);
  assert.match(body(/function setMode\(m\) \{[\s\S]*?\n\}/), /clearBanner\(\); syncTitle\(\); load\(\)/);
  assert.match(body(/function liveUI\(on\) \{[\s\S]*?\n\}/), /syncTitle\(\)/);
  assert.match(body(/function render\(\) \{[^\n]*/), /syncTitle\(\)/);
  assert.match(body(/function syncTitle\(\) \{[\s\S]*?\n\}/), /S\.data\.kpis\.data\.openExceptions/);
  assert.match(html, /\$\('#banner'\)\.addEventListener\('click'/);
});

test('the banner CSS uses theme variables only, with ink text', () => {
  const css = html.match(/\.banner\{[^\n]*\n\.banner\.err\{[^\n]*\n\.banner button\{[^\n]*/)?.[0] || assert.fail('banner css');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(/);
  assert.match(css, /\.banner\{[^}]*color:var\(--ink\)/);
  assert.doesNotMatch(css, /color:var\(--red\)|color:var\(--amber\)/);
});

test('the title count is the Open exceptions KPI the console route already returns', async () => {
  const org = fakeOrg({ queries: [[/SELECT COUNT\(Id\) c FROM ProcessException WHERE Status IN/, [{ c: 7 }]], [/./, []]] });
  const r = await org.core.route('/api/console?range=30d');
  assert.equal(r.kpis.ok, true);
  assert.equal(r.kpis.data.openExceptions, 7);
});
