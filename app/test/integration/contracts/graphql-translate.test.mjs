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
// Phases 1 and 2 (HAVING) of the in-org aggregate translator.
//
// Live verification (2026-10-09, read-only `query` documents against a large org, v68.0; 1,730,923 OrderSummary). Each
// generated document below was POSTed to /graphql and the mapped rows compared with `sf data query` for the same SOQL:
//   COUNT(Id) c, SUM(GrandTotalAmount) v ... OrderedDate = LAST_N_DAYS:3000      -> {c:1730822, v:101804637.91}, identical
//   Status s, COUNT(Id) c ... GROUP BY Status (same range)                          -> 5 rows, identical, same order
//   Account.Name nm, COUNT, SUM ... GROUP BY Account.Name ORDER BY SUM DESC LIMIT 10 -> identical (top 3 compared; 10s)
//   COUNT_DISTINCT(AccountId), MIN/AVG(GrandTotalAmount), MAX(OrderedDate)          -> identical (n:1509415, a:58.83196160083377)
//   Id NOT IN (SELECT ReferenceEntityId FROM Invoice)                                -> 1301173, identical (`Invoice:{}` is valid)
//   Id IN (SELECT OrderSummaryId FROM FulfillmentOrder WHERE Status = 'Fulfilled') AND Status IN (...) -> 429900, identical
//   OrderedDate = TODAY / >= THIS_YEAR / = THIS_YEAR, BillingCity != null            -> identical counts (0 / 96719 / 1730923)
//   OrderItemSummary 3-hop group OrderSummary.SalesChannel.SalesChannelName          -> identical
//   GrandTotalAmount IN (0, 10.5) GROUP BY BillingState ORDER BY BillingState        -> identical
//   ORDER BY Status ASC/DESC: SOQL here puts nulls FIRST both ways, GraphQL's default differs, so `nulls:FIRST` is emitted
//   ORDER BY MAX(OrderedDate) DESC: same nulls-first behaviour, GraphQL default already matches (no nulls arg sent)
//   ORDER BY COUNT_DISTINCT(AccountId): GraphQL rejects `function` on lookup fields (NoFunctionAggregateOrderByClause)
//     -> COUNT/COUNT_DISTINCT order on such a field is done client-side over all groups (see the 'lookup' test)
//   Datetime results come back as "…:00.000Z"; REST says "…:00.000+0000", so map() rewrites to the REST spelling.
//
// HAVING live check (2026-10-09, a large org): see the 'HAVING' tests; results are listed in the comment above them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translate } from "../../../public/shared/transport/om-graphql.js";

const q = (s) => translate(s)?.query;
const wrap = (obj, args, sel) => `query{uiapi{aggregate{${obj}${args ? `(${args})` : ''}{edges{node{aggregate{${sel}}}}}}}}`;
const ok = (soql, args, sel, obj = 'OrderSummary') => assert.equal(q(soql), wrap(obj, args, sel), soql);
const nul = (soql) => assert.equal(translate(soql), null, soql);
const body = (obj, rows) => ({ data: { uiapi: { aggregate: { [obj]: { edges: rows.map((aggregate) => ({ node: { aggregate } })) } } } } });

test('ungrouped aggregates are one row, with no first/groupBy', () => {
  ok('SELECT COUNT(Id) c, SUM(GrandTotalAmount) v FROM OrderSummary WHERE OrderedDate = LAST_N_DAYS:365',
    'where:{OrderedDate:{eq:{range:{last_n_days:365}}}}', 'Id{count{value}} GrandTotalAmount{sum{value}}');
  ok('SELECT COUNT() FROM OrderSummary', '', 'Id{count{value}}');
  ok('select count(id) c from OrderSummary', '', 'id{count{value}}');
});

test('LAST_N_MONTHS and the other N-literals are eq ranges; non-eq operators fall back', () => {
  ok('SELECT COUNT(Id) c FROM OrderSummary WHERE OrderedDate = LAST_N_MONTHS:6',
    'where:{OrderedDate:{eq:{range:{last_n_months:6}}}}', 'Id{count{value}}');
  ok('SELECT COUNT(Id) c FROM OrderSummary WHERE CreatedDate = NEXT_N_WEEKS:2',
    'where:{CreatedDate:{eq:{range:{next_n_weeks:2}}}}', 'Id{count{value}}');
  nul('SELECT COUNT(Id) c FROM OrderSummary WHERE OrderedDate >= LAST_N_DAYS:90');
  nul('SELECT COUNT(Id) c FROM OrderSummary WHERE OrderedDate != LAST_N_DAYS:90');
});

test('date literals use {literal:X}', () => {
  ok('SELECT COUNT(Id) c FROM OrderSummary WHERE OrderedDate = TODAY', 'where:{OrderedDate:{eq:{literal:TODAY}}}', 'Id{count{value}}');
  ok('SELECT COUNT(Id) c FROM OrderSummary WHERE OrderedDate >= THIS_YEAR',
    'where:{OrderedDate:{gte:{literal:THIS_YEAR}}}', 'Id{count{value}}');
  ok('SELECT COUNT(Id) c FROM Case WHERE CreatedDate = LAST_90_DAYS', 'where:{CreatedDate:{eq:{literal:LAST_90_DAYS}}}',
    'Id{count{value}}', 'Case');
  nul('SELECT COUNT(Id) c FROM OrderSummary WHERE OrderedDate = BOGUS_LITERAL');
});

test('ISO datetimes become {value:"…Z"}; ms and offsets fall back', () => {
  ok('SELECT COUNT(Id) c FROM OrderSummary WHERE OrderedDate >= 2026-01-01T00:00:00Z AND OrderedDate < 2026-07-01T00:00:00Z',
    'where:{and:[{OrderedDate:{gte:{value:"2026-01-01T00:00:00Z"}}},{OrderedDate:{lt:{value:"2026-07-01T00:00:00Z"}}}]}',
    'Id{count{value}}');
  nul('SELECT COUNT(Id) c FROM OrderSummary WHERE OrderedDate >= 2026-01-01T00:00:00.000Z');
  nul('SELECT COUNT(Id) c FROM OrderSummary WHERE OrderedDate >= 2026-01-01T00:00:00+01:00');
});

test('group by a direct field; unaliased group fields keep their name', () => {
  ok('SELECT Status s, COUNT(Id) c FROM OrderSummary GROUP BY Status',
    'groupBy:{Status:{group:true}},first:1999', 'Status{value} Id{count{value}}');
  ok('SELECT Status, BillingState FROM OrderSummary GROUP BY Status, BillingState',
    'groupBy:{Status:{group:true},BillingState:{group:true}},first:1999', 'Status{value} BillingState{value}');
});

