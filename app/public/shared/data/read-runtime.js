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
import { SCOPE_PATH, scopeCond, UNSCOPED } from './om-core-util.js';
// Shared read-only request, batching and schema-cache runtime. App profiles supply their query reader and providers.
import { readOnlyPost, isTooSlow, tooSlow } from '../transport/om-http.js';

// Providers are created once against one kit, then connected before any route runs. Dependencies are lazy across providers.
function registerExports(area, name, exports) {
  for (const key of Object.keys(area).filter((key) => key !== 'routes')) {
    if (exports.has(key)) throw new Error(`Duplicate read export: ${key} (${name})`);
    exports.add(key);
  }
}
function registerRoutes(area, routes) {
  for (const [route] of area.routes || []) {
    const key = String(route);
    if (routes.has(key)) throw new Error(`Duplicate read route: ${key}`);
    routes.add(key);
  }
}
function checkDependencies(providers, exports) {
  for (const provider of providers) for (const need of provider.needs || []) {
    if (!exports.has(need)) throw new Error(`Missing read dependency: ${provider.name} needs ${need}`);
  }
}
export function assembleProviders(kit, providers) {
  const names = new Set(), exports = new Set(Object.keys(kit)), routes = new Set();
  const areas = providers.map((provider) => {
    const make = provider.make || provider, name = provider.name || make.name;
    if (names.has(name)) throw new Error(`Duplicate read provider: ${name}`);
    names.add(name);
    const area = make(kit);
    registerExports(area, name, exports);
    registerRoutes(area, routes);
    return area;
  });
  checkDependencies(providers, exports);
  for (const { routes, ...reads } of areas) Object.assign(kit, reads);
  return areas;
}

