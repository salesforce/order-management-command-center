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
// Builds the live briefing: one self-contained page that reads Order Management through the viewer's Salesforce (Headless
// 360) connector, to publish as a Cowork artifact allowed to call dispatch_readonly only. It inlines the page
// (tools/artifact-live.*), its connector adapter, and om-core.js with what it imports, the same way as the edit view
// (build-artifact.mjs). public/ is not changed.
// --local builds the copy tools/serve-live.mjs serves: artifact-call-local.js answers for artifact-call.js, so the same page
// reads the org through a local stand-in for the connector instead of Cowork.
// --console builds the full Salesforce Order Management Operations Console the same way (index.html in its "inside Salesforce" mode, with om-cowork.js reading
// through the connector, batched into GraphQL where it can be).
// --skill writes the Cowork skill that publishes them (tools/cowork-skill/ and both pages, plus the design tokens' page, which
// reads nothing) to artifact/om-console-live/, and that folder zipped, for installing in Cowork.
// Usage: node tools/build-live-artifact.mjs [--console] [--local | --skill] [out]
//   (default: artifact/om-live.html; with --console artifact/om-console-live.html; --local adds -local to the name)
import nativeFs from 'node:fs';
import { createSourceView, APP_URL } from "../../public/source-layout.js";
const { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } = createSourceView(nativeFs, path, (p) => p instanceof URL ? fileURLToPath(p) : p);
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOADER, LEFTOVERS, MAX_BYTES, PUBLIC, bundleModule, inlineSafe, inlineConsole, buildTokensHtml, forceMode } from "./build-artifact.mjs";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.join(fileURLToPath(APP_URL), 'artifact', 'om-live.html');
export const OUT_LOCAL = path.join(fileURLToPath(APP_URL), 'artifact', 'om-live-local.html');
export const OUT_CONSOLE = path.join(fileURLToPath(APP_URL), 'artifact', 'om-console-live.html');
export const ENTRY = 'artifact-live.js';
export const SKILL = 'om-console-live';
export const PAGES = { console: 'om-console.html', briefing: 'om-live-briefing.html' }; // in the skill's folder
export const STATIC_PAGES = { tokens: 'om-design-tokens.html' }; // also there; no connector, so nothing to configure
// The #omc-tools block in artifact-live.html as built, which cowork-skill/configure.py fills with the viewer's tool name.
export const PLACEHOLDER = '{"__placeholder":"OMC_TOOLS"}';
const LOCAL = { 'artifact-call.js': 'artifact-call-local.js' };

const fail = (m) => { throw new Error(`build-live-artifact: ${m}`); };

// A module is the page's own (tools/) or the console's (public/).
const find = (f, publicDir) => [TOOLS, publicDir].map((d) => path.join(d, f)).find((p) => existsSync(p)) || fail(`${f} is imported but isn't in tools/ or public/`);

export function buildLiveHtml({ publicDir = PUBLIC, local = false } = {}) {
  const mods = new Map(), queue = [ENTRY];
  while (queue.length) {
    const f = queue.shift();
    if (mods.has(f)) continue;
    const m = bundleModule(f, readFileSync(find((local && LOCAL[f]) || f, publicDir), 'utf8'));
    mods.set(f, m);
    queue.push(...m.deps);
  }
  for (const [f, m] of mods) for (const [dep, names] of m.imports) {
    for (const n of names) if (!mods.get(dep).exports.includes(n)) fail(`${f} imports ${n} from ${dep}, which doesn't export it`);
  }

  const page = readFileSync(path.join(TOOLS, 'artifact-live.html'), 'utf8');
  const end = page.lastIndexOf('</body>');
  if (end < 0) fail("expected </body> in artifact-live.html and didn't find it");
  const start = `__omcImport('${ENTRY}').catch(function (e) { document.getElementById('state').textContent = 'Failed to start: ' + e.message; });`;
  const gen = [LOADER, ...[...mods].map(([f, m]) => inlineSafe(m.code, f)), start].map((c) => `<script>\n${c}\n</script>`).join('\n');
  const html = `${page.slice(0, end)}${gen}\n${page.slice(end)}`;
  for (const [re, what] of LEFTOVERS) if (re.test(html)) fail(`${what} is left in the page: ${html.match(re)[0]}…`);
  return html;
}

// Replaces `from` in the console's page, and insists it was there exactly once, so a console change can't quietly produce a page
// that reads the wrong way.
const swap = (text, from, to, what) => {
  const n = text.split(from).length - 1;
  if (n !== 1) fail(`expected ${what} once in index.html and found it ${n} times. Update tools/build-live-artifact.mjs to match the console.`);
  return text.replace(from, () => to);
};

