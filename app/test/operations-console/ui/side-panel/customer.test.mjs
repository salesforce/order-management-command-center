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
/* Customer value, rankings, loyalty, alternate customer states and the order drill-down. */
import assert from 'node:assert/strict';
import { loadPlaywright } from "../../../../tools/browser-kit.mjs";
import { panelTest, sample, open, facts, rows, usd, n, text, fixture } from "./side-panel-kit.mjs";
const pw = await loadPlaywright(), AVERY = 'DACC00000000000';

panelTest(pw, 'customer metrics rankings loyalty and recent records', async ({ page, step }) => {
  const d = await sample(page, 'demoAccount', AVERY), v = d.value, r = d.returns, member = d.loyalty.members[0];
  await step(() => open(page, 'Account', AVERY));
  assert.equal(await text(page, '#drawer .hd b'), d.account.Name);
  const f = await facts(page);
  for (const [key, value] of [['Lifetime spend', usd(v.spend)], ['Orders', n(v.orders)], ['Avg order', usd(v.aov)], ['Net of returns', usd(v.spend - r.amount)], ['Units returned', n(r.units)], ['Return rate', `${Math.round(r.rate * 100)}% of spend`], ['Program', member.Program.Name], ['Member #', member.MembershipNumber], ['Tier', member.tiers[0].LoyaltyTier.Name]]) assert.equal(f[key], value, key);
  assert.deepEqual(await rows(page, 'Loyalty'), member.points.map((p) => [p.Name, n(p.PointsBalance), n(p.TotalPointsAccrued), n(p.TotalPointsRedeemed)]));
  for (const rank of [v.rank.spend, v.rank.orders]) assert.ok((await text(page)).includes(`#${n(rank.pos)} of ${n(rank.of)} shoppers`));
  assert.ok((await text(page, '#drawer .badges')).includes('Platinum tier'));
  assert.deepEqual((await rows(page, 'Why they return')).map((r) => r), d.returns.reasons.map((r) => [r.key, n(r.n), n(r.units)]));
  assert.equal((await rows(page, 'Recent orders')).length, d.recentOrders.length);
  const first = d.recentOrders[0];
  await step(() => page.locator(`#drawer [data-rec="OrderSummary:${first.Id}"]`).click());
  assert.equal(await text(page, '#drawer .hd b'), first.OrderNumber);
  await page.locator('#dBack').click();
  assert.equal(await text(page, '#drawer .hd b'), d.account.Name);
});

panelTest(pw, 'customer badges distinguish heavy returner lapsed and no-return shoppers', async ({ page }) => {
  for (const [id, expected] of [['DACC00000000002', 'Top 2% returner'], ['DACC00000000003', 'Lapsed · no order in 12 months'], ['DACC00000000004', 'Never returned']]) {
    await open(page, 'Account', id);
    assert.ok((await text(page, '#drawer .badges')).includes(expected), expected);
  }
});

panelTest(pw, 'customer unavailable data empty lists and nonmembers', async ({ page }) => {
  const d = await sample(page, 'demoAccount', AVERY);
  await fixture(page, 'account', AVERY, { value: { ...d, value: null, returns: null, cases: null, recentOrders: [], loyalty: null, objects: { ...d.objects, OrderSummary: false, LoyaltyProgramMember: false } } });
  await open(page, 'Account', AVERY);
  assert.ok((await text(page)).includes("Loyalty Management isn't enabled in this org."));
  assert.ok((await text(page)).includes('No orders.'));
  assert.equal((await facts(page))['Lifetime spend'], undefined);
  assert.doesNotMatch(await text(page), /undefined|NaN|Invalid Date/);
  const business = 'DACC00000000001';
  await open(page, 'Account', business);
  assert.ok((await text(page)).includes('Not a loyalty member.'));
  assert.equal((await facts(page)).Type, 'Customer - Direct');
});
