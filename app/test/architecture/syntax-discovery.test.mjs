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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceFiles, checkSyntax } from "../../tools/check-syntax.mjs";

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-syntax-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'app'));
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return root;
}

test('syntax discovery includes nested app, shared, Node and tooling modules exactly once', (t) => {
  const files = {
    'app/server.mjs': 'export {};',
    'app/public/operations-console/data/core.js': 'export {};',
    'app/public/service-center/actions/action.js': 'export {};',
    'app/public/shared/data/runtime.js': 'export {};',
    'app/public/shared/.helper.mjs': 'export {};',
    'app/node/shared/host.mjs': 'export {};',
    'app/tools/shared/check.mjs': 'export {};',
    'app/public/operations-console/test/example.js': 'export {};',
  };
  const root = fixture(t, { ...files, 'app/public/shared/tokens.css': '', 'docs/example.mjs': 'invalid source' });
  assert.deepEqual(sourceFiles(root), Object.keys(files).sort());
});

test('generated artifacts, test fixtures and installed modules stay outside production syntax discovery', (t) => {
  const root = fixture(t, {
    'app/server.mjs': 'export {};',
    'app/test/support/intentionally-invalid.js': 'export const =',
    'app/artifact/generated.js': 'export const =',
    'app/coverage/generated.js': 'export const =',
    'app/tools/node_modules/vendor/index.js': 'export const =',
  });
  assert.deepEqual(checkSyntax(root), { checked: 1, failures: [] });
});

test('nested .js and .mjs syntax failures report their actual source paths', (t) => {
  const root = fixture(t, {
    'app/server.mjs': 'export {};',
    'app/public/shared/deep/bad.js': 'export const value = ;',
    'app/node/service-center/bad.mjs': 'export function broken( {',
  });
  const result = checkSyntax(root);
  assert.equal(result.checked, 3);
  assert.deepEqual(result.failures.map((x) => x.file), ['app/node/service-center/bad.mjs', 'app/public/shared/deep/bad.js']);
  for (const failure of result.failures) assert.match(failure.error, /SyntaxError/);
});

test('syntax checks parse ES modules without executing code or resolving imports', (t) => {
  const root = fixture(t, { 'app/server.mjs': "import './missing.mjs';\nexport const result = await Promise.resolve(1);\nthrow new Error('must not execute');" });
  assert.deepEqual(checkSyntax(root), { checked: 1, failures: [] });
});

test('empty source trees fail rather than producing an empty green check', (t) => {
  assert.throws(() => checkSyntax(fixture(t, {})), /No application or tooling modules/);
});

test('symlinks cannot hide source or send discovery outside the checkout', (t) => {
  const root = fixture(t, { 'app/server.mjs': 'export {};' });
  fs.symlinkSync(path.join(root, 'app/server.mjs'), path.join(root, 'app/alias.mjs'));
  assert.throws(() => sourceFiles(root), /must not be a symlink: app\/alias\.mjs/);
});

test('syntax CLI fails on nested invalid code and names the file', (t) => {
  const root = fixture(t, { 'app/public/shared/broken.js': 'export const broken = ;' });
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../tools/check-syntax.mjs", import.meta.url)), root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /syntax: app\/public\/shared\/broken\.js/);
});

test('both CI systems use the recursive syntax checker', () => {
  const root = new URL("../../../", import.meta.url);
  const github = fs.readFileSync(new URL('.github/workflows/test.yml', root), 'utf8');
  assert.match(github, /run: node app\/tools\/check-syntax\.mjs/);
  const strata = new URL('.strata.yml', root);
  if (fs.existsSync(strata)) assert.match(fs.readFileSync(strata, 'utf8'), /node app\/tools\/check-syntax\.mjs/);
});
