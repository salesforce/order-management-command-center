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
// The console's short read cache (j() in index.html goes through it).

// The four drawer reads are kept for 30 s, so Back and re-opening an order, record or customer cost no org calls. Identical requests in
// flight share one fetch; errors and partial answers are never kept, and load() / showGate() empty it.
export const J_TTL = 30e3;
export const J_MAX = 40;
export const J_ROUTES = [
  [/^\/api\/order\/\w+$/, (v) => !!v?.order],
  [/^\/api\/order\/\w+\/history$/, (v) => Array.isArray(v?.events)],
  [/^\/api\/account\/\w+$/, (v) => !!v?.account && !v.loyalty?.error],
  [/^\/api\/record\/\w+\/\w+$/, (v) => !!v?.record],
];
export function jCheck(url) { return J_ROUTES.find(([re]) => re.test(url))?.[1] || null; }
export function makeJCache(fetcher, { ttl = J_TTL, max = J_MAX, now = Date.now } = {}) {
  const hits = new Map(), flying = new Map();
  let gen = 0; // a fetch that started before clear() must not put its answer back
  const get = (url, opts) => {
    const check = opts === undefined ? jCheck(url) : null;
    if (!check) return fetcher(url, opts);
    const e = hits.get(url);
    if (e && now() - e.t < ttl) { hits.delete(url); hits.set(url, e); return Promise.resolve(e.v); }
    hits.delete(url);
    if (flying.has(url)) return flying.get(url);
    const g = gen;
    const p = fetcher(url).then((v) => {
      if (g === gen && check(v)) { hits.set(url, { v, t: now() }); while (hits.size > max) hits.delete(hits.keys().next().value); }
      return v;
    }).finally(() => { if (flying.get(url) === p) flying.delete(url); });
    flying.set(url, p);
    return p;
  };
  get.clear = () => { gen++; hits.clear(); flying.clear(); };
  get.size = () => hits.size;
  return get;
}