test('parent paths (1 to 3 hops) in select, group by and where', () => {
  ok('SELECT Account.Name nm, COUNT(Id) c, SUM(GrandTotalAmount) v FROM OrderSummary WHERE OrderedDate = LAST_N_DAYS:365 ' +
    'GROUP BY Account.Name ORDER BY SUM(GrandTotalAmount) DESC LIMIT 10',
    'where:{OrderedDate:{eq:{range:{last_n_days:365}}}},groupBy:{Account:{Name:{group:true}}},' +
    'orderBy:{GrandTotalAmount:{function:SUM,order:DESC}},first:10',
    'Account{Name{value}} Id{count{value}} GrandTotalAmount{sum{value}}');
  ok("SELECT OrderSummary.SalesChannel.SalesChannelName s, SUM(QuantityOrdered) o FROM OrderItemSummary " +
    "WHERE OrderSummary.OrderedDate = LAST_N_DAYS:90 AND TypeCode = 'Product' GROUP BY OrderSummary.SalesChannel.SalesChannelName",
    'where:{and:[{OrderSummary:{OrderedDate:{eq:{range:{last_n_days:90}}}}},{TypeCode:{eq:"Product"}}]},' +
    'groupBy:{OrderSummary:{SalesChannel:{SalesChannelName:{group:true}}}},first:1999',
    'OrderSummary{SalesChannel{SalesChannelName{value}}} QuantityOrdered{sum{value}}', 'OrderItemSummary');
  ok('SELECT Account.IsPersonAccount p, COUNT(Id) c FROM OrderSummary GROUP BY Account.IsPersonAccount',
    'groupBy:{Account:{IsPersonAccount:{group:true}}},first:1999', 'Account{IsPersonAccount{value}} Id{count{value}}');
  nul('SELECT A.B.C.D.E x, COUNT(Id) FROM OrderSummary GROUP BY A.B.C.D.E'); // deeper than 3 hops
});

test('COUNT_DISTINCT, MIN, MAX, AVG share a node with the group key on the same field', () => {
  ok('SELECT COUNT_DISTINCT(AccountId) n, MIN(GrandTotalAmount) lo, AVG(GrandTotalAmount) a, MAX(OrderedDate) hi FROM OrderSummary',
    '', 'AccountId{countDistinct{value}} GrandTotalAmount{min{value} avg{value}} OrderedDate{max{value}}');
  ok('SELECT AccountId a, COUNT_DISTINCT(AccountId) n FROM OrderSummary GROUP BY AccountId',
    'groupBy:{AccountId:{group:true}},first:1999', 'AccountId{value countDistinct{value}}');
});

test('filters: comparisons, IN / NOT IN lists, LIKE, null, booleans, AND/OR/NOT/parentheses', () => {
  ok("SELECT COUNT(Id) c FROM OrderSummary WHERE Status IN ('Fulfilled','Created') AND Total NOT IN (1, 2.5) AND A = true AND B != null AND C = null",
    'where:{and:[{Status:{in:["Fulfilled","Created"]}},{Total:{nin:[1,2.5]}},{A:{eq:true}},{B:{ne:null}},{C:{eq:null}}]}',
    'Id{count{value}}');
  ok("SELECT COUNT(Id) c FROM OrderSummary WHERE Name = 'x' OR (Name = 'y' AND NOT Total > 5)",
    'where:{or:[{Name:{eq:"x"}},{and:[{Name:{eq:"y"}},{not:{Total:{gt:5}}}]}]}', 'Id{count{value}}');
  ok("SELECT COUNT(Id) c FROM OrderSummary WHERE Name LIKE 'A%' AND T <= 3 AND U >= -4 AND V < 1 AND W <> 'q'",
    'where:{and:[{Name:{like:"A%"}},{T:{lte:3}},{U:{gte:-4}},{V:{lt:1}},{W:{ne:"q"}}]}', 'Id{count{value}}');
  ok("SELECT COUNT(Id) c FROM OrderSummary WHERE Account.Name LIKE 'A%'", 'where:{Account:{Name:{like:"A%"}}}', 'Id{count{value}}');
});

test('IN / NOT IN subqueries become inq / ninq join filters', () => {
  ok('SELECT COUNT(Id) c FROM OrderSummary WHERE Id NOT IN (SELECT ReferenceEntityId FROM Invoice)',
    'where:{Id:{ninq:{Invoice:{},ApiName:"ReferenceEntityId"}}}', 'Id{count{value}}');
  ok("SELECT COUNT(Id) c FROM OrderSummary WHERE Id IN (SELECT OrderSummaryId FROM FulfillmentOrder WHERE Status = 'Fulfilled' AND CreatedDate = TODAY)",
    'where:{Id:{inq:{FulfillmentOrder:{and:[{Status:{eq:"Fulfilled"}},{CreatedDate:{eq:{literal:TODAY}}}]},ApiName:"OrderSummaryId"}}}',
    'Id{count{value}}');
  ok("SELECT COUNT(Id) c FROM OrderSummary WHERE OrderedDate = LAST_N_DAYS:30 AND Id NOT IN (SELECT ReferenceEntityId FROM Invoice WHERE Balance > 0)",
    'where:{and:[{OrderedDate:{eq:{range:{last_n_days:30}}}},{Id:{ninq:{Invoice:{Balance:{gt:0}},ApiName:"ReferenceEntityId"}}}]}',
    'Id{count{value}}');
});

test('ORDER BY an aggregate or a group field; LIMIT becomes first, capped at 2000', () => {
  ok('SELECT Status s, COUNT(Id) c FROM OrderSummary GROUP BY Status ORDER BY COUNT(Id) DESC LIMIT 5',
    'groupBy:{Status:{group:true}},orderBy:{Id:{function:COUNT,order:DESC}},first:5', 'Status{value} Id{count{value}}');
  ok('SELECT Status s, COUNT(Id) c FROM OrderSummary GROUP BY Status ORDER BY MAX(OrderedDate)',
    'groupBy:{Status:{group:true}},orderBy:{OrderedDate:{function:MAX,order:ASC}},first:1999',
    'Status{value} Id{count{value}}');
  ok('SELECT Status s, COUNT(Id) c FROM OrderSummary GROUP BY Status ORDER BY Status DESC',
    'groupBy:{Status:{group:true}},orderBy:{Status:{order:DESC,nulls:FIRST}},first:1999', 'Status{value} Id{count{value}}');
  ok('SELECT Status s, COUNT(Id) c FROM OrderSummary GROUP BY Status ORDER BY Status ASC NULLS LAST LIMIT 3000',
    'groupBy:{Status:{group:true}},orderBy:{Status:{order:ASC,nulls:LAST}},first:1999', 'Status{value} Id{count{value}}');
  ok('SELECT BillingState s, COUNT(Id) c FROM OrderSummary GROUP BY BillingState ORDER BY COUNT_DISTINCT(Status) DESC LIMIT 2',
    'groupBy:{BillingState:{group:true}},orderBy:{Status:{function:COUNT_DISTINCT,order:DESC}},first:2', 'BillingState{value} Id{count{value}}');
});

test('select uses the GROUP BY spelling of a field (GraphQL names are case-sensitive)', () => {
  ok('SELECT status s, COUNT(Id) c FROM OrderSummary GROUP BY Status', 'groupBy:{Status:{group:true}},first:1999',
    'Status{value} Id{count{value}}');
});

