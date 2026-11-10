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
import { APP_URL } from "../../public/source-layout.js";
// Syntax-check application and tooling modules recursively before sources move into scoped folders.
// Tests are parsed by node --test; generated artifacts and installed dependencies are not source.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL("..", APP_URL));
const GENERATED = new Set(['app/test', 'app/artifact', 'app/coverage']);

export function sourceFiles(root = ROOT) {
  const files = [];
  const walk = (relative) => {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (GENERATED.has(name) || entry.name === 'node_modules') continue;
      if (entry.isSymbolicLink()) throw new Error(`Syntax source must not be a symlink: ${name}`);
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)) files.push(name);
    }
  };
  walk('app');
  return files.sort();
}

export function checkSyntax(root = ROOT) {
  const files = sourceFiles(root);
  if (!files.length) throw new Error('No application or tooling modules found to syntax-check');
  const failures = [];
  for (const file of files) {
    // Reading stdin as a module treats .js and .mjs equally and never executes their imports or code.
    const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
      input: readFileSync(path.join(root, file), 'utf8'), encoding: 'utf8',
    });
    if (result.error || result.status !== 0) failures.push({ file, error: result.error?.message || result.stderr || `exit ${result.status}` });
  }
  return { checked: files.length, failures };
}

export async function main() {

  try {
    const { checked, failures } = checkSyntax(process.argv[2] || ROOT);
    for (const { file, error } of failures) console.error(`syntax: ${file}\n${error}`);
    if (failures.length) process.exitCode = 1;
    else console.log(`Syntax checked ${checked} application/tooling modules`);
  } catch (error) {
    console.error(`syntax: ${error.message}`);
    process.exitCode = 1;
  }

}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
