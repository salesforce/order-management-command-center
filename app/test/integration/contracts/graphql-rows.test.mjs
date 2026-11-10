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
import test from 'node:test';
import assert from 'node:assert/strict';
import { translateRows, describeDoc } from "../../../public/shared/transport/om-graphql.js";

test('a row query becomes one uiapi query document', () => {
  const t = translateRows("SELECT Id, OrderNumber, Account.Name FROM OrderSummary WHERE Status = 'Created' ORDER BY CreatedDate DESC LIMIT 50");
  assert.equal(t.query, 'query{uiapi{query{OrderSummary(where:{Status:{eq:"Created"}},orderBy:{CreatedDate:{order:DESC,nulls:FIRST}},first:50){edges{node{Id OrderNumber{value} Account{Name{value}}}} pageInfo{hasNextPage}}}}}');
  assert.equal(t.object, 'OrderSummary');
  assert.equal(t.field, t.query.slice('query{uiapi{query{'.length, -'}}}'.length));
});

test('relationship Ids and shared prefixes nest once', () => {
  const t = translateRows('SELECT Order_Summary__r.Id, Order_Summary__r.OrderNumber FROM Case');
  assert.ok(t.query.includes('Order_Summary__r{Id OrderNumber{value}}'));
});

test('no LIMIT asks for 2000', () => {
  assert.ok(translateRows('SELECT Id FROM Case').query.includes('first:2000'));
});

test("the console's row queries translate", () => {
  for (const s of [
    "SELECT Id, ProcessExceptionNumber, Category, Status, Severity, Priority, Message, OrderSummaryId, OrderSummary.OrderNumber, CreatedDate FROM ProcessException WHERE Status IN ('New', 'Triaged', 'Paused') AND CreatedDate = LAST_N_DAYS:90 ORDER BY CreatedDate DESC LIMIT 50",
    'SELECT CreatedDate, ClosedDate FROM Case WHERE IsClosed = true AND CreatedDate >= 2026-10-01T07:00:00Z AND CreatedDate <= 2026-10-27T17:31:27Z ORDER BY CreatedDate DESC LIMIT 2000',
    "SELECT QuantityCanceled, Product2.Name, Name FROM OrderItemSummary WHERE OrderSummary.OrderedDate >= 2026-10-01T07:00:00Z AND TypeCode = 'Product' AND QuantityCanceled > 0 ORDER BY CreatedDate DESC LIMIT 2000",
    'SELECT LastModifiedDate FROM Case ORDER BY SystemModstamp DESC LIMIT 1',
    "SELECT Id FROM OrderItemSummary WHERE OrderSummaryId = '1Os000000000001AAA' AND Id > '10u000000000001AAA' ORDER BY Id LIMIT 2000",
  ]) assert.notEqual(translateRows(s), null, s);
});

test("what it can't express stays on Apex", () => {
  for (const s of [
    'SELECT COUNT() FROM Case',
    'SELECT Status, COUNT(Id) c FROM Case GROUP BY Status',
    'SELECT Id, (SELECT Id FROM OrderItemSummaries) FROM OrderSummary',
    'SELECT Id FROM Case ORDER BY Status, CreatedDate',
    'SELECT Id FROM Case LIMIT 10 OFFSET 5',
    'SELECT toLabel(Status) FROM Case',
    'SELECT Id, Id FROM Case',
    'SELECT Id FROM Case FOR VIEW',
  ]) assert.equal(translateRows(s), null, s);
});

const node = {
  Id: '801000000000001AAA', OrderNumber: { value: '00000001' }, CreatedDate: { value: '2026-10-27T17:00:00.000Z' },
  OrderedDate: { value: '2026-10-27' }, IsClosed: { value: true }, GrandTotalAmount: { value: 12.5 }, Account: { Name: { value: 'Acme' } },
};
const soql = 'SELECT Id, OrderNumber, CreatedDate, OrderedDate, IsClosed, GrandTotalAmount, Account.Name FROM OrderSummary';
const body = (n, hasNextPage = false) => ({ data: { uiapi: { query: { OrderSummary: { edges: [{ node: n }], pageInfo: { hasNextPage } } } } } });

test('map turns edges into REST records', () => {
  const r = translateRows(soql).map(body(node));
  assert.deepEqual(r.records, [{
    attributes: { type: 'OrderSummary' }, Id: '801000000000001AAA', OrderNumber: '00000001', CreatedDate: '2026-10-27T17:00:00.000+0000',
    OrderedDate: '2026-10-27', IsClosed: true, GrandTotalAmount: 12.5, Account: { Name: 'Acme' },
  }]);
});

test('an empty lookup is null, as REST has it', () => {
  const r = translateRows(soql).map(body({ ...node, Account: null }));
  assert.equal(r.records[0].Account, null);
});

test('done follows LIMIT, then the page', () => {
  const done = (q, more) => translateRows(q).map(body(node, more));
  assert.equal(done(soql, true).done, false);
  assert.equal(done(soql, false).done, true);
  assert.equal(done(`${soql} LIMIT 50`, true).done, true);
  assert.equal(done(soql, true).totalSize, 1);
  assert.equal(done(`${soql} LIMIT 50`, false).totalSize, 1);
});

test('a LIMIT above 2000 asks for 2000 and is not done while there is more', () => {
  const t = translateRows(`${soql} LIMIT 2500`);
  assert.match(t.query, /first:\s*2000/);
  assert.equal(t.map(body(node, true)).done, false);
  assert.equal(t.map(body(node, false)).done, true);
});

test('errors are thrown with their text', () => {
  assert.throws(() => translateRows(soql).map({ errors: [{ message: 'a' }, { message: 'b' }] }), /a; b/);
});

const info = { ApiName: 'OrderSummary', createable: false, fields: [{ ApiName: 'AccountId', relationshipName: 'Account', referenceToInfos: [{ ApiName: 'Account' }] }] };
const shaped = { name: 'OrderSummary', createable: false, fields: [{ name: 'AccountId', relationshipName: 'Account', referenceTo: ['Account'] }] };

test('describeDoc asks objectInfos for fields, relationships and createable', () => {
  assert.equal(describeDoc(['OrderSummary', 'Case']).query,
    'query{uiapi{objectInfos(apiNames:["OrderSummary","Case"]){ApiName createable fields{ApiName relationshipName referenceToInfos{ApiName}}}}}');
});

test('split answers in the REST describe\'s shape', () => {
  assert.deepEqual(describeDoc(['OrderSummary']).split({ data: { uiapi: { objectInfos: [info] } } }), [shaped]);
});

test('an object objectInfos has no info for is null', () => {
  const body = { data: { uiapi: { objectInfos: [info, null] } }, errors: [{ message: 'No ObjectInfo for Refund', path: ['uiapi', 'objectInfos', 1] }] };
  assert.deepEqual(describeDoc(['OrderSummary', 'Refund']).split(body), [shaped, null]);
});

test('a short answer throws', () => {
  assert.throws(() => describeDoc(['OrderSummary', 'Case']).split({ data: { uiapi: { objectInfos: [info] } } }), /without an answer/);
});

test('translateRows reports the paths it selects, filters and sorts on', () => {
  const t = translateRows("SELECT Id, AttachedTo.Name FROM ProcessException WHERE Status = 'New' AND Id IN (SELECT Hidden__c FROM Child WHERE Secret__c = 'x') ORDER BY CreatedDate DESC LIMIT 10");
  assert.deepEqual([...t.paths].sort(), ['AttachedTo.Name', 'CreatedDate', 'Id', 'Status']);
});
