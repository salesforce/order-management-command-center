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
// The Apache-2.0 header OSPO asks for (app/tools/license-headers.mjs): every file a release carries that takes comments has it,
// in the place its format allows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { addHeader, hasHeader, missingHeaders, releaseFiles, styleFor } from '../../../tools/license-headers.mjs';

let git = true;
try { execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: import.meta.dirname, stdio: 'ignore' }); } catch { git = false; }

test('every release file that takes comments has the header', { skip: !git && 'not a git checkout' }, () => {
  assert.ok(releaseFiles().length > 300, 'the release file list looks too short');
  assert.deepEqual(missingHeaders(), [], 'run: node app/tools/license-headers.mjs --write');
});

test('each format gets its own comment style', () => {
  assert.equal(styleFor('app/public/om-core.js'), 'block');
  assert.equal(styleFor('app/tools/build-artifact.mjs'), 'block');
  assert.equal(styleFor('org/x/classes/A.cls'), 'block');
  assert.equal(styleFor('app/public/theme.css'), 'block');
  assert.equal(styleFor('.github/workflows/test.yml'), 'hash');
  assert.equal(styleFor('.gitignore'), 'hash');
  assert.equal(styleFor('app/public/index.html'), 'html');
  assert.equal(styleFor('org/x/lwc/frame/frame.html'), 'lwc');
  assert.equal(styleFor('org/x/classes/A.cls-meta.xml'), 'xml');
  for (const f of ['package.json', 'README.md', 'NOTICE', 'LICENSE.txt', 'app/tools/playwright-core.version']) assert.equal(styleFor(f), null, f);
});

test('the header goes after a shebang, an XML declaration and a doctype, and inside an LWC template', () => {
  const js = addHeader('#!/usr/bin/env node\nconsole.log(1);\n', 'block');
  assert.match(js, /^#!\/usr\/bin\/env node\n\/\*\n \* Copyright \(c\) 2026, Salesforce, Inc\.\n/);
  assert.match(js, / \*\/\nconsole\.log\(1\);\n$/);

  const xml = addHeader('<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass/>\n', 'xml');
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!--\n {2}Copyright/);
  assert.match(xml, /-->\n<ApexClass\/>\n$/);

  const html = addHeader('<!doctype html>\n<html lang="en">\n', 'html');
  assert.match(html, /^<!doctype html>\n<!--\n/);

  const lwc = addHeader('<template>\n    <div></div>\n</template>\n', 'lwc');
  assert.match(lwc, /^<template>\n {4}<!--\n {6}Copyright/);
  assert.match(lwc, / {4}-->\n {4}<div><\/div>\n<\/template>\n$/);

  const yml = addHeader('name: Tests\n', 'hash');
  assert.match(yml, /^# Copyright \(c\) 2026, Salesforce, Inc\.\n# SPDX-License-Identifier: Apache-2\.0\n#\n/);
  assert.match(yml, /# limitations under the License\.\nname: Tests\n$/);
});

test('a file that already has the header is left alone', () => {
  const once = addHeader('const a = 1;\n', 'block');
  assert.ok(hasHeader(once));
  assert.equal(addHeader(once, 'block'), once);
});
