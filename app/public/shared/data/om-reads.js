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
// Salesforce Order Management Operations Console — reads: fixed sets of queries, written as data. om-core.js runs them (schema-tolerant, batched into /composite)
// and skills built on them copy the same queries, so a skill on an MCP server and one on the sf CLI ask Salesforce the
// same questions. No query in a read depends on another query's rows, so all of them can go out at once.
export const RANGES = { today: 'TODAY', '7d': 'LAST_N_DAYS:7', '30d': 'LAST_N_DAYS:30', '90d': 'LAST_N_DAYS:90', '6m': 'LAST_N_MONTHS:6', '1y': 'LAST_N_DAYS:365' };
export const ID_RE = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
// A period and the one before it. The current one is partial (this week so far) and the prior one complete, except
// lastweek and lastmonth: a finished week or month against the one before it, for Monday recaps.
export const PERIODS = { today: ['TODAY', 'YESTERDAY'], week: ['THIS_WEEK', 'LAST_WEEK'], lastweek: ['LAST_WEEK', 'N_WEEKS_AGO:2'], month: ['THIS_MONTH', 'LAST_MONTH'],
  lastmonth: ['LAST_MONTH', 'N_MONTHS_AGO:2'], quarter: ['THIS_QUARTER', 'LAST_QUARTER'], year: ['THIS_YEAR', 'LAST_YEAR'] };
// Open process exceptions: still being worked. Ignored and Voided ones aren't open, and a positive list lets a date filter lead.
const inList = (xs) => `(${xs.map((x) => `'${x}'`).join(', ')})`;
export const PE_OPEN = ['New', 'Triaged', 'Paused'];
export const OPEN_PE = `Status IN ${inList(PE_OPEN)}`;
export const CLOSED_PE = `Status NOT IN ${inList(PE_OPEN)}`;
// Open fulfillment orders: not yet shipped, collected, cancelled, rejected or closed. A rejected one is done: the org's transfer-back
// automation reroutes it as a new fulfillment order. Every count of "open" in the console and the reads uses this list.
export const FO_FULFILLED = ['Fulfilled', 'Picked Up'];
export const FO_ENDED = [...FO_FULFILLED, 'Cancelled', 'Rejected', 'Closed'];
export const FO_SHIPPED = inList(FO_FULFILLED);
export const FO_DONE = inList(FO_ENDED);
export const OPEN_FO = `Status NOT IN ${FO_DONE}`;
// Orders and returns are 'Canceled', fulfillment orders 'Cancelled'; this matches both.
export const NOT_CANCELED = "Status NOT IN ('Canceled', 'Cancelled')";
// Stuck: an open fulfillment order nobody has touched since before the start of the last two days.
export const STUCK = 'LastModifiedDate < LAST_N_DAYS:2';
// Queries that would otherwise read an object's whole history look back this far (CreatedDate is indexed).
export const YEAR = 'LAST_N_DAYS:365';
// The reasons OM Service Console offers when it can't read the org's picklists, and the change reasons it never offers (fee reasons
// belong to the return-with-fee flow it leaves out). The plugin's action skills use the same (its definitions.md).
export const REASON_FALLBACK = {
  change: ['Unknown', 'Damaged', 'Defective', 'Duplicate Order', 'Wrong Item', 'Wrong Quantity', 'Not Satisfied', 'Outdated', 'Other'],
  return: ['Damaged', 'Defective', 'Wrong Item', 'Wrong Quantity', 'Not Satisfied', 'Other'],
  reject: ['Damaged Item', 'Missing Item or Part', 'Wrong Item'],
};
export const REASON_HIDDEN = /fee/i;
// Order Management has one change-reason picklist for every change (OrderItemSummaryChange.Reason). Setup won't make it depend on
// ChangeType (a standard picklist can't be dependent, and ChangeType can't control one), so which reasons each action offers is
// the app's choice. Keyed by action, with the ChangeType each writes: cancel → Cancel, return → Return, adjust →
// ProductAdjustment, edit → Modify and Add.
export const REASONS_BY_ACTION = {
  cancel: ['Duplicate Order', 'Wrong Item', 'Wrong Quantity', 'Not Satisfied', 'Outdated', 'Unknown', 'Other'],
  edit: ['Wrong Item', 'Wrong Quantity', 'Duplicate Order', 'Unknown', 'Other'],
  adjust: ['Damaged', 'Defective', 'Not Satisfied', 'Outdated', 'Unknown', 'Other'],
  return: ['Damaged', 'Defective', 'Wrong Item', 'Wrong Quantity', 'Not Satisfied', 'Outdated', 'Other'],
};
// The reasons each action offers from the org's own (`all`, fee reasons already left out), in the picklist's order: the ones
// listed for it, and any the org added that no action lists. An action none of whose reasons the org has offers them all.
/**
 * Cut the org's change-reason picklist down to the reasons each action offers.
 * @param {string[]} all The org's reasons, fee reasons already left out.
 * @returns {Object<string, string[]>} Reasons by action (cancel, adjust, edit, return); an action none of whose reasons the org has gets all of them.
 */
export function reasonsFor(all) {
  const listed = new Set(Object.values(REASONS_BY_ACTION).flat());
  return Object.fromEntries(Object.entries(REASONS_BY_ACTION).map(([action, own]) => {
    const some = all.filter((r) => own.includes(r) || !listed.has(r));
    return [action, some.length ? some : all];
  }));
}

