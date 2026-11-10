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
// The rules both sides of OM Service Console apply, with nothing to import: the order policies (the panels show them, the write gate
// enforces them, and SomServicePolicy.cls repeats them in-org), a new customer's fields, and what Give a credit can put on a
// line, and what an order is missing or owed back. The read model (om-core.js) reads the facts they need; om-actions.js
// checks them before it sends anything.

// A new customer's records, as OM Service Console writes them (om-actions.js) and checks them for duplicates first (csDuplicates):
// the same fields both times, empty ones left out. A person account is its own contact; a business gets the caller as one.
export const CUSTOMER_FIELDS = {
  person: ['RecordTypeId', 'FirstName', 'LastName', 'PersonEmail', 'Phone', 'BillingStreet', 'BillingCity', 'BillingState', 'BillingPostalCode', 'BillingCountry'],
  business: ['RecordTypeId', 'Name', 'Phone', 'BillingStreet', 'BillingCity', 'BillingState', 'BillingPostalCode', 'BillingCountry'],
  contact: ['FirstName', 'LastName', 'Email', 'Phone'],
};
/**
 * The records a new customer is saved as.
 * @param {object} o What the Create a new customer form collected: `kind` ('person' or 'business'), names, `company`, `email`, `phone`, `recordTypeId` and an `address`.
 * @returns {{account: object, contact: object|null}} Fields to save, empty ones left out; `contact` is null for a person account.
 */
