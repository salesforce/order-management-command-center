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
// Bundles: an order's lines grouped the way Order Management links them (OrderItemSummaryRelationship, and each part's
// MainOrderItemSummaryId), and the arithmetic every action shares. A bundle, a set and an add-on are all kept together: the
// main line is the item, its associated lines are its parts, and no action takes a part on its own. Order Management doesn't
// hold a bundle together itself (core 264: cancel, adjust, return and exchange take each line as it comes), so the page builds
// whole-bundle requests from here and the write gate (om-actions.js) refuses any other. This file imports nothing; the
// browser and Node both load it, and so does the in-org bundle.

export const MAIN_ROLES = ['Bundle', 'Set', 'AddOn'];
// Which part roles go with which main role, as Order Management allows them.
export const ROLE_PAIRS = { Bundle: ['BundleComponent', 'ClassificationComponent'], Set: ['SetComponent'], AddOn: ['AddOnComponent'] };
// What each action takes a bundle by: what's left to cancel, to return, to send to a warehouse, to reship.
export const FIELDS = ['cancelable', 'returnable', 'toFulfill', 'toReship'];
// The fields whose shortfall means a part has already gone out (the rest mean it hasn't yet).
const GONE_OUT = new Set(['cancelable', 'toFulfill']);
const BROKEN = 'Its parts don’t come in whole numbers per bundle, so it can’t be changed here.';

const num = (v) => Number(v) || 0;
const amountOf = (l) => num(l.adjusted ?? l.lineAmount);

// The bundles among an order's lines. lines: the order's product lines, each with `partOf` (its MainOrderItemSummaryId, or
// null); rels: the relationship rows ({ main, part, mainRole, partRole, pricing, scale }). A part without a row is a
// Proportional bundle component, included in the bundle's price. A line whose main isn't among the lines stays a line.
// Proportional parts come `per` bundle: their ordered quantity over the top-level main line's (ordered, so an earlier cancel
// doesn't change it). Nested parts hang under their own main line and scale from the top-level one.
export function bundlesOf(lines, rels = []) {
  const byId = new Map(lines.map((l) => [l.id, l])), rel = new Map(rels.map((r) => [r.part, r])), kids = new Map();
  const mainOf = (l) => (l.partOf && l.partOf !== l.id && byId.has(l.partOf) ? l.partOf : null);
  for (const l of lines) { const m = mainOf(l); if (m) { const k = kids.get(m); if (k) k.push(l); else kids.set(m, [l]); } }
  const out = [];
  for (const m of lines) {
    if (mainOf(m) || !kids.has(m.id)) continue;
    const parts = [], seen = new Set([m.id]);
    const walk = (id, depth) => {
      for (const p of kids.get(id) || []) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const r = rel.get(p.id) || {}, scale = r.scale === 'Constant' ? 'Constant' : 'Proportional';
        parts.push({ id: p.id, name: p.name, depth, per: scale === 'Constant' ? null : num(p.ordered) / num(m.ordered), scale,
          included: r.pricing !== 'NotIncludedInBundlePrice', role: r.partRole || 'BundleComponent' });
        walk(p.id, depth + 1);
      }
    };
    walk(m.id, 1);
    const own = rels.filter((r) => r.main === m.id).map((r) => r.mainRole).filter(Boolean);
    const b = { id: m.id, role: own.includes('Bundle') || !own.length ? 'Bundle' : own[0], name: m.name, lines: [m.id, ...parts.map((p) => p.id)], parts,
      priced: [m, ...parts.map((p) => byId.get(p.id))].filter((l) => amountOf(l) > 0).map((l) => l.id),
      editable: [m.id, ...parts.map((p) => p.id)].every((id) => !!byId.get(id).editable), why: {},
      broken: !(num(m.ordered) > 0) || parts.some((p) => p.per !== null && !(Number.isInteger(p.per) && p.per > 0)) ? BROKEN : null };
    for (const f of FIELDS) Object.assign(b, counted(b, byId, f));
    out.push(b);
  }
  return out;
}

