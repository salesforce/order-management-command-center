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
import { existsSync, readdirSync, readFileSync } from "../../support/source-view.mjs";
import { frameUrl } from "../../../../org/console-app/force-app/main/default/lwc/somConsoleFrame/frameUrl.js";

const read = (p) => readFileSync(new URL(`../../../../org/${p}`, import.meta.url), 'utf8');
const APP = 'https://acme--c.my.salesforce.app/app/c__SOM_Console';
const ID = '1OsWs00000D8PZdKAN';

test('the frame opens the console at the record page\'s order', () => {
  assert.equal(frameUrl(APP, ID, 'details'), `${APP}?order=${ID}&view=details`);
  assert.equal(frameUrl(APP, ID, 'timeline'), `${APP}?order=${ID}&view=timeline`);
  assert.equal(frameUrl(APP, '1OsWs00000D8PZd', undefined), `${APP}?order=1OsWs00000D8PZd`);
  // No usable Id (App Builder's preview has none): the console's own start page, with no view.
  assert.equal(frameUrl(APP, undefined, 'details'), APP);
  assert.equal(frameUrl(APP, 'x"><script>', 'details'), APP);
  assert.equal(frameUrl(APP, ID, 'evil'), `${APP}?order=${ID}`);
  // A pasted address keeps none of its own query or hash.
  assert.equal(frameUrl(`${APP}?order=001000000000000AAA#service`, ID, 'activity'), `${APP}?order=${ID}&view=activity`);
});

test('the frame shows only a Multi-Framework app address', () => {
  for (const bad of [undefined, '', 'not a url', 'http://acme--c.my.salesforce.app/app/c__SOM_Console',
    'https://example.com/app/c__SOM_Console', 'https://acme--c.my.salesforce.app.example.com/app/c__SOM_Console',
    'https://acme--c.my.salesforce.app/services/data/v68.0/query', 'javascript:alert(1)']) {
    assert.equal(frameUrl(bad, ID, 'details'), null, String(bad));
  }
});

test('the component, the trusted URL and the web tab name the same app', () => {
  const meta = read('console-app/force-app/main/default/lwc/somConsoleFrame/somConsoleFrame.js-meta.xml');
  assert.match(meta, /<target>lightning__RecordPage<\/target>/);
  assert.match(meta, /<object>OrderSummary<\/object>/);
  const fallback = meta.match(/name="consoleUrl"[^>]*default="([^"]+)"/)[1];
  assert.equal(read('console-app/force-app/main/default/tabs/SOM_Console_Web.tab-meta.xml').match(/<url>([^<]+)<\/url>/)[1], fallback);
  // Lightning frames only trusted URLs: this one allows the app's origin, for frames and nothing else.
  const site = read('console-app/force-app/main/default/cspTrustedSites/SOM_Console_App.cspTrustedSite-meta.xml');
  assert.equal(site.match(/<endpointUrl>([^<]+)<\/endpointUrl>/)[1], new URL(fallback).origin);
  assert.match(site, /<isApplicableToFrameSrc>true</);
  assert.equal((site.match(/<isApplicableTo\w+>true</g) || []).length, 1);
});

test('a page that carries the frame sets every property', () => {
  // App Builder's defaults come from the page, not from the component. No page carries it for now
  // (it was briefly a tab on Order Management's Order Summary page); this holds when one does again.
  const fallback = read('console-app/force-app/main/default/lwc/somConsoleFrame/somConsoleFrame.js-meta.xml').match(/name="consoleUrl"[^>]*default="([^"]+)"/)[1];
  for (const dir of ['console-app', 'oms-app']) {
    const at = new URL(`../../../../org/${dir}/force-app/main/default/flexipages/`, import.meta.url);
    if (!existsSync(at)) continue;
    for (const f of readdirSync(at)) {
      const page = readFileSync(new URL(f, at), 'utf8');
      for (const inst of page.match(/<componentInstance>(?:(?!<\/componentInstance>)[\s\S])*<componentName>somConsoleFrame<\/componentName>[\s\S]*?<\/componentInstance>/g) || []) {
        const prop = (n) => inst.match(new RegExp(`<name>${n}</name>\\s*<value>([^<]+)</value>`))?.[1];
        assert.equal(prop('consoleUrl'), fallback, f);
        assert.ok(['details', 'activity', 'timeline'].includes(prop('view')), f);
        assert.ok(Number(prop('height')) >= 400, f);
      }
    }
  }
});
