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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from "../../support/source-view.mjs";
import { splitInlineScripts, versionRefs } from "../../../tools/build-ui-bundle.mjs";

test('inline scripts become files in order, and script tags with src stay as they are', () => {
  const { html, files } = splitInlineScripts('<head><script src="a.js"></script><script>one()</script></head><body><script>\ntwo()\n</script></body>');
  assert.equal(html, '<head><script src="a.js"></script><script src="inline-1.js"></script></head><body><script src="inline-2.js"></script></body>');
  assert.deepEqual(files, ['one()', '\ntwo()\n']);
});

test('the real page has no inline script left after the split, and no inline event handlers (the app domain blocks both)', () => {
  const page = readFileSync(new URL("../../../public/operations-console/index.html", import.meta.url), 'utf8');
  const { html } = splitInlineScripts(page);
  assert.doesNotMatch(html, /<script( type="module")?>(?!<)/);
  assert.match(html, /<script type="module" src="inline-\d\.js"><\/script>/);
  assert.doesNotMatch(page, /<[a-z][^>]*\son(click|change|input|load|error|submit|key\w+)="/i);
});

test('the console page takes its mode from om-mode.js, where the in-org mode is the Salesforce app domain (mode.test.mjs)', () => {
  const read = (p) => readFileSync(new URL(p, new URL("../../", import.meta.url)), 'utf8');
  assert.match(read('../public/index.html'), /import \{ DEMO, PLATFORM, BROWSER \} from '\.\/om-mode\.js';/);
  assert.match(read('../public/om-mode.js'), /\/\\\.my\\\.salesforce\\\.app\$\/i\.test\(hostname\)/);
});

test('every local script reference gets the build version, so a redeploy never runs cached files', () => {
  const page = '<script src="geo.js"></script><script src="inline-1.js"></script><script src="https://x.example/a.js"></script>';
  assert.equal(versionRefs(page, 'abc'), '<script src="geo.js?v=abc"></script><script src="inline-1.js?v=abc"></script><script src="https://x.example/a.js"></script>');
  const mod = "import { createCore } from './om-core.js';\nconst m = await import('./om-platform.js');\nimport x from './support/source-view.mjs';";
  assert.equal(versionRefs(mod, 'abc'), "import { createCore } from './om-core.js?v=abc';\nconst m = await import('./om-platform.js?v=abc');\nimport x from './support/source-view.mjs';");
});

test('the console never loads the write layer', () => {
  const read = (p) => readFileSync(new URL(p, new URL("../../", import.meta.url)), 'utf8');
  const imports = /(from\s*|import\s*\(\s*)['"][^'"]*om-actions\.js['"]/;
  // The read model is om-core.js and the modules it's made of (om-core-*.js, om-http.js, om-rules.js); none may load the write layer.
  const model = readdirSync(new URL("../../../public/", import.meta.url)).filter((f) => /^om-core(-[\w-]+)?\.js$|^om-(http|rules)\.js$/.test(f));
  assert.ok(model.length > 3, model.join());
  for (const f of model) assert.doesNotMatch(read(`../public/${f}`), imports, f);
  assert.doesNotMatch(read('../public/index.html'), imports);
  assert.doesNotMatch(read('../public/index.html'), /enableActions/);
});

test('the design tokens are versioned like the scripts', () => {
  assert.equal(versionRefs('<link rel="stylesheet" href="tokens.css"><link href="https://x.example/a.css" rel="stylesheet">', 'abc'),
    '<link rel="stylesheet" href="tokens.css?v=abc"><link href="https://x.example/a.css" rel="stylesheet">');
});
