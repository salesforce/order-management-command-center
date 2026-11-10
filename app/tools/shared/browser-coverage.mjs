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
// CI browser coverage: keep Chrome's execution data, map inline scripts back to their HTML lines, and let Istanbul write
// LCOV. The converters are installed in the ignored coverage/browser-tools folder; the app has no dependency on them.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sourcePath, deploymentName, canonicalDocument, APP_URL, legacyModule } from "../../public/source-layout.js";

const ROOT = fileURLToPath(new URL("..", APP_URL));

export function saveBrowserCoverage(dir, origin, entries) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${process.pid}-${randomUUID()}.json`), JSON.stringify({ origin, entries }));
}

// Only scripts from this sample server and app/public belong to the report. Test wrappers append code to modules; their
// extra lines are outside maxLine and aren't application coverage. Inline scripts retain their position in the HTML file.
export function coverageSource(entry, origin, root = ROOT) {
  if (!entry.url || !entry.source) return null;
  const url = new URL(entry.url, origin);
  if (url.origin !== new URL(origin).origin) return null;
  let name = decodeURIComponent(url.pathname);
  if (name.endsWith('/')) name += 'index.html';
  if (!/\.(?:js|html)$/.test(name)) return null;
  const publicDir = path.join(root, 'app', 'public');
  const organized = fs.existsSync(path.join(publicDir, 'shared', 'transport', 'om-http.js'));
  if (organized && entry.source.trim() === legacyModule(name.slice(1))?.trim()) return null; // its canonical module owns the coverage
  const file = path.resolve(publicDir, organized ? sourcePath(name.slice(1)) : name.slice(1));
  if (path.relative(publicDir, file).startsWith('..') || !fs.existsSync(file)) return null;
  const original = fs.readFileSync(file, 'utf8');
  if (name.endsWith('.js')) return { file, lineOffset: 0, maxLine: original.split('\n').length };
  const rendered = organized ? canonicalDocument(original, deploymentName(sourcePath(name.slice(1))), name.slice(1)) : original;
  const at = (original.includes(entry.source) ? original : rendered).indexOf(entry.source);
  if (at < 0) return null; // injected scripts aren't an application's inline script
  return { file, lineOffset: (original.includes(entry.source) ? original : rendered).slice(0, at).split('\n').length - 1, maxLine: entry.source.split('\n').length };
}

const shift = (loc, n) => ({ start: { ...loc.start, line: loc.start.line + n }, end: { ...loc.end, line: loc.end.line + n } });
const within = (loc, max) => loc && loc.start.line <= max && loc.end.line <= max;

// Keep Istanbul's real counters and branch locations; change only source positions and omit the appended test wrappers.
export function mapFileCoverage(data, { file, lineOffset, maxLine }) {
  const out = { path: file, statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: {}, b: {} };
  for (const [id, loc] of Object.entries(data.statementMap)) {
    if (!within(loc, maxLine)) continue;
    out.statementMap[id] = shift(loc, lineOffset); out.s[id] = data.s[id];
  }
  for (const [id, fn] of Object.entries(data.fnMap)) {
    if (!within(fn.loc, maxLine) || !within(fn.decl, maxLine)) continue;
    out.fnMap[id] = { ...fn, line: fn.line + lineOffset, loc: shift(fn.loc, lineOffset), decl: shift(fn.decl, lineOffset) };
    out.f[id] = data.f[id];
  }
  for (const [id, branch] of Object.entries(data.branchMap)) {
    if (!within(branch.loc, maxLine) || !branch.locations.every((loc) => within(loc, maxLine))) continue;
    out.branchMap[id] = { ...branch, line: branch.line + lineOffset, loc: shift(branch.loc, lineOffset), locations: branch.locations.map((loc) => shift(loc, lineOffset)) };
    out.b[id] = data.b[id];
  }
  return out;
}

export async function browserLcov(dir, destination, root = ROOT) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (!files.length) throw new Error('browser-coverage: no browser execution data was collected');
  const require = createRequire(path.join(root, 'coverage', 'browser-tools', 'package.json'));
  const convert = require('v8-to-istanbul'), { createCoverageMap } = require('istanbul-lib-coverage');
  const { createContext } = require('istanbul-lib-report'), reports = require('istanbul-reports');
  const coverage = createCoverageMap({});
  for (const file of files) {
    const { origin, entries } = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const entry of entries) {
      const source = coverageSource(entry, origin, root); if (!source) continue;
      const converter = convert(source.file, 0, { source: entry.source });
      await converter.load(); converter.applyCoverage(entry.functions);
      for (const data of Object.values(converter.toIstanbul())) coverage.addFileCoverage(mapFileCoverage(data, source));
    }
  }
  if (!coverage.files().length) throw new Error('browser-coverage: no application scripts matched the execution data');
  reports.create('lcovonly', { file: path.basename(destination), projectRoot: root }).execute(createContext({ dir: path.dirname(destination), coverageMap: coverage }));
  console.log(`Browser coverage: ${files.length} sessions, ${coverage.files().length} application files → ${destination}`);
}

export async function main() {
  await browserLcov(process.argv[2], process.argv[3]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
