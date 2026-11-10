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
// The Operations Console page as the text tests read it: index.html, its own module script, and every script the page reaches
// (its <script src>, and each static or dynamic import, followed through the files they import), so a check of what the code
// says (accessibility patterns, no colour literals) covers the console's code wherever it lives and whatever it is called.
// OM Service Console's service/ folder isn't reachable from the console page, so it stays out. Tests of behaviour import the modules.
import { readFileSync } from "./source-view.mjs";
import path from 'node:path';

const dir = new URL("../../public/", import.meta.url);
export const html = readFileSync(new URL('index.html', dir), 'utf8');
const at = html.indexOf('<script type="module">');
// The page's own script, from its <script type="module"> tag to the end of it.
export const pageScript = html.slice(at, html.indexOf('</script>', at));

// The files a piece of code loads: `<script src="x.js">`, `from './x.js'` (also `export * from`), `import('./x.js')` and
// `import './x.js'`, in either quote or a template literal, with or without a `?v=` query, in this folder only. A path this
// misses (a subfolder, `../`) is caught by the "every .js the console names is scanned" test in console-guard.test.mjs.
const REACH = /(?:<script[^>]*\ssrc=["']|\bfrom\s*["'`]|\bimport\s*\(\s*["'`]|\bimport\s*["'`])\.?\/?([\w.-]+\.js)(?=[?"'`])/g;
const reach = (text) => [...text.matchAll(REACH)].map((m) => m[1]);
// The data and transport layer (om-*.js) is tested on its own, and the console reaches the write layer only through om-browser.js.
const UI = (f) => !path.posix.basename(f).startsWith('om-');
const seen = new Set(), todo = reach(html).filter(UI);
for (let f; (f = todo.pop()) !== undefined;) {
  if (seen.has(f)) continue;
  seen.add(f);
  todo.push(...reach(readFileSync(new URL(f, dir), 'utf8')).filter(UI));
}
// Artwork painted onto a texture, not page styling, drawn in its own colours (not themeable), so its file isn't scanned for
// colour literals. Add a file here only for drawn artwork, with the reason. There is none now.
const ARTWORK = new Set([]);
export const ARTWORK_FILES = ARTWORK;
export const MODULES = [...seen].filter((f) => !ARTWORK.has(f)).sort();
export const modules = Object.fromEntries(MODULES.map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]));
// The console's code in one string: the page's script, then each file it reaches.
export const consoleCode = [pageScript, ...Object.values(modules)].join('\n');
// The page with its files after it, for checks that read markup and code together.
export const consoleText = [html, ...Object.values(modules)].join('\n');
