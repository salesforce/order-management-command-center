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
import { fakeOrg } from './fake-org.mjs';

export const PARITY_TIME = '2026-11-05T12:00:00.000Z';
export async function recordedRead(createCore, url, mode = 'normal') {
  const fake = fakeOrg({ objects: mode === 'missing-objects' ? [] : undefined,
    queries: [[/COUNT\(|SUM\(|GROUP BY/, [{ c: 3, s: 'Open' }]], [/./, []]],
    limits: { DailyApiRequests: { Max: 1000, Remaining: 900 } }, tooling: { DeveloperName: null } });
  const calls = [];
  const request = async (p, post) => {
    calls.push({ path: p.startsWith('/query?q=') ? '/query?q=' + decodeURIComponent(p.slice(9)) : p, ...(post !== undefined && { body: post }) });
    if (mode === 'expired') throw Object.assign(new Error('Session expired'), { httpStatus: 401 });
    return fake.request(p, post);
  };
  const core = createCore({ request, instanceUrl: () => 'https://test.my.salesforce.com' });
  let result;
  try { result = { code: 200, body: await core.route(url) }; }
  catch (e) { result = { code: e.code || e.httpStatus || 500, error: e.message }; }
  // JSON is the public API contract; undefined properties and non-enumerable internal flags are not response fields.
  return JSON.parse(JSON.stringify({ ...result, calls }));
}

export async function withFixedDate(run) {
  const Original = globalThis.Date, timezone = process.env.TZ;
  process.env.TZ = 'UTC';
  globalThis.Date = class extends Original {
    constructor(...args) { super(...(args.length ? args : [PARITY_TIME])); }
    static now() { return Original.parse(PARITY_TIME); }
  };
  try { return await run(); } finally {
    globalThis.Date = Original;
    if (timezone === undefined) delete process.env.TZ; else process.env.TZ = timezone;
  }
}
