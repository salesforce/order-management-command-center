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
// About the org itself: the Agentforce agent behind Agentforce, whether Omnichannel Inventory and Delivery Estimation are on, and
// the Limits view's limits, licences and jobs. Part of the read model (om-core.js); nothing here writes.

export function orgReads(k) {
  const { api, soql, has, pick, safe, instanceUrl } = k;
  // The Agentforce agent behind the Agentforce panel, by developer name (Ids differ per org), with an Active version. Null when
  // the org has no agents (no BotDefinition: Agentforce isn't on), the agent isn't deployed, or none of its versions is
  // active; the page then hides the panel's button. Flex Credits can't be read reliably, so they're never checked here: a
  // session that fails for them shows its error in the panel.
  // A found agent is kept per org, so agent calls don't query each time; a miss or an error is asked again next time.
  let agentFound = null; // { org, id }
  async function agentInfo() {
    if (agentFound && agentFound.org === instanceUrl()) return { agent: { id: agentFound.id } };
    if (!(await has('BotDefinition'))) return { agent: null };
    const active = (await has('BotVersion')) ? " AND Id IN (SELECT BotDefinitionId FROM BotVersion WHERE Status = 'Active')" : '';
    const [row] = await soql(`SELECT Id FROM BotDefinition WHERE DeveloperName = 'OM_Console_Assistant_Classic'${active} LIMIT 1`);
    if (!row) return { agent: null };
    agentFound = { org: instanceUrl(), id: row.Id };
    return { agent: { id: row.Id } };
  }

  // ---------- Limits view ----------
  // Org limits (/limits), entitlements, licences and today's async jobs. Each part degrades alone (safe); an object the org
  // lacks gives data: null. Inside Salesforce, request() answers /limits from Apex (OrgLimits), the REST endpoint is off there.
  // `only=api` is the heartbeat: just DailyApiRequests, one call.
  const jobRows = (rows) => rows.map((r) => ({ status: r.s ?? '(blank)', type: r.t ?? '(blank)', n: r.c }));
  const rowsOf = async (object, wanted, where, order) => {
    if (!(await has(object))) return null;
    const f = await pick(object, wanted);
    return f.length ? soql(`SELECT ${f.join(', ')} FROM ${object}${where && f.includes(where.field) ? ` WHERE ${where.field} ${where.test}` : ''}${order && f.includes(order) ? ` ORDER BY ${order}` : ''} LIMIT 500`) : null;
  };
  // Whether Omnichannel Inventory and Delivery Estimation are switched on (used only to skip their lookups), read from their Setup settings (Tooling API). An
  // unreadable setting is `on: null` (unknown), so only a definite false skips anything. Kept five minutes per org. Inside
  // Salesforce the Tooling API is closed, so om-platform.js answers from whether SomConsoleConnect is deployed instead.
  const FEATURES = [{ key: 'inventory', name: 'Omnichannel Inventory', object: 'InventorySettings', field: 'IsOmniChannelInventoryEnabled' },
    { key: 'delivery', name: 'Delivery Estimation', object: 'OrderManagementSettings', field: 'DeliveryEstimationEnabled' }];
  let featureCache = null; // { org, at, list }
  async function features() {
    if (featureCache && featureCache.org === instanceUrl() && Date.now() - featureCache.at < 300000) return featureCache.list;
    const list = await Promise.all(FEATURES.map(async ({ key, name, object, field }) => {
      try {
        const v = (await api(`/tooling/query?q=${encodeURIComponent(`SELECT ${field} FROM ${object} LIMIT 1`)}`)).records?.[0]?.[field];
        return { key, name, on: typeof v === 'boolean' ? v : null };
      } catch (e) { return { key, name, on: null, note: e.message }; }
    }));
    featureCache = { org: instanceUrl(), at: Date.now(), list };
    return list;
  }
  const featureOff = async (key) => (await features()).find((f) => f.key === key)?.on === false;
  async function limitsData(only) {
    const at = new Date().toISOString();
    if (only === 'api') return { at, org: await safe(async () => ({ DailyApiRequests: (await api('/limits')).DailyApiRequests ?? null })) };
    const [org, entitlements, orderSummary, user, permissionSet, jobs] = await Promise.all([
      safe(() => api('/limits')),
      safe(() => rowsOf('TenantUsageEntitlement', ['MasterLabel', 'Setting', 'Frequency', 'CurrentAmountAllowed', 'AmountUsed', 'UsageDate'], null, 'MasterLabel')),
      safe(async () => (await has('OrderSummary')) ? { count: (await soql('SELECT COUNT(Id) c FROM OrderSummary'))[0]?.c ?? 0 } : null),
      safe(() => rowsOf('UserLicense', ['Name', 'Status', 'TotalLicenses', 'UsedLicenses'], { field: 'TotalLicenses', test: '> 0' }, 'Name')),
      safe(() => rowsOf('PermissionSetLicense', ['MasterLabel', 'TotalLicenses', 'UsedLicenses', 'ExpirationDate'], { field: 'TotalLicenses', test: '> 0' }, 'MasterLabel')),
      safe(async () => (await has('AsyncApexJob')) ? jobRows(await soql('SELECT Status s, JobType t, COUNT(Id) c FROM AsyncApexJob WHERE CreatedDate = TODAY GROUP BY Status, JobType')) : null)]);
    // The order summary entitlement reports no usage of its own, so show the count of OrderSummary rows against it.
    if (entitlements.ok && orderSummary.ok && orderSummary.data) {
      entitlements.data = entitlements.data?.map((e) => /LOMOrderSummaryTotal$/.test(e.Setting || '') && e.AmountUsed == null ? { ...e, AmountUsed: orderSummary.data.count, usedFrom: 'OrderSummary count' } : e) ?? null;
    }
    const licenses = user.ok && permissionSet.ok ? { ok: true, data: { user: user.data, permissionSet: permissionSet.data } } : { ok: false, error: user.error || permissionSet.error };
    // What this user can read, part by part: "ok", "empty" (readable, no rows), or "blocked" (hidden from this user, or not in this org).
    const check = (name, r) => ({ name, state: !r.ok ? 'blocked' : r.data == null ? 'blocked' : Array.isArray(r.data) && !r.data.length ? 'empty' : 'ok',
      note: !r.ok ? r.error : r.data == null ? 'Not visible to your user, or not in this org' : '' });
    const access = [check('Org limits', org), check('Entitlements', entitlements), check('User licences', user), check('Permission set licences', permissionSet),
      check('Async Apex jobs', jobs), check('Order summary count', orderSummary)];
    return { at, org, entitlements, licenses, jobs, orderSummary, access };
  }

  const routes = [
    ['/api/agent/info', () => agentInfo()],
    ['/api/limits', (m, q) => limitsData(q('only'))],
  ];
  return { agentInfo, features, featureOff, limitsData, routes };
}
