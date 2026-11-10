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
// The lists the JavaScript and the Apex both keep, held equal. Inside Salesforce the console's reads go through SomConsoleRead
// (org/console-app), which re-checks what the read model checks. When the two drift, a read works locally and hosted and
// fails only in-org, so these tests read the Apex source and compare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from "../../support/source-view.mjs";
import { CUSTOMER_FIELDS, POLICY_KINDS } from "../../../public/shared/data/om-rules.js";
import { ID_RE } from "../../../public/shared/data/om-reads.js";

// Apex source is scanned, not parsed: comments are dropped (string literals kept), then a constant's brace block is read.
function uncomment(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'") { const m = src.slice(i).match(/^'(?:\\.|[^'\\])*'/); out += m[0]; i += m[0].length - 1; }
    else if (c === '/' && src[i + 1] === '/') { const n = src.indexOf('\n', i); i = (n < 0 ? src.length : n) - 1; }
    else if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; }
    else out += c;
  }
  return out;
}
const READ_CLS = uncomment(readFileSync(new URL('../../../../org/console-app/force-app/main/default/classes/SomConsoleRead.cls', import.meta.url), 'utf8'));
const valueAt = (name) => {
  const m = new RegExp(String.raw`(?:\s|,)${name}\s*=(?!=)\s*`).exec(READ_CLS);
  if (!m) throw new Error(`${name} isn't declared in SomConsoleRead`);
  return m.index + m[0].length;
};
const unquote = (lit) => lit.slice(1, -1).replace(/\\(.)/g, '$1');
const READ_MAX_BATCH = Number(READ_CLS.slice(valueAt('MAX_BATCH')).match(/^\d+/)[0]);
const DUPLICATE_FIELDS = Object.fromEntries([...READ_CLS.slice(valueAt('DUPLICATE_FIELDS')).split(';')[0].matchAll(/('(?:\\.|[^'\\])*')\s*=>\s*new\s+Set<String>\s*\{([^}]*)\}/g)]
  .map((m) => [unquote(m[1]), (m[2].match(/'(?:\\.|[^'\\])*'/g) || []).map(unquote)]));
const same = (a, b, what) => assert.deepEqual([...new Set(a)].sort(), [...new Set(b)].sort(), what);

test('in-org batches stay inside what SomConsoleRead takes', () => {
  const page = Number(readFileSync(new URL("../../../public/shared/transport/platform-runtime.js", import.meta.url), 'utf8').match(/^const MAX_BATCH = (\d+);/m)?.[1]);
  assert.ok(page > 0 && page <= READ_MAX_BATCH, `om-platform.js MAX_BATCH (${page}) must not pass SomConsoleRead.MAX_BATCH (${READ_MAX_BATCH})`);
});

test('an Id is the same pattern in SomConsoleRead and om-reads.js', () => {
  const [, src] = READ_CLS.match(/Pattern\.matches\('([^']+)', \(String\) v\)\) throw new IllegalArgumentException\('Bad ' \+ what \+ ' Id'\)/) || [];
  assert.ok(src, 'SomConsoleRead checks an Id with a pattern');
  const re = new RegExp(`^${src.replace(/\\\\/g, '\\')}$`);
  for (const s of ['001000000000001', '001000000000001AAA', '001000000000001AA', '00100000000001', '001000000000001AAAA', '001000000000-001', 'a0Bxx0000000001', '']) {
    assert.equal(re.test(s), ID_RE.test(s), `SomConsoleRead's Id check and om-reads.js ID_RE disagree on "${s}"`);
  }
});

test('the duplicate check reads the fields a new customer is written with', () => {
  same([...CUSTOMER_FIELDS.person, ...CUSTOMER_FIELDS.business], DUPLICATE_FIELDS.Account, 'SomConsoleRead DUPLICATE_FIELDS.Account');
  same(CUSTOMER_FIELDS.contact, DUPLICATE_FIELDS.Contact, 'SomConsoleRead DUPLICATE_FIELDS.Contact');
});

test('SomConsoleRead’s /features looks for the return policy’s object', () => {
  assert.match(READ_CLS, new RegExp(`containsKey\\('${POLICY_KINDS.return.object.toLowerCase()}'\\)`));
});
