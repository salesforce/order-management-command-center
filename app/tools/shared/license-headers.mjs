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
// The Apache-2.0 header that OSPO's oss-template (how_to_license.md) asks for on every Salesforce-authored file that takes
// comments. It checks the files a release carries: tracked files that .gitattributes doesn't mark export-ignore.
// Usage: node app/tools/license-headers.mjs [--write]   (lists files without the header and exits 1; --write adds it)
import fs from 'node:fs';
import { APP_URL } from '../../public/source-layout.js';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', APP_URL));

export const LICENSE_LINES = [
  'Copyright (c) 2026, Salesforce, Inc.',
  'SPDX-License-Identifier: Apache-2.0',
  '',
  'Licensed under the Apache License, Version 2.0 (the "License");',
  'you may not use this file except in compliance with the License.',
  'You may obtain a copy of the License at',
  '',
  '    http://www.apache.org/licenses/LICENSE-2.0',
  '',
  'Unless required by applicable law or agreed to in writing, software',
  'distributed under the License is distributed on an "AS IS" BASIS,',
  'WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.',
  'See the License for the specific language governing permissions and',
  'limitations under the License.',
];

// Generated or third-party files keep their own notice: geo.js is built from world-atlas data (see NOTICE) by build-geo.mjs.
const SKIP = new Set(['app/public/operations-console/geo.js']);

const block = () => ['/*', ...LICENSE_LINES.map((l) => (l ? ` * ${l}` : ' *')), ' */'].join('\n');
const hashes = () => LICENSE_LINES.map((l) => (l ? `# ${l}` : '#')).join('\n');
const markup = () => ['<!--', ...LICENSE_LINES.map((l) => (l ? `  ${l}` : '')), '-->'].join('\n');

// The comment style for a file, or null when it takes no header (JSON, Markdown, data files).
export function styleFor(file) {
  const base = path.basename(file);
  if (base === '.gitignore') return 'hash';
  if (/\.(m?js|css|cls)$/.test(base)) return 'block';
  if (/\.(ya?ml|py)$/.test(base)) return 'hash';
  if (/\.html$/.test(base)) return /(^|\/)lwc\//.test(file) ? 'lwc' : 'html';
  if (/\.xml$/.test(base) || /^<\?xml/.test(readHead(file))) return 'xml';
  return null;
}

function readHead(file) {
  try { return fs.readFileSync(path.join(ROOT, file), 'utf8').slice(0, 6); } catch { return ''; }
}

export const hasHeader = (text) => /SPDX-License-Identifier: Apache-2\.0/.test(text.slice(0, 1500));

// The text with the header added in the place its format allows: after a shebang, an XML declaration or a doctype, and
// inside an LWC template's root (a component's template has one root element).
export function addHeader(text, style) {
  if (hasHeader(text)) return text;
  const after = (re, header) => {
    const m = text.match(re);
    return m ? `${text.slice(0, m[0].length)}${header}\n${text.slice(m[0].length)}` : `${header}\n${text}`;
  };
  switch (style) {
    case 'block': return after(/^#![^\n]*\n/, block());
    case 'hash': return after(/^#![^\n]*\n/, hashes());
    case 'xml': return after(/^<\?xml[^>]*\?>\n/, markup());
    case 'html': return after(/^<!doctype[^>]*>\n/i, markup());
    case 'lwc': return after(/^<template>\n/, markup().replace(/^/gm, '    '));
    default: throw new Error(`no header style "${style}"`);
  }
}

// Files a release carries (git archive leaves out export-ignore ones) that take a header.
export function releaseFiles() {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  // A directory's export-ignore (`app/tools/h360/`) matches the directory only, asked for with its trailing slash, and
  // git archive then leaves out everything under it.
  const dirs = new Set();
  for (const f of files) for (let d = path.posix.dirname(f); d !== '.'; d = path.posix.dirname(d)) dirs.add(`${d}/`);
  const attrs = execFileSync('git', ['check-attr', '-z', '--stdin', 'export-ignore'], { cwd: ROOT, input: [...files, ...dirs].join('\0'), encoding: 'utf8' }).split('\0');
  const ignored = new Set();
  for (let i = 0; i + 2 < attrs.length; i += 3) if (attrs[i + 2] === 'set') ignored.add(attrs[i]);
  const shipped = (f) => !ignored.has(f) && ![...ignored].some((d) => d.endsWith('/') && f.startsWith(d));
  return files.filter((f) => shipped(f) && !SKIP.has(f) && fs.existsSync(path.join(ROOT, f)) && styleFor(f));
}

export const missingHeaders = () => releaseFiles().filter((f) => !hasHeader(fs.readFileSync(path.join(ROOT, f), 'utf8')));

export function main() {
  const missing = missingHeaders();
  if (process.argv.includes('--write')) {
    for (const f of missing) {
      const p = path.join(ROOT, f);
      fs.writeFileSync(p, addHeader(fs.readFileSync(p, 'utf8'), styleFor(f)));
    }
    console.log(`license-headers: added the header to ${missing.length} file(s)`);
  } else if (missing.length) {
    console.error(`license-headers: ${missing.length} file(s) without the Apache-2.0 header (run with --write):\n${missing.join('\n')}`);
    process.exit(1);
  } else console.log('license-headers: every release file has the header');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
