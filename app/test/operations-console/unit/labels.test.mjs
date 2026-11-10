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

// The label helpers (console-labels.js), run here; load() runs against stubs (load-harness.mjs).
const src = readFileSync(new URL("../../../public/operations-console/console-labels.js", import.meta.url), 'utf8');
const L = await import("../../../public/operations-console/console-labels.js");
const RANGE = { today: 'today', '7d': 'last 7 days', '90d': 'last 90 days', all: 'all open' }, PERIOD = { mtd: 'Month to date', qtd: 'Quarter to date', all: 'All time' };

test('the labels are their own module and stand alone', () => {
  assert.ok(src.length > 300);
  assert.doesNotMatch(src, /^import /m, 'console-labels.js stands alone');
  assert.match(html, /^import \{[^}]*\bshownKey\b[^}]*\} from '\.\/console-labels\.js';/m);
});

test('shownKey: the payload wins over the pick, and anything unknown falls back to the pick', () => {
  assert.equal(L.shownKey({ range: '7d' }, 'range', '90d', RANGE), '7d');
  assert.equal(L.shownKey({ period: 'qtd' }, 'period', 'mtd', PERIOD), 'qtd');
  for (const p of [null, undefined, {}, { range: 'bogus' }, { range: undefined }, { range: {} }, { range: undefined }, { range: null }]) assert.equal(L.shownKey(p, 'range', '90d', RANGE), '90d', JSON.stringify(p));
});

test('failNote names what was asked and what is still on screen', () => {
  assert.equal(L.failNote(RANGE, '7d', '90d', true), "Couldn't load last 7 days. Showing last 90 days.");
  assert.equal(L.failNote(RANGE, '90d', '90d', true), "Couldn't refresh last 90 days. Showing the last good load.");
  assert.equal(L.failNote(RANGE, '7d', '90d', false), "Couldn't load last 7 days.");
  assert.equal(L.failNote(PERIOD, 'qtd', 'mtd', true), "Couldn't load quarter to date. Showing month to date.");
  assert.equal(L.failNote(PERIOD, 'all', 'all', true), "Couldn't refresh all time. Showing the last good load.");
  assert.equal(L.failNote({}, 'x', 'x', true), "Couldn't refresh. Showing the last good load.");
  assert.equal(L.failNote({}, 'x', '', false), "Couldn't load.");
  assert.equal(L.failNote(RANGE, undefined, '90d', true), "Couldn't refresh. Showing the last good load.");
});