test('anything unsupported returns null, never throws', () => {
  for (const s of [
    'SELECT CALENDAR_YEAR(OrderedDate) y, COUNT(Id) FROM OrderSummary GROUP BY CALENDAR_YEAR(OrderedDate)',
    'SELECT DAY_ONLY(OrderedDate) d, COUNT(Id) FROM OrderSummary GROUP BY DAY_ONLY(OrderedDate)',
    'SELECT HOUR_IN_DAY(CreatedDate) h, COUNT(Id) FROM Case GROUP BY HOUR_IN_DAY(CreatedDate)',
    'SELECT convertTimezone(CreatedDate) d, COUNT(Id) FROM Case GROUP BY convertTimezone(CreatedDate)',
    'SELECT Id, Status FROM OrderSummary WHERE Status = \'Created\' LIMIT 10', // plain rows
    'SELECT Status, COUNT(Id) FROM OrderSummary', // field without GROUP BY
    'SELECT Status, Name, COUNT(Id) FROM OrderSummary GROUP BY Status', // field not grouped
    'SELECT COUNT(Id) FROM OrderSummary LIMIT 5', // limit with no group
    'SELECT COUNT(Id) FROM OrderSummary; SELECT COUNT(Id) FROM Case',
    'SELECT COUNT(Id) FROM OrderSummary;',
    'SELECT COUNT(Id) FROM OrderSummary OFFSET 5',
    'SELECT COUNT(Id) c FROM OrderSummary os',
    'SELECT COUNT(Id) FROM OrderSummary WHERE Total > Other', // field to field
    'SELECT COUNT(Id) FROM OrderSummary WHERE Id IN (SELECT Id FROM A LIMIT 5)', // subquery with extras
    'SELECT COUNT(Id) FROM OrderSummary WHERE Id IN (SELECT A.B FROM C)', // subquery selects a path
    'SELECT COUNT(Id) FROM OrderSummary WHERE Id IN (SELECT A, B FROM C)', // not a single field
    'SELECT COUNT(Id) FROM OrderSummary WHERE Id = (SELECT Id FROM C)', // scalar subquery
    'SELECT COUNT(Id) FROM OrderSummary WHERE Id > :x', // bind variable
    "SELECT COUNT(Id) FROM OrderSummary WHERE Status IN ('a', null)",
    'SELECT SUM(Account.Amount) FROM OrderSummary', // aggregate over a parent field
    'SELECT FIELDS(ALL) FROM OrderSummary',
    'SELECT Status, COUNT(Id) FROM OrderSummary GROUP BY ROLLUP(Status)',
    'SELECT Status, COUNT(Id) FROM OrderSummary GROUP BY Status ORDER BY Status, COUNT(Id)', // multi-key order
    'SELECT BillingState s, COUNT(Id) FROM OrderSummary GROUP BY BillingState ORDER BY SUM(AccountId) DESC', // lookup, not a count
    'SELECT Status s, COUNT(Id) FROM OrderSummary GROUP BY Status ORDER BY Other',
    'SELECT COUNT(Id) FROM OrderSummary WHERE', '', 'SELECT', null, undefined, 42, {},
  ]) assert.equal(translate(s), null, String(s));
});