// How many whole bundles an action can take: the main line's own, capped by every Proportional part's floor(available ÷ per).
// Constant parts don't cap it. `why` says what's short or left over when parts don't make whole bundles.
function counted(b, byId, f) {
  if (b.broken) { b.why[f] = b.broken; return { [f]: 0 }; }
  const m = byId.get(b.id), prop = b.parts.filter((p) => p.per !== null);
  const cap = (p) => Math.floor(num(byId.get(p.id)[f]) / p.per);
  const n = Math.max(0, Math.min(num(m[f]), ...prop.map(cap)));
  const avail = (id) => num(byId.get(id)[f]);
  let why = null;
  if (n < num(m[f]) || (n === 0 && b.lines.some((id) => avail(id) > 0))) {
    const short = prop.find((p) => cap(p) === n) || { id: m.id, name: m.name };
    const other = b.parts.find((p) => p.id !== short.id && avail(p.id) > 0) || (short.id !== m.id ? { name: m.name } : null);
    why = GONE_OUT.has(f) ? `Its ${short.name} has shipped${other ? ` and its ${other.name} hasn’t` : ''}.` : `Its ${short.name} hasn’t shipped yet.`;
  } else {
    const over = prop.find((p) => avail(p.id) > n * p.per);
    if (over) why = `${avail(over.id) - n * over.per} ${over.name} can’t go on its own: it isn’t a whole ${b.name}.`;
  }
  b.why[f] = why;
  return { [f]: n };
}

// Line Id → the Id of the bundle (its top-level main line) it belongs to.
export function bundleIndex(bundles) {
  const m = new Map();
  for (const b of bundles) for (const id of b.lines) m.set(id, b.id);
  return m;
}

// k of a bundle as lines: the main line k, each Proportional part k × per, and each Constant part all it has left for the
// action, but only with the last of the bundle (k is everything the main line has left for it). byId: the lines by Id.
export function expandBundle(b, byId, k, field) {
  const last = k === num(byId.get(b.id)?.[field]);
  return [{ id: b.id, quantity: k }, ...b.parts.map((p) => ({ id: p.id, quantity: p.per !== null ? k * p.per : last ? num(byId.get(p.id)?.[field]) : 0 }))]
    .filter((x) => x.quantity > 0);
}

// A discount on a bundle, over its priced lines (those with an amount: Order Management's stored amounts, not the pricing
// flag). A percent goes on each; an amount is shared out by their amounts to the cent: each line's share rounded down, then
// the leftover cents to the largest remainders (the larger line first on a tie), so every share is within a cent of its
// line's, as the gate checks.
export function spreadOver(b, byId, value, kind) {
  const lines = b.priced.map((id) => byId.get(id));
  if (kind === 'percent') return lines.map((l) => ({ id: l.id, value }));
  const total = lines.reduce((s, l) => s + Math.round(amountOf(l) * 100), 0), want = Math.round(value * 100);
  if (!total) return [];
  const exact = lines.map((l) => (want * Math.round(amountOf(l) * 100)) / total), shares = exact.map((x) => Math.floor(x + 1e-9));
  let left = want - shares.reduce((s, x) => s + x, 0);
  const order = lines.map((l, i) => i).sort((a, c) => exact[c] - shares[c] - (exact[a] - shares[a]) || amountOf(lines[c]) - amountOf(lines[a]));
  for (const i of order) { if (left <= 0) break; shares[i] += 1; left -= 1; }
  return lines.map((l, i) => ({ id: l.id, value: shares[i] / 100 }));
}

// When a bundle reached the customer: when its last part did (the kit was whole then), or null while any part hasn't.
// Every line of the bundle maps to it, so a return window counts from the same day for all of them.
export function latestDelivery(bundles, byId) {
  const m = new Map();
  for (const b of bundles) {
    const at = b.lines.map((id) => byId.get(id)?.deliveredAt ?? null);
    const last = at.some((x) => !x) ? null : at.reduce((a, x) => (x > a ? x : a));
    for (const id of b.lines) m.set(id, last);
  }
  return m;
}

// ---------- the write gate's check ----------
// Every operation that takes order lines. Each is checked against the order's bundles before anything is sent.
export const BUNDLE_OPS = new Set(['cancel', 'adjust', 'change', 'swap', 'return', 'rma', 'receive', 'exchange', 'focancel', 'fomove', 'focreate', 'reship', 'credit', 'roexpected']);
const SPLIT = 'This bundle is split across fulfillment orders: change it from the order.';

