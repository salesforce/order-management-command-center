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
// Batches the live page's reads into UI API GraphQL, so the full console fits Cowork's 30 connector calls a minute. Each batch
// is a GET of /graphql?queryInput=…, which dispatch_readonly carries like any other GET.
// - Aggregates: every /query whose SOQL translate() (om-graphql.js) turns into one GraphQL document, issued in the same tick,
//   goes out in one request. Each document's fields get a unique alias, and the answer is split back into the body each
//   translate() result's map() expects. Salesforce allows 10 data fetchers (top-level fields) per request (a demo org: "The
//   number of data fetchers in the query is 11, exceed the data fetcher limitation 10"). Time series stay SOQL: translate()
//   splits them into a document per 5 buckets, so one SOQL call would become several GraphQL ones.
// - Describes: those issued in the same tick go out as one objectInfos, answered in the REST describe's shape. On a demo org
//   objectInfos lists every field and relationship describe does, plus UI-only ones (CloneSourceId) the console never asks for.
//   An object it has no info for is either missing or one UI API doesn't support (Refund), so that one asks REST's describe,
//   whose 404 is what says the org lacks it.
// One field UI API doesn't know fails the whole request as a validation error, with no data for any field (a demo org:
// "FieldUndefined@[uiapi/aggregate/Refund]"). So an object objectInfos had no info for is kept out of batches, and a batch
// that fails validation sends the objects it names as SOQL and goes again once without them.
// Anything else goes as it is, and a read whose part of a batch fails goes again on its own, so batching never costs a panel
// its data. Read-only by construction: only `query` documents are sent.

export const MAX_FIELDS = 10; // data fetchers per GraphQL request
export const MAX_OBJECTS = 20; // objects per objectInfos request (11 came to 130 KB)
const DOC = /^query\{uiapi\{aggregate\{([\s\S]*)\}\}\}$/;