// ---------- parameters ----------
// Every value that reaches a query is checked here first. Ids match ID_RE; numbers are digits; text is escaped and capped.
const esc = (s) => String(s).replace(/[\\']/g, '\\$&');
const likeEsc = (s) => esc(s).replace(/[%_]/g, '\\$&');
const clean = (s) => String(s ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
const bad = (m) => { throw Object.assign(new Error(m), { code: 400 }); };
// Order and case numbers are stored zero-padded to 8 digits; people type them either way.
const numbers = (v) => [...new Set([v, (v.replace(/^0+/, '') || '0').padStart(8, '0')])];
// A value is an Id only with the object's key prefix too, so a 15- or 18-character name, SKU or number stays a name, SKU or number.
const idOr = (label, prefix, keyOk, toKey = (v) => [v]) => (v) => ID_RE.test(v) && v.startsWith(prefix) ? { id: v } : keyOk(v) ? { key: toKey(v) } : bad(`Bad ${label}`);
const TYPES = {
  range: (v) => (Object.hasOwn(RANGES, v) ? { lit: RANGES[v], v } : bad(`Bad range: use ${Object.keys(RANGES).join(', ')}`)),
  period: (v) => (Object.hasOwn(PERIODS, v) ? { cur: PERIODS[v][0], prior: PERIODS[v][1], v } : bad(`Bad period: use ${Object.keys(PERIODS).join(', ')}`)),
  text: (v) => (v.length >= 2 && v.length <= 80 ? { text: v } : bad('Search text must be 2 to 80 characters')),
  id: (v) => (ID_RE.test(v) ? { id: v } : bad('Bad Id')),
  order: idOr('order number or Id', '1Os', (v) => /^\d{1,20}$/.test(v), numbers),
  case: idOr('case number or Id', '500', (v) => /^\d{1,20}$/.test(v), numbers),
  fo: idOr('fulfillment order number or Id', '0a3', (v) => /^[\w-]{1,30}$/.test(v)),
  location: idOr('location name or Id', '131', (v) => v.length >= 1 && v.length <= 80),
  product: idOr('product SKU, code or Id', '01t', (v) => v.length >= 1 && v.length <= 80),
  user: idOr('username or Id', '005', (v) => /^[\w.+-]+@[\w.-]+$/.test(v) && v.length <= 80),
  store: idOr('store Id', '0ZE', () => false),
  // A product in a store's catalog, by SKU or Id, as Order Management's product details take it (it goes into a path).
  sku: (v) => (/^[\w.-]{1,80}$/.test(v) && !/^\.+$/.test(v) ? { text: v } : bad('Bad SKU or product Id')),
};

// What a reference parameter matches on its own object when it isn't an Id. `p` is the field prefix ('' or 'Rel.').
const list = (k) => k.map((x) => `'${esc(x)}'`).join(', ');
const KEYS = {
  order: { obj: 'OrderSummary', key: (k, p) => `${p}OrderNumber IN (${list(k)})`, ph: (p) => `${p}OrderNumber IN (<ORDER_NUMBERS>)` },
  case: { obj: 'Case', key: (k, p) => `${p}CaseNumber IN (${list(k)})`, ph: (p) => `${p}CaseNumber IN (<CASE_NUMBERS>)` },
  fo: { obj: 'FulfillmentOrder', key: (k, p) => `${p}FulfillmentOrderNumber = ${list(k)}`, ph: (p) => `${p}FulfillmentOrderNumber = '<FO_NUMBER>'` },
  // Skills pass locations and products by Id (from the locations / product-search reads): names repeat and codes aren't unique.
  location: { obj: 'Location', key: (k, p) => `${p}Name = ${list(k)}`, ph: () => null },
  product: { obj: 'Product2', key: (k, p) => `(${p}StockKeepingUnit = ${list(k)} OR ${p}ProductCode = ${list(k)})`, ph: () => null },
  user: { obj: 'User', key: (k, p) => `${p}Username = ${list(k)}`, ph: () => null },
  account: { obj: 'Account', key: null, ph: () => null },
  store: { obj: 'WebStore', key: null, ph: () => null },
};
// Placeholders for parameters the stamped skill text takes as Ids.
const ID_PH = { account: '<ACCOUNT_ID>', user: '<USER_ID>', fo: '<FO_ID>', location: '<LOCATION_ID>', product: '<PRODUCT_ID>', store: '<STORE_ID>' };
// Text that goes into a Connect path, URL-encoded, and how a skipped Connect read says what it needed.
const API_TEXT = { q: '<TEXT_URL>', sku: '<SKU>' };
const API_NEEDS = { fo: 'fulfillment order Id', q: 'search text', sku: 'SKU or product Id', store: 'store Id', account: 'Account Id' };
// A lookup's field name from its relationship name: Order_Summary__r → Order_Summary__c, OrderSummary → OrderSummaryId.
/**
 * Name the lookup field behind a relationship.
 * @param {string} [rel] Relationship name, e.g. `Order_Summary__r` or `OrderSummary`.
 * @returns {string|undefined} The field (`Order_Summary__c`, `OrderSummaryId`); falsy when `rel` is.
 */
export const relField = (rel) => rel && (rel.endsWith('__r') ? rel.slice(0, -3) + '__c' : rel + 'Id');

// ---------- the reads ----------
// A query has `from` and either `fields` (rows) or `group`/`aggs` (an aggregate). Fields are optional except `keys` (default Id):
// a field the org lacks is dropped, a missing key or object skips the query. `where` items are ANDed; an item that uses an
// optional parameter the caller left out is dropped, and `{ if, then, else }` picks by whether a field exists. `match` ORs
// `field LIKE` tests over the fields that exist. `ground` finds the lookup on `from` that points only at that object: `$ref`
// is its relationship and `$refField` its field. `requires` lists relationships the query can't run without.
// Tokens: {range} {cur} {prior} {q}; {x} for a reference parameter x on its own object, {x:Rel.Path} through a relationship
// path, {x@Field} through a polymorphic Id field (a semi-join).
const both = (as, q) => [
  { ...q, as, where: q.where.map((w) => (typeof w === 'string' ? w.replaceAll('{when}', '{cur}') : w)) },
  { ...q, as: `${as}Prior`, where: q.where.map((w) => (typeof w === 'string' ? w.replaceAll('{when}', '{prior}') : w)) },
];
const PE_ROW = ['Id', 'ProcessExceptionNumber', 'Category', 'Severity', 'Priority', 'Status', 'Message', 'AttachedToId', 'AttachedTo.Type', 'AttachedTo.Name',
  'OrderSummaryId', 'OrderSummary.OrderNumber', 'CaseId', 'Case.CaseNumber', 'Owner.Name', 'CreatedDate', 'LastModifiedDate'];
const FO_ROW = ['Id', 'FulfillmentOrderNumber', 'Status', 'FulfilledFromLocation.Name', 'DeliveryMethod.Name', 'OrderSummaryId', 'OrderSummary.OrderNumber', 'CreatedDate', 'LastModifiedDate'];
const TYPE_PRODUCT = { if: 'TypeCode', then: "TypeCode = 'Product'" };
// The reasons an org accepts for a change, a return and a rejection: its picklist values, as OM Service Console offers them.
const picklist = (as, object, field) => ({ as, from: 'PicklistValueInfo', keys: ['Value'], fields: ['Value', 'Label', 'IsActive'],
  where: [`EntityParticle.EntityDefinition.QualifiedApiName = '${object}'`, `EntityParticle.QualifiedApiName = '${field}'`], limit: 100 });
const REASONS = [picklist('changeReasons', 'OrderItemSummaryChange', 'Reason'), picklist('returnReasons', 'ReturnOrderLineItem', 'ReasonForReturn'),
  picklist('rejectReasons', 'ReturnOrderLineItem', 'ReasonForRejection')];
// A customer's conversations, every way each kind links to them: on the account, on one of its contacts (a person account's
// contact included), or on one of their cases. SOQL can't OR a semi-join, so each link is its own query; the skill merges them
// into one timeline, newest first, without repeating a record found twice.
const CASE_ROW = ['Id', 'CaseNumber', 'Subject', 'Status', 'Origin', 'Type', 'Priority', 'IsClosed', 'CreatedDate', 'ClosedDate', 'Owner.Name'];
const CHAT_ROW = ['Id', 'Name', 'Status', 'StartTime', 'EndTime', 'CreatedDate', 'Owner.Name', 'CaseId', 'Case.CaseNumber'];
const MSG_ROW = ['Id', 'Name', 'Status', 'Origin', 'StartTime', 'EndTime', 'CreatedDate', 'Owner.Name', 'CaseId', 'Case.CaseNumber', 'MessagingChannel.MasterLabel', 'MessagingChannel.MessageType'];
const EMAIL_ROW = ['Id', 'Subject', 'FromName', 'Incoming', 'MessageDate', 'Status', 'ParentId', 'TextBody', 'CreatedDate'];
const CALL_ROW = ['Id', 'Name', 'CallType', 'CallStartDateTime', 'CallEndDateTime', 'CallDurationInSeconds', 'CallDisposition', 'RelatedRecordId', 'Owner.Name', 'CreatedDate'];
const onContact = (f) => `${f} IN (SELECT Id FROM Contact WHERE {account:Account})`, onCase = (f) => `${f} IN (SELECT Id FROM Case WHERE {account:Account})`;
const talk = (as, from, fields, where, order = 'CreatedDate DESC', limit = 15) => ({ as, from, fields, where: [where], order, limit });

export const READS = {
  // Who is asking: their profile, role and permission sets, so `configure` can suggest a persona.
  whoami: {
    params: { user: { type: 'user', required: true } },
    queries: [
      { as: 'user', from: 'User', fields: ['Id', 'Name', 'Title', 'Department', 'Profile.Name', 'UserRole.Name', 'TimeZoneSidKey'], where: ['{user}'], limit: 1 },
      { as: 'permissionSets', from: 'PermissionSetAssignment', fields: ['Id', 'PermissionSet.Name', 'PermissionSet.Label'], where: ['{user:Assignee}', 'PermissionSet.IsOwnedByProfile = false'], limit: 200 },
    ],
  },

  // What an org has, for the plugin's setup: counts only, no names or contact details. An object the org lacks reads as skipped.
  capabilities: {
    params: {},
    queries: [
      { as: 'org', from: 'Organization', keys: [], fields: ['IsSandbox', 'OrganizationType', 'InstanceName'], limit: 1 },
      { as: 'orders', from: 'OrderSummary', aggs: ['COUNT(Id) c'], where: [`CreatedDate = ${YEAR}`] },
      { as: 'ociLocations', from: 'Location', aggs: ['COUNT(Id) c'], where: ['ExternalReference != null'] },
      { as: 'deliverySetups', from: 'DeliveryEstimationSetup', aggs: ['COUNT(Id) c'] },
      { as: 'stores', from: 'WebStore', aggs: ['COUNT(Id) c'] },
      { as: 'entitlements', from: 'Entitlement', aggs: ['COUNT(Id) c'] },
      { as: 'agents', from: 'BotDefinition', aggs: ['COUNT(Id) c'] },
      { as: 'policies', from: 'SOM_Return_Policy__c', aggs: ['COUNT(Id) c'] },
      { as: 'admins', from: 'User', aggs: ['COUNT(Id) c'], where: ['IsActive = true', 'Profile.PermissionsModifyAllData = true', 'LastLoginDate = LAST_N_DAYS:30'] },
    ],
  },

  // Today against yesterday, and what has piled up. Days are grouped in the user's time zone.
  briefing: {
    params: {},
    queries: [
      { as: 'orders', from: 'OrderSummary', group: ['DAY_ONLY(convertTimezone(OrderedDate)) d'], aggs: ['COUNT(Id) c', 'SUM(GrandTotalAmount) v'], where: ['OrderedDate >= YESTERDAY'] },
      { as: 'fulfillment', from: 'FulfillmentOrder', group: ['DAY_ONLY(convertTimezone(CreatedDate)) d', 'Status s'], aggs: ['COUNT(Id) c'], where: ['CreatedDate >= YESTERDAY'] },
      { as: 'shipments', from: 'Shipment', group: ['DAY_ONLY(convertTimezone(CreatedDate)) d'], aggs: ['COUNT(Id) c'], where: ['CreatedDate >= YESTERDAY'] },
      { as: 'returns', from: 'ReturnOrder', group: ['DAY_ONLY(convertTimezone(CreatedDate)) d'], aggs: ['COUNT(Id) c', 'SUM(GrandTotalAmount) v'], where: ['CreatedDate >= YESTERDAY'] },
      { as: 'newExceptions', from: 'ProcessException', group: ['DAY_ONLY(convertTimezone(CreatedDate)) d', 'Category k', '?Severity sev'], aggs: ['COUNT(Id) c'], where: ['CreatedDate >= YESTERDAY'] },
      { as: 'newCases', from: 'Case', group: ['DAY_ONLY(convertTimezone(CreatedDate)) d', 'Priority p'], aggs: ['COUNT(Id) c'], where: ['CreatedDate >= YESTERDAY'] },
      { as: 'openExceptions', from: 'ProcessException', group: ['Severity sev'], aggs: ['COUNT(Id) c'], where: [OPEN_PE, `CreatedDate = ${YEAR}`] },
      { as: 'openCases', from: 'Case', group: ['Priority p'], aggs: ['COUNT(Id) c'], where: ['IsClosed = false', `CreatedDate = ${YEAR}`] },
      { as: 'stuckTotal', from: 'FulfillmentOrder', aggs: ['COUNT(Id) c'], where: [OPEN_FO, STUCK, `CreatedDate = ${YEAR}`] },
      { as: 'stuckByLocation', from: 'FulfillmentOrder', group: ['FulfilledFromLocationId l', 'FulfilledFromLocation.Name loc'], aggs: ['COUNT(Id) c'], where: [OPEN_FO, STUCK, `CreatedDate = ${YEAR}`], order: 'COUNT(Id) DESC', limit: 10 },
      { as: 'stuck', from: 'FulfillmentOrder', fields: FO_ROW, where: [OPEN_FO, STUCK, `CreatedDate = ${YEAR}`], order: 'LastModifiedDate ASC', limit: 10 },
      // The oldest stuck can be long abandoned; these just went quiet, so a fresh pile-up shows too.
      { as: 'newlyStuck', from: 'FulfillmentOrder', fields: FO_ROW, where: [OPEN_FO, STUCK, `CreatedDate = ${YEAR}`], order: 'LastModifiedDate DESC', limit: 10 },
      { as: 'latestExceptions', from: 'ProcessException', fields: PE_ROW, where: [OPEN_PE, `CreatedDate = ${YEAR}`], order: 'CreatedDate DESC', limit: 10 },
    ],
  },

  // The open exception backlog: what kind, on which orders, how old, and what got closed in the same window.
  exceptions: {
    params: { range: { type: 'range', default: '30d' } },
    queries: [
      { as: 'byCategory', from: 'ProcessException', group: ['Category k', 'Severity sev'], aggs: ['COUNT(Id) c'], where: [OPEN_PE, 'CreatedDate = {range}'], order: 'COUNT(Id) DESC' },
      { as: 'byStatus', from: 'ProcessException', group: ['Status s'], aggs: ['COUNT(Id) c'], where: [OPEN_PE, 'CreatedDate = {range}'] },
      { as: 'byOrder', from: 'ProcessException', group: ['OrderSummaryId o', 'OrderSummary.OrderNumber n', 'Category k'], aggs: ['COUNT(Id) c', 'MIN(CreatedDate) firstAt'],
        where: [OPEN_PE, 'CreatedDate = {range}'], order: 'COUNT(Id) DESC', limit: 25 },
      { as: 'oldest', from: 'ProcessException', fields: PE_ROW, where: [OPEN_PE, 'CreatedDate = {range}'], order: 'CreatedDate ASC', limit: 25 },
      { as: 'newest', from: 'ProcessException', fields: PE_ROW, where: [OPEN_PE, 'CreatedDate = {range}'], order: 'CreatedDate DESC', limit: 10 },
      { as: 'closed', from: 'ProcessException', group: ['Status s'], aggs: ['COUNT(Id) c'], where: [CLOSED_PE, 'LastModifiedDate = {range}'] },
    ],
  },

  // One period against the one before: demand, fulfillment, returns and service load.
  performance: {
    params: { period: { type: 'period', default: 'week' } },
    queries: [
      ...both('orders', { from: 'OrderSummary', aggs: ['COUNT(Id) c', 'SUM(GrandTotalAmount) v'], where: ['OrderedDate = {when}'] }),
      ...both('ordersByStatus', { from: 'OrderSummary', group: ['Status s'], aggs: ['COUNT(Id) c'], where: ['OrderedDate = {when}'] }),
      ...both('units', { from: 'OrderItemSummary', aggs: ['SUM(QuantityOrdered) ordered', 'SUM(QuantityCanceled) canceled', 'SUM(QuantityReturned) returned'], where: ['OrderSummary.OrderedDate = {when}', TYPE_PRODUCT] }),
      ...both('fulfillment', { from: 'FulfillmentOrder', group: ['Status s'], aggs: ['COUNT(Id) c'], where: ['CreatedDate = {when}'] }),
      ...both('shipments', { from: 'Shipment', aggs: ['COUNT(Id) c'], where: ['CreatedDate = {when}'] }),
      ...both('returns', { from: 'ReturnOrder', aggs: ['COUNT(Id) c', 'SUM(GrandTotalAmount) v'], where: ['CreatedDate = {when}'] }),
      ...both('exceptions', { from: 'ProcessException', group: ['Category k'], aggs: ['COUNT(Id) c'], where: ['CreatedDate = {when}'] }),
      ...both('cases', { from: 'Case', aggs: ['COUNT(Id) c'], where: ['CreatedDate = {when}'] }),
      { as: 'topProducts', from: 'OrderItemSummary', group: ['Product2.Name p'], aggs: ['SUM(QuantityOrdered) units', 'SUM(TotalPrice) v'],
        where: ['OrderSummary.OrderedDate = {cur}', TYPE_PRODUCT], order: 'SUM(TotalPrice) DESC', limit: 10 },
    ],
  },

  // One order, start to finish. orderHistory() in om-core-console.js shapes these same rows into the console's timeline.
  order: {
    params: { order: { type: 'order', required: true } },
    queries: [
      { as: 'order', from: 'OrderSummary', fields: ['Id', 'OrderNumber', 'Status', 'GrandTotalAmount', 'OrderedDate', 'CreatedDate'], where: ['{order}'], order: 'CreatedDate', limit: 200 },
      // MainOrderItemSummaryId: the bundle a line is part of (a bundle, a set or an add-on), where the org has bundles.
      { as: 'items', from: 'OrderItemSummary', fields: ['Id', 'Name', 'ProductCode', 'Product2.Name', 'Quantity', 'QuantityOrdered', 'QuantityCanceled', 'QuantityFulfilled', 'QuantityReturned', 'TotalPrice', 'TypeCode',
        'MainOrderItemSummaryId'], where: ['{order:OrderSummary}'], order: 'Id', limit: 200 },
      { as: 'changes', from: 'OrderItemSummaryChange', fields: ['Id', 'OrderItemSummaryChangeNumber', 'ChangeType', 'Reason', 'OrderItemSummaryId', 'ChangeOrderId', 'CreatedDate'],
        where: [{ if: 'OrderSummaryId', then: '{order:OrderSummary}', else: '{order:OrderItemSummary.OrderSummary}' }], order: 'CreatedDate', limit: 200 },
      { as: 'fulfillmentOrders', from: 'FulfillmentOrder', fields: ['Id', 'FulfillmentOrderNumber', 'Status', 'FulfilledFromLocation.Name', 'GrandTotalAmount', 'CreatedDate', 'LastModifiedDate'],
        where: ['{order:OrderSummary}'], order: 'CreatedDate', limit: 200 },
      { as: 'fulfillmentLines', from: 'FulfillmentOrderLineItem', fields: ['Id', 'FulfillmentOrderId', 'OrderItemSummaryId', 'Quantity', 'TypeCode'], where: ['{order:FulfillmentOrder.OrderSummary}'], order: 'Id', limit: 200 },
      { as: 'shipments', from: 'Shipment', fields: ['Id', 'ShipmentNumber', 'Status', 'Provider', 'FulfillmentOrderId', 'CreatedDate', 'ExpectedDeliveryDate', 'ActualDeliveryDate'],
        where: [{ if: 'OrderSummaryId', then: '{order:OrderSummary}', else: '{order:FulfillmentOrder.OrderSummary}' }], order: 'CreatedDate', limit: 200 },
      { as: 'exceptions', from: 'ProcessException', fields: ['Id', 'ProcessExceptionNumber', 'Category', 'Status', 'Severity', 'AttachedToId', 'CreatedDate', 'LastModifiedDate'],
        where: ['{order:OrderSummary}'], order: 'CreatedDate', limit: 200 },
      { as: 'returns', from: 'ReturnOrder', fields: ['Id', 'ReturnOrderNumber', 'Status', 'GrandTotalAmount', 'CreatedDate', 'LastModifiedDate'], where: ['{order:OrderSummary}'], order: 'CreatedDate', limit: 200 },
      { as: 'returnLines', from: 'ReturnOrderLineItem', fields: ['Id', 'ReturnOrderId', 'OrderItemSummaryId', 'QuantityReturned', 'TypeCode'], where: ['{order:ReturnOrder.OrderSummary}'], order: 'Id', limit: 200 },
      { as: 'cases', from: 'Case', ground: 'OrderSummary', fields: ['Id', 'CaseNumber', 'Subject', 'Status', 'IsClosed', 'CreatedDate', 'ClosedDate'], where: ['{order:$ref}'], order: 'CreatedDate', limit: 200 },
      { as: 'authorizations', from: 'PaymentAuthorization', requires: ['OrderPaymentSummary'], fields: ['Id', 'PaymentAuthorizationNumber', 'Status', 'Amount', 'CreatedDate'],
        where: ['{order:OrderPaymentSummary.OrderSummary}'], order: 'CreatedDate', limit: 200 },
      { as: 'payments', from: 'Payment', requires: ['OrderPaymentSummary'], fields: ['Id', 'PaymentNumber', 'Status', 'Amount', 'CreatedDate'], where: ['{order:OrderPaymentSummary.OrderSummary}'], order: 'CreatedDate', limit: 200 },
      { as: 'refunds', from: 'Refund', requires: ['OrderPaymentSummary'], fields: ['Id', 'RefundNumber', 'Status', 'Amount', 'CreatedDate'], where: ['{order:OrderPaymentSummary.OrderSummary}'], order: 'CreatedDate', limit: 200 },
      { as: 'invoices', from: 'Invoice', fields: ['Id', 'DocumentNumber', 'Status', 'TotalAmountWithTax', 'Balance', 'CreatedDate'], where: ['{order@ReferenceEntityId}'], order: 'CreatedDate', limit: 200 },
      { as: 'creditMemos', from: 'CreditMemo', fields: ['Id', 'DocumentNumber', 'Status', 'TotalAmountWithTax', 'CreatedDate'], where: ['{order@ReferenceEntityId}'], order: 'CreatedDate', limit: 200 },
      // Not on the console's timeline, which reads no personal data: who ordered, where it's going, tracking numbers (they lead
      // to an address) and exception messages (free text). orderHistory() runs only the queries above.
      { as: 'tracking', from: 'Shipment', fields: ['Id', 'ShipmentNumber', 'Provider', 'TrackingNumber', 'TrackingUrl'],
        where: [{ if: 'OrderSummaryId', then: '{order:OrderSummary}', else: '{order:FulfillmentOrder.OrderSummary}' }], limit: 50 },
      { as: 'exceptionDetails', from: 'ProcessException', fields: PE_ROW, where: ['{order:OrderSummary}', OPEN_PE], order: 'CreatedDate DESC', limit: 50 },
      { as: 'customer', from: 'OrderSummary', fields: ['Id', 'AccountId', 'Account.Name', 'BillingEmailAddress', 'SalesChannel.SalesChannelName'], where: ['{order}'], limit: 1 },
      { as: 'deliveryGroups', from: 'OrderDeliveryGroupSummary', fields: ['Id', 'DeliverToName', 'DeliverToCity', 'DeliverToState', 'DeliverToCountry', 'OrderDeliveryMethod.Name'],
        where: ['{order:OrderSummary}'], limit: 20 },
    ],
  },

  // Find a customer by name, email, phone or order number (SOQL LIKE, like the Service tab's search).
  'customer-search': {
    params: { q: { type: 'text', required: true } },
    queries: [
      { as: 'accounts', from: 'Account', fields: ['Id', 'Name', 'PersonEmail', 'Phone', 'PersonMobilePhone', 'BillingCity', 'BillingState'], match: ['Name', 'PersonEmail', 'Phone', 'PersonMobilePhone'], limit: 10 },
      { as: 'contacts', from: 'Contact', keys: ['AccountId'], fields: ['AccountId', 'Account.Name', 'Account.BillingCity', 'Account.BillingState', 'Name', 'Email', 'Phone'],
        where: ['AccountId != null'], match: ['Name', 'Email', 'Phone'], limit: 10 },
      { as: 'orders', from: 'OrderSummary', keys: ['AccountId'], fields: ['Id', 'OrderNumber', 'AccountId', 'Account.Name', 'BillingEmailAddress', 'BillingCity', 'BillingState'],
        where: ['AccountId != null'], match: [['OrderNumber', "LIKE '{q}%'"], 'BillingEmailAddress'], order: 'CreatedDate DESC', limit: 10 },
    ],
  },

  // One customer (an Account): orders and spend, what's in flight, returns and money back, cases, exceptions and chats.
  customer: {
    params: { account: { type: 'id', required: true } },
    queries: [
      { as: 'account', from: 'Account', fields: ['Id', 'Name', 'Type', 'IsPersonAccount', 'PersonEmail', 'Phone', 'BillingCity', 'BillingState', 'CreatedDate'], where: ['{account}'], limit: 1 },
      { as: 'orders', from: 'OrderSummary', fields: ['Id', 'OrderNumber', 'Status', 'GrandTotalAmount', 'OrderedDate', 'CreatedDate', 'SalesChannel.SalesChannelName'],
        where: ['{account:Account}'], order: 'OrderedDate DESC', limit: 20 },
      { as: 'spend', from: 'OrderSummary', aggs: ['COUNT(Id) c', 'SUM(GrandTotalAmount) v', 'MIN(OrderedDate) firstAt', 'MAX(OrderedDate) lastAt'], where: ['{account:Account}'] },
      { as: 'openFulfillment', from: 'FulfillmentOrder', fields: FO_ROW, where: ['{account:OrderSummary.Account}', OPEN_FO], order: 'CreatedDate DESC', limit: 50 },
      { as: 'shipments', from: 'Shipment', fields: ['Id', 'ShipmentNumber', 'Status', 'Provider', 'TrackingNumber', 'TrackingUrl', 'OrderSummary.OrderNumber', 'ExpectedDeliveryDate', 'ActualDeliveryDate', 'CreatedDate'],
        requires: ['OrderSummary'], where: ['{account:OrderSummary.Account}'], order: 'CreatedDate DESC', limit: 20 },
      { as: 'returns', from: 'ReturnOrder', fields: ['Id', 'ReturnOrderNumber', 'Status', 'GrandTotalAmount', 'OrderSummary.OrderNumber', 'CreatedDate'], where: ['{account:Account}'], order: 'CreatedDate DESC', limit: 10 },
      { as: 'returnTotals', from: 'ReturnOrder', aggs: ['COUNT(Id) c', 'SUM(GrandTotalAmount) v'], where: ['{account:Account}', NOT_CANCELED] },
      { as: 'refunded', from: 'Refund', aggs: ['SUM(Amount) v'], where: ['{account:Account}', { if: 'Status', then: "Status = 'Processed'" }] },
      { as: 'credited', from: 'CreditMemo', aggs: ['SUM(TotalAmountWithTax) v'], where: ['{account:BillingAccount}'] },
      { as: 'cases', from: 'Case', ground: 'OrderSummary', fields: ['Id', 'CaseNumber', 'Subject', 'Type', 'Status', 'Priority', 'IsClosed', 'CreatedDate', 'Owner.Name', '$ref.OrderNumber'],
        where: ['{account:Account}'], order: 'IsClosed ASC, CreatedDate DESC', limit: 10 },
      // Cases often sit on the order but not the account (a guest checkout, or a case opened from the order), so look there too.
      { as: 'orderCases', from: 'Case', ground: 'OrderSummary', fields: ['Id', 'CaseNumber', 'Subject', 'Type', 'Status', 'Priority', 'IsClosed', 'CreatedDate', 'Owner.Name', '$ref.OrderNumber'],
        where: ['$refField IN (SELECT Id FROM OrderSummary WHERE {account:Account})'], order: 'IsClosed ASC, CreatedDate DESC', limit: 10 },
      { as: 'exceptions', from: 'ProcessException', group: ['OrderSummary.OrderNumber n', 'Category k'], aggs: ['COUNT(Id) c', 'MAX(CreatedDate) lastAt'], where: ['{account:OrderSummary.Account}', OPEN_PE] },
      { as: 'chats', from: 'LiveChatTranscript', fields: ['Id', 'Name', 'Status', 'StartTime', 'CreatedDate', 'Owner.Name', 'CaseId', 'Case.CaseNumber'], where: ['{account:Account}'], order: 'CreatedDate DESC', limit: 10 },
    ],
  },

  // One case: what it's about, its order, and everything attached to it (exceptions, returns, chats, emails, comments).
  case: {
    params: { case: { type: 'case', required: true } },
    queries: [
      { as: 'case', from: 'Case', ground: 'OrderSummary', fields: ['Id', 'CaseNumber', 'Subject', 'Description', 'Status', 'Priority', 'Type', 'Origin', 'Reason', 'IsClosed', 'AccountId', 'Account.Name',
        'Contact.Name', 'SuppliedEmail', 'Owner.Name', 'CreatedDate', 'ClosedDate', 'LastModifiedDate', '$refField', '$ref.OrderNumber', '$ref.Status'], where: ['{case}'], limit: 1 },
      { as: 'exceptions', from: 'ProcessException', fields: PE_ROW, where: ['{case:Case}'], order: 'CreatedDate DESC', limit: 50 },
      { as: 'returns', from: 'ReturnOrder', fields: ['Id', 'ReturnOrderNumber', 'Status', 'GrandTotalAmount', 'OrderSummary.OrderNumber', 'CreatedDate'], where: ['{case:Case}'], order: 'CreatedDate DESC', limit: 10 },
      { as: 'chats', from: 'LiveChatTranscript', fields: ['Id', 'Name', 'Status', 'StartTime', 'EndTime', 'ChatDuration', 'Owner.Name', 'Body', 'CreatedDate'], where: ['{case:Case}'], order: 'CreatedDate DESC', limit: 3 },
      { as: 'emails', from: 'EmailMessage', fields: ['Id', 'Subject', 'FromAddress', 'ToAddress', 'Incoming', 'MessageDate', 'TextBody'], where: ['{case@ParentId}'], order: 'MessageDate DESC', limit: 5 },
      { as: 'comments', from: 'CaseComment', fields: ['Id', 'CommentBody', 'IsPublished', 'CreatedDate', 'CreatedBy.Name'], where: ['{case@ParentId}'], order: 'CreatedDate DESC', limit: 10 },
    ],
  },

  // The team's queue: open cases and open exceptions, by age, priority and owner. Exceptions already on a case show on the case.
  'service-queue': {
    params: { range: { type: 'range', default: '30d' } },
    queries: [
      { as: 'cases', from: 'Case', ground: 'OrderSummary', fields: ['Id', 'CaseNumber', 'Subject', 'Type', 'Priority', 'Status', 'Origin', 'CreatedDate', 'Owner.Name', 'Owner.Type', 'AccountId', 'Account.Name', '$ref.OrderNumber'],
        where: ['IsClosed = false', 'CreatedDate = {range}'], order: 'CreatedDate ASC', limit: 200 },
      { as: 'casesByPriority', from: 'Case', group: ['Priority p'], aggs: ['COUNT(Id) c'], where: ['IsClosed = false', 'CreatedDate = {range}'] },
      { as: 'casesByOwner', from: 'Case', group: ['Owner.Name o'], aggs: ['COUNT(Id) c'], where: ['IsClosed = false', 'CreatedDate = {range}'], order: 'COUNT(Id) DESC', limit: 20 },
      { as: 'casesOver3d', from: 'Case', aggs: ['COUNT(Id) c'], where: ['IsClosed = false', 'CreatedDate = {range}', 'CreatedDate < LAST_N_DAYS:3'] },
      { as: 'casesOver7d', from: 'Case', aggs: ['COUNT(Id) c'], where: ['IsClosed = false', 'CreatedDate = {range}', 'CreatedDate < LAST_N_DAYS:7'] },
      { as: 'exceptionGroups', from: 'ProcessException', group: ['OrderSummaryId o', 'OrderSummary.OrderNumber n', 'Category k', '?Priority p'], aggs: ['COUNT(Id) c', 'MIN(CreatedDate) firstAt', 'MAX(CreatedDate) lastAt'],
        where: [OPEN_PE, 'CreatedDate = {range}', { if: 'CaseId', then: 'CaseId = null' }], order: 'MIN(CreatedDate) ASC', limit: 300 },
      { as: 'exceptionsByCategory', from: 'ProcessException', group: ['Category k'], aggs: ['COUNT(Id) c'], where: [OPEN_PE, 'CreatedDate = {range}'], order: 'COUNT(Id) DESC' },
    ],
  },

  // How the service team did in a period against the one before: cases opened and closed, by owner, channel and type, how long
  // closing took, missed milestones (orgs with entitlements), and the returns and refunds made. Owners are the only names read.
  'service-performance': {
    params: { period: { type: 'period', default: 'week' } },
    queries: [
      { as: 'opened', from: 'Case', aggs: ['COUNT(Id) c'], where: ['CreatedDate = {cur}'] },
      { as: 'openedPrior', from: 'Case', aggs: ['COUNT(Id) c'], where: ['CreatedDate = {prior}'] },
      { as: 'closed', from: 'Case', aggs: ['COUNT(Id) c'], where: ['IsClosed = true', 'ClosedDate = {cur}'] },
      { as: 'closedPrior', from: 'Case', aggs: ['COUNT(Id) c'], where: ['IsClosed = true', 'ClosedDate = {prior}'] },
      { as: 'closedByOwner', from: 'Case', group: ['Owner.Name o'], aggs: ['COUNT(Id) c'], where: ['IsClosed = true', 'ClosedDate = {cur}'], order: 'COUNT(Id) DESC', limit: 25 },
      { as: 'openByOwner', from: 'Case', group: ['Owner.Name o'], aggs: ['COUNT(Id) c'], where: ['IsClosed = false', `CreatedDate = ${YEAR}`], order: 'COUNT(Id) DESC', limit: 25 },
      { as: 'openTotal', from: 'Case', aggs: ['COUNT(Id) c'], where: ['IsClosed = false', `CreatedDate = ${YEAR}`] },
      { as: 'byOrigin', from: 'Case', group: ['Origin g'], aggs: ['COUNT(Id) c'], where: ['CreatedDate = {cur}'], order: 'COUNT(Id) DESC' },
      { as: 'byType', from: 'Case', group: ['Type t'], aggs: ['COUNT(Id) c'], where: ['CreatedDate = {cur}'], order: 'COUNT(Id) DESC' },
      // Time to close is worked out from these rows: SOQL can't subtract two dates.
      { as: 'closedCases', from: 'Case', fields: ['Id', 'CaseNumber', 'Priority', 'Origin', 'CreatedDate', 'ClosedDate', 'Owner.Name'],
        where: ['IsClosed = true', 'ClosedDate = {cur}'], order: 'ClosedDate DESC', limit: 500 },
      { as: 'milestones', from: 'CaseMilestone', group: ['IsViolated v'], aggs: ['COUNT(Id) c'], where: ['StartDate = {cur}'] },
      { as: 'milestonesPrior', from: 'CaseMilestone', group: ['IsViolated v'], aggs: ['COUNT(Id) c'], where: ['StartDate = {prior}'] },
      { as: 'returns', from: 'ReturnOrder', aggs: ['COUNT(Id) c', 'SUM(GrandTotalAmount) v'], where: ['CreatedDate = {cur}', NOT_CANCELED] },
      { as: 'returnsPrior', from: 'ReturnOrder', aggs: ['COUNT(Id) c', 'SUM(GrandTotalAmount) v'], where: ['CreatedDate = {prior}', NOT_CANCELED] },
      { as: 'refunds', from: 'Refund', aggs: ['COUNT(Id) c', 'SUM(Amount) v'], where: ['CreatedDate = {cur}', { if: 'Status', then: "Status = 'Processed'" }] },
      { as: 'refundsPrior', from: 'Refund', aggs: ['COUNT(Id) c', 'SUM(Amount) v'], where: ['CreatedDate = {prior}', { if: 'Status', then: "Status = 'Processed'" }] },
    ],
  },

  // Open fulfillment work: by location and status, how old, and what nobody has touched for two days.
  'fulfillment-backlog': {
    params: { range: { type: 'range', default: '30d' }, location: { type: 'location' } },
    queries: [
      { as: 'byLocation', from: 'FulfillmentOrder', group: ['FulfilledFromLocationId l', 'FulfilledFromLocation.Name loc', 'Status s'], aggs: ['COUNT(Id) c'], where: [OPEN_FO, 'CreatedDate = {range}', '{location:FulfilledFromLocation}'], order: 'COUNT(Id) DESC' },
      { as: 'byDeliveryMethod', from: 'FulfillmentOrder', group: ['DeliveryMethod.Name m'], aggs: ['COUNT(Id) c'], where: [OPEN_FO, 'CreatedDate = {range}', '{location:FulfilledFromLocation}'] },
      { as: 'openTotal', from: 'FulfillmentOrder', aggs: ['COUNT(Id) c'], where: [OPEN_FO, `CreatedDate = ${YEAR}`, '{location:FulfilledFromLocation}'] },
      { as: 'olderThan3d', from: 'FulfillmentOrder', aggs: ['COUNT(Id) c'], where: [OPEN_FO, `CreatedDate = ${YEAR}`, 'CreatedDate < LAST_N_DAYS:3', '{location:FulfilledFromLocation}'] },
      { as: 'olderThan7d', from: 'FulfillmentOrder', aggs: ['COUNT(Id) c'], where: [OPEN_FO, `CreatedDate = ${YEAR}`, 'CreatedDate < LAST_N_DAYS:7', '{location:FulfilledFromLocation}'] },
      { as: 'stuckTotal', from: 'FulfillmentOrder', aggs: ['COUNT(Id) c'], where: [OPEN_FO, STUCK, `CreatedDate = ${YEAR}`, '{location:FulfilledFromLocation}'] },
      { as: 'stuckByLocation', from: 'FulfillmentOrder', group: ['FulfilledFromLocationId l', 'FulfilledFromLocation.Name loc'], aggs: ['COUNT(Id) c'], where: [OPEN_FO, STUCK, `CreatedDate = ${YEAR}`, '{location:FulfilledFromLocation}'], order: 'COUNT(Id) DESC', limit: 20 },
      { as: 'stuck', from: 'FulfillmentOrder', fields: FO_ROW, where: [OPEN_FO, STUCK, `CreatedDate = ${YEAR}`, '{location:FulfilledFromLocation}'], order: 'LastModifiedDate ASC', limit: 25 },
      { as: 'exceptions', from: 'ProcessException', group: ['Category k'], aggs: ['COUNT(Id) c'],
        where: [OPEN_PE, "AttachedTo.Type = 'FulfillmentOrder'", 'CreatedDate = {range}', 'AttachedToId IN (SELECT Id FROM FulfillmentOrder WHERE {location:FulfilledFromLocation})'], order: 'COUNT(Id) DESC' },
    ],
  },

  // The fulfillment network: every non-virtual location and its open work.
  locations: {
    params: { q: { type: 'text' } },
    queries: [
      { as: 'locations', from: 'Location', fields: ['Id', 'Name', 'LocationType', 'ExternalReference', 'IsInventoryLocation', 'ShouldSyncWithOci', 'FulfillmentOrderCapacity', 'AssignedFulfillmentOrderCount'],
        where: [{ if: 'LocationType', then: "LocationType != 'Virtual'" }, "Name LIKE '%{q}%'"], order: 'Name', limit: 200 },
      { as: 'openByLocation', from: 'FulfillmentOrder', group: ['FulfilledFromLocationId l', 'FulfilledFromLocation.Name loc'], aggs: ['COUNT(Id) c'], where: [OPEN_FO, `CreatedDate = ${YEAR}`], order: 'COUNT(Id) DESC', limit: 200 },
    ],
  },

  // One location against the prior period: work in and out, what's open or stuck, late shipments and exceptions.
  location: {
    params: { location: { type: 'location', required: true }, period: { type: 'period', default: 'week' } },
    queries: [
      { as: 'location', from: 'Location', fields: ['Id', 'Name', 'LocationType', 'ExternalReference', 'IsInventoryLocation', 'FulfillmentOrderCapacity', 'AssignedFulfillmentOrderCount'], where: ['{location}'], limit: 1 },
      ...both('created', { from: 'FulfillmentOrder', group: ['Status s'], aggs: ['COUNT(Id) c'], where: ['{location:FulfilledFromLocation}', 'CreatedDate = {when}'] }),
      ...both('shipped', { from: 'Shipment', aggs: ['COUNT(Id) c'], where: ['{location:FulfillmentOrder.FulfilledFromLocation}', 'CreatedDate = {when}'] }),
      { as: 'open', from: 'FulfillmentOrder', group: ['Status s'], aggs: ['COUNT(Id) c'], where: ['{location:FulfilledFromLocation}', OPEN_FO, `CreatedDate = ${YEAR}`] },
      { as: 'stuckTotal', from: 'FulfillmentOrder', aggs: ['COUNT(Id) c'], where: ['{location:FulfilledFromLocation}', OPEN_FO, STUCK, `CreatedDate = ${YEAR}`] },
      { as: 'stuck', from: 'FulfillmentOrder', fields: FO_ROW, where: ['{location:FulfilledFromLocation}', OPEN_FO, STUCK, `CreatedDate = ${YEAR}`], order: 'LastModifiedDate ASC', limit: 25 },
      { as: 'lateShipments', from: 'Shipment', fields: ['Id', 'ShipmentNumber', 'Status', 'Provider', 'ExpectedDeliveryDate', 'FulfillmentOrder.FulfillmentOrderNumber', 'OrderSummary.OrderNumber', 'CreatedDate'],
        where: ['{location:FulfillmentOrder.FulfilledFromLocation}', 'ExpectedDeliveryDate < TODAY', 'ActualDeliveryDate = null', { if: 'Status', then: "Status != 'Voided'" }, 'CreatedDate = LAST_N_DAYS:90'], order: 'ExpectedDeliveryDate ASC', limit: 25 },
      { as: 'exceptions', from: 'ProcessException', group: ['Category k'], aggs: ['COUNT(Id) c'],
        where: [OPEN_PE, 'CreatedDate = LAST_N_DAYS:90', 'AttachedToId IN (SELECT Id FROM FulfillmentOrder WHERE {location:FulfilledFromLocation})'], order: 'COUNT(Id) DESC' },
    ],
  },

  // Why routing sent a fulfillment order where it did (OM routing explanation, API 68+). The explanation needs the FO's Id.
  routing: {
    params: { fo: { type: 'fo', required: true } },
    queries: [
      { as: 'fulfillmentOrder', from: 'FulfillmentOrder', fields: [...FO_ROW, 'FulfilledToCity', 'FulfilledToState'], where: ['{fo}'], limit: 1 },
      { as: 'explanation', api: '/commerce/fulfillment/fulfillment-orders/{fo}/routing-explanation' },
    ],
  },

  'product-search': {
    params: { q: { type: 'text', required: true } },
    queries: [
      { as: 'products', from: 'Product2', fields: ['Id', 'Name', 'ProductCode', 'StockKeepingUnit', 'Family', 'IsActive'], match: ['Name', 'ProductCode', 'StockKeepingUnit'], order: 'Name', limit: 10 },
    ],
  },

  // One product: on hand by location, units shipped and still in flight, and where demand comes from. Live Omnichannel
  // Inventory availability is a POST, so it isn't a read: on the CLI, /api/inventory adds it.
  inventory: {
    params: { product: { type: 'product', required: true }, range: { type: 'range', default: '30d' } },
    queries: [
      { as: 'product', from: 'Product2', fields: ['Id', 'Name', 'ProductCode', 'StockKeepingUnit', 'IsActive'], where: ['{product}'], limit: 1 },
      { as: 'onHand', from: 'ProductItem', group: ['LocationId l', 'Location.Name loc'], aggs: ['SUM(QuantityOnHand) q'], where: ['{product:Product2}'], order: 'SUM(QuantityOnHand) DESC', limit: 200 },
      // Shipped: lines on fulfillment orders that were fulfilled or picked up, created in the range.
      { as: 'shipped', from: 'FulfillmentOrderLineItem', group: ['FulfillmentOrder.FulfilledFromLocationId l', 'FulfillmentOrder.FulfilledFromLocation.Name loc'], aggs: ['SUM(Quantity) q'],
        where: ['{product:Product2}', `FulfillmentOrder.Status IN ${FO_SHIPPED}`, 'FulfillmentOrder.CreatedDate = {range}', 'Quantity > 0'], order: 'SUM(Quantity) DESC', limit: 50 },
      { as: 'inFlight', from: 'FulfillmentOrderLineItem', group: ['FulfillmentOrder.FulfilledFromLocationId l', 'FulfillmentOrder.FulfilledFromLocation.Name loc', 'FulfillmentOrder.Status s'], aggs: ['SUM(Quantity) q'],
        where: ['{product:Product2}', `FulfillmentOrder.Status NOT IN ${FO_DONE}`, `FulfillmentOrder.CreatedDate = ${YEAR}`, 'Quantity > 0'], order: 'SUM(Quantity) DESC', limit: 50 },
      { as: 'demandByState', from: 'OrderItemSummary', group: ['OrderDeliveryGroupSummary.DeliverToState st'], aggs: ['SUM(QuantityOrdered) q'],
        where: ['{product:Product2}', 'OrderSummary.OrderedDate = {range}'], order: 'SUM(QuantityOrdered) DESC', limit: 60 },
      { as: 'ociLocations', from: 'Location', aggs: ['COUNT(Id) c'], where: ['ExternalReference != null', { if: 'ShouldSyncWithOci', then: 'ShouldSyncWithOci = true' }] },
    ],
  },

  // An order as OM Service Console's action panels see it, for the plugin's action skills: what each line can still take (cancel,
  // return, fulfil, reship), where it is (fulfillment and return orders, with their lines), the order's store and its type,
  // the reasons the org accepts, and the locations a fulfillment order can come from. The same fields as csOrder().
  'order-actions': {
    params: { order: { type: 'order', required: true } },
    queries: [
      { as: 'order', from: 'OrderSummary', fields: ['Id', 'OrderNumber', 'Status', 'OrderLifeCycleType', 'CurrencyIsoCode', 'OrderedDate', 'AccountId', 'Account.Name', 'SalesStoreId', 'SalesStore.Name',
        'SalesChannel.SalesChannelName', 'Pricebook2Id', 'GrandTotalAmount', 'TotalAdjustedProductAmount', 'TotalAdjustedDeliveryAmount', 'TotalTaxAmount'], where: ['{order}'], limit: 2 },
      // SalesStore is polymorphic: the store's own Type (B2C, B2B, B2CE) is on WebStore.
      { as: 'store', from: 'WebStore', fields: ['Id', 'Name', 'Type'], where: ['Id IN (SELECT SalesStoreId FROM OrderSummary WHERE {order})'], limit: 2 },
      { as: 'lines', from: 'OrderItemSummary', fields: ['Id', 'Name', 'ProductCode', 'Product2Id', 'Product2.Name', 'Product2.StockKeepingUnit', 'TypeCode', 'Type', 'Status', 'Quantity', 'QuantityOrdered',
        'QuantityCanceled', 'QuantityFulfilled', 'QuantityReturned', 'QuantityAvailableToCancel', 'QuantityAvailableToReturn', 'QuantityAllocated', 'QuantityAvailableToFulfill', 'QuantityAvailableToReship',
        'QuantityReturnInitiated', 'UnitPrice', 'ListPrice', 'TotalLineAmount', 'AdjustedLineAmount', 'TotalPrice', 'TotalTaxAmount', 'OrderDeliveryGroupSummaryId', 'PricebookEntryId', 'MainOrderItemSummaryId'],
        where: ['{order:OrderSummary}'], order: 'Id', limit: 500 },
      // A bundle's parts, how each is priced (in the bundle's price or its own) and how its quantity follows the bundle's: every
      // action takes a bundle whole, as csOrder()'s bundles do.
      { as: 'relationships', from: 'OrderItemSummaryRelationship', fields: ['Id', 'MainOrderItemSummaryId', 'AssociatedOrderItemSummaryId', 'MainOrderItemSummaryRole', 'AssociatedOrderItemSummaryRole',
        'AssociatedOrderItemSumPricing', 'AssociatedQuanScaleMethod'], where: ['{order:MainOrderSummary}'], limit: 1000 },
      { as: 'taxLines', from: 'OrderItemTaxLineItemSummary', fields: ['Id', 'OrderItemSummaryId', 'Name', 'Type', 'Rate', 'Amount', 'TaxEffectiveDate'], where: ['{order:OrderItemSummary.OrderSummary}'], limit: 1000 },
      { as: 'adjustments', from: 'OrderItemAdjustmentLineSummary', fields: ['Id', 'OrderItemSummaryId', 'Name', 'Amount', 'Description', 'AdjustmentCause.Name'], where: ['{order:OrderItemSummary.OrderSummary}'], limit: 1000 },
      { as: 'deliveryGroups', from: 'OrderDeliveryGroupSummary', fields: ['Id', 'DeliverToName', 'DeliverToStreet', 'DeliverToCity', 'DeliverToState', 'DeliverToPostalCode', 'DeliverToCountry',
        'EmailAddress', 'PhoneNumber', 'OrderDeliveryMethodId', 'OrderDeliveryMethod.Name', 'GrandTotalAmount'], where: ['{order:OrderSummary}'], limit: 20 },
      { as: 'payments', from: 'OrderPaymentSummary', fields: ['Id', 'Method', 'Type', 'Status', 'AuthorizationAmount', 'CapturedAmount', 'RefundedAmount', 'BalanceAmount'], where: ['{order:OrderSummary}'], limit: 10 },
      { as: 'changes', from: 'OrderItemSummaryChange', fields: ['Id', 'ChangeType', 'Reason', 'OrderItemSummaryId', 'ChangeOrderId', 'CreatedDate'],
        where: [{ if: 'OrderSummaryId', then: '{order:OrderSummary}', else: '{order:OrderItemSummary.OrderSummary}' }], order: 'CreatedDate DESC', limit: 20 },
      { as: 'fulfillmentOrders', from: 'FulfillmentOrder', fields: ['Id', 'FulfillmentOrderNumber', 'Status', 'StatusCategory', 'Type', 'FulfilledFromLocationId', 'FulfilledFromLocation.Name',
        'DeliveryMethodId', 'DeliveryMethod.Name', 'IsReship', 'CreatedDate'], where: ['{order:OrderSummary}'], order: 'CreatedDate', limit: 50 },
      { as: 'fulfillmentLines', from: 'FulfillmentOrderLineItem', fields: ['Id', 'FulfillmentOrderId', 'OrderItemSummaryId', 'Quantity', 'OriginalQuantity', 'RejectedQuantity', 'Type', 'TypeCode'],
        where: ['{order:FulfillmentOrder.OrderSummary}', TYPE_PRODUCT], limit: 500 },
      // So a reship can warn when a parcel may still be on its way. No tracking numbers: they lead to an address.
      { as: 'shipments', from: 'Shipment', fields: ['Id', 'ShipmentNumber', 'Status', 'Provider', 'FulfillmentOrderId', 'ExpectedDeliveryDate', 'ActualDeliveryDate', 'CreatedDate'],
        where: [{ if: 'OrderSummaryId', then: '{order:OrderSummary}', else: '{order:FulfillmentOrder.OrderSummary}' }], order: 'CreatedDate', limit: 50 },
      { as: 'returnOrders', from: 'ReturnOrder', fields: ['Id', 'ReturnOrderNumber', 'Status', 'LifeCycleType', 'CreatedDate'], where: ['{order:OrderSummary}'], order: 'CreatedDate DESC', limit: 20 },
      { as: 'returnLines', from: 'ReturnOrderLineItem', fields: ['Id', 'ReturnOrderId', 'OrderItemSummaryId', 'QuantityExpected', 'QuantityReceived', 'QuantityRejected', 'QuantityReturned',
        'ReasonForReturn', 'ReasonForRejection', 'Type', 'TypeCode', 'ChangeOrderItemId'], where: ['{order:ReturnOrder.OrderSummary}'], limit: 500 },
      { as: 'deliveryMethods', from: 'OrderDeliveryMethod', fields: ['Id', 'Name'], where: ['IsActive = true'], order: 'Name', limit: 50 },
      // Where a fulfillment order can come from: locations Omnichannel Inventory knows (they have an external reference).
      { as: 'locations', from: 'Location', fields: ['Id', 'Name', 'LocationType', 'ExternalReference', 'IsInventoryLocation'], where: ['ExternalReference != null'], order: 'Name', limit: 100 },
      ...REASONS,
    ],
  },

  conversations: {
    params: { account: { type: 'id', required: true } },
    queries: [
      talk('cases', 'Case', CASE_ROW, '{account:Account}', 'CreatedDate DESC', 20), talk('contactCases', 'Case', CASE_ROW, onContact('ContactId'), 'CreatedDate DESC', 20),
      talk('chats', 'LiveChatTranscript', CHAT_ROW, '{account:Account}'), talk('contactChats', 'LiveChatTranscript', CHAT_ROW, onContact('ContactId')),
      talk('caseChats', 'LiveChatTranscript', CHAT_ROW, onCase('CaseId')),
      talk('messaging', 'MessagingSession', MSG_ROW, '{account:EndUserAccount}'), talk('contactMessaging', 'MessagingSession', MSG_ROW, onContact('EndUserContactId')),
      talk('caseMessaging', 'MessagingSession', MSG_ROW, onCase('CaseId')),
      talk('emails', 'EmailMessage', EMAIL_ROW, '{account@RelatedToId}', 'MessageDate DESC', 10), talk('caseEmails', 'EmailMessage', EMAIL_ROW, onCase('ParentId'), 'MessageDate DESC', 10),
      talk('calls', 'VoiceCall', CALL_ROW, '{account@RelatedRecordId}'), talk('caseCalls', 'VoiceCall', CALL_ROW, onCase('RelatedRecordId')),
    ],
  },

  // A store's products as Order Management's own search finds them for this customer: names, SKUs and variation values, no
  // prices (a product's details have its price). `catalog` is the store's price books, for when the search index fails.
  'store-products': {
    params: { store: { type: 'store', required: true }, q: { type: 'text', required: true }, account: { type: 'id', required: true } },
    queries: [
      { as: 'search', api: '/commerce/order-management/webstores/{store}/products?searchTerm={q}&effectiveAccountId={account}&page=0&pageSize=12' },
      { as: 'catalog', from: 'PricebookEntry', fields: ['Id', 'Product2Id', 'Product2.Name', 'Product2.StockKeepingUnit', 'Product2.ProductCode', 'UnitPrice', 'Pricebook2Id', 'CurrencyIsoCode'],
        where: ['IsActive = true', 'Product2.IsActive = true', 'Pricebook2Id IN (SELECT Pricebook2Id FROM WebStorePricebook WHERE {store:WebStore} AND IsActive = true)'],
        match: ['Product2.Name', 'Product2.StockKeepingUnit', 'Product2.ProductCode'], order: 'Product2.Name', limit: 25 },
    ],
  },

  // One product's details in a store for this customer: its price, and every sibling variant with its price.
  'store-product': {
    params: { store: { type: 'store', required: true }, sku: { type: 'sku', required: true }, account: { type: 'id', required: true } },
    queries: [{ as: 'product', api: '/commerce/order-management/webstores/{store}/products/{sku}?effectiveAccountId={account}' }],
  },

  // Where a customer's order can go: saved addresses, the account's own, and the ship-tos of their last orders.
  'customer-addresses': {
    params: { account: { type: 'id', required: true } },
    queries: [
      { as: 'saved', from: 'ContactPointAddress', fields: ['Id', 'Name', 'Street', 'City', 'State', 'PostalCode', 'Country', 'AddressType', 'IsDefault'], where: ['{account@ParentId}'], limit: 20 },
      { as: 'account', from: 'Account', fields: ['Id', 'Name', 'FirstName', 'LastName', 'ShippingStreet', 'ShippingCity', 'ShippingState', 'ShippingPostalCode', 'ShippingCountry',
        'BillingStreet', 'BillingCity', 'BillingState', 'BillingPostalCode', 'BillingCountry'], where: ['{account}'], limit: 1 },
      { as: 'recentShipTos', from: 'OrderDeliveryGroupSummary', fields: ['Id', 'DeliverToName', 'DeliverToStreet', 'DeliverToCity', 'DeliverToState', 'DeliverToPostalCode', 'DeliverToCountry',
        'CreatedDate', 'OrderSummary.OrderNumber'], where: ['{account:OrderSummary.Account}'], order: 'CreatedDate DESC', limit: 10 },
    ],
  },

  // The stores a new order can use, and where this customer orders. New order offers a Lightning store while its site is Live
  // and it has a price book (B2B for business accounts only), and a B2CE store when the store took any order in the last 12
  // months or it's the customer's last store. Whether a B2CE store took any order lately is one lookup per store (om-core's
  // csStores), which a read can't do, so `ordered` and `lastOrder` confirm only the customer's own stores; OM Service Console checks the rest.
  stores: {
    params: { account: { type: 'id', required: true } },
    queries: [
      { as: 'stores', from: 'WebStore', fields: ['Id', 'Name', 'Type'], order: 'Name', limit: 50 },
      { as: 'priceBooks', from: 'WebStorePricebook', keys: ['WebStoreId'], fields: ['WebStoreId', 'Pricebook2Id', 'Pricebook2.Name', 'IsActive'], where: ['IsActive = true'], limit: 200 },
      { as: 'sites', from: 'WebStoreNetwork', keys: ['WebStoreId'], fields: ['WebStoreId', 'Network.Name', 'Network.Status'], limit: 100 },
      { as: 'ordered', from: 'OrderSummary', group: ['SalesStoreId s'], aggs: ['COUNT(Id) c', 'MAX(OrderedDate) lastAt'], where: ['{account:Account}', 'OrderedDate = LAST_N_DAYS:365'],
        order: 'MAX(OrderedDate) DESC', limit: 20 },
      { as: 'lastOrder', from: 'OrderSummary', fields: ['Id', 'OrderNumber', 'SalesStoreId', 'OrderedDate'], where: ['{account:Account}'], order: 'OrderedDate DESC', limit: 1 },
    ],
  },
};

/**
 * Check and normalize the parameters of a read.
 * @param {string} name A key of `READS`.
 * @param {Object<string, string>} [raw] Parameters as the caller gave them (Ids, search text, a range).
 * @returns {Object<string, {type: string}>} Each declared parameter, parsed; throws a 400 error for a missing required one or a malformed value.
 */
export function readParams(name, raw = {}) {
  const def = READS[name], out = {};
  for (const [k, spec] of Object.entries(def.params)) {
    const v = clean(raw[k] ?? '') || spec.default || '';
    if (!v) { if (spec.required) bad(`Missing ${k}`); continue; }
    out[k] = { type: spec.type, ...TYPES[spec.type](v) };
  }
  return out;
}

// ---------- building one query ----------
const fieldOf = (expr) => { let e = expr.trim(); for (let m; (m = e.match(/^\w+\((.*)\)$/));) e = m[1].trim(); return e; };
// 'COUNT(Id) c' → { expr: 'COUNT(Id)', alias: 'c' }; 'Status' → { expr: 'Status', alias: null }.
const splitAlias = (s) => { const m = s.match(/^(.*\S)\s+(\w+)$/); return m ? { expr: m[1], alias: m[2] } : { expr: s, alias: null }; };

// ctx: { params, schema, ground, preview }. schema is { fields: Set, rels: Set } for `from`, or null in preview (everything exists).
// ground is the relationship name found for q.ground, or null. Returns { soql, keys, alts, optionalFilters } or { skip: reason }.
/**
 * Build one query of a read as SOQL, keeping only the fields the org has.
 * @param {object} q A query from `READS[name].queries`.
 * @param {object} ctx
 * @param {object} ctx.params Output of `readParams`.
 * @param {{fields: Set<string>, rels: Set<string>}|null} [ctx.schema] The object's describe, or null in preview (everything exists).
 * @param {string|null} [ctx.ground] The relationship found for `q.ground`, or null.
 * @param {boolean} [ctx.preview] Write placeholders instead of values.
 * @returns {{soql: string, keys: string[], alts: Array<{field: string, then: string, else: string|null}>, optionalFilters: string[]}|{skip: string}} The query, or why it is skipped. `alts` is empty unless `preview` is set; `optionalFilters` are the clauses written `[AND …]`.
 */
export function buildQuery(q, { params, schema = null, ground = null, preview = false }) {
  const exists = (f) => {
    if (!schema) return true;
    const [head, ...rest] = f.split('.');
    return rest.length ? schema.rels.has(head) : schema.fields.has(head);
  };
  const keys = q.keys ?? (q.fields ? ['Id'] : []);
  const missingRef = Symbol('missing ground');
  // Expand tokens; null means the string uses an optional parameter the caller left out.
  const expand = (s) => {
    let absent = false, noRef = false;
    const out = s.replace(/\$refField\b/g, () => (preview ? '<ORDER_LOOKUP_FIELD>' : ground ? relField(ground) : ((noRef = true), '')))
      .replace(/\$ref\b/g, () => (preview ? '<ORDER_LOOKUP>' : ground || ((noRef = true), '')))
      .replace(/\{(\w+)(?:([:@])([\w.<>]*))?\}/g, (m, k, sep, path) => {
        if (k === 'range' || k === 'cur' || k === 'prior') {
          const p = params[k === 'range' ? 'range' : 'period'];
          if (preview) return k === 'range' ? '<RANGE>' : k === 'cur' ? '<CUR>' : '<PRIOR>';
          return k === 'range' ? p.lit : p[k];
        }
        if (k === 'q') {
          if (preview) return '<TEXT>';
          if (!params.q) return ((absent = true), '');
          return likeEsc(params.q.text);
        }
        if (!KEYS[k]) throw new Error(`Unknown token ${m}`);
        const p = params[k];
        if (!p && !preview) return ((absent = true), '');
        const { obj, key, ph } = KEYS[k];
        const viaId = preview ? !ph('') : !!p.id;
        const idv = preview ? ID_PH[k] : `'${esc(p.id ?? '')}'`;
        const cond = (prefix) => (preview ? ph(prefix) : key(p.key, prefix));
        if (sep === '@') return viaId ? `${path} = ${preview ? `'${idv}'` : idv}` : `${path} IN (SELECT Id FROM ${obj} WHERE ${cond('')})`;
        if (sep === ':') {
          const segs = path.split('.'), last = segs.pop(), pre = segs.length ? `${segs.join('.')}.` : '';
          return viaId ? `${pre}${relField(last)} = ${preview ? `'${idv}'` : idv}` : cond(`${path}.`);
        }
        return viaId ? `Id = ${preview ? `'${idv}'` : idv}` : cond('');
      });
    if (noRef) return missingRef;
    return absent ? null : out;
  };

  if (q.requires && schema && !q.requires.every((r) => schema.rels.has(r))) return { skip: `${q.from} has no ${q.requires.join(', ')}` };

  const alts = [], optionalFilters = [];
  const where = [];
  for (const w of q.where || []) {
    let s = w;
    if (typeof w === 'object') {
      if (preview) { alts.push({ field: w.if, then: expand(w.then), else: w.else ? expand(w.else) : null }); s = w.then; }
      else s = exists(w.if) ? w.then : w.else;
      if (!s) continue;
    }
    const x = expand(s);
    if (x === missingRef) return { skip: `${q.from} has no lookup to ${q.ground}` };
    if (x === null) continue;
    // In preview, an item that uses an optional parameter is shown in brackets: keep it only when the input is given.
    const optional = preview && Object.entries(q._params || {}).some(([k, spec]) => !spec.required && !['range', 'period'].includes(spec.type) && new RegExp(`\\{${k}[:@}]`).test(s));
    (optional ? optionalFilters : where).push(x);
  }
  if (q.match) {
    const tests = q.match.map((m) => (Array.isArray(m) ? m : [m, "LIKE '%{q}%'"])).filter(([f]) => exists(f)).map(([f, op]) => `${f} ${expand(op)}`);
    if (!tests.length) return { skip: `${q.from} has none of ${q.match.map((m) => [].concat(m)[0]).join(', ')}` };
    where.push(tests.length > 1 ? `(${tests.join(' OR ')})` : tests[0]);
  }

  let select, groupBy = [];
  if (q.group || q.aggs) {
    for (const g of q.group || []) {
      const opt = g.startsWith('?'), { expr, alias } = splitAlias(opt ? g.slice(1) : g);
      if (!exists(fieldOf(expr))) { if (opt) continue; return { skip: `${q.from} has no ${fieldOf(expr)}` }; }
      groupBy.push({ expr, alias, opt });
    }
    const aggs = (q.aggs || []).map(splitAlias).filter(({ expr }) => /^COUNT\(Id\)$/i.test(expr) || exists(fieldOf(expr)));
    select = [...groupBy.map(({ expr, alias }) => (alias ? `${expr} ${alias}` : expr)), ...aggs.map(({ expr, alias }) => (alias ? `${expr} ${alias}` : expr))];
    if (!aggs.length) return { skip: `${q.from}: nothing to count` };
  } else {
    const fields = [];
    for (const f of q.fields) {
      const x = expand(f);
      if (x === missingRef || x === null) continue;
      if (exists(x)) fields.push(x);
      else if (keys.includes(f)) return { skip: `${q.from} has no ${f}` };
    }
    if (keys.some((k) => !fields.includes(k))) return { skip: `${q.from} has no ${keys.find((k) => !fields.includes(k))}` };
    select = fields;
  }
  const order = (q.order || '').split(',').map((s) => s.trim()).filter(Boolean).filter((o) => exists(fieldOf(o.replace(/\s+(ASC|DESC)$/i, ''))));
  const optionalText = optionalFilters.map((f) => ` [AND ${f}]`).join('');
  const whereText = where.length ? ` WHERE ${where.join(' AND ')}${optionalText}` : optionalFilters.length ? ` [WHERE ${optionalFilters.join(' AND ')}]` : '';
  const soql = `SELECT ${select.join(', ')} FROM ${q.from}${whereText}`
    + `${groupBy.length ? ` GROUP BY ${groupBy.map((g) => g.expr).join(', ')}` : ''}${order.length ? ` ORDER BY ${order.join(', ')}` : ''}${q.limit ? ` LIMIT ${q.limit}` : ''}`;
  return { soql, keys: q.group ? groupBy.filter((g) => !g.opt).map((g) => fieldOf(g.expr)) : keys, alts, optionalFilters };
}

// ---------- running a read ----------
const strip = (v) => Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'attributes').map(([k, x]) => [k, strip(x)])) : v;
const pub = (params) => Object.fromEntries(Object.entries(params).map(([k, p]) => [k, p.v ?? p.id ?? p.key?.[0] ?? p.text]));

// describe(sobject) → { fields: Set, rels: Set, to: { rel: [sobject] } } or null when the org lacks it (om-core's describe).
// soql(text) → rows (an array, with a non-enumerable `capped` when Salesforce stopped at its row cap). api(path) → JSON (GET).
/**
 * Make the function that runs a read against an org, through the caller's own query and describe.
 * @param {object} io
 * @param {(sobject: string) => Promise<{fields: Set<string>, rels: Set<string>, to: Object<string, string[]>}|null>} io.describe Null when the org lacks the object.
 * @param {(text: string) => Promise<object[]>} io.soql Rows; carries a non-enumerable `capped` when Salesforce stopped at its row cap.
 * @param {(path: string) => Promise<object>} io.api GET returning JSON.
 * @param {() => string|null} [io.instanceUrl] The org's address, echoed in the answer.
 * @returns {(name: string, raw?: object, opts?: {only?: string[]|null}) => Promise<{read: string, params: object, instanceUrl: string|null, results: object}>} `read`; it throws a 404 error for an unknown read, and a 401 when the session is dead.
 */
export function createReader({ soql, describe, api, instanceUrl = () => null }) {
  async function runOne(q, params) {
    try {
      if (q.api) {
        // Every {token} in the path: an Id as it is, text (search terms, SKUs) URL-encoded, so it can't add a parameter.
        let missing = null;
        const path = q.api.replace(/\{(\w+)\}/g, (m, k) => {
          const p = params[k], text = Object.hasOwn(API_TEXT, k);
          if (text ? !p?.text : !p?.id) { missing ??= k; return ''; }
          return text ? encodeURIComponent(p.text) : p.id;
        });
        if (missing) return { skipped: `needs the ${API_NEEDS[missing] ?? `${missing} Id`}` };
        return { data: strip(await api(path)) };
      }
      const d = await describe(q.from);
      if (!d) return { skipped: q.from };
      const ground = q.ground ? Object.entries(d.to || {}).find(([, r]) => r.length === 1 && r[0] === q.ground)?.[0] ?? null : null;
      const b = buildQuery(q, { params, schema: d, ground });
      if (b.skip) return { skipped: b.skip };
      const rows = await soql(b.soql);
      return rows.capped ? { rows: strip(rows), capped: true } : { rows: strip(rows) };
    } catch (e) {
      if (e.code === 401 || e.httpStatus === 401) throw Object.assign(e, { code: 401 }); // a dead session is the caller's to report
      return { error: e.message };
    }
  }
  // read(name, raw params, { only: [query names] }) → { read, params, instanceUrl, results: { [as]: { rows, capped? } | { data } | { skipped } | { error } } }
  // `only` runs just those queries; naming one the read doesn't have is a programming error, so it throws.
  return async function read(name, raw = {}, { only = null } = {}) {
    if (!Object.hasOwn(READS, name)) throw Object.assign(new Error(`No read "${name}". Reads: ${Object.keys(READS).join(', ')}`), { code: 404 });
    const params = readParams(name, raw);
    const unknown = (only || []).filter((k) => !READS[name].queries.some((q) => q.as === k));
    if (unknown.length) throw new Error(`Read "${name}" has no ${unknown.join(', ')}`);
    const qs = READS[name].queries.filter((q) => !only || only.includes(q.as));
    const results = await Promise.all(qs.map((q) => runOne(q, params)));
    return { read: name, params: pub(params), instanceUrl: instanceUrl(), results: Object.fromEntries(qs.map((q, i) => [q.as, results[i]])) };
  };
}

// The queries of a read as literal text with <PLACEHOLDERS>, for the plugin to stamp into skills. Every field is assumed to
// exist; `optional` lists the fields a skill may drop on INVALID_FIELD, and `alts` the where clauses to fall back to.
/**
 * The queries of a read as literal text with placeholders, for skills.
 * @param {string} name A key of `READS`.
 * @returns {object[]} One entry per query: `{ as, api }` for a Connect GET, else `{ as, from, soql, keys, optional, alts, ground, requires }`.
 */
export function previewRead(name) {
  const def = READS[name];
  return def.queries.map((q) => {
    if (q.api) return { as: q.as, api: q.api.replace(/\{(\w+)\}/g, (m, k) => API_TEXT[k] ?? ID_PH[k]) };
    const b = buildQuery({ ...q, _params: def.params }, { params: {}, preview: true });
    const fields = q.fields ? q.fields.map((f) => f.replace(/\$refField\b/, '<ORDER_LOOKUP_FIELD>').replace(/\$ref\b/, '<ORDER_LOOKUP>')) : [];
    return { as: q.as, from: q.from, soql: b.soql, keys: b.keys, optional: fields.filter((f) => !b.keys.includes(f)), alts: b.alts,
      // Headless 360 has no describe: a skill finds the lookup with this query (the same rule as om-core's describe).
      ground: q.ground ? { object: q.from, to: q.ground,
        soql: `SELECT QualifiedApiName, RelationshipName, ReferenceTo FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${q.from}' AND DataType LIKE 'Lookup%'` } : null,
      requires: q.requires || [] };
  });
}

