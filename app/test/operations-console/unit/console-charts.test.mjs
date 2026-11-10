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
// The dashboard's chart pieces (console-charts.js): the bars, the changes against the prior period, the empty buckets and the
// column chart. They are strings and numbers, so a change that flips a sign or loses a bar shows here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hbars, dur, pct1, ratio, mdelta, stats, na, buckets, niceMax, columns } from "../../../public/operations-console/console-charts.js";

test('hbars: a row per item, widths against the largest, shares of the total, the colour given', () => {
  const html = hbars([{ key: 'Open', n: 30 }, { key: 'Closed', n: 10 }], { color: 'var(--d2)' });
  assert.equal((html.match(/role="listitem"/g) || []).length, 2);
  assert.match(html, /width:100%;background:var\(--d2\)/);
  assert.match(html, /width:33\.3\d*%/);
  assert.match(html, /75%/);
  assert.match(html, /25%/);
});
test('hbars: no rows says so; a row with a tip takes focus; the label is escaped', () => {
  assert.match(hbars([]), /Nothing in this period/);
  assert.match(hbars(null), /Nothing in this period/);
  assert.match(hbars([{ key: 'a', n: 1, tip: true }]), /tabindex="0"/);
  assert.doesNotMatch(hbars([{ key: 'a', n: 1 }]), /tabindex/);
  assert.match(hbars([{ key: '<b>x</b>', n: 1 }]), /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(hbars([{ key: '<script>', n: 1 }]), /<script>/);
});

test('dur: minutes under an hour, hours under two days, days after', () => {
  assert.equal(dur(null), '—');
  assert.equal(dur(0.5), '30 min');
  assert.equal(dur(0.001), '1 min');
  assert.equal(dur(5), '5.0 h');
  assert.equal(dur(30), '30 h');
  assert.match(dur(72), /3(\.0)? d/);
});
test('pct1 and ratio: empty and zero cases', () => {
  assert.equal(pct1(null), '—');
  assert.equal(pct1(NaN), '—');
  assert.equal(pct1(0.05), '5.0%');
  assert.equal(pct1(0.5), '50%');
  assert.equal(ratio(1, 4), 0.25);
  assert.equal(ratio(1, 0), null);
  assert.equal(ratio(undefined, 4), 0);
});

test('mdelta: a rise is up, a fall is down, within half a percent is flat, nothing before is new', () => {
  assert.equal(mdelta(null, 5), '');
  assert.equal(mdelta(5, null), '');
  assert.equal(mdelta(0, 0), '');
  assert.equal(mdelta(3, 0), 'new vs prior');
  assert.equal(mdelta(150, 100), '▲ 50% vs prior');
  assert.equal(mdelta(50, 100), '▼ 50% vs prior');
  assert.equal(mdelta(100.4, 100), '■ 0% vs prior');
});

test('stats and na: labelled values, the optional small line, and the missing-object note', () => {
  const s = stats([['Orders', 12, 'today'], ['Refunds', 3]]);
  assert.match(s, /<span>Orders<\/span><b>12<\/b><small>today<\/small>/);
  assert.match(s, /<span>Refunds<\/span><b>3<\/b><\/div>/);
  assert.match(na('Refund'), /Refund is not available in this org/);
  assert.match(na('<x>'), /&lt;x&gt; is not available/);
});

test('niceMax rounds a maximum up to 1, 2, 5 or 10 of its size, and at least 4', () => {
  assert.deepEqual([0, 3, 4].map(niceMax), [4, 4, 4]);
  assert.deepEqual([5, 11, 21, 51, 99].map(niceMax), [5, 20, 50, 100, 100]);
});

test('buckets: the period is filled with zero days, hours or months', () => {
  const from = new Date(); from.setDate(from.getDate() - 2); from.setHours(0, 0, 0, 0);
  const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const days = buckets([{ key: day(from), n: 7 }], 'day', from);
  assert.equal(days.length, 3);
  assert.equal(days[0].n, 7);
  assert.deepEqual(days.slice(1).map((b) => b.n), [0, 0]);
  const hours = buckets([], 'hour', from);
  assert.equal(hours.length, new Date().getHours() + 1);
  assert.ok(hours.every((b) => b.n === 0));
  assert.ok(buckets([], 'month', new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)).length >= 2);
});

test('columns: a labelled chart, a bar for each non-zero column, and a tab stop', () => {
  const el = { clientWidth: 600, innerHTML: '' };
  const list = [{ n: 4, label: 'Mon', long: 'Monday' }, { n: 0, label: 'Tue', long: 'Tuesday' }, { n: 8, label: 'Wed', long: 'Wednesday' }];
  columns(el, list, { color: 'var(--d3)', unit: 'orders' });
  assert.match(el.innerHTML, /role="img" tabindex="0"/);
  assert.equal((el.innerHTML.match(/class="col"/g) || []).length, 2);
  assert.match(el.innerHTML, /fill="var\(--d3\)"/);
  assert.match(el.innerHTML, /aria-label="orders over time, Monday to Wednesday: 12 in all, the most 8 on Wednesday/);
  columns(el, [], {});
  assert.match(el.innerHTML, /orders over time: none/);
});
