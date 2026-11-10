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
// The guidance a person (or their AI tool) is handed for changing the console: it has to point at files that exist and
// commands that work, or it sends them the wrong way. Reads the docs; nothing here runs the commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from "../../support/source-view.mjs";

const root = new URL("../../../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const claude = read('CLAUDE.md');
const start = claude.slice(claude.indexOf('## Changing the Operations Console? Start here'), claude.indexOf('## Architecture in one paragraph'));
const SUITE = 'node --test "app/test/**/*.test.mjs"';

test('CLAUDE.md opens with the console quick start, and every file it names exists', () => {
  assert.ok(start.length > 500, 'the quick start is at the top, before the architecture');
  const files = [...start.matchAll(/`((?:console-[\w-]+|agent-panel)\.js)`/g)].map((m) => m[1]);
  assert.ok(files.length >= 7, files.join(', '));
  for (const f of files) assert.ok(existsSync(new URL(`app/public/${f}`, root)), f);
  assert.match(start, /Data map/);
  for (const rule of ['?demo=1', 'tokens.css', 'console-demo.js', 'om-reads.js', 'om-actions.js', SUITE]) assert.ok(start.includes(rule), rule);
});

test('the files the quick start links to exist', () => {
  for (const m of start.matchAll(/\]\((docs\/[\w./-]+|[A-Z]+\.md)\)/g)) assert.ok(existsSync(new URL(m[1], root)), m[1]);
  for (const f of ['docs/operations-console/changing-the-console.md', 'docs/shared/design-tokens.md', 'AGENTS.md', '.github/pull_request_template.md']) assert.ok(existsSync(new URL(f, root)), f);
});

test('AGENTS.md sends other AI tools to the same quick start', () => {
  const a = read('AGENTS.md');
  assert.match(a, /CLAUDE\.md/);
  assert.match(a, /Changing the Operations Console\? Start here/);
  assert.ok(a.includes(SUITE));
  assert.match(a, /docs\/operations-console\/changing-the-console\.md/);
});

test('the pull request template asks for a test and the sample-data check', () => {
  const t = read('.github/pull_request_template.md');
  assert.match(t, /\*\*Test:\*\*/);
  assert.match(t, /\?demo=1/);
  assert.match(t, /tokens\.css/);
});

test('the walkthrough and the Edit view prompt carry the same two rules and the same command', () => {
  const d = read('docs/operations-console/changing-the-console.md'), picker = read('app/tools/artifact-picker.js');
  assert.ok(d.includes('node --test "app/test/**/*.test.mjs"'));
  assert.match(d, /design tokens/);
  assert.match(picker, /design tokens in app\/public\/shared\/ui\/tokens\.css/);
  assert.ok(picker.includes(SUITE));
  // CI adds reporters for the case-preservation gate; it must still run this same recursive glob.
  assert.match(read('.github/workflows/test.yml'), /node --test[^\n]*(?:\\\n[^\n]*)*"app\/test\/\*\*\/\*\.test\.mjs"/, 'CI uses the same recursive test pattern');
  for (const folder of ['operation-console', 'dashboard', 'limits', 'side-panel', 'service-console']) assert.ok(existsSync(new URL(`app/test/operations-console/ui/${folder}/`, root)), folder);
});

test('the docs say GitHub Actions runs the tests', () => {
  for (const f of ['CONTRIBUTING.md', 'ARCHITECTURE.md', 'CLAUDE.md']) assert.match(read(f), /\.github\/workflows\/test\.yml/, f);
});