// Why a request splits a bundle, or null. facts (bundleFacts in om-core-facts.js): { bundles, lines: { [id]: { qty, amount } },
// foLines: { [fulfillment order line Id]: order line Id }, returnLines: { [return order line Id]: order line Id },
// returnExpected: { [return order line Id]: its expected quantity } }. A fulfillment or return order line is mapped through
// the facts; the order line the body gives with it (which the handlers act on) must be that one, and what a return order line
// expects is the record's, not the body's.
export function bundleCheck(op, facts, body) {
  if (!BUNDLE_OPS.has(op) || !facts?.bundles?.length) return null;
  const lines = Array.isArray(body?.lines) ? body.lines : body?.line ? [body.line] : [];
  const of = facts.bundles, index = bundleIndex(of);
  const sum = (pairs) => pairs.reduce((m, [id, q]) => m.set(id, (m.get(id) || 0) + (Number(q) || 0)), new Map());
  const through = (map, what) => (l) => { const id = map?.[l.id];
    if (!id) throw `a ${what} line that isn’t this order’s`;
    if (l.orderItemSummaryId != null && l.orderItemSummaryId !== id) throw `a ${what} line that isn’t for that order line`;
    return id; };
  try {
    if (op === 'adjust' || op === 'credit') return money(op, facts, index, lines, body);
    if (op === 'change') return change(facts, index, lines, body);
    if (op === 'focancel') return whole(of, index, facts, sum(lines.map((l) => [through(facts.foLines, 'fulfillment order')(l), l.quantity])));
    if (op === 'fomove') { const to = through(facts.foLines, 'fulfillment order');
      return whole(of, index, facts, sum(lines.map((l) => [to(l), l.quantity]))) || together(of, index, lines.map((l) => [to(l), l.locationId || body.locationId])); }
    if (op === 'focreate' || op === 'reship') return whole(of, index, facts, sum(lines.map((l) => [l.id, l.quantity]))) || together(of, index, lines.map((l) => [l.id, l.locationId || body.locationId]));
    if (op === 'receive') {
      const to = through(facts.returnLines, 'return order');
      return whole(of, index, facts, sum(lines.map((l) => [to(l), l.received])))
        || whole(of, index, facts, sum(lines.map((l) => [to(l), l.rejected ?? 0])), { needMain: false });
    }
    if (op === 'roexpected') return whole(of, index, facts, sum(lines.map((l) => [through(facts.returnLines, 'return order')(l), Number(facts.returnExpected?.[l.id] ?? l.from) - Number(l.quantity)])));
    return whole(of, index, facts, sum(lines.map((l) => [l.id, l.quantity])));
  } catch (e) { if (typeof e === 'string') return e; throw e; }
}

// Each bundle any of these quantities touch goes whole: its main line k, each Proportional part k × per, and a Constant part
// at most what it has. needMain false: a line of the bundle being there is enough, and the main line's absence is k = 0
// (what's rejected on a return order, which the received quantities already hold together).
function whole(bundles, index, facts, asked, { needMain = true } = {}) {
  for (const b of touched(bundles, index, asked)) {
    if (needMain && !asked.has(b.id)) return `${b.name}: its main line is missing`;
    const k = asked.get(b.id) || 0;
    for (const p of b.parts) {
      const q = asked.get(p.id) || 0;
      if (p.per !== null && q !== k * p.per) return `${b.name}: its ${p.name} goes in ${k * p.per}`;
      if (p.per === null && facts.lines?.[p.id] && q > facts.lines[p.id].qty) return `${b.name}: its ${p.name} goes in at most ${facts.lines[p.id].qty}`;
    }
  }
  return null;
}
// A fulfillment order takes a bundle's lines together, so all of a bundle goes to one location (one fulfillment group, or
// one reship).
// placed: [[order line Id, location Id]].
function together(bundles, index, placed) {
  const at = new Map();
  for (const [id, loc] of placed) {
    const b = index.get(id);
    if (!b) continue;
    if (at.has(b) && at.get(b) !== loc) return `${bundles.find((x) => x.id === b).name}: all of it ships from one location`;
    at.set(b, loc);
  }
  return null;
}
const touched = (bundles, index, asked) => { const ids = new Set([...asked.keys()].filter((id) => (asked.get(id) || 0) > 0).map((id) => index.get(id)).filter(Boolean)); return bundles.filter((b) => ids.has(b.id)); };

// A change order: a bundle whose quantity changes changes whole (its Constant parts stay, and go to 0 with it). A price on
// its own (the quantity as it is) is fine. A new discount or tax line never goes on a bundle's unpriced line, and a bundle
// with several priced lines takes a discount on all of them (Adjust price shares it), never a new one on one line.
function change(facts, index, lines, body) {
  for (const [list, what] of [[body?.newAdjustments, 'discount'], [body?.newTaxes, 'tax']]) {
    for (const a of Array.isArray(list) ? list : []) {
      const b = facts.bundles.find((x) => x.id === index.get(a?.lineId));
      if (!b) continue;
      if (!b.priced.includes(a.lineId)) return `${b.name}: its ${nameIn(b, a.lineId)} has no price to ${what}`;
      if (what === 'discount' && b.priced.length > 1) return `${b.name}: a discount goes on all its priced lines, so give it with Adjust price`;
    }
  }
  const asked = new Map(lines.filter((l) => l.quantity != null).map((l) => [l.id, Number(l.quantity)]));
  const moved = new Set([...asked].filter(([id, q]) => index.has(id) && facts.lines?.[id] && q !== facts.lines[id].qty).map(([id]) => index.get(id)));
  for (const b of facts.bundles.filter((x) => moved.has(x.id))) {
    if (!asked.has(b.id)) return `${b.name}: its main line is missing`;
    const k = asked.get(b.id);
    for (const p of b.parts) {
      const now = facts.lines?.[p.id]?.qty ?? 0, want = p.per !== null ? k * p.per : k === 0 ? 0 : now;
      if ((asked.has(p.id) ? asked.get(p.id) : now) !== want) return `${b.name}: its ${p.name} goes in ${want}`;
    }
  }
  return null;
}

