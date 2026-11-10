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
// Builds the Salesforce Order Management Operations Console as a Salesforce Multi-Framework app (UIBundle SOM_Console) from app/public, without changing it.
// The app domain's Content-Security-Policy allows only script files ('self'), so the page's inline <script> blocks are
// written out as inline-N.js and referenced by src. Everything else is copied as is. Deploy with org/console-app (README).
// Usage: node app/tools/build-ui-bundle.mjs (or node tools/build-ui-bundle.mjs in a copy).
import nativeFs from 'node:fs';
import { createSourceView, PUBLIC_SOURCES, resolvePath, APP_URL } from "../../public/source-layout.js";
const { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } = createSourceView(nativeFs, path, (p) => p instanceof URL ? fileURLToPath(p) : p);
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Works in the console repo (app/tools → app/public, ../org/console-app) and in a copy made by the plugin's
// build-oms-console skill (tools → public, org/console-app).
const APP = fileURLToPath(APP_URL);
const ROOT = existsSync(path.join(APP, 'org')) ? APP : path.dirname(APP);
const PUBLIC = path.join(APP, 'public');
export const BUNDLE = path.join(ROOT, 'org', 'console-app', 'force-app', 'main', 'default', 'uiBundles', 'SOM_Console');
const SKIP = new Set(['source-layout.js']); // distribution metadata is not an application asset
// One implementation per legacy filename. Deployment bundles remain flat; source imports use the owner folders.
export const SOURCE_MODULES = PUBLIC_SOURCES;
const sourceOf = (name) => SOURCE_MODULES[name] || name;
export const flattenScoped = (text) => text.replace(/(\bimport\s*\(\s*|\bfrom\s*)(['"])(?:\.{1,2}\/)+(?:shared\/transport\/)([\w.-]+\.js)\2/g, '$1$2./$3$2');
export function uniqueFiles(files) {
  const seen = new Map();
  for (const [name, source] of files) {
    if (seen.has(name)) throw new Error(`UIBundle filename collision: ${name} (${seen.get(name)} and ${source})`);
    seen.set(name, source);
  }
  return files;
}

// Inline scripts → files, in order, so execution order is the same as in the original page. A module script stays a module.
export function splitInlineScripts(html) {
  const files = [];
  const out = html.replace(/<script( type="module")?>([\s\S]*?)<\/script>/g, (_, mod = '', code) => { files.push(code); return `<script${mod} src="inline-${files.length}.js"></script>`; });
  return { html: out, files };
}

// The app domain caches files across deploys, so every local script and stylesheet reference gets ?v=<hash of this build>:
// in script src and stylesheet href attributes and in import specifiers inside the page and the modules, the same
// everywhere, so no module loads twice.
export function versionRefs(text, v) {
  return text
    .replace(/(<script[^>]*\ssrc=")([\w.-]+\.js)(")/g, `$1$2?v=${v}$3`)
    .replace(/(<link rel="stylesheet" href=")([\w.-]+\.css)(")/g, `$1$2?v=${v}$3`)
    .replace(/(\bimport\s*\(\s*|\bfrom\s*)(['"])\.\/([\w.-]+\.js)\2/g, `$1$2./$3?v=${v}$2`);
}

export function build({ publicDir = PUBLIC, bundle = BUNDLE } = {}) {
  const src = path.join(bundle, 'src');
  const names = commandFiles(publicDir);
  rmSync(bundle, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  const hash = createHash('sha256');
  for (const f of names) hash.update(f).update(readFileSync(path.join(publicDir, sourceOf(f))));
  const v = hash.digest('hex').slice(0, 10);
  for (const f of names) {
    const from = path.join(publicDir, sourceOf(f));
    if (f === 'index.html') {
      const { html, files } = splitInlineScripts(readFileSync(from, 'utf8'));
      writeFileSync(path.join(src, f), versionRefs(html, v));
      files.forEach((code, i) => writeFileSync(path.join(src, `inline-${i + 1}.js`), versionRefs(code, v)));
    } else if (f.endsWith('.js')) writeFileSync(path.join(src, f), versionRefs(flattenScoped(readFileSync(from, 'utf8')), v));
    else writeFileSync(path.join(src, f), readFileSync(from));
  }
  writeFileSync(path.join(bundle, 'ui-bundle.json'), JSON.stringify({ outputDir: 'src', routing: { trailingSlash: 'never', fallback: 'index.html' } }, null, 2) + '\n');
  writeFileSync(path.join(bundle, 'SOM_Console.uibundle-meta.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<UIBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <masterLabel>Salesforce Order Management Operations Console</masterLabel>
    <description>Read-only Order Management console. Built from app/public by app/tools/build-ui-bundle.mjs.</description>
    <isActive>true</isActive>
    <version>1</version>
    <target>CustomApplication</target>
</UIBundle>
`);
  return readdirSync(src).length;
}

// Follow the app's actual dependency graph; the bundle ships only what the console page reaches.
export function commandFiles(publicDir = PUBLIC) {
  const queue = ['index.html'], seen = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file) || SKIP.has(file)) continue;
    if (!existsSync(path.join(publicDir, file))) throw new Error(`UIBundle module missing: ${file}`);
    seen.add(file);
    if (!/\.(js|html)$/.test(file)) continue;
    const text = readFileSync(path.join(publicDir, file), 'utf8');
    const imports = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.{1,2}\/[^'"]+\.js)['"]/g)].map((m) => resolvePath(file, m[1]));
    const assets = [...text.matchAll(/(?:src|href)="([\w./-]+\.(?:js|css))"/g)].map((m) => resolvePath(file, './' + m[1]));
    queue.push(...imports, ...assets);
  }
  uniqueFiles([...seen].map((file) => [path.posix.basename(file), file]));
  return [...seen].sort();
}

export async function main() {
  console.log(`Built ${path.relative(ROOT, BUNDLE)} (${build()} files)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