test('the README and CONTRIBUTING.md link the license, security policy and code of conduct, and the files exist', () => {
  for (const f of ['LICENSE.txt', 'SECURITY.md', 'CODE_OF_CONDUCT.md']) assert.ok(existsSync(new URL(f, root)), f);
  for (const doc of ['README.md', 'CONTRIBUTING.md']) for (const f of ['SECURITY.md', 'CODE_OF_CONDUCT.md']) assert.ok(read(doc).includes(`](${f})`), `${doc} → ${f}`);
  // The wording OSPO's template (github.com/salesforce/oss-template) asks for.
  assert.match(read('SECURITY.md'), /https:\/\/www\.sfdc\.co\/SubmitVuln/);
  // CODEOWNERS names an internal team, so .gitattributes keeps it out of `git archive`; the published repo adds its own.
  if (existsSync(new URL('CODEOWNERS', root))) assert.match(read('CODEOWNERS'), /^#ECCN:Open Source$/m);
  assert.match(read('CONTRIBUTING.md'), /## Governance model\n\n\*\*Salesforce Sponsored\.\*\*/);
  assert.ok(read('CONTRIBUTING.md').includes('https://cla.salesforce.com/sign-cla'));
});

test('the README credits the map data, and build-geo.mjs names the file geo.js is built from', () => {
  assert.match(read('README.md'), /## Credits[\s\S]*world-atlas[\s\S]*Natural Earth/);
  assert.match(read('app/tools/build-geo.mjs'), /countries-50m\.json in world-atlas 2\.0\.2/);
});

test('NOTICE credits the map data with its license, and the README links it', () => {
  const n = read('NOTICE');
  assert.match(n, /world-atlas 2\.0\.2/);
  assert.match(n, /ISC License/);
  assert.match(n, /Natural Earth[\s\S]*public domain/);
  assert.ok(read('README.md').includes('](NOTICE)'));
});

test('CI lints with the config in the repo, and the config needs no installed package', () => {
  assert.ok(read('.github/workflows/test.yml').includes('run: npx -y eslint@10.14.0 .')); // an exact version
  assert.ok(read('CONTRIBUTING.md').includes('npx eslint@10 .'));
  assert.doesNotMatch(read('eslint.config.mjs'), /^import /m, 'ESLint runs from npx alone, so the config imports nothing');
  assert.ok(!existsSync(new URL('package.json', root)), 'the console keeps no npm dependencies');
});

test('the README shows the Tests workflow badge linked to its runs on main, and CONTRIBUTING names the maintainers', () => {
  const wf = 'https://github.com/salesforce/order-management-operations-console/actions/workflows/test.yml';
  assert.ok(read('README.md').includes(`[![Tests](${wf}/badge.svg?branch=main)](${wf}?query=branch%3Amain)`));
  assert.match(read('.github/workflows/test.yml'), /^name: Tests$/m, 'the badge is of the workflow named Tests');
  const c = read('CONTRIBUTING.md');
  for (const u of ['yogeshreddy83', 'rkatyalneu']) assert.ok(c.includes(`https://github.com/${u}`), u);
});

test('browser tests run in public CI on one exact playwright-core version, the same one internal CI fetches', () => {
  const v = read('app/tools/playwright-core.version').trim();
  assert.match(v, /^\d+\.\d+\.\d+$/, 'one exact version');
  const wf = read('.github/workflows/test.yml');
  assert.ok(wf.includes('playwright-core@$(cat app/tools/playwright-core.version)'));
  assert.match(wf, /REQUIRE_UI: '1'/);
  assert.match(wf, /install (--with-deps )?chromium/);
  assert.ok(wf.indexOf('- name: Playwright') < wf.indexOf('- name: Tests'), 'installed before the tests');
  assert.doesNotMatch(wf, /dist-tags|playwright-core@latest|playwright-core(?!@\$)@\S*latest/);
});

test('the README has a Testing section with the test command that links CONTRIBUTING, and CONTRIBUTING and CLAUDE.md say UI tests run in public CI', () => {
  const r = read('README.md');
  assert.match(r, /## Testing[\s\S]*node --test "app\/test\/\*\*\/\*\.test\.mjs"[\s\S]*\]\(CONTRIBUTING\.md#testing\)/);
  assert.match(read('CONTRIBUTING.md'), /Public CI[\s\S]*runs the browser tests on every pull request/);
  assert.match(read('CLAUDE.md'), /browser UI tests run in public CI/);
  assert.ok(!existsSync(new URL('package.json', root)));
});

test('the workflow reads only the repo, pins its actions to commit SHAs, and dependabot keeps them current', () => {
  const wf = read('.github/workflows/test.yml');
  assert.match(wf, /^permissions:\n {2}contents: read$/m);
  const uses = [...wf.matchAll(/^\s+uses: (\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length >= 2);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${u} is pinned to a commit`);
  assert.match(read('.github/dependabot.yml'), /package-ecosystem: github-actions/);
  assert.match(read('CONTRIBUTING.md'), /maintainer to approve the run/);
});
