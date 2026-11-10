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
import { fakeOrg, SCHEMA } from "../../support/fake-org.mjs";

const ref = (name, relationshipName, ...referenceTo) => ({ name, relationshipName, referenceTo });
const f = (...names) => names.map((name) => ({ name }));
const OS = '1Os000000000001AAA', FO1 = '0a3000000000001AAA', FO2 = '0a3000000000002AAA', I1 = '10u000000000001AAA', I2 = '10u000000000002AAA', SH = '0OB000000000001AAA';
const EXTRA = {
  OrderSummary: [...SCHEMA.OrderSummary, ...f('LastModifiedDate')],
  FulfillmentOrder: [...SCHEMA.FulfillmentOrder, ...f('GrandTotalAmount', 'LastModifiedDate')],
  Shipment: [...SCHEMA.Shipment, ...f('ExpectedDeliveryDate', 'ActualDeliveryDate')],
  ProcessException: [...SCHEMA.ProcessException, ...f('AttachedToId', 'LastModifiedDate')],
  PaymentAuthorization: [...f('Id', 'PaymentAuthorizationNumber', 'Status', 'Amount', 'CreatedDate'), ref('OrderPaymentSummaryId', 'OrderPaymentSummary', 'OrderPaymentSummary')],
  Invoice: f('Id', 'DocumentNumber', 'Status', 'TotalAmountWithTax', 'Balance', 'CreatedDate', 'ReferenceEntityId'),
  CreditMemo: f('Id', 'DocumentNumber', 'Status', 'TotalAmountWithTax', 'CreatedDate', 'ReferenceEntityId'),
};
const ALL = Object.keys({ ...SCHEMA, ...EXTRA });
const T = (h) => `2026-09-21T${String(h).padStart(2, '0')}:00:00.000+0000`;
const queries = [
  [/FROM OrderSummary WHERE Id/, [{ Id: OS, OrderNumber: '00000184', Status: 'Fulfilled', GrandTotalAmount: 441.8, OrderedDate: T(9) }]],
  [/FROM OrderItemSummary WHERE/, [{ Id: I1, Name: 'Trail runner 2', Quantity: 1, TotalPrice: 189, TypeCode: 'Product' }, { Id: I2, Name: 'Rain shell', Quantity: 1, TotalPrice: 129, TypeCode: 'Product' },
    { Id: '10u000000000009AAA', Name: 'Shipping', Quantity: 1, TotalPrice: 9, TypeCode: 'Charge' }]],
  [/FROM FulfillmentOrder WHERE/, [{ Id: FO1, FulfillmentOrderNumber: 'FO-1', Status: 'Fulfilled', FulfilledFromLocation: { Name: 'Reno DC' }, CreatedDate: T(10), LastModifiedDate: T(14) },
    { Id: FO2, FulfillmentOrderNumber: 'FO-2', Status: 'Cancelled', CreatedDate: T(10), LastModifiedDate: T(12) }]],
  [/FROM FulfillmentOrderLineItem WHERE/, [{ FulfillmentOrderId: FO1, OrderItemSummaryId: I1, Quantity: 1 }, { FulfillmentOrderId: FO2, OrderItemSummaryId: I2, Quantity: 1 }, { FulfillmentOrderId: FO1, OrderItemSummaryId: '10u000000000009AAA', Quantity: 1 }]],
  [/FROM Shipment WHERE/, [{ Id: SH, ShipmentNumber: 'SH-1', Status: 'Delivered', Provider: 'UPS', FulfillmentOrderId: FO1, CreatedDate: T(15), ActualDeliveryDate: '2026-09-23T15:00:00.000+0000' }]],
  [/FROM ProcessException WHERE/, [{ Id: '2Pe000000000001AAA', ProcessExceptionNumber: 'PE-1', Category: 'Fulfillment', Status: 'New', AttachedToId: FO2, CreatedDate: T(11) }]],
  [/FROM PaymentAuthorization WHERE/, [{ Id: '0Xc000000000001AAA', PaymentAuthorizationNumber: 'PA-1', Status: 'Processed', Amount: 441.8, CreatedDate: T(9) }]],
  [/FROM CreditMemo WHERE/, [{ Id: '50g000000000001AAA', DocumentNumber: 'CM-1', Status: 'Posted', TotalAmountWithTax: 58, CreatedDate: T(16) }]],
  [/./, []],
];
const history = (org = {}) => { const o = fakeOrg({ queries, schema: EXTRA, objects: ALL, ...org }); return o.core.route(`/api/order/${OS}/history`).then((r) => ({ ...o, r })); };

test('order history lays out every related record as events with products and relations', async () => {
  const { r, soql } = await history();
  assert.equal(r.order.OrderNumber, '00000184');
  assert.deepEqual(r.products.map((p) => p.name), ['Trail runner 2', 'Rain shell']);
  const by = Object.fromEntries(r.events.map((e) => [e.ref, e]));
  assert.equal(by['00000184'].lane, 'order');
  assert.deepEqual(by['FO-1'].products, [{ key: I1, qty: 1 }]);
  assert.equal(by['FO-1'].end, T(14));
  assert.equal(by['FO-2'].tone, 'fail');
  assert.equal(by['SH-1'].lane, 'ship');
  assert.ok(by['FO-1'].rel.includes(SH) && by['SH-1'].rel.includes(FO1));
  assert.ok(by['FO-2'].rel.includes('2Pe000000000001AAA'));
  assert.equal(by['PE-1'].end, null);
  assert.equal(by['PA-1'].lane, 'money');
  assert.equal(by['CM-1'].amount, -58);
  for (let i = 1; i < r.events.length; i++) assert.ok(new Date(r.events[i - 1].start) <= new Date(r.events[i].start));
  // Payments through the payment summary; invoices and credit memos through ReferenceEntityId; nothing about the customer.
  assert.ok(soql().some((q) => /FROM PaymentAuthorization WHERE OrderPaymentSummary\.OrderSummaryId = /.test(q)));
  assert.ok(soql().some((q) => /FROM Invoice WHERE ReferenceEntityId = /.test(q)));
  for (const q of soql()) assert.doesNotMatch(q, /Email|Phone|Billing|Account\.Name/);
});

test('objects the org lacks drop out without an error', async () => {
  const { r, soql } = await history({ objects: ['OrderSummary', 'OrderItemSummary', 'FulfillmentOrder'] });
  assert.deepEqual([...new Set(r.events.map((e) => e.lane))].sort(), ['fo', 'order']);
  assert.ok(!soql().some((q) => /FROM (Shipment|PaymentAuthorization|Invoice|Case)/.test(q)));
});

test('a bad Id is rejected and a missing order is a 404', async () => {
  const { core } = fakeOrg({ queries: [[/./, []]] });
  await assert.rejects(core.route('/api/order/nope/history'), (e) => e.code === 400);
  await assert.rejects(core.route(`/api/order/${OS}/history`), (e) => e.code === 404);
});