test('no label reads the pick: every one goes through the payload-based helpers', () => {
  const html = consoleCode; // the page's script and the console's views
  assert.doesNotMatch(html, /RANGE_LABEL\[(?:S\.)?range\]/);
  assert.doesNotMatch(html, /PERIOD_LABEL\[period\]/);
  assert.doesNotMatch(html, /PRIOR_LABEL\[period\]/);
  assert.match(html, /PRIOR_LABEL\[shownPeriod\(\)\]/);
  assert.match(html, /fields: \{ range: shownRange\(\)/);
  assert.match(html, /fields: \{ tab: S\.dtab, period: shownPeriod\(\)/);
  // The ones that stay: the "Show ..." button's target, and the inventory's own range.
  assert.match(html, /RANGE_LABEL\[fit\]/);
  assert.match(html, /RANGE_LABEL\[inv\.range\] \|\| rangeText\(\)/);
});

test('sample data carries the range like a real payload, and load() asks for the picked one', async () => {
  const { demoData } = await import("../../../public/operations-console/console-demo.js");
  assert.equal(demoData().range, '90d');
  assert.equal(demoData('7d').range, '7d');
  assert.ok(demoData('7d').at);
  assert.match(html, /DEMO \? demoData\(want, scope\)/);
});

test('scopeQuery and scopeText: the filters picked go on the query, and the words follow the payload', () => {
  assert.equal(L.scopeQuery({}), '');
  assert.equal(L.scopeQuery({ store: '0ZE000000000001', channel: null }), '&store=0ZE000000000001');
  assert.equal(L.scopeQuery({ store: '0ZE000000000001', channel: '0bI000000000001' }), '&store=0ZE000000000001&channel=0bI000000000001');
  const opt = { stores: [{ id: '0ZE000000000001', name: 'Outdoors' }], channels: [{ id: '0bI000000000001', name: 'Web' }] };
  assert.equal(L.scopeText({ store: '0ZE000000000001', channel: '0bI000000000001' }, opt), 'store Outdoors, sales channel Web');
  assert.equal(L.scopeText({ store: null, channel: '0bI000000000009' }, opt), 'sales channel 0bI000000000009');
  assert.equal(L.scopeText(null, opt), '');
});

test('scopeNames: a name two stores share gets the end of each Id; the rest stay as they are', () => {
  assert.deepEqual(L.scopeNames([{ id: '0ZE1Q0000004NCJWA2', name: 'RefArch USD' }, { id: '0ZE1Q0000004NCEWA2', name: 'RefArch USD' }, { id: '0ZEB00000000J0IOAU', name: 'nto USD' }]),
    [{ id: '0ZE1Q0000004NCJWA2', name: 'RefArch USD · 4NCJ' }, { id: '0ZE1Q0000004NCEWA2', name: 'RefArch USD · 4NCE' }, { id: '0ZEB00000000J0IOAU', name: 'nto USD' }]);
  assert.deepEqual(L.scopeNames(null), []);
});

test('load() asks for the Store and Sales channel picked, on the console and the Dashboard', async () => {
  const { s, load, pending, ok } = rig({ store: '0ZE000000000001', channel: '0bI000000000001' });
  const a = load(); await tick();
  assert.equal(pending[0].url, '/api/console?range=90d&store=0ZE000000000001&channel=0bI000000000001');
  ok(0, { range: '90d', at: new Date().toISOString() }); await a;
  s.mode = 'dashboard'; s.channel = '';
  const b = load(); await tick();
  assert.equal(pending[1].url, '/api/dashboard?period=mtd&store=0ZE000000000001');
  ok(1, { period: 'mtd', at: new Date().toISOString() }); await b;
});

test('console labels follow the loaded payload, not the pick', async () => {
  const { s, load, pending, ok } = rig();
  s.range = '7d';
  const p = load(); await tick();
  assert.equal(pending[0].url, '/api/console?range=7d');
  // Nothing has loaded yet: the pick is all there is.
  assert.equal(s.data, null);
  ok(0, { range: '7d', at: new Date().toISOString() }); await p;
  assert.equal(s.data.range, '7d');
});

test('a failed range click keeps the pick and the old data, and the banner names both', async () => {
  const { s, log, load, ok, fail } = rig();
  const a = load(); await tick(); ok(0, { range: '90d', at: '2026-10-23T10:00:00Z' }); await a;
  s.range = '7d';
  const b = load(); await tick(); fail(1, new Error('Failed to fetch')); await b;
  assert.equal(s.range, '7d');
  assert.equal(s.data.range, '90d');
  assert.equal(log.banners.length, 1);
  assert.equal(log.banners[0].kind, 'stale');
  assert.equal(log.banners[0].head, "Couldn't load last 7 days. Showing last 90 days.");
  assert.match(log.banners[0].text, /Failed to fetch/);
});

test('overlapping loads: the late answer for an older pick is discarded', async () => {
  const { s, load, ok } = rig();
  s.range = '7d'; const a = load(); await tick();
  s.range = '30d'; const b = load(); await tick();
  ok(1, { range: '30d', at: 'x' }); await b;
  ok(0, { range: '7d', at: 'x' }); await a;
  assert.equal(s.data.range, '30d');
});

test('a superseded load that fails writes nothing', async () => {
  const { s, log, load, ok, fail } = rig();
  s.range = '7d'; const a = load(); await tick();
  s.range = '30d'; const b = load(); await tick();
  ok(1, { range: '30d', at: 'x' }); await b;
  fail(0, new Error('late failure')); await a;
  assert.equal(log.banners.length, 0);
  assert.equal(s.data.range, '30d');
});

test('the dashboard labels from dash.period, the service queue from svc.range', async () => {
  const d = rig({ mode: 'dashboard', period: 'qtd' });
  const a = d.load(); await tick(); d.ok(0, { period: 'mtd', at: '2026-10-23T10:00:00Z' }); await a;
  assert.equal(d.s.dash.period, 'mtd');
  const b = d.load(); await tick(); d.fail(1, new Error('boom')); await b;
  assert.equal(d.log.banners[0].head, "Couldn't load quarter to date. Showing month to date.");

  const q = rig({ mode: 'service', range: 'all' });
  const c = q.load(); await tick(); q.ok(0, { range: '90d', at: '2026-10-23T10:00:00Z' }); await c;
  const e = q.load(); await tick(); q.fail(1, new Error('boom')); await e;
  assert.equal(q.log.banners[0].head, "Couldn't load all open. Showing last 90 days.");
});
