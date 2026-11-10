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
// Shared policy-book, relationship and money display facts; all reads.
import { ID_RE } from './om-reads.js';
import { POLICY_KINDS, POLICY_FIELDS, returnCredit } from './om-rules.js';

export const POLICY_SHIPMENT = ['Id', 'FulfillmentOrderId', 'ActualDeliveryDate', 'CreatedDate', 'OrderSummaryId'];
// What moneyFacts reads to tell an exchange order and value its return (returnCredit in om-rules.js), as SomServicePayment.cls
// reads it in-org: the order's Exchange relationship, its placed total, and the return order's total and status.
export const EXCHANGE_LINK = ['AssociatedOrderSummaryId', 'MainAttachedToId', 'AssociatedRelationshipType', 'AssociatedOrderSummary.OriginalOrder.GrandTotalAmount'];
export const EXCHANGE_RETURN = ['Id', 'ReturnOrderNumber', 'GrandTotalAmount', 'Status', 'StatusCategory'];

export function displayFacts(k) {
  const { api, soql, allRows, pick, ORDER_LINES, instanceUrl } = k;
  // ---------- order policies (org/policies) ----------
  // Return, cancel and adjustment policies are custom objects an admin keeps, each kind its own object. A policy is reusable:
  // a SOM_Policy_Assignment__c gives a store one policy of each kind, and a store with none (or a kind left blank) takes that
  // kind's active default. Only active policies are read. `state` says what the page can rely on:
  //   'ok': read; 'none': the org has no policy objects, so nothing is checked;
  //   'hidden': the objects are there but this user can't read them (no OM Policies Read), so what they govern is refused;
  //   'unknown': they can't be read and whether they exist can't be told either (no Setup access): treated as none, and said.
  // Whether they exist comes from the Tooling API (inside Salesforce, om-platform.js asks SomConsoleRead), kept five minutes.
  let policyObjCache = null; // { org, at, on }
  async function policyObjects() {
    if (policyObjCache && policyObjCache.org === instanceUrl() && Date.now() - policyObjCache.at < 300000) return policyObjCache.on;
    let on;
    try { on = ((await api(`/tooling/query?q=${encodeURIComponent("SELECT DeveloperName FROM CustomObject WHERE DeveloperName = 'SOM_Return_Policy'")}`)).records || []).length > 0; } catch { on = null; }
    policyObjCache = { org: instanceUrl(), at: Date.now(), on };
    return on;
  }
  async function policyBook() {
    const kinds = Object.entries(POLICY_KINDS);
    const [fs, aF] = await Promise.all([Promise.all(kinds.map(([, k]) => pick(k.object, [...POLICY_FIELDS, ...k.fields]))),
      pick('SOM_Policy_Assignment__c', ['Id', 'Store__c', 'Store__r.Name', ...kinds.map(([, k]) => k.lookup)])]);
    // An object the user can see with fields they can't (field-level security) would read as rules with no limits: that's
    // policies this user can't read, the same as objects they can't see.
    const partial = kinds.some(([, k], i) => fs[i].includes('Id') && [...POLICY_FIELDS, ...k.fields].some((x) => !fs[i].includes(x)));
    if (partial) return { available: false, state: 'hidden', at: new Date().toISOString(), return: null, cancel: null, adjust: null, assignments: [] };
    const [lists, assigns] = await Promise.all([
      Promise.all(kinds.map(([, k], i) => (fs[i].includes('Id') ? soql(`SELECT ${fs[i].join(', ')} FROM ${k.object}${fs[i].includes('Active__c') ? ' WHERE Active__c = true' : ''} ORDER BY Name LIMIT 200`).catch(() => null) : null))),
      aF.includes('Store__c') ? soql(`SELECT ${aF.join(', ')} FROM SOM_Policy_Assignment__c WHERE Store__c != null ORDER BY LastModifiedDate DESC LIMIT 500`).catch(() => null) : null]);
    const n = (v) => (v == null ? null : Number(v));
    const shape = (kind, r) => ({ id: r.Id, kind, name: r.Name ?? null, isDefault: r.Default__c === true, enforce: r.Enforcement__c === 'Warn' ? 'warn' : 'block', description: r.Description__c ?? null,
      ...(kind === 'return' && { days: n(r.Return_Window_Days__c), from: r.Return_Window_Starts__c === 'Order Date' ? 'order' : 'delivery' }), ...(kind === 'cancel' && { hours: n(r.Cancel_Window_Hours__c) }),
      ...(kind === 'adjust' && { maxPercent: n(r.Max_Percent__c), maxAmount: n(r.Max_Amount__c) }) });
    const available = lists.some(Boolean), there = available ? true : await policyObjects();
    const book = { available, state: available ? 'ok' : there === true ? 'hidden' : there === false ? 'none' : 'unknown', at: new Date().toISOString() };
    kinds.forEach(([kind], i) => { book[kind] = lists[i] ? lists[i].map((r) => shape(kind, r)) : null; });
    book.assignments = (assigns || []).map((a) => ({ id: a.Id, storeId: a.Store__c, store: a.Store__r?.Name ?? null, ...Object.fromEntries(kinds.map(([kind, k]) => [kind, a[k.lookup] ?? null])) }));
    return book;
  }

  // ---------- bundles ----------
  // Order Management links a bundle's parts to its main line (OrderItemSummaryRelationship: roles, pricing, how a part
  // scales). Read only when some line of the order is a part. A failed read (no access) leaves every part a Proportional
  // bundle component included in the price, which is what a cart-bought bundle is.
  const REL_FIELDS = ['Id', 'MainOrderItemSummaryId', 'AssociatedOrderItemSummaryId', 'MainOrderItemSummaryRole', 'AssociatedOrderItemSummaryRole', 'AssociatedOrderItemSumPricing', 'AssociatedQuanScaleMethod', 'MainOrderSummaryId'];
  async function relRows(id) {
    const f = await pick('OrderItemSummaryRelationship', REL_FIELDS);
    if (!f.includes('AssociatedOrderItemSummaryId') || !f.includes('MainOrderItemSummaryId')) return [];
    const where = f.includes('MainOrderSummaryId') ? `MainOrderSummaryId = '${id}'` : `MainOrderItemSummary.OrderSummaryId = '${id}'`;
    const rows = await allRows(f, 'OrderItemSummaryRelationship', where, ORDER_LINES).catch(() => []);
    return rows.map((r) => ({ main: r.MainOrderItemSummaryId, part: r.AssociatedOrderItemSummaryId, mainRole: r.MainOrderItemSummaryRole ?? null, partRole: r.AssociatedOrderItemSummaryRole ?? null,
      pricing: r.AssociatedOrderItemSumPricing ?? null, scale: r.AssociatedQuanScaleMethod ?? null }));
  }
  // An order line as bundlesOf() takes it, from its OrderItemSummary row.
  const bundleLine = (l) => { const n = (v) => (v == null ? null : Number(v));
    return { id: l.Id, name: l.Product2?.Name || l.Name || 'Item', partOf: l.MainOrderItemSummaryId ?? null, ordered: n(l.QuantityOrdered ?? l.Quantity), qty: n(l.Quantity ?? l.QuantityOrdered),
      cancelable: n(l.QuantityAvailableToCancel) ?? 0, returnable: n(l.QuantityAvailableToReturn) ?? 0, toFulfill: n(l.QuantityAvailableToFulfill), toReship: n(l.QuantityAvailableToReship),
      status: l.Status ?? null, editable: /^ordered$/i.test(l.Status || ''), lineAmount: n(l.TotalLineAmount), adjusted: n(l.AdjustedLineAmount) }; };
  const shipmentsOf = (shF, id) => (shF.includes('FulfillmentOrderId') && shF.includes('OrderSummaryId')
    ? soql(`SELECT ${shF.join(', ')} FROM Shipment WHERE OrderSummaryId = '${id}' ORDER BY CreatedDate LIMIT 200`).catch(() => []) : Promise.resolve([]));
  // ---------- what an order is paid, held and owed (moneyState in om-rules.js) ----------
  // One query per object for every order asked about (the customer's list asks for ten at once): the payment summaries, the
  // open credit memos and the open invoices, with `holds` the part of each payment summary's holds that has expired, and which
  // of them are exchange orders, with the return order each was placed with (`exchange`, what it pays for: returnCredit).
  // An org whose payment summaries lack the available amounts can't be worked out: those orders get no facts, and neither
  // does an exchange order whose return order can't be read. A failed query throws; the order page and the list catch it, the
  // write gate refuses on it.
  // Every Id here comes back from a query, so all are 18 characters and compare as they are.
  const key = (x) => String(x || ''), n = (v) => Number(v) || 0;
  async function moneyFacts(orders, { holds = false } = {}) {
    const out = new Map(), list = orders.filter((o) => ID_RE.test(o?.Id || ''));
    if (!list.length) return out;
    const ids = list.map((o) => `'${o.Id}'`).join(', '), live = new Date().toISOString().slice(0, 19) + 'Z';
    const [opsF, cmF, invF, paF, osrF, roF] = await Promise.all([
      pick('OrderPaymentSummary', ['Id', 'OrderSummaryId', 'Method', 'Type', 'PaymentMethodId', 'AvailableToCaptureAmount', 'AvailableToRefundAmount', 'CapturedAmount']),
      pick('CreditMemo', ['Id', 'DocumentNumber', 'Balance', 'ReferenceEntityId']),
      pick('Invoice', ['Id', 'DocumentNumber', 'Balance', 'ReferenceEntityId', 'CreatedDate']),
      holds ? pick('PaymentAuthorization', ['Id', 'OrderPaymentSummaryId', 'Balance', 'ExpirationDate']) : [],
      pick('OrderSummaryRelationship', EXCHANGE_LINK), pick('ReturnOrder', EXCHANGE_RETURN)]);
    const all = (fs, ...need) => need.every((x) => fs.includes(x));
    if (!all(opsF, 'Id', 'OrderSummaryId', 'AvailableToCaptureAmount', 'AvailableToRefundAmount')) return out;
    const [pays, memos, invs, auths, links] = await Promise.all([
      soql(`SELECT ${opsF.join(', ')} FROM OrderPaymentSummary WHERE OrderSummaryId IN (${ids}) LIMIT 200`),
      all(cmF, 'Id', 'Balance', 'ReferenceEntityId') ? soql(`SELECT ${cmF.join(', ')} FROM CreditMemo WHERE ReferenceEntityId IN (${ids}) AND Balance > 0 LIMIT 200`) : [],
      all(invF, 'Id', 'Balance', 'ReferenceEntityId', 'CreatedDate') ? soql(`SELECT ${invF.join(', ')} FROM Invoice WHERE ReferenceEntityId IN (${ids}) AND Balance > 0 LIMIT 200`) : [],
      all(paF, 'OrderPaymentSummaryId', 'Balance', 'ExpirationDate')
        ? soql(`SELECT ${paF.join(', ')} FROM PaymentAuthorization WHERE OrderPaymentSummary.OrderSummaryId IN (${ids}) AND ExpirationDate < ${live} AND Balance > 0 LIMIT 200`) : [],
      // Which are exchange orders: Order Management ties each to the return order it was placed with (MainAttachedTo).
      all(osrF, 'AssociatedOrderSummaryId', 'MainAttachedToId', 'AssociatedRelationshipType')
        ? soql(`SELECT ${osrF.join(', ')} FROM OrderSummaryRelationship WHERE AssociatedOrderSummaryId IN (${ids}) AND AssociatedRelationshipType = 'Exchange' LIMIT 200`) : []]);
    const roIds = [...new Set(links.map((r) => r.MainAttachedToId).filter((x) => ID_RE.test(x || '')))];
    const ros = roIds.length && all(roF, 'Id', 'GrandTotalAmount')
      ? await soql(`SELECT ${roF.join(', ')} FROM ReturnOrder WHERE Id IN (${roIds.map((x) => `'${x}'`).join(', ')}) LIMIT 200`) : [];
    const byKey = new Map();
    for (const o of list) {
      const f = { total: n(o.GrandTotalAmount), managed: !o.OrderLifeCycleType || o.OrderLifeCycleType === 'MANAGED', changedAt: o.LastModifiedDate ?? null, payments: [], memos: [], invoices: [] };
      out.set(o.Id, f); byKey.set(key(o.Id), f);
    }
    const expired = new Map();
    for (const a of auths) expired.set(key(a.OrderPaymentSummaryId), (expired.get(key(a.OrderPaymentSummaryId)) || 0) + n(a.Balance));
    for (const p of pays) byKey.get(key(p.OrderSummaryId))?.payments.push({ id: p.Id, methodId: p.PaymentMethodId ?? null, label: p.Method || p.Type || null,
      toCapture: n(p.AvailableToCaptureAmount), toRefund: n(p.AvailableToRefundAmount), captured: n(p.CapturedAmount), expired: expired.get(key(p.Id)) || 0 });
    for (const m of memos) byKey.get(key(m.ReferenceEntityId))?.memos.push({ id: m.Id, number: m.DocumentNumber ?? null, balance: n(m.Balance) });
    for (const v of invs) byKey.get(key(v.ReferenceEntityId))?.invoices.push({ id: v.Id, number: v.DocumentNumber ?? null, balance: n(v.Balance), at: v.CreatedDate ?? null });
    // An exchange order's return pays for it, up to what it was placed at (its OriginalOrder's total).
    const roById = new Map(ros.map((r) => [key(r.Id), r]));
    for (const l of links) {
      const o = list.find((x) => key(x.Id) === key(l.AssociatedOrderSummaryId)), f = o && out.get(o.Id), ro = roById.get(key(l.MainAttachedToId));
      if (!f) continue;
      if (!ro) { out.delete(o.Id); continue; }
      f.exchange = { returnOrderId: ro.Id, number: ro.ReturnOrderNumber ?? null,
        value: returnCredit({ total: ro.GrandTotalAmount, status: ro.Status, category: ro.StatusCategory }, l.AssociatedOrderSummary?.OriginalOrder?.GrandTotalAmount) };
    }
    return out;
  }
  return { policyBook, relRows, bundleLine, shipmentsOf, moneyFacts, resetPolicies: () => { policyObjCache = null; }, routes: [['/api/policies', () => policyBook()]] };
}
