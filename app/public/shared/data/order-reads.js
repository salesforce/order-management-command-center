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
// Order, customer drawer and inventory reads used by both apps.
import { RANGES, ID_RE, NOT_CANCELED, YEAR, relField } from './om-reads.js';
import { likeEsc, bad, OCI_AVAIL, ACCOUNT_F, scopeOf } from './om-core-util.js';

export function orderReads(k) {
  const { api, soql, describe, has, read, pick, instanceUrl, caseOrderRel, scoper } = k;
  const featureOff = (...a) => k.featureOff(...a);
  async function orderDetail(id) {
    const [osF, oisF, foF, peF, roF] = await Promise.all([
      pick('OrderSummary', ['Id', 'OrderNumber', 'Status', 'GrandTotalAmount', 'TotalAdjustedProductAmount', 'TotalAdjustedDeliveryAmount', 'OrderedDate', 'AccountId', 'Account.Name', 'BillingEmailAddress', 'BillingCity', 'BillingState', 'SalesChannel.SalesChannelName']),
      pick('OrderItemSummary', ['Id', 'Name', 'ProductCode', 'Quantity', 'QuantityCanceled', 'QuantityFulfilled', 'TotalPrice', 'Status', 'TypeCode', 'MainOrderItemSummaryId']),
      pick('FulfillmentOrder', ['Id', 'FulfillmentOrderNumber', 'Status', 'FulfilledFromLocationId', 'FulfilledFromLocation.Name', 'FulfilledToCity', 'FulfilledToState', 'DeliveryMethod.Name', 'CreatedDate']),
      pick('ProcessException', ['Id', 'ProcessExceptionNumber', 'Category', 'Status', 'Severity', 'Message', 'CreatedDate']),
      pick('ReturnOrder', ['Id', 'ReturnOrderNumber', 'Status', 'GrandTotalAmount', 'CreatedDate']),
    ]);
    const osRel = await caseOrderRel(), osField = relField(osRel);
    const csF = osField ? await pick('Case', ['Id', 'CaseNumber', 'Subject', 'Status', 'Priority', 'CreatedDate']) : [];
    const [os, items, fos, pes, ros, rlis, cases] = await Promise.all([
      soql(`SELECT ${osF.join(', ')} FROM OrderSummary WHERE Id = '${id}'`),
      oisF.length ? soql(`SELECT ${oisF.join(', ')} FROM OrderItemSummary WHERE OrderSummaryId = '${id}'`).catch(() => []) : [],
      foF.length ? soql(`SELECT ${foF.join(', ')} FROM FulfillmentOrder WHERE OrderSummaryId = '${id}'`).catch(() => []) : [],
      peF.length ? soql(`SELECT ${peF.join(', ')} FROM ProcessException WHERE OrderSummaryId = '${id}' ORDER BY CreatedDate DESC`).catch(() => []) : [],
      roF.includes('Id') ? soql(`SELECT ${roF.join(', ')} FROM ReturnOrder WHERE OrderSummaryId = '${id}' ORDER BY CreatedDate DESC`).catch(() => []) : [],
      roF.includes('Id') ? soql(`SELECT ReturnOrderId, Product2.Name, QuantityReturned, ReasonForReturn FROM ReturnOrderLineItem WHERE ReturnOrder.OrderSummaryId = '${id}' AND TypeCode = 'Product'`).catch(() => []) : [],
      csF.length ? soql(`SELECT ${csF.join(', ')} FROM Case WHERE ${osField} = '${id}' ORDER BY CreatedDate DESC`).catch(() => null) : null,
    ]);
    if (!os.length) throw Object.assign(new Error('Order Summary not found'), { code: 404 });
    return { order: os[0], items, fulfillmentOrders: fos, exceptions: pes, returns: ros.map((r) => ({ ...r, lines: rlis.filter((l) => l.ReturnOrderId === r.Id) })), cases, recordUrl: `${instanceUrl()}/lightning/r/OrderSummary/${id}/view` };
  }

  // Everything that happened to one order, as events on lanes, for the order drawer's Activity and Timeline tabs. Loaded only when
  // one of those tabs opens. Each event names the products it touched (by OrderItemSummary Id) and the events it relates to.
  // Records without an end date are points (money, the order itself) or still open (end null). Missing objects drop their lane.
  const DONE_RE = /^(fulfilled|delivered|closed|resolved|received|completed?|cancell?ed|rejected)$/i;
  const FAIL_RE = /cancel|reject|fail|declin|error/i;
  // Order number → Id, for callers that only know the number (the plugin's command-line tool). Numbers are digits only,
  // and OM pads them to 8, so "35807" and "0000035807" also try "00035807". The number exactly as typed wins.
  async function orderByNumber(num) {
    if (!(await has('OrderSummary'))) throw Object.assign(new Error('This org has no Order Summaries'), { code: 404 });
    const tries = [...new Set([num, (num.replace(/^0+/, '') || '0').padStart(8, '0')])];
    const rows = await soql(`SELECT Id, OrderNumber FROM OrderSummary WHERE OrderNumber IN (${tries.map((n) => `'${n}'`).join(', ')}) LIMIT 5`);
    const row = tries.map((n) => rows.find((r) => r.OrderNumber === n)).find(Boolean);
    if (!row) throw Object.assign(new Error(`No order ${num}`), { code: 404 });
    return { Id: row.Id, OrderNumber: row.OrderNumber };
  }

  async function orderHistory(id) {
    // The queries are the `order` read's (om-reads.js), so the console's timeline and the plugin's order-status skill see the
    // same rows. A query the org can't run (missing object, field or lookup) or one that fails just leaves its lane empty.
    // The timeline reads no personal data, so it names the queries it runs: a query added to the read later stays out.
    const lanes = ['order', 'items', 'changes', 'fulfillmentOrders', 'fulfillmentLines', 'shipments', 'exceptions', 'returns', 'returnLines', 'cases',
      'authorizations', 'payments', 'refunds', 'invoices', 'creditMemos'];
    const { results: r } = await read('order', { order: id }, { only: lanes });
    const [os, items, changes, fos, folis, ships, pes, ros, rolis, cases, auths, pays, refs, invs, cms] = lanes.map((k) => r[k].rows || []);
    if (!os.length) throw Object.assign(new Error('Order Summary not found'), { code: 404 });
    const o = os[0];
    const products = items.filter((i) => !i.TypeCode || i.TypeCode === 'Product')
      .map((i) => ({ key: i.Id, name: i.Product2?.Name || i.Name || i.ProductCode || 'Item', qty: i.Quantity ?? null, canceled: i.QuantityCanceled || 0, price: i.TotalPrice ?? null }));
    const isProduct = new Set(products.map((p) => p.key));
    const lines = (list, parent, qty) => (pid) => list.filter((l) => l[parent] === pid && isProduct.has(l.OrderItemSummaryId)).map((l) => ({ key: l.OrderItemSummaryId, qty: l[qty] ?? null }));
    const foLines = lines(folis, 'FulfillmentOrderId', 'Quantity'), roLines = lines(rolis, 'ReturnOrderId', 'QuantityReturned');
    const tone = (s) => FAIL_RE.test(s || '') ? 'fail' : DONE_RE.test(s || '') ? 'done' : 'open';
    const ended = (s, at) => DONE_RE.test(s || '') ? at || null : null;
    const ev = [];
    const at = o.OrderedDate || o.CreatedDate;
    ev.push({ id: o.Id, obj: 'OrderSummary', lane: 'order', ref: o.OrderNumber, title: 'Order placed', status: o.Status, tone: 'done', start: at, end: at, amount: o.GrandTotalAmount ?? null,
      products: products.map((p) => ({ key: p.key, qty: p.qty })), rel: [] });
    // Change orders: one event per ChangeOrder (or per change without one), listing the products it touched.
    const byChange = {};
    for (const c of changes) (byChange[c.ChangeOrderId || c.Id] ||= []).push(c);
    for (const [key, list] of Object.entries(byChange)) {
      const c = list[0], type = c.ChangeType || 'Change';
      ev.push({ id: key, obj: null, lane: 'change', ref: c.OrderItemSummaryChangeNumber || null, title: /cancel/i.test(type) ? 'Items cancelled' : /return/i.test(type) ? 'Items returned' : `${type} change`,
        sub: c.Reason || null, status: type, tone: 'done', start: c.CreatedDate, end: c.CreatedDate, amount: null,
        products: [...new Set(list.map((x) => x.OrderItemSummaryId).filter((k) => isProduct.has(k)))].map((k) => ({ key: k, qty: null })), rel: [] });
    }
    for (const f of fos) ev.push({ id: f.Id, obj: 'FulfillmentOrder', lane: 'fo', ref: f.FulfillmentOrderNumber, title: f.FulfilledFromLocation?.Name ? `Fulfilled from ${f.FulfilledFromLocation.Name}` : 'Fulfillment order',
      status: f.Status, tone: tone(f.Status), start: f.CreatedDate, end: ended(f.Status, f.LastModifiedDate), amount: f.GrandTotalAmount ?? null, products: foLines(f.Id),
      rel: [...ships.filter((s) => s.FulfillmentOrderId === f.Id).map((s) => s.Id), ...pes.filter((e) => e.AttachedToId === f.Id).map((e) => e.Id)] });
    for (const s of ships) {
      const fo = fos.find((f) => f.Id === s.FulfillmentOrderId);
      ev.push({ id: s.Id, obj: 'Shipment', lane: 'ship', ref: s.ShipmentNumber, title: s.Provider ? `Shipped with ${s.Provider}` : 'Shipment', status: s.Status, tone: tone(s.Status),
        start: s.CreatedDate, end: s.ActualDeliveryDate || ended(s.Status, null), due: s.ExpectedDeliveryDate || null, amount: null, products: fo ? foLines(fo.Id) : [], rel: fo ? [fo.Id] : [] });
    }
    for (const e of pes) {
      const fo = fos.find((f) => f.Id === e.AttachedToId);
      ev.push({ id: e.Id, obj: 'ProcessException', lane: 'exc', ref: e.ProcessExceptionNumber, title: e.Category || 'Exception', sub: e.Severity || null, status: e.Status,
        tone: DONE_RE.test(e.Status || '') ? 'done' : 'warn', start: e.CreatedDate, end: ended(e.Status, e.LastModifiedDate), amount: null, products: fo ? foLines(fo.Id) : [], rel: fo ? [fo.Id] : [] });
    }
    for (const c of cases) ev.push({ id: c.Id, obj: 'Case', lane: 'case', ref: c.CaseNumber, title: c.Subject || 'Case', status: c.Status, tone: c.IsClosed ? 'done' : 'open',
      start: c.CreatedDate, end: c.ClosedDate || null, amount: null, products: [], rel: [] });
    for (const r of ros) ev.push({ id: r.Id, obj: 'ReturnOrder', lane: 'ret', ref: r.ReturnOrderNumber, title: 'Return', status: r.Status, tone: tone(r.Status),
      start: r.CreatedDate, end: ended(r.Status, r.LastModifiedDate), amount: r.GrandTotalAmount ?? null, products: roLines(r.Id), rel: [] });
    const money = (list, title, num, amt, sign = 1) => list.forEach((m) => ev.push({ id: m.Id, obj: null, lane: 'money', ref: m[num] || null, title, status: m.Status, tone: tone(m.Status),
      start: m.CreatedDate, end: m.CreatedDate, amount: m[amt] == null ? null : sign * m[amt], products: [], rel: [] }));
    money(auths, 'Payment authorized', 'PaymentAuthorizationNumber', 'Amount');
    money(pays, 'Payment captured', 'PaymentNumber', 'Amount');
    money(invs, 'Invoiced', 'DocumentNumber', 'TotalAmountWithTax');
    money(cms, 'Credit memo', 'DocumentNumber', 'TotalAmountWithTax', -1);
    money(refs, 'Refunded', 'RefundNumber', 'Amount', -1);
    // Related both ways, so selecting either end lights up the other.
    for (const e of ev) for (const r of e.rel) { const t = ev.find((x) => x.id === r); if (t && !t.rel.includes(e.id)) t.rel.push(e.id); }
    ev.sort((a, b) => new Date(a.start) - new Date(b.start));
    return { order: { Id: o.Id, OrderNumber: o.OrderNumber, Status: o.Status }, products, events: ev.filter((e) => e.start), at: new Date().toISOString() };
  }

  // Record drawers for every stream entity: the record itself, its order and its related lists. Fields are picked against describe.
  const PE_LIST = ['Id', 'ProcessExceptionNumber', 'Category', 'Status', 'Severity', 'Message', 'CreatedDate'];
  const RECORDS = {
    Case: { fields: ['Id', 'CaseNumber', 'Subject', 'Description', 'Status', 'Priority', 'Type', 'Origin', 'Reason', 'IsClosed', 'AccountId', 'Account.Name', 'Contact.Name', 'SuppliedEmail', 'Owner.Name', 'CreatedDate', 'ClosedDate', 'LastModifiedDate'],
      related: [['exceptions', 'ProcessException', 'CaseId', PE_LIST]] },
    ProcessException: { fields: ['Id', 'ProcessExceptionNumber', 'Category', 'Status', 'Severity', 'Priority', 'Message', 'Description', 'ExternalReference', 'AttachedToId', 'AttachedTo.Name', 'AttachedTo.Type', 'Owner.Name', 'CreatedDate', 'LastModifiedDate',
      'OrderSummaryId', 'OrderSummary.OrderNumber', 'OrderSummary.Status', 'CaseId', 'Case.CaseNumber', 'Case.Status', 'Case.Subject'], related: [] },
    FulfillmentOrder: { fields: ['Id', 'FulfillmentOrderNumber', 'Status', 'Type', 'FulfilledFromLocationId', 'FulfilledFromLocation.Name', 'FulfilledToName', 'FulfilledToCity', 'FulfilledToState', 'FulfilledToEmailAddress', 'DeliveryMethod.Name', 'GrandTotalAmount', 'CreatedDate', 'LastModifiedDate', 'OrderSummaryId', 'OrderSummary.OrderNumber', 'OrderSummary.Status'],
      related: [['lines', 'FulfillmentOrderLineItem', 'FulfillmentOrderId', ['Id', 'Product2.Name', 'Product2.ProductCode', 'Quantity', 'OriginalQuantity', 'TotalPrice', 'TypeCode']],
        ['shipments', 'Shipment', 'FulfillmentOrderId', ['Id', 'ShipmentNumber', 'Status', 'Provider', 'TrackingNumber', 'ExpectedDeliveryDate', 'ActualDeliveryDate']],
        ['exceptions', 'ProcessException', 'AttachedToId', PE_LIST]] },
    Shipment: { fields: ['Id', 'ShipmentNumber', 'Status', 'Provider', 'TrackingNumber', 'TrackingUrl', 'ShipToName', 'ShipToCity', 'ShipToState', 'ExpectedDeliveryDate', 'ActualDeliveryDate', 'CreatedDate', 'LastModifiedDate',
      'FulfillmentOrderId', 'FulfillmentOrder.FulfillmentOrderNumber', 'FulfillmentOrder.Status', 'OrderSummaryId', 'OrderSummary.OrderNumber', 'OrderSummary.Status'],
      related: [['items', 'ShipmentItem', 'ShipmentId', ['Id', 'Product2.Name', 'Product2.ProductCode', 'Quantity']]] },
    ReturnOrder: { fields: ['Id', 'ReturnOrderNumber', 'Status', 'Description', 'GrandTotalAmount', 'AccountId', 'Account.Name', 'CreatedDate', 'LastModifiedDate', 'OrderSummaryId', 'OrderSummary.OrderNumber', 'OrderSummary.Status'],
      related: [['lines', 'ReturnOrderLineItem', 'ReturnOrderId', ['Id', 'Product2.Name', 'Product2.ProductCode', 'QuantityReturned', 'QuantityExpected', 'ReasonForReturn', 'TypeCode']],
        ['exceptions', 'ProcessException', 'AttachedToId', PE_LIST]] },
  };
  // Why routing picked this FO's location (OM routing explanation, API 68+). Absent for manual assignments, older orgs and older FOs.
  // routingFor() lets its error through (OM Service Console's lookup says why); the drawer's routingExplanation() reads one as none.
  const routingFor = (id) => api(`/commerce/fulfillment/fulfillment-orders/${id}/routing-explanation`).then((x) => {
    const sec = (n) => x?.sections?.find((s) => s.name === n)?.rows || [], [s = {}] = sec('summary');
    return x?.success ? { location: x.location, why: s.whyItWon, whyTip: s.whyItWonTooltip, score: s.selectionScore, scoreTip: s.selectionScoreTooltip, filled: s.unitsFilled, rules: sec('rules'), lines: sec('lineItems') } : null;
  });
  const routingExplanation = (id) => routingFor(id).catch(() => null);

  async function recordDetail(obj, id) {
    const cfg = RECORDS[obj];
    const osRel = obj === 'Case' ? await caseOrderRel() : null;
    const f = [...await pick(obj, cfg.fields), ...(osRel ? [`${osRel}.Id`, `${osRel}.OrderNumber`, `${osRel}.Status`] : [])];
    if (!f.length) throw Object.assign(new Error(`${obj} is not available in this org`), { code: 404 });
    const [rec] = await soql(`SELECT ${f.join(', ')} FROM ${obj} WHERE Id = '${id}'`);
    if (!rec) throw Object.assign(new Error(`${obj} not found`), { code: 404 });
    if (osRel) { const { [osRel]: os, ...r } = rec; Object.assign(rec, r, { OrderSummaryId: os?.Id ?? null, OrderSummary: os ? { OrderNumber: os.OrderNumber, Status: os.Status } : null }); delete rec[osRel]; }
    const [rel, routing] = await Promise.all([Promise.all(cfg.related.map(async ([key, sobject, where, wanted]) => {
      const d = await describe(sobject), rf = await pick(sobject, wanted);
      if (!d?.fields.has(where) || !rf.length) return [key, null];
      const order = d.fields.has('CreatedDate') ? ' ORDER BY CreatedDate DESC' : '';
      return [key, await soql(`SELECT ${rf.join(', ')} FROM ${sobject} WHERE ${where} = '${id}'${order} LIMIT 50`).catch(() => null)];
    })), obj === 'FulfillmentOrder' ? routingExplanation(id) : null]);
    const related = Object.fromEntries(routing ? [...rel, ['routing', routing]] : rel);
    return { obj, record: rec, related, recordUrl: `${instanceUrl()}/lightning/r/${obj}/${id}/view` };
  }

  // ---------- customer value ----------
  // Computed on open from the account's orders and returns, then ranked against every other shopper / returner with HAVING counts
  // (aggregate queries cap at 2000 rows, so a rank past that reads as "2000+"). Loyalty is shown only where Loyalty Management exists.
  async function accountDetail(id) {
    const [acF, osD, roD, rliD, csD, lpm] = await Promise.all([
      pick('Account', ACCOUNT_F),
      describe('OrderSummary'), describe('ReturnOrder'), describe('ReturnOrderLineItem'), describe('Case'), describe('LoyaltyProgramMember')]);
    if (!acF.length) throw Object.assign(new Error('Account is not available in this org'), { code: 404 });
    const hasOS = !!osD?.fields.has('AccountId') && osD.fields.has('GrandTotalAmount'), hasRO = !!roD?.fields.has('AccountId');
    const od = osD?.fields.has('OrderedDate') ? 'OrderedDate' : 'CreatedDate', roAmt = roD?.fields.has('GrandTotalAmount');
    const [osF, roF] = await Promise.all([
      pick('OrderSummary', ['Id', 'OrderNumber', 'Status', 'GrandTotalAmount', 'OrderedDate', 'CreatedDate', 'SalesChannel.SalesChannelName']),
      pick('ReturnOrder', ['Id', 'ReturnOrderNumber', 'Status', 'GrandTotalAmount', 'CreatedDate', 'OrderSummaryId', 'OrderSummary.OrderNumber'])]);
    const none = () => null;
    const [[acc], byStatus, last12, recent, ret, recentRet, reasons, cases] = await Promise.all([
      soql(`SELECT ${acF.join(', ')} FROM Account WHERE Id = '${id}'`),
      hasOS ? soql(`SELECT Status s, COUNT(Id) n, SUM(GrandTotalAmount) a, MIN(${od}) f, MAX(${od}) l FROM OrderSummary WHERE AccountId = '${id}' GROUP BY Status`).catch(none) : null,
      hasOS ? soql(`SELECT COUNT(Id) n, SUM(GrandTotalAmount) a FROM OrderSummary WHERE AccountId = '${id}' AND ${od} = LAST_N_DAYS:365 AND ${NOT_CANCELED}`).catch(none) : null,
      hasOS ? soql(`SELECT ${osF.join(', ')} FROM OrderSummary WHERE AccountId = '${id}' ORDER BY ${od} DESC LIMIT 8`).catch(none) : null,
      hasRO ? soql(`SELECT COUNT(Id) n${roAmt ? ', SUM(GrandTotalAmount) a' : ''} FROM ReturnOrder WHERE AccountId = '${id}'`).catch(none) : null,
      hasRO ? soql(`SELECT ${roF.join(', ')} FROM ReturnOrder WHERE AccountId = '${id}' ORDER BY CreatedDate DESC LIMIT 5`).catch(none) : null,
      hasRO && rliD?.fields.has('ReasonForReturn') ? soql(`SELECT ReasonForReturn r, COUNT(Id) n, SUM(QuantityReturned) q${rliD.fields.has('QuantityExpected') ? ', SUM(QuantityExpected) e' : ''} FROM ReturnOrderLineItem WHERE ReturnOrder.AccountId = '${id}' AND TypeCode = 'Product' GROUP BY ReasonForReturn ORDER BY COUNT(Id) DESC`).catch(none) : null,
      csD?.fields.has('AccountId') ? soql(`SELECT IsClosed c, COUNT(Id) n FROM Case WHERE AccountId = '${id}' GROUP BY IsClosed`).catch(none) : null]);
    if (!acc) throw Object.assign(new Error('Account not found'), { code: 404 });

    const live = (byStatus || []).filter((r) => !/cancel/i.test(r.s || '')), dates = (byStatus || []).flatMap((r) => [r.f, r.l]).filter(Boolean).sort();
    const orders = live.reduce((s, r) => s + r.n, 0), spend = live.reduce((s, r) => s + (r.a || 0), 0);
    const returns = ret ? { n: ret[0]?.n ?? 0, amount: ret[0]?.a ?? null } : null;
    // Ranks: how many shoppers beat this one over the last 12 months, and out of how many with orders (or returns) in that time.
    // Both sides use the same 12 months, so a large org's whole history is never scanned.
    const orders12 = last12?.[0]?.n ?? 0, spend12 = last12?.[0]?.a ?? 0;
    const returns12 = returns?.n ? await soql(`SELECT COUNT(Id) n FROM ReturnOrder WHERE AccountId = '${id}' AND CreatedDate = ${YEAR}`).then((r) => r[0]?.n ?? 0).catch(none) : 0;
    const above = (q) => soql(`${q} LIMIT 2000`).then((r) => r.length).catch(none), total = (q) => soql(q).then((r) => r[0]?.c ?? null).catch(none);
    const [bySpend, byOrders, shoppers, byReturns, returners] = await Promise.all([
      hasOS && byStatus ? above(`SELECT AccountId FROM OrderSummary WHERE ${od} = ${YEAR} AND AccountId != null AND ${NOT_CANCELED} GROUP BY AccountId HAVING SUM(GrandTotalAmount) > ${spend12.toFixed(2)}`) : null,
      hasOS && byStatus ? above(`SELECT AccountId FROM OrderSummary WHERE ${od} = ${YEAR} AND AccountId != null AND ${NOT_CANCELED} GROUP BY AccountId HAVING COUNT(Id) > ${orders12}`) : null,
      hasOS && byStatus ? total(`SELECT COUNT_DISTINCT(AccountId) c FROM OrderSummary WHERE ${od} = ${YEAR} AND ${NOT_CANCELED}`) : null,
      returns12 ? above(`SELECT AccountId FROM ReturnOrder WHERE CreatedDate = ${YEAR} AND AccountId != null GROUP BY AccountId HAVING COUNT(Id) > ${returns12}`) : null,
      returns12 ? total(`SELECT COUNT_DISTINCT(AccountId) c FROM ReturnOrder WHERE CreatedDate = ${YEAR}`) : null]);
    const rank = (n, of, mine) => n == null || of == null || !mine ? null : { pos: n + 1, of, capped: n >= 2000 };

    return {
      account: acc,
      objects: { OrderSummary: hasOS, ReturnOrder: hasRO, Case: !!csD, LoyaltyProgramMember: !!lpm },
      value: byStatus && {
        orders, spend, aov: orders ? spend / orders : null, first: dates[0] ?? null, last: dates.at(-1) ?? null,
        canceled: (byStatus || []).filter((r) => /cancel/i.test(r.s || '')).reduce((s, r) => s + r.n, 0),
        byStatus: byStatus.map((r) => ({ key: r.s ?? '(blank)', n: r.n, amount: r.a ?? 0 })),
        last12: last12 && { n: last12[0]?.n ?? 0, amount: last12[0]?.a ?? 0 },
        rank: { spend: rank(bySpend, shoppers, orders12), orders: rank(byOrders, shoppers, orders12) } },
      returns: returns && { ...returns, rate: returns.amount != null && spend ? returns.amount / spend : null, perOrder: orders ? returns.n / orders : null,
        units: reasons ? reasons.reduce((s, r) => s + (r.q || r.e || 0), 0) : null, reasons: reasons && reasons.map((r) => ({ key: r.r ?? '(no reason)', n: r.n, units: r.q || r.e || 0 })),
        rank: rank(byReturns, returners, returns12), recent: recentRet },
      recentOrders: recent,
      cases: cases && { open: cases.find((r) => r.c === false)?.n ?? 0, closed: cases.find((r) => r.c === true)?.n ?? 0 },
      loyalty: lpm ? await loyalty(acc, lpm).catch((e) => ({ error: e.message })) : null,
      recordUrl: `${instanceUrl()}/lightning/r/Account/${id}/view` };
  }
  // Loyalty Management: the member record(s) for this person account's contact (or the account, for corporate members), with tier and point balances.
  async function loyalty(acc, d) {
    const by = [d.fields.has('ContactId') && acc.PersonContactId && `ContactId = '${acc.PersonContactId}'`, d.fields.has('AccountId') && `AccountId = '${acc.Id}'`].filter(Boolean);
    if (!by.length) return { members: [] };
    const mf = await pick('LoyaltyProgramMember', ['Id', 'MembershipNumber', 'MemberStatus', 'MemberType', 'EnrollmentDate', 'Program.Name']);
    const members = await soql(`SELECT ${mf.join(', ')} FROM LoyaltyProgramMember WHERE ${by.join(' OR ')} LIMIT 5`);
    if (!members.length) return { members };
    const ids = members.map((m) => `'${m.Id}'`).join(', ');
    const [tf, cf] = await Promise.all([pick('LoyaltyMemberTier', ['LoyaltyMemberId', 'Name', 'LoyaltyTier.Name', 'EffectiveDate', 'TierExpirationDate']),
      pick('LoyaltyMemberCurrency', ['LoyaltyMemberId', 'Name', 'PointsBalance', 'TotalPointsAccrued', 'TotalPointsRedeemed', 'TotalPointsExpired'])]);
    const [tiers, points] = await Promise.all([
      tf.includes('LoyaltyMemberId') ? soql(`SELECT ${tf.join(', ')} FROM LoyaltyMemberTier WHERE LoyaltyMemberId IN (${ids})`).catch(() => []) : [],
      cf.includes('LoyaltyMemberId') ? soql(`SELECT ${cf.join(', ')} FROM LoyaltyMemberCurrency WHERE LoyaltyMemberId IN (${ids})`).catch(() => []) : []]);
    return { members: members.map((m) => ({ ...m, tiers: tiers.filter((t) => t.LoyaltyMemberId === m.Id), points: points.filter((p) => p.LoyaltyMemberId === m.Id) })) };
  }

  // ---------- product search + inventory ----------
  async function productSearch(text) {
    if (!(await has('Product2'))) return { available: false, list: [] };
    const t = likeEsc(text), f = await pick('Product2', ['Id', 'Name', 'ProductCode', 'StockKeepingUnit', 'Family', 'IsActive']);
    const by = ['Name', 'ProductCode', 'StockKeepingUnit'].filter((x) => f.includes(x));
    if (t.replace(/\\/g, '').length < 2 || !by.length) return { available: true, list: [] };
    return { available: true, list: await soql(`SELECT ${f.join(', ')} FROM Product2 WHERE ${by.map((x) => `${x} LIKE '%${t}%'`).join(' OR ')} ORDER BY Name LIMIT 12`) };
  }

  // Where a product is: the first inventory source that exists and knows the product wins, and `tried` says why earlier ones were skipped.
  // 1) ProductItem (field service inventory) · 2) Omnichannel Inventory availability · 3) fallback: this product's fulfillment/demand in range.
  async function inventory(id, rangeKey, scope) {
    const range = RANGES[rangeKey] || RANGES['7d'], tried = [];
    const [p] = await soql(`SELECT ${(await pick('Product2', ['Id', 'Name', 'ProductCode', 'StockKeepingUnit'])).join(', ')} FROM Product2 WHERE Id = '${id}'`);
    if (!p) throw Object.assign(new Error('Product not found'), { code: 404 });
    const out = (source, measure, locations, states = [], extra = {}) => ({ product: p, source, measure, locations, states, tried, range: rangeKey, ...extra });

    if ((await pick('ProductItem', ['Product2Id', 'LocationId', 'QuantityOnHand'])).length === 3) {
      const rows = await soql(`SELECT LocationId l, Location.Name n, SUM(QuantityOnHand) q FROM ProductItem WHERE Product2Id = '${id}' GROUP BY LocationId, Location.Name`);
      if (rows.length) return out('ProductItem', 'On hand', rows.map((r) => ({ id: r.l, name: r.n, qty: r.q ?? 0, onHand: r.q ?? 0 })));
      tried.push({ source: 'ProductItem', note: 'no records for this product' });
    } else tried.push({ source: 'ProductItem', note: 'not available in this org' });

    const lf = await pick('Location', ['ExternalReference', 'ShouldSyncWithOci']), gf = await pick('LocationGroup', ['ExternalReference', 'ShouldSyncWithOci', 'LocationGroupName']);
    if (await featureOff('inventory')) tried.push({ source: 'Omnichannel Inventory', note: 'turned off in this org' });
    else if (!p.StockKeepingUnit) tried.push({ source: 'Omnichannel Inventory', note: 'product has no StockKeepingUnit' });
    else if (!lf.includes('ExternalReference')) tried.push({ source: 'Omnichannel Inventory', note: 'Location.ExternalReference not available' });
    else {
      try {
        const sync = (f) => (f.includes('ShouldSyncWithOci') ? ' AND ShouldSyncWithOci = true' : '');
        const [locs, groups] = await Promise.all([
          soql(`SELECT Id, Name, ExternalReference FROM Location WHERE ExternalReference != null${sync(lf)} LIMIT 500`),
          gf.includes('ExternalReference') ? soql(`SELECT Id, LocationGroupName, ExternalReference FROM LocationGroup WHERE ExternalReference != null${sync(gf)} LIMIT 100`).catch(() => []) : []]);
        const chunks = (xs) => Array.from({ length: Math.ceil(xs.length / 100) }, (_, i) => xs.slice(i * 100, i * 100 + 100));
        const sku = p.StockKeepingUnit, rec = (x) => x.inventoryRecords?.find((r) => r.stockKeepingUnit === sku);
        const [lr, gr] = await Promise.all([
          Promise.all(chunks(locs.map((l) => l.ExternalReference)).map((ids) => api(OCI_AVAIL, { locationIdentifiers: ids, stockKeepingUnits: [sku] }))),
          groups.length ? api(OCI_AVAIL, { locationGroupIdentifiers: groups.map((g) => g.ExternalReference), stockKeepingUnits: [sku] }).catch(() => null) : null]);
        const byRef = Object.fromEntries(locs.map((l) => [l.ExternalReference, l])), gByRef = Object.fromEntries(groups.map((g) => [g.ExternalReference, g]));
        const shape = (r) => ({ qty: r.availableToFulfill ?? 0, onHand: r.onHand ?? 0, atf: r.availableToFulfill ?? 0, ato: r.availableToOrder ?? 0, reserved: r.reserved ?? 0, inTransit: r.inTransit ?? 0 });
        const found = lr.flatMap((x) => x.locations || []).map((x) => ({ x, r: rec(x) })).filter(({ r }) => r?.exists)
          .map(({ x, r }) => ({ id: byRef[x.locationIdentifier]?.Id ?? null, name: byRef[x.locationIdentifier]?.Name ?? x.locationIdentifier, ref: x.locationIdentifier, ...shape(r) }));
        const gl = (gr?.locationGroups || []).map((x) => ({ x, r: rec(x) })).filter(({ r }) => r?.exists).map(({ x, r }) => ({ name: gByRef[x.locationGroupIdentifier]?.LocationGroupName ?? x.locationGroupIdentifier, ref: x.locationGroupIdentifier, ...shape(r) }));
        if (found.length || gl.length) return out('Omnichannel Inventory', 'Available to fulfill', found.sort((a, b) => b.qty - a.qty), [], { groups: gl, checked: locs.length });
        tried.push({ source: 'Omnichannel Inventory', note: `no inventory records for SKU ${sku} at ${locs.length} synced locations` });
      } catch (e) { tried.push({ source: 'Omnichannel Inventory', note: e.message }); }
    }

    const [hasFOLI, hasOIS] = await Promise.all([has('FulfillmentOrderLineItem'), has('OrderItemSummary')]), A = (await scoper(scope)).and;
    const [fo, dem] = await Promise.all([
      hasFOLI ? soql(`SELECT FulfillmentOrder.FulfilledFromLocationId l, FulfillmentOrder.FulfilledFromLocation.Name n, FulfillmentOrder.FulfilledToState s, SUM(Quantity) q FROM FulfillmentOrderLineItem WHERE Product2Id = '${id}' AND FulfillmentOrder.CreatedDate = ${range}${A('FulfillmentOrderLineItem')} GROUP BY FulfillmentOrder.FulfilledFromLocationId, FulfillmentOrder.FulfilledFromLocation.Name, FulfillmentOrder.FulfilledToState`) : [],
      hasOIS && (await pick('OrderItemSummary', ['OrderDeliveryGroupSummary.DeliverToState', 'QuantityOrdered'])).length === 2
        ? soql(`SELECT OrderDeliveryGroupSummary.DeliverToState s, SUM(QuantityOrdered) q FROM OrderItemSummary WHERE Product2Id = '${id}' AND OrderSummary.OrderedDate = ${range}${A('OrderItemSummary')} GROUP BY OrderDeliveryGroupSummary.DeliverToState`) : []]);
    const locs = {}, ship = {};
    for (const r of fo) { if (r.l) (locs[r.l] ||= { id: r.l, name: r.n, qty: 0 }).qty += r.q || 0; if (r.s) ship[r.s] = (ship[r.s] || 0) + (r.q || 0); }
    const states = Object.keys(ship).length ? Object.entries(ship).map(([key, n]) => ({ key, n })) : dem.filter((r) => r.s).map((r) => ({ key: r.s, n: r.q || 0 }));
    return out('Orders', fo.length ? 'Units fulfilled' : 'Units ordered', Object.values(locs).sort((a, b) => b.qty - a.qty), states,
      { stateBasis: Object.keys(ship).length ? 'FO ship-to state' : 'delivery group ship-to state', available: hasFOLI || hasOIS });
  }

  const routes = [
    ['/api/products', (m, q) => productSearch(q('q'))],
    ['/api/inventory', (m, q) => (ID_RE.test(q('id') || '') ? inventory(q('id'), q('range'), scopeOf(q)) : bad('Bad Id'))],
    [/^\/api\/order-number\/([^/]+)$/, (m) => (/^\d{1,20}$/.test(m[1]) ? orderByNumber(m[1]) : bad('Bad order number'))],
    [/^\/api\/order\/([^/]+)\/history$/, (m) => (ID_RE.test(m[1]) ? orderHistory(m[1]) : bad('Bad Id'))],
    [/^\/api\/order\/([^/]+)$/, (m) => (ID_RE.test(m[1]) ? orderDetail(m[1]) : bad('Bad Id'))],
    [/^\/api\/account\/([^/]+)$/, (m) => (ID_RE.test(m[1]) ? accountDetail(m[1]) : bad('Bad Id'))],
    [/^\/api\/record\/([A-Za-z]+)\/([^/]+)$/, (m) => (Object.hasOwn(RECORDS, m[1]) && ID_RE.test(m[2]) ? recordDetail(m[1], m[2]) : bad('Bad record'))],
  ];
  return { orderDetail, orderByNumber, orderHistory, recordDetail, accountDetail, productSearch, inventory, routingFor, routes };
}
