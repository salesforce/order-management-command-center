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
// The reads OM Service Console's action skills use: an order as the action panels see it, a customer's
// conversations, a store's products, a customer's addresses and the stores a new order can use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeOrg, SCHEMA } from "../../support/fake-org.mjs";

const OS = '1Os000000000001AAA', ACC = '001000000000001AAA', STORE = '0ZE000000000001AAA';
const all = [[/./, []]];
const read = (core, name, params = {}) => core.route(`/api/read/${name}?${new URLSearchParams(params)}`);
const ref = (name, relationshipName, ...referenceTo) => ({ name, relationshipName, referenceTo });
const f = (...names) => names.map((name) => ({ name }));
const on = (soql, from) => soql.filter((s) => new RegExp(`FROM ${from}\\b`).test(s));

// What the action reads query, beyond the fake org's own schema.
const ACTIONS = {
  OrderSummary: [...SCHEMA.OrderSummary, ...f('OrderLifeCycleType', 'CurrencyIsoCode', 'Pricebook2Id', 'TotalAdjustedProductAmount', 'TotalAdjustedDeliveryAmount', 'TotalTaxAmount'),
    ref('SalesStoreId', 'SalesStore', 'WebStore'), ref('SalesChannelId', 'SalesChannel', 'SalesChannel')],
  WebStore: f('Id', 'Name', 'Type'),
  OrderItemSummary: [...SCHEMA.OrderItemSummary, ...f('Type', 'Quantity', 'QuantityAvailableToCancel', 'QuantityAvailableToReturn', 'QuantityAllocated', 'QuantityAvailableToFulfill',
    'QuantityAvailableToReship', 'QuantityReturnInitiated', 'UnitPrice', 'ListPrice', 'TotalLineAmount', 'AdjustedLineAmount', 'TotalTaxAmount', 'PricebookEntryId'),
    ref('OrderDeliveryGroupSummaryId', 'OrderDeliveryGroupSummary', 'OrderDeliveryGroupSummary'), ref('MainOrderItemSummaryId', 'MainOrderItemSummary', 'OrderItemSummary')],
  OrderItemSummaryRelationship: [...f('Id', 'MainOrderItemSummaryRole', 'AssociatedOrderItemSummaryRole', 'AssociatedOrderItemSumPricing', 'AssociatedQuanScaleMethod'),
    ref('MainOrderItemSummaryId', 'MainOrderItemSummary', 'OrderItemSummary'), ref('AssociatedOrderItemSummaryId', 'AssociatedOrderItemSummary', 'OrderItemSummary'), ref('MainOrderSummaryId', 'MainOrderSummary', 'OrderSummary')],
  OrderItemTaxLineItemSummary: [...f('Id', 'Name', 'Type', 'Rate', 'Amount', 'TaxEffectiveDate'), ref('OrderItemSummaryId', 'OrderItemSummary', 'OrderItemSummary')],
  OrderItemAdjustmentLineSummary: [...f('Id', 'Name', 'Amount', 'Description'), ref('OrderItemSummaryId', 'OrderItemSummary', 'OrderItemSummary')],
  OrderDeliveryGroupSummary: [...SCHEMA.OrderDeliveryGroupSummary, ...f('DeliverToStreet', 'DeliverToPostalCode', 'DeliverToCountry', 'EmailAddress', 'PhoneNumber', 'GrandTotalAmount')],
  OrderPaymentSummary: [...f('Id', 'Method', 'Type', 'Status', 'AuthorizationAmount', 'CapturedAmount', 'RefundedAmount', 'BalanceAmount'), ref('OrderSummaryId', 'OrderSummary', 'OrderSummary')],
  OrderItemSummaryChange: [...f('Id', 'ChangeType', 'Reason', 'CreatedDate'), ref('OrderSummaryId', 'OrderSummary', 'OrderSummary'), ref('OrderItemSummaryId', 'OrderItemSummary', 'OrderItemSummary'),
    ref('ChangeOrderId', 'ChangeOrder', 'Order')],
  FulfillmentOrder: [...SCHEMA.FulfillmentOrder, ...f('StatusCategory', 'Type', 'IsReship')],
  FulfillmentOrderLineItem: [...SCHEMA.FulfillmentOrderLineItem, ...f('RejectedQuantity', 'Type')],
  ReturnOrder: [...SCHEMA.ReturnOrder, ...f('LifeCycleType')],
  ReturnOrderLineItem: [...f('Id', 'QuantityExpected', 'QuantityReceived', 'QuantityRejected', 'QuantityReturned', 'ReasonForReturn', 'ReasonForRejection', 'Type', 'TypeCode', 'ChangeOrderItemId'),
    ref('ReturnOrderId', 'ReturnOrder', 'ReturnOrder'), ref('OrderItemSummaryId', 'OrderItemSummary', 'OrderItemSummary')],
  OrderDeliveryMethod: f('Id', 'Name', 'IsActive'),
  Location: f('Id', 'Name', 'LocationType', 'ExternalReference', 'IsInventoryLocation'),
  PicklistValueInfo: f('Id', 'Value', 'Label', 'IsActive'),
  Shipment: [...SCHEMA.Shipment, ...f('ExpectedDeliveryDate', 'ActualDeliveryDate')],
};
const actionsOrg = (opts = {}) => fakeOrg({ schema: ACTIONS, objects: [...new Set([...Object.keys(SCHEMA), ...Object.keys(ACTIONS)])], queries: all, ...opts });
const ORDER_ACTIONS = ['order', 'store', 'lines', 'relationships', 'taxLines', 'adjustments', 'deliveryGroups', 'payments', 'changes', 'fulfillmentOrders', 'fulfillmentLines', 'shipments', 'returnOrders', 'returnLines',
  'deliveryMethods', 'locations', 'changeReasons', 'returnReasons', 'rejectReasons'];