export function createReadRuntime({ request, instanceUrl, apiVersion = () => null, createReader }, providers) {
  const api = (p, post) => {
    if (post !== undefined && !readOnlyPost(p, post)) throw new Error(`Refusing to POST to ${p}: this app is read-only`);
    return request(p, post);
  };

  // Panels fire their queries at the same moment, so GETs issued in the same tick go out as one /composite call, which counts
  // once against the org's daily API limit. Composite takes 25 subrequests, at most 5 of them queries; a lone GET goes as is.
  const isQuery = (p) => p.startsWith('/query?');
  let queue = [];
  const get = (p) => apiVersion() && (isQuery(p) || /^\/sobjects\/\w+\/describe$/.test(p))
    ? new Promise((ok, fail) => { if (!queue.length) setTimeout(flush); queue.push({ p, ok, fail }); })
    : api(p);
  function flush() {
    const qs = queue.filter((x) => isQuery(x.p)), rest = queue.filter((x) => !isQuery(x.p));
    queue = [];
    while (qs.length || rest.length) { const b = qs.splice(0, 5); send([...b, ...rest.splice(0, 25 - b.length)]); }
  }
  async function send(batch) {
    if (batch.length === 1) return api(batch[0].p).then(batch[0].ok, batch[0].fail);
    try {
      const v = `/services/data/v${apiVersion()}`;
      const { compositeResponse: rs = [] } = await api('/composite', { allOrNone: false, compositeRequest: batch.map((x, i) => ({ method: 'GET', url: v + x.p, referenceId: `r${i}` })) });
      batch.forEach((x, i) => {
        const r = rs.find((r) => r.referenceId === `r${i}`), code = r?.httpStatusCode ?? 500;
        if (code < 300) x.ok(r.body);
        else if (isTooSlow(null, r?.body)) x.fail(tooSlow());
        else x.fail(Object.assign(new Error(Array.isArray(r?.body) ? r.body.map((e) => e.message).join('; ') : `HTTP ${code}`), { httpStatus: code }));
      });
    } catch (e) { batch.forEach((x) => x.fail(e)); }
  }
  // Salesforce returns at most 2,000 rows (or GROUP BY groups) per query and aggregates can't be paged. A result that hit
  // that cap carries a non-enumerable `capped` flag, which safe() lifts onto the panel so the page can say so.
  const CAP = 2000;
  const ORDER_LINES = 10000; // the most lines one order's page reads (OM Service Console), five pages of them
  const capped = (a) => Object.defineProperty(a, 'capped', { value: true });
  const soql = async (q) => { const r = await get(`/query?q=${encodeURIComponent(q)}`), recs = r.records ?? [];
    return r.done === false || recs.length >= CAP ? capped(recs) : recs; };
  // Every row past those 2,000 (a big order's lines, say): pages by Id, each one a plain query, so it reads the same in every
  // mode. It stops at `max` rows, and the result is then capped.
  async function allRows(fields, from, where, max) {
    const out = [];
    for (let last = null; ;) {
      const n = Math.min(CAP, max - out.length);
      const rows = await soql(`SELECT ${fields.join(', ')} FROM ${from} WHERE ${where}${last ? ` AND Id > '${last}'` : ''} ORDER BY Id LIMIT ${n}`);
      out.push(...rows);
      if (out.length >= max) return capped(out);
      if (!rows.capped || !rows.length) return out;
      last = rows.at(-1).Id;
    }
  }

  // ---------- schema-tolerant field selection ----------
  // OM field availability varies by edition/release, so every query only selects fields the org actually has.
  const describeCache = new Map();
  async function describe(sobject) {
    if (!describeCache.has(sobject)) {
      describeCache.set(sobject, get(`/sobjects/${sobject}/describe`).then((d) => {
        const fields = new Set(d.fields.map((f) => f.name));
        const rels = new Set(d.fields.filter((f) => f.relationshipName).map((f) => f.relationshipName));
        const to = Object.fromEntries(d.fields.filter((f) => f.relationshipName).map((f) => [f.relationshipName, f.referenceTo || []]));
        // Active picklist values, for the few pickers that need them (change reasons). Absent when describe doesn't carry them.
        const lists = Object.fromEntries(d.fields.filter((f) => f.picklistValues?.length).map((f) => [f.name, f.picklistValues.filter((v) => v.active !== false).map((v) => v.value)]));
        // Whether the user may create the object, and its record types (which they may use): undefined when describe doesn't say.
        const recordTypes = d.recordTypeInfos?.map((r) => ({ id: r.recordTypeId, developerName: r.developerName, available: r.available !== false, isDefault: !!r.defaultRecordTypeMapping, master: !!r.master }));
        return { fields, rels, to, lists, createable: d.createable, recordTypes };
      }).catch((e) => {
        // Only a 404 means the org lacks the object; anything else (API limit, network) is retried on the next load.
        if (e.httpStatus !== 404) describeCache.delete(sobject);
        return null;
      }));
    }
    return describeCache.get(sobject);
  }
  async function has(sobject) { return (await describe(sobject)) !== null; }
  // Reads (om-reads.js): fixed query sets shared with the plugin's skills, served at /api/read/<name>. A describe that failed
  // for any reason but a 404 isn't cached, so it isn't "this org lacks the object": the read reports it as an error instead.
  const readDescribe = async (o) => { const d = await describe(o); if (d === null && !describeCache.has(o)) throw new Error(`Couldn't read ${o}'s fields; try again`); return d; };
  const read = createReader({ soql, describe: readDescribe, api: (p) => api(p), instanceUrl });
  async function pick(sobject, wanted) {
    const d = await describe(sobject);
    if (!d) return [];
    return wanted.filter((f) => (f.includes('.') ? d.rels.has(f.split('.')[0]) : d.fields.has(f)));
  }

  // Run one panel's query; a failure degrades that panel only.
  // A capped query anywhere in a panel's result (looked for a few levels down, not inside row lists) marks the panel.
  const hasCap = (v, d = 0) => Array.isArray(v) ? !!v.capped : !!v && typeof v === 'object' && d < 3 && Object.values(v).some((x) => hasCap(x, d + 1));
  async function safe(fn) {
    try { const data = await fn(); return hasCap(data) ? { ok: true, data, capped: true } : { ok: true, data }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
  const agg = (rows) => { const out = rows.map((r) => ({ key: r.s ?? '(blank)', n: r.c })); return rows.capped ? capped(out) : out; };

  // Case reaches its order through a custom lookup; find it by what it points at.
  const caseOrderRel = async () => Object.entries((await describe('Case'))?.to || {}).find(([, r]) => r.length === 1 && r[0] === 'OrderSummary')?.[0];

  // The kit every area gets: the helpers above, and (once all are made) each area's reads, which an area calls in another
  // through the kit at call time. Each area also brings its routes.
  async function scoper(scope) {
    const on = !!(scope?.store || scope?.channel);
    if (!on) return { on, scope: { store: null, channel: null }, can: () => true, where: () => '', and: () => '', clause: () => '' };
    const [osF, caseRel] = await Promise.all([pick('OrderSummary', ['SalesStoreId', 'SalesChannelId']), caseOrderRel()]);
    const usable = (!scope.store || osF.includes('SalesStoreId')) && (!scope.channel || osF.includes('SalesChannelId'));
    const paths = { ...SCOPE_PATH, ...(caseRel ? { Case: `${caseRel}.` } : {}) }, os = scopeCond(scope);
    const ok = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([o, p]) => {
      if (!usable) return [o, null];
      const d = p ? await describe(o) : true;
      if (p && typeof p === 'object') return [o, d?.fields.has(p.semi) ? `${p.semi} IN (SELECT Id FROM OrderSummary WHERE ${os})` : null];
      return [o, !p || d?.rels.has(p.split('.')[0]) ? scopeCond(scope, p) : null];
    })));
    const where = (o) => ok[o] ?? null, can = (o) => where(o) !== null;
    const cond = (o) => { if (!can(o)) throw new Error(UNSCOPED); return where(o); };
    return { on, scope: { store: scope.store || null, channel: scope.channel || null }, can, where, and: (o) => ' AND ' + cond(o), clause: (o) => ' WHERE ' + cond(o) };
  }

  const k = { api, get, soql, allRows, describe, has, readDescribe, read, pick, safe, agg, capped, hasCap, CAP, ORDER_LINES, instanceUrl, apiVersion, caseOrderRel, scoper };
  const areas = assembleProviders(k, providers);

  // GET routes the page calls, answered in-process. Errors carry .code like the server's HTTP status. A route is [path, or a
  // pattern whose groups are its parameters, handler(match, q, url)]; the first that matches answers. Every Id is checked before
  // it reaches a query.
  const ROUTES = [[/^\/api\/read\/([\w-]+)$/, (m, q, u) => read(m[1], Object.fromEntries(u.searchParams))], ...areas.flatMap((a) => a.routes)];
  async function route(url) {
    const u = new URL(url, 'http://x'), p = u.pathname, q = (key) => u.searchParams.get(key);
    for (const [at, answer] of ROUTES) {
      const m = typeof at === 'string' ? (at === p ? [p] : null) : p.match(at);
      if (m) return answer(m, q, u);
    }
    throw Object.assign(new Error('Not found'), { code: 404 });
  }

  return { route, policyFacts: k.policyFacts, bundleFacts: k.bundleFacts, paymentFacts: k.paymentFacts, productFacts: k.productFacts, paylinkFacts: k.payLinkFacts, paylinkRead: k.csPayLink, pictureFacts: k.pictureFacts, reset: () => { describeCache.clear(); k.resetPolicies?.(); } };
}
