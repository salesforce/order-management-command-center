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
// Builds the edit view: the whole console as one self-contained HTML page with sample data and an edit mode, to
// publish as a Claude Code artifact (the plugin's build-oms-console skill, "Point at what to change"). An artifact is
// one file under a strict CSP, so scripts, modules and images are inlined and the page never fetches anything; the same
// file opens from file:// when artifacts aren't available. public/ is not changed.
// --tokens builds the design tokens' reference page (public/design/) the same way instead: one file, tokens.css inlined.
// Usage: node tools/build-artifact.mjs [--tokens] [out]   (default: artifact/om-console.html, or artifact/om-design-tokens.html)
import nativeFs from 'node:fs';
import { createSourceView, APP_URL } from "../../public/source-layout.js";
const { readFileSync, writeFileSync, mkdirSync, existsSync } = createSourceView(nativeFs, path, (p) => p instanceof URL ? fileURLToPath(p) : p);
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const APP = fileURLToPath(APP_URL);
export const PUBLIC = path.join(APP, 'public');
export const OUT = path.join(APP, 'artifact', 'om-console.html');
export const OUT_TOKENS = path.join(APP, 'artifact', 'om-design-tokens.html');
export const MAX_BYTES = 16 * 1024 * 1024; // an artifact's rendered page may be at most 16 MiB
const NOT_IN_DEMO = new Set(['om-browser.js', 'om-platform.js', 'om-command-browser.js', 'om-command-platform.js', 'om-service-browser.js', 'om-service-platform.js']); // sample data never reaches sign-in
const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' };

const fail = (m) => { throw new Error(`build-artifact: ${m}`); };

// The bundled modules register here; each runs once, on its first import. A module that isn't bundled (the sign-in
// paths, which sample data never reaches) rejects instead of loading.
export const LOADER = `(function () {
  var defs = {}, done = {};
  window.__omcDef = function (name, factory) { defs[name] = factory; };
  window.__omcImport = function (name) {
    if (!defs[name]) return Promise.reject(new Error(name + ' is not in the edit view'));
    return done[name] || (done[name] = defs[name]());
  };
})();`;

const DYN = /\bimport\(\s*(['"])(\.{1,2}\/[\w./-]+\.js)\1\s*\)/g;
const moduleName = (name, spec) => {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), spec));
  if (resolved.startsWith('../') || path.posix.isAbsolute(resolved)) fail(`${name}: import escapes the public source tree: ${spec}`);
  return resolved;
};

// True when a declaration line has a comma outside brackets and strings: `export const A = 1, B = 2`.
function topLevelComma(line) {
  let depth = 0, quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '/' && line[i + 1] === '/') return false;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) return true;
  }
  return false;
}

// One ES module → one inline __omcDef script. Only the forms the console uses are supported; anything else stops the
// build rather than produce a page that breaks at runtime. Returns the exports and the named imports, so buildHtml can
// check them against each other: a real module fails to load on a missing export, but here it would just be undefined.
export function bundleModule(name, src) {
  const exports = [], imports = [], deps = new Set();
  let body = src.replace(/^import\s*\{([^}]*)\}\s*from\s*(['"])(\.{1,2}\/[\w./-]+\.js)\2;?[ \t]*$/gm, (_, list, q, spec) => {
    const dep = moduleName(name, spec);
    deps.add(dep);
    imports.push([dep, list.split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)]);
    return `const {${list.replace(/\s+as\s+/g, ': ')}} = await __omcImport('${dep}');`;
  });
  body = body.replace(/^export\s+((?:async\s+)?function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (m, kind, id, at, all) => {
    const rest = all.slice(at + m.length).split(/\r?\n/)[0];
    if (/^(const|let|var)$/.test(kind) && topLevelComma(rest)) fail(`${name}: one name per export, please: ${m}${rest}`);
    exports.push(id);
    return `${kind} ${id}`;
  });
  // `export { a, b };` exports names the module declares or imports (om-core re-exports two of om-reads'). Renaming and
  // `export … from` aren't supported, and a name that isn't there stops the build instead of failing on import.
  const local = new Set([...src.matchAll(/^import\s*\{([^}]*)\}/gm)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)));
  body = body.replace(/^export\s*\{([^}]*)\}\s*;?[ \t]*$/gm, (m, list) => {
    for (const n of list.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!/^[A-Za-z_$][\w$]*$/.test(n)) fail(`${name}: unsupported export form: ${m.trim()}`);
      if (!local.has(n) && !new RegExp(String.raw`^\s*(?:(?:async\s+)?function\*?|class|const|let|var)\s+${n.replace(/\$/g, '\\$')}\b`, 'm').test(body)) fail(`${name}: exports ${n}, which it doesn't declare or import`);
      exports.push(n);
    }
    return '';
  });
  body = body.replace(DYN, (_, q, spec) => { const dep = moduleName(name, spec); deps.add(dep); return `__omcImport('${dep}')`; });
  const left = body.match(/^\s*(import|export)\b.*$/m);
  if (left) fail(`${name}: unsupported ${left[1]} form: ${left[0].trim()}`);
  if (/\bimport\.meta\b/.test(body)) fail(`${name}: import.meta has no meaning inside the one-page edit view`);
  return { code: `__omcDef('${name}', async () => {\n'use strict';\n${body}\nreturn { ${exports.join(', ')} };\n});`, deps: [...deps], exports, imports };
}