test('order-actions by number: every part runs, matched padded and unpadded, the store through a semi-join', async () => {
  const { core, soql, calls } = actionsOrg();
  const r = await read(core, 'order-actions', { order: '35807' });
  assert.deepEqual(Object.keys(r.results), ORDER_ACTIONS);
  for (const k of ORDER_ACTIONS) assert.ok(Array.isArray(r.results[k].rows), `${k}: ${JSON.stringify(r.results[k])}`);
  const q = soql();
  assert.match(on(q, 'OrderSummary')[0], /WHERE OrderNumber IN \('35807', '00035807'\)/);
  assert.match(on(q, 'WebStore')[0], /WHERE Id IN \(SELECT SalesStoreId FROM OrderSummary WHERE OrderNumber IN \('35807', '00035807'\)\)/);
  assert.match(on(q, 'OrderItemSummary')[0], /QuantityAvailableToCancel, QuantityAvailableToReturn/);
  assert.match(on(q, 'OrderItemTaxLineItemSummary')[0], /WHERE OrderItemSummary\.OrderSummary\.OrderNumber IN \('35807', '00035807'\)/);
  const reasons = on(q, 'PicklistValueInfo');
  assert.equal(reasons.length, 3);
  assert.ok(reasons.some((s) => /QualifiedApiName = 'OrderItemSummaryChange' AND EntityParticle\.QualifiedApiName = 'Reason'/.test(s)));
  assert.ok(reasons.some((s) => /'ReturnOrderLineItem' AND EntityParticle\.QualifiedApiName = 'ReasonForRejection'/.test(s)));
  assert.ok(!calls.some((c) => c.startsWith('POST')), 'read-only');
  // Shipments, so a reship can warn when a parcel may still be on its way: no tracking numbers (they lead to an address).
  const sh = on(q, 'Shipment')[0];
  assert.match(sh, /SELECT Id, ShipmentNumber, Status, Provider, FulfillmentOrderId, ExpectedDeliveryDate, ActualDeliveryDate, CreatedDate FROM Shipment WHERE OrderSummary\.OrderNumber IN \('35807', '00035807'\)/);
  assert.doesNotMatch(sh, /Tracking/);
});

test('order-actions by Id filters every part by the Id', async () => {
  const { core, soql } = actionsOrg();
  await read(core, 'order-actions', { order: OS });
  const q = soql();
  assert.match(on(q, 'OrderItemSummary')[0], new RegExp(`WHERE OrderSummaryId = '${OS}'`));
  assert.match(on(q, 'ReturnOrderLineItem')[0], new RegExp(`WHERE ReturnOrder\\.OrderSummaryId = '${OS}'`));
  assert.match(on(q, 'WebStore')[0], new RegExp(`SELECT SalesStoreId FROM OrderSummary WHERE Id = '${OS}'`));
});

