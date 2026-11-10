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
/* Policies: all rules, defaults and store assignments, per-panel CSV, and independence from period. */
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { panelTests, n, usd, table } from "./dashboard-kit.mjs";
const pw = await loadPlaywright();
const rules = (p) => p.kind === 'return' ? p.days == null ? 'Any time' : `Within ${n(p.days)} days of ${p.from === 'order' ? 'the order' : 'delivery'}` : p.kind === 'cancel' ? p.hours == null ? 'Until items ship' : `Within ${n(p.hours)} hours of the order` : `${[p.maxPercent != null ? `${p.maxPercent}% of products` : '', p.maxAmount != null ? usd(p.maxAmount) : ''].filter(Boolean).join(' or ') || 'Any size'}${p.maxPercent != null || p.maxAmount != null ? ' per order, all discounts together' : ''}`;
const stores = (b, k, p) => b.assignments.filter((a) => a[k] ? a[k].slice(0, 15) === p.id.slice(0, 15) : p.isDefault).map((a) => a.store || a.storeId);
const name = (b, k, id) => id ? b[k].find((p) => p.id.slice(0, 15) === id.slice(0, 15))?.name || 'inactive or deleted' : 'default';
const kind = (key, id, title, source) => [id, title, source, (p, d, b) => table(p, id, ['Policy', 'Rule', 'When broken', 'Applies to'], b[key].map((r) => [r.name + (r.isDefault ? ' Default' : ''), rules(r), r.enforce === 'warn' ? 'Warns' : 'Blocks', [r.isDefault ? 'Every store without its own' : '', ...stores(b, key, r)].filter(Boolean).join(', ') || 'No store yet'])), (d, b) => [['policy', 'rule', 'enforcement', 'default', 'stores'], ...b[key].map((r) => [r.name, rules(r), r.enforce, r.isDefault, stores(b, key, r).join('; ')])]];

panelTests(pw, 'policies', [
  kind('return', 'pPolReturn', 'Return policies', 'Return policy'),
  kind('cancel', 'pPolCancel', 'Cancel policies', 'Cancel policy'),
  kind('adjust', 'pPolAdjust', 'Adjustment policies', 'Adjustment policy'),
  ['pPolAssign', 'Store assignments', 'Store policy assignment', (p, d, b) => table(p, 'pPolAssign', ['Store', 'Return', 'Cancel', 'Adjustment'], b.assignments.map((a) => [a.store, ...['return', 'cancel', 'adjust'].map((k) => name(b, k, a[k]))])), (d, b) => [['store', 'return', 'cancel', 'adjustment'], ...b.assignments.map((a) => [a.store, ...['return', 'cancel', 'adjust'].map((k) => name(b, k, a[k]))])]],
]);
