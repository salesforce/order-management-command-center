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
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { moduleDependencies } from "../support/module-graph.mjs";
import { PUBLIC_SOURCES, resolvePath } from "../../public/source-layout.js";

const root = new URL("../../public/", import.meta.url);
const owner = (file) => file.split('/')[0];
export function boundaryProblems(from, dependencies) {
  return dependencies.flatMap((spec) => {
    if (!spec.startsWith('.')) return [`${from}: external/Node dependency ${spec}`];
    const target = resolvePath(from, spec), a = owner(from), b = owner(target);
    if (!['shared', a].includes(b)) return [`${from}: forbidden ${a} -> ${target}`];
    return [];
  });
}

test('dependency inspection includes static/dynamic imports, side effects and re-exports', () => {
  assert.deepEqual(moduleDependencies("import { a } from './a.js'; import './side.js'; export * from '../shared/x.js'; export { b } from './b.js'; const x = import('./lazy.js');"),
    ['./a.js', './side.js', '../shared/x.js', './b.js', './lazy.js']);
  assert.deepEqual(moduleDependencies("// import('./ignored.js')\nconst s = \"import('./string.js')\"; const re = /import\\('ignored'\\)/; export const x = 1;"), []);
});

test('computed and escaped dependencies cannot evade inspection', () => {
  for (const source of ['import(target)', 'import(`./${name}.js`)', "import('./\\x61.js')", 'const s = `${import("./hidden.js")}`', 'require("node:fs")']) assert.throws(() => moduleDependencies(source));
});

test('each forbidden boundary fails, including a dependency reached through shared code', () => {
  for (const [from, imports] of [
    ['operations-console/view.js', ['../service-center/actions/om-actions.js']],
    ['shared/helper.js', ['../operations-console/view.js']],
    ['shared/helper.js', ['../om-core.js']],
    ['operations-console/app.js', ['../../node/shared/host.mjs']],
    ['shared/helper.js', ['node:fs']],
  ]) assert.ok(boundaryProblems(from, imports).length, from);
});

test('every canonical app/shared module resolves and respects dependency ownership', () => {
  const files = [];
  const walk = (folder) => {
    for (const entry of readdirSync(new URL(folder + '/', root), { withFileTypes: true })) {
      const file = folder + '/' + entry.name;
      if (entry.isDirectory()) walk(file); else if (file.endsWith('.js')) files.push(file);
    }
  };
  for (const folder of ['operations-console', 'shared']) walk(folder);
  assert.ok(files.length > 40);
  for (const file of files) {
    assert.ok(Object.values(PUBLIC_SOURCES).includes(file), `${file}: canonical module needs an explicit serving/deployment name`);
    let imports;
    try { imports = moduleDependencies(readFileSync(new URL(file, root), 'utf8')); }
    catch (error) { throw new Error(`${file}: ${error.message}`, { cause: error }); }
    assert.deepEqual(boundaryProblems(file, imports), [], file);
    for (const spec of imports) assert.ok(existsSync(new URL(resolvePath(file, spec), root)), `${file}: ${spec}`);
  }
});

test('all declared legacy public names stay within the canonical browser source tree', () => {
  for (const [legacy, source] of Object.entries(PUBLIC_SOURCES)) {
    assert.match(source, /^(operations-console|shared)\//, legacy);
    assert.ok(!source.includes('..') && !legacy.includes('..'), legacy);
    assert.ok(existsSync(new URL(source, root)), `${legacy} -> ${source}`);
  }
});
