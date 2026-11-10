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
// Read Chromium screenshots (8-bit RGB/RGBA PNG). No image or test dependency is installed in the application.
import { inflateSync } from 'node:zlib';

function pngChunks(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Not a PNG screenshot');
  let width, height, channels;
  const chunks = [];
  for (let at = 8; at < buffer.length;) {
    const size = buffer.readUInt32BE(at), type = buffer.toString('ascii', at + 4, at + 8), data = buffer.subarray(at + 8, at + 8 + size);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = ({ 2: 3, 6: 4 })[data[9]] ?? null;
      if (data[8] !== 8 || !channels || data[12] !== 0) throw new Error('Screenshot must be non-interlaced 8-bit RGB/RGBA');
    }
    if (type === 'IDAT') chunks.push(data);
    at += size + 12;
  }
  return { width, height, channels, chunks };
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function prediction(filter, a, b, c) {
  switch (filter) {
    case 1: return a;
    case 2: return b;
    case 3: return Math.floor((a + b) / 2);
    case 4: return paeth(a, b, c);
    default: return 0;
  }
}

function unfilter(raw, width, height, channels) {
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * channels);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    if (filter > 4) throw new Error('Unknown PNG filter');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= channels ? pixels[i - channels] : 0, b = y ? pixels[i - stride] : 0, c = y && x >= channels ? pixels[i - stride - channels] : 0;
      pixels[i] = (raw[at++] + prediction(filter, a, b, c)) & 255;
    }
  }
  return pixels;
}

export function pngPixels(buffer) {
  const { width, height, channels, chunks } = pngChunks(buffer);
  const stride = width * channels, raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: height * (stride + 1) });
  if (raw.length !== height * (stride + 1)) throw new Error('Incomplete screenshot pixels');
  return { width, height, channels, pixels: unfilter(raw, width, height, channels) };
}

export function pixelDifference(first, second, tolerance = 2) {
  const a = pngPixels(first), b = pngPixels(second);
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) return { equal: false, reason: 'dimensions' };
  let changed = 0, different = 0, maxDelta = 0;
  for (let i = 0; i < a.pixels.length; i += a.channels) {
    let delta = 0;
    for (let c = 0; c < a.channels; c++) delta = Math.max(delta, Math.abs(a.pixels[i + c] - b.pixels[i + c]));
    maxDelta = Math.max(maxDelta, delta);
    if (delta) changed++;
    if (delta > tolerance) different++;
  }
  return { equal: different === 0, changed, different, maxDelta };
}
