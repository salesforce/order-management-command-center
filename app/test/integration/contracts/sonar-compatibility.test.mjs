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
// Compatibility checks for the Sonar loop/control-character cleanups against the unchanged main implementations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { controlSpaces, likeEsc } from '../../../public/shared/data/om-core-util.js';
import { buckets } from '../../../public/operations-console/console-charts.js';

const patches = JSON.parse(fs.readFileSync(new URL('../../architecture/sonar-compatibility-patches.json', import.meta.url)));
const source = (file) => fs.readFileSync(new URL('../../../public/' + file, import.meta.url), 'utf8');
function previous(file, text) {
  for (const { before, after } of patches[file].patches) text = text.replace(after, () => before);
  return text;
}
function calendarFunction(text, name, next) {
  const start = text.indexOf('function ' + name + '('), end = text.indexOf(next, start);
  assert.ok(start >= 0 && end > start);
  const label = (d) => new Date(d).toISOString();
  return new Function('day', 'time', 'hxDay', 'hxTime', text.slice(start, end) + '\nreturn ' + name)(label, label, label, label);
}
const charts = source('operations-console/console-charts.js');
const originalBuckets = calendarFunction(previous('console-charts.js', charts), 'buckets', 'export const niceMax');
const tickFunctions = [
  ['console-drawers.js', 'operations-console/console-drawers.js', 'hxTicks', 'function hxTimeline'],
].map(([key, file, name, next]) => {
  const text = source(file);
  return [calendarFunction(text, name, next), calendarFunction(previous(key, text), name, next)];
});

test('control cleaning preserves the former behavior for every UTF-16 code unit', () => {
  const text = Array.from({ length: 65536 }, (_, code) => String.fromCharCode(code)).join('');
  const oldControls = new RegExp(String.raw`[\x00-\x1f\x7f]`, 'g');
  const oldNoteControls = new RegExp(String.raw`[\x00-\x09\x0b-\x1f\x7f]`, 'g');
  assert.equal(controlSpaces(text), text.replace(oldControls, ' '));
  assert.equal(controlSpaces(text, true), text.replace(oldNoteControls, ' '));
  for (const value of [null, undefined, 0, false, 'café 😀', '\ud800x\udfff'])
    assert.equal(controlSpaces(value), String(value ?? '').replace(oldControls, ' '));
});

test('LIKE input cleaning keeps its length limit, Unicode and wildcard escaping', () => {
  assert.equal(likeEsc('a\u0000b%_'), 'a b\\%\\_');
  assert.equal(likeEsc("O'Brien"), "O\\'Brien");
  assert.equal(likeEsc('café 😀'), 'café 😀');
  assert.equal(likeEsc('x'.repeat(1000)).length, 80);
  assert.equal(likeEsc(null), '');
});

for (const zone of ['UTC', 'America/New_York', 'Australia/Lord_Howe']) {
  test(`calendar cursors retain buckets and the console's history axis across DST and year boundaries in ${zone}`, (t) => {
    const timezone = process.env.TZ;
    process.env.TZ = zone;
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    try {
      for (const [from, now] of [
        [new Date(2024, 1, 27), new Date(2024, 2, 12, 12)],
        [new Date(2024, 9, 28), new Date(2024, 10, 5, 12)],
        [new Date(2023, 11, 30), new Date(2024, 2, 2, 12)],
      ]) {
        t.mock.timers.setTime(+now);
        const series = [{ key: '2024-02-29', n: 7 }];
        for (const grain of ['hour', 'day', 'month'])
          assert.deepEqual(buckets(series, grain, from), originalBuckets(series, grain, from));
        for (const [current, original] of tickFunctions) {
          for (const end of [+now, +from + 5 * 3600e3]) {
            const actual = current(+from, end);
            assert.deepEqual(actual, original(+from, end));
            assert.ok(actual.every(([value], index) => value > +from && value < end && (!index || value > actual[index - 1][0])));
          }
        }
      }
      t.mock.timers.setTime(+new Date(2024, 2, 2, 12));
      assert.deepEqual(buckets([], 'day', new Date(2024, 1, 27)).map((d) => d.key),
        ['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02']);
      assert.deepEqual(buckets([], 'month', new Date(2023, 11, 1)).map((d) => d.key), ['2023-12', '2024-01', '2024-02', '2024-03']);
    } finally {
      t.mock.timers.reset();
      if (timezone === undefined) delete process.env.TZ; else process.env.TZ = timezone;
    }
  });
}
