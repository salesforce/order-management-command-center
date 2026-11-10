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
// Salesforce Order Management Operations Console inside Salesforce: a Multi-Framework app served from <mydomain>--<ns>.my.salesforce.app, opened from the App
// Launcher. The page already carries the user's session, so there is no sign-in here. That session can't call
// /services/data/vXX.X/query or /describe, so om-core.js's reads go to the read-only SomConsoleRead Apex REST class
// (org/console-app), which runs the same SOQL as the user and answers in the REST API's shapes. Every call sends the
// CSRF token the app domain requires. Reads made together go as one batch POST to the same endpoint (still read-only).
// Aggregate SOQL (om-graphql.js translate()) skips Apex, whose 50k-row cap it would hit, and goes as a GraphQL `query`
// POST to /graphql instead. With graphqlReads on, plain row queries and describes go the same way (translateRows,
// describeDoc), and Apex answers whatever GraphQL can't. These are the only POSTs the console's reads make, each checked
// to be a query.
// The console writes nothing here. Agentforce's chat goes to the SomConsoleAgent Apex class, which only relays text to the agent.
// OM Service Console (the customer service app) turns on its actions with enableActions(). They run om-actions.js in the page, as
// everywhere else; every call goes to the SomServiceActions Apex class (typed ConnectApi / Invocable.Action, as the user).
// The app domain's session can't call the Connect REST API at all, and Apex gets the same session, so nothing here does:
// stock, delivery estimates and Order Management's product search and details are SomConsoleRead lookups (their ConnectApi
// methods), and what has no Apex method (Commerce checkout) isn't available here (New order hands off). The pickup estimate
// and a fulfillment order's routing explanation have no Apex method either; they're reads, and go through the relay's named
// credential once the agent allows it (RELAY_READS). Only OM Service Console sends them: the console never calls the relay.
import { isBlocked, BLOCKED_MESSAGE, REQUEST_MS, COMPOSITE_MS, tooSlow, isTooSlow, readInit, readBody, errorText } from './om-http.js';
import { CONFIG } from './om-config.js';
import { translate as translateSoql, translateRows as translateRowsSoql, describeDoc as describeDocs } from './om-graphql.js';
import { agentMessage } from '../agent/om-agent.js';

