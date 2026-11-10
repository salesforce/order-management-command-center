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
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { pngPixels, pixelDifference } from '../../tools/shared/pixel-diff.mjs';

// Minimal trusted screenshot fixtures; CRC fields are unused by the read-only pixel comparator.
const chunk = (type, data) => { const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8); return out; };
function image(rgb, width = 1) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, ...rgb]))), chunk('IEND', Buffer.alloc(0))]);
}
function filteredImage(raw, color = 2) {
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = color;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))]);
}
test('pixel comparison decodes real RGB data and ignores only declared raster rounding', () => {
  const a = image([10, 20, 30]), b = image([12, 20, 30]);
  assert.deepEqual([...pngPixels(a).pixels], [10, 20, 30]);
  assert.deepEqual(pixelDifference(a, a), { equal: true, changed: 0, different: 0, maxDelta: 0 });
  assert.deepEqual(pixelDifference(a, b), { equal: true, changed: 1, different: 0, maxDelta: 2 });
  assert.equal(pixelDifference(a, b, 0).equal, false);
});
test('a changed pixel beyond rounding and a changed image size fail comparison', () => {
  assert.equal(pixelDifference(image([10, 20, 30]), image([13, 20, 30])).equal, false);
  assert.deepEqual(pixelDifference(image([1, 2, 3]), image([1, 2, 3, 1, 2, 3], 2)), { equal: false, reason: 'dimensions' });
});
test('invalid and truncated screenshots cannot pass the comparison', () => {
  assert.throws(() => pngPixels(Buffer.from('invalid')), /Not a PNG/);
  assert.throws(() => pngPixels(image([1, 2, 3]).subarray(0, 35)));
});
test('all five PNG row filters recover the same RGB pixels, including first-row and first-pixel edges', () => {
  const expected = [10, 20, 30, 40, 50, 60, 15, 25, 35, 45, 55, 65];
  const rows = [
    [0, 10, 20, 30, 40, 50, 60, 0, 15, 25, 35, 45, 55, 65],
    [1, 10, 20, 30, 30, 30, 30, 1, 15, 25, 35, 30, 30, 30],
    [2, 10, 20, 30, 40, 50, 60, 2, 5, 5, 5, 5, 5, 5],
    [3, 10, 20, 30, 35, 40, 45, 3, 10, 15, 20, 18, 18, 18],
    [4, 10, 20, 30, 30, 30, 30, 4, 5, 5, 5, 5, 5, 5],
  ];
  for (const row of rows) assert.deepEqual([...pngPixels(filteredImage(row)).pixels], expected, `filter ${row[0]}`);
  const diagonal = filteredImage([4, 20, 20, 20, 246, 246, 246, 4, 10, 10, 10, 5, 5, 5]);
  assert.deepEqual([...pngPixels(diagonal).pixels], [20, 20, 20, 10, 10, 10, 30, 30, 30, 25, 25, 25]);
});
test('RGBA channels and invalid filter bytes keep their decoder contract', () => {
  const pixels = [1, 2, 3, 255, 4, 5, 6, 128, 7, 8, 9, 64, 10, 11, 12, 0];
  const rgba = filteredImage([0, ...pixels.slice(0, 8), 0, ...pixels.slice(8)], 6);
  assert.equal(pngPixels(rgba).channels, 4); assert.deepEqual([...pngPixels(rgba).pixels], pixels);
  assert.throws(() => pngPixels(filteredImage([5, 1, 2, 3, 4, 5, 6, 0, 7, 8, 9, 10, 11, 12])), /Unknown PNG filter/);
});
