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
// A fake Salesforce org for core tests: describes come from SCHEMA, queries are answered by the first matching regex.
// Any POST throws, so a test run also proves the code under test stays read-only.
import { createCore } from "../../public/operations-console/data/core.js";

const ref = (name, relationshipName, ...referenceTo) => ({ name, relationshipName, referenceTo });
const f = (...names) => names.map((name) => ({ name }));
export const SCHEMA = {
  Account: [...f('Id', 'Name', 'Type', 'IsPersonAccount', 'PersonContactId', 'PersonEmail', 'Phone', 'PersonMobilePhone', 'BillingCity', 'BillingState', 'CreatedDate'), ref('OwnerId', 'Owner', 'User')],
  Contact: [...f('Id', 'Name', 'Email', 'Phone'), ref('AccountId', 'Account', 'Account')],
  Case: [...f('Id', 'CaseNumber', 'Subject', 'Type', 'Priority', 'Status', 'IsClosed', 'CreatedDate'), ref('OwnerId', 'Owner', 'User', 'Group'), ref('AccountId', 'Account', 'Account'), ref('Order_Summary__c', 'Order_Summary__r', 'OrderSummary')],
  ProcessException: [...f('Id', 'ProcessExceptionNumber', 'Category', 'Message', 'Priority', 'Severity', 'Status', 'CreatedDate'), ref('OwnerId', 'Owner', 'User', 'Group'), ref('OrderSummaryId', 'OrderSummary', 'OrderSummary'), ref('CaseId', 'Case', 'Case')],
  OrderSummary: [...f('Id', 'OrderNumber', 'Status', 'GrandTotalAmount', 'OrderedDate', 'CreatedDate', 'BillingEmailAddress', 'BillingCity', 'BillingState'), ref('AccountId', 'Account', 'Account')],
  FulfillmentOrder: [...f('Id', 'FulfillmentOrderNumber', 'Status', 'CreatedDate'), ref('OrderSummaryId', 'OrderSummary', 'OrderSummary'), ref('FulfilledFromLocationId', 'FulfilledFromLocation', 'Location'), ref('DeliveryMethodId', 'DeliveryMethod', 'OrderDeliveryMethod')],
  Shipment: [...f('Id', 'ShipmentNumber', 'Status', 'Provider', 'TrackingNumber', 'TrackingUrl', 'CreatedDate'), ref('FulfillmentOrderId', 'FulfillmentOrder', 'FulfillmentOrder'), ref('OrderSummaryId', 'OrderSummary', 'OrderSummary')],
  ReturnOrder: [...f('Id', 'ReturnOrderNumber', 'Status', 'GrandTotalAmount', 'CreatedDate'), ref('AccountId', 'Account', 'Account'), ref('OrderSummaryId', 'OrderSummary', 'OrderSummary'), ref('CaseId', 'Case', 'Case')],
  OrderItemSummary: [...f('Id', 'Name', 'ProductCode', 'TypeCode', 'Status', 'QuantityOrdered', 'QuantityFulfilled', 'QuantityCanceled', 'QuantityReturned', 'TotalPrice'), ref('OrderSummaryId', 'OrderSummary', 'OrderSummary'), ref('Product2Id', 'Product2', 'Product2')],
  OrderDeliveryGroupSummary: [...f('Id', 'DeliverToName', 'DeliverToCity', 'DeliverToState'), ref('OrderSummaryId', 'OrderSummary', 'OrderSummary'), ref('OrderDeliveryMethodId', 'OrderDeliveryMethod', 'OrderDeliveryMethod')],
  FulfillmentOrderLineItem: [...f('Id', 'Quantity', 'OriginalQuantity', 'TypeCode'), ref('FulfillmentOrderId', 'FulfillmentOrder', 'FulfillmentOrder'), ref('OrderItemSummaryId', 'OrderItemSummary', 'OrderItemSummary')],
  Refund: [...f('Id', 'Amount', 'Status'), ref('AccountId', 'Account', 'Account')],
  CreditMemo: [...f('Id', 'TotalAmount', 'TotalAmountWithTax'), ref('BillingAccountId', 'BillingAccount', 'Account')],
  LiveChatTranscript: [...f('Id', 'Name', 'Status', 'StartTime', 'EndTime', 'ChatDuration', 'Body', 'CreatedDate', 'Order_Summary_Id__c'), ref('OwnerId', 'Owner', 'User'), ref('AccountId', 'Account', 'Account'), ref('ContactId', 'Contact', 'Contact'), ref('CaseId', 'Case', 'Case')],
};