export function customerRecords(o) {
  const a = o?.address || {}, c = o?.contact || {}, keep = (r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && v !== ''));
  const bill = { BillingStreet: a.street, BillingCity: a.city, BillingState: a.state, BillingPostalCode: a.postalCode, BillingCountry: a.country };
  if (o?.kind === 'person') return { account: keep({ RecordTypeId: o.recordTypeId, FirstName: o.firstName, LastName: o.lastName, PersonEmail: o.email, Phone: o.phone, ...bill }), contact: null };
  return { account: keep({ RecordTypeId: o?.recordTypeId, Name: o?.company, Phone: o?.phone, ...bill }), contact: keep({ FirstName: c.firstName, LastName: c.lastName, Email: c.email, Phone: c.phone }) };
}
// A SKU the page names to make Salesforce products for (om-actions.js product.create, productFacts in om-core-commerce.js).
export const SKU_RE = /^[^/?\s]{1,80}$/;
// ---------- order policies ----------
// The org's return, cancel and adjustment policies (org/policies), one custom object per kind, and the lookup on
// SOM_Policy_Assignment__c that gives a store one of each. policyBook() reads them; these say which applies and what it allows.
// The same checks run in three places: the panels (before Preview), the write gate (om-actions.js, before anything is sent),
// and, inside Salesforce, the relay (SomServicePolicy.cls), which reads the policies itself.
export const POLICY_KINDS = {
  return: { object: 'SOM_Return_Policy__c', lookup: 'Return_Policy__c', fields: ['Return_Window_Days__c', 'Return_Window_Starts__c'], label: 'Return policy' },
  cancel: { object: 'SOM_Cancel_Policy__c', lookup: 'Cancel_Policy__c', fields: ['Cancel_Window_Hours__c'], label: 'Cancel policy' },
  adjust: { object: 'SOM_Adjustment_Policy__c', lookup: 'Adjustment_Policy__c', fields: ['Max_Percent__c', 'Max_Amount__c'], label: 'Adjustment policy' },
};
export const POLICY_FIELDS = ['Id', 'Name', 'Active__c', 'Default__c', 'Enforcement__c', 'Description__c'];
// The OM Service Console actions each kind governs: every way of sending something back, cancelling, or taking money off (a
// discount, a credit on what shipped, an edit's lower prices and discounts, and the discounts a swap's replacement brings).
// Keys are the panels and the gate's operations.
export const POLICY_ACTIONS = { return: 'return', rma: 'return', exchange: 'return', cancel: 'cancel', adjust: 'adjust', credit: 'adjust', edit: 'adjust', change: 'adjust', swap: 'adjust' };
// Edit (the gate's `change`) and Swap take items off the order when they lower a quantity, and that part is a cancel: they're
// held to the cancel policy as well. Past a Block cancel window an edit is refused; a swap goes ahead only when the agent
// overrides the policy on its panel (`overrideCancel: true` in the request), since the customer gets the replacement.
export const ALSO_CANCELS = { edit: { override: false }, change: { override: false }, swap: { override: true } };
const toCents = (v) => Math.round((Number(v) || 0) * 100) / 100;
const when = (v) => { const t = Date.parse(v || ''); return isFinite(t) ? t : null; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// When a line's cancel window starts: when it came onto the order. That's the order's date for the lines it was placed with,
// and the change's for a line Edit or Swap added (its CreatedDate, `createdAt`, more than five minutes after the order summary
// was made), so what a change added can come off again while it's new: Undo the change, say.
function cancelStart(l, d) {
  const placed = when(d.order?.OrderedDate || d.order?.CreatedDate), made = when(d.order?.CreatedDate || d.order?.OrderedDate), a = when(l?.createdAt);
  return a != null && made != null && a > made + 5 * 60e3 ? { t: a, how: 'added' } : { t: placed, how: 'placed' };
}
function cancelWindow(p, x, now) {
  const h = (now - x.t) / 36e5, ago = h < 48 ? plural(Math.floor(h), 'hour') : plural(Math.floor(h / 24), 'day');
  return x.how === 'added' ? `${x.l?.name || 'An item'} was added to the order ${ago} ago, and items can be cancelled up to ${plural(p.hours, 'hour')} after they're ordered.`
    : `This order was placed ${ago} ago, and items can be cancelled up to ${plural(p.hours, 'hour')} after it's placed.`;
}
// What an edit or a swap takes off the order: each product line it lowers (a swap, by what it swaps), less what the same change
// puts back of that product (a move to a new ship-to lowers the line and adds the product there, a bundle's parts included),
// which comes off the lines held longest first. [{ l, by, t, how }], the lines still lowered.
function takenOff(action, d, b) {
  const lines = d.lines || [], key = (productId, id) => productId || (id ? `line:${id}` : null), back = new Map(), down = [];
  const put = (k, q) => { if (k && q > 0) back.set(k, (back.get(k) || 0) + q); };
  for (const x of action === 'swap' ? [].concat(Array.isArray(b.lines) ? b.lines : b.line || []) : b.lines || []) {
    const l = lines.find((y) => y.id === x?.id), q = Number(x?.quantity);
    if (!l || !isFinite(q) || (l.type && l.type !== 'Product')) continue;
    const by = action === 'swap' ? q : (Number(l.qty) || 0) - q;
    if (by > 0) down.push({ l, by, ...cancelStart(l, d) }); else put(key(l.productId, l.id), -by);
  }
  for (const a of [].concat(b.add || [])) {
    if (!a || a.kind === 'charge') continue;
    const q = Number(a.quantity) || 0;
    put(key(a.productId), q);
    for (const x of Array.isArray(a.parts) ? a.parts : []) put(key(x?.productId), x?.scale === 'Constant' ? Number(x.quantity) || 0 : q * (Number(x?.quantity) || 0));
  }
  down.sort((x, y) => (x.t ?? 0) - (y.t ?? 0));
  for (const x of down) { const k = key(x.l.productId, x.l.id), n = Math.min(x.by, back.get(k) || 0); x.by -= n; if (n) back.set(k, back.get(k) - n); }
  return down.filter((x) => x.by > 0);
}
// The cancel policy on what an edit or a swap takes off (ALSO_CANCELS): null when it takes nothing off or there's no policy.
function cancelOf(action, d, b, now) {
  const p = d.policy?.cancel, off = p ? takenOff(action, d, b) : [];
  if (!off.length) return null;
  // The line furthest past its window names the breach; a bundle by its main line.
  const x = p.hours == null ? null : off.filter((y) => y.t != null && (now - y.t) / 36e5 > p.hours).sort((y, z) => (y.l.partOf ? 1 : 0) - (z.l.partOf ? 1 : 0) || y.t - z.t)[0];
  const breach = x ? `${action === 'swap' ? `Swapping ${x.l.name || 'an item'} cancels it.` : `Taking ${x.l.name || 'an item'} down by ${x.by} is a cancel.`} ${cancelWindow(p, x, now)}` : null;
  const block = !!breach && p.enforce === 'block', override = block && ALSO_CANCELS[action].override;
  if (override && b.overrideCancel === true) return { policy: p, kind: 'cancel', breach, block: false, overridden: true };
  return { policy: p, kind: 'cancel', breach, block, ...(override && { overridable: true }) };
}
// The policies a store's orders follow: its assignment's, kind by kind, else that kind's default (the first active one by
// name, when there are several). An assigned policy that's inactive or gone falls back to the default too.
/**
 * The policies a store's orders follow.
 * @param {object} book What `policyFacts` read: `available`, `assignments` and one list per kind.
 * @param {string} storeId The store's Id (15 or 18 characters).
 * @returns {Object<string, object|null>|null} By kind, the assigned policy (`via: 'store'`) or the default (`via: 'default'`); null when the org has no policies.
 */
export function policyFor(book, storeId) {
  if (!book?.available) return null;
  const same = (a, b) => !!a && !!b && a.slice(0, 15) === b.slice(0, 15);
  const assign = (book.assignments || []).find((a) => same(a.storeId, storeId)) || null;
  const out = {};
  for (const kind of Object.keys(POLICY_KINDS)) {
    const list = book[kind] || [], own = assign?.[kind] ? list.find((p) => same(p.id, assign[kind])) : null, p = own || list.find((x) => x.isDefault) || null;
    out[kind] = p ? { ...p, via: own ? 'store' : 'default' } : null;
  }
  return out;
}
// When each line reached the customer: the latest delivery date of its fulfillment orders' shipments (a line that came in
// several parcels counts from the last). With none recorded, the day the last of its fulfillment orders was fulfilled (closed
// as fulfilled, not cancelled or rejected). { [orderItemSummaryId]: { at, how: 'delivered' | 'fulfilled' } }.
/**
 * When each order line reached the customer.
 * @param {object[]} folis Fulfillment order line items (`FulfillmentOrderId`, `OrderItemSummaryId`).
 * @param {object[]} ships Shipments (`FulfillmentOrderId`, `ActualDeliveryDate`).
 * @param {object[]} [fos] Fulfillment orders (`Id`, `Status`, `StatusCategory`, `ClosedDate`).
 * @returns {Object<string, {at: string, how: 'delivered'|'fulfilled'}>} By order item summary Id.
 */
export function deliveriesOf(folis, ships, fos = []) {
  const later = (a, b) => (when(b) != null && (a == null || when(b) > when(a)) ? b : a);
  const done = (f) => (f.StatusCategory ? String(f.StatusCategory).toUpperCase() === 'CLOSED' : /^(fulfilled|picked up|closed)$/i.test(f.Status || ''));
  const byFo = new Map();
  for (const s of ships || []) { const x = byFo.get(s.FulfillmentOrderId) || {}; byFo.set(s.FulfillmentOrderId, { ...x, at: later(x.at, s.ActualDeliveryDate) }); }
  for (const f of fos || []) if (done(f)) { const x = byFo.get(f.Id) || {}; byFo.set(f.Id, { ...x, done: later(x.done, f.ClosedDate) }); }
  const by = new Map();
  for (const f of folis || []) {
    const x = byFo.get(f.FulfillmentOrderId);
    if (!x) continue;
    const y = by.get(f.OrderItemSummaryId) || {};
    by.set(f.OrderItemSummaryId, { at: later(y.at, x.at), done: later(y.done, x.done) });
  }
  return Object.fromEntries([...by].map(([id, x]) => [id, x.at ? { at: x.at, how: 'delivered' } : x.done ? { at: x.done, how: 'fulfilled' } : null]).filter(([, v]) => v));
}
// What agents have taken off the order since it was placed: adjustments made after the order summary was (its promotions came
// with it, in the same minute), and unit prices lowered from the original order's. Positive amounts.
/**
 * What agents have taken off an order since it was placed.
 * @param {object} o The order summary (`CreatedDate` or `OrderedDate`).
 * @param {object[]} lines Its lines, with `UnitPrice`, `Quantity` and `OriginalOrderItem.UnitPrice`.
 * @param {object[]} adjs Its adjustments (`CreatedDate`, `Amount`).
 * @returns {{total: number, adjustments: number, prices: number}} Positive amounts, in currency units.
 */
export function discountedSince(o, lines, adjs) {
  const made = when(o?.CreatedDate || o?.OrderedDate), after = made == null ? Infinity : made + 5 * 60e3;
  const adjustments = (adjs || []).filter((a) => (when(a.CreatedDate) ?? -Infinity) > after).reduce((s, a) => s + Math.max(0, -(Number(a.Amount) || 0)), 0);
  const prices = (lines || []).reduce((s, l) => {
    const was = Number(l.OriginalOrderItem?.UnitPrice), now = Number(l.UnitPrice), q = Number(l.Quantity ?? l.QuantityOrdered) || 0;
    return l.OriginalOrderItem?.UnitPrice != null && was > now + 0.005 ? s + (was - now) * q : s;
  }, 0);
  return { total: toCents(adjustments + prices), adjustments: toCents(adjustments), prices: toCents(prices) };
}
// What a change adds of a product the order already has, below that product's price: a move to a new ship-to (its line goes
// down and the product goes in there), the same product re-added anywhere, or simply more of it. Every add (to any ship-to;
// never a delivery charge) counts, and so does each of its bundle's parts that isn't one of that bundle's real catalog
// components (`d.components`: ProductRelatedComponent rows, { parentId, childId }; none known, every part counts), as the
// gate sends it: its quantity scaled by the add's (a Constant part's as it is), at its own price, else $0. A real component
// never counts, at any price. The cheapest adds go first. Each is held first to its product's lines the change takes down (to
// a lower quantity, 0 included), dearest first, at each line's unit price now, for as many units as they go down by, each
// line's units used once: they come off at that price, and a line's earlier discount is already in what was taken off
// before (discountedSince). What's left of it is held to the product's price on the order: the dearest of its lines with
// some left before the change, else of all of them (every one cancelled), each line at the higher of its unit price now and
// its original one (heldPrice), so an earlier edit's lower price doesn't lower what more of it is held to. Each unit counts
// (that price − its own) when positive. An edit's raised quantity counts like an add: a line in `b.lines` taken above its
// quantity now adds the difference, at the higher of its new unit price (else its own) and its price now (`lower` counts
// the difference on the whole line, so those units don't count twice), into the same pool, held first to taken-down units,
// then to that line's own held price, not the product's dearest line (raising a bundle raises its $0 part lines with it).
// A product the order doesn't have counts nothing. What stays on a line at a lower price is `lower`'s, not this. A swap takes
// its lines down by what it swaps (`line`, or a bundle's `lines`), as takenOff() reads it. A product is its Id's first 15
// characters (productKey); a blank one is no product, and matches nothing. SomServicePolicy.cls addedLower() applies the
// same rule in-org, reading the parts as the New lines they are there.
const productKey = (v) => (typeof v === 'string' && v.trim() ? v.slice(0, 15) : null);
const amountOr0 = (v) => { const n = Number(v ?? 0); return isFinite(n) ? n : 0; };
const heldPrice = (l) => { const now = Number(l.unitPrice) || 0, was = l.originalUnit == null || l.originalUnit === '' ? NaN : Number(l.originalUnit); return isFinite(was) && was > now ? was : now; };
function addedLower(action, d, b) {
  const products = (d.lines || []).filter((l) => productKey(l.productId) && (!l.type || l.type === 'Product')), down = new Map(), onOrder = new Map();
  const real = new Set((Array.isArray(d.components) ? d.components : []).map((c) => [productKey(c?.parentId), productKey(c?.childId)]).filter(([x, y]) => x && y).map(([x, y]) => `${x}|${y}`));
  for (const l of products) {
    const k = productKey(l.productId), p = heldPrice(l), x = onOrder.get(k) || { live: null, all: null };
    x.all = x.all == null ? p : Math.max(x.all, p);
    if ((Number(l.qty) || 0) > 0) x.live = x.live == null ? p : Math.max(x.live, p);
    onOrder.set(k, x);
  }
  for (const x of action === 'swap' ? [].concat(Array.isArray(b.lines) ? b.lines : b.line || []) : Array.isArray(b.lines) ? b.lines : []) {
    const l = products.find((y) => y.id === x?.id), q = Number(x?.quantity), by = !l || !isFinite(q) ? 0 : action === 'swap' ? q : (Number(l.qty) || 0) - q;
    if (!(by > 0)) continue;
    // Dearest first; lines at the same price in the request's order.
    const k = productKey(l.productId), ds = down.get(k) || [], price = Number(l.unitPrice) || 0, at = ds.findIndex((y) => y.price < price);
    ds.splice(at < 0 ? ds.length : at, 0, { price, left: by });
    down.set(k, ds);
  }
  // Every add and its parts but its real components, cheapest first (adds at the same price in the request's order, an edit's
  // raised quantities before them). A raise (an edit's line taken to a new quantity above its quantity now) adds that many
  // units at the higher of its new unit price (else its own) and its price now, and what's left of it is held to that
  // line's own held price (`own`).
  const adds = [];
  for (const x of action === 'swap' || !Array.isArray(b.lines) ? [] : b.lines) {
    const l = products.find((y) => y.id === x?.id), q = Number(x?.quantity), r = !l || !isFinite(q) ? 0 : q - (Number(l.qty) || 0);
    if (!(r > 0)) continue;
    const now = Number(l.unitPrice) || 0, set = x.unitPrice == null || x.unitPrice === '' || !isFinite(Number(x.unitPrice)) ? now : Number(x.unitPrice);
    adds.push({ k: productKey(l.productId), price: Math.max(set, now), want: r, own: heldPrice(l) });
  }
  for (const a of [].concat(b.add || [])) {
    if (!a || a.kind === 'charge') continue;
    const q = amountOr0(a.quantity), main = productKey(a.productId);
    adds.push({ k: main, price: amountOr0(a.unitPrice), want: q });
    for (const x of Array.isArray(a.parts) ? a.parts : []) {
      const k = productKey(x?.productId);
      if (main && k && real.has(`${main}|${k}`)) continue;
      adds.push({ k, price: amountOr0(x?.unitPrice), want: x?.scale === 'Constant' ? amountOr0(x.quantity) : q * amountOr0(x?.quantity) });
    }
  }
  adds.sort((x, y) => x.price - y.price);
  let off = 0;
  for (const a of adds) {
    if (!a.k || !onOrder.has(a.k)) continue;
    let want = a.want;
    for (const x of down.get(a.k) || []) {
      if (!(want > 0)) break;
      const u = Math.min(want, x.left);
      x.left -= u; want -= u;
      if (x.price > a.price + 0.005) off += (x.price - a.price) * u;
    }
    const p = onOrder.get(a.k), price = a.own ?? p.live ?? p.all;
    if (want > 0 && price > a.price + 0.005) off += (price - a.price) * want;
  }
  return off;
}
// How much an action takes off, from its request: a discount's lines, a credit's amount, an edit's lower prices and its
// discounts (new ones and existing ones made bigger, less those made smaller). The prices it lowers are the order's own,
// line or delivery charge, and what a change adds of a product the order already has below its price (addedLower).
function offBy(action, d, b) {
  const all = [...(d.lines || []), ...(d.charges || [])], L = (id) => all.find((l) => l.id === id);
  if (action === 'credit') return toCents(b.amount);
  if (action === 'adjust') return toCents((b.lines || []).reduce((s, x) => { const base = Number(L(x.id)?.adjusted ?? L(x.id)?.lineAmount) || 0;
    return s + (b.kind === 'percent' ? base * Math.min(Number(x.value) || 0, 100) / 100 : Number(x.value) || 0); }, 0));
  const lower = (b.lines || []).reduce((s, x) => { const l = L(x.id), was = Number(l?.unitPrice), now = Number(x.unitPrice);
    return l && isFinite(now) && was > now + 0.005 ? s + (was - now) * (Number(x.quantity) || 0) : s; }, 0) + addedLower(action, d, b);
  // Discounts made bigger or smaller and new ones (a swap's replacement brings its own, `add.adjustments`) count together, so a
  // discount a swap moves from the item to its replacement takes nothing more off.
  const was = (id) => -(Number(all.flatMap((l) => l.adjustments || []).find((y) => y.id === id)?.amount) || 0);
  const changed = (b.adjustments || []).reduce((s, x) => s + (Number(x.amount) || 0) - was(x.id), 0);
  const added = [...(b.newAdjustments || []), ...[].concat(b.add || []).flatMap((a) => a?.adjustments || [])].reduce((s, x) => s + Math.max(0, Number(x.amount) || 0), 0);
  return toCents(lower + Math.max(0, changed + added));
}
// What a policy says about an action on an order: null when no policy governs it, else the policy and, when the action goes
// past it, why (`breach`) and whether that stops it (`block`) or only warns. `b` is the action's request; without it only what
// doesn't depend on the inputs is checked (a cancel's window, and a return's when every returnable line is past it), which is
// what the action bar asks. Policies that exist but can't be read (`policyState: 'hidden'`) block what they would govern.
// An edit or a swap that takes items off is checked against the cancel policy too (ALSO_CANCELS), and the worse answer is
// the one given (the adjustment policy's on a tie). A swap past a Block cancel window comes back `overridable`, and with
// `overrideCancel` in the request, `overridden`: a breach that only warns.
/**
 * Check an action against the order's policy.
 * @param {string} action An order action key (see `POLICY_ACTIONS`).
 * @param {object} d The order's facts, with its `policy`, `policyState` and lines.
 * @param {object|null} [b] The request being checked (what it changes).
 * @param {object} [opts]
 * @param {number} [opts.now] Time to measure windows from, in ms.
 * @param {(v: number) => string} [opts.money] Formats an amount in a message.
 * @returns {{kind: string, policy: object|null, breach: string|null, block: boolean, overridable?: boolean, overridden?: boolean, hidden?: boolean}|null} Null when the action has no policy; `block` is true when the order may not go ahead.
 */
export function policyCheck(action, d, b = null, { now = Date.now(), money = (v) => `$${Number(v).toFixed(2)}` } = {}) {
  const kind = POLICY_ACTIONS[action];
  if (!kind || !d) return null;
  if (d.policyState === 'hidden') return { kind, policy: null, hidden: true, block: true,
    breach: 'The org has policies for this, but you can’t read them, so it can’t be checked. Ask an admin for the OM Policies Read permission set.' };
  if (d.policyState === 'error') return { kind, policy: null, hidden: true, block: true, breach: 'The order’s policies couldn’t be read, so this can’t be checked. Reload the order and try again.' };
  const v = kindCheck(kind, action, d, b, now, money), c = ALSO_CANCELS[action] && b ? cancelOf(action, d, b, now) : null;
  const rank = (x) => (!x ? 0 : x.block ? 3 : x.breach ? 2 : 1);
  return rank(c) > rank(v) ? c : v;
}
function kindCheck(kind, action, d, b, now, money) {
  const p = d.policy?.[kind];
  if (!p) return null;
  const days = (t) => Math.floor((now - t) / 864e5);
  const placed = when(d.order?.OrderedDate || d.order?.CreatedDate);
  let breach = null;
  if (kind === 'return' && p.days != null) {
    // Each line's window starts when it was delivered (else fulfilled, else ordered, when that's all there is), unless the policy counts from the order.
    const start = (l) => (p.from === 'order' || !l?.deliveredAt ? { t: placed, how: 'placed' } : { t: when(l.deliveredAt), how: l.delivery || 'delivered' });
    const ids = b ? (b.lines || []).map((x) => x.id) : (d.lines || []).filter((l) => l.returnable > 0).map((l) => l.id);
    const late = ids.map((id) => (d.lines || []).find((l) => l.id === id)).filter(Boolean).map((l) => ({ l, ...start(l) })).filter((x) => x.t != null && (now - x.t) / 864e5 > p.days);
    if (late.length && (b || late.length === ids.length)) {
      const x = late.sort((a, c) => a.t - c.t)[0], what = x.how === 'placed' ? `This order was placed ${plural(days(x.t), 'day')} ago` : `${x.l.name || 'An item'} was ${x.how} ${plural(days(x.t), 'day')} ago`;
      breach = `${what}, and returns are allowed for ${plural(p.days, 'day')} after ${p.from === 'order' ? 'the order' : 'delivery'}.`;
    }
  }
  if (kind === 'cancel' && p.hours != null) {
    // Each line's window starts when it came onto the order (cancelStart). Without the inputs, the order's window: Cancel leaves
    // the bar once the order is past it, unless a line Edit or Swap added is still inside its own and can be cancelled.
    const late = (x) => x.t != null && (now - x.t) / 36e5 > p.hours;
    let x;
    if (b) {
      const named = (b.lines || []).filter((y) => Number(y?.quantity) > 0).map((y) => (d.lines || []).find((l) => l.id === y.id)).filter(Boolean);
      x = (named.length ? named : [null]).map((l) => ({ l, ...cancelStart(l, d) })).filter(late).sort((y, z) => y.t - z.t)[0] || null;
    } else {
      const order = { l: null, t: placed, how: 'placed' }, fresh = (d.lines || []).some((l) => (Number(l.cancelable) || 0) > 0 && cancelStart(l, d).how === 'added' && !late(cancelStart(l, d)));
      x = late(order) && !fresh ? order : null;
    }
    if (x) breach = cancelWindow(p, x, now);
  }
  if (kind === 'adjust' && b) {
    const off = offBy(action, d, b), before = Number(d.discounted?.total) || 0, total = toCents(before + off);
    const base = (Number(d.order?.TotalAdjustedProductAmount) || (d.lines || []).reduce((s, l) => s + (Number(l.adjusted ?? l.lineAmount) || 0), 0)) + before;
    const share = base > 0 ? total / base * 100 : null, so = before > 0.005 ? `With ${money(before)} already taken off this order, this ${money(off)} makes ${money(total)}` : `This takes ${money(off)} off`;
    if (off > 0.005 && p.maxAmount != null && total > p.maxAmount + 0.005) breach = `${so}, and an order can get at most ${money(p.maxAmount)}.`;
    else if (off > 0.005 && p.maxPercent != null && share != null && share > p.maxPercent + 0.005) breach = `${so}, ${share.toFixed(1)}% of the order's products, and an order can get at most ${p.maxPercent}%.`;
  }
  return { policy: p, kind, breach, block: !!breach && p.enforce === 'block' };
}
// A policy in one line, as the action and the console show it.
/**
 * A policy in one line, as the action and the console show it.
 * @param {object|null} p A policy with its `kind`.
 * @param {object} [opts]
 * @param {(v: number) => string} [opts.money] Formats an amount.
 * @returns {string} The sentence; '' for no policy.
 */
export function policyRule(p, { money = (v) => `$${Number(v).toFixed(2)}` } = {}) {
  if (!p) return '';
  if (p.kind === 'return') return p.days == null ? 'Returns at any time' : `Returns within ${p.days} day${p.days === 1 ? '' : 's'} of ${p.from === 'order' ? 'the order' : 'delivery'}`;
  if (p.kind === 'cancel') return p.hours == null ? 'Cancellations until items ship' : `Cancellations within ${p.hours} hour${p.hours === 1 ? '' : 's'} of the order`;
  const caps = [p.maxPercent != null && `${p.maxPercent}% of the order's products`, p.maxAmount != null && money(p.maxAmount)].filter(Boolean);
  return caps.length ? `Discounts up to ${caps.join(' or ')} per order, all discounts together${caps.length > 1 ? ', whichever is less' : ''}` : 'Discounts of any size';
}

// What Give a credit can put on a line: its amount after discounts, less what came back, to the cent below. Only a line with
// nothing left to ship takes one (fulfilled = ordered − canceled, nothing allocated or still to allocate): Order Management
// splits an adjustment over a line's ordered, allocated and fulfilled quantities, and only the fulfilled part reaches the
// credit memo, so a partly shipped line would give less than it shows. `l` is a line as the order read shapes it.
/**
 * What Give a credit can put on one line.
 * @param {object} l A line as the order read shapes it (`ordered`, `canceled`, `fulfilled`, `returned`, `adjusted`, `lineAmount`).
 * @returns {number} The most that can be credited, in currency units; 0 for a line with items still to ship.
 */
export function creditRoom(l) {
  const net = l.ordered != null ? l.ordered - (l.canceled || 0) : l.qty || 0, shipped = l.fulfilled || 0;
  if (!(net > 0) || shipped < net || (l.toFulfill || 0) > 0 || (l.allocated != null && l.allocated > shipped)) return 0;
  const amount = l.adjusted ?? l.lineAmount ?? 0, out = net - Math.min(net, l.returned || 0);
  return Math.max(0, Math.floor(Math.round(amount * out / net * 1e6) / 1e4) / 100);
}

// ---------- what an order is missing or owed back ----------
// From one order's facts (moneyFacts in om-core-facts.js): its total, each payment summary's AvailableToCaptureAmount
// (`toCapture`, a hold not charged yet) and AvailableToRefundAmount (`toRefund`, charged and not given back: a payment credit
// is already left out of it), the part of its holds that has expired, its open credit memos and its open invoices, and, for an
// exchange order, what its return pays for (`exchange`: returnCredit below). The order page, the customer's list of orders
// and the write gate all read it (docs/gotchas/order-management.md says why).
// A change this recent may still have its refund on its way (Ensure Refunds is asynchronous: a demo org's land within minutes).
export const MONEY_SETTLE_MS = 15 * 60 * 1000;
// An invoice open this long while its money is still only a hold wasn't charged.
export const CHARGE_SETTLE_MS = 24 * 60 * 60 * 1000;
// What an exchange order's return pays for. Placing the exchange sets the return's value aside on the original order's
// payments, up to what the exchange order cost (the smaller of the return order's GrandTotalAmount and the cart's), and Ensure
// Funds applies it when the exchange order is invoiced, whether or not the return has come back. Order Management still counts
// it as owed on the exchange order, so it's left out of what's missing. A canceled return pays for nothing.
//   ro: { total, status, category }, placed: the exchange order's total when it was placed (its OriginalOrder's)
/**
 * What an exchange order's return pays for.
 * @param {{total: number|string, status: string, category: string}|null} ro The return order.
 * @param {number|string|null} [placed] The exchange order's total when it was placed; caps the credit.
 * @returns {number} Currency units; 0 for a canceled or missing return.
 */
export function returnCredit(ro, placed) {
  if (!ro || [ro.status, ro.category].some((s) => /^cancel/i.test(s || ''))) return 0;
  const cap = placed == null || placed === '' || !isFinite(Number(placed)) ? Infinity : Number(placed);
  return Math.max(0, toCents(Math.min(Number(ro.total) || 0, cap)));
}
/**
 * What an order is missing or owed back.
 * @param {object} f One order's money facts: `managed`, `total`, `payments`, `memos`, `invoices`, `changedAt` and, for an exchange, `exchange`.
 * @param {object} [opts]
 * @param {number} [opts.now] Time to measure settling windows from, in ms.
 * @returns {object|null} `{ paid, held, total, missing, memo, excess, refunding, uncollected, flags, methods, exchange }`, amounts in currency units; null when the order's money isn't managed here.
 */
export function moneyState(f, { now = Date.now() } = {}) {
  if (!f?.managed || !(f.payments?.length || f.exchange)) return null;
  const sum = (xs, v) => toCents(xs.reduce((s, x) => s + v(x), 0)), above = (v) => v > 0.005;
  const total = toCents(f.total), paid = sum(f.payments || [], (p) => Number(p.toRefund) || 0);
  const held = sum(f.payments || [], (p) => Math.max(0, (Number(p.toCapture) || 0) - (Number(p.expired) || 0)));
  const fromReturn = toCents(Math.max(0, Number(f.exchange?.value) || 0));
  const short = toCents(total - paid - held - fromReturn), missing = above(short) ? short : 0;
  const memo = sum((f.memos || []).filter((m) => above(m.balance)), (m) => Number(m.balance));
  const over = toCents(paid - total - memo), changed = when(f.changedAt);
  const refunding = above(over) && changed != null && now - changed < MONEY_SETTLE_MS;
  const excess = above(over) && !refunding ? over : 0;
  // An invoice's Balance alone doesn't say it wasn't charged (a captured order can keep its invoices' balance), so what was
  // captured comes off it, only what's still a hold counts, and only once the charge had a day to happen.
  const old = missing ? [] : (f.invoices || []).filter((v) => above(v.balance) && when(v.at) != null && now - when(v.at) >= CHARGE_SETTLE_MS);
  const captured = sum(f.payments || [], (p) => Number(p.captured) || 0);
  const notCharged = Math.min(Math.max(0, toCents(sum(old, (v) => Number(v.balance)) - captured)), held);
  const uncollected = above(notCharged) ? old.map((v) => ({ id: v.id, number: v.number ?? null, balance: toCents(v.balance) })) : [];
  const flags = [['missing', missing], ['uncollected', uncollected.length ? toCents(notCharged) : 0], ['memo', above(memo) ? memo : 0], ['excess', excess], ['refunding', refunding ? over : 0]]
    .filter(([, amount]) => amount).map(([kind, amount]) => ({ kind, amount }));
  // Each payment summary's part of it, for What they paid, and the return that pays for an exchange order.
  const methods = (f.payments || []).map((p) => ({ id: p.id ?? null, label: p.label ?? null, paid: toCents(Number(p.toRefund) || 0), held: toCents(Math.max(0, (Number(p.toCapture) || 0) - (Number(p.expired) || 0))) }));
  const exchange = f.exchange ? { returnOrderId: f.exchange.returnOrderId ?? null, number: f.exchange.number ?? null, covers: fromReturn } : null;
  return { paid, held, total, missing, memo, excess, refunding, uncollected, flags, methods, exchange };
}

// ---------- the record pages' statuses ----------
// What a record page may set a status to, as the write gate (om-actions.js recordWrite) and the page's pickers
// (service/record-actions.js) both read it: a status is a short plain word or phrase; a fulfillment order's never one of the
// warehouse's own steps (fulfilled, shipped, closed) or a cancel, which goes through cancel-item so the org's transfer-back
// automation runs; a return order's never Pending Exchange (an exchange's own) or Closed (it closes by being received).
export const STATUS_RE = /^[A-Za-z][\w .'()/-]{0,39}$/;
export const WAREHOUSE_STATUS = /fulfil|clos|cancel|reject|ship|deliver|invoic/i;
export const RETURN_NOT_SET = /^(pending exchange|closed)$/i;

// A return order's lines still to come back, as the order read shapes them: not done, an order product (not its delivery
// charge), with some expected. Receive return (service/returns.js) and Agentforce's fill (service/agent-fill.js) both go by it.
/**
 * A return order's lines still to come back.
 * @param {{lines?: object[]}} [ro] The return order as the order read shapes it.
 * @returns {object[]} Lines not done, for an order product, with some quantity expected.
 */
export const dueLines = (ro) => (ro?.lines || []).filter((x) => !x.done && x.orderItemSummaryId && !/delivery/i.test(x.type || '') && x.expected > 0);