test('order-actions in an org without returns, stores or picklist info still answers with the lines', async () => {
  const objects = Object.keys(ACTIONS).filter((o) => !['ReturnOrder', 'ReturnOrderLineItem', 'WebStore', 'PicklistValueInfo'].includes(o));
  const { core } = fakeOrg({ schema: ACTIONS, objects: [...new Set([...Object.keys(SCHEMA).filter((o) => o !== 'ReturnOrder'), ...objects])],
    queries: [[/FROM OrderItemSummary /, [{ Id: '10u000000000001AAA', QuantityAvailableToCancel: 1 }]], ...all] });
  const r = await read(core, 'order-actions', { order: OS });
  for (const k of ['store', 'returnOrders', 'returnLines', 'changeReasons', 'returnReasons', 'rejectReasons']) assert.ok(r.results[k].skipped, k);
  assert.equal(r.results.lines.rows.length, 1);
});

test('order-actions reads each line’s bundle and the links between a bundle and its parts', async () => {
  const { core, soql } = actionsOrg();
  await read(core, 'order-actions', { order: OS });
  const q = soql();
  assert.match(on(q, 'OrderItemSummary')[0], /, MainOrderItemSummaryId FROM OrderItemSummary /);
  assert.equal(on(q, 'OrderItemSummaryRelationship')[0], 'SELECT Id, MainOrderItemSummaryId, AssociatedOrderItemSummaryId, MainOrderItemSummaryRole, AssociatedOrderItemSummaryRole, AssociatedOrderItemSumPricing, '
    + `AssociatedQuanScaleMethod FROM OrderItemSummaryRelationship WHERE MainOrderSummaryId = '${OS}' LIMIT 1000`);
});

test('order-actions in an org without bundles drops the field and skips the links', async () => {
  const schema = { ...ACTIONS, OrderItemSummary: ACTIONS.OrderItemSummary.filter((x) => x.name !== 'MainOrderItemSummaryId') };
  const { core, soql } = fakeOrg({ schema, objects: [...new Set([...Object.keys(SCHEMA), ...Object.keys(ACTIONS)])].filter((o) => o !== 'OrderItemSummaryRelationship'), queries: all });
  const r = await read(core, 'order-actions', { order: OS });
  assert.equal(r.results.relationships.skipped, 'OrderItemSummaryRelationship');
  assert.doesNotMatch(on(soql(), 'OrderItemSummary')[0], /MainOrderItemSummaryId/);
});

test('order-actions refuses a bad order before any query', async () => {
  const { core, calls } = actionsOrg();
  await assert.rejects(read(core, 'order-actions', { order: "1'; DROP" }), { code: 400 });
  assert.ok(!calls.some((c) => c.startsWith('/query')));
});

// ---------- conversations ----------
const TALK = {
  Case: [...SCHEMA.Case, ...f('Origin', 'ClosedDate'), ref('ContactId', 'Contact', 'Contact')],
  LiveChatTranscript: [...SCHEMA.LiveChatTranscript, ref('CaseId', 'Case', 'Case')],
  MessagingSession: [...f('Id', 'Name', 'Status', 'Origin', 'StartTime', 'EndTime', 'CreatedDate'), ref('OwnerId', 'Owner', 'User'), ref('CaseId', 'Case', 'Case'),
    ref('EndUserAccountId', 'EndUserAccount', 'Account'), ref('EndUserContactId', 'EndUserContact', 'Contact'), ref('MessagingChannelId', 'MessagingChannel', 'MessagingChannel')],
  EmailMessage: [...f('Id', 'Subject', 'FromName', 'Incoming', 'MessageDate', 'Status', 'TextBody', 'CreatedDate'), ref('ParentId', 'Parent', 'Case'), ref('RelatedToId', 'RelatedTo', 'Account', 'Case')],
  VoiceCall: [...f('Id', 'Name', 'CallType', 'CallStartDateTime', 'CallEndDateTime', 'CallDurationInSeconds', 'CallDisposition', 'CreatedDate'), ref('OwnerId', 'Owner', 'User'),
    ref('RelatedRecordId', 'RelatedRecord', 'Account', 'Case')],
};
const CONVERSATIONS = ['cases', 'contactCases', 'chats', 'contactChats', 'caseChats', 'messaging', 'contactMessaging', 'caseMessaging', 'emails', 'caseEmails', 'calls', 'caseCalls'];

