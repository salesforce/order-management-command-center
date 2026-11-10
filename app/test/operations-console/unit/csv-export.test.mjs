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
import { consoleCode } from "../../support/console-source.mjs";

// The CSV cell escaping (console-csv.js), run here; the download functions are read from their views as text.
const src = readFileSync(new URL("../../../public/operations-console/console-csv.js", import.meta.url), 'utf8');
const C = await import("../../../public/operations-console/console-csv.js");
const fnSrc = (name, next, from) => from.slice(from.indexOf(`function ${name}(`), from.indexOf(next, from.indexOf(`function ${name}(`)));
// The Limits view's export is in its module (console-limits-view.js), indented inside createLimitsView().
const limCsvSrc = fnSrc('limCsv', '\n  }\n', readFileSync(new URL("../../../public/operations-console/console-limits-view.js", import.meta.url), 'utf8'));
// The dashboard's export is in console-dash-view.js, also inside its factory.
const downloadCsvSrc = fnSrc('downloadCsv', 'function openDataMap(', readFileSync(new URL("../../../public/operations-console/console-dash-view.js", import.meta.url), 'utf8'));

test('the CSV escaping is its own module and stands alone', () => {
  assert.ok(src.length > 100);
  assert.doesNotMatch(src, /^import /m, 'console-csv.js stands alone');
  assert.equal(typeof C.csvCell, 'function');
  assert.equal(typeof C.csvText, 'function');
  assert.ok(!src.includes('<!--') && !src.includes('</script'), 'inline-script builds choke on these');
});

test('formula starters are neutralised, then quoted', () => {
  for (const v of ['=1+1', '+1+1', "-2+3+cmd|' /C calc'!A0", '@SUM(A1)', '=HYPERLINK("http://x","c")']) {
    const c = C.csvCell(v);
    assert.ok(c.startsWith('"\''), `${v} -> ${c}`);
    assert.ok(!/^"[=+\-@]/.test(c), c);
  }
});

test('tab, CR and leading-space starters too', () => {
  for (const v of ['\tfoo', '\rfoo', ' =1', '\n=1']) assert.ok(C.csvCell(v).startsWith('"\''), JSON.stringify(v));
});

test('real numbers stay numeric', () => {
  assert.equal(C.csvCell(-5), '"-5"');
  assert.equal(C.csvCell(-12.5), '"-12.5"');
  assert.equal(C.csvCell(0), '"0"');
  assert.equal(C.csvCell(1234.5), '"1234.5"');
});

test('numeric-looking strings stay untouched, anything longer does not', () => {
  for (const v of ['-5', '-1.50', '+14155551212', '-.5', '1e5']) assert.equal(C.csvCell(v), `"${v}"`);
  for (const v of ['-5 items', '-5+3', '+', '-', '-Foo']) assert.equal(C.csvCell(v), `"'${v}"`);
});

test('dates, ordinary text, null and undefined', () => {
  assert.equal(C.csvCell('2026-10-01T10:00:00.000+0000'), '"2026-10-01T10:00:00.000+0000"');
  assert.equal(C.csvCell('Acme'), '"Acme"');
  assert.equal(C.csvCell(null), '""');
  assert.equal(C.csvCell(undefined), '""');
  assert.equal(C.csvCell(''), '""');
  assert.equal(C.csvCell(true), '"true"');
});

test('quotes, commas and newlines survive', () => {
  assert.equal(C.csvCell('a "b", c\nd'), '"a ""b"", c\nd"');
  assert.equal(C.csvCell('="x"'), '"\'=""x"""'); // the prefix goes on first, then the quotes are doubled
});

test('csvText joins rows with newlines and cells with commas', () => {
  assert.equal(C.csvText([['a', 'b'], [1, '=x']]), '"a","b"\n"1","\'=x"');
  assert.equal(C.csvText([]), '');
});

// A small RFC 4180 reader: proves the quoting is still valid CSV.
function parse(text) {
  const rows = [[]]; let cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { rows.at(-1).push(cell); cell = ''; }
    else if (ch === '\n') { rows.at(-1).push(cell); cell = ''; rows.push([]); }
    else cell += ch;
  }
  rows.at(-1).push(cell);
  return rows;
}
test('a round trip returns the original, with an apostrophe only on formula starters', () => {
  const vals = ['=1+1', '@SUM(A1)', '=HYPERLINK("http://x","c")', 'Acme, Inc', 'say "hi"', 'two\nlines', 'plain', '-5'];
  const back = parse(C.csvText([vals, vals]));
  assert.equal(back.length, 2);
  const want = vals.map((v) => (/^[=+\-@]/.test(v) && !/^-5$/.test(v) ? "'" + v : v));
  assert.deepEqual(back[0], want);
  assert.deepEqual(back[1], want);
});

test('both real exporters use the shared helper', () => {
  assert.ok(limCsvSrc.includes('csvText('));
  assert.ok(downloadCsvSrc.includes('csvText('));
  assert.ok(!limCsvSrc.includes('replace(/"/g') && !downloadCsvSrc.includes('replace(/"/g'), 'no private quoting copy');
  assert.equal(consoleCode.split(`replace(/"/g, '""')`).length - 1, 1, 'one copy, in csvCell');
});

test('downloadCsv end to end, with stubs', async () => {
  let blob, anchor;
  const csvStore = { pTopSpend: { cols: ['rank', 'account_id', 'account', 'spend'], rows: [[1, '001xx', '=HYPERLINK("http://evil","c")', -250.5], [2, '001yy', 'Acme, Inc', 100]] } };
  const document = { createElement: () => (anchor = { click() {} }) };
  const URL = { createObjectURL: (b) => { blob = b; return 'blob:x'; }, revokeObjectURL() {} };
  const downloadCsv = new Function('csvStore', 'S', 'document', 'URL', 'Blob', 'csvText', `${downloadCsvSrc}\nreturn downloadCsv;`)(csvStore, { dash: { period: 'mtd' } }, document, URL, Blob, C.csvText);
  downloadCsv('pTopSpend');
  const lines = (await blob.text()).split('\n');
  assert.equal(lines[1], '"1","001xx","\'=HYPERLINK(""http://evil"",""c"")","-250.5"');
  assert.equal(lines[2], '"2","001yy","Acme, Inc","100"');
  assert.equal(anchor.download, 'om-topspend-mtd.csv');
  assert.equal(blob.type, 'text/csv');
});

test('the raw csvStore is not escaped, so the agent context keeps real values', () => {
  const panels = readFileSync(new URL("../../../public/operations-console/console-panels.js", import.meta.url), 'utf8'), i = panels.indexOf('if (csv) csvStore[id] = csv;');
  assert.ok(i > 0);
  assert.ok(!panels.includes('csvCell'));
});