// A discount or a credit on a bundle goes on every line of it that has a price, and on nothing else of it: a percent the same
// on each, an amount shared by their amounts (a cent's leeway each). A credit's lines are shared out by the gate itself.
function money(op, facts, index, lines, body) {
  const ids = new Set(lines.map((l) => l.id)), value = new Map(lines.map((l) => [l.id, Number(l.value)]));
  for (const b of facts.bundles.filter((x) => x.lines.some((id) => ids.has(id)))) {
    const free = b.lines.find((id) => ids.has(id) && !b.priced.includes(id));
    if (free) return `${b.name}: its ${nameIn(b, free)} has no price to discount`;
    const left = b.priced.find((id) => !ids.has(id));
    if (left) return `${b.name}: the ${op === 'credit' ? 'credit' : 'discount'} goes on its ${nameIn(b, left)} too`;
    if (op === 'credit') continue;
    const vs = b.priced.map((id) => value.get(id));
    if (body?.kind === 'percent') { if (vs.some((v) => Math.abs(v - vs[0]) > 1e-9)) return `${b.name}: every priced line takes the same percent`; continue; }
    const total = b.priced.reduce((s, id) => s + (facts.lines?.[id]?.amount || 0), 0), all = vs.reduce((s, v) => s + v, 0);
    if (!(total > 0) || b.priced.some((id, i) => Math.abs(vs[i] - (all * (facts.lines[id].amount || 0)) / total) > 0.01 + 1e-9)) return `${b.name}: the discount is shared by the lines’ amounts`;
  }
  return null;
}
const nameIn = (b, id) => (id === b.id ? b.name : b.parts.find((p) => p.id === id)?.name || 'line');

// ---------- a fulfillment order's bundles ----------
// A fulfillment order's lines ({ id, orderItemSummaryId, qty }) as whole bundles: how many of each it holds. One whose main
// line isn't on it (Order Management split the bundle over two fulfillment orders, the main line at 0 on one) or that lacks
// a Proportional part is shown with the reason and isn't changed from the fulfillment order.
export function groupFoLines(foLines, bundles) {
  const index = bundleIndex(bundles), byOis = new Map();
  for (const l of foLines) { const a = byOis.get(l.orderItemSummaryId); if (a) a.push(l); else byOis.set(l.orderItemSummaryId, [l]); }
  const qty = (id) => (byOis.get(id) || []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const units = bundles.filter((b) => b.lines.some((id) => byOis.has(id))).map((b) => {
    const lines = b.lines.flatMap((id) => (byOis.get(id) || []).map((l) => l.id));
    const split = !(qty(b.id) > 0) || b.parts.some((p) => p.per !== null && !byOis.has(p.id));
    const n = split ? 0 : Math.min(qty(b.id), ...b.parts.filter((p) => p.per !== null).map((p) => Math.floor(qty(p.id) / p.per)));
    return { bundleId: b.id, lines, units: n, split, why: split ? SPLIT : null };
  });
  return { units, free: foLines.filter((l) => !index.has(l.orderItemSummaryId)).map((l) => l.id) };
}

// ---------- selling one ----------
// Why a bundle product can't be ordered somewhere: a B2C Commerce cart takes plain SKUs and quantities; Order on Behalf Of
// can't configure a bundle; sets aren't sold one by one here; and a change order adds a bundle only from API 68.
export const BUNDLE_WHY = {
  b2ce: 'Bundles can’t be ordered in a B2C Commerce store', configurable: 'Order on Behalf Of can’t configure this bundle',
  set: 'A set can’t be ordered here', api: 'Adding a bundle needs API 68 or later',
};
// A product search hit's bundle mark, from its Product2 Type and ConfigureDuringSale: { bundle, why }, or {} for a plain product.
export function bundleMark(type, configure = null, b2ce = false) {
  if (type !== 'Bundle' && type !== 'Set') return {};
  if (b2ce) return { bundle: 'unsupported', why: BUNDLE_WHY.b2ce };
  if (type === 'Set') return { bundle: 'set', why: BUNDLE_WHY.set };
  return configure === 'Allowed' ? { bundle: 'configurable', why: BUNDLE_WHY.configurable } : { bundle: 'ok', why: null };
}
