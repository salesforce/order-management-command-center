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
// The console map's geography (console-geo.js): the projection puts places where the map draws them, state names resolve, the
// ramp picks the right step, and the ring arc is a valid path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GEO_OUTPUT, main as buildGeo } from '../../../tools/operations-console/build-geo.mjs';
import { proj, toAbbr, STATES, BY_NAME, rampAt, RAMP, ringArc, LAYERS } from "../../../public/operations-console/console-geo.js";

test('the geography builder targets the canonical asset and can build an isolated fixture', async (t) => {
  const canonical = fileURLToPath(new URL('../../../public/operations-console/geo.js', import.meta.url));
  assert.equal(GEO_OUTPUT, canonical);
  const original = fs.readFileSync(canonical), args = process.argv;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-geo-build-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'world.json'), output = path.join(dir, 'geo.js');
  fs.writeFileSync(input, JSON.stringify({ objects: { world: { geometries: [{ id: '840', type: 'Polygon', arcs: [[0]] }] } }, arcs: [[[-120, 30], [-110, 40], [-100, 30], [-120, 30]]] }));
  try { process.argv = [args[0], args[1], input]; await buildGeo({ output }); } finally { process.argv = args; }
  assert.match(fs.readFileSync(output, 'utf8'), /window\.US_GEO = \{"l48":"M[^"]+Z","ak":"","hi":""\}/);
  assert.deepEqual(fs.readFileSync(canonical), original, 'the check never regenerates the maintained asset');
});

test('proj puts the lower 48, Alaska and Hawaii on the 975×610 map, east to the right and north up', () => {
  const [nyx, nyy] = proj(-74, 40.7), [lax, lay] = proj(-118.2, 34), [sex, sey] = proj(-122.3, 47.6), [anx, any] = proj(-149.9, 61.2), [hix, hiy] = proj(-157.8, 21.3);
  for (const v of [nyx, nyy, lax, lay, sex, sey, anx, any, hix, hiy]) assert.ok(Number.isFinite(v) && v > 0 && v < 975 + 1);
  assert.ok(nyx > lax, 'New York is east of Los Angeles');
  assert.ok(sey < lay, 'Seattle is north of Los Angeles');
  assert.ok(anx < 300 && any > lay, 'Alaska sits in the inset below the west coast');
  assert.ok(hix < 400 && hiy > lay, 'Hawaii sits in the inset below the west coast');
});
test('toAbbr takes an abbreviation or a name in any case, and nothing else', () => {
  assert.equal(toAbbr('ca'), 'CA');
  assert.equal(toAbbr(' California '), 'CA');
  assert.equal(toAbbr('new york'), 'NY');
  assert.equal(toAbbr('Narnia'), undefined);
  assert.equal(toAbbr(null), undefined);
  assert.equal(Object.keys(STATES).length, Object.keys(BY_NAME).length);
});
test('rampAt picks one of four steps, and the ends stay in range', () => {
  assert.equal(rampAt(0), RAMP[0]);
  assert.equal(rampAt(0.26), RAMP[1]);
  assert.equal(rampAt(0.99), RAMP[3]);
  assert.equal(rampAt(1), RAMP[3]);
  assert.ok(RAMP.every((c) => /^var\(--ramp\d\)$/.test(c)));
});
test('ringArc is an arc path that never closes the circle, and takes the long way past half', () => {
  assert.match(ringArc(10, 10, 5, 0.25), /^M10,5A5,5 0 0 1 /);
  assert.match(ringArc(10, 10, 5, 0.75), / 0 1 1 /);
  assert.doesNotMatch(ringArc(10, 10, 5, 1), /NaN/);
});
test('every layer names itself and uses a token for its colour', () => {
  for (const [k, l] of Object.entries(LAYERS)) { assert.ok(l.label && l.what, k); assert.match(l.color, /^var\(--/, k); }
});