// The top-level fields of a translator document's aggregate { … }: [{ key, text }], key being the alias or object name the
// translator's map() reads. null when the document isn't in that shape, so it isn't merged.
export function fieldsOf(doc) {
  const m = typeof doc === 'string' && doc.match(DOC);
  if (!m) return null;
  const body = m[1], out = [], open = [];
  let start = null, quote = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { if (c === '\\') i++; else if (c === '"') quote = false; continue; }
    if (c === '"') { quote = true; continue; }
    if (start === null) { if (/\s/.test(c)) continue; start = i; }
    if (c === '{' || c === '(') open.push(c);
    else if (c === '}' || c === ')') {
      if (open.pop() !== (c === '}' ? '{' : '(')) return null;
      if (!open.length && c === '}') { // a field ends with its selection set
        const text = body.slice(start, i + 1), k = text.match(/^(?:(\w+)\s*:\s*)?(\w+)\s*[({]/);
        if (!k) return null;
        out.push({ key: k[1] || k[2], text: k[1] ? text.slice(text.indexOf(':') + 1).trim() : text });
        start = null;
      }
    }
  }
  return !open.length && start === null && !quote && out.length ? out : null;
}

// docs → { query, split(body) }: one document with every field under a unique alias, and split(answer) → one body per input
// document, in the shape translate()'s map() reads ({ data: { uiapi: { aggregate: { key: … } } }, errors }). An error with
// a path is given to its own document only; one without a path goes to them all.
export function mergeDocs(docs) {
  const parts = docs.map((d, i) => {
    const fields = fieldsOf(d);
    if (!fields) throw new Error(`Document ${i} isn't one the batcher can merge`);
    return fields.map((f, j) => ({ ...f, alias: `d${i}_${j}` }));
  });
  const query = `query{uiapi{aggregate{${parts.flat().map((f) => `${f.alias}:${f.text}`).join(' ')}}}}`;
  const split = (body) => {
    const agg = body?.data?.uiapi?.aggregate || {}, errors = Array.isArray(body?.errors) ? body.errors : [];
    const at = (e) => (Array.isArray(e?.path) ? e.path.find((p) => /^d\d+_\d+$/.test(p)) : null);
    return parts.map((fields) => {
      const mine = new Set(fields.map((f) => f.alias));
      const errs = errors.filter((e) => !at(e) || mine.has(at(e)));
      return { data: { uiapi: { aggregate: Object.fromEntries(fields.map((f) => [f.key, agg[f.alias]])) } }, ...(errs.length ? { errors: errs } : {}) };
    });
  };
  return { query, split };
}

// One objectInfos for several objects. → { query, split(body) → per object: { fields } (the REST describe's shape: name,
// relationshipName, referenceTo), or null when objectInfos has no info for it: the org lacks it, or UI API doesn't support it }.
export function objectInfos(names) {
  const query = `query{uiapi{objectInfos(apiNames:${JSON.stringify(names)}){ApiName fields{ApiName relationshipName referenceToInfos{ApiName}}}}}`;
  const split = (body) => {
    const infos = body?.data?.uiapi?.objectInfos, errors = Array.isArray(body?.errors) ? body.errors : [];
    if (!Array.isArray(infos) || infos.length !== names.length) throw new Error('objectInfos came back without an answer per object');
    return names.map((name, i) => {
      const o = infos[i];
      if (o && o.ApiName === name && Array.isArray(o.fields)) {
        return { fields: o.fields.map((f) => ({ name: f.ApiName, relationshipName: f.relationshipName ?? null, referenceTo: (f.referenceToInfos || []).map((r) => r.ApiName) })) };
      }
      const e = errors.find((x) => Array.isArray(x?.path ?? x?.paths) && (x.path ?? x.paths).at(-1) === i);
      if (o === null && e && /No ObjectInfo/i.test(e.message || '')) return null;
      throw new Error(`objectInfos gave no answer for ${name}`);
    });
  };
  return { query, split };
}

// The objects a validation error names: "Validation error (FieldUndefined@[uiapi/aggregate/Refund]) : …" → ['Refund'].
export const undefinedObjects = (body) => (Array.isArray(body?.errors) ? body.errors : [])
  .flatMap((e) => [...String(e?.message || '').matchAll(/FieldUndefined@\[uiapi\/aggregate\/(\w+)\]/g)].map((m) => m[1]));
const objectOf = (doc) => fieldsOf(doc)?.[0]?.text.match(/^(\w+)/)?.[1] ?? null;

// get(path) → the REST answer (createCore's request, through the connector). Returns createCore's request(path, post), with
// aggregates and describes batched. After a GraphQL request fails outright (say the connector doesn't pass /graphql), it
// isn't tried again: reads go one by one.
export function createBatcher({ get, translate, maxFields = MAX_FIELDS, maxObjects = MAX_OBJECTS, onBatch = () => {} }) {
  let queries = [], describes = [], broken = false;
  const notInUiApi = new Set(); // objects GraphQL can't aggregate: their reads go as SOQL
  const gql = (query) => get(`/graphql?queryInput=${encodeURIComponent(JSON.stringify({ query }))}`);
  const giveUp = (e) => { if (!e.httpStatus || e.httpStatus === 404 || e.httpStatus === 405) broken = true; };
  const alone = (x) => get(x.p).then(x.ok, x.no);

  async function runQueries(items, again = true) {
    let body, bodies;
    try {
      const m = mergeDocs(items.map((x) => x.t.query));
      body = await gql(m.query);
      bodies = m.split(body);
      onBatch({ kind: 'aggregates', queries: items.length, fields: items.reduce((n, x) => n + x.size, 0) });
    } catch (e) { giveUp(e); return items.forEach(alone); }
    const named = undefinedObjects(body).filter((o) => items.some((x) => x.object === o));
    if (named.length && again) {
      named.forEach((o) => notInUiApi.add(o));
      const rest = items.filter((x) => !notInUiApi.has(x.object));
      items.filter((x) => notInUiApi.has(x.object)).forEach(alone);
      return rest.length ? runQueries(rest, false) : undefined;
    }
    items.forEach((x, i) => { try { x.ok(x.t.map(bodies[i])); } catch { alone(x); } });
  }
  async function runDescribes(items) {
    let answers;
    try {
      const m = objectInfos(items.map((x) => x.name));
      answers = m.split(await gql(m.query));
      onBatch({ kind: 'describes', objects: items.length });
    } catch (e) { giveUp(e); return items.forEach(alone); }
    items.forEach((x, i) => { if (answers[i]) x.ok(answers[i]); else { notInUiApi.add(x.name); alone(x); } });
  }
  function flush() {
    const qs = queries, ds = describes;
    queries = []; describes = [];
    let group = [], size = 0;
    for (const x of qs) {
      if (group.length && size + x.size > maxFields) { runQueries(group); group = []; size = 0; }
      group.push(x); size += x.size;
    }
    if (group.length) runQueries(group);
    for (let i = 0; i < ds.length; i += maxObjects) runDescribes(ds.slice(i, i + maxObjects));
  }
  const later = (list, x) => new Promise((ok, no) => {
    if (!queries.length && !describes.length) setTimeout(flush);
    list.push({ ...x, ok, no });
  });

  return async function request(p, post) {
    if (post !== undefined || broken) return get(p, post);
    const d = p.match(/^\/sobjects\/(\w+)\/describe$/);
    if (d) return later(describes, { p, name: d[1] });
    const m = p.match(/^\/query\?q=(.+)$/);
    if (!m) return get(p);
    // No time zone is given, so translate() leaves time series alone (null) and they go as SOQL.
    const t = translate(decodeURIComponent(m[1])), fields = typeof t?.query === 'string' && fieldsOf(t.query);
    const object = fields && objectOf(t.query);
    if (!fields || fields.length > maxFields || !object || notInUiApi.has(object)) return get(p);
    return later(queries, { t, p, object, size: fields.length });
  };
}