const UI_API = '/services/data/v68.0';
const APEX = '/services/apexrest/somconsole';
const ACTIONS = '/services/apexrest/somservice/call';
// The read-only lookups the REST API makes as POSTs, answered by SomConsoleRead: stock and delivery estimates through their
// ConnectApi methods, and a new customer's duplicate check (UI API's predupe) through Datacloud.FindDuplicates.
const OCI = '/commerce/oci/availability/availability-records/actions/get-availability';
const PREDUPE = '/ui-api/predupe';
const ESTIMATE = /^\/commerce\/delivery\/estimation-setup\/([\w.%-]{1,240})\/estimate\/estimate-date$/;
// Reads with no Apex method, which SomServiceActions sends through its named credential (CONNECT_READS), as [method, path]:
// the pickup estimate, and why a fulfillment order (0a3) went where it did.
export const RELAY_READS = [['POST', /^\/commerce\/delivery\/estimation-setup\/([\w.%-]{1,240})\/estimate\/bopis$/],
  ['GET', /^\/commerce\/fulfillment\/fulfillment-orders\/(?=0a3)[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?\/routing-explanation$/]];
// Order Management's product search and details for a store: SomConsoleRead runs them through ConnectApi.Repricing.
const PRODUCTS = /^\/commerce\/order-management\/webstores\/([A-Za-z0-9]{15,18})\/products(?:\/([^/?]{1,80}))?\?([^/]*)$/;
const MAX_BATCH = 5; // below SomConsoleRead.MAX_BATCH (10): one transaction's reads must not add up past 50k rows
const LIMIT_RE = /Too many (query rows|DML rows)|LimitException/i;
export const LIMIT_MESSAGE = 'This range has too many records for the in-org console. Pick a shorter range, or open the console locally.';
const LIMITS_HEADER = 'X-SomConsole-Limits';
const fail = (message, code, kind) => Object.assign(new Error(message), { code, httpStatus: code, kind });

// What a call was, for the live meter: from its path.
const kindOf = (path) => (/\/apexrest\/somconsole\/batch(?:\?|$)/.test(path) ? 'batch'
  : path.includes('/apexrest/somconsole') ? 'apex'
  : path.endsWith('/graphql') ? 'graphql'
  : /\/(?:ui-api|chatter)\//.test(path) ? 'ui-api'
  : path.includes('/commerce/') ? 'connect' : 'other');
// Rows a call returned, when that is cheap to say: records, a batch's records, or the edges of a GraphQL answer.
function rowCount(b) {
  if (!b || typeof b !== 'object') return null;
  if (Array.isArray(b.records)) return b.records.length;
  if (Array.isArray(b.results)) return b.results.reduce((n, r) => n + (Array.isArray(r?.body?.records) ? r.body.records.length : 0), 0);
  const agg = b.data?.uiapi?.aggregate;
  if (agg) { const first = Object.values(agg)[0]; return Array.isArray(first?.edges) ? first.edges.length : null; }
  const lists = Object.values(b.data?.uiapi?.query || {}).filter((v) => Array.isArray(v?.edges)); // a merged read document has one value per alias
  return lists.length ? lists.reduce((n, v) => n + v.edges.length, 0) : null;
}
// "rows=12/50000;queries=3/100;cpu=40/10000;heap=900/6000000;api=124/100000" → numbers, or null if there is none.
const LIMIT_KEYS = { rows: ['rows', 'rowsMax'], queries: ['queries', 'queriesMax'], cpu: ['cpu', 'cpuMax'], heap: ['heap', 'heapMax'], api: ['api', 'apiMax'] };
export function parseLimits(h) {
  if (typeof h !== 'string' || !h) return null;
  const out = {};
  for (const part of h.split(';')) {
    const m = part.match(/^(\w+)=(\d+)\/(\d+)$/);
    if (m && LIMIT_KEYS[m[1]]) { out[LIMIT_KEYS[m[1]][0]] = Number(m[2]); out[LIMIT_KEYS[m[1]][1]] = Number(m[3]); }
  }
  return Object.keys(out).length ? out : null;
}

// The agent action returns its answer as typed JSON text ({"type":"Text","value":"…"}, or a list of them). Show the words;
// anything that isn't that shape passes through untouched.
export function unwrapReply(raw) {
  if (raw == null) return '';
  const text = String(raw).trim();
  if (!/^[[{]/.test(text)) return text;
  try {
    const parts = [JSON.parse(text)].flat().filter((p) => p && typeof p.value === 'string');
    return parts.length ? parts.map((p) => p.value).join('\n\n') : text;
  } catch { return text; }
}

// fetchImpl and host are injectable for tests; in the page they are the browser's own.
// translate, translateRows and describeDoc are injectable too (default: om-graphql.js). graphqlReads (default off) sends row
// queries and describes through GraphQL. Only the console turns it on (?reads=graphql); GraphQL's describe has no picklist
// values or record types, which OM Service Console's status and reason pickers need, so OM Service Console never does.
// onRequest (optional) hears about every call once it ends, for the Limits view's live meter: { t, kind, path, method, ms,
// status, rows, apex }. It can never break a request.
// The org's own domain for an app-domain host: drop the `--<namespace>` that ends the first label (a sandbox's My Domain has `--` itself, so only the last one),
// swap `.salesforce.app` for `.salesforce.com`, and keep any `scratch.` / `sandbox.` label between.
export function orgDomainUrl(appHost) {
  const [label, ...rest] = appHost.split('.');
  const i = label.lastIndexOf('--');
  return `https://${i > 0 ? label.slice(0, i) : label}.${rest.join('.').replace(/\.salesforce\.app$/, '.salesforce.com')}`;
}

export function createPlatform({ fetchImpl = (...a) => fetch(...a), host = () => location.hostname, translate = translateSoql, translateRows = translateRowsSoql, describeDoc = describeDocs, graphqlReads = false, onRequest, createCore, loadActions } = {}) {
  let csrf = null; // Promise<string>, fetched once and again after a 401

  const report = (path, method, started, res, body, kind = kindOf(path)) => {
    if (!onRequest) return;
    try {
      onRequest({ t: Date.now(), kind, path, method, ms: Date.now() - started, status: res?.status ?? 0, rows: rowCount(body), apex: parseLimits(res?.headers?.get?.(LIMITS_HEADER)) });
    } catch { /* a listener's mistake is not the request's */ }
  };

  const token = () => (csrf ||= timed(`${UI_API}/ui-api/session/csrf`, 'GET', () => fetchImpl(`${UI_API}/ui-api/session/csrf`, { credentials: 'include' }))
    .then((r) => (r.ok ? r.json() : Promise.reject(fail('Your Salesforce session has expired. Reload the page.', 401))))
    .then((b) => b.csrfToken)
    .catch((e) => { csrf = null; throw e; }));

  // Runs one fetch and reports it, whether it answered or threw.
  async function timed(path, method, run, kind) {
    const started = Date.now();
    try { const res = await run(); report(path, method, started, res, undefined, kind); return res; }
    catch (e) { report(path, method, started, null, undefined, kind); throw e; }
  }

  async function call(path, retry = true, post) {
    const t = await token();
    const init = { credentials: 'include', ...readInit(path, post, { 'X-CSRF-Token': t, Accept: 'application/json' }, post ? COMPOSITE_MS : REQUEST_MS) };
    const started = Date.now();
    let res;
    try { res = await fetchImpl(path, init); }
    catch (e) { report(path, init.method || 'GET', started, null); throw isTooSlow(e) ? tooSlow() : e; }
    const body = await res.json().catch(() => ({}));
    report(path, init.method || 'GET', started, res, body);
    if (res.status === 401 && retry) { csrf = null; return call(path, false, post); }
    if (res.status === 401 && !isTooSlow(null, body)) throw fail('Your Salesforce session has expired. Reload the page.', 401);
    return readBody(res, body, fail);
  }

  // Panels fire their reads at the same moment, so reads issued in the same tick go out together as one batch call to the
  // Apex endpoint (5 per call), like om-core.js does with /composite elsewhere. A lone read goes as a plain GET.
  let queue = [];
  function enqueue(item, path) {
    return new Promise((ok, no) => { if (!queue.length) setTimeout(flush); queue.push({ item, path, ok, no }); });
  }
  function flush() {
    const all = queue; queue = [];
    for (let i = 0; i < all.length; i += MAX_BATCH) send(all.slice(i, i + MAX_BATCH));
  }
  async function send(batch) {
    if (batch.length === 1 && batch[0].path) return call(batch[0].path).then(batch[0].ok, batch[0].no); // a lookup has no GET form
    try {
      const { results = [] } = await call(`${APEX}/batch`, true, { items: batch.map((x) => x.item) });
      batch.forEach((x, i) => {
        const r = results[i];
        if (r && r.status < 300) x.ok(r.body);
        else x.no(fail(Array.isArray(r?.body) ? r.body.map((e) => e.message).join('; ') : 'No answer for this read', r?.status ?? 500));
      });
    } catch (e) { batch.forEach((x) => x.no(e)); }
  }

  // Apex's row-limit text means nothing to a user; keep it in `detail`, and the original error as `cause`.
  const friendly = (e) => (LIMIT_RE.test(e?.message || '')
    ? Object.assign(new Error(LIMIT_MESSAGE, { cause: e }), { code: 400, httpStatus: 400, detail: e.message }) : e);
  // An aggregate that stays on Apex can hit the 50k-row limit, which fails the whole /batch transaction it rides in. So it goes
  // alone, as its own GET: only its own panel pays. (A false positive from a quoted word just costs one extra request.)
  const AGGREGATE = /\b(?:COUNT|COUNT_DISTINCT|SUM|AVG|MIN|MAX)\s*\(|\bGROUP\s+BY\b/i;
  const apex = (item, path) => (item.q && AGGREGATE.test(item.q) ? call(path) : enqueue(item, path)).catch((e) => { throw friendly(e); });

  // GraphQL error text arrives HTML-escaped (&#39; for a quote).
  const unescapeHtml = (t) => t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const UNSUPPORTED = /FieldUndefined|SObjectException/;

  // The one place a GraphQL document leaves the page: a plain query, or a 404. The body comes back as it is, errors included.
  const notQuery = (d) => typeof d !== 'string' || !/^\s*query\b/.test(d) || /mutation/i.test(d);
  function postGraphql(query) {
    if (notQuery(query)) throw fail('Not available inside Salesforce', 404);
    return call(`${UI_API}/graphql`, true, { query });
  }
  // An aggregate (translate()): one document ({ query, map(body) }) or several run in parallel ({ queries, map(bodies) }), never
  // merged with other reads. A GraphQL error is thrown, flagged `unsupported` when Apex could still answer.
  async function graphql(t) {
    const docs = t && (Array.isArray(t.queries) ? t.queries : [t.query]);
    if (!docs?.length || docs.some(notQuery)) throw fail('Not available inside Salesforce', 404);
    const bodies = await Promise.all(docs.map(postGraphql));
    for (const body of bodies) {
      if (!Array.isArray(body.errors) || !body.errors.length) continue;
      const text = unescapeHtml(body.errors.map((e) => e.message).join('; '));
      // The object or field isn't in GraphQL's schema, or the server can't run this shape: Apex can still answer it.
      throw Object.assign(fail(text, 400), { unsupported: UNSUPPORTED.test(text) });
    }
    return t.map(Array.isArray(t.queries) ? bodies : bodies[0]);
  }

  // convertTimezone() in SOQL means the user's Salesforce time zone, which GraphQL groupBy cannot do, so time series are
  // translated per bucket in that zone (om-graphql.js). Looked up once; null (stay on Apex) if it can't be read.
  let zone = null;
  const timeZone = () => (zone ||= call(`${UI_API}/chatter/users/me`)
    .then((u) => graphql({ query: `query{uiapi{query{User(where:{Id:{eq:${JSON.stringify(String(u.id))}}}){edges{node{TimeZoneSidKey{value}}}}}}}`,
      map: (b) => b?.data?.uiapi?.query?.User?.edges?.[0]?.node?.TimeZoneSidKey?.value ?? null }))
    .catch(() => null)).then((z) => { if (!z) zone = null; return z; });
  const SERIES = /\b(?:CALENDAR_YEAR|CALENDAR_MONTH|DAY_ONLY|HOUR_IN_DAY)\s*\(/i;

  // Row queries and describes through GraphQL. Objects GraphQL doesn't know (Refund, a custom object it hides) are remembered
  // for the page, and so are refused fields (below): a later read that uses one goes straight to Apex. Reads issued in the same
  // tick as the first miss still go together, and are sorted out by the attribution below.
  const noGraphql = new Set();
  // Fields of an object that GraphQL refuses ('ProcessException.AttachedTo.Name'): a read that uses one goes straight to Apex.
  const noGraphqlPaths = new Set();
  const DETERMINISTIC = /FieldUndefined|SObjectException|Validation error/;
  const errorsText = (body) => (Array.isArray(body?.errors) ? unescapeHtml(body.errors.map((e) => e?.message ?? String(e)).join('; ')) : '');
  // A rejection (or error body) that means "GraphQL can't run this one": Apex answers instead. Anything else is thrown.
  const refused = (e, body) => DETERMINISTIC.test(`${unescapeHtml(e?.message || '')} ${errorsText(body)}`);
  // What a read that GraphQL refused throws: the errors' text unescaped, as an aggregate's are, a 400.
  const gqlError = (e, body) => (errorsText(body) ? fail(errorsText(body), 400) : e);

  // Reads issued in the same tick share GraphQL requests: ten row queries (as aliases r0, r1…) or twenty describes (one
  // objectInfos) at most. A lone read goes as its own plain document. Each read keeps its own fallback rules (below).
  // A shared document refused with an error that names an object or field of some reads (and no data) sends only those to Apex
  // and the rest again together, once. Any other failure of a shared request sends each read again alone. A read whose own
  // document would trip the query-only guard is never queued: it goes to Apex.
  const MAX_ROW_FIELDS = 10, MAX_DESCRIBES = 20;
  const queued = (list, size, run) => (item) => new Promise((ok, no) => {
    if (!list.length) setTimeout(() => { const all = list.splice(0); for (let i = 0; i < all.length; i += size) run(all.slice(i, i + size)); });
    list.push({ ...item, ok, no });
  });
  const settle = (r, work) => Promise.resolve().then(work).then(r.ok, r.no);

  // What a FieldUndefined message points at: { object, path } (path null when the object itself is unknown), else null.
  const FIELD_UNDEFINED = /FieldUndefined@\[uiapi\/query\/(\w+)((?:\/edges\/node\/[\w/]+)?)\]/;
  function undefinedAt(message) {
    const m = FIELD_UNDEFINED.exec(unescapeHtml(String(message ?? '')));
    return m ? { object: m[1], path: m[2] ? m[2].slice('/edges/node/'.length).replace(/\//g, '.') : null } : null;
  }
  const remember = ({ object, path }) => { if (path) noGraphqlPaths.add(`${object}.${path}`); else noGraphql.add(object); };
  // A remembered path covers what is under it too: a refused relationship ('Provider') covers 'Provider.Name'.
  const skipsGraphql = (t) => noGraphql.has(t.object) || (t.paths || []).some((p) => [...noGraphqlPaths].some((k) => {
    const at = `${t.object}.`;
    return k.startsWith(at) && (p === k.slice(at.length) || p.startsWith(`${k.slice(at.length)}.`));
  }));

  // Apex answers a row read that GraphQL refused for a reason that is the read's own.
  function rowFallback(r, e, body) {
    if (!refused(e, body)) throw gqlError(e, body);
    // An error naming the object itself (nothing after it in the path) means the whole object is unknown; one naming a field, that field.
    for (const x of [e?.message, ...(Array.isArray(body?.errors) ? body.errors.map((y) => y?.message) : [])]) {
      const at = undefinedAt(x);
      if (at && at.object === r.t.object) remember(at);
    }
    return r.viaApex();
  }
  async function rowAlone(r) {
    let body;
    try { body = await postGraphql(r.t.query); return r.t.map(body); }
    catch (e) { return rowFallback(r, e, body); }
  }
  async function rowsTogether(batch, again = false) {
    if (batch.length === 1) return settle(batch[0], () => rowAlone(batch[0]));
    let body;
    try { body = await postGraphql(`query{uiapi{query{${batch.map((r, i) => `r${i}:${r.t.field}`).join(' ')}}}}`); } catch { body = null; }
    const errors = Array.isArray(body?.errors) ? body.errors : [];
    const own = (i) => errors.filter((e) => Array.isArray(e?.path) && e.path.includes(`r${i}`));
    const loose = errors.filter((e) => !batch.some((_, i) => own(i).includes(e)));
    // A validation error fails the whole document and names the object (never the alias): if every loose error points at a read
    // in this document, those reads go to Apex and the others go again together, once.
    if (!again && loose.length && !body?.data?.uiapi?.query) {
      const hits = loose.map((e) => undefinedAt(e?.message));
      const hit = (r, at) => at.object === r.t.object && (!at.path || r.t.paths?.some((p) => p === at.path || p.startsWith(`${at.path}.`)));
      if (hits.every((at) => at && batch.some((r) => hit(r, at)))) {
        hits.forEach(remember);
        const bad = batch.filter((r) => hits.some((at) => hit(r, at))), rest = batch.filter((r) => !bad.includes(r));
        bad.forEach((r) => settle(r, () => r.viaApex()));
        return rest.length ? rowsTogether(rest, true) : undefined;
      }
    }
    // No answer, or an error that belongs to no read: each read goes alone, and its own error decides what happens to it.
    if (!body?.data?.uiapi?.query || errors.length !== batch.reduce((n, _, i) => n + own(i).length, 0)) return batch.forEach((r) => settle(r, () => rowAlone(r)));
    batch.forEach((r, i) => {
      const mine = own(i), rows = { data: { uiapi: { query: { [r.t.object]: body.data.uiapi.query[`r${i}`] } } }, ...(mine.length && { errors: mine }) };
      settle(r, () => { try { return r.t.map(rows); } catch (e) { return rowFallback(r, e, rows); } });
    });
  }
  const queueRows = queued([], MAX_ROW_FIELDS, rowsTogether);
  function rowRead(soql, rawQ) {
    const viaApex = () => apex({ q: soql }, `${APEX}/query?q=${rawQ}`);
    const t = translateRows(soql);
    return !t || notQuery(t.query) || skipsGraphql(t) ? viaApex() : queueRows({ t, viaApex });
  }

  // The same for a describe: objectInfos has no info for a name GraphQL doesn't know, and Apex says whether the org lacks it.
  function describeFallback(d, e, body) {
    if (!refused(e, body)) throw gqlError(e, body);
    return d.viaApex();
  }
  const fromInfo = (d, info) => { if (info) return info; noGraphql.add(d.name); return d.viaApex(); };
  async function describeAlone(d) {
    let body;
    try { const doc = describeDoc([d.name]); body = await postGraphql(doc.query); return fromInfo(d, doc.split(body)[0]); }
    catch (e) { return describeFallback(d, e, body); }
  }
  async function describesTogether(batch) {
    if (batch.length === 1) return settle(batch[0], () => describeAlone(batch[0]));
    let infos;
    try { const doc = describeDoc(batch.map((d) => d.name)); infos = doc.split(await postGraphql(doc.query)); } catch { infos = null; }
    batch.forEach((d, i) => settle(d, () => (infos ? fromInfo(d, infos[i]) : describeAlone(d))));
  }
  const queueDescribes = queued([], MAX_DESCRIBES, describesTogether);
  function describeRead(name) {
    const viaApex = () => apex({ describe: name }, `${APEX}/describe/${name}`);
    return noGraphql.has(name) ? viaApex() : queueDescribes({ name, viaApex });
  }

  // One lookup through SomConsoleRead's batch endpoint (it takes a single item), answered as the REST API would.
  async function lookup(item) {
    const { results = [] } = await call(`${APEX}/batch`, true, { items: [item] });
    const r = results[0];
    if (r && r.status < 300) return r.body;
    throw fail(Array.isArray(r?.body) ? r.body.map((e) => e.message).join('; ') : 'No answer for this lookup', r?.status ?? 500);
  }

  // om-core.js asks for paths relative to /services/data/vXX.X. Only reads exist here.
  async function request(p, post) {
    const relay = RELAY_READS.find(([m, re]) => m === (post === undefined ? 'GET' : 'POST') && re.test(p));
    if (relay) return relayRead(relay[0], p, post);
    if (post !== undefined) {
      if (p === OCI) return lookup({ inventory: post });
      const est = p.match(ESTIMATE);
      if (est) return lookup({ estimate: { setup: decodeURIComponent(est[1]), input: post } });
      if (p === PREDUPE) return lookup({ duplicates: post });
      throw fail('Not available inside Salesforce', 404);
    }
    const q = p.match(/^\/query\?q=(.+)$/);
    if (q) {
      const soql = decodeURIComponent(q[1]);
      const t = translate(soql, SERIES.test(soql) ? { timeZone: await timeZone() } : undefined);
      const viaApex = () => apex({ q: soql }, `${APEX}/query?q=${q[1]}`);
      if (t) return graphql(t).catch((e) => (e.incomplete || e.unsupported ? viaApex() : Promise.reject(e)));
      return graphqlReads ? rowRead(soql, q[1]) : viaApex();
    }
    const d = p.match(/^\/sobjects\/(\w+)\/describe$/);
    if (d && graphqlReads) return describeRead(d[1]);
    if (d) return apex({ describe: d[1] }, `${APEX}/describe/${d[1]}`);
    // OM Service Console's customer search (SOSL). Until SomConsoleRead can search, this is a 404 and om-core falls back to SOQL.
    const sr = p.match(/^\/search\?q=(.+)$/);
    if (sr) return apex({ s: decodeURIComponent(sr[1]) }, `${APEX}/search?q=${sr[1]}`);
    // The org's limits (REST /limits is closed to the app domain's session, so Apex's OrgLimits answers in its shape).
    // ?only=api is the live view's cheap poll: just the daily API request count.
    const lim = p.match(/^\/limits(\?only=api)?$/);
    if (lim) return call(`${APEX}/limits${lim[1] || ''}`);
    // The Tooling API is closed here too. Whether SomConsoleConnect is deployed (only orgs with Omnichannel Inventory and
    // Delivery Estimation get it) answers the two feature settings om-core.js asks for, in the Tooling API's shape.
    const feat = p.match(/^\/tooling\/query\?q=SELECT%20(IsOmniChannelInventoryEnabled|DeliveryEstimationEnabled)%20FROM%20\w+%20LIMIT%201$/);
    if (feat) return call(`${APEX}/features`).then((r) => ({ records: [{ [feat[1]]: r.connect === true }] }));
    // Whether the order policy objects are deployed (om-core-facts.js's policyBook asks, to tell "none" from "can't read them"):
    // SomConsoleRead knows from the org's schema, which doesn't depend on the user's access.
    if (p === `/tooling/query?q=${encodeURIComponent("SELECT DeveloperName FROM CustomObject WHERE DeveloperName = 'SOM_Return_Policy'")}`) {
      return call(`${APEX}/features`).then((r) => {
        if (typeof r.policies !== 'boolean') throw Object.assign(new Error('SomConsoleRead doesn’t say whether policies are deployed'), { httpStatus: 404 });
        return { records: r.policies ? [{ DeveloperName: 'SOM_Return_Policy' }] : [] };
      });
    }
    // A store's Experience Cloud site (where its CMS images come from): Connect's communities, which the app domain answers.
    const net = p.match(/^\/connect\/communities\/([A-Za-z0-9]{15,18})$/);
    if (net) return call(`${UI_API}/connect/communities/${net[1]}`);
    const pm = p.match(PRODUCTS);
    if (pm) {
      const [, store, sku, qs] = pm, q = new URLSearchParams(qs), account = q.get('effectiveAccountId');
      return enqueue(sku ? { product: { store, account, sku: decodeURIComponent(sku), excludeMedia: q.get('excludeMedia') === 'true', excludePrices: q.get('excludePrices') === 'true' } }
        : { products: { store, account, searchTerm: q.get('searchTerm') || '', page: Number(q.get('page') || 0), pageSize: Number(q.get('pageSize') || 12) } }, null);
    }
    throw fail('Not available inside Salesforce', 404);
  }

  // Record links go to the org's own domain: acme--c.my.salesforce.app → https://acme.my.salesforce.com.
  // A sandbox or scratch org keeps its label: acme-dev--c.scratch.my.salesforce.app → https://acme-dev.scratch.my.salesforce.com.
  const instanceUrl = () => orgDomainUrl(host());
  // No apiVersion: /composite isn't reachable from the app domain, so queries go one by one.
  const core = createCore({ request, instanceUrl, apiVersion: () => null });

  let me = null;
  async function status() {
    if (isBlocked(CONFIG.blocked, instanceUrl())) return { connected: false, error: BLOCKED_MESSAGE };
    me ||= await call(`${UI_API}/chatter/users/me`).catch((e) => ({ error: e }));
    if (me.error) return { connected: false, error: me.error.message };
    if (isBlocked(CONFIG.blocked, me.username)) return { connected: false, error: BLOCKED_MESSAGE };
    return { connected: true, username: me.username || me.name || 'Signed in', instanceUrl: instanceUrl(), platform: true };
  }

  // Agentforce's chat. The app domain can't reach the Agent API, so questions go to the SomConsoleAgent Apex class, which asks the
  // agent through its invocable action. The panel's session Id is a local handle; the agent's own session Id arrives with
  // the first reply and is sent with every later question. Ending a session is local: agent sessions expire by themselves.
  const sessions = new Map(); // panel handle → agent session Id (null until the first reply)
  async function agentRoute(method, url, body) {
    if (method === 'POST' && url === '/api/agent/session') {
      const id = `om-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      sessions.set(id, null);
      return { sessionId: id };
    }
    if (method === 'POST' && url === '/api/agent/message') {
      let b = {}; try { b = JSON.parse(body || '{}') || {}; } catch {}
      const { sessionId, text } = agentMessage(b);
      const r = await call(`${APEX}/agent`, true, { text, sessionId: sessions.get(sessionId) ?? null });
      if (sessions.has(sessionId) && r.sessionId) sessions.set(sessionId, r.sessionId);
      return { text: unwrapReply(r.text), actions: [], guardHit: false };
    }
    const end = method === 'DELETE' && url.match(/^\/api\/agent\/session\/([^/]+)$/);
    if (end) { sessions.delete(decodeURIComponent(end[1])); return { ok: true }; }
    throw fail('Not available inside Salesforce', 404);
  }

  // OM Service Console's order actions, off unless that page turns them on. om-actions.js checks each call against its allowlist
  // before send() sees it; the Apex class checks the path and inputs again. Answers are { status, body }, as om-actions expects.
  // A write is sent once: the 401 retry is only for a stale CSRF token, which Salesforce rejects before running anything.
  let actions = null;
  // `scope` names the order a payment call is for, and the relay holds the call to it (SomServicePayment); or it says a swap's
  // agent overrode the cancel policy, which the relay's own policy check (SomServicePolicy) then lets through.
  async function sendAction(method, path, body, scope = null, retry = true) {
    const t = await token();
    const init = { method: 'POST', credentials: 'include', signal: AbortSignal.timeout(COMPOSITE_MS),
      headers: { 'X-CSRF-Token': t, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(scope ? { method, path, body, scope } : { method, path, body }) };
    const started = Date.now();
    let res;
    try { res = await fetchImpl(ACTIONS, init); }
    catch (e) { report(ACTIONS, 'POST', started, null, undefined, 'action'); throw isTooSlow(e) ? fail('Salesforce took too long to answer. Check the order before trying again.', 504) : e; }
    report(ACTIONS, 'POST', started, res, undefined, 'action');
    if (res.status === 401 && retry) { csrf = null; return sendAction(method, path, body, scope, false); }
    if (res.status === 401) throw fail('Your Salesforce session has expired. Reload the page.', 401);
    const b = await res.json().catch(() => ({}));
    if (!res.ok) return { status: res.status, body: b };
    return { status: b.status, body: b.body };
  }
  // A read through the relay: its answer, or the error with `authorize` when the agent hasn't allowed API access yet. A GET
  // sends no body. Only a page that turned on actions (OM Service Console) reaches the relay; the console's drawer reads none.
  async function relayRead(method, path, body) {
    if (!actions) throw fail('Not available inside Salesforce', 404);
    const r = await sendAction(method, path, body);
    if (r.status < 300) return r.body;
    const errs = Array.isArray(r.body) ? r.body : [];
    throw Object.assign(fail(errorText(r.body) || `HTTP ${r.status}`, r.status), errs.some((e) => e?.errorCode === 'NEEDS_AUTHORIZATION') ? { authorize: true } : {});
  }
  async function actionRoute(body) {
    if (!actions) throw fail('Not available inside Salesforce', 404);
    let b; try { b = JSON.parse(body || '{}'); } catch { throw fail('Bad JSON', 400); }
    return (await actions).run(b);
  }

  // Whether this agent has authorized OM Service Console's named credential (what checkout and full cart pricing go through).
  const apiAccess = async () => { if (!actions) throw fail('Not available inside Salesforce', 404); return (await sendAction('GET', '/self-check')).body || { authorized: false }; };

  async function route(url, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    if (method === 'GET' && url === '/api/cs/api-access') return apiAccess();
    if (method === 'GET') return core.route(url);
    return method === 'POST' && url === '/api/cs/action' ? actionRoute(opts.body) : agentRoute(method, url, opts.body);
  }

  const enableActions = () => { if (!loadActions) throw fail('Not available inside Salesforce', 404); actions ||= loadActions().then((m) => m.createActions({ send: sendAction, version: '68.0', payments: (id) => core.paymentFacts(id), policy: (id, o) => core.policyFacts(id, o), bundles: (id, of) => core.bundleFacts(id, of),
    products: (store, account, sku) => core.productFacts(store, account, sku), pictures: (id, store, account) => core.pictureFacts(id, store, account),
  paylinks: { facts: (store, account, cart) => core.paylinkFacts(store, account, cart), get: (id) => core.paylinkRead(id) } })); };
  return { request, route, status, instanceUrl, enableActions };
}

// The page's single instance.