// Replaces, and insists the pattern was there, so a console change can't quietly produce a broken page.
function must(text, pattern, to, what) {
  let n = 0;
  const out = text.replace(pattern, (...a) => { n++; return to(...a); });
  if (!n) fail(`expected ${what} and didn't find it. Update tools/build-artifact.mjs to match the console.`);
  return out;
}

// A stylesheet inlined into <style>: a literal "</style" would end the tag early.
function inlineCss(css, name) {
  if (/<\/style/i.test(css)) fail(`${name} contains "</style", which can't be inlined safely`);
  return css;
}

// Code inlined into <script>: a literal "</script" would end the tag early; "<!--" can confuse the HTML parser.
export function inlineSafe(code, name) {
  if (code.includes('<!--')) fail(`${name} contains "<!--", which can't be inlined safely`);
  return code.replace(/<\/script/gi, '<\\/script');
}

function inlineImages(text, dir, name) {
  return text.replace(/\bsrc="([\w.-]+\.(webp|png|jpe?g|gif|svg))"/g, (_, f, ext) => {
    const p = path.join(dir, f);
    if (!existsSync(p)) fail(`${name} points at ${f}, which isn't in public/`);
    return `src="data:${MIME[ext]};base64,${readFileSync(p).toString('base64')}"`;
  });
}

