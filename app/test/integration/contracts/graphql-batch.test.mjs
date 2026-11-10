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
import { translate } from "../../../public/shared/transport/om-graphql.js";
import { fieldsOf, mergeDocs, objectInfos, createBatcher, undefinedObjects, MAX_FIELDS } from "../../../tools/graphql-batch.js";

const COUNT = "SELECT COUNT(Id) c FROM Case WHERE IsClosed = false";
const BY_STATUS = "SELECT Status s, COUNT(Id) c FROM Case WHERE IsClosed = false GROUP BY Status";
const q = (soql) => `/query?q=${encodeURIComponent(soql)}`;
const count = (n) => ({ edges: [{ node: { aggregate: { Id: { count: { value: n } } } } }] });
const input = (p) => JSON.parse(new URLSearchParams(p.split('?')[1]).get('queryInput')).query;

test('fieldsOf reads the top-level fields of a translator document, aliases and quoted braces included', () => {
  assert.deepEqual(fieldsOf(translate(COUNT).query).map((f) => f.key), ['Case']);
  const doc = 'query{uiapi{aggregate{b0:Case(where:{Subject:{like:"{x}"}}){edges{node{aggregate{Id{count{value}}}}}} b1:Case(where:{Subject:{eq:"a\\"}"}}){edges{node{aggregate{Id{count{value}}}}}}}}}';
  const f = fieldsOf(doc);
  assert.deepEqual(f.map((x) => x.key), ['b0', 'b1']);
  assert.ok(f.every((x) => x.text.startsWith('Case(')));
  for (const bad of ['query{uiapi{query{Case{edges{node{Id}}}}}}', 'mutation{x}', 'query{uiapi{aggregate{Case(}}}}', '', null]) assert.equal(fieldsOf(bad), null, String(bad));
});