test('conversations: every way each kind links to the customer is its own query, with no OR around a semi-join', async () => {
  const { core, soql, calls } = fakeOrg({ schema: TALK, objects: [...Object.keys(SCHEMA), ...Object.keys(TALK)], queries: all });
  const r = await read(core, 'conversations', { account: ACC });
  assert.deepEqual(Object.keys(r.results), CONVERSATIONS);
  for (const k of CONVERSATIONS) assert.ok(Array.isArray(r.results[k].rows), `${k}: ${JSON.stringify(r.results[k])}`);
  const q = soql();
  assert.ok(on(q, 'LiveChatTranscript').some((s) => s.includes(`CaseId IN (SELECT Id FROM Case WHERE AccountId = '${ACC}')`)));
  assert.ok(on(q, 'Case').some((s) => s.includes(`ContactId IN (SELECT Id FROM Contact WHERE AccountId = '${ACC}')`)));
  assert.ok(on(q, 'MessagingSession').some((s) => s.includes(`EndUserAccountId = '${ACC}'`)));
  assert.ok(on(q, 'EmailMessage').some((s) => s.includes(`RelatedToId = '${ACC}'`)));
  assert.ok(on(q, 'VoiceCall').some((s) => s.includes(`RelatedRecordId IN (SELECT Id FROM Case WHERE AccountId = '${ACC}')`)));
  for (const s of q) assert.ok(!(/ OR /.test(s) && /IN \(SELECT/.test(s)), s);
  assert.ok(!calls.some((c) => c.startsWith('POST')), 'read-only');
});

test('conversations in an org without messaging, calls or contacts still answers from the account and its cases', async () => {
  const { core } = fakeOrg({ schema: TALK, objects: ['Account', 'Case', 'LiveChatTranscript', 'EmailMessage'],
    queries: [[/FROM LiveChatTranscript WHERE CaseId IN/, [{ Id: '570000000000001AAA', CreatedDate: '2026-10-01T00:00:00Z' }]], ...all] });
  const r = await read(core, 'conversations', { account: ACC });
  for (const k of ['messaging', 'contactMessaging', 'caseMessaging', 'calls', 'caseCalls']) assert.ok(r.results[k].skipped, k);
  assert.ok(Array.isArray(r.results.cases.rows));
  assert.equal(r.results.caseChats.rows.length, 1);
});

test('conversations refuses an account that is not an Id before any query', async () => {
  const { core, calls } = fakeOrg({ queries: all });
  await assert.rejects(read(core, 'conversations', { account: 'Jane' }), { code: 400 });
  assert.ok(!calls.some((c) => c.startsWith('/query')));
});

// ---------- a store's products, a customer's addresses, the stores a new order can use ----------
const SHOP = {
  PricebookEntry: [...f('Id', 'UnitPrice', 'IsActive', 'CurrencyIsoCode'), ref('Product2Id', 'Product2', 'Product2'), ref('Pricebook2Id', 'Pricebook2', 'Pricebook2')],
  WebStore: f('Id', 'Name', 'Type'),
  WebStorePricebook: [...f('IsActive'), ref('WebStoreId', 'WebStore', 'WebStore'), ref('Pricebook2Id', 'Pricebook2', 'Pricebook2')],
  WebStoreNetwork: [ref('WebStoreId', 'WebStore', 'WebStore'), ref('NetworkId', 'Network', 'Network')],
  ContactPointAddress: [...f('Id', 'Name', 'Street', 'City', 'State', 'PostalCode', 'Country', 'AddressType', 'IsDefault'), ref('ParentId', 'Parent', 'Account', 'Individual')],
  Account: [...SCHEMA.Account, ...f('FirstName', 'LastName', 'ShippingStreet', 'ShippingCity', 'ShippingState', 'ShippingPostalCode', 'ShippingCountry', 'BillingStreet', 'BillingPostalCode', 'BillingCountry')],
  OrderSummary: [...SCHEMA.OrderSummary, ref('SalesStoreId', 'SalesStore', 'WebStore')],
  OrderDeliveryGroupSummary: [...SCHEMA.OrderDeliveryGroupSummary, ...f('DeliverToStreet', 'DeliverToPostalCode', 'DeliverToCountry', 'CreatedDate')],
};
const shopOrg = (opts = {}) => fakeOrg({ schema: SHOP, objects: [...new Set([...Object.keys(SCHEMA), ...Object.keys(SHOP)])], queries: all, ...opts });

test("store-products: Order Management's search with the text URL-encoded, and the store's price books as a fallback", async () => {
  const { core, soql, calls } = shopOrg({ gets: [[/\/products\?/, { products: [{ name: 'Trail cap', sku: 'NW-1180' }] }]] });
  const r = await read(core, 'store-products', { store: STORE, q: 'trail cap', account: ACC });
  assert.ok(calls.includes(`/commerce/order-management/webstores/${STORE}/products?searchTerm=trail%20cap&effectiveAccountId=${ACC}&page=0&pageSize=12`), calls.join('\n'));
  assert.equal(r.results.search.data.products[0].sku, 'NW-1180');
  const pbe = on(soql(), 'PricebookEntry')[0];
  assert.match(pbe, new RegExp(`Pricebook2Id IN \\(SELECT Pricebook2Id FROM WebStorePricebook WHERE WebStoreId = '${STORE}' AND IsActive = true\\)`));
  assert.match(pbe, /\(Product2\.Name LIKE '%trail cap%' OR Product2\.StockKeepingUnit LIKE '%trail cap%' OR Product2\.ProductCode LIKE '%trail cap%'\)/);
});

test("store-product: one product's details, by SKU, for the customer", async () => {
  const { core, calls } = shopOrg({ gets: [[/\/products\/NW-4471\?/, { prices: { unitPrice: 189 } }]] });
  const r = await read(core, 'store-product', { store: STORE, sku: 'NW-4471', account: ACC });
  assert.ok(calls.includes(`/commerce/order-management/webstores/${STORE}/products/NW-4471?effectiveAccountId=${ACC}`), calls.join('\n'));
  assert.equal(r.results.product.data.prices.unitPrice, 189);
  await assert.rejects(read(core, 'store-product', { store: ACC, sku: 'NW-4471', account: ACC }), { code: 400 });
});

test('customer-addresses: saved addresses, the account, and the ship-tos of their recent orders', async () => {
  const { core, soql } = shopOrg();
  const r = await read(core, 'customer-addresses', { account: ACC });
  assert.deepEqual(Object.keys(r.results), ['saved', 'account', 'recentShipTos']);
  assert.match(on(soql(), 'ContactPointAddress')[0], new RegExp(`WHERE ParentId = '${ACC}'`));
  // Addresses only: the account row carries no email or phone.
  assert.doesNotMatch(on(soql(), 'Account')[0], /PersonEmail|Phone/);
  assert.match(on(soql(), 'OrderDeliveryGroupSummary')[0], new RegExp(`WHERE OrderSummary\\.AccountId = '${ACC}' ORDER BY CreatedDate DESC LIMIT 10`));
});

test("stores: every store with its price books and site, and where this customer ordered in the last 12 months", async () => {
  const { core, soql } = shopOrg();
  const r = await read(core, 'stores', { account: ACC });
  assert.deepEqual(Object.keys(r.results), ['stores', 'priceBooks', 'sites', 'ordered', 'lastOrder']);
  const ordered = on(soql(), 'OrderSummary').find((s) => s.includes('GROUP BY'));
  assert.match(ordered, new RegExp(`WHERE AccountId = '${ACC}' AND OrderedDate = LAST_N_DAYS:365 GROUP BY SalesStoreId`));
});

test('products, addresses and stores in an org without store networks or saved addresses still answer', async () => {
  const { core } = fakeOrg({ schema: SHOP, objects: [...Object.keys(SCHEMA), 'PricebookEntry', 'WebStore', 'WebStorePricebook'], queries: all });
  const s = await read(core, 'stores', { account: ACC });
  assert.ok(s.results.sites.skipped);
  assert.ok(Array.isArray(s.results.stores.rows));
  const a = await read(core, 'customer-addresses', { account: ACC });
  assert.ok(a.results.saved.skipped);
  assert.ok(Array.isArray(a.results.recentShipTos.rows));
});
