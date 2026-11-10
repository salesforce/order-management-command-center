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
// What an order is missing or owed back (moneyState in om-rules.js), from the facts the read model gathers: its payment
// summaries, its open credit memos and its open invoices. The rows are a demo org's, as the spec's table has them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneyState, returnCredit, MONEY_SETTLE_MS, CHARGE_SETTLE_MS } from "../../../public/shared/data/om-rules.js";

const NOW = Date.parse('2026-10-26T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const HOUR = 3600e3, DAY = 24 * HOUR;
const pay = (toCapture, toRefund, expired = 0) => ({ id: 'OPS1', methodId: 'PM1', label: 'Visa - 4242', toCapture, toRefund, expired });
const facts = (total, payments, more = {}) => ({ total, managed: true, changedAt: ago(DAY), payments, memos: [], invoices: [], ...more });
const flags = (f) => moneyState(f, { now: NOW })?.flags;

test('the defaults are 15 minutes for a refund on its way and a day for a charge', () => {
  assert.equal(MONEY_SETTLE_MS, 15 * 60 * 1000);
  assert.equal(CHARGE_SETTLE_MS, 24 * 60 * 60 * 1000);
});

test('the demo org’s rows flag only the order that’s short', () => {
  assert.deepEqual(flags(facts(25.49, [pay(24.49, 0)])), [{ kind: 'missing', amount: 1 }]); // S2L67-2JO6Q-SRS22-K4Q6H
  assert.deepEqual(flags(facts(106.57, [pay(45.68, 106.57)])), []); // 00035907
  assert.deepEqual(flags(facts(80.85, [pay(0, 80.85)])), []); // 00035908
  assert.deepEqual(flags(facts(4.59, [pay(0, 4.59)])), []); // 00035807
  assert.deepEqual(flags(facts(0, [pay(0, 0)])), []); // 00036007
  assert.deepEqual(flags(facts(36.47, [pay(44.09, 0)])), []); // 00035534
  const s = moneyState(facts(25.49, [pay(24.49, 0)]), { now: NOW });
  assert.equal(s.missing, 1);
  assert.equal(s.held, 24.49);
  assert.equal(s.paid, 0);
});

test('an expired hold doesn’t cover the order', () => {
  const s = moneyState(facts(50, [pay(50, 0, 50)]), { now: NOW });
  assert.equal(s.held, 0);
  assert.equal(s.missing, 50);
});

test('a credit memo’s balance is a refund needed, and isn’t counted again as charged too much', () => {
  const s = moneyState(facts(80, [pay(0, 95)], { memos: [{ id: 'CM1', number: 'CM-1', balance: 15 }] }), { now: NOW });
  assert.equal(s.memo, 15);
  assert.equal(s.excess, 0);
  assert.deepEqual(s.flags, [{ kind: 'memo', amount: 15 }]);
});

test('charged more than the total with no memo is a direct refund', () => {
  const s = moneyState(facts(80, [pay(0, 95)], { changedAt: ago(HOUR) }), { now: NOW });
  assert.equal(s.excess, 15);
  assert.equal(s.refunding, false);
  assert.deepEqual(s.flags, [{ kind: 'excess', amount: 15 }]);
});

test('a change in the last 15 minutes is a refund on its way, not a flag', () => {
  const s = moneyState(facts(80, [pay(0, 95)], { changedAt: ago(5 * 60e3) }), { now: NOW });
  assert.equal(s.refunding, true);
  assert.equal(s.excess, 0);
  assert.deepEqual(s.flags, [{ kind: 'refunding', amount: 15 }]);
});

test('an invoice open more than a day while the hold covers it is not collected', () => {
  const inv = (at) => ({ invoices: [{ id: 'INV1', number: 'DOC-1', balance: 60, at }] });
  const s = moneyState(facts(60, [pay(60, 0)], inv(ago(2 * DAY))), { now: NOW });
  assert.deepEqual(s.flags, [{ kind: 'uncollected', amount: 60 }]);
  assert.deepEqual(s.uncollected, [{ id: 'INV1', number: 'DOC-1', balance: 60 }]);
  assert.deepEqual(flags(facts(60, [pay(60, 0)], inv(ago(2 * HOUR)))), []);
});

test('an invoice whose money was already charged isn’t counted as not collected', () => {
  // 00034107 in a demo org: $783.82 captured, nothing left to capture, and both invoices still show their full balance.
  const f = facts(783.82, [pay(0, 783.82)], { invoices: [{ id: 'INV1', number: 'DOC-000001221', balance: 458.33, at: ago(200 * DAY) }, { id: 'INV2', number: 'DOC-000001220', balance: 325.49, at: ago(200 * DAY) }] });
  assert.deepEqual(flags(f), []);
});

test('not collected is never more than what’s still held', () => {
  const f = facts(100, [pay(40, 60)], { invoices: [{ id: 'INV1', number: 'DOC-1', balance: 100, at: ago(3 * DAY) }] });
  assert.deepEqual(flags(f), [{ kind: 'uncollected', amount: 40 }]);
});

test('no payment summary, or an order Order Management doesn’t manage, flags nothing', () => {
  assert.equal(moneyState(facts(50, []), { now: NOW }), null);
  assert.equal(moneyState({ ...facts(50, [pay(0, 0)]), managed: false }, { now: NOW }), null);
});

test('half a cent flags nothing', () => {
  assert.deepEqual(flags(facts(10, [pay(9.996, 0)])), []);
});

test('it answers what each card has paid and has held', () => {
  const visa = { ...pay(20, 0), id: 'OPS1', label: 'Visa - 4242' }, mc = { ...pay(10, 5, 4), id: 'OPS2', label: 'Mastercard - 5454' };
  assert.deepEqual(moneyState(facts(40, [visa, mc]), { now: NOW }).methods, [{ id: 'OPS1', label: 'Visa - 4242', paid: 0, held: 20 }, { id: 'OPS2', label: 'Mastercard - 5454', paid: 5, held: 6 }]);
});

test('what was captured counts against an invoice’s balance, so an order already charged isn’t "not collected"', () => {
  const old = ago(2 * DAY);
  // The demo org's 00029808: 29.93 captured and the same still on its invoice, the rest held for what hasn't shipped.
  assert.deepEqual(flags(facts(249.37, [{ ...pay(249.37, 29.93), captured: 29.93 }], { invoices: [{ id: 'INV1', number: 'DOC-1', balance: 29.93, at: old }] })), []);
  // A split shipment: the first invoice charged (its balance kept), the second one's charge failed.
  const split = facts(100, [{ ...pay(40, 60), captured: 60 }], { invoices: [{ id: 'INV1', balance: 60, at: old }, { id: 'INV2', balance: 40, at: old }] });
  assert.deepEqual(flags(split), [{ kind: 'uncollected', amount: 40 }]);
  // Nothing captured and the invoice still open: a charge that didn't happen, as before.
  assert.deepEqual(flags(facts(100, [pay(100, 0)], { invoices: [{ id: 'INV1', balance: 60, at: old }] })), [{ kind: 'uncollected', amount: 60 }]);
});

// A demo org's five exchange orders (2026-10-28): each has a hold for what the replacements cost more, or nothing, and its
// return order on the order it came from. Order Management counts the return's value as still owed on each.
const RO = (total, status = 'Submitted', category = 'Activated') => ({ total, status, category });
const exchangeOf = (ro, placed, n = 'RO-0200') => ({ returnOrderId: '2oN1', number: n, value: returnCredit(ro, placed) });

test('what an exchange order’s return pays for: its total, up to what the exchange order was placed at, unless it’s canceled', () => {
  assert.equal(returnCredit(RO(28.87), 42.52), 28.87); // VWTCS-3V6GO-2VDAS-63W7T, RO-0200
  assert.equal(returnCredit(RO(76.65), 23.62), 23.62); // J64XR-OGH23-QJESH-4CDW4, RO-0198: an even exchange
  assert.equal(returnCredit(RO(15.6, 'Closed', 'Closed'), 17.69), 15.6, 'received or not');
  assert.equal(returnCredit(RO(15.6), null), 15.6, 'no placed total: the return order’s');
  assert.equal(returnCredit(RO(15.6, 'Canceled', 'Canceled'), 17.69), 0);
  assert.equal(returnCredit(RO(15.6, 'Submitted', 'Canceled'), 17.69), 0);
  assert.equal(returnCredit(null, 17.69), 0);
  assert.equal(returnCredit(RO(null), 17.69), 0);
});

test('an exchange order isn’t missing what its return pays for, only what it’s short beyond that', () => {
  // VWTCS ($42.52, $13.65 held) and 5AHQB ($42.52, $24.15 held): the return pays the rest.
  const vwtcs = moneyState(facts(42.52, [pay(13.65, 0)], { exchange: exchangeOf(RO(28.87), 42.52) }), { now: NOW });
  assert.deepEqual([vwtcs.missing, vwtcs.flags], [0, []]);
  assert.deepEqual(vwtcs.exchange, { returnOrderId: '2oN1', number: 'RO-0200', covers: 28.87 });
  assert.deepEqual(flags(facts(42.52, [pay(24.15, 0)], { exchange: exchangeOf(RO(18.37), 42.52) })), []);
  // "Exchange order after ERR" ($17.69, $2.09 held, a $15.60 return) is paid; "before fix ERR" ($29.34, $2.09 held, a $15.60
  // return) is still $11.65 short.
  assert.deepEqual(flags(facts(17.69, [pay(2.09, 0)], { exchange: exchangeOf(RO(15.6), 17.69) })), []);
  assert.deepEqual(flags(facts(29.34, [pay(2.09, 0)], { exchange: exchangeOf(RO(15.6), 29.34) })), [{ kind: 'missing', amount: 11.65 }]);
  // The same orders without it: the return's value reads as missing, as Order Management counts it.
  assert.deepEqual(flags(facts(42.52, [pay(13.65, 0)])), [{ kind: 'missing', amount: 28.87 }]);
});

test('an even exchange has no payment of its own, and its return pays for all of it', () => {
  // J64XR ($23.62): no payment summary, a $76.65 return.
  const s = moneyState(facts(23.62, [], { exchange: exchangeOf(RO(76.65), 23.62, 'RO-0198') }), { now: NOW });
  assert.deepEqual([s.missing, s.paid, s.held, s.methods, s.exchange.covers, s.flags], [0, 0, 0, [], 23.62, []]);
  // A raise left for later on it is missing; a canceled return leaves all of it missing.
  assert.deepEqual(flags(facts(28.62, [], { exchange: exchangeOf(RO(76.65), 23.62) })), [{ kind: 'missing', amount: 5 }]);
  assert.deepEqual(flags(facts(23.62, [], { exchange: exchangeOf(RO(76.65, 'Canceled', 'Canceled'), 23.62) })), [{ kind: 'missing', amount: 23.62 }]);
});

test('what an exchange order’s return pays for is never a refund', () => {
  // A discount on it lowers what's owed; the return's value doesn't come back as charged too much.
  assert.deepEqual(flags(facts(10, [pay(2.09, 0)], { exchange: exchangeOf(RO(15.6), 17.69) })), []);
});