test('mergeDocs puts every field under its own alias and splits the answer back as each map() expects', () => {
  const a = translate(COUNT), b = translate(BY_STATUS), m = mergeDocs([a.query, b.query]);
  assert.match(m.query, /^query\{uiapi\{aggregate\{d0_0:Case\(where:\{IsClosed:\{eq:false\}\}\)\{.*\} d1_0:Case\(where:/);
  assert.equal(fieldsOf(m.query).length, 2);
  const [ba, bb] = m.split({ data: { uiapi: { aggregate: { d0_0: count(7), d1_0: { edges: [{ node: { aggregate: { Status: { value: 'New' }, Id: { count: { value: 4 } } } } }] } } } } });
  assert.deepEqual(a.map(ba).records, [{ c: 7 }]);
  assert.deepEqual(b.map(bb).records, [{ s: 'New', c: 4 }]);
  // An error with a path belongs to that document only; one without a path to them all.
  const [ea, eb] = m.split({ data: { uiapi: { aggregate: { d0_0: count(7) } } }, errors: [{ message: 'bad', path: ['uiapi', 'aggregate', 'd1_0'] }] });
  assert.equal(ea.errors, undefined);
  assert.deepEqual(eb.errors.map((e) => e.message), ['bad']);
  assert.ok(m.split({ errors: [{ message: 'all' }] }).every((x) => x.errors[0].message === 'all'));
  assert.throws(() => mergeDocs(['query{uiapi{query{Case{edges{node{Id}}}}}}']), /isn't one the batcher can merge/);
});

test('objectInfos answers in the REST describe\'s shape, and null where it has no info (missing, or not in UI API)', () => {
  const m = objectInfos(['Case', 'Agent_Proposal__c']);
  assert.equal(m.query, 'query{uiapi{objectInfos(apiNames:["Case","Agent_Proposal__c"]){ApiName fields{ApiName relationshipName referenceToInfos{ApiName}}}}}');
  const [c, missing] = m.split({
    data: { uiapi: { objectInfos: [{ ApiName: 'Case', fields: [{ ApiName: 'Id', relationshipName: null, referenceToInfos: [] }, { ApiName: 'AccountId', relationshipName: 'Account', referenceToInfos: [{ ApiName: 'Account' }] }] }, null] } },
    errors: [{ message: 'Exception while fetching data (/uiapi/objectInfos[1]) : No ObjectInfo for apiName: Agent_Proposal__c', paths: ['uiapi', 'objectInfos', 1] }], // a demo org's shape
  });
  assert.deepEqual(c, { fields: [{ name: 'Id', relationshipName: null, referenceTo: [] }, { name: 'AccountId', relationshipName: 'Account', referenceTo: ['Account'] }] });
  assert.equal(missing, null);
  assert.throws(() => m.split({ data: { uiapi: { objectInfos: [] } } }), /without an answer per object/);
  assert.throws(() => m.split({ data: { uiapi: { objectInfos: [null, null] } } }), /no answer for Case/);
});

// get() for the batcher: answers GraphQL from `answer(query)`, and REST from `rest(path)`.
function fakeGet({ answer, rest = (p) => ({ records: [{ via: 'rest', p }], done: true }) }) {
  const calls = [];
  const get = async (p, post) => {
    calls.push(post === undefined ? p : `POST ${p}`);
    if (p.startsWith('/graphql')) return answer(input(p));
    return rest(p, post);
  };
  return { calls, get };
}
const aliases = (query) => [...query.matchAll(/(d\d+_\d+):/g)].map((m) => m[1]);

test('aggregates issued together go as one GraphQL GET, at most 10 data fetchers each; the rest go as they are', async () => {
  const { calls, get } = fakeGet({ answer: (query) => ({ data: { uiapi: { aggregate: Object.fromEntries(aliases(query).map((a, i) => [a, count(i + 1)])) } } }) });
  const request = createBatcher({ get, translate });
  const twelve = Array.from({ length: 12 }, (_, i) => request(q(`${COUNT} AND CreatedDate = LAST_N_DAYS:${i + 1}`)));
  const plain = request(q('SELECT Id FROM Case LIMIT 5'));
  const series = request(q('SELECT DAY_ONLY(convertTimezone(CreatedDate)) d, COUNT(Id) c FROM Case WHERE CreatedDate = LAST_N_DAYS:3 GROUP BY DAY_ONLY(convertTimezone(CreatedDate))'));
  const out = await Promise.all(twelve);
  assert.deepEqual(out.map((r) => r.records[0].c), [...Array(10).keys()].map((i) => i + 1).concat([1, 2]));
  assert.equal(calls.filter((c) => c.startsWith('/graphql')).length, 2); // 10 + 2
  assert.ok(calls.filter((c) => c.startsWith('/graphql')).every((c) => aliases(input(c)).length <= MAX_FIELDS));
  assert.equal((await plain).records[0].via, 'rest');
  assert.equal((await series).records[0].via, 'rest'); // time series stay SOQL: no time zone is given
  await assert.rejects(Promise.reject(new Error('x')), /x/);
  assert.equal(await request('/composite', { a: 1 }).then((r) => r.records[0].via), 'rest'); // passed on; connectorRequest refuses it
  assert.ok(calls.includes('POST /composite'));
});

test('a query whose part of the batch fails goes again on its own; the others keep their answers', async () => {
  const { calls, get } = fakeGet({
    answer: (query) => {
      const [a, b] = aliases(query);
      return { data: { uiapi: { aggregate: { [a]: count(3) } } }, errors: [{ message: 'No such column', path: ['uiapi', 'aggregate', b] }] };
    },
    rest: () => ({ records: [{ c: 99 }], totalSize: 1, done: true }),
  });
  const request = createBatcher({ get, translate });
  const [ok, retried] = await Promise.all([request(q(COUNT)), request(q(BY_STATUS))]);
  assert.deepEqual(ok.records, [{ c: 3 }]);
  assert.deepEqual(retried.records, [{ c: 99 }]);
  assert.deepEqual(calls.map((c) => c.split('?')[0]), ['/graphql', '/query']);
});

test('describes issued together go as one objectInfos; one it has no info for asks REST, whose 404 says it is missing', async () => {
  const { calls, get } = fakeGet({
    answer: (query) => {
      const names = JSON.parse(query.match(/apiNames:(\[[^\]]*\])/)[1]);
      const none = (n) => n === 'Nope__c' || n === 'Refund'; // Refund exists, but UI API has no info for it (a demo org)
      return { data: { uiapi: { objectInfos: names.map((n) => (none(n) ? null : { ApiName: n, fields: [{ ApiName: 'Id', relationshipName: null, referenceToInfos: [] }] })) } },
        errors: names.flatMap((n, i) => (none(n) ? [{ message: `No ObjectInfo for apiName: ${n}`, paths: ['uiapi', 'objectInfos', i] }] : [])) };
    },
    rest: (p) => {
      if (p === '/sobjects/Nope__c/describe') throw Object.assign(new Error('NOT_FOUND'), { httpStatus: 404 });
      return { fields: [{ name: 'Id' }, { name: 'Amount' }] };
    },
  });
  const request = createBatcher({ get, translate });
  const [c, fo, missing, refund] = await Promise.allSettled(['Case', 'FulfillmentOrder', 'Nope__c', 'Refund'].map((o) => request(`/sobjects/${o}/describe`)));
  assert.deepEqual(c.value, { fields: [{ name: 'Id', relationshipName: null, referenceTo: [] }] });
  assert.equal(fo.status, 'fulfilled');
  assert.equal(missing.reason.httpStatus, 404);
  assert.deepEqual(refund.value, { fields: [{ name: 'Id' }, { name: 'Amount' }] }); // from REST, not taken for missing
  assert.deepEqual(calls.map((c) => c.split('?')[0]), ['/graphql', '/sobjects/Nope__c/describe', '/sobjects/Refund/describe']);
});

test('when GraphQL itself is refused (say the connector won\'t pass /graphql), reads go one by one from then on', async () => {
  const { calls, get } = fakeGet({ answer: () => { throw Object.assign(new Error('Not a read this page makes'), { httpStatus: 404 }); } });
  const request = createBatcher({ get, translate });
  const [a, d] = await Promise.all([request(q(COUNT)), request('/sobjects/Case/describe')]);
  assert.equal(a.records[0].via, 'rest');
  assert.equal(d.records[0].via, 'rest');
  const before = calls.length;
  await request(q(COUNT));
  assert.deepEqual(calls.slice(before).map((c) => c.split('?')[0]), ['/query']); // no GraphQL tried again
});

test('an object UI API does not know fails a whole batch; its reads go as SOQL and the rest go again once', async () => {
  // A demo org: one unknown field is a validation error with no data at all, even for the fields that were fine.
  const invalid = (o) => ({ data: {}, errors: [{ message: `Validation error (FieldUndefined@[uiapi/aggregate/${o}]) : Field 'Refund' in type 'RecordQueryAggregate' is undefined`, locations: [{ line: 1, column: 80 }], paths: [] }] });
  assert.deepEqual(undefinedObjects(invalid('Refund')), ['Refund']);
  const { calls, get } = fakeGet({
    answer: (query) => (/:Refund\(/.test(query) ? invalid('Refund') : { data: { uiapi: { aggregate: Object.fromEntries(aliases(query).map((a) => [a, count(5)])) } } }),
    rest: () => ({ records: [{ c: 2 }], totalSize: 1, done: true }),
  });
  const request = createBatcher({ get, translate });
  const REFUND = "SELECT COUNT(Id) c FROM Refund WHERE Status = 'Processed'";
  const [kase, refund] = await Promise.all([request(q(COUNT)), request(q(REFUND))]);
  assert.deepEqual(kase.records, [{ c: 5 }]);
  assert.deepEqual(refund.records, [{ c: 2 }]);
  assert.deepEqual(calls.map((c) => c.split('?')[0]), ['/graphql', '/query', '/graphql']);
  // Learned: Refund's next aggregate goes straight to SOQL.
  calls.length = 0;
  await request(q(REFUND));
  assert.deepEqual(calls.map((c) => c.split('?')[0]), ['/query']);
});

test('an object objectInfos has no info for is kept out of batches from then on', async () => {
  const { calls, get } = fakeGet({
    answer: (query) => (query.includes('objectInfos') ? { data: { uiapi: { objectInfos: [null] } }, errors: [{ message: 'No ObjectInfo for apiName: Refund', paths: ['uiapi', 'objectInfos', 0] }] } : assert.fail('no aggregate batch expected')),
    rest: (p) => (p.includes('/describe') ? { fields: [{ name: 'Id' }, { name: 'Status' }] } : { records: [{ c: 1 }], done: true }),
  });
  const request = createBatcher({ get, translate });
  await request('/sobjects/Refund/describe');
  await request(q("SELECT COUNT(Id) c FROM Refund WHERE Status = 'Processed'"));
  assert.deepEqual(calls.map((c) => c.split('?')[0]), ['/graphql', '/sobjects/Refund/describe', '/query']);
});