// `search(sosl)` answers SOSL (/search) with searchRecords; without it the org has no search index, as inside Salesforce.
// `posts` answers the read-only POSTs a test expects ([[pathRegex, (body) => answer]]); any other POST still throws.
// `gets` answers Commerce, Connect and UI API GETs by path ([[pathRegex, body or () => body]]), as they come back from the
// API; an unanswered UI API GET is a 404.
// `describes` adds to an object's describe ({ Account: { createable, recordTypeInfos } }), beyond its fields.
// `tooling` answers the Tooling API's settings reads by field ({ DeliveryEstimationEnabled: false }); a field it lacks is unreadable.
// `limits` answers GET /limits (the org's limits, {Name: {Max, Remaining}}), as an object or () => object; without it the org has none.
export function fakeOrg({ objects = Object.keys(SCHEMA), schema = {}, queries = [], search = null, posts = [], gets = [], limits = null, tooling = null, describes = {} } = {}) {
  const S = { ...SCHEMA, ...schema }, calls = [], bodies = [];
  const request = async (p, post) => {
    if (post !== undefined) {
      const hit = posts.find(([re]) => re.test(p));
      if (!hit) throw new Error(`Unexpected POST ${p}`);
      calls.push(`POST ${p}`); bodies.push(post);
      return hit[1](post);
    }
    calls.push(p);
    if (p === '/limits') {
      if (!limits) throw Object.assign(new Error('NOT_FOUND'), { httpStatus: 404 });
      return typeof limits === 'function' ? limits() : limits;
    }
    const t = p.match(/^\/tooling\/query\?q=(.+)$/);
    if (t) {
      const field = decodeURIComponent(t[1]).match(/^SELECT (\w+) FROM/)[1];
      if (!tooling || !(field in tooling)) throw Object.assign(new Error('Cannot access in this organization'), { httpStatus: 400 });
      return { records: [{ [field]: tooling[field] }] };
    }
    const g = /^\/(commerce|ui-api|connect)\//.test(p) && gets.find(([re]) => re.test(p));
    if (g) return typeof g[1] === 'function' ? g[1](p) : g[1];
    if (p.startsWith('/ui-api/')) throw Object.assign(new Error('NOT_FOUND'), { httpStatus: 404 });
    const s = p.match(/^\/search\?q=(.+)$/);
    if (s) {
      if (!search) throw Object.assign(new Error('NOT_FOUND'), { httpStatus: 404 });
      return { searchRecords: search(decodeURIComponent(s[1])) };
    }
    const d = p.match(/^\/sobjects\/(\w+)\/describe$/);
    if (d) {
      if (!objects.includes(d[1]) || !S[d[1]]) throw Object.assign(new Error('NOT_FOUND'), { httpStatus: 404 });
      return { fields: S[d[1]], ...describes[d[1]] };
    }
    const q = decodeURIComponent(p.replace(/^\/query\?q=/, ''));
    const hit = queries.find(([re]) => re.test(q));
    if (!hit) throw new Error(`Unexpected query: ${q}`);
    const rows = typeof hit[1] === 'function' ? hit[1](q) : hit[1];
    return { records: rows, totalSize: rows.length, done: true };
  };
  const core = createCore({ request, instanceUrl: () => 'https://test.my.salesforce.com' });
  return { core, request, calls, bodies, soql: () => calls.filter((c) => c.startsWith('/query')).map((c) => decodeURIComponent(c.slice(9))),
    sosl: () => calls.filter((c) => c.startsWith('/search')).map((c) => decodeURIComponent(c.slice(10))) };
}