const SCRIPT_SRC = /<script src="([\w.-]+\.js)"><\/script>/g;
const STYLE_HREF = /<link rel="stylesheet" href="([\w.-]+\.css)">/g; // tokens.css, the design tokens
// What must not be left once everything is inlined: each would be blocked by the artifact's CSP, or wouldn't resolve.
// An attribute value, quoted or not, that isn't an http(s) or data: URL, an in-page #anchor or a ${template} value.
const LOCAL = String.raw`(?:"(?!https?:|data:|#|\$\{)|'(?!https?:|data:|#|\$\{)|(?!["'\s>]|https?:|data:|#))`;
export const LEFTOVERS = [
  [new RegExp(String.raw`<script\b[^>]*\ssrc=${LOCAL}`, 'i'), 'a local <script src>'],
  [/\bimport\(\s*['"]\.\//, "an import('./…')"],
  [/\bfrom\s*['"]\.\//, "an import … from './…'"],
  [/\ssrc=(["'])(?!https?:|data:|\$\{)[^"']+\1/, 'a local src'],
  [new RegExp(String.raw`<link\b[^>]*\shref=${LOCAL}`, 'i'), 'a local <link href>'],
  [/\burl\(\s*["']?(?!data:|https?:|#|\$\{)[\w./-]/, 'a local url()'],
  [/\ssrcset=/i, 'a srcset'],
  [/\.src\s*=\s*["'](?!https?:|data:)/, 'a .src set to a local file'],
];

// The page's mode (om-mode.js) has one switch the builds set: FORCE, 'demo' here and 'platform' for the live console.
export const forceMode = (to) => ({ 'om-mode.js': (src) => must(src, 'const FORCE = null;', () => `const FORCE = '${to}';`, 'the mode switch (const FORCE = null;) in om-mode.js') });

export function buildHtml(publicDir = PUBLIC) {
  const page = readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const picker = inlineSafe(readFileSync(path.join(TOOLS, 'artifact-picker.js'), 'utf8'), 'artifact-picker.js');
  return inlineConsole(page, { publicDir, skip: NOT_IN_DEMO, transform: forceMode('demo'), headExtra: '<style>#logout{display:none}</style>\n', bodyExtra: `<script>\n${picker}\n</script>` }); // Disconnect only reloads in demo
}

// The console page (index.html, as given) as one self-contained file: the modules it imports and theirs, except `skip`, its
// scripts and its images, inlined. find(f) is a module's file (default: public/); transform[f](source) changes one before it's
// bundled (the mode switch). headExtra goes at the end of <head>, before the modules; bodyExtra just before </body>. The edit
// view (above) and the live console (build-live-artifact.mjs --console) both build through here.
const PAGE_MODULE = /<script type="module">\n?([\s\S]*?)<\/script>/;
export function inlineConsole(page, { publicDir = PUBLIC, skip = new Set(), find = (f) => path.join(publicDir, f), transform = {}, headExtra = '', bodyExtra = '' } = {}) {
  const read = (f) => readFileSync(path.join(publicDir, f), 'utf8');

  // The page's own script is a module: bundled like the others (its imports become the loader's), then run once they're in.
  const pm = page.match(PAGE_MODULE);
  if (!pm) fail('expected the console\'s <script type="module"> and didn\'t find it. Update tools/build-artifact.mjs to match the console.');
  const own = bundleModule('index.html', pm[1]);
  page = page.replace(PAGE_MODULE, () => `<script>\n${inlineSafe(own.code, 'index.html')}\n__omcImport('index.html').catch(function (e) { console.error(e); });\n</script>`);

  // Modules: what the page imports, and what those import, except `skip`.
  const mods = new Map(), queue = own.deps.filter((f) => !skip.has(f));
  if (!queue.includes('agent-panel.js')) fail("expected import('./agent-panel.js') in index.html");
  while (queue.length) {
    const f = queue.shift();
    if (mods.has(f)) continue;
    const file = find(f);
    if (!file || !existsSync(file)) fail(`${f} is imported but isn't in public/`);
    const m = bundleModule(f, inlineImages((transform[f] || ((s) => s))(readFileSync(file, 'utf8')), publicDir, f));
    mods.set(f, m);
    queue.push(...m.deps.filter((d) => !skip.has(d)));
  }
  for (const [f, m] of [['index.html', own], ...mods]) for (const [dep, names] of m.imports) {
    const d = mods.get(dep);
    if (!d && !skip.has(dep)) fail(`${f} imports ${dep}, which isn't in the page`);
    for (const n of d ? names : []) if (!d.exports.includes(n)) fail(`${f} imports ${n} from ${dep}, which doesn't export it`);
  }

  // Split at the page's own </head> before inlining anything, so inlined code can't be mistaken for the page's tags.
  // The generated scripts go at the end of <head>: after <meta charset> (which must stay in the first 1024 bytes) and
  // before the body script that imports the modules.
  const end = page.indexOf('</head>');
  if (end < 0) fail("expected the </head> tag and didn't find it. Update tools/build-artifact.mjs to match the console.");
  if (!SCRIPT_SRC.test(page)) fail("expected local <script src> tags and didn't find them. Update tools/build-artifact.mjs to match the console.");
  let [head, body] = [page.slice(0, end), page.slice(end)].map((part) => inlineImages(part
    .replace(DYN, (_, q, f) => `__omcImport('${f}')`)
    .replace(STYLE_HREF, (_, f) => {
      if (!existsSync(path.join(publicDir, f))) fail(`index.html links ${f}, which isn't in public/`);
      return `<style>\n${inlineCss(read(f), f)}\n</style>`;
    })
    .replace(SCRIPT_SRC, (_, f) => {
      if (!existsSync(path.join(publicDir, f))) fail(`index.html loads ${f}, which isn't in public/`);
      return `<script>\n${inlineSafe(read(f), f)}\n</script>`;
    }), publicDir, 'index.html'));
  const gen = [LOADER, ...[...mods].map(([f, m]) => inlineSafe(m.code, f))].map((c) => `<script>\n${c}\n</script>`).join('\n');
  head += `${headExtra}${gen}\n`;
  if (bodyExtra) body = must(body, /<\/body>(?![\s\S]*<\/body>)/, () => `${bodyExtra}\n</body>`, 'the </body> tag');

  const html = head + body;
  for (const [re, what] of LEFTOVERS) if (re.test(html)) fail(`${what} is left in the page: ${html.match(re)[0]}…`);
  return html;
}

// The design tokens' reference page as one file: its link to ../tokens.css becomes a <style>. Its script is inline already.
export function buildTokensHtml(publicDir = PUBLIC) {
  const page = readFileSync(path.join(publicDir, 'design', 'index.html'), 'utf8');
  const css = inlineCss(readFileSync(path.join(publicDir, 'tokens.css'), 'utf8'), 'tokens.css');
  const html = must(page, '<link rel="stylesheet" href="../tokens.css">', () => `<style>\n${css}\n</style>`, 'the link to ../tokens.css in design/index.html');
  for (const [re, what] of LEFTOVERS) if (re.test(html)) fail(`${what} is left in design/index.html: ${html.match(re)[0]}…`);
  return html;
}

export function buildArtifact({ publicDir = PUBLIC, tokens = false, out = tokens ? OUT_TOKENS : OUT } = {}) {
  const html = tokens ? buildTokensHtml(publicDir) : buildHtml(publicDir), bytes = Buffer.byteLength(html);
  if (bytes > MAX_BYTES) fail(`the page is ${bytes} bytes; an artifact may be at most ${MAX_BYTES}`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, html);
  return { out, bytes };
}

export async function main() {

  try {
    const args = process.argv.slice(2), tokens = args.includes('--tokens'), file = args.find((a) => !a.startsWith('--'));
    const { out, bytes } = buildArtifact({ tokens, ...(file ? { out: path.resolve(file) } : {}) });
    console.log(`Built ${out} (${Math.round(bytes / 1024)} KB, ${tokens ? 'the design tokens' : 'sample data only'})`);
  } catch (e) { console.error(e.message); process.exit(1); }

}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