test('string literals are escaped, and control characters / injection attempts are refused', () => {
  const t = translate("SELECT COUNT(Id) c FROM OrderSummary WHERE Name = 'a\\\\b\\'c\"d} } mutation { x'");
  assert.equal(t.query, wrap('OrderSummary', 'where:{Name:{eq:"a\\\\b\'c\\"d} } mutation { x"}}', 'Id{count{value}}'));
  assert.ok(t.query.startsWith('query{') && !/\bmutation\b(?![^"]*"\})/.test(t.query.replace(/"(?:[^"\\]|\\.)*"/g, '""')));
  // The unescaped quote in the SOQL stays inside the GraphQL string, and the string is still one token.
  assert.equal(JSON.parse(`[${/Name:\{eq:("(?:[^"\\]|\\.)*")\}/.exec(t.query)[1]}]`)[0], 'a\\b\'c"d} } mutation { x');
  // LIKE escapes keep their backslash.
  assert.match(q("SELECT COUNT(Id) c FROM OrderSummary WHERE Name LIKE '50\\%%'"), /like:"50\\\\%%"/);
  for (const bad of ['a\nb', 'a\u0000b', 'a\u0007b', 'a\u001bb', 'a b', 'a\\nb', 'a\\tb', 'a\\rb'])
    nul(`SELECT COUNT(Id) c FROM OrderSummary WHERE Name = '${bad}'`);
  // Unterminated string, comment or mutation keywords outside a string are not SOQL we know.
  nul("SELECT COUNT(Id) c FROM OrderSummary WHERE Name = 'abc");
  nul('SELECT COUNT(Id) c FROM OrderSummary WHERE Name = "abc"');
  nul("SELECT COUNT(Id) c FROM OrderSummary WHERE Name = 'a' } } } mutation { x");
  nul("SELECT COUNT(Id) c FROM OrderSummary WHERE Name = 'a' # comment");
  nul('SELECT COUNT(Id) c FROM OrderSummary WHERE Na{me = 1');
  nul("SELECT Sta$tus s, COUNT(Id) c FROM OrderSummary GROUP BY Sta$tus");
});

test('every translated document is a read query', () => {
  for (const s of ['SELECT COUNT(Id) FROM OrderSummary', 'SELECT Status, COUNT(Id) FROM OrderSummary GROUP BY Status',
    "SELECT COUNT(Id) FROM Case WHERE Subject = 'mutation'"]) assert.match(q(s), /^query\{/);
});

// ---------- map() ----------

test('map: flat rows keyed by alias, expr0.. for unaliased aggregates, numbers as numbers', () => {
  const t = translate('SELECT COUNT(Id) c, SUM(GrandTotalAmount), AVG(GrandTotalAmount) FROM OrderSummary');
  // recorded from a large org (shape of j1.out)
  const r = t.map(body('OrderSummary', [{ Id: { count: { value: 1730822 } }, GrandTotalAmount: { sum: { value: 101804637.91 }, avg: { value: 58.83196160083377 } } }]));
  assert.deepEqual(r, { records: [{ c: 1730822, expr0: 101804637.91, expr1: 58.83196160083377 }], totalSize: 1, done: true });
});

test('map: grouped rows, nulls kept, group value from {value}', () => {
  const t = translate('SELECT Status s, COUNT(Id) c FROM OrderSummary GROUP BY Status');
  const r = t.map(body('OrderSummary', [
    { Status: { value: 'Fulfilled' }, Id: { count: { value: 429887 } } },
    { Status: { value: null }, Id: { count: { value: 98 } } }]));
  assert.deepEqual(r.records, [{ s: 'Fulfilled', c: 429887 }, { s: null, c: 98 }]);
  assert.equal(r.totalSize, 2);
  assert.equal(r.done, true);
  assert.equal(r.records.capped, undefined);
});

test('map: relationship fields nest unless aliased; aliased ones are flat', () => {
  const rows = [{ Account: { Name: { value: 'Justa Test' } }, Id: { count: { value: 5 } } }];
  assert.deepEqual(translate('SELECT Account.Name, COUNT(Id) c FROM OrderSummary GROUP BY Account.Name').map(body('OrderSummary', rows)).records,
    [{ Account: { Name: 'Justa Test' }, c: 5 }]);
  assert.deepEqual(translate('SELECT Account.Name nm, COUNT(Id) c FROM OrderSummary GROUP BY Account.Name').map(body('OrderSummary', rows)).records,
    [{ nm: 'Justa Test', c: 5 }]);
  const deep = [{ OrderSummary: { SalesChannel: { SalesChannelName: { value: 'SiteGenesis' } } }, Q: { sum: { value: 2 } } }];
  assert.deepEqual(translate('SELECT OrderSummary.SalesChannel.SalesChannelName, SUM(Q) FROM OrderItemSummary GROUP BY OrderSummary.SalesChannel.SalesChannelName')
    .map(body('OrderItemSummary', deep)).records, [{ OrderSummary: { SalesChannel: { SalesChannelName: 'SiteGenesis' } }, expr0: 2 }]);
});

test('map: datetimes get the REST spelling, null aggregates stay null, numeric strings become numbers', () => {
  const t = translate('SELECT MAX(OrderedDate) hi, MIN(CreatedDate), SUM(Amount) s, MIN(Name) n FROM OrderSummary');
  const r = t.map(body('OrderSummary', [{ OrderedDate: { max: { value: '2026-09-24T16:07:34.000Z' } },
    CreatedDate: { min: { value: '2020-05-26T19:04:23Z' } }, Amount: { sum: { value: '12.50' } }, Name: { min: { value: null } } }]));
  assert.deepEqual(r.records, [{ hi: '2026-09-24T16:07:34.000+0000', expr0: '2020-05-26T19:04:23.000+0000', s: 12.5, n: null }]);
});

test('map: capped flag is non-enumerable and set only when the 2000-row cap is reached', () => {
  const t = translate('SELECT AccountId a, COUNT(Id) c FROM OrderSummary GROUP BY AccountId');
  const mk = (n) => body('OrderSummary', Array.from({ length: n }, (_, i) => ({ AccountId: { value: `001${i}` }, Id: { count: { value: 1 } } })));
  const full = t.map(mk(1999)).records;
  assert.equal(full.capped, true);
  assert.deepEqual(Object.keys(full).slice(-1), ['1998']);
  assert.equal(JSON.stringify(full).includes('capped'), false);
  assert.equal(t.map(mk(1998)).records.capped, undefined);
  const small = translate('SELECT AccountId a, COUNT(Id) c FROM OrderSummary GROUP BY AccountId LIMIT 10');
  assert.equal(small.map(mk(10)).records.capped, undefined); // REST does not flag a LIMIT 10 either
});

test('map: GraphQL errors throw with all messages joined; empty or odd bodies throw too', () => {
  const t = translate('SELECT COUNT(Id) c FROM OrderSummary');
  assert.throws(() => t.map({ data: { uiapi: { aggregate: { OrderSummary: null } } }, errors: [{ message: 'one' }, { message: 'two' }] }), /one; two/);
  assert.throws(() => t.map({ errors: [{ message: 'boom' }] }), /boom/);
  assert.throws(() => t.map({ data: null }), Error);
  assert.throws(() => t.map(null), Error);
});

test('map: an empty edge list is an empty result, not an error', () => {
  const t = translate('SELECT Status s, COUNT(Id) c FROM OrderSummary GROUP BY Status');
  assert.deepEqual(t.map(body('OrderSummary', [])), { records: [], totalSize: 0, done: true });
});

// ---------- HAVING ----------
// The 5 queries om-core.js builds (cur()/NOT_CANCELED/lit() expanded with representative values).
const NC = "Status NOT IN ('Canceled', 'Cancelled')";
const W = "OrderedDate = LAST_N_DAYS:365 AND AccountId != null AND " + NC;
const WH = "where:{and:[{OrderedDate:{eq:{range:{last_n_days:365}}}},{AccountId:{ne:null}},{Status:{nin:[\"Canceled\",\"Cancelled\"]}}]}";
const hrows = (...v) => body('OrderSummary', v.map((c) => ({ AccountId: { value: `001${c}` }, Id: { count: { value: c } } })));

test('HAVING: the 5 om-core.js queries translate', () => {
  ok(`SELECT AccountId FROM OrderSummary WHERE ${W} GROUP BY AccountId HAVING COUNT(Id) > 1 LIMIT 2000`,
    `${WH},groupBy:{AccountId:{group:true}},orderBy:{Id:{function:COUNT,order:DESC,nulls:LAST}},first:1999`, 'AccountId{value} Id{count{value}}');
  ok(`SELECT AccountId FROM OrderSummary WHERE AccountId != null AND ${NC} GROUP BY AccountId HAVING MIN(OrderedDate) >= 2026-01-01T00:00:00Z LIMIT 2000`,
    'where:{and:[{AccountId:{ne:null}},{Status:{nin:["Canceled","Cancelled"]}}]},groupBy:{AccountId:{group:true}},' +
    'orderBy:{OrderedDate:{function:MIN,order:DESC,nulls:LAST}},first:1999', 'AccountId{value} OrderedDate{min{value}}');
  ok(`SELECT AccountId FROM OrderSummary WHERE ${W} GROUP BY AccountId HAVING SUM(GrandTotalAmount) > 1234.50 LIMIT 2000`,
    `${WH},groupBy:{AccountId:{group:true}},orderBy:{GrandTotalAmount:{function:SUM,order:DESC,nulls:LAST}},first:1999`,
    'AccountId{value} GrandTotalAmount{sum{value}}');
  ok(`SELECT AccountId FROM OrderSummary WHERE ${W} GROUP BY AccountId HAVING COUNT(Id) > 7 LIMIT 2000`,
    `${WH},groupBy:{AccountId:{group:true}},orderBy:{Id:{function:COUNT,order:DESC,nulls:LAST}},first:1999`, 'AccountId{value} Id{count{value}}');
  ok('SELECT AccountId FROM ReturnOrder WHERE CreatedDate = LAST_N_DAYS:365 AND AccountId != null GROUP BY AccountId HAVING COUNT(Id) > 3 LIMIT 2000',
    'where:{and:[{CreatedDate:{eq:{range:{last_n_days:365}}}},{AccountId:{ne:null}}]},groupBy:{AccountId:{group:true}},' +
    'orderBy:{Id:{function:COUNT,order:DESC,nulls:LAST}},first:1999', 'AccountId{value} Id{count{value}}', 'ReturnOrder');
});

test('HAVING: < and <= sort ascending; the helper aggregate is shared with a selected one; LIMIT caps at 2000', () => {
  ok('SELECT AccountId FROM OrderSummary GROUP BY AccountId HAVING COUNT(Id) <= 2',
    'groupBy:{AccountId:{group:true}},orderBy:{Id:{function:COUNT,order:ASC,nulls:LAST}},first:1999', 'AccountId{value} Id{count{value}}');
  ok('SELECT AccountId a, COUNT(Id) c FROM OrderSummary GROUP BY AccountId HAVING COUNT(Id) != 1 LIMIT 5000',
    'groupBy:{AccountId:{group:true}},orderBy:{Id:{function:COUNT,order:DESC,nulls:LAST}},first:1999', 'AccountId{value} Id{count{value}}');
  ok('SELECT Status FROM OrderSummary GROUP BY Status HAVING MAX(OrderedDate) < 2026-01-01 LIMIT 10',
    'groupBy:{Status:{group:true}},orderBy:{OrderedDate:{function:MAX,order:ASC,nulls:LAST}},first:10', 'Status{value} OrderedDate{max{value}}');
  ok('select accountid from OrderSummary group by AccountId having sum(Total) = 5',
    'groupBy:{AccountId:{group:true}},orderBy:{Total:{function:SUM,order:DESC,nulls:LAST}},first:1999', 'AccountId{value} Total{sum{value}}');
});

test('HAVING: unsupported shapes return null', () => {
  for (const h of [
    'HAVING COUNT(Id) > 1 AND SUM(Total) > 5', 'HAVING COUNT(Id) > 1 OR COUNT(Id) < 0', 'HAVING (COUNT(Id) > 1)',
    'HAVING COUNT_DISTINCT(BillingState) > 1 ORDER BY COUNT(Id)', // with ORDER BY
    'HAVING COUNT_DISTINCT(ParentId) > 1', 'HAVING MAX(AccountId) > 1', // aggregate on a lookup
    'HAVING AVG(Total) > 1', 'HAVING Status = 1', 'HAVING COUNT(Id) > Total', "HAVING MIN(Name) > 'a'", 'HAVING COUNT(Id) > null',
    'HAVING COUNT(Id) > :n', 'HAVING COUNT(Id)', 'HAVING COUNT(Id) >', 'HAVING SUM(Account.Total) > 1', 'HAVING COUNT(Id) IN (1)',
    'HAVING COUNT(Id) > 1 HAVING COUNT(Id) < 9',
  ]) nul(`SELECT AccountId FROM OrderSummary GROUP BY AccountId ${h} LIMIT 2000`);
  nul('SELECT COUNT(Id) FROM OrderSummary HAVING COUNT(Id) > 1'); // no GROUP BY
  nul('SELECT AccountId FROM OrderSummary HAVING COUNT(Id) > 1');
});

test('HAVING map: filters on the aggregate, drops the helper, numeric compare', () => {
  const t = translate('SELECT AccountId FROM OrderSummary GROUP BY AccountId HAVING COUNT(Id) > 1 LIMIT 2000');
  const r = t.map(hrows(9, 3, 2, 1, 1));
  assert.deepEqual(r.records, [{ AccountId: '0019' }, { AccountId: '0013' }, { AccountId: '0012' }]);
  assert.equal(r.totalSize, 3);
  assert.equal(r.records.capped, undefined);
  const keep = translate('SELECT AccountId a, COUNT(Id) c FROM OrderSummary GROUP BY AccountId HAVING COUNT(Id) >= 2');
  assert.deepEqual(keep.map(hrows(3, 2, 1)).records, [{ a: '0013', c: 3 }, { a: '0012', c: 2 }]); // selected aggregate stays
  const lo = translate('SELECT AccountId FROM OrderSummary GROUP BY AccountId HAVING COUNT(Id) < 3');
  assert.deepEqual(lo.map(hrows(1, 2, 3, 4)).records, [{ AccountId: '0011' }, { AccountId: '0012' }]);
  const eq = translate('SELECT AccountId FROM OrderSummary GROUP BY AccountId HAVING COUNT(Id) = 2');
  assert.deepEqual(eq.map(hrows(5, 2, 2, 1)).records.length, 2);
  const ne = translate('SELECT AccountId FROM OrderSummary GROUP BY AccountId HAVING COUNT(Id) != 2');
  assert.deepEqual(ne.map(hrows(5, 2, 1)).records.length, 2);
  const sum = translate('SELECT AccountId FROM OrderSummary GROUP BY AccountId HAVING SUM(Total) > 10.5');
  const sb = body('OrderSummary', [{ AccountId: { value: 'a' }, Total: { sum: { value: '12.5' } } }, { AccountId: { value: 'b' }, Total: { sum: { value: 10.5 } } },
    { AccountId: { value: 'c' }, Total: { sum: { value: null } } }]);
  assert.deepEqual(sum.map(sb).records, [{ AccountId: 'a' }]);
});

test('HAVING map: MIN(OrderedDate) >= ISO compares instants and drops null groups', () => {
  const t = translate('SELECT AccountId FROM OrderSummary GROUP BY AccountId HAVING MIN(OrderedDate) >= 2026-01-01T00:00:00Z LIMIT 2000');
  const mk = (a, d) => ({ AccountId: { value: a }, OrderedDate: { min: { value: d } } });
  const r = t.map(body('OrderSummary', [mk('a', '2026-09-01T10:00:00.000Z'), mk('b', '2026-01-01T00:00:00Z'), mk('c', '2025-12-31T23:59:59.000Z'), mk('d', null)]));
  assert.deepEqual(r.records, [{ AccountId: 'a' }, { AccountId: 'b' }]);
  const before = translate('SELECT Status FROM OrderSummary GROUP BY Status HAVING MAX(OrderedDate) < 2026-01-01');
  assert.deepEqual(before.map(body('OrderSummary', [{ Status: { value: 'x' }, OrderedDate: { max: { value: '2025-12-31T00:00:00Z' } } },
    { Status: { value: 'y' }, OrderedDate: { max: { value: '2026-01-01T00:00:00Z' } } }])).records, [{ Status: 'x' }]);
});

test('HAVING map: capped only when a full 2000 page ends on a row that still qualifies', () => {
  const page = (n, f) => body('OrderSummary', Array.from({ length: n }, (_, i) => ({ AccountId: { value: `${i}` }, Id: { count: { value: f(i) } } })));
  const gt = translate('SELECT AccountId FROM OrderSummary GROUP BY AccountId HAVING COUNT(Id) > 1 LIMIT 2000');
  assert.equal(gt.map(page(1999, () => 2)).records.capped, true); // last row qualifies: more may follow
  assert.equal(JSON.stringify(gt.map(page(1999, () => 2)).records).includes('capped'), false);
  assert.equal(gt.map(page(1999, (i) => (i < 1500 ? 2 : 1))).records.capped, undefined); // reached the cutoff: complete
  assert.equal(gt.map(page(1998, () => 2)).records.capped, undefined); // short page: complete
  assert.equal(gt.map(page(1999, () => 2)).records.length, 1999);
  const lt = translate('SELECT AccountId FROM OrderSummary GROUP BY AccountId HAVING COUNT(Id) < 5');
  assert.equal(lt.map(page(1999, () => 1)).records.capped, true);
  assert.equal(lt.map(page(1999, (i) => (i < 10 ? 1 : 5))).records.capped, undefined);
  const eq = translate('SELECT AccountId FROM OrderSummary GROUP BY AccountId HAVING COUNT(Id) = 2');
  assert.equal(eq.map(page(1999, () => 9)).records.capped, true); // still above the literal: the matches may be further down
  assert.equal(eq.map(page(1999, (i) => (i < 5 ? 9 : 1))).records.capped, undefined);
  const ne = translate('SELECT AccountId FROM OrderSummary GROUP BY AccountId HAVING COUNT(Id) != 2');
  assert.equal(ne.map(page(1999, () => 2)).records.capped, true);
  const small = translate('SELECT AccountId FROM OrderSummary GROUP BY AccountId HAVING COUNT(Id) > 1 LIMIT 10');
  assert.equal(small.map(page(10, () => 2)).records.capped, undefined); // same as a plain LIMIT 10
});

// Live (2026-10-13, a large org): GraphQL sorts null aggregates FIRST in both directions (MIN(LastViewedDate) by Status: ASC and DESC both
// start with the null groups); `orderBy:{F:{function:MIN,order:DESC,nulls:LAST}}` is accepted and puts the non-null group first.
test('HAVING map: null aggregates filling the page are never reported as a complete (empty) result', () => {
  const mk = (n, v) => body('OrderSummary', Array.from({ length: n }, (_, i) => ({ AccountId: { value: `${i}` }, OrderedDate: { min: { value: v(i) } } })));
  const t = translate(`SELECT AccountId FROM OrderSummary WHERE AccountId != null AND ${NC} GROUP BY AccountId HAVING MIN(OrderedDate) >= 2026-01-01T00:00:00Z LIMIT 2000`);
  assert.match(t.query, /orderBy:\{OrderedDate:\{function:MIN,order:DESC,nulls:LAST\}\}/);
  assert.throws(() => t.map(mk(1999, () => null)), (e) => e.incomplete === true); // a full page of nulls: Apex must answer
  assert.throws(() => t.map(mk(1999, (i) => (i < 5 ? '2026-02-01T00:00:00Z' : null))), (e) => e.incomplete === true); // full page ending on null
  assert.throws(() => t.map(mk(3, (i) => (i === 0 ? null : '2026-02-01T00:00:00Z'))), (e) => e.incomplete === true); // nulls came first: order not honoured
  const done = t.map(mk(3, (i) => (i < 2 ? '2026-02-01T00:00:00Z' : null))); // nulls last on a short page: complete
  assert.deepEqual(done.records, [{ AccountId: '0' }, { AccountId: '1' }]);
  assert.equal(done.records.capped, undefined);
  const lt = translate('SELECT Status FROM OrderSummary GROUP BY Status HAVING MAX(OrderedDate) < 2026-01-01');
  assert.match(lt.query, /orderBy:\{OrderedDate:\{function:MAX,order:ASC,nulls:LAST\}\}/);
});

test('ORDER BY COUNT_DISTINCT(lookup) fetches every group and sorts here; a full page is refused', () => {
  const t = translate('SELECT BillingState s, BillingCity y, COUNT_DISTINCT(AccountId) c, COUNT(Id) o FROM OrderSummary ' +
    'WHERE AccountId != null GROUP BY BillingState, BillingCity ORDER BY COUNT_DISTINCT(AccountId) DESC LIMIT 2');
  assert.ok(!/orderBy/.test(t.query) && /first:1999/.test(t.query));
  const row = (s, y, c, o) => ({ BillingState: { value: s }, BillingCity: { value: y }, AccountId: { countDistinct: { value: c } }, Id: { count: { value: o } } });
  const r = t.map(body('OrderSummary', [row('CA', 'A', 1, 9), row('NY', 'B', 5, 5), row('TX', 'C', 3, 3)]));
  assert.deepEqual(r.records.map((x) => [x.s, x.y, x.c, x.o]), [['NY', 'B', 5, 5], ['TX', 'C', 3, 3]]);
  assert.ok(!r.records.capped);
  const full = Array.from({ length: 1999 }, (_, i) => row('S', `C${i}`, i, 1));
  assert.throws(() => t.map(body('OrderSummary', full)), (e) => e.incomplete === true);
  assert.equal(translate('SELECT BillingState s, COUNT(Id) FROM OrderSummary GROUP BY BillingState ORDER BY MAX(AccountId)'), null);
});

// ---------- time series (Dashboard "orders and returns over time") ----------
// GraphQL groupBy has one date function per field (CALENDAR_YEAR+CALENDAR_MONTH cannot be grouped together) and no time zone
// option: probed on a large org, DAY_ONLY/HOUR_IN_DAY/CALENDAR_MONTH group in UTC while SOQL convertTimezone() uses the user's
// zone (America/Los_Angeles), so hours and days differ. So translate(soql, { timeZone, now }) emits one COUNT per bucket
// (field >= start AND field < end, bucket edges at local midnight / local hour) and map() rebuilds the SOQL rows.
// Live check (a large org, user zone America/Los_Angeles), mapped rows identical to `sf data query` for the same SOQL:
//   month 2019-08..12, 2019-09-15..11-15, whole of 2020; day 2019-10-01..12-31 (48 rows); hour 2019-11-01..04 and 2020-10-31..11-03
//   (spans the DST end, 24 rows); an empty hour window (0 rows).
const LA = 'America/Los_Angeles';
const FIELD = 'OrderedDate';
const series = (cols, from, to) => `SELECT ${cols.map((c) => `${c}(convertTimezone(${FIELD}))`).join(', ')}, COUNT(Id) c FROM OrderSummary WHERE ${FIELD} >= ${from} AND ${FIELD} <= ${to} GROUP BY ${cols.map((c) => `${c}(convertTimezone(${FIELD}))`).join(', ')}`;
const MONTH = ['CALENDAR_YEAR', 'CALENDAR_MONTH'];
const countBody = (counts) => ({ data: { uiapi: { aggregate: Object.fromEntries(Object.entries(counts).map(([k, c]) => [k, { edges: [{ node: { aggregate: { Id: { count: { value: c } } } } }] }])) } } });
const win = (t) => [...t.queries.join('').matchAll(/gte:\{value:"([^"]+)"\}\}\},\{OrderedDate:\{lt:\{value:"([^"]+)"/g)].map((m) => [m[1], m[2]]);

test('series month: one bucket per local month, edges at local midnight on the 1st (PDT/PST)', () => {
  const t = translate(series(MONTH, '2025-10-09T12:00:00Z', '2026-01-05T12:00:00Z'), { timeZone: LA });
  assert.deepEqual(win(t), [['2025-10-01T07:00:00Z', '2025-11-01T07:00:00Z'], ['2025-11-01T07:00:00Z', '2025-12-01T08:00:00Z'],
    ['2025-12-01T08:00:00Z', '2026-01-01T08:00:00Z'], ['2026-01-01T08:00:00Z', '2026-02-01T08:00:00Z']]);
  assert.equal(t.queries.length, 1);
  assert.match(t.queries[0], /^query\{uiapi\{aggregate\{b0:OrderSummary\(where:\{and:\[\{and:\[\{OrderedDate:\{gte:\{value:"2025-10-09T12:00:00Z"\}\}\},\{OrderedDate:\{lte:/);
  assert.match(t.queries[0], /\{edges\{node\{aggregate\{Id\{count\{value\}\}\}\}\}\} b1:/);
});

test('series month: rows are { expr0: year, expr1: month, c }, empty buckets are dropped', () => {
  const t = translate(series(MONTH, '2025-10-09T12:00:00Z', '2026-01-05T12:00:00Z'), { timeZone: LA });
  assert.deepEqual(t.map([countBody({ b0: 5, b1: 0, b2: '7', b3: 1 })]), {
    records: [{ expr0: 2025, expr1: 10, c: 5 }, { expr0: 2025, expr1: 12, c: 7 }, { expr0: 2026, expr1: 1, c: 1 }], totalSize: 3, done: true });
});

test('series month: a year of months is split into documents of 5 buckets (UI API allows 10 data fetchers per document)', () => {
  const t = translate(series(MONTH, '2025-10-09T00:00:00Z', '2026-10-09T00:00:00Z'), { timeZone: LA });
  assert.equal(win(t).length, 13); assert.deepEqual(t.queries.map((d) => d.split('Id{count').length - 1), [5, 5, 3]);
  const bodies = t.queries.map((_, i) => countBody(Object.fromEntries([...Array(i === 2 ? 3 : 5).keys()].map((k) => [`b${i * 5 + k}`, 1]))));
  assert.equal(t.map(bodies).records.length, 13);
  assert.throws(() => t.map([{ errors: [{ message: 'boom' }] }]), /boom/);
});

test('series day: DAY_ONLY rows are { expr0: "YYYY-MM-DD", c }; the DST change days are 23/25 hours long', () => {
  const t = translate(series(['DAY_ONLY'], '2025-11-01T20:00:00Z', '2025-11-03T20:00:00Z'), { timeZone: LA });
  assert.deepEqual(win(t), [['2025-11-01T07:00:00Z', '2025-11-02T07:00:00Z'], ['2025-11-02T07:00:00Z', '2025-11-03T08:00:00Z'], ['2025-11-03T08:00:00Z', '2025-11-04T08:00:00Z']]);
  assert.deepEqual(t.map([countBody({ b0: 2, b1: 3, b2: 0 })]).records, [{ expr0: '2025-11-01', c: 2 }, { expr0: '2025-11-02', c: 3 }]);
});

test('series hour: HOUR_IN_DAY rows are { expr0: hour, c }; the same hour on several days (and a repeated DST hour) sum', () => {
  const t = translate(series(['HOUR_IN_DAY'], '2025-11-02T07:00:00Z', '2025-11-02T10:30:00Z'), { timeZone: LA });
  // 00:00 PDT, 01:00 PDT, 01:00 PST (the repeated hour), 02:00 PST
  assert.deepEqual(win(t).map((w) => w[0]), ['2025-11-02T07:00:00Z', '2025-11-02T08:00:00Z', '2025-11-02T09:00:00Z', '2025-11-02T10:00:00Z']);
  assert.deepEqual(t.map([countBody({ b0: 1, b1: 4, b2: 6, b3: 2 })]).records, [{ expr0: 0, c: 1 }, { expr0: 1, c: 10 }, { expr0: 2, c: 2 }]);
});

test('series: a half-hour zone gets half-hour aligned local hours', () => {
  const t = translate(series(['HOUR_IN_DAY'], '2025-06-01T00:00:00Z', '2025-06-01T02:00:00Z'), { timeZone: 'Asia/Kolkata' });
  assert.deepEqual(win(t)[0], ['2025-05-31T23:30:00Z', '2025-06-01T00:30:00Z']);
});

test('series hour: a 30-minute DST shift inside a bucket stays on Apex; windows clear of it, and day/month buckets, still translate', () => {
  // Australia/Lord_Howe 2026-10-04 02:00 +10:30 -> 02:30 +11:00 (= 15:30Z). The bucket 15:00-16:00Z holds local 01:30-02:00 AND 02:30-03:00,
  // so 15:45Z (local 02:45, hour 2) must not be counted as hour 1.
  const LH = 'Australia/Lord_Howe';
  assert.equal(translate(series(['HOUR_IN_DAY'], '2026-10-03T14:00:00Z', '2026-10-03T17:00:00Z'), { timeZone: LH }), null);
  assert.equal(translate(series(['HOUR_IN_DAY'], '2026-10-03T15:45:00Z', '2026-10-03T15:50:00Z'), { timeZone: LH }), null);
  assert.ok(translate(series(['HOUR_IN_DAY'], '2026-10-03T12:00:00Z', '2026-10-03T14:40:00Z'), { timeZone: LH })); // before the shift
  const after = translate(series(['HOUR_IN_DAY'], '2026-10-03T16:00:00Z', '2026-10-03T18:00:00Z'), { timeZone: LH }); // after it
  assert.deepEqual(win(after)[0], ['2026-10-03T16:00:00Z', '2026-10-03T17:00:00Z']);
  for (const c of [['DAY_ONLY'], MONTH]) { // local midnights are whole instants whatever the offset
    const t = translate(series(c, '2026-10-03T00:00:00Z', '2026-10-05T00:00:00Z'), { timeZone: LH });
    assert.ok(t); assert.ok(win(t).every(([a, b]) => a < b));
  }
});

test('series: extra WHERE conditions stay in every bucket, aliases and column order are kept', () => {
  const sql = "SELECT COUNT(Id) n, DAY_ONLY(convertTimezone(CreatedDate)) FROM ReturnOrder WHERE CreatedDate >= 2025-11-01T00:00:00Z AND CreatedDate <= 2025-11-01T10:00:00Z AND Status = 'Open' GROUP BY DAY_ONLY(convertTimezone(CreatedDate))";
  const t = translate(sql, { timeZone: LA });
  assert.match(t.queries[0], /b0:ReturnOrder\(where:\{and:\[\{and:\[\{CreatedDate:\{gte:.*\{Status:\{eq:"Open"\}\}\]\},\{CreatedDate:\{gte:\{value:"2025-10-31T07:00:00Z"\}\}\},\{CreatedDate:\{lt:/);
  assert.deepEqual(t.map([countBody({ b0: 4, b1: 9 })]).records, [{ n: 4, expr0: '2025-10-31' }, { n: 9, expr0: '2025-11-01' }]);
});

test('series: an open upper bound runs to the injected now', () => {
  const sql = `SELECT DAY_ONLY(convertTimezone(OrderedDate)), COUNT(Id) c FROM OrderSummary WHERE OrderedDate >= 2025-11-01T20:00:00Z GROUP BY DAY_ONLY(convertTimezone(OrderedDate))`;
  assert.equal(win(translate(sql, { timeZone: LA, now: Date.parse('2025-11-03T12:00:00Z') })).length, 3);
});

test('series stays on Apex (null) without a zone, without a lower bound, or when the shape is not understood', () => {
  const ok = series(MONTH, '2025-10-09T00:00:00Z', '2026-01-01T00:00:00Z');
  assert.ok(translate(ok, { timeZone: LA }));
  nul(ok); // no context (om-platform could not read the zone)
  assert.equal(translate(ok, { timeZone: null }), null);
  assert.equal(translate(ok, { timeZone: 'Not/AZone' }), null);
  const all = 'SELECT CALENDAR_YEAR(convertTimezone(OrderedDate)), CALENDAR_MONTH(convertTimezone(OrderedDate)), COUNT(Id) c FROM OrderSummary WHERE OrderedDate != null GROUP BY CALENDAR_YEAR(convertTimezone(OrderedDate)), CALENDAR_MONTH(convertTimezone(OrderedDate))';
  assert.equal(translate(all, { timeZone: LA }), null); // "all time": no first bucket
  const ctx = { timeZone: LA };
  for (const bad of [
    series(['DAY_ONLY'], '2025-01-01T00:00:00Z', '2025-12-31T00:00:00Z'), // 365 buckets
    ok.replace(/convertTimezone\((\w+)\)/g, '$1'), // UTC semantics are not what the dashboard asks for
    ok.replace(' GROUP BY CALENDAR_YEAR(convertTimezone(OrderedDate)), CALENDAR_MONTH(convertTimezone(OrderedDate))', ' GROUP BY CALENDAR_YEAR(convertTimezone(OrderedDate))'),
    ok + ' ORDER BY COUNT(Id)',
    ok.replace('COUNT(Id) c', 'SUM(GrandTotalAmount) c'),
    ok.replace('OrderedDate >= 2025-10-09T00:00:00Z AND', ''),
    ok.replace('AND OrderedDate <= 2026-01-01T00:00:00Z', 'OR Status = \'x\''),
    series(['CALENDAR_MONTH'], '2025-10-09T00:00:00Z', '2025-11-01T00:00:00Z'), // month without year
    'SELECT DAY_ONLY(OrderedDate), COUNT(Id) FROM OrderSummary WHERE OrderedDate >= 2025-10-09T00:00:00Z GROUP BY DAY_ONLY(OrderedDate)',
  ]) assert.equal(translate(bad, ctx), null, bad);
});

test('series: a wall-clock midnight that does not exist (DST gap) is refused, not guessed', () => {
  // America/Sao_Paulo skipped 2018-11-04 00:00 -> 01:00
  assert.equal(translate(series(['DAY_ONLY'], '2018-11-03T12:00:00Z', '2018-11-05T12:00:00Z'), { timeZone: 'America/Sao_Paulo' }), null);
});

// Live (2026-10-09, a large org): groupBy keys sharing a relationship prefix must be ONE nested object. Repeating the key
// (OrderSummary:{A},OrderSummary:{B}) is rejected: UniqueObjectFieldName ... There can be only one field named 'OrderSummary'.
// OrderSummaryId{value} next to OrderSummary{...} is accepted. Verified on OrderItemSummary (same shape, one day of 2020):
// 891 groups, GraphQL rows identical to `sf data query`; FulfillmentOrder and FulfillmentOrderLineItem shapes identical too.
test('groupBy merges relationship paths that share a prefix into one nested object', () => {
  const soql = 'SELECT OrderSummaryId o, OrderSummary.OrderNumber n, OrderSummary.AccountId a, OrderSummary.Account.Name an, Category k, COUNT(Id) c, MAX(CreatedDate) l ' +
    'FROM ProcessException GROUP BY OrderSummaryId, OrderSummary.OrderNumber, OrderSummary.AccountId, OrderSummary.Account.Name, Category ORDER BY MAX(CreatedDate) DESC LIMIT 2000';
  ok(soql, 'groupBy:{OrderSummaryId:{group:true},OrderSummary:{OrderNumber:{group:true},AccountId:{group:true},Account:{Name:{group:true}}},Category:{group:true}},' +
    'orderBy:{CreatedDate:{function:MAX,order:DESC}},first:1999',
    'OrderSummaryId{value} OrderSummary{OrderNumber{value} AccountId{value} Account{Name{value}}} Category{value} Id{count{value}} CreatedDate{max{value}}', 'ProcessException');
  // a shared prefix that is not adjacent in GROUP BY still merges
  ok('SELECT FulfilledFromLocation.Name s, Status st, FulfilledFromLocation.LocationType t, COUNT(Id) c FROM FulfillmentOrder GROUP BY FulfilledFromLocation.Name, Status, FulfilledFromLocation.LocationType',
    'groupBy:{FulfilledFromLocation:{Name:{group:true},LocationType:{group:true}},Status:{group:true}},first:1999',
    'FulfilledFromLocation{Name{value} LocationType{value}} Status{value} Id{count{value}}', 'FulfillmentOrder');
  ok('SELECT FulfillmentOrder.FulfilledFromLocationId l, FulfillmentOrder.FulfilledFromLocation.Name n, SUM(Quantity) q FROM FulfillmentOrderLineItem GROUP BY FulfillmentOrder.FulfilledFromLocationId, FulfillmentOrder.FulfilledFromLocation.Name',
    'groupBy:{FulfillmentOrder:{FulfilledFromLocationId:{group:true},FulfilledFromLocation:{Name:{group:true}}}},first:1999',
    'FulfillmentOrder{FulfilledFromLocationId{value} FulfilledFromLocation{Name{value}}} Quantity{sum{value}}', 'FulfillmentOrderLineItem');
});

test('map() puts each aliased value from the merged selection in the right column', () => {
  const t = translate('SELECT OrderSummaryId o, OrderSummary.OrderNumber n, OrderSummary.AccountId a, OrderSummary.Account.Name an, Category k, COUNT(Id) c ' +
    'FROM ProcessException GROUP BY OrderSummaryId, OrderSummary.OrderNumber, OrderSummary.AccountId, OrderSummary.Account.Name, Category');
  const r = t.map(body('ProcessException', [{ OrderSummaryId: { value: '1Os1' }, OrderSummary: { OrderNumber: { value: '0001' }, AccountId: { value: '001A' }, Account: { Name: { value: 'Ann' } } }, Category: { value: 'Pay' }, Id: { count: { value: 3 } } }]));
  assert.deepEqual(r.records, [{ o: '1Os1', n: '0001', a: '001A', an: 'Ann', k: 'Pay', c: 3 }]);
});