// The full console for Cowork: index.html with its "inside Salesforce" mode on (om-mode.js's FORCE, so no sign-in of its own)
// and om-cowork.js in om-platform.js's place, so every read goes through the connector. The sign-in path (om-browser.js) isn't
// in the page, and Agentforce's button is hidden: its chat needs the Agent API's POSTs.
export function buildConsoleHtml({ publicDir = PUBLIC, local = false } = {}) {
  let page = readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  page = swap(page, "import('./om-command-platform.js')", "import('./om-cowork.js')", "import('./om-command-platform.js')");
  const find = (f) => [publicDir, TOOLS].map((d) => path.join(d, (local && LOCAL[f]) || f)).find((p) => existsSync(p));
  const block = `<!-- The viewer's connector tool name, written in by cowork-skill/configure.py when the page is published. -->\n<script id="omc-tools" type="application/json">${PLACEHOLDER}</script>\n`;
  return inlineConsole(page, { publicDir, skip: new Set(['om-browser.js', 'om-platform.js', 'om-command-browser.js', 'om-command-platform.js']), find, transform: forceMode('platform'), headExtra: `${block}<style>.agent-btn{display:none}</style>\n` });
}

export function buildLiveArtifact({ publicDir = PUBLIC, local = false, console: whole = false, out = whole ? (local ? OUT_CONSOLE.replace(/\.html$/, '-local.html') : OUT_CONSOLE) : local ? OUT_LOCAL : OUT } = {}) {
  const html = (whole ? buildConsoleHtml : buildLiveHtml)({ publicDir, local }), bytes = Buffer.byteLength(html);
  if (bytes > MAX_BYTES) fail(`the page is ${bytes} bytes; an artifact may be at most ${MAX_BYTES}`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, html);
  return { out, bytes };
}

// The skill folder: SKILL.md, configure.py, the two unconfigured pages (each must hold configure.py's placeholder once) and
// the design tokens' page (which must not: it calls no tool), and the folder zipped next to it unless zip is false.
export function buildSkill({ publicDir = PUBLIC, dir = path.dirname(OUT), zip = true } = {}) {
  const pages = { [PAGES.console]: buildConsoleHtml({ publicDir }), [PAGES.briefing]: buildLiveHtml({ publicDir }) };
  for (const [f, html] of Object.entries(pages)) {
    const bytes = Buffer.byteLength(html);
    if (bytes > MAX_BYTES) fail(`${f} is ${bytes} bytes; an artifact may be at most ${MAX_BYTES}`);
    if (html.split(PLACEHOLDER).length !== 2) fail(`expected the connector placeholder ${PLACEHOLDER} once in ${f}`);
  }
  const statics = { [STATIC_PAGES.tokens]: buildTokensHtml(publicDir) };
  for (const [f, html] of Object.entries(statics)) {
    if (Buffer.byteLength(html) > MAX_BYTES) fail(`${f} is ${Buffer.byteLength(html)} bytes; an artifact may be at most ${MAX_BYTES}`);
    if (html.includes(PLACEHOLDER) || /callMcpTool/.test(html)) fail(`${f} must not call a connector tool`);
  }
  const out = path.join(dir, SKILL), src = path.join(TOOLS, 'cowork-skill');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const [f, html] of Object.entries({ ...pages, ...statics })) writeFileSync(path.join(out, f), html);
  for (const f of ['SKILL.md', 'configure.py']) copyFileSync(path.join(src, f), path.join(out, f));
  if (!zip) return { out, zip: null };
  const file = path.join(dir, `${SKILL}-skill.zip`);
  rmSync(file, { force: true });
  const z = spawnSync('zip', ['-qr', file, SKILL], { cwd: dir, encoding: 'utf8' });
  if (z.status !== 0) fail(`zip failed: ${z.error?.message || z.stderr || z.status}`);
  return { out, zip: file };
}

export async function main() {

  try {
    const args = process.argv.slice(2), local = args.includes('--local'), whole = args.includes('--console'), file = args.find((a) => !a.startsWith('--'));
    if (args.includes('--skill')) {
      const { out, zip } = buildSkill(file ? { dir: path.resolve(file) } : {});
      console.log(`Built the Cowork skill in ${out}, and ${zip} to install`);
    } else {
      const { out, bytes } = buildLiveArtifact({ local, console: whole, ...(file ? { out: path.resolve(file) } : {}) });
      console.log(`Built ${out} (${Math.round(bytes / 1024)} KB, live through ${local ? 'tools/serve-live.mjs and the sf CLI' : 'the Salesforce connector in Cowork'})`);
    }
  } catch (e) { console.error(e.message); process.exit(1); }

}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
