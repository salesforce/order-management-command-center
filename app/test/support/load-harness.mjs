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
import { readFileSync } from "./source-view.mjs";
import * as LABELS from "../../public/operations-console/console-labels.js";
import * as BANNER from "../../public/operations-console/console-banner.js";

// Runs the page's real load() against stubs, with the label and banner helpers it imports (console-labels.js, console-banner.js). Names the page script defines elsewhere
// resolve to no-ops through a Proxy, so a new call in load() doesn't need a stub here unless the test cares about it. The
// page's shared state, S, is the scope object itself, so s.data is what load() wrote to S.data.
export const html = readFileSync(new URL("../../public/operations-console/index.html", import.meta.url), 'utf8');
const line = (re) => html.match(re)[0];

export function loadSource() {
  const load = html.match(/async function viewPayload\([^)]*\) \{[\s\S]*?\n\}/)[0] + '\n' + html.match(/async function load\(\) \{[\s\S]*?\n\}/)[0], fail = html.match(/function loadFailed\([^)]*\) \{[\s\S]*?\n\}/)[0];
  return [line(/^const shownRange = .*;$/m), line(/^const rangeText = .*;$/m), line(/^const VIEW_NAME = .*;$/m), fail, load].join('\n');
}
const make = new Function('s', `with (s) { ${loadSource()}\nreturn load; }`);

export function rig(init = {}) {
  const log = { banners: [], gates: [], clears: 0, updated: [], urls: [] };
  const pending = [];
  const s = {
    mode: 'console', range: '90d', period: 'mtd', data: null, dash: null, svc: null, loadSeq: 0, live: false, missed: false, pollTimer: null, DEMO: false,
    custId: null, lim: { d: null }, jc: { clear() {} }, ...LABELS, ...BANNER,
    $: (sel) => ({ classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, set textContent(v) { if (sel === '#updated') log.updated.push(v); } }),
    showBanner: (p) => log.banners.push(p), clearBanner: () => { log.clears++; }, showGate: (x) => log.gates.push(x),
    // Each j() call waits until the test settles it, so it can order or fail the answers.
    j: (url) => new Promise((resolve, reject) => { log.urls.push(url); pending.push({ url, resolve, reject }); }),
    ...init,
  };
  s.S = s; // the page's shared state (console-state.js) is the same object here
  const scope = new Proxy(s, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const load = make(scope);
  const settle = (i, how, v) => pending[i][how](v);
  return { s, log, load, pending, ok: (i, v) => settle(i, 'resolve', v), fail: (i, e) => settle(i, 'reject', e) };
}
export const tick = () => new Promise((r) => setImmediate(r));
