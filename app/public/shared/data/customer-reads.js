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
// Shared customer search, 360 and transcript reads.
import { ID_RE, OPEN_PE, relField } from './om-reads.js';
import { parseTranscript, likeEsc, idList, bad, ACCOUNT_F } from './om-core-util.js';
import { moneyState } from './om-rules.js';

export function customerReads(k) {
  const { soql, describe, pick, instanceUrl, caseOrderRel } = k;
  const moneyFacts = (...a) => k.moneyFacts(...a);
  // Find a customer by name, email, phone or order number. SOQL LIKE only: SOSL (/search) stays off the read allowlist.
  // One row per account; order-number hits rank first, then an exact email, then the rest.
  async function serviceSearch(text) {
    const t = likeEsc(text), raw = String(text ?? '').trim().slice(0, 80).toLowerCase();
    if (t.replace(/\\/g, '').length < 2) return [];
    const [acF, ctF, osF] = await Promise.all([
      pick('Account', ['Id', 'Name', 'PersonEmail', 'Phone', 'PersonMobilePhone', 'BillingCity', 'BillingState']),
      pick('Contact', ['AccountId', 'Account.Name', 'Account.BillingCity', 'Account.BillingState', 'Name', 'Email', 'Phone']),
      pick('OrderSummary', ['Id', 'OrderNumber', 'AccountId', 'Account.Name', 'BillingEmailAddress', 'BillingCity', 'BillingState'])]);
    const any = (have, fs) => fs.filter((x) => have.includes(x)).map((x) => `${x} LIKE '%${t}%'`).join(' OR ');
    const acW = acF.includes('Id') && any(acF, ['Name', 'PersonEmail', 'Phone', 'PersonMobilePhone']);
    const ctW = ctF.includes('AccountId') && any(ctF, ['Name', 'Email', 'Phone']);
    const osW = osF.includes('AccountId') && [osF.includes('OrderNumber') && `OrderNumber LIKE '${t}%'`, osF.includes('BillingEmailAddress') && `BillingEmailAddress LIKE '%${t}%'`].filter(Boolean).join(' OR ');
    const run = (w, q) => (w ? soql(q).catch(() => []) : []);
    const [acs, cts, oss] = await Promise.all([
      run(acW, `SELECT ${acF.join(', ')} FROM Account WHERE ${acW} LIMIT 10`),
      run(ctW, `SELECT ${ctF.join(', ')} FROM Contact WHERE AccountId != null AND (${ctW}) LIMIT 10`),
      run(osW, `SELECT ${osF.join(', ')} FROM OrderSummary WHERE AccountId != null AND (${osW}) ORDER BY CreatedDate DESC LIMIT 10`)]);
    const lc = (s) => String(s ?? '').toLowerCase(), by = new Map();
    // [label, rank]: 1 for an exact email, else 2 with the first field that contains the text.
    const why = (email, rest) => lc(email) === raw ? ['Email', 1] : [([['Email', email], ...rest].find(([, v]) => v && lc(v).includes(raw)) || ['Match'])[0], 2];
    const add = (id, row, [matched, rank], orderId = null) => {
      if (!id) return;
      const cur = by.get(id) || { accountId: id, name: null, email: null, city: null, state: null, matched, orderId: null, rank: 9 };
      cur.name ??= row.name ?? null; cur.email ??= row.email ?? null; cur.city ??= row.city ?? null; cur.state ??= row.state ?? null;
      if (rank < cur.rank) Object.assign(cur, { rank, matched, orderId });
      by.set(id, cur);
    };
    for (const o of oss) {
      const row = { name: o.Account?.Name, email: o.BillingEmailAddress, city: o.BillingCity, state: o.BillingState };
      if (lc(o.OrderNumber).startsWith(raw)) add(o.AccountId, row, [`Order ${o.OrderNumber}`, 0], o.Id);
      else add(o.AccountId, row, why(o.BillingEmailAddress, []));
    }
    for (const a of acs) add(a.Id, { name: a.Name, email: a.PersonEmail, city: a.BillingCity, state: a.BillingState }, why(a.PersonEmail, [['Name', a.Name], ['Phone', a.Phone], ['Phone', a.PersonMobilePhone]]));
    for (const c of cts) add(c.AccountId, { name: c.Account?.Name ?? c.Name, email: c.Email, city: c.Account?.BillingCity, state: c.Account?.BillingState }, why(c.Email, [['Name', c.Name], ['Phone', c.Phone]]));
    return [...by.values()].sort((a, b) => a.rank - b.rank).slice(0, 10).map(({ rank, ...r }) => r);
  }

  // One customer, three waves: the account and its lists, then everything keyed by those orders, then chats (keyed by cases and orders).
  // `focus` is the order a queue row pointed at; it's added even when it's older than the last 10.
  async function serviceCustomer(id, focus) {
    const [acF, osD, csD, roD, rfD, cmD, lcD, shD, peD, rel] = await Promise.all([pick('Account', ACCOUNT_F), describe('OrderSummary'), describe('Case'), describe('ReturnOrder'),
      describe('Refund'), describe('CreditMemo'), describe('LiveChatTranscript'), describe('Shipment'), describe('ProcessException'), caseOrderRel()]);
    if (!acF.length) throw Object.assign(new Error('Account is not available in this org'), { code: 404 });
    const osField = relField(rel), od = osD?.fields.has('OrderedDate') ? 'OrderedDate' : 'CreatedDate';
    const hasOS = !!osD?.fields.has('AccountId'), hasCS = !!csD?.fields.has('IsClosed'), roOk = !!roD?.fields.has('AccountId');
    const hasPE = !!peD?.fields.has('OrderSummaryId') && peD.fields.has('Category'), shipOk = !!shD?.fields.has('FulfillmentOrderId') && shD.fields.has('OrderSummaryId');
    const cmAmt = cmD?.fields.has('BillingAccountId') && ['TotalAmountWithTax', 'TotalAmount'].find((f) => cmD.fields.has(f));
    const [osF, csF, roF, foF, shF, peF, lcF, oisF, dgF, fliF, siF] = await Promise.all([
      pick('OrderSummary', ['Id', 'OrderNumber', 'Status', 'GrandTotalAmount', 'OrderedDate', 'CreatedDate', 'SalesChannel.SalesChannelName', 'LastModifiedDate', 'OrderLifeCycleType']),
      pick('Case', ['Id', 'CaseNumber', 'Subject', 'Type', 'Status', 'Priority', 'IsClosed', 'CreatedDate', 'Owner.Name', ...(rel ? [osField, `${rel}.OrderNumber`] : [])]),
      pick('ReturnOrder', ['Id', 'ReturnOrderNumber', 'Status', 'GrandTotalAmount', 'CreatedDate', 'OrderSummaryId', 'OrderSummary.OrderNumber']),
      pick('FulfillmentOrder', ['Id', 'FulfillmentOrderNumber', 'Status', 'StatusCategory', 'FulfilledFromLocation.Name', 'DeliveryMethod.Name', 'OrderSummaryId', 'FulfilledToCity', 'FulfilledToState', 'CreatedDate', 'LastModifiedDate']),
      pick('Shipment', ['Id', 'ShipmentNumber', 'Status', 'Provider', 'TrackingNumber', 'TrackingUrl', 'FulfillmentOrderId', 'OrderSummaryId', 'ExpectedDeliveryDate', 'ActualDeliveryDate', 'CreatedDate']),
      pick('ProcessException', ['Id', 'ProcessExceptionNumber', 'OrderSummaryId', 'Category', 'Message', 'Description', 'Priority', 'Severity', 'CreatedDate']),
      pick('LiveChatTranscript', ['Id', 'Name', 'Status', 'StartTime', 'CreatedDate', 'Owner.Name', 'CaseId', 'Case.CaseNumber', 'Order_Summary_Id__c']),
      pick('OrderItemSummary', ['Id', 'OrderSummaryId', 'Name', 'Product2.Name', 'ProductCode', 'TypeCode', 'Status', 'QuantityOrdered', 'QuantityFulfilled', 'QuantityCanceled', 'QuantityReturned', 'TotalPrice', 'MainOrderItemSummaryId']),
      pick('OrderDeliveryGroupSummary', ['Id', 'OrderSummaryId', 'DeliverToName', 'DeliverToCity', 'DeliverToState', 'OrderDeliveryMethod.Name', 'LatestEstimatedDeliveryDate']),
      pick('FulfillmentOrderLineItem', ['Id', 'FulfillmentOrderId', 'OrderItemSummaryId', 'Quantity', 'OriginalQuantity', 'TypeCode', 'FulfillmentOrder.OrderSummaryId']),
      // What went in which box: a fulfillment order can ship as several shipments.
      shipOk ? pick('ShipmentItem', ['Id', 'ShipmentId', 'OrderItemSummaryId', 'FulfillmentOrderLineItemId', 'Quantity', 'Shipment.OrderSummaryId']) : []]);
    const sum = (q) => soql(q).then(([r]) => r?.s ?? 0).catch(() => null);
    const [[account], orders, focused, byAcct, returns, refunded, credited] = await Promise.all([
      soql(`SELECT ${acF.join(', ')} FROM Account WHERE Id = '${id}'`),
      hasOS ? soql(`SELECT ${osF.join(', ')} FROM OrderSummary WHERE AccountId = '${id}' ORDER BY ${od} DESC LIMIT 10`).catch(() => []) : [],
      hasOS && focus ? soql(`SELECT ${osF.join(', ')} FROM OrderSummary WHERE Id = '${focus}' AND AccountId = '${id}'`).catch(() => []) : [],
      hasCS && csD.fields.has('AccountId') ? soql(`SELECT ${csF.join(', ')} FROM Case WHERE AccountId = '${id}' ORDER BY IsClosed ASC, CreatedDate DESC LIMIT 10`).catch(() => []) : [],
      roOk ? soql(`SELECT ${roF.join(', ')} FROM ReturnOrder WHERE AccountId = '${id}' ORDER BY CreatedDate DESC LIMIT 5`).catch(() => []) : [],
      rfD?.fields.has('AccountId') && rfD.fields.has('Amount') ? sum(`SELECT SUM(Amount) s FROM Refund WHERE AccountId = '${id}'${rfD.fields.has('Status') ? " AND Status = 'Processed'" : ''}`) : null,
      cmAmt ? sum(`SELECT SUM(${cmAmt}) s FROM CreditMemo WHERE BillingAccountId = '${id}'`) : null]);
    if (!account) throw Object.assign(new Error('Account not found'), { code: 404 });

    const list = [...orders, ...focused.filter((f) => !orders.some((o) => o.Id === f.Id))].map((o) => ({ ...o, focus: o.Id === focus }));
    const ids = idList(list.map((o) => o.Id));
    // Delivery charges are line items too; only products are shown (TypeCode, when the org has it).
    const product = (f) => f.includes('TypeCode') ? " AND TypeCode = 'Product'" : '';
    // What each order is missing or owed back (moneyState), for its tag: three queries for all of them. A failed read leaves
    // every order without a tag (`money: null`), never a wrong one.
    const [fos, ships, peGroups, peRows, byOrder, lines, groupsDG, foLines, shipLines, money] = await Promise.all([
      ids && foF.includes('OrderSummaryId') ? soql(`SELECT ${foF.join(', ')} FROM FulfillmentOrder WHERE OrderSummaryId IN (${ids}) ORDER BY CreatedDate`).catch(() => []) : [],
      !shipOk ? null : ids ? soql(`SELECT ${shF.join(', ')} FROM Shipment WHERE OrderSummaryId IN (${ids})`).catch(() => []) : [],
      ids && hasPE ? soql(`SELECT OrderSummaryId o, Category k, COUNT(Id) c, MAX(CreatedDate) l FROM ProcessException WHERE OrderSummaryId IN (${ids}) AND ${OPEN_PE} GROUP BY OrderSummaryId, Category`).catch(() => []) : [],
      ids && hasPE ? soql(`SELECT ${peF.join(', ')} FROM ProcessException WHERE OrderSummaryId IN (${ids}) AND ${OPEN_PE} ORDER BY CreatedDate DESC LIMIT 50`).catch(() => []) : [],
      ids && hasCS && osField && csF.includes(osField) ? soql(`SELECT ${csF.join(', ')} FROM Case WHERE ${osField} IN (${ids}) ORDER BY IsClosed ASC, CreatedDate DESC LIMIT 10`).catch(() => []) : [],
      ids && oisF.includes('OrderSummaryId') ? soql(`SELECT ${oisF.join(', ')} FROM OrderItemSummary WHERE OrderSummaryId IN (${ids})${product(oisF)} LIMIT 500`).catch(() => null) : null,
      ids && dgF.includes('OrderSummaryId') ? soql(`SELECT ${dgF.join(', ')} FROM OrderDeliveryGroupSummary WHERE OrderSummaryId IN (${ids}) LIMIT 100`).catch(() => []) : [],
      ids && fliF.includes('FulfillmentOrder.OrderSummaryId') && fliF.includes('FulfillmentOrderId') ? soql(`SELECT ${fliF.join(', ')} FROM FulfillmentOrderLineItem WHERE FulfillmentOrder.OrderSummaryId IN (${ids})${product(fliF)} LIMIT 1000`).catch(() => null) : null,
      ids && siF.includes('ShipmentId') && siF.includes('Shipment.OrderSummaryId') ? soql(`SELECT ${siF.join(', ')} FROM ShipmentItem WHERE Shipment.OrderSummaryId IN (${ids}) LIMIT 1000`).catch(() => null) : null,
      moneyFacts(list).catch(() => null)]);

    const merged = new Map();
    for (const c of [...byAcct, ...byOrder]) if (!merged.has(c.Id)) merged.set(c.Id, c);
    const cases = !hasCS ? null : [...merged.values()]
      .sort((a, b) => Number(!!a.IsClosed) - Number(!!b.IsClosed) || String(b.CreatedDate).localeCompare(String(a.CreatedDate))).slice(0, 10)
      .map((c) => ({ ...c, order: osField && c[osField] ? { id: c[osField], number: c[rel]?.OrderNumber ?? null } : null }));

    // Chats link through the account, the person account's contact, a case, or a custom text field holding the order id (15 or 18 chars).
    const caseIds = idList((cases || []).map((c) => c.Id)), orderKeys = idList(list.flatMap((o) => [o.Id, o.Id.slice(0, 15)]));
    const conds = [lcD?.fields.has('AccountId') && `AccountId = '${id}'`,
      lcD?.fields.has('ContactId') && ID_RE.test(account.PersonContactId || '') && `ContactId = '${account.PersonContactId}'`,
      lcD?.fields.has('CaseId') && caseIds && `CaseId IN (${caseIds})`,
      lcD?.fields.has('Order_Summary_Id__c') && orderKeys && `Order_Summary_Id__c IN (${orderKeys})`].filter(Boolean);
    const chats = !lcD ? null : conds.length ? await soql(`SELECT ${lcF.join(', ')} FROM LiveChatTranscript WHERE ${conds.join(' OR ')} ORDER BY CreatedDate DESC LIMIT 10`).catch(() => []) : [];

    const numOf = Object.fromEntries(list.map((o) => [o.Id, o.OrderNumber])), first = new Map();
    for (const r of peRows) { const k = `${r.OrderSummaryId}|${r.Category}`; if (!first.has(k)) first.set(k, r); }
    const groups = peGroups.map((g) => {
      const r = first.get(`${g.o}|${g.k}`);
      return { order: { id: g.o, number: numOf[g.o] ?? null }, category: g.k, count: g.c, at: g.l, id: r?.Id ?? null, number: r?.ProcessExceptionNumber ?? null, message: r?.Message ?? null, description: r?.Description ?? null, priority: r?.Priority ?? null, severity: r?.Severity ?? null };
    }).sort((a, b) => String(b.at).localeCompare(String(a.at)));

    // A shipment's items, named through the order's lines (ShipmentItem's Product2 is often empty). null when the org has no ShipmentItem.
    const lineOfFli = new Map((foLines || []).map((l) => [l.Id, l.OrderItemSummaryId]));
    const boxItems = (sid) => !shipLines ? null : shipLines.filter((l) => l.ShipmentId === sid).map((l) => {
      const oi = l.OrderItemSummaryId || lineOfFli.get(l.FulfillmentOrderLineItemId) || null;
      return { id: oi, name: itemName.get(oi) ?? null, quantity: l.Quantity ?? null };
    });

    // Line items and ship-to per order. items is null when the org has no OrderItemSummary (or the read failed), so the UI can say so.
    const itemName = new Map((lines || []).map((l) => [l.Id, l.Product2?.Name || l.Name || null]));
    const orderDetail = (oid) => {
      const g = groupsDG.find((d) => d.OrderSummaryId === oid);
      return {
        shipTo: g ? { name: g.DeliverToName ?? null, city: g.DeliverToCity ?? null, state: g.DeliverToState ?? null, method: g.OrderDeliveryMethod?.Name ?? null, latest: g.LatestEstimatedDeliveryDate ?? null } : null,
        // A bundle is named once, by its main line, not by each part.
        items: lines ? lines.filter((l) => l.OrderSummaryId === oid && !l.MainOrderItemSummaryId).map((l) => ({ id: l.Id, name: l.Product2?.Name || l.Name || null, code: l.ProductCode ?? null, status: l.Status ?? null,
          ordered: l.QuantityOrdered ?? null, fulfilled: l.QuantityFulfilled ?? null, canceled: l.QuantityCanceled ?? null, returned: l.QuantityReturned ?? null, total: l.TotalPrice ?? null })) : null,
      };
    };

    return {
      account,
      attention: { cases: (cases || []).filter((c) => !c.IsClosed), exceptions: groups },
      orders: hasOS ? list.map((o) => ({ ...o, ...orderDetail(o.Id),
        fulfillmentOrders: fos.filter((f) => f.OrderSummaryId === o.Id).map((f) => ({ ...f, shipments: ships ? ships.filter((s) => s.FulfillmentOrderId === f.Id).map((s) => ({ ...s, items: boxItems(s.Id) })) : null,
          items: foLines ? foLines.filter((l) => l.FulfillmentOrderId === f.Id).map((l) => ({ id: l.OrderItemSummaryId ?? null, name: itemName.get(l.OrderItemSummaryId) ?? null, quantity: l.Quantity ?? null, original: l.OriginalQuantity ?? null })) : null })),
        exceptions: groups.filter((g) => g.order.id === o.Id), money: money ? { flags: moneyState(money.get(o.Id))?.flags ?? [] } : null })) : null,
      cases,
      returns: roOk ? { list: returns, refunded, credited } : null,
      chats,
      objects: { OrderSummary: hasOS, Case: hasCS, ProcessException: hasPE, ReturnOrder: roOk, LiveChatTranscript: !!lcD, Shipment: shipOk },
      recordUrl: `${instanceUrl()}/lightning/r/Account/${id}/view`, instanceUrl: instanceUrl(), at: new Date().toISOString(),
    };
  }

  // One chat transcript, read on demand when an agent expands it (Body is long text, so the 360 list doesn't fetch it).
  async function serviceChat(id) {
    const f = await pick('LiveChatTranscript', ['Id', 'Name', 'Status', 'StartTime', 'EndTime', 'ChatDuration', 'CreatedDate', 'Owner.Name', 'CaseId', 'Case.CaseNumber', 'Body']);
    if (!f.length) throw Object.assign(new Error('Chat transcripts are not available in this org'), { code: 404 });
    const [row] = await soql(`SELECT ${f.join(', ')} FROM LiveChatTranscript WHERE Id = '${id}'`);
    if (!row) throw Object.assign(new Error('Chat not found'), { code: 404 });
    const { Body, ...chat } = row;
    return { chat, entries: f.includes('Body') ? parseTranscript(Body) : null, recordUrl: `${instanceUrl()}/lightning/r/LiveChatTranscript/${id}/view`, at: new Date().toISOString() };
  }

  const routes = [
    ['/api/service/search', (m, q) => serviceSearch(q('q'))],
    [/^\/api\/service\/chat\/([^/]+)$/, (m) => (ID_RE.test(m[1]) ? serviceChat(m[1]) : bad('Bad Id'))],
    [/^\/api\/service\/customer\/([^/]+)$/, (m, q) => (ID_RE.test(m[1]) && (!q('order') || ID_RE.test(q('order'))) ? serviceCustomer(m[1], q('order')) : bad('Bad Id'))],
  ];
  return { serviceSearch, serviceCustomer, serviceChat, routes };
}
